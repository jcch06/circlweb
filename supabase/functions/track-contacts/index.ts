import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// track-contacts (voie B)
// For each "important" contact (tagged VIP / À suivre, not checked recently),
// asks Claude — with its native web_search tool — to find recent public
// professional changes, diffs them against what we already know, and files
// pending contact_updates. Run by a weekly cron with the service-role key.
//
// Body: { limit?: number }  (default 8, hard-capped at 50 by the SQL side)

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};

const ALLOWED_FIELDS = ["company", "job_title", "industry", "location", "linkedin", "bio"] as const;
type Field = (typeof ALLOWED_FIELDS)[number];

const TYPE_FOR_FIELD: Record<Field, string> = {
  company: "company_change",
  job_title: "title_change",
  location: "location_change",
  linkedin: "profile_update",
  industry: "other",
  bio: "other",
};

const CONFIDENCE_MIN = 0.7;

interface TrackableContact {
  id: string;
  first_name: string;
  last_name: string;
  company: string | null;
  job_title: string | null;
  industry: string | null;
  location: string | null;
  linkedin: string | null;
  space_id: string;
}

interface DetectedChange {
  field?: string;
  new_value?: string;
  summary?: string;
  confidence?: number;
  source_url?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Ask Claude (with web search) for recent professional changes on one contact.
async function detectChanges(c: TrackableContact): Promise<DetectedChange[]> {
  const known = [
    `Nom: ${c.first_name} ${c.last_name}`,
    c.company ? `Entreprise connue: ${c.company}` : null,
    c.job_title ? `Poste connu: ${c.job_title}` : null,
    c.location ? `Localisation connue: ${c.location}` : null,
    c.linkedin ? `LinkedIn: ${c.linkedin}` : null,
  ].filter(Boolean).join("\n");

  const prompt = `Tu surveilles l'évolution professionnelle d'un contact pour un CRM. Recherche sur le web des informations PUBLIQUES et RÉCENTES (12 derniers mois) sur cette personne précise.

${known}

Objectif : détecter uniquement des CHANGEMENTS professionnels réels par rapport à ce que je sais déjà (nouveau poste, nouvelle entreprise, promotion, création de société, changement de ville professionnelle).

Règles strictes :
- Ne rapporte un changement QUE si tu es raisonnablement certain qu'il s'agit de la MÊME personne (recoupe avec l'entreprise, la localisation, le secteur connus).
- Ne rapporte RIEN si l'information correspond déjà à ce que je sais, ou si tu n'es pas sûr de l'identité.
- Chaque changement doit citer une source (URL).

Réponds UNIQUEMENT avec un JSON, sans texte autour :
{
  "changes": [
    {
      "field": "company | job_title | industry | location | linkedin",
      "new_value": "la nouvelle valeur",
      "summary": "phrase courte pour un fil d'activité, ex: est désormais CEO chez PayFlow",
      "confidence": 0.0,
      "source_url": "https://..."
    }
  ]
}
Si rien de fiable : {"changes": []}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    console.error("[track-contacts] anthropic error", res.status, (await res.text()).slice(0, 200));
    return [];
  }

  const data = await res.json();
  const text = (data.content ?? [])
    .filter((b: { type?: string }) => b.type === "text")
    .map((b: { text?: string }) => b.text ?? "")
    .join("\n");

  const matched = text.match(/\{[\s\S]*\}/);
  if (!matched) return [];
  try {
    const parsed = JSON.parse(matched[0]) as { changes?: DetectedChange[] };
    return Array.isArray(parsed.changes) ? parsed.changes : [];
  } catch {
    return [];
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let body: { limit?: number } = {};
    try { body = await req.json(); } catch { /* no body */ }
    const limit = typeof body.limit === "number" ? body.limit : 8;

    const { data: contacts, error } = await admin.rpc("get_trackable_contacts", { p_limit: limit });
    if (error) return json({ error: error.message }, 500);

    const list = (contacts ?? []) as TrackableContact[];
    let checked = 0, updatesCreated = 0;

    for (const c of list) {
      checked++;
      try {
        const changes = await detectChanges(c);
        const current = c as unknown as Record<string, string | null>;

        for (const ch of changes) {
          const field = ch.field as Field;
          if (!ALLOWED_FIELDS.includes(field)) continue;
          const newValue = (ch.new_value ?? "").trim();
          if (!newValue) continue;
          const confidence = typeof ch.confidence === "number" ? ch.confidence : 0;
          if (confidence < CONFIDENCE_MIN) continue;

          const oldValue = current[field] ?? null;
          if (oldValue && oldValue.trim().toLowerCase() === newValue.toLowerCase()) continue;

          const { error: insErr } = await admin.from("contact_updates").insert({
            contact_id: c.id,
            space_id: c.space_id,
            type: TYPE_FOR_FIELD[field],
            field,
            old_value: oldValue,
            new_value: newValue,
            summary: (ch.summary ?? `${field} → ${newValue}`).trim(),
            source: "web",
            confidence,
            metadata: ch.source_url ? { source_url: ch.source_url } : {},
          });
          if (!insErr) updatesCreated++;
          else if (insErr.code !== "23505") {
            console.error("[track-contacts] insert error", insErr.message);
          }
        }
      } catch (e) {
        console.error("[track-contacts] contact failed", c.id, String(e));
      } finally {
        // Mark as checked regardless, so the cron rotates onward.
        await admin.from("contacts").update({ tracked_at: new Date().toISOString() }).eq("id", c.id);
      }
    }

    return json({ success: true, checked, updates_created: updatesCreated });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
