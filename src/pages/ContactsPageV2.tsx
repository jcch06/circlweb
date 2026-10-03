import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Sparkles, Trash2, Layers, Tag as TagIcon, Search, Rows3, Share2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { enrichAndPersistContact } from '../lib/mistral';
import { useData } from '../data';
import { useToast } from '../ui/Toast';
import { Avatar, ConfirmModal } from '../ui/Bits';
import { ContactDrawer } from '../ui/ContactDrawer';
import { TagsPanel } from '../ui/TagsPanel';
import { relativeFR, circleColor, type RelStatus } from '../ui/format';
import { queryContacts, type ContactRow, type ViewKey, type SortKey } from '../lib/contactsQuery';
import { cn } from '../lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

// Page Contacts : l'espace de travail central. Table de travail + vues + bulk
// + fiche. Monde Atlas (shadcn), statut relationnel dérivé.

const VIEWS: { key: ViewKey; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'due', label: 'À relancer' },
  { key: 'not_enriched', label: 'Non enrichis' },
];

const STATUS: Record<RelStatus, { label: string; cls: string; dot: string }> = {
  fresh: { label: 'Actif', cls: 'text-hgreen-500', dot: 'bg-hgreen-500' },
  due: { label: 'À relancer', cls: 'text-hamber-500', dot: 'bg-hamber-500' },
  dormant: { label: 'En froid', cls: 'text-hred-500', dot: 'bg-hred-500' },
  never: { label: 'Jamais contacté', cls: 'text-muted-foreground', dot: 'bg-muted-foreground' },
};
const StatusTag: React.FC<{ s: RelStatus }> = ({ s }) => (
  <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium', STATUS[s].cls)}>
    <span className={cn('size-1.5 rounded-full', STATUS[s].dot)} />{STATUS[s].label}
  </span>
);

