import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// suggest-intros (Oracle-lite for the app)
// Looks at the user's network (contacts + their AI memory) and proposes a few
// high-value warm introductions ("who should meet who, and why"). One Claude
// pass, capped to the richest contacts to control tokens.
//
// Input:  { space_id: string }
// Output: { intros: [{ from_id, from_name, to_id, to_name, rationale, confidence }] }

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};

interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  company: string | null;
  job_title: string | null;
  industry: string | null;
  ai_context: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const { space_id } = (await req.json()) as { space_id?: string };
    if (!space_id) return json({ error: "space_id is required" }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: membership } = await admin
      .from("space_members")
      .select("role")
      .eq("space_id", space_id)
      .eq("user_id", user.id)
      .not("accepted_at", "is", null)
      .maybeSingle();
    if (!membership) return json({ error: "Forbidden" }, 403);

    const { data: allContacts } = await admin
      .from("contacts")
      .select("id, first_name, last_name, company, job_title, industry, ai_context")
      .eq("space_id", space_id)
      .limit(400);

    const contacts = (allContacts ?? []) as Contact[];
    // Keep the richest contacts (those with a memory or a company/role) — the
    // ones the AI can actually reason about — capped for token budget.
    const ranked = contacts
      .map((c) => ({
        c,
        score: (c.ai_context ? 3 : 0) + (c.company ? 1 : 0) + (c.job_title ? 1 : 0) + (c.industry ? 1 : 0),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 60)
      .map((x) => x.c);

    if (ranked.length < 2) return json({ intros: [] });

    const list = ranked.map((c, i) => {
      const name = `${c.first_name} ${c.last_name}`.trim();
      const role = [c.job_title, c.company].filter(Boolean).join(" @ ");
      const mem = (c.ai_context ?? "").slice(0, 220);
      return `#${i} ${name}${role ? " — " + role : ""}${c.industry ? " (" + c.industry + ")" : ""}${mem ? " — " + mem : ""}`;
    }).join("\n");

    const prompt = `Tu es l'Oracle de Circl. Voici le réseau professionnel de l'utilisateur, un contact par ligne, préfixé par un index #N :

${list}

Propose 2 à 3 MISES EN RELATION à forte valeur : deux personnes de ce réseau qui gagneraient vraiment à se rencontrer (complémentarité, un besoin de l'un que l'autre couvre, même secteur qui se cherche, investisseur ↔ fondateur, etc.).

Réponds UNIQUEMENT avec un JSON, sans markdown :
{
  "intros": [
    { "a": 0, "b": 5, "rationale": "1 phrase concrète expliquant pourquoi les mettre en relation", "confidence": 0.0 }
  ]
}
Règles : a et b sont des index du réseau ci-dessus, a ≠ b. Rationale en français, concret, orienté action. Pas d'intro tirée par les cheveux : mieux vaut 2 excellentes que 3 moyennes.`;

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const aiData = await aiRes.json();
    const raw = aiData.content?.[0]?.text ?? "{}";
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : { intros: [] };

    const intros = (parsed.intros ?? [])
      .map((it: { a?: number; b?: number; rationale?: string; confidence?: number }) => {
        const a = ranked[it.a ?? -1];
        const b = ranked[it.b ?? -1];
        if (!a || !b || a.id === b.id) return null;
        return {
          from_id: a.id,
          from_name: `${a.first_name} ${a.last_name}`.trim(),
          to_id: b.id,
          to_name: `${b.first_name} ${b.last_name}`.trim(),
          rationale: (it.rationale ?? "").trim(),
          confidence: typeof it.confidence === "number" ? Math.max(0, Math.min(1, it.confidence)) : null,
        };
      })
      .filter(Boolean)
      .slice(0, 3);

    return json({ intros });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
