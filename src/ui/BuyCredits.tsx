import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { IS_MOCK } from '../lib/mode';
import { cn } from '../lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// Achat de crédits d'enrichissement : choix d'un pack, paiement sur Stripe,
// retour sur Circl (?credits=ok). Les montants affichés reprennent les packs
// par défaut de la fonction buy-credits.
const PACKS = [
  { id: 'p100', credits: 100, price: '9 €', hint: '100 emails ou 10 téléphones' },
  { id: 'p500', credits: 500, price: '39 €', hint: '500 emails ou 50 téléphones' },
  { id: 'p2000', credits: 2000, price: '129 €', hint: '2 000 emails ou 200 téléphones' },
];

export const BuyCredits: React.FC<{ balance: number; onClose: () => void }> = ({ balance, onClose }) => {
  const [pack, setPack] = useState('p500');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pay = async () => {
    if (IS_MOCK) { setError("Le paiement n'est pas disponible en mode démonstration."); return; }
    setBusy(true); setError(null);
    const res: any = await supabase.functions.invoke('buy-credits', { body: { pack } });
    if (res.error || !res.data?.url) {
      let msg = "Le paiement n'a pas pu démarrer. Réessayez dans un instant.";
      try { const b = await res.error?.context?.json?.(); if (b?.error) msg = b.error; } catch { /* corps illisible */ }
      setBusy(false); setError(msg); return;
    }
    window.location.href = res.data.url;
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Acheter des crédits</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Solde actuel : <span className="tabular-nums text-foreground">{balance}</span> crédits. Un email coûte 1 crédit, un téléphone 10, et rien n'est débité si la recherche ne trouve pas.
        </p>
        <div role="radiogroup" aria-label="Pack de crédits" className="flex flex-col gap-1.5">
          {PACKS.map((p) => (
            <button key={p.id} role="radio" aria-checked={pack === p.id} onClick={() => setPack(p.id)}
              className={cn('flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                pack === p.id ? 'border-foreground/40 bg-secondary' : 'hover:bg-muted')}>
              <span className={cn('grid size-4 place-items-center rounded-full border', pack === p.id && 'border-foreground')}>
                {pack === p.id && <span className="size-2 rounded-full bg-foreground" />}
              </span>
              <span className="flex-1">
                <span className="block text-sm font-medium tabular-nums">{p.credits.toLocaleString('fr-FR')} crédits</span>
                <span className="block text-xs text-muted-foreground">{p.hint}</span>
              </span>
              <span className="text-sm tabular-nums">{p.price}</span>
            </button>
          ))}
        </div>
        {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={pay} disabled={busy}>{busy ? 'Redirection…' : 'Payer avec Stripe'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
