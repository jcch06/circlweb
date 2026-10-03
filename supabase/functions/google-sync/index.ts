import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Synchronisation Gmail et Agenda : rapproche les adresses des emails
// (expéditeur, destinataires) et des invités aux rendez-vous des emails des
// fiches que l'utilisateur voit déverrouillées (google_match_contacts). Crée
// des « interactions » privées à l'utilisateur et avance le dernier échange
// des fiches dont il est propriétaire. Aucun contenu d'email n'est lu
// (scope gmail.metadata, qui interdit aussi le filtre q : on parcourt donc
// les messages du plus récent au plus ancien jusqu'au point de reprise).
// Le point de reprise n'avance que si tout a été lu et enregistré.
//   Avec la session d'un utilisateur : synchronise son compte.
//   Avec la clé service-role (cron quotidien) : synchronise tous les comptes connectés.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
const DAY = 86400000;
const MAX_MESSAGES = 1500; // par synchronisation ; le reste est repris à la suivante

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const emailsIn = (header: string) => [...header.toLowerCase().matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g)].map((m) => m[0]);

async function syncUser(admin: any, userId: string) {
  const fail = async (message: string) => {
    await admin.from("google_connections").update({ last_error: message }).eq("user_id", userId);
    return { user: userId, error: message };
  };
  const { data: refresh } = await admin.rpc("google_get_token", { p_user: userId });
  const { data: conn } = await admin.from("google_connections").select("google_email, last_sync_at").eq("user_id", userId).maybeSingle();
  if (!refresh || !conn) return { user: userId, skipped: "non connecté" };

  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID!, client_secret: CLIENT_SECRET!, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  const t = await tok.json();
  if (!tok.ok) return fail("Reconnectez Google : l'autorisation a expiré ou a été retirée.");
  const H = { Authorization: `Bearer ${t.access_token}` };

  const { data: matches, error: mErr } = await admin.rpc("google_match_contacts", { p_user: userId });
  if (mErr) return fail("Synchronisation impossible pour le moment.");
  const byEmail = new Map<string, { id: string; owner_id: string }[]>();
  for (const c of matches ?? []) (byEmail.get(c.email) ?? byEmail.set(c.email, []).get(c.email)!).push(c);
  const ownerOf = new Map((matches ?? []).map((c: any) => [c.id, c.owner_id]));

  const me = (conn.google_email ?? "").toLowerCase();
  const syncStart = new Date();
  const since = conn.last_sync_at ? new Date(new Date(conn.last_sync_at).getTime() - DAY) : new Date(Date.now() - 90 * DAY);
  const rows: any[] = [];
  const push = (email: string, kind: string, at: string, ext: string, title?: string) => {
    for (const c of byEmail.get(email) ?? []) rows.push({ user_id: userId, contact_id: c.id, kind, occurred_at: at, external_id: ext, title: title?.slice(0, 200) ?? null });
  };

  // Agenda : toutes les pages de rendez-vous depuis le point de reprise.
  let calToken = "";
  do {
    const cal = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${new URLSearchParams({
      timeMin: since.toISOString(), timeMax: syncStart.toISOString(), singleEvents: "true", maxResults: "2500",
      fields: "nextPageToken,items(id,summary,start,attendees(email))", ...(calToken ? { pageToken: calToken } : {}),
    })}`, { headers: H });
    if (!cal.ok) return fail(`Agenda indisponible (${cal.status}). Le point de reprise n'a pas avancé.`);
    const page = await cal.json();
    for (const ev of page.items ?? []) {
      const at = ev.start?.dateTime ?? ev.start?.date;
      if (!at) continue;
      for (const a of ev.attendees ?? []) {
        const e = (a.email ?? "").toLowerCase();
        if (e && e !== me) push(e, "meeting", new Date(at).toISOString(), `cal:${ev.id}`, ev.summary);
      }
    }
    calToken = page.nextPageToken ?? "";
  } while (calToken);

  // Gmail : du plus récent au plus ancien, jusqu'au point de reprise.
  let pageToken = "", read = 0, reachedSince = false;
  while (!reachedSince && read < MAX_MESSAGES) {
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({
      maxResults: "100", ...(pageToken ? { pageToken } : {}),
    })}`, { headers: H });
    if (!r.ok) return fail(`Gmail indisponible (${r.status}). Le point de reprise n'a pas avancé.`);
    const page = await r.json();
    const ids: string[] = (page.messages ?? []).map((m: any) => m.id);
    for (let i = 0; i < ids.length && !reachedSince; i += 10) {
      const metas = await Promise.all(ids.slice(i, i + 10).map(async (id) => {
        const m = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc`, { headers: H });
        return m.ok ? m.json() : null;
      }));
      if (metas.some((m) => m === null)) return fail("Gmail a refusé une partie des messages. Le point de reprise n'a pas avancé.");
      for (const m of metas) {
        read++;
        const atMs = Number(m.internalDate);
        if (atMs < since.getTime()) { reachedSince = true; continue; }
        const h = Object.fromEntries((m.payload?.headers ?? []).map((x: any) => [x.name.toLowerCase(), x.value]));
        const at = new Date(atMs).toISOString();
        const from = emailsIn(h.from ?? "")[0] ?? "";
        if (from === me) for (const e of emailsIn(`${h.to ?? ""} ${h.cc ?? ""}`)) push(e, "email_out", at, `gm:${m.id}`);
        else push(from, "email_in", at, `gm:${m.id}`);
      }
    }
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }
  const complete = reachedSince || !pageToken || read < MAX_MESSAGES;

  let added = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await admin.from("interactions")
      .upsert(rows.slice(i, i + 500), { onConflict: "user_id,contact_id,external_id", ignoreDuplicates: true }).select("id");
    if (error) return fail("Les échanges n'ont pas pu être enregistrés. Le point de reprise n'a pas avancé.");
    added += data?.length ?? 0;
  }
  // Dernier échange : seulement sur les fiches dont l'utilisateur est propriétaire.
  const latest = new Map<string, string>();
  for (const r of rows) {
    if (ownerOf.get(r.contact_id) === userId && (!latest.has(r.contact_id) || latest.get(r.contact_id)! < r.occurred_at)) latest.set(r.contact_id, r.occurred_at);
  }
  for (const [id, at] of latest) {
    const { error } = await admin.from("contacts").update({ last_contacted_at: at }).eq("id", id).or(`last_contacted_at.is.null,last_contacted_at.lt.${at}`);
    if (error) console.warn("[google-sync] last_contacted_at", id, error.message);
  }
  // Historique trop long pour une seule passe : on reprend là où on s'est arrêté au prochain passage.
  await admin.from("google_connections").update(complete
    ? { last_sync_at: syncStart.toISOString(), last_error: null }
    : { last_error: null }).eq("user_id", userId);
  return { user: userId, added, candidates: rows.length, messages: read, complete };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: "Connexion Google non configurée" }, 503);
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const secretKeys = (() => { try { return Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}")) as string[]; } catch { return []; } })();
    if (token && (token === SERVICE_KEY || secretKeys.includes(token))) {
      const { data: conns } = await admin.from("google_connections").select("user_id");
      const out = [];
      for (const c of conns ?? []) out.push(await syncUser(admin, c.user_id).catch((e) => ({ user: c.user_id, error: (e as Error).message })));
      return json({ synced: out });
    }
    const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user } } = await db.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    return json(await syncUser(admin, user.id));
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
