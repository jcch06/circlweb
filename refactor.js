import fs from 'fs';
import path from 'path';

function replaceInFile(filePath, searchRegex, replacement) {
  const content = fs.readFileSync(filePath, 'utf8');
  const newContent = content.replace(searchRegex, replacement);
  if (content !== newContent) {
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log('Updated ' + filePath);
  }
}

// 1. Rename isGeminiConfigured to isMistralConfigured and change imports
const componentsToUpdate = [
  'src/components/AIInput.tsx',
  'src/components/ContactsPage.tsx',
  'src/components/GalaxyVisualizer.tsx',
  'src/components/OpportunityHub.tsx',
  'src/components/Sidebar.tsx',
  'src/components/UserProfilePopup.tsx'
];

for (const file of componentsToUpdate) {
  replaceInFile(file, /isGeminiConfigured/g, 'isMistralConfigured');
  replaceInFile(file, /\/lib\/gemini/g, '/lib/mistral');
  replaceInFile(file, /VITE_GEMINI_API_KEY/g, 'VITE_MISTRAL_API_KEY');
  replaceInFile(file, /gemini-3\.5-flash/g, 'mistral-small-latest');
  replaceInFile(file, /Gemini/g, 'Mistral');
  replaceInFile(file, /gemini/g, 'mistral');
}
