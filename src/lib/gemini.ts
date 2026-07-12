import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize the Gemini API client
const getGeminiClient = () => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    return null;
  }
  return new GoogleGenerativeAI(apiKey);
};

export const isGeminiConfigured = () => {
  const client = getGeminiClient();
  return client !== null;
};

export const isPerplexityConfigured = () => {
  const key = import.meta.env.VITE_PERPLEXITY_API_KEY;
  return key && key.trim().length > 0;
};


// Interface definitions for the return schemas
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
  const genAI = getGeminiClient();
  if (!genAI) throw new Error("Gemini API key is not configured in .env.local");

  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

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

  const prompt = `Tu es l'algorithme "Oracle" de Circl Web. Ton rôle est de scanner ce réseau de contacts et d'identifier des synergies cachées.
Trouve des binômes de contacts (Contact A et Contact B) où l'un possède une compétence, une ressource ou un profil qui peut résoudre un problème ou répondre à un besoin exprimé par l'autre dans ses notes/bio.

Voici les données réseau en JSON :
${JSON.stringify(networkData, null, 2)}

Retourne un tableau JSON contenant jusqu'à 5 synergies les plus fortes avec la structure suivante :
[
  {
    "title": "Nom accrocheur de la synergie (ex: Synergie Financement ou Synergie Dev Mobile)",
    "description": "Explication de la synergie en une phrase",
    "sourceContact": { "id": "ID du contact ayant le besoin", "name": "Nom complet", "role": "Poste", "company": "Entreprise" },
    "targetContact": { "id": "ID du contact ayant la solution/compétence", "name": "Nom complet", "role": "Poste", "company": "Entreprise" },
    "matchReason": "Explication détaillée de pourquoi ces deux personnes doivent se parler (en français, max 3 phrases)",
    "recommendedIntroPath": "Comment le propriétaire du réseau (l'utilisateur) doit-il les connecter (ex: présenter A à B à propos de X)"
  }
]

Règle absolue : Ne propose que des synergies réalistes basées sur les données fournies. Réponds uniquement avec le JSON.`;

  const result = await model.generateContent(prompt);
  let text = result.response.text();
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
  const genAI = getGeminiClient();
  if (!genAI) throw new Error("Gemini API key is not configured in .env.local");

  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

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

  const prompt = `Tu es un consultant en business et innovation. L'utilisateur veut créer un projet (SaaS, service de consulting ou micro-logiciel) en s'appuyant sur ses propres compétences et sur les besoins non résolus de son réseau de contacts.

Mes compétences (l'utilisateur) :
${JSON.stringify(mySkills)}

Le réseau de contacts et leurs besoins identifiés (dans leurs notes de rendez-vous) :
${JSON.stringify(networkData, null, 2)}

Propose 3 idées de projets de services ou de produits numériques à développer. Pour chaque idée, associe l'utilisateur avec un ou plusieurs contacts de son réseau qui pourraient être des cofondateurs, des apporteurs d'affaires, des conseillers ou des premiers clients (design partners).

Format de réponse attendu (Strictement ce JSON) :
[
  {
    "title": "Nom du Projet",
    "tagline": "Une phrase d'accroche résumant la proposition de valeur",
    "problem": "Le problème identifié dans le réseau qui a inspiré cette idée",
    "solution": "Ce que fait le produit/service et comment il résout le problème en utilisant les compétences de l'utilisateur",
    "techStackSuggested": ["React", "Supabase", "Gemini API", "etc."],
    "involvedContacts": [
      { "id": "ID du contact", "name": "Nom complet", "role": "Poste", "contribution": "Son rôle dans le projet (ex: Premier client test, Conseiller sectoriel, Associé commercial)" }
    ],
    "marketPotential": "Estimation du potentiel de marché (ex: niche B2B, fort potentiel SaaS, etc.)",
    "difficulty": "Facile" | "Moyen" | "Difficile"
  }
]`;

  const result = await model.generateContent(prompt);
  let text = result.response.text();
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
  const genAI = getGeminiClient();
  if (!genAI) throw new Error("Gemini API key is not configured in .env.local");

  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

  const networkData = contacts.map(c => ({
    name: `${c.first_name} ${c.last_name}`,
    company: c.company || '',
    job_title: c.job_title || '',
    industry: c.industry || '',
    location: c.location || ''
  }));

  const prompt = `L'utilisateur cherche à entrer en contact avec quelqu'un occupant le poste de "${targetRole}" au sein de l'entreprise "${targetCompany}".
Analyse la liste des contacts de l'utilisateur et trouve les 3 meilleurs intermédiaires (connecteurs) qui travaillent dans la même boîte, le même secteur, ou qui ont un profil qui faciliterait une introduction "warm".

Réseau disponible :
${JSON.stringify(networkData, null, 2)}

Pour chaque connecteur identifié, génère un e-mail type en français que l'utilisateur peut lui envoyer pour demander la mise en relation.

Format attendu :
[
  {
    "targetName": "Nom de la cible (ou 'Un profil cible' si inconnu)",
    "targetCompany": "${targetCompany}",
    "connectorName": "Nom du contact intermédiaire identifié",
    "connectorCloseness": 4, // Note de 1 (faible) à 5 (très proche) basée sur la pertinence
    "reason": "Pourquoi ce contact est un bon connecteur (ex: travaille dans le même secteur ou a travaillé chez cette cible)",
    "introEmailDraft": "Le projet d'e-mail complet rédigé de manière professionnelle et chaleureuse en français"
  }
]`;

  const result = await model.generateContent(prompt);
  let text = result.response.text();
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
  const genAI = getGeminiClient();
  if (!genAI) throw new Error("Gemini API key is not configured in .env.local");

  // Gemini Flash is perfect for parsing and structuring raw text quickly and cheaply
  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

  const prompt = `Tu es un agent d'enrichissement de données de contact.
À partir des informations brutes scrappées sur internet concernant ${name} qui travaille chez ${company}, extrais et structure les informations de profil.

Texte brut scrappé :
\"\"\"
${scrapedText}
\"\"\"

Retourne STRICTEMENT le JSON suivant :
{
  "industry": "secteur d'activité déduit (ex: FinTech, SaaS, Santé)",
  "companySize": "Taille estimée de l'entreprise (ex: 1-10, 11-50, 51-200, 201-1000, 1000+)",
  "bio": "Résumé de son profil professionnel en 1 ou 2 phrases concises",
  "skills": ["liste de 3 à 5 compétences clés extraites, ex: React, Growth Hacking, Vente"],
  "inferredNeeds": ["liste de 2 à 3 besoins ou challenges potentiels déduits de son poste ou secteur, ex: Recrutement technique, Automatisation CRM"],
  "aiContext": "Un paragraphe d'analyse contextuelle destiné à l'utilisateur pour l'aider à aborder ce contact lors d'un rendez-vous."
}

Règle : Reste factuel, ne sur-interprète pas si le texte ne contient rien de pertinent.`;

  const result = await model.generateContent(prompt);
  let text = result.response.text();
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
  const genAI = getGeminiClient();
  if (!genAI) throw new Error("Gemini API key is not configured in .env.local");

  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

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

  const prompt = `Tu es l'algorithme "Oracle" de Circl Web. Ton rôle est de scanner le réseau pour identifier des synergies entre un contact d'intérêt spécifique et les autres membres du réseau.

Voici le contact d'intérêt sélectionné :
${JSON.stringify(selectedContactData, null, 2)}

Voici le reste du réseau de contacts disponible en JSON :
${JSON.stringify(networkData, null, 2)}

Identifie s'il existe des opportunités de synergie claires et pertinentes (jusqu'à 3 max) entre ce contact sélectionné et les autres membres du réseau. Par exemple, l'un a un besoin d'aide ou un projet à lancer, et l'autre a la compétence, l'intérêt ou les ressources nécessaires.

Retourne un tableau JSON contenant les synergies trouvées avec cette structure exacte :
[
  {
    "title": "Nom de la synergie (ex: Synergie Recrutement Tech ou Synergie Co-investissement)",
    "description": "Résumé court de la synergie en une phrase",
    "targetContact": { "id": "ID du contact complémentaire trouvé", "name": "Nom complet", "role": "Poste", "company": "Entreprise" },
    "matchReason": "Explication claire de pourquoi ces deux personnes doivent entrer en relation (en français, max 3 phrases)",
    "recommendedIntroPath": "Comment l'utilisateur peut les mettre en relation (ex: Proposer à A d'accompagner B sur le sujet Y)"
  }
]

Règle absolue : Ne propose que des synergies réalistes basées sur les données fournies. S'il n'y a aucune synergie évidente ou sensée, renvoie un tableau vide []. Réponds uniquement avec le JSON.`;

  const result = await model.generateContent(prompt);
  let text = result.response.text();
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
 * 6. Auto Enrichment (Batch-safe) — with Google Search grounding via REST API.
 * Uses the Gemini REST API directly (same as Edge Function) so Google Search
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
    throw new Error(`Données insuffisantes ou invalides pour enrichir "${contact.first_name} ${contact.last_name}"`);
  }

  const prompt = `Tu es un assistant d'enrichissement de contacts professionnels B2B.
Recherche sur le web des informations RÉELLES et VÉRIFIABLES sur ce contact professionnel.

Nom complet : ${contact.first_name} ${contact.last_name}
Poste : ${contact.job_title || 'Non renseigné'}
Entreprise : ${contact.company || 'Non renseignée'}
Secteur déclaré : ${contact.industry || 'Non renseigné'}
Localisation : ${contact.location || 'Non renseignée'}

RÈGLE ABSOLUE : Si tu n'as pas assez d'informations vérifiables, mets "null" plutôt qu'inventer.
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
    throw new Error(`Perplexity API error: ${response.status} — ${err}`);
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
  const genAI = getGeminiClient();
  if (!genAI) throw new Error("Gemini API key is not configured");

  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

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

  const prompt = `Tu es un expert en analyse de réseaux (Network Science). Ton but est d'analyser ce réseau professionnel pour identifier des "clusters" (groupes de personnes) ayant des besoins, défis ou intérêts communs.

