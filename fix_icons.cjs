const fs = require('fs');

const files = [
  'src/components/AIInput.tsx',
  'src/components/GalaxyVisualizer.tsx',
  'src/components/NetworkAnalysisProgress.tsx',
  'src/components/NotesPage.tsx',
  'src/components/SpacesPage.tsx',
  'src/components/TagsPage.tsx',
  'src/components/UserProfilePopup.tsx'
];

const icons = ['UserCheck', 'Building', 'User', 'Brain', 'Fingerprint', 'Network', 'Target', 'Activity', 'HeartHandshake', 'Send', 'Shield', 'Folder', 'Lightbulb', 'X'];

let iconRegex = new RegExp(`<(${icons.join('|')})[^>]*/>`, 'g');
let iconRegex2 = new RegExp(`<(${icons.join('|')})[^>]*>[^<]*</\\1>`, 'g');

for (const file of files) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf-8');
    
    content = content.replace(iconRegex, '');
    content = content.replace(iconRegex2, '');
    
    // Fix empty ternary logic again
    content = content.replace(/\{\s*[A-Za-z0-9_]+\s*\?\s*:\s*\}/g, '');
    content = content.replace(/(\?\s*):\s*([^}]+)\}/g, '$1 null : $2}');

    fs.writeFileSync(file, content);
    console.log(`Fixed icons in ${file}`);
  }
}

// Special case for NetworkAnalysisProgress.tsx where icons are an array of components
if (fs.existsSync('src/components/NetworkAnalysisProgress.tsx')) {
    let c = fs.readFileSync('src/components/NetworkAnalysisProgress.tsx', 'utf-8');
    c = c.replace(/const steps = \[\s*\{[^}]*icon:\s*[A-Za-z]+[^}]*\}\s*(,\s*\{[^}]*icon:\s*[A-Za-z]+[^}]*\})*\s*\];/g, 
        'const steps = [ { id: "step1", label: "Collecte" }, { id: "step2", label: "Cartographie" }, { id: "step3", label: "Profilage" }, { id: "step4", label: "Besoins" }, { id: "step5", label: "Synergies" }, { id: "step6", label: "Synthèse" } ];'
    );
    c = c.replace(/const Icon = step\.icon;[\s\S]*?<Icon[^>]*\/>/g, '');
    c = c.replace(/<step\.icon[^>]*\/>/g, '');
    fs.writeFileSync('src/components/NetworkAnalysisProgress.tsx', c);
}
