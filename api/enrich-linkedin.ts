import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Auth inlined so this api/ file stays self-contained for Vercel's bundler,
// matching the api/ai/* pattern.
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
    console.error('authenticateRequest: token verification failed', err);
    return null;
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // A LinkedIn PII lookup (personal email/phone) that burns a paid quota must
  // never be an open proxy: require a valid Supabase session.
  const userId = await authenticateRequest(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { linkedinUrl } = req.body;

  if (!linkedinUrl) {
    res.status(400).json({ error: 'Missing linkedinUrl in request body' });
    return;
  }

  const apiKey = process.env.NINJAPEAR_API_KEY;

  if (!apiKey) {
    res.status(500).json({ error: 'NinjaPear API Key not configured on the server' });
    return;
  }

  try {
    const apiEndpoint = 'https://api.ninjapear.com/v1/person';
    const params = new URLSearchParams({
      url: linkedinUrl,
      fallback_to_cache: 'on-error',
      use_cache: 'if-present',
      skills: 'include',
      inferred_salary: 'include',
      personal_email: 'include',
      personal_contact_number: 'include',
      twitter_profile_id: 'include',
      facebook_profile_id: 'include',
      github_profile_id: 'include',
      extra: 'include'
    });

    const response = await fetch(`${apiEndpoint}?${params}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('NinjaPear API error:', response.status, errText);
      res.status(response.status).json({ error: `NinjaPear error: ${response.statusText}` });
      return;
    }

    const data = await response.json();
    
    // Minimal extraction to return to client
    const enrichedData = {
      fullName: data.full_name,
      headline: data.headline,
      summary: data.summary,
      industry: data.industry,
      location: data.country_full_name,
      experiences: (data.experiences || []).slice(0, 3).map((e: any) => ({
        company: e.company,
        title: e.title,
        description: e.description,
        starts_at: e.starts_at,
        ends_at: e.ends_at
      })),
      education: (data.education || []).slice(0, 2).map((e: any) => ({
        school: e.school,
        degree_name: e.degree_name,
        field_of_study: e.field_of_study
      })),
      skills: data.skills || []
    };

    res.status(200).json({ success: true, data: enrichedData });
  } catch (error: any) {
    console.error('Error fetching from NinjaPear:', error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
