import React, { useState, useEffect } from 'react';
import { 
  detectSynergies, 
  detectGroupSynergies,
  brainstormUserOpportunities,
  suggestWarmIntros,
  isGeminiConfigured
} from '../lib/gemini';
import type {
  SynergyResult,
  GroupSynergyResult,
  UserOpportunityResult,
  WarmIntroSuggestion
} from '../lib/gemini';
import { 
  Sparkles, 
  Zap, 
  Lightbulb, 
  Send, 
  Key, 
  Plus, 
  X, 
  Copy, 
  Check, 
  ArrowRight,
  User
} from 'lucide-react';
import { UserProfilePopup } from './UserProfilePopup';

interface OpportunityHubProps {
  contacts: any[];
  notes: any[];
  tags: any[];
  spaces?: any[];
  selectedSpaceId?: string | null;
  user: any;
}

type Mode = 'synergies' | 'opportunities' | 'intros';

export const OpportunityHub: React.FC<OpportunityHubProps> = ({ contacts, notes, tags: _tags, spaces = [], selectedSpaceId = null, user }) => {
  const [activeMode, setActiveMode] = useState<Mode>('synergies');
  const [loading, setLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // User Profile State
  const [showProfilePopup, setShowProfilePopup] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);

  // State for AI results
  const [synergies, setSynergies] = useState<SynergyResult[]>([]);
  const [groupSynergies, setGroupSynergies] = useState<GroupSynergyResult[]>([]);
  const [opportunities, setOpportunities] = useState<UserOpportunityResult[]>([]);
  const [intros, setIntros] = useState<WarmIntroSuggestion[]>([]);

  // Inputs for Warm Intros
  const [targetCompany, setTargetCompany] = useState('');
  const [targetRole, setTargetRole] = useState('');

  const hasApiKey = isGeminiConfigured();

  useEffect(() => {
    if (user) {
      const saved = localStorage.getItem(`circl_user_profile_${user.id}`);
      if (saved) {
        setUserProfile(JSON.parse(saved));
      } else {
        setShowProfilePopup(true); // Auto-prompt
      }
    }
  }, [user]);

  const triggerSynergyDetection = async () => {
    setLoading(true);
    try {
      const [synRes, groupRes] = await Promise.all([
        detectSynergies(contacts, notes),
        detectGroupSynergies(contacts, notes)
      ]);
      setSynergies(synRes);
      setGroupSynergies(groupRes);
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la détection des synergies. Vérifiez votre clé API.");
    } finally {
      setLoading(false);
    }
  };

  const triggerUserOpportunitiesBrainstorm = async () => {
    if (!userProfile || !userProfile.name) {
      alert("Veuillez d'abord remplir votre profil (Bouton 'Mon Profil' en haut) !");
      setShowProfilePopup(true);
      return;
    }
    setLoading(true);
    try {
      const res = await brainstormUserOpportunities(userProfile, contacts, notes);
      setOpportunities(res);
    } catch (err) {
      console.error(err);
      alert("Erreur lors du brainstorming. Vérifiez votre clé API.");
    } finally {
      setLoading(false);
    }
  };

  const triggerWarmIntroSearch = async () => {
    if (!targetCompany.trim() || !targetRole.trim()) {
      alert("Veuillez renseigner l'entreprise et le poste ciblé.");
      return;
    }
    setLoading(true);
    try {
      const res = await suggestWarmIntros(contacts, targetCompany, targetRole);
      setIntros(res);
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la recherche de connexions. Vérifiez votre clé API.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const activeSpaceName = selectedSpaceId 
    ? spaces.find(s => s.id === selectedSpaceId)?.name || 'Espace Inconnu'
    : 'Toutes les Galaxies (Fusion Globale)';

  return (
    <div style={styles.container}>
      {/* Background space elements */}
      <div className="bg-grid"></div>
      <div className="bg-stars"></div>

      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>L'Oracle IA</h1>
          <p style={styles.subtitle}>Générez de la valeur et trouvez des synergies dans vos galaxies de réseaux</p>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--neon-blue)', fontWeight: 600, background: 'rgba(79, 142, 247, 0.1)', padding: '4px 10px', borderRadius: 99 }}>
              Espace actif : {activeSpaceName}
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              ({contacts.length} contacts analysables)
            </span>
          </div>
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
            <span style={styles.apiBadgeText}>Gemini Pro Connecté</span>
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
              onClick={() => setActiveMode('synergies')} 
              style={{ ...styles.tabBtn, ...(activeMode === 'synergies' ? styles.tabBtnActive : {}) }}
            >
              <Zap size={16} />
              Synergies Croisées
            </button>
            <button 
              onClick={() => setActiveMode('opportunities')} 
              style={{ ...styles.tabBtn, ...(activeMode === 'opportunities' ? styles.tabBtnActive : {}) }}
            >
              <Lightbulb size={16} />
              Mes Services & Projets
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
            {loading ? (
              <div style={styles.loadingContainer}>
                <div className="orbit-spinner"></div>
                <span style={styles.loadingText}>L'IA Oracle interroge vos constellations de contacts...</span>
              </div>
            ) : (
              <>
                {/* 1. SYNERGIES TAB */}
                {activeMode === 'synergies' && (
                  <div style={styles.tabContent}>
                    <div style={styles.controlsRow}>
                      <p style={styles.tabDescription}>
                        L'IA analyse les profils et les notes de vos contacts pour détecter des groupes d'intérêts et des connexions 1-à-1 croisées.
                      </p>
                      <button onClick={triggerSynergyDetection} className="btn-primary">
                        Lancer l'Analyse Systémique 🚀
                      </button>
                    </div>

                    <div style={styles.resultsGrid}>
                      {synergies.length === 0 && groupSynergies.length === 0 ? (
                        <div style={styles.emptyResults}>
                          <span>Cliquez sur le bouton ci-dessus pour lancer la détection.</span>
                        </div>
                      ) : (
                        <>
                          {groupSynergies.length > 0 && (
                            <div style={{ gridColumn: '1 / -1', marginBottom: 24 }}>
                              <h3 style={{ color: 'var(--neon-blue)', marginBottom: 16, borderBottom: '1px solid rgba(79, 142, 247, 0.3)', paddingBottom: 8 }}>
                                🌌 Clusters & Synergies de Groupe
                              </h3>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
                                {groupSynergies.map((group, idx) => (
                                  <div key={idx} className="glass-card glow-active" style={{ ...styles.synergyCard, borderColor: 'rgba(79, 142, 247, 0.3)' }}>
                                    <h3 style={styles.cardHeaderTitle}>{group.clusterName}</h3>
                                    
                                    <div style={{ marginTop: 12 }}>
                                      <span style={styles.boxTitle}>Besoins Partagés :</span>
                                      <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                        {group.commonNeeds.map((need, i) => <li key={i}>{need}</li>)}
                                      </ul>
                                    </div>

                                    <div style={styles.matchVisualizer}>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                        {group.members.map(m => (
                                          <div key={m.id} style={{ background: 'rgba(255,255,255,0.05)', padding: '6px 10px', borderRadius: 6, fontSize: '0.8rem' }}>
                                            <span style={{ color: '#fff', fontWeight: 500 }}>{m.name}</span>
                                            <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>{m.role}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>

                                    <div style={styles.reasonBox}>
                                      <span style={styles.boxTitle}>Pourquoi ce groupe ?</span>
                                      <p style={styles.boxText}>{group.matchReason}</p>
                                    </div>

                                    <div style={styles.introBox}>
                                      <span style={styles.boxTitle}>Service / Produit Potentiel :</span>
                                      <p style={{ ...styles.boxText, color: 'var(--neon-green)', fontSize: '0.85rem', fontWeight: 500 }}>
                                        {group.potentialService}
                                      </p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {synergies.length > 0 && (
                            <div style={{ gridColumn: '1 / -1' }}>
                              <h3 style={{ color: 'var(--neon-purple)', marginBottom: 16, borderBottom: '1px solid rgba(138, 43, 226, 0.3)', paddingBottom: 8 }}>
                                ⚡ Connexions 1-à-1 Directes
                              </h3>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
                                {synergies.map((syn, idx) => (
                                  <div key={idx} className="glass-card" style={styles.synergyCard}>
                                    <h3 style={styles.cardHeaderTitle}>{syn.title}</h3>
                                    <p style={styles.cardDescription}>{syn.description}</p>
                                    
                                    <div style={styles.matchVisualizer}>
                                      <div style={styles.matchParty}>
                                        <span style={styles.partyLabel}>A BESOIN</span>
                                        <span style={styles.partyName}>{syn.sourceContact.name}</span>
                                        <span style={styles.partyMeta}>{syn.sourceContact.role} @ {syn.sourceContact.company}</span>
                                      </div>
                                      <ArrowRight size={18} color="var(--neon-purple)" />
                                      <div style={styles.matchParty}>
                                        <span style={{ ...styles.partyLabel, color: 'var(--neon-green)' }}>A LA SOLUTION</span>
                                        <span style={styles.partyName}>{syn.targetContact.name}</span>
                                        <span style={styles.partyMeta}>{syn.targetContact.role} @ {syn.targetContact.company}</span>
                                      </div>
                                    </div>

                                    <div style={styles.reasonBox}>
                                      <span style={styles.boxTitle}>Pourquoi ils doivent se connecter :</span>
                                      <p style={styles.boxText}>{syn.matchReason}</p>
                                    </div>

                                    <div style={styles.introBox}>
                                      <span style={styles.boxTitle}>Action recommandée :</span>
                                      <p style={{ ...styles.boxText, color: 'var(--neon-blue)', fontSize: '0.825rem' }}>
                                        {syn.recommendedIntroPath}
                                      </p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* 2. OPPORTUNITIES TAB */}
                {activeMode === 'opportunities' && (
                  <div style={styles.tabContent}>
                    <div style={styles.brainstormHeader}>
                      <div style={styles.skillsConfig}>
                        <h4 style={styles.configTitle}>1. Mon Profil Oracle</h4>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                          L'IA va croiser vos compétences avec les besoins cachés de votre réseau.
                        </p>
                        {userProfile ? (
                          <div style={{ background: 'rgba(255,255,255,0.05)', padding: 12, borderRadius: 8 }}>
                            <span style={{ color: '#fff', fontWeight: 600 }}>{userProfile.name}</span>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginLeft: 8 }}>{userProfile.role}</span>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                              {userProfile.skills?.map((s: string) => (
                                <span key={s} style={{ background: 'rgba(138, 43, 226, 0.2)', color: 'var(--neon-purple)', padding: '2px 8px', borderRadius: 99, fontSize: '0.75rem' }}>{s}</span>
                              ))}
                            </div>
                            <button onClick={() => setShowProfilePopup(true)} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '4px 8px', borderRadius: 4, marginTop: 12, cursor: 'pointer', fontSize: '0.75rem' }}>
                              Modifier le profil
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setShowProfilePopup(true)} style={{ background: 'var(--neon-purple)', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: '0.85rem' }}>
                            Remplir mon profil
                          </button>
                        )}
                      </div>
                      <div style={styles.brainstormAction}>
                        <h4 style={styles.configTitle}>2. Générer mes Opportunités</h4>
                        <button onClick={triggerUserOpportunitiesBrainstorm} className="btn-primary" style={{ width: '100%' }}>
                          Lancer l'Analyse 💡
                        </button>
                      </div>
                    </div>

                    <div style={styles.resultsGrid}>
                      {opportunities.length === 0 ? (
                        <div style={styles.emptyResults}>
                          <span>Générez des idées pour voir les services ou projets que vous devriez lancer.</span>
                        </div>
                      ) : (
                        opportunities.map((opp, idx) => (
                          <div key={idx} className="glass-card glow-active" style={{ ...styles.projectCard, borderColor: 'rgba(48, 192, 96, 0.3)' }}>
                            <div style={styles.projectHeader}>
                              <div>
                                <h3 style={{ ...styles.projectTitle, color: 'var(--neon-green)' }}>{opp.opportunityTitle}</h3>
                                <span style={styles.projectTagline}>Cible : {opp.targetAudience}</span>
                              </div>
                            </div>

                            <div style={styles.projSection}>
                              <span style={styles.sectionHeaderTitle}>Le Problème Résolu :</span>
                              <p style={styles.projText}>{opp.problemSolved}</p>
                            </div>

                            <div style={styles.projSection}>
                              <span style={styles.sectionHeaderTitle}>Votre Solution (Basée sur votre profil) :</span>
                              <p style={styles.projText}>{opp.proposedSolution}</p>
                            </div>

                            <div style={styles.teamSection}>
                              <span style={styles.sectionHeaderTitle}>Vos Premiers Prospects / Partenaires :</span>
                              <div style={styles.teamList}>
                                {opp.relevantContacts.map((c, cIdx) => (
                                  <div key={cIdx} style={{ ...styles.teamMemberCard, borderLeft: '2px solid var(--neon-green)' }}>
                                    <div style={styles.teamMemberHeader}>
                                      <span style={styles.memberName}>{c.name}</span>
                                      <span style={styles.memberContribution}>{c.role} @ {c.company}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div style={styles.reasonBox}>
                              <span style={styles.boxTitle}>Plan d'Action :</span>
                              <p style={{ ...styles.boxText, color: 'var(--text-secondary)' }}>{opp.actionPlan}</p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* 3. WARM INTROS TAB */}
                {activeMode === 'intros' && (
                  <div style={styles.tabContent}>
                    <div style={styles.introForm}>
                      <p style={{ ...styles.tabDescription, marginBottom: 16 }}>
                        Vous ciblez une entreprise spécifique ou un rôle ? Entrez les critères ci-dessous. Gemini va fouiller dans votre réseau fusionné pour trouver qui peut vous faire l'introduction et rédigera le message à envoyer.
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
                                      Copie !
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
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    height: '300px',
    gap: 16,
  },
  loadingText: {
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
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
  resultsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
    gap: 24,
  },
  emptyResults: {
    gridColumn: '1 / -1',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '200px',
    border: '1.5px dashed var(--border-glow)',
    borderRadius: 16,
    color: 'var(--text-muted)',
    fontSize: '0.9rem',
  },
  synergyCard: {
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  cardHeaderTitle: {
    fontSize: '1.2rem',
    fontWeight: 700,
    color: '#fff',
  },
  cardDescription: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.4,
  },
  matchVisualizer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'rgba(0, 0, 0, 0.15)',
    border: '1px solid var(--border-glow)',
    padding: 14,
    borderRadius: 10,
    gap: 10,
  },
  matchParty: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    width: '45%',
  },
  partyLabel: {
    fontSize: '0.65rem',
    fontWeight: 800,
    color: 'var(--neon-purple)',
    letterSpacing: '0.05em',
  },
  partyName: {
    fontSize: '0.85rem',
    fontWeight: 700,
    color: '#fff',
  },
  partyMeta: {
    fontSize: '0.725rem',
    color: 'var(--text-muted)',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    overflow: 'hidden',
  },
  reasonBox: {
    background: 'rgba(255, 255, 255, 0.02)',
    padding: 12,
    borderRadius: 8,
    borderLeft: '3px solid var(--neon-purple)',
  },
  introBox: {
    background: 'rgba(79, 142, 247, 0.05)',
    padding: 12,
    borderRadius: 8,
    borderLeft: '3px solid var(--neon-blue)',
  },
  boxTitle: {
    fontSize: '0.75rem',
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    display: 'block',
    marginBottom: 4,
  },
  boxText: {
    fontSize: '0.825rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.4,
  },
  brainstormHeader: {
    display: 'grid',
    gridTemplateColumns: '3fr 1fr',
    gap: 20,
    background: 'rgba(255,255,255,0.01)',
    border: '1px solid var(--border-glow)',
    padding: 20,
    borderRadius: 12,
    alignItems: 'end',
  },
  skillsConfig: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  configTitle: {
    fontSize: '0.85rem',
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  skillsWrapper: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  skillBadge: {
    background: 'rgba(159, 97, 232, 0.1)',
    border: '1px solid rgba(159, 97, 232, 0.2)',
    color: 'var(--neon-purple)',
    padding: '6px 12px',
    borderRadius: 99,
    fontSize: '0.8rem',
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  removeSkillBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--neon-purple)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
  },
  addSkillInputWrapper: {
    display: 'flex',
    alignItems: 'center',
    background: 'rgba(0,0,0,0.2)',
    border: '1px solid var(--border-glow)',
    borderRadius: 99,
    padding: '2px 8px 2px 14px',
    height: 32,
  },
  addSkillInput: {
    background: 'none',
    border: 'none',
    color: '#fff',
    fontSize: '0.8rem',
    outline: 'none',
    width: 140,
  },
  addSkillBtn: {
    background: 'rgba(255, 255, 255, 0.05)',
    border: 'none',
    color: 'var(--text-secondary)',
    borderRadius: '50%',
    width: 22,
    height: 22,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  brainstormAction: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  projectCard: {
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  projectHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottom: '1px solid var(--border-glow)',
    paddingBottom: 12,
  },
  projectTitle: {
    fontSize: '1.25rem',
    fontWeight: 700,
    color: '#fff',
  },
  projectTagline: {
    fontSize: '0.8rem',
    color: 'var(--neon-purple)',
    fontWeight: 500,
  },
  difficultyBadge: {
    padding: '4px 10px',
    borderRadius: 6,
    fontSize: '0.75rem',
    fontWeight: 600,
  },
  projSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  sectionHeaderTitle: {
    fontSize: '0.75rem',
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
  },
  projText: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
  },
  techStack: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  techBadge: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid var(--border-glow)',
    padding: '4px 8px',
    borderRadius: 4,
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
  },
  teamSection: {
    marginTop: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  teamList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  teamMemberCard: {
    background: 'rgba(255, 255, 255, 0.01)',
    border: '1px solid var(--border-glow)',
    borderRadius: 8,
    padding: 10,
  },
  teamMemberHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  memberName: {
    fontSize: '0.825rem',
    fontWeight: 600,
    color: '#fff',
  },
  memberContribution: {
    fontSize: '0.75rem',
    color: 'var(--neon-blue)',
    fontWeight: 500,
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


