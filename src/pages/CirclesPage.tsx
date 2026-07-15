import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X, LogOut, Trash2, Send } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useData } from '../data';
import { useToast } from '../ui/Toast';
import { DecisionPair, ConfirmModal, SectionLabel } from '../ui/Bits';
import { fullName, circleColor, relativeFR, avatarColor } from '../ui/format';

// Cercles (brief 4.7) : la seule page de gestion conservée.
// En tête : invitations et demandes d'accès (avec l'identité du demandeur).
// Cartes à rail coloré, panneau de détail 420 px.

export const CirclesPage: React.FC = () => {
  const data = useData();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [members, setMembers] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Map<string, any>>(new Map());
  const [invites, setInvites] = useState<any[]>([]);
  const [accessRequests, setAccessRequests] = useState<any[]>([]);
  const [openSpaceId, setOpenSpaceId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    const [m, i, ar] = await Promise.all([
      supabase.from('space_members').select('*').then((r) => r.data ?? []),
      supabase.from('invitations').select('*').is('accepted_at', null).then((r) => r.data ?? []),
      supabase.from('contact_access_requests').select('*').eq('status', 'pending').then((r) => r.data ?? []),
    ]);
    setMembers(m);
    setInvites(i);
    setAccessRequests(ar);
    const userIds = [...new Set([...m.map((x: any) => x.user_id), ...ar.map((x: any) => x.requester_id)])];
    if (userIds.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', userIds);
      setProfiles(new Map((profs ?? []).map((p: any) => [p.id, p])));
    }
  };

  useEffect(() => { load(); }, []);

  const membersBySpace = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const m of members.filter((x) => x.accepted_at)) {
      const arr = map.get(m.space_id) ?? [];
      arr.push(m);
      map.set(m.space_id, arr);
    }
    return map;
  }, [members]);

  const contactCountBySpace = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of data.contacts) m.set(c.space_id, (m.get(c.space_id) ?? 0) + 1);
    return m;
  }, [data.contacts]);

  /* Invitations qui me sont adressées */
  const myInvites = invites.filter((i) => i.email?.toLowerCase() === data.user?.email?.toLowerCase());
  /* Demandes d'accès sur MES contacts */
  const myRequests = accessRequests.filter((r) => r.owner_id === data.user?.id);

  const respondInvite = async (inv: any, accept: boolean) => {
    if (accept) {
      const { error } = await supabase.from('space_members').insert({
        space_id: inv.space_id, user_id: data.user.id, role: inv.role, accepted_at: new Date().toISOString(),
      });
      if (error && !error.message.includes('duplicate')) { toast(`Échec : ${error.message}`); return; }
      await supabase.from('invitations').update({ accepted_at: new Date().toISOString() }).eq('id', inv.id);
      toast('Invitation acceptée.');
      await data.refresh();
    } else {
      await supabase.from('invitations').delete().eq('id', inv.id);
      toast('Invitation refusée.');
    }
    await load();
  };

  const respondRequest = async (r: any, approve: boolean) => {
    const { error } = await supabase
      .from('contact_access_requests')
      .update({ status: approve ? 'approved' : 'denied', responded_at: new Date().toISOString() })
      .eq('id', r.id);
    if (error) { toast(`Échec : ${error.message}`); return; }
    toast(approve ? 'Accès accordé.' : 'Demande refusée.');
    await load();
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 24px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <h1 className="t-page">Cercles</h1>
          <span style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={15} /> Nouveau cercle
          </button>
        </div>

        {/* Files d'attente : visibles seulement si non vides */}
        {myInvites.length > 0 && (
          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <SectionLabel>Invitations</SectionLabel>
            {myInvites.map((inv) => {
              const space = data.spaceById.get(inv.space_id);
              return (
                <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44 }}>
                  <span className="t-sec" style={{ flex: 1 }}>
                    Rejoindre <b>{space?.name ?? 'un cercle'}</b> comme {inv.role === 'admin' ? 'admin' : 'membre'}
                  </span>
                  <DecisionPair
                    noTitle="Refuser" yesTitle="Accepter"
                    onNo={() => respondInvite(inv, false)}
                    onYes={() => respondInvite(inv, true)}
                  />
                </div>
              );
            })}
          </div>
        )}

        {myRequests.length > 0 && (
          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <SectionLabel>Demandes d'accès</SectionLabel>
            {myRequests.map((r) => {
              const requester = profiles.get(r.requester_id);
              const contact = data.contactById.get(r.contact_id);
              const rName = requester?.full_name ?? 'Un membre';
              return (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44 }}>
                  <span
                    style={{
                      width: 28, height: 28, borderRadius: 999, background: avatarColor(rName),
                      display: 'grid', placeItems: 'center', color: '#fff', fontSize: 11, fontWeight: 600, flex: 'none',
                    }}
                  >
                    {rName.split(/\s+/).slice(0, 2).map((p: string) => p.charAt(0).toUpperCase()).join('')}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span className="t-sec">
                      <b>{rName}</b> demande l'accès à <b>{contact ? fullName(contact) : 'un contact'}</b>
                    </span>
                    {r.reason && <div className="t-meta" style={{ color: 'var(--mut)' }}>{r.reason}</div>}
                  </div>
                  <span className="t-meta tnum" style={{ color: 'var(--faint)' }}>{relativeFR(r.created_at)}</span>
                  <DecisionPair
                    noTitle="Refuser" yesTitle="Accorder"
                    onNo={() => respondRequest(r, false)}
                    onYes={() => respondRequest(r, true)}
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Cartes de cercle */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
          {data.spaces.map((s) => {
            const spaceMembers = membersBySpace.get(s.id) ?? [];
            const count = contactCountBySpace.get(s.id) ?? 0;
            const myRole = spaceMembers.find((m) => m.user_id === data.user?.id)?.role
              ?? (s.created_by === data.user?.id ? 'owner' : 'member');
            const color = circleColor(s);
            return (
              <div
                key={s.id}
                className="card"
                style={{ padding: '16px 18px 16px 15px', borderLeft: `3px solid ${color}`, cursor: 'pointer' }}
                onClick={() => setOpenSpaceId(s.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span className="t-block" style={{ fontSize: 16 }}>{s.name}</span>
                  <span style={{ flex: 1 }} />
                  <span
                    className="chip"
                    style={{ height: 20, fontSize: 11, padding: '0 8px', borderColor: 'transparent', background: `${''}var(--hover)`, color: 'var(--ink-2)' }}
                  >
                    {s.type === 'personal' ? 'Personnel' : 'Collaboratif'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {/* Pile d'avatars des membres */}
                  <span style={{ display: 'flex' }}>
                    {spaceMembers.slice(0, 5).map((m, i) => {
                      const p = profiles.get(m.user_id);
                      const nm = p?.full_name ?? '?';
                      return (
                        <span
                          key={m.id}
                          title={nm}
                          style={{
                            width: 26, height: 26, borderRadius: 999, background: avatarColor(nm),
                            display: 'grid', placeItems: 'center', color: '#fff', fontSize: 10, fontWeight: 600,
                            border: '2px solid var(--card)', marginLeft: i === 0 ? 0 : -8,
                          }}
                        >
                          {nm.split(/\s+/).slice(0, 2).map((x: string) => x.charAt(0).toUpperCase()).join('')}
                        </span>
                      );
                    })}
                    {spaceMembers.length > 5 && (
                      <span className="t-meta" style={{ color: 'var(--mut)', marginLeft: 4, alignSelf: 'center' }}>
                        +{spaceMembers.length - 5}
                      </span>
                    )}
                  </span>
                  <span style={{ flex: 1 }} />
                  <button
                    className="t-sec tnum"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontWeight: 500 }}
                    onClick={(e) => { e.stopPropagation(); data.setSelectedSpaceId(s.id); navigate('/contacts'); }}
                  >
                    {count} contact{count > 1 ? 's' : ''}
                  </button>
                </div>
                <div className="t-meta" style={{ color: 'var(--mut)', marginTop: 6 }}>
                  Votre rôle : {myRole === 'owner' ? 'propriétaire' : myRole === 'admin' ? 'admin' : 'membre'}
                </div>
              </div>
            );
          })}
        </div>

        {openSpaceId && (
          <CircleDetailPanel
            spaceId={openSpaceId}
            members={membersBySpace.get(openSpaceId) ?? []}
            profiles={profiles}
            onClose={() => setOpenSpaceId(null)}
            onChanged={async () => { await Promise.all([load(), data.refresh()]); }}
          />
        )}

        {showCreate && <CreateCircleModal onClose={() => setShowCreate(false)} onCreated={load} />}
      </div>
    </div>
  );
};

/* Panneau de détail 420 px */
const CircleDetailPanel: React.FC<{
  spaceId: string;
  members: any[];
  profiles: Map<string, any>;
  onClose: () => void;
  onChanged: () => Promise<void>;
}> = ({ spaceId, members, profiles, onClose, onChanged }) => {
  const data = useData();
  const { toast } = useToast();
  const space = data.spaceById.get(spaceId);
  const [name, setName] = useState(space?.name ?? '');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [confirmQuit, setConfirmQuit] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!space) return null;
  const isOwner = space.created_by === data.user?.id;
  const isPersonal = space.type === 'personal';
  const contactCount = data.contacts.filter((c) => c.space_id === spaceId).length;

  const rename = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === space.name) return;
    const { error } = await supabase.from('spaces').update({ name: trimmed }).eq('id', spaceId);
    if (error) { toast(`Renommage impossible : ${error.message}`); return; }
    toast('Cercle renommé.');
    await onChanged();
  };

  const invite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email.includes('@')) return;
    setInviting(true);
    try {
      const res: any = await supabase.functions.invoke('send-invitation', {
        body: { space_id: spaceId, email, role: 'member' },
      });
      if (res.error) throw res.error;
      toast(`Invitation envoyée à ${email}.`);
      setInviteEmail('');
      await onChanged();
    } catch (err: any) {
      toast(`Invitation impossible : ${err.message ?? 'erreur'}`);
    } finally {
      setInviting(false);
    }
  };

  const removeMember = async (m: any) => {
    const { error } = await supabase.from('space_members').delete().eq('id', m.id);
    if (error) { toast(`Retrait impossible : ${error.message}`); return; }
    toast('Membre retiré.');
    await onChanged();
  };

  const quit = async () => {
    const mine = members.find((m) => m.user_id === data.user?.id);
    if (!mine) { setConfirmQuit(false); return; }
    const { error } = await supabase.from('space_members').delete().eq('id', mine.id);
    setConfirmQuit(false);
    if (error) { toast(`Impossible de quitter : ${error.message}`); return; }
    toast(`Vous avez quitté ${space.name}.`);
    onClose();
    await onChanged();
  };

  const doDelete = async () => {
    const { error } = await supabase.from('spaces').delete().eq('id', spaceId);
    setConfirmDelete(false);
    if (error) { toast(`Suppression impossible : ${error.message}`); return; }
    onClose();
    toast(`${space.name} supprimé.`);
    await onChanged();
  };

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="side-panel" role="dialog" aria-label={`Cercle ${space.name}`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <span style={{ width: 10, height: 10, borderRadius: 999, background: circleColor(space), flex: 'none' }} />
          <span className="t-block" style={{ flex: 1, fontSize: 16 }}>{space.name}</span>
          <button className="btn btn-quiet" style={{ padding: 6 }} onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Membres */}
          {!isPersonal && (
            <div>
              <SectionLabel>Membres · {members.length}</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {members.map((m) => {
                  const p = profiles.get(m.user_id);
                  const nm = p?.full_name ?? 'Membre';
                  const isMe = m.user_id === data.user?.id;
                  return (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 36 }}>
                      <span
                        style={{
                          width: 28, height: 28, borderRadius: 999, background: avatarColor(nm),
                          display: 'grid', placeItems: 'center', color: '#fff', fontSize: 11, fontWeight: 600, flex: 'none',
                        }}
                      >
                        {nm.split(/\s+/).slice(0, 2).map((x: string) => x.charAt(0).toUpperCase()).join('')}
                      </span>
                      <span className="t-sec" style={{ flex: 1, fontWeight: isMe ? 600 : 400 }}>
                        {nm}{isMe ? ' (vous)' : ''}
                      </span>
                      <span className="t-meta" style={{ color: 'var(--mut)' }}>
                        {m.role === 'owner' ? 'propriétaire' : m.role}
                      </span>
                      {isOwner && !isMe && m.role !== 'owner' && (
                        <button className="btn btn-quiet" style={{ padding: 4, color: 'var(--danger)' }} title="Retirer" onClick={() => removeMember(m)}>
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {isOwner && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <input
                    className="input"
                    style={{ fontSize: 13 }}
                    type="email"
                    placeholder="email@exemple.fr"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') invite(); }}
                  />
                  <button className="btn btn-primary" style={{ padding: '8px 12px' }} disabled={inviting || !inviteEmail.includes('@')} onClick={invite}>
                    <Send size={13} /> Inviter
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Renommer */}
          {isOwner && (
            <div>
              <SectionLabel>Nom du cercle</SectionLabel>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
                <button className="btn btn-ghost" style={{ padding: '8px 12px' }} disabled={name.trim() === space.name} onClick={rename}>
                  Renommer
                </button>
              </div>
            </div>
          )}

          <div>
            <SectionLabel>Contenu</SectionLabel>
            <div className="t-sec" style={{ color: 'var(--ink-2)' }}>
              <span className="tnum">{contactCount}</span> contact{contactCount > 1 ? 's' : ''} dans ce cercle.
            </div>
          </div>
        </div>

        {/* Pied : quitter / supprimer */}
        {!isPersonal && (
          <div style={{ borderTop: '1px solid var(--line)', padding: '12px 18px', display: 'flex', gap: 10 }}>
            {!isOwner && (
              <button className="btn btn-ghost" onClick={() => setConfirmQuit(true)}>
                <LogOut size={14} /> Quitter le cercle
              </button>
            )}
            <span style={{ flex: 1 }} />
            {isOwner && (
              <button className="btn btn-danger" onClick={() => { setDeleteInput(''); setConfirmDelete(true); }}>
                <Trash2 size={14} /> Supprimer
              </button>
            )}
          </div>
        )}
      </aside>

      {confirmQuit && (
        <ConfirmModal
          title={`Quitter ${space.name} ?`}
          body="Vous n'aurez plus accès aux contacts et notes partagés de ce cercle."
          confirmLabel="Quitter"
          danger
          onConfirm={quit}
          onCancel={() => setConfirmQuit(false)}
        />
      )}

      {confirmDelete && (
        <div className="modal-scrim" onClick={() => setConfirmDelete(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="t-block" style={{ marginBottom: 10 }}>Supprimer {space.name} ?</div>
            <div className="t-sec" style={{ color: 'var(--ink-2)', marginBottom: 12 }}>
              Suppression définitive : les <b className="tnum">{contactCount}</b> contacts du cercle et leurs
              notes, liens et mises à jour disparaissent avec lui. Tapez le nom du cercle pour confirmer.
            </div>
            <input className="input" placeholder={space.name} value={deleteInput} onChange={(e) => setDeleteInput(e.target.value)} autoFocus />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>Annuler</button>
              <button className="btn btn-danger" disabled={deleteInput !== space.name} onClick={doDelete}>
                Supprimer définitivement
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const CreateCircleModal: React.FC<{ onClose: () => void; onCreated: () => Promise<void> }> = ({ onClose, onCreated }) => {
  const data = useData();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    const { data: created, error } = await supabase
      .from('spaces')
      .insert({ type: 'team', name: trimmed, created_by: data.user.id })
      .select('id')
      .single();
    if (!error && created) {
      await supabase.from('space_members').insert({
        space_id: created.id, user_id: data.user.id, role: 'owner', accepted_at: new Date().toISOString(),
      });
    }
    setBusy(false);
    if (error) { toast(`Création impossible : ${error.message}`); return; }
    onClose();
    toast(`Cercle « ${trimmed} » créé.`);
    await Promise.all([onCreated(), data.refresh()]);
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="t-block" style={{ marginBottom: 12 }}>Nouveau cercle</div>
        <input
          className="input" autoFocus placeholder="Nom du cercle (ex : Investisseurs)"
          value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={!name.trim() || busy} onClick={create}>
            {busy ? 'Création…' : 'Créer le cercle'}
          </button>
        </div>
      </div>
    </div>
  );
};
