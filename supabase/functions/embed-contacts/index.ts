import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Recherche par le sens : calcule l'embedding (OpenAI text-embedding-3-small,
// 1536 dimensions) des fiches visibles par l'appelant qui n'en ont pas, ou
// dont le contenu a changé (empreinte embedding_hash). 400 fiches par appel ;
// le client rappelle tant que « remaining » > 0.
// Contenu embarqué : nom, poste, entreprise, secteur, lieu, compétences,
// besoins et notes NON privées (déjà visibles par le cercle de la fiche).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const BATCH = 400;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const sha1 = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await db.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    if (!OPENAI_API_KEY) return json({ error: "Recherche par le sens non configurée" }, 503);
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Fiches brutes visibles par l'appelant (RLS : cercles, partages, verrouillage).
    const rows: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("contacts")
        .select("id, first_name, last_name, job_title, company, industry, location, skills, inferred_needs, embedding_hash")
        .range(from, from + 999);
      if (error) return json({ error: error.message }, 500);
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const withInfo = rows.filter((c) => c.job_title || c.company || c.industry || (c.skills ?? []).length);
    const ids = withInfo.map((c) => c.id);
    const notesBy = new Map<string, string[]>();
    for (let i = 0; i < ids.length; i += 300) {
      const { data } = await admin.from("notes").select("contact_id, content").in("contact_id", ids.slice(i, i + 300)).eq("is_private", false).limit(3000);
      for (const n of data ?? []) (notesBy.get(n.contact_id) ?? notesBy.set(n.contact_id, []).get(n.contact_id)!).push(n.content);
    }
    const texts = await Promise.all(withInfo.map(async (c) => {
      const text = [
        `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(), c.job_title, c.company, c.industry, c.location,
        (c.skills ?? []).join(", "), (c.inferred_needs ?? []).join(", "), (notesBy.get(c.id) ?? []).join(" ").slice(0, 2000),
      ].filter(Boolean).join(" · ");
      return { id: c.id, text, hash: await sha1(text), old: c.embedding_hash };
    }));
    const todo = texts.filter((t) => t.hash !== t.old);
    const batch = todo.slice(0, BATCH);
    if (batch.length) {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({ model: "text-embedding-3-small", input: batch.map((t) => t.text) }),
      });
      const body = await res.json();
      if (!res.ok) return json({ error: body?.error?.message ?? `Embeddings indisponibles (${res.status})` }, 502);
      await Promise.all(batch.map((t, i) => admin.from("contacts")
        .update({ embedding: JSON.stringify(body.data[i].embedding), embedding_hash: t.hash }).eq("id", t.id)));
    }
    return json({ embedded: batch.length, remaining: todo.length - batch.length, total: withInfo.length });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
