import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Mistral } from '@mistralai/mistralai';
import { createClient } from '@supabase/supabase-js';

// Step 3/4 of the Oracle pipeline (see topology.ts, map-batch.ts,
// supply-demand.ts). No DB fetch needed — inputs are the already-redacted
// per-batch results from map-batch.ts plus the bridge contacts from
// topology.ts (already role/company-redacted for locked contacts there).
//
// Self-contained on purpose — no imports from ../_lib or src/lib.

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

// Chunked `.in()` — a large id list serialized into one query string can blow
// the gateway's request-line limit (bare "Bad Request"). Same helper as
// topology.ts / supply-demand.ts.
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

// Build a compact, per-batch roster REDUCE can reason on directly: who is
// actually in each batch (name, role, company, estimated skills/needs). This
// is the context REDUCE lacked — batchResults only carry aggregated
// needs/competencies, so it could never cross-match a specific profile in one
// batch with one in another. Locked contacts keep their name but everything
// else is redacted (never leak role/company for a contact the user can't see).
// Notes are deliberately NOT included here (they stay in MAP) — this roster is
// a structural map of the network, not a place to surface private note text.
function buildBatchRosters(
  batches: string[][],
  contactById: Map<string, any>,
  lockedNameSet: Set<string>
): string {
  const MAX_PER_BATCH = 20; // batches are ~15-30; keeps the prompt bounded.
  const lines: string[] = [];
  batches.forEach((ids, i) => {
    const members = ids
      .map(id => contactById.get(id))
      .filter(Boolean)
      .slice(0, MAX_PER_BATCH)
      .map(c => {
        const name = `${c.first_name} ${c.last_name || ''}`.trim();
        if (lockedNameSet.has(name)) return `  - ${name} (profil verrouillé — détails masqués)`;
        const skills = Array.isArray(c.skills) ? c.skills.filter((s: any) => s && String(s).trim()).slice(0, 6).join(', ') : '';
        const needs = Array.isArray(c.inferred_needs) ? c.inferred_needs.filter((n: any) => n && String(n).trim()).slice(0, 6).join(', ') : '';
        const role = c.job_title || 'Inconnu';
        const company = c.company || 'Inconnue';
        return `  - ${name} — ${role} @ ${company}${skills ? ` | compétences estimées : ${skills}` : ''}${needs ? ` | besoins estimés : ${needs}` : ''}`;
      });
    if (members.length > 0) lines.push(`Lot ${i + 1} :\n${members.join('\n')}`);
  });
  return lines.join('\n\n');
}

interface MistralBatchResult {
  recurrentNeeds: string[];
  immediateSynergies: {
    contactId1: string; contactName1: string; contactId2: string; contactName2: string;
    reason: string; confidence?: 'high' | 'medium' | 'low'; evidence?: string;
  }[];
  keyCompetencies: string[];
}

interface MacroNeed { label: string; mergedFrom: string[]; affectedContactsCount: number; priority: 'high' | 'medium' | 'low'; }
interface ValueChainLink { step: number; contactName: string; role: string; contribution: string; }
interface ValueChain { title: string; description: string; chain: ValueChainLink[]; estimatedImpact: string; }
// Un pôle DENSE mais HORS-PROFIL : un thème/besoin réellement partagé par
// plusieurs contacts qui ne colle à aucun levier de l'utilisateur, présenté
// comme une direction nouvelle qu'il pourrait explorer (pas comme une
// faiblesse). Ancré sur des contacts réels — jamais une tendance inventée.
interface EmergingOpportunity {
  theme: string;
  description: string;
  anchorContacts: { name: string }[];
  whyNewDoor: string;
}

interface MistralGlobalSynthesis {
  globalThemes: string[];
  crossBatchSynergies: { theme: string; description: string; potentialImpact: string }[];
  networkStrength: string;
  recommendedActionPlan: string[];
  macroNeeds: MacroNeed[];
  valueChains: ValueChain[];
  emergingOpportunities: EmergingOpportunity[];
}

interface BridgeContact { id: string; name: string; role: string; company: string; centralityScore: number; }

const FALLBACK_SYNTHESIS: MistralGlobalSynthesis = {
  globalThemes: [], crossBatchSynergies: [],
  networkStrength: "L'analyse globale a échoué (erreur API ou rate-limiting). Veuillez réessayer.",
  recommendedActionPlan: [], macroNeeds: [], valueChains: [], emergingOpportunities: []
};

