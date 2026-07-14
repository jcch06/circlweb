import React from 'react';
import { LogOut, LayoutDashboard, Network, Sparkles, Upload, Users, Globe2, Tag, StickyNote } from 'lucide-react';

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
            className="nav-item-hover"
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
                className="nav-item-hover"
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
          { key: 'dashboard', label: 'Tableau de bord', Icon: LayoutDashboard },
          { key: 'galaxy', label: 'Graphe', Icon: Network },
          { key: 'oracle', label: 'Analyse IA', Icon: Sparkles },
          { key: 'ingestion', label: 'Ingestion', Icon: Upload },
        ] as { key: TabType; label: string; Icon: typeof LayoutDashboard }[]).map(item => (
          <button
            key={item.key}
            onClick={() => setActiveTab(item.key)}
            className="nav-item-hover"
            style={{
              ...styles.navItem,
              ...(activeTab === item.key ? styles.navItemActive : {}),
            }}
          >
            <item.Icon size={15} />
            {item.label}
          </button>
        ))}

        <div style={{ ...styles.sectionHeader, marginTop: 16 }}>
          <span style={styles.sectionTitle}>Donnees</span>
        </div>

        {([
          { key: 'contacts', label: 'Contacts', Icon: Users },
          { key: 'spaces', label: 'Espaces', Icon: Globe2 },
          { key: 'tags', label: 'Tags', Icon: Tag },
          { key: 'notes', label: 'Notes', Icon: StickyNote },
        ] as { key: TabType; label: string; Icon: typeof LayoutDashboard }[]).map(item => (
          <button
            key={item.key}
            onClick={() => setActiveTab(item.key)}
            className="nav-item-hover"
            style={{
              ...styles.navItem,
              ...(activeTab === item.key ? styles.navItemActive : {}),
            }}
          >
            <item.Icon size={15} />
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
    height: '100%',
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
    borderRadius: 6,
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'background-color 0.15s ease',
  },
  spaceItemActive: {
    background: 'rgba(255, 255, 255, 0.08)',
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
    gap: 10,
    padding: '9px 10px',
    background: 'none',
    border: 'none',
    borderRadius: 6,
    color: '#888',
    fontSize: '0.82rem',
    fontWeight: 400,
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'background-color 0.15s ease, color 0.15s ease',
  },
  navItemActive: {
    background: 'rgba(255, 255, 255, 0.08)',
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
