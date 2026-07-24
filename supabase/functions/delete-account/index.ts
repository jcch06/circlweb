import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    // Protect the Apple Review demo account from accidental deletion.
    // Apple's reviewer needs this account intact across multiple submissions.
    // Real users can be deleted normally; only this specific demo account
    // is preserved (data is reset by us out-of-band when needed).
    const PROTECTED_EMAILS = new Set([
      "review@mycircl.eu",
    ]);
    if (user.email && PROTECTED_EMAILS.has(user.email.toLowerCase())) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Compte démo simulé supprimé. Cette action n'a pas réellement effacé le compte (réservé à la review Apple).",
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Delete the auth user — triggers CASCADE on profiles, spaces, contacts, etc.
    const { error } = await admin.auth.admin.deleteUser(user.id);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
