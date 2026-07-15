import { supabase } from './supabase';

export interface TokenUsage {
  promptTokens: number;
  candidateTokens: number;
  totalTokens: number;
}

export let globalTokenUsage: TokenUsage | null = null;

export function trackGlobalUsage(usage: any) {
  if (globalTokenUsage && usage) {
    globalTokenUsage.promptTokens += usage.promptTokens || 0;
    globalTokenUsage.candidateTokens += usage.completionTokens || 0;
    globalTokenUsage.totalTokens += usage.totalTokens || 0;
  }
}

export function resetGlobalUsage() {
  globalTokenUsage = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
}

// ============================================================================
// AI keys never live in the client anymore — every Mistral/Perplexity call
// goes through an authenticated Vercel function (api/ai/*) that holds the
// real keys server-side. See api/_lib/auth.ts.
// ============================================================================

async function getAuthHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

let cachedAIStatus: { mistralConfigured: boolean; perplexityConfigured: boolean } | null = null;
let statusFetchPromise: Promise<void> | null = null;

function refreshAIStatus(): Promise<void> {
  if (!statusFetchPromise) {
    statusFetchPromise = fetch('/api/ai/status')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data) cachedAIStatus = data;
      })
      .catch(() => {
        // Network error: leave the optimistic default in place, the real
        // call will surface a clear error from the server if truly unconfigured.
      });
  }
  return statusFetchPromise;
}

refreshAIStatus();

// Optimistic default (true) until the async status check resolves, so the UI
// doesn't flash a "not configured" screen on every cold load in the common
// case where the keys ARE configured server-side.
export const isMistralConfigured = (): boolean =>
  cachedAIStatus ? cachedAIStatus.mistralConfigured : true;

export const isPerplexityConfigured = (): boolean =>
  cachedAIStatus ? cachedAIStatus.perplexityConfigured : true;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function callMistral(prompt: string, isJSON: boolean = true, model: string = 'mistral-small-latest'): Promise<string> {
  let retries = 3;
  let lastError: any = null;

  while (retries > 0) {
    try {
      const authHeader = await getAuthHeader();
      const response = await fetch('/api/ai/mistral-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          responseFormat: isJSON ? 'json_object' : undefined
        })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        lastError = new Error(err.error || `Mistral proxy error ${response.status}`);
        await sleep(response.status === 429 ? 3000 : 1000);
        retries--;
        continue;
      }

      const data = await response.json();
      trackGlobalUsage(data.usage);
      let text = data.text || (isJSON ? "{}" : "");
      if (typeof text !== 'string') text = String(text);
      return text;
    } catch (err: any) {
      lastError = err;
      await sleep(1000);
      retries--;
    }
  }
  throw lastError || new Error("Mistral API failure");
}

