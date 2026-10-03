import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  Home, Users, Bell, BookOpen, Lightbulb, Layers, Share2, Columns3, Sparkles,
  Plus, Search, LogOut, ChevronsUpDown, Check, Copy, Sun, Moon, Menu, Mail, CreditCard,
} from 'lucide-react';
import { useData } from './data';
import { supabase } from './lib/supabase';
import { CommandPalette } from './ui/CommandPalette';
import { GoogleConnect } from './ui/GoogleConnect';
import { circleColor } from './ui/format';
import { cn } from './lib/utils';
import { toggleTheme, isDark } from './lib/theme';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import logo from './assets/logocircl.png';

// Structure produit validée : le contact est l'atome ; Pipelines (prospection)
// et Demander (IA sur le réseau) sont des surfaces de premier rang.
const NAV_GROUPS: { label?: string; items: { to: string; label: string; icon: any; badge?: 'updates' }[] }[] = [
  { items: [
    { to: '/accueil', label: 'Accueil', icon: Home },
    { to: '/demander', label: 'Demander', icon: Sparkles },
  ] },
  { label: 'Réseau', items: [
    { to: '/contacts', label: 'Contacts', icon: Users },
    { to: '/pipelines', label: 'Pipelines', icon: Columns3 },
    { to: '/reseau', label: 'Réseau', icon: Share2 },
  ] },
  { label: 'Intelligence', items: [
    { to: '/mises-a-jour', label: 'Mises à jour', icon: Bell, badge: 'updates' },
    { to: '/opportunites', label: 'Opportunités', icon: Lightbulb },
  ] },
  { label: 'Équipe', items: [
    { to: '/cercles', label: 'Cercles', icon: Layers },
    { to: '/journal', label: 'Journal', icon: BookOpen },
  ] },
];

const TITLES: Record<string, string> = {
  '/accueil': 'Accueil', '/demander': 'Demander', '/contacts': 'Contacts', '/pipelines': 'Pipelines',
  '/reseau': 'Réseau', '/cercles': 'Cercles', '/mises-a-jour': 'Mises à jour', '/opportunites': 'Opportunités',
  '/journal': 'Journal', '/doublons': 'Doublons', '/capture': 'Capturer', '/abonnement': 'Abonnement',
};

