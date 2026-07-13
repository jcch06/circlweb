const fs = require('fs');

const file = 'src/lib/mistral.ts';
let content = fs.readFileSync(file, 'utf-8');

// 1. Fix safeParseJSON
content = content.replace(
  `function safeParseJSON(text: string): any {
  try {
    let clean = text.replace(/\\\`\\\`\\\`json\\n?/gi, '').replace(/\\\`\\\`\\\`\\n?/gi, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error("JSON Parse Error:", err);
    return null;
  }
}`,
  `function safeParseJSON(text: string): any {
  try {
    let clean = text.replace(/\\\`\\\`\\\`json\\n?/gi, '').replace(/\\\`\\\`\\\`\\n?/gi, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      clean = clean.substring(start, end + 1);
    }
    return JSON.parse(clean);
  } catch (err) {
    console.error("JSON Parse Error:", err, "Raw text:", text);
    return null;
  }
}`
);

// 2. Fix processContactBatch fallback
content = content.replace(
  `  let text = await callMistral(prompt, true);
  const parsed = safeParseJSON(text);
  if (parsed && parsed.immediateSynergies) {
    return parsed as MistralBatchResult;
  }
  return { recurrentNeeds: [], immediateSynergies: [], keyCompetencies: [] };`,
  `  let text = await callMistral(prompt, true);
  const parsed = safeParseJSON(text);
  
  return {
    recurrentNeeds: parsed?.recurrentNeeds || [],
    immediateSynergies: parsed?.immediateSynergies || [],
    keyCompetencies: parsed?.keyCompetencies || []
  };`
);

// 3. Fix synthesizeNetwork fallback
content = content.replace(
  `  let text = await callMistral(prompt, true);
  const parsed = safeParseJSON(text);
  if (parsed && parsed.globalThemes) {
    return parsed as MistralGlobalSynthesis;
  }
  return { globalThemes: [], crossBatchSynergies: [], networkStrength: "Analyse échouée.", recommendedActionPlan: [] };`,
  `  let text = await callMistral(prompt, true);
  const parsed = safeParseJSON(text);
  
  return {
    globalThemes: parsed?.globalThemes || [],
    crossBatchSynergies: parsed?.crossBatchSynergies || [],
    networkStrength: parsed?.networkStrength || "Analyse échouée / Données insuffisantes",
    recommendedActionPlan: parsed?.recommendedActionPlan || []
  };`
);

// 4. Fix autoEnrichUserProfile signature and prompt
content = content.replace(
  `export async function autoEnrichUserProfile(
  name: string, 
  company: string, 
  role: string,
  existingProjects?: string,
  existingNeeds?: string
): Promise<any> {`,
  `export async function autoEnrichUserProfile(
  name: string, 
  company: string, 
  role: string
): Promise<any> {`
);

content = content.replace(
  `L'utilisateur a déjà renseigné les informations suivantes sur lui-même :
Projets actuels : \${existingProjects || 'Non renseigné'}
Besoins/Défis : \${existingNeeds || 'Non renseigné'}

Trouve ses compétences probables, et ENRICHIS ses projets et défis en intégrant intelligemment ce qu'il a déjà écrit avec tes nouvelles trouvailles (ne supprime pas ce qu'il a écrit, complète-le !).
Retourne UNIQUEMENT un objet JSON valide avec cette structure exacte :
{
  "skills": ["Compétence 1", "Compétence 2"],
  "currentProjects": "Texte combiné des projets existants et de tes ajouts...",
  "needs": "Texte combiné des besoins existants et de tes ajouts..."
}`,
  `L'utilisateur veut enrichir son profil.
Retourne UNIQUEMENT un objet JSON valide avec cette structure exacte :
{
  "skills": ["Compétence 1", "Compétence 2"],
  "currentProjects": "Un résumé des projets, responsabilités ou accomplissements liés à ce poste (n'inclus que tes NOUVELLES découvertes).",
  "needs": "Les défis ou besoins probables pour une personne à ce poste dans cette entreprise (NOUVELLES découvertes uniquement)."
}`
);

fs.writeFileSync(file, content);
console.log('mistral.ts patched successfully.');
