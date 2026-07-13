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

  const prompt = `Tu es l'algorithme "Oracle" de Circl Web. Ton rÃ´le est de scanner ce rÃ©seau de contacts et d'identifier des synergies cachÃ©es.
Trouve des binÃ´mes de contacts (Contact A et Contact B) oÃ¹ l'un possÃ¨de une compÃ©tence, une ressource ou un profil qui peut rÃ©soudre un problÃ¨me ou rÃ©pondre Ã  un besoin exprimÃ© par l'autre dans ses notes/bio.

Voici les donnÃ©es rÃ©seau en JSON :
${JSON.stringify(networkData, null, 2)}

Retourne un tableau JSON contenant jusqu'Ã  5 synergies les plus fortes avec la structure suivante :
[
  {
    "title": "Nom accrocheur de la synergie (ex: Synergie Financement ou Synergie Dev Mobile)",
    "description": "Explication de la synergie en une phrase",
    "sourceContact": { "id": "ID du contact ayant le besoin", "name": "Nom complet", "role": "Poste", "company": "Entreprise" },
    "targetContact": { "id": "ID du contact ayant la solution/compÃ©tence", "name": "Nom complet", "role": "Poste", "company": "Entreprise" },
    "matchReason": "Explication dÃ©taillÃ©e de pourquoi ces deux personnes doivent se parler (en franÃ§ais, max 3 phrases)",
    "recommendedIntroPath": "Comment le propriÃ©taire du rÃ©seau (l'utilisateur) doit-il les connecter (ex: prÃ©senter A Ã  B Ã  propos de X)"
  }
]

RÃ¨gle absolue : Ne propose que des synergies rÃ©alistes basÃ©es sur les donnÃ©es fournies. RÃ©ponds uniquement avec le JSON.`;

  const result = await model.generateContent(prompt);
  trackGlobalUsage(result);
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

  const prompt = `Tu es un consultant en business et innovation. L'utilisateur veut crÃ©er un projet (SaaS, service de consulting ou micro-logiciel) en s'appuyant sur ses propres compÃ©tences et sur les besoins non rÃ©solus de son rÃ©seau de contacts.

Mes compÃ©tences (l'utilisateur) :
${JSON.stringify(mySkills)}

Le rÃ©seau de contacts et leurs besoins identifiÃ©s (dans leurs notes de rendez-vous) :
${JSON.stringify(networkData, null, 2)}

Propose 3 idÃ©es de projets de services ou de produits numÃ©riques Ã  dÃ©velopper. Pour chaque idÃ©e, associe l'utilisateur avec un ou plusieurs contacts de son rÃ©seau qui pourraient Ãªtre des cofondateurs, des apporteurs d'affaires, des conseillers ou des premiers clients (design partners).

Format de rÃ©ponse attendu (Strictement ce JSON) :
[
  {
    "title": "Nom du Projet",
    "tagline": "Une phrase d'accroche rÃ©sumant la proposition de valeur",
    "problem": "Le problÃ¨me identifiÃ© dans le rÃ©seau qui a inspirÃ© cette idÃ©e",
    "solution": "Ce que fait le produit/service et comment il rÃ©sout le problÃ¨me en utilisant les compÃ©tences de l'utilisateur",
    "techStackSuggested": ["React", "Supabase", "Gemini API", "etc."],
    "involvedContacts": [
      { "id": "ID du contact", "name": "Nom complet", "role": "Poste", "contribution": "Son rÃ´le dans le projet (ex: Premier client test, Conseiller sectoriel, AssociÃ© commercial)" }
    ],
    "marketPotential": "Estimation du potentiel de marchÃ© (ex: niche B2B, fort potentiel SaaS, etc.)",
    "difficulty": "Facile" | "Moyen" | "Difficile"
  }
]`;

  const result = await model.generateContent(prompt);
  trackGlobalUsage(result);
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

  const prompt = `L'utilisateur cherche Ã  entrer en contact avec quelqu'un occupant le poste de "${targetRole}" au sein de l'entreprise "${targetCompany}".
Analyse la liste des contacts de l'utilisateur et trouve les 3 meilleurs intermÃ©diaires (connecteurs) qui travaillent dans la mÃªme boÃ®te, le mÃªme secteur, ou qui ont un profil qui faciliterait une introduction "warm".

RÃ©seau disponible :
${JSON.stringify(networkData, null, 2)}

Pour chaque connecteur identifiÃ©, gÃ©nÃ¨re un e-mail type en franÃ§ais que l'utilisateur peut lui envoyer pour demander la mise en relation.

Format attendu :
[
  {
    "targetName": "Nom de la cible (ou 'Un profil cible' si inconnu)",
    "targetCompany": "${targetCompany}",
    "connectorName": "Nom du contact intermÃ©diaire identifiÃ©",
    "connectorCloseness": 4, // Note de 1 (faible) Ã  5 (trÃ¨s proche) basÃ©e sur la pertinence
    "reason": "Pourquoi ce contact est un bon connecteur (ex: travaille dans le mÃªme secteur ou a travaillÃ© chez cette cible)",
    "introEmailDraft": "Le projet d'e-mail complet rÃ©digÃ© de maniÃ¨re professionnelle et chaleureuse en franÃ§ais"
  }
]`;

  const result = await model.generateContent(prompt);
  trackGlobalUsage(result);
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

  const prompt = `Tu es un agent d'enrichissement de donnÃ©es de contact.
Ã€ partir des informations brutes scrappÃ©es sur internet concernant ${name} qui travaille chez ${company}, extrais et structure les informations de profil.

Texte brut scrappÃ© :
\"\"\"
${scrapedText}
\"\"\"

Retourne STRICTEMENT le JSON suivant :
{
  "industry": "secteur d'activitÃ© dÃ©duit (ex: FinTech, SaaS, SantÃ©)",
  "companySize": "Taille estimÃ©e de l'entreprise (ex: 1-10, 11-50, 51-200, 201-1000, 1000+)",
  "bio": "RÃ©sumÃ© de son profil professionnel en 1 ou 2 phrases concises",
  "skills": ["liste de 3 Ã  5 compÃ©tences clÃ©s extraites, ex: React, Growth Hacking, Vente"],
  "inferredNeeds": ["liste de 2 Ã  3 besoins ou challenges potentiels dÃ©duits de son poste ou secteur, ex: Recrutement technique, Automatisation CRM"],
  "aiContext": "Un paragraphe d'analyse contextuelle destinÃ© Ã  l'utilisateur pour l'aider Ã  aborder ce contact lors d'un rendez-vous."
}

RÃ¨gle : Reste factuel, ne sur-interprÃ¨te pas si le texte ne contient rien de pertinent.`;

  const result = await model.generateContent(prompt);
  trackGlobalUsage(result);
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

  const prompt = `Tu es l'algorithme "Oracle" de Circl Web. Ton rÃ´le est de scanner le rÃ©seau pour identifier des synergies entre un contact d'intÃ©rÃªt spÃ©cifique et les autres membres du rÃ©seau.

Voici le contact d'intÃ©rÃªt sÃ©lectionnÃ© :
${JSON.stringify(selectedContactData, null, 2)}

Voici le reste du rÃ©seau de contacts disponible en JSON :
${JSON.stringify(networkData, null, 2)}

Identifie s'il existe des opportunitÃ©s de synergie claires et pertinentes (jusqu'Ã  3 max) entre ce contact sÃ©lectionnÃ© et les autres membres du rÃ©seau. Par exemple, l'un a un besoin d'aide ou un projet Ã  lancer, et l'autre a la compÃ©tence, l'intÃ©rÃªt ou les ressources nÃ©cessaires.

Retourne un tableau JSON contenant les synergies trouvÃ©es avec cette structure exacte :
[
  {
    "title": "Nom de la synergie (ex: Synergie Recrutement Tech ou Synergie Co-investissement)",
    "description": "RÃ©sumÃ© court de la synergie en une phrase",
    "targetContact": { "id": "ID du contact complÃ©mentaire trouvÃ©", "name": "Nom complet", "role": "Poste", "company": "Entreprise" },
    "matchReason": "Explication claire de pourquoi ces deux personnes doivent entrer en relation (en franÃ§ais, max 3 phrases)",
    "recommendedIntroPath": "Comment l'utilisateur peut les mettre en relation (ex: Proposer Ã  A d'accompagner B sur le sujet Y)"
  }
]

RÃ¨gle absolue : Ne propose que des synergies rÃ©alistes basÃ©es sur les donnÃ©es fournies. S'il n'y a aucune synergie Ã©vidente ou sensÃ©e, renvoie un tableau vide []. RÃ©ponds uniquement avec le JSON.`;

  const result = await model.generateContent(prompt);
  trackGlobalUsage(result);
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
 * 6. Auto Enrichment (Batch-safe) â€” with Google Search grounding via REST API.
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
    throw new Error(`DonnÃ©es insuffisantes ou invalides pour enrichir "${contact.first_name} ${contact.last_name}"`);
  }

  const prompt = `Tu es un assistant d'enrichissement de contacts professionnels B2B.
Recherche sur le web des informations RÃ‰ELLES et VÃ‰RIFIABLES sur ce contact professionnel.

Nom complet : ${contact.first_name} ${contact.last_name}
Poste : ${contact.job_title || 'Non renseignÃ©'}
Entreprise : ${contact.company || 'Non renseignÃ©e'}
Secteur dÃ©clarÃ© : ${contact.industry || 'Non renseignÃ©'}
Localisation : ${contact.location || 'Non renseignÃ©e'}

RÃˆGLE ABSOLUE : Si tu n'as pas assez d'informations vÃ©rifiables, mets "null" plutÃ´t qu'inventer.
Ne gÃ©nÃ¨re JAMAIS de bio gÃ©nÃ©rique comme "professionnel chevronnÃ©" ou "experte en marketing digital".
La bio doit Ãªtre SPÃ‰CIFIQUE Ã  cette personne et cette entreprise.

Retourne UNIQUEMENT un objet JSON valide avec cette structure exacte, sans markdown ni code blocks autour :
{
  "industry": "secteur prÃ©cis ou null si inconnu",
  "companySize": "taille estimÃ©e (1-10 | 11-50 | 51-200 | 201-1000 | 1000+) ou null",
  "bio": "bio SPÃ‰CIFIQUE et VÃ‰RIFIABLE en 1-2 phrases, ou null si pas assez d'info",
  "skills": ["compÃ©tences spÃ©cifiques au poste/secteur"],
  "inferredNeeds": ["dÃ©fis spÃ©cifiques Ã  ce type de rÃ´le dans ce secteur"],
  "aiContext": "conseil concret et personnalisÃ© sur comment aborder ce contact, ou null si pas assez d'info"
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
    throw new Error(`Perplexity API error: ${response.status} â€” ${err}`);
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

  const prompt = `Tu es un expert en analyse de rÃ©seaux (Network Science). Ton but est d'analyser ce rÃ©seau professionnel pour identifier des "clusters" (groupes de personnes) ayant des besoins, dÃ©fis ou intÃ©rÃªts communs.

