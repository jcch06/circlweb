// Standalone local test for the Mistral Large "Oracle" Map-Reduce pipeline.
// Run with:  node --env-file=.env.local src/lib/test_map_reduce.js
// (or export VITE_MISTRAL_API_KEY / MISTRAL_API_KEY in your shell before running)
//
// This script is intentionally self-contained (does not import mistral.ts,
// which relies on import.meta.env and is only valid inside Vite). It mirrors
// the MAP prompt used in processContactBatch() to validate, in isolation,
// that mistral-large-latest can deduce non-obvious synergies from a small,
// deliberately ambiguous batch of contacts.

import { Mistral } from '@mistralai/mistralai';

const apiKey = process.env.VITE_MISTRAL_API_KEY || process.env.MISTRAL_API_KEY;

if (!apiKey || apiKey === 'YOUR_MISTRAL_API_KEY_HERE') {
  console.error(
    '[test_map_reduce] Aucune clé API Mistral trouvée.\n' +
    'Définissez VITE_MISTRAL_API_KEY (ou MISTRAL_API_KEY) puis relancez :\n' +
    '  node --env-file=.env.local src/lib/test_map_reduce.js'
  );
  process.exit(1);
}

const MAP_REDUCE_MODEL = 'mistral-large-latest';

// 6 fake, deliberately ambiguous/distant profiles: no two contacts share an
// obvious skill<->need pairing on the surface, forcing the model to make
// indirect deductions rather than pattern-match keywords.
const fakeBatch = [
  {
    id: 'c1',
    name: 'Claire Dubois',
    job_title: 'Directrice Artistique Freelance',
    company: 'Indépendante',
    notes: "Cherche à structurer son activité en société et à trouver des clients récurrents dans le luxe."
  },
  {
    id: 'c2',
    name: 'Marc Andrieu',
    job_title: 'Avocat fiscaliste',
    company: 'Cabinet Andrieu & Associés',
    notes: "Spécialiste des montages de holding pour indépendants et professions libérales. Cherche à diversifier sa clientèle hors du secteur médical."
  },
  {
    id: 'c3',
    name: 'Sophie Nguyen',
    job_title: 'Responsable Achats',
    company: 'Maison Vallière (Maroquinerie de luxe)',
    notes: "En pleine recherche de nouveaux fournisseurs créatifs pour une collection capsule, budget encore non validé en interne."
  },
  {
    id: 'c4',
    name: 'Karim Benali',
    job_title: 'Ingénieur DevOps',
    company: 'CloudNova',
    notes: "Envisage de quitter le salariat, passionné de automatisation et de no-code, aucun projet concret pour l'instant."
  },
  {
    id: 'c5',
    name: 'Élise Ferrand',
    job_title: 'Coach en reconversion professionnelle',
    company: 'Indépendante',
    notes: "Accompagne des cadres en transition, cherche des témoignages concrets de reconversions réussies pour son prochain livre."
  },
  {
    id: 'c6',
    name: 'Thomas Roy',
    job_title: 'Fondateur',
    company: 'Studio Roy (no-code agency)',
    notes: "Cherche un associé technique capable d'automatiser la production de sites vitrines, débordé par la demande."
  }
];

function buildBatchData(batch) {
  return batch.map(c => `<contact id="${c.id}">
  <name>${c.name}</name>
  <role>${c.job_title}</role>
  <company>${c.company}</company>
  <notes>${c.notes}</notes>
</contact>`).join('\n');
}

function buildPrompt(batch) {
  return `<role>
Tu es "Oracle MAP", un analyste expert en réseaux professionnels et en détection de synergies business cachées. Tu es reconnu pour ta capacité à relier des profils en apparence très différents autour d'un besoin, d'une ressource ou d'une compétence complémentaire non évidente.
</role>

<instructions>
Analyse EN PROFONDEUR le lot de contacts fourni ci-dessous et extrais :
1. Les besoins récurrents ou latents (explicites dans les notes, ou déduits du poste/secteur/contexte).
2. Des synergies immédiates entre paires de contacts DE CE LOT UNIQUEMENT.
3. Les compétences clés (mots-clés) qui ressortent du groupe.
</instructions>

<rules>
- INTERDICTION FORMELLE de renvoyer un tableau "immediateSynergies" vide si le lot contient au moins 2 contacts. Si aucune synergie évidente n'existe, tu DOIS déduire une opportunité d'échange de compétences plausible même entre profils qui semblent éloignés au premier abord (ex : un besoin abstrait chez A peut être résolu par une compétence indirecte ou un réseau détenu par B). Sois créatif mais réaliste.
- N'invente jamais d'identité : utilise uniquement les id/noms fournis dans les balises <contact>.
- Chaque synergie doit avoir une "reason" concrète et actionnable, pas une généralité.
- Réponds STRICTEMENT avec un objet JSON valide respectant le format ci-dessous, sans aucun texte, markdown ou commentaire additionnel.
</rules>

<contacts>
${buildBatchData(batch)}
</contacts>

<output_format>
{
  "recurrentNeeds": ["besoin 1", "besoin 2"],
  "immediateSynergies": [
    {
      "contactId1": "id exact du premier contact",
      "contactName1": "Nom du premier",
      "contactId2": "id exact du deuxieme contact",
      "contactName2": "Nom du deuxieme",
      "reason": "Explication concrète et actionnable de la synergie, même indirecte"
    }
  ],
  "keyCompetencies": ["mot cle 1", "mot cle 2"]
}
</output_format>`;
}

function safeParseJSON(text) {
  try {
    const clean = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error('[test_map_reduce] JSON parse error:', err.message);
    return null;
  }
}

async function main() {
  console.log(`[test_map_reduce] Envoi du lot de ${fakeBatch.length} contacts à ${MAP_REDUCE_MODEL}...\n`);

  const client = new Mistral({ apiKey });
  const prompt = buildPrompt(fakeBatch);

  const response = await client.chat.complete({
    model: MAP_REDUCE_MODEL,
    messages: [{ role: 'user', content: prompt }],
    responseFormat: { type: 'json_object' }
  });

  const text = response.choices?.[0]?.message?.content ?? '{}';
  const parsed = safeParseJSON(typeof text === 'string' ? text : String(text));

  if (!parsed) {
    console.error('[test_map_reduce] ÉCHEC: réponse non parsable en JSON.');
    process.exit(1);
  }

  console.log('--- Résultat brut ---');
  console.log(JSON.stringify(parsed, null, 2));

  const synergyCount = Array.isArray(parsed.immediateSynergies) ? parsed.immediateSynergies.length : 0;
  console.log(`\n--- Validation ---`);
  console.log(`Besoins récurrents détectés : ${parsed.recurrentNeeds?.length ?? 0}`);
  console.log(`Synergies immédiates détectées : ${synergyCount}`);
  console.log(`Compétences clés détectées : ${parsed.keyCompetencies?.length ?? 0}`);

  if (synergyCount === 0) {
    console.error('\n[test_map_reduce] ÉCHEC: aucune synergie détectée malgré la consigne anti-tableau-vide.');
    process.exit(1);
  }

  console.log('\n[test_map_reduce] SUCCÈS: Mistral Large a extrait des synergies pertinentes de manière autonome.');
}

main().catch(err => {
  console.error('[test_map_reduce] Erreur API:', err);
  process.exit(1);
});
