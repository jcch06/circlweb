import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Synchronisation Gmail et Agenda : rapproche les adresses des emails
// (expéditeur, destinataires) et des invités aux rendez-vous des emails des
// fiches visibles par l'utilisateur. Crée des « interactions » (privées à
// l'utilisateur) et avance le dernier échange des fiches dont il est
// propriétaire. Aucun contenu d'email n'est lu ni stocké (scope metadata).
//   Avec la session d'un utilisateur : synchronise son compte.
//   Avec la clé service-role (cron quotidien) : synchronise tous les comptes connectés.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
const DAY = 86400000;
const MAX_MESSAGES = 300;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const emailsIn = (header: string) => [...header.toLowerCase().matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g)].map((m) => m[0]);

async function syncUser(admin: any, userId: string) {
  const { data: refresh } = await admin.rpc("google_get_token", { p_user: userId });
  const { data: conn } = await admin.from("google_connections").select("google_email, last_sync_at").eq("user_id", userId).maybeSingle();
  if (!refresh || !conn) return { user: userId, skipped: "non connecté" };

  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID!, client_secret: CLIENT_SECRET!, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  const t = await tok.json();
  if (!tok.ok) {
    await admin.from("google_connections").update({ last_error: "Reconnectez Google : l'autorisation a expiré ou a été retirée." }).eq("user_id", userId);
    return { user: userId, error: t.error ?? tok.status };
  }
  const H = { Authorization: `Bearer ${t.access_token}` };

  // Fiches visibles : cercles de l'utilisateur et fiches partagées avec eux.
  const { data: spaces } = await admin.rpc("user_space_ids", { uid: userId });
  const spaceIds = (spaces ?? []).map((s: any) => (typeof s === "string" ? s : s.user_space_ids));
  const { data: shared } = await admin.from("contact_shares").select("contact_id").in("space_id", spaceIds);
  const byEmail = new Map<string, { id: string; owner_id: string }[]>();
  const add = (c: any) => { if (!c.email) return; const k = c.email.trim().toLowerCase(); (byEmail.get(k) ?? byEmail.set(k, []).get(k)!).push(c); };
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from("contacts").select("id, email, owner_id").in("space_id", spaceIds).not("email", "is", null).range(from, from + 999);
    (data ?? []).forEach(add);
    if (!data || data.length < 1000) break;
  }
  const sharedIds = (shared ?? []).map((s: any) => s.contact_id);
  for (let i = 0; i < sharedIds.length; i += 300) {
    const { data } = await admin.from("contacts").select("id, email, owner_id").in("id", sharedIds.slice(i, i + 300)).not("email", "is", null);
    (data ?? []).forEach(add);
  }
  const me = (conn.google_email ?? "").toLowerCase();
  const since = conn.last_sync_at ? new Date(new Date(conn.last_sync_at).getTime() - DAY) : new Date(Date.now() - 90 * DAY);
  const rows: any[] = [];
  const push = (email: string, kind: string, at: string, ext: string, title?: string) => {
    for (const c of byEmail.get(email) ?? []) rows.push({ user_id: userId, contact_id: c.id, kind, occurred_at: at, external_id: ext, title: title?.slice(0, 200) ?? null });
  };

  // Agenda : rendez-vous passés depuis la dernière synchronisation.
  const cal = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${new URLSearchParams({
    timeMin: since.toISOString(), timeMax: new Date().toISOString(), singleEvents: "true", maxResults: "2500",
    fields: "items(id,summary,start,attendees(email))",
  })}`, { headers: H });
  if (cal.ok) {
    for (const ev of (await cal.json()).items ?? []) {
      const at = ev.start?.dateTime ?? ev.start?.date;
      if (!at) continue;
      for (const a of ev.attendees ?? []) {
        const e = (a.email ?? "").toLowerCase();
        if (e && e !== me) push(e, "meeting", new Date(at).toISOString(), `cal:${ev.id}`, ev.summary);
      }
    }
  }

  // Gmail : en-têtes From/To/Cc/Date seulement.
  const ids: string[] = [];
  let pageToken = "";
  while (ids.length < MAX_MESSAGES) {
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({
      q: `after:${Math.floor(since.getTime() / 1000)} -in:chats`, maxResults: "100", ...(pageToken ? { pageToken } : {}),
    })}`, { headers: H });
    if (!r.ok) break;
    const page = await r.json();
    ids.push(...(page.messages ?? []).map((m: any) => m.id));
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }
  for (let i = 0; i < ids.length; i += 10) {
    await Promise.all(ids.slice(i, i + 10).map(async (id) => {
      const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Date`, { headers: H });
      if (!r.ok) return;
      const m = await r.json();
      const h = Object.fromEntries((m.payload?.headers ?? []).map((x: any) => [x.name.toLowerCase(), x.value]));
      const at = new Date(Number(m.internalDate) || h.date).toISOString();
      const from = emailsIn(h.from ?? "")[0] ?? "";
      if (from === me) for (const e of emailsIn(`${h.to ?? ""} ${h.cc ?? ""}`)) push(e, "email_out", at, `gm:${id}`);
      else push(from, "email_in", at, `gm:${id}`);
    }));
  }

  if (rows.length) {
    await admin.from("interactions").upsert(rows, { onConflict: "user_id,contact_id,external_id", ignoreDuplicates: true });
    // Dernier échange : seulement sur les fiches dont l'utilisateur est propriétaire.
    const latest = new Map<string, string>();
    for (const r of rows) {
      const owner = [...byEmail.values()].flat().find((c) => c.id === r.contact_id)?.owner_id;
      if (owner === userId && (!latest.has(r.contact_id) || latest.get(r.contact_id)! < r.occurred_at)) latest.set(r.contact_id, r.occurred_at);
    }
    for (const [id, at] of latest) {
      await admin.from("contacts").update({ last_contacted_at: at }).eq("id", id).or(`last_contacted_at.is.null,last_contacted_at.lt.${at}`);
    }
  }
  await admin.from("google_connections").update({ last_sync_at: new Date().toISOString(), last_error: null }).eq("user_id", userId);
  return { user: userId, interactions: rows.length, messages: ids.length };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: "Connexion Google non configurée" }, 503);
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const role = (() => { try { return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role; } catch { return null; } })();
    if (token === SERVICE_KEY || role === "service_role") {
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
