import React, { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Home, Users, Bell, BookOpen, Lightbulb, Layers,
  Plus, Search, LogOut, ChevronDown, Check,
} from 'lucide-react';
import { useData } from './data';
import { circleColor } from './ui/format';

// Coquille du redesign (brief 5.1) : sidebar 240 px, six destinations,
// sélecteur de cercle en tête, « + Capturer » comme seule action du chrome.

const NAV = [
  { to: '/accueil', label: 'Accueil', icon: Home },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/mises-a-jour', label: 'Mises à jour', icon: Bell, badge: 'updates' as const },
  { to: '/journal', label: 'Journal', icon: BookOpen },
  { to: '/opportunites', label: 'Opportunités', icon: Lightbulb },
  { to: '/cercles', label: 'Cercles', icon: Layers },
];

export const AppShell: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const data = useData();
  const navigate = useNavigate();
  const [circleOpen, setCircleOpen] = useState(false);
  const [query, setQuery] = useState('');
  const circleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!circleOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (circleRef.current && !circleRef.current.contains(e.target as Node)) setCircleOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [circleOpen]);

  const activeSpace = data.selectedSpaceId ? data.spaceById.get(data.selectedSpaceId) : null;
  const userName = data.user?.user_metadata?.full_name || data.user?.email?.split('@')[0] || '';
  const initialsUser = userName
    .split(/[\s@.]+/).slice(0, 2).map((p: string) => p.charAt(0).toUpperCase()).join('') || 'U';

  const pendingCount = data.pendingUpdates.length;

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    navigate(q ? `/contacts?q=${encodeURIComponent(q)}` : '/contacts');
  };

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--wash)' }}>
      <aside
        style={{
          width: 240, flex: 'none', background: 'var(--card)',
          borderRight: '1px solid var(--line)',
          display: 'flex', flexDirection: 'column', padding: '16px 12px',
        }}
      >
        {/* Logo + Capturer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 4px', marginBottom: 14 }}>
          <span
            style={{
              width: 30, height: 30, borderRadius: 9, background: 'var(--accent)',
              display: 'grid', placeItems: 'center', color: '#fff', flex: 'none',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="4" />
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </span>
          <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', flex: 1 }}>Circl</span>
          <button
            className="btn btn-primary"
            style={{ padding: '6px 10px', fontSize: 12.5 }}
            title="Capturer une note ou un texte (C)"
            onClick={() => navigate('/capture')}
          >
            <Plus size={13} /> Capturer
          </button>
        </div>

        {/* Sélecteur de cercle : fonction structurante, en tête */}
        <div ref={circleRef} style={{ position: 'relative', marginBottom: 10 }}>
          <button
            className="btn btn-ghost"
            style={{ width: '100%', justifyContent: 'flex-start', gap: 9 }}
            onClick={() => setCircleOpen((o) => !o)}
          >
            <span
              style={{
                width: 9, height: 9, borderRadius: 999, flex: 'none',
                background: activeSpace ? circleColor(activeSpace) : 'var(--ink-2)',
              }}
            />
            <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeSpace ? activeSpace.name : 'Tous les cercles'}
            </span>
            <ChevronDown size={14} color="var(--mut)" />
          </button>
          {circleOpen && (
            <div className="popover" style={{ top: 'calc(100% + 6px)', left: 0, right: 0, padding: 6 }}>
              <button
                className="nav-item"
                onClick={() => { data.setSelectedSpaceId(null); setCircleOpen(false); }}
              >
                <span style={{ width: 9, height: 9, borderRadius: 999, background: 'var(--ink-2)', flex: 'none' }} />
                <span style={{ flex: 1 }}>Tous les cercles</span>
                {data.selectedSpaceId === null && <Check size={14} color="var(--accent)" />}
              </button>
              {data.spaces.map((s) => (
                <button
                  key={s.id}
                  className="nav-item"
                  onClick={() => { data.setSelectedSpaceId(s.id); setCircleOpen(false); }}
                >
                  <span style={{ width: 9, height: 9, borderRadius: 999, background: circleColor(s), flex: 'none' }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                  {data.selectedSpaceId === s.id && <Check size={14} color="var(--accent)" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Recherche */}
        <form onSubmit={submitSearch} style={{ position: 'relative', marginBottom: 14 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--faint)' }} />
          <input
            className="input"
            style={{ paddingLeft: 30, fontSize: 13.5, background: 'var(--wash)' }}
            placeholder="Rechercher…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>

        {/* Destinations */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, overflowY: 'auto' }}>
          {NAV.map(({ to, label, icon: Icon, badge }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <Icon size={16} />
              <span style={{ flex: 1 }}>{label}</span>
              {badge === 'updates' && pendingCount > 0 && (
                <span className="badge">{pendingCount}</span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer : profil seulement */}
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 32, height: 32, borderRadius: 999, background: 'var(--accent)',
              display: 'grid', placeItems: 'center', color: '#fff', fontSize: 12, fontWeight: 600, flex: 'none',
            }}
          >
            {initialsUser}
          </span>
          <span className="t-sec" style={{ flex: 1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {userName}
          </span>
          <button className="btn btn-quiet" style={{ padding: 6 }} title="Se déconnecter" onClick={onLogout}>
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0, overflow: 'hidden', position: 'relative' }}>
        {data.errorMsg ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div className="t-block" style={{ marginBottom: 8 }}>Le chargement a échoué</div>
            <p className="t-sec" style={{ color: 'var(--ink-2)', marginBottom: 18 }}>{data.errorMsg}</p>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Relancer la synchronisation
            </button>
          </div>
        ) : (
          <Outlet />
        )}
        {data.loading && (
          <div
            style={{
              position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
              background: 'rgba(245, 247, 246, 0.7)', zIndex: 30,
            }}
          >
            <div className="orbit-spinner" />
          </div>
        )}
      </main>
    </div>
  );
};
