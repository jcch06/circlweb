import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface InviteRequest {
  space_id: string;
  email: string;
  role?: "admin" | "member" | "viewer";
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
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { space_id, email, role = "member" } = (await req.json()) as InviteRequest;

    // Check inviter is owner/admin of space
    const { data: membership } = await admin
      .from("space_members")
      .select("role")
      .eq("space_id", space_id)
      .eq("user_id", user.id)
      .single();

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return new Response(JSON.stringify({ error: "Permission refusée" }), { status: 403 });
    }

    // Create invitation (upsert by space+email)
    const { data: invitation, error: inviteError } = await admin
      .from("invitations")
      .upsert(
        { space_id, email: email.toLowerCase(), role, invited_by: user.id, accepted_at: null },
        { onConflict: "space_id,email" }
      )
      .select()
      .single();

    if (inviteError || !invitation) {
      return new Response(JSON.stringify({ error: inviteError?.message ?? "Échec de l'invitation" }), { status: 500 });
    }

    // Get space name for email
    const { data: space } = await admin.from("spaces").select("name").eq("id", space_id).single();
    const { data: inviterProfile } = await admin.from("profiles").select("full_name").eq("id", user.id).single();

    // Send invitation email via Supabase auth (magic link with metadata)
    // This sends a standard email; user clicks link, signs up/logs in, invitation auto-accepts via trigger
    const { error: emailError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: {
        invited_to_space: space_id,
        space_name: space?.name ?? "une équipe",
        invited_by: inviterProfile?.full_name ?? "Un collègue",
      },
      redirectTo: "circl://invite-accepted",
    });

    // If the user already exists, inviteUserByEmail will fail, but the invitation row is created
    // and will auto-accept on next login. That's acceptable.

    return new Response(JSON.stringify({
      success: true,
      invitation_id: invitation.id,
      email_sent: !emailError,
      user_exists: emailError?.message?.includes("already") ?? false,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
