import type { VercelRequest } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

/**
 * Verifies the Supabase access token attached to a request (`Authorization: Bearer <token>`)
 * and returns the authenticated user's id, or null if missing/invalid.
 *
 * Uses the anon key, not the service role key — auth.getUser(jwt) validates the token
 * against Supabase Auth without needing elevated privileges.
 */
export async function authenticateRequest(req: VercelRequest): Promise<string | null> {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;

  return data.user.id;
}
