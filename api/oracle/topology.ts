import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Mistral } from '@mistralai/mistralai';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

// Step 1/4 of the Oracle pipeline (see api/oracle/map-batch.ts, reduce.ts,
// supply-demand.ts). Split into short calls, each well under any Vercel
// plan's timeout, orchestrated from the client — a single do-everything
// function (the original design) hit 504s in production because a full
// pipeline is several sequential Mistral Large calls.
//
// Incremental: persists per-contact embeddings (contact_embeddings) and
// cluster centroids (oracle_clusters) across runs. A contact whose content
// hasn't changed since its embedding was computed never gets re-embedded; a
// contact new to a scope gets assigned to its nearest existing cluster
// instead of triggering a full re-cluster (which would reshuffle batch
// membership and defeat the per-cluster MAP cache in map-batch.ts). Falls
// back to the old "always full" behavior if the cache tables don't exist yet
// (migration not applied) — never a hard failure.
//
// Self-contained on purpose — see map-batch.ts for why.

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
    console.error('authenticateRequest: unexpected failure verifying token', err);
    return null;
  }
}

// A PostgREST `.in('col', ids)` filter is serialized straight into the
// request's query string — on a large merged network (hundreds of contact
// ids) that URL can exceed the gateway's request-line size limit, which
// comes back as a bare, non-JSON "400 Bad Request" (no PostgREST error body
// to parse, no Mistral involved at all). Chunking keeps every single
// request well under that ceiling.
async function selectInChunks<T = any>(
  build: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: any }>,
  ids: string[],
  chunkSize = 150
): Promise<{ data: T[]; error: any }> {
  if (ids.length === 0) return { data: [], error: null };
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize));
  const results = await Promise.all(chunks.map(build));
  const failed = results.find(r => r.error);
  if (failed) return { data: [], error: failed.error };
  return { data: results.flatMap(r => r.data || []), error: null };
}

// ─── Content hashing (shared formula with map-batch.ts / supply-demand.ts) ──
// Captures everything that feeds either the embedding or the MAP/SUPPLY
// prompts for a contact — if this hash is unchanged, the contact's prior
// embedding and its cluster's cached MAP result are both still valid.

// Version tag of the MAP synergy prompt/algorithm. It is folded into the
// per-cluster MAP cache key so that ANY change to how synergies are detected
// (prompt wording, rigor/recall balance, output shape) automatically
// invalidates every cached batch result — otherwise a cluster whose contacts
// didn't change keeps serving synergies computed under the OLD prompt, and
// prompt improvements silently never reach an already-analyzed network.
// BUMP THIS whenever the map-batch.ts synergy prompt changes.
const MAP_PROMPT_VERSION = 'map-v2-recall';

function contactContentHash(c: any, notes: any[]): string {
  const noteText = notes.filter(n => n.contact_id === c.id).map(n => n.content).sort().join('|');
  const skills = Array.isArray(c.skills) ? [...c.skills].sort().join(',') : '';
  const needs = Array.isArray(c.inferred_needs) ? [...c.inferred_needs].sort().join(',') : '';
  const raw = [c.first_name, c.last_name, c.job_title, c.company, skills, needs, noteText].join('::');
  return createHash('sha256').update(raw).digest('hex');
}

// NB: the MAP prompt version is part of this key — a prompt bump changes every
// cluster's hash, forcing a one-time full recompute under the new prompt.
function clusterContactsHash(contactIds: string[], hashByContactId: Map<string, string>): string {
  const parts = [...contactIds].sort().map(id => `${id}:${hashByContactId.get(id) || ''}`);
  return createHash('sha256').update(`${MAP_PROMPT_VERSION}|${parts.join('|')}`).digest('hex');
}

// ─── vectorMath (ported verbatim from src/lib/vectorMath.ts) ────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  if (a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return Math.max(0, Math.min(1, dot / denom));
}

function buildSimilarityMatrix(embeddings: number[][]): number[][] {
  const n = embeddings.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const sim = cosineSimilarity(embeddings[i], embeddings[j]);
      matrix[i][j] = sim;
      matrix[j][i] = sim;
    }
  }
  return matrix;
}

function distanceSquared(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum;
}

