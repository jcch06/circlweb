import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../data';
import { Dashboard } from '../components/Dashboard';
import { GalaxyVisualizer } from '../components/GalaxyVisualizer';
import { OpportunityHub } from '../components/OpportunityHub';
import { AIInput } from '../components/AIInput';
import { NotesPage } from '../components/NotesPage';
import { SpacesPage } from '../components/SpacesPage';

// Adaptateurs des écrans pas encore refondus (lots 2 à 5).
// Ils traduisent l'ancien contrat setActiveTab vers les routes,
// et disparaissent au fil des lots.

const routeForTab: Record<string, string> = {
  dashboard: '/accueil',
  contacts: '/contacts',
  galaxy: '/reseau',
  oracle: '/opportunites',
  ingestion: '/capture',
  tags: '/contacts',
  notes: '/journal',
  spaces: '/cercles',
};

function useLegacyProps() {
  const data = useData();
  const navigate = useNavigate();
  return {
    data,
    navigate,
    setActiveTab: (tab: string) => navigate(routeForTab[tab] ?? '/accueil'),
  };
}

const Scroll: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ height: '100%', overflowY: 'auto' }}>{children}</div>
);

export const LegacyHome: React.FC = () => {
  const { data, navigate, setActiveTab } = useLegacyProps();
  return (
    <Scroll>
      <Dashboard
        contacts={data.contacts}
        spaces={data.spaces}
        notes={data.notes}
        tags={data.tags}
        selectedSpaceId={data.selectedSpaceId}
        user={data.user}
        onRefreshData={data.refresh}
        setActiveTab={setActiveTab}
        setSelectedSpaceId={data.setSelectedSpaceId}
        onNewContact={() => navigate('/contacts')}
      />
    </Scroll>
  );
};

export const LegacyNetwork: React.FC = () => {
  const { data } = useLegacyProps();
  return (
    <GalaxyVisualizer
      contacts={data.contacts}
      spaces={data.spaces}
      notes={data.notes}
      tags={data.tags}
      contactTags={data.contactTags}
      selectedSpaceId={data.selectedSpaceId}
      user={data.user}
      onRefreshData={data.refresh}
    />
  );
};

export const LegacyOpportunities: React.FC = () => {
  const { data } = useLegacyProps();
  const contacts = data.selectedSpaceId
    ? data.contacts.filter((c) => c.space_id === data.selectedSpaceId)
    : data.contacts;
  return (
    <Scroll>
      <OpportunityHub
        contacts={contacts}
        notes={data.notes}
        tags={data.tags}
        spaces={data.spaces}
        selectedSpaceId={data.selectedSpaceId}
        user={data.user}
      />
    </Scroll>
  );
};

export const LegacyCapture: React.FC = () => {
  const { data } = useLegacyProps();
  return (
    <Scroll>
      <AIInput
        contacts={data.contacts}
        onRefreshData={data.refresh}
        user={data.user}
        selectedSpaceId={data.selectedSpaceId}
        spaces={data.spaces}
      />
    </Scroll>
  );
};

export const LegacyJournal: React.FC = () => {
  const { data } = useLegacyProps();
  return (
    <Scroll>
      <NotesPage
        notes={data.notes}
        contacts={data.contacts}
        user={data.user}
        onRefreshData={data.refresh}
      />
    </Scroll>
  );
};

export const LegacyCircles: React.FC = () => {
  const { data } = useLegacyProps();
  return (
    <Scroll>
      <SpacesPage
        spaces={data.spaces}
        user={data.user}
        onRefreshData={data.refresh}
      />
    </Scroll>
  );
};