export const AppShell: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const data = useData();
  const navigate = useNavigate();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [dark, setDark] = useState(isDark());
  // Sous md, la barre latérale devient un panneau ouvert par le bouton menu.
  const [navOpen, setNavOpen] = useState(false);
  // Sous md, le panneau fermé est hors écran : on le rend inerte (clavier, lecteurs d'écran).
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const on = () => setIsMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => setNavOpen(false), [location.pathname]);
  // Retour de Stripe (achat de crédits) ou de Google (connexion Gmail et Agenda).
  const [googleOpen, setGoogleOpen] = useState(false);
  const [creditsNotice, setCreditsNotice] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('credits'), g = params.get('google');
    if (!q && !g) return;
    const GOOGLE: Record<string, string> = {
      ok: 'Google est connecté. Circl rattache vos échanges à vos contacts.',
      refuse: 'Connexion Google annulée.', expire: 'La connexion Google a expiré. Recommencez.',
      non_configure: "La connexion Google n'est pas encore activée.", erreur: 'La connexion Google a échoué. Réessayez.',
    };
    window.history.replaceState(null, '', window.location.pathname);
    if (g === 'finish') {
      // Retour de Google : la session connectée finalise (le code n'est valable qu'une fois).
      setCreditsNotice('Connexion de Google en cours…');
      supabase.functions.invoke('google-oauth', { body: { action: 'finish', code: params.get('code'), state: params.get('state') } })
        .then(async (res: any) => {
          if (res.error) {
            let msg = GOOGLE.erreur;
            try { const b = await res.error.context?.json?.(); if (b?.error) msg = b.error; } catch { /* corps illisible */ }
            setCreditsNotice(msg); return;
          }
          setCreditsNotice(GOOGLE.ok); setGoogleOpen(true);
          await supabase.functions.invoke('google-sync', { body: {} }); await data.refresh(['contacts']);
        });
      return;
    }
    if (q === 'ok') {
      // Le retour de Stripe ne prouve pas la livraison : on attend que le webhook crédite le solde.
      setCreditsNotice('Paiement en cours de validation…');
      (async () => {
        const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
        for (let i = 0; i < 10; i++) {
          const { count } = await supabase.from('credit_ledger').select('id', { count: 'exact', head: true }).gt('delta', 0).like('reason', 'achat_%').gte('created_at', since);
          if ((count ?? 0) > 0) { setCreditsNotice('Crédits ajoutés à votre solde.'); window.setTimeout(() => setCreditsNotice(null), 6000); return; }
          await new Promise((r) => setTimeout(r, 3000));
        }
        setCreditsNotice('Paiement reçu. Les crédits apparaîtront dans quelques minutes.');
      })();
      return;
    }
    setCreditsNotice(g ? (GOOGLE[g] ?? GOOGLE.erreur) : 'Paiement annulé. Aucun montant n’a été débité.');
    const t = window.setTimeout(() => setCreditsNotice(null), 6000);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setPaletteOpen((o) => !o); }
      const t = e.target as HTMLElement;
      if (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA' && !e.metaKey && !e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
        if (!paletteOpen) navigate('/capture');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [paletteOpen, navigate]);

  const activeSpace = data.selectedSpaceId ? data.spaceById.get(data.selectedSpaceId) : null;
  const userName = data.user?.user_metadata?.full_name || data.user?.email?.split('@')[0] || '';
  const initials = userName.split(/[\s@.]+/).slice(0, 2).map((p: string) => p.charAt(0).toUpperCase()).join('') || 'U';
  const pendingCount = data.pendingUpdates.length;
  const title = Object.entries(TITLES).find(([p]) => location.pathname.startsWith(p))?.[1] ?? 'Circl';

  return (
    <div className="flex h-screen overflow-hidden text-foreground">
      {/* Sidebar — modèle CRM Atlas, 192px, blanche, nav en sections */}
      {navOpen && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setNavOpen(false)} />}
      <aside inert={!navOpen && isMobile ? true : undefined}
        className={cn('fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col overflow-y-auto border-r transition-transform md:static md:w-48 md:translate-x-0',
          navOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full')}
        style={{ background: 'hsl(var(--sidebar-background))', borderColor: 'hsl(var(--sidebar-border))' }}>
        <div className="flex items-center gap-2 px-3.5 pb-2 pt-3.5">
          <img src={logo} alt="Circl" className="size-[22px] rounded-md" />
          <span className="text-[15px] font-semibold tracking-tight">Circl</span>
        </div>

        <div className="flex flex-col gap-1 px-2 pb-1">
          <button onClick={() => navigate('/capture')}
            className="flex items-center gap-2 rounded-md bg-primary px-2.5 py-1.5 text-[12px] font-medium text-primary-foreground hover:opacity-90">
            <Plus size={13} /> Capturer
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[11.5px] text-muted-foreground hover:bg-accent hover:text-accent-foreground">
                <span className="size-2 shrink-0 rounded-full" style={{ background: activeSpace ? circleColor(activeSpace) : 'hsl(var(--muted-foreground))' }} />
                <span className="flex-1 truncate text-left">{activeSpace ? activeSpace.name : 'Tous les cercles'}</span>
                <ChevronsUpDown size={12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuItem onClick={() => data.setSelectedSpaceId(null)}>
                <span className="size-2 rounded-full bg-muted-foreground" /><span className="flex-1">Tous les cercles</span>
                {data.selectedSpaceId === null && <Check size={13} />}
              </DropdownMenuItem>
              {data.spaces.map((s) => (
                <DropdownMenuItem key={s.id} onClick={() => data.setSelectedSpaceId(s.id)}>
                  <span className="size-2 rounded-full" style={{ background: circleColor(s) }} /><span className="flex-1 truncate">{s.name}</span>
                  {data.selectedSpaceId === s.id && <Check size={13} />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[11.5px] text-muted-foreground hover:bg-accent hover:text-accent-foreground">
            <Search size={13} /> <span className="flex-1 text-left">Rechercher</span>
            <kbd className="mono rounded border px-1 text-[9px]">⌘K</kbd>
          </button>
        </div>

        <nav className="flex flex-1 flex-col px-2 py-1">
          {NAV_GROUPS.map((group, gi) => (
            <div key={gi}>
              {group.label && (
                <div className="mono px-2.5 pb-[3px] pt-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{group.label}</div>
              )}
              {group.items.map(({ to, label, icon: Icon, badge }) => (
                <NavLink key={to} to={to} title={label}
                  className={({ isActive }) => cn(
                    'flex items-center gap-2 rounded-md px-2.5 py-[5px] text-[11.5px] transition-colors',
                    isActive ? 'bg-accent font-medium text-primary dark:bg-card-hover' : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
                  )}>
                  <Icon size={13} className="shrink-0" />
                  <span className="flex-1">{label}</span>
                  {badge === 'updates' && pendingCount > 0 && (
                    <span className="mono rounded bg-primary px-1 text-[9px] font-semibold text-primary-foreground">{pendingCount}</span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Bas : thème + profil */}
        <div className="border-t p-2" style={{ borderColor: 'hsl(var(--sidebar-border))' }}>
          <button onClick={() => setDark(toggleTheme())}
            className="mb-1 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-accent hover:text-accent-foreground">
            {dark ? <Sun size={13} /> : <Moon size={13} />} {dark ? 'Mode clair' : 'Mode sombre'}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-accent">
                <Avatar className="size-7">
                  <AvatarImage src={data.user?.user_metadata?.avatar_url} />
                  <AvatarFallback className="bg-primary text-[10px] font-medium text-primary-foreground">{initials}</AvatarFallback>
                </Avatar>
                <span className="flex-1 truncate text-[12px] font-medium">{userName}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-48">
              <DropdownMenuItem onClick={() => navigate('/abonnement')}><CreditCard size={13} /> Abonnement et factures</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setGoogleOpen(true)}><Mail size={13} /> Gmail et Agenda</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/doublons')}><Copy size={13} /> Doublons</DropdownMenuItem>
              <DropdownMenuItem onClick={onLogout}><LogOut size={13} /> Se déconnecter</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      {googleOpen && <GoogleConnect onClose={() => setGoogleOpen(false)} onSynced={() => data.refresh(['contacts'])} />}

      {/* Zone principale : TopBar + contenu */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-3 md:px-5">
          <button onClick={() => setNavOpen(true)} aria-label="Ouvrir la navigation"
            className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted md:hidden"><Menu size={16} /></button>
          <h1 className="text-sm font-medium tracking-tight">{title}</h1>
          {creditsNotice && <span role="status" className="ml-auto text-xs text-muted-foreground">{creditsNotice}</span>}
        </header>
        <div className="relative min-h-0 flex-1 overflow-hidden page-enter">
          {data.errorMsg ? (
            <div className="grid h-full place-items-center p-10 text-center">
              <div>
                <div className="text-base font-medium">Le chargement a échoué</div>
                <p className="mt-1 text-sm text-muted-foreground">{data.errorMsg}</p>
                <button className="mt-4 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground" onClick={() => window.location.reload()}>Relancer la synchronisation</button>
              </div>
            </div>
          ) : (
            <Outlet />
          )}
          {data.loading && (
            <div className="absolute inset-0 z-30 grid place-items-center bg-background/70">
              <div className="size-8 animate-spin rounded-full border-2 border-border border-t-foreground" />
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
