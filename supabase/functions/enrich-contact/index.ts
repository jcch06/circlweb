import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface EnrichRequest {
  contact_id: string;
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
      return new Response(JSON.stringify({ error: "Missing authorization" }), { status: 401 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify the user
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const { contact_id } = (await req.json()) as EnrichRequest;

    // Fetch the contact
    const { data: contact, error: fetchError } = await supabase
      .from("contacts")
      .select("*")
      .eq("id", contact_id)
      .single();

    if (fetchError || !contact) {
      return new Response(JSON.stringify({ error: "Contact not found" }), { status: 404 });
    }

    // Use Claude Haiku to generate enrichment from available data
    const enrichPrompt = `Tu es un assistant d'enrichissement de contacts professionnels.
À partir des informations suivantes, génère un profil enrichi en JSON.

Contact:
- Nom: ${contact.first_name} ${contact.last_name}
- Email: ${contact.email || "inconnu"}
- Téléphone: ${contact.phone || "inconnu"}
- Entreprise: ${contact.company || "inconnue"}
- Poste: ${contact.job_title || "inconnu"}
- Localisation: ${contact.location || "inconnue"}

Génère un JSON avec les champs suivants (laisse null si impossible à déduire):
{
  "industry": "secteur d'activité",
  "company_size": "1-10 | 11-50 | 51-200 | 201-1000 | 1001-5000 | 5001-10000 | 10000+",
  "bio": "courte bio professionnelle en 1-2 phrases",
  "ai_context": "résumé contextuel utile pour le propriétaire du contact, 2-3 phrases max"
}

Réponds UNIQUEMENT avec le JSON, sans markdown ni explication.`;

    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        messages: [{ role: "user", content: enrichPrompt }],
      }),
    });

    const claudeData = await claudeResponse.json();
    const enrichedText = claudeData.content?.[0]?.text || "{}";
    const enriched = JSON.parse(enrichedText);

    // Generate embedding for vector search
    const embeddingText = [
      contact.first_name, contact.last_name,
      contact.company, contact.job_title,
      enriched.industry, contact.location,
      enriched.bio, enriched.ai_context,
    ].filter(Boolean).join(" ");

    const embeddingResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 64,
        messages: [{
          role: "user",
          content: `Generate a semantic search representation for this professional contact. Respond with only the key concepts separated by commas: ${embeddingText}`,
        }],
      }),
    });

    // For MVP: use Supabase's built-in embedding or a dedicated embedding API
    // For now, we skip embedding generation and update the enriched fields
    const updateData: Record<string, unknown> = {
      enriched_at: new Date().toISOString(),
      source: "enrichment",
    };

    if (enriched.industry) updateData.industry = enriched.industry;
    if (enriched.company_size) updateData.company_size = enriched.company_size;
    if (enriched.bio) updateData.bio = enriched.bio;
    if (enriched.ai_context) updateData.ai_context = enriched.ai_context;

    const { error: updateError } = await supabase
      .from("contacts")
      .update(updateData)
      .eq("id", contact_id);

    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ success: true, enriched: updateData }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
