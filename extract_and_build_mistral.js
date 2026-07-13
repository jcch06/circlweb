import fs from 'fs';

let content = fs.readFileSync('original_gemini.ts', 'utf8');

// Extract everything from \`export interface SynergyResult\` to \`export async function extractNormalizedProfiles\`
const startIndex = content.indexOf('export interface SynergyResult');
const endIndex = content.indexOf('export async function extractNormalizedProfiles');

if (startIndex === -1 || endIndex === -1) {
  console.error("Could not find start or end index");
  process.exit(1);
}

let helpers = content.substring(startIndex, endIndex);

helpers = helpers.replace(/getGeminiClient\(\)/g, 'getMistralClient()');
helpers = helpers.replace(/const genAI = getMistralClient\(\);\\n\\s*if \\(\\!genAI\\) throw new Error\\("Gemini API key is not configured.*"\\);\\n\\s*(?:\\/\\/.*)?\\n\\s*const model = genAI\\.getGenerativeModel\\(\\{ model: ".*" \\}\\);/g, 
  \`\`);
helpers = helpers.replace(/const genAI = getMistralClient\(\);\\n\\s*if \\(\\!genAI\\) throw new Error\\("Gemini API key is not configured.*"\\);\\n\\s*(?:\\/\\/.*)?\\n\\s*const model = genAI\\.getGenerativeModel\\(\\{[\\s\\S]*?\\}\\);/g, 
  \`\`);
helpers = helpers.replace(/const result = await model\\.generateContent\\(prompt\\);/g, 
  \`let text = await callMistral(prompt, true);\`);
helpers = helpers.replace(/trackGlobalUsage\\(result\\);/g, '');
helpers = helpers.replace(/let text = result\\.response\\.text\\(\\);/g, '');
helpers = helpers.replace(/result\\.response\\.text\\(\\)/g, 'text');
helpers = helpers.replace(/safeParseGeminiJSON/g, 'safeParseJSON');
helpers = helpers.replace(/Gemini/gi, 'Mistral');

// Handle the "text" redeclaration or assignment issue
helpers = helpers.replace(/const text = await/g, 'let text = await');

// 2. Base Mistral Logic
const baseLogic = \`import { Mistral } from '@mistralai/mistralai';

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

async function callMistral(prompt: string, isJSON: boolean = true) {
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
  if (typeof text !== 'string') return null;
  try {
    let clean = text.replace(/\\\`\\\`\\\`json\\n?/gi, '').replace(/\\\`\\\`\\\`\\n?/gi, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error("JSON Parse Error:", err);
    return null;
  }
}

// --- PORTED HELPERS ---
\`;

const batchLogic = \`
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
    return \\\`Contact: \\\${c.name || (c.first_name + ' ' + c.last_name)} (\\\${c.job_title} chez \\\${c.company})\\nInfos: \\\${contactNotes}\\\`;
  }).join('\\n\\n');

  const prompt = \\\`Tu es un expert en analyse de réseau professionnel.
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
\\\${batchData}

Règle absolue : Réponds UNIQUEMENT avec le JSON valide, sans markdown additionnel.\\\`;

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

  const prompt = \\\`Tu es un super-cerveau réseau. 
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
\\\${aggregatedData}

Règle absolue : Réponds UNIQUEMENT avec le JSON valide.\\\`;

  const text = await callMistral(prompt, true);
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
      return \\\`Profil: \\\${c.first_name || c.name}, Role: \\\${c.job_title || c.role}, Entreprise: \\\${c.company}. Notes: \\\${contactNotes}\\\`.substring(0, 8000);
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
  const cacheKey = \\\`circl_mistral_v4_\\\${contacts.length}_\\\${contacts.map(c => c.id).sort().join(',').substring(0, 100)}\\\`;
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
  
  const cacheKey = \\\`circl_mistral_v4_\\\${contacts.length}_\\\${contacts.map(c => c.id).sort().join(',').substring(0, 100)}\\\`;
  localStorage.setItem(cacheKey, JSON.stringify(result));

  return result;
}
\`;

fs.writeFileSync('src/lib/mistral.ts', baseLogic + helpers + batchLogic, 'utf8');
console.log('mistral.ts rebuilt cleanly');