const MAP_REDUCE_MODEL = 'mistral-large-latest';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

  // Prefer the leviers Mistral derived from THIS user's profile (client-side,
  // see deriveAnalysisAngles) over the static generic list — the latter is
  // only a fallback when no profile-specific angles were produced.
  const angles: string[] = Array.isArray(userProfile?.analysisAngles) && userProfile.analysisAngles.length > 0
    ? userProfile.analysisAngles
    : genericAngles;

  return `${lines.join('\n')}

L'utilisateur veut MONÉTISER et VALORISER son réseau. Leviers de valeur prioritaires, dérivés de SON profil :
${angles.map((a: string, i: number) => `${i + 1}. ${a}`).join('\n')}

ADAPTE ton analyse au profil ci-dessus. Si le poste/les compétences pointent vers un domaine précis (ex : "architecte" → immobilier/urbanisme, "développeur" → consulting tech, "avocat" → conseil juridique, "élu/politique" → influence & coalitions, "dirigeant associatif" → mécénat & partenariats), PRIORISE les opportunités ALIGNÉES avec son expertise et ses objectifs déclarés.

IMPORTANT : cet alignement sert à PRIORISER et à construire le plan d'action, jamais à faire disparaître une observation réelle. Si le réseau analysé ne colle à aucun des leviers ci-dessus, dis-le explicitement dans "networkStrength" — mais continue de rapporter les thèmes, besoins et compétences RÉELLEMENT présents dans les données, même hors sujet par rapport au profil de l'utilisateur. Un réseau sans lien avec son activité reste un réseau réel avec de vrais thèmes ; ne le réduis jamais à des tableaux vides sous prétexte qu'il ne sert pas directement l'utilisateur.

OUVERTURE (essentiel) : un pôle DENSE mais HORS-PROFIL n'est PAS une faiblesse — c'est une porte que l'utilisateur pourrait ouvrir. Quand plusieurs contacts (≥2) convergent réellement sur un thème ou un besoin commun qui ne colle à aucun de ses leviers, remonte-le dans "emergingOpportunities" comme une DIRECTION NOUVELLE à explorer (ex : "ton réseau a un pôle événementiel/luxe inattendu — voilà la porte que ça t'ouvre"), pas comme du bruit à ignorer. Formule "networkStrength" dans cet esprit : si le réseau est dense sur des thèmes hors-profil, présente cette densité comme une opportunité latente d'ouverture, jamais comme un échec d'alignement. Et dans "recommendedActionPlan", inclus au moins une action qui invite à explorer ces portes quand elles existent — pas seulement à prospecter en externe.`;
}

function buildLockedContext(lockedNames: string[]): string {
  if (lockedNames.length === 0) return '';
  return `\n<locked_contacts>\nCes contacts sont VERROUILLÉS pour l'utilisateur actuel (il n'a pas accès à leurs détails complets) : ${lockedNames.join(', ')}.\nTu PEUX les mentionner par leur nom s'ils sont impliqués dans une synergie ou une chaîne de valeur, mais tu ne dois JAMAIS révéler leur poste, leur entreprise, ni aucun détail tiré de leurs notes privées. Utilise une formulation générique du type "un profil pertinent dans le réseau" pour justifier leur implication.\n</locked_contacts>\n`;
}

