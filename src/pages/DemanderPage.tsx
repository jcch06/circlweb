import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Sparkles } from 'lucide-react';
import { useData } from '../data';
import { Avatar } from '../ui/Bits';
import { ContactDrawer } from '../ui/ContactDrawer';
import { fullName } from '../ui/format';
import { askNetwork } from '../lib/askNetwork';
import { supabase } from '../lib/supabase';
import { IS_MOCK } from '../lib/mode';

// Demander : parler à son réseau. « Trouve-moi tous mes contacts dans les
// affaires publiques. » La réponse cite des fiches cliquables.

const SUGGESTIONS = [
  'Qui travaille dans les affaires publiques ?',
  'Qui pourrait m\'aider à lever des fonds ?',
  'Qui n\'ai-je pas relancé depuis longtemps ?',
  'Qui est dans la tech à Paris ?',
];

type Msg = { role: 'user' | 'assistant'; text: string; ids?: string[]; why?: Record<string, string> };

export const DemanderPage: React.FC = () => {
  const data = useData();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', text: q }]);
    setBusy(true);
    if (IS_MOCK) {
      await new Promise((r) => setTimeout(r, 350));
      const res = askNetwork(q, {
        contacts: data.contacts, notesByContact: data.notesByContact,
        tagsByContact: data.tagsByContact, lastNoteByContact: data.lastNoteByContact,
      });
      setMsgs((m) => [...m, { role: 'assistant', text: res.response, ids: res.contact_ids }]);
      setBusy(false);
      return;
    }
    // IA réelle : ask-network lit vos fiches sous votre session (masquage respecté).
    const history = msgs.map(({ role, text, ids }) => ({ role, text, ids }));
    const res: any = await supabase.functions.invoke('ask-network', { body: { question: q, space_id: data.selectedSpaceId, history } });
    let text: string;
    let ids: string[] = [];
    const why: Record<string, string> = {};
    if (res.error) {
      let msg = res.error.message ?? 'erreur';
      try { const body = await res.error.context?.json?.(); if (body?.error) msg = body.error; } catch { /* corps illisible */ }
      text = `Je n'ai pas pu interroger votre réseau : ${msg}`;
    } else {
      text = res.data?.response || 'Aucune réponse.';
      for (const c of res.data?.contacts ?? []) { ids.push(c.id); why[c.id] = c.why; }
    }
    setMsgs((m) => [...m, { role: 'assistant', text, ids, why }]);
    setBusy(false);
  };

  const composer = (
    <form onSubmit={(e) => { e.preventDefault(); ask(input); }}
      className="flex items-end gap-2 rounded-2xl border bg-card p-2 pl-4 focus-within:border-foreground/25">
      <textarea
        rows={1} value={input} onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input); } }}
        placeholder="Demandez quelque chose à votre réseau…"
        className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[14px] outline-none placeholder:text-muted-foreground"
      />
      <button type="submit" disabled={!input.trim() || busy} title="Envoyer"
        className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-30">
        <ArrowUp size={16} />
      </button>
    </form>
  );

  if (msgs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6">
        <div className="w-full max-w-2xl">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 grid size-10 place-items-center rounded-xl bg-secondary"><Sparkles size={18} /></div>
            <h2 className="text-[20px] font-semibold tracking-tight">Demandez à votre réseau</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">Circl cherche dans vos {data.contacts.length.toLocaleString('fr-FR')} contacts, leurs notes et leurs parcours.</p>
          </div>
          {composer}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => ask(s)}
                className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">{s}</button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-8">
          {msgs.map((m, i) => m.role === 'user' ? (
            <div key={i} className="self-end rounded-2xl bg-secondary px-4 py-2.5 text-[14px]">{m.text}</div>
          ) : (
            <div key={i}>
              <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{m.text}</p>
              {m.ids && m.ids.length > 0 && (
                <div className="mt-3 overflow-hidden rounded-xl border">
                  {m.ids.map((id) => {
                    const c = data.contactById.get(id);
                    if (!c) return null;
                    return (
                      <button key={id} onClick={() => setDrawerId(id)}
                        className="flex w-full items-center gap-3 border-b px-3.5 py-2.5 text-left last:border-0 hover:bg-muted">
                        <Avatar name={fullName(c)} firstName={c.first_name} lastName={c.last_name} photoUrl={c.photo_url} size={32} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{fullName(c)}</span>
                          <span className="block truncate text-xs text-muted-foreground">{[c.job_title, c.company].filter(Boolean).join(' · ')}</span>
                          {m.why?.[id] && <span className="mt-0.5 block text-xs leading-snug text-foreground/80">{m.why[id]}</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="text-[13px] text-muted-foreground">Recherche dans votre réseau…</div>}
          <div ref={endRef} />
        </div>
      </div>
      <div className="mx-auto w-full max-w-2xl px-6 pb-6">{composer}</div>

      {drawerId && (
        <ContactDrawer contactId={drawerId} onClose={() => setDrawerId(null)} onNavigate={(id) => setDrawerId(id)} />
      )}
    </div>
  );
};
