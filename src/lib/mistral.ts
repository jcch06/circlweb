import { Mistral } from '@mistralai/mistralai';

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

const getMistralClient = () => {
  const apiKey = import.meta.env.VITE_MISTRAL_API_KEY;
  if (!apiKey || apiKey === 'YOUR_MISTRAL_API_KEY_HERE') {
    return null;
  }
  return new Mistral({ apiKey });
};

export const isMistralConfigured = () => {
  return getMistralClient() !== null;
};

export const isPerplexityConfigured = () => {
  const key = import.meta.env.VITE_PERPLEXITY_API_KEY;
  return key && key.trim().length > 0;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function callMistral(prompt: string, isJSON: boolean = true): Promise<string> {
  const client = getMistralClient();
  if (!client) throw new Error("Mistral API key is not configured");
  
  let retries = 3;
  while (retries > 0) {
    try {
      const response = await client.chat.complete({
        model: 'mistral-small-latest',
        messages: [{ role: 'user', content: prompt }],
        responseFormat: isJSON ? { type: 'json_object' } : undefined
      });
      trackGlobalUsage(response.usage);
      let text = response.choices?.[0]?.message?.content || (isJSON ? "{}" : "");
      if (typeof text !== 'string') text = String(text);
      return text;
    } catch (err: any) {
      if (err.status === 429) {
        await sleep(3000);
      } else {
        await sleep(1000);
      }
      retries--;
    }
  }
  throw new Error("Mistral API failure");
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

export interface EnrichmentResult {
  industry: string;
  companySize: string;
  bio: string;
  skills: string[];
  inferredNeeds: string[];
  aiContext: string;
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
  const genAI = getMistralClient();
  if (!genAI) throw new Error("Mistral API key is not configured in .env.local");

  

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
  const genAI = getMistralClient();
  if (!genAI) throw new Error("Mistral API key is not configured in .env.local");

  

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
  const genAI = getMistralClient();
  if (!genAI) throw new Error("Mistral API key is not configured in .env.local");

  

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
  const genAI = getMistralClient();
  if (!genAI) throw new Error("Mistral API key is not configured in .env.local");

  // Mistral Flash is perfect for parsing and structuring raw text quickly and cheaply
  

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
  const genAI = getMistralClient();
  if (!genAI) throw new Error("Mistral API key is not configured in .env.local");

  

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
  location?: string;
}): Promise<EnrichmentResult> {
  const perplexityKey = import.meta.env.VITE_PERPLEXITY_API_KEY;
  if (!perplexityKey) {
    throw new Error("Perplexity API key is not configured");
  }

  // Validate before even calling the API
  if (!isValidContactForEnrichment(contact)) {
    throw new Error(`Donn├®es insuffisantes ou invalides pour enrichir "${contact.first_name} ${contact.last_name}"`);
  }

  const prompt = `Tu es un assistant d'enrichissement de contacts professionnels B2B.
Recherche sur le web des informations R├ëELLES et V├ëRIFIABLES sur ce contact professionnel.

Nom complet : ${contact.first_name} ${contact.last_name}
Poste : ${contact.job_title || 'Non renseign├®'}
Entreprise : ${contact.company || 'Non renseign├®e'}
Secteur d├®clar├® : ${contact.industry || 'Non renseign├®'}
Localisation : ${contact.location || 'Non renseign├®e'}

R├êGLE ABSOLUE : Si tu n'as pas assez d'informations v├®rifiables, mets "null" plut├┤t qu'inventer.
Ne g├®n├¿re JAMAIS de bio g├®n├®rique comme "professionnel chevronn├®" ou "experte en marketing digital".
La bio doit ├¬tre SP├ëCIFIQUE ├á cette personne et cette entreprise.

Retourne UNIQUEMENT un objet JSON valide avec cette structure exacte, sans markdown ni code blocks autour :
{
  "industry": "secteur pr├®cis ou null si inconnu",
  "companySize": "taille estim├®e (1-10 | 11-50 | 51-200 | 201-1000 | 1000+) ou null",
  "bio": "bio SP├ëCIFIQUE et V├ëRIFIABLE en 1-2 phrases, ou null si pas assez d'info",
  "skills": ["comp├®tences sp├®cifiques au poste/secteur"],
  "inferredNeeds": ["d├®fis sp├®cifiques ├á ce type de r├┤le dans ce secteur"],
  "aiContext": "conseil concret et personnalis├® sur comment aborder ce contact, ou null si pas assez d'info"
}`;

  const response = await fetch(
    `https://api.perplexity.ai/chat/completions`,
    {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${perplexityKey}`,
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { role: 'system', content: 'You are a strict data extraction assistant. Always output only valid JSON without any markdown or extra text.' },
          { role: 'user', content: prompt }
        ]
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Perplexity API error: ${response.status} ÔÇö ${err}`);
  }

  const data = await response.json();
  let text = data.choices?.[0]?.message?.content || '{}';

  // Sanitize markdown wrappers if present
  text = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();

  try {
    return JSON.parse(text);
  } catch {
    // Cleanup common LLM JSON issues: trailing commas, etc.
    let cleaned = text.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1) cleaned = cleaned.substring(start, end + 1);
    return JSON.parse(cleaned);
  }
}