Voici les membres du réseau avec leurs besoins, compétences et notes contextuelles :
${JSON.stringify(networkData, null, 2)}

Analyse tout le réseau et identifie jusqu'à 4 groupes de personnes (minimum 2 personnes par groupe) qui partagent une problématique majeure ou qui auraient intérêt à collaborer ensemble.

Retourne UNIQUEMENT un tableau JSON valide avec cette structure exacte :
[
  {
    "clusterName": "Nom accrocheur du groupe (ex: Les pionniers de l'IA RH)",
    "commonNeeds": ["Besoin majeur partagé 1", "Besoin partagé 2"],
    "members": [
      { "id": "ID du contact", "name": "Nom complet", "role": "Poste", "company": "Entreprise" }
    ],
    "potentialService": "Idée de service, produit, ou événement qui pourrait résoudre leur problème commun",
    "matchReason": "Explication détaillée de pourquoi ces personnes forment un groupe cohérent et ce qu'elles ont à gagner à se rencontrer"
  }
]`;

  const result = await model.generateContent(prompt);
  let text = result.response.text();
  text = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
  return JSON.parse(text);
}

/**
 * 8. User Opportunities Brainstorming
 * Proposes specific services or projects the SaaS user can launch to serve network clusters.
 */
export async function brainstormUserOpportunities(userProfile: any, contacts: any[], notes: any[]): Promise<UserOpportunityResult[]> {
  const genAI = getGeminiClient();
  if (!genAI) throw new Error("Gemini API key is not configured");

  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash", // Pro model for deeper reasoning
    generationConfig: { responseMimeType: "application/json" }
  });

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

  const prompt = `Tu es un conseiller stratégique (Business Strategist). Ton but est d'analyser le réseau de l'utilisateur pour lui suggérer des offres, services ou projets très concrets qu'il pourrait créer pour monétiser son réseau ou y apporter de la valeur, en te basant sur SON profil.

