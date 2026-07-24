import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, ChevronDown, ChevronRight, Trash2, User, Lock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useData } from '../data';
import { useToast } from '../ui/Toast';
import { Avatar, AICard, SectionLabel, ConfirmModal } from '../ui/Bits';
import { OpportunityCard, type Intro } from '../ui/OpportunityCard';
import { UserProfilePopup } from '../components/UserProfilePopup';
import { fullName, dayFR, relativeFR } from '../ui/format';
import type { MistralPipelineResult, AnalysisHistoryEntry, AnalysisDelta } from '../lib/mistral';
import {
  isMistralConfigured,
  runMistralOracleBatchPipeline,
  getCachedMistralPipelineResult,
  listAnalysisHistory,
  getAnalysisById,
  deleteAnalysis,
  compareAnalyses,
} from '../lib/mistral';
import { createAndRunAnalysisJob, type JobState } from '../lib/oracleJob';

// Opportunités (brief 4.8) : l'ancien Oracle converti en file d'action.
// Le jargon d'implémentation disparaît : plus de Map/Reduce, de lots, de
// jetons ni de coût en dollars. Trois onglets : Opportunités, Cartographie,
// Historique. Les décisions survivent aux régénérations (intro_suggestions).

type Tab = 'intros' | 'map' | 'history';

const PRIORITY_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  high: { label: 'Prioritaire', color: 'var(--orange)', bg: 'var(--orange-soft)' },
  medium: { label: 'À suivre', color: 'var(--amber)', bg: 'var(--amber-soft)' },
  low: { label: 'Secondaire', color: 'var(--mut)', bg: 'var(--hover)' },
};

