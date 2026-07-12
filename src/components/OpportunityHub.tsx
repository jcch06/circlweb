import React, { useState, useEffect } from 'react';
import { 
  suggestWarmIntros,
  runOracleV3Pipeline,
  getCachedOracleV3Result,
  isGeminiConfigured
} from '../lib/gemini';
import type {
  WarmIntroSuggestion,
  OracleV3Result,
  DeepOpportunity
} from '../lib/gemini';
import { 
  Sparkles, 
  Zap, 
  Lightbulb, 
  Send, 
  Key, 
  Copy, 
  Check, 
  User,
  Brain,
  Network,
  Target,
  Star,
  Briefcase,
  Link2,
  Calendar,
  RefreshCw,
  TrendingUp
} from 'lucide-react';
import { UserProfilePopup } from './UserProfilePopup';
import { NetworkAnalysisProgress } from './NetworkAnalysisProgress';
import { SupplyDemandMatrix } from './SupplyDemandMatrix';

interface OpportunityHubProps {
  contacts: any[];
  notes: any[];
  tags: any[];
  spaces?: any[];
  selectedSpaceId?: string | null;
  user: any;
}

type Mode = 'network' | 'opportunities' | 'intros';

const CATEGORY_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  service: { icon: <Briefcase size={16} />, color: 'var(--neon-purple)', label: 'Service' },
  product: { icon: <Target size={16} />, color: 'var(--neon-blue)', label: 'Produit' },
  connection: { icon: <Link2 size={16} />, color: 'var(--neon-green)', label: 'Connexion' },
  event: { icon: <Calendar size={16} />, color: 'var(--neon-yellow)', label: 'Événement' },
};

