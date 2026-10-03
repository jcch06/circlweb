// Thème clair/sombre (monde Atlas). Clair par défaut : on ne bascule en
// sombre que sur choix explicite, jamais d'après l'OS.
export function initTheme() {
  try {
    document.documentElement.classList.toggle('dark', localStorage.getItem('theme') === 'dark');
  } catch { /* localStorage indisponible : reste en clair */ }
}

export function toggleTheme(): boolean {
  const dark = !document.documentElement.classList.contains('dark');
  document.documentElement.classList.toggle('dark', dark);
  try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch { /* ignore */ }
  return dark;
}

export function isDark(): boolean {
  return document.documentElement.classList.contains('dark');
}
