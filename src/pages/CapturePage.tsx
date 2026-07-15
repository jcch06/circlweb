import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Lock, LockOpen, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useData } from '../data';
import { useToast } from '../ui/Toast';
import { Avatar, AICard, SectionLabel } from '../ui/Bits';
import { fullName, dayFR } from '../ui/format';

// Capture (brief 4.5) : le renversement. Zéro écriture en base avant le
// clic final. L'écran prévisualise, fait corriger, puis commite en un coup.
// État 1 : saisie. État 2 : revue en cartes IA éditables.

const FIELD_LABELS: Record<string, string> = {
  company: 'Entreprise', job_title: 'Poste', industry: 'Secteur',
  location: 'Lieu', linkedin: 'LinkedIn', bio: 'Bio',
};

const DRAFT_KEY = 'circl_capture_draft';

const EXAMPLES = [
  "J'ai déjeuné avec {nom}. Il quitte son poste pour monter une boîte dans la santé. Le relancer en octobre pour voir où il en est.",
  "Call avec {nom} : très intéressée par le projet, elle connaît deux investisseurs à nous présenter. Lui envoyer le deck cette semaine.",
  "{nom} déménage à Lyon le mois prochain et cherche un associé technique.",
];

interface Preview {
  clean_note: string;
  context: string;
  suggested_tags: string[];
  field_updates: { field: string; old_value: string | null; new_value: string; summary: string | null; confidence: number | null }[];
  follow_ups: { label: string; date: string }[];
  updated_memory: string;
  mentioned_names: string[];
}

