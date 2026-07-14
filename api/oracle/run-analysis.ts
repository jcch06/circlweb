import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Mistral } from '@mistralai/mistralai';
import { createClient } from '@supabase/supabase-js';

// Vercel serverless functions default to a short timeout — a full Map-Reduce
// pipeline (embeddings + several sequential Mistral Large calls) needs more
// room. 300s is the max on Pro/Team plans; Hobby caps lower. Adjust if your
// plan's limit differs, or split large networks into smaller spaces.
export const config = {
  maxDuration: 300
};

// ============================================================================
// This entire pipeline runs server-side, fetching FULL (unmasked) contact
// data using the caller's own JWT (so row-level RLS/space-membership still
// applies — this is NOT a service-role bypass), so cross-network synergy
// detection keeps its full analytical power even when some contacts are
// locked for the caller. The RESULT is then redacted before it ever reaches
// the client: structured per-contact fields (role/company/reason) for a
// locked contact are stripped with a code-level guarantee; free-text fields
// (summaries, descriptions) rely on an explicit prompt instruction not to
// reveal locked contacts' private details — a best-effort mitigation, not a
// hard guarantee, same caveat as any LLM instruction-following.
//
// Self-contained on purpose (no imports from ../_lib or src/lib): an earlier
// cross-file import inside api/ caused a deployment-only crash that was hard
// to diagnose without live logs. Duplicating ~250 lines of vectorMath here is
// a deliberate trade-off for deployment reliability we've already been
// burned by once.
// ============================================================================

// ─── Auth ────────────────────────────────────────────────────────────────────

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

// ─── Types (mirrors src/lib/mistral.ts) ──────────────────────────────────────

interface MistralBatchResult {
  recurrentNeeds: string[];
  immediateSynergies: { contactId1: string; contactName1: string; contactId2: string; contactName2: string; reason: string }[];
  keyCompetencies: string[];
}

interface MacroNeed { label: string; mergedFrom: string[]; affectedContactsCount: number; priority: 'high' | 'medium' | 'low'; }
interface ValueChainLink { step: number; contactName: string; role: string; contribution: string; }
interface ValueChain { title: string; description: string; chain: ValueChainLink[]; estimatedImpact: string; }

interface MistralGlobalSynthesis {
  globalThemes: string[];
  crossBatchSynergies: { theme: string; description: string; potentialImpact: string }[];
  networkStrength: string;
  recommendedActionPlan: string[];
  macroNeeds: MacroNeed[];
  valueChains: ValueChain[];
  tokenUsage?: { promptTokens: number; candidateTokens: number; totalTokens: number };
}

interface SupplyDemandEntry {
  need: string;
  demanders: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  gapLevel: 'covered' | 'partial' | 'opportunity';
  opportunityForUser: boolean;
}

interface BridgeContact { id: string; name: string; role: string; company: string; centralityScore: number; }

interface MistralPipelineResult {
  batches: MistralBatchResult[];
  synthesis: MistralGlobalSynthesis;
  supplyDemand: SupplyDemandEntry[];
  bridgeContacts: BridgeContact[];
  timestamp: number;
}

// ─── User context prompt (ported verbatim) ───────────────────────────────────

