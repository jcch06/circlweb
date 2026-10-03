import { supabase } from './supabase';
import { IS_MOCK } from './mode';

// Recherche par le sens : met à jour en tâche de fond les embeddings des
// fiches nouvelles ou modifiées (embed-contacts, 400 par appel). Une fois par
// session, sauf après un import (force).
let running = false;
export async function embedInBackground(force = false) {
  if (IS_MOCK || running) return;
  try { if (!force && sessionStorage.getItem('circl-embed')) return; sessionStorage.setItem('circl-embed', '1'); } catch { /* stockage indisponible */ }
  running = true;
  try {
    for (let i = 0; i < 50; i++) {
      const res: any = await supabase.functions.invoke('embed-contacts', { body: {} });
      if (res.error || !res.data || res.data.remaining <= 0) break;
    }
  } finally {
    running = false;
  }
}
