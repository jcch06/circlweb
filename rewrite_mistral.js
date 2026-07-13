import fs from 'fs';

let content = fs.readFileSync('src/lib/mistral.ts', 'utf8');

// 1. Imports
content = content.replace("import { GoogleGenerativeAI } from '@google/generative-ai';", "import { Mistral } from '@mistralai/mistralai';");

// 2. Client setup
content = content.replace(/const getGeminiClient = \(\) => \{[\s\S]*?return new GoogleGenerativeAI\(apiKey\);\n\};/, `const getMistralClient = () => {
  const apiKey = import.meta.env.VITE_MISTRAL_API_KEY;
  if (!apiKey || apiKey === 'YOUR_MISTRAL_API_KEY_HERE') {
    return null;
  }
  return new Mistral({ apiKey });
};`);

// 3. isMistralConfigured
content = content.replace(/export const isGeminiConfigured = \(\) => \{[\s\S]*?\n\};/, `export const isMistralConfigured = () => {
  const client = getMistralClient();
  return client !== null;
};`);

// 4. Global Usage
content = content.replace(/export function trackGlobalUsage\(result: any\) \{[\s\S]*?\}\n\}/, `export function trackGlobalUsage(usage: any) {
  if (globalTokenUsage && usage) {
    globalTokenUsage.promptTokens += usage.promptTokens || 0;
    globalTokenUsage.candidateTokens += usage.completionTokens || 0;
    globalTokenUsage.totalTokens += usage.totalTokens || 0;
  }
}`);

// 5. Add callMistral wrapper
content = content.replace("export const isPerplexityConfigured", `// Sleep for rate limiting
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

export const isPerplexityConfigured`);

// 6. Rewrite all generation patterns
// Match block:
// const genAI = getGeminiClient(); ... const result = await model.generateContent(prompt);
// And replace with `const text = await callMistral(prompt, true);`
// Then replace `result.response.text()` with `text`

content = content.replace(/const genAI = getGeminiClient\(\);[\s\S]*?const result = await model\.generateContent\(prompt\);\n\s*trackGlobalUsage\(result\);/g, `const text = await callMistral(prompt, true);`);

// For autoEnrichContact which has its own thing, skip or it doesn't use gemini (it uses perplexity).

content = content.replace(/safeParseGeminiJSON\(result\.response\.text\(\)\)/g, 'safeParseGeminiJSON(text)');
content = content.replace(/let text = result\.response\.text\(\);/g, ''); // we already have `text` from callMistral
content = content.replace(/result\.response\.text\(\)/g, 'text');

content = content.replace(/safeParseGeminiJSON/g, 'safeParseJSON');

fs.writeFileSync('src/lib/mistral.ts', content, 'utf8');
console.log("Rewritten mistral.ts");