Voici les membres du rÃ©seau avec leurs besoins, compÃ©tences et notes contextuelles :
${JSON.stringify(networkData, null, 2)}

Analyse tout le rÃ©seau et identifie jusqu'Ã  4 groupes de personnes (minimum 2 personnes par groupe) qui partagent une problÃ©matique majeure ou qui auraient intÃ©rÃªt Ã  collaborer ensemble.

Retourne UNIQUEMENT un tableau JSON valide avec cette structure exacte :
[
  {
    "clusterName": "Nom accrocheur du groupe (ex: Les pionniers de l'IA RH)",
    "commonNeeds": ["Besoin majeur partagÃ© 1", "Besoin partagÃ© 2"],
    "members": [
      { "id": "ID du contact", "name": "Nom complet", "role": "Poste", "company": "Entreprise" }
    ],
    "potentialService": "IdÃ©e de service, produit, ou Ã©vÃ©nement qui pourrait rÃ©soudre leur problÃ¨me commun",
    "matchReason": "Explication dÃ©taillÃ©e de pourquoi ces personnes forment un groupe cohÃ©rent et ce qu'elles ont Ã  gagner Ã  se rencontrer"
  }
]`;

  const result = await model.generateContent(prompt);
  trackGlobalUsage(result);
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

  const prompt = `Tu es un conseiller stratÃ©gique (Business Strategist). Ton but est d'analyser le rÃ©seau de l'utilisateur pour lui suggÃ©rer des offres, services ou projets trÃ¨s concrets qu'il pourrait crÃ©er pour monÃ©tiser son rÃ©seau ou y apporter de la valeur, en te basant sur SON profil.

