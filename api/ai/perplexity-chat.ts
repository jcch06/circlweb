import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateRequest } from '../_lib/auth';

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
    res.status(200).json({ text });
  } catch (err: any) {
    console.error('Perplexity proxy error:', err);
    res.status(500).json({ error: err.message || 'Perplexity API error' });
  }
}
