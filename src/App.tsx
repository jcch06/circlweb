import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { AuthScreen } from './components/AuthScreen';
import { DataProvider } from './data';
import { ToastProvider } from './ui/Toast';
import { AppShell } from './AppShell';
import { ContactsPageV2 } from './pages/ContactsPageV2';
import { UpdatesPage } from './pages/UpdatesPage';
import {
  LegacyHome, LegacyNetwork, LegacyOpportunities,
  LegacyCapture, LegacyJournal, LegacyCircles,
} from './pages/legacy';

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
              <Route path="/accueil" element={<LegacyHome />} />
              <Route path="/contacts" element={<ContactsPageV2 />} />
              <Route path="/contacts/:id" element={<ContactsPageV2 />} />
              <Route path="/reseau" element={<LegacyNetwork />} />
              <Route path="/mises-a-jour" element={<UpdatesPage />} />
              <Route path="/journal" element={<LegacyJournal />} />
              <Route path="/opportunites" element={<LegacyOpportunities />} />
              <Route path="/cercles" element={<LegacyCircles />} />
              <Route path="/capture" element={<LegacyCapture />} />
              <Route path="*" element={<Navigate to="/accueil" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </DataProvider>
  );
}

export default App;
