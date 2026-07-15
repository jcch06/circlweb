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
}

interface BridgeContact { id: string; name: string; role: string; company: string; centralityScore: number; }

const FALLBACK_SYNTHESIS: MistralGlobalSynthesis = {
  globalThemes: [], crossBatchSynergies: [],
  networkStrength: "L'analyse globale a échoué (erreur API ou rate-limiting). Veuillez réessayer.",
  recommendedActionPlan: [], macroNeeds: [], valueChains: []
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

ADAPTE ton analyse au profil ci-dessus. Si le poste/les compétences pointent vers un domaine précis (ex : "architecte" → immobilier/urbanisme, "développeur" → consulting tech, "avocat" → conseil juridique, "élu/politique" → influence & coalitions, "dirigeant associatif" → mécénat & partenariats), PRIORISE les opportunités ALIGNÉES avec son expertise et ses objectifs déclarés.`;
}

function buildLockedContext(lockedNames: string[]): string {
  if (lockedNames.length === 0) return '';
  return `\n<locked_contacts>\nCes contacts sont VERROUILLÉS pour l'utilisateur actuel (il n'a pas accès à leurs détails complets) : ${lockedNames.join(', ')}.\nTu PEUX les mentionner par leur nom s'ils sont impliqués dans une synergie ou une chaîne de valeur, mais tu ne dois JAMAIS révéler leur poste, leur entreprise, ni aucun détail tiré de leurs notes privées. Utilise une formulation générique du type "un profil pertinent dans le réseau" pour justifier leur implication.\n</locked_contacts>\n`;
}

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
      return typeof choice === 'string' ? choice : (choice ? String(choice) : '{}');
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
- RIGUEUR AVANT TOUT : ne consolide que ce que les données agrégées soutiennent réellement. Il vaut mieux 2 macro-besoins et 1 chaîne de valeur SOLIDES que des listes étoffées de connexions spéculatives. Si les données ne soutiennent pas de synergie transversale crédible, renvoie peu d'éléments (voire des tableaux vides) — c'est une réponse valide.
- Un "Macro-Besoin" doit regrouper au moins un besoin réel présent dans "mergedFrom", jamais inventé de toutes pièces.
- Une "valueChain" ne doit relier que des contacts RÉELLEMENT nommés dans les données agrégées, chacun avec un rôle concret tiré de ses données. N'ajoute JAMAIS un maillon générique du type "un profil pertinent dans le réseau" ni un rôle vague ("profil technique ou opérationnel", "client potentiel") : si tu n'as pas de rôle précis pour un contact, ne l'inclus pas dans la chaîne.
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

    const { batchResults, bridgeContacts, lockedContactNames, userProfile } = req.body || {};
    if (!Array.isArray(batchResults)) {
      res.status(400).json({ error: 'batchResults must be an array' });
      return;
    }

    const client = new Mistral({ apiKey });
    const userContext = userProfile ? buildUserContext(userProfile) : '';
    const lockedNames: string[] = Array.isArray(lockedContactNames) ? lockedContactNames : [];
    const lockedContext = buildLockedContext(lockedNames);
    const lockedNameSet = new Set(lockedNames);

    const synthesis = await synthesizeNetwork(client, batchResults, userContext, Array.isArray(bridgeContacts) ? bridgeContacts : [], lockedContext);

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
    res.status(500).json({ error: err.message || 'Oracle reduce failed' });
  }
}
