import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

// Achat de crédits d'enrichissement : session Stripe Checkout (paiement unique).
// Le solde est crédité par stripe-webhook (checkout.session.completed), une
// seule fois par session. Entrée : { pack }. Sortie : { url }.
// Les packs et leurs prix sont une proposition, ajustable sans redéploiement
// via le secret CREDIT_PACKS (JSON : { "id": { "credits": n, "eur_cents": n } }).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const DEFAULT_PACKS: Record<string, { credits: number; eur_cents: number }> = {
  p100: { credits: 100, eur_cents: 900 },
  p500: { credits: 500, eur_cents: 3900 },
  p2000: { credits: 2000, eur_cents: 12900 },
};
const PACKS: Record<string, { credits: number; eur_cents: number }> = (() => {
  try { return JSON.parse(Deno.env.get("CREDIT_PACKS") ?? "") ?? DEFAULT_PACKS; } catch { return DEFAULT_PACKS; }
})();
// Retour après paiement : uniquement vers une origine connue.
const ORIGINS = ["https://circl-web-rho.vercel.app", "http://localhost:5173", "http://localhost:5200"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    if (!STRIPE_SECRET_KEY) return json({ error: "Paiement non configuré" }, 503);

    const { pack } = await req.json();
    const p = PACKS[pack];
    if (!p) return json({ error: "Pack inconnu" }, 400);
    const origin = ORIGINS.find((o) => o === req.headers.get("origin")) ?? ORIGINS[0];

    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16", httpClient: Stripe.createFetchHttpClient() });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: profile } = await admin.from("profiles").select("stripe_customer_id, full_name").eq("id", user.id).maybeSingle();
    let customerId = profile?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, name: profile?.full_name ?? undefined, metadata: { user_id: user.id } });
      customerId = customer.id;
      await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("id", user.id);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "payment",
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: p.eur_cents,
          product_data: { name: `Circl · ${p.credits} crédits d'enrichissement`, description: "Recherche d'emails (1 crédit) et de téléphones (10 crédits). Un crédit n'est débité que si une valeur est trouvée." },
        },
      }],
      metadata: { kind: "credits", user_id: user.id, credits: String(p.credits), pack },
      payment_intent_data: { metadata: { kind: "credits", user_id: user.id, credits: String(p.credits) } },
      success_url: `${origin}/?credits=ok`,
      cancel_url: `${origin}/?credits=annule`,
      locale: "fr",
      automatic_tax: { enabled: false },
    });
    return json({ url: session.url });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
