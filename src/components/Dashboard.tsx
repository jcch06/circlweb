import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { 
  Users, 
  Layers, 
  FileText, 
  Tag, 
  AlertCircle,
  Database,
  ArrowRight
} from 'lucide-react';

interface DashboardProps {
  contacts: any[];
  spaces: any[];
  notes: any[];
  tags: any[];
  selectedSpaceId: string | null;
  user: any;
  onRefreshData: () => Promise<void>;
  setActiveTab: (tab: any) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  contacts,
  spaces,
  notes,
  tags,
  selectedSpaceId,
  user,
  onRefreshData,
  setActiveTab
}) => {
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  // Filter contacts belonging to the selected space (if any)
  const displayedContacts = selectedSpaceId
    ? contacts.filter(c => c.space_id === selectedSpaceId)
    : contacts;

  const displayedNotes = selectedSpaceId
    ? notes.filter(n => displayedContacts.some(c => c.id === n.contact_id))
    : notes;

  // Calculate some analytics
  const recentNotes = [...displayedNotes]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  const activeCircleName = selectedSpaceId
    ? spaces.find(s => s.id === selectedSpaceId)?.name || 'Espace'
    : 'Toutes vos Galaxies (Fusionnées)';

  const handleGenerateDemoData = async () => {
    setLoadingDemo(true);
    setDemoError(null);

    try {
      // Find the space to insert demo data into.
      // We will target the first personal space of the user or the active space.
      let targetSpaceId = selectedSpaceId;
      if (!targetSpaceId) {
        const { data: personalSpace } = await supabase
          .from('spaces')
          .select('id')
          .eq('type', 'personal')
          .eq('created_by', user.id)
          .maybeSingle();
        
        targetSpaceId = personalSpace?.id || (spaces.length > 0 ? spaces[0].id : null);
      }

      if (!targetSpaceId) {
        throw new Error("Aucun Espace trouvé pour insérer les données. Veuillez recharger la page.");
      }

      // Seed 5 demo contacts
      const demoContacts = [
        {
          space_id: targetSpaceId,
          owner_id: user.id,
          first_name: 'Alice',
          last_name: 'Martin',
          company: 'GreenTech Solutions',
          job_title: 'Fondatrice & CEO',
          industry: 'Santé', // Matches default category tag category
          location: 'Paris, France',
          bio: 'Développe un produit SaaS de gestion de carbone pour entreprises. Cherche des fonds et un développeur.',
          source: 'manual',
          ai_context: 'Profil dynamique. Alice cherche un associé technique (Dev React/Node) pour finaliser son MVP et se prépare pour une levée de fonds en septembre.'
        },
        {
          space_id: targetSpaceId,
          owner_id: user.id,
          first_name: 'Bob',
          last_name: 'Dubois',
          company: 'FreeCode',
          job_title: 'Architecte Software',
          industry: 'Tech',
          location: 'Lyon, France',
          bio: 'Développeur FullStack chevronné. Passionné par les projets écologiques et la transition écologique.',
          source: 'manual',
          ai_context: 'Bob cherche un projet à impact à rejoindre en tant que cofondateur technique ou consultant senior. Il maîtrise Node.js, React et PostgreSQL.'
        },
        {
          space_id: targetSpaceId,
          owner_id: user.id,
          first_name: 'Chloé',
          last_name: 'Bernard',
          company: 'Galactic Ventures',
          job_title: 'VC Investor',
          industry: 'Fintech',
          location: 'Paris, France',
          bio: 'Investit en Pre-seed et Seed dans des projets SaaS B2B, climatetech et fintech.',
          source: 'manual',
          ai_context: 'Investisseur à l\'écoute. Chloé cherche de nouveaux projets GreenTech ou SaaS à financer. Ticket moyen : 250k€.'
        },
        {
          space_id: targetSpaceId,
          owner_id: user.id,
          first_name: 'Damien',
          last_name: 'Petit',
          company: 'FlowPay',
          job_title: 'Directeur Marketing',
          industry: 'Fintech',
          location: 'Bordeaux, France',
          bio: 'Expert en acquisition digitale, SEO et Growth Hacking B2B. Auparavant chez Stripe.',
          source: 'manual',
          ai_context: 'Damien peut aider sur la stratégie d\'acquisition. Il cherche des freelances UI/UX pour refondre le site web de FlowPay.'
        },
        {
          space_id: targetSpaceId,
          owner_id: user.id,
          first_name: 'Elsa',
          last_name: 'Morel',
          company: 'Studio Pixel',
          job_title: 'Product Designer UI/UX',
          industry: 'Tech',
          location: 'Marseille, France',
          bio: 'Designer d\'interfaces mobiles et web. Spécialisée en design systems et SaaS.',
          source: 'manual',
          ai_context: 'Elsa cherche des projets SaaS B2B ou Fintech en freelance. Elle a un excellent portfolio et cherche des intros auprès de boîtes comme FlowPay.'
        }
      ];

      // Insert contacts
      const { data: insertedContacts, error: insertError } = await supabase
        .from('contacts')
        .insert(demoContacts)
        .select();

      if (insertError) throw insertError;
      if (!insertedContacts || insertedContacts.length === 0) throw new Error("Erreur d'insertion");

      // Insert notes for these contacts to build rich relationships
      const demoNotes = [
        {
          contact_id: insertedContacts[0].id, // Alice
          author_id: user.id,
          content: 'Rencontrée au Meetup Tech de Paris. Elle cherche désespérément un CTO associé pour coder la version 2. Elle a déjà des marques d\'intérêt de 5 clients.',
          context: 'professional',
          is_private: false
        },
        {
          contact_id: insertedContacts[1].id, // Bob
          author_id: user.id,
          content: 'Bob veut s\'investir dans un projet écologique. Il m\'a dit être disponible immédiatement pour faire du conseil ou s\'associer si l\'équipe est bonne.',
          context: 'professional',
          is_private: false
        },
        {
          contact_id: insertedContacts[2].id, // Chloé
          author_id: user.id,
          content: 'Chloé cherche des deals dans la ClimateTech en France. Elle m\'a demandé si je connaissais des projets sérieux en cours de création.',
          context: 'professional',
          is_private: false
        },
        {
          contact_id: insertedContacts[3].id, // Damien
          author_id: user.id,
          content: 'Damien cherche un designer UI/UX pour une mission de 3 semaines sur leur nouveau dashboard de paiement.',
          context: 'professional',
          is_private: false
        },
        {
          contact_id: insertedContacts[4].id, // Elsa
          author_id: user.id,
          content: 'Elsa cherche des clients en freelance dans le domaine Fintech. Elle est très réactive.',
          context: 'professional',
          is_private: false
        }
      ];

      const { error: notesError } = await supabase
        .from('notes')
        .insert(demoNotes);

      if (notesError) throw notesError;

      // Seed default tags matching if possible
      // Let's add tag associations in contact_tags if tags exist
      const techTag = tags.find(t => t.name.toLowerCase() === 'tech' && t.space_id === targetSpaceId);
      const fintechTag = tags.find(t => t.name.toLowerCase() === 'fintech' && t.space_id === targetSpaceId);
      const contactTagRows: any[] = [];

      if (techTag) {
        // Bob, Elsa are tech
        contactTagRows.push(
          { contact_id: insertedContacts[1].id, tag_id: techTag.id, tagged_by: user.id },
          { contact_id: insertedContacts[4].id, tag_id: techTag.id, tagged_by: user.id }
        );
      }

      if (fintechTag) {
        // Damien, Chloé are fintech
        contactTagRows.push(
          { contact_id: insertedContacts[2].id, tag_id: fintechTag.id, tagged_by: user.id },
          { contact_id: insertedContacts[3].id, tag_id: fintechTag.id, tagged_by: user.id }
        );
      }

      if (contactTagRows.length > 0) {
        await supabase.from('contact_tags').insert(contactTagRows);
      }

      await onRefreshData();
      alert("Données de démonstration générées avec succès ! Vous pouvez maintenant voir le graphe ou ouvrir l'Oracle IA.");
    } catch (err: any) {
      console.error(err);
      setDemoError(err.message || "Une erreur est survenue.");
    } finally {
      setLoadingDemo(false);
    }
  };

  return (
    <div style={styles.container}>
      {/* Title block */}
      <div style={styles.titleBlock}>
        <div>
          <h1 style={styles.title}>{activeCircleName}</h1>
          <p style={styles.subtitle}>Vue d'ensemble de votre réseau et état des connexions</p>
        </div>
        {displayedContacts.length === 0 && (
          <button 
            onClick={handleGenerateDemoData} 
            disabled={loadingDemo}
            className="btn-primary" 
            style={styles.demoBtn}
          >
            <Database size={16} style={{ marginRight: 8 }} />
            {loadingDemo ? 'Génération...' : 'Générer des données démo'}
          </button>
        )}
      </div>

      {demoError && (
        <div style={styles.errorBox}>
          <AlertCircle size={18} color="var(--neon-pink)" />
          <span style={{ fontSize: '0.85rem', color: 'var(--neon-pink)', marginLeft: 8 }}>{demoError}</span>
        </div>
      )}

      {/* Metrics Grid */}
      <div style={styles.metricsGrid}>
        <div 
          className="glass-card" 
          onClick={() => setActiveTab('contacts')} 
          style={{ ...styles.metricCard, cursor: 'pointer' }}
        >
          <div style={styles.metricHeader}>
            <span style={styles.metricTitle}>Contacts</span>
            <Users size={20} color="var(--neon-purple)" />
          </div>
          <span style={styles.metricValue}>{displayedContacts.length}</span>
          <span style={styles.metricLabel}>Étoiles dans votre galaxie</span>
        </div>

        <div 
          className="glass-card" 
          onClick={() => setActiveTab('spaces')} 
          style={{ ...styles.metricCard, cursor: 'pointer' }}
        >
          <div style={styles.metricHeader}>
            <span style={styles.metricTitle}>Galaxies / Cercles</span>
            <Layers size={20} color="var(--neon-blue)" />
          </div>
          <span style={styles.metricValue}>{spaces.length}</span>
          <span style={styles.metricLabel}>Espaces collaboratifs ou persos</span>
        </div>

        <div 
          className="glass-card" 
          onClick={() => setActiveTab('tags')} 
          style={{ ...styles.metricCard, cursor: 'pointer' }}
        >
          <div style={styles.metricHeader}>
            <span style={styles.metricTitle}>Tags & Filtres</span>
            <Tag size={20} color="var(--neon-green)" />
          </div>
          <span style={styles.metricValue}>{tags.filter(t => selectedSpaceId ? t.space_id === selectedSpaceId : true).length}</span>
          <span style={styles.metricLabel}>Compétences et secteurs répertoriés</span>
        </div>

        <div 
          className="glass-card" 
          onClick={() => setActiveTab('notes')} 
          style={{ ...styles.metricCard, cursor: 'pointer' }}
        >
          <div style={styles.metricHeader}>
            <span style={styles.metricTitle}>Notes d'échanges</span>
            <FileText size={20} color="var(--neon-yellow)" />
          </div>
          <span style={styles.metricValue}>{displayedNotes.length}</span>
          <span style={styles.metricLabel}>Comptes-rendus IA et manuels</span>
        </div>
      </div>

      <div style={styles.contentRow}>
        {/* Quick action card */}
        <div className="glass-card" style={styles.mainCard}>
          <h3 style={styles.cardTitle}>Fusionner & Trouver des Opportunités</h3>
          <p style={styles.cardDesc}>
            Connectez vos galaxies de contacts avec celles de vos associés pour identifier des cross-connexions. 
            Notre IA analyse les compétences disponibles et les besoins de chacun pour vous proposer des projets innovants.
          </p>
          <div style={styles.actions}>
            <button 
              onClick={() => setActiveTab('galaxy')} 
              className="btn-primary" 
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
            >
              Visualiser la Galaxie
              <ArrowRight size={16} />
            </button>
            <button 
              onClick={() => setActiveTab('oracle')} 
              className="btn-secondary"
            >
              Consulter l'Oracle IA
            </button>
          </div>
        </div>

        {/* Recent notes sidebar */}
        <div className="glass-panel" style={styles.notesPanel}>
          <h3 style={styles.panelTitle}>Échanges récents</h3>
          <div style={styles.notesList}>
            {recentNotes.length === 0 ? (
              <div style={styles.emptyNotes}>
                <FileText size={28} color="var(--text-muted)" style={{ marginBottom: 8 }} />
                <span>Aucune note disponible dans cette sélection.</span>
              </div>
            ) : (
              recentNotes.map((note) => {
                const contact = contacts.find(c => c.id === note.contact_id);
                return (
                  <div key={note.id} style={styles.noteItem}>
                    <div style={styles.noteHeader}>
                      <span style={styles.noteContact}>
                        {contact ? `${contact.first_name} ${contact.last_name}` : 'Contact inconnu'}
                      </span>
                      <span style={styles.noteDate}>
                        {new Date(note.created_at).toLocaleDateString('fr-FR', {
                          day: 'numeric',
                          month: 'short'
                        })}
                      </span>
                    </div>
                    <p style={styles.noteContent}>{note.content}</p>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
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
    gap: 30,
  },
  titleBlock: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: '2.25rem',
    fontWeight: 800,
    marginBottom: 6,
    color: 'var(--text-primary)',
  },
  subtitle: {
    fontSize: '0.95rem',
    color: 'var(--text-secondary)',
  },
  demoBtn: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 18px',
    background: 'linear-gradient(135deg, var(--neon-blue), var(--neon-purple))',
    fontSize: '0.85rem',
  },
  errorBox: {
    background: 'rgba(236, 111, 139, 0.1)',
    border: '1px solid rgba(236, 111, 139, 0.2)',
    borderRadius: 10,
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 20,
  },
  metricCard: {
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  metricHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metricTitle: {
    fontSize: '0.8rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  metricValue: {
    fontSize: '2.5rem',
    fontWeight: 800,
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-display)',
    lineHeight: 1,
  },
  metricLabel: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
  },
  contentRow: {
    display: 'grid',
    gridTemplateColumns: '3fr 2fr',
    gap: 30,
    alignItems: 'start',
  },
  mainCard: {
    padding: 30,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    height: '100%',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: '1.5rem',
    fontWeight: 700,
  },
  cardDesc: {
    fontSize: '0.95rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.6,
  },
  actions: {
    display: 'flex',
    gap: 14,
    marginTop: 10,
  },
  notesPanel: {
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    maxHeight: '400px',
  },
  panelTitle: {
    fontSize: '1.1rem',
    fontWeight: 700,
  },
  notesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    overflowY: 'auto',
    flexGrow: 1,
    paddingRight: 4,
  },
  emptyNotes: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '200px',
    color: 'var(--text-muted)',
    fontSize: '0.85rem',
    textAlign: 'center',
  },
  noteItem: {
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid rgba(255, 255, 255, 0.04)',
    borderRadius: 8,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  noteHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  noteContact: {
    fontSize: '0.85rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  noteDate: {
    fontSize: '0.7rem',
    color: 'var(--text-muted)',
  },
  noteContent: {
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.4,
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    overflow: 'hidden',
  },
};

