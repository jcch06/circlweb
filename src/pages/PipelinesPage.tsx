import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useData } from '../data';
import { useToast } from '../ui/Toast';
import { Avatar } from '../ui/Bits';
import { ContactDrawer } from '../ui/ContactDrawer';
import { fullName, lastTouch, relStatus, relativeFR } from '../ui/format';
import { IS_MOCK } from '../lib/mode';
import { cn } from '../lib/utils';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

// Pipelines : des tableaux de contacts rangés par étapes (prospection, levée,
// recrutement…). Glisser une carte d'une colonne à l'autre change l'étape.
// Mises à jour optimistes, persistées dans pipeline_items (retour arrière si
// l'écriture échoue).

const DEFAULT_STAGES: { name: string; tone: string }[] = [
  { name: 'À contacter', tone: 'neutral' },
  { name: 'Contacté', tone: 'neutral' },
  { name: 'En discussion', tone: 'progress' },
  { name: 'Proposition', tone: 'progress' },
  { name: 'Gagné', tone: 'won' },
  { name: 'Perdu', tone: 'lost' },
];
const TONE_DOT: Record<string, string> = {
  neutral: 'bg-muted-foreground/60',
  progress: 'bg-foreground',
  won: 'bg-[hsl(var(--h-green-500))]',
  lost: 'bg-[hsl(var(--h-red-500))]',
};
const STATUS_DOT: Record<string, string> = {
  fresh: 'bg-[hsl(var(--h-green-500))]',
  due: 'bg-[hsl(var(--h-amber-500))]',
  dormant: 'bg-[hsl(var(--h-red-500))]',
  never: 'bg-muted-foreground/50',
};

