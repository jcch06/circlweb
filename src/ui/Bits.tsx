import React, { useEffect, useRef, useState } from 'react';
import { Check, X, Lock } from 'lucide-react';
import { avatarColor, initials, STATUS_META, type RelStatus, dayFR } from './format';

/* ============================================================
   Composant 4 : avatar système.
   Photo sinon initiales sur les 10 couleurs iOS. 24/32/40/56.
   ============================================================ */
export const Avatar: React.FC<{
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  photoUrl?: string | null;
  size?: 24 | 32 | 40 | 56;
  locked?: boolean;
}> = ({ name, firstName, lastName, photoUrl, size = 32, locked }) => {
  const [broken, setBroken] = useState(false);
  const fontSize = size <= 24 ? 9 : size <= 32 ? 11 : size <= 40 ? 13 : 18;
  return (
    <span style={{ position: 'relative', flex: 'none', width: size, height: size, display: 'inline-block' }}>
      {photoUrl && !broken ? (
        <img
          src={photoUrl}
          alt=""
          onError={() => setBroken(true)}
          style={{ width: size, height: size, borderRadius: 999, objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <span
          style={{
            width: size, height: size, borderRadius: 999,
            background: avatarColor(name),
            display: 'grid', placeItems: 'center',
            color: '#fff', fontSize, fontWeight: 600,
          }}
        >
          {initials(firstName ?? name.split(' ')[0], lastName ?? name.split(' ')[1])}
        </span>
      )}
      {locked && (
        <span
          style={{
            position: 'absolute', right: -3, bottom: -3,
            width: Math.max(14, size / 3), height: Math.max(14, size / 3),
            borderRadius: 999, background: 'var(--orange)', color: '#fff',
            display: 'grid', placeItems: 'center', border: '2px solid var(--card)',
          }}
        >
          <Lock size={Math.max(7, size / 6)} />
        </span>
      )}
    </span>
  );
};

/* ============================================================
   Composant 2 : pastille de statut relationnel.
   Cliquer ouvre un popover factuel + « Je l'ai contacté ».
   ============================================================ */
export const StatusPill: React.FC<{
  status: RelStatus;
  lastTouchIso?: string | null;
  lastTouchKind?: string;
  onMarkContacted?: () => void;
}> = ({ status, lastTouchIso, lastTouchKind, onMarkContacted }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const meta = STATUS_META[status];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="status-pill"
        style={{ background: meta.color }}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        {meta.label}
      </button>
      {open && (
        <span className="popover" style={{ top: 'calc(100% + 6px)', left: 0 }} onClick={(e) => e.stopPropagation()}>
          <span className="t-sec" style={{ display: 'block', color: 'var(--ink-2)', marginBottom: onMarkContacted ? 10 : 0 }}>
            {lastTouchIso
              ? `Dernière trace : ${lastTouchKind ?? 'note'} du ${dayFR(lastTouchIso)}`
              : 'Aucune trace dans Circl pour l’instant.'}
          </span>
          {onMarkContacted && (
            <button
              className="btn btn-ghost"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => { onMarkContacted(); setOpen(false); }}
            >
              Je l'ai contacté
            </button>
          )}
        </span>
      )}
    </span>
  );
};

/* ============================================================
   Composant 7 : paire de décision. Croix grise puis coche teal,
   toujours dans cet ordre, toujours à droite.
   ============================================================ */
export const DecisionPair: React.FC<{
  onNo: () => void;
  onYes: () => void;
  noTitle?: string;
  yesTitle?: string;
  disabled?: boolean;
}> = ({ onNo, onYes, noTitle = 'Ignorer', yesTitle = 'Confirmer', disabled }) => (
  <span className="decision-pair">
    <button
      className="decision-btn decision-no"
      title={noTitle}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onNo(); }}
    >
      <X size={15} />
    </button>
    <button
      className="decision-btn decision-yes"
      title={yesTitle}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onYes(); }}
    >
      <Check size={15} />
    </button>
  </span>
);

/* ============================================================
   Composant 6 : carte IA (signature). Contient toujours le
   contenu, la provenance et une issue.
   ============================================================ */
export const AICard: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div className="ai-card" style={style}>{children}</div>
);

/* ============================================================
   Ligne de diff (composant 8).
   ============================================================ */
export const DiffLine: React.FC<{
  field: string;
  oldValue?: string | null;
  newValue: string;
}> = ({ field, oldValue, newValue }) => (
  <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
    <span className="t-label" style={{ fontSize: 11 }}>{field}</span>
    {oldValue && <span className="t-sec diff-old">{oldValue}</span>}
    {oldValue && <span style={{ color: 'var(--faint)' }}>→</span>}
    <span className="t-sec diff-new">{newValue}</span>
  </span>
);

/* ============================================================
   Modale de confirmation avec impact chiffré (suppressions).
   ============================================================ */
export const ConfirmModal: React.FC<{
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ title, body, confirmLabel, danger, busy, onConfirm, onCancel }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="modal-scrim" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="t-block" style={{ marginBottom: 10 }}>{title}</div>
        <div className="t-sec" style={{ color: 'var(--ink-2)', marginBottom: 18 }}>{body}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn btn-ghost" onClick={onCancel}>Annuler</button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'En cours…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

/* Label de section : 13 px MAJUSCULES 600 --mut (code iOS). */
export const SectionLabel: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div className="t-label" style={{ marginBottom: 8, ...style }}>{children}</div>
);

/* ============================================================
   Champ éditable en place. Le clic passe en édition, Entrée ou
   la perte de focus enregistre, Échap annule. Un champ vide
   affiche son invite en --faint plutôt qu'un blanc muet.
   ============================================================ */
export const EditableField: React.FC<{
  value?: string | null;
  placeholder: string;
  multiline?: boolean;
  disabled?: boolean;
  onSave: (value: string) => void | Promise<void>;
  render?: (value: string) => React.ReactNode;
  style?: React.CSSProperties;
}> = ({ value, placeholder, multiline, disabled, onSave, render, style }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => { setDraft(value ?? ''); }, [value]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  const commit = async () => {
    setEditing(false);
    const next = draft.trim();
    if (next === (value ?? '').trim()) return;
    await onSave(next);
  };

  if (disabled) {
    return <span className="t-sec" style={{ color: 'var(--ink-2)', ...style }}>{value || <span style={{ color: 'var(--faint)' }}>{placeholder}</span>}</span>;
  }

  if (editing) {
    const common = {
      ref: ref as never,
      className: 'input',
      value: draft,
      placeholder,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false); }
        if (e.key === 'Enter' && !multiline) { e.preventDefault(); commit(); }
        if (e.key === 'Enter' && multiline && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
      },
      style: { padding: '4px 8px', fontSize: 13.5, ...style },
    };
    return multiline
      ? <textarea {...common} rows={3} style={{ ...common.style, resize: 'vertical' }} />
      : <input {...common} />;
  }

  return (
    <span
      onClick={() => setEditing(true)}
      title="Cliquer pour modifier"
      style={{
        cursor: 'text', borderRadius: 6, padding: '2px 4px', margin: '-2px -4px',
        display: 'inline-block', minWidth: 60, ...style,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {value
        ? (render ? render(value) : <span className="t-sec" style={{ color: 'var(--ink-2)' }}>{value}</span>)
        : <span className="t-sec" style={{ color: 'var(--faint)' }}>{placeholder}</span>}
    </span>
  );
};
