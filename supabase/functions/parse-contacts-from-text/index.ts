import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

interface ParseRequest {
  text: string;
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

    const { text } = (await req.json()) as ParseRequest;
    if (!text || text.length < 10) {
      return new Response(JSON.stringify({ contacts: [] }), { headers: { "Content-Type": "application/json" } });
    }

    const prompt = `Tu es un expert en extraction de contacts depuis du texte brut (OCR).
Analyse ce texte et extrais TOUS les contacts présents (personnes avec leurs coordonnées professionnelles).

Texte extrait:
"""
${text}
"""

Pour chaque contact, retourne les champs suivants (null si absent):
- first_name: Prénom
- last_name: Nom
- phone: Téléphone (format international si possible)
- email: Email
- company: Entreprise
- job_title: Poste/titre
- linkedin: URL LinkedIn si présente
- location: Ville/pays
- industry: Secteur d'activité déduit

Réponds UNIQUEMENT avec un JSON valide:
{"contacts": [{"first_name": "...", "last_name": "...", ...}]}

Pas de markdown, pas d'explication. Si aucun contact n'est clairement identifiable, retourne {"contacts": []}.
Ignore les doublons évidents.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    const text_response = data.content?.[0]?.text || "{\"contacts\": []}";

    // Robust JSON extraction (Claude sometimes wraps in markdown)
    const jsonMatch = text_response.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { contacts: [] };

    return new Response(JSON.stringify(parsed), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message, contacts: [] }), { status: 500 });
  }
});