function assignClusters(data: number[][], centroids: number[][]): number[] {
  return data.map((point) => {
    let bestIdx = 0, bestDist = Infinity;
    for (let c = 0; c < centroids.length; c++) {
      const d = distanceSquared(point, centroids[c]);
      if (d < bestDist) { bestDist = d; bestIdx = c; }
    }
    return bestIdx;
  });
}

function recomputeCentroids(data: number[][], clusters: number[], k: number, dims: number): number[][] {
  const sums: number[][] = Array.from({ length: k }, () => new Array<number>(dims).fill(0));
  const counts = new Array<number>(k).fill(0);
  for (let i = 0; i < data.length; i++) {
    const c = clusters[i];
    counts[c]++;
    for (let d = 0; d < dims; d++) sums[c][d] += data[i][d];
  }
  return sums.map((sum, idx) => {
    if (counts[idx] === 0) return [...data[Math.floor(Math.random() * data.length)]];
    return sum.map((v) => v / counts[idx]);
  });
}

function computeInertia(data: number[][], clusters: number[], centroids: number[][]): number {
  let inertia = 0;
  for (let i = 0; i < data.length; i++) inertia += distanceSquared(data[i], centroids[clusters[i]]);
  return inertia;
}

function randomIndices(n: number, k: number): number[] {
  const indices = new Set<number>();
  while (indices.size < k) indices.add(Math.floor(Math.random() * n));
  return Array.from(indices);
}

function kMeansClustering(data: number[][], k: number, maxIterations: number = 100): { clusters: number[]; centroids: number[][] } {
  if (data.length === 0) return { clusters: [], centroids: [] };
  if (k <= 0) throw new Error('k must be positive');
  const effectiveK = Math.min(k, data.length);
  const dims = data[0].length;
  const NUM_RESTARTS = 3;

  let bestClusters: number[] = [];
  let bestCentroids: number[][] = [];
  let bestInertia = Infinity;

  for (let restart = 0; restart < NUM_RESTARTS; restart++) {
    const initIndices = randomIndices(data.length, effectiveK);
    let centroids = initIndices.map((i) => [...data[i]]);
    let clusters = assignClusters(data, centroids);

    for (let iter = 0; iter < maxIterations; iter++) {
      const newCentroids = recomputeCentroids(data, clusters, effectiveK, dims);
      const newClusters = assignClusters(data, newCentroids);
      let converged = true;
      for (let i = 0; i < newClusters.length; i++) {
        if (newClusters[i] !== clusters[i]) { converged = false; break; }
      }
      centroids = newCentroids;
      clusters = newClusters;
      if (converged) break;
    }

    const inertia = computeInertia(data, clusters, centroids);
    if (inertia < bestInertia) {
      bestInertia = inertia;
      bestClusters = clusters;
      bestCentroids = centroids;
    }
  }

  return { clusters: bestClusters, centroids: bestCentroids };
}

function findOptimalK(data: number[][], maxK?: number): number {
  if (data.length <= 2) return 1;
  const minK = data.length >= 6 ? 3 : 2;
  const effectiveMaxK = maxK ?? Math.min(8, Math.max(minK + 1, Math.floor(data.length / 2)));
  if (effectiveMaxK <= 1) return 1;

  const inertias: number[] = [];
  for (let k = 1; k <= effectiveMaxK; k++) {
    const { clusters, centroids } = kMeansClustering(data, k);
    inertias.push(computeInertia(data, clusters, centroids));
  }

  let bestElbowIdx = minK - 1;
  let bestSecondDeriv = -Infinity;
  for (let i = 1; i < inertias.length - 1; i++) {
    const sd = inertias[i - 1] - 2 * inertias[i] + inertias[i + 1];
    if (sd > bestSecondDeriv) { bestSecondDeriv = sd; bestElbowIdx = i; }
  }

  return Math.max(minK, bestElbowIdx + 1);
}

