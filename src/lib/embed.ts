import { supabase } from './supabase';
import { IS_MOCK } from './mode';

// Recherche par le sens : met à jour en tâche de fond les embeddings des
// fiches nouvelles ou modifiées (embed-contacts, 400 par appel). Une fois par
// session, sauf après un import (force).
let running = false;
export async function embedInBackground(force = false) {
  if (IS_MOCK || running) return;
  try { if (!force && sessionStorage.getItem('circl-embed')) return; } catch { /* stockage indisponible */ }
  running = true;
  try {
    // Jusqu'au bout du carnet (400 fiches par appel) ; la session n'est marquée
    // comme à jour que si tout a été indexé sans erreur.
    for (let i = 0; i < 300; i++) {
      const res: any = await supabase.functions.invoke('embed-contacts', { body: {} });
      if (res.error || !res.data) return;
      if (res.data.remaining <= 0) { try { sessionStorage.setItem('circl-embed', '1'); } catch { /* stockage indisponible */ } return; }
    }
  } finally {
    running = false;
  }
}