function buildUserContext(userProfile: any): string {
  const name = userProfile?.name || 'Utilisateur';
  const role = userProfile?.role || userProfile?.title || userProfile?.job_title || '';
  const company = userProfile?.company || '';
  const skills: string[] = userProfile?.skills || [];
  const projects = userProfile?.currentProjects || userProfile?.bio || userProfile?.description || '';
  const needs = userProfile?.needs || '';

  const genericAngles = [
    'mise en relation / apport d\'affaires (commission)',
    'consulting & conseil stratégique',
    'freelance & prestations de service',
    'levée de fonds & recherche d\'investisseurs',
    'événementiel & networking (dîners privés, masterclasses)',
    'vente de formations & coaching',
    'création de produits numériques (SaaS, outils, templates)',
    'lobbying & influence politique',
    'recrutement & chasse de talents',
    'partenariats commerciaux & co-entreprises',
    'affiliation & recommandation rémunérée',
    'management de communauté & cercles premium',
    'courtage immobilier & investissement',
    'gestion de patrimoine & conseil financier',
    'relations presse & personal branding'
  ];

  const lines = [
    `## PROFIL DE L'UTILISATEUR — ${name}`,
    role ? `Poste : ${role}` : '',
    company ? `Entreprise : ${company}` : '',
    skills.length > 0 ? `Compétences : ${skills.join(', ')}` : '',
    projects ? `Projets en cours : ${projects}` : '',
    needs ? `Besoins / objectifs déclarés : ${needs}` : ''
  ].filter(Boolean);

  return `${lines.join('\n')}

L'utilisateur veut MONÉTISER et VALORISER son réseau. Angles de valeur à explorer en priorité :
${genericAngles.map((a, i) => `${i + 1}. ${a}`).join('\n')}

ADAPTE ton analyse au profil ci-dessus. Si le poste/les compétences pointent vers un domaine précis (ex : "architecte" → immobilier/urbanisme, "développeur" → consulting tech, "avocat" → conseil juridique, "élu/politique" → influence & coalitions, "dirigeant associatif" → mécénat & partenariats), PRIORISE les opportunités ALIGNÉES avec son expertise et ses objectifs déclarés.`;
}

/** Prompt block telling the model which contacts it must not reveal private details about. */
function buildLockedContext(lockedNames: string[]): string {
  if (lockedNames.length === 0) return '';
  return `\n<locked_contacts>\nCes contacts sont VERROUILLÉS pour l'utilisateur actuel (il n'a pas accès à leurs détails complets) : ${lockedNames.join(', ')}.\nTu PEUX les mentionner par leur nom s'ils sont impliqués dans une synergie ou une chaîne de valeur, mais tu ne dois JAMAIS révéler leur poste, leur entreprise, ni aucun détail tiré de leurs notes privées. Utilise une formulation générique du type "un profil pertinent dans le réseau" pour justifier leur implication.\n</locked_contacts>\n`;
}

// ─── Mistral calls (SDK direct — already server-side, no need to proxy through api/ai/*) ───

const MAP_REDUCE_MODEL = 'mistral-large-latest';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function callMistralServer(client: Mistral, prompt: string, model: string = MAP_REDUCE_MODEL): Promise<string> {
  let retries = 3;
  let lastError: any = null;

  while (retries > 0) {
    try {
      const response = await client.chat.complete({
        model,
        messages: [{ role: 'user', content: prompt }],
        responseFormat: { type: 'json_object' }
      });
      const choice = response.choices?.[0]?.message?.content;
      const text = typeof choice === 'string' ? choice : (choice ? String(choice) : '{}');
      return text;
    } catch (err: any) {
      lastError = err;
      await sleep(err.statusCode === 429 ? 3000 : 1000);
      retries--;
    }
  }
  throw lastError || new Error('Mistral API failure');
}

function safeParseJSON(text: string): any {
  try {
    const clean = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error('JSON parse error:', err);
    return null;
  }
}

const FALLBACK_BATCH_RESULT: MistralBatchResult = { recurrentNeeds: [], immediateSynergies: [], keyCompetencies: [] };
const FALLBACK_SYNTHESIS: MistralGlobalSynthesis = {
  globalThemes: [], crossBatchSynergies: [],
  networkStrength: "L'analyse globale a échoué (erreur API ou rate-limiting). Veuillez réessayer.",
  recommendedActionPlan: [], macroNeeds: [], valueChains: []
};

