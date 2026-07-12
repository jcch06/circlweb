/**
 * vectorMath.ts — Pure TypeScript vector math utilities for Oracle IA V3.
 * No external dependencies. All functions are pure and deterministic
 * (except for k-means random initialization).
 */

/**
 * Compute the cosine similarity between two vectors.
 * Returns a value in [0, 1] (clamped — raw cosine is in [-1, 1]).
 *
 * @param a - First vector
 * @param b - Second vector (must be same length as `a`)
 * @returns Cosine similarity clamped to [0, 1]
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vector length mismatch: ${a.length} vs ${b.length}`
    );
  }
  if (a.length === 0) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, dot / denom));
}

/**
 * Build an N×N similarity matrix from N embedding vectors.
 * Each cell [i][j] is the cosine similarity between embeddings[i] and embeddings[j].
 * The matrix is symmetric with 1s on the diagonal.
 *
 * @param embeddings - Array of N embedding vectors (each the same length)
 * @returns N×N similarity matrix
 */
export function buildSimilarityMatrix(embeddings: number[][]): number[][] {
  const n = embeddings.length;
  const matrix: number[][] = Array.from({ length: n }, () =>
    new Array<number>(n).fill(0)
  );

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1; // Self-similarity is always 1
    for (let j = i + 1; j < n; j++) {
      const sim = cosineSimilarity(embeddings[i], embeddings[j]);
      matrix[i][j] = sim;
      matrix[j][i] = sim;
    }
  }

  return matrix;
}

// ─── Internal helpers for k-means ────────────────────────────────────────────

/** Euclidean distance squared (avoids sqrt for comparison). */
function distanceSquared(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum;
}

/** Assign each data point to the nearest centroid. */
function assignClusters(data: number[][], centroids: number[][]): number[] {
  return data.map((point) => {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let c = 0; c < centroids.length; c++) {
      const d = distanceSquared(point, centroids[c]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = c;
      }
    }
    return bestIdx;
  });
}

/** Recompute centroids as the mean of assigned points. */
function recomputeCentroids(
  data: number[][],
  clusters: number[],
  k: number,
  dims: number
): number[][] {
  const sums: number[][] = Array.from({ length: k }, () =>
    new Array<number>(dims).fill(0)
  );
  const counts = new Array<number>(k).fill(0);

  for (let i = 0; i < data.length; i++) {
    const c = clusters[i];
    counts[c]++;
    for (let d = 0; d < dims; d++) {
      sums[c][d] += data[i][d];
    }
  }

  return sums.map((sum, idx) => {
    if (counts[idx] === 0) {
      // Empty cluster — reinitialize to a random data point
      return [...data[Math.floor(Math.random() * data.length)]];
    }
    return sum.map((v) => v / counts[idx]);
  });
}

/** Compute total within-cluster sum of squared distances (WCSS / inertia). */
function computeInertia(
  data: number[][],
  clusters: number[],
  centroids: number[][]
): number {
  let inertia = 0;
  for (let i = 0; i < data.length; i++) {
    inertia += distanceSquared(data[i], centroids[clusters[i]]);
  }
  return inertia;
}

/** Pick k distinct random indices from [0, n). */
function randomIndices(n: number, k: number): number[] {
  const indices = new Set<number>();
  while (indices.size < k) {
    indices.add(Math.floor(Math.random() * n));
  }
  return Array.from(indices);
}

/**
 * K-means clustering with random initialization and multiple restarts.
 * Picks the run with the lowest inertia (within-cluster sum of squares).
 *
 * @param data - Array of N data points (vectors of equal length)
 * @param k - Number of clusters
 * @param maxIterations - Maximum iterations per run (default 100)
 * @returns Object with `clusters` (assignment array) and `centroids`
 */
