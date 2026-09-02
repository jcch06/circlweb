import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Home, Users, Bell, BookOpen, Lightbulb, Layers,
  Plus, Search, LogOut, ChevronDown, Check, Copy, Share2,
} from 'lucide-react';
import { useData } from './data';
import { CommandPalette } from './ui/CommandPalette';
import { Avatar } from './ui/Bits';
import { circleColor, fullName, lastTouch, relStatus, relativeFR } from './ui/format';
import logo from './assets/logocircl.png';

// Coquille à deux niveaux (langage kit CRM) : rail d'icônes fin + sidebar
// contexte blanche (logo, bonjour, cercle actif, recherche, la boucle du
// matin, santé du réseau). « Capturer » reste l'action mise en avant.

const NAV = [
  { to: '/accueil', label: 'Accueil', icon: Home },
  { to: '/contacts', label: 'Contacts', icon: Users },
  // La page Réseau (graphe des liens réels + « me présenter à… ») était routée
  // sur /reseau mais absente d'ici : inatteignable sans taper l'URL à la main.
  { to: '/reseau', label: 'Réseau', icon: Share2 },
  { to: '/cercles', label: 'Cercles', icon: Layers },
  { to: '/mises-a-jour', label: 'Mises à jour', icon: Bell, badge: 'updates' as const },
  { to: '/opportunites', label: 'Opportunités', icon: Lightbulb },
  { to: '/journal', label: 'Journal', icon: BookOpen },
  { to: '/doublons', label: 'Doublons', icon: Copy },
];

const DAY = 86400000;

