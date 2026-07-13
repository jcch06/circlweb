import fs from 'fs';

const batchLogic = `
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
    const contactNotes = notes.filter(n => n.contactId === c.id).map(n => n.content).join(' | ');
    return \`Contact: \${c.name || c.first_name + ' ' + c.last_name} (\${c.job_title} chez \${c.company})\\nInfos: \${contactNotes}\`;
  }).join('\\n\\n');

  const prompt = \`Tu es un expert en analyse de réseau professionnel.
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
\${batchData}

Règle absolue : Réponds UNIQUEMENT avec le JSON valide, sans markdown additionnel.\`;

  const text = await callMistral(prompt, true);
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

  const prompt = \`Tu es un super-cerveau réseau. 
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
\${aggregatedData}

Règle absolue : Réponds UNIQUEMENT avec le JSON valide.\`;

  const text = await callMistral(prompt, true);
  const parsed = safeParseJSON(text);
  if (parsed && parsed.globalThemes) {
    return parsed as MistralGlobalSynthesis;
  }
  return { globalThemes: [], crossBatchSynergies: [], networkStrength: "Analyse échouée.", recommendedActionPlan: [] };
}

// ============================================================================
// ORCHESTRATOR: Run full Map-Reduce Pipeline
// ============================================================================
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

  return {
    batches: batchResults,
    synthesis,
    timestamp: Date.now()
  };
}
\`;

fs.appendFileSync('src/lib/mistral.ts', batchLogic, 'utf8');
console.log('Batch logic appended to mistral.ts');
