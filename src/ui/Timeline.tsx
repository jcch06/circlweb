import React, { useState } from 'react';
import { Lock, Pencil, Trash2, Sparkles, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useData } from '../data';
import { useToast } from './Toast';
import { Avatar } from './Bits';
import { fullName, relativeFR } from './format';

// Timeline de relation : fil antichronologique des notes (auteur si cercle
// partagé, cadenas si privée), de l'enrichissement et de la création. Sous
// chaque note, les personnes mentionnées (liens détectés).

export const Timeline: React.FC<{ contact: any; onOpenContact?: (id: string) => void }> = ({ contact, onOpenContact }) => {
  const { user, notesByContact, contactLinks, contactById, spaceById, refresh } = useData();
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const notes = notesByContact.get(contact.id) ?? [];
  const isShared = spaceById.get(contact.space_id)?.type !== 'personal';

  const mentionsByNote = new Map<string, any[]>();
  for (const l of contactLinks) {
    if (!l.source_note_id) continue;
    if (l.from_contact_id !== contact.id && l.to_contact_id !== contact.id) continue;
    const other = contactById.get(l.from_contact_id === contact.id ? l.to_contact_id : l.from_contact_id);
    if (!other) continue;
    (mentionsByNote.get(l.source_note_id) ?? mentionsByNote.set(l.source_note_id, []).get(l.source_note_id)!).push(other);
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
    else { toast('Note modifiée.'); await refresh(['notes']); }
  };
  const deleteNote = async (note: any) => {
    const { error } = await supabase.from('notes').delete().eq('id', note.id);
    if (error) { toast(`Suppression impossible : ${error.message}`); return; }
    toast('Note supprimée.'); await refresh(['notes']);
  };

  if (events.length === 0) {
    return <p className="py-2 text-[13px] text-muted-foreground">Aucune activité pour l'instant. La première note démarre l'historique.</p>;
  }

  return (
    <div className="flex flex-col">
      {events.map((ev, i) => {
        if (ev.kind !== 'note') {
          return (
            <div key={`${ev.kind}-${i}`} className="flex items-center gap-2.5 border-b py-2.5 last:border-0">
              {ev.kind === 'enriched' ? <Sparkles size={13} className="text-muted-foreground" /> : <UserPlus size={13} className="text-muted-foreground" />}
              <span className="text-[13px] text-muted-foreground">{ev.kind === 'enriched' ? 'Fiche enrichie' : 'Contact ajouté'}</span>
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">{relativeFR(ev.at)}</span>
            </div>
          );
        }
        const n = ev.note;
        const mine = n.author_id === user?.id;
        const mentions = mentionsByNote.get(n.id) ?? [];
        const editing = editingId === n.id;
        return (
          <div key={n.id} className="group border-b py-3 last:border-0">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              {n.is_private && <Lock size={11} className="text-[hsl(var(--h-amber-500))]" aria-label="Note privée" />}
              {isShared && <span>{mine ? 'Vous' : 'Un membre du cercle'}</span>}
              <span className="ml-auto tabular-nums">{relativeFR(n.created_at)}</span>
              {mine && !editing && (
                <span className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button className="grid size-6 place-items-center rounded hover:bg-muted hover:text-foreground" title="Modifier" onClick={() => { setEditingId(n.id); setDraft(n.content); }}><Pencil size={12} /></button>
                  <button className="grid size-6 place-items-center rounded hover:bg-muted hover:text-destructive" title="Supprimer" onClick={() => deleteNote(n)}><Trash2 size={12} /></button>
                </span>
              )}
            </div>
            {editing ? (
              <div className="flex flex-col gap-2">
                <textarea value={draft} rows={3} onChange={(e) => setDraft(e.target.value)}
                  className="w-full resize-y rounded-lg border bg-card px-3 py-2 text-[13.5px] outline-none focus:border-foreground/25" />
                <div className="flex justify-end gap-2">
                  <button className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted" onClick={() => setEditingId(null)}>Annuler</button>
                  <button className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground" onClick={() => saveEdit(n)}>Enregistrer</button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{n.content}</p>
            )}
            {mentions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {mentions.map((m) => (
                  <button key={m.id} onClick={() => onOpenContact?.(m.id)}
                    className="inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                    <Avatar name={fullName(m)} firstName={m.first_name} lastName={m.last_name} photoUrl={m.photo_url} size={24} />
                    mentionne {m.first_name}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
