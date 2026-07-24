import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface ChatRequest {
  message: string;
  space_id: string;
  conversation_id?: string;
  history?: Array<{ role: string; content: string }>;
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

    // Verify user
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { message, space_id, conversation_id, history = [] } = (await req.json()) as ChatRequest;

    // Fetch all contacts in the user's space for context
    const { data: contacts, error: contactsError } = await supabase
      .from("contacts")
      .select(`
        id, first_name, last_name, job_title, company, industry,
        location, company_size, bio, ai_context, last_contacted_at,
        phone, email, source, created_at
      `)
      .eq("space_id", space_id)
      .order("last_name");

    if (contactsError) {
      return new Response(JSON.stringify({ error: contactsError.message }), { status: 500 });
    }

    // Fetch tags for these contacts
    const contactIds = (contacts || []).map((c) => c.id);
    const { data: contactTags } = await supabase
      .from("contact_tags")
      .select("contact_id, tag_id, tags(name, category)")
      .in("contact_id", contactIds);

    // Fetch notes
    const { data: notes } = await supabase
      .from("notes")
      .select("contact_id, content, created_at, is_private, author_id")
      .in("contact_id", contactIds)
      .or(`is_private.eq.false,author_id.eq.${user.id}`);

    // Build contact context string
    const contactsContext = (contacts || []).map((c) => {
      const tags = (contactTags || [])
        .filter((ct) => ct.contact_id === c.id)
        .map((ct) => (ct as any).tags?.name)
        .filter(Boolean);

      const contactNotes = (notes || [])
        .filter((n) => n.contact_id === c.id)
        .map((n) => n.content);

      const lastContact = c.last_contacted_at
        ? new Date(c.last_contacted_at).toLocaleDateString("fr-FR")
        : "jamais";

      return `[${c.id}] ${c.first_name} ${c.last_name} — ${c.job_title || "?"} chez ${c.company || "?"} — ${c.industry || "?"} — ${c.location || "?"} — Taille: ${c.company_size || "?"} — Tags: ${tags.join(", ") || "aucun"} — Dernier contact: ${lastContact} — Notes: ${contactNotes.join("; ") || "aucune"} — Contexte: ${c.ai_context || "aucun"}`;
    }).join("\n");

    const systemPrompt = `Tu es l'assistant IA de Circl, un gestionnaire de relations professionnelles (PRM).
L'utilisateur te pose des questions sur ses contacts. Tu dois répondre en français, de manière concise et utile.

Tu as accès à la base de contacts suivante:
${contactsContext}

Règles de forme (IMPORTANT — l'app affiche ta réponse en texte simple) :
- Réponds en français, BREF et naturel. Pas de titres markdown (#, ##), pas de lignes "---", pas de longues listes à puces.
- Quand tu cites un contact, mets son ID entre crochets [uuid] juste après son nom. L'app transforme ça en fiche cliquable et RETIRE l'ID du texte affiché — ne commente jamais l'ID.
- N'énumère pas des dizaines de contacts dans le texte. Donne une phrase de synthèse puis cite au maximum ~8 contacts les plus pertinents (avec leur [uuid]). Si la liste est plus longue, écris "et X autres" et propose d'affiner.

Règles de fond :
- Si rien ne correspond, dis-le clairement et suggère d'élargir la recherche.
- Croise tags, notes, secteur, localisation pour des réponses pertinentes.
- Pour les introductions, raisonne sur qui connaît qui à partir des notes et du contexte.`;

    const messages = [
      ...history.map((h) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
      })),
      { role: "user" as const, content: message },
    ];

    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      }),
    });

    const claudeData = await claudeResponse.json();
    const responseText = claudeData.content?.[0]?.text || "Désolé, je n'ai pas pu traiter votre demande.";

    // Extract contact IDs mentioned in the response
    const mentionedIds: string[] = [];
    const idRegex = /\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/g;
    let match;
    while ((match = idRegex.exec(responseText)) !== null) {
      mentionedIds.push(match[1]);
    }

    // Clean the response (remove raw UUIDs for display)
    const cleanResponse = responseText.replace(idRegex, "").replace(/\s{2,}/g, " ").trim();

    // Save conversation
    const newMessages = [
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user", content: message },
      { role: "assistant", content: cleanResponse, contact_ids: mentionedIds },
    ];

    if (conversation_id) {
      await supabase
        .from("conversations")
        .update({ messages: newMessages, updated_at: new Date().toISOString() })
        .eq("id", conversation_id);
    } else {
      const { data: conv } = await supabase
        .from("conversations")
        .insert({ user_id: user.id, space_id, messages: newMessages, title: message.slice(0, 100) })
        .select("id")
        .single();

      return new Response(JSON.stringify({
        response: cleanResponse,
        contact_ids: mentionedIds,
        conversation_id: conv?.id,
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      response: cleanResponse,
      contact_ids: mentionedIds,
      conversation_id,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
