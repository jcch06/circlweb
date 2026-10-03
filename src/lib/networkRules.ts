// Carte réseau : milieux et liens devinés, calculés à la volée à partir des
// fiches et des notes. Rien n'est inventé : chaque milieu vient d'un indice
// lisible (parenthèse dans le nom, champ entreprise, domaine d'email, poste)
// et chaque lien deviné porte sa raison, à confirmer par l'utilisateur.
// La base ne garde que les décisions (classements, renommages, liens
// confirmés ou rejetés). Self-check : npx tsx src/lib/networkRules.check.ts

export type RuleContact = {
  id: string; first_name?: string | null; last_name?: string | null;
  company?: string | null; job_title?: string | null; email?: string | null;
};
export type RuleNote = { contact_id: string; content: string; created_at: string };
export type LinkKind = 'works_for' | 'co_mention';
export type Suggestion = { a: string; b: string; kind: LinkKind; reason: string };

export const POLITIQUE = 'Politique';
export const COLLABS = 'Collaborateurs parlementaires';
export const MEDIAS = 'Médias';

export const norm = (s?: string | null) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.fr', 'yahoo.fr', 'yahoo.com', 'outlook.com',
  'outlook.fr', 'live.fr', 'live.com', 'icloud.com', 'me.com', 'orange.fr', 'free.fr', 'wanadoo.fr', 'sfr.fr', 'laposte.net', 'proton.me', 'protonmail.com']);
const PARTIES = new Set(['lr', 'rn', 'ps', 'lfi', 'udr', 'eelv', 'pcf', 'modem', 'horizons', 'renaissance', 'reconquete',
  'les republicains', 'rassemblement national', 'la france insoumise', 'parti socialiste']);
