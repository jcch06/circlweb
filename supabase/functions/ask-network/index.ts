import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// « Demander » : interroger son réseau en langage naturel (web).
// Lit contacts_visible SOUS LA SESSION de l'appelant : RLS (cercles dont il
// est membre) et masquage des contacts verrouillés s'appliquent, rien ne fuit
// vers le modèle. Format compact (une ligne par contact) pour tenir des
// milliers de fiches. Entrée : { question, space_id? }.
// Sortie : { response, contact_ids }.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MAX_CONTACTS = 4000; // ponytail: au-delà, présélection par mots-clés ; recherche sémantique (embeddings) quand le volume l'exigera

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await db.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { question, space_id } = await req.json();
    if (!question || String(question).trim().length < 2) return json({ error: "Question vide" }, 400);

    // Toutes les fiches accessibles (pagination : plafond 1000 lignes par requête).
    const rows: any[] = [];
    for (let from = 0; ; from += 1000) {
      let q = db.from("contacts_visible")
        .select("id, first_name, last_name, job_title, company, industry, location, ai_context, skills")
        .range(from, from + 999);
      if (space_id) q = q.eq("space_id", space_id);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }

    // Au-delà du plafond, on garde les fiches qui partagent des mots avec la question.
    let pool = rows;
    if (rows.length > MAX_CONTACTS) {
      const terms = norm(question).split(/\W+/).filter((t) => t.length > 3);
      const score = (c: any) => {
        const hay = norm([c.job_title, c.company, c.industry, c.location, c.ai_context, (c.skills ?? []).join(" ")].filter(Boolean).join(" "));
        return terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
      };
      pool = rows.map((c) => ({ c, s: score(c) })).sort((a, b) => b.s - a.s).slice(0, MAX_CONTACTS).map((x) => x.c);
    }

    const lines = pool.map((c) => [
      c.id,
      `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
      c.job_title ?? "", c.company ?? "", c.industry ?? "", c.location ?? "",
      (c.skills ?? []).slice(0, 4).join(", "),
      (c.ai_context ?? "").slice(0, 140),
    ].join(" | ")).join("\n");

    const system = `Tu es l'assistant de Circl, un gestionnaire de relations professionnelles. L'utilisateur interroge son réseau.
Chaque ligne décrit un contact : id | nom | poste | entreprise | secteur | lieu | compétences | contexte.
Réponds en français, en une ou deux phrases sobres, puis cite les contacts pertinents par leur id.
Réponds UNIQUEMENT avec un JSON : {"response": "phrase de synthèse", "contact_ids": ["id1", "id2"]}.
Au maximum 30 contacts, les plus pertinents d'abord. Si personne ne correspond, contact_ids vide et dis-le simplement.

Contacts :
${lines}`;

    const ai = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1500, system, messages: [{ role: "user", content: String(question) }] }),
    });
    const body = await ai.json();
    if (!ai.ok) return json({ error: body?.error?.message ?? `IA indisponible (${ai.status})` }, 502);
    const text: string = body.content?.[0]?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    let parsed: any = { response: text.trim(), contact_ids: [] };
    try { if (match) parsed = JSON.parse(match[0]); } catch { /* garde le texte brut */ }

    // Ne renvoie que des ids réellement accessibles à l'appelant.
    const allowed = new Set(pool.map((c) => c.id));
    const contact_ids = (Array.isArray(parsed.contact_ids) ? parsed.contact_ids : []).filter((id: string) => allowed.has(id)).slice(0, 30);
    return json({ response: String(parsed.response ?? ""), contact_ids, searched: pool.length });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
