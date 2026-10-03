import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Mail, Phone, Link2, ArrowLeft, Lock, Sparkles, MoreHorizontal, Trash2, Search, Columns3, Check, Share2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { enrichAndPersistContact } from '../lib/mistral';
import { useData } from '../data';
import { useToast } from './Toast';
import { Avatar, DiffLine } from './Bits';
import { NoteComposer } from './NoteComposer';
import { Timeline } from './Timeline';
import { fullName, lastTouch, relStatus, relativeFR, circleColor } from './format';
import { IS_MOCK } from '../lib/mode';
import { BuyCredits } from './BuyCredits';
import { cn } from '../lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

// La fiche contact, unique dans toute l'app. Panneau large façon Folk :
// propriétés à gauche (éditables en place, recherche d'email/téléphone au
// crédit), activité à droite (note rapide, mises à jour, historique).
// Échap ferme, ↑/↓ change de contact, pile interne pour les rebonds.

const FIELD_LABELS: Record<string, string> = {
  company: 'Entreprise', job_title: 'Poste', industry: 'Secteur',
  location: 'Lieu', linkedin: 'LinkedIn', bio: 'Bio',
};
const STATUS: Record<string, { label: string; dot: string }> = {
  fresh: { label: 'Actif', dot: 'bg-[hsl(var(--h-green-500))]' },
  due: { label: 'À relancer', dot: 'bg-[hsl(var(--h-amber-500))]' },
  dormant: { label: 'En froid', dot: 'bg-[hsl(var(--h-red-500))]' },
  never: { label: 'Jamais contacté', dot: 'bg-muted-foreground/50' },
};
// Coût indicatif d'une recherche FullEnrich (waterfall), revendue au crédit.
const COST = { email: 1, phone: 10 };

/* Propriété éditable en place : clic → champ, Entrée/blur enregistre, Échap annule. */
const Prop: React.FC<{
  label: string; value?: string | null; placeholder?: string; disabled?: boolean;
  onSave?: (v: string) => void; children?: React.ReactNode;
}> = ({ label, value, placeholder = 'Ajouter', disabled, onSave, children }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  const commit = () => { setEditing(false); if (draft.trim() !== (value ?? '').trim()) onSave?.(draft.trim()); };
  return (
    <div className="flex min-h-[30px] items-start gap-3 py-1">
      <span className="w-[86px] shrink-0 pt-1 text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">
        {children ? children : editing ? (
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false); } }}
            className="w-full rounded-md border bg-card px-2 py-1 text-[13px] outline-none focus:border-foreground/25" />
        ) : (
          <button disabled={disabled || !onSave} onClick={() => setEditing(true)}
            className={cn('w-full whitespace-normal break-words rounded-md px-2 py-1 text-left text-[13px] leading-snug -ml-2', onSave && !disabled && 'hover:bg-muted',
              !value && 'text-muted-foreground/70')}>
            {value || placeholder}
          </button>
        )}
      </div>
    </div>
  );
};

