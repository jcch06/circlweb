import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────────────────────────────────────
// Async Oracle pipeline (option B) — a RESUMABLE, background-friendly analysis
// for large networks (up to ~10k contacts).
//
// The synchronous pipeline (src/lib/mistral.ts → runMistralOracleBatchPipeline)
// drives topology → N×map-batch → reduce → supply from the browser, each call
// bounded to 60s. That works to ~1200 contacts but a bigger network needs
// hundreds of MAP calls: too long for one browser session and fatal if the tab
// closes. This endpoint instead persists a JOB and does a BOUNDED slice of work
// per "advance" call, so the client just polls, and a Vercel cron can push a job
// forward even with no tab open.
//
// It REUSES the existing endpoints (topology/map-batch/reduce/supply-demand) via
// internal HTTP calls rather than duplicating their logic — the only new heavy
// code is the state machine itself.
//
// Phases: embed (warm embeddings in waves) → plan (cluster + define batches) →
// map (run batches in waves) → reduce → supply → done.
//
// STATUS: first cut. The MAP phase scales to hundreds of batches; REDUCE
// currently does a single pass over the richest MAX_REDUCE_BATCHES batches —
// a true 10k needs a hierarchical reduce (documented below).
// ─────────────────────────────────────────────────────────────────────────────

const EMBED_WAVE = 250;        // contacts embedded per advance call
const MAP_WAVE = 6;            // batches MAP-analyzed per advance call
const MAX_REDUCE_BATCHES = 80; // batches fed to the single reduce pass (see TODO)

async function authenticateRequest(req: VercelRequest): Promise<{ userId: string; token: string } | null> {
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
    return { userId: data.user.id, token };
  } catch (err) {
    console.error('job authenticateRequest failed', err);
    return null;
  }
}

function baseUrl(req: VercelRequest): string {
  const host = req.headers.host;
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  return `${proto}://${host}`;
}

// Call one of our own Oracle endpoints server-to-server, forwarding the caller's
// token so RLS + the same auth path apply.
async function callInternal<T = any>(req: VercelRequest, token: string, path: string, body: any): Promise<T> {
  const resp = await fetch(`${baseUrl(req)}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const e: any = new Error(err.error || `${path} failed (${resp.status})`);
    e.statusCode = resp.status;
    e.rateLimited = Boolean(err.rateLimited) || resp.status === 429;
    throw e;
  }
  return resp.json();
}

function progressFor(job: any): number {
  switch (job.phase) {
    case 'init': return 2;
    case 'embed': return job.total_to_embed > 0 ? 5 + Math.round((job.embedded / job.total_to_embed) * 20) : 25;
    case 'plan': return 28;
    case 'map': return job.total_batches > 0 ? 30 + Math.round((job.completed_batches / job.total_batches) * 55) : 85;
    case 'reduce': return 88;
    case 'supply': return 95;
    case 'done': return 100;
    default: return job.progress || 0;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const auth = await authenticateRequest(req);
  if (!auth) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const supabaseUrl = process.env.VITE_SUPABASE_URL!;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY!;
  const db = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${auth.token}` } }
  });

  const { action, jobId, spaceId, userProfile } = req.body || {};

  try {
    // ── create ──────────────────────────────────────────────────────────────
    if (action === 'create') {
      const { data, error } = await db.from('analysis_jobs').insert({
        owner_id: auth.userId,
        space_id: spaceId ?? null,
        status: 'running',
        phase: 'embed',
        user_profile: userProfile ?? null,
        heartbeat_at: new Date().toISOString()
      }).select('*').single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.status(200).json({ jobId: data.id, status: data.status, phase: data.phase, progress: progressFor(data) });
      return;
    }

    // ── status ──────────────────────────────────────────────────────────────
    if (action === 'status') {
      const { data, error } = await db.from('analysis_jobs').select('*').eq('id', jobId).single();
      if (error) { res.status(404).json({ error: 'job not found' }); return; }
      res.status(200).json(publicJob(data));
      return;
    }

    // ── cancel ──────────────────────────────────────────────────────────────
    if (action === 'cancel') {
      await db.from('analysis_jobs').update({ status: 'error', error: 'cancelled', updated_at: new Date().toISOString() }).eq('id', jobId);
      res.status(200).json({ ok: true });
      return;
    }

    // ── advance ───────────────────────────────────────────────────────────────
    if (action === 'advance') {
      const { data: job, error } = await db.from('analysis_jobs').select('*').eq('id', jobId).single();
      if (error || !job) { res.status(404).json({ error: 'job not found' }); return; }
      if (job.status !== 'running') { res.status(200).json(publicJob(job)); return; }

      await db.from('analysis_jobs').update({ heartbeat_at: new Date().toISOString() }).eq('id', jobId);

      try {
        const updated = await advance(req, auth.token, db, job);
        res.status(200).json(publicJob(updated));
      } catch (err: any) {
        // A rate-limit is transient — leave the job running so the next advance
        // (or cron) retries the same phase. Anything else fails the job.
        if (err?.rateLimited) {
          res.status(200).json({ ...publicJob(job), rateLimited: true });
          return;
        }
        await db.from('analysis_jobs').update({ status: 'error', error: String(err?.message || err), updated_at: new Date().toISOString() }).eq('id', jobId);
        res.status(200).json({ ...publicJob(job), status: 'error', error: String(err?.message || err) });
      }
      return;
    }

    res.status(400).json({ error: 'unknown action' });
  } catch (err: any) {
    console.error('job handler failure', err);
    res.status(500).json({ error: err?.message || 'job failed' });
  }
}

