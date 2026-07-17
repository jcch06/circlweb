import { supabase } from './supabase';
import type { MistralGlobalSynthesis, SupplyDemandEntry, BridgeContact } from './mistral';

// Client driver for the async Oracle pipeline (api/oracle/job.ts). Creates a
// resumable job, then repeatedly calls "advance" (each call does a bounded slice
// of work server-side) until the job is done, reporting progress. Because all
// state lives in Supabase, the loop can be abandoned (tab closed) and resumed
// later — or pushed forward by the Vercel cron — without losing work.

export interface JobState {
  jobId: string;
  status: 'pending' | 'running' | 'done' | 'error';
  phase: 'init' | 'embed' | 'plan' | 'map' | 'reduce' | 'supply' | 'done';
  progress: number;
  analyzedCount?: number;
  excludedCount?: number;
  cappedCount?: number;
  totalBatches?: number;
  completedBatches?: number;
  totalToEmbed?: number;
  embedded?: number;
  error?: string | null;
  rateLimited?: boolean;
  synthesis?: MistralGlobalSynthesis | null;
  supplyDemand?: SupplyDemandEntry[] | null;
  bridgeContacts?: BridgeContact[];
  userProfile?: any;
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

async function post(body: any): Promise<any> {
  const resp = await fetch('/api/oracle/job', { method: 'POST', headers: await authHeader(), body: JSON.stringify(body) });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `job request failed (${resp.status})`);
  }
  return resp.json();
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function createAnalysisJob(spaceId: string | null, userProfile: any): Promise<JobState> {
  return post({ action: 'create', spaceId, userProfile });
}

export async function getJobStatus(jobId: string): Promise<JobState> {
  return post({ action: 'status', jobId });
}

export async function cancelJob(jobId: string): Promise<void> {
  await post({ action: 'cancel', jobId });
}

/**
 * Drive an existing job to completion, advancing one bounded slice at a time.
 * `onProgress` fires after every slice. Safe to call on a fresh job or to RESUME
 * one that was left mid-flight. Returns the final job state.
 */
export async function runAnalysisJob(
  jobId: string,
  onProgress?: (s: JobState) => void,
  opts?: { signal?: AbortSignal }
): Promise<JobState> {
  // Generous ceiling: a 10k network is hundreds of map waves. The loop is cheap
  // (each advance is one bounded server call) and the real guard is job.status.
  const MAX_STEPS = 5000;
  for (let i = 0; i < MAX_STEPS; i++) {
    if (opts?.signal?.aborted) throw new Error('aborted');
    const state: JobState = await post({ action: 'advance', jobId });
    onProgress?.(state);
    if (state.status === 'done' || state.status === 'error') return state;
    // Back off a beat when the account is rate-limited so we ride it out
    // instead of hammering; otherwise keep the loop tight.
    await sleep(state.rateLimited ? 8000 : 300);
  }
  throw new Error('Job did not complete within the step budget — resume it later.');
}

/** Convenience: create + run in one call. */
export async function createAndRunAnalysisJob(
  spaceId: string | null,
  userProfile: any,
  onProgress?: (s: JobState) => void,
  opts?: { signal?: AbortSignal }
): Promise<JobState> {
  const created = await createAnalysisJob(spaceId, userProfile);
  onProgress?.(created);
  return runAnalysisJob(created.jobId, onProgress, opts);
}