export const ContactDrawer: React.FC<{
  contactId: string;
  siblings?: string[];
  onClose: () => void;
  onNavigate: (id: string) => void;
}> = ({ contactId, siblings, onClose, onNavigate }) => {
  const data = useData();
  const { toast } = useToast();
  const [stack, setStack] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [finding, setFinding] = useState<null | 'email' | 'phone'>(null);
  const [overrides, setOverrides] = useState<Record<string, Record<string, any>>>({});
  const [credits, setCredits] = useState(25);
  const [buyOpen, setBuyOpen] = useState(false);

  // Solde réel (créé à 25 crédits offerts au premier usage côté serveur).
  useEffect(() => {
    if (IS_MOCK || !data.user?.id) return;
    supabase.from('enrichment_credits').select('balance').eq('user_id', data.user.id).maybeSingle()
      .then(({ data: row }) => setCredits(row?.balance ?? 25));
  }, [data.user?.id]);

  const base = data.contactById.get(contactId);
  const contact = base ? { ...base, ...(overrides[contactId] ?? {}) } : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') return;
      // Une fenêtre ouverte par-dessus la fiche (crédits, suppression…) garde ses touches.
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      if (e.key === 'Escape') {
        if (stack.length > 0) { const prev = stack[stack.length - 1]; setStack((s) => s.slice(0, -1)); onNavigate(prev); }
        else onClose();
      }
      if (siblings && siblings.length > 1 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const idx = siblings.indexOf(contactId);
        if (idx === -1) return;
        e.preventDefault();
        const next = e.key === 'ArrowDown' ? siblings[Math.min(siblings.length - 1, idx + 1)] : siblings[Math.max(0, idx - 1)];
        if (next !== contactId) { setStack([]); onNavigate(next); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [contactId, siblings, stack, onClose, onNavigate]);

  const pending = data.pendingByContact.get(contactId) ?? [];
  const links = useMemo(() => {
    const seen = new Set<string>(); const out: any[] = [];
    for (const l of data.linksByContact.get(contactId) ?? []) {
      const otherId = l.from_contact_id === contactId ? l.to_contact_id : l.from_contact_id;
      if (seen.has(otherId)) continue; seen.add(otherId);
      const other = data.contactById.get(otherId); if (other) out.push(other);
    }
    return out;
  }, [data.linksByContact, data.contactById, contactId]);
  const memberships = useMemo(() => data.pipelineItems.filter((i) => i.contact_id === contactId).map((i) => ({
    item: i, pipeline: data.pipelines.find((p) => p.id === i.pipeline_id), stage: data.pipelineStages.find((s) => s.id === i.stage_id),
  })), [data.pipelineItems, data.pipelines, data.pipelineStages, contactId]);

  // Suivi LinkedIn (cron quotidien) : lu sur la fiche brute, absent de la vue masquée.
  // null = selon les tags VIP / À suivre ; true / false = choix explicite, prioritaire.
  const [followLinkedin, setFollowLinkedin] = useState<boolean | null>(null);
  // Droit de modifier la fiche (propriétaire ou admin de son cercle) et partages connus.
  const [canEdit, setCanEdit] = useState(IS_MOCK);
  const [shares, setShares] = useState<{ space_id: string; shared_by: string }[] | null>(null);
  useEffect(() => {
    if (IS_MOCK) return;
    supabase.from('contacts').select('follow_linkedin').eq('id', contactId).maybeSingle()
      .then(({ data: row }) => setFollowLinkedin(row?.follow_linkedin ?? null));
    supabase.rpc('can_edit_contact', { p_contact: contactId }).then(({ data: ok }) => setCanEdit(ok === true));
    supabase.from('contact_shares').select('space_id, shared_by').eq('contact_id', contactId)
      .then(({ data: rows }) => setShares(rows ?? []));
  }, [contactId]);
  const toggleFollow = async (on: boolean, viaTag: boolean) => {
    const before = followLinkedin;
    setFollowLinkedin(on);
    if (IS_MOCK) return;
    const { error } = await supabase.from('contacts').update({ follow_linkedin: on }).eq('id', contactId);
    if (error) { setFollowLinkedin(before); toast(`Réglage impossible : ${error.message}`); return; }
    toast(on ? 'Circl vérifiera son poste chaque semaine et vous préviendra en cas de changement.'
      : viaTag ? 'Suivi LinkedIn arrêté pour ce contact, malgré son tag de suivi.' : 'Suivi LinkedIn arrêté.');
  };

  // Reprise d'une recherche FullEnrich lancée plus tôt (page rechargée, fiche refermée).
  const findRef = useRef<(kind: 'email' | 'phone', resume?: boolean) => void>(undefined);
  useEffect(() => {
    if (IS_MOCK) return;
    supabase.from('enrichment_jobs').select('kind').eq('contact_id', contactId).in('status', ['pending', 'finalizing'])
      .then(({ data: jobs }) => { const kind = jobs?.[0]?.kind; if (kind) findRef.current?.(kind, true); });
  }, [contactId]);

  if (!contact) return null;

  const name = fullName(contact);
  const touch = lastTouch(contact, data.lastNoteByContact.get(contactId));
  const status = relStatus(touch);
  const tags = data.tagsByContact.get(contactId) ?? [];
  const trackTag = tags.some((t: any) => ['vip', 'à suivre', 'a suivre'].includes(String(t.name ?? '').toLowerCase()));
  // Fiche verrouillée : la vue contacts_visible le dit directement.
  const locked = contact.is_unlocked === false;
  const noteCount = (data.notesByContact.get(contactId) ?? []).length;

  const hop = (id: string) => { setStack((s) => [...s, contactId]); onNavigate(id); };
  const patchLocal = (patch: Record<string, any>) => setOverrides((o) => ({ ...o, [contactId]: { ...(o[contactId] ?? {}), ...patch } }));

  const saveField = async (field: string, value: string) => {
    patchLocal({ [field]: value || null });
    if (IS_MOCK) return;
    const { error } = await supabase.from('contacts').update({ [field]: value || null }).eq('id', contactId);
    if (error) { toast(`Modification impossible : ${error.message}`); return; }
    data.patchContact(contactId, { [field]: value || null });
  };

  const decide = async (u: any, confirm: boolean) => {
    if (IS_MOCK) { toast(confirm ? 'Mise à jour appliquée.' : 'Mise à jour écartée.'); return; }
    const { error } = await supabase.rpc(confirm ? 'confirm_contact_update' : 'dismiss_contact_update', { p_update_id: u.id });
    if (error) { toast(`Échec : ${error.message}`); return; }
    toast(confirm ? 'Mise à jour appliquée.' : 'Mise à jour écartée.');
    await data.refresh(confirm ? ['updates', 'contacts'] : ['updates']);
  };

  // Partage par référence : la fiche reste dans son cercle d'origine. Le
  // propriétaire voit tous les partages, y compris vers des cercles dont il
  // n'est pas membre (« un cercle d'un collègue »).
  const shareIds: string[] = shares ? shares.map((x) => x.space_id) : (contact.space_ids ?? []).filter((id: string) => id !== contact.space_id);
  const sharedWith = shareIds.map((id) => data.spaceById.get(id) ?? { id, name: 'Un cercle d’un collègue', type: 'team' });
  const canUnshare = (spaceId: string) => canEdit || shares?.find((x) => x.space_id === spaceId)?.shared_by === data.user?.id;
  const shareTargets = canEdit ? data.spaces.filter((sp) => sp.type !== 'personal' && sp.id !== contact.space_id && !shareIds.includes(sp.id)) : [];
  const share = async (spaceId: string) => {
    const next = [...new Set([...(contact.space_ids ?? [contact.space_id]), spaceId])];
    patchLocal({ space_ids: next });
    if (IS_MOCK) return;
    const { error } = await supabase.from('contact_shares').insert({ contact_id: contactId, space_id: spaceId, shared_by: data.user?.id });
    if (error && error.code !== '23505') { patchLocal({ space_ids: contact.space_ids }); toast(`Partage impossible : ${error.message}`); return; }
    data.patchContact(contactId, { space_ids: next });
    setShares((sh) => (sh ? [...sh, { space_id: spaceId, shared_by: data.user?.id }] : sh));
    toast(`Partagé avec ${data.spaceById.get(spaceId)?.name ?? 'ce cercle'}.`);
  };
  const unshare = async (spaceId: string) => {
    const next = (contact.space_ids ?? []).filter((id: string) => id !== spaceId);
    patchLocal({ space_ids: next });
    if (IS_MOCK) return;
    const { data: gone, error } = await supabase.from('contact_shares').delete().eq('contact_id', contactId).eq('space_id', spaceId).select('space_id');
    if (error || !gone?.length) {
      patchLocal({ space_ids: contact.space_ids });
      toast(error ? `Retrait impossible : ${error.message}` : 'Seuls le propriétaire de la fiche et l’auteur du partage peuvent le retirer.');
      return;
    }
    data.patchContact(contactId, { space_ids: next });
    setShares((sh) => (sh ? sh.filter((x) => x.space_id !== spaceId) : sh));
    toast(`Partage avec ${data.spaceById.get(spaceId)?.name ?? 'ce cercle'} retiré.`);
  };

  const moveCircle = async (spaceId: string) => {
    if (spaceId === contact.space_id) return;
    patchLocal({ space_id: spaceId });
    toast(`${contact.first_name} déplacé vers ${data.spaceById.get(spaceId)?.name ?? 'ce cercle'}.`);
    if (IS_MOCK) return;
    const { error } = await supabase.from('contacts').update({ space_id: spaceId }).eq('id', contactId);
    if (error) { patchLocal({ space_id: contact.space_id }); toast(`Déplacement impossible : ${error.message}`); return; }
    // Le cercle d'origine change aussi dans la liste des cercles visibles.
    const space_ids = [...new Set([...(contact.space_ids ?? []).filter((id: string) => id !== contact.space_id), spaceId])];
    patchLocal({ space_ids });
    data.patchContact(contactId, { space_id: spaceId, space_ids });
  };

  const requestAccess = async () => {
    const { error } = await supabase.from('contact_access_requests').insert({
      contact_id: contactId, owner_id: contact.owner_id, requester_id: data.user?.id, space_id: contact.space_id,
    });
    if (error) { toast(error.code === '23505' ? 'Vous avez déjà demandé l’accès à ce contact.' : `Demande impossible : ${error.message}`); return; }
    toast('Demande envoyée au propriétaire du contact.');
  };

  // Enrichissement web (Perplexity) : poste, secteur, compétences, besoins.
  const enrich = async () => {
    setEnriching(true);
    try {
      if (IS_MOCK) {
        await new Promise((r) => setTimeout(r, 900));
        patchLocal({ enriched_at: new Date().toISOString(), industry: contact.industry || 'Conseil', skills: ['stratégie', 'affaires publiques'] });
        toast('Fiche enrichie depuis le web.');
        return;
      }
      const { skillsAdded, needsAdded } = await enrichAndPersistContact({
        id: contactId, first_name: contact.first_name, last_name: contact.last_name, company: contact.company,
        job_title: contact.job_title, industry: contact.industry, bio: contact.bio, ai_context: contact.ai_context, location: contact.location,
      });
      toast(skillsAdded + needsAdded > 0 ? `Fiche enrichie : ${skillsAdded} compétence${skillsAdded > 1 ? 's' : ''}, ${needsAdded} besoin${needsAdded > 1 ? 's' : ''}.` : 'Fiche enrichie.');
      await data.refresh(['contacts']);
    } catch (err: any) {
      toast(`Enrichissement impossible : ${err.message ?? 'erreur'}`);
    } finally { setEnriching(false); }
  };

  // Recherche d'email / téléphone (FullEnrich, revendue au crédit). Débit
  // côté serveur, seulement si une valeur est trouvée.
  const findInfo = async (kind: 'email' | 'phone', resume = false) => {
    const cost = COST[kind];
    if (!resume && credits < cost) { setBuyOpen(true); return; }
    setFinding(kind);
    if (!IS_MOCK) {
      const label = kind === 'email' ? 'Email' : 'Téléphone';
      const call = async (body: object) => {
        const res: any = await supabase.functions.invoke('find-contact-info', { body });
        if (!res.error) { if (typeof res.data?.balance === 'number') setCredits(res.data.balance); return res.data; }
        let msg = res.error.message ?? 'erreur';
        try { const b = await res.error.context?.json?.(); if (b?.error) msg = b.error; if (typeof b?.balance === 'number') setCredits(b.balance); } catch { /* corps illisible */ }
        return { status: 'error', error: msg };
      };
      // Lancement (ou reprise d'une recherche en cours, côté serveur) puis
      // suivi toutes les 4 s, jusqu'à 5 min (waterfall FullEnrich).
      let r = await call({ contact_id: contactId, kind });
      for (let i = 0; r.status === 'pending' && r.job_id && i < 75; i++) {
        await new Promise((ok) => setTimeout(ok, 4000));
        const next = await call({ job_id: r.job_id });
        r = { ...next, job_id: r.job_id };
      }
      setFinding(null);
      if (r.status === 'pending') { toast('La recherche est toujours en cours. Revenez sur la fiche dans quelques minutes.'); return; }
      if (r.status === 'error') { toast(`Recherche impossible : ${r.error}`); return; }
      if (!r.value) { toast(`${label} introuvable. Aucun crédit utilisé.`); return; }
      patchLocal({ [kind]: r.value });
      toast(`${label} trouvé · ${cost} crédit${cost > 1 ? 's' : ''} utilisé${cost > 1 ? 's' : ''}.`);
      data.patchContact(contactId, { [kind]: r.value });
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
    const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
    const value = kind === 'email'
      ? `${slug(contact.first_name)}.${slug(contact.last_name)}@${slug(contact.company ?? 'mail') || 'mail'}.com`
      : '+33 6 41 27 88 03';
    patchLocal({ [kind]: value });
    setCredits((c) => c - cost);
    setFinding(null);
    toast(`${kind === 'email' ? 'Email' : 'Téléphone'} trouvé · ${cost} crédit${cost > 1 ? 's' : ''} utilisé${cost > 1 ? 's' : ''}.`);
  };
  findRef.current = findInfo;

  const addToPipeline = async (pipelineId: string) => {
    const p = data.pipelines.find((x) => x.id === pipelineId);
    if (memberships.some((m) => m.item.pipeline_id === pipelineId)) { toast(`${contact.first_name} est déjà dans ${p?.name}.`); return; }
    if (!IS_MOCK) {
      const first = data.pipelineStages.filter((s) => s.pipeline_id === pipelineId).sort((a, b) => a.position - b.position)[0];
      if (!first) { toast('Ce pipeline n’a pas d’étape.'); return; }
      const { error } = await supabase.from('pipeline_items').insert({ pipeline_id: pipelineId, stage_id: first.id, contact_id: contactId, position: 0 });
      if (error) { toast(`Ajout impossible : ${error.message}`); return; }
      await data.refresh(['pipelines']);
    }
    toast(`${contact.first_name} ajouté à ${p?.name ?? 'ce pipeline'}.`);
  };

  const doDelete = async () => {
    setDeleting(true);
    if (!IS_MOCK) {
      const { error } = await supabase.from('contacts').delete().eq('id', contactId);
      if (error) { setDeleting(false); setConfirmDelete(false); toast(`Suppression impossible : ${error.message}`); return; }
    }
    setDeleting(false); setConfirmDelete(false); onClose();
    toast(`${name} supprimé.`);
    if (!IS_MOCK) await data.refresh(['contacts']);
  };

  const findBtn = (kind: 'email' | 'phone') => (
    <button disabled={finding !== null || locked} onClick={() => findInfo(kind)}
      title={`Trouver ${kind === 'email' ? "l'email" : 'le téléphone'} via l'enrichissement`}
      className="-ml-2 inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">
      <Search size={12} />
      {finding === kind ? 'Recherche…' : 'Trouver'}
      <span className="text-[11px] text-muted-foreground/80">· {COST[kind]} crédit{COST[kind] > 1 ? 's' : ''}</span>
    </button>
  );

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/20 animate-in fade-in-0" onClick={onClose} />
      <aside role="dialog" aria-label={`Fiche de ${name}`}
        className="fixed bottom-0 right-0 top-0 z-50 flex w-[min(1100px,96vw)] flex-col border-l bg-background shadow-2xl animate-in slide-in-from-right-8 duration-200">
        {/* Barre */}
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          {stack.length > 0 && (
            <button className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted" title="Retour"
              onClick={() => { const prev = stack[stack.length - 1]; setStack((s) => s.slice(0, -1)); onNavigate(prev); }}>
              <ArrowLeft size={15} />
            </button>
          )}
          <span className="text-xs text-muted-foreground">{siblings && siblings.length > 1 ? '↑ ↓ pour passer au contact suivant' : ''}</span>
          <span className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted" title="Plus"><MoreHorizontal size={15} /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={13} /> Supprimer le contact
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted" onClick={onClose} title="Fermer (Échap)"><X size={15} /></button>
        </div>

        {/* Identité */}
        <div className="flex items-start gap-4 border-b px-6 py-5">
          <Avatar name={name} firstName={contact.first_name} lastName={contact.last_name} photoUrl={contact.photo_url} size={56} locked={locked} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[20px] font-semibold tracking-tight">{name}</h2>
            <div className="mt-0.5 truncate text-[13px] text-muted-foreground">
              {[contact.job_title, contact.company].filter(Boolean).join(' · ') || 'Poste et entreprise à compléter'}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className={cn('size-1.5 rounded-full', STATUS[status].dot)} />{STATUS[status].label}</span>
              {touch && <span>· dernier échange {relativeFR(touch.toISOString())}</span>}
              {tags.map((t: any) => <span key={t.id} className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">{t.name}</span>)}
            </div>
          </div>
          {!locked && (
            <button onClick={enrich} disabled={enriching}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50">
              <Sparkles size={13} /> {enriching ? 'Enrichissement…' : 'Enrichir'}
            </button>
          )}
        </div>

        {locked && (
          <div className="mx-6 mt-4 flex items-center gap-2.5 rounded-xl border border-[hsl(var(--h-amber-500))]/30 bg-[hsl(var(--h-amber-100))] px-4 py-2.5">
            <Lock size={14} className="text-[hsl(var(--h-amber-500))]" />
            <span className="flex-1 text-[13px] text-[hsl(var(--h-amber-500))]">Contact verrouillé par son propriétaire : seuls le prénom et le nom sont partagés.</span>
            <button className="rounded-md border bg-card px-2.5 py-1 text-xs hover:bg-muted" onClick={requestAccess}>Demander l'accès</button>
          </div>
        )}

        {/* Corps : propriétés | activité */}
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[360px_1fr] md:overflow-hidden">
          <div className="border-b px-6 py-4 md:overflow-y-auto md:border-b-0 md:border-r">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-xs font-semibold">Coordonnées</h3>
              <button onClick={() => setBuyOpen(true)} title="Acheter des crédits"
                className="rounded px-1 text-[11px] tabular-nums text-muted-foreground hover:bg-muted hover:text-foreground">{credits} crédits · Acheter</button>
            </div>
            <Prop label="Email">
              {contact.email ? <a href={`mailto:${contact.email}`} title={contact.email} className="inline-flex max-w-full items-center gap-1.5 truncate px-0 py-1 text-[13px] hover:underline"><Mail size={12} className="shrink-0 text-muted-foreground" />{contact.email}</a> : findBtn('email')}
            </Prop>
            <Prop label="Téléphone">
              {contact.phone ? <a href={`tel:${contact.phone}`} className="inline-flex items-center gap-1.5 py-1 text-[13px] tabular-nums hover:underline"><Phone size={12} className="text-muted-foreground" />{contact.phone}</a> : findBtn('phone')}
            </Prop>
            {contact.linkedin ? (
              <Prop label="LinkedIn">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
                  <a href={contact.linkedin.startsWith('http') ? contact.linkedin : `https://${contact.linkedin}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] hover:underline"><Link2 size={12} className="text-muted-foreground" />Profil</a>
                  {!locked && (
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                      <input type="checkbox" checked={followLinkedin ?? trackTag} onChange={(e) => toggleFollow(e.target.checked, trackTag)} className="size-3.5 accent-foreground" />
                      Suivre ses changements de poste
                    </label>
                  )}
                </span>
              </Prop>
            ) : (
              <Prop label="LinkedIn" value={contact.linkedin} disabled={locked} onSave={(v) => saveField('linkedin', v)} />
            )}

            <h3 className="mb-1 mt-5 text-xs font-semibold">Profil</h3>
            <Prop label="Poste" value={contact.job_title} disabled={locked} onSave={(v) => saveField('job_title', v)} />
            <Prop label="Entreprise" value={contact.company} disabled={locked} onSave={(v) => saveField('company', v)} />
            <Prop label="Secteur" value={contact.industry} disabled={locked} onSave={(v) => saveField('industry', v)} />
            <Prop label="Lieu" value={contact.location} disabled={locked} onSave={(v) => saveField('location', v)} />

            <h3 className="mb-1 mt-5 text-xs font-semibold">Organisation</h3>
            <Prop label="Cercle">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="-ml-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] hover:bg-muted">
                    <span className="size-2 rounded-full" style={{ background: data.spaceById.get(contact.space_id) ? circleColor(data.spaceById.get(contact.space_id)) : undefined }} />
                    {data.spaceById.get(contact.space_id)?.name ?? 'Aucun'}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  {data.spaces.map((s) => (
                    <DropdownMenuItem key={s.id} onClick={() => moveCircle(s.id)}>
                      <span className="size-2 rounded-full" style={{ background: circleColor(s) }} /><span className="flex-1">{s.name}</span>
                      {s.id === contact.space_id && <Check size={13} />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </Prop>
            <Prop label="Partagé avec">
              <div className="flex flex-wrap items-center gap-1 py-0.5">
                {sharedWith.map((sp: any) => (
                  <span key={sp.id} className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-2 py-0.5 text-xs">
                    <span className="size-1.5 rounded-full" style={{ background: circleColor(sp) }} />{sp.name}
                    {!locked && canUnshare(sp.id) && <button aria-label={`Retirer le partage avec ${sp.name}`} onClick={() => unshare(sp.id)} className="text-muted-foreground hover:text-foreground"><X size={11} /></button>}
                  </span>
                ))}
                {shareTargets.length > 0 && !locked && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="-ml-1 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground">
                        <Share2 size={12} /> {sharedWith.length ? 'Ajouter' : 'Partager avec un cercle'}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-60">
                      {shareTargets.map((sp) => (
                        <DropdownMenuItem key={sp.id} onClick={() => share(sp.id)}>
                          <span className="size-2 rounded-full" style={{ background: circleColor(sp) }} /><span className="flex-1 truncate">{sp.name}</span>
                        </DropdownMenuItem>
                      ))}
                      <p className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">Ses membres verront la fiche et les notes non privées. Aucune copie n'est créée.</p>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {sharedWith.length === 0 && shareTargets.length === 0 && <span className="text-[13px] text-muted-foreground">Aucun cercle</span>}
              </div>
            </Prop>
            <Prop label="Pipeline">
              <div className="flex flex-col items-start gap-1 py-0.5">
                {memberships.map((m) => (
                  <span key={m.item.id} className="text-[13px]">{m.pipeline?.name} <span className="text-muted-foreground">· {m.stage?.name}</span></span>
                ))}
                {data.pipelines.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="-ml-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground">
                        <Columns3 size={12} /> Ajouter à un pipeline
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-52">
                      {data.pipelines.map((p) => <DropdownMenuItem key={p.id} onClick={() => addToPipeline(p.id)}>{p.name}</DropdownMenuItem>)}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </Prop>
            <Prop label="Source">
              <span className="py-1 text-[13px] text-muted-foreground">
                {contact.source === 'iphone_import' ? 'Import iPhone' : contact.source === 'import' ? 'Import' : contact.source === 'enrichment' ? 'Enrichissement' : 'Manuel'}
                {contact.enriched_at ? ` · enrichi ${relativeFR(contact.enriched_at)}` : ''}
              </span>
            </Prop>
          </div>

          <div className="flex flex-col gap-6 px-6 py-5 md:overflow-y-auto">
            {pending.length > 0 && (
              <div className="rounded-xl border bg-muted/40 p-3.5">
                <div className="mb-2 text-xs font-semibold">{pending.length > 1 ? `${pending.length} mises à jour détectées` : 'Mise à jour détectée'}</div>
                <div className="flex flex-col gap-2">
                  {pending.map((u) => (
                    <div key={u.id} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        {u.field ? <DiffLine field={FIELD_LABELS[u.field] ?? u.field} oldValue={u.old_value} newValue={u.new_value ?? ''} /> : <span className="text-[13px]">{u.summary}</span>}
                        {u.source === 'linkedin' && <div className="mt-0.5 text-[11px] text-muted-foreground">Détecté sur LinkedIn</div>}
                      </div>
                      <button className="grid size-7 place-items-center rounded-md border text-muted-foreground hover:bg-secondary" title="Écarter" onClick={() => decide(u, false)}><X size={14} /></button>
                      <button className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground" title="Appliquer" onClick={() => decide(u, true)}><Check size={14} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <NoteComposer contactId={contactId} contactFirstName={contact.first_name} />

            {contact.ai_context && (
              <div>
                <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold"><Sparkles size={12} /> Mémoire</h3>
                <p className="text-[13px] leading-relaxed text-muted-foreground">{contact.ai_context}</p>
              </div>
            )}

            {/* Profil enrichi : compétences (étiquettes courtes) et besoins
                (phrases, donc en liste et pas en étiquettes). */}
            {((contact.skills?.length ?? 0) > 0 || (contact.inferred_needs?.length ?? 0) > 0) && (
              <div className="flex flex-col gap-5">
                {(contact.skills?.length ?? 0) > 0 && (
                  <div>
                    <h3 className="mb-2 text-xs font-semibold">Compétences</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {contact.skills.map((s: string) => (
                        <span key={s} className="rounded-md bg-secondary px-2 py-1 text-xs leading-snug">{s}</span>
                      ))}
                    </div>
                  </div>
                )}
                {(contact.inferred_needs?.length ?? 0) > 0 && (
                  <div>
                    <h3 className="mb-2 text-xs font-semibold">Cherche</h3>
                    <ul className="flex flex-col gap-1.5">
                      {contact.inferred_needs.map((s: string) => (
                        <li key={s} className="flex gap-2 text-[13px] leading-snug text-muted-foreground">
                          <span className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground/60" />
                          <span>{s.charAt(0).toUpperCase() + s.slice(1)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div>
              <h3 className="mb-1 text-xs font-semibold">Activité</h3>
              <Timeline contact={contact} onOpenContact={hop} />
            </div>

            {links.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold">Connexions</h3>
                <div className="flex flex-wrap gap-1.5">
                  {links.map((other) => (
                    <button key={other.id} onClick={() => hop(other.id)}
                      className="inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs hover:bg-muted">
                      <Avatar name={fullName(other)} firstName={other.first_name} lastName={other.last_name} photoUrl={other.photo_url} size={24} />
                      {fullName(other)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Supprimer {name} ?</DialogTitle></DialogHeader>
          <p className="text-[13px] text-muted-foreground">
            Cette suppression est définitive et emporte tout ce qui est rattaché à cette fiche : {noteCount} note{noteCount > 1 ? 's' : ''}, {links.length} lien{links.length > 1 ? 's' : ''}, ses mises à jour et ses relances.
          </p>
          <DialogFooter>
            <button className="rounded-md px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted" onClick={() => setConfirmDelete(false)}>Annuler</button>
            <button disabled={deleting} className="rounded-md bg-destructive px-3 py-1.5 text-[13px] font-medium text-destructive-foreground disabled:opacity-50" onClick={doDelete}>
              {deleting ? 'Suppression…' : 'Supprimer définitivement'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {buyOpen && <BuyCredits balance={credits} onClose={() => setBuyOpen(false)} />}
    </>
  );
};