export const OpportunityHub: React.FC<OpportunityHubProps> = ({ contacts, notes, tags: _tags, user }) => {
  const [activeMode, setActiveMode] = useState<Mode>('network');
  const [loading, setLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // User Profile State
  const [showProfilePopup, setShowProfilePopup] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);

  // V3 Pipeline State
  const [v3Result, setV3Result] = useState<OracleV3Result | null>(null);
  const [pipelinePass, setPipelinePass] = useState(0);
  const [pipelineProgress, setPipelineProgress] = useState(0);
  const [pipelineRunning, setPipelineRunning] = useState(false);

  // Legacy: Warm Intros (kept as a separate targeted feature)
  const [intros, setIntros] = useState<WarmIntroSuggestion[]>([]);
  const [targetCompany, setTargetCompany] = useState('');
  const [targetRole, setTargetRole] = useState('');

  const hasApiKey = isGeminiConfigured();

  useEffect(() => {
    if (user) {
      const saved = localStorage.getItem(`circl_user_profile_${user.id}`);
      if (saved) {
        setUserProfile(JSON.parse(saved));
      } else {
        setShowProfilePopup(true);
      }
    }
  }, [user]);

  // Load cached V3 result on mount or contacts change
  useEffect(() => {
    if (contacts && contacts.length > 0) {
      const cached = getCachedOracleV3Result(contacts);
      if (cached && !pipelineRunning) {
        setV3Result(cached);
      }
    }
  }, [contacts]);

  // V3 Pipeline trigger
  const triggerV3Pipeline = async (forceRefresh = false) => {
    if (!userProfile || !userProfile.name) {
      alert("Veuillez d'abord remplir votre profil (Bouton 'Mon Profil' en haut) !");
      setShowProfilePopup(true);
      return;
    }

    setPipelineRunning(true);
    setPipelinePass(0);
    setPipelineProgress(0);
    setLoading(true);

    // Clear cache if forced
    if (forceRefresh) {
      const keys = Object.keys(localStorage).filter(k => k.startsWith('circl_oracle_v3_'));
      keys.forEach(k => localStorage.removeItem(k));
    }

    try {
      const result = await runOracleV3Pipeline(
        contacts,
        notes,
        userProfile,
        (pass, progress) => {
          setPipelinePass(pass);
          setPipelineProgress(progress);
        }
      );
      setV3Result(result);
    } catch (err) {
      console.error(err);
      alert("Erreur lors de l'analyse Oracle V3. Vérifiez votre clé API.");
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

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>
            L'Oracle <span className="text-gradient-purple-blue">IA V3</span>
          </h1>
          <span style={styles.subtitle}>
            Pipeline d'intelligence réseau multi-couches — Analyse profonde de votre constellation de contacts
          </span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button 
            onClick={() => setShowProfilePopup(true)}
            className="hover-glow"
            style={{ 
              background: 'rgba(138, 43, 226, 0.15)', 
              border: '1px solid var(--neon-purple)', 
              color: '#fff', 
              padding: '6px 12px', 
              borderRadius: 99, 
              display: 'flex', 
              alignItems: 'center', 
              gap: 6,
              fontSize: '0.8rem',
              cursor: 'pointer'
            }}
          >
            <User size={14} /> Mon Profil Oracle
          </button>
          <div style={styles.apiBadge}>
            <Sparkles size={14} color="var(--neon-purple)" />
            <span style={styles.apiBadgeText}>Oracle V3 Actif</span>
          </div>
        </div>
      </div>

      {/* API Key Missing State */}
      {!hasApiKey && (
        <div className="glass-card" style={styles.setupCard}>
          <Key size={36} color="var(--neon-purple)" style={{ marginBottom: 12 }} />
          <h3>Clé API Gemini Pro Requise</h3>
          <p style={styles.setupDesc}>
            Pour activer le cerveau IA de l'application, vous devez fournir votre clé Google AI Studio. 
            C'est gratuit, ultra-rapide et sécurisé (la clé reste uniquement dans vos variables d'environnement locales).
          </p>
          <div style={styles.setupInstructions}>
            <p>1. Allez sur <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer" style={{ color: 'var(--neon-blue)' }}>Google AI Studio</a> et cliquez sur <b>"Get API Key"</b>.</p>
            <p>2. Copiez votre clé de développement.</p>
            <p>3. Ouvrez le fichier <code>.env.local</code> de votre projet et remplacez la valeur : <br/> <code>VITE_GEMINI_API_KEY=votre_cle_ici</code></p>
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
              Analyse Réseau
            </button>
            <button 
              onClick={() => setActiveMode('opportunities')} 
              style={{ ...styles.tabBtn, ...(activeMode === 'opportunities' ? styles.tabBtnActive : {}) }}
            >
              <Lightbulb size={16} />
              Mes Opportunités
            </button>
            <button 
              onClick={() => setActiveMode('intros')} 
              style={{ ...styles.tabBtn, ...(activeMode === 'intros' ? styles.tabBtnActive : {}) }}
            >
              <Send size={16} />
              Warm Intros Finder
            </button>
          </div>

          {/* Main Area */}
          <div style={styles.contentArea}>
            {/* Pipeline Progress (shown when running) */}
            {pipelineRunning && (
              <NetworkAnalysisProgress
                currentPass={pipelinePass}
                passProgress={pipelineProgress}
                isComplete={false}
              />
            )}

            {!pipelineRunning && (
              <>
                {/* 1. NETWORK ANALYSIS TAB */}
                {activeMode === 'network' && (
                  <div style={styles.tabContent}>
                    <div style={styles.controlsRow}>
                      <div style={{ flex: 1 }}>
                        <p style={styles.tabDescription}>
                          L'Oracle V3 exécute une <strong>pipeline en 4 passes</strong> : extraction structurée → embeddings vectoriels → clustering & matrice offre/demande → analyse croisée avec votre profil.
                        </p>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 6 }}>
                          📊 {contacts.length} contacts analysés | {v3Result ? `${v3Result.clusters.length} clusters détectés` : 'Analyse non lancée'}
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
                        <button onClick={() => triggerV3Pipeline(false)} className="btn-primary" disabled={loading}>
                          {v3Result ? 'Relancer l\'Analyse' : 'Lancer l\'Analyse Systémique'} 🚀
                        </button>
                        {v3Result && (
                          <button 
                            onClick={() => triggerV3Pipeline(true)} 
                            style={{ background: 'none', border: '1px solid var(--border-glow)', color: 'var(--text-muted)', padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}
                          >
                            <RefreshCw size={12} /> Forcer le recalcul
                          </button>
                        )}
                      </div>
                    </div>

                    {v3Result ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                        {/* Clusters Section */}
                        <div>
                          <h3 style={{ color: 'var(--neon-blue)', marginBottom: 16, borderBottom: '1px solid rgba(79, 142, 247, 0.3)', paddingBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Network size={20} /> Clusters Détectés ({v3Result.clusters.length})
                          </h3>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
                            {v3Result.clusters.map((cluster, idx) => (
                              <div key={idx} className="glass-card glow-active" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14, borderColor: 'rgba(79, 142, 247, 0.3)' }}>
                                <div>
                                  <h4 style={{ color: '#fff', fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>{cluster.clusterName}</h4>
                                  <p style={{ color: 'var(--neon-blue)', fontSize: '0.8rem', margin: '4px 0 0 0' }}>{cluster.theme}</p>
                                </div>

                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                  {cluster.members.map(m => (
                                    <span key={m.id} style={{ background: 'rgba(255,255,255,0.05)', padding: '4px 10px', borderRadius: 6, fontSize: '0.78rem', color: '#fff' }}>
                                      {m.name}
                                    </span>
                                  ))}
                                </div>

                                <div>
                                  <span style={styles.boxTitle}>Besoins communs :</span>
                                  <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.6 }}>
                                    {cluster.commonNeeds.map((n, i) => <li key={i}>{n}</li>)}
                                  </ul>
                                </div>

                                {cluster.commonSkills.length > 0 && (
                                  <div>
                                    <span style={styles.boxTitle}>Compétences partagées :</span>
                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                                      {cluster.commonSkills.map((s, i) => (
                                        <span key={i} style={{ background: 'rgba(48, 192, 96, 0.1)', color: 'var(--neon-green)', padding: '2px 8px', borderRadius: 99, fontSize: '0.72rem' }}>{s}</span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Bridge Contacts */}
                        {v3Result.bridgeContacts.length > 0 && (
                          <div>
                            <h3 style={{ color: 'var(--neon-purple)', marginBottom: 16, borderBottom: '1px solid rgba(138, 43, 226, 0.3)', paddingBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                              <Zap size={20} /> Super-Connecteurs ({v3Result.bridgeContacts.length})
                            </h3>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 12 }}>
                              Ces contacts sont les "ponts" qui relient plusieurs communautés de votre réseau. Ce sont vos relais les plus stratégiques.
                            </p>
                            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                              {v3Result.bridgeContacts.map((bc, idx) => (
                                <div key={idx} className="glass-card" style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10, borderColor: 'rgba(138, 43, 226, 0.3)' }}>
                                  <div style={{ background: 'linear-gradient(135deg, var(--neon-purple), var(--neon-blue))', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8rem', color: '#fff' }}>
                                    {idx + 1}
                                  </div>
                                  <div>
                                    <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.9rem' }}>{bc.name}</span>
                                    <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                                      Score de centralité : {bc.centralityScore}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Supply/Demand Matrix */}
                        <div>
                          <h3 style={{ color: 'var(--neon-green)', marginBottom: 16, borderBottom: '1px solid rgba(48, 192, 96, 0.3)', paddingBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <TrendingUp size={20} /> Matrice Offre / Demande
                          </h3>
                          <SupplyDemandMatrix 
                            data={v3Result.supplyDemand} 
                            userName={userProfile?.name || 'Vous'} 
                          />
                        </div>
                      </div>
                    ) : (
                      <div style={styles.emptyResults}>
                        <span>Cliquez sur le bouton ci-dessus pour lancer l'analyse réseau complète.</span>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. OPPORTUNITIES TAB */}
                {activeMode === 'opportunities' && (
                  <div style={styles.tabContent}>
                    {!v3Result ? (
                      <div style={styles.emptyResults}>
                        <div style={{ textAlign: 'center' }}>
                          <Brain size={40} color="var(--text-muted)" style={{ marginBottom: 12 }} />
                          <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>L'analyse réseau doit être lancée d'abord.</p>
                          <button onClick={() => { setActiveMode('network'); triggerV3Pipeline(false); }} className="btn-primary">
                            Lancer l'Analyse Complète 🚀
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                        {/* Category filter badges */}
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', marginRight: 8 }}>
                            {v3Result.opportunities.length} opportunités détectées :
                          </span>
                          {Object.entries(
                            v3Result.opportunities.reduce<Record<string, number>>((acc, o) => { acc[o.category] = (acc[o.category] || 0) + 1; return acc; }, {})
                          ).map(([cat, count]) => (
                            <span key={cat} style={{ background: `${CATEGORY_CONFIG[cat]?.color || '#fff'}15`, color: CATEGORY_CONFIG[cat]?.color || '#fff', padding: '4px 12px', borderRadius: 99, fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                              {CATEGORY_CONFIG[cat]?.icon} {CATEGORY_CONFIG[cat]?.label}: {count}
                            </span>
                          ))}
                        </div>

                        {/* Opportunity Cards */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 20 }}>
                          {v3Result.opportunities.map((opp, idx) => (
                            <OpportunityCard key={idx} opportunity={opp} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 3. WARM INTROS TAB */}
                {activeMode === 'intros' && (
                  <div style={styles.tabContent}>
                    <div style={styles.introForm}>
                      <p style={{ ...styles.tabDescription, marginBottom: 16 }}>
                        Vous ciblez une entreprise spécifique ou un rôle ? Entrez les critères ci-dessous. L'IA va fouiller dans votre réseau fusionné pour trouver qui peut vous faire l'introduction et rédigera le message à envoyer.
                      </p>
                      <div style={styles.formRow}>
                        <div style={styles.formGroup}>
                          <label style={styles.formLabel}>Entreprise Cible</label>
                          <input
                            type="text"
                            value={targetCompany}
                            onChange={(e) => setTargetCompany(e.target.value)}
                            placeholder="Ex: Stripe, Google, LVMH..."
                            style={styles.formInput}
                          />
                        </div>
                        <div style={styles.formGroup}>
                          <label style={styles.formLabel}>Poste recherché</label>
                          <input
                            type="text"
                            value={targetRole}
                            onChange={(e) => setTargetRole(e.target.value)}
                            placeholder="Ex: CTO, Head of Product, CFO..."
                            style={styles.formInput}
                          />
                        </div>
                        <button 
                          onClick={triggerWarmIntroSearch} 
                          className="btn-primary"
                          style={{ alignSelf: 'flex-end', height: 44, padding: '0 24px' }}
                          disabled={loading}
                        >
                          Trouver le Chemin 🔍
                        </button>
                      </div>
                    </div>

                    <div style={styles.introsList}>
                      {intros.length === 0 ? (
                        <div style={styles.emptyResults}>
                          <span>Renseignez l'entreprise et le poste cible pour lancer la recherche de warm intros.</span>
                        </div>
                      ) : (
                        intros.map((intro, idx) => (
                          <div key={idx} className="glass-card" style={styles.introCard}>
                            <div style={styles.introCardHeader}>
                              <div>
                                <h3 style={styles.introCardTitle}>
                                  Introduction via <span className="text-gradient-purple-blue">{intro.connectorName}</span>
                                </h3>
                                <p style={styles.introReason}>{intro.reason}</p>
                              </div>
                              <div style={styles.closenessScore}>
                                <span style={styles.scoreLabel}>Confiance</span>
                                <div style={styles.stars}>
                                  {Array.from({ length: 5 }).map((_, i) => (
                                    <Sparkles 
                                      key={i} 
                                      size={12} 
                                      color={i < intro.connectorCloseness ? 'var(--neon-yellow)' : 'var(--text-muted)'} 
                                      style={{ marginRight: 2 }}
                                    />
                                  ))}
                                </div>
                              </div>
                            </div>

                            <div style={styles.emailContainer}>
                              <div style={styles.emailHeader}>
                                <span>Projet de mail d'introduction :</span>
                                <button 
                                  onClick={() => handleCopy(intro.introEmailDraft, idx)} 
                                  style={styles.copyBtn}
                                >
                                  {copiedIndex === idx ? (
                                    <>
                                      <Check size={14} color="var(--neon-green)" />
                                      Copié !
                                    </>
                                  ) : (
                                    <>
                                      <Copy size={14} />
                                      Copier
                                    </>
                                  )}
                                </button>
                              </div>
                              <pre style={styles.emailBody}>{intro.introEmailDraft}</pre>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {showProfilePopup && (
        <UserProfilePopup 
          userId={user?.id || 'default'} 
          onClose={() => setShowProfilePopup(false)} 
          onSave={(p) => setUserProfile(p)} 
        />
      )}
    </div>
  );
};

// =========================================================================
// Sub-component: Opportunity Card
// =========================================================================
const OpportunityCard: React.FC<{ opportunity: DeepOpportunity }> = ({ opportunity: opp }) => {
  const config = CATEGORY_CONFIG[opp.category] || CATEGORY_CONFIG.service;
  
  return (
    <div className="glass-card glow-active" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14, borderColor: `${config.color}30` }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ background: `${config.color}20`, color: config.color, padding: '3px 10px', borderRadius: 99, fontSize: '0.72rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, textTransform: 'uppercase' }}>
              {config.icon} {config.label}
            </span>
            {opp.urgency && (
              <span style={{ 
                background: opp.urgency === 'immediate' ? 'rgba(255, 59, 48, 0.15)' : opp.urgency === 'short-term' ? 'rgba(255, 159, 10, 0.15)' : 'rgba(255,255,255,0.05)',
                color: opp.urgency === 'immediate' ? '#ff3b30' : opp.urgency === 'short-term' ? '#ff9f0a' : 'var(--text-muted)',
                padding: '3px 10px', borderRadius: 99, fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase'
              }}>
                {opp.urgency === 'immediate' ? '🔥 Urgent' : opp.urgency === 'short-term' ? '⚡ Court terme' : '📅 Moyen terme'}
              </span>
            )}
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              Cluster : {opp.targetCluster}
            </span>
          </div>
          <h4 style={{ color: '#fff', fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>{opp.title}</h4>
        </div>
      </div>

      {/* Revenue Section */}
      {(opp.revenueModel || opp.estimatedRevenue) && (
        <div style={{ background: 'linear-gradient(135deg, rgba(48, 192, 96, 0.08), rgba(79, 142, 247, 0.08))', border: '1px solid rgba(48, 192, 96, 0.2)', borderRadius: 10, padding: 14, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          {opp.estimatedRevenue && (
            <div>
              <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: 2 }}>Revenu estimé</span>
              <span style={{ fontSize: '1rem', color: 'var(--neon-green)', fontWeight: 800 }}>{opp.estimatedRevenue}</span>
            </div>
          )}
          {opp.revenueModel && (
            <div>
              <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: 2 }}>Modèle</span>
              <span style={{ fontSize: '0.82rem', color: 'var(--neon-blue)', fontWeight: 600 }}>{opp.revenueModel}</span>
            </div>
          )}
          {opp.timeToRevenue && (
            <div>
              <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: 2 }}>Délai</span>
              <span style={{ fontSize: '0.82rem', color: 'var(--neon-yellow)', fontWeight: 600 }}>{opp.timeToRevenue}</span>
            </div>
          )}
        </div>
      )}

      {/* Scores */}
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: 4 }}>Demande</span>
          <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
            <div style={{ width: `${opp.demandScore * 10}%`, height: '100%', background: `linear-gradient(90deg, ${config.color}, ${config.color}80)`, borderRadius: 4 }} />
          </div>
          <span style={{ fontSize: '0.7rem', color: config.color, fontWeight: 600 }}>{opp.demandScore}/10</span>
        </div>
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: 4 }}>Faisabilité</span>
          <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
            <div style={{ width: `${opp.feasibilityScore * 10}%`, height: '100%', background: 'linear-gradient(90deg, var(--neon-green), rgba(48,192,96,0.5))', borderRadius: 4 }} />
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--neon-green)', fontWeight: 600 }}>{opp.feasibilityScore}/10</span>
        </div>
      </div>

      {/* Description */}
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.5, margin: 0 }}>{opp.description}</p>

      {/* Relevant Contacts */}
      {opp.relevantContacts && opp.relevantContacts.length > 0 && (
        <div>
          <span style={cardStyles.sectionTitle}>Contacts pertinents :</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            {opp.relevantContacts.map((c, i) => (
              <div key={i} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-glow)', borderRadius: 6, padding: '6px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.82rem' }}>{c.name}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginLeft: 8 }}>{c.role} @ {c.company}</span>
                </div>
                <span style={{ color: config.color, fontSize: '0.72rem', fontWeight: 500, maxWidth: '40%', textAlign: 'right' }}>{c.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Plan */}
      {opp.actionPlan && opp.actionPlan.length > 0 && (
        <div style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid var(--border-glow)', borderRadius: 8, padding: 12 }}>
          <span style={cardStyles.sectionTitle}>Plan d'action :</span>
          <ol style={{ margin: '6px 0 0 0', paddingLeft: 18, color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.6 }}>
            {opp.actionPlan.map((step, i) => <li key={i}>{step}</li>)}
          </ol>
        </div>
      )}

      {/* Estimated Impact */}
      {opp.estimatedImpact && (
        <div style={{ borderTop: '1px solid var(--border-glow)', paddingTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Star size={14} color="var(--neon-yellow)" />
          <span style={{ fontSize: '0.8rem', color: 'var(--neon-yellow)', fontWeight: 500 }}>{opp.estimatedImpact}</span>
        </div>
      )}
    </div>
  );
};

const cardStyles: Record<string, React.CSSProperties> = {
  sectionTitle: {
    fontSize: '0.72rem',
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
};

// =========================================================================
// Main Styles
// =========================================================================
const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '30px',
    height: '100%',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
    position: 'relative',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: '2.25rem',
    fontWeight: 800,
    color: '#fff',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: '0.95rem',
    color: 'var(--text-secondary)',
  },
  apiBadge: {
    background: 'rgba(159, 97, 232, 0.1)',
    border: '1px solid rgba(159, 97, 232, 0.2)',
    padding: '8px 14px',
    borderRadius: 99,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  apiBadgeText: {
    fontSize: '0.8rem',
    fontWeight: 600,
    color: 'var(--neon-purple)',
  },
  setupCard: {
    padding: 40,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    maxWidth: 600,
    alignSelf: 'center',
    marginTop: 40,
  },
  setupDesc: {
    fontSize: '0.95rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.6,
    marginBottom: 24,
  },
  setupInstructions: {
    textAlign: 'left',
    background: 'rgba(0, 0, 0, 0.2)',
    padding: 20,
    borderRadius: 12,
    border: '1px solid var(--border-glow)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    fontSize: '0.875rem',
    width: '100%',
  },
  tabsNav: {
    display: 'flex',
    gap: 12,
    borderBottom: '1px solid var(--border-glow)',
    paddingBottom: 12,
  },
  tabBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    padding: '10px 16px',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    transition: 'var(--transition-smooth)',
  },
  tabBtnActive: {
    background: 'rgba(255, 255, 255, 0.05)',
    color: '#fff',
    boxShadow: '0 0 10px rgba(255,255,255,0.02)',
  },
  contentArea: {
    flexGrow: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  tabContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  controlsRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'rgba(255,255,255,0.01)',
    border: '1px solid var(--border-glow)',
    padding: 20,
    borderRadius: 12,
    gap: 20,
  },
  tabDescription: {
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
    flexGrow: 1,
    maxWidth: '70%',
  },
  emptyResults: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '250px',
    border: '1.5px dashed var(--border-glow)',
    borderRadius: 16,
    color: 'var(--text-muted)',
    fontSize: '0.9rem',
  },
  boxTitle: {
    fontSize: '0.72rem',
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    display: 'block',
    marginBottom: 4,
  },
  introForm: {
    background: 'rgba(255,255,255,0.01)',
    border: '1px solid var(--border-glow)',
    padding: 20,
    borderRadius: 12,
  },
  formRow: {
    display: 'flex',
    gap: 16,
    flexWrap: 'wrap',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    flexGrow: 1,
    minWidth: 200,
  },
  formLabel: {
    fontSize: '0.75rem',
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
  },
  formInput: {
    background: 'rgba(0,0,0,0.2)',
    border: '1px solid var(--border-glow)',
    borderRadius: 8,
    padding: '10px 14px',
    color: '#fff',
    fontSize: '0.9rem',
    outline: 'none',
  },
  introsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  introCard: {
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  introCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottom: '1px solid var(--border-glow)',
    paddingBottom: 12,
  },
  introCardTitle: {
    fontSize: '1.2rem',
    fontWeight: 700,
    color: '#fff',
  },
  introReason: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    marginTop: 4,
  },
  closenessScore: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 4,
  },
  scoreLabel: {
    fontSize: '0.65rem',
    fontWeight: 800,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
  },
  stars: {
    display: 'flex',
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
