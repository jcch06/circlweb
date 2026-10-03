import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../data';
import { supabase } from '../lib/supabase';
import { IS_MOCK } from '../lib/mode';
import { fullName, relativeFR } from './format';

// Suivi des introductions envoyées : réponse reçue, intro faite, sans suite.
// Une intro envoyée devient une relance à J+7 si rien ne bouge.
type Row = { id: string; from_contact_id: string; to_contact_id: string; status: string; sent_at: string | null; resolved_at: string | null; replied_at: string | null; done_at: string | null };
const OPEN = ['sent', 'replied'];
const LABEL: Record<string, string> = { sent: 'Envoyée', replied: 'Réponse reçue', done: 'Intro faite', no_reply: 'Sans suite' };

export const IntroTracker: React.FC<{ reloadKey?: number }> = ({ reloadKey }) => {
  const data = useData();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (IS_MOCK) return;
    supabase.from('intro_suggestions').select('id, from_contact_id, to_contact_id, status, sent_at, resolved_at, replied_at, done_at')
      .in('status', ['sent', 'replied', 'done', 'no_reply']).order('resolved_at', { ascending: false }).limit(500)
      .then(({ data: r }) => setRows((r ?? []) as Row[]));
  }, [reloadKey]);

  const open = useMemo(() => rows.filter((r) => OPEN.includes(r.status)), [rows]);
  const stats = useMemo(() => ({
    sent: rows.length,
    replied: rows.filter((r) => r.status === 'replied' || r.status === 'done').length,
    done: rows.filter((r) => r.status === 'done').length,
  }), [rows]);

  const move = async (r: Row, status: 'replied' | 'done' | 'no_reply') => {
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status, resolved_at: now };
    if (status === 'replied') patch.replied_at = now;
    if (status === 'done') { patch.done_at = now; patch.replied_at = r.replied_at ?? now; }
    setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, ...patch } as Row : x)));
    const { error: e } = await supabase.from('intro_suggestions').update(patch).eq('id', r.id);
    if (e) setError(`Mise à jour impossible : ${e.message}`);
  };

  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Intros en cours</h2>
        <p className="text-xs tabular-nums text-muted-foreground">
          {stats.sent} envoyée{stats.sent > 1 ? 's' : ''} · {stats.replied} avec réponse · {stats.done} faite{stats.done > 1 ? 's' : ''}
        </p>
      </div>
      {open.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Aucune intro en attente de réponse.</p>
      ) : (
        <ul className="divide-y">
          {open.map((r) => {
            const a = data.contactById.get(r.from_contact_id), b = data.contactById.get(r.to_contact_id);
            if (!a || !b) return null;
            return (
              <li key={r.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1 text-[13px]">
                  <button className="font-medium hover:underline" onClick={() => navigate(`/contacts/${a.id}`)}>{fullName(a)}</button>
                  <span className="text-muted-foreground"> ↔ </span>
                  <button className="font-medium hover:underline" onClick={() => navigate(`/contacts/${b.id}`)}>{fullName(b)}</button>
                  <span className="block text-xs text-muted-foreground">{LABEL[r.status]} {relativeFR(r.replied_at ?? r.sent_at ?? r.resolved_at)}</span>
                </div>
                <div className="flex shrink-0 gap-1">
                  {r.status === 'sent' && <button onClick={() => move(r, 'replied')} className="rounded-md border px-2.5 py-1 text-xs hover:bg-muted">Réponse reçue</button>}
                  <button onClick={() => move(r, 'done')} className="rounded-md border px-2.5 py-1 text-xs hover:bg-muted">Intro faite</button>
                  <button onClick={() => move(r, 'no_reply')} className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">Sans suite</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </section>
  );
};
