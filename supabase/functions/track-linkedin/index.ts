import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// track-linkedin (voie C — suivi LinkedIn via Coresignal)
//
// Pour chaque contact suivi (VIP / À suivre) qui a une URL LinkedIn,
// interroge l'API Clean Employee de Coresignal, lit son poste et son
// entreprise actuels, les compare à ce qu'on connaît, et dépose un
// contact_update « pending » quand ça a changé. Même destination que
// track-contacts (voie B) : le feed « Mises à jour » + la notif iOS.
//
// Champs Coresignal (validés sur une vraie réponse) :
//   - job_title (racine)         = poste principal actuel
//   - experience[] avec date_to null = poste actuel ; company_name y vit
//   - is_working (1/0)           = travaille actuellement
//   - last_updated               = fraîcheur de la fiche Coresignal
// Le collect accepte le "shorthand" LinkedIn (segment après /in/), plus
// robuste qu'une URL complète encodée.
//
// Lancé par un cron avec la clé service-role. Body :
//   { limit?: number, contact_id?: string, debug?: boolean }
// En mode { contact_id, debug: true } → un seul contact + réponse brute.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORESIGNAL_API_KEY = Deno.env.get("CORESIGNAL_API_KEY") ?? "";

const CORESIGNAL_BASE = "https://api.coresignal.com/cdapi/v2/employee_clean/collect";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};

// Seuls le poste et l'entreprise sont suivis : LinkedIn est fiable là-dessus.
const TYPE_FOR_FIELD: Record<string, string> = {
  job_title: "title_change",
  company: "company_change",
};

