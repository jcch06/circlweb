import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// « Demander » : interroger son réseau en langage naturel (web).
// Lit contacts_visible SOUS LA SESSION de l'appelant : RLS (cercles dont il
// est membre) et masquage des contacts verrouillés s'appliquent, rien ne fuit
// vers le modèle. Format compact (une ligne par contact) pour tenir des
// milliers de fiches. Entrée : { question, space_id?, history? }.
// Sortie : { response, contacts: [{ id, why }], contact_ids }.

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

    const { question, space_id, history } = await req.json();
    if (!question || String(question).trim().length < 2) return json({ error: "Question vide" }, 400);

    // Toutes les fiches accessibles (pagination : plafond 1000 lignes par requête).
    const rows: any[] = [];
    for (let from = 0; ; from += 1000) {
      let q = db.from("contacts_visible")
        .select("id, first_name, last_name, job_title, company, industry, location, ai_context, skills, last_contacted_at")
        .range(from, from + 999);
      if (space_id) q = q.eq("space_id", space_id);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }

    // Une personne présente dans plusieurs cercles n'apparaît qu'une fois :
    // on garde la fiche la plus renseignée.
    const filled = (c: any) => [c.job_title, c.company, c.industry, c.ai_context, c.last_contacted_at].filter(Boolean).length;
    const byPerson = new Map<string, any>();
    for (const c of rows) {
      const k = norm(`${c.first_name ?? ""} ${c.last_name ?? ""}`).replace(/\s+/g, " ").trim() || c.id;
      const prev = byPerson.get(k);
      if (!prev || filled(c) > filled(prev)) byPerson.set(k, c);
    }
    const people = [...byPerson.values()];

    // Au-delà du plafond, on garde les fiches qui partagent des mots avec la question.
    let pool = people;
    if (people.length > MAX_CONTACTS) {
      const terms = norm(question).split(/\W+/).filter((t) => t.length > 3);
      const score = (c: any) => {
        const hay = norm([c.job_title, c.company, c.industry, c.location, c.ai_context, (c.skills ?? []).join(" ")].filter(Boolean).join(" "));
        return terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
      };
      pool = people.map((c) => ({ c, s: score(c) })).sort((a, b) => b.s - a.s).slice(0, MAX_CONTACTS).map((x) => x.c);
    }

    const lines = pool.map((c) => [
      c.id,
      `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
      c.job_title ?? "", c.company ?? "", c.industry ?? "", c.location ?? "",
      (c.skills ?? []).slice(0, 4).join(", "),
      c.last_contacted_at ? String(c.last_contacted_at).slice(0, 10) : "jamais",
      (c.ai_context ?? "").slice(0, 160),
    ].join(" | ")).join("\n");

    const today = new Date().toISOString().slice(0, 10);
    const system = `Tu es l'assistant de Circl, le carnet de relations professionnelles de l'utilisateur. Nous sommes le ${today}.
Tu as accès à ses ${pool.length} contacts, une ligne par personne :
id | nom | poste | entreprise | secteur | lieu | compétences | dernier échange | contexte.

Tu réponds à TOUTE question : recherche de personnes, statistiques sur le réseau, conseils (qui relancer, qui présenter à qui), rédaction d'un message, ou question générale. Tu tiens compte de la conversation précédente : « eux », « pour chacun », « le deuxième » renvoient aux contacts déjà cités.
Règles :
- Tu t'appuies uniquement sur les données ci-dessous pour parler des contacts. Tu n'inventes ni poste, ni lien, ni fait. Si l'information manque, dis-le.
- Quand tu cites des personnes, donne pour chacune une raison courte et factuelle tirée de sa fiche (« Sénateur LR », « chargé d'affaires publiques chez AmCham »).
- Ton sobre, en français, phrases complètes. Pas de tiret cadratin.
Réponds UNIQUEMENT avec un JSON valide :
{"response": "ta réponse, plusieurs paragraphes possibles", "contacts": [{"id": "…", "why": "raison courte"}]}
"contacts" est vide si la question ne porte pas sur des personnes. Au maximum 40 contacts, les plus pertinents d'abord.

Contacts :
${lines}`;

    // Historique : les derniers échanges, avec les contacts cités par leur id.
    const nameOf = new Map(pool.map((c) => [c.id, `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim()]));
    const past = (Array.isArray(history) ? history : []).slice(-10).map((m: any) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.role === "assistant"
        ? JSON.stringify({ response: String(m.text ?? ""), contacts: (m.ids ?? []).map((id: string) => ({ id, name: nameOf.get(id) ?? "" })) })
        : String(m.text ?? ""),
    })).filter((m: any) => m.content);
    const messages = [...past, { role: "user", content: String(question) }];
    // L'API exige une alternance qui commence par l'utilisateur.
    while (messages.length && messages[0].role !== "user") messages.shift();

    const ai = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-5-5",
        max_tokens: 4000,
        // Le carnet est mis en cache : les questions suivantes coûtent et attendent moins.
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages,
      }),
    });
    const body = await ai.json();
    if (!ai.ok) return json({ error: body?.error?.message ?? `IA indisponible (${ai.status})` }, 502);
    const text: string = body.content?.find((b: any) => b.type === "text")?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    let parsed: any = { response: text.trim(), contacts: [] };
    try { if (match) parsed = JSON.parse(match[0]); } catch { /* garde le texte brut */ }

    // Ne renvoie que des ids réellement accessibles à l'appelant, sans doublon.
    const allowed = new Set(pool.map((c) => c.id));
    const seen = new Set<string>();
    const contacts = (Array.isArray(parsed.contacts) ? parsed.contacts : [])
      .filter((x: any) => x && allowed.has(x.id) && !seen.has(x.id) && seen.add(x.id))
      .slice(0, 40)
      .map((x: any) => ({ id: x.id, why: String(x.why ?? "") }));
    return json({ response: String(parsed.response ?? ""), contacts, contact_ids: contacts.map((x: any) => x.id), searched: pool.length });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
