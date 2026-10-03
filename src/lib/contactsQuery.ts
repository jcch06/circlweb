import { fullName, lastTouch, relStatus, type RelStatus } from '../ui/format';
import { supabase } from './supabase';
import { IS_MOCK } from './mode';

// Requête paginée sur les contacts : la page Contacts ne charge jamais tout
// le carnet (cible : des dizaines de milliers de fiches). Recherche, filtres,
// tri et pagination passent par cette interface.
// ponytail: implémentation en mémoire (mode design) ; au branchement des
// données, remplacée par une RPC Supabase (search_contacts) qui calcule le
// statut relationnel côté serveur, sans changer la signature.

export type ViewKey = 'all' | 'due' | 'not_enriched';
export type SortKey = 'name' | 'company' | 'last';

export interface ContactQuery {
  q: string; view: ViewKey; status: RelStatus | null; tagId: string | null;
  spaceId: string | null; sort: SortKey; offset: number; limit: number;
}
export interface ContactRow {
  c: any; name: string; touch: Date | null; status: RelStatus; tags: any[];
  space: any; followUp: any | null; pendingCount: number;
}
export interface ContactPage { rows: ContactRow[]; total: number; counts: Record<RelStatus, number> }

export async function queryContacts(query: ContactQuery, ctx: {
  contacts: any[]; lastNoteByContact: Map<string, string>; tagsByContact: Map<string, any[]>;
  spaceById: Map<string, any>; followUpsByContact: Map<string, any[]>; pendingByContact: Map<string, any[]>;
}): Promise<ContactPage> {
  if (!IS_MOCK) {
    // Côté serveur : RLS, masquage, statut et pagination calculés en base.
    const { data, error } = await supabase.rpc('search_contacts', {
      p_q: query.q.trim(), p_view: query.view, p_status: query.status, p_tag: query.tagId,
      p_space: query.spaceId, p_sort: query.sort, p_offset: query.offset, p_limit: query.limit,
    });
    if (error) throw error;
    const counts: Record<RelStatus, number> = { fresh: 0, due: 0, dormant: 0, never: 0, ...(data?.counts ?? {}) };
    const rows: ContactRow[] = (data?.rows ?? []).map((c: any) => ({
      c, name: fullName(c), touch: c.touch ? new Date(c.touch) : null, status: c.status as RelStatus,
      tags: ctx.tagsByContact.get(c.id) ?? [], space: ctx.spaceById.get(c.space_id),
      followUp: (ctx.followUpsByContact.get(c.id) ?? [])[0] ?? null,
      pendingCount: (ctx.pendingByContact.get(c.id) ?? []).length,
    }));
    return { rows, total: Number(data?.total ?? 0), counts };
  }

  let base = query.spaceId ? ctx.contacts.filter((c) => c.space_id === query.spaceId) : ctx.contacts;
  if (!query.spaceId) {
    // Un même contact partagé dans plusieurs cercles n'apparaît qu'une fois.
    const seen = new Set<string>();
    base = base.filter((c) => { const k = c.shared_contact_id ?? c.id; if (seen.has(k)) return false; seen.add(k); return true; });
  }
  const q = query.q.trim().toLowerCase();
  let rows: ContactRow[] = base.map((c) => {
    const touch = lastTouch(c, ctx.lastNoteByContact.get(c.id));
    return {
      c, name: fullName(c), touch, status: relStatus(touch),
      tags: ctx.tagsByContact.get(c.id) ?? [], space: ctx.spaceById.get(c.space_id),
      followUp: (ctx.followUpsByContact.get(c.id) ?? [])[0] ?? null,
      pendingCount: (ctx.pendingByContact.get(c.id) ?? []).length,
    };
  });
  if (q) {
    rows = rows.filter((r) => r.name.toLowerCase().includes(q) || (r.c.company ?? '').toLowerCase().includes(q)
      || (r.c.job_title ?? '').toLowerCase().includes(q) || r.tags.some((t) => t.name.toLowerCase().includes(q)));
  }
  if (query.view === 'due') rows = rows.filter((r) => r.status === 'due' || r.status === 'dormant');
  if (query.view === 'not_enriched') rows = rows.filter((r) => !r.c.enriched_at);
  if (query.tagId) rows = rows.filter((r) => r.tags.some((t) => t.id === query.tagId));

  // Répartition par statut avant le filtre de statut : les pastilles de
  // filtre montrent toujours la distribution complète.
  const counts: Record<RelStatus, number> = { fresh: 0, due: 0, dormant: 0, never: 0 };
  for (const r of rows) counts[r.status]++;
  if (query.status) rows = rows.filter((r) => r.status === query.status);

  const bySort: Record<SortKey, (a: ContactRow, b: ContactRow) => number> = {
    name: (a, b) => a.name.localeCompare(b.name, 'fr'),
    company: (a, b) => (a.c.company ?? '').localeCompare(b.c.company ?? '', 'fr'),
    last: (a, b) => (a.touch?.getTime() ?? 0) - (b.touch?.getTime() ?? 0),
  };
  rows.sort(bySort[query.view === 'due' && query.sort === 'name' ? 'last' : query.sort]);
  return { rows: rows.slice(query.offset, query.offset + query.limit), total: rows.length, counts };
}
