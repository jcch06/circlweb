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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
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
      if (job.status !== "pending") return json({ status: job.status, value: job.value, error: job.error, balance: await getBalance() });

      const res = await fetch(`${FE}/${job.enrichment_id}`, { headers: { Authorization: `Bearer ${FULLENRICH_API_KEY}` } });
      if (!res.ok) return json({ status: "pending", balance: await getBalance() });
      const result = await res.json();
      if (result.status !== "FINISHED") {
        if (["CANCELED", "CREDITS_INSUFFICIENT", "UNKNOWN"].includes(result.status)) {
          const error = result.status === "CREDITS_INSUFFICIENT" ? "Le service d'enrichissement est momentanément indisponible." : `FullEnrich : ${result.status}`;
          await admin.from("enrichment_jobs").update({ status: "error", error, finished_at: new Date().toISOString() }).eq("id", job.id).eq("status", "pending");
          return json({ status: "error", error, balance: await getBalance() });
        }
        return json({ status: "pending", balance: await getBalance() });
      }

      const info = result.data?.[0]?.contact_info ?? {};
      let value: string | null = null;
      if (job.kind === "email") {
        const best = info.most_probable_work_email ?? info.most_probable_personal_email;
        if (best?.email && !BAD_EMAIL.has(best.status)) value = best.email;
      } else {
        value = info.most_probable_phone?.number ?? null;
      }

      // Clôture atomique : un seul appel gagne, donc un seul débit.
      const { data: won } = await admin.from("enrichment_jobs")
        .update({ status: value ? "found" : "not_found", value, finished_at: new Date().toISOString() })
        .eq("id", job.id).eq("status", "pending").select("id");
      if (!won?.length) {
        const { data: done } = await admin.from("enrichment_jobs").select("status, value, error").eq("id", job.id).single();
        return json({ ...done, balance: await getBalance() });
      }
      if (!value) return json({ status: "not_found", balance: await getBalance() });

      const { data: newBalance } = await admin.rpc("debit_enrichment_credits", {
        p_user: user.id, p_cost: COST[job.kind], p_reason: `fullenrich_${job.kind}`, p_contact: job.contact_id,
      });
      if (typeof newBalance !== "number" || newBalance < 0) {
        const error = "Crédits insuffisants";
        await admin.from("enrichment_jobs").update({ status: "error", value: null, error }).eq("id", job.id);
        return json({ status: "error", error, balance: await getBalance() });
      }
      // Écriture sous les droits de l'appelant (RLS).
      await userClient.from("contacts").update({ [job.kind]: value }).eq("id", job.contact_id);
      return json({ status: "found", value, balance: newBalance });
    }

    // ---- Lancement ----
    const { contact_id, kind } = body;
    if (!contact_id || (kind !== "email" && kind !== "phone")) return json({ error: "Requête invalide" }, 400);
    const cost = COST[kind];

    // Autorisation : le contact doit être visible ET déverrouillé pour l'appelant.
    const { data: contact } = await userClient
      .from("contacts_visible")
      .select("id, first_name, last_name, company, linkedin, is_unlocked")
      .eq("id", contact_id)
      .maybeSingle();
    if (!contact) return json({ error: "Contact introuvable" }, 404);
    if (!contact.is_unlocked) return json({ error: "Contact verrouillé" }, 403);

    // FullEnrich exige prénom, nom, et une entreprise ou un LinkedIn.
    const linkedin = contact.linkedin ? (contact.linkedin.startsWith("http") ? contact.linkedin : `https://${contact.linkedin}`) : undefined;
    const first = contact.first_name?.trim(), last = contact.last_name?.trim(), company = contact.company?.trim();
    if (!first || !last) return json({ error: "Il faut le prénom et le nom pour lancer la recherche." }, 422);
    if (!company && !linkedin) return json({ error: "Ajoutez l'entreprise ou le LinkedIn pour lancer la recherche." }, 422);

    const balance = await getBalance();
    if (balance < cost) return json({ error: "Crédits insuffisants", balance }, 402);

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
    });
    if (!start.ok) {
      const detail = (await start.text()).slice(0, 300);
      console.error("FullEnrich start", start.status, detail);
      return json({ error: `FullEnrich ${start.status} : ${detail}`, balance }, 502);
    }
    const { enrichment_id } = await start.json();
    if (!enrichment_id) return json({ error: "FullEnrich : pas d'identifiant d'enrichissement", balance }, 502);

    const { data: job, error: jobError } = await admin.from("enrichment_jobs")
      .insert({ user_id: user.id, contact_id, kind, enrichment_id }).select("id").single();
    if (jobError) return json({ error: jobError.message, balance }, 500);
    return json({ job_id: job.id, status: "pending", balance });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