async function processContactBatch(client: Mistral, batch: any[], notes: any[], userContext: string, lockedContext: string): Promise<MistralBatchResult> {
  const batchData = batch.map(c => {
    const contactNotes = notes.filter(n => n.contact_id === c.id).map(n => n.content).join(' | ');
    const skills: string[] = Array.isArray(c.skills) ? c.skills : [];
    const needs: string[] = Array.isArray(c.inferred_needs) ? c.inferred_needs : [];
    return `<contact id="${c.id}">
  <name>${c.first_name} ${c.last_name}</name>
  <role>${c.job_title || 'Inconnu'}</role>
  <company>${c.company || 'Inconnue'}</company>
  <skills>${skills.length > 0 ? skills.join(', ') : 'Non renseignées'}</skills>
  <needs>${needs.length > 0 ? needs.join(', ') : 'Non renseignés'}</needs>
  <notes>${contactNotes || 'Aucune note disponible'}</notes>
</contact>`;
  }).join('\n');

  const prompt = `<role>
Tu es "Oracle MAP", un analyste expert en réseaux professionnels et en détection de synergies business cachées. Tu es reconnu pour ta capacité à relier des profils en apparence très différents autour d'un besoin, d'une ressource ou d'une compétence complémentaire non évidente.
</role>
${userContext ? `\n<user_context>\n${userContext}\n</user_context>\n` : ''}${lockedContext}
<instructions>
Analyse EN PROFONDEUR le lot de contacts fourni ci-dessous et extrais :
1. Les besoins récurrents ou latents (explicites dans les notes, ou déduits du poste/secteur/contexte).
2. Des synergies immédiates entre paires de contacts DE CE LOT UNIQUEMENT.
3. Les compétences clés (mots-clés) qui ressortent du groupe.
</instructions>

<rules>
- INTERDICTION FORMELLE de renvoyer un tableau "immediateSynergies" vide si le lot contient au moins 2 contacts. Si aucune synergie évidente n'existe, tu DOIS déduire une opportunité d'échange de compétences plausible même entre profils qui semblent éloignés au premier abord (ex : un besoin abstrait chez A peut être résolu par une compétence indirecte ou un réseau détenu par B). Sois créatif mais réaliste.
- N'invente jamais d'identité : utilise uniquement les id/noms fournis dans les balises <contact>.
- Chaque synergie doit avoir une "reason" concrète et actionnable, pas une généralité.
- Réponds STRICTEMENT avec un objet JSON valide respectant le format ci-dessous, sans aucun texte, markdown ou commentaire additionnel.
</rules>

<contacts>
${batchData}
</contacts>

<output_format>
{
  "recurrentNeeds": ["besoin 1", "besoin 2"],
  "immediateSynergies": [
    {
      "contactId1": "id exact du premier contact",
      "contactName1": "Nom du premier",
      "contactId2": "id exact du deuxieme contact",
      "contactName2": "Nom du deuxieme",
      "reason": "Explication concrète et actionnable de la synergie, même indirecte"
    }
  ],
  "keyCompetencies": ["mot cle 1", "mot cle 2"]
}
</output_format>`;

  try {
    const text = await callMistralServer(client, prompt);
    const parsed = safeParseJSON(text);
    if (parsed && Array.isArray(parsed.immediateSynergies) && Array.isArray(parsed.recurrentNeeds) && Array.isArray(parsed.keyCompetencies)) {
      return parsed as MistralBatchResult;
    }
    console.error('Mistral MAP: réponse JSON invalide, fallback appliqué.', text);
    return { ...FALLBACK_BATCH_RESULT };
  } catch (err) {
    console.error('Mistral MAP batch failure:', err);
    return { ...FALLBACK_BATCH_RESULT };
  }
}

