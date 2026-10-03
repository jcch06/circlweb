import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { useData } from '../data';
import { supabase } from '../lib/supabase';
import { IS_MOCK } from '../lib/mode';
import { cn } from '../lib/utils';
import { Button } from '@/components/ui/button';
import { BuyCredits } from '../ui/BuyCredits';
import { dayFR } from '../ui/format';

// Abonnement et factures : offres, essai de 14 jours, portail Stripe (changer
// d'offre, places, moyen de paiement, adresse, numéro de TVA, factures).
// Prix HT, TVA ajoutée par Stripe Tax. Les montants affichés reprennent les
// prix créés dans Stripe (lookup_key solo_monthly…).

type Tier = 'solo' | 'team' | 'business';
const PLANS: { tier: Tier; name: string; monthly: number; pitch: string; features: string[] }[] = [
  { tier: 'solo', name: 'Solo', monthly: 12, pitch: 'Pour un professionnel et son réseau.',
    features: ['Contacts illimités', 'Demander à votre réseau', 'Réseau et milieux', 'Pipelines', 'Import CSV et Excel'] },
  { tier: 'team', name: 'Équipe', monthly: 19, pitch: 'Pour partager un réseau entre associés.',
    features: ['Tout Solo', 'Cercles partagés', 'Partage sans copie de fiche', 'Opportunités d’introduction', 'Gmail et Agenda'] },
  { tier: 'business', name: 'Business', monthly: 35, pitch: 'Pour les cabinets et les gros carnets.',
    features: ['Tout Équipe', 'Suivi LinkedIn automatique', 'Recherche par le sens à grande échelle', 'Accompagnement à l’import'] },
];
const STATUS: Record<string, string> = {
  trialing: 'Essai gratuit', active: 'Actif', past_due: 'Paiement en retard', canceled: 'Résilié', incomplete: 'Paiement à finaliser', unpaid: 'Impayé',
};
const euros = (n: number) => `${n.toLocaleString('fr-FR')} €`;

