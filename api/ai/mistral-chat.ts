import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Mistral } from '@mistralai/mistralai';
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

  const userId = await authenticateRequest(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Mistral API key is not configured on the server' });
    return;
  }

  const { model, messages, responseFormat } = req.body || {};
  if (!model || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'Missing model or messages in request body' });
    return;
  }

  try {
    const client = new Mistral({ apiKey });
    const response = await client.chat.complete({
      model,
      messages,
      responseFormat: responseFormat === 'json_object' ? { type: 'json_object' } : undefined
    });

    const choice = response.choices?.[0]?.message?.content;
    const text = typeof choice === 'string' ? choice : (choice ? String(choice) : '');

    res.status(200).json({ text, usage: response.usage || null });
  } catch (err: any) {
    console.error('Mistral chat proxy error:', err);
    const status = err.statusCode || err.status || 500;
    res.status(status).json({ error: err.message || 'Mistral API error' });
  }
}
