import React, { useState, useEffect } from 'react';
import { Inbox, Send, Check, User, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { listIncomingRequests, respondToAccessRequest } from '../lib/contactAccess';
import type { AccessRequest } from '../lib/contactAccess';


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
  const [activeSubTab, setActiveSubTab] = useState<'list' | 'invitations' | 'access-requests'>('list');
  const [syncingSpaceId, setSyncingSpaceId] = useState<string | null>(null);
  const [updatingSharingSpaceId, setUpdatingSharingSpaceId] = useState<string | null>(null);

  // Contact access requests (people asking to see a locked contact's full details)
  const [incomingAccessRequests, setIncomingAccessRequests] = useState<AccessRequest[]>([]);
  const [loadingAccessRequests, setLoadingAccessRequests] = useState(false);
  const [respondingRequestId, setRespondingRequestId] = useState<string | null>(null);

  const fetchAccessRequests = async () => {
    if (!user) return;
    setLoadingAccessRequests(true);
    try {
      const requests = await listIncomingRequests(user.id);
      setIncomingAccessRequests(requests);
    } finally {
      setLoadingAccessRequests(false);
    }
  };

  useEffect(() => {
    fetchAccessRequests();
  }, [user]);

  const handleRespondToRequest = async (requestId: string, approve: boolean) => {
    setRespondingRequestId(requestId);
    try {
      await respondToAccessRequest(requestId, approve);
      setIncomingAccessRequests(prev => prev.filter(r => r.id !== requestId));
      await onRefreshData();
    } catch (err: any) {
      alert(`Erreur : ${err.message || err}`);
    } finally {
      setRespondingRequestId(null);
    }
  };

  const handleToggleSharingMode = async (spaceId: string, currentMode: string) => {
    const nextMode = currentMode === 'request_only' ? 'full' : 'request_only';
    setUpdatingSharingSpaceId(spaceId);
    try {
      const { error } = await supabase
        .from('spaces')
        .update({ contact_sharing_mode: nextMode })
        .eq('id', spaceId);
      if (error) throw error;
      await onRefreshData();
    } catch (err: any) {
      alert(`Erreur lors du changement de mode de partage : ${err.message || err}`);
    } finally {
      setUpdatingSharingSpaceId(null);
    }
  };

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

      alert("Félicitations ! Les galaxies ont été fusionnées avec succès. Vous partagez désormais cet Espace.");
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
                <option value="personal">Espace Personnel (Uniquement visible par moi)</option>
                <option value="team">Espace Collaboratif / Team (Partageable avec d'autres utilisateurs)</option>
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
        <button
          onClick={() => setActiveSubTab('access-requests')}
          style={{
            ...styles.tabBtn,
            color: activeSubTab === 'access-requests' ? 'var(--neon-green)' : 'var(--text-secondary)',
            borderBottom: activeSubTab === 'access-requests' ? '2px solid var(--neon-green)' : 'none'
          }}
        >
          Demandes d'accès ({incomingAccessRequests.length})
        </button>
      </div>

      {activeSubTab === 'list' && (
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
                      background: 'rgba(27, 23, 37, 0.05)',
                      border: '1.5px solid var(--border-hover)'
                    }}>
                      {isPersonal ? <User size={18} color="var(--text-secondary)" /> : <Users size={18} color="var(--text-secondary)" />}
                    </div>
                    <div>
                      <h3 style={styles.spaceName}>{s.name}</h3>
                      <div style={styles.typeBadgeRow}>
                        <span style={{
                          ...styles.typeBadge,
                          color: 'var(--text-primary)',
                          backgroundColor: 'rgba(27, 23, 37, 0.06)'
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

                  {!isPersonal && isOwner && (
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      padding: '8px 0', borderTop: '1px solid rgba(27, 23, 37, 0.06)', marginTop: 8
                    }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }} title="Contrôle ce que les autres membres voient par défaut sur les contacts que vous n'avez pas ajoutés vous-même.">
                        {s.contact_sharing_mode === 'request_only' ? 'Accès sur demande' : 'Partage intégral'}
                      </span>
                      <button
                        onClick={() => handleToggleSharingMode(s.id, s.contact_sharing_mode || 'full')}
                        disabled={updatingSharingSpaceId === s.id}
                        className="glass-button"
                        style={{ fontSize: '0.7rem', padding: '4px 10px', whiteSpace: 'nowrap' }}
                      >
                        {updatingSharingSpaceId === s.id
                          ? '...'
                          : s.contact_sharing_mode === 'request_only'
                            ? 'Passer en partage intégral'
                            : 'Passer en accès sur demande'}
                      </button>
                    </div>
                  )}

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
      )}

      {activeSubTab === 'invitations' && (
        /* Invitations Panel */
        <div style={styles.invitationsLayout}>
          {/* Incoming */}
          <div className="glass-panel" style={styles.inviteSection}>
            <h3 style={styles.sectionTitleInvite}><Inbox size={16} /> Demandes de fusion reçues ({incomingInvites.length})</h3>
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
                      <Check size={14} /> Accepter la Fusion
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Outgoing */}
          <div className="glass-panel" style={styles.inviteSection}>
            <h3 style={styles.sectionTitleInvite}><Send size={16} /> Invitations de fusion envoyées ({outgoingInvites.length})</h3>
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
                          <span style={{ color: 'var(--text-primary)', display: 'flex', alignItems: 'center', fontSize: '0.8rem', fontWeight: 600 }}>
                            
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

      {activeSubTab === 'access-requests' && (
        /* Contact Access Requests Panel */
        <div className="glass-panel" style={styles.inviteSection}>
          <h3 style={styles.sectionTitleInvite}>Demandes d'accès reçues ({incomingAccessRequests.length})</h3>
          <div style={styles.invitesList}>
            {loadingAccessRequests ? (
              <span style={styles.emptyText}>Chargement...</span>
            ) : incomingAccessRequests.length === 0 ? (
              <span style={styles.emptyText}>Aucune demande d'accès en attente. Quand un membre de votre équipe demande à voir les détails complets d'un de vos contacts verrouillés, ça apparaîtra ici.</span>
            ) : (
              incomingAccessRequests.map(req => (
                <div key={req.id} className="glass-card" style={styles.inviteCard}>
                  <div>
                    <h4 style={styles.inviteSpaceName}>{req.contactName || 'Contact'}</h4>
                    {req.reason && (
                      <p style={styles.inviteMeta}>Raison : {req.reason}</p>
                    )}
                    <p style={styles.inviteMeta}>
                      Demandé le {new Date(req.createdAt).toLocaleDateString('fr-FR')}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => handleRespondToRequest(req.id, true)}
                      disabled={respondingRequestId === req.id}
                      className="btn-primary"
                      style={styles.acceptBtn}
                    >
                      Approuver
                    </button>
                    <button
                      onClick={() => handleRespondToRequest(req.id, false)}
                      disabled={respondingRequestId === req.id}
                      className="glass-button"
                      style={{ fontSize: '0.8rem', padding: '8px 14px' }}
                    >
                      Refuser
                    </button>
                  </div>
                </div>
              ))
            )}
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
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: '2.25rem',
    fontWeight: 800,
    color: 'var(--text-primary)',
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
    color: 'var(--text-primary)',
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
    background: 'var(--bg-input)',
    border: '1px solid var(--border-glow)',
    borderRadius: 8,
    padding: '10px 14px',
    color: 'var(--text-primary)',
    outline: 'none',
    fontSize: '0.9rem',
  },
  select: {
    background: 'var(--bg-input)',
    border: '1px solid var(--border-glow)',
    borderRadius: 8,
    padding: '10px 14px',
    color: 'var(--text-primary)',
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
    color: 'var(--text-primary)',
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
    color: 'var(--text-primary)',
    backgroundColor: 'rgba(27, 23, 37, 0.08)',
    padding: '3px 8px',
    borderRadius: 4,
    display: 'inline-flex',
    alignItems: 'center',
  },
  cardFooter: {
    borderTop: '1px solid rgba(27, 23, 37, 0.03)',
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
    background: 'rgba(27, 23, 37, 0.06)',
    border: '1px solid var(--border-hover)',
    color: 'var(--text-primary)',
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
    color: 'var(--text-primary)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
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
    color: 'var(--text-primary)',
    marginBottom: 4,
  },
  inviteMeta: {
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
  },
  acceptBtn: {
    padding: '8px 16px',
    fontSize: '0.8rem',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
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
