import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useData } from '../data';
import { useToast } from '../ui/Toast';
import { Avatar, SectionLabel } from '../ui/Bits';
import { NoteComposer } from '../ui/NoteComposer';
import { fullName, relativeFR, circleColor } from '../ui/format';

// Journal (brief 4.6) : le flux transverse des notes, groupé par période.
// La lecture par personne vit dans la timeline de la fiche.

type Filter = 'all' | 'professional' | 'personal' | 'private';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Toutes' },
  { key: 'professional', label: 'Pro' },
  { key: 'personal', label: 'Perso' },
  { key: 'private', label: 'Privées' },
];

const DAY = 86400000;

function periodOf(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
  if (days <= 0) return "Aujourd'hui";
  if (days < 7) return 'Cette semaine';
  if (days < 31) return 'Ce mois';
  return 'Avant';
}

const PERIODS = ["Aujourd'hui", 'Cette semaine', 'Ce mois', 'Avant'];

export const JournalPage: React.FC = () => {
  const data = useData();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerTarget, setComposerTarget] = useState<string | null>(null);
  const [targetQuery, setTargetQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const activeSpace = data.selectedSpaceId ? data.spaceById.get(data.selectedSpaceId) : null;

  const grouped = useMemo(() => {
    let notes = data.notes.filter((n) => {
      const c = data.contactById.get(n.contact_id);
      if (!c) return false;
      if (data.selectedSpaceId && c.space_id !== data.selectedSpaceId) return false;
      if (filter === 'private') return n.is_private;
      if (filter !== 'all' && n.context !== filter) return false;
      return true;
    });
    const m = new Map<string, any[]>();
    for (const n of notes) {
      const p = periodOf(n.created_at);
      const arr = m.get(p) ?? [];
      arr.push(n);
      m.set(p, arr);
    }
    return m;
  }, [data.notes, data.contactById, data.selectedSpaceId, filter]);

  const total = [...grouped.values()].reduce((s, a) => s + a.length, 0);

  const saveEdit = async (note: any) => {
    const content = draft.trim();
    setEditingId(null);
    if (!content || content === note.content) return;
    const { error } = await supabase.from('notes').update({ content }).eq('id', note.id);
    if (error) toast(`Modification impossible : ${error.message}`);
    else { toast('Note modifiée.'); await data.refresh(); }
  };

  const deleteNote = async (note: any) => {
    const { error } = await supabase.from('notes').delete().eq('id', note.id);
    if (error) { toast(`Suppression impossible : ${error.message}`); return; }
    toast('Note supprimée.');
    await data.refresh();
  };

  const targetMatches = useMemo(() => {
    const q = targetQuery.trim().toLowerCase();
    if (q.length < 1) return [];
    return data.contacts
      .filter((c) => fullName(c).toLowerCase().includes(q))
      .slice(0, 6);
  }, [targetQuery, data.contacts]);

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 20px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <h1 className="t-page">Journal</h1>
          <span className="t-sec tnum" style={{ color: 'var(--mut)' }}>{total}</span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={() => { setComposerOpen(true); setComposerTarget(null); setTargetQuery(''); }}>
            <Plus size={15} /> Note
          </button>
        </div>

        {activeSpace && (
          <div
            className="t-sec"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              color: circleColor(activeSpace), fontWeight: 500, marginBottom: 12,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 999, background: circleColor(activeSpace) }} />
            Journal de {activeSpace.name}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`chip clickable chip-filter${filter === f.key ? ' on' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {total === 0 ? (
          <div className="card card-pad" style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div className="t-block" style={{ marginBottom: 6 }}>Aucune note ici</div>
            <div className="t-sec" style={{ color: 'var(--mut)' }}>
              Les notes se prennent depuis une fiche, l'app iPhone, ou le bouton Note ci-dessus.
            </div>
          </div>
        ) : (
          PERIODS.filter((p) => grouped.has(p)).map((p) => (
            <div key={p} style={{ marginBottom: 24 }}>
              <SectionLabel>{p}</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {grouped.get(p)!.map((n) => {
                  const c = data.contactById.get(n.contact_id);
                  const space = data.spaceById.get(c.space_id);
                  const shared = space?.type !== 'personal';
                  const mine = n.author_id === data.user?.id;
                  const isEditing = editingId === n.id;
                  return (
                    <div key={n.id} className="card" style={{ padding: '12px 16px', display: 'flex', gap: 10 }}>
                      <Avatar name={fullName(c)} firstName={c.first_name} lastName={c.last_name} photoUrl={c.photo_url} size={32} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                          <button
                            className="t-name"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', padding: 0 }}
                            onClick={() => navigate(`/contacts/${c.id}`)}
                          >
                            {fullName(c)}
                          </button>
                          {n.is_private && <Lock size={12} color="var(--orange)" aria-label="Privée" />}
                          <span
                            className="chip"
                            style={{
                              height: 20, fontSize: 11, padding: '0 8px',
                              borderColor: n.context === 'personal' ? 'var(--amber)' : 'var(--accent)',
                              color: n.context === 'personal' ? 'var(--amber)' : 'var(--accent)',
                            }}
                          >
                            {n.context === 'personal' ? 'Perso' : 'Pro'}
                          </span>
                          {shared && (
                            <span className="t-meta" style={{ color: 'var(--mut)' }}>
                              par {mine ? 'vous' : 'un membre'}
                            </span>
                          )}
                          <span className="t-meta tnum" style={{ color: 'var(--faint)', marginLeft: 'auto' }}>
                            {relativeFR(n.created_at)}
                          </span>
                          {mine && !isEditing && (
                            <span style={{ display: 'inline-flex', gap: 2 }}>
                              <button className="btn btn-quiet" style={{ padding: 4 }} title="Modifier" onClick={() => { setEditingId(n.id); setDraft(n.content); }}>
                                <Pencil size={13} />
                              </button>
                              <button className="btn btn-quiet" style={{ padding: 4, color: 'var(--danger)' }} title="Supprimer" onClick={() => deleteNote(n)}>
                                <Trash2 size={13} />
                              </button>
                            </span>
                          )}
                        </div>
                        {isEditing ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <textarea className="input" value={draft} rows={3} onChange={(e) => setDraft(e.target.value)} style={{ resize: 'vertical', fontSize: 14 }} />
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                              <button className="btn btn-ghost" style={{ padding: '5px 10px' }} onClick={() => setEditingId(null)}>Annuler</button>
                              <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => saveEdit(n)}>Enregistrer</button>
                            </div>
                          </div>
                        ) : (
                          <div
                            className="t-sec"
                            style={{ color: 'var(--ink-2)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
                          >
                            {n.content}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}

        {/* Nouvelle note : combobox recherchable, jamais de pré-sélection arbitraire */}
        {composerOpen && (
          <div className="modal-scrim" onClick={() => setComposerOpen(false)}>
            <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
              {composerTarget === null ? (
                <>
                  <div className="t-block" style={{ marginBottom: 12 }}>Sur qui porte cette note ?</div>
                  <input
                    className="input"
                    autoFocus
                    placeholder="Chercher un contact…"
                    value={targetQuery}
                    onChange={(e) => setTargetQuery(e.target.value)}
                  />
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {targetMatches.map((c) => (
                      <button key={c.id} className="nav-item" onClick={() => setComposerTarget(c.id)}>
                        <Avatar name={fullName(c)} firstName={c.first_name} lastName={c.last_name} photoUrl={c.photo_url} size={24} />
                        <span style={{ flex: 1 }}>{fullName(c)}</span>
                        <span className="t-meta" style={{ color: 'var(--mut)' }}>{c.company ?? ''}</span>
                      </button>
                    ))}
                    {targetQuery.length > 0 && targetMatches.length === 0 && (
                      <span className="t-sec" style={{ color: 'var(--mut)', padding: '8px 4px' }}>Aucun contact trouvé.</span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="t-block" style={{ marginBottom: 12 }}>
                    Note sur {fullName(data.contactById.get(composerTarget) ?? {})}
                  </div>
                  <NoteComposer
                    contactId={composerTarget}
                    contactFirstName={data.contactById.get(composerTarget)?.first_name}
                    onSaved={() => setComposerOpen(false)}
                  />
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
