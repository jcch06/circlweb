import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { AuthScreen } from './components/AuthScreen';
import { DataProvider } from './data';
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

function App() {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  if (authLoading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', background: 'var(--wash)' }}>
        <div className="orbit-spinner" />
      </div>
    );
  }

  if (!session) {
    return <AuthScreen onAuthSuccess={() => {}} />;
  }

  return (
    <DataProvider session={session}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell onLogout={handleLogout} />}>
              <Route index element={<Navigate to="/accueil" replace />} />
              <Route path="/accueil" element={<HomePage />} />
              <Route path="/contacts" element={<ContactsPageV2 />} />
              <Route path="/contacts/:id" element={<ContactsPageV2 />} />
              <Route path="/reseau" element={<NetworkPage />} />
              <Route path="/reseau/:id" element={<NetworkPage />} />
              <Route path="/mises-a-jour" element={<UpdatesPage />} />
              <Route path="/journal" element={<JournalPage />} />
              <Route path="/opportunites" element={<OpportunitiesPage />} />
              <Route path="/cercles" element={<CirclesPage />} />
              <Route path="/capture" element={<CapturePage />} />
              <Route path="*" element={<Navigate to="/accueil" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </DataProvider>
  );
}

export default App;
