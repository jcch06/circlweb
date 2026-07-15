import React, { useState } from 'react';
import { Lock, Pencil, Trash2, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useData } from '../data';
import { useToast } from './Toast';
import { Avatar } from './Bits';
import { fullName, relativeFR } from './format';

// Composant 10 : timeline de relation. Fil antichronologique fusionnant
// notes (auteur si cercle partagé, cadenas si privée), enrichissement et
// création. Sous chaque note, les chips « mentionne : {personne} ».

interface TimelineProps {
  contact: any;
  onOpenContact?: (id: string) => void;
}

export const Timeline: React.FC<TimelineProps> = ({ contact, onOpenContact }) => {
  const { user, notesByContact, contactLinks, contactById, spaceById, refresh } = useData();
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const notes = notesByContact.get(contact.id) ?? [];
  const space = spaceById.get(contact.space_id);
  const isShared = space?.type !== 'personal';

  const mentionsByNote = new Map<string, any[]>();
  for (const l of contactLinks) {
    if (!l.source_note_id) continue;
    if (l.from_contact_id !== contact.id && l.to_contact_id !== contact.id) continue;
    const otherId = l.from_contact_id === contact.id ? l.to_contact_id : l.from_contact_id;
    const other = contactById.get(otherId);
    if (!other) continue;
    const arr = mentionsByNote.get(l.source_note_id) ?? [];
    arr.push(other);
    mentionsByNote.set(l.source_note_id, arr);
  }

  const events: { kind: 'note' | 'enriched' | 'created'; at: string; note?: any }[] = [
    ...notes.map((n) => ({ kind: 'note' as const, at: n.created_at, note: n })),
    ...(contact.enriched_at ? [{ kind: 'enriched' as const, at: contact.enriched_at }] : []),
    ...(contact.created_at ? [{ kind: 'created' as const, at: contact.created_at }] : []),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  const saveEdit = async (note: any) => {
    const content = draft.trim();
    setEditingId(null);
    if (!content || content === note.content) return;
    const { error } = await supabase.from('notes').update({ content }).eq('id', note.id);
    if (error) toast(`Modification impossible : ${error.message}`);
    else { toast('Note modifiée.'); await refresh(); }
  };

  const deleteNote = async (note: any) => {
    const { error } = await supabase.from('notes').delete().eq('id', note.id);
    if (error) { toast(`Suppression impossible : ${error.message}`); return; }
    toast('Note supprimée.');
    await refresh();
  };

  if (events.length === 0) {
    return (
      <div className="t-sec" style={{ color: 'var(--mut)', padding: '8px 0' }}>
        Aucune activité pour l'instant. La première note démarre l'historique.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {events.map((ev, i) => {
        if (ev.kind !== 'note') {
          return (
            <div
              key={`${ev.kind}-${i}`}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--line)' }}
            >
              <span style={{ width: 28, display: 'grid', placeItems: 'center', color: 'var(--faint)' }}>
                <Sparkles size={14} />
              </span>
              <span className="t-sec" style={{ color: 'var(--mut)' }}>
                {ev.kind === 'enriched' ? 'Fiche enrichie par l’IA' : 'Contact ajouté'}
              </span>
              <span className="t-meta tnum" style={{ color: 'var(--faint)', marginLeft: 'auto' }}>
                {relativeFR(ev.at)}
              </span>
            </div>
          );
        }

        const n = ev.note;
        const mine = n.author_id === user?.id;
        const mentions = mentionsByNote.get(n.id) ?? [];
        const isEditing = editingId === n.id;

        return (
          <div key={n.id} style={{ display: 'flex', gap: 10, padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                {n.is_private && <Lock size={12} color="var(--orange)" aria-label="Note privée" />}
                {isShared && (
                  <span className="t-meta" style={{ color: 'var(--mut)' }}>
                    {mine ? 'Vous' : 'Un membre du cercle'}
                  </span>
                )}
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
                <span className="t-meta tnum" style={{ color: 'var(--faint)', marginLeft: 'auto' }}>
                  {relativeFR(n.created_at)}
                </span>
                {mine && !isEditing && (
                  <span style={{ display: 'inline-flex', gap: 2 }}>
                    <button
                      className="btn btn-quiet" style={{ padding: 4 }}
                      title="Modifier"
                      onClick={() => { setEditingId(n.id); setDraft(n.content); }}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      className="btn btn-quiet" style={{ padding: 4, color: 'var(--danger)' }}
                      title="Supprimer"
                      onClick={() => deleteNote(n)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                )}
              </div>

              {isEditing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <textarea
                    className="input"
                    value={draft}
                    rows={3}
                    onChange={(e) => setDraft(e.target.value)}
                    style={{ resize: 'vertical', fontSize: 14 }}
                  />
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button className="btn btn-ghost" style={{ padding: '5px 10px' }} onClick={() => setEditingId(null)}>Annuler</button>
                    <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => saveEdit(n)}>Enregistrer</button>
                  </div>
                </div>
              ) : (
                <div className="t-sec" style={{ color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>{n.content}</div>
              )}

              {mentions.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {mentions.map((m) => (
                    <button
                      key={m.id}
                      className="chip clickable"
                      onClick={() => onOpenContact?.(m.id)}
                    >
                      <Avatar name={fullName(m)} firstName={m.first_name} lastName={m.last_name} photoUrl={m.photo_url} size={24} />
                      <span style={{ marginLeft: 2 }}>mentionne : {m.first_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
