import { useState, useEffect, useCallback } from 'react';
import { supabase } from './lib/supabase';
import { AuthScreen } from './components/AuthScreen';
import { Sidebar } from './components/Sidebar';
import type { TabType } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { GalaxyVisualizer } from './components/GalaxyVisualizer';
import { OpportunityHub } from './components/OpportunityHub';
import { AIInput } from './components/AIInput';
import { ContactsPage } from './components/ContactsPage';
import { SpacesPage } from './components/SpacesPage';
import { TagsPage } from './components/TagsPage';
import { NotesPage } from './components/NotesPage';


function App() {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [addNonce, setAddNonce] = useState(0);

  // Core Data States
  const [spaces, setSpaces] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [tags, setTags] = useState<any[]>([]);
  const [contactTags, setContactTags] = useState<any[]>([]);

  // Monitor auth state changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch all user network data
  const fetchNetworkData = useCallback(async () => {
    if (!session?.user) return;
    setDataLoading(true);
    setErrorMsg(null);

    const timeout = setTimeout(() => {
      setDataLoading(false);
      setErrorMsg("Le chargement a expiré (Timeout). Il y a peut-être un problème avec Supabase.");
    }, 15000);

    // Supabase plafonne chaque requête à 1000 lignes : on pagine systématiquement.
    // Lecture via les vues masquées (contacts_visible…) : un contact verrouillé
    // n'expose que prénom/nom, ses notes et tags ne sortent pas.
    // Voir supabase/migrations/20260716100000_add_contact_privacy_controls.sql.
    const fetchAll = async (table: string, orderBy: string, ascending = true) => {
      const PAGE = 1000;
      const rows: any[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .order(orderBy, { ascending })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < PAGE) break;
      }
      return rows;
    };

    try {
      const spacesData = await fetchAll('spaces', 'name');
      setSpaces(spacesData);

      if (spacesData.length > 0) {
        const [contactsData, notesData, tagsData, contactTagsData] = await Promise.all([
          fetchAll('contacts_visible', 'first_name'),
          fetchAll('notes_visible', 'created_at', false),
          fetchAll('tags', 'name'),
          fetchAll('contact_tags_visible', 'contact_id'),
        ]);
        setContacts(contactsData);
        setNotes(notesData);
        setTags(tagsData);
        setContactTags(contactTagsData);
      }
    } catch (err: any) {
      console.error('Erreur lors du chargement des données réseau:', err);
      setErrorMsg('Erreur réseau: ' + (err.message || 'Impossible de joindre Supabase'));
    } finally {
      clearTimeout(timeout);
      setDataLoading(false);
    }
  }, [session]);

  // Fetch data on session change
  useEffect(() => {
    if (session) {
      fetchNetworkData();
    }
  }, [session, fetchNetworkData]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setSpaces([]);
    setContacts([]);
    setNotes([]);
    setTags([]);
    setContactTags([]);
    setSelectedSpaceId(null);
    setActiveTab('dashboard');
  };

  if (authLoading) {
    return (
      <div style={styles.loadingScreen}>
        <div className="bg-grid"></div>
        <div className="bg-stars"></div>
        <div className="orbit-spinner"></div>
        <span style={{ marginTop: 16, color: 'var(--text-secondary)' }}>Synchronisation cosmique...</span>
      </div>
    );
  }

  if (!session) {
    return <AuthScreen onAuthSuccess={() => fetchNetworkData()} />;
  }

  return (
    <div style={styles.appContainer}>
      {/* Main Layout wrapper */}
      <div style={styles.layout}>
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          spaces={spaces}
          selectedSpaceId={selectedSpaceId}
          setSelectedSpaceId={setSelectedSpaceId}
          user={session.user}
          onLogout={handleLogout}
          onSearch={setSearchQuery}
        />

        <main style={styles.mainContent}>
          {dataLoading ? (
            <div style={{ ...styles.loadingScreen, position: 'absolute', inset: 0, zIndex: 5 }}>
              <div className="orbit-spinner"></div>
              <span style={{ marginTop: 16, color: 'var(--text-secondary)' }}>Chargement de vos galaxies...</span>
            </div>
          ) : errorMsg ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--red)' }}>
              <h3>⚠️ Oups, une erreur cosmique...</h3>
              <p>{errorMsg}</p>
              <button onClick={() => window.location.reload()} className="btn-teal" style={{ marginTop: 20 }}>
                Relancer la synchronisation
              </button>
            </div>
          ) : null}

          {activeTab === 'dashboard' && (
            <Dashboard
              contacts={contacts}
              spaces={spaces}
              notes={notes}
              tags={tags}
              selectedSpaceId={selectedSpaceId}
              user={session.user}
              onRefreshData={fetchNetworkData}
              setActiveTab={setActiveTab}
              setSelectedSpaceId={setSelectedSpaceId}
              onNewContact={() => { setActiveTab('contacts'); setAddNonce((n) => n + 1); }}
            />
          )}

          {activeTab === 'galaxy' && (
            <GalaxyVisualizer
              contacts={contacts}
              spaces={spaces}
              notes={notes}
              tags={tags}
              contactTags={contactTags}
              selectedSpaceId={selectedSpaceId}
              user={session.user}
              onRefreshData={fetchNetworkData}
            />
          )}

          {activeTab === 'oracle' && (
            <OpportunityHub
              contacts={selectedSpaceId ? contacts.filter(c => c.space_id === selectedSpaceId) : contacts}
              notes={notes}
              tags={tags}
              spaces={spaces}
              selectedSpaceId={selectedSpaceId}
              user={session.user}
            />
          )}

          {activeTab === 'ingestion' && (
            <AIInput
              contacts={contacts}
              onRefreshData={fetchNetworkData}
              user={session.user}
              selectedSpaceId={selectedSpaceId}
              spaces={spaces}
            />
          )}

          {activeTab === 'contacts' && (
            <ContactsPage
              contacts={contacts}
              spaces={spaces}
              notes={notes}
              tags={tags}
              contactTags={contactTags}
              user={session.user}
              selectedSpaceId={selectedSpaceId}
              onRefreshData={fetchNetworkData}
              initialSearch={searchQuery}
              addNonce={addNonce}
            />
          )}

          {activeTab === 'spaces' && (
            <SpacesPage
              spaces={spaces}
              user={session.user}
              onRefreshData={fetchNetworkData}
            />
          )}

          {activeTab === 'tags' && (
            <TagsPage
              tags={tags}
              spaces={spaces}
              user={session.user}
              onRefreshData={fetchNetworkData}
            />
          )}

          {activeTab === 'notes' && (
            <NotesPage
              notes={notes}
              contacts={contacts}
              user={session.user}
              onRefreshData={fetchNetworkData}
            />
          )}
        </main>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  loadingScreen: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100vw',
    height: '100vh',
    position: 'relative',
    backgroundColor: 'var(--bg-deep)',
  },
  appContainer: {
    width: '100vw',
    height: '100vh',
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: 'var(--bg-deep)',
  },
  layout: {
    display: 'flex',
    width: '100%',
    height: '100%',
  },
  mainContent: {
    flexGrow: 1,
    height: '100%',
    overflow: 'hidden',
    position: 'relative',
  },
};

export default App;