export const AppShell: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const data = useData();
  const navigate = useNavigate();
  const [circleOpen, setCircleOpen] = useState(false);
  const [railCircleOpen, setRailCircleOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const circleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setPaletteOpen((o) => !o); }
      const target = e.target as HTMLElement;
      if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !e.metaKey && !e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
        if (!paletteOpen) navigate('/capture');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [paletteOpen, navigate]);

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
  const prenom = userName.split(/[\s@.]+/)[0] || '';
  const pendingCount = data.pendingUpdates.length;

  const inSpace = (c: any) => !data.selectedSpaceId || c.space_id === data.selectedSpaceId;

  /* La boucle du matin : relances échues, puis contacts qui refroidissent. */
  const dueToday = useMemo(() => {
    const fu = data.followUps
      .filter((f) => new Date(f.due_date).getTime() <= Date.now() + DAY)
      .map((f) => ({ c: data.contactById.get(f.contact_id), why: f.label, cold: false }))
      .filter((x) => x.c && inSpace(x.c));
    const seen = new Set(fu.map((x) => x.c.id));
    const dorm = data.contacts
      .filter(inSpace)
      .map((c) => ({ c, touch: lastTouch(c, data.lastNoteByContact.get(c.id)) }))
      .filter((x) => x.touch && (relStatus(x.touch) === 'due' || relStatus(x.touch) === 'dormant'))
      .filter((x) => !seen.has(x.c.id))
      .sort((a, b) => a.touch!.getTime() - b.touch!.getTime())
      .map((x) => ({
        c: x.c,
        why: relStatus(x.touch) === 'dormant' ? `Silence · ${relativeFR(x.touch!.toISOString())}` : 'À relancer',
        cold: relStatus(x.touch) === 'dormant',
      }));
    return [...fu, ...dorm].slice(0, 3);
  }, [data.followUps, data.contacts, data.lastNoteByContact, data.contactById, data.selectedSpaceId]);

  /* Santé du réseau : actifs vs en froid + activité des 8 dernières semaines. */
  const health = useMemo(() => {
    let actifs = 0, froid = 0;
    for (const c of data.contacts.filter(inSpace)) {
      const s = relStatus(lastTouch(c, data.lastNoteByContact.get(c.id)));
      if (s === 'fresh') actifs++;
      else if (s === 'dormant') froid++;
    }
    return { actifs, froid };
  }, [data.contacts, data.lastNoteByContact, data.selectedSpaceId]);

  const spark = useMemo(() => {
    const weeks = 8;
    const now = Date.now();
    const buckets = new Array(weeks).fill(0);
    for (const n of data.notes) {
      const t = new Date(n.created_at).getTime();
      if (Number.isNaN(t)) continue;
      const wk = Math.floor((now - t) / (7 * DAY));
      if (wk >= 0 && wk < weeks) buckets[weeks - 1 - wk]++;
    }
    return buckets;
  }, [data.notes]);

  const sparkPath = useMemo(() => {
    const W = 260, H = 56, max = Math.max(1, ...spark);
    const step = spark.length > 1 ? W / (spark.length - 1) : W;
    const pts = spark.map((v, i) => [i * step, H - (v / max) * (H - 6) - 3]);
    if (pts.length === 0) return { line: '', area: '' };
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const area = `${line} L${W},${H} L0,${H} Z`;
    return { line, area };
  }, [spark]);

  // Liste des cercles, partagée par le sélecteur de la sidebar et celui du
  // rail (repli tactile sous 900px, où la sidebar contexte est masquée).
  const pickCircle = (id: string | null) => { data.setSelectedSpaceId(id); setCircleOpen(false); setRailCircleOpen(false); };
  const circleList = (
    <>
      <button className="nav-item" onClick={() => pickCircle(null)}>
        <span style={{ width: 9, height: 9, borderRadius: 999, background: 'var(--mut)', flex: 'none' }} />
        <span style={{ flex: 1 }}>Tous les cercles</span>
        {data.selectedSpaceId === null && <Check size={14} color="var(--accent)" />}
      </button>
      {data.spaces.map((s) => (
        <button key={s.id} className="nav-item" onClick={() => pickCircle(s.id)}>
          <span style={{ width: 9, height: 9, borderRadius: 999, background: circleColor(s), flex: 'none' }} />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
          {data.selectedSpaceId === s.id && <Check size={14} color="var(--accent)" />}
        </button>
      ))}
    </>
  );

  const circleDropdown = (
    <div ref={circleRef} style={{ position: 'relative', marginBottom: 12 }}>
      <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', gap: 9 }} onClick={() => setCircleOpen((o) => !o)}>
        <span style={{ width: 9, height: 9, borderRadius: 999, flex: 'none', background: activeSpace ? circleColor(activeSpace) : 'var(--mut)' }} />
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activeSpace ? activeSpace.name : 'Tous les cercles'}
        </span>
        <ChevronDown size={14} color="var(--mut)" />
      </button>
      {circleOpen && (
        <div className="popover" style={{ top: 'calc(100% + 6px)', left: 0, right: 0, padding: 6 }}>
          {circleList}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--wash)' }}>
      {/* Rail d'icônes */}
      <nav className="rail">
        <div className="rail-logo"><img src={logo} alt="Circl" /></div>
        {NAV.map(({ to, label, icon: Icon, badge }) => (
          <NavLink key={to} to={to} title={label} className={({ isActive }) => `rail-ico${isActive ? ' active' : ''}`}>
            <Icon size={20} />
            {badge === 'updates' && pendingCount > 0 && <span className="badge" />}
          </NavLink>
        ))}
        <button className="rail-ico" title="Rechercher (⌘K)" onClick={() => setPaletteOpen(true)}>
          <Search size={20} />
        </button>
        <button className="rail-ico" title={activeSpace ? activeSpace.name : 'Tous les cercles'} onClick={() => setRailCircleOpen((o) => !o)}>
          <span style={{ width: 16, height: 16, borderRadius: 999, background: activeSpace ? circleColor(activeSpace) : 'var(--mut)' }} />
        </button>
        <div className="rail-sep" />
        <button className="rail-ico" title="Capturer (C)" style={{ background: 'var(--accent)', color: '#fff' }} onClick={() => navigate('/capture')}>
          <Plus size={20} />
        </button>
        <button className="rail-ico" title="Se déconnecter" onClick={onLogout}>
          <LogOut size={18} />
        </button>
      </nav>

      {/* Sidebar contexte */}
      <aside className="ctx">
        <div className="ctx-logo"><img src={logo} alt="Circl" /></div>
        <div style={{ margin: '14px 0 4px', color: 'var(--mut)', fontSize: 15 }}>Bonjour,</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', marginBottom: 20, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {prenom || 'vous'}
        </div>

        {circleDropdown}

        <button
          className="input"
          style={{ paddingLeft: 32, background: 'var(--wash)', textAlign: 'left', color: 'var(--faint)', position: 'relative', marginBottom: 22, cursor: 'pointer', border: 'none' }}
          onClick={() => setPaletteOpen(true)}
        >
          <Search size={15} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--faint)' }} />
          Rechercher…
          <span className="t-meta" style={{ position: 'absolute', right: 10, top: 9, background: 'var(--card)', borderRadius: 5, padding: '1px 6px', color: 'var(--mut)' }}>⌘K</span>
        </button>

        <div className="t-label" style={{ marginBottom: 12 }}>
          {dueToday.length > 0 ? `Aujourd'hui · ${dueToday.length} relance${dueToday.length > 1 ? 's' : ''}` : "Aujourd'hui"}
        </div>
        {dueToday.length === 0 ? (
          <div className="t-sec" style={{ color: 'var(--mut)' }}>Rien à relancer. Le réseau est à jour.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {dueToday.map(({ c, why, cold }) => (
              <button
                key={c.id}
                onClick={() => navigate(`/contacts/${c.id}`)}
                style={{ display: 'flex', gap: 11, alignItems: 'center', textAlign: 'left', border: '1px solid var(--line)', borderRadius: 'var(--r-el)', padding: '10px 12px', background: 'var(--card)', cursor: 'pointer' }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 999, flex: 'none', background: cold ? 'var(--status-dormant)' : 'var(--status-due)' }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fullName(c)}</span>
                  <span style={{ display: 'block', color: 'var(--mut)', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{why}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Santé du réseau */}
        <div style={{ marginTop: 'auto', paddingTop: 20 }}>
          <div style={{ borderRadius: 'var(--r-el)', background: 'linear-gradient(160deg, #F7F8FE, #FFFFFF)', border: '1px solid var(--line)', padding: 15 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Santé du réseau</div>
            <div style={{ color: 'var(--mut)', fontSize: 12, marginTop: 1 }}>Notes des 8 dernières semaines</div>
            <svg viewBox="0 0 260 56" style={{ width: '100%', height: 52, marginTop: 10 }} preserveAspectRatio="none">
              <defs>
                <linearGradient id="sparkfill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="#5E81F4" stopOpacity="0.22" />
                  <stop offset="1" stopColor="#5E81F4" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={sparkPath.area} fill="url(#sparkfill)" />
              <path d={sparkPath.line} fill="none" stroke="#5E81F4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 12, color: 'var(--mut)' }}>
              <span><b style={{ color: 'var(--status-fresh)' }} className="tnum">{health.actifs}</b> actifs</span>
              <span><b style={{ color: 'var(--status-dormant)' }} className="tnum">{health.froid}</b> en froid</span>
            </div>
          </div>

          <div className="side-foot" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
            <Avatar name={userName} size={32} />
            <span className="t-name" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName}</span>
            <button className="btn btn-quiet" style={{ padding: 6 }} title="Se déconnecter" onClick={onLogout}>
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {railCircleOpen && (
        <>
          <div onClick={() => setRailCircleOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 59 }} />
          <div className="popover" style={{ position: 'fixed', left: 80, bottom: 72, minWidth: 220, padding: 6, zIndex: 60 }}>
            {circleList}
          </div>
        </>
      )}

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
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(245, 245, 250, 0.7)', zIndex: 30 }}>
            <div className="orbit-spinner" />
          </div>
        )}
      </main>
    </div>
  );
};
