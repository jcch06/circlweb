import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Bell, Check, X, PenLine } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useData } from '../data';
import { useToast } from '../ui/Toast';
import { Avatar, DiffLine } from '../ui/Bits';
import { NoteComposer } from '../ui/NoteComposer';
import { OpportunityCard } from '../ui/OpportunityCard';
import { deriveIntros, getLatestAnalysis, type MistralPipelineResult } from '../lib/mistral';
import { fullName, lastTouch, relStatus, relativeFR, dayFR, inCircle } from '../ui/format';
import { enablePush, pushSupported } from '../lib/push';
import { cn } from '../lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// Accueil : la boîte de réception du matin. Style Folk, épuré : pas de cartes
// boxées, des sections aérées séparées par de l'espace et de fines règles.

const FIELD_LABELS: Record<string, string> = {
  company: 'Entreprise', job_title: 'Poste', industry: 'Secteur',
  location: 'Lieu', linkedin: 'LinkedIn', bio: 'Bio',
};

const SectionHead: React.FC<{ title: string; count?: number; action?: React.ReactNode }> = ({ title, count, action }) => (
  <div className="mb-2 flex items-center gap-2">
    <h2 className="text-[13px] font-semibold">{title}</h2>
    {count != null && <span className="text-xs text-muted-foreground">{count}</span>}
    <span className="flex-1" />
    {action}
  </div>
);

const ghostLink = 'text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1';

