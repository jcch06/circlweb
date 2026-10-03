import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, Pencil, Rows3, Share2, Sparkles, X, ArrowRight, Link2 } from 'lucide-react';
import { useData } from '../data';
import { supabase } from '../lib/supabase';
import { IS_MOCK } from '../lib/mode';
import { cn } from '../lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ContactDrawer } from '../ui/ContactDrawer';
import { Avatar } from '../ui/Bits';
import { fullName, lastTouch, relStatus, relativeFR, type RelStatus, inCircle } from '../ui/format';
import { computeMilieux, suggestLinks, hasInfo, linkKey, norm, type Suggestion } from '../lib/networkRules';

// Réseau : le carnet rangé par milieux (où l'on a connu les gens), et des
// liens qui disent toujours pourquoi ils existent. Les milieux et les liens
// devinés sont calculés par des règles lisibles (lib/networkRules) ; la base
// ne garde que les décisions de l'utilisateur.

type Tab = 'milieux' | 'liens' | 'trier';
const UNCLASSIFIED = '__a_classer__';
const DOT: Record<RelStatus, string> = { fresh: 'bg-hgreen-500', due: 'bg-hamber-500', dormant: 'bg-hred-500', never: 'bg-muted-foreground/50' };
const KIND_LABEL: Record<string, string> = { works_for: 'travaille pour', co_mention: 'connaît', note: 'cités dans une note', knows: 'connaît', colleague: 'collègue de' };

type Bubble = { key: string; name: string; ids: string[]; r: number; x: number; y: number; unclassified?: boolean };

/** Bulles serrées autour de « Vous » : placement en spirale puis relaxation des chevauchements. */
function layoutBubbles(items: Omit<Bubble, 'r' | 'x' | 'y'>[]): Bubble[] {
  const bs = items.map((it, i) => {
    const r = Math.min(90, 36 + 6 * Math.sqrt(it.ids.length));
    const a = i * 2.39996, d = 70 + 22 * i;
    return { ...it, r, x: Math.cos(a) * d, y: Math.sin(a) * d };
  });
  const me = { r: 30, x: 0, y: 0 };
  for (let k = 0; k < 320; k++) {
    for (const b of bs) { b.x *= 0.985; b.y *= 0.985; }
    const all = [me, ...bs];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const p = all[i], q = all[j];
      const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 0.01, min = p.r + q.r + 12;
      if (d >= min) continue;
      const m = (min - d) / 2, ux = dx / d, uy = dy / d;
      if (p === me) { q.x += ux * m * 2; q.y += uy * m * 2; }
      else { p.x -= ux * m; p.y -= uy * m; q.x += ux * m; q.y += uy * m; }
    }
  }
  return bs;
}

