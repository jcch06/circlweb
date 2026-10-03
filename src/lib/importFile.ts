// Import de fichier (CSV, TSV, Excel) : lecture, correspondance des colonnes,
// construction des fiches avec dédoublonnage interne au fichier.
// Self-check : npx tsx src/lib/importFile.check.ts

export type Field = 'first_name' | 'last_name' | 'full_name' | 'email' | 'phone' | 'company' | 'job_title' | 'linkedin' | 'location' | 'industry';
export const FIELD_LABEL: Record<Field, string> = {
  first_name: 'Prénom', last_name: 'Nom', full_name: 'Nom complet', email: 'Email', phone: 'Téléphone',
  company: 'Entreprise', job_title: 'Poste', linkedin: 'LinkedIn', location: 'Ville', industry: 'Secteur',
};

/** CSV RFC 4180 : guillemets, guillemets doublés, retours à la ligne dans un champ.
 *  Séparateur détecté sur la première ligne (; pour les exports Excel français). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.slice(0, src.indexOf('\n') === -1 ? undefined : src.indexOf('\n'));
  const sep = [';', '\t', ','].map((s) => ({ s, n: firstLine.split(s).length })).sort((a, b) => b.n - a.n)[0].s;
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const SYNONYMS: [Field, RegExp][] = [
  ['first_name', /^(pr[eé]nom|first ?name|given ?name|firstname)$/],
  ['last_name', /^(nom( de famille)?|last ?name|surname|family ?name|lastname)$/],
  ['full_name', /^(nom complet|full ?name|name|contact|personne)$/],
  ['email', /(e-?mail|courriel|mail)/],
  ['phone', /(t[eé]l[eé]phone|phone|mobile|portable|t[eé]l\b|tel\b|gsm)/],
  ['company', /(entreprise|soci[eé]t[eé]|company|organi[sz]ation|employeur|structure|account)/],
  ['job_title', /(poste|fonction|titre|title|job|r[oô]le|position)/],
  ['linkedin', /linkedin/],
  ['location', /(ville|city|localisation|location|lieu|adresse)/],
  ['industry', /(secteur|industry|industrie|domaine)/],
];

/** Correspondance devinée à partir des en-têtes ; chaque champ n'est pris qu'une fois. */
export function guessMapping(headers: string[]): (Field | null)[] {
  const used = new Set<Field>();
  return headers.map((h) => {
    const k = h.trim().toLowerCase();
    const hit = SYNONYMS.find(([f, re]) => !used.has(f) && re.test(k));
    if (!hit) return null;
    used.add(hit[0]);
    return hit[0];
  });
}

export type Built = Partial<Record<Exclude<Field, 'full_name'>, string>> & { first_name: string };
export type BuildResult = { contacts: Built[]; duplicatesInFile: number; withoutName: number };

const key = (s?: string) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Lignes -> fiches. Une ligne sans nom est écartée ; un doublon dans le
 *  fichier (même email, même téléphone, ou même nom + entreprise) aussi. */
export function buildContacts(rows: string[][], mapping: (Field | null)[]): BuildResult {
  const seen = new Set<string>();
  const contacts: Built[] = [];
  let duplicatesInFile = 0, withoutName = 0;
  for (const r of rows) {
    const v: Partial<Record<Field, string>> = {};
    mapping.forEach((f, i) => { const val = (r[i] ?? '').trim(); if (f && val && !v[f]) v[f] = val.slice(0, 300); });
    let first = v.first_name ?? '', last = v.last_name ?? '';
    if (!first && !last && v.full_name) { const parts = v.full_name.split(/\s+/); first = parts[0]; last = parts.slice(1).join(' '); }
    if (!first && last) { first = last; last = ''; }
    if (!first) { withoutName++; continue; }
    const phoneKey = (v.phone ?? '').replace(/\D/g, '').slice(-9);
    const ids = [v.email && `e:${key(v.email)}`, phoneKey.length === 9 && `p:${phoneKey}`, `n:${key(`${first} ${last}`)}|${key(v.company)}`].filter(Boolean) as string[];
    if (ids.some((id) => seen.has(id))) { duplicatesInFile++; continue; }
    ids.forEach((id) => seen.add(id));
    const { full_name: _drop, ...rest } = v;
    contacts.push({ ...rest, first_name: first, ...(last ? { last_name: last } : {}) });
  }
  return { contacts, duplicatesInFile, withoutName };
}
