import React, { useState, useEffect, useMemo } from 'react';
import { Zap, Copy, Check, Target, Key, Brain, Workflow, Award, Scale, Share2, History, GitCompare, Trash2, ArrowRight, Lock, Compass } from 'lucide-react';
import type { MistralPipelineResult, AnalysisHistoryEntry, AnalysisDelta } from '../lib/mistral';
import {
  suggestWarmIntros,
  isMistralConfigured,
  runMistralOracleBatchPipeline,
  getCachedMistralPipelineResult,
  listAnalysisHistory,
  getAnalysisById,
  deleteAnalysis,
  compareAnalyses
} from '../lib/mistral';
import { UserProfilePopup } from './UserProfilePopup';
import { SupplyDemandMatrix } from './SupplyDemandMatrix';

interface OpportunityHubProps {
  contacts: any[];
  notes: any[];
  tags: any[];
  spaces?: any[];
  selectedSpaceId?: string | null;
  user: any;
  /** Jump to the Contacts page filtered on a given contact's name — used to send the user straight to a contact excluded from the analysis so they can enrich it. */
  onViewContact?: (name: string) => void;
}

/** Resolve the user's Oracle profile from auth metadata or localStorage fallback. */
function loadUserProfile(user: any): any | null {
  if (!user) return null;
  const metaProfile = user.user_metadata?.oracle_profile;
  if (metaProfile) return metaProfile;
  try {
    const saved = localStorage.getItem(`circl_user_profile_${user.id}`);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

export const OpportunityHub: React.FC<OpportunityHubProps> = ({ contacts, notes, user, selectedSpaceId, onViewContact }) => {
  const [activeMode, setActiveMode] = useState<'network' | 'opportunities' | 'market' | 'intros' | 'radar' | 'history'>('network');

  const [loading, setLoading] = useState(false);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineProgress, setPipelineProgress] = useState(0);

  const [v3Result, setV3Result] = useState<MistralPipelineResult | null>(null);
  const [viewingArchiveId, setViewingArchiveId] = useState<string | null>(null);
  const [showProfilePopup, setShowProfilePopup] = useState(false);
  const [showExcludedList, setShowExcludedList] = useState(false);
  const [hideWeakSynergies, setHideWeakSynergies] = useState(true);

  // Analysis history & delta comparison
  const [history, setHistory] = useState<AnalysisHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [compareFromId, setCompareFromId] = useState<string>('');
  const [compareToId, setCompareToId] = useState<string>('');
  const [delta, setDelta] = useState<AnalysisDelta | null>(null);
  const [loadingDelta, setLoadingDelta] = useState(false);

  // Legacy: Warm Intros (kept as a separate targeted feature)
  const [intros, setIntros] = useState<any[]>([]);
  const [targetCompany, setTargetCompany] = useState('');
  const [targetRole, setTargetRole] = useState('');

  const hasApiKey = isMistralConfigured();

  // Concrete cross-network introductions, derived DETERMINISTICALLY from the
  // supply/demand matrix (which is already global across every cluster and
  // grounded in real contact skills/needs). Zero extra LLM call, zero
  // invention: for each need with both a demander and a supplier, we surface
  // the pairwise "introduce X to Y" that the matrix implies but never spelled
  // out. Works on archived analyses too (they carry supplyDemand).
  const recommendedIntros = useMemo(() => {
    const matrix = v3Result?.supplyDemand;
    if (!Array.isArray(matrix) || matrix.length === 0) return [];
    const contactById = new Map<string, any>((contacts || []).map(c => [c.id, c]));
    const roleOf = (id: string, fallbackName: string) => {
      const c = contactById.get(id);
      if (!c) return '';
      const bits = [c.job_title, c.company].filter((x: any) => typeof x === 'string' && x.trim() && x.trim().toLowerCase() !== 'null');
      return bits.join(' · ') || (fallbackName ? '' : '');
    };
    const pairs: { demander: { id: string; name: string }; supplier: { id: string; name: string }; demanderRole: string; supplierRole: string; need: string; opportunityForUser: boolean }[] = [];
    const seen = new Set<string>();
    for (const entry of matrix) {
      if (!entry || !Array.isArray(entry.demanders) || !Array.isArray(entry.suppliers)) continue;
      for (const d of entry.demanders) {
        for (const s of entry.suppliers) {
          if (!d?.id || !s?.id || d.id === s.id) continue; // never pair a contact with themselves
          const key = `${d.id}|${s.id}|${entry.need}`;
          if (seen.has(key)) continue;
          seen.add(key);
          pairs.push({
            demander: d,
            supplier: s,
            demanderRole: roleOf(d.id, d.name),
            supplierRole: roleOf(s.id, s.name),
            need: entry.need,
            opportunityForUser: Boolean(entry.opportunityForUser)
          });
        }
      }
    }
    // Surface the ones that also matter for the user first, cap the list so it
    // stays a shortlist of actionable intros rather than a combinatorial dump.
    return pairs
      .sort((a, b) => Number(b.opportunityForUser) - Number(a.opportunityForUser))
      .slice(0, 12);
  }, [v3Result, contacts]);

  useEffect(() => {
    if (user) {
      const metaProfile = user.user_metadata?.oracle_profile;
      const saved = localStorage.getItem(`circl_user_profile_${user.id}`);
      if (!metaProfile && !saved) {
        setShowProfilePopup(true);
      }
    }
  }, [user]);

  // Load cached V3 result on mount or contacts change
  useEffect(() => {
    if (contacts && contacts.length > 0) {
      const cached = getCachedMistralPipelineResult(contacts);
      if (cached && !pipelineRunning) {
        setV3Result(cached);
        setViewingArchiveId(null);
      }
    }
  }, [contacts]);

  const refreshHistory = async () => {
    setLoadingHistory(true);
    try {
      const entries = await listAnalysisHistory(selectedSpaceId ?? null);
      setHistory(entries);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    refreshHistory();
  }, [selectedSpaceId]);

  const handleViewArchivedAnalysis = async (id: string) => {
    setLoading(true);
    try {
      const archived = await getAnalysisById(id);
      if (!archived) {
        alert("Impossible de charger cette analyse archivée.");
        return;
      }
      setV3Result(archived);
      setViewingArchiveId(id);
      setActiveMode('network');
    } finally {
      setLoading(false);
    }
  };

  const handleReturnToLatest = () => {
    const cached = getCachedMistralPipelineResult(contacts);
    setV3Result(cached);
    setViewingArchiveId(null);
  };

  const handleDeleteArchivedAnalysis = async (id: string) => {
    if (!confirm("Supprimer définitivement cette analyse de l'historique ?")) return;
    try {
      await deleteAnalysis(id);
      setHistory(h => h.filter(e => e.id !== id));
      if (compareFromId === id) setCompareFromId('');
      if (compareToId === id) setCompareToId('');
    } catch (err: any) {
      alert(`Erreur lors de la suppression : ${err.message || err}`);
    }
  };

  const handleCompareAnalyses = async () => {
    if (!compareFromId || !compareToId || compareFromId === compareToId) {
      alert("Sélectionnez deux analyses différentes à comparer.");
      return;
    }
    setLoadingDelta(true);
    setDelta(null);
    try {
      const [before, after] = await Promise.all([
        getAnalysisById(compareFromId),
        getAnalysisById(compareToId)
      ]);
      if (!before || !after) {
        alert("Impossible de charger les deux analyses sélectionnées.");
        return;
      }
      const result = await compareAnalyses(before, after);
      setDelta(result);
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la comparaison des analyses.");
    } finally {
      setLoadingDelta(false);
    }
  };

  // V3 Pipeline trigger
  const triggerV3Pipeline = async (forceRefresh = false) => {
    setPipelineRunning(true);
    setPipelineProgress(0);
    setLoading(true);
    setViewingArchiveId(null);

    if (forceRefresh) {
      const keys = Object.keys(localStorage).filter(k => k.startsWith('circl_mistral_v7_'));
      keys.forEach(k => localStorage.removeItem(k));
    }

    try {
      const userProfile = loadUserProfile(user);
      const result = await runMistralOracleBatchPipeline(
        contacts,
        notes,
        userProfile,
        (progress) => {
          setPipelineProgress(progress);
        },
        { ownerId: user.id, spaceId: selectedSpaceId ?? null }
      );
      setV3Result(result);
      refreshHistory();
    } catch (err: any) {
      console.error(err);
      const message = err?.message || 'erreur inconnue';
      const isRateLimit = /429|rate.?limit/i.test(message);
      alert(
        `Erreur lors de l'analyse Mistral AI : ${message}.\n\n` +
        (isRateLimit
          ? "Le compte Mistral a atteint sa limite de requêtes par minute — ça arrive surtout sur un gros réseau (beaucoup de lots à analyser d'affilée). L'analyse a déjà réessayé plusieurs fois automatiquement avant d'abandonner. Réessayez dans quelques minutes, ou vérifiez le palier de votre clé API Mistral si ça persiste."
          : "Si l'analyse a mis longtemps avant d'échouer, réessayez, ou réduisez le périmètre analysé (un espace précis plutôt que \"Toutes les galaxies\").")
      );
    } finally {
      setPipelineRunning(false);
      setLoading(false);
    }
  };

  const triggerWarmIntroSearch = async () => {
    if (!targetCompany.trim() || !targetRole.trim()) {
      alert("Renseignez l'entreprise et le poste cible.");
      return;
    }
    setLoading(true);
    try {
      const res = await suggestWarmIntros(contacts, targetCompany, targetRole);
      setIntros(res);
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la recherche de Warm Intros.");
    } finally {
      setLoading(false);
    }
  };

  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const handleCopyEmail = (email: string, index: number) => {
    navigator.clipboard.writeText(email);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Analyse IA</h2>
          <p style={styles.subtitle}>Mistral Large - Map/Reduce</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button 
            className="glass-button" 
            onClick={() => setShowProfilePopup(true)}
            style={{ fontSize: '0.8rem', padding: '6px 14px', whiteSpace: 'nowrap' }}
          >
            Profil
          </button>
          <button 
            className="glow-button primary" 
            onClick={() => triggerV3Pipeline(true)}
            disabled={loading || contacts.length === 0}
            style={{ whiteSpace: 'nowrap' }}
          >
            {loading ? 'Analyse...' : 'Lancer l\'analyse'}
          </button>
        </div>
      </div>

      {/* API Key Missing State */}
      {!hasApiKey && (
        <div className="glass-card" style={styles.setupCard}>
          <Key size={36} color="var(--teal)" style={{ marginBottom: 12 }} />
          <h3>Clé API Mistral Requise</h3>
          <p style={styles.setupDesc}>
            Pour activer le cerveau IA de l'application, vous devez fournir votre clé Mistral AI.
          </p>
          <div style={styles.setupInstructions}>
            <p>1. Allez sur <a href="https://console.mistral.ai/" target="_blank" rel="noreferrer" style={{ color: 'var(--neon-blue)' }}>Mistral Console</a> et créez une clé API.</p>
            <p>2. Dans les paramètres de votre projet Vercel, ajoutez la variable d'environnement <code>MISTRAL_API_KEY</code> (sans préfixe <code>VITE_</code> — elle reste côté serveur et n'est jamais exposée au navigateur).</p>
            <p>3. Redéployez l'application.</p>
          </div>
        </div>
      )}

      {hasApiKey && (
        <>
          {/* Tabs Nav */}
          <div style={styles.tabsNav}>
            <button 
              onClick={() => setActiveMode('network')} 
              style={{ ...styles.tabBtn, ...(activeMode === 'network' ? styles.tabBtnActive : {}) }}
            >
              <Brain size={16} />
              Synthèse Globale (Reduce)
            </button>
            <button
              onClick={() => setActiveMode('market')}
              style={{ ...styles.tabBtn, ...(activeMode === 'market' ? styles.tabBtnActive : {}) }}
            >
              <Scale size={16} />
              Offre / Demande
            </button>
            <button
              onClick={() => setActiveMode('opportunities')}
              style={{ ...styles.tabBtn, ...(activeMode === 'opportunities' ? styles.tabBtnActive : {}) }}
            >
              <Workflow size={16} />
              Résultats par Lots (Map)
            </button>
            <button
              onClick={() => setActiveMode('intros')}
              style={{ ...styles.tabBtn, ...(activeMode === 'intros' ? styles.tabBtnActive : {}) }}
            >
              <Target size={16} />
              Warm Intros
            </button>
            <button
              onClick={() => setActiveMode('history')}
              style={{ ...styles.tabBtn, ...(activeMode === 'history' ? styles.tabBtnActive : {}) }}
            >
              <History size={16} />
              Historique
            </button>
          </div>

          <div style={styles.tabContentContainer}>
            {/* PROGRESS OVERLAY */}
            {pipelineRunning && (
              <div style={styles.progressOverlay}>
                <div style={styles.progressModal}>
                  <div style={styles.spinnerWrapper}>
                    <div style={styles.spinnerPulse}></div>
                    <Brain size={32} color="var(--neon-blue)" style={{ position: 'relative', zIndex: 2 }} />
                  </div>
                  <h3 style={{ margin: '16px 0 8px 0' }}>Analyse Mistral Map-Reduce...</h3>
                  <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: '0.9rem', textAlign: 'center' }}>
                    Le réseau est cartographié sémantiquement puis découpé en lots cohérents. Chaque lot est analysé, puis une synthèse globale est générée. Ça peut prendre jusqu'à une minute sur un grand réseau.
                  </p>
                  
                  <div style={styles.progressBarBg}>
                    <div style={{ ...styles.progressBarFill, width: `${pipelineProgress}%` }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    <span>Traitement</span>
                    <span>{Math.round(pipelineProgress)}%</span>
                  </div>
                </div>
              </div>
            )}

            {/* 1. SYNTHESIS TAB */}
            {activeMode === 'network' && (
              <div style={styles.tabContent}>
                {!v3Result ? (
                  <div style={styles.emptyState}>
                    <Workflow size={48} color="rgba(27, 23, 37, 0.1)" />
                    <h3>Aucune analyse Mistral V4</h3>
                    <p>Cliquez sur "Lancer l'Analyse Globale" pour démarrer.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

                    {v3Result.dataQuality && v3Result.dataQuality.excluded > 0 && (
                      <div style={{
                        display: 'flex', flexDirection: 'column', gap: 10,
                        padding: '12px 20px', borderRadius: 8,
                        background: 'rgba(27, 23, 37, 0.03)', border: '1px solid var(--border)'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                          <Lock size={15} style={{ marginTop: 2, flexShrink: 0, color: 'var(--text-muted)' }} />
                          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5, flex: 1 }}>
                            Analyse concentrée sur <b style={{ color: 'var(--text-primary)' }}>{v3Result.dataQuality.analyzed} contact(s) suffisamment renseignés</b>.
                            {' '}{v3Result.dataQuality.excluded} contact(s) ont été écartés faute d'informations exploitables (nom seul, sans poste, entreprise, compétences ni notes) — enrichissez-les pour les inclure dans une prochaine analyse.
                          </span>
                          {v3Result.dataQuality.excludedContacts && v3Result.dataQuality.excludedContacts.length > 0 && (
                            <button
                              onClick={() => setShowExcludedList(s => !s)}
                              className="glass-button"
                              style={{ fontSize: '0.72rem', padding: '4px 10px', whiteSpace: 'nowrap', flexShrink: 0 }}
                            >
                              {showExcludedList ? 'Masquer' : 'Voir qui enrichir'}
                            </button>
                          )}
                        </div>
                        {showExcludedList && v3Result.dataQuality.excludedContacts && (
                          <div style={{
                            display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 180, overflowY: 'auto',
                            paddingTop: 10, borderTop: '1px solid var(--border)'
                          }}>
                            {v3Result.dataQuality.excludedContacts.map(c => (
                              <button
                                key={c.id}
                                onClick={() => onViewContact?.(c.name)}
                                disabled={!onViewContact}
                                title={onViewContact ? `Ouvrir la fiche de ${c.name}` : c.name}
                                style={{
                                  fontSize: '0.75rem', padding: '3px 10px', borderRadius: 99,
                                  background: 'rgba(27, 23, 37, 0.05)', border: '1px solid var(--border-hover)',
                                  color: 'var(--text-primary)', cursor: onViewContact ? 'pointer' : 'default'
                                }}
                              >
                                {c.name}
                              </button>
                            ))}
                            {v3Result.dataQuality.excluded > v3Result.dataQuality.excludedContacts.length && (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '3px 4px' }}>
                                + {v3Result.dataQuality.excluded - v3Result.dataQuality.excludedContacts.length} autre(s)
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {v3Result.analysisAngles && v3Result.analysisAngles.length > 0 ? (
                      <div style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        padding: '12px 20px', borderRadius: 8,
                        background: 'rgba(27, 23, 37, 0.03)', border: '1px solid var(--border)'
                      }}>
                        <Target size={15} style={{ marginTop: 2, flexShrink: 0, color: 'var(--text-muted)' }} />
                        <div>
                          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                            Leviers d'analyse utilisés (dérivés de votre profil) :
                          </span>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                            {v3Result.analysisAngles.map((angle, i) => (
                              <span key={i} style={{
                                fontSize: '0.75rem', padding: '3px 10px', borderRadius: 99,
                                background: 'rgba(27, 23, 37, 0.05)', border: '1px solid var(--border-hover)',
                                color: 'var(--text-primary)'
                              }}>
                                {angle}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '12px 20px', borderRadius: 8,
                        background: 'rgba(27, 23, 37, 0.03)', border: '1px solid var(--border)'
                      }}>
                        <Target size={15} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                          Leviers d'analyse génériques utilisés — complétez votre profil (poste, compétences, projets, besoins) pour des leviers personnalisés à votre activité.
                        </span>
                        <button
                          onClick={() => setShowProfilePopup(true)}
                          className="glass-button"
                          style={{ fontSize: '0.72rem', padding: '4px 10px', whiteSpace: 'nowrap', marginLeft: 'auto' }}
                        >
                          Compléter mon profil
                        </button>
                      </div>
                    )}

                    {viewingArchiveId && (
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                        padding: '12px 20px', borderRadius: 8,
                        background: 'rgba(27, 23, 37, 0.04)', border: '1px solid var(--border-hover)'
                      }}>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                          <History size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                          Vous consultez une analyse archivée
                          {(() => {
                            const entry = history.find(h => h.id === viewingArchiveId);
                            return entry ? ` du ${new Date(entry.createdAt).toLocaleString('fr-FR')}` : '';
                          })()}.
                        </span>
                        <button className="glass-button" onClick={handleReturnToLatest} style={{ fontSize: '0.75rem', padding: '4px 12px', whiteSpace: 'nowrap' }}>
                          Revenir à la dernière analyse
                        </button>
                      </div>
                    )}

                    {/* Synthèse */}
                    <div className="glass-card" style={{ padding: 32, background: 'linear-gradient(145deg, rgba(27, 23, 37, 0.04) 0%, rgba(27, 23, 37, 0.01) 100%)', border: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                        <Brain size={24} color="var(--text-primary)" />
                        <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Force du Réseau</h3>
                      </div>
                      <p style={{ fontSize: '1.05rem', color: 'var(--text-primary)', lineHeight: 1.6 }}>
                        {v3Result.synthesis.networkStrength}
                      </p>
                    </div>

                    {/* Contacts-Ponts */}
                    {v3Result.bridgeContacts && v3Result.bridgeContacts.length > 0 && (
                      <div>
                        <h3 style={styles.sectionTitle}>
                          <Share2 size={18} /> Contacts-Ponts Stratégiques
                        </h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 16 }}>
                          Ces contacts relient des groupes autrement séparés de votre réseau — les meilleurs candidats pour des introductions à fort impact.
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                          {v3Result.bridgeContacts.map((b, i) => {
                            const isLocked = b.role === 'Verrouillé';
                            return (
                            <div key={i} className="glass-card" style={{ padding: 16 }}>
                              <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{b.name}</div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: isLocked ? 'var(--text-secondary)' : 'var(--text-secondary)', marginBottom: 10 }}>
                                {isLocked ? (<><Lock size={12} /> Accès non accordé — consultez ce contact pour le demander</>) : `${b.role} · ${b.company}`}
                              </div>
                              <div style={{ height: 4, background: 'rgba(27, 23, 37, 0.08)', borderRadius: 99, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${Math.round(b.centralityScore * 100)}%`, background: 'var(--accent)', borderRadius: 99 }} />
                              </div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5, fontFamily: 'var(--font-mono)' }}>
                                Score de connexion : {Math.round(b.centralityScore * 100)}%
                              </div>
                            </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Thèmes Globaux */}
                    <div>
                      <h3 style={styles.sectionTitle}>
                        <Target size={18} /> Thèmes Dominants
                      </h3>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                        {v3Result.synthesis.globalThemes.map((theme, i) => (
                          <div key={i} style={styles.pill}>
                            {theme}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Macro-Besoins */}
                    {v3Result.synthesis.macroNeeds && v3Result.synthesis.macroNeeds.length > 0 && (
                      <div>
                        <h3 style={styles.sectionTitle}>
                          <Target size={18} /> Macro-Besoins Consolidés
                        </h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                          {v3Result.synthesis.macroNeeds.map((mn, i) => (
                            <div key={i} className="glass-card" style={{ padding: 20 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 8 }}>
                                <h4 style={{ color: 'var(--text-primary)', margin: 0, fontSize: '1rem' }}>{mn.label}</h4>
                                <span style={{
                                  fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', padding: '3px 8px', borderRadius: 5, flexShrink: 0,
                                  color: mn.priority === 'high' ? '#ffffff' : mn.priority === 'medium' ? 'var(--text-primary)' : 'var(--text-muted)',
                                  background: mn.priority === 'high' ? 'var(--accent)' : mn.priority === 'medium' ? 'rgba(27, 23, 37, 0.1)' : 'rgba(27, 23, 37, 0.04)',
                                  border: mn.priority === 'low' ? '1px solid var(--border)' : 'none'
                                }}>{mn.priority}</span>
                              </div>
                              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 8 }}>
                                {mn.affectedContactsCount} contact(s) concerné(s) · fusionne : {mn.mergedFrom.join(', ')}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Chaînes de Valeur */}
                    {v3Result.synthesis.valueChains && v3Result.synthesis.valueChains.length > 0 && (
                      <div>
                        <h3 style={styles.sectionTitle}>
                          <Workflow size={18} /> Chaînes de Valeur Globales
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                          {v3Result.synthesis.valueChains.map((vc, i) => (
                            <div key={i} className="glass-card" style={{ padding: 20 }}>
                              <h4 style={{ color: 'var(--text-primary)', marginBottom: 4, fontSize: '1.05rem' }}>{vc.title}</h4>
                              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 12 }}>{vc.description}</p>
                              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                {vc.chain.map((link, j) => (
                                  <React.Fragment key={j}>
                                    <div style={{ padding: '6px 12px', background: 'rgba(27, 23, 37, 0.04)', border: '1px solid var(--border)', borderRadius: 7, fontSize: '0.8rem' }}>
                                      <b style={{ color: 'var(--text-primary)' }}>{link.contactName}</b>
                                      <span style={{ color: 'var(--text-muted)' }}> ({link.role})</span>
                                      <div style={{ color: 'var(--text-secondary)' }}>{link.contribution}</div>
                                    </div>
                                    {j < vc.chain.length - 1 && <span style={{ color: 'var(--text-muted)' }}>→</span>}
                                  </React.Fragment>
                                ))}
                              </div>
                              <div style={styles.impactBadge}>
                                Impact : {vc.estimatedImpact}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Synergies Cross-Batch */}
                    <div>
                      <h3 style={styles.sectionTitle}>
                        <Zap size={18} /> Synergies Globales Croisées
                      </h3>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                        {v3Result.synthesis.crossBatchSynergies.map((syn, i) => (
                          <div key={i} className="glass-card" style={{ padding: 20 }}>
                            <h4 style={{ color: 'var(--text-primary)', marginBottom: 8, fontSize: '1.05rem' }}>{syn.theme}</h4>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 12 }}>{syn.description}</p>
                            <div style={styles.impactBadge}>
                              Impact : {syn.potentialImpact}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Mises en relation concrètes dérivées de l'offre/demande */}
                    {recommendedIntros.length > 0 && (
                      <div>
                        <h3 style={styles.sectionTitle}>
                          <ArrowRight size={18} /> Mises en Relation à Fort Potentiel
                        </h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 16 }}>
                          Paires concrètes déduites de la matrice offre / demande : un contact exprime un besoin, un autre peut y répondre. Ce sont les introductions les plus directes à provoquer.
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
                          {recommendedIntros.map((intro, i) => (
                            <div key={i} className="glass-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: '0.9rem' }}>
                                <b style={{ color: 'var(--text-primary)' }}>{intro.supplier.name}</b>
                                <ArrowRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                                <b style={{ color: 'var(--text-primary)' }}>{intro.demander.name}</b>
                                {intro.opportunityForUser && (
                                  <span style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4, background: 'var(--accent)', color: '#ffffff' }}>
                                    Pour vous
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                                <b style={{ color: 'var(--text-primary)' }}>{intro.demander.name}</b>
                                {intro.demanderRole ? ` (${intro.demanderRole})` : ''} recherche : <span style={{ color: 'var(--text-primary)' }}>{intro.need}</span>.
                                {' '}<b style={{ color: 'var(--text-primary)' }}>{intro.supplier.name}</b>
                                {intro.supplierRole ? ` (${intro.supplierRole})` : ''} peut y répondre.
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Portes à Explorer — pôles denses mais hors-profil */}
                    {v3Result.synthesis.emergingOpportunities && v3Result.synthesis.emergingOpportunities.length > 0 && (
                      <div>
                        <h3 style={styles.sectionTitle}>
                          <Compass size={18} /> Portes à Explorer
                        </h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 16 }}>
                          Des pôles denses dans votre réseau qui ne collent pas à vos leviers actuels — mais qui pourraient vous ouvrir une direction nouvelle. Chacun s'appuie sur plusieurs contacts réels partageant ce thème.
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                          {v3Result.synthesis.emergingOpportunities.map((op, i) => (
                            <div key={i} className="glass-card" style={{ padding: 20 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <h4 style={{ color: 'var(--text-primary)', margin: 0, fontSize: '1.05rem' }}>{op.theme}</h4>
                                <span style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4, background: 'rgba(27, 23, 37, 0.06)', color: 'var(--text-muted)', border: '1px solid var(--border)', flexShrink: 0 }}>
                                  Hors-profil
                                </span>
                              </div>
                              {op.description && (
                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 10 }}>{op.description}</p>
                              )}
                              {op.anchorContacts.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                                  {op.anchorContacts.map((c, j) => (
                                    <span
                                      key={j}
                                      onClick={() => onViewContact?.(c.name)}
                                      style={{ padding: '3px 9px', background: 'rgba(27, 23, 37, 0.04)', border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.78rem', color: 'var(--text-primary)', cursor: onViewContact ? 'pointer' : 'default' }}
                                    >
                                      {c.name}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {op.whyNewDoor && (
                                <div style={{ ...styles.impactBadge, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                                  <Compass size={13} style={{ flexShrink: 0, marginTop: 2 }} /> {op.whyNewDoor}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Plan d'action */}
                    <div className="glass-card" style={{ padding: 24, borderColor: 'var(--border-hover)' }}>
                      <h3 style={styles.sectionTitle}>
                        <Award size={18} /> Plan d'Action Recommandé
                      </h3>
                      <ul style={{ paddingLeft: 20, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                        {v3Result.synthesis.recommendedActionPlan.map((action, i) => (
                          <li key={i} style={{ marginBottom: 8 }}>{action}</li>
                        ))}
                      </ul>
                    </div>

                  </div>
                )}
              </div>
            )}

            {/* 1b. SUPPLY / DEMAND TAB */}
            {activeMode === 'market' && (
              <div style={styles.tabContent}>
                {!v3Result ? (
                  <div style={styles.emptyState}>
                    <Scale size={48} color="rgba(27, 23, 37, 0.1)" />
                    <h3>Aucune matrice Offre / Demande</h3>
                    <p>Lancez l'analyse pour cartographier qui demande quoi et qui peut le fournir dans votre réseau.</p>
                  </div>
                ) : v3Result.supplyDemand && v3Result.supplyDemand.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                      Pour chaque besoin détecté, qui le <b>demande</b> et qui peut le <b>fournir</b>. Les lignes marquées comme opportunités sont celles où vous êtes le mieux placé pour créer de la valeur.
                    </p>
                    <SupplyDemandMatrix
                      data={v3Result.supplyDemand}
                      userName={loadUserProfile(user)?.name || user?.user_metadata?.full_name || 'Vous'}
                    />
                  </div>
                ) : (
                  <div style={styles.emptyState}>
                    <Scale size={48} color="rgba(27, 23, 37, 0.1)" />
                    <h3>Aucune correspondance offre / demande détectée</h3>
                    <p>Enrichissez vos contacts (compétences & besoins) pour alimenter cette matrice, puis relancez l'analyse.</p>
                  </div>
                )}
              </div>
            )}

            {/* 2. BATCHES TAB */}
            {activeMode === 'opportunities' && (
              <div style={styles.tabContent}>
                {!v3Result ? (
                  <div style={styles.emptyState}>
                    <Workflow size={48} color="rgba(27, 23, 37, 0.1)" />
                    <h3>Aucune analyse Mistral V4</h3>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: 0 }}>
                        L'algorithme a découpé votre réseau en {v3Result.batches.length} lots. Voici les détails extraits pour chaque groupe.
                      </p>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        <input type="checkbox" checked={hideWeakSynergies} onChange={e => setHideWeakSynergies(e.target.checked)} />
                        Masquer les synergies à faible confiance
                      </label>
                    </div>

                    {v3Result.batches.map((batch, i) => (
                      <div key={i} className="glass-card" style={{ padding: 24, borderLeft: '3px solid var(--border-hover)' }}>
                        <h3 style={{ margin: '0 0 16px 0', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '1rem' }}>Lot d'Analyse #{i + 1}</h3>

                        <div style={{ marginBottom: 16 }}>
                          <span style={styles.eyebrow}>Besoins Récurrents</span>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                            {batch.recurrentNeeds.map((need, j) => (
                              <span key={j} style={{ padding: '4px 10px', background: 'rgba(27, 23, 37, 0.05)', border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{need}</span>
                            ))}
                          </div>
                        </div>

                        {(() => {
                          const visibleSynergies = hideWeakSynergies
                            ? batch.immediateSynergies.filter(s => s.confidence !== 'low')
                            : batch.immediateSynergies;
                          const hiddenCount = batch.immediateSynergies.length - visibleSynergies.length;
                          if (batch.immediateSynergies.length === 0) return null;
                          return (
                            <div style={{ marginBottom: 16 }}>
                              <span style={styles.eyebrow}>Synergies Immédiates</span>
                              {visibleSynergies.length === 0 ? (
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 8 }}>
                                  {hiddenCount} synergie(s) à faible confiance masquée(s).
                                </p>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                                  {visibleSynergies.map((syn, j) => (
                                    <div key={j} style={{ padding: 12, background: 'rgba(27, 23, 37, 0.03)', borderRadius: 8, border: '1px solid var(--border)' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                          {syn.contactName1} <span style={{ color: 'var(--text-muted)' }}>&</span> {syn.contactName2}
                                        </div>
                                        <span style={{
                                          fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 4, flexShrink: 0,
                                          color: syn.confidence === 'high' ? '#ffffff' : syn.confidence === 'medium' ? 'var(--text-primary)' : 'var(--text-muted)',
                                          background: syn.confidence === 'high' ? 'var(--accent)' : syn.confidence === 'medium' ? 'rgba(27, 23, 37, 0.1)' : 'rgba(27, 23, 37, 0.04)',
                                          border: syn.confidence === 'low' ? '1px solid var(--border)' : 'none'
                                        }}>
                                          {syn.confidence === 'high' ? 'Confiance forte' : syn.confidence === 'medium' ? 'Confiance moyenne' : 'Confiance faible'}
                                        </span>
                                      </div>
                                      <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{syn.reason}</div>
                                      {syn.evidence && (
                                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 6, fontStyle: 'italic' }}>
                                          « {syn.evidence} »
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                  {hiddenCount > 0 && (
                                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
                                      + {hiddenCount} synergie(s) à faible confiance masquée(s).
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        <div>
                          <span style={styles.eyebrow}>Mots-Clés</span>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                            {batch.keyCompetencies.map((comp, j) => (
                              <span key={j} style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>#{comp}</span>
                            ))}
                          </div>
                        </div>

                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 3. WARM INTROS TAB */}
            {activeMode === 'intros' && (
              <div style={styles.tabContent}>
                <div className="glass-card" style={styles.searchCard}>
                  <h3 style={{ marginBottom: 16 }}>Recherche d'Introduction (Warm Intro)</h3>
                  <div style={styles.searchForm}>
                    <input 
                      type="text" 
                      placeholder="Entreprise cible (ex: Stripe)" 
                      value={targetCompany}
                      onChange={e => setTargetCompany(e.target.value)}
                      style={styles.searchInput}
                    />
                    <input 
                      type="text" 
                      placeholder="Poste cible (ex: CTO, Marketing Director)" 
                      value={targetRole}
                      onChange={e => setTargetRole(e.target.value)}
                      style={styles.searchInput}
                    />
                    <button 
                      className="glow-button" 
                      onClick={triggerWarmIntroSearch}
                      disabled={loading || contacts.length === 0}
                      style={{ padding: '0 24px' }}
                    >
                      {loading ? 'Recherche...' : 'Trouver un chemin'}
                    </button>
                  </div>
                </div>

                {intros.length > 0 && (
                  <div style={styles.resultsGrid}>
                    {intros.map((intro, idx) => (
                      <div key={idx} className="glass-card" style={styles.introCard}>
                        <div style={styles.introHeader}>
                          <div style={styles.connectorAvatar}>
                            {intro.connectorName.charAt(0)}
                          </div>
                          <div>
                            <div style={styles.connectorName}>{intro.connectorName}</div>
                            <div style={styles.introTarget}>Cible: {intro.targetName} ({intro.targetCompany})</div>
                          </div>
                          <div style={styles.closenessBadge}>Force : {intro.connectorCloseness}/5</div>
                        </div>
                        <p style={styles.introReason}>{intro.reason}</p>
                        
                        <div style={styles.emailContainer}>
                          <div style={styles.emailHeader}>
                            <span>Brouillon d'e-mail d'intro</span>
                            <button onClick={() => handleCopyEmail(intro.introEmailDraft, idx)} style={styles.copyBtn}>
                              {copiedIndex === idx ? <Check size={14} /> : <Copy size={14} />}
                              {copiedIndex === idx ? 'Copié' : 'Copier'}
                            </button>
                          </div>
                          <div style={styles.emailBody}>
                            {intro.introEmailDraft}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 4. HISTORY & DELTA TAB */}
            {activeMode === 'history' && (
              <div style={styles.tabContent}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

                  {/* Delta comparison */}
                  <div className="glass-card" style={{ padding: 24 }}>
                    <h3 style={styles.sectionTitle}>
                      <GitCompare size={18} /> Comparer deux analyses
                    </h3>
                    {history.length < 2 ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        Il faut au moins 2 analyses archivées pour comparer leur évolution.
                      </p>
                    ) : (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                          <select
                            value={compareFromId}
                            onChange={e => setCompareFromId(e.target.value)}
                            style={styles.historySelect}
                          >
                            <option value="">Analyse de départ...</option>
                            {history.map(h => (
                              <option key={h.id} value={h.id}>
                                {h.label || new Date(h.createdAt).toLocaleString('fr-FR')} ({h.contactCount} contacts)
                              </option>
                            ))}
                          </select>
                          <ArrowRight size={18} color="var(--text-muted)" />
                          <select
                            value={compareToId}
                            onChange={e => setCompareToId(e.target.value)}
                            style={styles.historySelect}
                          >
                            <option value="">Analyse d'arrivée...</option>
                            {history.map(h => (
                              <option key={h.id} value={h.id}>
                                {h.label || new Date(h.createdAt).toLocaleString('fr-FR')} ({h.contactCount} contacts)
                              </option>
                            ))}
                          </select>
                          <button
                            className="glow-button primary"
                            onClick={handleCompareAnalyses}
                            disabled={loadingDelta || !compareFromId || !compareToId}
                            style={{ whiteSpace: 'nowrap' }}
                          >
                            {loadingDelta ? 'Comparaison...' : 'Voir l\'évolution'}
                          </button>
                        </div>

                        {delta && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 8 }}>
                            <p style={{ fontSize: '1rem', color: 'var(--text-primary)', lineHeight: 1.6 }}>
                              {delta.networkEvolutionSummary}
                            </p>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
                              {delta.newThemes.length > 0 && (
                                <div>
                                  <span style={styles.eyebrow}>Nouveaux thèmes</span>
                                  <ul style={{ paddingLeft: 18, marginTop: 8, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                    {delta.newThemes.map((t, i) => <li key={i}>{t}</li>)}
                                  </ul>
                                </div>
                              )}
                              {delta.resolvedThemes.length > 0 && (
                                <div>
                                  <span style={styles.eyebrow}>Thèmes résolus / disparus</span>
                                  <ul style={{ paddingLeft: 18, marginTop: 8, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                    {delta.resolvedThemes.map((t, i) => <li key={i}>{t}</li>)}
                                  </ul>
                                </div>
                              )}
                              {delta.newMacroNeeds.length > 0 && (
                                <div>
                                  <span style={styles.eyebrow}>Nouveaux macro-besoins</span>
                                  <ul style={{ paddingLeft: 18, marginTop: 8, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                    {delta.newMacroNeeds.map((t, i) => <li key={i}>{t}</li>)}
                                  </ul>
                                </div>
                              )}
                              {delta.emergingSynergies.length > 0 && (
                                <div>
                                  <span style={styles.eyebrow}>Synergies émergentes</span>
                                  <ul style={{ paddingLeft: 18, marginTop: 8, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                    {delta.emergingSynergies.map((t, i) => <li key={i}>{t}</li>)}
                                  </ul>
                                </div>
                              )}
                              {delta.bridgeContactChanges.length > 0 && (
                                <div>
                                  <span style={styles.eyebrow}>Connecteurs clés</span>
                                  <ul style={{ paddingLeft: 18, marginTop: 8, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                    {delta.bridgeContactChanges.map((t, i) => <li key={i}>{t}</li>)}
                                  </ul>
                                </div>
                              )}
                            </div>

                            {delta.recommendedNextSteps.length > 0 && (
                              <div className="glass-card" style={{ padding: 20, borderColor: 'var(--border-hover)' }}>
                                <h4 style={{ color: 'var(--text-primary)', marginBottom: 12, fontSize: '0.95rem' }}>Prochaines étapes recommandées</h4>
                                <ul style={{ paddingLeft: 20, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                                  {delta.recommendedNextSteps.map((s, i) => <li key={i} style={{ marginBottom: 6 }}>{s}</li>)}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* History list */}
                  <div>
                    <h3 style={styles.sectionTitle}>
                      <History size={18} /> Analyses archivées
                    </h3>
                    {loadingHistory ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Chargement...</p>
                    ) : history.length === 0 ? (
                      <div style={styles.emptyState}>
                        <History size={48} color="rgba(27, 23, 37, 0.1)" />
                        <h3>Aucune analyse archivée</h3>
                        <p>Chaque analyse complète que vous lancez est automatiquement sauvegardée ici.</p>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {history.map(h => (
                          <div
                            key={h.id}
                            className="glass-card"
                            style={{
                              padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                              borderLeft: viewingArchiveId === h.id ? '3px solid #fff' : '3px solid transparent'
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                                {h.label || new Date(h.createdAt).toLocaleString('fr-FR')}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                                {new Date(h.createdAt).toLocaleString('fr-FR')} · {h.contactCount} contacts
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                              <button className="glass-button" onClick={() => handleViewArchivedAnalysis(h.id)} style={{ fontSize: '0.75rem', padding: '4px 12px' }}>
                                Consulter
                              </button>
                              <button
                                onClick={() => handleDeleteArchivedAnalysis(h.id)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
                                title="Supprimer"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Incremental analysis stats */}
      {v3Result && v3Result.cacheStats && v3Result.cacheStats.totalBatches > 0 && (
        <div style={{ marginTop: 32, padding: 12, borderRadius: 8, background: 'rgba(27, 23, 37, 0.03)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
          <span style={{ color: 'var(--text-muted)' }}>Analyse incrémentale :</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
            {v3Result.cacheStats.reusedBatches}/{v3Result.cacheStats.totalBatches} lots réutilisés du cache
          </span>
          {v3Result.cacheStats.reusedBatches === v3Result.cacheStats.totalBatches && (
            <span style={{ color: 'var(--text-muted)' }}>— rien n'a changé depuis la dernière analyse</span>
          )}
        </div>
      )}

      {/* API Cost Tracker */}
      {v3Result && v3Result.synthesis && v3Result.synthesis.tokenUsage && (
        <div style={{ marginTop: 32, padding: 12, borderRadius: 8, background: 'rgba(27, 23, 37, 0.03)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, border: '1px solid var(--border)', fontFamily: 'var(--font-mono)' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            <b style={{ color: 'var(--text-secondary)' }}>Consommation API (Mistral Large) :</b> {v3Result.synthesis.tokenUsage.totalTokens.toLocaleString()} jetons
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>|</div>
          <div style={{ color: 'var(--text-primary)', fontSize: '0.8rem', fontWeight: 600 }}>
            Coût estimé : ${(v3Result.synthesis.tokenUsage.totalTokens / 1000000 * 0.2).toFixed(4)}
          </div>
        </div>
      )}

      {showProfilePopup && (
        <UserProfilePopup 
          userId={user?.id || 'default'} 
          onClose={() => setShowProfilePopup(false)} 
          onSave={() => {}} 
        />
      )}
    </div>
  );
};

// =========================================================================
// Styles
// =========================================================================
const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    width: '100%',
    overflowY: 'auto',
    padding: '30px',
  },
  header: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 24,
    background: 'rgba(27, 23, 37, 0.02)',
    padding: '20px 24px',
    borderRadius: 12,
    border: '1px solid var(--border)',
  },
  sectionTitle: {
    color: 'var(--text-primary)',
    marginBottom: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: '1rem',
    fontWeight: 600,
  },
  eyebrow: {
    fontSize: '0.72rem',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: 'var(--text-muted)',
    fontWeight: 700,
  },
  pill: {
    padding: '8px 16px',
    background: 'rgba(27, 23, 37, 0.05)',
    border: '1px solid var(--border)',
    borderRadius: 24,
    color: 'var(--text-primary)',
    fontSize: '0.85rem',
  },
  impactBadge: {
    display: 'inline-block',
    background: 'rgba(27, 23, 37, 0.08)',
    color: 'var(--text-primary)',
    padding: '4px 10px',
    borderRadius: 6,
    fontSize: '0.8rem',
    fontWeight: 600,
    border: '1px solid var(--border)',
  },
  titleContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  iconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 12,
    background: 'var(--neon-blue)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    margin: 0,
    fontSize: '1.5rem',
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  subtitle: {
    margin: '4px 0 0 0',
    color: 'var(--text-secondary)',
    fontSize: '0.9rem',
  },
  setupCard: {
    padding: 40,
    textAlign: 'center',
    maxWidth: 600,
    margin: '40px auto',
    background: 'var(--bg-card)',
  },
  setupDesc: {
    color: 'var(--text-secondary)',
    lineHeight: 1.6,
    marginBottom: 24,
  },
  setupInstructions: {
    textAlign: 'left',
    background: 'var(--bg-input)',
    padding: 24,
    borderRadius: 8,
    color: 'var(--text-secondary)',
    lineHeight: 1.8,
  },
  tabsNav: {
    display: 'flex',
    gap: 12,
    marginBottom: 24,
    borderBottom: '1px solid rgba(27, 23, 37, 0.1)',
    paddingBottom: 16,
    overflowX: 'auto',
    maxWidth: '100%',
  },
  tabBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    flexShrink: 0,
    padding: '8px 16px',
    fontSize: '0.95rem',
    fontWeight: 600,
    cursor: 'pointer',
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    transition: 'all 0.2s ease',
  },
  tabBtnActive: {
    background: 'rgba(27, 23, 37, 0.08)',
    color: 'var(--text-primary)',
  },
  tabContentContainer: {
    position: 'relative',
    minHeight: 400,
  },
  progressOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(250, 249, 251, 0.85)',
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  progressModal: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border-glow)',
    padding: 32,
    borderRadius: 16,
    width: 400,
    textAlign: 'center',
    boxShadow: '0 20px 40px rgba(27, 23, 37, 0.14)',
  },
  spinnerWrapper: {
    position: 'relative',
    width: 64,
    height: 64,
    margin: '0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinnerPulse: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: '50%',
    border: '2px solid var(--neon-blue)',
    animation: 'ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite',
  },
  progressBarBg: {
    height: 6,
    background: 'rgba(27, 23, 37, 0.1)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    background: 'var(--neon-blue)',
    transition: 'width 0.3s ease',
  },
  tabContent: {
    animation: 'fadeIn 0.3s ease',
  },
  emptyState: {
    padding: 80,
    textAlign: 'center',
    color: 'var(--text-muted)',
    background: 'rgba(27, 23, 37, 0.01)',
    borderRadius: 16,
    border: '1px dashed rgba(27, 23, 37, 0.1)',
  },
  searchCard: {
    padding: 24,
    marginBottom: 24,
  },
  searchForm: {
    display: 'flex',
    gap: 16,
  },
  searchInput: {
    flex: 1,
    background: 'var(--bg-input)',
    border: '1px solid rgba(27, 23, 37, 0.1)',
    padding: '12px 16px',
    borderRadius: 8,
    color: 'var(--text-primary)',
    fontSize: '0.95rem',
  },
  historySelect: {
    background: 'var(--bg-input)',
    border: '1px solid rgba(27, 23, 37, 0.1)',
    padding: '10px 14px',
    borderRadius: 8,
    color: 'var(--text-primary)',
    fontSize: '0.85rem',
    minWidth: 220,
  },
  resultsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))',
    gap: 24,
  },
  introCard: {
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  introHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  connectorAvatar: {
    width: 48,
    height: 48,
    borderRadius: '50%',
    background: 'var(--teal)',
    color: 'var(--text-primary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.2rem',
    fontWeight: 700,
  },
  connectorName: {
    color: 'var(--text-primary)',
    fontWeight: 600,
    fontSize: '1.1rem',
  },
  introTarget: {
    color: 'var(--text-secondary)',
    fontSize: '0.85rem',
    marginTop: 4,
  },
  closenessBadge: {
    marginLeft: 'auto',
    background: 'rgba(27, 23, 37, 0.08)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
    padding: '4px 12px',
    borderRadius: 20,
    fontSize: '0.8rem',
    fontWeight: 600,
    fontFamily: 'var(--font-mono)',
  },
  introReason: {
    color: 'var(--text-primary)',
    lineHeight: 1.6,
    fontSize: '0.95rem',
  },
  emailContainer: {
    background: 'var(--bg-input)',
    border: '1px solid var(--border-glow)',
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column',
  },
  emailHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 16px',
    borderBottom: '1px solid var(--border-glow)',
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    fontWeight: 600,
  },
  copyBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--neon-blue)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: '0.8rem',
    fontWeight: 600,
  },
  emailBody: {
    padding: 16,
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    whiteSpace: 'pre-wrap',
    fontFamily: 'monospace',
    lineHeight: 1.5,
  },
};