function safeParseJSON(text: string): any {
  try {
    let clean = text.replace(/\`\`\`json\n?/gi, '').replace(/\`\`\`\n?/gi, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error("JSON Parse Error:", err);
    return null;
  }
}

/**
 * Strategic introduction between two contacts
 */
export interface StrategicIntro {
  contactA: { id: string; name: string; role: string; company: string };
  contactB: { id: string; name: string; role: string; company: string };
  reason: string;
  valueForA: string;
  valueForB: string;
  valueForUser: string;
  urgency: 'immediate' | 'short-term' | 'medium-term';
  similarityScore: number;
}

/**
 * Network Genome (Valuation & DNA)
 */
export interface NetworkGenome {
  valuationScore: number;
  valuationReasoning: string;
  networkPersona: string;
  topStrengths: string[];
  blindSpots: string[];
}

/**
 * Reciprocity Imbalance (Giver/Taker CRM)
 */
export interface ReciprocityImbalance {
  contactId: string;
  contactName: string;
  status: 'user_owes_them' | 'they_owe_user';
  reason: string;
  recommendedAction: string;
}

// --- PORTED HELPERS ---
export interface SynergyResult {
  title: string;
  description: string;
  sourceContact: { id: string; name: string; role: string; company: string };
  targetContact: { id: string; name: string; role: string; company: string };
  matchReason: string;
  recommendedIntroPath: string;
}

export interface ProjectIdea {
  title: string;
  tagline: string;
  problem: string;
  solution: string;
  techStackSuggested: string[];
  involvedContacts: { id: string; name: string; role: string; contribution: string }[];
  marketPotential: string;
  difficulty: 'Facile' | 'Moyen' | 'Difficile';
}

export interface WarmIntroSuggestion {
  targetName: string;
  targetCompany: string;
  connectorName: string;
  connectorCloseness: number; // 1-5 scale
  introEmailDraft: string;
  reason: string;
}

export interface EnrichmentCitation {
  title: string;
  url: string;
}

export interface EnrichmentResult {
  industry: string;
  companySize: string;
  bio: string;
  skills: string[];
  inferredNeeds: string[];
  aiContext: string;
  citations?: EnrichmentCitation[];
}

export interface GroupSynergyResult {
  clusterName: string;
  commonNeeds: string[];
  members: { id: string; name: string; role: string; company: string }[];
  potentialService: string;
  matchReason: string;
}

export interface UserOpportunityResult {
  opportunityTitle: string;
  targetAudience: string;
  problemSolved: string;
  proposedSolution: string;
  relevantContacts: { id: string; name: string; role: string; company: string }[];
  actionPlan: string;
}

/**
 * 1. Synergy Detector
 * Compares contacts' needs and skills to find complementary matches
 */
export async function detectSynergies(contacts: any[], notes: any[]): Promise<SynergyResult[]> {
  // Prepare a condensed version of contacts and notes to conserve tokens
  const networkData = contacts.map(c => {
    const contactNotes = notes
      .filter(n => n.contact_id === c.id)
      .map(n => n.content)
      .join(" | ");
    return {
      id: c.id,
      name: `${c.first_name} ${c.last_name}`,
      company: c.company || 'Inconnue',
      job_title: c.job_title || 'Inconnu',
      industry: c.industry || 'Inconnu',
      bio: c.bio || '',
      notes: contactNotes
    };
  });

  const prompt = `Tu es l'algorithme "Oracle" de Circl Web. Ton r├┤le est de scanner ce r├®seau de contacts et d'identifier des synergies cach├®es.
Trouve des bin├┤mes de contacts (Contact A et Contact B) o├╣ l'un poss├¿de une comp├®tence, une ressource ou un profil qui peut r├®soudre un probl├¿me ou r├®pondre ├á un besoin exprim├® par l'autre dans ses notes/bio.

Voici les donn├®es r├®seau en JSON :
${JSON.stringify(networkData, null, 2)}

Retourne un tableau JSON contenant jusqu'├á 5 synergies les plus fortes avec la structure suivante :
[
  {
    "title": "Nom accrocheur de la synergie (ex: Synergie Financement ou Synergie Dev Mobile)",
    "description": "Explication de la synergie en une phrase",
    "sourceContact": { "id": "ID du contact ayant le besoin", "name": "Nom complet", "role": "Poste", "company": "Entreprise" },
    "targetContact": { "id": "ID du contact ayant la solution/comp├®tence", "name": "Nom complet", "role": "Poste", "company": "Entreprise" },
    "matchReason": "Explication d├®taill├®e de pourquoi ces deux personnes doivent se parler (en fran├ºais, max 3 phrases)",
    "recommendedIntroPath": "Comment le propri├®taire du r├®seau (l'utilisateur) doit-il les connecter (ex: pr├®senter A ├á B ├á propos de X)"
  }
]

R├¿gle absolue : Ne propose que des synergies r├®alistes bas├®es sur les donn├®es fournies. R├®ponds uniquement avec le JSON.`;

  let text = await callMistral(prompt, true);
  
  
  text = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
  return JSON.parse(text);
}

/**
 * 2. Project Ideator
 * Scans the network to find potential SaaS or Services to build using own skills and contacts
 */
export async function brainstormProjects(
  mySkills: string[],
  contacts: any[],
  notes: any[]
): Promise<ProjectIdea[]> {
  const networkData = contacts.map(c => {
    const contactNotes = notes
      .filter(n => n.contact_id === c.id)
      .map(n => n.content)
      .join(" | ");
    return {
      id: c.id,
      name: `${c.first_name} ${c.last_name}`,
      company: c.company || 'Inconnue',
      job_title: c.job_title || 'Inconnu',
      industry: c.industry || 'Inconnu',
      notes: contactNotes
    };
  });

  const prompt = `Tu es un consultant en business et innovation. L'utilisateur veut cr├®er un projet (SaaS, service de consulting ou micro-logiciel) en s'appuyant sur ses propres comp├®tences et sur les besoins non r├®solus de son r├®seau de contacts.

Mes comp├®tences (l'utilisateur) :
${JSON.stringify(mySkills)}

Le r├®seau de contacts et leurs besoins identifi├®s (dans leurs notes de rendez-vous) :
${JSON.stringify(networkData, null, 2)}

Propose 3 id├®es de projets de services ou de produits num├®riques ├á d├®velopper. Pour chaque id├®e, associe l'utilisateur avec un ou plusieurs contacts de son r├®seau qui pourraient ├¬tre des cofondateurs, des apporteurs d'affaires, des conseillers ou des premiers clients (design partners).

Format de r├®ponse attendu (Strictement ce JSON) :
[
  {
    "title": "Nom du Projet",
    "tagline": "Une phrase d'accroche r├®sumant la proposition de valeur",
    "problem": "Le probl├¿me identifi├® dans le r├®seau qui a inspir├® cette id├®e",
    "solution": "Ce que fait le produit/service et comment il r├®sout le probl├¿me en utilisant les comp├®tences de l'utilisateur",
    "techStackSuggested": ["React", "Supabase", "Mistral API", "etc."],
    "involvedContacts": [
      { "id": "ID du contact", "name": "Nom complet", "role": "Poste", "contribution": "Son r├┤le dans le projet (ex: Premier client test, Conseiller sectoriel, Associ├® commercial)" }
    ],
    "marketPotential": "Estimation du potentiel de march├® (ex: niche B2B, fort potentiel SaaS, etc.)",
    "difficulty": "Facile" | "Moyen" | "Difficile"
  }
]`;

  let text = await callMistral(prompt, true);
  
  
  text = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
  return JSON.parse(text);
}

/**
 * 3. Warm Intro Path Suggestion
 */
export async function suggestWarmIntros(
  contacts: any[],
  targetCompany: string,
  targetRole: string
): Promise<WarmIntroSuggestion[]> {
  const networkData = contacts.map(c => ({
    name: `${c.first_name} ${c.last_name}`,
    company: c.company || '',
    job_title: c.job_title || '',
    industry: c.industry || '',
    location: c.location || ''
  }));

  const prompt = `L'utilisateur cherche ├á entrer en contact avec quelqu'un occupant le poste de "${targetRole}" au sein de l'entreprise "${targetCompany}".
Analyse la liste des contacts de l'utilisateur et trouve les 3 meilleurs interm├®diaires (connecteurs) qui travaillent dans la m├¬me bo├«te, le m├¬me secteur, ou qui ont un profil qui faciliterait une introduction "warm".

R├®seau disponible :
${JSON.stringify(networkData, null, 2)}

Pour chaque connecteur identifi├®, g├®n├¿re un e-mail type en fran├ºais que l'utilisateur peut lui envoyer pour demander la mise en relation.

Format attendu :
[
  {
    "targetName": "Nom de la cible (ou 'Un profil cible' si inconnu)",
    "targetCompany": "${targetCompany}",
    "connectorName": "Nom du contact interm├®diaire identifi├®",
    "connectorCloseness": 4, // Note de 1 (faible) ├á 5 (tr├¿s proche) bas├®e sur la pertinence
    "reason": "Pourquoi ce contact est un bon connecteur (ex: travaille dans le m├¬me secteur ou a travaill├® chez cette cible)",
    "introEmailDraft": "Le projet d'e-mail complet r├®dig├® de mani├¿re professionnelle et chaleureuse en fran├ºais"
  }
]`;

  let text = await callMistral(prompt, true);
  
  
  text = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
  return JSON.parse(text);
}

/**
 * 4. Scraping and enrichment engine (Simulated / AI-powered)
 * Takes raw text from public pages and structures it.
 */
export async function enrichProfileFromScraping(
  name: string,
  company: string,
  scrapedText: string
): Promise<EnrichmentResult> {
  const prompt = `Tu es un agent d'enrichissement de donn├®es de contact.
├Ç partir des informations brutes scrapp├®es sur internet concernant ${name} qui travaille chez ${company}, extrais et structure les informations de profil.

Texte brut scrapp├® :
\"\"\"
${scrapedText}
\"\"\"

Retourne STRICTEMENT le JSON suivant :
{
  "industry": "secteur d'activit├® d├®duit (ex: FinTech, SaaS, Sant├®)",
  "companySize": "Taille estim├®e de l'entreprise (ex: 1-10, 11-50, 51-200, 201-1000, 1000+)",
  "bio": "R├®sum├® de son profil professionnel en 1 ou 2 phrases concises",
  "skills": ["liste de 3 ├á 5 comp├®tences cl├®s extraites, ex: React, Growth Hacking, Vente"],
  "inferredNeeds": ["liste de 2 ├á 3 besoins ou challenges potentiels d├®duits de son poste ou secteur, ex: Recrutement technique, Automatisation CRM"],
  "aiContext": "Un paragraphe d'analyse contextuelle destin├® ├á l'utilisateur pour l'aider ├á aborder ce contact lors d'un rendez-vous."
}

R├¿gle : Reste factuel, ne sur-interpr├¿te pas si le texte ne contient rien de pertinent.`;

  let text = await callMistral(prompt, true);
  
  
  text = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
  return JSON.parse(text);
}

export interface ContactSynergy {
  title: string;
  description: string;
  targetContact: { id: string; name: string; role: string; company: string };
  matchReason: string;
  recommendedIntroPath: string;
}

/**
 * 5. Specific Contact Synergy Detector
 * Compares a single contact's needs and skills with the rest of the network to find matches
 */
export async function detectContactSynergies(
  selectedContact: any,
  contacts: any[],
  notes: any[]
): Promise<ContactSynergy[]> {
  // Exclude the selected contact from the potential target list
  const otherContacts = contacts.filter(c => c.id !== selectedContact.id);
  if (otherContacts.length === 0) return [];

  const selectedContactNotes = notes
    .filter(n => n.contact_id === selectedContact.id)
    .map(n => n.content)
    .join(" | ");

  const selectedContactData = {
    id: selectedContact.id,
    name: `${selectedContact.first_name} ${selectedContact.last_name}`,
    company: selectedContact.company || 'Inconnue',
    job_title: selectedContact.job_title || 'Inconnu',
    industry: selectedContact.industry || 'Inconnu',
    bio: selectedContact.bio || '',
    notes: selectedContactNotes
  };

  const networkData = otherContacts.map(c => {
    const contactNotes = notes
      .filter(n => n.contact_id === c.id)
      .map(n => n.content)
      .join(" | ");
    return {
      id: c.id,
      name: `${c.first_name} ${c.last_name}`,
      company: c.company || 'Inconnue',
      job_title: c.job_title || 'Inconnu',
      industry: c.industry || 'Inconnu',
      bio: c.bio || '',
      notes: contactNotes
    };
  });

  const prompt = `Tu es l'algorithme "Oracle" de Circl Web. Ton r├┤le est de scanner le r├®seau pour identifier des synergies entre un contact d'int├®r├¬t sp├®cifique et les autres membres du r├®seau.

Voici le contact d'int├®r├¬t s├®lectionn├® :
${JSON.stringify(selectedContactData, null, 2)}

Voici le reste du r├®seau de contacts disponible en JSON :
${JSON.stringify(networkData, null, 2)}

Identifie s'il existe des opportunit├®s de synergie claires et pertinentes (jusqu'├á 3 max) entre ce contact s├®lectionn├® et les autres membres du r├®seau. Par exemple, l'un a un besoin d'aide ou un projet ├á lancer, et l'autre a la comp├®tence, l'int├®r├¬t ou les ressources n├®cessaires.

Retourne un tableau JSON contenant les synergies trouv├®es avec cette structure exacte :
[
  {
    "title": "Nom de la synergie (ex: Synergie Recrutement Tech ou Synergie Co-investissement)",
    "description": "R├®sum├® court de la synergie en une phrase",
    "targetContact": { "id": "ID du contact compl├®mentaire trouv├®", "name": "Nom complet", "role": "Poste", "company": "Entreprise" },
    "matchReason": "Explication claire de pourquoi ces deux personnes doivent entrer en relation (en fran├ºais, max 3 phrases)",
    "recommendedIntroPath": "Comment l'utilisateur peut les mettre en relation (ex: Proposer ├á A d'accompagner B sur le sujet Y)"
  }
]

R├¿gle absolue : Ne propose que des synergies r├®alistes bas├®es sur les donn├®es fournies. S'il n'y a aucune synergie ├®vidente ou sens├®e, renvoie un tableau vide []. R├®ponds uniquement avec le JSON.`;

  let text = await callMistral(prompt, true);
  
  
  text = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
  return JSON.parse(text);
}

/**
 * Validates that a contact has real usable identifying data for enrichment.
 * Returns false for phone numbers as names, single-word entries, company names as contacts, etc.
 */
function isValidContactForEnrichment(contact: {
  first_name: string;
  last_name: string;
  company?: string;
}): boolean {
  const fn = (contact.first_name || '').trim();
  const ln = (contact.last_name || '').trim();

  // Must have both first and last name
  if (!fn || !ln) return false;

  // Reject entries where first_name looks like a phone number
  if (/^[+\d\s\-().]{6,}$/.test(fn)) return false;

  // Reject entries where first_name looks like an email
  if (fn.includes('@')) return false;

  // Reject very short or clearly invalid last names (single char)
  if (ln.length < 2) return false;

  // Reject if first_name is all uppercase (likely a company abbreviation)
  if (fn === fn.toUpperCase() && fn.length > 3) return false;

  return true;
}

/**
 * 6. Auto Enrichment (Batch-safe) ÔÇö with Google Search grounding via REST API.
 * Uses the Mistral REST API directly (same as Edge Function) so Google Search
 * is available in the browser without needing a backend.
 * Skips contacts with invalid/insufficient identifying data to avoid hallucinations.
 */
export async function autoEnrichContact(contact: {
  first_name: string;
  last_name: string;
  company?: string;
  job_title?: string;
  industry?: string;
  bio?: string;
  ai_context?: string;
  location?: string;
}): Promise<EnrichmentResult> {
  // Validate before even calling the API
  if (!isValidContactForEnrichment(contact)) {
    throw new Error(`Données insuffisantes ou invalides pour enrichir "${contact.first_name} ${contact.last_name}"`);
  }

  const hasExistingContent = Boolean(contact.bio?.trim() || contact.ai_context?.trim());

  const existingContextBlock = hasExistingContent
    ? `\nL'utilisateur a déjà renseigné manuellement les informations suivantes sur ce contact — NE LES EFFACE PAS :
${contact.bio?.trim() ? `Bio existante : ${contact.bio.trim()}` : ''}
${contact.ai_context?.trim() ? `Contexte existant : ${contact.ai_context.trim()}` : ''}
`
    : '';

  const prompt = `Tu es un assistant d'enrichissement de contacts professionnels B2B.
Recherche sur le web des informations RÉELLES et VÉRIFIABLES sur ce contact professionnel.

Nom complet : ${contact.first_name} ${contact.last_name}
Poste : ${contact.job_title || 'Non renseigné'}
Entreprise : ${contact.company || 'Non renseignée'}
Secteur déclaré : ${contact.industry || 'Non renseigné'}
Localisation : ${contact.location || 'Non renseignée'}
${existingContextBlock}
${hasExistingContent
  ? `RÈGLE ABSOLUE : Utilise les informations déjà renseignées ci-dessus comme BASE de vérité. Ta recherche web doit COMPLÉTER et ENRICHIR cette base, pas la remplacer. Si tes recherches confirment ou précisent ce qui est déjà écrit, intègre-le dans une version enrichie. Si tu ne trouves rien de nouveau, renvoie la bio/le contexte existants tels quels plutôt que "null" — ne fais JAMAIS régresser une information déjà présente.`
  : `RÈGLE ABSOLUE : Si tu n'as pas assez d'informations vérifiables, mets "null" plutôt qu'inventer.`}
Ne génère JAMAIS de bio générique comme "professionnel chevronné" ou "experte en marketing digital".
La bio doit être SPÉCIFIQUE à cette personne et cette entreprise.

Retourne UNIQUEMENT un objet JSON valide avec cette structure exacte, sans markdown ni code blocks autour :
{
  "industry": "secteur précis ou null si inconnu",
  "companySize": "taille estimée (1-10 | 11-50 | 51-200 | 201-1000 | 1000+) ou null",
  "bio": "bio SPÉCIFIQUE et VÉRIFIABLE en 1-2 phrases, ou null si pas assez d'info",
  "skills": ["compétences spécifiques au poste/secteur"],
  "inferredNeeds": ["défis spécifiques à ce type de rôle dans ce secteur"],
  "aiContext": "conseil concret et personnalisé sur comment aborder ce contact, ou null si pas assez d'info"
}`;

  const authHeader = await getAuthHeader();
  const response = await fetch('/api/ai/perplexity-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: 'You are a strict data extraction assistant. Always output only valid JSON without any markdown or extra text.' },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Perplexity proxy error ${response.status}`);
  }

  const data = await response.json();
  let text = data.text || '{}';
  const citations: EnrichmentCitation[] = Array.isArray(data.citations) ? data.citations : [];

  // Sanitize markdown wrappers if present
  text = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();

  try {
    return { ...JSON.parse(text), citations };
  } catch {
    // Cleanup common LLM JSON issues: trailing commas, etc.
    let cleaned = text.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1) cleaned = cleaned.substring(start, end + 1);
    return { ...JSON.parse(cleaned), citations };
  }
}

