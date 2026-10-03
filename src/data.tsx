import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './lib/supabase';
import { buildMockBase } from './lib/mockData';

// Contexte de données du redesign. Les lectures passent par les vues
// masquées (contacts_visible…) : un contact verrouillé n'expose que
// prénom/nom. Pagination systématique (plafond Supabase 1000 lignes).

export interface DataApi {
  session: any;
  user: any;
  loading: boolean;
  errorMsg: string | null;
  spaces: any[];
  contacts: any[];
  notes: any[];
  tags: any[];
  contactTags: any[];
  contactLinks: any[];
  pendingUpdates: any[];
  followUps: any[];
  /* Pipelines (nouvel objet) : vides côté Supabase tant que les tables ne
     sont pas branchées ; alimentés par le mock en mode design. */
  pipelines: any[];
  pipelineStages: any[];
  pipelineItems: any[];
  selectedSpaceId: string | null;
  setSelectedSpaceId: (id: string | null) => void;
  refresh: (only?: DataKey[]) => Promise<void>;
  /** Met à jour une fiche en mémoire après une écriture réussie, sans tout recharger. */
  patchContact: (id: string, patch: Record<string, unknown>) => void;
  /* Index dérivés */
  lastNoteByContact: Map<string, string>;
  followUpsByContact: Map<string, any[]>;
  notesByContact: Map<string, any[]>;
  tagsByContact: Map<string, any[]>;
  linksByContact: Map<string, any[]>;
  pendingByContact: Map<string, any[]>;
  spaceById: Map<string, any>;
  contactById: Map<string, any>;
}

const DataContext = createContext<DataApi | null>(null);

export function useData(): DataApi {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData hors DataProvider');
  return ctx;
}

// Pagination systématique (plafond Supabase 1000 lignes/requête). Le filtre
// d'égalité optionnel permet de paginer aussi les requêtes filtrées (ex.
// status = 'pending') sans plafond dur à 500.
// Première page avec le total, puis les suivantes en parallèle (6 à la fois) :
// 10 000 contacts = 1 aller-retour + 2 vagues, au lieu de 10 requêtes en file.
// L'id départage les ex aequo pour que les pages ne se chevauchent pas.
const fetchAll = async (
  table: string,
  orderBy: string,
  ascending = true,
  eq?: [string, unknown],
  tiebreak: string | null = 'id',
) => {
  const PAGE = 1000;
  const page = (from: number, count = false) => {
    let q = supabase.from(table).select('*', count ? { count: 'exact' } : undefined);
    if (eq) q = q.eq(eq[0], eq[1]);
    q = q.order(orderBy, { ascending });
    if (tiebreak) q = q.order(tiebreak, { ascending: true });
    return q.range(from, from + PAGE - 1);
  };
  const first = await page(0, true);
  if (first.error) throw first.error;
  const rows: any[] = [...(first.data || [])];
  const total = first.count ?? rows.length;
  const starts: number[] = [];
  for (let from = PAGE; from < total; from += PAGE) starts.push(from);
  for (let i = 0; i < starts.length; i += 6) {
    const pages = await Promise.all(starts.slice(i, i + 6).map((from) => page(from)));
    for (const p of pages) { if (p.error) throw p.error; rows.push(...(p.data || [])); }
  }
  return rows;
};

export type DataKey = 'contacts' | 'notes' | 'tags' | 'links' | 'updates' | 'followUps' | 'pipelines';

