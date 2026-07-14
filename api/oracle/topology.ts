import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Mistral } from '@mistralai/mistralai';
import { createClient } from '@supabase/supabase-js';

// Step 1/4 of the Oracle pipeline (see api/oracle/map-batch.ts, reduce.ts,
// supply-demand.ts). Split into short calls, each well under any Vercel
// plan's timeout, orchestrated from the client — a single do-everything
// function (the original design) hit 504s in production because a full
// pipeline is several sequential Mistral Large calls.
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

const MIN_MAP_BATCH = 15;
const MAX_MAP_BATCH = 30;

function chunkNaive(contactIds: string[], size: number = 25): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < contactIds.length; i += size) batches.push(contactIds.slice(i, i + size));
  return batches;
}

function packClustersIntoBatches(clusterGroups: string[][]): string[][] {
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
  const results: { contactId: string; vector: number[] }[] = [];
  const BATCH_SIZE = 20;

  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);
    const inputs = batch.map(c => {
      const contactNotes = notes.filter((n: any) => n.contact_id === c.id).map((n: any) => n.content).join(' ');
      return `Profil: ${c.first_name}, Role: ${c.job_title}, Entreprise: ${c.company}. Notes: ${contactNotes}`.substring(0, 8000);
    });
    try {
      const embedResponse = await client.embeddings.create({ model: 'mistral-embed', inputs });
      embedResponse.data.forEach((d, idx) => {
        results.push({ contactId: batch[idx].id, vector: d.embedding as number[] });
      });
    } catch (err) {
      console.error('Mistral embeddings error:', err);
    }
  }

  return results;
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

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${auth.token}` } }
    });

    let contactsQuery = userSupabase.from('contacts').select('id, first_name, last_name, job_title, company').order('first_name');
    if (spaceId) contactsQuery = contactsQuery.eq('space_id', spaceId);
    const { data: contacts, error: contactsError } = await contactsQuery;
    if (contactsError) { res.status(500).json({ error: contactsError.message }); return; }

    if (!contacts || contacts.length === 0) {
      res.status(200).json({ batches: [], bridgeContacts: [], lockedContactNames: [] });
      return;
    }

    const contactIds = contacts.map(c => c.id);

    const { data: visibility, error: visibilityError } = await userSupabase
      .from('contacts_visible')
      .select('id, is_unlocked')
      .in('id', contactIds);
    if (visibilityError) { res.status(500).json({ error: visibilityError.message }); return; }

    const visibleIds = new Set((visibility || []).filter(v => v.is_unlocked).map(v => v.id));
    const lockedContactNames = contacts.filter(c => !visibleIds.has(c.id)).map(c => `${c.first_name} ${c.last_name}`);

    if (contacts.length < 6) {
      res.status(200).json({ batches: chunkNaive(contactIds), bridgeContacts: [], lockedContactNames });
      return;
    }

    const { data: notes } = await userSupabase.from('notes').select('*').in('contact_id', contactIds);

    const client = new Mistral({ apiKey });
    let embeddings: { contactId: string; vector: number[] }[] = [];
    try {
      embeddings = await computeEmbeddings(client, contacts, notes || []);
    } catch (err) {
      console.error('topology: embedding failure, falling back to naive batching.', err);
      res.status(200).json({ batches: chunkNaive(contactIds), bridgeContacts: [], lockedContactNames });
      return;
    }

    if (embeddings.length < 6) {
      res.status(200).json({ batches: chunkNaive(contactIds), bridgeContacts: [], lockedContactNames });
      return;
    }

    const embeddedIds = new Set(embeddings.map(e => e.contactId));
    const contactById = new Map(contacts.map(c => [c.id, c]));
    const vectors = embeddings.map(e => e.vector);

    let clusterGroups: string[][];
    let bridgeContacts: BridgeContact[] = [];

    try {
      const k = findOptimalK(vectors);
      const { clusters } = kMeansClustering(vectors, k);

      const groupsById = new Map<number, string[]>();
      embeddings.forEach((e, idx) => {
        const clusterId = clusters[idx];
        if (!contactById.has(e.contactId)) return;
        if (!groupsById.has(clusterId)) groupsById.set(clusterId, []);
        groupsById.get(clusterId)!.push(e.contactId);
      });
      clusterGroups = Array.from(groupsById.values());

      const similarityMatrix = buildSimilarityMatrix(vectors);
      const centrality = computeBetweennessCentrality(similarityMatrix, 0.5);
      const maxCentrality = Math.max(...centrality, 0);

      if (maxCentrality > 0) {
        bridgeContacts = embeddings
          .map((e, idx) => ({ e, score: centrality[idx] }))
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 6)
          .map(({ e, score }) => {
            const c = contactById.get(e.contactId);
            const isLocked = !visibleIds.has(e.contactId);
            return {
              id: e.contactId,
              name: `${c?.first_name || ''} ${c?.last_name || ''}`.trim(),
              role: isLocked ? 'Verrouillé' : (c?.job_title || 'Inconnu'),
              company: isLocked ? 'Verrouillé' : (c?.company || 'Inconnue'),
              centralityScore: Math.round((score / maxCentrality) * 100) / 100
            };
          });
      }
    } catch (err) {
      console.error('topology: clustering failure, falling back to a single naive group.', err);
      clusterGroups = [contactIds.filter(id => embeddedIds.has(id))];
    }

    const unembedded = contactIds.filter(id => !embeddedIds.has(id));
    if (unembedded.length > 0) clusterGroups.push(unembedded);

    res.status(200).json({ batches: packClustersIntoBatches(clusterGroups), bridgeContacts, lockedContactNames });
  } catch (err: any) {
    console.error('Oracle topology failure:', err);
    res.status(500).json({ error: err.message || 'Oracle topology failed' });
  }
}
