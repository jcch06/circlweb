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
  estimatedRevenue: string; // Rough revenue estimate (e.g. "2k-5k€/mois")
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
 * Build a dynamic user context string for prompts based on the user's bio/profile
 */
function buildUserContext(userProfile: any): string {
  const bio = userProfile?.bio || userProfile?.description || '';
  const skills = userProfile?.skills || [];
  const name = userProfile?.name || 'Utilisateur';
  const title = userProfile?.title || userProfile?.job_title || '';
  
  // Always-included generic monetization angles
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

  return `## PROFIL DE L'UTILISATEUR — ${name}
${title ? `Poste : ${title}` : ''}
${bio ? `Bio : ${bio}` : ''}
${skills.length > 0 ? `Compétences : ${skills.join(', ')}` : ''}

L'utilisateur veut MONÉTISER son réseau. Voici les angles de monétisation à explorer en priorité :
${genericAngles.map((a, i) => `${i + 1}. ${a}`).join('\n')}

ADAPTE ton analyse au profil spécifique de l'utilisateur ci-dessus. Si sa bio mentionne un domaine précis (ex: "architecte" → opportunités dans l'immobilier/urbanisme, "développeur" → consulting tech, "avocat" → conseil juridique), priorise les opportunités ALIGNÉES avec son expertise.`;
}

/**
 * PASSE 1 — Extract Normalized Profiles
 * Processes contacts in batches to extract structured profile data
 */
