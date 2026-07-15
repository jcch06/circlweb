import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../data';
import { OpportunityHub } from '../components/OpportunityHub';

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
