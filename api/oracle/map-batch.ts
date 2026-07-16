import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Mistral } from '@mistralai/mistralai';
import { createClient } from '@supabase/supabase-js';

// Step 2/4 of the Oracle pipeline (see topology.ts, reduce.ts,
// supply-demand.ts). One call per batch of contacts produced by topology.ts,
// each well under any Vercel plan's timeout.
//
// Self-contained on purpose — no imports from ../_lib or src/lib. An earlier
// cross-file import inside api/ caused a deployment-only crash that was hard
// to diagnose without live logs.

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
    reason: string;
    confidence: 'high' | 'medium' | 'low';
    evidence: string;
  }[];
  keyCompetencies: string[];
}

const FALLBACK_BATCH_RESULT: MistralBatchResult = { recurrentNeeds: [], immediateSynergies: [], keyCompetencies: [] };
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

IMPORTANT : cet alignement sert à PRIORISER, jamais à faire disparaître une observation réelle. "recurrentNeeds" et "keyCompetencies" sont un résumé factuel de ce lot de contacts — ils doivent exister dès que le lot contient des données exploitables, même si rien ne colle au profil de l'utilisateur. Seules "immediateSynergies" (qui exigent une vraie complémentarité entre deux contacts) peuvent légitimement rester vides.`;
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