export const ContactsPageV2: React.FC = () => {
  const data = useData();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const view = (searchParams.get('vue') as ViewKey) || 'all';
  const query = searchParams.get('q') ?? '';
  const statusFilter = searchParams.get('statut') as RelStatus | null;
  const tagFilter = searchParams.get('tag');
  const [sort, setSort] = useState<SortKey>('name');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [confirmEnrich, setConfirmEnrich] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState<{ done: number; total: number } | null>(null);
  const cancelEnrich = useRef(false);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  /* Liste paginée : on ne charge jamais tout le carnet. Page de 100,
     la suivante arrive quand on approche du bas. */
  const PAGE = 100;
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<RelStatus, number>>({ fresh: 0, due: 0, dormant: 0, never: 0 });
  const [loading, setLoading] = useState(true);
  const [debouncedQ, setDebouncedQ] = useState(query);
  const reqId = useRef(0);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const t = setTimeout(() => setDebouncedQ(query), 200); return () => clearTimeout(t); }, [query]);

  const load = async (offset: number) => {
    const id = ++reqId.current;
    setLoading(true);
    const page = await queryContacts(
      { q: debouncedQ, view, status: statusFilter, tagId: tagFilter, spaceId: data.selectedSpaceId, sort, offset, limit: PAGE },
      { contacts: data.contacts, lastNoteByContact: data.lastNoteByContact, tagsByContact: data.tagsByContact,
        spaceById: data.spaceById, followUpsByContact: data.followUpsByContact, pendingByContact: data.pendingByContact },
    );
    if (id !== reqId.current) return; // une requête plus récente a été lancée
    setRows((prev) => (offset === 0 ? page.rows : [...prev, ...page.rows]));
    setTotal(page.total);
    setCounts(page.counts);
    setLoading(false);
  };

  useEffect(() => { load(0); }, [debouncedQ, view, statusFilter, tagFilter, sort, data.selectedSpaceId, data.contacts, data.lastNoteByContact]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !loading && rows.length < total) load(rows.length);
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [rows.length, total, loading]);

  const siblingIds = useMemo(() => rows.map((r) => r.c.id), [rows]);
  const nbSel = selected.size;

  const toggleSelect = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const bulkDelete = async () => {
    setBulkBusy(true);
    const ids = [...selected];
    const { error } = await supabase.from('contacts').delete().in('id', ids);
    setBulkBusy(false); setConfirmBulkDelete(false);
    if (error) { toast(`Suppression impossible : ${error.message}`); return; }
    setSelected(new Set());
    toast(`${ids.length} contact${ids.length > 1 ? 's' : ''} supprimé${ids.length > 1 ? 's' : ''}.`);
    await data.refresh();
  };
  const bulkMoveCircle = async (spaceId: string) => {
    const ids = [...selected];
    const { error } = await supabase.from('contacts').update({ space_id: spaceId }).in('id', ids);
    if (error) { toast(`Déplacement impossible : ${error.message}`); return; }
    setSelected(new Set());
    toast(`${ids.length} contact${ids.length > 1 ? 's' : ''} déplacé${ids.length > 1 ? 's' : ''}.`);
    await data.refresh();
  };
  const bulkTag = async (tagId: string) => {
    const ids = [...selected];
    const already = new Set(data.contactTags.filter((ct) => ct.tag_id === tagId).map((ct) => ct.contact_id));
    const rowsToInsert = ids.filter((id) => !already.has(id)).map((contact_id) => ({ contact_id, tag_id: tagId, tagged_by: data.user?.id }));
    if (rowsToInsert.length === 0) { toast('Tag déjà appliqué à toute la sélection.'); return; }
    const { error } = await supabase.from('contact_tags').insert(rowsToInsert);
    if (error) { toast(`Tag impossible : ${error.message}`); return; }
    setSelected(new Set());
    toast(`Tag appliqué à ${rowsToInsert.length} contact${rowsToInsert.length > 1 ? 's' : ''}.`);
    await data.refresh();
  };
  const bulkEnrich = async () => {
    setConfirmEnrich(false);
    const ids = [...selected];
    cancelEnrich.current = false;
    setEnrichProgress({ done: 0, total: ids.length });
    let ok = 0;
    for (const id of ids) {
      if (cancelEnrich.current) break;
      try {
        const c = data.contactById.get(id);
        if (c) {
          await enrichAndPersistContact({ id, first_name: c.first_name, last_name: c.last_name, company: c.company, job_title: c.job_title, industry: c.industry, bio: c.bio, ai_context: c.ai_context, location: c.location });
          ok++;
        }
      } catch { /* un échec n'arrête pas le lot */ }
      setEnrichProgress((p) => (p ? { ...p, done: p.done + 1 } : null));
    }
    setEnrichProgress(null);
    setSelected(new Set());
    toast(cancelEnrich.current
      ? `Enrichissement interrompu. ${ok} fiche${ok > 1 ? 's' : ''} complétée${ok > 1 ? 's' : ''}.`
      : `${ok} fiche${ok > 1 ? 's' : ''} enrichie${ok > 1 ? 's' : ''} sur ${ids.length}.`);
    await data.refresh();
  };

  const statusOrder: RelStatus[] = ['fresh', 'due', 'dormant', 'never'];

  return (
    <div className="relative flex h-full flex-col">
      {/* En-tête */}
      <div className="px-7 pt-6">
        <div className="mb-3.5 flex flex-wrap items-center gap-3">
          <span className="text-sm tabular-nums text-muted-foreground">{total.toLocaleString('fr-FR')} contact{total > 1 ? 's' : ''}</span>
          <div className="flex rounded-lg bg-muted p-0.5">
            <button className="rounded-md bg-card px-3 py-1 text-xs font-medium shadow-sm"><Rows3 className="mr-1.5 inline size-3.5" />Table</button>
            <button className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => navigate(`/reseau${window.location.search}`)}><Share2 className="mr-1.5 inline size-3.5" />Réseau</button>
          </div>
          <span className="flex-1" />
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="w-64 pl-9" placeholder="Rechercher" value={query} onChange={(e) => setParam('q', e.target.value)} />
          </div>
          <Button variant="outline" onClick={() => setShowImport(true)}>Importer</Button>
          <Button onClick={() => setShowCreate(true)}><Plus className="size-4" /> Nouveau contact</Button>
        </div>

        {/* Vues + filtres */}
        <div className="flex flex-wrap items-center gap-2 pb-3">
          {VIEWS.map((v) => (
            <Button key={v.key} variant={view === v.key ? 'secondary' : 'ghost'} size="sm" className="h-7 text-xs"
              onClick={() => setParam('vue', v.key === 'all' ? null : v.key)}>{v.label}</Button>
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          {statusOrder.map((s) => (
            <Button key={s} variant={statusFilter === s ? 'secondary' : 'ghost'} size="sm" className="h-7 gap-1.5 text-xs"
              onClick={() => setParam('statut', statusFilter === s ? null : s)}>
              <span className={cn('size-1.5 rounded-full', STATUS[s].dot)} />{STATUS[s].label}
              <span className="tabular-nums text-muted-foreground">{counts[s]}</span>
            </Button>
          ))}
          <span className="flex-1" />
          {tagFilter && (
            <Button variant="secondary" size="sm" className="h-7 text-xs" onClick={() => setParam('tag', null)}>
              tag : {data.tags.find((t) => t.id === tagFilter)?.name ?? '?'} ✕
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => setShowTags(true)}>Gérer les tags</Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-7 pb-24">
        {!loading && total === 0 ? (
          <EmptyContacts hasQuery={!!query || view !== 'all' || !!statusFilter} onCreate={() => setShowCreate(true)} onImport={() => setShowImport(true)} />
        ) : (
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10" />
                  <TableHead className="cursor-pointer" onClick={() => setSort('name')}>Nom</TableHead>
                  <TableHead className="cursor-pointer" onClick={() => setSort('company')}>Poste & entreprise</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="cursor-pointer" onClick={() => setSort('last')}>Dernier échange</TableHead>
                  <TableHead>Tags</TableHead>
                  {!data.selectedSpaceId && <TableHead>Cercle</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ c, name, touch, status, tags, space, pendingCount }) => (
                  <TableRow key={c.id} data-state={selected.has(c.id) ? 'selected' : undefined}
                    className="cursor-pointer" onClick={() => navigate(`/contacts/${c.id}${window.location.search}`)}>
                    <TableCell onClick={(e) => { e.stopPropagation(); toggleSelect(c.id); }}>
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => {}} className="size-4 cursor-pointer accent-foreground" />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={name} firstName={c.first_name} lastName={c.last_name} photoUrl={c.photo_url} size={32} />
                        <span className="max-w-[220px] truncate font-medium">{name}</span>
                        {c.enriched_at && <Sparkles className="size-3 text-muted-foreground" aria-label="Fiche enrichie" />}
                        {pendingCount > 0 && <span className="rounded-md bg-primary px-1.5 text-[10px] font-semibold tabular-nums text-primary-foreground">{pendingCount}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      <span className="block truncate text-muted-foreground">{[c.job_title, c.company].filter(Boolean).join(' · ') || '·'}</span>
                    </TableCell>
                    <TableCell><StatusTag s={status} /></TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{touch ? relativeFR(touch.toISOString()) : 'jamais'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {tags.slice(0, 2).map((t: any) => (
                          <Badge key={t.id} variant="secondary" className="font-normal"
                            style={t.color_hex ? { background: `${t.color_hex}1F`, color: t.color_hex } : undefined}>{t.name}</Badge>
                        ))}
                        {tags.length > 2 && <span className="text-xs text-muted-foreground">+{tags.length - 2}</span>}
                      </div>
                    </TableCell>
                    {!data.selectedSpaceId && (
                      <TableCell>
                        {space && (
                          <Badge variant="outline" className="gap-1.5 font-normal">
                            <span className="size-1.5 rounded-full" style={{ background: circleColor(space) }} />{space.name}
                          </Badge>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {rows.length < total && (
              <div className="px-5 py-3 text-center text-xs text-muted-foreground">Chargement de la suite…</div>
            )}
          </Card>
        )}
        <div ref={sentinelRef} className="h-px" />
      </div>

      {/* Barre de sélection */}
      {nbSel > 0 && (
        <div className="absolute bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-foreground px-3 py-2 text-background shadow-lg">
          <span className="px-1 text-sm font-semibold tabular-nums">{nbSel} sélectionné{nbSel > 1 ? 's' : ''}</span>
          <span className="h-4 w-px bg-background/25" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-8 gap-1.5 text-background hover:bg-background/15 hover:text-background"><Layers className="size-4" /> Cercle</Button></DropdownMenuTrigger>
            <DropdownMenuContent side="top">
              {data.spaces.map((s) => (
                <DropdownMenuItem key={s.id} onClick={() => bulkMoveCircle(s.id)}>
                  <span className="size-2 rounded-full" style={{ background: circleColor(s) }} />{s.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-8 gap-1.5 text-background hover:bg-background/15 hover:text-background"><TagIcon className="size-4" /> Tag</Button></DropdownMenuTrigger>
            <DropdownMenuContent side="top" className="max-h-64 overflow-y-auto">
              {data.tags.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">Aucun tag.</div>}
              {data.tags.map((t) => (
                <DropdownMenuItem key={t.id} onClick={() => bulkTag(t.id)}>
                  <span className="size-2 rounded-full" style={{ background: t.color_hex ?? 'hsl(var(--muted-foreground))' }} />{t.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-background hover:bg-background/15 hover:text-background" onClick={() => setConfirmEnrich(true)}><Sparkles className="size-4" /> Enrichir</Button>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-hred-500 hover:bg-background/15 hover:text-hred-500" onClick={() => setConfirmBulkDelete(true)}><Trash2 className="size-4" /> Supprimer</Button>
          <span className="h-4 w-px bg-background/25" />
          <Button variant="ghost" size="sm" className="h-8 text-background hover:bg-background/15 hover:text-background" onClick={() => setSelected(new Set())}>Annuler</Button>
        </div>
      )}

      {params.id && (
        <ContactDrawer contactId={params.id} siblings={siblingIds}
          onClose={() => navigate(`/contacts${window.location.search}`)}
          onNavigate={(id) => navigate(`/contacts/${id}${window.location.search}`)} />
      )}

      {confirmBulkDelete && (
        <ConfirmModal title={`Supprimer ${nbSel} contact${nbSel > 1 ? 's' : ''} ?`}
          body="Cette suppression est définitive et emporte les notes, liens, mises à jour et relances rattachés à chaque fiche."
          confirmLabel="Supprimer définitivement" danger busy={bulkBusy} onConfirm={bulkDelete} onCancel={() => setConfirmBulkDelete(false)} />
      )}
      {confirmEnrich && (
        <ConfirmModal title={`Enrichir ${nbSel} fiche${nbSel > 1 ? 's' : ''} via l'IA ?`}
          body={<>L'IA cherchera poste, entreprise et contexte pour chaque contact sélectionné. Durée estimée : environ <b className="tabular-nums">{Math.ceil(nbSel * 1.5)} secondes</b>. Vous pourrez interrompre en cours de route.</>}
          confirmLabel="Lancer l'enrichissement" onConfirm={bulkEnrich} onCancel={() => setConfirmEnrich(false)} />
      )}
      {enrichProgress && (
        <div className="absolute bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-foreground px-3 py-2 text-background shadow-lg">
          <span className="text-sm tabular-nums">Enrichissement… {enrichProgress.done}/{enrichProgress.total}</span>
          <span className="h-4 w-px bg-background/25" />
          <Button variant="ghost" size="sm" className="h-8 text-background hover:bg-background/15 hover:text-background" onClick={() => { cancelEnrich.current = true; }}>Interrompre</Button>
        </div>
      )}

      {showCreate && <CreateContactModal onClose={() => setShowCreate(false)} />}
      {showImport && <ImportContactsModal onClose={() => setShowImport(false)} />}
      {showTags && <TagsPanel onClose={() => setShowTags(false)} onFilterTag={(tagId) => setParam('tag', tagId)} />}
    </div>
  );
};

/* État vide. */
const EmptyContacts: React.FC<{ hasQuery: boolean; onCreate: () => void; onImport: () => void }> = ({ hasQuery, onCreate, onImport }) => {
  if (hasQuery) {
    return (
      <Card className="px-5 py-12 text-center">
        <div className="text-base font-semibold">Personne ne correspond</div>
        <p className="mt-1 text-sm text-muted-foreground">Élargissez la recherche ou changez de vue.</p>
      </Card>
    );
  }
  return (
    <Card className="px-5 py-12 text-center">
      <div className="text-base font-semibold">Votre réseau commence ici</div>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Importez vos contacts, ou ajoutez une première fiche à la main.</p>
      <div className="mt-4 flex justify-center gap-2.5">
        <Button onClick={onImport}>Importer des contacts</Button>
        <Button variant="outline" onClick={onCreate}><Plus className="size-4" /> Nouveau contact</Button>
      </div>
    </Card>
  );
};

const CIRCLE_FIELD = 'space_id';

/* Création rapide. */
const CreateContactModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const data = useData();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ first_name: '', last_name: '', company: '', job_title: '', email: '', phone: '' });
  const personal = data.spaces.find((s) => s.type === 'personal');
  const [spaceId, setSpaceId] = useState<string>(data.selectedSpaceId ?? personal?.id ?? data.spaces[0]?.id ?? '');
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.first_name.trim() || !spaceId) return;
    setBusy(true);
    const { data: created, error } = await supabase.from('contacts').insert({
      [CIRCLE_FIELD]: spaceId, owner_id: data.user?.id,
      first_name: form.first_name.trim(), last_name: form.last_name.trim(),
      company: form.company.trim() || null, job_title: form.job_title.trim() || null,
      email: form.email.trim() || null, phone: form.phone.trim() || null, source: 'manual',
    }).select('id').single();
    setBusy(false);
    if (error) { toast(`Création impossible : ${error.message}`); return; }
    onClose();
    toast(`${form.first_name} ajouté.`);
    await data.refresh();
    if (created) navigate(`/contacts/${created.id}`);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Nouveau contact</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-2.5">
          <Input placeholder="Prénom" autoFocus value={form.first_name} onChange={(e) => set('first_name', e.target.value)} />
          <Input placeholder="Nom" value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />
          <Input placeholder="Poste" value={form.job_title} onChange={(e) => set('job_title', e.target.value)} />
          <Input placeholder="Entreprise" value={form.company} onChange={(e) => set('company', e.target.value)} />
          <Input placeholder="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          <Input placeholder="Téléphone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cercle</span>
          {data.spaces.map((s) => (
            <Button key={s.id} variant={spaceId === s.id ? 'secondary' : 'ghost'} size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setSpaceId(s.id)}>
              <span className="size-1.5 rounded-full" style={{ background: circleColor(s) }} />{s.name}
            </Button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button disabled={!form.first_name.trim() || busy} onClick={save}>{busy ? 'Création…' : 'Créer la fiche'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* Import en masse : coller un texte, parse-contacts-from-text, confirmer. */
const ImportContactsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const data = useData();
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState<any[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const personal = data.spaces.find((s) => s.type === 'personal');
  const [spaceId, setSpaceId] = useState<string>(data.selectedSpaceId ?? personal?.id ?? data.spaces[0]?.id ?? '');

  const parse = async () => {
    if (text.trim().length < 10) return;
    setBusy(true);
    const res: any = await supabase.functions.invoke('parse-contacts-from-text', { body: { text } });
    setBusy(false);
    if (res.error) { toast(`Analyse impossible : ${res.error.message}`); return; }
    const list = (res.data?.contacts ?? []).filter((c: any) => c.first_name || c.last_name);
    if (list.length === 0) { toast('Aucun contact détecté dans ce texte.'); return; }
    setParsed(list);
    setSelected(new Set(list.map((_: any, i: number) => i)));
  };
  const importSelected = async () => {
    if (!spaceId || !parsed) return;
    const rows = parsed.filter((_, i) => selected.has(i)).map((c: any) => ({
      space_id: spaceId, owner_id: data.user?.id,
      first_name: (c.first_name || c.last_name || '').trim(),
      last_name: (c.first_name ? (c.last_name || '') : '').trim() || null,
      company: c.company?.trim() || null, job_title: c.job_title?.trim() || null,
      email: c.email?.trim() || null, phone: c.phone?.trim() || null,
      linkedin: c.linkedin?.trim() || null, location: c.location?.trim() || null,
      industry: c.industry?.trim() || null, source: 'import',
    })).filter((r) => r.first_name);
    if (rows.length === 0) return;
    setBusy(true);
    const { error } = await supabase.from('contacts').insert(rows);
    setBusy(false);
    if (error) { toast(`Import impossible : ${error.message}`); return; }
    onClose();
    toast(`${rows.length} contact${rows.length > 1 ? 's' : ''} importé${rows.length > 1 ? 's' : ''}.`);
    await data.refresh();
  };
  const toggle = (i: number) => setSelected((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[86vh] flex-col sm:max-w-xl">
        <DialogHeader><DialogTitle>Importer des contacts</DialogTitle></DialogHeader>
        {!parsed ? (
          <>
            <p className="text-sm text-muted-foreground">Collez n'importe quel texte contenant des contacts : signatures d'email, liste de participants, notes de réunion. L'IA en extrait les fiches, vous validez avant l'ajout.</p>
            <textarea className="min-h-[200px] w-full resize-y rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
              autoFocus placeholder={"Jean Dupont, Directeur commercial chez Acme\njean.dupont@acme.com — +33 6 12 34 56 78"} value={text} onChange={(e) => setText(e.target.value)} />
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Annuler</Button>
              <Button disabled={text.trim().length < 10 || busy} onClick={parse}>{busy ? 'Analyse…' : 'Analyser le texte'}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{parsed.length} contact{parsed.length > 1 ? 's' : ''} détecté{parsed.length > 1 ? 's' : ''}. Décochez ceux à écarter.</p>
            <div className="-mx-1 flex-1 overflow-y-auto pr-1">
              {parsed.map((c: any, i: number) => (
                <label key={i} className="flex cursor-pointer items-center gap-3 border-b border-border px-1.5 py-2.5 last:border-0">
                  <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} className="size-4 accent-foreground" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{[c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[[c.job_title, c.company].filter(Boolean).join(' · '), c.email].filter(Boolean).join(' — ') || 'aucun détail'}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cercle</span>
              {data.spaces.map((s) => (
                <Button key={s.id} variant={spaceId === s.id ? 'secondary' : 'ghost'} size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setSpaceId(s.id)}>
                  <span className="size-1.5 rounded-full" style={{ background: circleColor(s) }} />{s.name}
                </Button>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setParsed(null)}>Retour</Button>
              <Button disabled={selected.size === 0 || !spaceId || busy} onClick={importSelected}>{busy ? 'Import…' : `Importer ${selected.size}`}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