async function synthesizeNetwork(
  client: Mistral,
  batchResults: MistralBatchResult[],
  userContext: string,
  bridgeContacts: BridgeContact[],
  lockedContext: string
): Promise<MistralGlobalSynthesis> {
  const aggregatedData = JSON.stringify(batchResults, null, 2);
  const bridgeContext = bridgeContacts.length > 0
    ? `\n<bridge_contacts>\nCes contacts relient structurellement des parties autrement séparées du réseau (calculé par centralité d'intermédiarité). Ce sont les meilleurs candidats pour des introductions stratégiques et des chaînes de valeur inter-groupes :\n${bridgeContacts.map(b => `- ${b.name} (${b.role} chez ${b.company})`).join('\n')}\n</bridge_contacts>\n`
    : '';

  const prompt = `<role>
Tu es "Oracle REDUCE", un super-cerveau stratégique spécialisé dans la consolidation d'analyses de réseaux professionnels. Ta mission est de fusionner des dizaines d'analyses locales (par lots) en une synthèse globale d'une qualité exceptionnelle.
</role>
${userContext ? `\n<user_context>\n${userContext}\n</user_context>\n` : ''}${bridgeContext}${lockedContext}
<instructions>
1. Fusionne les besoins similaires ou redondants détectés dans les différents lots en "Macro-Besoins" consolidés (ne liste pas les doublons séparément).
2. Construis des chaînes de valeur globales (value chains) qui relient plusieurs contacts de lots DIFFÉRENTS entre eux autour d'un objectif business commun (ex : A a un besoin, B a la compétence, C a le réseau/financement pour industrialiser). Quand c'est pertinent, utilise les <bridge_contacts> comme maillons de connexion entre groupes.
3. Identifie les thèmes dominants et les synergies transversales (cross-batch).
4. Propose un plan d'action concret et priorisé.
</instructions>

<rules>
- INTERDICTION de renvoyer des tableaux vides ("globalThemes", "crossBatchSynergies", "macroNeeds") si les données agrégées contiennent au moins un besoin ou une synergie exploitable. Déduis des connexions même si elles ne sont pas explicites lot par lot.
- Un "Macro-Besoin" doit regrouper au moins un besoin réel présent dans "mergedFrom", jamais inventé de toutes pièces.
- Une "valueChain" doit contenir au moins 2 étapes (chain) reliant des contacts réellement mentionnés dans les données agrégées.
- Réponds STRICTEMENT avec un objet JSON valide respectant le format ci-dessous, sans markdown ni texte additionnel.
</rules>

<aggregated_batch_data>
${aggregatedData}
</aggregated_batch_data>

<output_format>
{
  "globalThemes": ["thème dominant 1", "thème dominant 2"],
  "crossBatchSynergies": [
    { "theme": "Thème de la synergie globale", "description": "Explication de pourquoi ce réseau a de la valeur ici", "potentialImpact": "Estimation de l'impact (ex: Fort potentiel commercial)" }
  ],
  "macroNeeds": [
    { "label": "Nom du besoin consolidé (ex: Recrutement Tech Senior)", "mergedFrom": ["besoin brut 1", "besoin brut 2"], "affectedContactsCount": 3, "priority": "high" }
  ],
  "valueChains": [
    { "title": "Nom de la chaîne de valeur", "description": "Comment ces contacts s'enchaînent pour créer de la valeur", "chain": [{ "step": 1, "contactName": "Nom", "role": "Poste", "contribution": "Ce qu'il apporte à la chaîne" }], "estimatedImpact": "Estimation de l'impact business" }
  ],
  "networkStrength": "Résumé en 1-2 phrases de la force principale de ce réseau",
  "recommendedActionPlan": ["Action 1", "Action 2"]
}
</output_format>`;

  try {
    const text = await callMistralServer(client, prompt);
    const parsed = safeParseJSON(text);
    if (parsed && Array.isArray(parsed.globalThemes)) {
      return {
        globalThemes: parsed.globalThemes ?? [],
        crossBatchSynergies: parsed.crossBatchSynergies ?? [],
        networkStrength: parsed.networkStrength ?? FALLBACK_SYNTHESIS.networkStrength,
        recommendedActionPlan: parsed.recommendedActionPlan ?? [],
        macroNeeds: parsed.macroNeeds ?? [],
        valueChains: parsed.valueChains ?? []
      };
    }
    console.error('Mistral REDUCE: réponse JSON invalide, fallback appliqué.', text);
    return { ...FALLBACK_SYNTHESIS };
  } catch (err) {
    console.error('Mistral REDUCE synthesis failure:', err);
    return { ...FALLBACK_SYNTHESIS };
  }
}

