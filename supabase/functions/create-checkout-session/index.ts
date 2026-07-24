import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

// Stripe price IDs — created in Stripe Dashboard, set as secrets
const PRICE_IDS: Record<string, { monthly: string; yearly: string }> = {
  solo: {
    monthly: Deno.env.get("STRIPE_PRICE_SOLO_MONTHLY") ?? "",
    yearly: Deno.env.get("STRIPE_PRICE_SOLO_YEARLY") ?? "",
  },
  team: {
    monthly: Deno.env.get("STRIPE_PRICE_TEAM_MONTHLY") ?? "",
    yearly: Deno.env.get("STRIPE_PRICE_TEAM_YEARLY") ?? "",
  },
  business: {
    monthly: Deno.env.get("STRIPE_PRICE_BUSINESS_MONTHLY") ?? "",
    yearly: Deno.env.get("STRIPE_PRICE_BUSINESS_YEARLY") ?? "",
  },
};

interface CheckoutRequest {
  tier: "solo" | "team" | "business";
  billing: "monthly" | "yearly";
  seats?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
      },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { tier, billing, seats = 1 } = (await req.json()) as CheckoutRequest;

    const priceId = PRICE_IDS[tier]?.[billing];
    if (!priceId) {
      return new Response(JSON.stringify({ error: `Prix non configuré pour ${tier} ${billing}` }), { status: 400 });
    }

    // Fetch or create Stripe customer
    const { data: profile } = await admin.from("profiles").select("stripe_customer_id, full_name").eq("id", user.id).single();

    let customerId = profile?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: profile?.full_name ?? undefined,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("id", user.id);
    }

    const quantity = tier === "team" || tier === "business" ? Math.max(seats, 2) : 1;

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity }],
      subscription_data: {
        trial_period_days: 14,
        metadata: { user_id: user.id, tier },
      },
      success_url: "circl://subscription-success",
      cancel_url: "circl://subscription-cancelled",
      locale: "fr",
      allow_promotion_codes: true,
    });

    return new Response(JSON.stringify({ url: session.url, session_id: session.id }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