async function processContactBatch(client: Mistral, batch: any[], notes: any[], userContext: string, lockedContext: string): Promise<MistralBatchResult> {
  // Tag names spell out the provenance explicitly: skills/needs are an AI
  // guess derived from job title/sector at enrichment time (see
  // enrichProfileFromScraping / autoEnrichContact prompts) — never read from
  // this contact's actual notes. <notes_utilisateur> is the one field the
  // user personally wrote about this contact, so it's the only genuinely
  // verified signal. The model needs this distinction spelled out to avoid
  // treating a guess and a fact as equally solid ground for "confidence".
  const batchData = batch.map(c => {
    const contactNotes = notes.filter(n => n.contact_id === c.id).map(n => n.content).join(' | ');
    const skills: string[] = Array.isArray(c.skills) ? c.skills : [];
    const needs: string[] = Array.isArray(c.inferred_needs) ? c.inferred_needs : [];
    return `<contact id="${c.id}">
  <name>${c.first_name} ${c.last_name}</name>
  <role>${c.job_title || 'Inconnu'}</role>
  <company>${c.company || 'Inconnue'}</company>
  <skills_estimees_ia>${skills.length > 0 ? skills.join(', ') : 'Non renseignées'}</skills_estimees_ia>
  <besoins_estimes_ia>${needs.length > 0 ? needs.join(', ') : 'Non renseignés'}</besoins_estimes_ia>
  <notes_utilisateur>${contactNotes || 'Aucune note disponible'}</notes_utilisateur>
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

<hierarchie_de_confiance>
<skills_estimees_ia> et <besoins_estimes_ia> sont une ESTIMATION automatique déduite du poste/secteur au moment de l'enrichissement — jamais vérifiée, jamais tirée d'une vraie conversation avec ce contact. <notes_utilisateur> est écrit par l'utilisateur lui-même à partir de sa connaissance réelle du contact — c'est la seule donnée réellement vérifiée. Un contact sans notes n'a AUCUNE donnée vérifiée, seulement une estimation générique.
</hierarchie_de_confiance>

<rules>
- RIGUEUR AVANT TOUT : ne propose une synergie QUE si elle s'appuie sur des données réelles du contact (poste, compétences, besoins, notes). Il vaut mieux renvoyer 0 ou 1 synergie SOLIDE qu'un lot de synergies plausibles mais inventées. Un tableau "immediateSynergies" vide est une réponse VALIDE et attendue quand les données ne soutiennent aucune synergie crédible.
- N'invente JAMAIS un besoin, une compétence, un rôle ou une identité qui ne figure pas explicitement dans les balises <contact>. Si un contact n'a qu'un nom et aucune autre donnée, ne construis AUCUNE synergie autour de lui.
- Chaque synergie doit citer, dans sa "reason", l'élément concret (compétence, besoin ou note) de CHAQUE contact qui la justifie — pas une généralité.
- Chaque synergie porte un "confidence" honnête, calibré selon la hiérarchie ci-dessus : "high" UNIQUEMENT si au moins un des deux contacts a une <notes_utilisateur> qui corrobore directement le lien (le besoin/la compétence apparaît dans une vraie note, pas seulement dans l'estimation IA). "medium" si le lien ne s'appuie QUE sur <skills_estimees_ia>/<besoins_estimes_ia> des deux côtés, sans corroboration par une note réelle — c'est plausible mais reste une estimation contre une estimation. "low" pour une hypothèse plus lointaine que tu choisis quand même de proposer. N'attribue JAMAIS "high" à une synergie qui ne repose que sur des champs estimés par l'IA.
- "evidence" cite le texte EXACT (mot pour mot) tiré de <skills_estimees_ia>, <besoins_estimes_ia> ou <notes_utilisateur> qui fonde la synergie — pas une paraphrase. Préfère toujours citer <notes_utilisateur> quand elle contient l'élément pertinent, plutôt qu'un champ estimé.
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
      "reason": "Explication concrète et actionnable de la synergie, même indirecte",
      "confidence": "high | medium | low",
      "evidence": "Citation exacte de la donnée (skill/need/note) qui justifie la synergie"
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

    const { contactIds, lockedContactNames, userProfile, clusterId, contactIdsHash, spaceId } = req.body || {};
    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      res.status(400).json({ error: 'contactIds must be a non-empty array' });
      return;
    }

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${auth.token}` } }
    });

    const { data: contacts, error: contactsError } = await userSupabase.from('contacts').select('*').in('id', contactIds);
    if (contactsError) { res.status(500).json({ error: contactsError.message }); return; }
    if (!contacts || contacts.length === 0) {
      res.status(200).json({ ...FALLBACK_BATCH_RESULT });
      return;
    }

    const { data: notes, error: notesError } = await userSupabase.from('notes').select('*').in('contact_id', contactIds);
    if (notesError) { res.status(500).json({ error: notesError.message }); return; }

    const { data: visibility, error: visibilityError } = await userSupabase
      .from('contacts_visible')
      .select('id, is_unlocked')
      .in('id', contactIds);
    if (visibilityError) { res.status(500).json({ error: visibilityError.message }); return; }

    const visibleIds = new Set((visibility || []).filter(v => v.is_unlocked).map(v => v.id));
    const isLocked = (id?: string) => Boolean(id) && !visibleIds.has(id as string);

    const client = new Mistral({ apiKey });
    const userContext = userProfile ? buildUserContext(userProfile) : '';
    const lockedContext = buildLockedContext(Array.isArray(lockedContactNames) ? lockedContactNames : []);

    const result = await processContactBatch(client, contacts, notes || [], userContext, lockedContext);

    // Persist the RAW (unredacted) result for reuse by future incremental
    // runs, keyed by this cluster and the exact content hash of its members
    // at compute time — best-effort, never blocks the response.
    if (clusterId && contactIdsHash) {
      try {
        await userSupabase.from('oracle_batch_cache').upsert({
          cluster_id: clusterId,
          scope_key: spaceId || `user:${auth.userId}`,
          space_id: spaceId || null,
          owner_id: auth.userId,
          contact_ids_hash: contactIdsHash,
          result,
          updated_at: new Date().toISOString()
        }, { onConflict: 'cluster_id' });
      } catch (err) {
        console.warn('map-batch: failed to persist oracle_batch_cache (non-fatal).', err);
      }
    }

    const redacted: MistralBatchResult = {
      ...result,
      immediateSynergies: result.immediateSynergies.map(s => {
        if (isLocked(s.contactId1) || isLocked(s.contactId2)) {
          // "evidence" quotes a locked contact's note/skill verbatim — must be
          // masked here too, not just "reason", or the redaction is a leak.
          return { ...s, reason: "Synergie potentielle détectée — demandez l'accès aux contacts concernés pour voir les détails.", evidence: '' };
        }
        return s;
      })
    };

    res.status(200).json(redacted);
  } catch (err: any) {
    console.error('Oracle map-batch failure:', err);
    res.status(500).json({ error: err.message || 'Oracle map-batch failed' });
  }
}
