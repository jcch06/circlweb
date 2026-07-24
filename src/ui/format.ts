// Utilitaires partagés du redesign (brief §2).

/* Palette avatars : copiée verbatim de ios/Circl/Theme.swift (source de vérité).
   Les mêmes personnes doivent avoir le même avatar sur iOS et web. */
export const AVATAR_COLORS = [
  '#F27373', '#F29A4D', '#D9B840', '#61C785', '#4FB8D9',
  '#4F8EF7', '#9E7AE6', '#E680BF', '#8C99B3', '#73C7B8',
] as const;

/* djb2 avec débordement 64 bits signé, comme le Swift Int (&+). */
export function avatarColor(seed: string): string {
  let hash = 5381n;
  const MASK = (1n << 64n) - 1n;
  for (const ch of seed) {
    hash = (hash * 33n + BigInt(ch.codePointAt(0) ?? 0)) & MASK;
  }
  // Réinterprète en signé puis valeur absolue, comme abs(hash) côté Swift.
  const signed = BigInt.asIntN(64, hash);
  const abs = signed < 0n ? -signed : signed;
  return AVATAR_COLORS[Number(abs % 10n)];
}

export function initials(firstName?: string | null, lastName?: string | null): string {
  const f = (firstName ?? '').trim().charAt(0);
  const l = (lastName ?? '').trim().charAt(0);
  return (f + l).toUpperCase() || '?';
}

export function fullName(c: { first_name?: string | null; last_name?: string | null }): string {
  return [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || 'Sans nom';
}

/* ---- Statut relationnel (brief 4.0.6) : dérivé des faits, jamais saisi.
   Base : max(notes.created_at, last_contacted_at). Seuils 30/90 jours. ---- */

export type RelStatus = 'fresh' | 'due' | 'dormant' | 'never';

export const STATUS_META: Record<RelStatus, { label: string; color: string }> = {
  fresh:   { label: 'À jour',           color: 'var(--status-fresh)' },
  due:     { label: 'À relancer',       color: 'var(--status-due)' },
  dormant: { label: 'Dormant',          color: 'var(--status-dormant)' },
  never:   { label: 'Jamais contacté',  color: 'var(--status-never)' },
};

const DAY = 86400000;

export function lastTouch(contact: { last_contacted_at?: string | null }, lastNoteAt?: string | null): Date | null {
  const dates = [contact.last_contacted_at, lastNoteAt]
    .filter(Boolean)
    .map((d) => new Date(d as string).getTime())
    .filter((t) => !Number.isNaN(t));
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates));
}

export function relStatus(touch: Date | null): RelStatus {
  if (!touch) return 'never';
  const days = (Date.now() - touch.getTime()) / DAY;
  if (days < 30) return 'fresh';
  if (days <= 90) return 'due';
  return 'dormant';
}

/* ---- Dates relatives en français ---- */

export function relativeFR(iso?: string | null): string {
  if (!iso) return 'jamais';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'jamais';
  const days = Math.floor((Date.now() - t) / DAY);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 30) return `il y a ${days} j`;
  if (days < 365) return `il y a ${Math.floor(days / 30)} mois`;
  const y = Math.floor(days / 365);
  return `il y a ${y} an${y > 1 ? 's' : ''}`;
}

export function dayFR(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

// HH:mm — needed alongside relativeFR/dayFR wherever several same-day
// entries must stay distinguishable (e.g. two analyses run hours apart on
// the same day both otherwise read "aujourd'hui").
export function timeFR(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/* ---- Couleur canonique d'un cercle (brief 2.2.4) ----
   Attribution stable par hash de l'id tant que la table spaces
   ne porte pas de color_hex. Le cercle personnel prend le pétrole. */
const CIRCLE_COLORS = [
  'var(--circle-1)', 'var(--circle-2)', 'var(--circle-3)', 'var(--circle-4)',
  'var(--circle-5)', 'var(--circle-6)', 'var(--circle-7)', 'var(--circle-8)',
];

export function circleColor(space: { id: string; type?: string | null }): string {
  if (space.type === 'personal') return 'var(--circle-7)';
  let h = 0;
  for (let i = 0; i < space.id.length; i++) h = (h * 31 + space.id.charCodeAt(i)) >>> 0;
  return CIRCLE_COLORS[h % CIRCLE_COLORS.length];
}
