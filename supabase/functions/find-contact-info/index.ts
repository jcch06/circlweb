import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Recherche d'email pro / téléphone d'un contact via FullEnrich (API v2,
// waterfall), revendue au crédit. Débit seulement si une valeur est trouvée.
// Asynchrone, car le waterfall peut prendre plusieurs minutes :
//   { contact_id, kind: 'email' | 'phone' }  lance la recherche, renvoie { job_id, status: 'pending', balance }
//   { job_id }                               renvoie { status: 'pending' | 'found' | 'not_found' | 'error', value?, error?, balance }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FULLENRICH_API_KEY = Deno.env.get("FULLENRICH_API_KEY");
const FE = "https://app.fullenrich.com/api/v2/contact/enrich/bulk";
const COST: Record<string, number> = { email: 1, phone: 10 };
const BAD_EMAIL = new Set(["INVALID", "INVALID_DOMAIN"]);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Fait avancer une recherche : interroge le fournisseur, puis clôt en une
// seule transaction SQL (débit, écriture de la fiche, état final). Utilisé
// par le suivi du client et par le balayage quotidien du cron.
const JOB_EXPIRE_MS = 2 * 60 * 60 * 1000;
async function advance(admin: any, job: any): Promise<{ status: string; value?: string | null; error?: string | null }> {
  if (!["pending", "finalizing"].includes(job.status)) return { status: job.status, value: job.value, error: job.error };
  const age = Date.now() - new Date(job.created_at).getTime();
  const expire = async () => {
    const error = "La recherche n'a pas abouti. Aucun crédit utilisé.";
    await admin.from("enrichment_jobs").update({ status: "error", error, finished_at: new Date().toISOString() }).eq("id", job.id).in("status", ["pending", "finalizing"]);
    return { status: "error", error };
  };
  if (!job.enrichment_id) return age > 5 * 60 * 1000 ? expire() : { status: "pending" };
  const res = await fetch(`${FE}/${job.enrichment_id}`, { headers: { Authorization: `Bearer ${FULLENRICH_API_KEY}` } }).catch(() => null);
  if (!res || !res.ok) return age > JOB_EXPIRE_MS ? expire() : { status: "pending" };
  const result = await res.json();
  if (result.status !== "FINISHED") {
    if (["CANCELED", "CREDITS_INSUFFICIENT", "UNKNOWN"].includes(result.status)) {
      const error = result.status === "CREDITS_INSUFFICIENT" ? "Le service d'enrichissement est momentanément indisponible. Aucun crédit utilisé." : `FullEnrich : ${result.status}`;
      await admin.from("enrichment_jobs").update({ status: "error", error, finished_at: new Date().toISOString() }).eq("id", job.id).in("status", ["pending", "finalizing"]);
      return { status: "error", error };
    }
    return age > JOB_EXPIRE_MS ? expire() : { status: "pending" };
  }
  const info = result.data?.[0]?.contact_info ?? {};
  let value: string | null = null;
  if (job.kind === "email") {
    const best = info.most_probable_work_email ?? info.most_probable_personal_email;
    if (best?.email && !BAD_EMAIL.has(best.status)) value = best.email;
  } else {
    value = info.most_probable_phone?.number ?? null;
  }
  const { data: status, error } = await admin.rpc("finalize_enrichment_job", { p_job: job.id, p_value: value });
  if (error) {
    // La transaction a été annulée : rien n'est débité.
    const msg = "La fiche n'a pas pu être mise à jour (valeur déjà utilisée par une autre fiche ?). Aucun crédit utilisé.";
    await admin.from("enrichment_jobs").update({ status: "error", error: msg, finished_at: new Date().toISOString() }).eq("id", job.id);
    return { status: "error", error: msg };
  }
  return { status: status === "found" ? "found" : status, value: status === "found" ? value : null };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    // Balayage quotidien (cron, clé service-role) : clôt les recherches que
    // personne n'a suivies jusqu'au bout.
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    const secretKeys = (() => { try { return Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}")) as string[]; } catch { return []; } })();
    if (bearer === SERVICE_KEY || secretKeys.includes(bearer)) {
      if (!FULLENRICH_API_KEY) return json({ swept: 0 });
      const svc = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data: jobs } = await svc.from("enrichment_jobs").select("*").in("status", ["pending", "finalizing"])
        .lt("created_at", new Date(Date.now() - 60 * 1000).toISOString()).limit(50);
      const out = [];
      for (const j of jobs ?? []) out.push((await advance(svc, j)).status);
      return json({ swept: out.length, statuses: out });
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const getBalance = async () => {
      const { data } = await admin.from("enrichment_credits").select("balance").eq("user_id", user.id).maybeSingle();
      return data?.balance ?? 25;
    };
    if (!FULLENRICH_API_KEY) return json({ error: "Enrichissement non configuré", balance: await getBalance() }, 503);

    const body = await req.json();

    // ---- Suivi d'une recherche lancée ----
    if (body.job_id) {
      const { data: job } = await admin.from("enrichment_jobs").select("*").eq("id", body.job_id).eq("user_id", user.id).maybeSingle();
      if (!job) return json({ error: "Recherche introuvable" }, 404);
      const r = await advance(admin, job);
      return json({ ...r, balance: await getBalance() });
    }

    // ---- Lancement ----
    const { contact_id, kind } = body;
    if (!contact_id || (kind !== "email" && kind !== "phone")) return json({ error: "Requête invalide" }, 400);
    const cost = COST[kind];

    // Autorisation : le contact doit être visible ET déverrouillé pour l'appelant.
    const { data: contact } = await userClient
      .from("contacts_visible")
      .select("id, space_id, owner_id, first_name, last_name, company, linkedin, is_unlocked")
      .eq("id", contact_id)
      .maybeSingle();
    if (!contact) return json({ error: "Contact introuvable" }, 404);
    if (!contact.is_unlocked) return json({ error: "Contact verrouillé" }, 403);

    // FullEnrich exige prénom, nom, et une entreprise ou un LinkedIn.
    const linkedin = contact.linkedin ? (contact.linkedin.startsWith("http") ? contact.linkedin : `https://${contact.linkedin}`) : undefined;
    const first = contact.first_name?.trim(), last = contact.last_name?.trim(), company = contact.company?.trim();
    if (!first || !last) return json({ error: "Il faut le prénom et le nom pour lancer la recherche." }, 422);
    if (!company && !linkedin) return json({ error: "Ajoutez l'entreprise ou le LinkedIn pour lancer la recherche." }, 422);

    // Seuls le propriétaire de la fiche et les admins du cercle peuvent l'écrire :
    // inutile de payer une recherche dont le résultat ne pourrait pas être enregistré.
    if (contact.owner_id !== user.id) {
      const { data: m } = await userClient.from("space_members").select("role").eq("space_id", contact.space_id).eq("user_id", user.id).maybeSingle();
      if (!m || !["owner", "admin"].includes(m.role)) {
        return json({ error: "Seul le propriétaire de la fiche peut lancer cette recherche." }, 403);
      }
    }

    // Réservation transactionnelle AVANT l'appel au fournisseur : solde moins
    // recherches en cours, et une seule recherche active par fiche et par champ.
    const { data: jobId, error: resErr } = await admin.rpc("reserve_enrichment_job", { p_user: user.id, p_contact: contact_id, p_kind: kind, p_cost: cost });
    if (resErr) {
      if (resErr.code === "23505") {
        const { data: active } = await admin.from("enrichment_jobs").select("id").eq("user_id", user.id).eq("contact_id", contact_id)
          .eq("kind", kind).in("status", ["pending", "finalizing"]).maybeSingle();
        return json({ job_id: active?.id, status: "pending", balance: await getBalance() });
      }
      if (/insuffisants/i.test(resErr.message)) return json({ error: "Crédits insuffisants", balance: await getBalance() }, 402);
      return json({ error: resErr.message }, 500);
    }
    const fail = async (error: string, status = 502) => {
      await admin.from("enrichment_jobs").update({ status: "error", error, finished_at: new Date().toISOString() }).eq("id", jobId);
      return json({ error, balance: await getBalance() }, status);
    };

    const start = await fetch(FE, {
      method: "POST",
      headers: { Authorization: `Bearer ${FULLENRICH_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `circl-${contact_id}`,
        data: [{
          first_name: first,
          last_name: last,
          ...(company ? { company_name: company } : {}),
          ...(linkedin ? { linkedin_url: linkedin } : {}),
          enrich_fields: [kind === "email" ? "contact.work_emails" : "contact.phones"],
        }],
      }),
    }).catch(() => null);
    if (!start || !start.ok) {
      const detail = start ? (await start.text()).slice(0, 300) : "réseau";
      console.error("FullEnrich start", start?.status, detail);
      return fail(`FullEnrich ${start?.status ?? ""} : ${detail}`);
    }
    const { enrichment_id } = await start.json();
    if (!enrichment_id) return fail("FullEnrich : pas d'identifiant d'enrichissement");
    await admin.from("enrichment_jobs").update({ enrichment_id }).eq("id", jobId);
    return json({ job_id: jobId, status: "pending", balance: await getBalance() });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