export async function extractNormalizedProfiles(
  contacts: any[],
  notes: any[],
  userProfile: any,
  onProgress?: (pct: number) => void
): Promise<NormalizedProfile[]> {
  const genAI = getGeminiClient();
  if (!genAI) throw new Error("Gemini API key is not configured");

  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

  const userContext = buildUserContext(userProfile);
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

    const prompt = `Tu es un analyste d'intelligence commerciale (Business Intelligence). Pour chaque contact ci-dessous, extrais un profil orienté BUSINESS et MONÉTISATION.

${userContext}

Ton but : extraire les signaux COMMERCIAUX de chaque profil en pensant à comment L'UTILISATEUR CI-DESSUS pourrait en tirer profit (vente, partenariat, commission, influence, etc.).

Contacts à analyser :
${JSON.stringify(batchData, null, 2)}

Pour CHAQUE contact, extrais les informations suivantes. Si une donnée n'est pas disponible, DÉDUIS-la intelligemment du poste, secteur et contexte. Sois PRÉCIS et CONCRET, pas générique.

Retourne un tableau JSON avec cette structure exacte pour chaque contact :
[
  {
    "contactId": "l'ID du contact",
    "name": "Nom complet",
    "sector": "Secteur d'activité normalisé (ex: FinTech, EdTech, SaaS, Immobilier, Santé, Consulting, etc.)",
    "roleCategory": "Décideur | Technique | Commercial | Créatif | Opérationnel | Support",
    "seniority": "Junior | Mid | Senior | C-Level | Fondateur",
    "explicitNeeds": ["Besoins EXPLICITEMENT mentionnés dans les notes ou bio — sois très spécifique"],
    "inferredNeeds": ["Besoins DÉDUITS du poste et secteur. Pense business : un CEO cherche des clients/investisseurs, un CTO cherche des devs, un commercial cherche des leads, un freelance cherche des missions"],
    "skillsOffered": ["Ce que cette personne PEUT VENDRE ou OFFRIR concrètement (expertise précise, réseau dans un secteur, pouvoir de décision, budget)"],
    "painPoints": ["Frustrations BUSINESS : manque de clients, coût d'acquisition trop élevé, difficulté à recruter, manque de financement, etc."],
    "collaborationOpenness": 3,
    "topicsOfInterest": ["Sujets business qui les passionnent"],
    "budgetAuthority": "none | influencer | decision-maker | budget-holder",
    "businessIntent": "Que cherche activement cette personne ? (recruter, vendre, lever des fonds, trouver des partenaires, se former, pivoter, etc.)",
    "networkValue": "connector | influencer | specialist | dormant",
    "buyingSignals": ["Signaux d'achat concrets : cherche un prestataire, recrute, lève des fonds, lance un projet, change de poste, croissance rapide"],
    "relationshipStrength": "cold | warm | hot | strategic (basé sur la quantité de notes/détails disponibles : beaucoup d'info = hot/strategic, peu = cold/warm)",
    "whatUserCanDoForThem": "Une phrase CONCRÈTE décrivant ce que l'utilisateur pourrait apporter à cette personne (ex: 'Lui présenter 3 investisseurs de son réseau', 'Lui fournir un dev React pour son projet')",
    "whatTheyCanDoForUser": "Une phrase CONCRÈTE décrivant ce que cette personne pourrait apporter à l'utilisateur (ex: 'Ouvrir la porte chez L'Oréal', 'Devenir client pour du consulting growth')"
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
      // Build a rich semantic text for high-quality embeddings
      const parts = [
        `${profile.name} travaille dans le secteur ${profile.sector} en tant que ${profile.roleCategory} (${profile.seniority}).`,
        profile.skillsOffered.length > 0 ? `Expertise : ${profile.skillsOffered.join(', ')}.` : '',
        profile.explicitNeeds.length > 0 ? `Besoins explicites : ${profile.explicitNeeds.join(', ')}.` : '',
        profile.inferredNeeds.length > 0 ? `Besoins déduits : ${profile.inferredNeeds.join(', ')}.` : '',
        profile.painPoints.length > 0 ? `Problèmes business : ${profile.painPoints.join(', ')}.` : '',
        profile.businessIntent ? `Objectif actuel : ${profile.businessIntent}.` : '',
        profile.buyingSignals && profile.buyingSignals.length > 0 ? `Signaux d'achat : ${profile.buyingSignals.join(', ')}.` : '',
        profile.budgetAuthority && profile.budgetAuthority !== 'none' ? `Pouvoir de décision : ${profile.budgetAuthority}.` : '',
        profile.networkValue ? `Valeur réseau : ${profile.networkValue}.` : '',
        profile.topicsOfInterest.length > 0 ? `Centres d'intérêt : ${profile.topicsOfInterest.join(', ')}.` : '',
        profile.whatUserCanDoForThem ? `Ce qu'on peut lui apporter : ${profile.whatUserCanDoForThem}.` : '',
        profile.whatTheyCanDoForUser ? `Ce qu'il/elle peut nous apporter : ${profile.whatTheyCanDoForUser}.` : ''
      ].filter(Boolean).join(' ');

      try {
        const result = await model.embedContent(parts);
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

  // Build condensed data for the prompt — include business signals
  const profilesSummary = profiles.map(p => ({
    id: p.contactId,
    name: p.name,
    needs: [...p.explicitNeeds, ...p.inferredNeeds],
    skills: p.skillsOffered,
    sector: p.sector,
    seniority: p.seniority,
    budgetAuthority: p.budgetAuthority || 'none',
    buyingSignals: p.buyingSignals || [],
    businessIntent: p.businessIntent || ''
  }));

  const prompt = `Tu es un analyste en intelligence de réseau pour des professionnels de la mise en relation, du consulting, du freelance, de la levée de fonds et de l'événementiel.

Ton objectif : identifier les besoins MONÉTISABLES dans ce réseau. Un besoin monétisable = un problème pour lequel quelqu'un est PRÊT À PAYER (en argent, en temps, en accès).

Profils du réseau (avec signaux d'achat) :
${JSON.stringify(profilesSummary, null, 2)}

Clusters détectés :
${JSON.stringify(clusters.map(c => ({ name: c.clusterName, theme: c.theme, members: c.members.map(m => m.name) })), null, 2)}

Profil de l'utilisateur (propriétaire du réseau) :
${JSON.stringify(userProfile, null, 2)}

INSTRUCTIONS :
1. Identifie les 10-15 besoins les plus CONCRETS et MONÉTISABLES du réseau
2. Priorise les besoins où il y a des signaux d'achat (gens qui cherchent activement, qui ont le budget, qui sont en phase de décision)
3. Pour chaque besoin, identifie les demandeurs ET les fournisseurs potentiels dans le réseau
4. Évalue le gap : "covered" (offre suffisante), "partial" (quelques fournisseurs), "opportunity" (forte demande, pas d'offre → le user peut intervenir)
5. Indique si le user peut combler ce gap avec ses compétences

EXEMPLES de besoins monétisables :
- "Besoin de développeurs React/Next.js pour un projet 6 mois" (pas juste "besoin tech")
- "Recherche d'investisseurs seed pour SaaS B2B (300-500K€)" (pas juste "financement")
- "Besoin d'un consultant growth pour atteindre 100 clients" (pas juste "croissance")
- "Recherche de partenaires commerciaux sur le marché français" (pas juste "partenariats")

Retourne UNIQUEMENT un tableau JSON :
[
  {
    "need": "Description PRÉCISE et CHIFFRÉE du besoin monétisable",
    "demanders": [{ "id": "ID contact", "name": "Nom" }],
    "suppliers": [{ "id": "ID contact", "name": "Nom" }],
    "gapLevel": "covered" | "partial" | "opportunity",
    "opportunityForUser": true | false
  }
]

Trie par potentiel de monétisation : "opportunity" avec budget-holders d'abord.`;

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

  const prompt = `Tu es un expert en analyse de communautés. Voici des groupes de personnes regroupées AUTOMATIQUEMENT par proximité sémantique (via un algorithme K-means sur des embeddings vectoriels).

RÈGLES STRICTES :
1. CHAQUE PERSONNE N'APPARAÎT QUE DANS UN SEUL CLUSTER. Ne duplique JAMAIS un contact dans plusieurs clusters.
2. Les membres de chaque cluster sont CEUX QUI SONT LISTÉS dans le cluster — tu ne peux PAS les déplacer.
3. Donne un nom accrocheur au cluster qui capture PRÉCISÉMENT le point commun de ces personnes spécifiques.
4. Les "commonNeeds" et "commonSkills" doivent être des choses que la MAJORITÉ des membres du cluster partagent réellement, pas des généralités.
5. Si un cluster contient des profils très variés, sois honnête dans le thème (ex: "Profils entrepreneuriaux diversifiés") plutôt que d'inventer un lien artificiel.

Clusters (groupements calculés par K-means) :
${JSON.stringify(clustersData, null, 2)}

Retourne un tableau JSON avec cette structure exacte. GARDE EXACTEMENT les mêmes membres dans chaque cluster, ne modifie pas les groupements :
[
  {
    "clusterId": 0,
    "clusterName": "Nom accrocheur et PRÉCIS du groupe",
    "theme": "Thème principal en une phrase courte",
    "members": [{ "id": "ID ORIGINAL du contact", "name": "Nom", "role": "Rôle", "company": "Entreprise" }],
    "commonNeeds": ["Besoin vraiment partagé par la majorité"],
    "commonSkills": ["Compétence vraiment commune"],
    "bridgeContacts": ["IDs des contacts qui font le pont"]
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

  const prompt = `Tu es un Business Strategist et Deal Maker de haut niveau.

${buildUserContext(userProfile)}

Ton but : trouver les DEALS CACHÉS dans ce réseau. Pas des idées vagues — des opportunités concrètes avec un modèle de revenu clair, ADAPTÉES AU PROFIL SPÉCIFIQUE de l'utilisateur ci-dessus.

## PROFIL DE L'UTILISATEUR (celui qui possède le réseau)
${JSON.stringify(userProfile, null, 2)}

## CLUSTERS DÉTECTÉS DANS LE RÉSEAU
${JSON.stringify(clusters.map(c => ({
    name: c.clusterName,
    theme: c.theme,
    memberCount: c.members.length,
    commonNeeds: c.commonNeeds,
    commonSkills: c.commonSkills
  })), null, 2)}

## GAPS IDENTIFIÉS (Besoins monétisables non couverts)
${JSON.stringify(gaps, null, 2)}

## OPPORTUNITÉS SPÉCIFIQUES POUR L'UTILISATEUR
${JSON.stringify(userOpportunities, null, 2)}

## PROFILS DÉTAILLÉS DES CONTACTS (avec signaux d'achat)
${JSON.stringify(profiles.map(p => ({
    name: p.name,
    sector: p.sector,
    seniority: p.seniority,
    needs: [...p.explicitNeeds, ...p.inferredNeeds].slice(0, 4),
    skills: p.skillsOffered.slice(0, 3),
    budgetAuthority: p.budgetAuthority || 'none',
    buyingSignals: p.buyingSignals || [],
    businessIntent: p.businessIntent || ''
  })), null, 2)}

GÉNÈRE jusqu'à 8 opportunités concrètes. Pour chaque opportunité, pense comme un deal maker :
- QUI paie ? (le client, un sponsor, une commission ?)
- COMBIEN ? (estimation réaliste en euros)
- QUAND ? (immédiat, 1 mois, 3 mois)
- COMMENT tu te fais payer ? (prestation, commission d'apporteur d'affaires, abonnement, ticket d'entrée, equity)

Répartis en 4 catégories :
1. **"service"** : Missions de consulting, formations payantes, accompagnement stratégique, coaching
2. **"product"** : Produits numériques (SaaS, templates, guides premium, outils) pour un besoin récurrent
3. **"connection"** : Mise en relation à haute valeur. L'utilisateur joue le BROKER : il prend une commission ou renforce sa position en orchestrant le deal
4. **"event"** : Dîners privés, masterclasses, cercles de réflexion exclusifs avec un ticket d'entrée ou des sponsors

Retourne UNIQUEMENT un tableau JSON :
[
  {
    "category": "service" | "product" | "connection" | "event",
    "title": "Nom concret et vendeur (ex: 'Sprint Acquisition Client pour fondateurs SaaS')",
    "description": "Description en 2-3 phrases qui donne envie d'agir",
    "targetCluster": "Nom du cluster ciblé",
    "demandScore": 8,
    "feasibilityScore": 7,
    "relevantContacts": [
      { "id": "ID", "name": "Nom", "role": "Poste", "company": "Entreprise", "reason": "Prospect / Partenaire / Ambassadeur / Sponsor — et pourquoi" }
    ],
    "actionPlan": ["Action 1 faisable CETTE SEMAINE", "Action 2 dans les 2 semaines", "Action 3 dans le mois"],
    "estimatedImpact": "Impact business concret (ex: 5 clients à 2K€, 3 partenariats qui ouvrent 50 leads)",
    "revenueModel": "Comment tu gagnes de l'argent (ex: commission 10% sur mise en relation, 3K€/jour de consulting, ticket 200€/personne)",
    "estimatedRevenue": "Estimation réaliste (ex: 5K-15K€ sur 3 mois)",
    "timeToRevenue": "Délai estimé (ex: 2 semaines, 1 mois, 3 mois)",
    "urgency": "immediate | short-term | medium-term"
  }
]

RÈGLES :
- Priorise les opportunités "immediate" avec des budget-holders identifiés
- Sois CONCRET sur les montants — mieux vaut une fourchette réaliste que pas de chiffre
- Chaque contact dans "relevantContacts" doit avoir une raison SPÉCIFIQUE (pas juste "intéressé par le sujet")
- L'action plan doit être faisable par UNE personne sans budget initial`;

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
  const profiles = await extractNormalizedProfiles(contacts, notes, userProfile, (pct) => onPassChange?.(1, pct));

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
    
    // Find optimal K — enforce minimum granularity
    let optimalK = findOptimalK(vectors);
    // For bigger networks, be more aggressive with splitting
    if (vectors.length >= 10) optimalK = Math.max(optimalK, 4);
    if (vectors.length >= 20) optimalK = Math.max(optimalK, 5);
    
    let { clusters: assignments } = kMeansClustering(vectors, optimalK);
    
    // Post-check: if any cluster has > 40% of contacts, increase K and retry
    const maxClusterSize = Math.ceil(vectors.length * 0.4);
    const clusterSizes = new Map<number, number>();
    assignments.forEach(c => clusterSizes.set(c, (clusterSizes.get(c) || 0) + 1));
    const hasOversizedCluster = Array.from(clusterSizes.values()).some(size => size > maxClusterSize);
    
    if (hasOversizedCluster && optimalK < vectors.length - 1) {
      const newK = Math.min(optimalK + 2, Math.floor(vectors.length / 2));
      const result2 = kMeansClustering(vectors, newK);
      assignments = result2.clusters;
    }
    
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
  const opportunities = await deepUserOpportunityAnalysis(userProfile, profiles, clusters, supplyDemand, (pct) => onPassChange?.(4, pct * 0.6));

  // === PASSE 4b: Strategic Pairwise Introductions ===
  onPassChange?.(4, 60);
  let keyIntros: StrategicIntro[] = [];
  if (embeddings.length >= 4) {
    const { cosineSimilarity } = await import('./vectorMath');
    keyIntros = await detectStrategicIntros(profiles, embeddings, clusters, userProfile, cosineSimilarity);
  }
  onPassChange?.(4, 100);

  // === PASSE 5: Network Genome & Valuation ===
  onPassChange?.(5, 0);
  const genome = await analyzeNetworkGenome(userProfile, profiles, opportunities, keyIntros);
  onPassChange?.(5, 100);

  // === PASSE 6: Reciprocity Engine ===
  onPassChange?.(6, 0);
  const reciprocity = await analyzeReciprocity(profiles, notes);
  onPassChange?.(6, 100);

  const result: OracleV3Result = {
    profiles,
    clusters,
    supplyDemand,
    opportunities,
    bridgeContacts,
    keyIntros,
    genome,
    reciprocity,
    timestamp: Date.now()
  };

  // Cache result
  try {
    localStorage.setItem(cacheKey, JSON.stringify(result));
  } catch { /* localStorage full, ignore */ }

  return result;
}

/**
 * PASSE 4b — Detect Strategic Pairwise Introductions
 * Uses similarity scores + supply/demand matching to find high-value intros
 */
async function detectStrategicIntros(
  profiles: NormalizedProfile[],
  embeddings: { contactId: string; embedding: number[] }[],
  clusters: NetworkCluster[],
  userProfile: any,
  cosineSimilarity: (a: number[], b: number[]) => number
): Promise<StrategicIntro[]> {
  const genAI = getGeminiClient();
  if (!genAI) return [];

  // Find cross-cluster pairs with complementary needs/skills
  const candidates: { a: NormalizedProfile; b: NormalizedProfile; sim: number; crossCluster: boolean }[] = [];
  
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const a = profiles[i];
      const b = profiles[j];
      
      // Check if they're in different clusters
      const clusterA = clusters.find(c => c.members.some(m => m.id === a.contactId));
      const clusterB = clusters.find(c => c.members.some(m => m.id === b.contactId));
      const crossCluster = clusterA !== clusterB;
      
      // Check complementarity: A's skills match B's needs or vice versa
      const aSkills = new Set(a.skillsOffered.map(s => s.toLowerCase()));
      const bSkills = new Set(b.skillsOffered.map(s => s.toLowerCase()));
      const aNeeds = [...a.explicitNeeds, ...a.inferredNeeds].map(n => n.toLowerCase());
      const bNeeds = [...b.explicitNeeds, ...b.inferredNeeds].map(n => n.toLowerCase());
      
      const aCanHelpB = aNeeds.some(need => [...bSkills].some(skill => need.includes(skill) || skill.includes(need)));
      const bCanHelpA = bNeeds.some(need => [...aSkills].some(skill => need.includes(skill) || skill.includes(need)));
      
      // Calculate similarity from embeddings
      const embA = embeddings.find(e => e.contactId === a.contactId);
      const embB = embeddings.find(e => e.contactId === b.contactId);
      const sim = embA && embB ? cosineSimilarity(embA.embedding, embB.embedding) : 0;
      
      // Score: cross-cluster pairs with complementary needs score highest
      const complementaryBoost = (aCanHelpB || bCanHelpA) ? 0.3 : 0;
      const crossClusterBoost = crossCluster ? 0.2 : 0;
      const score = sim + complementaryBoost + crossClusterBoost;
      
      if (score > 0.4) {
        candidates.push({ a, b, sim: Math.round(score * 100) / 100, crossCluster });
      }
    }
  }
  
  // Take top 8 candidates
  const topCandidates = candidates
    .sort((x, y) => y.sim - x.sim)
    .slice(0, 8);
  
  if (topCandidates.length === 0) return [];

  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

  const prompt = `Tu es un expert en mise en relation stratégique. Voici des paires de contacts qui pourraient bénéficier d'une introduction.

${buildUserContext(userProfile)}

Paires candidates (triées par score de compatibilité) :
${JSON.stringify(topCandidates.map(c => ({
    contactA: { name: c.a.name, sector: c.a.sector, role: c.a.roleCategory, seniority: c.a.seniority, needs: [...c.a.explicitNeeds, ...c.a.inferredNeeds].slice(0, 3), skills: c.a.skillsOffered.slice(0, 3), intent: c.a.businessIntent },
    contactB: { name: c.b.name, sector: c.b.sector, role: c.b.roleCategory, seniority: c.b.seniority, needs: [...c.b.explicitNeeds, ...c.b.inferredNeeds].slice(0, 3), skills: c.b.skillsOffered.slice(0, 3), intent: c.b.businessIntent },
    score: c.sim,
    crossCluster: c.crossCluster
  })), null, 2)}

Pour chaque paire, évalue si l'introduction a du SENS BUSINESS. Élimine les paires sans vraie valeur ajoutée.
Pour les paires retenues, explique CONCRÈTEMENT :
- Pourquoi ils devraient se rencontrer
- Ce que A gagne
- Ce que B gagne
- Ce que l'UTILISATEUR gagne en orchestrant cette intro (commission, positionnement, réciprocité)

Retourne UNIQUEMENT un tableau JSON :
[
  {
    "contactA": { "id": "", "name": "Nom A", "role": "Rôle", "company": "Entreprise" },
    "contactB": { "id": "", "name": "Nom B", "role": "Rôle", "company": "Entreprise" },
    "reason": "Phrase d'accroche pour l'introduction (ex: 'Marie a exactement le profil d'investisseur que Paul recherche pour sa série A')",
    "valueForA": "Ce que A gagne concrètement",
    "valueForB": "Ce que B gagne concrètement",
    "valueForUser": "Ce que l'utilisateur gagne en faisant cette intro",
    "urgency": "immediate | short-term | medium-term",
    "similarityScore": 0.85
  }
]

Retourne entre 3 et 6 introductions les plus stratégiques.`;

  try {
    const result = await model.generateContent(prompt);
    const intros = safeParseGeminiJSON(result.response.text());
    return Array.isArray(intros) ? intros : [];
  } catch (err) {
    console.error('Strategic intros error:', err);
    return [];
  }
}

