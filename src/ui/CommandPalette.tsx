import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, Users, Bell, BookOpen, Lightbulb, Layers, Plus, Network, MessageCircleQuestion } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useData } from '../data';
import { Avatar } from './Bits';
import { fullName, circleColor } from './format';

// Composant 13 : palette de commandes. Cmd+K, 560 px, résultats 44 px.
// Trois modes : texte libre = recherche (contacts, notes, cercles),
// « > » = commandes, « ? » = question au réseau (absorbe l'ancien chat).
// La palette accélère, elle ne remplace jamais un bouton visible.

const COMMANDS = [
  { label: 'Aller à l’Accueil', to: '/accueil', icon: Home, kbd: '' },
  { label: 'Aller aux Contacts', to: '/contacts', icon: Users, kbd: '' },
  { label: 'Voir le Réseau', to: '/reseau', icon: Network, kbd: '' },
  { label: 'Aller aux Mises à jour', to: '/mises-a-jour', icon: Bell, kbd: '' },
  { label: 'Aller au Journal', to: '/journal', icon: BookOpen, kbd: '' },
  { label: 'Aller aux Opportunités', to: '/opportunites', icon: Lightbulb, kbd: '' },
  { label: 'Aller aux Cercles', to: '/cercles', icon: Layers, kbd: '' },
  { label: 'Capturer une note', to: '/capture', icon: Plus, kbd: 'C' },
];