export const DataProvider: React.FC<{ session: any; children: React.ReactNode }> = ({ session, children }) => {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [tags, setTags] = useState<any[]>([]);
  const [contactTags, setContactTags] = useState<any[]>([]);
  const [contactLinks, setContactLinks] = useState<any[]>([]);
  const [pendingUpdates, setPendingUpdates] = useState<any[]>([]);
  const [followUps, setFollowUps] = useState<any[]>([]);
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [pipelineStages, setPipelineStages] = useState<any[]>([]);
  const [pipelineItems, setPipelineItems] = useState<any[]>([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);

  const loadedOnce = useRef(false);
  // refresh() recharge tout ; refresh(['notes']) seulement ce qui a changé.
  // Le voile de chargement ne couvre que le premier chargement.
  const refresh = useCallback(async (only?: DataKey[]) => {
    if (!session?.user) return;
    if (only && loadedOnce.current) {
      const want = new Set(only);
      try {
        await Promise.all([
          want.has('contacts') && fetchAll('contacts_visible', 'first_name').then(setContacts),
          want.has('notes') && fetchAll('notes_visible', 'created_at', false).then(setNotes),
          want.has('tags') && Promise.all([fetchAll('tags', 'name'), fetchAll('contact_tags_visible', 'contact_id', true, undefined, 'tag_id')])
            .then(([t, ct]) => { setTags(t); setContactTags(ct); }),
          want.has('links') && fetchAll('contact_links', 'created_at', false).then(setContactLinks).catch(() => {}),
          want.has('updates') && fetchAll('contact_updates', 'detected_at', false, ['status', 'pending']).then(setPendingUpdates),
          want.has('followUps') && fetchAll('follow_ups', 'due_date', true, ['status', 'pending']).then(setFollowUps),
          want.has('pipelines') && Promise.all([fetchAll('pipelines', 'position'), fetchAll('pipeline_stages', 'position'), fetchAll('pipeline_items', 'position')])
            .then(([p, st, it]) => { setPipelines(p); setPipelineStages(st); setPipelineItems(it); }).catch(() => {}),
        ]);
      } catch (err: any) {
        console.error('Erreur de rafraîchissement:', err);
      }
      return;
    }
    if (!loadedOnce.current) setLoading(true);
    setErrorMsg(null);
    const timeout = setTimeout(() => {
      setLoading(false);
      setErrorMsg('Le chargement a expiré. Il y a peut-être un problème avec Supabase.');
    }, 15000);
    try {
      const spacesData = await fetchAll('spaces', 'name');
      setSpaces(spacesData);
      if (spacesData.length > 0) {
        const [contactsData, notesData, tagsData, contactTagsData, linksData, updatesData, followUpsData, pipelinesData, stagesData, itemsData] = await Promise.all([
          fetchAll('contacts_visible', 'first_name'),
          fetchAll('notes_visible', 'created_at', false),
          fetchAll('tags', 'name'),
          fetchAll('contact_tags_visible', 'contact_id', true, undefined, 'tag_id'),
          fetchAll('contact_links', 'created_at', false).catch(() => []),
          // contact_updates' real timestamp column is detected_at, not created_at
          // (see supabase/migrations/20260720100000_add_redesign_tables.sql).
          fetchAll('contact_updates', 'detected_at', false, ['status', 'pending']),
          fetchAll('follow_ups', 'due_date', true, ['status', 'pending']),
          fetchAll('pipelines', 'position').catch(() => []),
          fetchAll('pipeline_stages', 'position').catch(() => []),
          fetchAll('pipeline_items', 'position').catch(() => []),
        ]);
        setPipelines(pipelinesData);
        setPipelineStages(stagesData);
        setPipelineItems(itemsData);
        setContacts(contactsData);
        setNotes(notesData);
        setTags(tagsData);
        setContactTags(contactTagsData);
        setContactLinks(linksData);
        setPendingUpdates(updatesData);
        setFollowUps(followUpsData);
      }
      loadedOnce.current = true;
    } catch (err: any) {
      console.error('Erreur de chargement réseau:', err);
      setErrorMsg('Erreur réseau : ' + (err.message || 'impossible de joindre Supabase'));
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (session) refresh();
  }, [session, refresh]);

  const lastNoteByContact = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of notes) {
      const prev = m.get(n.contact_id);
      if (!prev || n.created_at > prev) m.set(n.contact_id, n.created_at);
    }
    return m;
  }, [notes]);

  const notesByContact = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const n of notes) {
      const arr = m.get(n.contact_id) ?? [];
      arr.push(n);
      m.set(n.contact_id, arr);
    }
    return m;
  }, [notes]);

  const tagsByContact = useMemo(() => {
    const tagById = new Map(tags.map((t) => [t.id, t]));
    const m = new Map<string, any[]>();
    for (const ct of contactTags) {
      const tag = tagById.get(ct.tag_id);
      if (!tag) continue;
      const arr = m.get(ct.contact_id) ?? [];
      arr.push(tag);
      m.set(ct.contact_id, arr);
    }
    return m;
  }, [contactTags, tags]);

  const linksByContact = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const l of contactLinks) {
      for (const id of [l.from_contact_id, l.to_contact_id]) {
        const arr = m.get(id) ?? [];
        arr.push(l);
        m.set(id, arr);
      }
    }
    return m;
  }, [contactLinks]);

  const pendingByContact = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const u of pendingUpdates) {
      const arr = m.get(u.contact_id) ?? [];
      arr.push(u);
      m.set(u.contact_id, arr);
    }
    return m;
  }, [pendingUpdates]);

  const followUpsByContact = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const f of followUps) {
      const arr = m.get(f.contact_id) ?? [];
      arr.push(f);
      m.set(f.contact_id, arr);
    }
    return m;
  }, [followUps]);

  const spaceById = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
  const contactById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);

  const value: DataApi = {
    session,
    user: session?.user ?? null,
    loading,
    errorMsg,
    spaces,
    contacts,
    notes,
    tags,
    contactTags,
    contactLinks,
    pendingUpdates,
    followUps,
    pipelines,
    pipelineStages,
    pipelineItems,
    selectedSpaceId,
    setSelectedSpaceId,
    refresh,
    patchContact: (id: string, patch: Record<string, unknown>) => setContacts((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c))),
    lastNoteByContact,
    followUpsByContact,
    notesByContact,
    tagsByContact,
    linksByContact,
    pendingByContact,
    spaceById,
    contactById,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

// Provider de données mockées (design local, dev uniquement). Satisfait la
// même interface que DataProvider pour que tous les écrans s'affichent sans
// session. Remplacé par DataProvider une fois le design validé.
export const MockDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const base = useMemo(() => buildMockBase(), []);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const value = { ...base, selectedSpaceId, setSelectedSpaceId, refresh: async () => {}, patchContact: () => {} } as unknown as DataApi;
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};