/**
 * PASSE 5 — Analyze Network Genome & Valuation
 */
async function analyzeNetworkGenome(
  userProfile: any,
  profiles: NormalizedProfile[],
  opportunities: DeepOpportunity[],
  keyIntros: StrategicIntro[]
): Promise<NetworkGenome> {
  const genAI = getGeminiClient();
  if (!genAI) return { valuationScore: 0, valuationReasoning: '', networkPersona: 'Inconnu', topStrengths: [], blindSpots: [] };

  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

  const prompt = `Tu es un auditeur financier spécialisé dans la valorisation de capital social et de réseaux d'affaires.

${buildUserContext(userProfile)}

Voici un résumé du réseau de l'utilisateur :
- Taille : ${profiles.length} contacts qualifiés
- Opportunités directes détectées : ${opportunities.length}
- Introductions stratégiques détectées : ${keyIntros.length}

Détails des opportunités :
${JSON.stringify(opportunities.map(o => ({ title: o.title, estimatedRevenue: o.estimatedRevenue, urgency: o.urgency })), null, 2)}

Ton objectif : Générer l'ADN du réseau (Network Genome) et estimer sa valeur financière ANNUELLE potentielle.

Instructions pour la valorisation financière (valuationScore) :
- Additionne la valeur basse estimée de chaque opportunité. Si c'est "2k-5k€", compte 2000€.
- Ajoute 500€ de valeur pour chaque introduction stratégique.
- Applique un multiplicateur basé sur la densité de décideurs (budget-holder/decision-maker) dans le réseau.
- Retourne UNIQUEMENT un NOMBRE ENTIER (ex: 47000) pour la valeur \`valuationScore\`.

Retourne un objet JSON avec la structure exacte suivante :
{
  "valuationScore": 47000,
  "valuationReasoning": "Explication courte du calcul. Ex: 'Basé sur 3 opportunités qualifiées (25K€) et 4 intros stratégiques (2K€), plus une prime pour votre densité de décideurs Tech.'",
  "networkPersona": "Un titre accrocheur définissant le style du réseau (ex: 'Le Hub B2B Parisien', 'L'Insider FinTech', 'Le Connecteur de Talents')",
  "topStrengths": [
    "Force 1 : Très forte concentration de fondateurs SaaS en recherche de fonds",
    "Force 2 : Excellente couverture des décideurs RH",
    "Force 3 : Capacité à connecter la tech et le marketing"
  ],
  "blindSpots": [
    "Angle mort 1 : Beaucoup de startups mais aucun investisseur VC pour les financer",
    "Angle mort 2 : Un réseau très francilien, peu d'ouvertures à l'international"
  ]
}`;

  try {
    const result = await model.generateContent(prompt);
    const genome = safeParseGeminiJSON(result.response.text());
    
    // Fallback if parsing fails or structure is wrong
    if (!genome || typeof genome.valuationScore !== 'number') {
      return {
        valuationScore: 0,
        valuationReasoning: 'Calcul de valorisation indisponible.',
        networkPersona: 'Analyse en cours',
        topStrengths: [],
        blindSpots: []
      };
    }
    
    return genome as NetworkGenome;
  } catch (err) {
    console.error('Network genome error:', err);
    return { valuationScore: 0, valuationReasoning: 'Erreur', networkPersona: 'Erreur', topStrengths: [], blindSpots: [] };
  }
}

