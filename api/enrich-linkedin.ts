import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
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
