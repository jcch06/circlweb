import React, { useRef, useState } from 'react';
import { Lock, LockOpen, CornerDownLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useData } from '../data';
import { useToast } from './Toast';
import { AICard, DecisionPair, DiffLine } from './Bits';

// Composant 11 : composer de note. Textarea qui s'étend, toggle privée,
// Cmd+Entrée envoie via structure-note. Les suggestions retournées
// (mises à jour, relances) apparaissent dessous en cartes IA à valider.

const FIELD_LABELS: Record<string, string> = {
  company: 'Entreprise',
  job_title: 'Poste',
  industry: 'Secteur',
  location: 'Lieu',
  linkedin: 'LinkedIn',
  bio: 'Bio',
};

export const NoteComposer: React.FC<{
  contactId: string;
  contactFirstName?: string;
  onSaved?: () => void;
}> = ({ contactId, contactFirstName, onSaved }) => {
  const { refresh } = useData();
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
    ta.style.height = Math.min(200, ta.scrollHeight) + 'px';
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
      setSuggestions(data.pending_updates ?? []);
      setFollowUps(data.follow_ups ?? []);
      toast('Note enregistrée.');
      await refresh();
      onSaved?.();
    } catch (err: any) {
      toast(`La note n'a pas pu être enregistrée : ${err.message ?? 'erreur réseau'}`);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (u: any, confirm: boolean) => {
    setSuggestions((prev) => prev.filter((x) => x.id !== u.id));
    const { error } = await supabase.rpc(
      confirm ? 'confirm_contact_update' : 'dismiss_contact_update',
      { p_update_id: u.id }
    );
    if (error) {
      toast(`Échec : ${error.message}`);
      setSuggestions((prev) => [...prev, u]);
      return;
    }
    if (confirm) await refresh();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        className="card"
        style={{ borderRadius: 'var(--r-el)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <textarea
          ref={taRef}
          value={text}
          rows={1}
          placeholder={`Noter quelque chose sur ${contactFirstName ?? 'ce contact'}…`}
          onChange={(e) => { setText(e.target.value); autogrow(); }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
          }}
          style={{
            border: 'none', outline: 'none', resize: 'none', background: 'none',
            fontSize: 14, lineHeight: '21px', color: 'var(--ink)', minHeight: 21,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className={`chip clickable${isPrivate ? '' : ''}`}
            onClick={() => setIsPrivate((p) => !p)}
            style={isPrivate ? { borderColor: 'var(--orange)', color: 'var(--orange)' } : undefined}
            title={isPrivate
              ? 'Note privée : visible par vous seul, jamais partagée ni utilisée dans la mémoire commune.'
              : 'Note visible par les membres du cercle.'}
          >
            {isPrivate ? <Lock size={12} /> : <LockOpen size={12} />}
            {isPrivate ? 'Privée' : 'Cercle'}
          </button>
          {isPrivate && (
            <span className="t-meta" style={{ color: 'var(--mut)' }}>
              Visible par vous seul, exclue de la mémoire partagée.
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button
            className="btn btn-primary"
            style={{ padding: '6px 12px' }}
            disabled={text.trim().length < 3 || busy}
            onClick={send}
          >
            {busy ? 'Analyse…' : <>Noter <CornerDownLeft size={13} /></>}
          </button>
        </div>
      </div>

      {suggestions.length > 0 && (
        <AICard>
          <div className="t-label" style={{ marginBottom: 10 }}>Mises à jour suggérées</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {suggestions.map((u) => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <DiffLine
                    field={FIELD_LABELS[u.field] ?? u.field ?? 'Champ'}
                    oldValue={u.old_value}
                    newValue={u.new_value ?? ''}
                  />
                  {u.summary && (
                    <div className="t-meta" style={{ color: 'var(--mut)', marginTop: 2 }}>{u.summary}</div>
                  )}
                </div>
                <DecisionPair onNo={() => decide(u, false)} onYes={() => decide(u, true)} />
              </div>
            ))}
          </div>
        </AICard>
      )}

      {followUps.length > 0 && (
        <AICard>
          <div className="t-label" style={{ marginBottom: 8 }}>
            {followUps.length > 1 ? 'Relances créées' : 'Relance créée'}
          </div>
          {followUps.map((f: any) => (
            <div key={f.id} className="t-sec" style={{ color: 'var(--ink-2)' }}>
              {f.label} · <span className="tnum">{f.due_date}</span>
            </div>
          ))}
        </AICard>
      )}
    </div>
  );
};
