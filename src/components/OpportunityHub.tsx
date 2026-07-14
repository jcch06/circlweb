import React, { useState, useEffect } from 'react';
import { Zap, Copy, Check, Target, Key, Brain, Workflow, Award, Scale, Share2, History, GitCompare, Trash2, ArrowRight } from 'lucide-react';
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

export const OpportunityHub: React.FC<OpportunityHubProps> = ({ contacts, notes, user, selectedSpaceId }) => {
  const [activeMode, setActiveMode] = useState<'network' | 'opportunities' | 'market' | 'intros' | 'radar' | 'history'>('network');

  const [loading, setLoading] = useState(false);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineProgress, setPipelineProgress] = useState(0);

  const [v3Result, setV3Result] = useState<MistralPipelineResult | null>(null);
  const [viewingArchiveId, setViewingArchiveId] = useState<string | null>(null);
  const [showProfilePopup, setShowProfilePopup] = useState(false);

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
    } catch (err) {
      console.error(err);
      alert("Erreur lors de l'analyse Mistral AI. Vérifiez votre clé API.");
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
          <Key size={36} color="var(--neon-purple)" style={{ marginBottom: 12 }} />
          <h3>Clé API Mistral Requise</h3>
          <p style={styles.setupDesc}>
            Pour activer le cerveau IA de l'application, vous devez fournir votre clé Mistral AI.
          </p>
          <div style={styles.setupInstructions}>
            <p>1. Allez sur <a href="https://console.mistral.ai/" target="_blank" rel="noreferrer" style={{ color: 'var(--neon-blue)' }}>Mistral Console</a> et créez une clé API.</p>
            <p>3. Ouvrez le fichier <code>.env.local</code> de votre projet et remplacez la valeur : <br/> <code>VITE_MISTRAL_API_KEY=votre_cle_ici</code></p>
            <p>4. Relancez l'application.</p>
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
                    Le réseau est cartographié sémantiquement puis découpé en lots cohérents. Chaque lot est analysé, puis une synthèse globale est générée.
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
                    <Workflow size={48} color="rgba(255,255,255,0.1)" />
                    <h3>Aucune analyse Mistral V4</h3>
                    <p>Cliquez sur "Lancer l'Analyse Globale" pour démarrer.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

                    {viewingArchiveId && (
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                        padding: '12px 20px', borderRadius: 10,
                        background: 'rgba(250, 204, 21, 0.08)', border: '1px solid rgba(250, 204, 21, 0.25)'
                      }}>
                        <span style={{ fontSize: '0.85rem', color: '#facc15' }}>
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
                    <div className="glass-card" style={{ padding: 32, background: 'linear-gradient(145deg, rgba(30, 41, 59, 0.4) 0%, rgba(15, 23, 42, 0.4) 100%)', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                        <Brain size={28} color="var(--neon-green)" />
                        <h3 style={{ margin: 0, fontSize: '1.4rem' }}>Force du Réseau</h3>
                      </div>
                      <p style={{ fontSize: '1.1rem', color: '#e2e8f0', lineHeight: 1.6 }}>
                        {v3Result.synthesis.networkStrength}
                      </p>
                    </div>

                    {/* Contacts-Ponts */}
                    {v3Result.bridgeContacts && v3Result.bridgeContacts.length > 0 && (
                      <div>
                        <h3 style={{ color: 'var(--neon-purple)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Share2 size={20} /> Contacts-Ponts Stratégiques
                        </h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 16 }}>
                          Ces contacts relient des groupes autrement séparés de votre réseau — les meilleurs candidats pour des introductions à fort impact.
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                          {v3Result.bridgeContacts.map((b, i) => (
                            <div key={i} className="glass-card" style={{ padding: 16 }}>
                              <div style={{ fontWeight: 600, color: '#fff', marginBottom: 4 }}>{b.name}</div>
                              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 10 }}>{b.role} · {b.company}</div>
                              <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${Math.round(b.centralityScore * 100)}%`, background: 'var(--neon-purple)', borderRadius: 99 }} />
                              </div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                Score de connexion : {Math.round(b.centralityScore * 100)}%
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Thèmes Globaux */}
                    <div>
                      <h3 style={{ color: 'var(--neon-blue)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Target size={20} /> Thèmes Dominants
                      </h3>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                        {v3Result.synthesis.globalThemes.map((theme, i) => (
                          <div key={i} style={{ padding: '8px 16px', background: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.2)', borderRadius: 24, color: '#38bdf8' }}>
                            {theme}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Macro-Besoins */}
                    {v3Result.synthesis.macroNeeds && v3Result.synthesis.macroNeeds.length > 0 && (
                      <div>
                        <h3 style={{ color: 'var(--neon-green)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Target size={20} /> Macro-Besoins Consolidés
                        </h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                          {v3Result.synthesis.macroNeeds.map((mn, i) => (
                            <div key={i} className="glass-card" style={{ padding: 20 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                                <h4 style={{ color: '#fff', margin: 0, fontSize: '1rem' }}>{mn.label}</h4>
                                <span style={{
                                  fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 4,
                                  color: mn.priority === 'high' ? '#facc15' : mn.priority === 'medium' ? '#38bdf8' : 'var(--text-muted)',
                                  background: mn.priority === 'high' ? 'rgba(250, 204, 21, 0.1)' : mn.priority === 'medium' ? 'rgba(56, 189, 248, 0.1)' : 'rgba(255,255,255,0.05)'
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
                        <h3 style={{ color: 'var(--neon-blue)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Workflow size={20} /> Chaînes de Valeur Globales
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                          {v3Result.synthesis.valueChains.map((vc, i) => (
                            <div key={i} className="glass-card" style={{ padding: 20 }}>
                              <h4 style={{ color: '#fff', marginBottom: 4, fontSize: '1.05rem' }}>{vc.title}</h4>
                              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 12 }}>{vc.description}</p>
                              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                {vc.chain.map((link, j) => (
                                  <React.Fragment key={j}>
                                    <div style={{ padding: '6px 12px', background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: 8, fontSize: '0.8rem' }}>
                                      <b style={{ color: '#fff' }}>{link.contactName}</b>
                                      <span style={{ color: 'var(--text-muted)' }}> ({link.role})</span>
                                      <div style={{ color: 'var(--text-secondary)' }}>{link.contribution}</div>
                                    </div>
                                    {j < vc.chain.length - 1 && <span style={{ color: 'var(--text-muted)' }}>→</span>}
                                  </React.Fragment>
                                ))}
                              </div>
                              <div style={{ display: 'inline-block', background: 'rgba(250, 204, 21, 0.1)', color: '#facc15', padding: '4px 10px', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600 }}>
                                Impact : {vc.estimatedImpact}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Synergies Cross-Batch */}
                    <div>
                      <h3 style={{ color: 'var(--neon-yellow)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Zap size={20} /> Synergies Globales Croisées
                      </h3>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                        {v3Result.synthesis.crossBatchSynergies.map((syn, i) => (
                          <div key={i} className="glass-card" style={{ padding: 20 }}>
                            <h4 style={{ color: '#fff', marginBottom: 8, fontSize: '1.1rem' }}>{syn.theme}</h4>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 12 }}>{syn.description}</p>
                            <div style={{ display: 'inline-block', background: 'rgba(250, 204, 21, 0.1)', color: '#facc15', padding: '4px 10px', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600 }}>
                              Impact : {syn.potentialImpact}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Plan d'action */}
                    <div className="glass-card" style={{ padding: 24, borderColor: 'var(--neon-purple)' }}>
                      <h3 style={{ color: 'var(--neon-purple)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Award size={20} /> Plan d'Action Recommandé
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
                    <Scale size={48} color="rgba(255,255,255,0.1)" />
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
                    <Scale size={48} color="rgba(255,255,255,0.1)" />
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
                    <Workflow size={48} color="rgba(255,255,255,0.1)" />
                    <h3>Aucune analyse Mistral V4</h3>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                      L'algorithme a découpé votre réseau en {v3Result.batches.length} lots. Voici les détails extraits pour chaque groupe.
                    </p>

                    {v3Result.batches.map((batch, i) => (
                      <div key={i} className="glass-card" style={{ padding: 24, borderLeft: '4px solid var(--neon-blue)' }}>
                        <h3 style={{ margin: '0 0 16px 0', color: '#fff' }}>Lot d'Analyse #{i + 1}</h3>
                        
                        <div style={{ marginBottom: 16 }}>
                          <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>Besoins Récurrents</span>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                            {batch.recurrentNeeds.map((need, j) => (
                              <span key={j} style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.05)', borderRadius: 4, fontSize: '0.8rem' }}>{need}</span>
                            ))}
                          </div>
                        </div>

                        {batch.immediateSynergies && batch.immediateSynergies.length > 0 && (
                          <div style={{ marginBottom: 16 }}>
                            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--neon-green)', fontWeight: 700 }}>Synergies Immédiates</span>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                              {batch.immediateSynergies.map((syn, j) => (
                                <div key={j} style={{ padding: 12, background: 'rgba(34, 197, 94, 0.05)', borderRadius: 8, border: '1px solid rgba(34, 197, 94, 0.1)' }}>
                                  <div style={{ fontWeight: 600, color: '#fff', marginBottom: 4 }}>
                                    {syn.contactName1} <span style={{ color: 'var(--text-muted)' }}>&</span> {syn.contactName2}
                                  </div>
                                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{syn.reason}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div>
                          <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>Mots-Clés</span>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                            {batch.keyCompetencies.map((comp, j) => (
                              <span key={j} style={{ color: 'var(--neon-purple)', fontSize: '0.8rem' }}>#{comp}</span>
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
                          <div style={styles.closenessBadge}>Force: {intro.connectorCloseness}/5</div>
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
                    <h3 style={{ color: 'var(--neon-purple)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <GitCompare size={20} /> Comparer deux analyses
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
                            <p style={{ fontSize: '1rem', color: '#e2e8f0', lineHeight: 1.6 }}>
                              {delta.networkEvolutionSummary}
                            </p>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
                              {delta.newThemes.length > 0 && (
                                <div>
                                  <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--neon-green)', fontWeight: 700 }}>Nouveaux thèmes</span>
                                  <ul style={{ paddingLeft: 18, marginTop: 8, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                    {delta.newThemes.map((t, i) => <li key={i}>{t}</li>)}
                                  </ul>
                                </div>
                              )}
                              {delta.resolvedThemes.length > 0 && (
                                <div>
                                  <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>Thèmes résolus / disparus</span>
                                  <ul style={{ paddingLeft: 18, marginTop: 8, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                    {delta.resolvedThemes.map((t, i) => <li key={i}>{t}</li>)}
                                  </ul>
                                </div>
                              )}
                              {delta.newMacroNeeds.length > 0 && (
                                <div>
                                  <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#38bdf8', fontWeight: 700 }}>Nouveaux macro-besoins</span>
                                  <ul style={{ paddingLeft: 18, marginTop: 8, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                    {delta.newMacroNeeds.map((t, i) => <li key={i}>{t}</li>)}
                                  </ul>
                                </div>
                              )}
                              {delta.emergingSynergies.length > 0 && (
                                <div>
                                  <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#facc15', fontWeight: 700 }}>Synergies émergentes</span>
                                  <ul style={{ paddingLeft: 18, marginTop: 8, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                    {delta.emergingSynergies.map((t, i) => <li key={i}>{t}</li>)}
                                  </ul>
                                </div>
                              )}
                              {delta.bridgeContactChanges.length > 0 && (
                                <div>
                                  <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--neon-purple)', fontWeight: 700 }}>Connecteurs clés</span>
                                  <ul style={{ paddingLeft: 18, marginTop: 8, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                    {delta.bridgeContactChanges.map((t, i) => <li key={i}>{t}</li>)}
                                  </ul>
                                </div>
                              )}
                            </div>

                            {delta.recommendedNextSteps.length > 0 && (
                              <div className="glass-card" style={{ padding: 20, borderColor: 'var(--neon-purple)' }}>
                                <h4 style={{ color: 'var(--neon-purple)', marginBottom: 12 }}>Prochaines étapes recommandées</h4>
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
                    <h3 style={{ color: 'var(--text-secondary)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <History size={20} /> Analyses archivées
                    </h3>
                    {loadingHistory ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Chargement...</p>
                    ) : history.length === 0 ? (
                      <div style={styles.emptyState}>
                        <History size={48} color="rgba(255,255,255,0.1)" />
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
                              borderLeft: viewingArchiveId === h.id ? '3px solid var(--neon-purple)' : '3px solid transparent'
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: 600, color: '#fff', fontSize: '0.9rem' }}>
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

      {/* API Cost Tracker */}
      {v3Result && v3Result.synthesis && v3Result.synthesis.tokenUsage && (
        <div style={{ marginTop: 32, padding: 12, borderRadius: 8, background: 'rgba(255,255,255,0.03)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            ⚡ <b>Consommation API (Mistral Large) :</b> {v3Result.synthesis.tokenUsage.totalTokens.toLocaleString()} jetons
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>|</div>
          <div style={{ color: 'var(--neon-green)', fontSize: '0.8rem', fontWeight: 600 }}>
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
    padding: '24px 0',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 32,
    background: 'rgba(255,255,255,0.02)',
    padding: 24,
    borderRadius: 16,
    border: '1px solid rgba(255,255,255,0.05)',
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
    boxShadow: '0 0 20px rgba(0, 240, 255, 0.3)',
  },
  title: {
    margin: 0,
    fontSize: '1.5rem',
    fontWeight: 700,
    color: '#fff',
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
    background: 'linear-gradient(145deg, rgba(30,30,30,0.8), rgba(20,20,20,0.8))',
  },
  setupDesc: {
    color: 'var(--text-secondary)',
    lineHeight: 1.6,
    marginBottom: 24,
  },
  setupInstructions: {
    textAlign: 'left',
    background: 'rgba(0,0,0,0.3)',
    padding: 24,
    borderRadius: 8,
    color: 'var(--text-secondary)',
    lineHeight: 1.8,
  },
  tabsNav: {
    display: 'flex',
    gap: 12,
    marginBottom: 24,
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    paddingBottom: 16,
  },
  tabBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
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
    background: 'rgba(0, 240, 255, 0.1)',
    color: 'var(--neon-blue)',
  },
  tabContentContainer: {
    position: 'relative',
    minHeight: 400,
  },
  progressOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(10, 10, 15, 0.8)',
    backdropFilter: 'blur(10px)',
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  progressModal: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-glow)',
    padding: 32,
    borderRadius: 16,
    width: 400,
    textAlign: 'center',
    boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
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
    background: 'rgba(255,255,255,0.1)',
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
    background: 'rgba(255,255,255,0.01)',
    borderRadius: 16,
    border: '1px dashed rgba(255,255,255,0.1)',
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
    background: 'rgba(0,0,0,0.3)',
    border: '1px solid rgba(255,255,255,0.1)',
    padding: '12px 16px',
    borderRadius: 8,
    color: '#fff',
    fontSize: '0.95rem',
  },
  historySelect: {
    background: 'rgba(0,0,0,0.3)',
    border: '1px solid rgba(255,255,255,0.1)',
    padding: '10px 14px',
    borderRadius: 8,
    color: '#fff',
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
    background: 'var(--neon-purple)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.2rem',
    fontWeight: 700,
  },
  connectorName: {
    color: '#fff',
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
    background: 'rgba(168, 85, 247, 0.1)',
    color: '#a855f7',
    padding: '4px 12px',
    borderRadius: 20,
    fontSize: '0.8rem',
    fontWeight: 600,
  },
  introReason: {
    color: 'var(--text-primary)',
    lineHeight: 1.6,
    fontSize: '0.95rem',
  },
  emailContainer: {
    background: 'rgba(0,0,0,0.3)',
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
