const fs = require('fs');
const files = [
  'src/components/ContactsPage.tsx',
  'src/components/TagsPage.tsx',
  'src/components/NotesPage.tsx',
  'src/components/SpacesPage.tsx',
  'src/components/UserProfilePopup.tsx',
  'src/components/GalaxyVisualizer.tsx',
  'src/components/NetworkAnalysisProgress.tsx',
  'src/components/SupplyDemandMatrix.tsx',
  'src/components/AIInput.tsx'
];

const icons = ['Users', 'Plus', 'X', 'Search', 'MapPin', 'Briefcase', 'Tag', 'Mail', 'Phone', 'ExternalLink', 'Sparkles', 'Orbit', 'Zap', 'Key', 'ArrowRight', 'Clock', 'Globe', 'Layers', 'Edit2', 'Check', 'Mic', 'Trash2', 'PlusCircle', 'LogOut', 'Brain', 'Database', 'FileText', 'MessageSquare', 'Activity', 'TrendingUp', 'Target', 'Settings', 'AlertCircle', 'Save', 'Linkedin', 'Loader2', 'UserPlus', 'LogIn', 'Settings2', 'Network', 'Compass'];

let iconRegex = new RegExp(`<(${icons.join('|')})[^>]*/>`, 'g');
let iconRegex2 = new RegExp(`<(${icons.join('|')})[^>]*>[^<]*</\\1>`, 'g');

for (const file of files) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf-8');
    
    // Remove lucide-react imports
    content = content.replace(/import\s+{([^}]+)}\s+from\s+['"]lucide-react['"];?/g, '');
    
    // Remove icons
    content = content.replace(iconRegex, '');
    content = content.replace(iconRegex2, '');
    
    // Remove emojis 🌌, 🔮, 🧠, ✨, 🚀, 💡
    content = content.replace(/[🌌🔮🧠✨🚀💡]/g, '');

    // Remove gradient classes
    content = content.replace(/className="[^"]*text-gradient-[^"]*"/g, '');
    content = content.replace(/className="[^"]*bg-gradient-[^"]*"/g, '');
    
    // Replace glow-button with just button or btn-primary
    content = content.replace(/className="glow-button[^"]*"/g, 'className="btn-primary"');
    
    // Replace inline color vars that use neon
    content = content.replace(/color:\s*['"]var\(--neon-[^'"]+['"]/g, "color: '#fff'");
    content = content.replace(/background:\s*['"]var\(--neon-[^'"]+['"]/g, "background: '#333'");
    content = content.replace(/borderColor:\s*['"]var\(--neon-[^'"]+['"]/g, "borderColor: '#555'");
    
    // Replace bg-card and glass classes
    content = content.replace(/className="glass-card[^"]*"/g, 'className="glass-card"');
    content = content.replace(/className="glass-panel[^"]*"/g, 'className="glass-panel"');
    
    // Remove glow-active and pulse-anim
    content = content.replace(/className="glow-active[^"]*"/g, '');
    content = content.replace(/className="pulse-anim[^"]*"/g, '');

    fs.writeFileSync(file, content);
    console.log(`Refactored ${file}`);
  }
}
