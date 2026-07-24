import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface EmbeddingRequest {
  contact_id?: string;
  text?: string; // For query embedding
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
    const { contact_id, text } = (await req.json()) as EmbeddingRequest;

    let inputText = text;

    // If contact_id provided, build text from contact data
    if (contact_id && !text) {
      const { data: contact } = await supabase
        .from("contacts")
        .select("*")
        .eq("id", contact_id)
        .single();

      if (!contact) {
        return new Response(JSON.stringify({ error: "Contact not found" }), { status: 404 });
      }

      // Fetch tags
      const { data: tags } = await supabase
        .from("contact_tags")
        .select("tags(name)")
        .eq("contact_id", contact_id);

      // Fetch notes
      const { data: notes } = await supabase
        .from("notes")
        .select("content")
        .eq("contact_id", contact_id)
        .eq("is_private", false);

      const tagNames = (tags || []).map((t) => (t as any).tags?.name).filter(Boolean);
      const noteTexts = (notes || []).map((n) => n.content);

      inputText = [
        `${contact.first_name} ${contact.last_name}`,
        contact.job_title,
        contact.company,
        contact.industry,
        contact.location,
        contact.company_size,
        contact.bio,
        contact.ai_context,
        tagNames.length ? `Tags: ${tagNames.join(", ")}` : "",
        noteTexts.length ? `Notes: ${noteTexts.join(". ")}` : "",
      ].filter(Boolean).join(". ");
    }

    if (!inputText) {
      return new Response(JSON.stringify({ error: "No text to embed" }), { status: 400 });
    }

    // Generate embedding via OpenAI (text-embedding-3-small, 1536 dimensions)
    const embeddingResponse = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: inputText,
        dimensions: 1536,
      }),
    });

    const embeddingData = await embeddingResponse.json();
    const embedding = embeddingData.data?.[0]?.embedding;

    if (!embedding) {
      return new Response(JSON.stringify({ error: "Failed to generate embedding" }), { status: 500 });
    }

    // If contact_id, store the embedding
    if (contact_id) {
      const { error: updateError } = await supabase
        .from("contacts")
        .update({ embedding })
        .eq("id", contact_id);

      if (updateError) {
        return new Response(JSON.stringify({ error: updateError.message }), { status: 500 });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // If just text, return the embedding (for query search)
    return new Response(JSON.stringify({ embedding }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