async function callMistralServer(client: Mistral, prompt: string, model: string = MAP_REDUCE_MODEL): Promise<string> {
  // Kept modest and bounded well under this function's own maxDuration
  // (60s, see vercel.json) — a 429 here needs the caller to retry the WHOLE
  // request after a real delay (a fresh invocation gets a fresh budget),
  // not this function stalling on a backoff long enough to get killed
  // mid-retry by its own execution timeout. See postOracleStep in
  // src/lib/mistral.ts for the client-side retry that actually rides out a
  // sustained per-minute rate limit (observed as low as 4 req/min on some
  // account tiers).
  const maxAttempts = 3;
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await client.chat.complete({
        model,
        messages: [{ role: 'user', content: prompt }],
        responseFormat: { type: 'json_object' }
      });
      const choice = response.choices?.[0]?.message?.content;
      return typeof choice === 'string' ? choice : (choice ? String(choice) : '{}');
    } catch (err: any) {
      lastError = err;
      if (attempt === maxAttempts) break;
      const delay = err.statusCode === 429 ? Math.min(5000 * attempt, 10000) : 1000;
      await sleep(delay);
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

// Garde-fou : un Macro-Besoin n'a de sens que s'il CONSOLIDE réellement — au
// moins 2 contacts concernés OU au moins 2 besoins bruts distincts fusionnés.
// Le prompt le demande déjà, mais Mistral produit parfois des besoins isolés
// recopiés ("1 contact · fusionne : <le même libellé>") qui polluent la
// synthèse sur un réseau éclaté. On les écarte ici plutôt que de les afficher.
function filterMacroNeeds(raw: any): MacroNeed[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((n: any) => {
    if (!n || typeof n.label !== 'string' || !n.label.trim()) return false;
    const merged = Array.isArray(n.mergedFrom)
      ? n.mergedFrom.filter((m: any) => typeof m === 'string' && m.trim())
      : [];
    // Besoins bruts réellement distincts (insensible à la casse/espaces) —
    // deux fois le même libellé ne compte pas comme une consolidation.
    const distinctMerged = new Set(merged.map((m: string) => m.trim().toLowerCase()));
    const contactsCount = Number(n.affectedContactsCount) || 0;
    return contactsCount >= 2 || distinctMerged.size >= 2;
  });
}

// Garde-fou "Portes à Explorer" : une opportunité émergente n'est crédible
// que si elle est ANCRÉE sur au moins 2 contacts réels et nommés qui
// partagent vraiment le thème — même rigueur que les macro-besoins, pour que
// ces pistes hors-profil restent des observations réelles et jamais une
// tendance extrapolée à partir d'une seule personne.
function filterEmergingOpportunities(raw: any): EmergingOpportunity[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o: any) => {
      if (!o || typeof o.theme !== 'string' || !o.theme.trim()) return null;
      const anchors = Array.isArray(o.anchorContacts)
        ? o.anchorContacts
            .map((c: any) => (typeof c === 'string' ? { name: c } : c))
            .filter((c: any) => c && typeof c.name === 'string' && c.name.trim())
            .map((c: any) => ({ name: c.name.trim() }))
        : [];
      // Contacts distincts uniquement — deux fois le même nom ne fait pas un pôle.
      const seen = new Set<string>();
      const distinctAnchors = anchors.filter((c: { name: string }) => {
        const k = c.name.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (distinctAnchors.length < 2) return null;
      return {
        theme: o.theme.trim(),
        description: typeof o.description === 'string' ? o.description : '',
        anchorContacts: distinctAnchors,
        whyNewDoor: typeof o.whyNewDoor === 'string' ? o.whyNewDoor : ''
      } as EmergingOpportunity;
    })
    .filter((o: EmergingOpportunity | null): o is EmergingOpportunity => o !== null);
}

async function synthesizeNetwork(
  client: Mistral,
  batchResults: MistralBatchResult[],
  userContext: string,
  bridgeContacts: BridgeContact[],
  lockedContext: string,
  batchRosters: string
): Promise<MistralGlobalSynthesis> {
  const aggregatedData = JSON.stringify(batchResults, null, 2);
  const bridgeContext = bridgeContacts.length > 0
    ? `\n<bridge_contacts>\nCes contacts relient structurellement des parties autrement séparées du réseau (calculé par centralité d'intermédiarité). Ce sont les meilleurs candidats pour des introductions stratégiques et des chaînes de valeur inter-groupes :\n${bridgeContacts.map(b => `- ${b.name} (${b.role} chez ${b.company})`).join('\n')}\n</bridge_contacts>\n`
    : '';
  // Real per-batch roster (name/role/company/estimated skills+needs). Lets
  // REDUCE ground cross-batch synergies and value chains on actual named
  // profiles rather than only the compact aggregated needs/competencies.
  const rosterContext = batchRosters
    ? `\n<composition_des_lots>\nVoici QUI compose chaque lot (nom, poste, entreprise, compétences/besoins estimés). Sers-t'en pour croiser des profils PRÉCIS d'un lot à l'autre et nommer les bons contacts dans les chaînes de valeur — sans jamais inventer de personne absente de cette liste.\n${batchRosters}\n</composition_des_lots>\n`
    : '';

  const prompt = `<role>
Tu es "Oracle REDUCE", un super-cerveau stratégique spécialisé dans la consolidation d'analyses de réseaux professionnels. Ta mission est de fusionner des dizaines d'analyses locales (par lots) en une synthèse globale d'une qualité exceptionnelle.
</role>
${userContext ? `\n<user_context>\n${userContext}\n</user_context>\n` : ''}${bridgeContext}${rosterContext}${lockedContext}
<instructions>
1. Fusionne les besoins similaires ou redondants détectés dans les différents lots en "Macro-Besoins" consolidés (ne liste pas les doublons séparément).
2. Construis des chaînes de valeur globales (value chains) qui relient plusieurs contacts de lots DIFFÉRENTS entre eux autour d'un objectif business commun (ex : A a un besoin, B a la compétence, C a le réseau/financement pour industrialiser). Quand c'est pertinent, utilise les <bridge_contacts> comme maillons de connexion entre groupes.
3. Identifie les thèmes dominants ET, surtout, les SYNERGIES TRANSVERSALES (crossBatchSynergies) : croise ACTIVEMENT les besoins récurrents d'un lot avec les compétences clés d'un AUTRE lot (ex : le lot A exprime un besoin de financement, le lot B regroupe des profils investissement → synergie transversale ; le lot C a besoin de tech, le lot D a des développeurs → synergie). C'est le CŒUR de la valeur d'un réseau diversifié : deux mondes qui ne se connaissent pas mais dont l'un a ce que l'autre cherche. Cherche systématiquement ces croisements besoin↔compétence entre lots différents.
4. Repère les "Portes à Explorer" (emergingOpportunities) : les pôles DENSES mais HORS-PROFIL — un thème ou un besoin réellement partagé par au moins DEUX contacts, qui ne colle à aucun levier de l'utilisateur, et qui pourrait lui ouvrir une direction nouvelle. Vois la section OUVERTURE du user_context.
5. Propose un plan d'action concret et priorisé.
</instructions>

<rules>
- RIGUEUR sur "macroNeeds" et "valueChains" (qui NOMMENT des contacts précis) : ne consolide que ce que les données agrégées soutiennent réellement, mieux vaut 2 chaînes de valeur SOLIDES que des listes spéculatives, et n'invente jamais un contact ou un rôle. En revanche "crossBatchSynergies" est THÉMATIQUE (un thème, une description, un impact — pas des contacts nommés fragiles) : sois GÉNÉREUX ici. Dès qu'un besoin réel présent dans un lot rencontre une compétence réelle présente dans un AUTRE lot, c'est une synergie transversale valide à remonter, même sans note qui la corrobore — c'est une piste, pas une certitude. Ne renvoie "crossBatchSynergies" vide QUE si aucun croisement besoin↔compétence n'existe réellement entre les lots (rare sur un réseau diversifié). "globalThemes" est un simple résumé factuel de ce qui existe dans <aggregated_batch_data> : il ne dépend d'aucune synergie ni alignement, et ne doit être vide que si <aggregated_batch_data> est lui-même vide.
- Un "Macro-Besoin" est par définition une CONSOLIDATION : il ne se justifie que s'il regroupe au moins DEUX contacts distincts OU au moins deux besoins bruts distincts dans "mergedFrom". Ne crée JAMAIS un macro-besoin qui ne concerne qu'un seul contact avec un seul besoin recopié — ce n'est pas un macro-besoin, c'est un besoin isolé, et il n'a pas sa place ici. Si le réseau ne présente aucun besoin réellement partagé par plusieurs contacts, renvoie un tableau "macroNeeds" vide : c'est une réponse valide et préférable à des besoins triviaux. "mergedFrom" et "affectedContactsCount" doivent refléter la réalité (jamais gonflés pour atteindre le seuil).
- Une "valueChain" ne doit relier que des contacts RÉELLEMENT nommés dans les données agrégées, chacun avec un rôle concret tiré de ses données. N'ajoute JAMAIS un maillon générique du type "un profil pertinent dans le réseau" ni un rôle vague ("profil technique ou opérationnel", "client potentiel") : si tu n'as pas de rôle précis pour un contact, ne l'inclus pas dans la chaîne.
- Chaque synergie agrégée porte un "confidence" ("high"/"medium"/"low") hérité du MAP — "high" y signifie qu'une note réelle de l'utilisateur corrobore le lien, "medium"/"low" signifient une pure estimation IA. Privilégie les synergies "high" pour bâtir les "valueChains" et macro-besoins les plus mis en avant ; une chaîne construite uniquement sur des synergies "low" doit rester marginale, pas headline.
- Le "recommendedActionPlan" ne doit citer que des contacts, entreprises ou organisations RÉELLEMENT présents dans les données agrégées. N'invente JAMAIS un tiers plausible (syndicat professionnel, entreprise cible, segment de marché précis) qui n'apparaît nulle part dans <aggregated_batch_data> — une action peut rester généraliste ("Prendre contact avec X pour explorer Y") plutôt que de nommer une entité non vérifiée.
- Une "emergingOpportunity" (Porte à Explorer) suit la MÊME RIGUEUR : elle doit s'appuyer sur au moins DEUX contacts réels et nommés (dans "anchorContacts") qui partagent réellement ce thème/besoin dans les données agrégées. N'invente jamais un pôle ou une tendance à partir d'un seul contact ou d'une extrapolation. Ne remonte ici QUE des thèmes hors-profil (ceux qui collent aux leviers de l'utilisateur ont déjà leur place dans macroNeeds/valueChains) ; si tout le réseau est déjà aligné, renvoie un tableau "emergingOpportunities" vide. Le champ "whyNewDoor" explique concrètement quelle direction nouvelle ce pôle pourrait ouvrir à l'utilisateur.
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
  "emergingOpportunities": [
    { "theme": "Pôle hors-profil dense (ex: Événementiel haut de gamme)", "description": "Ce que ce pôle représente dans le réseau", "anchorContacts": [{ "name": "Nom A" }, { "name": "Nom B" }], "whyNewDoor": "Quelle direction nouvelle ce pôle pourrait ouvrir à l'utilisateur" }
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
        macroNeeds: filterMacroNeeds(parsed.macroNeeds),
        valueChains: parsed.valueChains ?? [],
        emergingOpportunities: filterEmergingOpportunities(parsed.emergingOpportunities)
      };
    }
    console.error('Mistral REDUCE: réponse JSON invalide, fallback appliqué.', text);
    return { ...FALLBACK_SYNTHESIS };
  } catch (err: any) {
    console.error('Mistral REDUCE synthesis failure:', err);
    // See map-batch.ts's identical guard: a rate-limit exhaustion must not
    // masquerade as a genuine empty synthesis — let it propagate so the
    // handler can report 429 distinctly.
    if (err?.statusCode === 429) throw err;
    return { ...FALLBACK_SYNTHESIS };
  }
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

    const { batchResults, batches, bridgeContacts, lockedContactNames, userProfile } = req.body || {};
    if (!Array.isArray(batchResults)) {
      res.status(400).json({ error: 'batchResults must be an array' });
      return;
    }

    const client = new Mistral({ apiKey });
    const userContext = userProfile ? buildUserContext(userProfile) : '';
    const lockedNames: string[] = Array.isArray(lockedContactNames) ? lockedContactNames : [];
    const lockedContext = buildLockedContext(lockedNames);
    const lockedNameSet = new Set(lockedNames);

    // Build the real per-batch roster (name/role/company/skills/needs) so
    // REDUCE can cross-match specific profiles across batches. Best-effort:
    // any fetch problem just falls back to the summary-only synthesis (empty
    // roster) rather than failing the whole step.
    let batchRosters = '';
    try {
      const supabaseUrl = process.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
      const batchIdArrays: string[][] = Array.isArray(batches)
        ? batches.filter((b: any) => Array.isArray(b)).map((b: any[]) => b.map(String))
        : [];
      if (supabaseUrl && supabaseAnonKey && batchIdArrays.length > 0) {
        const allIds = Array.from(new Set(batchIdArrays.flat()));
        const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: `Bearer ${auth.token}` } }
        });
        const { data: rosterContacts, error: rosterError } = await selectInChunks<any>(
          chunk => userSupabase.from('contacts').select('id, first_name, last_name, job_title, company, skills, inferred_needs').in('id', chunk),
          allIds
        );
        if (rosterError) {
          console.error('Oracle reduce: roster contacts fetch failed, continuing summary-only', rosterError);
        } else {
          const contactById = new Map<string, any>((rosterContacts || []).map((c: any) => [c.id, c]));
          batchRosters = buildBatchRosters(batchIdArrays, contactById, lockedNameSet);
        }
      }
    } catch (err) {
      console.error('Oracle reduce: roster build failed, continuing summary-only', err);
    }

    const synthesis = await synthesizeNetwork(client, batchResults, userContext, Array.isArray(bridgeContacts) ? bridgeContacts : [], lockedContext, batchRosters);

    const redacted: MistralGlobalSynthesis = {
      ...synthesis,
      valueChains: synthesis.valueChains.map(vc => ({
        ...vc,
        chain: vc.chain.map(link =>
          lockedNameSet.has(link.contactName)
            ? { ...link, role: 'Verrouillé', contribution: 'Détails masqués — accès non accordé.' }
            : link
        )
      }))
    };

    res.status(200).json(redacted);
  } catch (err: any) {
    console.error('Oracle reduce failure:', err);
    const status = err?.statusCode === 429 ? 429 : 500;
    res.status(status).json({ error: err.message || 'Oracle reduce failed', rateLimited: status === 429 });
  }
}
