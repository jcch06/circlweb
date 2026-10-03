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
  // Séparateur : compté sur la première ligne, hors guillemets (« "Nom, prénom";Email » est un CSV à point-virgule).
  const count = { ';': 0, '\t': 0, ',': 0 } as Record<string, number>;
  for (let i = 0, q = false; i < src.length && src[i] !== '\n'; i++) {
    if (src[i] === '"') q = !q;
    else if (!q && src[i] in count) count[src[i]]++;
  }
  const sep = Object.entries(count).sort((a, b) => b[1] - a[1])[0][0];
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
export type Ignored = { row: number; name: string; reason: string; contact: Built };
export type BuildResult = { contacts: Built[]; duplicatesInFile: number; withoutName: number; ignored: Ignored[] };

const key = (s?: string) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const phoneKey = (s?: string) => (s ?? '').replace(/\D/g, '').slice(-9);

/** Lignes -> fiches. Une ligne sans nom est écartée. Un doublon certain dans
 *  le fichier aussi : même email ; même téléphone ET même nom ; même nom et
 *  même entreprise sans email ni téléphone contradictoire. Deux homonymes aux
 *  emails différents restent deux personnes. Les lignes écartées sont
 *  rendues (ignored) pour que l'utilisateur puisse les garder. */
export function buildContacts(rows: string[][], mapping: (Field | null)[]): BuildResult {
  const contacts: Built[] = [];
  const ignored: Ignored[] = [];
  const byEmail = new Map<string, Built>(), byPhoneName = new Map<string, Built>(), byName = new Map<string, Built[]>();
  let withoutName = 0;
  rows.forEach((r, idx) => {
    const v: Partial<Record<Field, string>> = {};
    mapping.forEach((f, i) => { const val = (r[i] ?? '').trim(); if (f && val && !v[f]) v[f] = val.slice(0, 300); });
    let first = v.first_name ?? '', last = v.last_name ?? '';
    if (!first && !last && v.full_name) { const parts = v.full_name.split(/\s+/); first = parts[0]; last = parts.slice(1).join(' '); }
    if (!first && last) { first = last; last = ''; }
    if (!first) { withoutName++; return; }
    const { full_name: _drop, ...rest } = v;
    const c: Built = { ...rest, first_name: first, ...(last ? { last_name: last } : {}) };
    const name = key(`${first} ${last}`), email = key(v.email), phone = phoneKey(v.phone);
    const dupOf = (email && byEmail.get(email))
      || (phone.length === 9 && byPhoneName.get(`${phone}|${name}`))
      || (byName.get(`${name}|${key(v.company)}`) ?? []).find((o) =>
        (!email || !o.email || key(o.email) === email) && (phone.length !== 9 || !o.phone || phoneKey(o.phone) === phone));
    if (dupOf) {
      ignored.push({ row: idx + 2, name: `${first} ${last}`.trim(), reason: email && key(dupOf.email) === email ? 'même email' : 'même personne', contact: c });
      return;
    }
    contacts.push(c);
    if (email) byEmail.set(email, c);
    if (phone.length === 9) byPhoneName.set(`${phone}|${name}`, c);
    const nk = `${name}|${key(v.company)}`;
    byName.set(nk, [...(byName.get(nk) ?? []), c]);
  });
  return { contacts, duplicatesInFile: ignored.length, withoutName, ignored };
}
