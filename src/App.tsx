import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { AuthScreen } from './components/AuthScreen';
import { DataProvider, MockDataProvider } from './data';
import { ToastProvider } from './ui/Toast';
import { AppShell } from './AppShell';
import { ContactsPageV2 } from './pages/ContactsPageV2';
import { UpdatesPage } from './pages/UpdatesPage';
import { HomePage } from './pages/HomePage';
import { JournalPage } from './pages/JournalPage';
import { CirclesPage } from './pages/CirclesPage';
import { NetworkPage } from './pages/NetworkPage';
import { CapturePage } from './pages/CapturePage';
import { OpportunitiesPage } from './pages/OpportunitiesPage';
import { DuplicatesRoute } from './pages/DuplicatesRoute';
import { PipelinesPage } from './pages/PipelinesPage';
import { DemanderPage } from './pages/DemanderPage';

function AppRoutes({ onLogout }: { onLogout: () => void }) {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell onLogout={onLogout} />}>
          <Route index element={<Navigate to="/accueil" replace />} />
          <Route path="/accueil" element={<HomePage />} />
          <Route path="/demander" element={<DemanderPage />} />
          <Route path="/pipelines" element={<PipelinesPage />} />
          <Route path="/contacts" element={<ContactsPageV2 />} />
          <Route path="/contacts/:id" element={<ContactsPageV2 />} />
          <Route path="/reseau" element={<NetworkPage />} />
          <Route path="/reseau/:id" element={<NetworkPage />} />
          <Route path="/mises-a-jour" element={<UpdatesPage />} />
          <Route path="/journal" element={<JournalPage />} />
          <Route path="/opportunites" element={<OpportunitiesPage />} />
          <Route path="/cercles" element={<CirclesPage />} />
          <Route path="/capture" element={<CapturePage />} />
          <Route path="/doublons" element={<DuplicatesRoute />} />
          <Route path="*" element={<Navigate to="/accueil" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

function App() {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Mode design local : ?mock (dev only) affiche l'app avec des données
  // mockées, sans session. À retirer une fois le design validé et branché.
  const mock = import.meta.env.DEV && new URLSearchParams(window.location.search).has('mock');

  useEffect(() => {
    if (mock) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, [mock]);

  if (mock) {
    return (
      <MockDataProvider>
        <ToastProvider>
          <AppRoutes onLogout={() => {}} />
        </ToastProvider>
      </MockDataProvider>
    );
  }

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  if (authLoading) {
    return (
      <div className="grid h-screen place-items-center bg-background">
        <div className="size-9 animate-spin rounded-full border-2 border-border border-t-foreground" />
      </div>
    );
  }

  if (!session) return <AuthScreen onAuthSuccess={() => {}} />;

  return (
    <DataProvider session={session}>
      <ToastProvider>
        <AppRoutes onLogout={handleLogout} />
      </ToastProvider>
    </DataProvider>
  );
}

export default App;