/**
 * 7. Advanced Group Synergies
 * Analyzes the entire network to find clusters of people with common needs/interests.
 */
export async function detectGroupSynergies(contacts: any[], notes: any[]): Promise<GroupSynergyResult[]> {
  const networkData = contacts.map(c => {
    const contactNotes = notes.filter(n => n.contact_id === c.id).map(n => n.content).join(" | ");
    return {
      id: c.id,
      name: `${c.first_name} ${c.last_name}`,
      company: c.company || 'Inconnue',
      role: c.job_title || 'Inconnu',
      needs: c.inferred_needs || [],
      skills: c.skills || [],
      bio: c.bio || '',
      notes: contactNotes
    };
  });

  const prompt = `Tu es un expert en analyse de r├®seaux (Network Science). Ton but est d'analyser ce r├®seau professionnel pour identifier des "clusters" (groupes de personnes) ayant des besoins, d├®fis ou int├®r├¬ts communs.

Voici les membres du r├®seau avec leurs besoins, comp├®tences et notes contextuelles :
${JSON.stringify(networkData, null, 2)}

Analyse tout le r├®seau et identifie jusqu'├á 4 groupes de personnes (minimum 2 personnes par groupe) qui partagent une probl├®matique majeure ou qui auraient int├®r├¬t ├á collaborer ensemble.

Retourne UNIQUEMENT un tableau JSON valide avec cette structure exacte :
[
  {
    "clusterName": "Nom accrocheur du groupe (ex: Les pionniers de l'IA RH)",
    "commonNeeds": ["Besoin majeur partag├® 1", "Besoin partag├® 2"],
    "members": [
      { "id": "ID du contact", "name": "Nom complet", "role": "Poste", "company": "Entreprise" }
    ],
    "potentialService": "Id├®e de service, produit, ou ├®v├®nement qui pourrait r├®soudre leur probl├¿me commun",
    "matchReason": "Explication d├®taill├®e de pourquoi ces personnes forment un groupe coh├®rent et ce qu'elles ont ├á gagner ├á se rencontrer"
  }
]`;

  let text = await callMistral(prompt, true);
  
  
  text = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
  return JSON.parse(text);
}

