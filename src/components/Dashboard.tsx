import React, { useState } from 'react';
import { Users, Layers, Tag, StickyNote, Sparkles, Network } from 'lucide-react';
import { supabase } from '../lib/supabase';

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

  const displayedContacts = selectedSpaceId
    ? contacts.filter(c => c.space_id === selectedSpaceId)
    : contacts;

  const displayedNotes = selectedSpaceId
    ? notes.filter(n => displayedContacts.some(c => c.id === n.contact_id))
    : notes;

  const recentNotes = [...displayedNotes]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  const activeCircleName = selectedSpaceId
    ? spaces.find(s => s.id === selectedSpaceId)?.name || 'Espace'
    : 'Tous les contacts';

  const handleGenerateDemoData = async () => {
    setLoadingDemo(true);
    setDemoError(null);
    try {
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
      if (!targetSpaceId) throw new Error("Aucun Espace trouvé.");

      const demoContacts = [
        {
          space_id: targetSpaceId, owner_id: user.id, first_name: 'Alice', last_name: 'Martin',
          company: 'GreenTech Solutions', job_title: 'CEO', industry: 'Tech', location: 'Paris',
          bio: 'Développe un produit SaaS', source: 'manual', ai_context: 'Recherche associé tech.'
        },
        {
          space_id: targetSpaceId, owner_id: user.id, first_name: 'Bob', last_name: 'Dubois',
          company: 'FreeCode', job_title: 'Dev', industry: 'Tech', location: 'Lyon',
          bio: 'Dev JS', source: 'manual', ai_context: 'Cherche mission freelance.'
        }
      ];

      const { data: insertedContacts, error: insertError } = await supabase.from('contacts').insert(demoContacts).select();
      if (insertError) throw insertError;
      if (!insertedContacts || insertedContacts.length === 0) throw new Error("Erreur insertion");

      const demoNotes = [
        { contact_id: insertedContacts[0].id, author_id: user.id, content: 'Rencontrée à Paris. Cherche dev.', context: 'professional', is_private: false },
        { contact_id: insertedContacts[1].id, author_id: user.id, content: 'Dispo freelance.', context: 'professional', is_private: false }
      ];
      const { error: notesError } = await supabase.from('notes').insert(demoNotes);
      if (notesError) throw notesError;

      await onRefreshData();
    } catch (err: any) {
      console.error(err);
      setDemoError(err.message || "Erreur.");
    } finally {
      setLoadingDemo(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.titleBlock}>
        <div>
          <h1 style={styles.title}>{activeCircleName}</h1>
          <p style={styles.subtitle}>Vue d'ensemble</p>
        </div>
        {displayedContacts.length === 0 && (
          <button onClick={handleGenerateDemoData} disabled={loadingDemo} className="btn-primary">
            {loadingDemo ? 'Génération...' : 'Générer contacts démo'}
          </button>
        )}
      </div>

      {demoError && (
        <div style={styles.errorBox}>
          <span>[Erreur] {demoError}</span>
        </div>
      )}

      <div style={styles.metricsGrid}>
        <div className="glass-card" onClick={() => setActiveTab('contacts')} style={styles.metricCard}>
          <div style={styles.metricHeader}>
            <Users size={15} style={styles.metricIcon} />
            <span style={styles.metricTitle}>Contacts</span>
          </div>
          <span style={styles.metricValue}>{displayedContacts.length}</span>
        </div>

        <div className="glass-card" onClick={() => setActiveTab('spaces')} style={styles.metricCard}>
          <div style={styles.metricHeader}>
            <Layers size={15} style={styles.metricIcon} />
            <span style={styles.metricTitle}>Espaces</span>
          </div>
          <span style={styles.metricValue}>{spaces.length}</span>
        </div>

        <div className="glass-card" onClick={() => setActiveTab('tags')} style={styles.metricCard}>
          <div style={styles.metricHeader}>
            <Tag size={15} style={styles.metricIcon} />
            <span style={styles.metricTitle}>Tags</span>
          </div>
          <span style={styles.metricValue}>{tags.filter(t => selectedSpaceId ? t.space_id === selectedSpaceId : true).length}</span>
        </div>

        <div className="glass-card" onClick={() => setActiveTab('notes')} style={styles.metricCard}>
          <div style={styles.metricHeader}>
            <StickyNote size={15} style={styles.metricIcon} />
            <span style={styles.metricTitle}>Notes</span>
          </div>
          <span style={styles.metricValue}>{displayedNotes.length}</span>
        </div>
      </div>

      <div style={styles.contentRow}>
        <div className="glass-card" style={styles.mainCard}>
          <h3 style={styles.cardTitle}>Analyse du réseau</h3>
          <p style={styles.cardDesc}>
            L'IA connecte les profils, identifie les opportunités et suggère des actions concrètes.
          </p>
          <div style={styles.actions}>
            <button onClick={() => setActiveTab('oracle')} className="btn-primary" style={styles.iconBtn}>
              <Sparkles size={14} />
              Lancer l'analyse
            </button>
            <button onClick={() => setActiveTab('galaxy')} className="btn-secondary" style={styles.iconBtn}>
              <Network size={14} />
              Voir le graphe
            </button>
          </div>
        </div>

        <div className="glass-card" style={styles.notesPanel}>
          <h3 style={styles.panelTitle}>Dernières notes</h3>
          <div className="scroll-y" style={styles.notesList}>
            {recentNotes.length === 0 ? (
              <div style={styles.emptyNotes}>
                <span>Aucune note.</span>
              </div>
            ) : (
              recentNotes.map((note) => {
                const contact = contacts.find(c => c.id === note.contact_id);
                return (
                  <div key={note.id} style={styles.noteItem}>
                    <div style={styles.noteHeader}>
                      <span style={styles.noteContact}>
                        {contact ? `${contact.first_name} ${contact.last_name}` : 'Inconnu'}
                      </span>
                      <span style={styles.noteDate}>
                        {new Date(note.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
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
    fontSize: '2rem',
    fontWeight: 700,
    marginBottom: 4,
    color: 'var(--text-primary)',
  },
  subtitle: {
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
  },
  errorBox: {
    border: '1px solid var(--border-active)',
    borderRadius: 8,
    padding: '10px 16px',
    color: 'var(--text-primary)',
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 16,
  },
  metricCard: {
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    cursor: 'pointer',
  },
  metricHeader: {
    display: 'flex',
    justifyContent: 'flex-start',
    alignItems: 'center',
    gap: 8,
  },
  metricIcon: {
    color: 'var(--text-muted)',
  },
  metricTitle: {
    fontSize: '0.75rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  },
  metricValue: {
    fontSize: '2rem',
    fontWeight: 700,
    color: 'var(--text-primary)',
    lineHeight: 1,
    fontFamily: 'var(--font-mono)',
  },
  contentRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
    alignItems: 'stretch',
    minHeight: 0,
    flex: 1,
  },
  mainCard: {
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    height: '100%',
  },
  cardTitle: {
    fontSize: '1.15rem',
    fontWeight: 600,
  },
  cardDesc: {
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
  },
  actions: {
    display: 'flex',
    gap: 10,
    marginTop: 'auto',
  },
  iconBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
  },
  notesPanel: {
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    height: '100%',
    minHeight: 0,
  },
  panelTitle: {
    fontSize: '1.15rem',
    fontWeight: 600,
  },
  notesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    flex: 1,
    minHeight: 0,
  },
  emptyNotes: {
    padding: 20,
    color: 'var(--text-secondary)',
    fontSize: '0.85rem',
    textAlign: 'center',
  },
  noteItem: {
    border: '1px solid var(--border)',
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
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
  },
  noteContent: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.4,
  },
};
