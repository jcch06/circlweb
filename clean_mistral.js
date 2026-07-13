import fs from 'fs';

let content = fs.readFileSync('src/lib/mistral.ts', 'utf8');

// 1. Change `const text = await callMistral` to `let text = await callMistral`
content = content.replace(/const text = await callMistral/g, 'let text = await callMistral');

// 2. Remove all `getGenerativeModel` remaining
content = content.replace(/const model = genAI\.getGenerativeModel\(\{[\s\S]*?\}\);/g, '');

// 3. The `buildUserContext` function is never read, let's export it or remove it.
// We can just export it.
content = content.replace(/function buildUserContext/g, 'export function buildUserContext');

// 4. `d.embedding` as number[]
content = content.replace(/vector: d\.embedding \}/g, 'vector: d.embedding as number[] }');

// 5. Remove duplicated safeParseJSON if it exists twice
// Let's just rename the first one or second one, or use a regex to remove the second block
const safeParseCount = (content.match(/function safeParseJSON/g) || []).length;
if (safeParseCount > 1) {
  const lastIndex = content.lastIndexOf('function safeParseJSON');
  const endIndex = content.indexOf('}', lastIndex);
  if (endIndex !== -1) {
    const afterEnd = content.indexOf('}', endIndex + 1);
    content = content.substring(0, lastIndex) + content.substring(afterEnd + 1);
  }
}

fs.writeFileSync('src/lib/mistral.ts', content, 'utf8');
console.log('Cleaned mistral.ts');