const POLITICAL = /\b(deput[ee]?e?s?|senat(eur|rice)s?|maire|ministre|elue?s?|conseill(er|ere) (regional|municipal|departemental)e?)\b/;
const COLLAB = /\b(coll?ab(orat(eur|rice))?|assistante? parlementaire)\b/;
const MEDIA = /\b(journalistes?|redac\w*|radio|television|tv|presse|media|magazine|podcast|editorialiste|chroniqueu?r\w*)\b/;
// « Collab Philippe Ballard & Arnaud Sanvert », « Colab Parlementaire Stéphane Rambaud »
const WORKS_FOR = /\bcoll?ab(?:orat(?:eur|rice))?\.?(?:\s+parlementaire)?\s*(?:de\s+|d['’]\s*)?(.+)$/i;

const display = (s: string) => { const t = s.trim().replace(/\s+/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };

/** Indices bruts d'un contact : ce qu'il dit de son ou ses milieux. */
function cues(c: RuleContact) {
  const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`;
  const tags = [...name.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim())
    .filter((t) => t.length >= 2 && t.split(/\s+/).length <= 3 && !/^(avec|dit|de|le|la|les)\b/i.test(t));
  const org = norm(c.company), job = norm(c.job_title);
  const both = `${org} ${job}`;
  const kinds: string[] = [];
  if (COLLAB.test(both)) kinds.push(COLLABS);
  else if (POLITICAL.test(both) || PARTIES.has(org)) kinds.push(POLITIQUE);
  if (MEDIA.test(both)) kinds.push(MEDIAS);
  const domain = (c.email ?? '').toLowerCase().split('@')[1] ?? '';
  return {
    tags,
    // L'entreprise n'est un milieu que si elle n'est ni un mandat, ni un parti, ni « collab ».
    company: org && !kinds.includes(COLLABS) && !kinds.includes(POLITIQUE) ? c.company!.trim() : null,
    domain: domain && !FREE_MAIL.has(domain) ? domain : null,
    kinds,
  };
}

export type MilieuInput = {
  contacts: RuleContact[];
  explicit: Map<string, string[]>; // contact_milieux : remplace les règles pour ce contact
  aliases: Map<string, string>;    // norm(nom) -> nouveau nom
};
export type MilieuResult = {
  byContact: Map<string, string[]>;
  milieux: { name: string; ids: string[] }[]; // du plus grand au plus petit
  unclassified: string[];
};

/** Milieux de chaque contact. Un indice (tag, entreprise, domaine) ne devient
 *  un milieu que s'il est partagé par au moins deux contacts. */
export function computeMilieux({ contacts, explicit, aliases }: MilieuInput): MilieuResult {
  const all = contacts.map((c) => ({ c, k: cues(c) }));
  const count = new Map<string, number>();
  const forms = new Map<string, Map<string, number>>();
  const bump = (key: string, form: string) => {
    count.set(key, (count.get(key) ?? 0) + 1);
    const f = forms.get(key) ?? new Map<string, number>();
    f.set(form, (f.get(form) ?? 0) + 1); forms.set(key, f);
  };
  for (const { k } of all) {
    for (const t of new Set(k.tags.map(norm))) bump(`t:${t}`, k.tags.find((x) => norm(x) === t)!);
    if (k.company) bump(`c:${norm(k.company)}`, k.company);
    if (k.domain) bump(`d:${k.domain}`, k.domain.split('.')[0]);
  }
  const best = (key: string) => display([...(forms.get(key) ?? new Map()).entries()].sort((a, b) => b[1] - a[1])[0][0]);
  const alias = (name: string) => aliases.get(norm(name)) ?? name;

  const byContact = new Map<string, string[]>();
  const groups = new Map<string, { name: string; ids: string[] }>();
  const unclassified: string[] = [];
  for (const { c, k } of all) {
    let names = explicit.get(c.id);
    if (!names) {
      const out = [...k.kinds];
      for (const t of new Set(k.tags.map(norm))) if ((count.get(`t:${t}`) ?? 0) >= 2) out.push(best(`t:${t}`));
      if (k.company && (count.get(`c:${norm(k.company)}`) ?? 0) >= 2) out.push(best(`c:${norm(k.company)}`));
      else if (k.domain && (count.get(`d:${k.domain}`) ?? 0) >= 2) out.push(best(`d:${k.domain}`));
      names = out;
    }
    const final = [...new Map(names.map((n) => [norm(alias(n)), alias(n)])).values()];
    byContact.set(c.id, final);
    if (final.length === 0) unclassified.push(c.id);
    for (const n of final) {
      const g = groups.get(norm(n)) ?? { name: n, ids: [] };
      g.ids.push(c.id); groups.set(norm(n), g);
    }
  }
  return { byContact, milieux: [...groups.values()].sort((a, b) => b.ids.length - a.ids.length), unclassified };
}

/** Un contact sans aucun indice exploitable par l'IA (nom seul). */
export const hasInfo = (c: RuleContact) => Boolean(c.company || c.job_title || c.email || /\(/.test(`${c.first_name} ${c.last_name}`));

const fullKey = (c: RuleContact) => norm(`${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\([^)]*\)/g, ''));
const pairKey = (a: string, b: string, kind: string) => `${a < b ? a : b}|${a < b ? b : a}|${kind}`;

/** Liens devinés, chacun avec sa raison. Exclut les paires déjà liées et rejetées. */
export function suggestLinks(contacts: RuleContact[], notes: RuleNote[], known: Set<string>): Suggestion[] {
  const byFull = new Map<string, RuleContact[]>();
  const byLast = new Map<string, RuleContact[]>();
  for (const c of contacts) {
    const f = fullKey(c);
    if (f.includes(' ')) (byFull.get(f) ?? byFull.set(f, []).get(f)!).push(c);
    const l = norm(c.last_name);
    if (l.length >= 4) (byLast.get(l) ?? byLast.set(l, []).get(l)!).push(c);
  }
  const out = new Map<string, Suggestion>();
  // Une seule suggestion par paire : la première règle (la plus sûre) gagne.
  const add = (a: string, b: string, kind: LinkKind, reason: string) => {
    if (a === b) return;
    const any = pairKey(a, b, 'any');
    if (known.has(pairKey(a, b, kind)) || known.has(any) || out.has(any)) return;
    out.set(any, { a, b, kind, reason });
  };

  // 1. « Collab X » : la personne travaille pour X, si X est dans le carnet (sans ambiguïté).
  for (const c of contacts) {
    for (const field of [c.company, c.job_title]) {
      const m = (field ?? '').match(WORKS_FOR);
      if (!m) continue;
      // « Collab RN Weber » : les sigles de partis ne font pas partie du nom.
      const chunks = m[1].split(/\s*(?:&|,|\/|\bet\b)\s*/i)
        .map((x) => norm(x).split(' ').filter((w) => !PARTIES.has(w) && w !== 'an').join(' '))
        .filter((x) => x.length >= 4);
      for (const chunk of chunks) {
        const hits = byFull.get(chunk) ?? (chunk.includes(' ') ? [] : byLast.get(chunk) ?? []);
        if (hits.length === 1) add(c.id, hits[0].id, 'works_for', `Sa fiche indique « ${field!.trim()} ».`);
      }
    }
  }
  // 2. Personne citée par son nom complet dans la note ou la fiche d'un autre contact.
  // ponytail: balayage textes x noms, index par mot si les notes dépassent quelques milliers
  const names = [...byFull.entries()].filter(([, cs]) => cs.length === 1).map(([k, cs]) => ({ k, id: cs[0].id }));
  const scan = (owner: string, raw: string, reason: (name: string) => string) => {
    const text = ` ${norm(raw).replace(/[^\p{L}\p{N} ]+/gu, ' ')} `;
    for (const { k, id } of names) if (id !== owner && text.includes(` ${k} `)) add(owner, id, 'co_mention', reason(k));
  };
  const nameOf = new Map(contacts.map((c) => [c.id, `${c.first_name ?? ''} ${c.last_name ?? ''}`.replace(/\([^)]*\)/g, '').trim()]));
  for (const c of contacts) {
    const raw = [c.company, c.job_title].filter(Boolean).join(' · ');
    if (raw) scan(c.id, raw, () => `Sa fiche mentionne cette personne : « ${raw.trim()} ».`);
  }
  for (const n of notes) {
    scan(n.contact_id, n.content, () => `Cités ensemble dans votre note du ${new Date(n.created_at).toLocaleDateString('fr-FR')} sur ${nameOf.get(n.contact_id) ?? 'ce contact'}.`);
  }
  return [...out.values()];
}

export const linkKey = pairKey;
