import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Map Stripe price nicknames/product names to our tier system
// You can also look up by product ID if you set product metadata
function periodEnd(sub: Stripe.Subscription): string | null {
  const ts = (sub as any).current_period_end ?? (sub.items.data[0] as any)?.current_period_end;
  return typeof ts === "number" ? new Date(ts * 1000).toISOString() : null;
}

// Offre déduite du lookup_key du prix (solo_monthly, team_yearly…).
function tierFromPrice(price: Stripe.Price | undefined): string {
  const t = (price?.lookup_key ?? "").split("_")[0];
  return ["solo", "team", "business"].includes(t) ? t : "free";
}

serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("No signature", { status: 400 });

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return new Response(`Webhook error: ${(err as Error).message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      // Achat de crédits (buy-credits) : crédit idempotent, une fois par session.
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.metadata?.kind !== "credits" || s.payment_status !== "paid") break;
        const credits = Number(s.metadata.credits);
        if (!s.metadata.user_id || !Number.isInteger(credits) || credits <= 0) break;
        const { error } = await admin.rpc("add_enrichment_credits", {
          p_user: s.metadata.user_id, p_credits: credits, p_reason: `achat_${s.metadata.pack ?? "credits"}`, p_ref: s.id,
        });
        if (error) throw error;
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        const quantity = sub.items.data[0]?.quantity ?? 1;
        const tier = tierFromPrice(sub.items.data[0]?.price);

        await admin
          .from("profiles")
          .update({
            stripe_subscription_id: sub.id,
            subscription_status: sub.status,
            subscription_tier: tier,
            subscription_seats: quantity,
            // Selon la version d'API du compte, la fin de période est sur l'abonnement ou sur sa ligne.
            current_period_end: periodEnd(sub),
            trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
            plan: tier,
          })
          .eq("stripe_customer_id", customerId);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await admin
          .from("profiles")
          .update({
            subscription_status: "canceled",
            subscription_tier: "free",
            plan: "free",
            stripe_subscription_id: null,
          })
          .eq("stripe_customer_id", sub.customer as string);
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.subscription) {
          await admin.from("profiles").update({ subscription_status: "active" })
            .eq("stripe_customer_id", invoice.customer as string).eq("stripe_subscription_id", invoice.subscription as string);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await admin
          .from("profiles")
          .update({ subscription_status: "past_due" })
          .eq("stripe_customer_id", invoice.customer as string);
        break;
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
