import { supabase } from './supabase';

// Abonnement web-push. La clé publique VAPID est injectée au build ; la
// souscription est écrite directement dans push_subscriptions (RLS owner),
// pas besoin d'endpoint serveur pour l'enregistrer.

const PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export function pushSupported(): boolean {
  return typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && typeof window !== 'undefined'
    && 'PushManager' in window
    && 'Notification' in window;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type EnablePushResult = 'ok' | 'denied' | 'unsupported' | 'error';

export async function enablePush(userId: string): Promise<EnablePushResult> {
  if (!pushSupported() || !PUBLIC_KEY) return 'unsupported';
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';

    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(PUBLIC_KEY) as BufferSource,
    });
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return 'error';

    const { error } = await supabase.from('push_subscriptions').upsert({
      endpoint: json.endpoint,
      user_id: userId,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    }, { onConflict: 'endpoint' });
    if (error) { console.error('push_subscriptions upsert', error); return 'error'; }
    return 'ok';
  } catch (err) {
    console.error('enablePush', err);
    return 'error';
  }
}
