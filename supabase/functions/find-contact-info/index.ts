import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Recherche d'email pro / téléphone d'un contact via FullEnrich (API v2,
// waterfall), revendue au crédit. Débit seulement si une valeur est trouvée.
// Entrée : { contact_id, kind: 'email' | 'phone' }.
// Sortie : { value: string | null, balance: number }.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FULLENRICH_API_KEY = Deno.env.get("FULLENRICH_API_KEY");
const FE = "https://app.fullenrich.com/api/v2/contact/enrich/bulk";
const COST: Record<string, number> = { email: 1, phone: 10 };

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

    const { contact_id, kind } = await req.json();
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

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: credits } = await admin.from("enrichment_credits").select("balance").eq("user_id", user.id).maybeSingle();
    const balance = credits?.balance ?? 25;
    if (balance < cost) return json({ error: "Crédits insuffisants", balance }, 402);

    if (!FULLENRICH_API_KEY) return json({ error: "Enrichissement non configuré", balance }, 503);

    const field = kind === "email" ? "contact.work_emails" : "contact.phones";
    const start = await fetch(FE, {
      method: "POST",
      headers: { Authorization: `Bearer ${FULLENRICH_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `circl-${contact_id}`,
        data: [{
          first_name: contact.first_name ?? "",
          last_name: contact.last_name ?? "",
          company_name: contact.company ?? undefined,
          linkedin_url: contact.linkedin ? (contact.linkedin.startsWith("http") ? contact.linkedin : `https://${contact.linkedin}`) : undefined,
          enrich_fields: [field],
        }],
      }),
    });
    if (!start.ok) return json({ error: `FullEnrich : ${start.status}`, balance }, 502);
    const { enrichment_id } = await start.json();
    if (!enrichment_id) return json({ error: "FullEnrich : pas d'identifiant d'enrichissement", balance }, 502);

    // Le waterfall prend de quelques secondes à ~1 min : on interroge toutes les 3 s.
    let result: any = null;
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const res = await fetch(`${FE}/${enrichment_id}`, { headers: { Authorization: `Bearer ${FULLENRICH_API_KEY}` } });
      if (!res.ok) continue;
      const body = await res.json();
      if (body.status === "FINISHED") { result = body; break; }
      if (["CANCELED", "CREDITS_INSUFFICIENT", "UNKNOWN"].includes(body.status)) {
        return json({ error: `FullEnrich : ${body.status}`, balance }, 502);
      }
    }
    if (!result) return json({ error: "La recherche prend plus de temps que prévu, réessayez dans une minute.", balance }, 504);

    const info = result.data?.[0]?.contact_info ?? {};
    const BAD = new Set(["INVALID", "INVALID_DOMAIN"]);
    let value: string | null = null;
    if (kind === "email") {
      const best = info.most_probable_work_email ?? info.most_probable_personal_email;
      if (best?.email && !BAD.has(best.status)) value = best.email;
    } else {
      value = info.most_probable_phone?.number ?? null;
    }
    if (!value) return json({ value: null, balance });

    // Écriture sous les droits de l'appelant (RLS) ; débit seulement si trouvé.
    await userClient.from("contacts").update({ [kind]: value }).eq("id", contact_id);
    const { data: newBalance } = await admin.rpc("debit_enrichment_credits", {
      p_user: user.id, p_cost: cost, p_reason: `fullenrich_${kind}`, p_contact: contact_id,
    });
    return json({ value, balance: typeof newBalance === "number" && newBalance >= 0 ? newBalance : balance - cost });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
