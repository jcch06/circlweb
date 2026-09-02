import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Bell, Check, PenLine, Users, Clock, Snowflake } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useData } from '../data';
import { useToast } from '../ui/Toast';
import { Avatar, DecisionPair, DiffLine, SectionLabel } from '../ui/Bits';
import { NoteComposer } from '../ui/NoteComposer';
import { OpportunityCard } from '../ui/OpportunityCard';
import { deriveIntros, getLatestAnalysis, type MistralPipelineResult } from '../lib/mistral';
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
  // Opportunités de l'Accueil : dérivées de la DERNIÈRE analyse Oracle
  // enregistrée, exactement comme la page Opportunités (deriveIntros partagé).
  // Avant, l'Accueil appelait une Edge Function `suggest-intros` distincte
  // (autre modèle, autre périmètre, aucune persistance) : une paire écartée
  // dans Opportunités revenait ici, et les cartes n'étaient pas actionnables.
  const [analysis, setAnalysis] = useState<MistralPipelineResult | null>(null);
  const [decided, setDecided] = useState<Set<string>>(new Set());
  const [introsLoaded, setIntrosLoaded] = useState(false);

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
  const contactsCount = useMemo(() => data.contacts.filter(inSpace).length, [data.contacts, data.selectedSpaceId]);
  const enFroid = useMemo(
    () => data.contacts.filter(inSpace).filter((c) => relStatus(lastTouch(c, data.lastNoteByContact.get(c.id))) === 'dormant').length,
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

  const loadDecisions = async () => {
    const { data: rows } = await supabase.from('intro_suggestions').select('from_contact_id, to_contact_id');
    setDecided(new Set((rows ?? []).map((r: any) => `${r.from_contact_id}|${r.to_contact_id}`)));
  };

  // Même périmètre que la page Opportunités : null = fusion de tous les cercles.
  useEffect(() => {
    let cancelled = false;
    setIntrosLoaded(false);
    (async () => {
      const [latest] = await Promise.all([
        getLatestAnalysis(data.selectedSpaceId ?? null).catch(() => null),
        loadDecisions().catch(() => {}),
      ]);
      if (cancelled) return;
      setAnalysis(latest);
      setIntrosLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [data.selectedSpaceId]);

  const intros = useMemo(
    () => deriveIntros(analysis, (id) => Boolean(data.contactById.get(id)))
      .filter((i) => !decided.has(`${i.from_contact_id}|${i.to_contact_id}`))
      .slice(0, 3),
    [analysis, decided, data.contactById]
  );

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
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 20 }}>
          <h1 className="t-page">Accueil</h1>
          <span className="t-sec" style={{ color: 'var(--mut)', textTransform: 'capitalize' }}>{today}</span>
          {activeSpace && (
            <span className="t-sec" style={{ color: 'var(--mut)' }}>· {activeSpace.name}</span>
          )}
        </div>

        {/* Rangée d'indicateurs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
          <div className="kpi" style={{ cursor: 'pointer' }} onClick={() => navigate('/contacts')}>
            <div><div className="kpi-lbl">Contacts</div><div className="kpi-val">{contactsCount}</div></div>
            <div className="kpi-tile" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Users size={22} /></div>
          </div>
          <div className="kpi" style={{ cursor: 'pointer' }} onClick={() => navigate('/contacts?vue=due')}>
            <div><div className="kpi-lbl">À relancer</div><div className="kpi-val">{totalDue}</div></div>
            <div className="kpi-tile" style={{ background: 'var(--status-due-soft)', color: 'var(--status-due)' }}><Clock size={22} /></div>
          </div>
          <div className="kpi" style={{ cursor: 'pointer' }} onClick={() => navigate('/mises-a-jour')}>
            <div><div className="kpi-lbl">À traiter</div><div className="kpi-val">{totalPending}</div></div>
            <div className="kpi-tile" style={{ background: '#ECECFA', color: 'var(--circle-2)' }}><Bell size={22} /></div>
          </div>
          <div className="kpi" style={{ cursor: 'pointer' }} onClick={() => navigate('/contacts?statut=dormant')}>
            <div><div className="kpi-lbl">En froid · +90j</div><div className="kpi-val">{enFroid}</div></div>
            <div className="kpi-tile" style={{ background: 'var(--status-dormant-soft)', color: 'var(--status-dormant)' }}><Snowflake size={22} /></div>
          </div>
        </div>

        <div className="home-grid">
          {/* Colonne principale */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {calm ? (
              contactsCount === 0 ? (
                <div className="card card-pad" style={{ textAlign: 'center', padding: '44px 24px' }}>
                  <div className="t-block" style={{ marginBottom: 6 }}>Bienvenue sur Circl</div>
                  <div className="t-sec" style={{ color: 'var(--mut)', marginBottom: 18 }}>
                    Votre réseau est vide. Importez vos contacts pour que Circl vous dise qui relancer et qui présenter à qui.
                  </div>
                  <button className="btn btn-primary" onClick={() => navigate('/contacts')}>Importer mes contacts</button>
                </div>
              ) : (
                <div className="card card-pad" style={{ textAlign: 'center', padding: '40px 20px' }}>
                  <div className="t-block" style={{ marginBottom: 6 }}>Rien à traiter ce matin</div>
                  <div className="t-sec" style={{ color: 'var(--mut)' }}>
                    {nextFollowUp
                      ? `Prochaine relance planifiée le ${dayFR(nextFollowUp.due_date)}.`
                      : 'Aucune relance planifiée. Votre réseau est à jour.'}
                  </div>
                </div>
              )
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: intros.length > 0 ? 12 : 0 }}>
                <SectionLabel style={{ marginBottom: 0 }}>Opportunités</SectionLabel>
                <span style={{ flex: 1 }} />
                <button className="btn btn-quiet" style={{ padding: '3px 8px', fontSize: 12.5 }} onClick={() => navigate('/opportunites')}>
                  Tout voir <ArrowRight size={12} />
                </button>
              </div>
              {introsLoaded && intros.length === 0 && (
                <div className="t-sec" style={{ color: 'var(--mut)', marginTop: 8 }}>
                  {analysis
                    ? 'Toutes les mises en relation proposées ont été traitées.'
                    : 'Aucune analyse pour ce périmètre. Lancez-en une depuis Opportunités pour voir qui présenter à qui.'}
                </div>
              )}
              {intros.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {intros.map((i) => (
                    <OpportunityCard
                      key={`${i.from_contact_id}|${i.to_contact_id}`}
                      intro={i}
                      onResolved={loadDecisions}
                    />
                  ))}
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