export const HomePage: React.FC = () => {
  const data = useData();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [canPromptPush, setCanPromptPush] = useState(false);
  useEffect(() => { setCanPromptPush(pushSupported() && Notification.permission === 'default'); }, []);
  const askPush = async () => {
    setCanPromptPush(false);
    if (!data.user?.id) return;
    const r = await enablePush(data.user.id);
    toast(r === 'ok' ? 'Rappels activés.' : r === 'denied' ? 'Notifications refusées par le navigateur.' : "Activation impossible sur cet appareil.");
  };
  const [analysis, setAnalysis] = useState<MistralPipelineResult | null>(null);
  const [decided, setDecided] = useState<Set<string>>(new Set());
  const [introsLoaded, setIntrosLoaded] = useState(false);

  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const activeSpace = data.selectedSpaceId ? data.spaceById.get(data.selectedSpaceId) : null;
  const inSpace = (c: any) => inCircle(c, data.selectedSpaceId);

  const toProcess = useMemo(
    () => data.pendingUpdates.filter((u) => !data.selectedSpaceId || u.space_id === data.selectedSpaceId).filter((u) => data.contactById.get(u.contact_id)).slice(0, 5),
    [data.pendingUpdates, data.selectedSpaceId, data.contactById]
  );
  const totalPending = data.pendingUpdates.filter((u) => !data.selectedSpaceId || u.space_id === data.selectedSpaceId).length;

  const DAY = 86400000;
  const dueFollowUps = useMemo(
    () => data.followUps.filter((f) => new Date(f.due_date).getTime() <= Date.now() + DAY).map((f) => ({ f, c: data.contactById.get(f.contact_id) })).filter((x) => x.c && inSpace(x.c)),
    [data.followUps, data.contactById, data.selectedSpaceId]
  );
  // Une personne = une ligne, même si elle a été copiée dans plusieurs cercles
  // (même unité que la table Contacts, qui regroupe par shared_contact_id).
  const people = useMemo(() => {
    const seen = new Set<string>();
    return data.contacts.filter(inSpace).filter((c) => { const k = c.shared_contact_id ?? c.id; if (seen.has(k)) return false; seen.add(k); return true; });
  }, [data.contacts, data.selectedSpaceId]);
  const dormants = useMemo(
    () => people.map((c) => { const touch = lastTouch(c, data.lastNoteByContact.get(c.id)); return { c, touch, status: relStatus(touch) }; })
      .filter((x) => x.status === 'due' || x.status === 'dormant').filter((x) => x.touch).sort((a, b) => (a.touch!.getTime() - b.touch!.getTime())).slice(0, 5),
    [people, data.lastNoteByContact]
  );
  // « À relancer » = statut due seul ; « À recontacter » = due + en froid.
  const statusCount = useMemo(() => {
    const n = { due: 0, dormant: 0 };
    for (const c of people) { const st = relStatus(lastTouch(c, data.lastNoteByContact.get(c.id))); if (st === 'due' || st === 'dormant') n[st]++; }
    return n;
  }, [people, data.lastNoteByContact]);
  const totalDue = statusCount.due;
  const enFroid = statusCount.dormant;
  const contactsCount = people.length;
  const recentNotes = useMemo(
    () => data.notes.filter((n) => data.contactById.get(n.contact_id) && inSpace(data.contactById.get(n.contact_id))).slice(0, 6),
    [data.notes, data.contactById, data.selectedSpaceId]
  );
  const notesThisMonth = useMemo(() => { const s = new Date(); s.setDate(1); s.setHours(0, 0, 0, 0); return data.notes.filter((n) => new Date(n.created_at) >= s).length; }, [data.notes]);
  const incomplete = useMemo(() => people.filter((c) => !c.company || !c.job_title).length, [people]);

  const decide = async (u: any, confirm: boolean) => {
    const { error } = await supabase.rpc(confirm ? 'confirm_contact_update' : 'dismiss_contact_update', { p_update_id: u.id });
    if (error) { toast(`Échec : ${error.message}`); return; }
    const c = data.contactById.get(u.contact_id);
    if (confirm && u.field === 'job_title' && c) toast('Mise à jour appliquée.', { label: `Féliciter ${c.first_name} ?`, onClick: () => setNoteFor(c.id) });
    else toast(confirm ? 'Mise à jour appliquée.' : 'Mise à jour écartée.');
    await data.refresh(confirm ? ['updates', 'contacts'] : ['updates']);
  };
  // « Fait » = la personne a été jointe (date de dernier échange mise à jour) ;
  // « Écarter » ferme la relance sans rien affirmer sur l'échange.
  const closeFollowUp = async (f: any, contacted: boolean) => {
    const { error } = await supabase.from('follow_ups').update({ status: contacted ? 'done' : 'dismissed' }).eq('id', f.id);
    if (error) { toast(`Échec : ${error.message}`); return; }
    if (contacted) {
      const { error: e2 } = await supabase.from('contacts').update({ last_contacted_at: new Date().toISOString() }).eq('id', f.contact_id);
      if (e2) { toast(`Relance close, mais la date d'échange n'a pas pu être enregistrée : ${e2.message}`); await data.refresh(['followUps']); return; }
      data.patchContact(f.contact_id, { last_contacted_at: new Date().toISOString() });
    }
    toast(contacted ? 'Relance faite, échange enregistré.' : 'Relance écartée.'); await data.refresh(['followUps']);
  };
  const markContacted = async (c: any) => {
    const { error } = await supabase.from('contacts').update({ last_contacted_at: new Date().toISOString() }).eq('id', c.id);
    if (error) { toast(`Échec : ${error.message}`); return; }
    toast(`${c.first_name} marqué comme joint.`); data.patchContact(c.id, { last_contacted_at: new Date().toISOString() });
  };
  const loadDecisions = async () => {
    const { data: rows } = await supabase.from('intro_suggestions').select('from_contact_id, to_contact_id');
    setDecided(new Set((rows ?? []).map((r: any) => `${r.from_contact_id}|${r.to_contact_id}`)));
  };
  useEffect(() => {
    let cancelled = false; setIntrosLoaded(false);
    (async () => {
      const [latest] = await Promise.all([getLatestAnalysis(data.selectedSpaceId ?? null).catch(() => null), loadDecisions().catch(() => {})]);
      if (cancelled) return; setAnalysis(latest); setIntrosLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [data.selectedSpaceId]);
  const intros = useMemo(
    () => deriveIntros(analysis, (id) => Boolean(data.contactById.get(id))).filter((i) => !decided.has(`${i.from_contact_id}|${i.to_contact_id}`)).slice(0, 3),
    [analysis, decided, data.contactById]
  );

  const calm = toProcess.length === 0 && dueFollowUps.length === 0 && dormants.length === 0;
  const nextFollowUp = data.followUps[0];

  const stats = [
    { label: 'Contacts', value: contactsCount, to: '/contacts' },
    { label: 'À relancer', value: totalDue, to: '/contacts?statut=due', dot: 'bg-[hsl(var(--h-amber-500))]' },
    { label: 'À traiter', value: totalPending, to: '/mises-a-jour' },
    { label: 'En froid', value: enFroid, to: '/contacts?statut=dormant', dot: 'bg-[hsl(var(--h-red-500))]' },
  ];

  const relanceRow = (c: any, meta: React.ReactNode, action: React.ReactNode, key: string) => {
    const lastNote = (data.notesByContact.get(c.id) ?? [])[0];
    return (
      <div key={key} onClick={() => navigate(`/contacts/${c.id}`)}
        className="group -mx-2.5 flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2.5 hover:bg-muted">
        <Avatar name={fullName(c)} firstName={c.first_name} lastName={c.last_name} photoUrl={c.photo_url} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-[13px] font-medium">{fullName(c)}</span>
            <span className="truncate text-xs text-muted-foreground">{[c.job_title, c.company].filter(Boolean).join(' · ')}</span>
          </div>
          <div className="truncate text-xs text-muted-foreground">{lastNote ? lastNote.content.slice(0, 80) : meta}</div>
        </div>
        {meta && lastNote && <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{meta}</span>}
        <span className="flex shrink-0 items-center gap-0.5 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100" onClick={(e) => e.stopPropagation()}>
          <button className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => setNoteFor(c.id)}><PenLine size={13} /> Noter</button>
          {action}
        </span>
      </div>
    );
  };
  const faitBtn = (onClick: () => void) => (
    <button className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={onClick}><Check size={13} /> Fait</button>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1120px] px-7 py-7">
        <div className="mb-6 text-[13px] capitalize text-muted-foreground">{today}{activeSpace ? ` · ${activeSpace.name}` : ''}</div>

        {/* Indicateurs — rangée aérée, séparée par une règle */}
        <div className="mb-7 grid grid-cols-2 gap-6 border-b pb-6 sm:grid-cols-4 sm:gap-8">
          {stats.map((s) => (
            <button key={s.label} onClick={() => navigate(s.to)} className="text-left">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {s.dot && <span className={cn('size-1.5 rounded-full', s.dot)} />}{s.label}
              </span>
              <span className="mt-1.5 block text-[28px] font-semibold leading-none tabular-nums tracking-tight">{s.value.toLocaleString('fr-FR')}</span>
            </button>
          ))}
        </div>

        {canPromptPush && (
          <div className="mb-7 flex items-center gap-3 rounded-xl border px-4 py-3">
            <Bell size={16} className="shrink-0 text-muted-foreground" />
            <div className="flex-1">
              <div className="text-[13px] font-medium">Activez les rappels</div>
              <div className="text-xs text-muted-foreground">Un rappel chaque matin quand des relances vous attendent.</div>
            </div>
            <button className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary" onClick={() => setCanPromptPush(false)}>Plus tard</button>
            <button className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90" onClick={askPush}>Activer</button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-[1fr_300px]">
          <div className="min-w-0">
            {calm ? (
              contactsCount === 0 ? (
                <div className="rounded-xl border px-6 py-14 text-center">
                  <div className="text-base font-semibold">Bienvenue sur Circl</div>
                  <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-muted-foreground">Votre réseau est vide. Importez vos contacts pour que Circl vous dise qui relancer et qui présenter à qui.</p>
                  <button className="mt-4 rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground" onClick={() => navigate('/contacts')}>Importer mes contacts</button>
                </div>
              ) : (
                <div className="rounded-xl border px-6 py-12 text-center">
                  <div className="text-[15px] font-semibold">Rien à traiter ce matin</div>
                  <p className="mt-1 text-[13px] text-muted-foreground">{nextFollowUp ? `Prochaine relance planifiée le ${dayFR(nextFollowUp.due_date)}.` : 'Aucune relance planifiée. Votre réseau est à jour.'}</p>
                </div>
              )
            ) : (
              <>
                {toProcess.length > 0 && (
                  <section className="mb-8">
                    <SectionHead title="À traiter" count={totalPending} action={totalPending > toProcess.length && (
                      <button className={ghostLink} onClick={() => navigate('/mises-a-jour')}>Voir les {totalPending - toProcess.length} restantes <ArrowRight size={12} /></button>
                    )} />
                    <div className="flex flex-col">
                      {toProcess.map((u) => {
                        const c = data.contactById.get(u.contact_id);
                        return (
                          <div key={u.id} className="-mx-2.5 flex items-center gap-3 rounded-lg px-2.5 py-2.5 hover:bg-muted">
                            <Avatar name={fullName(c)} firstName={c.first_name} lastName={c.last_name} photoUrl={c.photo_url} size={32} />
                            <div className="min-w-0 flex-1 cursor-pointer" onClick={() => navigate(`/contacts/${c.id}`)}>
                              <span className="mr-2 text-[13px] font-medium">{fullName(c)}</span>
                              {u.field ? <DiffLine field={FIELD_LABELS[u.field] ?? u.field} oldValue={u.old_value} newValue={u.new_value ?? ''} /> : <span className="text-[13px] text-muted-foreground">{u.summary}</span>}
                            </div>
                            <div className="flex shrink-0 gap-1">
                              <button className="grid size-7 place-items-center rounded-md border text-muted-foreground hover:bg-secondary" title="Écarter" onClick={() => decide(u, false)}><X size={14} /></button>
                              <button className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground hover:opacity-90" title="Confirmer" onClick={() => decide(u, true)}><Check size={14} /></button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {(dueFollowUps.length > 0 || dormants.length > 0) && (
                  <section className="mb-8">
                    <SectionHead title="À recontacter" count={totalDue + enFroid} action={<button className={ghostLink} onClick={() => navigate('/contacts?vue=due')}>Tout voir <ArrowRight size={12} /></button>} />
                    <div className="flex flex-col">
                      {dueFollowUps.map(({ f, c }) => relanceRow(c, <span className="text-[hsl(var(--h-amber-500))]">{f.label} · {dayFR(f.due_date)}</span>, <>{faitBtn(() => closeFollowUp(f, true))}<button className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => closeFollowUp(f, false)}><X size={13} /> Écarter</button></>, `f-${f.id}`))}
                      {dormants.filter(({ c }) => !dueFollowUps.some((d) => d.c.id === c.id)).map(({ c, touch }) => relanceRow(c, <>{relativeFR(touch!.toISOString())}</>, faitBtn(() => markContacted(c)), `d-${c.id}`))}
                    </div>
                  </section>
                )}
              </>
            )}

            <section className="mb-8">
              <SectionHead title="Opportunités" action={<button className={ghostLink} onClick={() => navigate('/opportunites')}>Tout voir <ArrowRight size={12} /></button>} />
              {introsLoaded && intros.length === 0 && (
                <p className="text-[13px] text-muted-foreground">{analysis ? 'Toutes les mises en relation proposées ont été traitées.' : 'Aucune analyse pour ce périmètre. Lancez-en une depuis Opportunités pour voir qui présenter à qui.'}</p>
              )}
              {intros.length > 0 && <div className="flex flex-col gap-3">{intros.map((i) => <OpportunityCard key={`${i.from_contact_id}|${i.to_contact_id}`} intro={i} onResolved={loadDecisions} />)}</div>}
            </section>
          </div>

          {/* Aside */}
          <aside className="min-w-0">
            <h2 className="mb-3 text-[13px] font-semibold">Depuis votre dernière visite</h2>
            {recentNotes.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Aucune note récente.</p>
            ) : (
              <div className="flex flex-col gap-3.5">
                {recentNotes.map((n) => {
                  const c = data.contactById.get(n.contact_id);
                  const space = data.spaceById.get(c.space_id);
                  const shared = space?.type !== 'personal';
                  const mine = n.author_id === data.user?.id;
                  return (
                    <div key={n.id} className="flex cursor-pointer gap-2.5" onClick={() => navigate(`/contacts/${c.id}`)}>
                      <Avatar name={fullName(c)} firstName={c.first_name} lastName={c.last_name} photoUrl={c.photo_url} size={24} />
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{fullName(c)}</span>{shared && <> · {mine ? 'vous' : 'un membre'}</>}{' · '}{relativeFR(n.created_at)}</div>
                        <div className="mt-0.5 line-clamp-2 text-[13px] text-foreground/80">{n.content}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-5 border-t pt-3 text-xs text-muted-foreground">
              <button className="hover:text-foreground" onClick={() => navigate('/contacts')}>{data.contacts.filter(inSpace).length} contacts</button>
              {' · '}<span>{notesThisMonth} notes ce mois</span>
              {' · '}<button className="hover:text-foreground" onClick={() => navigate('/contacts?vue=not_enriched')}>{incomplete} fiches incomplètes</button>
            </div>
          </aside>
        </div>

        <Dialog open={!!noteFor} onOpenChange={(o) => !o && setNoteFor(null)}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader><DialogTitle>Note sur {fullName(data.contactById.get(noteFor ?? '') ?? {})}</DialogTitle></DialogHeader>
            {noteFor && <NoteComposer contactId={noteFor} contactFirstName={data.contactById.get(noteFor)?.first_name} onSaved={() => setNoteFor(null)} />}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};
