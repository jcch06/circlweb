import React, { useRef, useState } from 'react';
import { Lock, LockOpen, Check, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useData } from '../data';
import { useToast } from './Toast';
import { DiffLine } from './Bits';
import { cn } from '../lib/utils';

// Composer de note : le geste principal de la fiche. ⌘↵ envoie via
// structure-note ; les mises à jour et relances détectées apparaissent
// dessous, à valider.

const FIELD_LABELS: Record<string, string> = {
  company: 'Entreprise', job_title: 'Poste', industry: 'Secteur',
  location: 'Lieu', linkedin: 'LinkedIn', bio: 'Bio',
};

export const NoteComposer: React.FC<{
  contactId: string;
  contactFirstName?: string;
  onSaved?: () => void;
}> = ({ contactId, contactFirstName, onSaved }) => {
  const { refresh, user } = useData();
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [followUps, setFollowUps] = useState<any[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const autogrow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(220, ta.scrollHeight) + 'px';
  };

  const send = async () => {
    const trimmed = text.trim();
    if (trimmed.length < 3 || busy) return;
    setBusy(true);
    try {
      const res: any = await supabase.functions.invoke('structure-note', {
        body: { contact_id: contactId, transcript: trimmed, is_private: isPrivate },
      });
      if (res.error) throw res.error;
      const data = res.data ?? {};
      setText('');
      if (taRef.current) taRef.current.style.height = 'auto';
      setSuggestions(data.pending_updates ?? []);
      setFollowUps(data.follow_ups ?? []);
      toast('Note enregistrée.');
      await refresh(['notes', 'updates', 'followUps', 'links']);
      onSaved?.();
    } catch (err: any) {
      // L'analyse IA a échoué : la note est quand même enregistrée telle quelle,
      // sauf refus d'accès (fiche verrouillée), qui s'applique aussi à l'écriture.
      const status = err?.context?.status;
      const { error } = status === 401 || status === 403
        ? { error: err }
        : await supabase.from('notes').insert({ contact_id: contactId, author_id: user?.id, content: trimmed, is_private: isPrivate, context: 'professional' });
      if (error) {
        toast(`La note n'a pas pu être enregistrée : ${error.message ?? 'erreur réseau'}`);
      } else {
        setText('');
        if (taRef.current) taRef.current.style.height = 'auto';
        toast("Note enregistrée. L'analyse automatique n'a pas pu être faite.");
        await refresh(['notes', 'updates', 'followUps', 'links']);
        onSaved?.();
      }
    } finally {
      setBusy(false);
    }
  };

  const decide = async (u: any, confirm: boolean) => {
    setSuggestions((prev) => prev.filter((x) => x.id !== u.id));
    const { error } = await supabase.rpc(confirm ? 'confirm_contact_update' : 'dismiss_contact_update', { p_update_id: u.id });
    if (error) { toast(`Échec : ${error.message}`); setSuggestions((prev) => [...prev, u]); return; }
    if (confirm) await refresh(['notes', 'updates', 'followUps', 'links']);
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-2 rounded-xl border bg-card p-3 transition-colors focus-within:border-foreground/25">
        <textarea
          ref={taRef}
          value={text}
          rows={2}
          placeholder={`Noter quelque chose sur ${contactFirstName ?? 'ce contact'}…`}
          onChange={(e) => { setText(e.target.value); autogrow(); }}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); } }}
          className="min-h-[42px] resize-none bg-transparent text-[13.5px] leading-relaxed outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPrivate((p) => !p)}
            title={isPrivate ? 'Note privée : visible par vous seul, jamais partagée.' : 'Note visible par les membres du cercle.'}
            className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
              isPrivate ? 'border-[hsl(var(--h-amber-500))] text-[hsl(var(--h-amber-500))]' : 'text-muted-foreground hover:bg-muted')}
          >
            {isPrivate ? <Lock size={12} /> : <LockOpen size={12} />}
            {isPrivate ? 'Privée' : 'Visible du cercle'}
          </button>
          <span className="flex-1" />
          <span className="hidden text-[11px] text-muted-foreground sm:inline">⌘↵</span>
          <button
            disabled={text.trim().length < 3 || busy}
            onClick={send}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-30"
          >
            {busy ? 'Analyse…' : 'Noter'}
          </button>
        </div>
      </div>

      {suggestions.length > 0 && (
        <div className="rounded-xl border bg-muted/40 p-3">
          <div className="mb-2 text-xs font-semibold">Mises à jour détectées</div>
          <div className="flex flex-col gap-2">
            {suggestions.map((u) => (
              <div key={u.id} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <DiffLine field={FIELD_LABELS[u.field] ?? u.field ?? 'Champ'} oldValue={u.old_value} newValue={u.new_value ?? ''} />
                  {u.summary && <div className="mt-0.5 text-xs text-muted-foreground">{u.summary}</div>}
                </div>
                <button className="grid size-7 place-items-center rounded-md border text-muted-foreground hover:bg-secondary" title="Écarter" onClick={() => decide(u, false)}><X size={14} /></button>
                <button className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground" title="Appliquer" onClick={() => decide(u, true)}><Check size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {followUps.length > 0 && (
        <div className="rounded-xl border bg-muted/40 p-3">
          <div className="mb-1.5 text-xs font-semibold">{followUps.length > 1 ? 'Relances créées' : 'Relance créée'}</div>
          {followUps.map((f: any) => (
            <div key={f.id} className="text-[13px] text-muted-foreground">{f.label} · <span className="tabular-nums">{f.due_date}</span></div>
          ))}
        </div>
      )}
    </div>
  );
};