function publicJob(job: any) {
  return {
    jobId: job.id,
    status: job.status,
    phase: job.phase,
    progress: progressFor(job),
    analyzedCount: job.analyzed_count,
    excludedCount: job.excluded_count,
    cappedCount: job.capped_count,
    totalBatches: job.total_batches,
    completedBatches: job.completed_batches,
    totalToEmbed: job.total_to_embed,
    embedded: job.embedded,
    error: job.error,
    synthesis: job.synthesis ?? null,
    supplyDemand: job.supply_demand ?? null,
    bridgeContacts: job.bridge_contacts ?? [],
    userProfile: job.user_profile ?? null
  };
}

// Run ONE bounded slice of work for the job's current phase and persist it.
async function advance(req: VercelRequest, token: string, db: any, job: any): Promise<any> {
  const jobId = job.id;
  const spaceId = job.space_id ?? null;

  const save = async (patch: any) => {
    const { data } = await db.from('analysis_jobs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', jobId).select('*').single();
    return data;
  };

  // ── embed: warm the embedding cache in waves ────────────────────────────────
  if (job.phase === 'embed') {
    const r = await callInternal(req, token, '/api/oracle/topology', {
      spaceId, maxAnalyze: 100000, embedOnly: true, embedLimit: EMBED_WAVE
    });
    const embedded = (job.embedded || 0) + (r.embeddedNow || 0);
    if ((r.remaining ?? 0) <= 0) {
      return save({
        phase: 'plan', embedded, total_to_embed: r.totalToEmbed ?? embedded,
        analyzed_count: r.analyzedCount ?? 0, excluded_count: r.excludedCount ?? 0, capped_count: r.cappedCount ?? 0
      });
    }
    return save({ embedded, total_to_embed: r.totalToEmbed ?? 0, analyzed_count: r.analyzedCount ?? 0 });
  }

  // ── plan: cluster + define batches (embeddings are warm now) ────────────────
  if (job.phase === 'plan') {
    const topo = await callInternal(req, token, '/api/oracle/topology', { spaceId, maxAnalyze: 100000 });
    const batches: any[] = Array.isArray(topo.batches) ? topo.batches : [];
    // Persist each batch; a batch that came back with an inline cached MAP
    // result is already "done".
    const rows = batches.map((b, i) => ({
      job_id: jobId, batch_index: i,
      contact_ids: b.contactIds, cluster_id: b.clusterId ?? null, contact_ids_hash: b.contactIdsHash ?? null,
      status: b.cached ? 'done' : 'pending', result: b.cached ?? null,
      updated_at: new Date().toISOString()
    }));
    // Chunk the insert so a huge batch list doesn't exceed request limits.
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db.from('analysis_job_batches').upsert(rows.slice(i, i + 200), { onConflict: 'job_id,batch_index' });
      if (error) throw new Error(`plan persist failed: ${error.message}`);
    }
    const completed = rows.filter(r => r.status === 'done').length;
    const nextPhase = batches.length === 0 ? 'reduce' : 'map';
    return save({
      phase: nextPhase, total_batches: batches.length, completed_batches: completed,
      bridge_contacts: topo.bridgeContacts ?? [], locked_names: topo.lockedContactNames ?? [],
      analyzed_count: topo.analyzedCount ?? job.analyzed_count, excluded_count: topo.excludedCount ?? job.excluded_count,
      capped_count: topo.cappedCount ?? job.capped_count
    });
  }

  // ── map: run the next wave of pending batches ───────────────────────────────
  if (job.phase === 'map') {
    const { data: pending } = await db.from('analysis_job_batches')
      .select('*').eq('job_id', jobId).eq('status', 'pending').order('batch_index').limit(MAP_WAVE);
    if (!pending || pending.length === 0) {
      return save({ phase: 'reduce' });
    }
    for (const b of pending) {
      const result = await callInternal(req, token, '/api/oracle/map-batch', {
        contactIds: b.contact_ids, clusterId: b.cluster_id, contactIdsHash: b.contact_ids_hash,
        spaceId, lockedContactNames: job.locked_names ?? [], userProfile: job.user_profile ?? null
      });
      await db.from('analysis_job_batches').update({ status: 'done', result, updated_at: new Date().toISOString() })
        .eq('job_id', jobId).eq('batch_index', b.batch_index);
    }
    const { count } = await db.from('analysis_job_batches')
      .select('*', { count: 'exact', head: true }).eq('job_id', jobId).eq('status', 'done');
    return save({ completed_batches: count ?? job.completed_batches });
  }

  // ── reduce: synthesize (single pass over the richest batches) ────────────────
  // TODO(scale): for a very large network (> MAX_REDUCE_BATCHES batches) this
  // should be hierarchical — reduce batches in groups into partial syntheses,
  // then reduce the partials. For now we feed the richest MAX_REDUCE_BATCHES.
  if (job.phase === 'reduce') {
    const { data: done } = await db.from('analysis_job_batches')
      .select('batch_index, contact_ids, result').eq('job_id', jobId).eq('status', 'done').order('batch_index');
    const withResults = (done || []).filter((b: any) => b.result);
    // Richest = most immediate synergies + needs first.
    const ranked = withResults.sort((a: any, b: any) => scoreBatch(b.result) - scoreBatch(a.result)).slice(0, MAX_REDUCE_BATCHES);
    const batchResults = ranked.map((b: any) => b.result);
    const batchMembership = ranked.map((b: any) => b.contact_ids);

    const synthesis = await callInternal(req, token, '/api/oracle/reduce', {
      batchResults, batches: batchMembership,
      bridgeContacts: job.bridge_contacts ?? [], lockedContactNames: job.locked_names ?? [],
      userProfile: job.user_profile ?? null
    });
    return save({ phase: 'supply', synthesis });
  }

  // ── supply: offre/demande matrix ────────────────────────────────────────────
  if (job.phase === 'supply') {
    const supplyDemand = await callInternal(req, token, '/api/oracle/supply-demand', {
      spaceId, userProfile: job.user_profile ?? null
    });
    return save({ phase: 'done', status: 'done', progress: 100, supply_demand: supplyDemand });
  }

  return job;
}

function scoreBatch(result: any): number {
  if (!result) return 0;
  const syn = Array.isArray(result.immediateSynergies) ? result.immediateSynergies.length : 0;
  const needs = Array.isArray(result.recurrentNeeds) ? result.recurrentNeeds.length : 0;
  const comps = Array.isArray(result.keyCompetencies) ? result.keyCompetencies.length : 0;
  return syn * 3 + needs + comps;
}