/**
 * 7. Advanced Group Synergies
 * Analyzes the entire network to find clusters of people with common needs/interests.
 */
export async function detectGroupSynergies(contacts: any[], notes: any[]): Promise<GroupSynergyResult[]> {
  const genAI = getMistralClient();
  if (!genAI) throw new Error("Mistral API key is not configured");

  

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
  const genAI = getMistralClient();
  if (!genAI) throw new Error("Mistral API key is not configured");

  

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
export async function autoEnrichUserProfile(name: string, company: string, role: string): Promise<any> {
  const perplexityKey = import.meta.env.VITE_PERPLEXITY_API_KEY;
  if (!perplexityKey) {
    throw new Error("Perplexity API key is not configured");
  }

  const prompt = `Tu es un assistant d'analyse de profil B2B. Fais une recherche approfondie sur cette personne.
Nom : ${name}
Poste : ${role}
Entreprise : ${company}

Trouve ses comp├®tences probables, ses projets actuels et les d├®fis (besoins) auxquels elle fait face dans ce r├┤le.
Retourne UNIQUEMENT un objet JSON valide avec cette structure exacte :
{
  "skills": ["Comp├®tence 1", "Comp├®tence 2"],
  "currentProjects": "Un paragraphe d├®crivant les missions ou projets probables...",
  "needs": "Un paragraphe d├®crivant ses enjeux et d├®fis actuels..."
}`;

  const response = await fetch(
    `https://api.perplexity.ai/chat/completions`,
    {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${perplexityKey}`,
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { role: 'system', content: 'You are a strict data extraction assistant. Always output only valid JSON without any markdown or extra text.' },
          { role: 'user', content: prompt }
        ]
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Perplexity API error: ${response.status} ÔÇö ${err}`);
  }

  const data = await response.json();
  let text = data.choices?.[0]?.message?.content || '{}';
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

export interface TokenUsage {
  promptTokens: number;
  candidateTokens: number;
  totalTokens: number;
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
 * Reciprocity Imbalance (Giver/Taker CRM)
    const start = cleaned.indexOf('[') !== -1 && (cleaned.indexOf('{') === -1 || cleaned.indexOf('[') < cleaned.indexOf('{'))
      ? cleaned.indexOf('[')
      : cleaned.indexOf('{');
    const end = cleaned.lastIndexOf(']') !== -1 && cleaned.lastIndexOf(']') > cleaned.lastIndexOf('}')
      ? cleaned.lastIndexOf(']')
      : cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      return JSON.parse(cleaned.substring(start, end + 1));
    }
    throw new Error('Could not parse Mistral response as JSON');
  }
}

/**
 * Build a dynamic user context string for prompts based on the user's bio/profile
 */