export function kMeansClustering(
  data: number[][],
  k: number,
  maxIterations: number = 100
): { clusters: number[]; centroids: number[][] } {
  if (data.length === 0) {
    return { clusters: [], centroids: [] };
  }
  if (k <= 0) {
    throw new Error('k must be positive');
  }
  // Clamp k to data size
  const effectiveK = Math.min(k, data.length);
  const dims = data[0].length;
  const NUM_RESTARTS = 3;

  let bestClusters: number[] = [];
  let bestCentroids: number[][] = [];
  let bestInertia = Infinity;

  for (let restart = 0; restart < NUM_RESTARTS; restart++) {
    // Random initialization: pick k distinct data points as initial centroids
    const initIndices = randomIndices(data.length, effectiveK);
    let centroids = initIndices.map((i) => [...data[i]]);
    let clusters = assignClusters(data, centroids);

    for (let iter = 0; iter < maxIterations; iter++) {
      const newCentroids = recomputeCentroids(data, clusters, effectiveK, dims);
      const newClusters = assignClusters(data, newCentroids);

      // Check for convergence
      let converged = true;
      for (let i = 0; i < newClusters.length; i++) {
        if (newClusters[i] !== clusters[i]) {
          converged = false;
          break;
        }
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

/**
 * Find the optimal number of clusters using the Elbow method.
 * Computes WCSS for k = 1..maxK and selects the k with the largest
 * second-derivative (biggest "elbow" / drop-off in improvement).
 *
 * @param data - Array of N data points
 * @param maxK - Maximum k to try (default: min(8, floor(data.length / 2)))
 * @returns The optimal k value (at least 1)
 */
export function findOptimalK(data: number[][], maxK?: number): number {
  if (data.length <= 2) return 1;

  const effectiveMaxK = maxK ?? Math.min(8, Math.floor(data.length / 2));
  if (effectiveMaxK <= 1) return 1;

  const inertias: number[] = [];

  for (let k = 1; k <= effectiveMaxK; k++) {
    const { clusters, centroids } = kMeansClustering(data, k);
    inertias.push(computeInertia(data, clusters, centroids));
  }

  // Find the elbow: the k where the second derivative is maximized.
  // secondDerivative[i] = inertias[i-1] - 2*inertias[i] + inertias[i+1]
  // This is defined for i in [1, effectiveMaxK - 2] (0-indexed).
  let bestElbowIdx = 0; // 0-indexed into inertias, so k = bestElbowIdx + 1
  let bestSecondDeriv = -Infinity;

  for (let i = 1; i < inertias.length - 1; i++) {
    const sd = inertias[i - 1] - 2 * inertias[i] + inertias[i + 1];
    if (sd > bestSecondDeriv) {
      bestSecondDeriv = sd;
      bestElbowIdx = i;
    }
  }

  // k is 1-indexed
  return bestElbowIdx + 1;
}

// ─── Betweenness Centrality ──────────────────────────────────────────────────

/**
 * Compute betweenness centrality for each node in a similarity graph.
 *
 * Edges with similarity below `threshold` are excluded.
 * Uses Brandes' algorithm for unweighted BFS-based betweenness.
 *
 * @param similarityMatrix - N×N similarity matrix (values in [0, 1])
 * @param threshold - Minimum similarity to form an edge (default 0.5)
 * @returns Array of N centrality scores (higher = more central / bridge node)
 */
export function computeBetweennessCentrality(
  similarityMatrix: number[][],
  threshold: number = 0.5
): number[] {
  const n = similarityMatrix.length;
  if (n === 0) return [];

  // Build adjacency list from thresholded similarity matrix
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

  // Brandes' algorithm
  for (let s = 0; s < n; s++) {
    // BFS from source s
    const stack: number[] = [];
    const predecessors: number[][] = Array.from({ length: n }, () => []);
    const sigma = new Array<number>(n).fill(0); // # of shortest paths
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
        // First visit?
        if (dist[w] < 0) {
          dist[w] = dist[v] + 1;
          queue.push(w);
        }
        // Shortest path via v?
        if (dist[w] === dist[v] + 1) {
          sigma[w] += sigma[v];
          predecessors[w].push(v);
        }
      }
    }

    // Back-propagation
    while (stack.length > 0) {
      const w = stack.pop()!;
      for (const v of predecessors[w]) {
        delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
      }
      if (w !== s) {
        centrality[w] += delta[w];
      }
    }
  }

  // Normalize: for undirected graphs, each pair is counted twice
  for (let i = 0; i < n; i++) {
    centrality[i] /= 2;
  }

  return centrality;
}
