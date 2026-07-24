import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabase';

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
  selectedSpaceId: string | null;
  setSelectedSpaceId: (id: string | null) => void;
  refresh: () => Promise<void>;
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
const fetchAll = async (
  table: string,
  orderBy: string,
  ascending = true,
  eq?: [string, unknown],
) => {
  const PAGE = 1000;
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select('*');
    if (eq) q = q.eq(eq[0], eq[1]);
    const { data, error } = await q.order(orderBy, { ascending }).range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
};

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
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session?.user) return;
    setLoading(true);
    setErrorMsg(null);
    const timeout = setTimeout(() => {
      setLoading(false);
      setErrorMsg('Le chargement a expiré. Il y a peut-être un problème avec Supabase.');
    }, 15000);
    try {
      const spacesData = await fetchAll('spaces', 'name');
      setSpaces(spacesData);
      if (spacesData.length > 0) {
        const [contactsData, notesData, tagsData, contactTagsData, linksData, updatesData, followUpsData] = await Promise.all([
          fetchAll('contacts_visible', 'first_name'),
          fetchAll('notes_visible', 'created_at', false),
          fetchAll('tags', 'name'),
          fetchAll('contact_tags_visible', 'contact_id'),
          fetchAll('contact_links', 'created_at', false).catch(() => []),
          // contact_updates' real timestamp column is detected_at, not created_at
          // (see supabase/migrations/20260720100000_add_redesign_tables.sql).
          fetchAll('contact_updates', 'detected_at', false, ['status', 'pending']),
          fetchAll('follow_ups', 'due_date', true, ['status', 'pending']),
        ]);
        setContacts(contactsData);
        setNotes(notesData);
        setTags(tagsData);
        setContactTags(contactTagsData);
        setContactLinks(linksData);
        setPendingUpdates(updatesData);
        setFollowUps(followUpsData);
      }
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
    selectedSpaceId,
    setSelectedSpaceId,
    refresh,
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