/**
 * 8. User Opportunities Brainstorming
 * Proposes specific services or projects the SaaS user can launch to serve network clusters.
 */
export async function brainstormUserOpportunities(userProfile: any, contacts: any[], notes: any[]): Promise<UserOpportunityResult[]> {
  const networkData = contacts.map(c => {
    const contactNotes = notes.filter(n => n.contact_id === c.id).map(n => n.content).join(" | ");
    return {
      id: c.id,
      name: `${c.first_name} ${c.last_name}`,
      company: c.company || '',
      role: c.job_title || '',
      needs: c.inferred_needs || [],
      bio: c.bio || '',
      notes: contactNotes
    };
  });

  const prompt = `Tu es un conseiller strat├®gique (Business Strategist). Ton but est d'analyser le r├®seau de l'utilisateur pour lui sugg├®rer des offres, services ou projets tr├¿s concrets qu'il pourrait cr├®er pour mon├®tiser son r├®seau ou y apporter de la valeur, en te basant sur SON profil.

Voici le profil de l'utilisateur (celui qui poss├¿de ce r├®seau) :
${JSON.stringify(userProfile, null, 2)}

Voici les contacts de son r├®seau avec leurs besoins et contextes :
${JSON.stringify(networkData, null, 2)}

Identifie les plus grandes opportunit├®s (jusqu'├á 4) o├╣ les comp├®tences de l'utilisateur croisent un besoin partag├® par plusieurs contacts de son r├®seau.

Retourne UNIQUEMENT un tableau JSON valide avec cette structure exacte :
[
  {
    "opportunityTitle": "Nom de l'offre/projet (ex: Cr├®ation d'une formation IA pour les RH)",
    "targetAudience": "Description du segment cible dans le r├®seau",
    "problemSolved": "Quel probl├¿me profond cette opportunit├® r├®sout-elle ?",
    "proposedSolution": "Comment l'utilisateur peut-il utiliser ses comp├®tences pour r├®pondre ├á ce besoin ?",
    "relevantContacts": [
      { "id": "ID du contact cible", "name": "Nom", "role": "Poste", "company": "Entreprise" }
    ],
    "actionPlan": "Les 3 prochaines ├®tapes concr├¿tes pour lancer cette opportunit├®."
  }
]`;

  let text = await callMistral(prompt, true);
  
  
  text = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
  return JSON.parse(text);
}

