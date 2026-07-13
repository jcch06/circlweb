import React from 'react';
import { LogOut } from 'lucide-react';

export type TabType = 'dashboard' | 'galaxy' | 'oracle' | 'ingestion' | 'contacts' | 'spaces' | 'tags' | 'notes';

interface SidebarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  spaces: any[];
  selectedSpaceId: string | null;
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
        <h2 style={styles.logoText}>circl</h2>
      </div>

      {/* Space Selector */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionTitle}>Espaces</span>
        </div>
        <div style={styles.spaceList}>
          <button
            onClick={() => setSelectedSpaceId(null)}
            style={{
              ...styles.spaceItem,
              ...(selectedSpaceId === null ? styles.spaceItemActive : {}),
            }}
          >
            <span style={{ 
              ...styles.spaceName, 
              fontWeight: selectedSpaceId === null ? 600 : 400,
              color: selectedSpaceId === null ? '#fff' : '#888'
            }}>
              Tous les contacts
            </span>
          </button>

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
                <span style={{ 
                  ...styles.spaceName,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? '#fff' : '#888'
                }}>
                  {space.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Navigation */}
      <nav style={styles.nav}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionTitle}>Navigation</span>
        </div>

        {([
          { key: 'dashboard', label: 'Tableau de bord' },
          { key: 'galaxy', label: 'Graphe' },
          { key: 'oracle', label: 'Analyse IA' },
          { key: 'ingestion', label: 'Ingestion' },
        ] as { key: TabType; label: string }[]).map(item => (
          <button
            key={item.key}
            onClick={() => setActiveTab(item.key)}
            style={{
              ...styles.navItem,
              ...(activeTab === item.key ? styles.navItemActive : {}),
            }}
          >
            {item.label}
          </button>
        ))}

        <div style={{ ...styles.sectionHeader, marginTop: 16 }}>
          <span style={styles.sectionTitle}>Donnees</span>
        </div>

        {([
          { key: 'contacts', label: 'Contacts' },
          { key: 'spaces', label: 'Espaces' },
          { key: 'tags', label: 'Tags' },
          { key: 'notes', label: 'Notes' },
        ] as { key: TabType; label: string }[]).map(item => (
          <button
            key={item.key}
            onClick={() => setActiveTab(item.key)}
            style={{
              ...styles.navItem,
              ...(activeTab === item.key ? styles.navItemActive : {}),
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div style={styles.footer}>
        <div style={styles.userInfo}>
          <span style={styles.userName}>
            {user?.user_metadata?.full_name || user?.email?.split('@')[0]}
          </span>
        </div>
        <button onClick={onLogout} style={styles.logoutBtn} title="Deconnexion">
          <LogOut size={14} />
        </button>
      </div>
    </aside>
  );
};

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: 220,
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    padding: '20px 12px',
    flexShrink: 0,
    borderRight: '1px solid #2a2a2a',
    background: '#0e0e0e',
  },
  header: {
    marginBottom: 28,
    paddingLeft: 8,
  },
  logoText: {
    fontSize: '1.1rem',
    fontWeight: 700,
    letterSpacing: '0.05em',
    color: '#ffffff',
    textTransform: 'lowercase' as const,
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    paddingLeft: 8,
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: '0.65rem',
    fontWeight: 600,
    color: '#555',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
  },
  spaceList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    maxHeight: '180px',
    overflowY: 'auto',
  },
  spaceItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 10px',
    background: 'transparent',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    textAlign: 'left',
  },
  spaceItemActive: {
    background: 'rgba(255, 255, 255, 0.06)',
  },
  spaceName: {
    fontSize: '0.82rem',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    flexGrow: 1,
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '9px 10px',
    background: 'none',
    border: 'none',
    borderRadius: 4,
    color: '#888',
    fontSize: '0.82rem',
    fontWeight: 400,
    cursor: 'pointer',
    textAlign: 'left',
  },
  navItemActive: {
    background: 'rgba(255, 255, 255, 0.06)',
    color: '#fff',
    fontWeight: 600,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTop: '1px solid #2a2a2a',
    marginTop: 'auto',
  },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    maxWidth: '160px',
    overflow: 'hidden',
  },
  userName: {
    fontSize: '0.78rem',
    fontWeight: 500,
    color: '#888',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    overflow: 'hidden',
  },
  logoutBtn: {
    background: 'none',
    border: 'none',
    color: '#555',
    cursor: 'pointer',
    padding: 6,
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};
