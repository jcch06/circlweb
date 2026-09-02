import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import http2 from 'node:http2';
import crypto from 'node:crypto';

// Digest quotidien de rappel. Pour chaque utilisateur ayant des relances
// échues aujourd'hui, écrit une notification in-app et pousse un rappel sur
// ses canaux (web-push + APNs). Déclenché par un cron Vercel une fois/jour.
// ponytail: v1 ne compte que les relances (follow_ups) — signal le plus net
// et le moins cher ; ajouter les contacts "en froid" quand utile.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ---- APNs (actif seulement si la clé Apple est configurée) ----
function apnsConfigured(): boolean {
  return !!(process.env.APNS_KEY && process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_BUNDLE_ID);
}
let apnsJwt = { token: '', at: 0 };
function apnsToken(): string {
  if (apnsJwt.token && Date.now() - apnsJwt.at < 50 * 60 * 1000) return apnsJwt.token;
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${enc({ alg: 'ES256', kid: process.env.APNS_KEY_ID })}.${enc({ iss: process.env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) })}`;
  const key = process.env.APNS_KEY!.replace(/\\n/g, '\n');
  const sig = crypto.createSign('SHA256').update(unsigned).sign({ key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  apnsJwt = { token: `${unsigned}.${sig}`, at: Date.now() };
  return apnsJwt.token;
}
async function sendApns(client: http2.ClientHttp2Session, token: string, title: string, body: string, url: string): Promise<number> {
  const payload = JSON.stringify({ aps: { alert: { title, body }, sound: 'default' }, url });
  return new Promise((resolve) => {
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${apnsToken()}`,
      'apns-topic': process.env.APNS_BUNDLE_ID,
      'apns-push-type': 'alert',
    });
    let status = 0;
    req.on('response', (h) => { status = Number(h[':status']) || 0; });
    req.setEncoding('utf8');
    req.on('data', () => {});
    req.on('end', () => resolve(status));
    req.on('error', () => resolve(0));
    req.write(payload);
    req.end();
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    res.status(500).json({ error: 'not configured' });
    return;
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const today = new Date().toISOString().slice(0, 10);

  // Relances échues (aujourd'hui ou avant), regroupées par utilisateur.
  const { data: dues, error } = await admin
    .from('follow_ups')
    .select('user_id, due_date')
    .eq('status', 'pending')
    .lte('due_date', today);
  if (error) { res.status(500).json({ error: error.message }); return; }

  const counts = new Map<string, number>();
  for (const r of dues || []) counts.set(r.user_id, (counts.get(r.user_id) || 0) + 1);
  if (counts.size === 0) { res.status(200).json({ users: 0, sent: 0 }); return; }

  const vapidReady = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
  if (vapidReady) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  }
  const apnsClient = apnsConfigured()
    ? http2.connect(process.env.APNS_ENV === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com')
    : null;

  let sent = 0;
  for (const [userId, n] of counts) {
    const title = 'Circl';
    const body = `${n} relance${n > 1 ? 's' : ''} à faire aujourd'hui`;
    const url = '/accueil';

    await admin.from('notifications').insert({ user_id: userId, type: 'digest', title, body });

    if (vapidReady) {
      const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', userId);
      for (const s of subs || []) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title, body, url })
          );
          sent++;
        } catch (err: unknown) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
          }
        }
      }
    }

    if (apnsClient) {
      const { data: tokens } = await admin.from('device_tokens').select('token').eq('user_id', userId).eq('platform', 'ios');
      for (const t of tokens || []) {
        const status = await sendApns(apnsClient, t.token, title, body, url);
        if (status === 200) sent++;
        else if (status === 410) await admin.from('device_tokens').delete().eq('user_id', userId).eq('token', t.token);
      }
    }
  }

  if (apnsClient) apnsClient.close();
  res.status(200).json({ users: counts.size, sent, channels: { webpush: vapidReady, apns: apnsConfigured() } });
}
