import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Mistral } from '@mistralai/mistralai';
import { createClient } from '@supabase/supabase-js';
import { createHash, createHmac } from 'node:crypto';

// See topology.ts — accepts the cron's short-lived oracle_cron JWT locally so a
// background job advance works with the owner's RLS, without touching the
// normal user-token path.
function verifyCronToken(token: string): string | null {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload || payload.oracle_cron !== true) return null;
    const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
    if (expected !== parts[2]) return null;
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch { return null; }
}

// Step 4/4 of the Oracle pipeline (see topology.ts, map-batch.ts, reduce.ts).
// Its own contact+notes fetch (a full catalog of skills/needs across the
// space), independent of the batching used by map-batch.ts.
//
// Self-contained on purpose — no imports from ../_lib or src/lib.

async function authenticateRequest(req: VercelRequest): Promise<{ userId: string; token: string } | null> {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  const cronSub = verifyCronToken(token);
  if (cronSub) return { userId: cronSub, token };
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
// to parse, no Mistral involved at all — the terse "Bad Request" message
// this endpoint has been observed to surface, unlike every real Mistral
// SDKError elsewhere in this pipeline, which always reads "API error
// occurred: Status X..."). Chunking keeps every single request well under
// that ceiling. This endpoint fetches the FULL network's notes/visibility in
// one shot (unlike map-batch.ts, which only ever queries one 15-30 contact
// cluster at a time), so it's the one most exposed to this.
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

// PostgREST caps every request at 1000 rows — a network over 1000 contacts was
// silently truncated to the first 1000 (alphabetical). Paginate with .range()
// so the full network is seen before it's ranked/capped for the catalog.
async function fetchAllRows<T = any>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  pageSize = 1000
): Promise<{ data: T[]; error: any }> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery(from, from + pageSize - 1);
    if (error) return { data: [], error };
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return { data: rows, error: null };
}

interface SupplyDemandEntry {
  need: string;
  rationale?: string;
  demanders: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  gapLevel: 'covered' | 'partial' | 'opportunity';
  opportunityForUser: boolean;
}

// Version tag of the SUPPLY/DEMAND prompt + catalog-building logic. Folded
// into the cache key (see scopeContactsHash) so any change here — prompt
// wording, catalog cap, contact ordering — invalidates a stale cached matrix.
// Without this, a network whose contacts didn't change kept re-serving an old
// (often EMPTY) matrix computed under the previous logic, and improvements
// never reached an already-analyzed network. BUMP when this file's prompt or
// catalog logic changes.
const SUPPLY_PROMPT_VERSION = 'supply-v3-crosspairs';

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
  return createHash('sha256').update(`${SUPPLY_PROMPT_VERSION}|${parts.join('|')}`).digest('hex');
}