async function buildSupplyDemandMatrix(client: Mistral, contacts: any[], notes: any[], userContext: string, lockedContext: string): Promise<SupplyDemandEntry[]> {
  if (!contacts || contacts.length === 0) return [];

  const catalog = contacts.slice(0, 200).map(c => {
    const contactNotes = notes.filter(n => n.contact_id === c.id).map(n => n.content).join(' | ').substring(0, 400);
    const skills: string[] = Array.isArray(c.skills) ? c.skills : [];
    const needs: string[] = Array.isArray(c.inferred_needs) ? c.inferred_needs : [];
    return {
      id: c.id,
      name: `${c.first_name} ${c.last_name}`,
      role: c.job_title || 'Inconnu',
      company: c.company || 'Inconnue',
      skills, needs, notes: contactNotes
    };
  });

  const prompt = `<role>
Tu es "Oracle MARKET", un analyste spécialisé dans la cartographie OFFRE / DEMANDE d'un réseau professionnel. Tu construis une matrice qui, pour chaque besoin identifié dans le réseau, liste QUI le demande et QUI peut le fournir.
</role>
${userContext ? `\n<user_context>\n${userContext}\n</user_context>\n` : ''}${lockedContext}
<instructions>
1. Parcours le catalogue de contacts (chacun a des compétences = OFFRE, et des besoins = DEMANDE).
2. Regroupe les besoins similaires en une même ligne "need" (ex : "trouver un développeur" et "besoin technique" → "Développement / compétence technique").
3. Pour chaque besoin, liste les "demanders" (contacts qui expriment ce besoin) et les "suppliers" (contacts dont les compétences y répondent, même indirectement).
4. Évalue le "gapLevel" : "opportunity" (forte demande, peu/pas de fournisseur), "partial" (partiellement couverte), "covered" (bien couverte).
5. Mets "opportunityForUser" à true si l'utilisateur (voir user_context) est bien placé pour capter cette opportunité.
</instructions>

<rules>
- INTERDICTION de renvoyer un tableau vide si le catalogue contient au moins un besoin exploitable.
- Utilise UNIQUEMENT les id/noms fournis dans le catalogue pour demanders/suppliers.
- Limite-toi aux ~12 lignes les plus pertinentes.
- Réponds STRICTEMENT avec un objet JSON valide, sans markdown ni texte additionnel.
</rules>

<catalog>
${JSON.stringify(catalog, null, 2)}
</catalog>

<output_format>
{ "supplyDemand": [ { "need": "Nom clair du besoin consolidé", "demanders": [{ "id": "id exact", "name": "Nom" }], "suppliers": [{ "id": "id exact", "name": "Nom" }], "gapLevel": "opportunity", "opportunityForUser": true } ] }
</output_format>`;

  try {
    const text = await callMistralServer(client, prompt);
    const parsed = safeParseJSON(text);
    if (parsed && Array.isArray(parsed.supplyDemand)) {
      return parsed.supplyDemand
        .filter((e: any) => e && typeof e.need === 'string')
        .map((e: any) => ({
          need: e.need,
          demanders: Array.isArray(e.demanders) ? e.demanders : [],
          suppliers: Array.isArray(e.suppliers) ? e.suppliers : [],
          gapLevel: ['covered', 'partial', 'opportunity'].includes(e.gapLevel) ? e.gapLevel : 'partial',
          opportunityForUser: Boolean(e.opportunityForUser)
        })) as SupplyDemandEntry[];
    }
    console.error('Mistral SUPPLY/DEMAND: réponse JSON invalide, fallback vide appliqué.', text);
    return [];
  } catch (err) {
    console.error('Mistral SUPPLY/DEMAND failure:', err);
    return [];
  }
}

