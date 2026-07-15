import React, { useState, useRef, useEffect } from 'react';
import { LogOut } from 'lucide-react';

export type TabType = 'dashboard' | 'galaxy' | 'oracle' | 'ingestion' | 'contacts' | 'spaces' | 'tags' | 'notes';

interface SidebarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  spaces: any[];
  selectedSpaceId: string | null; // null = galaxies fusionnées
  setSelectedSpaceId: (id: string | null) => void;
  user: any;
  onLogout: () => void;
  onSearch: (query: string) => void;
}

/* Icônes reprises telles quelles de la maquette (circl-app.html) */
const IconDashboard = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <rect x="3" y="3" width="7" height="7" rx="1.6" /><rect x="14" y="3" width="7" height="7" rx="1.6" />
    <rect x="3" y="14" width="7" height="7" rx="1.6" /><rect x="14" y="14" width="7" height="7" rx="1.6" />
  </svg>
);
const IconContacts = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <circle cx="12" cy="8" r="3.2" /><path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
  </svg>
);
const IconGalaxy = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <circle cx="12" cy="12" r="3" /><circle cx="5" cy="6" r="1.6" /><circle cx="19" cy="7" r="1.6" />
    <circle cx="18" cy="18" r="1.6" /><path d="M12 12 5 6M12 12l7-5M12 12l6 6" />
  </svg>
);
const IconOracle = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <circle cx="12" cy="12" r="5" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);
const IconIngestion = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <path d="M12 5v10M8 11l4 4 4-4" /><path d="M5 19h14" />
  </svg>
);
const IconTags = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <path d="M4 7h16M4 12h16M4 17h10" />
  </svg>
);
const IconNotes = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <path d="M6 3h9l4 4v14H6z" /><path d="M9 12h7M9 16h5" />
  </svg>
);
const IconSpaces = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" />
  </svg>
);

const NAV: { tab: TabType; label: string; icon: () => React.JSX.Element }[] = [
  { tab: 'contacts', label: 'Contacts', icon: IconContacts },
  { tab: 'galaxy', label: 'Galaxie', icon: IconGalaxy },
  { tab: 'oracle', label: 'Oracle', icon: IconOracle },
  { tab: 'ingestion', label: 'Ingestion', icon: IconIngestion },
  { tab: 'tags', label: 'Tags', icon: IconTags },
  { tab: 'notes', label: 'Notes', icon: IconNotes },
  { tab: 'spaces', label: 'Espaces', icon: IconSpaces },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  spaces,
  selectedSpaceId,
  setSelectedSpaceId,
  user,
  onLogout,
  onSearch,
}) => {
  const [query, setQuery] = useState('');
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const footRef = useRef<HTMLDivElement>(null);

  // Ferme le sélecteur d'espace au clic extérieur
  useEffect(() => {
    if (!switcherOpen) return;
    const onClick = (e: MouseEvent) => {
      if (footRef.current && !footRef.current.contains(e.target as Node)) setSwitcherOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [switcherOpen]);

  const activeSpace = spaces.find((s) => s.id === selectedSpaceId);
  const spaceLabel = activeSpace ? activeSpace.name : 'Toutes les galaxies';
  const initials = (user?.user_metadata?.full_name || user?.email || 'U')
    .split(/[\s@.]+/)
    .slice(0, 2)
    .map((p: string) => p.charAt(0).toUpperCase())
    .join('');

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    onSearch(query.trim());
    setActiveTab('contacts');
  };

  return (
    <aside className="side">
      <div className="brandrow">
        <div className="brand">
          <span className="mk">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2l2.2 5.8L20 9l-5 3.7L16.5 19 12 15.6 7.5 19 9 12.7 4 9l5.8-1.2z" />
            </svg>
          </span>
          <span className="nm">Circl</span>
        </div>
      </div>

      <form className="search" onSubmit={submitSearch}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" />
        </svg>
        <input
          placeholder="Rechercher un contact..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query ? (
          <span className="kbd" style={{ cursor: 'pointer' }} onClick={() => { setQuery(''); onSearch(''); }}>
            ✕
          </span>
        ) : (
          <span className="kbd">⏎</span>
        )}
      </form>

      <nav className="nav">
        <button
          className={`nav-i${activeTab === 'dashboard' ? ' on' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          <IconDashboard />
          <span className="t">Tableau de bord</span>
        </button>

        <div className="sec">Mon réseau</div>

        {NAV.map(({ tab, label, icon: Icon }) => (
          <button
            key={tab}
            className={`nav-i${activeTab === tab ? ' on' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            <Icon />
            <span className="t">{label}</span>
          </button>
        ))}
      </nav>

      <div className="foot" ref={footRef} style={{ position: 'relative' }}>
        {switcherOpen && (
          <div
            style={{
              position: 'absolute',
              bottom: 'calc(100% + 10px)',
              left: 0,
              right: 0,
              background: '#fff',
              border: '1px solid var(--line)',
              borderRadius: 12,
              padding: 6,
              boxShadow: '0 12px 30px -14px rgba(20,30,30,.3)',
              zIndex: 20,
              maxHeight: 280,
              overflowY: 'auto',
            }}
          >
            <div className="sec" style={{ padding: '8px 10px 6px' }}>Galaxie active</div>
            <button
              className={`nav-i${selectedSpaceId === null ? ' on' : ''}`}
              onClick={() => { setSelectedSpaceId(null); setSwitcherOpen(false); }}
            >
              <IconGalaxy />
              <span className="t">Toutes les galaxies</span>
            </button>
            {spaces.map((space) => (
              <button
                key={space.id}
                className={`nav-i${selectedSpaceId === space.id ? ' on' : ''}`}
                onClick={() => { setSelectedSpaceId(space.id); setSwitcherOpen(false); }}
              >
                <span
                  style={{
                    width: 8, height: 8, borderRadius: 9999, flex: 'none',
                    background: space.type === 'personal' ? 'var(--teal)' : 'var(--blue)',
                  }}
                />
                <span className="t">{space.name}</span>
              </button>
            ))}
          </div>
        )}

        <button
          onClick={() => setSwitcherOpen((o) => !o)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0,
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
          }}
          title="Changer de galaxie"
        >
          <span className="av">{initials}</span>
          <span style={{ minWidth: 0 }}>
            <span className="nm" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.user_metadata?.full_name || user?.email?.split('@')[0]}
            </span>
            <span className="pl" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {spaceLabel}
            </span>
          </span>
        </button>

        <button
          onClick={onLogout}
          title="Se déconnecter"
          style={{
            background: 'none', border: 'none', color: 'var(--mut)', cursor: 'pointer',
            padding: 8, borderRadius: 8, display: 'grid', placeItems: 'center', flex: 'none',
          }}
        >
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  );
};
