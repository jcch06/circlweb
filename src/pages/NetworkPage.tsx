import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ForceGraph2D from 'react-force-graph-2d';
import { Search, X, Route as RouteIcon, PenLine, Rows3, Share2 } from 'lucide-react';
import { useData } from '../data';
import { ContactDrawer } from '../ui/ContactDrawer';
import { NoteComposer } from '../ui/NoteComposer';
import { AICard, SectionLabel, Segmented } from '../ui/Bits';
import { fullName, avatarColor, circleColor, lastTouch, relStatus, STATUS_META, relativeFR } from '../ui/format';

// Réseau (brief 4.3) : le graphe devient un outil de décision.
// Seules les arêtes réelles (contact_links) sont visibles, épaisseur selon
// le nombre de notes sources. Un seul encodage couleur à la fois. Panneau
// droit permanent : légende au repos, contexte du nœud au clic.
// « Me présenter à… » illumine le chemin réel fondé sur les notes.

type ColorMode = 'circles' | 'recency' | 'degree';

const MODES: { key: ColorMode; label: string; shortcut: string }[] = [
  { key: 'circles', label: 'Cercles', shortcut: '1' },
  { key: 'recency', label: 'Récence', shortcut: '2' },
  { key: 'degree', label: 'Force', shortcut: '3' },
];

const RECENCY_COLORS: Record<string, string> = {
  fresh: '#2F7D51', due: '#C2540A', dormant: '#5B6B8C', never: '#C3C7C6',
};

const CIRCLE_HEX: Record<string, string> = {
  'var(--circle-1)': '#3B6FB5', 'var(--circle-2)': '#7A5CC5', 'var(--circle-3)': '#A64D79',
  'var(--circle-4)': '#C25B4A', 'var(--circle-5)': '#B07C1F', 'var(--circle-6)': '#6E8B3D',
  'var(--circle-7)': '#2D7E93', 'var(--circle-8)': '#8A7357',
};