Voici le profil de l'utilisateur (celui qui possède ce réseau) :
${JSON.stringify(userProfile, null, 2)}

Voici les contacts de son réseau avec leurs besoins et contextes :
${JSON.stringify(networkData, null, 2)}

Identifie les plus grandes opportunités (jusqu'à 4) où les compétences de l'utilisateur croisent un besoin partagé par plusieurs contacts de son réseau.

Retourne UNIQUEMENT un tableau JSON valide avec cette structure exacte :
[
  {
    "opportunityTitle": "Nom de l'offre/projet (ex: Création d'une formation IA pour les RH)",
    "targetAudience": "Description du segment cible dans le réseau",
    "problemSolved": "Quel problème profond cette opportunité résout-elle ?",
    "proposedSolution": "Comment l'utilisateur peut-il utiliser ses compétences pour répondre à ce besoin ?",
    "relevantContacts": [
      { "id": "ID du contact cible", "name": "Nom", "role": "Poste", "company": "Entreprise" }
    ],
    "actionPlan": "Les 3 prochaines étapes concrètes pour lancer cette opportunité."
  }
]`;

  const result = await model.generateContent(prompt);
  let text = result.response.text();
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

Trouve ses compétences probables, ses projets actuels et les défis (besoins) auxquels elle fait face dans ce rôle.
Retourne UNIQUEMENT un objet JSON valide avec cette structure exacte :
{
  "skills": ["Compétence 1", "Compétence 2"],
  "currentProjects": "Un paragraphe décrivant les missions ou projets probables...",
  "needs": "Un paragraphe décrivant ses enjeux et défis actuels..."
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
    throw new Error(`Perplexity API error: ${response.status} — ${err}`);
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
// ORACLE IA V3 — Multi-Pass Intelligence Pipeline
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
  demandScore: number; // 1-10: how many people need this
  feasibilityScore: number; // 1-10: how feasible based on user skills
  relevantContacts: { id: string; name: string; role: string; company: string; reason: string }[];
  actionPlan: string[];
  estimatedImpact: string;
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
  timestamp: number;
}

// Helper to parse Gemini JSON responses safely
function safeParseGeminiJSON(text: string): any {
  let cleaned = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to fix common issues
    cleaned = cleaned.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    const start = cleaned.indexOf('[') !== -1 && (cleaned.indexOf('{') === -1 || cleaned.indexOf('[') < cleaned.indexOf('{'))
      ? cleaned.indexOf('[')
      : cleaned.indexOf('{');
    const end = cleaned.lastIndexOf(']') !== -1 && cleaned.lastIndexOf(']') > cleaned.lastIndexOf('}')
      ? cleaned.lastIndexOf(']')
      : cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      return JSON.parse(cleaned.substring(start, end + 1));
    }
    throw new Error('Could not parse Gemini response as JSON');
  }
}

/**
 * PASSE 1 — Extract Normalized Profiles
 * Processes contacts in batches to extract structured profile data
 */
export async function extractNormalizedProfiles(
  contacts: any[],
  notes: any[],
  onProgress?: (pct: number) => void
): Promise<NormalizedProfile[]> {
  const genAI = getGeminiClient();
  if (!genAI) throw new Error("Gemini API key is not configured");

  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

  const allProfiles: NormalizedProfile[] = [];
  const batchSize = 8;
  const batches: any[][] = [];

  // Prepare batches
  for (let i = 0; i < contacts.length; i += batchSize) {
    batches.push(contacts.slice(i, i + batchSize));
  }

  for (let bIdx = 0; bIdx < batches.length; bIdx++) {
    const batch = batches[bIdx];
    const batchData = batch.map(c => {
      const contactNotes = notes
        .filter(n => n.contact_id === c.id)
        .map(n => n.content)
        .join(" | ");
      return {
        id: c.id,
        name: `${c.first_name} ${c.last_name}`,
        company: c.company || '',
        job_title: c.job_title || '',
        industry: c.industry || '',
        bio: c.bio || '',
        skills: c.skills || [],
        inferred_needs: c.inferred_needs || [],
        notes: contactNotes
      };
    });

    const prompt = `Tu es un algorithme d'extraction de données. Pour chaque contact ci-dessous, extrais un profil normalisé.

Contacts à analyser :
${JSON.stringify(batchData, null, 2)}

Pour CHAQUE contact, extrais les informations suivantes. Si une donnée n'est pas disponible, déduis-la intelligemment du poste, secteur et contexte.

Retourne un tableau JSON avec cette structure exacte pour chaque contact :
[
  {
    "contactId": "l'ID du contact",
    "name": "Nom complet",
    "sector": "Secteur d'activité normalisé (ex: FinTech, EdTech, SaaS, Immobilier, Santé, Consulting, etc.)",
    "roleCategory": "Catégorie de rôle : Décideur | Technique | Commercial | Créatif | Opérationnel | Support",
    "seniority": "Junior | Mid | Senior | C-Level | Fondateur",
    "explicitNeeds": ["Besoins EXPLICITEMENT mentionnés dans les notes ou bio"],
    "inferredNeeds": ["Besoins DÉDUITS du poste et secteur (ex: un CTO a besoin de recrutement tech, un CEO de levée de fonds)"],
    "skillsOffered": ["Ce que cette personne PEUT offrir à d'autres (compétences, réseau, expertise)"],
    "painPoints": ["Frustrations ou problèmes probables vu le contexte"],
    "collaborationOpenness": 3,
    "topicsOfInterest": ["Sujets qui les passionnent, déduits du profil"]
  }
]`;

    try {
      const result = await model.generateContent(prompt);
      const parsed = safeParseGeminiJSON(result.response.text());
      if (Array.isArray(parsed)) {
        allProfiles.push(...parsed);
      }
    } catch (err) {
      console.error(`Passe 1 batch ${bIdx} error:`, err);
      // Continue with remaining batches
    }

    onProgress?.(Math.round(((bIdx + 1) / batches.length) * 100));
  }

  return allProfiles;
}

/**
 * PASSE 2 — Compute Embeddings for each profile
 * Uses Gemini Embedding API to create vector representations
 */
export async function computeContactEmbeddings(
  profiles: NormalizedProfile[],
  onProgress?: (pct: number) => void
): Promise<{ contactId: string; embedding: number[] }[]> {
  const genAI = getGeminiClient();
  if (!genAI) throw new Error("Gemini API key is not configured");

  const model = genAI.getGenerativeModel({ model: "gemini-embedding-2" });
  const results: { contactId: string; embedding: number[] }[] = [];
  const batchSize = 5;

  for (let i = 0; i < profiles.length; i += batchSize) {
    const batch = profiles.slice(i, i + batchSize);
    
    const embedPromises = batch.map(async (profile) => {
      const text = [
        `Secteur: ${profile.sector}`,
        `Rôle: ${profile.roleCategory} (${profile.seniority})`,
        `Compétences: ${profile.skillsOffered.join(', ')}`,
        `Besoins: ${[...profile.explicitNeeds, ...profile.inferredNeeds].join(', ')}`,
        `Pain points: ${profile.painPoints.join(', ')}`,
        `Intérêts: ${profile.topicsOfInterest.join(', ')}`
      ].join('. ');

      try {
        const result = await model.embedContent(text);
        return {
          contactId: profile.contactId,
          embedding: result.embedding.values
        };
      } catch (err) {
        console.error(`Embedding error for ${profile.name}:`, err);
        return null;
      }
    });

    const batchResults = await Promise.all(embedPromises);
    results.push(...batchResults.filter((r): r is NonNullable<typeof r> => r !== null));

    onProgress?.(Math.round(((i + batch.length) / profiles.length) * 100));
  }

  return results;
}

/**
 * PASSE 3 — Build Supply/Demand Matrix
 * Analyzes all profiles to find what's needed vs what's available
 */
export async function buildSupplyDemandAnalysis(
  profiles: NormalizedProfile[],
  clusters: NetworkCluster[],
  userProfile: any,
  onProgress?: (pct: number) => void
): Promise<SupplyDemandEntry[]> {
  const genAI = getGeminiClient();
  if (!genAI) throw new Error("Gemini API key is not configured");

  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

  onProgress?.(10);

  // Build condensed data for the prompt
  const profilesSummary = profiles.map(p => ({
    id: p.contactId,
    name: p.name,
    needs: [...p.explicitNeeds, ...p.inferredNeeds],
    skills: p.skillsOffered,
    sector: p.sector
  }));

  const prompt = `Tu es un analyste de réseau expert. Ton rôle est de construire une MATRICE OFFRE/DEMANDE complète à partir de ce réseau professionnel.

Profils du réseau :
${JSON.stringify(profilesSummary, null, 2)}

Clusters détectés :
${JSON.stringify(clusters.map(c => ({ name: c.clusterName, theme: c.theme, members: c.members.map(m => m.name) })), null, 2)}

Profil de l'utilisateur (propriétaire du réseau) :
${JSON.stringify(userProfile, null, 2)}

INSTRUCTIONS :
1. Identifie TOUS les besoins majeurs exprimés ou déduits dans le réseau (jusqu'à 15 besoins)
2. Pour chaque besoin, liste QUI en a besoin (demandeurs) et QUI peut y répondre (fournisseurs)
3. Évalue le niveau de couverture : "covered" (offre >= demande), "partial" (quelques fournisseurs mais pas assez), "opportunity" (forte demande, pas d'offre interne)
4. Indique si l'utilisateur pourrait combler ce gap avec ses compétences (opportunityForUser)

Retourne UNIQUEMENT un tableau JSON avec cette structure :
[
  {
    "need": "Description du besoin (ex: Expertise en IA générative)",
    "demanders": [{ "id": "ID contact", "name": "Nom" }],
    "suppliers": [{ "id": "ID contact", "name": "Nom" }],
    "gapLevel": "covered" | "partial" | "opportunity",
    "opportunityForUser": true | false
  }
]

Trie les résultats par importance : les "opportunity" d'abord, puis "partial", puis "covered".`;

  onProgress?.(30);

  const result = await model.generateContent(prompt);
  const entries = safeParseGeminiJSON(result.response.text());

  onProgress?.(100);
  return entries;
}

/**
 * PASSE 3b — Name clusters using Gemini
 * Takes raw cluster assignments and generates meaningful names/themes
 */
export async function nameClusters(
  profiles: NormalizedProfile[],
  clusterAssignments: number[],
  bridgeScores: number[]
): Promise<NetworkCluster[]> {
  const genAI = getGeminiClient();
  if (!genAI) throw new Error("Gemini API key is not configured");

  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

  // Group profiles by cluster
  const clusterMap = new Map<number, NormalizedProfile[]>();
  clusterAssignments.forEach((clusterId, idx) => {
    if (!clusterMap.has(clusterId)) clusterMap.set(clusterId, []);
    clusterMap.get(clusterId)!.push(profiles[idx]);
  });

  // Find bridge contacts (top 20% centrality)
  const sortedScores = [...bridgeScores].sort((a, b) => b - a);
  const bridgeThreshold = sortedScores[Math.max(0, Math.floor(sortedScores.length * 0.2) - 1)] || 0;

  const clustersData = Array.from(clusterMap.entries()).map(([clusterId, members]) => ({
    clusterId,
    members: members.map(m => ({
      id: m.contactId,
      name: m.name,
      sector: m.sector,
      role: m.roleCategory,
      needs: [...m.explicitNeeds, ...m.inferredNeeds],
      skills: m.skillsOffered,
      interests: m.topicsOfInterest
    })),
    bridgeContactIds: members
      .filter((_, idx) => {
        const globalIdx = profiles.findIndex(p => p.contactId === members[idx]?.contactId);
        return globalIdx !== -1 && bridgeScores[globalIdx] >= bridgeThreshold && bridgeThreshold > 0;
      })
      .map(m => m.contactId)
  }));

  const prompt = `Tu es un expert en analyse de communautés. Voici des groupes de personnes regroupées automatiquement par proximité sémantique (besoins, compétences, secteurs similaires).

Pour chaque cluster, donne-lui un nom accrocheur et identifie son thème principal, ses besoins communs et ses compétences partagées.

Clusters :
${JSON.stringify(clustersData, null, 2)}

Retourne un tableau JSON avec cette structure exacte :
[
  {
    "clusterId": 0,
    "clusterName": "Nom accrocheur du groupe (ex: Les Architectes du Digital)",
    "theme": "Thème principal en une phrase (ex: Transformation digitale et innovation produit)",
    "members": [{ "id": "ID", "name": "Nom", "role": "Rôle", "company": "Entreprise" }],
    "commonNeeds": ["Besoin partagé 1", "Besoin partagé 2"],
    "commonSkills": ["Compétence commune 1", "Compétence commune 2"],
    "bridgeContacts": ["IDs des contacts qui font le pont avec d'autres clusters"]
  }
]`;

  const result = await model.generateContent(prompt);
  return safeParseGeminiJSON(result.response.text());
}

/**
 * PASSE 4 — Deep User Opportunity Analysis
 * Crosses user profile with supply/demand gaps and clusters to find opportunities
 */
export async function deepUserOpportunityAnalysis(
  userProfile: any,
  profiles: NormalizedProfile[],
  clusters: NetworkCluster[],
  supplyDemand: SupplyDemandEntry[],
  onProgress?: (pct: number) => void
): Promise<DeepOpportunity[]> {
  const genAI = getGeminiClient();
  if (!genAI) throw new Error("Gemini API key is not configured");

  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

  onProgress?.(10);

  // Filter to the most interesting supply/demand entries
  const gaps = supplyDemand.filter(sd => sd.gapLevel === 'opportunity' || sd.gapLevel === 'partial');
  const userOpportunities = supplyDemand.filter(sd => sd.opportunityForUser);

  const prompt = `Tu es un Business Strategist de haut niveau. Tu dois analyser en profondeur les opportunités que l'utilisateur peut saisir dans son réseau professionnel.

## PROFIL DE L'UTILISATEUR (celui qui possède le réseau)
${JSON.stringify(userProfile, null, 2)}

## CLUSTERS DÉTECTÉS DANS LE RÉSEAU
${JSON.stringify(clusters.map(c => ({
    name: c.clusterName,
    theme: c.theme,
    members: c.members.length,
    commonNeeds: c.commonNeeds,
    commonSkills: c.commonSkills
  })), null, 2)}

## GAPS IDENTIFIÉS (Besoins non couverts)
${JSON.stringify(gaps, null, 2)}

## OPPORTUNITÉS SPÉCIFIQUES POUR L'UTILISATEUR
${JSON.stringify(userOpportunities, null, 2)}

## PROFILS DÉTAILLÉS DES CONTACTS
${JSON.stringify(profiles.map(p => ({
    name: p.name,
    sector: p.sector,
    needs: [...p.explicitNeeds, ...p.inferredNeeds].slice(0, 3),
    skills: p.skillsOffered.slice(0, 3)
  })), null, 2)}

ANALYSE EN PROFONDEUR et génère jusqu'à 8 opportunités concrètes réparties en 4 catégories :

1. **"service"** : Prestations de consulting, formation, ou accompagnement que l'utilisateur peut vendre à son réseau
2. **"product"** : Produits numériques (SaaS, templates, outils) à créer pour répondre à un besoin récurrent
3. **"connection"** : Introductions stratégiques à orchestrer entre contacts (l'utilisateur joue le rôle de connecteur)
4. **"event"** : Événements, masterclasses ou cercles de réflexion à organiser pour fédérer des clusters

Pour chaque opportunité, sois TRÈS CONCRET et ACTIONNABLE. Pas de généralités.

Retourne UNIQUEMENT un tableau JSON :
[
  {
    "category": "service" | "product" | "connection" | "event",
    "title": "Nom concret de l'opportunité",
    "description": "Description détaillée en 2-3 phrases",
    "targetCluster": "Nom du cluster ciblé",
    "demandScore": 8,
    "feasibilityScore": 7,
    "relevantContacts": [
      { "id": "ID", "name": "Nom", "role": "Poste", "company": "Entreprise", "reason": "Pourquoi ce contact est pertinent (prospect, partenaire, ambassadeur)" }
    ],
    "actionPlan": ["Étape 1 concrète", "Étape 2 concrète", "Étape 3 concrète"],
    "estimatedImpact": "Impact estimé (ex: 5 clients potentiels, 3 partenariats, revenus récurrents possibles)"
  }
]`;

  onProgress?.(50);

  const result = await model.generateContent(prompt);
  const opportunities = safeParseGeminiJSON(result.response.text());

  onProgress?.(100);
  return opportunities;
}

/**
 * Retrieve cached Oracle V3 result without running the pipeline
 */
export function getCachedOracleV3Result(contacts: any[]): OracleV3Result | null {
  if (!contacts || contacts.length === 0) return null;
  const cacheKey = `circl_oracle_v3_${contacts.length}_${contacts.map(c => c.id).sort().join(',').substring(0, 100)}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed.timestamp && Date.now() - parsed.timestamp < 3600000) {
        return parsed as OracleV3Result;
      }
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * MASTER ORCHESTRATOR — Runs the full 4-pass pipeline
 */
export async function runOracleV3Pipeline(
  contacts: any[],
  notes: any[],
  userProfile: any,
  onPassChange?: (pass: number, progress: number) => void
): Promise<OracleV3Result> {
  // Check cache first
  const cacheKey = `circl_oracle_v3_${contacts.length}_${contacts.map(c => c.id).sort().join(',').substring(0, 100)}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      // Cache valid for 1 hour
      if (parsed.timestamp && Date.now() - parsed.timestamp < 3600000) {
        return parsed;
      }
    } catch { /* ignore invalid cache */ }
  }

  // Import vectorMath dynamically to keep the module lightweight
  const { buildSimilarityMatrix, kMeansClustering, findOptimalK, computeBetweennessCentrality } = await import('./vectorMath');

  // === PASSE 1: Extract Normalized Profiles ===
  onPassChange?.(1, 0);
  const profiles = await extractNormalizedProfiles(contacts, notes, (pct) => onPassChange?.(1, pct));

  if (profiles.length === 0) {
    throw new Error("Aucun profil n'a pu être extrait. Vérifiez vos contacts.");
  }

  // === PASSE 2: Compute Embeddings ===
  onPassChange?.(2, 0);
  const embeddings = await computeContactEmbeddings(profiles, (pct) => onPassChange?.(2, pct));

  // Build similarity matrix and clustering
  onPassChange?.(2, 90);
  let clusters: NetworkCluster[] = [];
  let bridgeContacts: { id: string; name: string; centralityScore: number }[] = [];

  if (embeddings.length >= 4) {
    const vectors = embeddings.map(e => e.embedding);
    const simMatrix = buildSimilarityMatrix(vectors);
    
    // Find optimal K and cluster
    const optimalK = findOptimalK(vectors);
    const { clusters: assignments } = kMeansClustering(vectors, optimalK);
    
    // Compute bridge contacts
    const centrality = computeBetweennessCentrality(simMatrix, 0.4);
    
    // Match embeddings back to profiles
    const embeddingProfiles = embeddings.map(e => profiles.find(p => p.contactId === e.contactId)!).filter(Boolean);

    // === PASSE 3a: Name clusters ===
    onPassChange?.(3, 0);
    clusters = await nameClusters(embeddingProfiles, assignments, centrality);

    // Top bridge contacts
    const contactsWithCentrality = embeddings.map((e, idx) => ({
      id: e.contactId,
      name: profiles.find(p => p.contactId === e.contactId)?.name || 'Inconnu',
      centralityScore: Math.round(centrality[idx] * 100) / 100
    }));
    bridgeContacts = contactsWithCentrality
      .sort((a, b) => b.centralityScore - a.centralityScore)
      .slice(0, Math.max(3, Math.floor(contacts.length * 0.2)));
  } else {
    // Not enough contacts for clustering — use Gemini directly
    onPassChange?.(3, 0);
    const groupResults = await detectGroupSynergies(contacts, notes);
    clusters = groupResults.map((g, idx) => ({
      clusterId: idx,
      clusterName: g.clusterName,
      theme: g.matchReason,
      members: g.members,
      commonNeeds: g.commonNeeds,
      commonSkills: [],
      bridgeContacts: []
    }));
  }

  // === PASSE 3b: Build Supply/Demand Matrix ===
  onPassChange?.(3, 50);
  const supplyDemand = await buildSupplyDemandAnalysis(profiles, clusters, userProfile, (pct) => onPassChange?.(3, 50 + pct / 2));

  // === PASSE 4: Deep User Opportunity Analysis ===
  onPassChange?.(4, 0);
  const opportunities = await deepUserOpportunityAnalysis(userProfile, profiles, clusters, supplyDemand, (pct) => onPassChange?.(4, pct));

  const result: OracleV3Result = {
    profiles,
    clusters,
    supplyDemand,
    opportunities,
    bridgeContacts,
    timestamp: Date.now()
  };

  // Cache result
  try {
    localStorage.setItem(cacheKey, JSON.stringify(result));
  } catch { /* localStorage full, ignore */ }

  return result;
}

