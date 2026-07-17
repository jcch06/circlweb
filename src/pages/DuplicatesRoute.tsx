import React from 'react';
import { useData } from '../data';
import { DuplicatesPage } from '../components/DuplicatesPage';

// Adaptateur pour la page Doublons de jcch06 : elle attend les données en
// props (contrat d'origine), la coquille refondue les tient dans le contexte.
// Elle garde son fonctionnement, on ne fait que la brancher sur les routes.
export const DuplicatesRoute: React.FC = () => {
  const data = useData();
  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <DuplicatesPage
        contacts={data.contacts}
        notes={data.notes}
        user={data.user}
        onRefreshData={data.refresh}
      />
    </div>
  );
};