/**
 * 9. Auto-Enrich User Profile (Perplexity)
 */
export async function autoEnrichUserProfile(
  name: string, 
  company: string, 
  role: string,
  existingProjects?: string,
  existingNeeds?: string
): Promise<any> {
  const prompt = `Tu es un assistant d'analyse de profil B2B. Fais une recherche approfondie sur cette personne.
Nom : ${name}
Poste : ${role}
Entreprise : ${company}

L'utilisateur a déjà renseigné les informations suivantes sur lui-même :
Projets actuels : ${existingProjects || 'Non renseigné'}
Besoins/Défis : ${existingNeeds || 'Non renseigné'}

Trouve ses compétences probables, et ENRICHIS ses projets et défis en intégrant intelligemment ce qu'il a déjà écrit avec tes nouvelles trouvailles (ne supprime pas ce qu'il a écrit, complète-le !).
Retourne UNIQUEMENT un objet JSON valide avec cette structure exacte :
{
  "skills": ["Compétence 1", "Compétence 2"],
  "currentProjects": "Texte combiné des projets existants et de tes ajouts...",
  "needs": "Texte combiné des besoins existants et de tes ajouts..."
}`;

  const authHeader = await getAuthHeader();
  const response = await fetch('/api/ai/perplexity-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: 'You are a strict data extraction assistant. Always output only valid JSON without any markdown or extra text.' },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Perplexity proxy error ${response.status}`);
  }

  const data = await response.json();
  let text = data.text || '{}';
  text = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();

  try {
    return JSON.parse(text);
  } catch {
    return { skills: [], currentProjects: "", needs: "" };
  }
}

// ============================================================================
// ORACLE IA V3 ÔÇö Multi-Pass Intelligence Pipeline
// ============================================================================

/**
 * Normalized profile structure extracted by Passe 1
 */
export interface NormalizedProfile {
  contactId: string;
  name: string;
  sector: string;
  roleCategory: string;
  seniority: string;
  explicitNeeds: string[];
  inferredNeeds: string[];
  skillsOffered: string[];
  painPoints: string[];
  collaborationOpenness: number;
  topicsOfInterest: string[];
  // Business-oriented fields
  budgetAuthority: 'none' | 'influencer' | 'decision-maker' | 'budget-holder';
  businessIntent: string;
  networkValue: 'connector' | 'influencer' | 'specialist' | 'dormant';
  buyingSignals: string[];
  // Relationship quality
  relationshipStrength: 'cold' | 'warm' | 'hot' | 'strategic';
  whatUserCanDoForThem: string; // Concrete value the user can bring
  whatTheyCanDoForUser: string; // Concrete value they can bring to user
}

/**
 * Supply/Demand matrix entry
 */
export interface SupplyDemandEntry {
  need: string;
  demanders: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  gapLevel: 'covered' | 'partial' | 'opportunity';
  opportunityForUser: boolean;
}

/**
 * Network cluster result
 */
export interface NetworkCluster {
  clusterId: number;
  clusterName: string;
  theme: string;
  members: { id: string; name: string; role: string; company: string }[];
  commonNeeds: string[];
  commonSkills: string[];
  bridgeContacts: string[]; // IDs of contacts that bridge this cluster with others
}

/**
 * Deep opportunity result (Passe 4)
 */
export interface DeepOpportunity {
  category: 'service' | 'product' | 'connection' | 'event';
  title: string;
  description: string;
  targetCluster: string;
  demandScore: number;
  feasibilityScore: number;
  relevantContacts: { id: string; name: string; role: string; company: string; reason: string }[];
  actionPlan: string[];
  estimatedImpact: string;
  // Revenue-oriented fields
  revenueModel: string;   // How does this make money (commission, fee, subscription, equity...)
  estimatedRevenue: string; // Rough revenue estimate (e.g. "2k-5kÔé¼/mois")
  timeToRevenue: string;   // How fast ("1 semaine", "1 mois", "3 mois")
  urgency: 'immediate' | 'short-term' | 'medium-term';
}

/**
 * Full pipeline result
 */
export interface OracleV3Result {
  profiles: NormalizedProfile[];
  clusters: NetworkCluster[];
  supplyDemand: SupplyDemandEntry[];
  opportunities: DeepOpportunity[];
  bridgeContacts: { id: string; name: string; centralityScore: number }[];
  keyIntros: StrategicIntro[];
  genome?: NetworkGenome;
  reciprocity?: ReciprocityImbalance[];
  timestamp: number;
  tokenUsage?: TokenUsage;
}

/**
 * Build a dynamic user context string for prompts based on the user's bio/profile
 */