async function computeEmbeddingsServer(client: Mistral, contacts: any[], notes: any[]): Promise<{ contactId: string; vector: number[] }[]> {
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

    if (i + BATCH_SIZE < contacts.length) await sleep(300);
  }

  return results;
}

const MIN_MAP_BATCH = 15;
const MAX_MAP_BATCH = 30;

function chunkNaive(contacts: any[], size: number = 25): any[][] {
  const batches: any[][] = [];
  for (let i = 0; i < contacts.length; i += size) batches.push(contacts.slice(i, i + size));
  return batches;
}

function packClustersIntoBatches(clusterGroups: any[][]): any[][] {
  const batches: any[][] = [];
  let buffer: any[] = [];

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

async function computeNetworkTopology(client: Mistral, contacts: any[], notes: any[]): Promise<{ batches: any[][]; bridgeContacts: BridgeContact[] }> {
  if (contacts.length < 6) return { batches: chunkNaive(contacts), bridgeContacts: [] };

  let embeddings: { contactId: string; vector: number[] }[] = [];
  try {
    embeddings = await computeEmbeddingsServer(client, contacts, notes);
  } catch (err) {
    console.error('computeNetworkTopology: embedding failure, falling back to naive batching.', err);
    return { batches: chunkNaive(contacts), bridgeContacts: [] };
  }

  if (embeddings.length < 6) return { batches: chunkNaive(contacts), bridgeContacts: [] };

  const embeddedIds = new Set(embeddings.map(e => e.contactId));
  const contactById = new Map(contacts.map(c => [c.id, c]));
  const vectors = embeddings.map(e => e.vector);

  let clusterGroups: any[][];
  let bridgeContacts: BridgeContact[] = [];

  try {
    const k = findOptimalK(vectors);
    const { clusters } = kMeansClustering(vectors, k);

    const groupsById = new Map<number, any[]>();
    embeddings.forEach((e, idx) => {
      const clusterId = clusters[idx];
      const contact = contactById.get(e.contactId);
      if (!contact) return;
      if (!groupsById.has(clusterId)) groupsById.set(clusterId, []);
      groupsById.get(clusterId)!.push(contact);
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
          return {
            id: e.contactId,
            name: `${c?.first_name || ''} ${c?.last_name || ''}`.trim(),
            role: c?.job_title || 'Inconnu',
            company: c?.company || 'Inconnue',
            centralityScore: Math.round((score / maxCentrality) * 100) / 100
          };
        });
    }
  } catch (err) {
    console.error('computeNetworkTopology: clustering failure, falling back to a single naive group.', err);
    clusterGroups = [contacts.filter(c => embeddedIds.has(c.id))];
  }

  const unembedded = contacts.filter(c => !embeddedIds.has(c.id));
  if (unembedded.length > 0) clusterGroups.push(unembedded);

  return { batches: packClustersIntoBatches(clusterGroups), bridgeContacts };
}

// ─── Output redaction ─────────────────────────────────────────────────────

