import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useData } from '../data';
import { useToast } from '../ui/Toast';
import { Avatar, DecisionPair, DiffLine, AICard, SectionLabel } from '../ui/Bits';
import { fullName, relativeFR } from '../ui/format';

// Page Mises à jour (brief 4.4) : la boîte de réception des changements
// détectés. Version lot 1 : groupage par contact, diff, paire de décision.
// (Strates par confiance, veille transparente et triage clavier : lot 2.)

const FIELD_LABELS: Record<string, string> = {
  company: 'Entreprise', job_title: 'Poste', industry: 'Secteur',
  location: 'Lieu', linkedin: 'LinkedIn', bio: 'Bio',
};

export const UpdatesPage: React.FC = () => {
  const data = useData();
  const { toast } = useToast();
  const navigate = useNavigate();

  const groups = useMemo(() => {
    const filtered = data.selectedSpaceId
      ? data.pendingUpdates.filter((u) => u.space_id === data.selectedSpaceId)
      : data.pendingUpdates;
    const byContact = new Map<string, any[]>();
    for (const u of filtered) {
      const arr = byContact.get(u.contact_id) ?? [];
      arr.push(u);
      byContact.set(u.contact_id, arr);
    }
    return [...byContact.entries()]
      .map(([contactId, updates]) => ({ contact: data.contactById.get(contactId), updates }))
      .filter((g) => g.contact)
      .sort((a, b) => (b.updates[0].created_at > a.updates[0].created_at ? 1 : -1));
  }, [data.pendingUpdates, data.selectedSpaceId, data.contactById]);

  const total = groups.reduce((n, g) => n + g.updates.length, 0);

  const decide = async (u: any, confirm: boolean) => {
    const { error } = await supabase.rpc(
      confirm ? 'confirm_contact_update' : 'dismiss_contact_update',
      { p_update_id: u.id }
    );
    if (error) { toast(`Échec : ${error.message}`); return; }
    toast(confirm ? 'Mise à jour appliquée.' : 'Mise à jour écartée.');
    await data.refresh();
  };

  const confirmAll = async (updates: any[]) => {
    for (const u of updates) {
      await supabase.rpc('confirm_contact_update', { p_update_id: u.id });
    }
    toast(`${updates.length} mises à jour appliquées.`);
    await data.refresh();
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '24px 20px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 20 }}>
          <h1 className="t-page">Mises à jour</h1>
          {total > 0 && <span className="t-sec tnum" style={{ color: 'var(--mut)' }}>{total} à traiter</span>}
        </div>

        {groups.length === 0 ? (
          <AICard>
            <SectionLabel>Tout est à jour</SectionLabel>
            <p className="t-sec" style={{ color: 'var(--ink-2)', lineHeight: '21px' }}>
              Les mises à jour arrivent de deux endroits : les notes vocales dictées dans l'app iPhone,
              et la veille web sur les contacts tagués VIP ou À suivre. Quand un changement est détecté
              (nouveau poste, nouvelle entreprise…), il attend ici votre confirmation avant d'écrire
              quoi que ce soit sur la fiche.
            </p>
          </AICard>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {groups.map(({ contact, updates }) => {
              const name = fullName(contact);
              return (
                <div key={contact.id} className="card card-pad">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <Avatar name={name} firstName={contact.first_name} lastName={contact.last_name} photoUrl={contact.photo_url} size={32} />
                    <button
                      className="t-name"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)' }}
                      onClick={() => navigate(`/contacts/${contact.id}`)}
                    >
                      {name}
                    </button>
                    <span className="t-meta tnum" style={{ color: 'var(--faint)' }}>
                      {relativeFR(updates[0].created_at)}
                    </span>
                    <span style={{ flex: 1 }} />
                    {updates.length > 1 && (
                      <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12.5 }} onClick={() => confirmAll(updates)}>
                        <CheckCheck size={13} /> Tout confirmer ({updates.length})
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {updates.map((u) => (
                      <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {u.field ? (
                            <DiffLine field={FIELD_LABELS[u.field] ?? u.field} oldValue={u.old_value} newValue={u.new_value ?? ''} />
                          ) : (
                            <span className="t-sec">{u.summary}</span>
                          )}
                          {u.summary && u.field && (
                            <div className="t-meta" style={{ color: 'var(--mut)', marginTop: 2 }}>{u.summary}</div>
                          )}
                        </div>
                        <DecisionPair onNo={() => decide(u, false)} onYes={() => decide(u, true)} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