export function buildUserContext(userProfile: any): string {
  // Supports the UserProfilePopup shape { name, company, role, skills[], currentProjects, needs }
  // as well as looser bio/title fallbacks.
  const name = userProfile?.name || 'Utilisateur';
  const role = userProfile?.role || userProfile?.title || userProfile?.job_title || '';
  const company = userProfile?.company || '';
  const skills: string[] = userProfile?.skills || [];
  const projects = userProfile?.currentProjects || userProfile?.bio || userProfile?.description || '';
  const needs = userProfile?.needs || '';

  // Always-included generic monetization angles.
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

/**
 * PASSE 1 ÔÇö Extract Normalized Profiles
 * Processes contacts in batches to extract structured profile data
 */

// ============================================================================
// MAP: Process a single batch
// ============================================================================
export interface MistralBatchResult {
  recurrentNeeds: string[];
  immediateSynergies: {
    contactId1: string;
    contactName1: string;
    contactId2: string;
    contactName2: string;
    reason: string;
  }[];
  keyCompetencies: string[];
}

export interface MacroNeed {
  label: string;
  mergedFrom: string[];
  affectedContactsCount: number;
  priority: 'high' | 'medium' | 'low';
}

export interface ValueChainLink {
  step: number;
  contactName: string;
  role: string;
  contribution: string;
}

export interface ValueChain {
  title: string;
  description: string;
  chain: ValueChainLink[];
  estimatedImpact: string;
}

export interface MistralGlobalSynthesis {
  globalThemes: string[];
  crossBatchSynergies: {
    theme: string;
    description: string;
    potentialImpact: string;
  }[];
  networkStrength: string;
  recommendedActionPlan: string[];
  macroNeeds: MacroNeed[];
  valueChains: ValueChain[];
  tokenUsage?: TokenUsage;
}

export interface MistralPipelineResult {
  batches: MistralBatchResult[];
  synthesis: MistralGlobalSynthesis;
  supplyDemand: SupplyDemandEntry[];
  bridgeContacts: BridgeContact[];
  timestamp: number;
  /** How much of this run was served from the incremental cache vs freshly computed. */
  cacheStats?: { totalBatches: number; reusedBatches: number };
  /** How many contacts passed the enrichment gate vs were excluded as too sparse. */
  dataQuality?: { analyzed: number; excluded: number };
}

/**
 * The Reduce step's JSON schema (macroNeeds/valueChains as nested objects)
 * is only a prompt convention, not something Mistral is guaranteed to follow —
 * a run can persist a macroNeed/valueChain as a bare string. That's harmless
 * until the UI calls a method on the expected nested field (`mn.mergedFrom.join`,
 * `vc.chain.map`) and crashes. Coerces any non-compliant entry back into shape
 * so archived analyses stay renderable no matter what got saved.
 */
function normalizeMacroNeed(mn: any): MacroNeed {
  if (mn && typeof mn === 'object') {
    return {
      label: typeof mn.label === 'string' ? mn.label : String(mn.label ?? ''),
      mergedFrom: Array.isArray(mn.mergedFrom) ? mn.mergedFrom : [],
      affectedContactsCount: typeof mn.affectedContactsCount === 'number' ? mn.affectedContactsCount : 0,
      priority: mn.priority === 'high' || mn.priority === 'low' ? mn.priority : 'medium'
    };
  }
  return { label: String(mn ?? ''), mergedFrom: [], affectedContactsCount: 0, priority: 'medium' };
}

function normalizeValueChain(vc: any): ValueChain {
  return {
    title: typeof vc?.title === 'string' ? vc.title : '',
    description: typeof vc?.description === 'string' ? vc.description : '',
    chain: Array.isArray(vc?.chain) ? vc.chain : [],
    estimatedImpact: typeof vc?.estimatedImpact === 'string' ? vc.estimatedImpact : ''
  };
}

/**
 * Several fields (globalThemes, recommendedActionPlan, a batch's
 * recurrentNeeds/keyCompetencies) are rendered as `{entry}` directly — a
 * bare string is expected. An older/non-compliant run can persist those as
 * objects instead (e.g. `{action, priority, expectedOutcome}`), which React
 * refuses to render as a child at all (error #31) and takes the whole page
 * down with it. Coerces every entry down to a display string first.
 */
function normalizeStringArray(arr: any, objectKeys: string[] = ['label', 'action', 'name', 'theme', 'text']): string[] {
  if (!Array.isArray(arr)) return [];
  return arr.map(entry => {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object') {
      const key = objectKeys.find(k => typeof entry[k] === 'string');
      return key ? entry[key] : JSON.stringify(entry);
    }
    return String(entry ?? '');
  });
}

function normalizeSynthesis(synthesis: MistralGlobalSynthesis): MistralGlobalSynthesis {
  return {
    ...synthesis,
    globalThemes: normalizeStringArray(synthesis?.globalThemes),
    recommendedActionPlan: normalizeStringArray(synthesis?.recommendedActionPlan),
    macroNeeds: Array.isArray(synthesis?.macroNeeds) ? synthesis.macroNeeds.map(normalizeMacroNeed) : [],
    valueChains: Array.isArray(synthesis?.valueChains) ? synthesis.valueChains.map(normalizeValueChain) : []
  };
}

function normalizeBatchResult(batch: any): MistralBatchResult {
  return {
    recurrentNeeds: normalizeStringArray(batch?.recurrentNeeds),
    immediateSynergies: Array.isArray(batch?.immediateSynergies) ? batch.immediateSynergies : [],
    keyCompetencies: normalizeStringArray(batch?.keyCompetencies)
  };
}

function normalizePipelineResult<T extends MistralPipelineResult>(result: T): T {
  return {
    ...result,
    synthesis: normalizeSynthesis(result.synthesis),
    batches: Array.isArray(result.batches) ? result.batches.map(normalizeBatchResult) : []
  };
}


export interface BridgeContact {
  id: string;
  name: string;
  role: string;
  company: string;
  centralityScore: number;
}


// ============================================================================
// ORCHESTRATOR: Run full Map-Reduce Pipeline
// ============================================================================
export function getCachedMistralPipelineResult(contacts: any[]): MistralPipelineResult | null {
  const cacheKey = `circl_mistral_v7_${contacts.length}_${contacts.map(c => c.id).sort().join(',').substring(0, 100)}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed.timestamp && Date.now() - parsed.timestamp < 3600000) {
        return parsed;
      }
    } catch (e) {}
  }
  return null;
}

export interface AnalysisHistoryMeta {
  ownerId: string;
  spaceId: string | null;
  label?: string;
}

async function postOracleStep<T>(path: string, body: any): Promise<T> {
  const authHeader = await getAuthHeader();
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Oracle proxy error ${response.status} (${path})`);
  }
  return response.json();
}

