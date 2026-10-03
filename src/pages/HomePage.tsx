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
import { fullName, lastTouch, relStatus, relativeFR, dayFR } from '../ui/format';
import { enablePush, pushSupported } from '../lib/push';
import { cn } from '../lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// Accueil : la boîte de réception du matin. En moins de 60 s : ce qui attend
// une décision, qui relancer et pourquoi, ce qui a bougé. Traiter sans quitter
// l'écran. Le vide est un état sain.

const FIELD_LABELS: Record<string, string> = {
  company: 'Entreprise', job_title: 'Poste', industry: 'Secteur',
  location: 'Lieu', linkedin: 'LinkedIn', bio: 'Bio',
};

const SectionHead: React.FC<{ title: string; count?: number; action?: React.ReactNode }> = ({ title, count, action }) => (
  <div className="mb-3 flex items-center gap-2">
    <h2 className="text-sm font-semibold">{title}</h2>
    {count != null && <span className="text-xs tabular-nums text-muted-foreground">{count}</span>}
    <span className="flex-1" />
    {action}
  </div>
);

export const HomePage: React.FC = () => {
  const data = useData();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [canPromptPush, setCanPromptPush] = useState(false);
  useEffect(() => {
    setCanPromptPush(pushSupported() && Notification.permission === 'default');
  }, []);
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

  const inSpace = (c: any) => !data.selectedSpaceId || c.space_id === data.selectedSpaceId;

  const toProcess = useMemo(
    () => data.pendingUpdates
      .filter((u) => !data.selectedSpaceId || u.space_id === data.selectedSpaceId)
      .filter((u) => data.contactById.get(u.contact_id))
      .slice(0, 5),
    [data.pendingUpdates, data.selectedSpaceId, data.contactById]
  );
  const totalPending = data.pendingUpdates.filter((u) => !data.selectedSpaceId || u.space_id === data.selectedSpaceId).length;

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
      .filter((x) => x.touch)
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
    const { error } = await supabase.rpc(confirm ? 'confirm_contact_update' : 'dismiss_contact_update', { p_update_id: u.id });
    if (error) { toast(`Échec : ${error.message}`); return; }
    const c = data.contactById.get(u.contact_id);
    if (confirm && u.field === 'job_title' && c) {
      toast('Mise à jour appliquée.', { label: `Féliciter ${c.first_name} ?`, onClick: () => setNoteFor(c.id) });
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

  const stats = [
    { label: 'Contacts', value: contactsCount, to: '/contacts' },
    { label: 'À relancer', value: totalDue, to: '/contacts?vue=due', dot: 'bg-hamber-500' },
    { label: 'À traiter', value: totalPending, to: '/mises-a-jour' },
    { label: 'En froid', value: enFroid, to: '/contacts?statut=dormant', dot: 'bg-hred-500' },
  ];

  const relanceRow = (c: any, meta: React.ReactNode, action: React.ReactNode, key: string) => {
    const lastNote = (data.notesByContact.get(c.id) ?? [])[0];
    return (
      <div key={key} onClick={() => navigate(`/contacts/${c.id}`)}
        className="group flex min-h-[48px] cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-accent/60">
        <Avatar name={fullName(c)} firstName={c.first_name} lastName={c.last_name} photoUrl={c.photo_url} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-medium">{fullName(c)}</span>
            <span className="truncate text-xs text-muted-foreground">{[c.job_title, c.company].filter(Boolean).join(' · ')}</span>
          </div>
          <div className="truncate text-xs text-muted-foreground">{lastNote ? lastNote.content.slice(0, 70) : meta}</div>
        </div>
        {meta && lastNote && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{meta}</span>}
        <span className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" title="Écrire une note" onClick={() => setNoteFor(c.id)}>
            <PenLine className="size-3.5" /> Noter
          </Button>
          {action}
        </span>
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-8 pb-16">
        <div className="mb-5 text-sm capitalize text-muted-foreground">{today}{activeSpace ? ` · ${activeSpace.name}` : ''}</div>

        {/* Indicateurs */}
        <Card className="mb-5 grid grid-cols-2 divide-border sm:grid-cols-4 sm:divide-x">
          {stats.map((s) => (
            <button key={s.label} onClick={() => navigate(s.to)}
              className="flex flex-col items-start gap-1 px-5 py-4 text-left transition-colors hover:bg-card-hover">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {s.dot && <span className={cn('size-1.5 rounded-full', s.dot)} />}{s.label}
              </span>
              <span className="text-2xl font-semibold tabular-nums tracking-tight">{s.value}</span>
            </button>
          ))}
        </Card>

        {canPromptPush && (
          <Card className="mb-5 flex items-center gap-3 px-4 py-3">
            <Bell className="size-4 shrink-0 text-muted-foreground" />
            <div className="flex-1">
              <div className="text-sm font-medium">Activez les rappels</div>
              <div className="text-xs text-muted-foreground">Un rappel chaque matin quand des relances vous attendent.</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setCanPromptPush(false)}>Plus tard</Button>
            <Button size="sm" onClick={askPush}>Activer</Button>
          </Card>
        )}

        <div className="grid items-start gap-5 lg:grid-cols-[1fr_320px]">
          <div className="flex flex-col gap-5">
            {calm ? (
              contactsCount === 0 ? (
                <Card className="px-6 py-11 text-center">
                  <div className="text-lg font-semibold">Bienvenue sur Circl</div>
                  <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
                    Votre réseau est vide. Importez vos contacts pour que Circl vous dise qui relancer et qui présenter à qui.
                  </p>
                  <Button className="mt-4" onClick={() => navigate('/contacts')}>Importer mes contacts</Button>
                </Card>
              ) : (
                <Card className="px-5 py-10 text-center">
                  <div className="text-base font-semibold">Rien à traiter ce matin</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {nextFollowUp ? `Prochaine relance planifiée le ${dayFR(nextFollowUp.due_date)}.` : 'Aucune relance planifiée. Votre réseau est à jour.'}
                  </p>
                </Card>
              )
            ) : (
              <>
                {toProcess.length > 0 && (
                  <Card className="p-5">
                    <SectionHead title="À traiter" count={totalPending} action={
                      totalPending > toProcess.length && (
                        <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => navigate('/mises-a-jour')}>
                          Voir les {totalPending - toProcess.length} restantes <ArrowRight className="size-3" />
                        </Button>
                      )} />
                    <div className="flex flex-col gap-1">
                      {toProcess.map((u) => {
                        const c = data.contactById.get(u.contact_id);
                        return (
                          <div key={u.id} className="flex min-h-[44px] items-center gap-3">
                            <Avatar name={fullName(c)} firstName={c.first_name} lastName={c.last_name} photoUrl={c.photo_url} size={32} />
                            <div className="min-w-0 flex-1 cursor-pointer" onClick={() => navigate(`/contacts/${c.id}`)}>
                              <span className="mr-2 text-sm font-medium">{fullName(c)}</span>
                              {u.field
                                ? <DiffLine field={FIELD_LABELS[u.field] ?? u.field} oldValue={u.old_value} newValue={u.new_value ?? ''} />
                                : <span className="text-sm text-muted-foreground">{u.summary}</span>}
                            </div>
                            <div className="flex shrink-0 gap-1.5">
                              <Button variant="outline" size="icon" className="size-8" title="Écarter" onClick={() => decide(u, false)}><X className="size-4" /></Button>
                              <Button size="icon" className="size-8" title="Confirmer" onClick={() => decide(u, true)}><Check className="size-4" /></Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                )}

                {(dueFollowUps.length > 0 || dormants.length > 0) && (
                  <Card className="p-5">
                    <SectionHead title="À relancer" count={totalDue} action={
                      <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => navigate('/contacts?vue=due')}>Tout voir <ArrowRight className="size-3" /></Button>
                    } />
                    <div className="flex flex-col">
                      {dueFollowUps.map(({ f, c }) =>
                        relanceRow(c,
                          <span className="font-medium text-hamber-500">{f.label} · {dayFR(f.due_date)}</span>,
                          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => closeFollowUp(f)}><Check className="size-3.5" /> Fait</Button>,
                          `f-${f.id}`)
                      )}
                      {dormants.filter(({ c }) => !dueFollowUps.some((d) => d.c.id === c.id)).map(({ c, touch }) =>
                        relanceRow(c,
                          <>{relativeFR(touch!.toISOString())}</>,
                          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => markContacted(c)}><Check className="size-3.5" /> Fait</Button>,
                          `d-${c.id}`)
                      )}
                    </div>
                  </Card>
                )}
              </>
            )}

            <Card className="p-5">
              <SectionHead title="Opportunités" action={
                <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => navigate('/opportunites')}>Tout voir <ArrowRight className="size-3" /></Button>
              } />
              {introsLoaded && intros.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {analysis ? 'Toutes les mises en relation proposées ont été traitées.' : 'Aucune analyse pour ce périmètre. Lancez-en une depuis Opportunités pour voir qui présenter à qui.'}
                </p>
              )}
              {intros.length > 0 && (
                <div className="flex flex-col gap-3">
                  {intros.map((i) => (
                    <OpportunityCard key={`${i.from_contact_id}|${i.to_contact_id}`} intro={i} onResolved={loadDecisions} />
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Aside */}
          <div className="flex flex-col gap-4">
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold">Depuis votre dernière visite</h2>
              {recentNotes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune note récente.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {recentNotes.map((n) => {
                    const c = data.contactById.get(n.contact_id);
                    const space = data.spaceById.get(c.space_id);
                    const shared = space?.type !== 'personal';
                    const mine = n.author_id === data.user?.id;
                    return (
                      <div key={n.id} className="flex cursor-pointer gap-2.5" onClick={() => navigate(`/contacts/${c.id}`)}>
                        <Avatar name={fullName(c)} firstName={c.first_name} lastName={c.last_name} photoUrl={c.photo_url} size={24} />
                        <div className="min-w-0">
                          <div className="text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">{fullName(c)}</span>
                            {shared && <> · {mine ? 'vous' : 'un membre'}</>}{' · '}{relativeFR(n.created_at)}
                          </div>
                          <div className="line-clamp-2 text-sm text-foreground/90">{n.content}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
            <div className="flex flex-wrap gap-1.5 px-1 text-xs text-muted-foreground">
              <button className="hover:text-foreground" onClick={() => navigate('/contacts')}>{data.contacts.filter(inSpace).length} contacts</button>
              · <span>{notesThisMonth} notes ce mois</span>
              · <button className="hover:text-foreground" onClick={() => navigate('/contacts?vue=not_enriched')}>{incomplete} fiches incomplètes</button>
            </div>
          </div>
        </div>

        <Dialog open={!!noteFor} onOpenChange={(o) => !o && setNoteFor(null)}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Note sur {fullName(data.contactById.get(noteFor ?? '') ?? {})}</DialogTitle>
            </DialogHeader>
            {noteFor && (
              <NoteComposer contactId={noteFor} contactFirstName={data.contactById.get(noteFor)?.first_name} onSaved={() => setNoteFor(null)} />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};
