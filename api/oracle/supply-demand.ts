import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Mistral } from '@mistralai/mistralai';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

// Step 4/4 of the Oracle pipeline (see topology.ts, map-batch.ts, reduce.ts).
// Its own contact+notes fetch (a full catalog of skills/needs across the
// space), independent of the batching used by map-batch.ts.
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

interface SupplyDemandEntry {
  need: string;
  demanders: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  gapLevel: 'covered' | 'partial' | 'opportunity';
  opportunityForUser: boolean;
}

// Same formula as topology.ts / map-batch.ts rely on transitively — if this
// hash is unchanged for every contact in the scope, the cached matrix is
// still valid and the Mistral call can be skipped entirely.
function contactContentHash(c: any, notes: any[]): string {
  const noteText = notes.filter((n: any) => n.contact_id === c.id).map((n: any) => n.content).sort().join('|');
  const skills = Array.isArray(c.skills) ? [...c.skills].sort().join(',') : '';
  const needs = Array.isArray(c.inferred_needs) ? [...c.inferred_needs].sort().join(',') : '';
  const raw = [c.first_name, c.last_name, c.job_title, c.company, skills, needs, noteText].join('::');
  return createHash('sha256').update(raw).digest('hex');
}

function scopeContactsHash(contacts: any[], notes: any[]): string {
  const parts = contacts
    .map(c => `${c.id}:${contactContentHash(c, notes)}`)
    .sort();
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

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

// Twin of topology.ts's enrichment gate — keep in sync. A contact with only
// a name gives the matrix nothing real to match on.
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
- RIGUEUR AVANT TOUT : ne crée une ligne QUE si des demanders ET des suppliers réels et nommés existent dans le catalogue. Il vaut mieux 3 lignes solides et vérifiables que 12 lignes spéculatives. Si le catalogue ne contient aucun besoin exploitable, renvoie un tableau vide — c'est une réponse valide et attendue.
- N'invente JAMAIS un besoin, une compétence ou une mise en relation qui n'est pas ancrée dans les données du contact (skills / needs / notes). Ne déduis pas un besoin du seul poste si aucune donnée ne l'appuie.
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

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${auth.token}` } }
    });

    let contactsQuery = userSupabase.from('contacts').select('*').order('first_name');
    if (spaceId) contactsQuery = contactsQuery.eq('space_id', spaceId);
    const { data: rawContacts, error: contactsError } = await contactsQuery;
    if (contactsError) { res.status(500).json({ error: contactsError.message }); return; }
    if (!rawContacts || rawContacts.length === 0) {
      res.status(200).json([]);
      return;
    }

    const rawContactIds = rawContacts.map(c => c.id);
    const { data: notes, error: notesError } = await userSupabase.from('notes').select('*').in('contact_id', rawContactIds);
    if (notesError) { res.status(500).json({ error: notesError.message }); return; }

    // Enrichment gate — only contacts with a real signal enter the matrix.
    const noteCountById = new Map<string, number>();
    (notes || []).forEach((n: any) => noteCountById.set(n.contact_id, (noteCountById.get(n.contact_id) || 0) + 1));
    const contacts = rawContacts.filter(c => isAnalyzableContact(c, noteCountById));
    if (contacts.length === 0) {
      res.status(200).json([]);
      return;
    }

    const contactIds = contacts.map(c => c.id);

    const { data: visibility, error: visibilityError } = await userSupabase
      .from('contacts_visible')
      .select('id, is_unlocked')
      .in('id', contactIds);
    if (visibilityError) { res.status(500).json({ error: visibilityError.message }); return; }

    const visibleIds = new Set((visibility || []).filter(v => v.is_unlocked).map(v => v.id));
    const lockedNames = contacts.filter(c => !visibleIds.has(c.id)).map(c => `${c.first_name} ${c.last_name}`);

    const scopeKey = spaceId || `user:${auth.userId}`;
    const contactsHash = scopeContactsHash(contacts, notes || []);

    // Best-effort cache: if nothing in this scope changed since the last
    // computation, skip the Mistral call entirely.
    try {
      const { data: cacheRow } = await userSupabase
        .from('oracle_supply_demand_cache')
        .select('contacts_hash, result')
        .eq('scope_key', scopeKey)
        .maybeSingle();
      if (cacheRow && cacheRow.contacts_hash === contactsHash) {
        res.status(200).json(cacheRow.result);
        return;
      }
    } catch (err) {
      console.warn('supply-demand: oracle_supply_demand_cache unavailable (non-fatal).', err);
    }

    const client = new Mistral({ apiKey });
    const userContext = userProfile ? buildUserContext(userProfile) : '';
    const lockedContext = buildLockedContext(lockedNames);

    const supplyDemand = await buildSupplyDemandMatrix(client, contacts, notes || [], userContext, lockedContext);

    try {
      await userSupabase.from('oracle_supply_demand_cache').upsert({
        scope_key: scopeKey,
        space_id: spaceId || null,
        owner_id: auth.userId,
        contacts_hash: contactsHash,
        result: supplyDemand,
        updated_at: new Date().toISOString()
      }, { onConflict: 'scope_key' });
    } catch (err) {
      console.warn('supply-demand: failed to persist oracle_supply_demand_cache (non-fatal).', err);
    }

    // demanders/suppliers only carry id+name, already minimal — no further
    // redaction needed (a locked contact's name is already visible per the
    // read-masking rules; only role/company/notes are hidden).
    res.status(200).json(supplyDemand);
  } catch (err: any) {
    console.error('Oracle supply-demand failure:', err);
    res.status(500).json({ error: err.message || 'Oracle supply-demand failed' });
  }
}
