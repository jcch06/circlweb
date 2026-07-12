import React from 'react';
import { 
  Sparkles, 
  LayoutDashboard, 
  Orbit, 
  Brain, 
  PlusCircle, 
  LogOut, 
  Layers,
  Users,
  Tag,
  FileText
} from 'lucide-react';

export type TabType = 'dashboard' | 'galaxy' | 'oracle' | 'ingestion' | 'contacts' | 'spaces' | 'tags' | 'notes';

interface SidebarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  spaces: any[];
  selectedSpaceId: string | null; // null = Merged Galaxies
  setSelectedSpaceId: (id: string | null) => void;
  user: any;
  onLogout: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  spaces,
  selectedSpaceId,
  setSelectedSpaceId,
  user,
  onLogout
}) => {
  return (
    <aside className="glass-sidebar" style={styles.sidebar}>
      {/* Title */}
      <div style={styles.header}>
        <div style={styles.logoIcon}>
          <Sparkles size={20} color="var(--neon-purple)" />
        </div>
        <h2 style={styles.logoText}>
          CIRCL <span className="text-gradient-purple-blue">WEB</span>
        </h2>
      </div>

      {/* Galaxy Space Selector (Core concept: Fusion) */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <Layers size={14} color="var(--text-secondary)" />
          <span style={styles.sectionTitle}>Nébuleuse Active</span>
        </div>
        <div style={styles.spaceList}>
          {/* Merger Option */}
          <button
            onClick={() => setSelectedSpaceId(null)}
            style={{
              ...styles.spaceItem,
              ...(selectedSpaceId === null ? styles.spaceItemActiveMerger : {}),
            }}
          >
            <Orbit size={16} color={selectedSpaceId === null ? 'var(--neon-pink)' : 'var(--neon-purple)'} />
            <div style={styles.spaceDetails}>
              <span style={{ 
                ...styles.spaceName, 
                fontWeight: selectedSpaceId === null ? 700 : 500,
                color: selectedSpaceId === null ? 'var(--text-primary)' : 'var(--text-secondary)'
              }}>
                🌌 Fusionner les Galaxies
              </span>
              <span style={styles.spaceMeta}>Tout le réseau connecté</span>
            </div>
          </button>

          {/* Individual Spaces */}
          {spaces.map((space) => {
            const isActive = selectedSpaceId === space.id;
            return (
              <button
                key={space.id}
                onClick={() => setSelectedSpaceId(space.id)}
                style={{
                  ...styles.spaceItem,
                  ...(isActive ? styles.spaceItemActive : {}),
                }}
              >
                <div style={{
                  ...styles.dot,
                  backgroundColor: space.type === 'personal' ? 'var(--neon-blue)' : 'var(--neon-green)'
                }}></div>
                <div style={styles.spaceDetails}>
                  <span style={{ 
                    ...styles.spaceName,
                    fontWeight: isActive ? 700 : 500,
                    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)'
                  }}>
                    {space.name}
                  </span>
                  <span style={styles.spaceMeta}>
                    {space.type === 'personal' ? 'Espace perso' : 'Espace collaboratif'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Navigation Tabs */}
      <nav style={styles.nav}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionTitle}>Outils & IA</span>
        </div>

        <button
          onClick={() => setActiveTab('dashboard')}
          style={{
            ...styles.navItem,
            ...(activeTab === 'dashboard' ? styles.navItemActive : {}),
          }}
        >
          <LayoutDashboard size={18} />
          <span>Tableau de Bord</span>
        </button>

        <button
          onClick={() => setActiveTab('galaxy')}
          style={{
            ...styles.navItem,
            ...(activeTab === 'galaxy' ? styles.navItemActive : {}),
          }}
        >
          <Orbit size={18} />
          <span>La Galaxie Graphe</span>
        </button>

        <button
          onClick={() => setActiveTab('oracle')}
          style={{
            ...styles.navItem,
            ...(activeTab === 'oracle' ? styles.navItemActive : {}),
          }}
        >
          <Brain size={18} />
          <span>L'Oracle IA (Synergies)</span>
        </button>

        <button
          onClick={() => setActiveTab('ingestion')}
          style={{
            ...styles.navItem,
            ...(activeTab === 'ingestion' ? styles.navItemActive : {}),
          }}
        >
          <PlusCircle size={18} />
          <span>Ingestion Rapide</span>
        </button>

        <div style={{ ...styles.sectionHeader, marginTop: 16 }}>
          <span style={styles.sectionTitle}>Données</span>
        </div>

        <button
          onClick={() => setActiveTab('contacts')}
          style={{
            ...styles.navItem,
            ...(activeTab === 'contacts' ? styles.navItemActive : {}),
          }}
        >
          <Users size={18} />
          <span>Contacts</span>
        </button>

        <button
          onClick={() => setActiveTab('spaces')}
          style={{
            ...styles.navItem,
            ...(activeTab === 'spaces' ? styles.navItemActive : {}),
          }}
        >
          <Layers size={18} />
          <span>Galaxies / Cercles</span>
        </button>

        <button
          onClick={() => setActiveTab('tags')}
          style={{
            ...styles.navItem,
            ...(activeTab === 'tags' ? styles.navItemActive : {}),
          }}
        >
          <Tag size={18} />
          <span>Tags & Catégories</span>
        </button>

        <button
          onClick={() => setActiveTab('notes')}
          style={{
            ...styles.navItem,
            ...(activeTab === 'notes' ? styles.navItemActive : {}),
          }}
        >
          <FileText size={18} />
          <span>Notes d'Échanges</span>
        </button>
      </nav>

      {/* User Session Info Footer */}
      <div style={styles.footer}>
        <div style={styles.userInfo}>
          <div style={styles.avatar}>
            {user?.email?.charAt(0).toUpperCase() || 'U'}
          </div>
          <div style={styles.userDetails}>
            <span style={styles.userName}>
              {user?.user_metadata?.full_name || user?.email?.split('@')[0]}
            </span>
            <span style={styles.userPlan}>Compte Pro Gemini</span>
          </div>
        </div>
        <button onClick={onLogout} style={styles.logoutBtn} title="Se déconnecter">
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  );
};

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: 280,
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    padding: '24px 16px',
    flexShrink: 0,
    zIndex: 10,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 32,
    paddingLeft: 8,
  },
  logoIcon: {
    width: 32,
    height: 32,
    borderRadius: '8px',
    background: 'rgba(159, 97, 232, 0.1)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    border: '1px solid rgba(159, 97, 232, 0.2)',
  },
  logoText: {
    fontSize: '1.25rem',
    fontWeight: 800,
    letterSpacing: '-0.02em',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 8,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: '0.7rem',
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  },
  spaceList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    maxHeight: '220px',
    overflowY: 'auto',
    paddingRight: 4,
  },
  spaceItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 12px',
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid rgba(255, 255, 255, 0.04)',
    borderRadius: '10px',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'var(--transition-smooth)',
  },
  spaceItemActive: {
    background: 'rgba(79, 142, 247, 0.1)',
    borderColor: 'rgba(79, 142, 247, 0.3)',
  },
  spaceItemActiveMerger: {
    background: 'rgba(159, 97, 232, 0.08)',
    border: '1px dashed rgba(236, 111, 139, 0.5)',
    boxShadow: '0 0 15px rgba(236, 111, 139, 0.1)',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  spaceDetails: {
    display: 'flex',
    flexDirection: 'column',
  },
  spaceName: {
    fontSize: '0.85rem',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    maxWidth: '180px',
  },
  spaceMeta: {
    fontSize: '0.7rem',
    color: 'var(--text-muted)',
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    flexGrow: 1,
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 14px',
    background: 'none',
    border: 'none',
    borderRadius: '10px',
    color: 'var(--text-secondary)',
    fontSize: '0.9rem',
    fontWeight: 500,
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'var(--transition-smooth)',
  },
  navItemActive: {
    background: 'rgba(255, 255, 255, 0.06)',
    color: '#fff',
    fontWeight: 600,
    boxShadow: 'inset 0 0 8px rgba(255, 255, 255, 0.03)',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 16,
    borderTop: '1px solid var(--border-glow)',
    marginTop: 'auto',
  },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    maxWidth: '180px',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, var(--neon-purple), var(--neon-blue))',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    color: '#fff',
    fontSize: '0.95rem',
    fontWeight: 700,
    flexShrink: 0,
  },
  userDetails: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  userName: {
    fontSize: '0.85rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    overflow: 'hidden',
  },
  userPlan: {
    fontSize: '0.7rem',
    color: 'var(--neon-purple)',
    fontWeight: 500,
  },
  logoutBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    padding: 8,
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'var(--transition-smooth)',
  },
};