export const CommandPalette: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const data = useData();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [cursor, setCursor] = useState(0);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<{ text: string; contactIds: string[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setInput('');
      setAnswer(null);
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const mode: 'search' | 'command' | 'ask' =
    input.startsWith('>') ? 'command' : input.startsWith('?') ? 'ask' : 'search';
  const q = input.replace(/^[>?]\s*/, '').trim().toLowerCase();

  const results = useMemo(() => {
    if (mode === 'command') {
      return COMMANDS
        .filter((c) => !q || c.label.toLowerCase().includes(q))
        .map((c) => ({ kind: 'command' as const, ...c }));
    }
    if (mode === 'ask') return [];
    if (q.length < 2) return [];
    const contacts = data.contacts
      .filter((c) => fullName(c).toLowerCase().includes(q) || (c.company ?? '').toLowerCase().includes(q))
      .slice(0, 5)
      .map((c) => ({ kind: 'contact' as const, c }));
    const notes = data.notes
      .filter((n) => n.content?.toLowerCase().includes(q))
      .slice(0, 3)
      .map((n) => ({ kind: 'note' as const, n, c: data.contactById.get(n.contact_id) }))
      .filter((x) => x.c);
    const circles = data.spaces
      .filter((s) => s.name.toLowerCase().includes(q))
      .slice(0, 2)
      .map((s) => ({ kind: 'circle' as const, s }));
    return [...contacts, ...notes, ...circles];
  }, [mode, q, data.contacts, data.notes, data.spaces, data.contactById]);

  const run = (r: any) => {
    if (r.kind === 'command') navigate(r.to);
    if (r.kind === 'contact') navigate(`/contacts/${r.c.id}`);
    if (r.kind === 'note') navigate(`/contacts/${r.c.id}`);
    if (r.kind === 'circle') { data.setSelectedSpaceId(r.s.id); navigate('/contacts'); }
    onClose();
  };

  const ask = async () => {
    const question = input.replace(/^\?\s*/, '').trim();
    if (question.length < 3 || asking) return;
    setAsking(true);
    setAnswer(null);
    try {
      const spaceId = data.selectedSpaceId ?? data.spaces.find((s) => s.type === 'personal')?.id;
      const res: any = await supabase.functions.invoke('chat-contacts', {
        body: { message: question, space_id: spaceId },
      });
      if (res.error) throw res.error;
      setAnswer({ text: res.data?.response ?? 'Pas de réponse.', contactIds: res.data?.contact_ids ?? [] });
    } catch (err: any) {
      setAnswer({ text: `La question n'a pas abouti : ${err.message ?? 'erreur'}`, contactIds: [] });
    } finally {
      setAsking(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(results.length - 1, c + 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (mode === 'ask') ask();
        else if (results[cursor]) run(results[cursor]);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  if (!open) return null;

  return (
    <div className="modal-scrim" style={{ alignItems: 'flex-start', display: 'flex', justifyContent: 'center', paddingTop: '14vh' }} onClick={onClose}>
      <div
        className="modal"
        style={{ width: 560, padding: 0, overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => { setInput(e.target.value); setCursor(0); setAnswer(null); }}
          placeholder="Rechercher…  ·  > commande  ·  ? question au réseau"
          style={{
            width: '100%', border: 'none', outline: 'none', padding: '16px 18px',
            fontSize: 15, background: 'var(--card)', color: 'var(--ink)',
            borderBottom: '1px solid var(--line)',
          }}
        />

        <div style={{ maxHeight: 380, overflowY: 'auto', padding: results.length > 0 || mode === 'ask' ? 6 : 0 }}>
          {mode === 'ask' && (
            <div style={{ padding: '10px 12px' }}>
              {!answer && (
                <div className="t-sec" style={{ color: 'var(--mut)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <MessageCircleQuestion size={15} />
                  {asking ? 'Le réseau réfléchit…' : 'Entrée pour poser la question à votre réseau.'}
                </div>
              )}
              {answer && (
                <div className="ai-card" style={{ borderRadius: 12 }}>
                  <div className="t-sec" style={{ color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>{answer.text}</div>
                  {answer.contactIds.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                      {answer.contactIds.map((id) => {
                        const c = data.contactById.get(id);
                        if (!c) return null;
                        return (
                          <button key={id} className="chip clickable" onClick={() => { navigate(`/contacts/${id}`); onClose(); }}>
                            <Avatar name={fullName(c)} firstName={c.first_name} lastName={c.last_name} photoUrl={c.photo_url} size={24} />
                            <span style={{ marginLeft: 2 }}>{fullName(c)}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {results.map((r: any, i) => (
            <button
              key={i}
              className="nav-item"
              style={{ minHeight: 44, background: i === cursor ? 'var(--accent-soft)' : undefined }}
              onMouseEnter={() => setCursor(i)}
              onClick={() => run(r)}
            >
              {r.kind === 'command' && <r.icon size={16} color="var(--mut)" />}
              {r.kind === 'contact' && (
                <Avatar name={fullName(r.c)} firstName={r.c.first_name} lastName={r.c.last_name} photoUrl={r.c.photo_url} size={24} />
              )}
              {r.kind === 'note' && (
                <Avatar name={fullName(r.c)} firstName={r.c.first_name} lastName={r.c.last_name} photoUrl={r.c.photo_url} size={24} />
              )}
              {r.kind === 'circle' && (
                <span style={{ width: 10, height: 10, borderRadius: 999, background: circleColor(r.s), flex: 'none' }} />
              )}
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
                {r.kind === 'command' && r.label}
                {r.kind === 'contact' && fullName(r.c)}
                {r.kind === 'note' && (
                  <>
                    <span style={{ fontWeight: 500 }}>{fullName(r.c)}</span>
                    <span style={{ color: 'var(--mut)' }}> · {r.n.content.slice(0, 60)}</span>
                  </>
                )}
                {r.kind === 'circle' && <>Cercle : {r.s.name}</>}
              </span>
              {r.kind === 'command' && r.kbd && <span className="t-meta" style={{ color: 'var(--faint)' }}>{r.kbd}</span>}
            </button>
          ))}

          {mode === 'search' && q.length >= 2 && results.length === 0 && (
            <div className="t-sec" style={{ color: 'var(--mut)', padding: '14px 16px' }}>
              Rien trouvé. Essayez « &gt; » pour les commandes ou « ? » pour interroger le réseau.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