export const OpportunitiesPage: React.FC = () => {
  const data = useData();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>('intros');
  const [result, setResult] = useState<MistralPipelineResult | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  // Grand réseau : analyse résumable en tâche de fond (voir lib/oracleJob) au
  // lieu du pipeline synchrone ci-dessous — nécessaire dès que le nombre de
  // lots dépasse ce qu'une seule invocation de 60s peut traiter.
  const [asyncJob, setAsyncJob] = useState<JobState | null>(null);
  const [decided, setDecided] = useState<Map<string, any>>(new Map());
  const [history, setHistory] = useState<AnalysisHistoryEntry[]>([]);
  const [delta, setDelta] = useState<AnalysisDelta | null>(null);
  const [archive, setArchive] = useState<{ id: string; label: string | null } | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [synthesisOpen, setSynthesisOpen] = useState(false);
  const [plan, setPlan] = useState<Record<string, boolean>>({});

  const spaceId = data.selectedSpaceId ?? data.spaces.find((s) => s.type === 'personal')?.id ?? null;
  const contacts = useMemo(
    () => (data.selectedSpaceId ? data.contacts.filter((c) => c.space_id === data.selectedSpaceId) : data.contacts),
    [data.contacts, data.selectedSpaceId]
  );
  const eligible = useMemo(() => contacts.filter((c) => c.company || c.job_title || c.ai_context), [contacts]);

  /* Décisions déjà prises : elles ne reviennent pas. */
  const loadDecisions = async () => {
    const { data: rows } = await supabase.from('intro_suggestions').select('*');
    setDecided(new Map((rows ?? []).map((r: any) => [`${r.from_contact_id}|${r.to_contact_id}`, r])));
  };

  useEffect(() => {
    loadDecisions();
    listAnalysisHistory(spaceId).then(setHistory).catch(() => {});
    const cached = getCachedMistralPipelineResult(eligible);
    if (cached) setResult(cached);
    const saved = localStorage.getItem('circl_action_plan');
    if (saved) { try { setPlan(JSON.parse(saved)); } catch { /* plan corrompu : on repart à vide */ } }
  }, [spaceId]);

  useEffect(() => { localStorage.setItem('circl_action_plan', JSON.stringify(plan)); }, [plan]);

  const run = async () => {
    setRunning(true);
    setProgress(0);
    setArchive(null);
    try {
      const profile = localStorage.getItem(`circl_user_profile_${data.user?.id}`);
      const r = await runMistralOracleBatchPipeline(
        eligible,
        data.notes,
        profile ? JSON.parse(profile) : undefined,
        (pct) => setProgress(pct),
        { ownerId: data.user?.id, spaceId }
      );
      setResult(r);
      listAnalysisHistory(spaceId).then(setHistory).catch(() => {});
      toast('Analyse à jour.');
    } catch (err: any) {
      toast(`L'analyse est momentanément indisponible : ${err.message ?? 'erreur'}`);
    } finally {
      setRunning(false);
    }
  };

  // Grand réseau : crée un job résumable côté serveur et l'avance par tranches
  // bornées, pour que des centaines de lots ne bloquent jamais une seule
  // invocation de 60s. Reprenable si l'onglet se ferme en cours de route.
  // Aboutit au même MistralPipelineResult que le pipeline synchrone.
  const runAsync = async () => {
    setRunning(true);
    setProgress(0);
    setAsyncJob(null);
    setArchive(null);
    try {
      const profile = localStorage.getItem(`circl_user_profile_${data.user?.id}`);
      const final = await createAndRunAnalysisJob(
        spaceId,
        profile ? JSON.parse(profile) : undefined,
        (s) => setAsyncJob(s)
      );
      if (final.status === 'error') {
        toast(`Analyse en tâche de fond échouée : ${final.error || 'erreur inconnue'}`);
        return;
      }
      if (!final.synthesis) {
        toast("L'analyse est terminée mais n'a produit aucune synthèse (réseau trop peu enrichi ?).");
        return;
      }
      setResult({
        // Per-batch immediateSynergies — the PRIMARY source the intros list
        // below reads first. Leaving this empty was the bug: only the
        // narrower supply/demand cross-product surfaced, so the same few
        // names kept recombining.
        batches: final.batches ?? [],
        synthesis: final.synthesis,
        supplyDemand: final.supplyDemand ?? [],
        bridgeContacts: final.bridgeContacts ?? [],
        timestamp: Date.now(),
        dataQuality: {
          analyzed: final.analyzedCount ?? 0,
          excluded: final.excludedCount ?? 0,
          capped: final.cappedCount ?? 0,
        },
      });
      listAnalysisHistory(spaceId).then(setHistory).catch(() => {});
      toast('Analyse à jour.');
    } catch (err: any) {
      toast(`Erreur analyse en tâche de fond : ${err?.message ?? 'inconnue'}`);
    } finally {
      setRunning(false);
      setAsyncJob(null);
    }
  };

  const openArchive = async (id: string) => {
    const a = await getAnalysisById(id);
    if (!a) { toast('Analyse introuvable.'); return; }
    setResult(a);
    setArchive({ id: a.id, label: a.label });
    setTab('map');
  };

  const removeAnalysis = async (id: string) => {
    setConfirmDelete(null);
    try {
      await deleteAnalysis(id);
      setHistory((h) => h.filter((x) => x.id !== id));
      if (archive?.id === id) { setArchive(null); setResult(null); }
      toast('Analyse supprimée.');
    } catch (err: any) {
      toast(`Suppression impossible : ${err.message}`);
    }
  };

  /* Delta automatique vs analyse précédente : il faut charger les deux
     snapshots complets, compareAnalyses travaille sur les résultats. */
  useEffect(() => {
    if (tab !== 'history' || history.length < 2 || delta) return;
    let cancelled = false;
    (async () => {
      try {
        const [before, after] = await Promise.all([
          getAnalysisById(history[1].id),
          getAnalysisById(history[0].id),
        ]);
        if (!before || !after || cancelled) return;
        const d = await compareAnalyses(before, after);
        if (!cancelled) setDelta(d);
      } catch { /* le delta est un bonus : son échec ne casse pas l'historique */ }
    })();
    return () => { cancelled = true; };
  }, [tab, history, delta]);

  /* Intros proposées par l'analyse, moins celles déjà tranchées.
     Source primaire : les immediateSynergies de jcch06 — l'IA y nomme
     directement la paire, sa raison et sa preuve. Le croisement
     offre/demande ne sert que de complément pour les paires qu'elles
     n'ont pas vues. */
  const intros: Intro[] = useMemo(() => {
    if (!result) return [];
    const out: Intro[] = [];
    const seen = new Set<string>();
    const CONF: Record<string, number> = { high: 0.9, medium: 0.72, low: 0.55 };

    const add = (fromId: string, toId: string, rationale: string, confidence: number) => {
      if (fromId === toId) return;
      const key = `${fromId}|${toId}`;
      const mirror = `${toId}|${fromId}`;
      if (seen.has(key) || seen.has(mirror)) return;
      if (!data.contactById.get(fromId) || !data.contactById.get(toId)) return;
      seen.add(key);
      out.push({ from_contact_id: fromId, to_contact_id: toId, rationale, confidence });
    };

    for (const batch of result.batches ?? []) {
      for (const syn of batch.immediateSynergies ?? []) {
        const reason = [syn.reason, syn.evidence && `Ce qui le laisse penser : ${syn.evidence}`]
          .filter(Boolean)
          .join(' ');
        add(syn.contactId1, syn.contactId2, reason, CONF[syn.confidence] ?? 0.7);
      }
    }

    for (const sd of result.supplyDemand ?? []) {
      for (const d of sd.demanders ?? []) {
        for (const s of sd.suppliers ?? []) {
          add(
            d.id,
            s.id,
            sd.rationale?.trim()
              || `${d.name} cherche « ${sd.need} », et ${s.name} sait le faire. Une intro directe vaut mieux qu'un cold outreach.`,
            sd.gapLevel === 'covered' ? 0.9 : sd.gapLevel === 'partial' ? 0.72 : 0.6
          );
        }
      }
    }
    return out.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  }, [result, data.contactById]);

  const pending = intros.filter((i) => !decided.has(`${i.from_contact_id}|${i.to_contact_id}`));
  const planned = [...decided.values()].filter((d) => d.status === 'snoozed');
  const done = [...decided.values()].filter((d) => d.status === 'sent');

  const lastAnalysis = history[0];

  /* --------- États vides honnêtes --------- */
  if (!isMistralConfigured()) {
    return (
      <Shell title="Opportunités">
        <AICard>
          <SectionLabel>L'analyse est momentanément indisponible</SectionLabel>
          <p className="t-sec" style={{ color: 'var(--ink-2)' }}>
            Le moteur d'analyse n'est pas joignable pour l'instant. Vos contacts et vos notes
            restent intacts ; réessayez plus tard.
          </p>
        </AICard>
      </Shell>
    );
  }

  if (eligible.length < 10 && !result) {
    return (
      <Shell title="Opportunités">
        <AICard>
          <SectionLabel>Votre réseau n'est pas encore assez fourni</SectionLabel>
          <p className="t-sec" style={{ color: 'var(--ink-2)', lineHeight: '21px' }}>
            L'analyse croise ce que vos contacts cherchent avec ce qu'ils savent faire pour
            trouver des mises en relation. Elle a besoin d'environ dix fiches renseignées
            (poste, entreprise ou contexte) pour dire quelque chose d'utile.
            Vous en avez <b className="tnum">{eligible.length}</b>.
          </p>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => navigate('/contacts?vue=not_enriched')}>
            Compléter des fiches
          </button>
        </AICard>
      </Shell>
    );
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ maxWidth: 1060, margin: '0 auto', padding: '24px 24px 60px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 18 }}>
          <div style={{ flex: 1 }}>
            <h1 className="t-page">Opportunités</h1>
            <div className="t-sec tnum" style={{ color: 'var(--mut)', marginTop: 2 }}>
              {lastAnalysis
                ? `Analyse du ${dayFR(lastAnalysis.createdAt)} · ${lastAnalysis.contactCount} contacts`
                : 'Aucune analyse pour l’instant'}
            </div>
          </div>
          <button className="btn btn-ghost" onClick={() => setShowProfile(true)}>
            <User size={14} /> Profil
          </button>
          <button
            className="btn btn-ghost"
            onClick={runAsync}
            disabled={running}
            title="Pour un très gros réseau : analyse résumable en tâche de fond, survit à un rafraîchissement."
          >
            Gros réseau
          </button>
          <button className="btn btn-primary" onClick={run} disabled={running}>
            <RefreshCw size={14} style={running ? { animation: 'spin 1.2s linear infinite' } : undefined} />
            {running ? `Analyse… ${progress}%` : lastAnalysis ? 'Actualiser l’analyse' : 'Lancer l’analyse'}
          </button>
        </div>

        {asyncJob && (asyncJob.status === 'running' || asyncJob.status === 'pending') && (
          <div className="card card-pad" style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="t-sec tnum" style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ink-2)' }}>
              <span>
                Analyse en tâche de fond — {(
                  { init: 'initialisation', embed: 'vectorisation', plan: 'clustering', map: 'analyse des lots', reduce: 'synthèse', supply: 'offre/demande', done: 'terminé' } as Record<string, string>
                )[asyncJob.phase] ?? asyncJob.phase}
                {asyncJob.phase === 'embed' && asyncJob.totalToEmbed ? ` (${asyncJob.embedded}/${asyncJob.totalToEmbed})` : ''}
                {asyncJob.phase === 'map' && asyncJob.totalBatches ? ` (${asyncJob.completedBatches}/${asyncJob.totalBatches} lots)` : ''}
                {asyncJob.rateLimited ? ' · limite Mistral, patiente…' : ''}
              </span>
              <span>{asyncJob.progress}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: 'var(--hover)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${asyncJob.progress}%`, background: 'var(--accent)', transition: 'width 0.3s ease' }} />
            </div>
          </div>
        )}

        {archive && (
          <div
            style={{
              background: 'var(--accent-soft)', border: '1px solid var(--accent)',
              borderRadius: 'var(--r-el)', padding: '8px 14px', marginBottom: 14,
              display: 'flex', alignItems: 'center', gap: 10,
            }}
          >
            <span className="t-sec" style={{ color: 'var(--accent)', flex: 1, fontWeight: 500 }}>
              Vous consultez une analyse archivée{archive.label ? ` : ${archive.label}` : ''}.
            </span>
            <button className="btn btn-quiet" style={{ padding: '4px 8px', fontSize: 12.5, color: 'var(--accent)' }} onClick={() => { setArchive(null); setResult(null); }}>
              Revenir à l'actuelle
            </button>
          </div>
        )}

        {/* Onglets */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
          {([
            { key: 'intros' as const, label: 'Opportunités', badge: pending.length },
            { key: 'map' as const, label: 'Cartographie' },
            { key: 'history' as const, label: 'Historique' },
          ]).map((t) => (
            <button
              key={t.key}
              className={`chip clickable chip-filter${tab === t.key ? ' on' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {'badge' in t && t.badge ? <span className="tnum" style={{ marginLeft: 4 }}>{t.badge}</span> : null}
            </button>
          ))}
        </div>

        {/* ---------------- Onglet Opportunités ---------------- */}
        {tab === 'intros' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 20, alignItems: 'start' }} className="home-grid">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {!result ? (
                <AICard>
                  <SectionLabel>Trouvez qui présenter à qui</SectionLabel>
                  <p className="t-sec" style={{ color: 'var(--ink-2)', lineHeight: '21px' }}>
                    L'analyse lit ce que vos {eligible.length} contacts cherchent et ce qu'ils
                    savent faire, puis propose les mises en relation qui ont du sens. Vous gardez
                    la main : chaque suggestion s'envoie, se planifie ou s'écarte.
                  </p>
                </AICard>
              ) : (
                <>
                  {pending.length === 0 && planned.length === 0 && done.length === 0 && (
                    <div className="card card-pad">
                      <div className="t-block" style={{ marginBottom: 6 }}>Rien à proposer pour l'instant</div>
                      <div className="t-sec" style={{ color: 'var(--mut)' }}>
                        Plus vos notes sont riches, plus l'analyse trouve de recoupements.
                      </div>
                    </div>
                  )}

                  {pending.length > 0 && (
                    <div>
                      <SectionLabel>À traiter · {pending.length}</SectionLabel>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {pending.slice(0, 12).map((i) => (
                          <OpportunityCard
                            key={`${i.from_contact_id}|${i.to_contact_id}`}
                            intro={i}
                            onResolved={loadDecisions}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {planned.length > 0 && (
                    <Collapsible label={`Planifiées · ${planned.length}`}>
                      {planned.map((d) => (
                        <ResolvedRow key={d.id} d={d} suffix={d.snoozed_until ? `relance le ${dayFR(d.snoozed_until)}` : ''} />
                      ))}
                    </Collapsible>
                  )}

                  {done.length > 0 && (
                    <Collapsible label={`Traitées · ${done.length}`}>
                      {done.map((d) => (
                        <ResolvedRow key={d.id} d={d} suffix={d.resolved_at ? `envoyée ${relativeFR(d.resolved_at)}` : ''} />
                      ))}
                    </Collapsible>
                  )}
                </>
              )}
            </div>

            {/* Colonne droite : profil + plan d'action */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="card card-pad" style={{ padding: '14px 16px' }}>
                <SectionLabel>Votre profil</SectionLabel>
                <p className="t-sec" style={{ color: 'var(--ink-2)' }}>
                  Un profil complet améliore les suggestions : l'analyse sait ce que vous
                  cherchez et ce que vous offrez.
                </p>
                <button className="btn btn-ghost" style={{ marginTop: 10, width: '100%', justifyContent: 'center' }} onClick={() => setShowProfile(true)}>
                  Compléter mon profil
                </button>
              </div>

              {result?.synthesis?.recommendedActionPlan && result.synthesis.recommendedActionPlan.length > 0 && (
                <div className="card card-pad" style={{ padding: '14px 16px' }}>
                  <SectionLabel>Plan d'action</SectionLabel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {result.synthesis.recommendedActionPlan.slice(0, 5).map((a, i) => (
                      <label key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={!!plan[a]}
                          onChange={() => setPlan((p) => ({ ...p, [a]: !p[a] }))}
                          style={{ accentColor: 'var(--accent)', marginTop: 3, cursor: 'pointer' }}
                        />
                        <span
                          className="t-sec"
                          style={{ color: plan[a] ? 'var(--faint)' : 'var(--ink-2)', textDecoration: plan[a] ? 'line-through' : 'none' }}
                        >
                          {a}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ---------------- Onglet Cartographie ---------------- */}
        {tab === 'map' && (
          !result ? (
            <div className="card card-pad t-sec" style={{ color: 'var(--mut)' }}>
              Lancez une analyse pour cartographier votre réseau.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Bandeau de synthèse : 3 stats + une phrase */}
              <div className="card card-pad">
                <div style={{ display: 'flex', gap: 28, marginBottom: 12, flexWrap: 'wrap' }}>
                  <Stat value={result.synthesis?.globalThemes?.length ?? 0} label="thèmes" />
                  <Stat value={result.synthesis?.macroNeeds?.length ?? 0} label="besoins" />
                  <Stat value={result.bridgeContacts?.length ?? 0} label="contacts-ponts" />
                </div>
                <p className="t-sec" style={{ color: 'var(--ink-2)', lineHeight: '21px' }}>
                  {result.synthesis?.networkStrength}
                </p>
                {result.dataQuality && (
                  <p className="t-meta tnum" style={{ color: 'var(--mut)', marginTop: 8 }}>
                    Analyse portée sur {result.dataQuality.analyzed} contact{result.dataQuality.analyzed > 1 ? 's' : ''}
                    {result.dataQuality.excluded > 0 && (
                      <> · {result.dataQuality.excluded} écarté{result.dataQuality.excluded > 1 ? 's' : ''} faute de fiche assez remplie</>
                    )}
                    {result.dataQuality.capped ? <> · plafonnée à {result.dataQuality.capped} pour tenir le temps de calcul</> : null}
                  </p>
                )}
                {result.synthesis?.crossBatchSynergies?.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <button className="btn btn-quiet" style={{ padding: '4px 0', gap: 5 }} onClick={() => setSynthesisOpen((o) => !o)}>
                      {synthesisOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className="t-label" style={{ color: 'var(--mut)' }}>Analyse détaillée</span>
                    </button>
                    {synthesisOpen && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                        {result.synthesis.crossBatchSynergies.map((s, i) => (
                          <div key={i}>
                            <div className="t-name" style={{ fontSize: 14 }}>{s.theme}</div>
                            <div className="t-sec" style={{ color: 'var(--ink-2)' }}>{s.description}</div>
                            <div className="t-meta" style={{ color: 'var(--mut)' }}>{s.potentialImpact}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Thèmes cliquables */}
              {result.synthesis?.globalThemes?.length > 0 && (
                <div>
                  <SectionLabel>Thèmes de votre réseau</SectionLabel>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {result.synthesis.globalThemes.map((t) => (
                      <button key={t} className="chip clickable" onClick={() => navigate(`/contacts?q=${encodeURIComponent(t)}`)}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Contacts-ponts */}
              {result.bridgeContacts?.length > 0 && (
                <div>
                  <SectionLabel>Vos contacts-ponts</SectionLabel>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {result.bridgeContacts.slice(0, 12).map((b) => {
                      const c = data.contactById.get(b.id);
                      return (
                        <button
                          key={b.id}
                          className="chip clickable"
                          style={{ height: 34, paddingLeft: 4 }}
                          onClick={() => navigate(`/contacts/${b.id}`)}
                          title={`${b.role}${b.company ? ` · ${b.company}` : ''}`}
                        >
                          <span style={{ boxShadow: '0 0 0 2px var(--accent)', borderRadius: 999, display: 'inline-flex' }}>
                            <Avatar
                              name={b.name}
                              firstName={c?.first_name ?? b.name.split(' ')[0]}
                              lastName={c?.last_name ?? b.name.split(' ')[1]}
                              photoUrl={c?.photo_url}
                              size={24}
                            />
                          </span>
                          <span style={{ marginLeft: 4 }}>{b.name}</span>
                          {!c && <Lock size={11} color="var(--orange)" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Macro-besoins */}
              {result.synthesis?.macroNeeds?.length > 0 && (
                <div>
                  <SectionLabel>Ce que votre réseau cherche</SectionLabel>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                    {result.synthesis.macroNeeds.map((n, i) => {
                      const p = PRIORITY_LABEL[n.priority] ?? PRIORITY_LABEL.low;
                      return (
                        <div key={i} className="card card-pad" style={{ padding: '14px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                            <span className="t-name" style={{ flex: 1, fontSize: 14 }}>{n.label}</span>
                            <span className="chip" style={{ height: 20, fontSize: 11, padding: '0 8px', borderColor: 'transparent', background: p.bg, color: p.color }}>
                              {p.label}
                            </span>
                          </div>
                          <div className="t-meta tnum" style={{ color: 'var(--mut)' }}>
                            {n.affectedContactsCount} contact{n.affectedContactsCount > 1 ? 's' : ''} concerné{n.affectedContactsCount > 1 ? 's' : ''}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Offre / demande appariées */}
              {result.supplyDemand?.length > 0 && (
                <div>
                  <SectionLabel>Offre et demande</SectionLabel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {result.supplyDemand.slice(0, 10).map((sd, i) => (
                      <div key={i} className="card card-pad" style={{ padding: '12px 16px' }}>
                        <div className="t-name" style={{ fontSize: 14, marginBottom: 8 }}>{sd.need}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          <div>
                            <div className="t-meta" style={{ color: 'var(--mut)', marginBottom: 4 }}>cherchent</div>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {sd.demanders.map((d) => (
                                <button key={d.id} className="chip clickable chip-need" style={{ height: 22, fontSize: 11.5 }} onClick={() => navigate(`/contacts/${d.id}`)}>
                                  {d.name}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <div className="t-meta" style={{ color: 'var(--mut)', marginBottom: 4 }}>offrent</div>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {sd.suppliers.map((s) => (
                                <button key={s.id} className="chip clickable chip-skill" style={{ height: 22, fontSize: 11.5 }} onClick={() => navigate(`/contacts/${s.id}`)}>
                                  {s.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Portes qui s'ouvrent (emergingOpportunities de jcch06) */}
              {result.synthesis?.emergingOpportunities?.length > 0 && (
                <div>
                  <SectionLabel>Les portes que votre réseau ouvre</SectionLabel>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
                    {result.synthesis.emergingOpportunities.map((eo, i) => (
                      <AICard key={i}>
                        <div className="t-name" style={{ fontSize: 14, marginBottom: 4 }}>{eo.theme}</div>
                        <div className="t-sec" style={{ color: 'var(--ink-2)', marginBottom: 8 }}>{eo.description}</div>
                        {eo.whyNewDoor && (
                          <div className="t-meta" style={{ color: 'var(--mut)', marginBottom: 8 }}>{eo.whyNewDoor}</div>
                        )}
                        {eo.anchorContacts?.length > 0 && (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {eo.anchorContacts.map((a, j) => {
                              const c = data.contacts.find((x) => fullName(x).toLowerCase() === a.name?.toLowerCase());
                              return c ? (
                                <button key={j} className="chip clickable" style={{ height: 22, fontSize: 11.5 }} onClick={() => navigate(`/contacts/${c.id}`)}>
                                  {a.name}
                                </button>
                              ) : (
                                <span key={j} className="chip" style={{ height: 22, fontSize: 11.5 }}>{a.name}</span>
                              );
                            })}
                          </div>
                        )}
                      </AICard>
                    ))}
                  </div>
                </div>
              )}

              {/* Chaînes de valeur */}
              {result.synthesis?.valueChains?.length > 0 && (
                <div>
                  <SectionLabel>Chaînes de valeur possibles</SectionLabel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {result.synthesis.valueChains.map((vc, i) => (
                      <div key={i} className="card card-pad" style={{ padding: '14px 16px' }}>
                        <div className="t-name" style={{ fontSize: 14 }}>{vc.title}</div>
                        <div className="t-sec" style={{ color: 'var(--ink-2)', marginBottom: 8 }}>{vc.description}</div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          {vc.chain.map((link, j) => (
                            <React.Fragment key={j}>
                              {j > 0 && <span style={{ color: 'var(--faint)' }}>→</span>}
                              <span className="chip" title={link.contribution}>{link.contactName}</span>
                            </React.Fragment>
                          ))}
                        </div>
                        <div className="t-meta" style={{ color: 'var(--mut)', marginTop: 6 }}>{vc.estimatedImpact}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        )}

        {/* ---------------- Onglet Historique ---------------- */}
        {tab === 'history' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {delta && (
              <AICard>
                <SectionLabel>Depuis l'analyse précédente</SectionLabel>
                <p className="t-sec" style={{ color: 'var(--ink-2)', marginBottom: 8 }}>{delta.networkEvolutionSummary}</p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {delta.newThemes?.map((t) => <span key={t} className="chip chip-skill">+ {t}</span>)}
                  {delta.resolvedThemes?.map((t) => <span key={t} className="chip">✓ {t}</span>)}
                </div>
              </AICard>
            )}
            {history.length === 0 && (
              <div className="t-sec" style={{ color: 'var(--mut)' }}>Aucune analyse enregistrée.</div>
            )}
            {history.map((h) => (
              <div key={h.id} className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t-name" style={{ fontSize: 14 }}>{h.label ?? `Analyse du ${dayFR(h.createdAt)}`}</div>
                  <div className="t-meta tnum" style={{ color: 'var(--mut)' }}>
                    {h.contactCount} contacts · {relativeFR(h.createdAt)}
                  </div>
                </div>
                <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12.5 }} onClick={() => openArchive(h.id)}>
                  Consulter
                </button>
                <button className="btn btn-quiet" style={{ padding: 5, color: 'var(--danger)' }} onClick={() => setConfirmDelete(h.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {showProfile && data.user && (
          <UserProfilePopup
            userId={data.user.id}
            onClose={() => setShowProfile(false)}
            onSave={() => toast('Profil enregistré.')}
          />
        )}

        {confirmDelete && (
          <ConfirmModal
            title="Supprimer cette analyse ?"
            body="L'analyse archivée disparaît de l'historique. Vos contacts et notes ne sont pas touchés."
            confirmLabel="Supprimer"
            danger
            onConfirm={() => removeAnalysis(confirmDelete)}
            onCancel={() => setConfirmDelete(null)}
          />
        )}
      </div>
    </div>
  );
};

const Shell: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ height: '100%', overflowY: 'auto' }}>
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '24px 20px' }}>
      <h1 className="t-page" style={{ marginBottom: 18 }}>{title}</h1>
      {children}
    </div>
  </div>
);

const Stat: React.FC<{ value: number; label: string }> = ({ value, label }) => (
  <div>
    <div className="t-count">{value}</div>
    <div className="t-meta" style={{ color: 'var(--mut)' }}>{label}</div>
  </div>
);

const Collapsible: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="btn btn-quiet" style={{ padding: '4px 0', gap: 5 }} onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="t-label" style={{ color: 'var(--mut)' }}>{label}</span>
      </button>
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>{children}</div>}
    </div>
  );
};

const ResolvedRow: React.FC<{ d: any; suffix: string }> = ({ d, suffix }) => {
  const data = useData();
  const navigate = useNavigate();
  const from = data.contactById.get(d.from_contact_id);
  const to = data.contactById.get(d.to_contact_id);
  if (!from || !to) return null;
  return (
    <div className="card" style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className="t-sec" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <button className="t-sec" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', fontWeight: 500, padding: 0 }} onClick={() => navigate(`/contacts/${from.id}`)}>
          {fullName(from)}
        </button>
        <span style={{ color: 'var(--faint)' }}> → </span>
        <button className="t-sec" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', fontWeight: 500, padding: 0 }} onClick={() => navigate(`/contacts/${to.id}`)}>
          {fullName(to)}
        </button>
      </span>
      <span className="t-meta tnum" style={{ color: 'var(--mut)' }}>{suffix}</span>
    </div>
  );
};