interface TrackableContact {
  id: string;
  first_name: string;
  last_name: string;
  company: string | null;
  job_title: string | null;
  linkedin: string | null;
  space_id: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// L'URL LinkedIn stockée a plein de formes ; Coresignal collecte par
// "shorthand" (le segment après /in/). On l'extrait, c'est le plus fiable.
function linkedinShorthand(raw: string): string | null {
  const s = raw.trim();
  const m = s.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  if (m) return decodeURIComponent(m[1]);
  // Si l'utilisateur a saisi juste le shorthand, on l'accepte tel quel.
  if (/^[a-z0-9\-_%]+$/i.test(s)) return s;
  return null;
}

// Poste + entreprise actuels, d'après les vrais champs Coresignal.
function extractCurrentRole(p: any): {
  job_title: string | null;
  company: string | null;
  isWorking: boolean;
  lastUpdated: string | null;
} {
  if (!p || typeof p !== "object") {
    return { job_title: null, company: null, isWorking: false, lastUpdated: null };
  }

  const isWorking = p.is_working === 1 || p.is_working === true;
  const lastUpdated = typeof p.last_updated === "string" ? p.last_updated : null;

  // Poste principal : le champ racine calculé par Coresignal.
  const jobTitle: string | null = (p.job_title ?? "").trim() || null;

  // Entreprise : l'expérience « active » (date_to null / vide) porte le nom.
  // On préfère celle dont le titre correspond au poste principal, sinon la
  // première active, sinon la plus récente.
  let company: string | null = null;
  const exp: any[] = Array.isArray(p.experience) ? p.experience : [];
  const active = exp.filter((e) => e && (e.date_to == null || e.date_to === ""));
  const pool = active.length > 0 ? active : exp;
  const match =
    pool.find((e) => jobTitle && String(e.title ?? "").trim().toLowerCase() === jobTitle.toLowerCase()) ??
    pool[0];
  if (match) {
    company = (match.company_name ?? "").trim() || null;
  }

  return { job_title: jobTitle, company, isWorking, lastUpdated };
}

async function fetchProfile(shorthand: string): Promise<{ ok: boolean; status: number; data: any }> {
  const endpoint = `${CORESIGNAL_BASE}/${encodeURIComponent(shorthand)}`;
  const res = await fetch(endpoint, {
    method: "GET",
    headers: { accept: "application/json", apikey: CORESIGNAL_API_KEY },
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

// Retenu seulement si la nouvelle valeur est non vide ET diffère franchement.
function changed(oldVal: string | null, newVal: string | null): boolean {
  const a = (oldVal ?? "").trim().toLowerCase();
  const b = (newVal ?? "").trim().toLowerCase();
  return b.length > 0 && a !== b;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    if (!CORESIGNAL_API_KEY) {
      return json({ error: "CORESIGNAL_API_KEY manquante. Pose le secret puis redéploie." }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const limit: number = Math.min(Math.max(1, Number(body.limit ?? 8)), 50);
    const onlyContactId: string | undefined = body.contact_id;
    const debug: boolean = body.debug === true;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Un seul contact en mode POC, sinon la même liste que track-contacts
    // (VIP / À suivre, pas revus récemment), filtrée sur ceux qui ont un
    // LinkedIn exploitable.
    let contacts: TrackableContact[] = [];
    if (onlyContactId) {
      const { data, error } = await admin
        .from("contacts")
        .select("id, first_name, last_name, company, job_title, linkedin, space_id")
        .eq("id", onlyContactId)
        .single();
      if (error || !data) return json({ error: "Contact introuvable" }, 404);
      contacts = [data as TrackableContact];
    } else {
      const { data, error } = await admin.rpc("get_trackable_contacts", { p_limit: limit });
      if (error) return json({ error: error.message }, 500);
      contacts = (data as TrackableContact[]).filter((c) => c.linkedin);
    }

    let checked = 0;
    let skipped = 0;
    let updatesCreated = 0;
    const debugOut: unknown[] = [];

    for (const c of contacts) {
      const shorthand = c.linkedin ? linkedinShorthand(c.linkedin) : null;
      if (!shorthand) { skipped++; continue; }

      try {
        const { ok, status, data } = await fetchProfile(shorthand);
        checked++;

        if (debug) {
          const role = ok ? extractCurrentRole(data) : null;
          debugOut.push({ contact: `${c.first_name} ${c.last_name}`, shorthand, status, ok, extracted: role, raw: data });
        }
        if (!ok) {
          // 404 = profil absent de la base Coresignal ; 402 = crédits épuisés.
          if (!debug) console.warn(`[track-linkedin] ${status} sur ${c.id}`);
          await admin.from("contacts").update({ tracked_at: new Date().toISOString() }).eq("id", c.id);
          continue;
        }

        const { job_title, company, isWorking, lastUpdated } = extractCurrentRole(data);

        // Personne sans emploi actuel déclaré : on ne fabrique pas un faux
        // changement de poste. On note juste le passage.
        if (isWorking) {
          for (const field of ["job_title", "company"] as const) {
            const oldValue = field === "job_title" ? c.job_title : c.company;
            const newValue = field === "job_title" ? job_title : company;
            if (!changed(oldValue, newValue)) continue;

            const { error: insErr } = await admin.from("contact_updates").insert({
              contact_id: c.id,
              space_id: c.space_id,
              type: TYPE_FOR_FIELD[field],
              field,
              old_value: oldValue,
              new_value: newValue,
              summary:
                field === "job_title"
                  ? `Nouveau poste : ${newValue}`
                  : `Nouvelle entreprise : ${newValue}`,
              source: "linkedin",
              confidence: 0.9, // source directe LinkedIn
              metadata: {
                source_url: c.linkedin,
                coresignal_last_updated: lastUpdated,
              },
            });
            if (!insErr) updatesCreated++;
            else if (insErr.code !== "23505") {
              console.error("[track-linkedin] insert error", insErr.message);
            }
          }
        }

        await admin.from("contacts").update({ tracked_at: new Date().toISOString() }).eq("id", c.id);
      } catch (e) {
        console.error("[track-linkedin] contact failed", c.id, String(e));
      }
    }

    return json({ checked, skipped, updates_created: updatesCreated, ...(debug ? { debug: debugOut } : {}) });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