export const NetworkPage: React.FC = () => {
  const data = useData();
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const [tab, setTab] = useState<Tab>('milieux');
  const [selected, setSelected] = useState<string | null>(null);
  const [explicit, setExplicit] = useState<Map<string, string[]>>(new Map());
  // Classements proposés par l'IA : appliqués à la carte, mais à valider.
  const [aiRows, setAiRows] = useState<Map<string, string[]>>(new Map());
  const [aliases, setAliases] = useState<Map<string, string>>(new Map());
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(IS_MOCK);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const userId = data.user?.id;

  // Décisions de l'utilisateur (classements, renommages, rejets).
  // Toutes les pages : une limite d'API ne doit jamais faire oublier une décision.
  const pageAll = async (q: () => any) => {
    const out: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: page, error } = await q().range(from, from + 999);
      if (error) throw error;
      out.push(...(page ?? []));
      if (!page || page.length < 1000) return out;
    }
  };
  const loadDecisions = async () => {
    if (IS_MOCK) return;
    try {
      const [m, a, r] = await Promise.all([
        pageAll(() => supabase.from('contact_milieux').select('contact_id, milieu, source').order('contact_id')),
        pageAll(() => supabase.from('milieu_aliases').select('from_name, to_name').order('from_name')),
        pageAll(() => supabase.from('link_rejections').select('a, b, kind').order('a')),
      ]);
      const user = new Map<string, string[]>(), ai = new Map<string, string[]>();
      for (const row of m) { const t = row.source === 'ai' ? ai : user; (t.get(row.contact_id) ?? t.set(row.contact_id, []).get(row.contact_id)!).push(row.milieu); }
      setExplicit(user); setAiRows(ai);
      setAliases(new Map(a.map((x) => [x.from_name, x.to_name])));
      setRejected(new Set(r.map((x) => linkKey(x.a, x.b, x.kind))));
      setLoaded(true);
    } catch {
      flash('Vos classements n’ont pas pu être chargés. Rechargez la page.');
    }
  };
  useEffect(() => { loadDecisions(); }, []);

  // Une personne = une fiche, même copiée dans plusieurs cercles.
  const people = useMemo(() => {
    const seen = new Set<string>();
    return data.contacts
      .filter((c) => inCircle(c, data.selectedSpaceId))
      .filter((c) => { const k = c.shared_contact_id ?? c.id; if (seen.has(k)) return false; seen.add(k); return true; });
  }, [data.contacts, data.selectedSpaceId]);

  const merged = useMemo(() => { const m = new Map(aiRows); for (const [k, v] of explicit) m.set(k, v); return m; }, [explicit, aiRows]);
  const result = useMemo(() => computeMilieux({ contacts: people, explicit: merged, aliases }), [people, merged, aliases]);
  const aiPending = useMemo(() => people.filter((c) => aiRows.has(c.id) && !explicit.has(c.id)).map((c) => c.id), [people, aiRows, explicit]);
  const status = (c: any) => relStatus(lastTouch(c, data.lastNoteByContact.get(c.id)));

  const known = useMemo(() => {
    const s = new Set(rejected);
    for (const l of data.contactLinks) s.add(linkKey(l.from_contact_id, l.to_contact_id, 'any'));
    return s;
  }, [rejected, data.contactLinks]);
  const suggestions = useMemo(() => (loaded ? suggestLinks(people, data.notes, known) : []), [loaded, people, data.notes, known]);

  const bubbles = useMemo(() => {
    const items: Omit<Bubble, 'r' | 'x' | 'y'>[] = result.milieux.slice(0, 28).map((m) => ({ key: norm(m.name), name: m.name, ids: m.ids }));
    if (result.unclassified.length) items.push({ key: UNCLASSIFIED, name: 'À classer', ids: result.unclassified, unclassified: true });
    return layoutBubbles(items);
  }, [result]);
  const view = useMemo(() => {
    const xs = bubbles.flatMap((b) => [b.x - b.r, b.x + b.r]).concat([-40, 40]);
    const ys = bubbles.flatMap((b) => [b.y - b.r, b.y + b.r]).concat([-40, 40]);
    // Taille minimale : un petit carnet ne doit pas être agrandi jusqu'à des libellés géants.
    const w = Math.max(760, Math.max(...xs) - Math.min(...xs) + 32), h = Math.max(520, Math.max(...ys) - Math.min(...ys) + 32);
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    return `${cx - w / 2} ${cy - h / 2} ${w} ${h}`;
  }, [bubbles]);

  const sel = bubbles.find((b) => b.key === selected)
    ?? (() => { const m = result.milieux.find((x) => norm(x.name) === selected); return m ? { key: norm(m.name), name: m.name, ids: m.ids, r: 0, x: 0, y: 0 } : null; })();
  const members = useMemo(() => {
    if (!sel) return [];
    return sel.ids.map((id) => data.contactById.get(id)).filter(Boolean)
      .sort((a: any, b: any) => (lastTouch(b, data.lastNoteByContact.get(b.id))?.getTime() ?? 0) - (lastTouch(a, data.lastNoteByContact.get(a.id))?.getTime() ?? 0));
  }, [sel, data.contactById, data.lastNoteByContact]);

  const flash = (msg: string) => { setNotice(msg); window.setTimeout(() => setNotice(null), 3200); };

  // ---- Décisions ----
  // Classer (ou valider une proposition de l'IA) : le choix de l'utilisateur remplace tout classement précédent.
  const classify = async (contactId: string, milieu: string) => {
    const name = milieu.trim().replace(/\s+/g, ' ');
    if (!name) return;
    setExplicit((m) => new Map(m).set(contactId, [name]));
    setAiRows((m) => { const n = new Map(m); n.delete(contactId); return n; });
    if (IS_MOCK) return;
    const del = await supabase.from('contact_milieux').delete().eq('contact_id', contactId);
    const { error } = del.error ? del : await supabase.from('contact_milieux').insert({ contact_id: contactId, milieu: name.slice(0, 80), source: 'user' });
    if (error && error.code !== '23505') flash(`Classement non enregistré : ${error.message}`);
  };
  const rename = async (from: string, to: string) => {
    const target = to.trim().replace(/\s+/g, ' ');
    if (!target || norm(target) === norm(from)) return;
    setAliases((m) => new Map(m).set(norm(from), target));
    setSelected(norm(target));
    if (IS_MOCK) return;
    const { error } = await supabase.from('milieu_aliases').upsert({ from_name: norm(from), to_name: target.slice(0, 80) });
    if (error) flash(`Renommage non enregistré : ${error.message}`);
  };
  const decide = async (s: Suggestion, ok: boolean) => {
    const [a, b] = s.a < s.b ? [s.a, s.b] : [s.b, s.a];
    setRejected((r) => new Set(r).add(linkKey(a, b, ok ? 'any' : s.kind)));
    if (IS_MOCK) return;
    if (ok) {
      const from = data.contactById.get(s.a);
      const { error } = await supabase.from('contact_links').insert({
        space_id: from?.space_id, from_contact_id: s.a, to_contact_id: s.b, kind: s.kind, reason: s.reason, created_by: userId,
      });
      if (error && error.code !== '23505') { flash(`Lien non enregistré : ${error.message}`); return; }
      await data.refresh(['links']);
    } else {
      const { error } = await supabase.from('link_rejections').insert({ a, b, kind: s.kind });
      if (error && error.code !== '23505') flash(`Rejet non enregistré : ${error.message}`);
    }
  };
  const removeLink = async (l: any) => {
    const { error } = await supabase.from('contact_links').delete().eq('id', l.id);
    if (error) { flash(`Suppression impossible : ${error.message}`); return; }
    await data.refresh(['links']);
  };
  // Classement IA des contacts qui ont au moins un indice (entreprise, poste, email, parenthèse).
  const aiCandidates = useMemo(() => result.unclassified.filter((id) => { const c = data.contactById.get(id); return c && hasInfo(c); }), [result, data.contactById]);
  const runAI = async () => {
    if (IS_MOCK || aiCandidates.length === 0) return;
    let done = 0, classified = 0;
    const milieux = result.milieux.map((m) => m.name);
    for (let i = 0; i < aiCandidates.length; i += 150) {
      setAiBusy(`Classement en cours… ${done}/${aiCandidates.length}`);
      const res: any = await supabase.functions.invoke('classify-milieux', { body: { contact_ids: aiCandidates.slice(i, i + 150), milieux } });
      if (res.error) { setAiBusy(null); flash("Le classement automatique a échoué. Réessayez dans un instant."); return; }
      classified += res.data?.classified ?? 0;
      done = Math.min(aiCandidates.length, i + 150);
    }
    setAiBusy(null);
    await loadDecisions();
    flash(`${classified} contact${classified > 1 ? 's' : ''} rangé${classified > 1 ? 's' : ''} par l'IA. Les autres restent à classer.`);
  };

  // ---- Rendu ----
  const personRow = (c: any, right?: React.ReactNode) => {
    const st = status(c);
    const via = c.owner_id && c.owner_id !== userId ? c.owner_display_name : null;
    return (
      <button key={c.id} onClick={() => navigate(`/reseau/${c.id}`)}
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">
        <Avatar name={fullName(c)} firstName={c.first_name} lastName={c.last_name} size={24} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px]">{fullName(c)}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {[c.job_title, c.company].filter(Boolean).join(' · ') || 'Fiche à compléter'}{via ? ` · via ${via}` : ''}
          </span>
        </span>
        {right ?? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
            <span className={cn('size-1.5 rounded-full', DOT[st])} />{lastTouch(c, data.lastNoteByContact.get(c.id)) ? relativeFR(lastTouch(c, data.lastNoteByContact.get(c.id))!.toISOString()) : 'jamais'}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-4 py-2.5 md:px-6">
        <div className="flex items-center rounded-lg bg-secondary p-0.5 text-xs">
          <button className="rounded-md px-3 py-1 font-medium text-muted-foreground hover:text-foreground" onClick={() => navigate(`/contacts${window.location.search}`)}><Rows3 className="mr-1.5 inline size-3.5" />Table</button>
          <span className="rounded-md bg-card px-3 py-1 font-medium shadow-sm"><Share2 className="mr-1.5 inline size-3.5" />Réseau</span>
        </div>
        <span className="mx-1 h-4 w-px bg-border" />
        {([
          ['milieux', `Milieux · ${result.milieux.length}`],
          ['liens', `Liens${suggestions.length ? ` · ${suggestions.length} à confirmer` : ''}`],
          ['trier', `À classer · ${result.unclassified.length.toLocaleString('fr-FR')}`],
        ] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k}
            className={cn('rounded-md px-2.5 py-1 text-[13px] tabular-nums', tab === k ? 'bg-secondary font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {label}
          </button>
        ))}
        <span className="flex-1" />
        {notice && <span role="status" className="text-xs text-muted-foreground">{notice}</span>}
      </div>

      {tab === 'milieux' && (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="relative min-h-[320px] flex-1 overflow-hidden bg-background">
            {people.length === 0 ? (
              <div className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground">Importez des contacts pour voir apparaître vos milieux.</div>
            ) : (
              <svg viewBox={view} className="h-full w-full" role="img" aria-label="Vos milieux, autour de vous">
                {bubbles.map((b) => {
                  const active = b.ids.filter((id) => { const c = data.contactById.get(id); return c && ['fresh', 'due'].includes(status(c)); }).length;
                  return <line key={`l-${b.key}`} x1={0} y1={0} x2={b.x} y2={b.y} className="stroke-border" strokeWidth={1 + 4 * (active / Math.max(1, b.ids.length))} strokeDasharray={b.unclassified ? '4 4' : undefined} />;
                })}
                {bubbles.map((b) => {
                  const on = selected === b.key;
                  const inside = true;
                  const maxChars = Math.floor((b.r * 2 - 14) / 6.6);
                  const label = b.name.length > maxChars ? `${b.name.slice(0, Math.max(3, maxChars - 1))}…` : b.name;
                  return (
                    <g key={b.key} role="button" tabIndex={0} aria-label={`${b.name}, ${b.ids.length} contacts`} className="cursor-pointer outline-none"
                      onClick={() => setSelected(on ? null : b.key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(on ? null : b.key); } }}>
                      <title>{b.name}</title>
                      <circle cx={b.x} cy={b.y} r={b.r}
                        className={cn('transition-colors', b.unclassified ? 'fill-background stroke-muted-foreground/40' : on ? 'fill-foreground stroke-foreground' : 'fill-secondary stroke-border hover:fill-muted')}
                        strokeWidth={on ? 2 : 1} strokeDasharray={b.unclassified ? '5 4' : undefined} />
                      <text x={b.x} y={inside ? b.y - 2 : b.y + b.r + 13} textAnchor="middle"
                        className={cn('select-none text-[12px] font-medium', on && inside ? 'fill-background' : 'fill-foreground')}>{label}</text>
                      <text x={b.x} y={inside ? b.y + 14 : b.y + 4} textAnchor="middle"
                        className={cn('select-none text-[11px] tabular-nums', on && inside ? 'fill-background/70' : 'fill-muted-foreground')}>{b.ids.length.toLocaleString('fr-FR')}</text>
                    </g>
                  );
                })}
                <circle cx={0} cy={0} r={30} className="fill-foreground" />
                <text x={0} y={4} textAnchor="middle" className="select-none fill-background text-[12px] font-medium">Vous</text>
              </svg>
            )}
            <p className="pointer-events-none absolute bottom-3 left-4 text-xs text-muted-foreground">Taille = nombre de contacts · trait plus épais = milieu plus actif</p>
          </div>

          <aside className="w-full shrink-0 overflow-y-auto border-t bg-card p-4 md:w-[340px] md:border-l md:border-t-0">
            {sel ? (
              <MilieuPanel key={sel.key} bubble={sel} members={members} personRow={personRow} status={status}
                onRename={(to) => rename(sel.name, to)} onClose={() => setSelected(null)}
                onTriage={() => setTab('trier')} onAI={runAI} aiCount={aiCandidates.length} aiBusy={aiBusy} />
            ) : (
              <div className="flex flex-col gap-4 text-[13px]">
                <div>
                  <h2 className="text-sm font-semibold">Vos milieux</h2>
                  <p className="mt-1 leading-relaxed text-muted-foreground">
                    Circl range vos contacts selon les indices de leurs fiches : un mot entre parenthèses dans le nom, l'entreprise, le domaine d'email, le poste. Cliquez une bulle pour voir qui s'y trouve.
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-y-1.5 tabular-nums">
                  <dt className="text-muted-foreground">Contacts rangés</dt><dd className="text-right">{(people.length - result.unclassified.length).toLocaleString('fr-FR')}</dd>
                  <dt className="text-muted-foreground">À classer</dt><dd className="text-right">{result.unclassified.length.toLocaleString('fr-FR')}</dd>
                  <dt className="text-muted-foreground">Liens à confirmer</dt><dd className="text-right">{suggestions.length}</dd>
                </dl>
                {result.milieux.length > 0 && (
                  <div>
                    <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">Tous les milieux · {result.milieux.length}</h3>
                    <ul className="max-h-64 overflow-y-auto">
                      {result.milieux.map((m) => (
                        <li key={m.name}>
                          <button onClick={() => setSelected(norm(m.name))} className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left hover:bg-muted">
                            <span className="truncate">{m.name}</span><span className="tabular-nums text-muted-foreground">{m.ids.length.toLocaleString('fr-FR')}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {aiPending.length > 0 && (
                  <Button variant="ghost" size="sm" className="justify-between" onClick={() => setTab('trier')}>
                    Vérifier {aiPending.length} classement{aiPending.length > 1 ? 's' : ''} proposé{aiPending.length > 1 ? 's' : ''} par l'IA <ArrowRight className="size-3.5" />
                  </Button>
                )}
                {aiCandidates.length > 0 && !IS_MOCK && (
                  <Button variant="outline" size="sm" disabled={!!aiBusy} onClick={runAI}>
                    <Sparkles className="size-3.5" />{aiBusy ?? `Ranger ${aiCandidates.length} contacts avec l'IA`}
                  </Button>
                )}
                {result.unclassified.length > 0 && (
                  <Button variant="ghost" size="sm" className="justify-between" onClick={() => setTab('trier')}>
                    Trier les contacts à classer <ArrowRight className="size-3.5" />
                  </Button>
                )}
              </div>
            )}
          </aside>
        </div>
      )}

      {tab === 'liens' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-6 md:px-6">
            <section>
              <h2 className="text-sm font-semibold">Liens à confirmer</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">Circl les a déduits de vos fiches et de vos notes. Rien n'est enregistré sans votre accord.</p>
              {suggestions.length === 0 ? (
                <p className="mt-4 text-[13px] text-muted-foreground">Aucun lien à confirmer. Écrivez « Collab Prénom Nom » dans l'entreprise d'un contact, ou citez quelqu'un dans une note, et Circl le proposera ici.</p>
              ) : (
                <ul className="mt-3 divide-y border-y">
                  {suggestions.map((s) => {
                    const a = data.contactById.get(s.a), b = data.contactById.get(s.b);
                    if (!a || !b) return null;
                    return (
                      <li key={`${s.a}-${s.b}-${s.kind}`} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px]">
                            <button className="font-medium hover:underline" onClick={() => navigate(`/reseau/${a.id}`)}>{fullName(a)}</button>
                            <span className="text-muted-foreground"> {KIND_LABEL[s.kind]} </span>
                            <button className="font-medium hover:underline" onClick={() => navigate(`/reseau/${b.id}`)}>{fullName(b)}</button>
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">{s.reason}</div>
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => decide(s, true)}><Check className="size-3.5" />Confirmer</Button>
                          <Button size="sm" variant="ghost" onClick={() => decide(s, false)}><X className="size-3.5" />Rejeter</Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            <section>
              <h2 className="text-sm font-semibold">Liens enregistrés</h2>
              {data.contactLinks.length === 0 ? (
                <p className="mt-2 text-[13px] text-muted-foreground">Aucun lien pour l'instant.</p>
              ) : (
                <ul className="mt-3 divide-y border-y">
                  {data.contactLinks.map((l) => {
                    const a = data.contactById.get(l.from_contact_id), b = data.contactById.get(l.to_contact_id);
                    if (!a || !b) return null;
                    const note = l.source_note_id ? data.notes.find((n) => n.id === l.source_note_id) : null;
                    return (
                      <li key={l.id ?? `${l.from_contact_id}-${l.to_contact_id}-${l.source_note_id ?? l.kind}`} className="group flex items-center gap-3 py-2.5">
                        <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px]">
                            <button className="font-medium hover:underline" onClick={() => navigate(`/reseau/${a.id}`)}>{fullName(a)}</button>
                            <span className="text-muted-foreground"> {KIND_LABEL[l.kind ?? 'note']} </span>
                            <button className="font-medium hover:underline" onClick={() => navigate(`/reseau/${b.id}`)}>{fullName(b)}</button>
                          </div>
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">
                            {l.reason ?? (note ? `Note du ${new Date(note.created_at).toLocaleDateString('fr-FR')} : « ${note.content.slice(0, 90)}${note.content.length > 90 ? '…' : ''} »` : 'Issu d’une note')}
                          </div>
                        </div>
                        {l.created_by === userId && (
                          <button aria-label="Supprimer ce lien" onClick={() => removeLink(l)}
                            className="grid size-7 place-items-center rounded-md text-muted-foreground opacity-100 hover:bg-muted hover:text-foreground md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"><X className="size-3.5" /></button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}

      {tab === 'trier' && (
        <Triage ids={result.unclassified} aiIds={aiPending} aiSuggestion={aiRows} milieux={result.milieux.map((m) => m.name)} onClassify={classify}
          onAI={runAI} aiCount={aiCandidates.length} aiBusy={aiBusy} />
      )}

      {params.id && (
        <ContactDrawer contactId={params.id} onClose={() => navigate('/reseau')} onNavigate={(id) => navigate(`/reseau/${id}`)} />
      )}
    </div>
  );
};

const MilieuPanel: React.FC<{
  bubble: Bubble; members: any[]; personRow: (c: any) => React.ReactNode; status: (c: any) => RelStatus;
  onRename: (to: string) => void; onClose: () => void; onTriage: () => void; onAI: () => void; aiCount: number; aiBusy: string | null;
}> = ({ bubble, members, personRow, status, onRename, onClose, onTriage, onAI, aiCount, aiBusy }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bubble.name);
  const counts = members.reduce((n: Record<RelStatus, number>, c) => { n[status(c)]++; return n; }, { fresh: 0, due: 0, dormant: 0, never: 0 });
  const [limit, setLimit] = useState(50);
  const [filter, setFilter] = useState('');
  const filtered = filter.trim() ? members.filter((c) => `${fullName(c)} ${c.company ?? ''} ${c.job_title ?? ''}`.toLowerCase().includes(filter.trim().toLowerCase())) : members;
  const shown = filtered.slice(0, limit);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        {editing ? (
          <form className="flex flex-1 gap-1.5" onSubmit={(e) => { e.preventDefault(); onRename(draft); setEditing(false); }}>
            <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Nouveau nom du milieu" className="h-8" />
            <Button size="sm" type="submit">OK</Button>
          </form>
        ) : (
          <h2 className="flex-1 text-sm font-semibold leading-8">{bubble.name}</h2>
        )}
        {!bubble.unclassified && !editing && (
          <button aria-label="Renommer ce milieu" onClick={() => setEditing(true)} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="size-3.5" /></button>
        )}
        <button aria-label="Fermer" onClick={onClose} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-3.5" /></button>
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">
        {members.length.toLocaleString('fr-FR')} contact{members.length > 1 ? 's' : ''} · {counts.fresh} actif{counts.fresh > 1 ? 's' : ''} · {counts.due} à relancer · {counts.dormant} en froid
      </p>
      {bubble.unclassified && (
        <div className="flex flex-col gap-1.5">
          <Button size="sm" onClick={onTriage}>Trier ces contacts <ArrowRight className="size-3.5" /></Button>
          {aiCount > 0 && !IS_MOCK && (
            <Button size="sm" variant="outline" disabled={!!aiBusy} onClick={onAI}><Sparkles className="size-3.5" />{aiBusy ?? `Ranger ${aiCount} contacts avec l'IA`}</Button>
          )}
        </div>
      )}
      {members.length > 50 && <Input value={filter} onChange={(e) => { setFilter(e.target.value); setLimit(50); }} placeholder="Chercher dans ce milieu" aria-label="Chercher dans ce milieu" className="h-8" />}
      <div className="-mx-2 flex flex-col">{shown.map((c) => personRow(c))}</div>
      {filtered.length > shown.length && (
        <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + 50)}>Afficher 50 de plus ({(filtered.length - shown.length).toLocaleString('fr-FR')} restants)</Button>
      )}
    </div>
  );
};

/** Tri des contacts à classer : une personne à la fois, un milieu en un clic ou une touche. */
const Triage: React.FC<{
  ids: string[]; aiIds: string[]; aiSuggestion: Map<string, string[]>; milieux: string[]; onClassify: (id: string, milieu: string) => void;
  onAI: () => void; aiCount: number; aiBusy: string | null;
}> = ({ ids, aiIds, aiSuggestion, milieux, onClassify, onAI, aiCount, aiBusy }) => {
  const data = useData();
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState('');
  // Deux piles : contacts sans milieu, et classements proposés par l'IA à valider.
  const [mode, setMode] = useState<'classer' | 'ia'>(ids.length === 0 && aiIds.length > 0 ? 'ia' : 'classer');
  const queue = (mode === 'ia' ? aiIds : ids).filter((id) => !skipped.has(id));
  const proposal = mode === 'ia' && queue[0] ? aiSuggestion.get(queue[0])?.[0] : undefined;
  const c = queue[0] ? data.contactById.get(queue[0]) : null;
  const choices = milieux.slice(0, 9);
  const pick = (m: string) => { if (c) { onClassify(c.id, m); setDraft(''); } };
  const skip = () => { if (c) setSkipped((s) => new Set(s).add(c.id)); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const n = Number(e.key);
      if (n >= 1 && n <= choices.length) { e.preventDefault(); pick(choices[n - 1]); }
      if (e.key === 'ArrowRight' || e.key === 's') { e.preventDefault(); skip(); }
      if (e.key === 'Enter' && proposal) { e.preventDefault(); pick(proposal); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  if (!c) {
    return (
      <div className="grid flex-1 place-items-center p-8 text-center">
        <div>
          <h2 className="text-sm font-semibold">{ids.length === 0 ? 'Tous vos contacts sont rangés' : 'Fin de la pile'}</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">{ids.length === 0 ? 'Votre carte des milieux est complète.' : 'Les contacts passés reviendront à votre prochaine visite.'}</p>
        </div>
      </div>
    );
  }
  const lastNote = (data.notesByContact.get(c.id) ?? [])[0];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-8 md:px-6">
        {aiIds.length > 0 && (
          <div className="flex w-fit items-center rounded-lg bg-secondary p-0.5 text-xs" role="tablist">
            {([['classer', `Sans milieu · ${ids.length}`], ['ia', `Proposés par l'IA · ${aiIds.length}`]] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
                className={cn('rounded-md px-3 py-1 font-medium tabular-nums', mode === k ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{label}</button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between text-xs tabular-nums text-muted-foreground">
          <span>{queue.length.toLocaleString('fr-FR')} contact{queue.length > 1 ? 's' : ''} {mode === 'ia' ? 'à vérifier' : 'à classer'}</span>
          {aiCount > 0 && !IS_MOCK && (
            <button className="inline-flex items-center gap-1 hover:text-foreground disabled:opacity-60" disabled={!!aiBusy} onClick={onAI}>
              <Sparkles className="size-3" />{aiBusy ?? `Laisser l'IA ranger les ${aiCount} qui ont des indices`}
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Avatar name={fullName(c)} firstName={c.first_name} lastName={c.last_name} size={40} />
          <div className="min-w-0">
            <div className="truncate text-base font-medium">{fullName(c)}</div>
            <div className="truncate text-[13px] text-muted-foreground">
              {[c.job_title, c.company, c.email].filter(Boolean).join(' · ') || 'Aucune autre information sur cette fiche'}
            </div>
          </div>
        </div>
        {lastNote && <p className="text-[13px] leading-relaxed text-muted-foreground">Dernière note : « {lastNote.content.slice(0, 180)}{lastNote.content.length > 180 ? '…' : ''} »</p>}
        <div>
          {proposal && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-[13px]">
              <Sparkles className="size-3.5 text-muted-foreground" />
              <span>L'IA propose <span className="font-medium">{proposal}</span>, d'après les indices de la fiche.</span>
              <Button size="sm" className="ml-auto" onClick={() => pick(proposal)}>Valider · Entrée</Button>
            </div>
          )}
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">{proposal ? 'Ou choisissez un autre milieu' : 'Où l\'avez-vous connu ?'}</h3>
          <div className="flex flex-wrap gap-1.5">
            {choices.map((m, i) => (
              <button key={m} onClick={() => pick(m)}
                className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-[13px] hover:bg-muted focus-visible:outline focus-visible:outline-1">
                <kbd className="text-[11px] tabular-nums text-muted-foreground">{i + 1}</kbd>{m}
              </button>
            ))}
          </div>
          <form className="mt-2 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); pick(draft); }}>
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Nouveau milieu, par exemple Famille" aria-label="Nouveau milieu" className="h-9" />
            <Button type="submit" variant="outline" disabled={!draft.trim()}>Ranger</Button>
          </form>
        </div>
        <div className="flex items-center justify-between border-t pt-4 text-xs text-muted-foreground">
          <span>Touches 1 à {choices.length || 1} pour choisir</span>
          <button onClick={skip} className="inline-flex items-center gap-1 hover:text-foreground">Passer <ArrowRight className="size-3" /></button>
        </div>
      </div>
    </div>
  );
};
