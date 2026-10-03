import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Connexion Google (Gmail en lecture des métadonnées, Agenda en lecture).
//   POST { action: 'start' } avec la session de l'utilisateur -> { url } de consentement Google
//   GET  ?code&state (retour de Google, sans session)      -> renvoi vers Circl, sans rien stocker
//   POST { action: 'finish', code, state } avec la session -> jeton chiffré dans Vault
// Le paramètre state est signé (HMAC) : il porte l'utilisateur, l'origine et
// une expiration de 10 minutes. Déployée sans vérification JWT (retour Google).
// Secrets requis : GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET. URI de redirection
// à déclarer chez Google : <SUPABASE_URL>/functions/v1/google-oauth

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-oauth`;
const SCOPES = [
  "openid", "email",
  "https://www.googleapis.com/auth/gmail.metadata",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");
const ORIGINS = ["https://circl-web-rho.vercel.app", "http://localhost:5173", "http://localhost:5200"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf instanceof Uint8Array ? buf : new Uint8Array(buf)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

async function hmac(data: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SERVICE_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}
const back = (origin: string, status: string) => Response.redirect(`${origin}/?google=${status}`, 302);
// Les tentatives (oauth_attempts) sont à usage unique et valables 10 minutes.

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return req.method === "GET" ? back(ORIGINS[0], "non_configure") : json({ error: "Connexion Google non configurée" }, 503);
  }

  // ---- Retour de Google : rien n'est stocké ici. Le code repart vers Circl,
  // où la session de l'utilisateur finalise (action 'finish') : le compte
  // Google n'est rattaché qu'au navigateur connecté qui a lancé la tentative.
  if (req.method === "GET") {
    const url = new URL(req.url);
    const state = url.searchParams.get("state") ?? "";
    let origin = ORIGINS[0];
    try { origin = ORIGINS.find((o) => o === JSON.parse(fromB64url(state.split(".")[0])).o) ?? ORIGINS[0]; } catch { /* state illisible */ }
    const code = url.searchParams.get("code");
    if (!code) return back(origin, "refuse");
    return Response.redirect(`${origin}/?google=finish&code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`, 302);
  }

  // ---- Démarrage, depuis Circl ----
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await db.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({}));

  // ---- Finalisation, avec la session : vérifie signature, expiration,
  // utilisateur et usage unique de la tentative, puis stocke le jeton.
  if (body.action === "finish") {
    const [payload, sig] = String(body.state ?? "").split(".");
    if (!payload || !sig || (await hmac(payload)) !== sig) return json({ error: "Tentative de connexion invalide." }, 400);
    const st = JSON.parse(fromB64url(payload));
    if (Date.now() > st.exp) return json({ error: "La connexion a expiré. Recommencez." }, 400);
    if (st.u !== user.id) return json({ error: "Cette connexion a été lancée par un autre compte." }, 403);
    const { data: used } = await admin.from("oauth_attempts").update({ used_at: new Date().toISOString() })
      .eq("nonce", st.n).eq("user_id", user.id).is("used_at", null).gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString()).select("nonce");
    if (!used?.length) return json({ error: "Tentative déjà utilisée ou inconnue. Recommencez." }, 400);
    const tok = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: String(body.code ?? ""), client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: "authorization_code" }),
    });
    const t = await tok.json();
    if (!tok.ok || !t.refresh_token) return json({ error: "Google n'a pas confirmé l'autorisation. Recommencez." }, 502);
    const email = (() => { try { return JSON.parse(fromB64url(t.id_token.split(".")[1])).email ?? null; } catch { return null; } })();
    const { error } = await admin.rpc("google_store_token", { p_user: user.id, p_token: t.refresh_token, p_email: email, p_scopes: t.scope ?? SCOPES });
    if (error) return json({ error: "Le jeton n'a pas pu être enregistré." }, 500);
    return json({ ok: true, email });
  }

  const origin = ORIGINS.find((o) => o === req.headers.get("origin")) ?? ORIGINS[0];
  const { data: attempt, error: attErr } = await admin.from("oauth_attempts").insert({ user_id: user.id }).select("nonce").single();
  if (attErr) return json({ error: attErr.message }, 500);
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ u: user.id, o: origin, exp: Date.now() + 10 * 60 * 1000, n: attempt.nonce })));
  const state = `${payload}.${await hmac(payload)}`;
  const params = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: "code", scope: SCOPES,
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state, login_hint: user.email ?? "",
  });
  return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
});