Voici le profil de l'utilisateur (celui qui possÃ¨de ce rÃ©seau) :
${JSON.stringify(userProfile, null, 2)}

Voici les contacts de son rÃ©seau avec leurs besoins et contextes :
${JSON.stringify(networkData, null, 2)}

Identifie les plus grandes opportunitÃ©s (jusqu'Ã  4) oÃ¹ les compÃ©tences de l'utilisateur croisent un besoin partagÃ© par plusieurs contacts de son rÃ©seau.

Retourne UNIQUEMENT un tableau JSON valide avec cette structure exacte :
[
  {
    "opportunityTitle": "Nom de l'offre/projet (ex: CrÃ©ation d'une formation IA pour les RH)",
    "targetAudience": "Description du segment cible dans le rÃ©seau",
    "problemSolved": "Quel problÃ¨me profond cette opportunitÃ© rÃ©sout-elle ?",
    "proposedSolution": "Comment l'utilisateur peut-il utiliser ses compÃ©tences pour rÃ©pondre Ã  ce besoin ?",
    "relevantContacts": [
      { "id": "ID du contact cible", "name": "Nom", "role": "Poste", "company": "Entreprise" }
    ],
    "actionPlan": "Les 3 prochaines Ã©tapes concrÃ¨tes pour lancer cette opportunitÃ©."
  }
]`;

  const result = await model.generateContent(prompt);
  trackGlobalUsage(result);
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

Trouve ses compÃ©tences probables, ses projets actuels et les dÃ©fis (besoins) auxquels elle fait face dans ce rÃ´le.
Retourne UNIQUEMENT un objet JSON valide avec cette structure exacte :
{
  "skills": ["CompÃ©tence 1", "CompÃ©tence 2"],
  "currentProjects": "Un paragraphe dÃ©crivant les missions ou projets probables...",
  "needs": "Un paragraphe dÃ©crivant ses enjeux et dÃ©fis actuels..."
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
    throw new Error(`Perplexity API error: ${response.status} â€” ${err}`);
  }

  const data = await response.json();
  let text = data.choices?.[0]?.message?.content || '{}';
  text = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();

  try {