function computeBetweennessCentrality(similarityMatrix: number[][], threshold: number = 0.5): number[] {
  const n = similarityMatrix.length;
  if (n === 0) return [];

  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (similarityMatrix[i][j] >= threshold) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }

  const centrality = new Array<number>(n).fill(0);

  for (let s = 0; s < n; s++) {
    const stack: number[] = [];
    const predecessors: number[][] = Array.from({ length: n }, () => []);
    const sigma = new Array<number>(n).fill(0);
    const dist = new Array<number>(n).fill(-1);
    const delta = new Array<number>(n).fill(0);

    sigma[s] = 1;
    dist[s] = 0;
    const queue: number[] = [s];
    let head = 0;

    while (head < queue.length) {
      const v = queue[head++];
      stack.push(v);
      for (const w of adj[v]) {
        if (dist[w] < 0) { dist[w] = dist[v] + 1; queue.push(w); }
        if (dist[w] === dist[v] + 1) { sigma[w] += sigma[v]; predecessors[w].push(v); }
      }
    }

    while (stack.length > 0) {
      const w = stack.pop()!;
      for (const v of predecessors[w]) delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
      if (w !== s) centrality[w] += delta[w];
    }
  }

  for (let i = 0; i < n; i++) centrality[i] /= 2;
  return centrality;
}

interface BridgeContact { id: string; name: string; role: string; company: string; centralityScore: number; }
interface MistralBatchResult {
  recurrentNeeds: string[];
  immediateSynergies: {
    contactId1: string; contactName1: string; contactId2: string; contactName2: string;
    reason: string; confidence?: 'high' | 'medium' | 'low'; evidence?: string;
  }[];
  keyCompetencies: string[];
}
interface TopologyBatch { contactIds: string[]; clusterId: string | null; contactIdsHash: string | null; cached: MistralBatchResult | null; }

const MIN_MAP_BATCH = 15;
const MAX_MAP_BATCH = 30;
// Above this fraction of contacts changed/new since the last clustering run
// for this scope, a full re-cluster is worth the cost (incremental nearest-
// centroid assignment would otherwise drift too far from an optimal split).
const FULL_RECLUSTER_THRESHOLD = 0.4;

// ── Enrichment gate ─────────────────────────────────────────────────────
// A contact carrying nothing but a name is pure noise for synergy detection:
// the model can only hallucinate a role/need/synergy for it (that's the
// source of "un profil pertinent dans le réseau (ex: …)" and invented value
// chains). A contact is analyzable only if it exposes at least ONE real
// signal beyond its name. Same rule lives in supply-demand.ts — keep them in
// sync (no cross-file import inside api/ on purpose).
function hasText(v: any): boolean {
  return typeof v === 'string' && v.trim().length > 0 && v.trim().toLowerCase() !== 'null';
}
function hasArray(v: any): boolean {
  return Array.isArray(v) && v.some((x: any) => x && String(x).trim() && String(x).trim().toLowerCase() !== 'null');
}
function isAnalyzableContact(c: any, noteCountById: Map<string, number>): boolean {
  return hasText(c.job_title)
    || hasText(c.company)
    || hasText(c.bio)
    || hasArray(c.skills)
    || hasArray(c.inferred_needs)
    || (noteCountById.get(c.id) || 0) > 0;
}

function chunkNaive(contactIds: string[], size: number = 25): TopologyBatch[] {
  const batches: TopologyBatch[] = [];
  for (let i = 0; i < contactIds.length; i += size) {
    batches.push({ contactIds: contactIds.slice(i, i + size), clusterId: null, contactIdsHash: null, cached: null });
  }
  return batches;
}

function packClusterIdsIntoGroups(clusterGroups: string[][]): string[][] {
  const batches: string[][] = [];
  let buffer: string[] = [];

  for (const group of clusterGroups) {
    let idx = 0;
    while (idx < group.length) {
      const space = MAX_MAP_BATCH - buffer.length;
      const slice = group.slice(idx, idx + space);
      buffer.push(...slice);
      idx += slice.length;
      if (buffer.length >= MAX_MAP_BATCH) { batches.push(buffer); buffer = []; }
    }
  }

  if (buffer.length > 0) {
    if (batches.length > 0 && buffer.length < MIN_MAP_BATCH) {
      batches[batches.length - 1] = batches[batches.length - 1].concat(buffer);
    } else {
      batches.push(buffer);
    }
  }

  return batches;
}

