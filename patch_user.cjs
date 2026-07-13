const fs = require('fs');

const file = 'src/components/UserProfilePopup.tsx';
let content = fs.readFileSync(file, 'utf-8');

// Update autoEnrichUserProfile call
content = content.replace(
  `      const data = await autoEnrichUserProfile(
        profile.name, 
        profile.company, 
        profile.role,
        profile.currentProjects,
        profile.needs
      );`,
  `      const data = await autoEnrichUserProfile(
        profile.name, 
        profile.company, 
        profile.role
      );`
);

// We already changed setProfile logic, but I'll make sure it's using the append logic just in case it was reverted or not fully applied.
// Since my previous replace_file_content succeeded on UserProfilePopup.tsx, this just ensures the call to autoEnrichUserProfile is correct.

fs.writeFileSync(file, content);
console.log('UserProfilePopup.tsx patched successfully.');