/**
 * PASSE 6 — Analyze Reciprocity Engine
 */
async function analyzeReciprocity(
  profiles: NormalizedProfile[],
  notes: any[]
): Promise<ReciprocityImbalance[]> {
  const genAI = getGeminiClient();
  if (!genAI) return [];

  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

  // Ne prendre que les contacts avec des notes pour l'analyse
  const contactsWithNotes = profiles.filter(p => notes.some(n => n.contact_id === p.contactId));
  
  if (contactsWithNotes.length === 0) return [];

  const contactData = contactsWithNotes.map(p => {
    const contactNotes = notes.filter(n => n.contact_id === p.contactId).map(n => n.content);
    return {
      id: p.contactId,
      name: p.name,
      notes: contactNotes
    };
  });

  const prompt = `Tu es un expert en intelligence relationnelle.
Voici des contacts et les notes prises par l'utilisateur à leur sujet.
Ton but est de détecter les "Déséquilibres de Réciprocité" (Reciprocity Imbalance) — c'est-à-dire les relations où l'une des parties a rendu un service significatif à l'autre, et où un retour d'ascenseur est attendu ou recommandé.

Données des contacts :
${JSON.stringify(contactData, null, 2)}

Pour chaque contact, détermine s'il y a un déséquilibre clair basé sur les mots utilisés dans les notes (ex: "m'a présenté à", "je l'ai aidé sur", "redevable", "a fait une intro"). S'il n'y en a pas, ignore-le.

Retourne UNIQUEMENT un tableau JSON :
[
  {
    "contactId": "ID du contact",
    "contactName": "Nom du contact",
    "status": "user_owes_them" (l'utilisateur leur doit un service) OU "they_owe_user" (ils doivent un service à l'utilisateur),
    "reason": "Phrase courte expliquant pourquoi (ex: 'Pierre vous a mis en relation avec le CTO de LVMH')",
    "recommendedAction": "Action concrète recommandée (ex: 'Invitez-le à déjeuner', 'Envoyez-lui un prospect')"
  }
]`;

  try {
    const result = await model.generateContent(prompt);
    const parsed = safeParseGeminiJSON(result.response.text());
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Reciprocity engine error:', err);
    return [];
  }
}