export function buildUserContext(userProfile: any): string {
  const bio = userProfile?.bio || userProfile?.description || '';
  const skills = userProfile?.skills || [];
  const name = userProfile?.name || 'Utilisateur';
  const title = userProfile?.title || userProfile?.job_title || '';
  
  // Always-included generic monetization angles
  const genericAngles = [
    'mise en relation / apport d\'affaires (commission)',
    'consulting & conseil strat├®gique',
    'freelance & prestations de service',
    'lev├®e de fonds & recherche d\'investisseurs',
    '├®v├®nementiel & networking (d├«ners priv├®s, masterclasses)',
    'vente de formations & coaching',
    'cr├®ation de produits num├®riques (SaaS, outils, templates)',
    'lobbying & influence politique',
    'recrutement & chasse de talents',
    'partenariats commerciaux & co-entreprises',
    'affiliation & recommandation r├®mun├®r├®e',
    'management de communaut├® & cercles premium',
    'courtage immobilier & investissement',
    'gestion de patrimoine & conseil financier',
    'relations presse & personal branding'
  ];

  return `## PROFIL DE L'UTILISATEUR ÔÇö ${name}
${title ? `Poste : ${title}` : ''}
${bio ? `Bio : ${bio}` : ''}
${skills.length > 0 ? `Comp├®tences : ${skills.join(', ')}` : ''}

L'utilisateur veut MON├ëTISER son r├®seau. Voici les angles de mon├®tisation ├á explorer en priorit├® :
${genericAngles.map((a, i) => `${i + 1}. ${a}`).join('\n')}

ADAPTE ton analyse au profil sp├®cifique de l'utilisateur ci-dessus. Si sa bio mentionne un domaine pr├®cis (ex: "architecte" ÔåÆ opportunit├®s dans l'immobilier/urbanisme, "d├®veloppeur" ÔåÆ consulting tech, "avocat" ÔåÆ conseil juridique), priorise les opportunit├®s ALIGN├ëES avec son expertise.`;
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

export interface MistralGlobalSynthesis {
  globalThemes: string[];
  crossBatchSynergies: {
    theme: string;
    description: string;
    potentialImpact: string;
  }[];
  networkStrength: string;
  recommendedActionPlan: string[];
  tokenUsage?: TokenUsage;
}

export interface MistralPipelineResult {
  batches: MistralBatchResult[];
  synthesis: MistralGlobalSynthesis;
  timestamp: number;
}

async function processContactBatch(batch: any[], notes: any[]): Promise<MistralBatchResult> {
  const batchData = batch.map(c => {
    const contactNotes = notes.filter(n => n.contact_id === c.id || n.contactId === c.id).map(n => n.content).join(' | ');
    return `Contact: ${c.name || (c.first_name + ' ' + c.last_name)} (${c.job_title} chez ${c.company})\nInfos: ${contactNotes}`;
  }).join('\n\n');

  const prompt = `Tu es un expert en analyse de réseau professionnel.
Voici un lot de contacts avec leurs informations.
Extrais les informations suivantes au format JSON STRICT :
{
  "recurrentNeeds": ["besoin 1", "besoin 2"],
  "immediateSynergies": [
    {
      "contactId1": "ID du premier contact",
      "contactName1": "Nom du premier",
      "contactId2": "ID du deuxieme contact",
      "contactName2": "Nom du deuxieme",
      "reason": "Explication de la synergie"
    }
  ],
  "keyCompetencies": ["mot cle 1", "mot cle 2"]
}

Contacts du lot :
${batchData}

Règle absolue : Réponds UNIQUEMENT avec le JSON valide, sans markdown additionnel.`;

  let text = await callMistral(prompt, true);
  const parsed = safeParseJSON(text);
  if (parsed && parsed.immediateSynergies) {
    return parsed as MistralBatchResult;
  }
  return { recurrentNeeds: [], immediateSynergies: [], keyCompetencies: [] };
}

// ============================================================================
// REDUCE: Synthesize all batch results
// ============================================================================
async function synthesizeNetwork(batchResults: MistralBatchResult[]): Promise<MistralGlobalSynthesis> {
  const aggregatedData = JSON.stringify(batchResults, null, 2);

  const prompt = `Tu es un super-cerveau réseau. 
Voici les résultats d'analyses locales (par lots) d'un grand réseau de contacts.
Fais-en une synthèse globale (Reduce) pour identifier les grandes forces du réseau.

Réponds au format JSON STRICT :
{
  "globalThemes": ["thème dominant 1", "thème dominant 2"],
  "crossBatchSynergies": [
    {
      "theme": "Thème de la synergie globale",
      "description": "Explication de pourquoi ce réseau a de la valeur ici",
      "potentialImpact": "Estimation de l'impact (ex: Fort potentiel commercial)"
    }
  ],
  "networkStrength": "Résumé en 1-2 phrases de la force principale de ce réseau",
  "recommendedActionPlan": ["Action 1", "Action 2"]
}

Données agrégées des lots :
${aggregatedData}

Règle absolue : Réponds UNIQUEMENT avec le JSON valide.`;

  let text = await callMistral(prompt, true);
  const parsed = safeParseJSON(text);
  if (parsed && parsed.globalThemes) {
    return parsed as MistralGlobalSynthesis;
  }
  return { globalThemes: [], crossBatchSynergies: [], networkStrength: "Analyse échouée.", recommendedActionPlan: [] };
}

// ============================================================================
// Embeddings (Mistral Embed)
// ============================================================================
export async function computeMistralEmbeddings(
  contacts: any[],
  notes: any[],
  onProgress?: (pct: number) => void
): Promise<{ contactId: string; vector: number[] }[]> {
  const client = getMistralClient();
  if (!client) throw new Error("Mistral API key non configurée");

  const results: { contactId: string; vector: number[] }[] = [];
  
  const BATCH_SIZE = 20;
  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);
    const inputs = batch.map(c => {
      const contactNotes = notes.filter((n: any) => n.contact_id === c.id || n.contactId === c.id).map((n: any) => n.content).join(' ');
      return `Profil: ${c.first_name || c.name}, Role: ${c.job_title || c.role}, Entreprise: ${c.company}. Notes: ${contactNotes}`.substring(0, 8000);
    });

    try {
      const embedResponse = await client.embeddings.create({
        model: 'mistral-embed',
        inputs
      });
      
      trackGlobalUsage(embedResponse.usage);
      
      embedResponse.data.forEach((d, idx) => {
        results.push({ contactId: batch[idx].id, vector: d.embedding as number[] });
      });
    } catch (err) {
      console.error("Mistral Embedding Error", err);
    }
    
    onProgress?.(Math.min(100, Math.round(((i + BATCH_SIZE) / contacts.length) * 100)));
    if (i + BATCH_SIZE < contacts.length) {
      await sleep(500);
    }
  }

  return results;
}

