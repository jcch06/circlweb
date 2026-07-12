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
  const text = result.response.text();
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
  const text = result.response.text();
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
  const text = result.response.text();
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
  const text = result.response.text();
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
  const text = result.response.text();
  return JSON.parse(text);
}

/**
 * 6. Auto Enrichment (Batch-safe)
 * Generates an enriched profile directly from known contact data (no scraped text needed).
 * Perfect for bulk enrichment runs.
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
  const genAI = getGeminiClient();
  if (!genAI) throw new Error("Gemini API key is not configured in .env.local");

  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

  const prompt = `Tu es un agent d'intelligence commerciale spécialisé dans l'enrichissement de fiches contacts B2B.
À partir des informations connues sur ce professionnel, génère une fiche enrichie détaillée et réaliste.

Nom : ${contact.first_name} ${contact.last_name}
Poste : ${contact.job_title || 'Inconnu'}
Entreprise : ${contact.company || 'Inconnue'}
Secteur : ${contact.industry || 'Non renseigné'}
Ville/Pays : ${contact.location || 'Non renseigné'}
Bio actuelle : ${contact.bio || 'Aucune'}

Retourne STRICTEMENT ce JSON :
{
  "industry": "secteur d'activité précis (ex: FinTech, SaaS B2B, Santé Numérique)",
  "companySize": "Taille estimée (ex: 1-10, 11-50, 51-200, 201-1000, 1000+)",
  "bio": "Résumé professionnel en 2 phrases percutantes en français",
  "skills": ["3 à 5 compétences clés probables pour ce profil"],
  "inferredNeeds": ["2 à 3 besoins ou défis probables dans son secteur/poste"],
  "aiContext": "Un conseil stratégique en 2-3 phrases pour l'utilisateur : comment aborder ce contact, quels sujets mentionner, quelle valeur lui apporter"
}`;

  const result = await model.generateContent(prompt);
  let text = result.response.text();
  
  try {
    // Sanitize text: remove markdown code block formatting if present
    if (text.includes('```')) {
      text = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
    }
    
    // Fallback for truncated JSON
    text = text.trim();
    if (text.startsWith('{') && !text.endsWith('}')) {
      if (text.endsWith('"')) {
        text += '\n}';
      }
    }
    
    return JSON.parse(text);
  } catch (err) {
    try {
      // Second attempt: aggressive cleanup for common LLM JSON syntax errors
      // Fix stray quotes before closing brace: "\n"\n} -> "}
      let cleaned = text.replace(/"\s*"\s*}/g, '"}');
      // Fix trailing commas: ,} -> }
      cleaned = cleaned.replace(/,\s*}/g, '}');
      // Extract only the JSON object
      const startIdx = cleaned.indexOf('{');
      const endIdx = cleaned.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1) {
        cleaned = cleaned.substring(startIdx, endIdx + 1);
      }
      return JSON.parse(cleaned);
    } catch (finalErr) {
      console.error("Gemini JSON Parse Error. Raw text:", text);
      throw new Error("Failed to parse Gemini response: " + finalErr);
    }
  }
}
