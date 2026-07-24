import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCheck, ChevronDown, ChevronRight, ExternalLink, RotateCcw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useData } from '../data';
import { useToast } from '../ui/Toast';
import { Avatar, DecisionPair, DiffLine, AICard, SectionLabel, Segmented } from '../ui/Bits';
import { fullName, relativeFR } from '../ui/format';

// Page Mises à jour (brief 4.4) : trier tous les changements détectés en
// moins de 2 minutes. Strates par confiance, groupage par contact, preuve
// à un clic, triage clavier J/K/Entrée/X, historique restaurable.

const FIELD_LABELS: Record<string, string> = {
  company: 'Entreprise', job_title: 'Poste', industry: 'Secteur',
  location: 'Lieu', linkedin: 'LinkedIn', bio: 'Bio',
};

type SourceFilter = 'all' | 'voice' | 'web';

const SOURCES: { key: SourceFilter; label: string }[] = [
  { key: 'all', label: 'Toutes' },
  { key: 'voice', label: 'Note vocale' },
  { key: 'web', label: 'Veille web' },
];

/* Échelle de confiance unique (brief 4.0.7). */
const strateOf = (u: any): 'important' | 'other' | 'weak' => {
  const conf = typeof u.confidence === 'number' ? u.confidence : 1;
  if (conf < 0.6) return 'weak';
  if (conf >= 0.85 && (u.field === 'job_title' || u.field === 'company')) return 'important';
  return 'other';
};