export const CapturePage: React.FC = () => {
  const data = useData();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [text, setText] = useState(() => localStorage.getItem(DRAFT_KEY) ?? '');
  const [isPrivate, setIsPrivate] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [targetQuery, setTargetQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [committing, setCommitting] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);

  /* État de revue éditable */
  const [note, setNote] = useState('');
  const [checkedUpdates, setCheckedUpdates] = useState<Set<number>>(new Set());
  const [editedValues, setEditedValues] = useState<Record<number, string>>({});
  const [followUps, setFollowUps] = useState<{ label: string; date: string; kept: boolean }[]>([]);

  useEffect(() => { localStorage.setItem(DRAFT_KEY, text); }, [text]);

  const target = targetId ? data.contactById.get(targetId) : null;

  const matches = useMemo(() => {
    const q = targetQuery.trim().toLowerCase();
    if (q.length < 1) return [];
    return data.contacts.filter((c) => fullName(c).toLowerCase().includes(q)).slice(0, 6);
  }, [targetQuery, data.contacts]);

  const analyze = async () => {
    if (!targetId || text.trim().length < 3 || busy) return;
    setBusy(true);
    try {
      const res: any = await supabase.functions.invoke('structure-note', {
        body: { contact_id: targetId, transcript: text.trim(), is_private: isPrivate, dry_run: true },
      });
      if (res.error) throw res.error;
      const p: Preview = res.data?.preview;
      if (!p) throw new Error('réponse vide (la fonction structure-note doit être redéployée)');
      setPreview(p);
      setNote(p.clean_note);
      // Décochées sous 0,60 (brief 4.0.7), cochées sinon.
      setCheckedUpdates(new Set(p.field_updates.map((u, i) => ((u.confidence ?? 1) >= 0.6 ? i : -1)).filter((i) => i >= 0)));
      setEditedValues({});
      setFollowUps(p.follow_ups.map((f) => ({ ...f, kept: true })));
    } catch (err: any) {
      toast(`Analyse impossible : ${err.message ?? 'erreur'}`);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview || !targetId || committing) return;
    setCommitting(true);
    try {
      const payload = {
        clean_note: note.trim(),
        context: preview.context,
        field_updates: preview.field_updates
          .filter((_, i) => checkedUpdates.has(i))
          .map((u, i) => ({
            field: u.field,
            new_value: (editedValues[i] ?? u.new_value).trim(),
            summary: u.summary ?? undefined,
            confidence: u.confidence ?? undefined,
          })),
        follow_ups: followUps.filter((f) => f.kept && f.label && f.date).map((f) => ({ label: f.label, date: f.date })),
        updated_memory: preview.updated_memory,
        mentioned_names: preview.mentioned_names,
      };
      const res: any = await supabase.functions.invoke('structure-note', {
        body: { contact_id: targetId, is_private: isPrivate, commit: payload },
      });
      if (res.error) throw res.error;
      localStorage.removeItem(DRAFT_KEY);
      setText('');
      setPreview(null);
      toast('Enregistré.', {
        label: `Voir ${target?.first_name ?? 'la fiche'}`,
        onClick: () => navigate(`/contacts/${targetId}`),
      });
      await data.refresh();
    } catch (err: any) {
      toast(`Enregistrement impossible : ${err.message ?? 'erreur'}`);
    } finally {
      setCommitting(false);
    }
  };

  const nbUpdates = preview ? [...checkedUpdates].length : 0;
  const nbFollowUps = followUps.filter((f) => f.kept).length;

  /* ------------------- État 1 : saisie ------------------- */
  if (!preview) {
    return (
      <div style={{ height: '100%', overflowY: 'auto' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 20px 60px' }}>
          <h1 className="t-page" style={{ marginBottom: 4 }}>Capturer</h1>
          <p className="t-sec" style={{ color: 'var(--mut)', marginBottom: 20 }}>
            Collez ou écrivez n'importe quoi : compte-rendu de rendez-vous, notes de réunion, mail.
            Rien n'est enregistré avant votre validation.
          </p>

          {/* Contact cible */}
          <div style={{ marginBottom: 14 }}>
            <SectionLabel>Sur qui porte cette note ?</SectionLabel>
            {target ? (
              <button className="chip clickable chip-filter on" onClick={() => { setTargetId(null); setTargetQuery(''); }}>
                <Avatar name={fullName(target)} firstName={target.first_name} lastName={target.last_name} photoUrl={target.photo_url} size={24} />
                {fullName(target)} ✕
              </button>
            ) : (
              <div style={{ position: 'relative' }}>
                <input
                  className="input"
                  placeholder="Chercher un contact…"
                  value={targetQuery}
                  onChange={(e) => setTargetQuery(e.target.value)}
                />
                {matches.length > 0 && (
                  <div className="popover" style={{ top: 'calc(100% + 4px)', left: 0, right: 0, padding: 4, position: 'absolute' }}>
                    {matches.map((c) => (
                      <button key={c.id} className="nav-item" onClick={() => { setTargetId(c.id); setTargetQuery(''); }}>
                        <Avatar name={fullName(c)} firstName={c.first_name} lastName={c.last_name} photoUrl={c.photo_url} size={24} />
                        <span style={{ flex: 1 }}>{fullName(c)}</span>
                        <span className="t-meta" style={{ color: 'var(--mut)' }}>{c.company ?? ''}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <textarea
            className="input"
            style={{ minHeight: 180, resize: 'vertical', fontSize: 14.5, lineHeight: '22px', marginBottom: 12 }}
            placeholder="Ex : J'ai déjeuné avec Bob. Il quitte FreeCode pour rejoindre PayFlow comme CTO. Le relancer en octobre."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') analyze(); }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
            <button
              className="chip clickable"
              onClick={() => setIsPrivate((p) => !p)}
              style={isPrivate ? { borderColor: 'var(--orange)', color: 'var(--orange)' } : undefined}
            >
              {isPrivate ? <Lock size={12} /> : <LockOpen size={12} />}
              {isPrivate ? 'Note privée' : 'Visible par le cercle'}
            </button>
            {isPrivate && (
              <span className="t-meta" style={{ color: 'var(--mut)' }}>
                Visible par vous seul, exclue de la mémoire partagée.
              </span>
            )}
            <span style={{ flex: 1 }} />
            <button className="btn btn-primary" disabled={!targetId || text.trim().length < 3 || busy} onClick={analyze}>
              <Sparkles size={14} /> {busy ? 'Analyse…' : 'Analyser (⌘⏎)'}
            </button>
          </div>

          {text.trim().length === 0 && (
            <div>
              <SectionLabel>Essayez avec un exemple</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {EXAMPLES.map((ex, i) => (
                  <button
                    key={i}
                    className="card"
                    style={{ padding: '10px 14px', textAlign: 'left', cursor: 'pointer', border: '1px dashed var(--line-strong)', background: 'var(--wash)', fontSize: 13, color: 'var(--ink-2)' }}
                    onClick={() => setText(ex.replace('{nom}', target?.first_name ?? 'Alex'))}
                  >
                    {ex.replace('{nom}', target?.first_name ?? 'Alex')}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ------------------- État 2 : revue ------------------- */
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <h1 className="t-page" style={{ marginBottom: 2 }}>Vérifiez avant d'enregistrer</h1>
            <p className="t-sec" style={{ color: 'var(--mut)' }}>
              Tout est éditable. Rien n'est écrit tant que vous n'avez pas validé.
            </p>
          </div>

          <AICard>
            <SectionLabel>Note · {target ? fullName(target) : ''} · {preview.context === 'personal' ? 'perso' : 'pro'}{isPrivate ? ' · privée' : ''}</SectionLabel>
            <textarea
              className="input"
              style={{ minHeight: 90, resize: 'vertical', fontSize: 14, background: 'var(--card)' }}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </AICard>

          {preview.field_updates.length > 0 && (
            <AICard>
              <SectionLabel>Mises à jour suggérées</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {preview.field_updates.map((u, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={checkedUpdates.has(i)}
                      onChange={() => setCheckedUpdates((prev) => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i); else next.add(i);
                        return next;
                      })}
                      style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                        <span className="t-label" style={{ fontSize: 11 }}>{FIELD_LABELS[u.field] ?? u.field}</span>
                        {u.old_value && <span className="t-sec diff-old">{u.old_value}</span>}
                        {u.old_value && <span style={{ color: 'var(--faint)' }}>→</span>}
                        <input
                          className="input"
                          style={{ width: 'auto', flex: 1, minWidth: 120, padding: '3px 8px', fontSize: 13, fontWeight: 500 }}
                          value={editedValues[i] ?? u.new_value}
                          onChange={(e) => setEditedValues((prev) => ({ ...prev, [i]: e.target.value }))}
                        />
                      </span>
                      {(u.confidence ?? 1) < 0.6 && (
                        <span className="t-meta" style={{ color: 'var(--amber)' }}>signal faible, décoché par défaut</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </AICard>
          )}

          {followUps.length > 0 && (
            <div className="card card-pad" style={{ borderColor: 'var(--orange)', background: 'var(--orange-soft)' }}>
              <SectionLabel style={{ color: 'var(--orange)' }}>Relances</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {followUps.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={f.kept}
                      onChange={() => setFollowUps((prev) => prev.map((x, j) => (j === i ? { ...x, kept: !x.kept } : x)))}
                      style={{ accentColor: 'var(--orange)', cursor: 'pointer' }}
                    />
                    <span className="t-sec" style={{ flex: 1 }}>{f.label}</span>
                    <input
                      type="date"
                      className="input"
                      style={{ width: 150, padding: '4px 8px', fontSize: 13 }}
                      value={f.date}
                      onChange={(e) => setFollowUps((prev) => prev.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {preview.mentioned_names.length > 0 && (
            <div>
              <SectionLabel>Personnes citées</SectionLabel>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {preview.mentioned_names.map((n) => {
                  const known = data.contacts.find((c) => fullName(c).toLowerCase() === n.toLowerCase());
                  return (
                    <span key={n} className="chip" style={known ? undefined : { borderStyle: 'dashed' }}>
                      {n}{known ? '' : ' (inconnu)'}
                    </span>
                  );
                })}
              </div>
              <div className="t-meta" style={{ color: 'var(--mut)', marginTop: 4 }}>
                Les personnes reconnues seront reliées à {target?.first_name} dans le réseau.
              </div>
            </div>
          )}

          {preview.updated_memory && !isPrivate && (
            <div>
              <button className="btn btn-quiet" style={{ padding: '4px 0', gap: 5 }} onClick={() => setMemoryOpen((o) => !o)}>
                {memoryOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="t-label" style={{ color: 'var(--mut)' }}>
                  La mémoire de {target?.first_name} sera mise à jour
                </span>
              </button>
              {memoryOpen && (
                <AICard style={{ marginTop: 8 }}>
                  <div className="t-sec" style={{ color: 'var(--ink-2)' }}>{preview.updated_memory}</div>
                </AICard>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Barre sticky : récapitulatif vivant + annuler + commit atomique */}
      <div style={{ borderTop: '1px solid var(--line)', background: 'var(--card)', padding: '12px 20px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="t-sec tnum" style={{ color: 'var(--ink-2)', flex: 1 }}>
            1 note{nbUpdates > 0 ? ` · ${nbUpdates} mise${nbUpdates > 1 ? 's' : ''} à jour` : ''}
            {nbFollowUps > 0 ? ` · ${nbFollowUps} relance${nbFollowUps > 1 ? 's' : ''}` : ''}
            {nbFollowUps > 0 && followUps.find((f) => f.kept) ? ` (1re : ${dayFR(followUps.find((f) => f.kept)!.date)})` : ''}
          </span>
          <button className="btn btn-ghost" onClick={() => setPreview(null)}>
            Annuler
          </button>
          <button className="btn btn-primary" disabled={committing || note.trim().length < 3} onClick={commit}>
            {committing ? 'Enregistrement…' : 'Tout enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
};
