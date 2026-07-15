import React, { useEffect, useMemo, useState } from 'react';
import { X, GitMerge, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useData } from '../data';
import { useToast } from './Toast';
import { SectionLabel } from './Bits';

// Tags : plus de page (brief 4.7). Panneau latéral 400 px ouvert depuis
// « Gérer les tags » dans Contacts. Libellés fonctionnels, fusion avec
// récapitulatif, renommage au double-clic, 0 usage en opacité réduite.

const CATEGORIES: { key: string; label: string }[] = [
  { key: 'industrie', label: 'Secteur et compétence' },
  { key: 'relation', label: 'Type de relation' },
  { key: 'contexte', label: 'Source et contexte' },
  { key: 'statut', label: "Statut d'activité" },
];

export const TagsPanel: React.FC<{ onClose: () => void; onFilterTag: (tagId: string) => void }> = ({ onClose, onFilterTag }) => {
  const data = useData();
  const { toast } = useToast();
  const [mergeSel, setMergeSel] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const ct of data.contactTags) m.set(ct.tag_id, (m.get(ct.tag_id) ?? 0) + 1);
    return m;
  }, [data.contactTags]);

  const tags = useMemo(
    () => data.selectedSpaceId ? data.tags.filter((t) => t.space_id === data.selectedSpaceId) : data.tags,
    [data.tags, data.selectedSpaceId]
  );

  const rename = async (tag: any) => {
    const name = renameDraft.trim();
    setRenamingId(null);
    if (!name || name === tag.name) return;
    const { error } = await supabase.from('tags').update({ name }).eq('id', tag.id);
    if (error) { toast(`Renommage impossible : ${error.message}`); return; }
    toast('Tag renommé.');
    await data.refresh();
  };

  const remove = async (tag: any) => {
    const count = usage.get(tag.id) ?? 0;
    const { error } = await supabase.from('tags').delete().eq('id', tag.id);
    if (error) { toast(`Suppression impossible : ${error.message}`); return; }
    toast(count > 0 ? `Tag supprimé (retiré de ${count} contact${count > 1 ? 's' : ''}).` : 'Tag supprimé.');
    await data.refresh();
  };

  const toggleMerge = (id: string) => {
    setMergeSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const merge = async () => {
    const ids = [...mergeSel];
    if (ids.length < 2) return;
    // Le tag conservé = le plus utilisé.
    const target = ids.reduce((a, b) => ((usage.get(a) ?? 0) >= (usage.get(b) ?? 0) ? a : b));
    const others = ids.filter((id) => id !== target);
    const affected = data.contactTags.filter((ct) => others.includes(ct.tag_id));
    const already = new Set(data.contactTags.filter((ct) => ct.tag_id === target).map((ct) => ct.contact_id));
    const toInsert = [...new Set(affected.map((ct) => ct.contact_id))]
      .filter((cid) => !already.has(cid))
      .map((contact_id) => ({ contact_id, tag_id: target, tagged_by: data.user?.id }));
    if (toInsert.length > 0) await supabase.from('contact_tags').insert(toInsert);
    await supabase.from('tags').delete().in('id', others);
    const targetTag = data.tags.find((t) => t.id === target);
    toast(`Fusion faite : ${affected.length} liaison${affected.length > 1 ? 's' : ''} re-taguée${affected.length > 1 ? 's' : ''} vers « ${targetTag?.name} ».`);
    setMergeSel(new Set());
    await data.refresh();
  };

  const mergeCount = useMemo(() => {
    const contactIds = new Set(
      data.contactTags.filter((ct) => mergeSel.has(ct.tag_id)).map((ct) => ct.contact_id)
    );
    return contactIds.size;
  }, [mergeSel, data.contactTags]);

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="side-panel" style={{ width: 400 }} role="dialog" aria-label="Gérer les tags">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <span className="t-block" style={{ flex: 1, fontSize: 16 }}>Gérer les tags</span>
          <button className="btn btn-quiet" style={{ padding: 6 }} onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="t-meta" style={{ color: 'var(--mut)' }}>
            Double-clic pour renommer · cochez plusieurs tags pour les fusionner · le compteur filtre la liste.
          </div>

          {CATEGORIES.map((cat) => {
            const catTags = tags.filter((t) => t.category === cat.key);
            if (catTags.length === 0) return null;
            return (
              <div key={cat.key}>
                <SectionLabel>{cat.label}</SectionLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {catTags.map((t) => {
                    const count = usage.get(t.id) ?? 0;
                    const isRenaming = renamingId === t.id;
                    return (
                      <div
                        key={t.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, minHeight: 32,
                          opacity: count === 0 ? 0.55 : 1,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={mergeSel.has(t.id)}
                          onChange={() => toggleMerge(t.id)}
                          style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
                          title="Sélectionner pour fusion"
                        />
                        <span style={{ width: 9, height: 9, borderRadius: 999, background: t.color_hex ?? 'var(--faint)', flex: 'none' }} />
                        {isRenaming ? (
                          <input
                            className="input"
                            style={{ padding: '3px 8px', fontSize: 13 }}
                            value={renameDraft}
                            autoFocus
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onBlur={() => rename(t)}
                            onKeyDown={(e) => { if (e.key === 'Enter') rename(t); if (e.key === 'Escape') setRenamingId(null); }}
                          />
                        ) : (
                          <span
                            className="t-sec"
                            style={{ flex: 1, cursor: 'text' }}
                            onDoubleClick={() => { setRenamingId(t.id); setRenameDraft(t.name); }}
                          >
                            {t.name}
                          </span>
                        )}
                        {!isRenaming && (
                          <>
                            <button
                              className="t-meta tnum"
                              style={{ background: 'none', border: 'none', cursor: count > 0 ? 'pointer' : 'default', color: count > 0 ? 'var(--accent)' : 'var(--faint)' }}
                              onClick={() => { if (count > 0) { onFilterTag(t.id); onClose(); } }}
                              title={count > 0 ? 'Voir les contacts tagués' : 'Aucun contact'}
                            >
                              {count}
                            </button>
                            <button className="btn btn-quiet" style={{ padding: 4, color: 'var(--danger)' }} title="Supprimer" onClick={() => remove(t)}>
                              <Trash2 size={12} />
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {tags.length === 0 && (
            <div className="t-sec" style={{ color: 'var(--mut)' }}>Aucun tag dans ce cercle.</div>
          )}
        </div>

        {mergeSel.size >= 2 && (
          <div style={{ borderTop: '1px solid var(--line)', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="t-sec" style={{ flex: 1, color: 'var(--ink-2)' }}>
              <span className="tnum">{mergeCount}</span> contact{mergeCount > 1 ? 's' : ''} ser{mergeCount > 1 ? 'ont' : 'a'} re-tagué{mergeCount > 1 ? 's' : ''}.
            </span>
            <button className="btn btn-primary" onClick={merge}>
              <GitMerge size={14} /> Fusionner ({mergeSel.size})
            </button>
          </div>
        )}
      </aside>
    </>
  );
};
