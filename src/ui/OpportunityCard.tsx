import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Copy, Mail, Clock, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useData } from '../data';
import { useToast } from './Toast';
import { Avatar, AICard } from './Bits';
import { fullName } from './format';

// Composant 9 : carte opportunité. 120 px repliée, jauge de confiance à
// 5 crans (jamais de %), trois issues : envoyer l'intro (brouillon
// éditable), planifier (écrit une relance), pas pertinent (définitif).

export interface Intro {
  id?: string;
  from_contact_id: string;
  to_contact_id: string;
  rationale: string;
  confidence?: number | null;
}

const ConfidenceGauge: React.FC<{ value?: number | null }> = ({ value }) => {
  const filled = Math.max(1, Math.min(5, Math.round((value ?? 0.6) * 5)));
  return (
    <span title="Confiance de l'analyse" style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          style={{
            width: 4, height: 10, borderRadius: 2,
            background: i <= filled ? 'var(--accent)' : 'var(--line-strong)',
          }}
        />
      ))}
    </span>
  );
};

export const OpportunityCard: React.FC<{
  intro: Intro;
  onResolved: () => void;
}> = ({ intro, onResolved }) => {
  const data = useData();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [draftOpen, setDraftOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const from = data.contactById.get(intro.from_contact_id);
  const to = data.contactById.get(intro.to_contact_id);
  if (!from || !to) return null;

  const defaultDraft =
    `Bonjour ${from.first_name},\n\n` +
    `Je pense que tu devrais rencontrer ${fullName(to)}` +
    `${to.job_title ? `, ${to.job_title}` : ''}${to.company ? ` chez ${to.company}` : ''}.\n\n` +
    `${intro.rationale}\n\n` +
    `Je vous mets en copie si vous êtes partants tous les deux.\n\nBien à toi`;
  const [draft, setDraft] = useState(defaultDraft);

  const persist = async (status: 'sent' | 'snoozed' | 'dismissed', snoozedUntil?: string) => {
    setBusy(true);
    const row = {
      space_id: from.space_id,
      user_id: data.user?.id,
      from_contact_id: intro.from_contact_id,
      to_contact_id: intro.to_contact_id,
      rationale: intro.rationale,
      confidence: intro.confidence ?? null,
      status,
      snoozed_until: snoozedUntil ?? null,
      resolved_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('intro_suggestions')
      .upsert(row, { onConflict: 'user_id,from_contact_id,to_contact_id' });
    setBusy(false);
    if (error) { toast(`Échec : ${error.message}`); return false; }
    return true;
  };

  const send = async () => {
    const subject = `${to.first_name} ↔ ${from.first_name}`;
    const ok = await persist('sent');
    if (!ok) return;
    setDraftOpen(false);
    toast('Intro marquée comme envoyée.', from.email ? {
      label: 'Ouvrir mon mail',
      onClick: () => {
        window.location.href = `mailto:${from.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(draft)}`;
      },
    } : undefined);
    onResolved();
  };

  const snooze = async (days: number) => {
    const due = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const ok = await persist('snoozed', due);
    if (!ok) return;
    // Une intro planifiée devient une vraie relance dans la boucle du matin.
    await supabase.from('follow_ups').insert({
      space_id: from.space_id,
      contact_id: from.id,
      user_id: data.user?.id,
      due_date: due,
      label: `Présenter ${fullName(to)} à ${from.first_name}`,
    });
    setSnoozeOpen(false);
    toast(`Relance posée au ${new Date(due).toLocaleDateString('fr-FR')}.`);
    await data.refresh();
    onResolved();
  };

  const dismiss = async () => {
    const ok = await persist('dismissed');
    if (!ok) return;
    toast('Opportunité écartée. Elle ne reviendra plus.');
    onResolved();
  };

  return (
    <AICard>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <Avatar name={fullName(from)} firstName={from.first_name} lastName={from.last_name} photoUrl={from.photo_url} size={32} />
        <button
          className="t-name"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', padding: 0 }}
          onClick={() => navigate(`/contacts/${from.id}`)}
        >
          {fullName(from)}
        </button>
        <ArrowRight size={14} color="var(--mut)" />
        <Avatar name={fullName(to)} firstName={to.first_name} lastName={to.last_name} photoUrl={to.photo_url} size={32} />
        <button
          className="t-name"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', padding: 0 }}
          onClick={() => navigate(`/contacts/${to.id}`)}
        >
          {fullName(to)}
        </button>
        <span style={{ flex: 1 }} />
        <ConfidenceGauge value={intro.confidence} />
      </div>

      <p className="t-sec" style={{ color: 'var(--ink-2)', lineHeight: '20px' }}>
        {intro.rationale?.length > 140 && !draftOpen ? `${intro.rationale.slice(0, 140)}…` : intro.rationale}
      </p>

      {draftOpen && (
        <div style={{ marginTop: 12 }}>
          <textarea
            className="input"
            style={{ minHeight: 150, resize: 'vertical', fontSize: 13.5, background: 'var(--card)' }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              className="btn btn-ghost"
              style={{ padding: '6px 11px' }}
              onClick={() => { navigator.clipboard.writeText(draft); toast('Brouillon copié.'); }}
            >
              <Copy size={13} /> Copier
            </button>
            <span style={{ flex: 1 }} />
            <button className="btn btn-quiet" style={{ padding: '6px 11px' }} onClick={() => setDraftOpen(false)}>
              Fermer
            </button>
            <button className="btn btn-primary" style={{ padding: '6px 11px' }} disabled={busy} onClick={send}>
              <Mail size={13} /> {from.email ? 'Envoyer l’intro' : 'Marquer comme envoyée'}
            </button>
          </div>
        </div>
      )}

      {!draftOpen && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, position: 'relative' }}>
          <button className="btn btn-primary" style={{ padding: '6px 11px' }} onClick={() => setDraftOpen(true)}>
            Envoyer l'intro
          </button>
          <div style={{ position: 'relative' }}>
            <button className="btn btn-ghost" style={{ padding: '6px 11px' }} onClick={() => setSnoozeOpen((o) => !o)}>
              <Clock size={13} /> Planifier
            </button>
            {snoozeOpen && (
              <div className="popover" style={{ bottom: 'calc(100% + 6px)', left: 0, padding: 6, minWidth: 160 }}>
                <button className="nav-item" onClick={() => snooze(7)}>Dans 1 semaine</button>
                <button className="nav-item" onClick={() => snooze(30)}>Dans 1 mois</button>
              </div>
            )}
          </div>
          <span style={{ flex: 1 }} />
          <button className="btn btn-quiet" style={{ padding: '6px 11px' }} disabled={busy} onClick={dismiss}>
            <X size={13} /> Pas pertinent
          </button>
        </div>
      )}
    </AICard>
  );
};