// Rank a contact by how much real signal it carries, so that when the catalog
// is capped we keep the MOST matchable contacts rather than an arbitrary
// alphabetical slice. A note (verified) outweighs estimated fields; estimated
// skills/needs outweigh a bare title/company. On a 1200-contact network this
// is the difference between a useful matrix and one built on 100 people whose
// names happen to start with "A".
function contactRichness(c: any, noteCountById: Map<string, number>): number {
  const notes = noteCountById.get(c.id) || 0;
  const skills = Array.isArray(c.skills) ? c.skills.filter((s: any) => s && String(s).trim()).length : 0;
  const needs = Array.isArray(c.inferred_needs) ? c.inferred_needs.filter((n: any) => n && String(n).trim()).length : 0;
  const hasTitle = typeof c.job_title === 'string' && c.job_title.trim() ? 1 : 0;
  const hasCompany = typeof c.company === 'string' && c.company.trim() ? 1 : 0;
  const hasBio = typeof c.bio === 'string' && c.bio.trim() ? 1 : 0;
  return notes * 10 + skills * 2 + needs * 2 + hasTitle + hasCompany + hasBio;
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

ADAPTE ton analyse au profil ci-dessus. Si le poste/les compétences pointent vers un domaine précis (ex : "architecte" → immobilier/urbanisme, "développeur" → consulting tech, "avocat" → conseil juridique, "élu/politique" → influence & coalitions, "dirigeant associatif" → mécénat & partenariats), PRIORISE les opportunités ALIGNÉES avec son expertise et ses objectifs déclarés.

IMPORTANT : cet alignement détermine UNIQUEMENT "opportunityForUser" (true/false), jamais l'existence d'une ligne. Une ligne "supplyDemand" doit exister dès qu'un vrai besoin a des demanders ET des suppliers réels dans le catalogue, même si ce besoin ne sert pas directement l'utilisateur — mets simplement "opportunityForUser" à false dans ce cas plutôt que d'omettre la ligne.`;
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
  //
  // Only 2 attempts here (vs 3 in map-batch.ts/reduce.ts): this prompt carries
  // the full contact catalog in one shot (see buildSupplyDemandMatrix) and is
  // the slowest single completion in the pipeline — leaving less in-function
  // retry budget makes room for that completion time itself, instead of
  // risking the whole invocation getting killed mid-retry.
  const maxAttempts = 2;
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
      const delay = err.statusCode === 429 ? 5000 : 1000;
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

async function buildSupplyDemandMatrix(client: Mistral, contacts: any[], notes: any[], userContext: string, lockedContext: string, noteCountById: Map<string, number>): Promise<SupplyDemandEntry[]> {
  if (!contacts || contacts.length === 0) return [];

  // Key names spell out provenance explicitly: skillsEstimeesIA/besoinsEstimesIA
  // are an AI guess derived from job title/sector at enrichment time (see
  // enrichProfileFromScraping / autoEnrichContact) — never read from this
  // contact's actual notes. notesUtilisateur is what the user personally
  // wrote about this contact — the only genuinely verified signal.
  //
  // This is the ONE call in the whole pipeline that puts many contacts in a
  // single prompt, so it must be capped for maxDuration (60s, see vercel.json).
  // But on a 1200-contact network an alphabetical slice threw away 90%+ of the
  // graph and produced a near-empty matrix. Two fixes: (1) rank by real signal
  // (contactRichness) so the cap keeps the most MATCHABLE contacts, not an
  // arbitrary A-first slice; (2) raise the cap to 250 — Mistral Large handles
  // that catalog size, and the client-side retry already rides out the rate
  // limit, so the extra prompt length is an acceptable trade for real recall.
  const CATALOG_CAP = 250;
  const ranked = [...contacts].sort((a, b) => contactRichness(b, noteCountById) - contactRichness(a, noteCountById));
  const catalog = ranked.slice(0, CATALOG_CAP).map(c => {
    const contactNotes = notes.filter(n => n.contact_id === c.id).map(n => n.content).join(' | ').substring(0, 400);
    const skills: string[] = Array.isArray(c.skills) ? c.skills : [];
    const needs: string[] = Array.isArray(c.inferred_needs) ? c.inferred_needs : [];
    return {
      id: c.id,
      name: `${c.first_name} ${c.last_name}`,
      role: c.job_title || 'Inconnu',
      company: c.company || 'Inconnue',
      skillsEstimeesIA: skills, besoinsEstimesIA: needs, notesUtilisateur: contactNotes
    };
  });

  const prompt = `<role>
Tu es "Oracle MARKET", un analyste spécialisé dans la cartographie OFFRE / DEMANDE d'un réseau professionnel. Tu construis une matrice qui, pour chaque besoin identifié dans le réseau, liste QUI le demande et QUI peut le fournir.
</role>
${userContext ? `\n<user_context>\n${userContext}\n</user_context>\n` : ''}${lockedContext}
<instructions>
1. Parcours le catalogue de contacts (chacun a des compétences = OFFRE, et des besoins = DEMANDE).
2. Regroupe les besoins similaires en une même ligne "need" (ex : "trouver un développeur" et "besoin technique" → "Développement / compétence technique").
3. Pour chaque besoin, liste les "demanders" (contacts qui expriment ce besoin) et les "suppliers" (contacts dont les compétences y répondent, même indirectement). IMPORTANT : les fournisseurs sont AVANT TOUT d'AUTRES CONTACTS DU RÉSEAU, pas seulement l'utilisateur. Cherche systématiquement, pour chaque besoin d'un contact, quel(s) AUTRE(S) contact(s) du catalogue peu(ven)t y répondre — y compris entre secteurs éloignés (un besoin logistique couvert par un profil tech, un besoin de visibilité couvert par un contact média, etc.). Ces mises en relation contact↔contact sont le cœur de la valeur : ne te contente pas de lister l'utilisateur comme unique fournisseur.
4. Évalue le "gapLevel" : "opportunity" (forte demande, peu/pas de fournisseur), "partial" (partiellement couverte), "covered" (bien couverte).
5. Mets "opportunityForUser" à true si l'utilisateur (voir user_context) est bien placé pour capter cette opportunité — mais une ligne reste PLEINEMENT valable et utile même quand opportunityForUser vaut false (une mise en relation entre deux contacts du réseau qui ne concerne pas directement l'utilisateur a de la valeur).
6. Rédige un "rationale" par ligne : 2-3 phrases concrètes expliquant qui demande quoi, qui peut fournir et pourquoi, et le premier pas pour provoquer la mise en relation.
</instructions>

<hierarchie_de_confiance>
"skillsEstimeesIA" et "besoinsEstimesIA" sont une ESTIMATION automatique déduite du poste/secteur au moment de l'enrichissement — jamais vérifiée, jamais tirée d'une vraie conversation avec ce contact. "notesUtilisateur" est écrit par l'utilisateur lui-même à partir de sa connaissance réelle du contact — c'est la seule donnée réellement vérifiée. Un contact sans notes n'a AUCUNE donnée vérifiée, seulement une estimation générique.
</hierarchie_de_confiance>

<rules>
- ANCRAGE puis GÉNÉROSITÉ : chaque demander et chaque supplier doit être un contact RÉEL du catalogue avec une donnée qui le justifie (skillsEstimeesIA / besoinsEstimesIA / notesUtilisateur) — n'invente jamais un besoin, une compétence ou un contact. Mais dans cette limite, sois GÉNÉREUX : parcours tout le catalogue et remonte CHAQUE besoin qui trouve au moins un fournisseur crédible, y compris les croisements inter-secteurs non évidents. Ne te limite pas à quelques lignes autour de l'utilisateur ; un réseau de 250 contacts diversifiés contient de nombreuses complémentarités contact↔contact. Un match fondé uniquement sur des champs estimés par l'IA reste valable (marque-le "partial"/"opportunity", pas "covered").
- Calibre "gapLevel" selon la hiérarchie de confiance : ne marque "covered" que si l'offre ET la demande sont corroborées par au moins une "notesUtilisateur" réelle de chaque côté. Une estimation IA des deux côtés ne justifie jamais "covered".
- Utilise UNIQUEMENT les id/noms fournis dans le catalogue pour demanders/suppliers.
- Vise 15 à 25 lignes couvrant différents besoins et différents pôles du réseau (pas seulement le secteur de l'utilisateur). Ne renvoie un tableau vide que si le catalogue ne contient réellement aucune complémentarité.
- Réponds STRICTEMENT avec un objet JSON valide, sans markdown ni texte additionnel.
</rules>

<catalog>
${JSON.stringify(catalog, null, 2)}
</catalog>

<output_format>
{ "supplyDemand": [ { "need": "Nom clair du besoin consolidé", "rationale": "2-3 phrases : qui demande quoi, qui peut fournir et pourquoi, et le premier pas concret pour provoquer la mise en relation.", "demanders": [{ "id": "id exact", "name": "Nom" }], "suppliers": [{ "id": "id exact", "name": "Nom" }], "gapLevel": "opportunity", "opportunityForUser": true } ] }
</output_format>`;

  try {
    const text = await callMistralServer(client, prompt);
    const parsed = safeParseJSON(text);
    if (parsed && Array.isArray(parsed.supplyDemand)) {
      return parsed.supplyDemand
        .filter((e: any) => e && typeof e.need === 'string')
        .map((e: any) => ({
          need: e.need,
          rationale: typeof e.rationale === 'string' ? e.rationale : '',
          demanders: Array.isArray(e.demanders) ? e.demanders : [],
          suppliers: Array.isArray(e.suppliers) ? e.suppliers : [],
          gapLevel: ['covered', 'partial', 'opportunity'].includes(e.gapLevel) ? e.gapLevel : 'partial',
          opportunityForUser: Boolean(e.opportunityForUser)
        })) as SupplyDemandEntry[];
    }
    console.error('Mistral SUPPLY/DEMAND: réponse JSON invalide, fallback vide appliqué.', text);
    return [];
  } catch (err: any) {
    console.error('Mistral SUPPLY/DEMAND failure:', err);
    // See map-batch.ts's identical guard: a rate-limit exhaustion must not
    // masquerade as a genuine empty matrix — let it propagate so the handler
    // can report 429 distinctly.
    if (err?.statusCode === 429) throw err;
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

    const { data: rawContacts, error: contactsError } = await fetchAllRows<any>((from, to) => {
      let q = userSupabase.from('contacts').select('*').order('first_name').range(from, to);
      if (spaceId) q = q.eq('space_id', spaceId);
      return q;
    });
    if (contactsError) {
      console.error('Oracle supply-demand: contacts fetch failed', contactsError);
      res.status(500).json({ error: contactsError.message });
      return;
    }
    if (!rawContacts || rawContacts.length === 0) {
      res.status(200).json([]);
      return;
    }

    const rawContactIds = rawContacts.map(c => c.id);
    const { data: notes, error: notesError } = await selectInChunks<any>(
      chunk => userSupabase.from('notes').select('*').in('contact_id', chunk),
      rawContactIds
    );
    if (notesError) {
      console.error('Oracle supply-demand: notes fetch failed', notesError);
      res.status(500).json({ error: notesError.message });
      return;
    }

    // Enrichment gate — only contacts with a real signal enter the matrix.
    const noteCountById = new Map<string, number>();
    (notes || []).forEach((n: any) => noteCountById.set(n.contact_id, (noteCountById.get(n.contact_id) || 0) + 1));
    const contacts = rawContacts.filter(c => isAnalyzableContact(c, noteCountById));
    if (contacts.length === 0) {
      res.status(200).json([]);
      return;
    }

    const contactIds = contacts.map(c => c.id);

    const { data: visibility, error: visibilityError } = await selectInChunks<any>(
      chunk => userSupabase.from('contacts_visible').select('id, is_unlocked').in('id', chunk),
      contactIds
    );
    if (visibilityError) {
      console.error('Oracle supply-demand: visibility fetch failed', visibilityError);
      res.status(500).json({ error: visibilityError.message });
      return;
    }

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

    const supplyDemand = await buildSupplyDemandMatrix(client, contacts, notes || [], userContext, lockedContext, noteCountById);

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
    const status = err?.statusCode === 429 ? 429 : 500;
    res.status(status).json({ error: err.message || 'Oracle supply-demand failed', rateLimited: status === 429 });
  }
}
