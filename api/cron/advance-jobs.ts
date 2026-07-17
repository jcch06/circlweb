import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';

// Autonomous background driver for the async Oracle pipeline (api/oracle/job.ts).
// A Vercel cron hits this ~every minute; it finds RUNNING jobs whose client has
// gone quiet (stale heartbeat = tab closed) and pushes each forward a slice.
// A job actively driven by an open tab keeps a fresh heartbeat and is skipped,
// so the client and the cron never fight over the same job.
//
// Auth model: the cron has no user session. It uses the service-role key ONLY
// to LIST stale jobs, then mints a short-lived JWT (signed with
// SUPABASE_JWT_SECRET, marked oracle_cron) for each job's OWNER and calls the
// normal job endpoint with it — so every downstream contact read runs under
// that owner's RLS, exactly as if they were driving it. No service-role data
// access, no cross-user scoping to get wrong.
//
// Required env: CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET.

const STALE_MS = 90_000;       // a job is "abandoned" after 90s without a heartbeat
const MAX_JOBS_PER_TICK = 4;   // keep each cron invocation short
const ADVANCES_PER_JOB = 2;    // slices to push per job per tick

function mintOwnerToken(secret: string, userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({
    sub: userId, role: 'authenticated', aud: 'authenticated', oracle_cron: true, iat: now, exp: now + 600
  })}`;
  const sig = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function baseUrl(req: VercelRequest): string {
  const host = req.headers.host;
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  return `${proto}://${host}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is
  // set. Reject anything else so the endpoint can't be poked publicly.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authz = req.headers.authorization || '';
    if (authz !== `Bearer ${cronSecret}`) { res.status(401).json({ error: 'Unauthorized' }); return; }
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  if (!supabaseUrl || !serviceKey || !jwtSecret) {
    res.status(500).json({ error: 'cron not configured (needs SUPABASE_SERVICE_ROLE_KEY + SUPABASE_JWT_SECRET)' });
    return;
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const staleBefore = new Date(Date.now() - STALE_MS).toISOString();

  const { data: jobs, error } = await admin
    .from('analysis_jobs')
    .select('id, owner_id')
    .eq('status', 'running')
    .or(`heartbeat_at.is.null,heartbeat_at.lt.${staleBefore}`)
    .order('updated_at', { ascending: true })
    .limit(MAX_JOBS_PER_TICK);
  if (error) { res.status(500).json({ error: error.message }); return; }

  let advanced = 0;
  for (const job of jobs || []) {
    const token = mintOwnerToken(jwtSecret, job.owner_id);
    for (let i = 0; i < ADVANCES_PER_JOB; i++) {
      try {
        const r = await fetch(`${baseUrl(req)}/api/oracle/job`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: 'advance', jobId: job.id })
        });
        const s = await r.json().catch(() => ({}));
        advanced++;
        // Stop pushing this job if it finished, errored, or is rate-limited
        // (let the next tick retry so we don't hammer Mistral).
        if (s.status !== 'running' || s.rateLimited) break;
      } catch (err) {
        console.error('cron advance failed for job', job.id, err);
        break;
      }
    }
  }

  res.status(200).json({ jobsPicked: jobs?.length ?? 0, advanced });
}
