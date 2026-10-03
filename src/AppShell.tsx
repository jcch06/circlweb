import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Home, Users, Bell, BookOpen, Lightbulb, Layers, Share2,
  Plus, Search, LogOut, ChevronsUpDown, Check, Copy, Sun, Moon,
} from 'lucide-react';
import { useData } from './data';
import { CommandPalette } from './ui/CommandPalette';
import { circleColor } from './ui/format';
import { cn } from './lib/utils';
import { toggleTheme, isDark } from './lib/theme';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import logo from './assets/logocircl.png';

const NAV = [
  { to: '/accueil', label: 'Accueil', icon: Home },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/reseau', label: 'Réseau', icon: Share2 },
  { to: '/cercles', label: 'Cercles', icon: Layers },
  { to: '/mises-a-jour', label: 'Mises à jour', icon: Bell, badge: 'updates' as const },
  { to: '/opportunites', label: 'Opportunités', icon: Lightbulb },
  { to: '/journal', label: 'Journal', icon: BookOpen },
  { to: '/doublons', label: 'Doublons', icon: Copy },
];

export const AppShell: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const data = useData();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [dark, setDark] = useState(isDark());

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

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card max-md:w-[68px]">
        {/* Marque + thème */}
        <div className="flex items-center gap-2.5 px-4 py-4">
          <img src={logo} alt="Circl" className="size-8 rounded-lg" />
          <span className="flex-1 text-[17px] font-semibold tracking-tight max-md:hidden">Circl</span>
          <Button variant="ghost" size="icon" className="size-8 max-md:hidden" title="Thème"
            onClick={() => setDark(toggleTheme())}>
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        </div>

        <div className="flex flex-col gap-1 px-3">
          {/* Sélecteur de cercle */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full justify-start gap-2 bg-background font-normal max-md:px-0 max-md:justify-center">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: activeSpace ? circleColor(activeSpace) : 'hsl(var(--muted-foreground))' }} />
                <span className="flex-1 truncate text-left max-md:hidden">{activeSpace ? activeSpace.name : 'Tous les cercles'}</span>
                <ChevronsUpDown className="size-3.5 text-muted-foreground max-md:hidden" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onClick={() => data.setSelectedSpaceId(null)}>
                <span className="size-2.5 rounded-full bg-muted-foreground" />
                <span className="flex-1">Tous les cercles</span>
                {data.selectedSpaceId === null && <Check className="size-4" />}
              </DropdownMenuItem>
              {data.spaces.map((s) => (
                <DropdownMenuItem key={s.id} onClick={() => data.setSelectedSpaceId(s.id)}>
                  <span className="size-2.5 rounded-full" style={{ background: circleColor(s) }} />
                  <span className="flex-1 truncate">{s.name}</span>
                  {data.selectedSpaceId === s.id && <Check className="size-4" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Recherche */}
          <Button variant="ghost" className="w-full justify-start gap-2 px-3 text-muted-foreground font-normal max-md:justify-center max-md:px-0"
            onClick={() => setPaletteOpen(true)}>
            <Search className="size-4" />
            <span className="flex-1 text-left max-md:hidden">Rechercher</span>
            <kbd className="rounded border border-border bg-muted px-1.5 text-[10px] text-muted-foreground max-md:hidden">⌘K</kbd>
          </Button>
        </div>

        {/* Navigation */}
        <nav className="mt-2 flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
          {NAV.map(({ to, label, icon: Icon, badge }) => (
            <NavLink key={to} to={to} title={label}
              className={({ isActive }) => cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors max-md:justify-center max-md:px-0',
                isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}>
              <Icon className="size-[18px] shrink-0" />
              <span className="flex-1 max-md:hidden">{label}</span>
              {badge === 'updates' && pendingCount > 0 && (
                <span className="rounded-md bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-foreground max-md:hidden">{pendingCount}</span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Capturer */}
        <div className="px-3 pb-2">
          <Button className="w-full gap-2 max-md:px-0" onClick={() => navigate('/capture')} title="Capturer (C)">
            <Plus className="size-4" />
            <span className="max-md:hidden">Capturer</span>
          </Button>
        </div>

        {/* Profil */}
        <div className="border-t border-border p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-accent/60 max-md:justify-center">
                <Avatar className="size-8">
                  <AvatarImage src={data.user?.user_metadata?.avatar_url} />
                  <AvatarFallback className="bg-secondary text-xs font-semibold">{initials}</AvatarFallback>
                </Avatar>
                <span className="flex-1 truncate text-sm font-medium max-md:hidden">{userName}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-56">
              <DropdownMenuItem onClick={() => setDark(toggleTheme())} className="md:hidden">
                {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
                {dark ? 'Thème clair' : 'Thème sombre'}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="md:hidden" />
              <DropdownMenuItem onClick={onLogout}>
                <LogOut className="size-4" /> Se déconnecter
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      <main className="relative min-w-0 flex-1 overflow-hidden">
        {data.errorMsg ? (
          <div className="grid h-full place-items-center p-10 text-center">
            <div>
              <div className="text-lg font-semibold">Le chargement a échoué</div>
              <p className="mt-1 text-sm text-muted-foreground">{data.errorMsg}</p>
              <Button className="mt-4" onClick={() => window.location.reload()}>Relancer la synchronisation</Button>
            </div>
          </div>
        ) : (
          <Outlet />
        )}
        {data.loading && (
          <div className="absolute inset-0 z-30 grid place-items-center bg-background/70">
            <div className="size-9 animate-spin rounded-full border-2 border-border border-t-foreground" />
          </div>
        )}
      </main>
    </div>
  );
};