async function computeEmbeddings(client: Mistral, contacts: any[], notes: any[]): Promise<{ contactId: string; vector: number[] }[]> {
  const BATCH_SIZE = 20;
  const batches: any[][] = [];
  for (let i = 0; i < contacts.length; i += BATCH_SIZE) batches.push(contacts.slice(i, i + BATCH_SIZE));

  // Fired concurrently rather than awaited one at a time — on a large/merged
  // network with many contacts needing a fresh embedding (a new scope starts
  // with an empty cache), a sequential loop of N Mistral calls could exceed
  // this function's execution budget on its own, even though each individual
  // call is fast. Concurrent requests turn N sequential round-trips into one
  // wall-clock round-trip (bounded by Mistral's own rate limiting, not ours).
  const batchResults = await Promise.all(batches.map(async (batch) => {
    const inputs = batch.map(c => {
      const contactNotes = notes.filter((n: any) => n.contact_id === c.id).map((n: any) => n.content).join(' ');
      const skills = Array.isArray(c.skills) ? c.skills.join(', ') : '';
      const needs = Array.isArray(c.inferred_needs) ? c.inferred_needs.join(', ') : '';
      // Skills & needs carry the complementarity signal (who needs what / who
      // offers what) — omitting them made clustering group on job title alone,
      // scattering genuinely complementary contacts into separate batches.
      return `Profil: ${c.first_name} ${c.last_name || ''}, Role: ${c.job_title}, Entreprise: ${c.company}. Compétences: ${skills}. Besoins: ${needs}. Notes: ${contactNotes}`.substring(0, 8000);
    });
    try {
      const embedResponse = await client.embeddings.create({ model: 'mistral-embed', inputs });
      return embedResponse.data.map((d, idx) => ({ contactId: batch[idx].id, vector: d.embedding as number[] }));
    } catch (err) {
      console.error('Mistral embeddings error:', err);
      return [];
    }
  }));

  return batchResults.flat();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const auth = await authenticateRequest(req);
    if (!auth) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) { res.status(500).json({ error: 'Mistral API key is not configured on the server' }); return; }

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) { res.status(500).json({ error: 'Supabase is not configured on the server' }); return; }

    const { spaceId } = req.body || {};
    const scopeKey: string = spaceId || `user:${auth.userId}`;

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${auth.token}` } }
    });

    let contactsQuery = userSupabase.from('contacts').select('id, first_name, last_name, job_title, company, bio, skills, inferred_needs, space_id').order('first_name');
    if (spaceId) contactsQuery = contactsQuery.eq('space_id', spaceId);
    const { data: rawContacts, error: contactsError } = await contactsQuery;
    if (contactsError) {
      console.error('Oracle topology: contacts fetch failed', contactsError);
      res.status(500).json({ error: contactsError.message });
      return;
    }

    if (!rawContacts || rawContacts.length === 0) {
      res.status(200).json({ batches: [], bridgeContacts: [], lockedContactNames: [], analyzedCount: 0, excludedCount: 0, excludedContacts: [] });
      return;
    }

    // Apply the enrichment gate before anything else — notes are fetched up
    // front (they're one of the signals that make a contact analyzable) and
    // reused for hashing/embedding below.
    const rawContactIds = rawContacts.map(c => c.id);
    const { data: allNotes, error: allNotesError } = await selectInChunks<any>(
      chunk => userSupabase.from('notes').select('*').in('contact_id', chunk),
      rawContactIds
    );
    if (allNotesError) {
      // Non-fatal by design (a contact with unreadable notes just falls back
      // to its other signals) but MUST be logged — silently swallowing this
      // used to make a real fetch failure indistinguishable from "nobody has
      // notes," which then wrongly excluded contacts as unanalyzable.
      console.error('Oracle topology: notes fetch failed, continuing without notes', allNotesError);
    }
    const noteCountById = new Map<string, number>();
    (allNotes || []).forEach((n: any) => noteCountById.set(n.contact_id, (noteCountById.get(n.contact_id) || 0) + 1));

    const contacts = rawContacts.filter(c => isAnalyzableContact(c, noteCountById));
    const excludedCount = rawContacts.length - contacts.length;
    // Capped so the response stays light even on a sparsely-enriched
    // network with hundreds of excluded contacts — the UI only needs
    // enough of a shortlist to point the user at who to enrich next.
    const excludedContacts = rawContacts
      .filter(c => !isAnalyzableContact(c, noteCountById))
      .slice(0, 300)
      .map(c => ({ id: c.id, name: `${c.first_name} ${c.last_name || ''}`.trim() }));

    if (contacts.length === 0) {
      res.status(200).json({ batches: [], bridgeContacts: [], lockedContactNames: [], analyzedCount: 0, excludedCount, excludedContacts });
      return;
    }

    const contactIds = contacts.map(c => c.id);

    const { data: visibility, error: visibilityError } = await selectInChunks<any>(
      chunk => userSupabase.from('contacts_visible').select('id, is_unlocked').in('id', chunk),
      contactIds
    );
    if (visibilityError) {
      console.error('Oracle topology: visibility fetch failed', visibilityError);
      res.status(500).json({ error: visibilityError.message });
      return;
    }

    const visibleIds = new Set((visibility || []).filter(v => v.is_unlocked).map(v => v.id));
    const isLocked = (id?: string) => Boolean(id) && !visibleIds.has(id as string);
    const lockedContactNames = contacts.filter(c => !visibleIds.has(c.id)).map(c => `${c.first_name} ${c.last_name}`);

    const redactCached = (result: MistralBatchResult): MistralBatchResult => ({
      ...result,
      immediateSynergies: result.immediateSynergies.map(s => {
        if (isLocked(s.contactId1) || isLocked(s.contactId2)) {
          // "evidence" quotes a locked contact's note/skill verbatim — must be
          // masked here too, not just "reason", or the redaction is a leak.
          return { ...s, reason: "Synergie potentielle détectée — demandez l'accès aux contacts concernés pour voir les détails.", evidence: '' };
        }
        return s;
      })
    });

    if (contacts.length < 6) {
      res.status(200).json({ batches: chunkNaive(contactIds), bridgeContacts: [], lockedContactNames, analyzedCount: contacts.length, excludedCount, excludedContacts });
      return;
    }

    const notesList = allNotes || [];

    const hashByContactId = new Map<string, string>();
    contacts.forEach(c => hashByContactId.set(c.id, contactContentHash(c, notesList)));

    // ── Incremental embedding cache ──────────────────────────────────────
    // Best-effort: if the cache tables don't exist yet (migration not
    // applied), every read below returns an error we swallow, and every
    // contact is simply treated as "needs a fresh embedding" — identical to
    // the pre-incremental behavior, just without the speedup.
    let cachedEmbeddings = new Map<string, { vector: number[]; clusterId: string | null }>();
    try {
      const { data: cacheRows, error: cacheRowsError } = await selectInChunks<any>(
        chunk => userSupabase.from('contact_embeddings').select('contact_id, content_hash, embedding, cluster_id').in('contact_id', chunk),
        contactIds
      );
      if (cacheRowsError) throw cacheRowsError;
      (cacheRows || []).forEach((row: any) => {
        if (row.content_hash === hashByContactId.get(row.contact_id)) {
          cachedEmbeddings.set(row.contact_id, { vector: row.embedding as number[], clusterId: row.cluster_id });
        }
      });
    } catch (err) {
      console.warn('topology: contact_embeddings cache unavailable, falling back to full recompute.', err);
    }

    const contactById = new Map(contacts.map(c => [c.id, c]));
    const needsEmbedding = contacts.filter(c => !cachedEmbeddings.has(c.id));

    const client = new Mistral({ apiKey });
    let freshEmbeddings: { contactId: string; vector: number[] }[] = [];
    if (needsEmbedding.length > 0) {
      try {
        freshEmbeddings = await computeEmbeddings(client, needsEmbedding, notesList);
      } catch (err) {
        console.error('topology: embedding failure, falling back to naive batching.', err);
        res.status(200).json({ batches: chunkNaive(contactIds), bridgeContacts: [], lockedContactNames, analyzedCount: contacts.length, excludedCount, excludedContacts });
        return;
      }
    }

    // Persist freshly computed embeddings (best-effort — see above).
    if (freshEmbeddings.length > 0) {
      try {
        const rows = freshEmbeddings.map(e => ({
          contact_id: e.contactId,
          space_id: contactById.get(e.contactId)?.space_id,
          content_hash: hashByContactId.get(e.contactId),
          embedding: e.vector,
          updated_at: new Date().toISOString()
        }));
        await userSupabase.from('contact_embeddings').upsert(rows, { onConflict: 'contact_id' });
      } catch (err) {
        console.warn('topology: failed to persist contact_embeddings (non-fatal).', err);
      }
    }

    // Combined embedding map (cached + fresh) for every contact we could embed.
    const embeddingByContactId = new Map<string, number[]>();
    cachedEmbeddings.forEach((v, k) => embeddingByContactId.set(k, v.vector));
    freshEmbeddings.forEach(e => embeddingByContactId.set(e.contactId, e.vector));

    if (embeddingByContactId.size < 6) {
      res.status(200).json({ batches: chunkNaive(contactIds), bridgeContacts: [], lockedContactNames, analyzedCount: contacts.length, excludedCount, excludedContacts });
      return;
    }

    const embeddedIds = contactIds.filter(id => embeddingByContactId.has(id));
    const vectors = embeddedIds.map(id => embeddingByContactId.get(id)!);

    let bridgeContacts: BridgeContact[] = [];
    try {
      const similarityMatrix = buildSimilarityMatrix(vectors);
      const centrality = computeBetweennessCentrality(similarityMatrix, 0.5);
      const maxCentrality = Math.max(...centrality, 0);
      if (maxCentrality > 0) {
        bridgeContacts = embeddedIds
          .map((id, idx) => ({ id, score: centrality[idx] }))
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 6)
          .map(({ id, score }) => {
            const c = contactById.get(id);
            const locked = isLocked(id);
            return {
              id,
              name: `${c?.first_name || ''} ${c?.last_name || ''}`.trim(),
              role: locked ? 'Verrouillé' : (c?.job_title || 'Inconnu'),
              company: locked ? 'Verrouillé' : (c?.company || 'Inconnue'),
              centralityScore: Math.round((score / maxCentrality) * 100) / 100
            };
          });
      }
    } catch (err) {
      console.error('topology: bridge-contact computation failure (non-fatal).', err);
    }

    // ── Incremental clustering ───────────────────────────────────────────
    let clusterOf = new Map<string, string>(); // contactId -> cluster row id (uuid string)
    let clusterCacheAvailable = true;

    try {
      const { data: existingClusters, error: clustersError } = await userSupabase
        .from('oracle_clusters')
        .select('id, centroid')
        .eq('scope_key', scopeKey);
      if (clustersError) throw clustersError;

      const changedCount = embeddedIds.filter(id => !cachedEmbeddings.has(id)).length;
      const changedRatio = embeddedIds.length > 0 ? changedCount / embeddedIds.length : 1;
      const forceFullRecluster = !existingClusters || existingClusters.length === 0 || changedRatio > FULL_RECLUSTER_THRESHOLD;

      if (forceFullRecluster) {
        const k = findOptimalK(vectors);
        const { clusters, centroids } = kMeansClustering(vectors, k);

        // Replace this scope's cluster set atomically-ish: delete then reinsert.
        // Cascades to oracle_batch_cache (every cluster's cache is invalidated —
        // correct, since cluster membership itself just changed wholesale).
        await userSupabase.from('oracle_clusters').delete().eq('scope_key', scopeKey);

        const newClusterRows = centroids.map(centroid => ({
          owner_id: auth.userId,
          space_id: spaceId || null,
          scope_key: scopeKey,
          centroid,
          updated_at: new Date().toISOString()
        }));
        const { data: inserted, error: insertError } = await userSupabase
          .from('oracle_clusters')
          .insert(newClusterRows)
          .select('id');
        if (insertError) throw insertError;

        const clusterIds = (inserted || []).map(r => r.id as string);
        embeddedIds.forEach((id, idx) => {
          const clusterIdx = clusters[idx];
          const clusterId = clusterIds[clusterIdx];
          if (clusterId) clusterOf.set(id, clusterId);
        });
      } else {
        const centroidRows = existingClusters as { id: string; centroid: number[] }[];
        // Keep every contact whose embedding is unchanged (and already has a
        // cluster) exactly where it was — this is what keeps most clusters'
        // contact sets stable across runs, so their MAP cache stays valid.
        embeddedIds.forEach(id => {
          const cached = cachedEmbeddings.get(id);
          if (cached?.clusterId && centroidRows.some(c => c.id === cached.clusterId)) {
            clusterOf.set(id, cached.clusterId);
          }
        });
        // New/changed contacts: assign to the nearest existing centroid.
        embeddedIds.forEach(id => {
          if (clusterOf.has(id)) return;
          const vec = embeddingByContactId.get(id)!;
          let bestId: string | null = null;
          let bestDist = Infinity;
          for (const c of centroidRows) {
            const d = distanceSquared(vec, c.centroid);
            if (d < bestDist) { bestDist = d; bestId = c.id; }
          }
          if (bestId) clusterOf.set(id, bestId);
        });
      }

      // Persist the final cluster_id assignment for every contact we touched.
      const assignmentRows = embeddedIds
        .filter(id => clusterOf.has(id))
        .map(id => ({
          contact_id: id,
          space_id: contactById.get(id)?.space_id,
          content_hash: hashByContactId.get(id),
          embedding: embeddingByContactId.get(id),
          cluster_id: clusterOf.get(id),
          updated_at: new Date().toISOString()
        }));
      if (assignmentRows.length > 0) {
        await userSupabase.from('contact_embeddings').upsert(assignmentRows, { onConflict: 'contact_id' });
      }
    } catch (err) {
      console.warn('topology: cluster persistence unavailable, falling back to one-shot clustering (non-fatal).', err);
      clusterCacheAvailable = false;
      try {
        const k = findOptimalK(vectors);
        const { clusters } = kMeansClustering(vectors, k);
        embeddedIds.forEach((id, idx) => clusterOf.set(id, `local-${clusters[idx]}`));
      } catch (clusterErr) {
        console.error('topology: clustering failure, falling back to a single naive group.', clusterErr);
        clusterOf = new Map(embeddedIds.map(id => [id, 'local-0']));
      }
    }

    // Group contacts by final cluster assignment.
    const groupsByCluster = new Map<string, string[]>();
    embeddedIds.forEach(id => {
      const clusterId = clusterOf.get(id);
      if (!clusterId) return;
      if (!groupsByCluster.has(clusterId)) groupsByCluster.set(clusterId, []);
      groupsByCluster.get(clusterId)!.push(id);
    });

    const unembedded = contactIds.filter(id => !embeddingByContactId.has(id));

    // ── Per-cluster MAP result cache ─────────────────────────────────────
    let cachedResults = new Map<string, { result: MistralBatchResult; hash: string }>();
    if (clusterCacheAvailable && groupsByCluster.size > 0) {
      try {
        const clusterIds = Array.from(groupsByCluster.keys());
        const { data: batchCacheRows } = await userSupabase
          .from('oracle_batch_cache')
          .select('cluster_id, contact_ids_hash, result')
          .in('cluster_id', clusterIds);
        (batchCacheRows || []).forEach((row: any) => {
          cachedResults.set(row.cluster_id, { result: row.result as MistralBatchResult, hash: row.contact_ids_hash });
        });
      } catch (err) {
        console.warn('topology: oracle_batch_cache unavailable (non-fatal).', err);
      }
    }

    // Groups that are too small to be their own MAP batch get packed together
    // with others below MIN_MAP_BATCH — those packed batches are never cached
    // (their membership isn't a single stable cluster), same as unembedded
    // contacts. Only groups that survive as their OWN batch 1:1 are cacheable.
    const clusterGroupEntries = Array.from(groupsByCluster.entries());
    const clusterContactGroups = clusterGroupEntries.map(([, ids]) => ids);
    if (unembedded.length > 0) clusterContactGroups.push(unembedded);
    const packedGroups = packClusterIdsIntoGroups(clusterContactGroups);

    const batches: TopologyBatch[] = packedGroups.map(group => {
      // Only treat this as a cacheable single-cluster batch if it wasn't
      // merged/split by the packing step (exact membership match).
      const matchingEntry = clusterGroupEntries.find(([, ids]) => ids.length === group.length && ids.every(id => group.includes(id)));
      if (!matchingEntry) {
        return { contactIds: group, clusterId: null, contactIdsHash: null, cached: null };
      }
      const [clusterId] = matchingEntry;
      const contactIdsHash = clusterContactsHash(group, hashByContactId);
      const cacheEntry = cachedResults.get(clusterId);
      const cached = cacheEntry && cacheEntry.hash === contactIdsHash ? redactCached(cacheEntry.result) : null;
      return { contactIds: group, clusterId, contactIdsHash, cached };
    });

    res.status(200).json({ batches, bridgeContacts, lockedContactNames, analyzedCount: contacts.length, excludedCount, excludedContacts });
  } catch (err: any) {
    console.error('Oracle topology failure:', err);
    res.status(500).json({ error: err.message || 'Oracle topology failed' });
  }
}