// ============================================================================
// ORCHESTRATOR: Run full Map-Reduce Pipeline
// ============================================================================
export function getCachedMistralPipelineResult(contacts: any[]): MistralPipelineResult | null {
  const cacheKey = `circl_mistral_v4_${contacts.length}_${contacts.map(c => c.id).sort().join(',').substring(0, 100)}`;
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

export async function runMistralOracleBatchPipeline(
  contacts: any[],
  notes: any[],
  onProgress?: (pct: number) => void
): Promise<MistralPipelineResult> {
  resetGlobalUsage();

  const BATCH_SIZE = 25;
  const batches = [];
  
  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    batches.push(contacts.slice(i, i + BATCH_SIZE));
  }

  const batchResults: MistralBatchResult[] = [];
  
  for (let i = 0; i < batches.length; i++) {
    onProgress?.((i / batches.length) * 70);
    const res = await processContactBatch(batches[i], notes);
    batchResults.push(res);
    if (i < batches.length - 1) {
      await sleep(1500);
    }
  }

  onProgress?.(80);
  const synthesis = await synthesizeNetwork(batchResults);
  onProgress?.(100);

  synthesis.tokenUsage = globalTokenUsage || undefined;

  const result = {
    batches: batchResults,
    synthesis,
    timestamp: Date.now()
  };
  
  const cacheKey = `circl_mistral_v4_${contacts.length}_${contacts.map(c => c.id).sort().join(',').substring(0, 100)}`;
  localStorage.setItem(cacheKey, JSON.stringify(result));

  return result;
}
