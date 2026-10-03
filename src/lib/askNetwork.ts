import { fullName, lastTouch, relStatus } from '../ui/format';

// Interroger son réseau en langage naturel. Même forme de réponse que l'edge
// function chat-contacts ({ response, contact_ids }) pour un branchement
// direct. ponytail: implémentation locale par mots-clés (mode design) ;
// remplacée par chat-contacts + recherche sémantique (embeddings) au
// branchement des données.

export interface AskResult { response: string; contact_ids: string[] }

const STOP = new Set(['qui', 'les', 'des', 'mes', 'dans', 'de', 'la', 'le', 'du', 'en', 'et', 'un', 'une', 'à', 'a', 'au', 'aux',
  'pour', 'avec', 'sur', 'ma', 'mon', 'trouve', 'moi', 'tous', 'toutes', 'personnes', 'contacts', 'contact', 'travaille',
  'travaillent', 'est', 'sont', 'quelqu', 'quelqu\'un', 'chez', 'pourrait', 'peut', 'aider', 'connaît', 'connait']);

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function askNetwork(question: string, ctx: {
  contacts: any[]; notesByContact: Map<string, any[]>; tagsByContact: Map<string, any[]>; lastNoteByContact: Map<string, string>;
}): AskResult {
  const q = norm(question);

  // Intention « à relancer / pas vu depuis longtemps »
  if (/relanc|pas vu|pas parle|depuis longtemps|refroidi|en froid/.test(q)) {
    const hits = ctx.contacts
      .map((c) => ({ c, s: relStatus(lastTouch(c, ctx.lastNoteByContact.get(c.id))) }))
      .filter((x) => x.s === 'due' || x.s === 'dormant')
      .map((x) => x.c);
    return {
      response: hits.length ? `${hits.length} contacts n'ont pas eu de nouvelles depuis plus d'un mois. Les plus anciens en premier.` : 'Tout votre réseau a été contacté récemment.',
      contact_ids: hits.slice(0, 20).map((c) => c.id),
    };
  }

  const terms = q.replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t));
  const phrase = terms.join(' ');
  const scored = ctx.contacts.map((c) => {
    const notes = (ctx.notesByContact.get(c.id) ?? []).map((n) => n.content).join(' ');
    const tags = (ctx.tagsByContact.get(c.id) ?? []).map((t) => t.name).join(' ');
    const hay = norm([fullName(c), c.job_title, c.company, c.industry, c.location, tags, notes, (c.skills ?? []).join(' ')].filter(Boolean).join(' '));
    let score = phrase && hay.includes(phrase) ? 5 : 0;
    for (const t of terms) if (hay.includes(t)) score += 1;
    return { c, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { response: 'Je n\'ai trouvé personne qui corresponde. Essayez un secteur, un poste ou une entreprise.', contact_ids: [] };
  }
  return {
    response: `${scored.length} contact${scored.length > 1 ? 's correspondent' : ' correspond'} à votre demande.`,
    contact_ids: scored.slice(0, 20).map((x) => x.c.id),
  };
}
