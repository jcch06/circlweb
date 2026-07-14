import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // No secret material is returned here — booleans only — so this endpoint
  // is intentionally unauthenticated, same as the client-side checks it replaces.
  res.status(200).json({
    mistralConfigured: Boolean(process.env.MISTRAL_API_KEY),
    perplexityConfigured: Boolean(process.env.PERPLEXITY_API_KEY)
  });
}