function redactResult(result: MistralPipelineResult, visibleIds: Set<string>, visibleNames: Set<string>): MistralPipelineResult {
  const isLocked = (id?: string) => Boolean(id) && !visibleIds.has(id as string);

  const batches = result.batches.map(b => ({
    ...b,
    immediateSynergies: b.immediateSynergies.map(s => {
      if (isLocked(s.contactId1) || isLocked(s.contactId2)) {
        return { ...s, reason: "Synergie potentielle détectée — demandez l'accès aux contacts concernés pour voir les détails." };
      }
      return s;
    })
  }));

  const bridgeContacts = result.bridgeContacts.map(b =>
    isLocked(b.id) ? { ...b, role: 'Verrouillé', company: 'Verrouillé' } : b
  );

  const supplyDemand = result.supplyDemand; // demanders/suppliers only carry id+name, already minimal

  const valueChains = result.synthesis.valueChains.map(vc => ({
    ...vc,
    chain: vc.chain.map(link =>
      visibleNames.has(link.contactName)
        ? link
        : { ...link, role: 'Verrouillé', contribution: 'Détails masqués — accès non accordé.' }
    )
  }));

  return {
    ...result,
    batches,
    bridgeContacts,
    supplyDemand,
    synthesis: { ...result.synthesis, valueChains }
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────

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

    const { spaceId, userProfile } = req.body || {};

    // Query AS the calling user (their JWT forwarded) so row-level RLS
    // (space membership) applies exactly as it would client-side — this is
    // not a service-role bypass, it only skips the FIELD-masking view.
    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${auth.token}` } }
    });

    let contactsQuery = userSupabase.from('contacts').select('*').order('first_name');
    if (spaceId) contactsQuery = contactsQuery.eq('space_id', spaceId);
    const { data: contacts, error: contactsError } = await contactsQuery;
    if (contactsError) { res.status(500).json({ error: contactsError.message }); return; }
    if (!contacts || contacts.length === 0) {
      res.status(200).json({ batches: [], synthesis: { ...FALLBACK_SYNTHESIS, networkStrength: 'Aucun contact à analyser.' }, supplyDemand: [], bridgeContacts: [], timestamp: Date.now() });
      return;
    }

    const contactIds = contacts.map(c => c.id);
    const { data: notes, error: notesError } = await userSupabase.from('notes').select('*').in('contact_id', contactIds);
    if (notesError) { res.status(500).json({ error: notesError.message }); return; }

    // Which of these contacts is the CALLER actually allowed to see in full?
    // Drives the redaction pass below — never sent to Mistral as a masking
    // input (the model always sees full data so it can reason well), only
    // used to decide what comes back OUT.
    const { data: visibility, error: visibilityError } = await userSupabase
      .from('contacts_visible')
      .select('id, is_unlocked')
      .in('id', contactIds);
    if (visibilityError) { res.status(500).json({ error: visibilityError.message }); return; }

    const visibleIds = new Set((visibility || []).filter(v => v.is_unlocked).map(v => v.id));
    const lockedNames = contacts.filter(c => !visibleIds.has(c.id)).map(c => `${c.first_name} ${c.last_name}`);
    const visibleNames = new Set(contacts.filter(c => visibleIds.has(c.id)).map(c => `${c.first_name} ${c.last_name}`));

    const client = new Mistral({ apiKey });
    const userContext = userProfile ? buildUserContext(userProfile) : '';
    const lockedContext = buildLockedContext(lockedNames);

    const { batches, bridgeContacts } = await computeNetworkTopology(client, contacts, notes || []);

    const batchResults: MistralBatchResult[] = [];
    for (let i = 0; i < batches.length; i++) {
      const result = await processContactBatch(client, batches[i], notes || [], userContext, lockedContext);
      batchResults.push(result);
      if (i < batches.length - 1) await sleep(800);
    }

    const synthesis = await synthesizeNetwork(client, batchResults, userContext, bridgeContacts, lockedContext);
    const supplyDemand = await buildSupplyDemandMatrix(client, contacts, notes || [], userContext, lockedContext);

    const rawResult: MistralPipelineResult = {
      batches: batchResults,
      synthesis,
      supplyDemand,
      bridgeContacts,
      timestamp: Date.now()
    };

    const redacted = redactResult(rawResult, visibleIds, visibleNames);
    res.status(200).json(redacted);
  } catch (err: any) {
    console.error('Oracle run-analysis failure:', err);
    res.status(500).json({ error: err.message || 'Oracle analysis failed' });
  }
}
