import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// structure-note
// Turns a raw voice-dictated transcript into:
//   - a clean, saved note on the contact
//   - pending contact_updates for any field the transcript implies changed
//   - suggested tags + an optional follow-up (returned for the client to confirm)
//
// Input:  { contact_id: string, transcript: string }
// Output: { note, pending_updates[], suggested_tags[], follow_up }

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};

// Only these contact columns can be updated from a voice note.
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

interface Body {
  contact_id?: string;
  transcript?: string;
  is_private?: boolean;
}

interface FieldUpdate {
  field?: string;
  new_value?: string;
  summary?: string;
  confidence?: number;
}

interface Structured {
  clean_note?: string;
  context?: string;
  suggested_tags?: string[];
  field_updates?: FieldUpdate[];
  follow_ups?: { date?: string; label?: string }[];
  // Legacy single-reminder shape, still parsed defensively.
  follow_up?: { date?: string; label?: string } | null;
  updated_memory?: string;
  mentioned_names?: string[];
}

// Today's date in the user's timezone, as YYYY-MM-DD.
function todayParis(): string {
  return new Date().toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
}

// A reminder must be in the future. If the model resolved "septembre" to a
// past year, roll the year forward until the date is >= today.
function clampToFuture(dateStr: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  let [y, m, d] = dateStr.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  for (let i = 0; i < 4; i++) {
    if (y > ty || (y === ty && (m > tm || (m === tm && d >= td)))) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    y += 1;
  }
  return null;
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

    const body = (await req.json()) as Body & { dry_run?: boolean; commit?: Structured };
    const { contact_id, transcript, is_private, dry_run, commit } = body;
    // Deux modes ajoutés pour la Capture web (preview avant écriture) :
    //  - dry_run : analyse LLM, AUCUNE écriture, renvoie la proposition.
    //  - commit  : pas de LLM, écrit le payload (éventuellement corrigé).
    // Sans ces flags, comportement historique (analyse + écriture) pour iOS.
    if (!contact_id || (!commit && (!transcript || transcript.trim().length < 3))) {
      return json({ error: "contact_id and a non-empty transcript are required" }, 400);
    }
    const isPrivate = is_private === true;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Who is calling.
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    // Load the contact snapshot.
    const { data: contact, error: contactError } = await admin
      .from("contacts")
      .select("id, space_id, first_name, last_name, company, job_title, industry, location, linkedin, bio, ai_context")
      .eq("id", contact_id)
      .single();
    if (contactError || !contact) return json({ error: "Contact not found" }, 404);

    // Caller must be an accepted member of the contact's space.
    const { data: membership } = await admin
      .from("space_members")
      .select("role")
      .eq("space_id", contact.space_id)
      .eq("user_id", user.id)
      .not("accepted_at", "is", null)
      .maybeSingle();
    if (!membership) return json({ error: "Forbidden" }, 403);

    const today = todayParis();

    // Mode commit (Capture web) : le payload corrigé par l'utilisateur
    // remplace l'analyse LLM ; on passe directement aux écritures.
    let structured: Structured;
    if (commit) {
      structured = commit;
    } else {
    // Structure the transcript with Claude.
    const todayHuman = new Date().toLocaleDateString("fr-FR", {
      timeZone: "Europe/Paris",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const prompt = `Tu es l'assistant de prise de notes de Circl. Un utilisateur vient de dicter une note vocale à propos d'un contact professionnel, souvent juste après un rendez-vous. Le transcript est brut, parlé, parfois désordonné.

Nous sommes le ${todayHuman} (${today}).

Contact concerné :
- Nom : ${contact.first_name} ${contact.last_name}
- Entreprise actuelle : ${contact.company ?? "inconnue"}
- Poste actuel : ${contact.job_title ?? "inconnu"}
- Secteur actuel : ${contact.industry ?? "inconnu"}
- Localisation actuelle : ${contact.location ?? "inconnue"}
- Mémoire actuelle du contact : ${contact.ai_context ?? "aucune pour l'instant"}

Transcript dicté :
"""
${transcript}
"""

Produis un JSON STRICT avec :
{
  "clean_note": "La note reformulée proprement en français, à la première personne, concise et fidèle. Garde les faits, enlève les hésitations orales.",
  "context": "professional" | "personal",
  "suggested_tags": ["noms de tags courts et pertinents, ex: à recontacter, prospect"],
  "field_updates": [
    {
      "field": "company | job_title | industry | location | linkedin | bio",
      "new_value": "la nouvelle valeur mentionnée",
      "summary": "phrase courte pour un fil d'activité, ex: est désormais CEO chez PayFlow",
      "confidence": 0.0
    }
  ],
  "follow_ups": [{ "date": "AAAA-MM-JJ", "label": "action à faire" }],
  "updated_memory": "La mémoire du contact, mise à jour : 3-4 phrases max qui gardent l'essentiel déjà connu ET intègrent ce qu'apporte cette note. C'est ce que l'IA relira plus tard pour ce contact.",
  "mentioned_names": ["noms complets d'AUTRES personnes explicitement citées dans la note (jamais le contact courant), ex: Paul Gérard"]
}

Règles :
- N'ajoute un field_update QUE si le transcript indique clairement un changement, et seulement pour les champs autorisés.
- Ne répète pas une valeur déjà à jour dans le contact.
- "follow_ups" : TOUTES les relances évoquées dans la note (0, 1 ou plusieurs). Chaque date doit être STRICTEMENT dans le futur par rapport à aujourd'hui (${today}). Si un mois est cité sans année ("en septembre"), prends la PROCHAINE occurrence future de ce mois. Si le jour n'est pas précisé, prends le 1er du mois. Tableau vide [] si aucune relance.
- "updated_memory" est TOUJOURS renseigné : fusionne la mémoire actuelle et cette note, sans jamais perdre d'info importante déjà connue.
- "mentioned_names" : uniquement des personnes nommées explicitement dans la note, autres que ${contact.first_name} ${contact.last_name}. Vide [] si aucune.
- Réponds UNIQUEMENT avec le JSON, sans markdown ni explication.`;

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
    structured = match ? JSON.parse(match[0]) : {};

    // Mode preview (Capture web) : renvoyer la proposition, n'écrire NULLE PART.
    if (dry_run) {
      const current = contact as unknown as Record<string, string | null>;
      const previewUpdates = (structured.field_updates ?? [])
        .filter((fu) => ALLOWED_FIELDS.includes(fu.field as Field))
        .map((fu) => ({
          field: fu.field,
          old_value: current[fu.field as Field] ?? null,
          new_value: (fu.new_value ?? "").trim(),
          summary: fu.summary ?? null,
          confidence: typeof fu.confidence === "number" ? fu.confidence : null,
        }))
        .filter((fu) =>
          fu.new_value &&
          (!fu.old_value || fu.old_value.trim().toLowerCase() !== fu.new_value.toLowerCase())
        );
      const previewFollowUps = (structured.follow_ups ?? [])
        .slice(0, 5)
        .map((f) => ({ label: (f?.label ?? "").trim(), date: clampToFuture((f?.date ?? "").trim(), today) }))
        .filter((f) => f.label && f.date);
      return json({
        preview: {
          clean_note: (structured.clean_note ?? transcript ?? "").trim(),
          context: structured.context === "personal" ? "personal" : "professional",
          suggested_tags: Array.isArray(structured.suggested_tags) ? structured.suggested_tags : [],
          field_updates: previewUpdates,
          follow_ups: previewFollowUps,
          updated_memory: (structured.updated_memory ?? "").trim(),
          mentioned_names: Array.isArray(structured.mentioned_names) ? structured.mentioned_names : [],
        },
      });
    }

    }

    const cleanNote = (structured.clean_note ?? transcript ?? "").trim();
    const context = structured.context === "personal" ? "personal" : "professional";
    if (!cleanNote) return json({ error: "Empty note" }, 400);

    // 1) Save the note.
    const { data: note, error: noteError } = await admin
      .from("notes")
      .insert({
        contact_id: contact.id,
        author_id: user.id,
        content: cleanNote,
        context,
        is_private: isPrivate,
      })
      .select("id, content, context, created_at")
      .single();
    if (noteError) return json({ error: noteError.message }, 500);

    // Fold this note into the contact's running AI memory so it is reused later
    // (by chat-contacts, the Oracle, and the contact detail). Private notes are
    // NEVER folded into ai_context, which is shared with the team.
    const updatedMemory = (structured.updated_memory ?? "").trim();
    if (updatedMemory && !isPrivate) {
      await admin.from("contacts").update({ ai_context: updatedMemory }).eq("id", contact.id);
    }

    // 2) Turn field changes into pending contact_updates (diffed vs current).
    const current = contact as unknown as Record<string, string | null>;
    const pending: unknown[] = [];

    for (const fu of structured.field_updates ?? []) {
      const field = fu.field as Field;
      if (!ALLOWED_FIELDS.includes(field)) continue;
      const newValue = (fu.new_value ?? "").trim();
      if (!newValue) continue;
      const oldValue = current[field] ?? null;
      if (oldValue && oldValue.trim().toLowerCase() === newValue.toLowerCase()) continue;

      const confidence = typeof fu.confidence === "number"
        ? Math.max(0, Math.min(1, fu.confidence))
        : null;

      const row = {
        contact_id: contact.id,
        space_id: contact.space_id,
        type: TYPE_FOR_FIELD[field],
        field,
        old_value: oldValue,
        new_value: newValue,
        summary: (fu.summary ?? `${field} → ${newValue}`).trim(),
        source: "voice",
        confidence,
        detected_by: user.id,
        metadata: { note_id: note.id },
      };

      const { data: inserted, error: insErr } = await admin
        .from("contact_updates")
        .insert(row)
        .select("id, type, field, old_value, new_value, summary, confidence, status")
        .single();

      // 23505 = duplicate pending update (dedupe index). Ignore silently.
      if (inserted) pending.push(inserted);
      else if (insErr && insErr.code !== "23505") {
        console.error("[structure-note] contact_updates insert error", insErr.message);
      }
    }

    // Link mentioned contacts (who-knows-who) for the galaxy graph + AI.
    const mentioned: { id: string; name: string }[] = [];
    for (const rawName of structured.mentioned_names ?? []) {
      const name = (rawName ?? "").replace(/[^\p{L}\p{N}\s'-]/gu, "").trim();
      if (name.length < 3) continue;
      const tokens = name.split(/\s+/).filter((t) => t.length >= 2);
      if (tokens.length === 0) continue;
      const first = tokens[0];
      const last = tokens[tokens.length - 1];
      const { data: matches } = await admin
        .from("contacts")
        .select("id, first_name, last_name")
        .eq("space_id", contact.space_id)
        .neq("id", contact.id)
        .or(`last_name.ilike.%${last}%,first_name.ilike.%${first}%`)
        .limit(8);
      const target = (matches ?? []).find((m: { first_name?: string; last_name?: string }) => {
        const full = `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim().toLowerCase();
        const lname = name.toLowerCase();
        return full.length > 0 && (full.includes(lname) || lname.includes(full));
      }) as { id: string; first_name: string; last_name: string } | undefined;
      if (!target) continue;
      const { error: linkErr } = await admin.from("contact_links").insert({
        space_id: contact.space_id,
        from_contact_id: contact.id,
        to_contact_id: target.id,
        source_note_id: note.id,
        created_by: user.id,
      });
      if (!linkErr || linkErr.code === "23505") {
        mentioned.push({ id: target.id, name: `${target.first_name} ${target.last_name}`.trim() });
      }
    }

    // 3) Persist every reminder mentioned in the note (they used to be
    // display-only and lost on dismiss). Dates are clamped to the future.
    const rawFollowUps = Array.isArray(structured.follow_ups)
      ? structured.follow_ups
      : structured.follow_up
        ? [structured.follow_up]
        : [];
    const followUps: unknown[] = [];
    for (const fu of rawFollowUps.slice(0, 5)) {
      const label = (fu?.label ?? "").trim();
      const due = clampToFuture((fu?.date ?? "").trim(), today);
      if (!label || !due) continue;
      const { data: created, error: fuErr } = await admin
        .from("follow_ups")
        .insert({
          space_id: contact.space_id,
          contact_id: contact.id,
          user_id: user.id,
          note_id: note.id,
          due_date: due,
          label,
        })
        .select("id, contact_id, due_date, label, status")
        .single();
      if (created) followUps.push(created);
      else if (fuErr) console.error("[structure-note] follow_ups insert error", fuErr.message);
    }

    const legacyFollowUp = followUps.length > 0
      ? {
        date: (followUps[0] as { due_date: string }).due_date,
        label: (followUps[0] as { label: string }).label,
      }
      : null;

    return json({
      note,
      pending_updates: pending,
      suggested_tags: Array.isArray(structured.suggested_tags) ? structured.suggested_tags : [],
      follow_ups: followUps,
      // Kept for app builds that still decode a single follow_up.
      follow_up: legacyFollowUp,
      mentioned,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
