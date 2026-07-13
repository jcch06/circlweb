const fs = require('fs');

const files = [
  'src/components/ContactsPage.tsx',
  'src/components/NotesPage.tsx',
  'src/components/SpacesPage.tsx',
  'src/components/TagsPage.tsx'
];

for (const file of files) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf-8');
    
    // Fix empty ternary logic from removed icons: {condition ? <Icon/> : <Icon/>} => {condition ? : }
    content = content.replace(/\{\s*[A-Za-z0-9_]+\s*\?\s*:\s*\}/g, '');
    content = content.replace(/\{\s*[A-Za-z0-9_]+\s*\?\s*''\s*:\s*\}/g, '');
    
    // Sometimes there are fragments left over like `{condition ? <Icon/> : 'text'}` -> `{condition ? : 'text'}`
    content = content.replace(/(\?\s*):\s*([^}]+)\}/g, '$1 null : $2}');

    fs.writeFileSync(file, content);
    console.log(`Fixed syntax in ${file}`);
  }
}
