import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';


interface SpacesPageProps {
  spaces: any[];
  user: any;
  onRefreshData: () => Promise<void>;
}

export const SpacesPage: React.FC<SpacesPageProps> = ({
  spaces,
  user,
  onRefreshData
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [loading, setLoading] = useState(false);

  // Form Fields
  const [name, setName] = useState('');
  const [type, setType] = useState<'personal' | 'team'>('personal');

  // Invitations States
  const [incomingInvites, setIncomingInvites] = useState<any[]>([]);
  const [outgoingInvites, setOutgoingInvites] = useState<any[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'list' | 'invitations'>('list');
  const [syncingSpaceId, setSyncingSpaceId] = useState<string | null>(null);

  const fetchInvitations = async () => {
    if (!user) return;
    setLoadingInvites(true);
    try {
      // 1. Fetch Incoming
      const { data: incoming, error: incError } = await supabase
        .from('invitations')
        .select('*, space:spaces(name, created_by)')
        .eq('email', user.email)
        .is('accepted_at', null);

      if (incError) throw incError;
      setIncomingInvites(incoming || []);

      // 2. Fetch Outgoing
      const { data: outgoing, error: outError } = await supabase
        .from('invitations')
        .select('*, space:spaces(name)')
        .eq('invited_by', user.id);

      if (outError) throw outError;
      setOutgoingInvites(outgoing || []);
    } catch (err) {
      console.error("Erreur lors de la récupération des invitations :", err);
    } finally {
      setLoadingInvites(false);
    }
  };

  useEffect(() => {
    fetchInvitations();
  }, [user, spaces]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert("Veuillez renseigner le nom de la galaxie.");
      return;
    }

    setLoading(true);
    try {
      // Call the Supabase RPC to atomically create the space and add the user as owner
      const { error } = await supabase.rpc('create_team_space', {
        team_name: name.trim()
      });

      if (error) throw error;

      // Reset form
      setName('');
      setShowAddForm(false);
      
      await onRefreshData();
      alert("Espace Collaboratif créé avec succès !");
    } catch (err: any) {
      console.error(err);
      alert(`Erreur de création : ${err.message || 'Impossible d\'ajouter la galaxie.'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptInvite = async (token: string) => {
    setLoadingInvites(true);
    try {
      const { error } = await supabase.rpc('accept_invitation', {
        invitation_token: token
      });

      if (error) throw error;

      alert("Félicitations ! Les galaxies ont été fusionnées avec succès. Vous partagez désormais cet Espace �");
      await onRefreshData();
      await fetchInvitations();
    } catch (err: any) {
      console.error(err);
      alert(`Erreur d'acceptation : ${err.message || "Impossible d'accepter la fusion."}`);
    } finally {
      setLoadingInvites(false);
    }
  };

  const handleSyncNetwork = async (targetSpaceId: string) => {
    if (!window.confirm("Voulez-vous vraiment copier tous vos contacts personnels dans cet espace partagé ?")) return;

    setSyncingSpaceId(targetSpaceId);
    try {
      const personalSpace = spaces.find(s => s.type === 'personal');
      if (!personalSpace) throw new Error("Espace personnel introuvable.");

      const { data: personalContacts, error: fetchError } = await supabase
        .from('contacts')
        .select('*')
        .eq('space_id', personalSpace.id);

      if (fetchError) throw fetchError;
      if (!personalContacts || personalContacts.length === 0) {
        alert("Votre carnet d'adresses personnel est vide.");
        return;
      }

      const { data: existingContacts, error: existError } = await supabase
        .from('contacts')
        .select('first_name, last_name')
        .eq('space_id', targetSpaceId);

      if (existError) throw existError;

      const newContacts = personalContacts.filter(pc => 
        !existingContacts.some(ec => 
          ec.first_name.toLowerCase() === pc.first_name.toLowerCase() && 
          ec.last_name.toLowerCase() === pc.last_name.toLowerCase()
        )
      );

      if (newContacts.length === 0) {
        alert("Tous vos contacts personnels sont déjà présents dans cet espace.");
        return;
      }

      const insertPayload = newContacts.map(c => ({
        space_id: targetSpaceId,
        owner_id: user.id,
        first_name: c.first_name,
        last_name: c.last_name,
        company: c.company,
        job_title: c.job_title,
        industry: c.industry,
        location: c.location,
        bio: c.bio,
        email: c.email,
        phone: c.phone,
        linkedin: c.linkedin,
        ai_context: c.ai_context,
        source: 'import'
      }));

      const { error: insertError } = await supabase.from('contacts').insert(insertPayload);
      if (insertError) throw insertError;

      await onRefreshData();
      alert(`${newContacts.length} contacts synchronisés avec succès dans cet espace !`);
    } catch (err: any) {
      console.error(err);
      alert(`Erreur lors de la synchronisation : ${err.message}`);
    } finally {
      setSyncingSpaceId(null);
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Vos Galaxies / Espaces</h1>
          <p style={styles.subtitle}>Gerez vos constellations personnelles et cercles partages</p>
        </div>
        <button 
          onClick={() => setShowAddForm(!showAddForm)} 
          className="btn-primary" 
          style={styles.addBtn}
        >
          
          {showAddForm ? 'Fermer' : 'Nouveau Cercle'}
        </button>
      </div>

      {/* Add Space Form */}
      {showAddForm && (
        <form onSubmit={handleSubmit} className="glass-card" style={styles.formCard}>
          <h3 style={styles.formTitle}>Créer un nouvel espace galactique</h3>
          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Nom de la Galaxie / Cercle *</label>
              <input 
                type="text" 
                value={name} 
                onChange={(e) => setName(e.target.value)} 
                required 
                placeholder="Ex: Mon Réseau Tech, Seed Investisseurs..."
                style={styles.input} 
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Type de Galaxie *</label>
              <select 
                value={type} 
                onChange={(e) => setType(e.target.value as any)} 
                required 
                style={styles.select}
              >
                <option value="personal">� Espace Personnel (Uniquement visible par moi)</option>
                <option value="team">� Espace Collaboratif / Team (Partageable avec d'autres utilisateurs)</option>
              </select>
            </div>
          </div>
          <button type="submit" disabled={loading} className="btn-primary" style={styles.submitBtn}>
            {loading ? 'Création de l\'espace...' : 'Créer l\'Espace '}
          </button>
        </form>
      )}

      {/* Sub Tabs Navigation */}
      <div style={styles.tabNav}>
        <button 
          onClick={() => setActiveSubTab('list')}
          style={{
            ...styles.tabBtn,
            color: activeSubTab === 'list' ? 'var(--neon-blue)' : 'var(--text-secondary)',
            borderBottom: activeSubTab === 'list' ? '2px solid var(--neon-blue)' : 'none'
          }}
        >
          
          Mes Espaces ({spaces.length})
        </button>
        <button 
          onClick={() => setActiveSubTab('invitations')}
          style={{
            ...styles.tabBtn,
            color: activeSubTab === 'invitations' ? 'var(--neon-purple)' : 'var(--text-secondary)',
            borderBottom: activeSubTab === 'invitations' ? '2px solid var(--neon-purple)' : 'none'
          }}
        >
          
          Fusions & Invitations ({incomingInvites.length + outgoingInvites.length})
        </button>
      </div>

      {activeSubTab === 'list' ? (
        /* List of Spaces */
        <div style={styles.spacesGrid}>
          {spaces.length === 0 ? (
            <div style={styles.emptyState}>
              
              <span>Aucune galaxie configurée.</span>
            </div>
          ) : (
            spaces.map(s => {
              const isPersonal = s.type === 'personal';
              const isOwner = s.created_by === user.id;

              return (
                <div key={s.id} className="glass-card" style={styles.spaceCard}>
                  <div style={styles.cardHeader}>
                    <div style={{
                      ...styles.iconWrapper,
                      background: isPersonal ? 'rgba(79, 142, 247, 0.1)' : 'rgba(48, 192, 96, 0.1)',
                      border: `1.5px solid ${isPersonal ? 'var(--neon-blue)' : 'var(--neon-green)'}`
                    }}>
                      
                    </div>
                    <div>
                      <h3 style={styles.spaceName}>{s.name}</h3>
                      <div style={styles.typeBadgeRow}>
                        <span style={{
                          ...styles.typeBadge,
                          color: isPersonal ? 'var(--neon-blue)' : 'var(--neon-green)',
                          backgroundColor: isPersonal ? 'rgba(79, 142, 247, 0.08)' : 'rgba(48, 192, 96, 0.08)'
                        }}>
                          {isPersonal ? 'Personnel' : 'Collaboratif'}
                        </span>
                        {isOwner && (
                          <span style={styles.ownerBadge}>
                            
                            Propriétaire
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={styles.cardFooter}>
                    <span style={styles.creationText}>
                      Créé le {new Date(s.created_at).toLocaleDateString('fr-FR', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric'
                      })}
                    </span>
                    {!isPersonal && (
                      <button 
                        onClick={() => handleSyncNetwork(s.id)}
                        disabled={syncingSpaceId !== null}
                        style={styles.syncBtn}
                        title="Copier vos contacts personnels dans cet espace partagé"
                      >
                        {syncingSpaceId === s.id ? 'Sync...' : 'Pousser mon réseau '}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* Invitations Panel */
        <div style={styles.invitationsLayout}>
          {/* Incoming */}
          <div className="glass-panel" style={styles.inviteSection}>
            <h3 style={styles.sectionTitleInvite}>� Demandes de fusion reçues ({incomingInvites.length})</h3>
            <div style={styles.invitesList}>
              {incomingInvites.length === 0 ? (
                <span style={styles.emptyText}>Aucune demande de fusion en attente.</span>
              ) : (
                incomingInvites.map(inv => (
                  <div key={inv.id} className="glass-card" style={styles.inviteCard}>
                    <div>
                      <h4 style={styles.inviteSpaceName}>Galaxie : {inv.space?.name || 'Espace collaboratif'}</h4>
                      <p style={styles.inviteMeta}>
                        Par invitation envoyée à : <b>{inv.email}</b>
                      </p>
                    </div>
                    <button 
                      onClick={() => handleAcceptInvite(inv.token)}
                      disabled={loadingInvites}
                      className="btn-primary"
                      style={styles.acceptBtn}
                    >
                      Accepter la Fusion �
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Outgoing */}
          <div className="glass-panel" style={styles.inviteSection}>
            <h3 style={styles.sectionTitleInvite}>� Invitations de fusion envoyées ({outgoingInvites.length})</h3>
            <div style={styles.invitesList}>
              {outgoingInvites.length === 0 ? (
                <span style={styles.emptyText}>Aucune invitation envoyée.</span>
              ) : (
                outgoingInvites.map(inv => {
                  const isAccepted = inv.accepted_at !== null;
                  return (
                    <div key={inv.id} className="glass-card" style={styles.inviteCard}>
                      <div>
                        <h4 style={styles.inviteSpaceName}>Galaxie : {inv.space?.name || 'Inconnue'}</h4>
                        <p style={styles.inviteMeta}>
                          Envoyée à : <b>{inv.email}</b>
                        </p>
                      </div>
                      <div style={styles.statusBlock}>
                        {isAccepted ? (
                          <span style={{ color: '#fff', display: 'flex', alignItems: 'center', fontSize: '0.8rem', fontWeight: 600 }}>
                            
                            Fusionnée
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', fontSize: '0.8rem' }}>
                            
                            En attente
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
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
  addBtn: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 18px',
    fontSize: '0.85rem',
  },
  formCard: {
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  formTitle: {
    fontSize: '1.25rem',
    fontWeight: 700,
    color: '#fff',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: '0.75rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
  },
  input: {
    background: 'rgba(0,0,0,0.2)',
    border: '1px solid var(--border-glow)',
    borderRadius: 8,
    padding: '10px 14px',
    color: '#fff',
    outline: 'none',
    fontSize: '0.9rem',
  },
  select: {
    background: 'rgba(0,0,0,0.2)',
    border: '1px solid var(--border-glow)',
    borderRadius: 8,
    padding: '10px 14px',
    color: '#fff',
    outline: 'none',
    fontSize: '0.9rem',
  },
  submitBtn: {
    alignSelf: 'flex-start',
    padding: '12px 24px',
  },
  tabNav: {
    display: 'flex',
    gap: 16,
    borderBottom: '1px solid var(--border-glow)',
    paddingBottom: 1,
  },
  tabBtn: {
    background: 'none',
    border: 'none',
    fontSize: '0.9rem',
    fontWeight: 600,
    cursor: 'pointer',
    padding: '10px 4px',
    transition: 'var(--transition-smooth)',
  },
  spacesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: 20,
  },
  spaceCard: {
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    height: '140px',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
  },
  iconWrapper: {
    width: 46,
    height: 46,
    borderRadius: '12px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  spaceName: {
    fontSize: '1.1rem',
    fontWeight: 700,
    color: '#fff',
    marginBottom: 6,
  },
  typeBadgeRow: {
    display: 'flex',
    gap: 8,
  },
  typeBadge: {
    fontSize: '0.65rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    padding: '3px 8px',
    borderRadius: 4,
    display: 'inline-flex',
    alignItems: 'center',
  },
  ownerBadge: {
    fontSize: '0.65rem',
    fontWeight: 700,
    color: '#fff',
    backgroundColor: 'rgba(159, 97, 232, 0.08)',
    padding: '3px 8px',
    borderRadius: 4,
    display: 'inline-flex',
    alignItems: 'center',
  },
  cardFooter: {
    borderTop: '1px solid rgba(255,255,255,0.03)',
    paddingTop: 10,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  creationText: {
    fontSize: '0.725rem',
    color: 'var(--text-muted)',
  },
  syncBtn: {
    background: 'rgba(48, 192, 96, 0.1)',
    border: '1px solid rgba(48, 192, 96, 0.3)',
    color: '#fff',
    fontSize: '0.7rem',
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: 6,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  emptyState: {
    gridColumn: '1 / -1',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    border: '1.5px dashed var(--border-glow)',
    borderRadius: 16,
    color: 'var(--text-muted)',
  },

  // Invitations styles
  invitationsLayout: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 24,
  },
  inviteSection: {
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  sectionTitleInvite: {
    fontSize: '1.05rem',
    fontWeight: 700,
    color: '#fff',
  },
  invitesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  inviteCard: {
    padding: 16,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
  },
  inviteSpaceName: {
    fontSize: '0.9rem',
    fontWeight: 700,
    color: '#fff',
    marginBottom: 4,
  },
  inviteMeta: {
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
  },
  acceptBtn: {
    padding: '8px 16px',
    fontSize: '0.8rem',
  },
  statusBlock: {
    display: 'flex',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    fontStyle: 'italic',
  }
};
