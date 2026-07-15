import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Auth is inlined (not imported from a shared file) so this function has no
// cross-file dependency for Vercel's bundler to trace — each api/ file is
// fully self-contained, matching the pre-existing api/enrich-linkedin.ts pattern.
async function authenticateRequest(req: VercelRequest): Promise<string | null> {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  } catch (err) {
    console.error('authenticateRequest: unexpected failure verifying token', err);
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // See mistral-chat.ts for why this is one top-level try/catch: no failure
  // mode should ever escape as a non-JSON platform error page.
  try {
    const userId = await authenticateRequest(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'Perplexity API key is not configured on the server' });
      return;
    }

    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Missing messages in request body' });
      return;
    }

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: 'sonar', messages })
    });

    if (!response.ok) {
      const errText = await response.text();
      res.status(response.status).json({ error: `Perplexity API error: ${errText}` });
      return;
    }

    const data: any = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    // Perplexity's "sonar" models ground answers in a live web search and
    // return the sources they used — `search_results` (richer: title/url/date)
    // when available, else the older `citations` (URL-only) array. Surfacing
    // these lets the user verify an AI-generated claim instead of trusting it
    // blindly.
    let citations: { title: string; url: string }[] = [];
    if (Array.isArray(data.search_results)) {
      citations = data.search_results
        .filter((r: any) => r && typeof r.url === 'string')
        .map((r: any) => ({ title: r.title || r.url, url: r.url }));
    } else if (Array.isArray(data.citations)) {
      citations = data.citations
        .filter((url: any) => typeof url === 'string')
        .map((url: string) => ({ title: url, url }));
    }

    res.status(200).json({ text, citations });
  } catch (err: any) {
    console.error('Perplexity proxy error:', err);
    res.status(500).json({ error: err.message || 'Perplexity API error' });
  }
}
