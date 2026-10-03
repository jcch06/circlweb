import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

// Abonnement Circl : session Stripe Checkout (mode subscription).
// Prix résolus par lookup_key (solo_monthly, team_yearly…), créés dans Stripe ;
// prix HT, TVA calculée par Stripe Tax ; adresse de facturation et numéro de
// TVA intracommunautaire collectés (clients B2B). Les factures sont émises
// par Stripe Billing à chaque échéance. Essai de 14 jours.
// Entrée : { tier: 'solo'|'team'|'business', billing: 'monthly'|'yearly', seats?, platform?: 'web'|'ios' }.

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ORIGINS = ["https://circl-web-rho.vercel.app", "https://mycircl.eu", "http://localhost:5173", "http://localhost:5200"];

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16", httpClient: Stripe.createFetchHttpClient() });
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
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { tier, billing, seats = 1, platform } = await req.json();
    if (!["solo", "team", "business"].includes(tier) || !["monthly", "yearly"].includes(billing)) return json({ error: "Offre inconnue" }, 400);
    const { data: prices } = await stripe.prices.list({ lookup_keys: [`${tier}_${billing}`], active: true, limit: 1 });
    const price = prices[0];
    if (!price) return json({ error: "Prix non configuré dans Stripe" }, 500);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: profile } = await admin.from("profiles").select("stripe_customer_id, full_name, subscription_status").eq("id", user.id).single();
    if (["active", "trialing", "past_due"].includes(profile?.subscription_status ?? "")) {
      return json({ error: "Vous avez déjà un abonnement. Modifiez-le depuis « Gérer l'abonnement »." }, 409);
    }
    let customerId = profile?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, name: profile?.full_name ?? undefined, metadata: { user_id: user.id } });
      customerId = customer.id;
      await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("id", user.id);
    }

    // Équipe et Business : au moins 2 places ; Solo : 1.
    const quantity = tier === "solo" ? 1 : Math.min(500, Math.max(2, Math.floor(Number(seats) || 2)));
    const origin = ORIGINS.find((o) => o === req.headers.get("origin")) ?? ORIGINS[0];
    const ios = platform === "ios";
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: price.id, quantity, ...(tier === "solo" ? {} : { adjustable_quantity: { enabled: true, minimum: 2, maximum: 500 } }) }],
      subscription_data: { trial_period_days: 14, metadata: { user_id: user.id, tier } },
      automatic_tax: { enabled: true },
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
      customer_update: { address: "auto", name: "auto" },
      success_url: ios ? "circl://subscription-success" : `${origin}/abonnement?statut=ok`,
      cancel_url: ios ? "circl://subscription-cancelled" : `${origin}/abonnement?statut=annule`,
      locale: "fr",
      allow_promotion_codes: true,
    });
    return json({ url: session.url, session_id: session.id });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
