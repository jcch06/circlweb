import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Bell, Check, Lightbulb, PenLine } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useData } from '../data';
import { useToast } from '../ui/Toast';
import { Avatar, DecisionPair, DiffLine, AICard, SectionLabel } from '../ui/Bits';
import { NoteComposer } from '../ui/NoteComposer';
import { fullName, lastTouch, relStatus, relativeFR, dayFR } from '../ui/format';

// Accueil (brief 4.1) : la boîte de réception du matin. En moins de 60 s :
// ce qui attend une décision, qui relancer et pourquoi, ce qui a bougé.
// Traiter sans quitter l'écran. Le vide est un état sain.

const FIELD_LABELS: Record<string, string> = {
  company: 'Entreprise', job_title: 'Poste', industry: 'Secteur',
  location: 'Lieu', linkedin: 'LinkedIn', bio: 'Bio',
};

export const HomePage: React.FC = () => {
  const data = useData();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [intros, setIntros] = useState<any[] | null>(null);
  const [introsBusy, setIntrosBusy] = useState(false);

  const prenom = data.user?.user_metadata?.full_name?.split(' ')[0]
    || data.user?.email?.split('@')[0] || '';
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const activeSpace = data.selectedSpaceId ? data.spaceById.get(data.selectedSpaceId) : null;

  const inSpace = (c: any) => !data.selectedSpaceId || c.space_id === data.selectedSpaceId;

  /* --- À traiter : sommet de la file des mises à jour --- */
  const toProcess = useMemo(
    () => data.pendingUpdates
      .filter((u) => !data.selectedSpaceId || u.space_id === data.selectedSpaceId)
      .filter((u) => data.contactById.get(u.contact_id))
      .slice(0, 5),
    [data.pendingUpdates, data.selectedSpaceId, data.contactById]
  );
  const totalPending = data.pendingUpdates.filter((u) => !data.selectedSpaceId || u.space_id === data.selectedSpaceId).length;

  /* --- À relancer : relances échues d'abord, puis dormants --- */
  const DAY = 86400000;
  const dueFollowUps = useMemo(
    () => data.followUps
      .filter((f) => new Date(f.due_date).getTime() <= Date.now() + DAY)
      .map((f) => ({ f, c: data.contactById.get(f.contact_id) }))
      .filter((x) => x.c && inSpace(x.c)),
    [data.followUps, data.contactById, data.selectedSpaceId]
  );
  const dormants = useMemo(
    () => data.contacts
      .filter(inSpace)
      .map((c) => {
        const touch = lastTouch(c, data.lastNoteByContact.get(c.id));
        return { c, touch, status: relStatus(touch) };
      })
      .filter((x) => x.status === 'due' || x.status === 'dormant')
      .filter((x) => x.touch)   // les « jamais contactés » ne polluent pas la relance
      .sort((a, b) => (a.touch!.getTime() - b.touch!.getTime()))
      .slice(0, 5),
    [data.contacts, data.lastNoteByContact, data.selectedSpaceId]
  );
  const totalDue = useMemo(
    () => data.contacts.filter(inSpace).filter((c) => {
      const s = relStatus(lastTouch(c, data.lastNoteByContact.get(c.id)));
      return s === 'due' || s === 'dormant';
    }).length,
    [data.contacts, data.lastNoteByContact, data.selectedSpaceId]
  );

  /* --- Rail droit : depuis votre dernière visite --- */
  const recentNotes = useMemo(
    () => data.notes
      .filter((n) => data.contactById.get(n.contact_id) && inSpace(data.contactById.get(n.contact_id)))
      .slice(0, 6),
    [data.notes, data.contactById, data.selectedSpaceId]
  );

  const notesThisMonth = useMemo(() => {
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    return data.notes.filter((n) => new Date(n.created_at) >= start).length;
  }, [data.notes]);
  const incomplete = useMemo(
    () => data.contacts.filter(inSpace).filter((c) => !c.company || !c.job_title).length,
    [data.contacts, data.selectedSpaceId]
  );

  const decide = async (u: any, confirm: boolean) => {
    const { error } = await supabase.rpc(
      confirm ? 'confirm_contact_update' : 'dismiss_contact_update',
      { p_update_id: u.id }
    );
    if (error) { toast(`Échec : ${error.message}`); return; }
    const c = data.contactById.get(u.contact_id);
    if (confirm && u.field === 'job_title' && c) {
      toast('Mise à jour appliquée.', {
        label: `Féliciter ${c.first_name} ?`,
        onClick: () => { setNoteFor(c.id); },
      });
    } else {
      toast(confirm ? 'Mise à jour appliquée.' : 'Mise à jour écartée.');
    }
    await data.refresh();
  };

  const closeFollowUp = async (f: any) => {
    const now = new Date().toISOString();
    await supabase.from('follow_ups').update({ status: 'done' }).eq('id', f.id);
    await supabase.from('contacts').update({ last_contacted_at: now }).eq('id', f.contact_id);
    toast('Relance close.');
    await data.refresh();
  };

  const markContacted = async (c: any) => {
    const now = new Date().toISOString();
    const { error } = await supabase.from('contacts').update({ last_contacted_at: now }).eq('id', c.id);
    if (error) { toast(`Échec : ${error.message}`); return; }
    toast(`${c.first_name} marqué comme joint.`);
    await data.refresh();
  };

  const discoverIntros = async () => {
    setIntrosBusy(true);
    try {
      const res: any = await supabase.functions.invoke('suggest-intros', {
        body: { space_id: data.selectedSpaceId ?? data.spaces.find((s) => s.type === 'personal')?.id },
      });
      if (res.error) throw res.error;
      setIntros((res.data?.intros ?? []).slice(0, 3));
    } catch (err: any) {
      toast(`Analyse indisponible : ${err.message ?? 'erreur'}`);
      setIntros([]);
    } finally {
      setIntrosBusy(false);
    }
  };

  const calm = toProcess.length === 0 && dueFollowUps.length === 0 && dormants.length === 0;
  const nextFollowUp = data.followUps[0];

  const relanceRow = (c: any, meta: React.ReactNode, action: React.ReactNode, key: string) => {
    const lastNote = (data.notesByContact.get(c.id) ?? [])[0];
    return (
      <div
        key={key}
        onClick={() => navigate(`/contacts/${c.id}`)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
          borderRadius: 'var(--r-el)', cursor: 'pointer', minHeight: 44,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <Avatar name={fullName(c)} firstName={c.first_name} lastName={c.last_name} photoUrl={c.photo_url} size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="t-name">{fullName(c)}</span>
            <span className="t-meta" style={{ color: 'var(--mut)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[c.job_title, c.company].filter(Boolean).join(' · ')}
            </span>
          </div>
          <div className="t-meta" style={{ color: 'var(--mut)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {lastNote ? lastNote.content.slice(0, 60) : meta}
          </div>
        </div>
        {meta && lastNote && <span className="t-meta tnum" style={{ color: 'var(--mut)', flex: 'none' }}>{meta}</span>}
        <span style={{ display: 'flex', gap: 6, flex: 'none' }} onClick={(e) => e.stopPropagation()}>
          <button className="btn btn-quiet" style={{ padding: '5px 8px', fontSize: 12.5 }} title="Écrire une note" onClick={() => setNoteFor(c.id)}>
            <PenLine size={13} /> Noter
          </button>
          {action}
        </span>
      </div>
    );
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ maxWidth: 1060, margin: '0 auto', padding: '24px 24px 60px' }}>
        {/* En-tête d'une ligne */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 22 }}>
          <h1 className="t-page">{prenom ? `Bonjour, ${prenom}` : 'Bonjour'}</h1>
          <span className="t-sec" style={{ color: 'var(--mut)' }}>{today}</span>
          {activeSpace && (
            <span className="t-sec" style={{ color: 'var(--mut)' }}>· {activeSpace.name}</span>
          )}
        </div>

        <div className="home-grid">
          {/* Colonne principale */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {calm ? (
              <div className="card card-pad" style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div className="t-block" style={{ marginBottom: 6 }}>Rien à traiter ce matin</div>
                <div className="t-sec" style={{ color: 'var(--mut)' }}>
                  {nextFollowUp
                    ? `Prochaine relance planifiée le ${dayFR(nextFollowUp.due_date)}.`
                    : 'Aucune relance planifiée. Votre réseau est à jour.'}
                </div>
              </div>
            ) : (
              <>
                {/* À traiter */}
                {toProcess.length > 0 && (
                  <div className="card card-pad">
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                      <SectionLabel style={{ marginBottom: 0 }}>À traiter</SectionLabel>
                      <span className="t-meta tnum" style={{ color: 'var(--mut)' }}>{totalPending}</span>
                      <span style={{ flex: 1 }} />
                      {totalPending > toProcess.length && (
                        <button className="btn btn-quiet" style={{ padding: '3px 8px', fontSize: 12.5 }} onClick={() => navigate('/mises-a-jour')}>
                          Voir les {totalPending - toProcess.length} restantes <ArrowRight size={12} />
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {toProcess.map((u) => {
                        const c = data.contactById.get(u.contact_id);
                        return (
                          <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44 }}>
                            <Avatar name={fullName(c)} firstName={c.first_name} lastName={c.last_name} photoUrl={c.photo_url} size={32} />
                            <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => navigate(`/contacts/${c.id}`)}>
                              <span className="t-name" style={{ marginRight: 8 }}>{fullName(c)}</span>
                              {u.field ? (
                                <DiffLine field={FIELD_LABELS[u.field] ?? u.field} oldValue={u.old_value} newValue={u.new_value ?? ''} />
                              ) : (
                                <span className="t-sec" style={{ color: 'var(--ink-2)' }}>{u.summary}</span>
                              )}
                            </div>
                            <DecisionPair onNo={() => decide(u, false)} onYes={() => decide(u, true)} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* À relancer */}
                {(dueFollowUps.length > 0 || dormants.length > 0) && (
                  <div className="card card-pad">
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                      <SectionLabel style={{ marginBottom: 0 }}>À relancer</SectionLabel>
                      <button
                        className="t-meta tnum"
                        style={{ color: 'var(--mut)', background: 'none', border: 'none', cursor: 'pointer' }}
                        onClick={() => navigate('/contacts?vue=due')}
                        title="Voir tous les contacts à relancer"
                      >
                        {totalDue}
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {dueFollowUps.map(({ f, c }) =>
                        relanceRow(
                          c,
                          <span className="t-meta tnum" style={{ color: 'var(--orange)', fontWeight: 600 }}>
                            <Bell size={11} style={{ verticalAlign: -1, marginRight: 3 }} />
                            {f.label} · {dayFR(f.due_date)}
                          </span>,
                          <button className="btn btn-quiet" style={{ padding: '5px 8px', fontSize: 12.5, color: 'var(--accent)' }} onClick={() => closeFollowUp(f)}>
                            <Check size={13} /> Fait
                          </button>,
                          `f-${f.id}`
                        )
                      )}
                      {dormants
                        .filter(({ c }) => !dueFollowUps.some((d) => d.c.id === c.id))
                        .map(({ c, touch }) =>
                          relanceRow(
                            c,
                            <>{relativeFR(touch!.toISOString())}</>,
                            <button className="btn btn-quiet" style={{ padding: '5px 8px', fontSize: 12.5, color: 'var(--accent)' }} onClick={() => markContacted(c)}>
                              <Check size={13} /> Fait
                            </button>,
                            `d-${c.id}`
                          )
                        )}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Opportunités : chargées à la demande (coût API) */}
            <div className="card card-pad">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: intros && intros.length > 0 ? 12 : 0 }}>
                <SectionLabel style={{ marginBottom: 0 }}>Opportunités</SectionLabel>
                <span style={{ flex: 1 }} />
                {intros === null ? (
                  <button className="btn btn-ghost" style={{ padding: '5px 11px', fontSize: 12.5 }} onClick={discoverIntros} disabled={introsBusy}>
                    <Lightbulb size={13} /> {introsBusy ? 'Analyse…' : 'Découvrir'}
                  </button>
                ) : (
                  <button className="btn btn-quiet" style={{ padding: '3px 8px', fontSize: 12.5 }} onClick={() => navigate('/opportunites')}>
                    Tout voir <ArrowRight size={12} />
                  </button>
                )}
              </div>
              {intros !== null && intros.length === 0 && (
                <div className="t-sec" style={{ color: 'var(--mut)', marginTop: 8 }}>
                  Rien à suggérer pour l'instant. Plus vos notes sont riches, plus l'analyse trouve de mises en relation.
                </div>
              )}
              {intros && intros.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {intros.map((it) => {
                    const from = data.contactById.get(it.from_id);
                    const to = data.contactById.get(it.to_id);
                    return (
                      <AICard key={`${it.from_id}-${it.to_id}`}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          {from && <Avatar name={fullName(from)} firstName={from.first_name} lastName={from.last_name} photoUrl={from.photo_url} size={24} />}
                          <button className="t-name" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)' }} onClick={() => from && navigate(`/contacts/${from.id}`)}>
                            {it.from_name}
                          </button>
                          <ArrowRight size={13} color="var(--mut)" />
                          {to && <Avatar name={fullName(to)} firstName={to.first_name} lastName={to.last_name} photoUrl={to.photo_url} size={24} />}
                          <button className="t-name" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)' }} onClick={() => to && navigate(`/contacts/${to.id}`)}>
                            {it.to_name}
                          </button>
                        </div>
                        <div className="t-sec" style={{ color: 'var(--ink-2)' }}>
                          {it.rationale?.length > 140 ? `${it.rationale.slice(0, 140)}…` : it.rationale}
                        </div>
                      </AICard>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Rail droit */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card card-pad" style={{ padding: '14px 16px' }}>
              <SectionLabel>Depuis votre dernière visite</SectionLabel>
              {recentNotes.length === 0 ? (
                <div className="t-sec" style={{ color: 'var(--mut)' }}>Aucune note récente.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {recentNotes.map((n) => {
                    const c = data.contactById.get(n.contact_id);
                    const space = data.spaceById.get(c.space_id);
                    const shared = space?.type !== 'personal';
                    const mine = n.author_id === data.user?.id;
                    return (
                      <div key={n.id} style={{ display: 'flex', gap: 8, cursor: 'pointer' }} onClick={() => navigate(`/contacts/${c.id}`)}>
                        <Avatar name={fullName(c)} firstName={c.first_name} lastName={c.last_name} photoUrl={c.photo_url} size={24} />
                        <div style={{ minWidth: 0 }}>
                          <div className="t-meta" style={{ color: 'var(--mut)' }}>
                            <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{fullName(c)}</span>
                            {shared && <> · {mine ? 'vous' : 'un membre'}</>}
                            {' · '}{relativeFR(n.created_at)}
                          </div>
                          <div className="t-sec" style={{ color: 'var(--ink-2)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {n.content}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Compteurs-liens */}
            <div className="t-meta tnum" style={{ color: 'var(--mut)', padding: '0 4px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <a style={{ cursor: 'pointer' }} onClick={() => navigate('/contacts')}>
                {data.contacts.filter(inSpace).length} contacts
              </a>
              · <span>{notesThisMonth} notes ce mois</span>
              · <a style={{ cursor: 'pointer' }} onClick={() => navigate('/contacts?vue=not_enriched')}>
                {incomplete} fiches incomplètes
              </a>
            </div>
          </div>
        </div>

        {/* Composer pré-ciblé (action « Noter » et « Féliciter ») */}
        {noteFor && (
          <div className="modal-scrim" onClick={() => setNoteFor(null)}>
            <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
              <div className="t-block" style={{ marginBottom: 12 }}>
                Note sur {fullName(data.contactById.get(noteFor) ?? {})}
              </div>
              <NoteComposer
                contactId={noteFor}
                contactFirstName={data.contactById.get(noteFor)?.first_name}
                onSaved={() => setNoteFor(null)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