export const NetworkPage: React.FC = () => {
  const data = useData();
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const graphRef = useRef<any>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const [mode, setMode] = useState<ColorMode>('circles');
  const [showIsolated, setShowIsolated] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pathTargetMode, setPathTargetMode] = useState(false);
  const [path, setPath] = useState<string[] | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const hoverRef = useRef<string | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDims({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---- Construction du graphe : arêtes réelles agrégées ---- */
  const { nodes, links, degree, linkCount, isolatedCount } = useMemo(() => {
    const contacts = data.selectedSpaceId
      ? data.contacts.filter((c) => c.space_id === data.selectedSpaceId)
      : data.contacts;
    const byId = new Map(contacts.map((c) => [c.id, c]));

    const pair = new Map<string, { a: string; b: string; count: number }>();
    for (const l of data.contactLinks) {
      if (!byId.has(l.from_contact_id) || !byId.has(l.to_contact_id)) continue;
      const [a, b] = [l.from_contact_id, l.to_contact_id].sort();
      const key = `${a}|${b}`;
      const e = pair.get(key) ?? { a, b, count: 0 };
      e.count += 1;
      pair.set(key, e);
    }

    const deg = new Map<string, number>();
    for (const e of pair.values()) {
      deg.set(e.a, (deg.get(e.a) ?? 0) + e.count);
      deg.set(e.b, (deg.get(e.b) ?? 0) + e.count);
    }

    const connected = contacts.filter((c) => (deg.get(c.id) ?? 0) > 0);
    const isolated = contacts.filter((c) => (deg.get(c.id) ?? 0) === 0);

    const shown = showIsolated ? contacts : connected;
    const nodes = shown.map((c) => ({ id: c.id, c }));
    const links = [...pair.values()].map((e) => ({ source: e.a, target: e.b, count: e.count }));

    return { nodes, links, degree: deg, linkCount: pair, isolatedCount: isolated.length };
  }, [data.contacts, data.contactLinks, data.selectedSpaceId, showIsolated]);

  const maxDegree = useMemo(() => Math.max(1, ...[...degree.values()]), [degree]);
  const bridges = useMemo(() => {
    const sorted = [...degree.entries()].sort((a, b) => b[1] - a[1]);
    return new Set(sorted.slice(0, 5).map(([id]) => id));
  }, [degree]);

  /* ---- Couleur d'un nœud selon l'encodage actif ---- */
  const nodeColor = useCallback((c: any): string => {
    if (mode === 'circles') {
      const space = data.spaceById.get(c.space_id);
      return space ? (CIRCLE_HEX[circleColor(space)] ?? '#8C99B3') : '#8C99B3';
    }
    if (mode === 'recency') {
      const s = relStatus(lastTouch(c, data.lastNoteByContact.get(c.id)));
      return RECENCY_COLORS[s];
    }
    const d = degree.get(c.id) ?? 0;
    const t = Math.min(1, d / maxDegree);
    // Force : du gris clair au teal profond
    const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
    return `rgb(${mix(195, 15)}, ${mix(199, 111)}, ${mix(198, 92)})`;
  }, [mode, data.spaceById, data.lastNoteByContact, degree, maxDegree]);

  /* ---- Raccourcis clavier 1/2/3 ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      const m = MODES.find((x) => x.shortcut === e.key);
      if (m) setMode(m.key);
      if (e.key === 'Escape') { setPath(null); setPathTargetMode(false); setSelectedId(null); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /* ---- Chemin d'intro : BFS pondéré (liens forts privilégiés) ---- */
  const adjacency = useMemo(() => {
    const adj = new Map<string, { to: string; count: number }[]>();
    for (const e of linkCount.values()) {
      (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push({ to: e.b, count: e.count });
      (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push({ to: e.a, count: e.count });
    }
    return adj;
  }, [linkCount]);

  const findPath = useCallback((fromId: string, toId: string): string[] | null => {
    // Dijkstra avec coût 1/count : les liens nourris de notes pèsent moins.
    const dist = new Map<string, number>([[fromId, 0]]);
    const prev = new Map<string, string>();
    const queue = new Set<string>([fromId]);
    while (queue.size > 0) {
      let u: string | null = null; let best = Infinity;
      for (const q of queue) { const d = dist.get(q) ?? Infinity; if (d < best) { best = d; u = q; } }
      if (!u) break;
      queue.delete(u);
      if (u === toId) break;
      for (const { to, count } of adjacency.get(u) ?? []) {
        const alt = (dist.get(u) ?? 0) + 1 / Math.max(1, count);
        if (alt < (dist.get(to) ?? Infinity)) {
          dist.set(to, alt);
          prev.set(to, u);
          queue.add(to);
        }
      }
    }
    if (!prev.has(toId) && fromId !== toId) return null;
    const out = [toId];
    let cur = toId;
    while (cur !== fromId) { cur = prev.get(cur)!; out.unshift(cur); }
    return out;
  }, [adjacency]);

  const pathEdges = useMemo(() => {
    if (!path) return new Set<string>();
    const s = new Set<string>();
    for (let i = 0; i < path.length - 1; i++) {
      s.add([path[i], path[i + 1]].sort().join('|'));
    }
    return s;
  }, [path]);

  /* ---- Recherche fly-to (8 résultats max) ---- */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return nodes
      .filter((n) => fullName(n.c).toLowerCase().includes(q) || (n.c.company ?? '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, nodes]);

  const flyTo = (id: string) => {
    const node: any = nodes.find((n) => n.id === id);
    const g = graphRef.current;
    if (node && g && node.x !== undefined) {
      g.centerAt(node.x, node.y, 500);
      g.zoom(3, 500);
    }
    if (pathTargetMode && selectedId) {
      setPath(findPath(selectedId, id));
      setPathTargetMode(false);
    } else {
      setSelectedId(id);
    }
    setQuery('');
  };

  const selected = selectedId ? data.contactById.get(selectedId) : null;

  /* ---- Rendu d'un nœud : zoom sémantique léger ---- */
  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, scale: number) => {
    const c = node.c;
    const d = degree.get(c.id) ?? 0;
    const r = 3 + Math.min(5, Math.sqrt(d));
    const onPath = path?.includes(c.id);
    const dimmed = path && !onPath;

    ctx.globalAlpha = dimmed ? 0.15 : 1;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = nodeColor(c);
    ctx.fill();

    if (bridges.has(c.id)) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 1.8, 0, 2 * Math.PI);
      ctx.strokeStyle = '#0F6F5C';
      ctx.lineWidth = 1.2 / scale;
      ctx.stroke();
    }
    if (selectedId === c.id || onPath) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 2.6, 0, 2 * Math.PI);
      ctx.strokeStyle = '#0F6F5C';
      ctx.lineWidth = 2 / scale;
      ctx.stroke();
    }

    // Étiquettes : ponts et survol toujours, tout le monde au zoom rapproché
    const showLabel = scale > 2.4 || bridges.has(c.id) || hoverRef.current === c.id || onPath || selectedId === c.id;
    if (showLabel && !dimmed) {
      const label = fullName(c);
      const fontSize = Math.max(10 / scale, 2.4);
      ctx.font = `500 ${fontSize}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#4A5350';
      ctx.fillText(label, node.x, node.y + r + fontSize + 1);
    }
    ctx.globalAlpha = 1;
  }, [degree, nodeColor, bridges, selectedId, path]);

  const steps = useMemo(() => {
    if (!path || path.length < 2) return [];
    const out: { from: any; to: any; notes: number }[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      const key = [path[i], path[i + 1]].sort().join('|');
      out.push({
        from: data.contactById.get(path[i]),
        to: data.contactById.get(path[i + 1]),
        notes: linkCount.get(key)?.count ?? 1,
      });
    }
    return out;
  }, [path, data.contactById, linkCount]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Barre d'outils */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderBottom: '1px solid var(--line)', background: 'var(--card)', flexWrap: 'wrap' }}>
        <Segmented
          options={[
            { key: 'table', label: 'Table', icon: Rows3 },
            { key: 'reseau', label: 'Réseau', icon: Share2 },
          ]}
          value="reseau"
          onChange={(v) => { if (v === 'table') navigate(`/contacts${window.location.search}`); }}
        />
        <span style={{ width: 1, height: 18, background: 'var(--line-strong)' }} />
        <span className="t-meta" style={{ color: 'var(--mut)' }}>Colorer par</span>
        <Segmented
          size="sm"
          options={MODES.map((m) => ({ key: m.key, label: m.label }))}
          value={mode}
          onChange={setMode}
        />
        <div style={{ position: 'relative', flex: 1, maxWidth: 260 }}>
          <Search size={13} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--faint)' }} />
          <input
            className="input"
            style={{ paddingLeft: 28, padding: '6px 10px 6px 28px', fontSize: 13 }}
            placeholder={pathTargetMode ? 'Me présenter à qui ?' : 'Chercher dans le réseau…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {matches.length > 0 && (
            <div className="popover" style={{ top: 'calc(100% + 4px)', left: 0, right: 0, padding: 4 }}>
              {matches.map((n) => (
                <button key={n.id} className="nav-item" onClick={() => flyTo(n.id)}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: nodeColor(n.c), flex: 'none' }} />
                  <span style={{ flex: 1 }}>{fullName(n.c)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {isolatedCount > 0 && (
          <button className={`chip clickable${showIsolated ? ' chip-filter on' : ''}`} onClick={() => setShowIsolated((o) => !o)}>
            {isolatedCount} isolés
          </button>
        )}
        {path && (
          <button className="chip clickable chip-filter on" onClick={() => setPath(null)}>
            chemin ✕
          </button>
        )}
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Canvas */}
        <div ref={wrapRef} style={{ flex: 1, background: 'var(--wash)', position: 'relative', minWidth: 0 }}>
          {nodes.length === 0 ? (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              <AICard style={{ maxWidth: 420, textAlign: 'center' }}>
                <SectionLabel>Le réseau se dessine avec vos notes</SectionLabel>
                <p className="t-sec" style={{ color: 'var(--ink-2)' }}>
                  Mentionnez une personne dans la note d'une autre (« déjeuner avec Paul et Marie »)
                  et un lien apparaît ici. Aucun lien pour l'instant dans ce cercle.
                </p>
              </AICard>
            </div>
          ) : (
            <ForceGraph2D
              ref={graphRef}
              width={dims.w}
              height={dims.h}
              graphData={{ nodes, links }}
              backgroundColor="#F5F7F6"
              nodeCanvasObject={paintNode}
              nodePointerAreaPaint={(node: any, color, ctx) => {
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(node.x, node.y, 8, 0, 2 * Math.PI);
                ctx.fill();
              }}
              linkColor={(l: any) => {
                const key = [typeof l.source === 'object' ? l.source.id : l.source, typeof l.target === 'object' ? l.target.id : l.target].sort().join('|');
                if (path) return pathEdges.has(key) ? '#0F6F5C' : 'rgba(23,27,26,0.05)';
                return 'rgba(23,27,26,0.16)';
              }}
              linkWidth={(l: any) => {
                const key = [typeof l.source === 'object' ? l.source.id : l.source, typeof l.target === 'object' ? l.target.id : l.target].sort().join('|');
                const w = Math.min(4, l.count);
                return pathEdges.has(key) ? w + 1.5 : w;
              }}
              onNodeClick={(node: any) => {
                if (pathTargetMode && selectedId) {
                  setPath(findPath(selectedId, node.id));
                  setPathTargetMode(false);
                } else {
                  setSelectedId(node.id);
                }
              }}
              onNodeHover={(node: any) => { hoverRef.current = node?.id ?? null; }}
              onBackgroundClick={() => { setSelectedId(null); setPath(null); setPathTargetMode(false); }}
              cooldownTicks={120}
            />
          )}
        </div>

        {/* Panneau droit permanent : légende au repos, contexte au clic */}
        <div style={{ width: 340, flex: 'none', borderLeft: '1px solid var(--line)', background: 'var(--card)', overflowY: 'auto', padding: '16px 18px' }}>
          {selected ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 40, height: 40, borderRadius: 999, background: avatarColor(fullName(selected)), display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 600, fontSize: 13, flex: 'none' }}>
                  {(selected.first_name?.[0] ?? '') + (selected.last_name?.[0] ?? '')}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t-name" style={{ fontSize: 16 }}>{fullName(selected)}</div>
                  <div className="t-meta" style={{ color: 'var(--mut)' }}>
                    {[selected.job_title, selected.company].filter(Boolean).join(' @ ') || 'Fiche peu renseignée'}
                  </div>
                </div>
                <button className="btn btn-quiet" style={{ padding: 5 }} onClick={() => { setSelectedId(null); setPath(null); }}><X size={14} /></button>
              </div>

              <div className="t-sec" style={{ color: 'var(--ink-2)' }}>
                <span className="tnum">{degree.get(selected.id) ?? 0}</span> lien{(degree.get(selected.id) ?? 0) > 1 ? 's' : ''} dans le réseau
                {bridges.has(selected.id) && <span style={{ color: 'var(--accent)', fontWeight: 500 }}> · contact-pont</span>}
                {' · '}{STATUS_META[relStatus(lastTouch(selected, data.lastNoteByContact.get(selected.id)))].label.toLowerCase()}
              </div>

              {selected.ai_context && (
                <AICard>
                  <SectionLabel>Mémoire</SectionLabel>
                  <div className="t-sec" style={{ color: 'var(--ink-2)' }}>{selected.ai_context}</div>
                </AICard>
              )}

              {(data.notesByContact.get(selected.id) ?? []).slice(0, 3).map((n) => (
                <div key={n.id} className="t-sec" style={{ color: 'var(--ink-2)', borderLeft: '2px solid var(--line-strong)', paddingLeft: 10 }}>
                  {n.content.slice(0, 110)}{n.content.length > 110 ? '…' : ''}
                  <div className="t-meta tnum" style={{ color: 'var(--faint)', marginTop: 2 }}>{relativeFR(n.created_at)}</div>
                </div>
              ))}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button className="btn btn-primary" style={{ justifyContent: 'center' }} onClick={() => navigate(`/reseau/${selected.id}`)}>
                  Ouvrir la fiche
                </button>
                <button className="btn btn-ghost" style={{ justifyContent: 'center' }} onClick={() => setNoteFor(selected.id)}>
                  <PenLine size={14} /> Ajouter une note
                </button>
                <button
                  className={`btn ${pathTargetMode ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ justifyContent: 'center' }}
                  onClick={() => { setPathTargetMode((o) => !o); setPath(null); }}
                >
                  <RouteIcon size={14} /> {pathTargetMode ? 'Cliquez la cible…' : 'Me présenter à…'}
                </button>
              </div>

              {path && steps.length > 0 && (
                <div>
                  <SectionLabel>Chemin d'intro · {steps.length} étape{steps.length > 1 ? 's' : ''}</SectionLabel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {steps.map((s, i) => (
                      <div key={i} className="t-sec" style={{ color: 'var(--ink-2)' }}>
                        <span className="tnum" style={{ color: 'var(--accent)', fontWeight: 600 }}>{i + 1}.</span>{' '}
                        <b>{s.from ? fullName(s.from) : '?'}</b> connaît <b>{s.to ? fullName(s.to) : '?'}</b>
                        <span className="t-meta" style={{ color: 'var(--mut)' }}>
                          {' '}({s.notes} note{s.notes > 1 ? 's' : ''} en commun)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {path === null && pathTargetMode && (
                <div className="t-meta" style={{ color: 'var(--mut)' }}>
                  Cliquez une personne dans le graphe ou cherchez-la ci-dessus.
                </div>
              )}
              {path && steps.length === 0 && (
                <div className="t-sec" style={{ color: 'var(--mut)' }}>
                  Aucun chemin dans vos notes entre ces deux personnes.
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <SectionLabel>Légende</SectionLabel>
              {mode === 'circles' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.spaces.map((s) => (
                    <div key={s.id} className="t-sec" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: CIRCLE_HEX[circleColor(s)] }} />
                      {s.name}
                    </div>
                  ))}
                </div>
              )}
              {mode === 'recency' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(['fresh', 'due', 'dormant', 'never'] as const).map((k) => (
                    <div key={k} className="t-sec" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: RECENCY_COLORS[k] }} />
                      {STATUS_META[k].label}
                      <span className="t-meta" style={{ color: 'var(--faint)' }}>(dernière trace dans Circl)</span>
                    </div>
                  ))}
                </div>
              )}
              {mode === 'degree' && (
                <div className="t-sec" style={{ color: 'var(--ink-2)' }}>
                  Plus un contact est foncé, plus il est relié. L'anneau teal marque vos 5 contacts-ponts.
                </div>
              )}
              <div className="t-sec" style={{ color: 'var(--mut)', lineHeight: '20px' }}>
                L'épaisseur d'un lien = le nombre de notes qui relient deux personnes.
                Cliquez un contact pour son contexte, puis « Me présenter à… » pour
                trouver un chemin d'introduction.
              </div>
              <div className="t-meta" style={{ color: 'var(--faint)' }}>
                Raccourcis : 1 cercles · 2 récence · 3 force · Échap tout désélectionner
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Fiche unique, partagée avec Contacts */}
      {params.id && (
        <ContactDrawer
          contactId={params.id}
          onClose={() => navigate('/reseau')}
          onNavigate={(id) => navigate(`/reseau/${id}`)}
        />
      )}

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
  );
};
