import fs from 'fs';

let content = fs.readFileSync('independent_helpers.ts', 'utf8');

// Replacements
content = content.replace(/getGeminiClient\(\)/g, 'getMistralClient()');

// Remove genAI checks
content = content.replace(/const genAI = getMistralClient\(\);\n\s*if \(\!genAI\) throw new Error\("Gemini API key is not configured.*"\);\n\s*(?:\/\/.*)?\n\s*const model = genAI\.getGenerativeModel\(\{ model: ".*" \}\);/g, 
  `const client = getMistralClient();\n  if (!client) throw new Error("Mistral API key is not configured");`);

content = content.replace(/const result = await model\.generateContent\(prompt\);/g, 
  `const result = await client.chat.complete({\n    model: 'mistral-small-latest',\n    messages: [{ role: 'user', content: prompt }],\n    responseFormat: { type: 'json_object' }\n  });`);

content = content.replace(/trackGlobalUsage\(result\);/g, 'trackGlobalUsage(result.usage);');

content = content.replace(/let text = result\.response\.text\(\);/g, 'let text = result.choices?.[0]?.message?.content || "{}";');

fs.appendFileSync('src/lib/mistral.ts', '\n\n// --- PORTED HELPERS ---\n' + content, 'utf8');
console.log('Helpers ported');
