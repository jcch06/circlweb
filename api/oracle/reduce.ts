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
  immediateSynergies: {
    contactId1: string; contactName1: string; contactId2: string; contactName2: string;
    reason: string; confidence?: 'high' | 'medium' | 'low'; evidence?: string;
  }[];
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

ADAPTE ton analyse au profil ci-dessus. Si le poste/les compétences pointent vers un domaine précis (ex : "architecte" → immobilier/urbanisme, "développeur" → consulting tech, "avocat" → conseil juridique, "élu/politique" → influence & coalitions, "dirigeant associatif" → mécénat & partenariats), PRIORISE les opportunités ALIGNÉES avec son expertise et ses objectifs déclarés.

IMPORTANT : cet alignement sert à PRIORISER et à construire le plan d'action, jamais à faire disparaître une observation réelle. Si le réseau analysé ne colle à aucun des leviers ci-dessus, dis-le explicitement dans "networkStrength" — mais continue de rapporter les thèmes, besoins et compétences RÉELLEMENT présents dans les données, même hors sujet par rapport au profil de l'utilisateur. Un réseau sans lien avec son activité reste un réseau réel avec de vrais thèmes ; ne le réduis jamais à des tableaux vides sous prétexte qu'il ne sert pas directement l'utilisateur.`;
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
- RIGUEUR AVANT TOUT, mais UNIQUEMENT sur "macroNeeds", "valueChains" et "crossBatchSynergies" (qui exigent des connexions crédibles entre contacts) : ne consolide que ce que les données agrégées soutiennent réellement. Il vaut mieux 2 macro-besoins et 1 chaîne de valeur SOLIDES que des listes étoffées de connexions spéculatives. Si les données ne soutiennent pas de synergie transversale crédible, renvoie peu d'éléments sur CES champs (voire des tableaux vides) — c'est une réponse valide. "globalThemes" en revanche est un simple résumé factuel de ce qui existe dans <aggregated_batch_data> (besoins récurrents, compétences clés déjà extraits par lot) : il ne dépend d'AUCUNE synergie ni d'aucun alignement avec le profil utilisateur, et ne doit être vide que si <aggregated_batch_data> est lui-même vide.
- Un "Macro-Besoin" est par définition une CONSOLIDATION : il ne se justifie que s'il regroupe au moins DEUX contacts distincts OU au moins deux besoins bruts distincts dans "mergedFrom". Ne crée JAMAIS un macro-besoin qui ne concerne qu'un seul contact avec un seul besoin recopié — ce n'est pas un macro-besoin, c'est un besoin isolé, et il n'a pas sa place ici. Si le réseau ne présente aucun besoin réellement partagé par plusieurs contacts, renvoie un tableau "macroNeeds" vide : c'est une réponse valide et préférable à des besoins triviaux. "mergedFrom" et "affectedContactsCount" doivent refléter la réalité (jamais gonflés pour atteindre le seuil).
- Une "valueChain" ne doit relier que des contacts RÉELLEMENT nommés dans les données agrégées, chacun avec un rôle concret tiré de ses données. N'ajoute JAMAIS un maillon générique du type "un profil pertinent dans le réseau" ni un rôle vague ("profil technique ou opérationnel", "client potentiel") : si tu n'as pas de rôle précis pour un contact, ne l'inclus pas dans la chaîne.
- Chaque synergie agrégée porte un "confidence" ("high"/"medium"/"low") hérité du MAP — "high" y signifie qu'une note réelle de l'utilisateur corrobore le lien, "medium"/"low" signifient une pure estimation IA. Privilégie les synergies "high" pour bâtir les "valueChains" et macro-besoins les plus mis en avant ; une chaîne construite uniquement sur des synergies "low" doit rester marginale, pas headline.
- Le "recommendedActionPlan" ne doit citer que des contacts, entreprises ou organisations RÉELLEMENT présents dans les données agrégées. N'invente JAMAIS un tiers plausible (syndicat professionnel, entreprise cible, segment de marché précis) qui n'apparaît nulle part dans <aggregated_batch_data> — une action peut rester généraliste ("Prendre contact avec X pour explorer Y") plutôt que de nommer une entité non vérifiée.
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
        macroNeeds: filterMacroNeeds(parsed.macroNeeds),
        valueChains: parsed.valueChains ?? []
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
    const status = err?.statusCode === 429 ? 429 : 500;
    res.status(status).json({ error: err.message || 'Oracle reduce failed', rateLimited: status === 429 });
  }
}