/** Tiny stable string hash (djb2) for cache keys — not cryptographic. */
function djb2(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Derive 4–6 value-creation "leviers d'analyse" tailored to the user's own
 * profile, instead of injecting the same 15 static monetization angles into
 * every network (which pushed a deeptech founder's analysis toward "cercles
 * premium / masterclasses / courtage immobilier"). Mistral reads the profile
 * and synthesizes the angles that actually fit the person's trade. Cached in
 * localStorage keyed by the profile's content so it costs one small call the
 * first time and nothing on repeat runs. Returns [] on empty profile or
 * failure — callers fall back to the generic angles server-side.
 */
export async function deriveAnalysisAngles(userProfile: any): Promise<string[]> {
  if (!userProfile) return [];

  const role = userProfile?.role || userProfile?.title || userProfile?.job_title || '';
  const company = userProfile?.company || '';
  const skills: string[] = Array.isArray(userProfile?.skills) ? userProfile.skills : [];
  const projects = userProfile?.currentProjects || userProfile?.bio || userProfile?.description || '';
  const needs = userProfile?.needs || '';

  // Nothing to reason about — let the generic fallback apply, skip the call.
  if (!role && !company && skills.length === 0 && !projects && !needs) return [];

  const cacheKey = `circl_analysis_angles_${djb2(JSON.stringify({ role, company, skills, projects, needs }))}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }

  const prompt = `<role>
Tu es un stratège en développement business. Tu analyses le profil d'un professionnel pour déterminer par quels leviers CONCRETS et RÉALISTES il peut valoriser et monétiser son réseau.
</role>
<profil>
Poste : ${role || 'non renseigné'}
Entreprise : ${company || 'non renseignée'}
Compétences : ${skills.join(', ') || 'non renseignées'}
Projets en cours : ${projects || 'non renseignés'}
Besoins / objectifs : ${needs || 'non renseignés'}
</profil>
<instructions>
Identifie les 4 à 6 leviers de valeur les plus pertinents pour CE profil précis. Reste strictement ancré sur son métier et ses objectifs réels : n'inclus JAMAIS un levier hors-sujet (ex : ne propose pas "courtage immobilier" ou "gestion de patrimoine" à un fondateur deeptech). Chaque levier est une formule courte et actionnable.
</instructions>
<rules>
- Entre 4 et 6 leviers, jamais plus.
- Spécifiques à ce profil, jamais des généralités passe-partout.
- Réponds STRICTEMENT en JSON valide : { "angles": ["levier 1", "levier 2", "levier 3", "levier 4"] }
</rules>`;

  try {
    const text = await callMistral(prompt, true, 'mistral-small-latest');
    const parsed = safeParseJSON(text);
    const angles: string[] = Array.isArray(parsed?.angles)
      ? parsed.angles.filter((a: any) => typeof a === 'string' && a.trim()).slice(0, 6)
      : [];
    if (angles.length > 0) {
      try { localStorage.setItem(cacheKey, JSON.stringify(angles)); } catch { /* ignore */ }
    }
    return angles;
  } catch (err) {
    console.warn('deriveAnalysisAngles: dérivation échouée, fallback sur angles génériques.', err);
    return [];
  }
}

/**
 * Runs the full Map-Reduce Oracle pipeline server-side, as 4 short calls
 * orchestrated from here instead of one monolithic function — a single
 * do-everything endpoint (the original design) hit 504 Gateway Timeouts in
 * production because a full pipeline is several sequential Mistral Large
 * calls. Each step still fetches FULL contact data server-side (never sent
 * to this client) using the caller's own JWT, and redacts anything
 * involving a contact the caller doesn't have full access to before
 * returning — this is what keeps cross-network analysis safe even when some
 * contacts are locked (see the confidentialité inter-réseaux migration).
 *
 * `contacts` is still used here for the local cache key and history
 * bookkeeping (count/ids), not sent to the pipeline itself — the server
 * fetches its own authoritative copy scoped to `historyMeta.spaceId`.
 */
export async function runMistralOracleBatchPipeline(
  contacts: any[],
  _notes: any[],
  userProfile?: any,
  onProgress?: (pct: number) => void,
  historyMeta?: AnalysisHistoryMeta
): Promise<MistralPipelineResult> {
  resetGlobalUsage();
  const spaceId = historyMeta?.spaceId ?? null;
  onProgress?.(5);

  // Derive analysis angles tailored to the user's profile once, then attach
  // them to the profile sent to every LLM step (MAP/REDUCE/SUPPLY). The
  // server prompts prefer these over their static generic-angle fallback.
  let profileForPipeline = userProfile;
  if (userProfile) {
    try {
      const analysisAngles = await deriveAnalysisAngles(userProfile);
      if (analysisAngles.length > 0) profileForPipeline = { ...userProfile, analysisAngles };
    } catch { /* keep the raw profile — server falls back to generic angles */ }
  }
  onProgress?.(10);

  const topology = await postOracleStep<{
    batches: { contactIds: string[]; clusterId: string | null; contactIdsHash: string | null; cached: MistralBatchResult | null }[];
    bridgeContacts: BridgeContact[];
    lockedContactNames: string[];
    analyzedCount?: number;
    excludedCount?: number;
  }>('/api/oracle/topology', { spaceId });
  onProgress?.(15);

  // Incremental: topology.ts already reused cached embeddings/clusters and
  // returns a batch's prior MAP result inline (`cached`) whenever none of
  // its contacts changed since that result was computed — those batches
  // never need a round trip to Mistral at all.
  const batchResults: MistralBatchResult[] = [];
  const totalBatches = topology.batches.length;
  const reusedBatches = topology.batches.filter(b => b.cached !== null).length;
  for (let i = 0; i < totalBatches; i++) {
    const batch = topology.batches[i];
    const batchResult = batch.cached ?? await postOracleStep<MistralBatchResult>('/api/oracle/map-batch', {
      contactIds: batch.contactIds,
      clusterId: batch.clusterId,
      contactIdsHash: batch.contactIdsHash,
      spaceId,
      lockedContactNames: topology.lockedContactNames,
      userProfile: profileForPipeline
    });
    batchResults.push(batchResult);
    onProgress?.(15 + Math.round(((i + 1) / Math.max(totalBatches, 1)) * 55));
  }

  const synthesis = await postOracleStep<MistralGlobalSynthesis>('/api/oracle/reduce', {
    batchResults,
    bridgeContacts: topology.bridgeContacts,
    lockedContactNames: topology.lockedContactNames,
    userProfile: profileForPipeline
  });
  onProgress?.(85);

  const supplyDemand = await postOracleStep<SupplyDemandEntry[]>('/api/oracle/supply-demand', {
    spaceId,
    userProfile: profileForPipeline
  });
  onProgress?.(95);

  const result: MistralPipelineResult = normalizePipelineResult({
    batches: batchResults,
    synthesis,
    supplyDemand,
    bridgeContacts: topology.bridgeContacts,
    timestamp: Date.now(),
    cacheStats: { totalBatches, reusedBatches },
    dataQuality: {
      analyzed: topology.analyzedCount ?? 0,
      excluded: topology.excludedCount ?? 0
    }
  });

  onProgress?.(100);

  const cacheKey = `circl_mistral_v7_${contacts.length}_${contacts.map(c => c.id).sort().join(',').substring(0, 100)}`;
  localStorage.setItem(cacheKey, JSON.stringify(result));

  if (historyMeta) {
    await saveAnalysisSnapshot(result, contacts, historyMeta);
  }

  return result;
}

// ============================================================================
// ANALYSIS HISTORY — persist every full run so past analyses stay readable
// even after running new ones, and can be diffed to show network evolution.
// ============================================================================

export interface AnalysisHistoryEntry {
  id: string;
  label: string | null;
  spaceId: string | null;
  contactCount: number;
  createdAt: string;
}

/**
 * Best-effort persistence of a completed pipeline run. Never throws — a
 * history-write failure (e.g. migration not applied yet) must not make the
 * analysis the user just paid for look like it failed.
 */
async function saveAnalysisSnapshot(
  result: MistralPipelineResult,
  contacts: any[],
  meta: AnalysisHistoryMeta
): Promise<void> {
  try {
    const { error } = await supabase.from('network_analyses').insert({
      owner_id: meta.ownerId,
      space_id: meta.spaceId,
      label: meta.label || null,
      contact_count: contacts.length,
      contact_ids: contacts.map(c => c.id),
      result
    });
    if (error) {
      console.warn('saveAnalysisSnapshot: écriture ignorée (migration manquante ?)', error.message);
    }
  } catch (err) {
    console.warn('saveAnalysisSnapshot: écriture ignorée', err);
  }
}

/** Lightweight list of past analyses (no `result` payload) for a history picker. */
export async function listAnalysisHistory(spaceId: string | null): Promise<AnalysisHistoryEntry[]> {
  let query = supabase
    .from('network_analyses')
    .select('id, label, space_id, contact_count, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  query = spaceId ? query.eq('space_id', spaceId) : query.is('space_id', null);

  const { data, error } = await query;
  if (error) {
    console.error('listAnalysisHistory failure:', error);
    return [];
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    label: row.label,
    spaceId: row.space_id,
    contactCount: row.contact_count,
    createdAt: row.created_at
  }));
}

/** Fetches the full pipeline result of a single archived analysis. */
export async function getAnalysisById(id: string): Promise<(MistralPipelineResult & { id: string; label: string | null }) | null> {
  const { data, error } = await supabase
    .from('network_analyses')
    .select('id, label, result')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) {
    console.error('getAnalysisById failure:', error);
    return null;
  }

  const result = normalizePipelineResult(data.result as MistralPipelineResult);
  return { ...result, id: data.id, label: data.label };
}

export async function deleteAnalysis(id: string): Promise<void> {
  const { error } = await supabase.from('network_analyses').delete().eq('id', id);
  if (error) throw error;
}

export interface AnalysisDelta {
  networkEvolutionSummary: string;
  newThemes: string[];
  resolvedThemes: string[];
  newMacroNeeds: string[];
  emergingSynergies: string[];
  bridgeContactChanges: string[];
  recommendedNextSteps: string[];
}

const FALLBACK_DELTA: AnalysisDelta = {
  networkEvolutionSummary: "La comparaison a échoué (erreur API ou rate-limiting). Veuillez réessayer.",
  newThemes: [],
  resolvedThemes: [],
  newMacroNeeds: [],
  emergingSynergies: [],
  bridgeContactChanges: [],
  recommendedNextSteps: []
};

/**
 * Compares two archived analyses with Mistral Large to surface how the
 * network evolved between them — new themes/needs that appeared, ones that
 * got resolved (disappeared), new synergies, and how the strategic
 * connectors changed.
 */
/** Only model on Mistral capable of the complex, indirect deductions this comparison requires. */
const MAP_REDUCE_MODEL = 'mistral-large-latest';

export async function compareAnalyses(
  before: MistralPipelineResult,
  after: MistralPipelineResult
): Promise<AnalysisDelta> {
  const compact = (r: MistralPipelineResult) => ({
    globalThemes: r.synthesis.globalThemes,
    macroNeeds: r.synthesis.macroNeeds,
    valueChains: r.synthesis.valueChains.map(v => v.title),
    networkStrength: r.synthesis.networkStrength,
    bridgeContacts: r.bridgeContacts.map(b => b.name),
    supplyDemandOpportunities: r.supplyDemand.filter(s => s.opportunityForUser).map(s => s.need)
  });

  const prompt = `<role>
Tu es "Oracle DELTA", un analyste spécialisé dans l'évolution temporelle des réseaux professionnels. Tu compares deux analyses successives du même réseau (ou du même périmètre) pour en dégager la trajectoire.
</role>

<instructions>
1. Identifie les thèmes/besoins qui sont NOUVEAUX dans "after" et absents de "before" (newThemes, newMacroNeeds).
2. Identifie les thèmes qui étaient présents dans "before" et ont DISPARU dans "after" (resolvedThemes) — cela signale généralement un besoin comblé ou une opportunité saisie.
3. Repère les synergies ou chaînes de valeur émergentes qui n'existaient pas avant (emergingSynergies).
4. Compare les listes de contacts-ponts (bridgeContacts) entre les deux analyses et décris ce qui a changé (bridgeContactChanges) — nouveaux connecteurs, connecteurs qui ont perdu leur rôle central, etc.
5. Rédige un résumé narratif de l'évolution du réseau (networkEvolutionSummary) et un plan d'action pour capitaliser sur cette trajectoire (recommendedNextSteps).
</instructions>

<rules>
- INTERDICTION de renvoyer un résumé générique du type "le réseau a évolué positivement" sans détails concrets tirés des données.
- Si les deux analyses sont quasi identiques, dis-le explicitement dans networkEvolutionSummary plutôt que d'inventer des différences.
- Réponds STRICTEMENT avec un objet JSON valide respectant le format ci-dessous, sans markdown ni texte additionnel.
</rules>

<analysis_before>
${JSON.stringify(compact(before), null, 2)}
</analysis_before>

<analysis_after>
${JSON.stringify(compact(after), null, 2)}
</analysis_after>

<output_format>
{
  "networkEvolutionSummary": "Résumé narratif de l'évolution en 2-4 phrases",
  "newThemes": ["thème nouveau 1"],
  "resolvedThemes": ["thème disparu / résolu 1"],
  "newMacroNeeds": ["macro-besoin nouveau 1"],
  "emergingSynergies": ["synergie ou chaîne de valeur émergente 1"],
  "bridgeContactChanges": ["description d'un changement de connecteur clé"],
  "recommendedNextSteps": ["action 1", "action 2"]
}
</output_format>`;

  try {
    const text = await callMistral(prompt, true, MAP_REDUCE_MODEL);
    const parsed = safeParseJSON(text);
    if (parsed && typeof parsed.networkEvolutionSummary === 'string') {
      return {
        networkEvolutionSummary: parsed.networkEvolutionSummary,
        newThemes: normalizeStringArray(parsed.newThemes),
        resolvedThemes: normalizeStringArray(parsed.resolvedThemes),
        newMacroNeeds: normalizeStringArray(parsed.newMacroNeeds),
        emergingSynergies: normalizeStringArray(parsed.emergingSynergies),
        bridgeContactChanges: normalizeStringArray(parsed.bridgeContactChanges),
        recommendedNextSteps: normalizeStringArray(parsed.recommendedNextSteps)
      };
    }
    console.error('Mistral DELTA: réponse JSON invalide, fallback appliqué.', text);
    return { ...FALLBACK_DELTA };
  } catch (err) {
    console.error('Mistral DELTA comparison failure:', err);
    return { ...FALLBACK_DELTA };
  }
}