export const PipelinesPage: React.FC = () => {
  const data = useData();
  const { toast } = useToast();
  const [pipelines, setPipelines] = useState<any[]>(data.pipelines);
  const [stagesAll, setStagesAll] = useState<any[]>(data.pipelineStages);
  const [items, setItems] = useState<any[]>(data.pipelineItems);
  const [pipelineId, setPipelineId] = useState<string | null>(data.pipelines[0]?.id ?? null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addStage, setAddStage] = useState<string | null>(null);
  const [addQuery, setAddQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const dragId = useRef<string | null>(null);

  // Resynchronise avec les données serveur après chaque rafraîchissement.
  useEffect(() => { setPipelines(data.pipelines); }, [data.pipelines]);
  useEffect(() => { setStagesAll(data.pipelineStages); }, [data.pipelineStages]);
  useEffect(() => { setItems(data.pipelineItems); }, [data.pipelineItems]);
  useEffect(() => {
    if (!pipelineId || !pipelines.some((p) => p.id === pipelineId)) setPipelineId(pipelines[0]?.id ?? null);
  }, [pipelines, pipelineId]);

  const stages = useMemo(
    () => stagesAll.filter((s) => s.pipeline_id === pipelineId).sort((a, b) => a.position - b.position),
    [stagesAll, pipelineId]
  );
  const pipelineItems = useMemo(() => items.filter((i) => i.pipeline_id === pipelineId), [items, pipelineId]);
  const byStage = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const s of stages) m.set(s.id, []);
    for (const it of pipelineItems) m.get(it.stage_id)?.push(it);
    for (const arr of m.values()) arr.sort((a, b) => a.position - b.position);
    return m;
  }, [stages, pipelineItems]);

  const moveTo = async (itemId: string, stageId: string) => {
    const it = items.find((i) => i.id === itemId);
    if (!it || it.stage_id === stageId) return;
    const before = items;
    const position = byStage.get(stageId)?.length ?? 0;
    const updated_at = new Date().toISOString();
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, stage_id: stageId, position, updated_at } : i)));
    const stage = stages.find((s) => s.id === stageId);
    const c = data.contactById.get(it.contact_id);
    if (!IS_MOCK) {
      const { error } = await supabase.from('pipeline_items').update({ stage_id: stageId, position, updated_at }).eq('id', itemId);
      if (error) { setItems(before); toast(`Déplacement impossible : ${error.message}`); return; }
    }
    toast(`${c ? c.first_name : 'Contact'} → ${stage?.name}`);
  };

  const inPipeline = useMemo(() => new Set(pipelineItems.map((i) => i.contact_id)), [pipelineItems]);
  const candidates = useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    return data.contacts
      .filter((c) => !inPipeline.has(c.id))
      .filter((c) => !q || fullName(c).toLowerCase().includes(q) || (c.company ?? '').toLowerCase().includes(q))
      .slice(0, 30);
  }, [data.contacts, inPipeline, addQuery]);

  const addContact = async (contactId: string) => {
    const target = addStage ?? stages[0]?.id;
    if (!target || !pipelineId) return;
    const position = byStage.get(target)?.length ?? 0;
    setAddOpen(false); setAddQuery('');
    const c = data.contactById.get(contactId);
    if (IS_MOCK) {
      setItems((prev) => [...prev, { id: `pi-${Date.now()}`, pipeline_id: pipelineId, stage_id: target, contact_id: contactId, position, updated_at: new Date().toISOString() }]);
    } else {
      const { data: row, error } = await supabase.from('pipeline_items')
        .insert({ pipeline_id: pipelineId, stage_id: target, contact_id: contactId, position })
        .select('*').single();
      if (error) { toast(`Ajout impossible : ${error.message}`); return; }
      setItems((prev) => [...prev, row]);
    }
    toast(`${c ? fullName(c) : 'Contact'} ajouté au pipeline.`);
  };

  // Un pipeline vit dans un cercle : le cercle sélectionné, sinon le personnel.
  const createPipeline = async () => {
    const name = newName.trim();
    if (!name) return;
    const spaceId = data.selectedSpaceId ?? data.spaces.find((s) => s.type === 'personal')?.id ?? data.spaces[0]?.id;
    if (!spaceId) { toast('Aucun cercle disponible.'); return; }
    setCreating(true);
    if (IS_MOCK) {
      const pid = `p-${Date.now()}`;
      setPipelines((prev) => [...prev, { id: pid, name, space_id: spaceId, position: prev.length }]);
      setStagesAll((prev) => [...prev, ...DEFAULT_STAGES.map((s, i) => ({ id: `${pid}-s${i}`, pipeline_id: pid, name: s.name, tone: s.tone, position: i }))]);
      setPipelineId(pid);
    } else {
      const { data: p, error } = await supabase.from('pipelines')
        .insert({ name, space_id: spaceId, position: pipelines.length }).select('*').single();
      if (error || !p) { setCreating(false); toast(`Création impossible : ${error?.message ?? 'erreur'}`); return; }
      const { data: st, error: e2 } = await supabase.from('pipeline_stages')
        .insert(DEFAULT_STAGES.map((s, i) => ({ pipeline_id: p.id, name: s.name, tone: s.tone, position: i }))).select('*');
      if (e2) { setCreating(false); toast(`Étapes non créées : ${e2.message}`); return; }
      setPipelines((prev) => [...prev, p]);
      setStagesAll((prev) => [...prev, ...(st ?? [])]);
      setPipelineId(p.id);
    }
    setCreating(false); setCreateOpen(false); setNewName('');
    toast(`Pipeline « ${name} » créé.`);
  };

  const createDialog = (
    <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) setNewName(''); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Nouveau pipeline</DialogTitle></DialogHeader>
        <Input autoFocus placeholder="Prospection, levée de fonds, recrutement…" value={newName}
          onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createPipeline(); }} />
        <p className="text-xs text-muted-foreground">Étapes créées : {DEFAULT_STAGES.map((s) => s.name).join(', ')}.</p>
        <DialogFooter>
          <button className="rounded-md px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted" onClick={() => setCreateOpen(false)}>Annuler</button>
          <button disabled={!newName.trim() || creating} onClick={createPipeline}
            className="rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground disabled:opacity-40">
            {creating ? 'Création…' : 'Créer'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (pipelines.length === 0) {
    return (
      <div className="grid h-full place-items-center p-10">
        <div className="max-w-sm text-center">
          <div className="text-[15px] font-semibold">Aucun pipeline pour l'instant</div>
          <p className="mt-1.5 text-[13px] text-muted-foreground">Un pipeline range vos contacts par étapes : prospection, levée de fonds, recrutement. Vous suivez qui vous avez contacté, quand et où vous en êtes.</p>
          <button onClick={() => setCreateOpen(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground">
            <Plus size={14} /> Créer un pipeline
          </button>
        </div>
        {createDialog}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 px-6 pb-3 pt-5">
        {pipelines.map((p) => {
          const n = items.filter((i) => i.pipeline_id === p.id).length;
          return (
            <button key={p.id} onClick={() => setPipelineId(p.id)}
              className={cn('rounded-md px-3 py-1.5 text-[13px] transition-colors',
                p.id === pipelineId ? 'bg-secondary font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
              {p.name} <span className="ml-1 text-xs text-muted-foreground">{n}</span>
            </button>
          );
        })}
        <button onClick={() => setCreateOpen(true)} title="Nouveau pipeline"
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><Plus size={14} /></button>
        <span className="flex-1" />
        <button onClick={() => { setAddStage(null); setAddOpen(true); }}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:opacity-90">
          <Plus size={14} /> Ajouter un contact
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-x-auto px-6 pb-6">
        <div className="flex min-w-max items-start gap-3">
          {stages.map((s) => {
            const col = byStage.get(s.id) ?? [];
            const over = overStage === s.id;
            return (
              <div key={s.id} className="flex w-[268px] shrink-0 flex-col">
                <div className="mb-2 flex items-center gap-2 px-1">
                  <span className={cn('size-2 rounded-full', TONE_DOT[s.tone] ?? TONE_DOT.neutral)} />
                  <span className="text-[13px] font-medium">{s.name}</span>
                  <span className="text-xs text-muted-foreground">{col.length}</span>
                  <span className="flex-1" />
                  <button onClick={() => { setAddStage(s.id); setAddOpen(true); }} title="Ajouter dans cette étape"
                    className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><Plus size={13} /></button>
                </div>
                <div
                  onDragOver={(e) => { e.preventDefault(); setOverStage(s.id); }}
                  onDragLeave={() => setOverStage((cur) => (cur === s.id ? null : cur))}
                  onDrop={(e) => { e.preventDefault(); setOverStage(null); if (dragId.current) moveTo(dragId.current, s.id); dragId.current = null; }}
                  className={cn('flex min-h-[140px] flex-col gap-1.5 rounded-xl p-1.5 transition-colors',
                    over ? 'bg-secondary ring-1 ring-foreground/15' : 'bg-muted/60')}>
                  {col.length === 0 && (
                    <div className="grid flex-1 place-items-center rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">Glissez un contact ici</div>
                  )}
                  {col.map((it) => {
                    const c = data.contactById.get(it.contact_id);
                    if (!c) return null;
                    const st = relStatus(lastTouch(c, data.lastNoteByContact.get(c.id)));
                    const tags = data.tagsByContact.get(c.id) ?? [];
                    return (
                      <div key={it.id} draggable
                        onDragStart={() => { dragId.current = it.id; }}
                        onClick={() => setDrawerId(c.id)}
                        className="cursor-grab rounded-lg border bg-card p-3 transition-colors hover:border-foreground/20 active:cursor-grabbing">
                        <div className="flex items-center gap-2">
                          <Avatar name={fullName(c)} firstName={c.first_name} lastName={c.last_name} photoUrl={c.photo_url} size={24} />
                          <span className="truncate text-[13px] font-medium">{fullName(c)}</span>
                        </div>
                        {(c.job_title || c.company) && (
                          <div className="mt-1.5 truncate text-xs text-muted-foreground">{[c.job_title, c.company].filter(Boolean).join(' · ')}</div>
                        )}
                        {tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {tags.slice(0, 3).map((t: any) => (
                              <span key={t.id} className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">{t.name}</span>
                            ))}
                          </div>
                        )}
                        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className={cn('size-1.5 rounded-full', STATUS_DOT[st])} />
                          Bougé {relativeFR(it.updated_at)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) setAddQuery(''); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Ajouter un contact{addStage ? ` · ${stages.find((s) => s.id === addStage)?.name}` : ''}</DialogTitle></DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus className="pl-9" placeholder="Nom ou entreprise" value={addQuery} onChange={(e) => setAddQuery(e.target.value)} />
          </div>
          <div className="-mx-2 max-h-80 overflow-y-auto">
            {candidates.length === 0 && <div className="px-2 py-6 text-center text-[13px] text-muted-foreground">Personne ne correspond.</div>}
            {candidates.map((c) => (
              <button key={c.id} onClick={() => addContact(c.id)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-muted">
                <Avatar name={fullName(c)} firstName={c.first_name} lastName={c.last_name} photoUrl={c.photo_url} size={24} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{fullName(c)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{[c.job_title, c.company].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {createDialog}

      {drawerId && (
        <ContactDrawer contactId={drawerId} siblings={pipelineItems.map((i) => i.contact_id)}
          onClose={() => setDrawerId(null)} onNavigate={(id) => setDrawerId(id)} />
      )}
    </div>
  );
};