export const SubscriptionPage: React.FC = () => {
  const data = useData();
  const [yearly, setYearly] = useState(false);
  const [seats, setSeats] = useState(3);
  const [profile, setProfile] = useState<any>(null);
  const [credits, setCredits] = useState(25);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);

  const load = async () => {
    if (IS_MOCK || !data.user?.id) return;
    const [{ data: p }, { data: c }] = await Promise.all([
      supabase.from('profiles').select('stripe_customer_id, subscription_status, subscription_tier, subscription_seats, current_period_end, trial_end').eq('id', data.user.id).maybeSingle(),
      supabase.from('enrichment_credits').select('balance').eq('user_id', data.user.id).maybeSingle(),
    ]);
    setProfile(p); setCredits(c?.balance ?? 25);
    return p;
  };
  useEffect(() => {
    load().then(async (p) => {
      // Retour de Stripe : l'abonnement est activé par le webhook, on attend sa confirmation.
      const statut = new URLSearchParams(window.location.search).get('statut');
      if (!statut) return;
      window.history.replaceState(null, '', window.location.pathname);
      if (statut === 'annule') { setMessage('Paiement annulé. Aucun abonnement n’a été créé.'); return; }
      setMessage('Activation de votre abonnement…');
      for (let i = 0; i < 10 && !['active', 'trialing'].includes(p?.subscription_status); i++) {
        await new Promise((r) => setTimeout(r, 3000));
        p = await load();
      }
      setMessage(['active', 'trialing'].includes(p?.subscription_status) ? 'Votre abonnement est actif. Merci.' : 'Paiement reçu. L’activation peut prendre quelques minutes.');
    });
  }, [data.user?.id]);

  const call = async (fn: string, body: object, key: string) => {
    if (IS_MOCK) { setMessage('Le paiement n’est pas disponible en mode démonstration.'); return; }
    setBusy(key); setMessage(null);
    const res: any = await supabase.functions.invoke(fn, { body });
    if (res.error || !res.data?.url) {
      let msg = 'Le paiement n’a pas pu démarrer. Réessayez dans un instant.';
      try { const b = await res.error?.context?.json?.(); if (b?.error) msg = b.error; } catch { /* corps illisible */ }
      setBusy(null); setMessage(msg); return;
    }
    window.location.href = res.data.url;
  };

  const current = profile && ['active', 'trialing', 'past_due', 'incomplete'].includes(profile.subscription_status) ? profile : null;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 md:px-7">
        {current ? (
          <section className="flex flex-col gap-3 rounded-xl border bg-card p-5 sm:flex-row sm:items-center">
            <div className="flex-1">
              <h2 className="text-base font-semibold">Circl {PLANS.find((p) => p.tier === current.subscription_tier)?.name ?? ''}</h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {STATUS[current.subscription_status] ?? current.subscription_status}
                {current.subscription_seats > 1 ? ` · ${current.subscription_seats} places` : ''}
                {current.subscription_status === 'trialing' && current.trial_end ? ` jusqu’au ${dayFR(current.trial_end)}` : ''}
                {current.subscription_status === 'active' && current.current_period_end ? ` · renouvellement le ${dayFR(current.current_period_end)}` : ''}
              </p>
            </div>
            <Button variant="outline" disabled={!!busy} onClick={() => call('create-portal-session', { platform: 'web' }, 'portal')}>
              {busy === 'portal' ? 'Ouverture…' : 'Gérer l’abonnement et les factures'}
            </Button>
          </section>
        ) : (
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Choisissez votre offre</h1>
            <p className="mt-1 text-sm text-muted-foreground">14 jours d’essai gratuit, sans engagement. Prix hors taxes, TVA ajoutée selon votre pays.</p>
          </div>
        )}
        {message && <p role="status" className="text-sm">{message}</p>}

        {!current && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center rounded-lg bg-secondary p-0.5 text-xs" role="radiogroup" aria-label="Facturation">
                {([[false, 'Mensuel'], [true, 'Annuel · 2 mois offerts']] as const).map(([y, label]) => (
                  <button key={label} role="radio" aria-checked={yearly === y} onClick={() => setYearly(y)}
                    className={cn('rounded-md px-3 py-1 font-medium', yearly === y ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{label}</button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                Places pour Équipe et Business
                <input type="number" min={2} max={500} value={seats} onChange={(e) => setSeats(Math.max(2, Math.min(500, Number(e.target.value) || 2)))}
                  className="h-8 w-20 rounded-md border bg-card px-2 text-[13px] tabular-nums text-foreground" />
              </label>
            </div>
            <div className="grid gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-3">
              {PLANS.map((p) => {
                const unit = yearly ? p.monthly * 10 : p.monthly;
                const qty = p.tier === 'solo' ? 1 : seats;
                return (
                  <section key={p.tier} className="flex flex-col gap-4 bg-card p-5">
                    <div>
                      <h2 className="text-sm font-semibold">{p.name}</h2>
                      <p className="mt-0.5 text-[13px] text-muted-foreground">{p.pitch}</p>
                    </div>
                    <p>
                      <span className="text-2xl font-semibold tabular-nums">{euros(unit)}</span>
                      <span className="text-[13px] text-muted-foreground"> HT {p.tier === 'solo' ? '' : 'par utilisateur '}/ {yearly ? 'an' : 'mois'}</span>
                      {qty > 1 && <span className="block text-xs tabular-nums text-muted-foreground">{qty} places : {euros(unit * qty)} HT / {yearly ? 'an' : 'mois'}</span>}
                    </p>
                    <ul className="flex flex-1 flex-col gap-1.5 text-[13px]">
                      {p.features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />{f}</li>)}
                    </ul>
                    <Button variant={p.tier === 'team' ? 'default' : 'outline'} disabled={!!busy}
                      onClick={() => call('create-checkout-session', { tier: p.tier, billing: yearly ? 'yearly' : 'monthly', seats: qty, platform: 'web' }, p.tier)}>
                      {busy === p.tier ? 'Redirection…' : 'Commencer l’essai gratuit'}
                    </Button>
                  </section>
                );
              })}
            </div>
          </>
        )}

        <section className="flex flex-col gap-2 border-t pt-6 sm:flex-row sm:items-center">
          <div className="flex-1">
            <h2 className="text-sm font-semibold">Crédits d’enrichissement</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Solde : <span className="tabular-nums text-foreground">{credits}</span> crédits. Un email coûte 1 crédit, un téléphone 10, et rien n’est débité si la recherche ne trouve pas. Chaque achat donne une facture.
            </p>
          </div>
          <Button variant="outline" onClick={() => setBuyOpen(true)}>Acheter des crédits</Button>
        </section>
      </div>
      {buyOpen && <BuyCredits balance={credits} onClose={() => setBuyOpen(false)} />}
    </div>
  );
};