export const UpdatesPage: React.FC = () => {
  const data = useData();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [source, setSource] = useState<SourceFilter>('all');
  const [tab, setTab] = useState<'inbox' | 'history'>('inbox');
  const [weakOpen, setWeakOpen] = useState(false);
  const [history, setHistory] = useState<any[] | null>(null);
  const [cursor, setCursor] = useState(0);

  const filtered = useMemo(
    () => data.pendingUpdates
      .filter((u) => !data.selectedSpaceId || u.space_id === data.selectedSpaceId)
      .filter((u) => source === 'all' || u.source === source)
      .filter((u) => data.contactById.get(u.contact_id)),
    [data.pendingUpdates, data.selectedSpaceId, source, data.contactById]
  );

  const strates = useMemo(() => {
    const s = { important: [] as any[], other: [] as any[], weak: [] as any[] };
    for (const u of filtered) s[strateOf(u)].push(u);
    return s;
  }, [filtered]);

  const flat = useMemo(
    () => [...strates.important, ...strates.other, ...(weakOpen ? strates.weak : [])],
    [strates, weakOpen]
  );

  /* Contacts suivis (transparence de la veille) */
  const tracked = useMemo(
    () => data.contacts.filter((c) => c.tracked_at),
    [data.contacts]
  );

  const decide = async (u: any, confirm: boolean) => {
    const { error } = await supabase.rpc(
      confirm ? 'confirm_contact_update' : 'dismiss_contact_update',
      { p_update_id: u.id }
    );
    if (error) { toast(`Échec : ${error.message}`); return; }
    const c = data.contactById.get(u.contact_id);
    if (confirm && u.field === 'job_title' && c) {
      toast('Mise à jour appliquée.', {
        label: `Voir la fiche de ${c.first_name}`,
        onClick: () => navigate(`/contacts/${c.id}`),
      });
    } else {
      toast(confirm ? 'Mise à jour appliquée.' : 'Mise à jour écartée.');
    }
    await data.refresh();
  };

  const confirmAll = async (updates: any[]) => {
    for (const u of updates) {
      await supabase.rpc('confirm_contact_update', { p_update_id: u.id });
    }
    toast(`${updates.length} mises à jour appliquées.`);
    await data.refresh();
  };

  const loadHistory = async () => {
    const { data: rows } = await supabase
      .from('contact_updates')
      .select('*')
      .neq('status', 'pending')
      // Real column is detected_at, not created_at — see
      // supabase/migrations/20260720100000_add_redesign_tables.sql.
      .order('detected_at', { ascending: false })
      .limit(100);
    setHistory(rows ?? []);
  };

  const restore = async (u: any) => {
    const { error } = await supabase.from('contact_updates').update({ status: 'pending' }).eq('id', u.id);
    if (error) { toast(`Échec : ${error.message}`); return; }
    toast('Mise à jour restaurée.');
    await Promise.all([loadHistory(), data.refresh()]);
  };

  /* Triage clavier : J/K déplacent, Entrée confirme, X écarte. */
  useEffect(() => {
    if (tab !== 'inbox') return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return;
      if (e.key === 'j' || e.key === 'J') setCursor((c) => Math.min(flat.length - 1, c + 1));
      if (e.key === 'k' || e.key === 'K') setCursor((c) => Math.max(0, c - 1));
      if (flat[cursor]) {
        if (e.key === 'Enter') { e.preventDefault(); decide(flat[cursor], true); }
        if (e.key === 'x' || e.key === 'X') decide(flat[cursor], false);
        if ((e.key === 'o' || e.key === 'O')) {
          const url = flat[cursor].metadata?.source_url;
          if (url) window.open(url, '_blank');
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tab, flat, cursor]);

  const card = (u: any, idx: number) => {
    const c = data.contactById.get(u.contact_id);
    const name = fullName(c);
    const sourceUrl = u.metadata?.source_url as string | undefined;
    const focused = idx === cursor;
    return (
      <div
        key={u.id}
        className="card card-pad"
        style={focused ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 1px var(--accent)' } : undefined}
        onMouseEnter={() => setCursor(idx)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Avatar name={name} firstName={c.first_name} lastName={c.last_name} photoUrl={c.photo_url} size={32} />
          <button
            className="t-name"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)' }}
            onClick={() => navigate(`/contacts/${c.id}`)}
          >
            {name}
          </button>
          {typeof u.confidence === 'number' && u.confidence >= 0.6 && u.confidence < 0.85 && (
            <span className="chip" style={{ height: 20, fontSize: 11, padding: '0 8px', borderColor: 'transparent', background: 'var(--amber-soft)', color: 'var(--amber)' }}>
              à vérifier
            </span>
          )}
          <span className="t-meta tnum" style={{ color: 'var(--faint)' }}>{relativeFR(u.detected_at)}</span>
          <span style={{ flex: 1 }} />
          <DecisionPair onNo={() => decide(u, false)} onYes={() => decide(u, true)} />
        </div>
        <div style={{ marginTop: 10, paddingLeft: 42 }}>
          {u.field ? (
            <DiffLine field={FIELD_LABELS[u.field] ?? u.field} oldValue={u.old_value} newValue={u.new_value ?? ''} />
          ) : (
            <span className="t-sec">{u.summary}</span>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            {u.summary && u.field && (
              <span className="t-meta" style={{ color: 'var(--mut)' }}>{u.summary}</span>
            )}
            {sourceUrl ? (
              <a className="chip clickable" style={{ height: 20, fontSize: 11, padding: '0 8px' }} href={sourceUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={10} /> source
              </a>
            ) : u.source === 'voice' ? (
              <span className="t-meta" style={{ color: 'var(--faint)' }}>issue d'une note vocale</span>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  const strateBlock = (label: string, items: any[], offset: number) =>
    items.length > 0 && (
      <div>
        <SectionLabel style={{ marginBottom: 8 }}>{label} · {items.length}</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((u, i) => card(u, offset + i))}
        </div>
      </div>
    );

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '24px 20px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
          <h1 className="t-page">Mises à jour</h1>
          {filtered.length > 0 && tab === 'inbox' && (
            <span className="t-sec tnum" style={{ color: 'var(--mut)' }}>{filtered.length} à traiter</span>
          )}
        </div>

        {/* Transparence de la veille */}
        <div className="t-sec" style={{ color: 'var(--mut)', marginBottom: 14 }}>
          {tracked.length > 0
            ? <>Veille active sur <span className="tnum">{tracked.length}</span> contact{tracked.length > 1 ? 's' : ''} (tags VIP, À suivre).</>
            : 'Aucune veille web active. Taguez des contacts VIP ou À suivre pour la démarrer.'}
        </div>

        {/* Filtres + segmented */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
          {SOURCES.map((s) => (
            <button
              key={s.key}
              className={`chip clickable chip-filter${source === s.key ? ' on' : ''}`}
              onClick={() => setSource(s.key)}
            >
              {s.label}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <Segmented
            size="sm"
            options={[
              { key: 'inbox', label: 'À traiter' },
              { key: 'history', label: 'Historique' },
            ]}
            value={tab}
            onChange={(t) => { setTab(t); if (t === 'history' && history === null) loadHistory(); }}
          />
        </div>

        {tab === 'inbox' ? (
          filtered.length === 0 ? (
            <AICard>
              <SectionLabel>Tout est à jour</SectionLabel>
              <p className="t-sec" style={{ color: 'var(--ink-2)', lineHeight: '21px' }}>
                Les mises à jour arrivent de deux endroits : les notes vocales dictées dans l'app iPhone,
                et la veille web sur les contacts tagués VIP ou À suivre. Quand un changement est détecté,
                il attend ici votre confirmation avant d'écrire quoi que ce soit sur la fiche.
              </p>
            </AICard>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {strateBlock('Important', strates.important, 0)}
              {strateBlock('Autres signaux', strates.other, strates.important.length)}
              {strates.weak.length > 0 && (
                <div>
                  <button className="btn btn-quiet" style={{ padding: '4px 0', gap: 5 }} onClick={() => setWeakOpen((o) => !o)}>
                    {weakOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span className="t-label" style={{ color: 'var(--mut)' }}>Signaux faibles · {strates.weak.length}</span>
                  </button>
                  {weakOpen && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                      {strates.weak.map((u, i) => card(u, strates.important.length + strates.other.length + i))}
                    </div>
                  )}
                </div>
              )}
              {filtered.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button className="btn btn-ghost" onClick={() => confirmAll([...strates.important, ...strates.other])} disabled={strates.important.length + strates.other.length === 0}>
                    <CheckCheck size={14} /> Tout confirmer ({strates.important.length + strates.other.length})
                  </button>
                  <span className="t-meta" style={{ color: 'var(--faint)' }}>
                    J/K naviguer · Entrée confirmer · X écarter · O ouvrir la source
                  </span>
                </div>
              )}
            </div>
          )
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(history ?? []).length === 0 && (
              <div className="t-sec" style={{ color: 'var(--mut)' }}>Aucune mise à jour traitée pour l'instant.</div>
            )}
            {(history ?? []).map((u) => {
              const c = data.contactById.get(u.contact_id);
              if (!c) return null;
              return (
                <div key={u.id} className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar name={fullName(c)} firstName={c.first_name} lastName={c.last_name} photoUrl={c.photo_url} size={24} />
                  <span className="t-sec" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ fontWeight: 500 }}>{fullName(c)}</span> · {u.summary ?? `${FIELD_LABELS[u.field] ?? u.field} → ${u.new_value}`}
                  </span>
                  <span
                    className="chip"
                    style={{
                      height: 20, fontSize: 11, padding: '0 8px', borderColor: 'transparent',
                      background: u.status === 'confirmed' ? 'var(--green-soft)' : 'var(--hover)',
                      color: u.status === 'confirmed' ? 'var(--status-fresh)' : 'var(--mut)',
                    }}
                  >
                    {u.status === 'confirmed' ? 'confirmée' : 'écartée'}
                  </span>
                  {u.status !== 'confirmed' && (
                    <button className="btn btn-quiet" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => restore(u)}>
                      <RotateCcw size={12} /> Restaurer
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
