const fs = require('fs');
let c = fs.readFileSync('src/lib/mistral.ts', 'utf8');

const newPrompt = `Tu es un assistant d'analyse de profil B2B. Fais une recherche approfondie sur cette personne.
Nom : \${name}
Poste : \${role}
Entreprise : \${company}

L'utilisateur a déjà renseigné les informations suivantes sur lui-même :
Projets actuels : \${existingProjects || 'Non renseigné'}
Besoins/Défis : \${existingNeeds || 'Non renseigné'}

Trouve ses compétences probables, et ENRICHIS ses projets et défis en intégrant intelligemment ce qu'il a déjà écrit avec tes nouvelles trouvailles (ne supprime pas ce qu'il a écrit, complète-le !).
Retourne UNIQUEMENT un objet JSON valide avec cette structure exacte :
{
  "skills": ["Compétence 1", "Compétence 2"],
  "currentProjects": "Texte combiné des projets existants et de tes ajouts...",
  "needs": "Texte combiné des besoins existants et de tes ajouts..."
}`;

// regex to match the old prompt
const regex = /const prompt = `Tu es un assistant d'analyse de profil B2B(?:.|\n|\r)*?}`;/g;

c = c.replace(regex, 'const prompt = `' + newPrompt + '`;');

fs.writeFileSync('src/lib/mistral.ts', c);
console.log("Done");
