import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Sparkles, Trash2, Layers, Tag as TagIcon, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useData } from '../data';
import { useToast } from '../ui/Toast';
import { Avatar, StatusPill, ConfirmModal } from '../ui/Bits';
import { ContactDrawer } from '../ui/ContactDrawer';
import { TagsPanel } from '../ui/TagsPanel';
import { fullName, lastTouch, relStatus, relativeFR, circleColor, STATUS_META, type RelStatus } from '../ui/format';

// Page Contacts (brief 4.2) : l'espace de travail central.
// Table de travail (composant 1) + vues + bulk + fiche unique.

type ViewKey = 'all' | 'due' | 'not_enriched';

const VIEWS: { key: ViewKey; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'due', label: 'À relancer' },
  { key: 'not_enriched', label: 'Non enrichis' },
];

type SortKey = 'name' | 'company' | 'last';

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
  const [circlePicker, setCirclePicker] = useState(false);
  const [tagPicker, setTagPicker] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showTags, setShowTags] = useState(false);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  /* Enrichissement du modèle par ligne : statut, dernier échange, tags, cercle. */
  const rows = useMemo(() => {
    let base = data.selectedSpaceId
      ? data.contacts.filter((c) => c.space_id === data.selectedSpaceId)
      : data.contacts;

    // Dédoublonnage d'affichage par shared_contact_id (multi-cercles, brief 4.0.17)
    if (!data.selectedSpaceId) {
      const seen = new Set<string>();
      base = base.filter((c) => {
        const key = c.shared_contact_id ?? c.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    const q = query.trim().toLowerCase();
    let out = base.map((c) => {
      const touch = lastTouch(c, data.lastNoteByContact.get(c.id));
      return {
        c,
        name: fullName(c),
        touch,
        status: relStatus(touch),
        tags: data.tagsByContact.get(c.id) ?? [],
        space: data.spaceById.get(c.space_id),
        followUp: (data.followUpsByContact.get(c.id) ?? [])[0] ?? null,
        pendingCount: (data.pendingByContact.get(c.id) ?? []).length,
      };
    });

    if (q) {
      out = out.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        (r.c.company ?? '').toLowerCase().includes(q) ||
        (r.c.job_title ?? '').toLowerCase().includes(q) ||
        r.tags.some((t: any) => t.name.toLowerCase().includes(q))
      );
    }
    if (view === 'due') out = out.filter((r) => r.status === 'due' || r.status === 'dormant');
    if (view === 'not_enriched') out = out.filter((r) => !r.c.enriched_at);
    if (statusFilter) out = out.filter((r) => r.status === statusFilter);
    if (tagFilter) out = out.filter((r) => r.tags.some((t: any) => t.id === tagFilter));

    const bySort: Record<SortKey, (a: typeof out[0], b: typeof out[0]) => number> = {
      name: (a, b) => a.name.localeCompare(b.name, 'fr'),
      company: (a, b) => (a.c.company ?? '').localeCompare(b.c.company ?? '', 'fr'),
      last: (a, b) => (a.touch?.getTime() ?? 0) - (b.touch?.getTime() ?? 0),
    };
    out.sort(bySort[view === 'due' && sort === 'name' ? 'last' : sort]);
    return out;
  }, [data, view, query, statusFilter, tagFilter, sort]);

  const siblingIds = useMemo(() => rows.map((r) => r.c.id), [rows]);

  /* Sélection en masse */
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkDelete = async () => {
    setBulkBusy(true);
    const ids = [...selected];
    const { error } = await supabase.from('contacts').delete().in('id', ids);
    setBulkBusy(false);
    setConfirmBulkDelete(false);
    if (error) { toast(`Suppression impossible : ${error.message}`); return; }
    setSelected(new Set());
    toast(`${ids.length} contact${ids.length > 1 ? 's' : ''} supprimé${ids.length > 1 ? 's' : ''}.`);
    await data.refresh();
  };

  const bulkMoveCircle = async (spaceId: string) => {
    setCirclePicker(false);
    const ids = [...selected];
    const { error } = await supabase.from('contacts').update({ space_id: spaceId }).in('id', ids);
    if (error) { toast(`Déplacement impossible : ${error.message}`); return; }
    setSelected(new Set());
    toast(`${ids.length} contact${ids.length > 1 ? 's' : ''} déplacé${ids.length > 1 ? 's' : ''}.`);
    await data.refresh();
  };

  const bulkTag = async (tagId: string) => {
    setTagPicker(false);
    const ids = [...selected];
    const already = new Set(
      data.contactTags.filter((ct) => ct.tag_id === tagId).map((ct) => ct.contact_id)
    );
    const rowsToInsert = ids
      .filter((id) => !already.has(id))
      .map((contact_id) => ({ contact_id, tag_id: tagId, tagged_by: data.user?.id }));
    if (rowsToInsert.length === 0) { toast('Tag déjà appliqué à toute la sélection.'); return; }
    const { error } = await supabase.from('contact_tags').insert(rowsToInsert);
    if (error) { toast(`Tag impossible : ${error.message}`); return; }
    setSelected(new Set());
    toast(`Tag appliqué à ${rowsToInsert.length} contact${rowsToInsert.length > 1 ? 's' : ''}.`);
    await data.refresh();
  };

  const nbSel = selected.size;
  const counts = useMemo(() => {
    const m: Record<RelStatus, number> = { fresh: 0, due: 0, dormant: 0, never: 0 };
    for (const r of rows) m[r.status]++;
    return m;
  }, [rows]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {/* Header */}
      <div style={{ padding: '20px 28px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <h1 className="t-page">Contacts</h1>
          <span className="t-sec tnum" style={{ color: 'var(--mut)' }}>{rows.length.toLocaleString('fr-FR')}</span>
          <span style={{ flex: 1 }} />
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--faint)' }} />
            <input
              className="input"
              style={{ width: 260, paddingLeft: 30 }}
              placeholder="Rechercher…"
              value={query}
              onChange={(e) => setParam('q', e.target.value)}
            />
          </div>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={15} /> Nouveau contact
          </button>
        </div>

        {/* Vues + filtres de statut */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 12, flexWrap: 'wrap' }}>
          {VIEWS.map((v) => (
            <button
              key={v.key}
              className={`chip clickable chip-filter${view === v.key ? ' on' : ''}`}
              onClick={() => { setParam('vue', v.key === 'all' ? null : v.key); }}
            >
              {v.label}
            </button>
          ))}
          {tagFilter && (
            <button className="chip clickable chip-filter on" onClick={() => setParam('tag', null)}>
              tag : {data.tags.find((t) => t.id === tagFilter)?.name ?? '?'} ✕
            </button>
          )}
          <button className="chip clickable" onClick={() => setShowTags(true)}>Gérer les tags</button>
          <span style={{ width: 1, height: 18, background: 'var(--line-strong)', margin: '0 4px' }} />
          {(Object.keys(counts) as RelStatus[]).filter((s) => counts[s] > 0).map((s) => (
            <button
              key={s}
              className={`chip clickable chip-filter${statusFilter === s ? ' on' : ''}`}
              onClick={() => setParam('statut', statusFilter === s ? null : s)}
            >
              <span style={{ width: 8, height: 8, borderRadius: 3, background: STATUS_META[s].color, flex: 'none' }} />
              {STATUS_META[s].label} <span className="tnum" style={{ color: 'var(--mut)' }}>{counts[s]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 28px 80px' }}>
        {rows.length === 0 ? (
          <EmptyContacts hasQuery={!!query || view !== 'all' || !!statusFilter} onCreate={() => setShowCreate(true)} />
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="wtable">
              <thead>
                <tr>
                  <th style={{ width: 34 }} />
                  <th className="sortable" onClick={() => setSort('name')}>Nom</th>
                  <th className="sortable" onClick={() => setSort('company')}>Poste @ Entreprise</th>
                  <th>Statut</th>
                  <th className="sortable" onClick={() => setSort('last')}>Dernier échange</th>
                  <th>Tags</th>
                  <th>Relance</th>
                  {!data.selectedSpaceId && <th>Cercle</th>}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 400).map(({ c, name, touch, status, tags, space, pendingCount, followUp }) => (
                  <tr
                    key={c.id}
                    className={selected.has(c.id) ? 'selected' : ''}
                    onClick={() => navigate(`/contacts/${c.id}${window.location.search}`)}
                  >
                    <td onClick={(e) => { e.stopPropagation(); toggleSelect(c.id); }}>
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => {}}
                        style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
                      />
                    </td>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Avatar name={name} firstName={c.first_name} lastName={c.last_name} photoUrl={c.photo_url} size={32} />
                        <span className="t-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{name}</span>
                        {c.enriched_at && <Sparkles size={11} color="var(--accent)" aria-label="Fiche enrichie" />}
                        {pendingCount > 0 && (
                          <span className="badge" style={{ background: 'var(--accent)', color: '#fff', fontSize: 10, borderRadius: 7, padding: '0 6px', fontWeight: 600 }}>
                            {pendingCount}
                          </span>
                        )}
                      </span>
                    </td>
                    <td>
                      <span className="t-sec" style={{ color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', maxWidth: 260 }}>
                        {[c.job_title, c.company].filter(Boolean).join(' @ ') || <span style={{ color: 'var(--faint)' }}>·</span>}
                      </span>
                    </td>
                    <td><StatusPill status={status} lastTouchIso={touch?.toISOString()} /></td>
                    <td className="tnum t-sec" style={{ color: touch ? 'var(--ink-2)' : 'var(--faint)', whiteSpace: 'nowrap' }}>
                      {touch ? relativeFR(touch.toISOString()) : 'jamais'}
                    </td>
                    <td>
                      <span style={{ display: 'flex', gap: 4 }}>
                        {tags.slice(0, 2).map((t: any) => (
                          <span key={t.id} className="chip" style={{ height: 20, fontSize: 11, padding: '0 8px', ...(t.color_hex ? { borderColor: 'transparent', background: `${t.color_hex}1F`, color: t.color_hex } : {}) }}>
                            {t.name}
                          </span>
                        ))}
                        {tags.length > 2 && <span className="t-meta" style={{ color: 'var(--mut)' }}>+{tags.length - 2}</span>}
                      </span>
                    </td>
                    <td className="tnum t-sec" style={{ whiteSpace: 'nowrap' }}>
                      {followUp ? (
                        <span style={{ color: new Date(followUp.due_date) <= new Date() ? 'var(--orange)' : 'var(--ink-2)', fontWeight: new Date(followUp.due_date) <= new Date() ? 600 : 400 }}>
                          {followUp.due_date}
                        </span>
                      ) : (
                        <span className="muted" style={{ color: 'var(--faint)' }}>·</span>
                      )}
                    </td>
                    {!data.selectedSpaceId && (
                      <td>
                        {space && (
                          <span className="chip" style={{ height: 20, fontSize: 11, padding: '0 8px' }}>
                            <span style={{ width: 7, height: 7, borderRadius: 999, background: circleColor(space), flex: 'none' }} />
                            {space.name}
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 400 && (
              <div className="t-sec" style={{ color: 'var(--mut)', padding: '10px 14px' }}>
                {rows.length - 400} contacts de plus. Affinez avec la recherche ou les filtres.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Barre de sélection flottante */}
      {nbSel > 0 && (
        <div className="bulkbar">
          <span className="tnum" style={{ fontWeight: 600 }}>{nbSel} sélectionné{nbSel > 1 ? 's' : ''}</span>
          <span className="sep" />
          <div style={{ position: 'relative' }}>
            <button onClick={() => { setCirclePicker((o) => !o); setTagPicker(false); }}>
              <Layers size={14} /> Cercle
            </button>
            {circlePicker && (
              <div className="popover" style={{ bottom: 'calc(100% + 10px)', left: 0, color: 'var(--ink)' }}>
                {data.spaces.map((s) => (
                  <button key={s.id} className="nav-item" onClick={() => bulkMoveCircle(s.id)}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: circleColor(s), flex: 'none' }} />
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ position: 'relative' }}>
            <button onClick={() => { setTagPicker((o) => !o); setCirclePicker(false); }}>
              <TagIcon size={14} /> Tag
            </button>
            {tagPicker && (
              <div className="popover" style={{ bottom: 'calc(100% + 10px)', left: 0, color: 'var(--ink)', maxHeight: 260, overflowY: 'auto' }}>
                {data.tags.length === 0 && <span className="t-sec" style={{ color: 'var(--mut)' }}>Aucun tag.</span>}
                {data.tags.map((t) => (
                  <button key={t.id} className="nav-item" onClick={() => bulkTag(t.id)}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: t.color_hex ?? 'var(--faint)', flex: 'none' }} />
                    {t.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => setConfirmBulkDelete(true)} style={{ color: '#F1A9A3' }}>
            <Trash2 size={14} /> Supprimer
          </button>
          <span className="sep" />
          <button onClick={() => setSelected(new Set())}>Annuler</button>
        </div>
      )}

      {/* Fiche */}
      {params.id && (
        <ContactDrawer
          contactId={params.id}
          siblings={siblingIds}
          onClose={() => navigate(`/contacts${window.location.search}`)}
          onNavigate={(id) => navigate(`/contacts/${id}${window.location.search}`)}
        />
      )}

      {confirmBulkDelete && (
        <ConfirmModal
          title={`Supprimer ${nbSel} contact${nbSel > 1 ? 's' : ''} ?`}
          body="Cette suppression est définitive et emporte les notes, liens, mises à jour et relances rattachés à chaque fiche."
          confirmLabel="Supprimer définitivement"
          danger
          busy={bulkBusy}
          onConfirm={bulkDelete}
          onCancel={() => setConfirmBulkDelete(false)}
        />
      )}

      {showCreate && <CreateContactModal onClose={() => setShowCreate(false)} />}

      {showTags && (
        <TagsPanel
          onClose={() => setShowTags(false)}
          onFilterTag={(tagId) => setParam('tag', tagId)}
        />
      )}
    </div>
  );
};

/* État vide pédagogique (composant 15). */
const EmptyContacts: React.FC<{ hasQuery: boolean; onCreate: () => void }> = ({ hasQuery, onCreate }) => {
  const navigate = useNavigate();
  if (hasQuery) {
    return (
      <div className="card card-pad" style={{ textAlign: 'center', padding: '48px 20px' }}>
        <div className="t-block" style={{ marginBottom: 6 }}>Personne ne correspond</div>
        <div className="t-sec" style={{ color: 'var(--mut)' }}>Élargissez la recherche ou changez de vue.</div>
      </div>
    );
  }
  return (
    <div className="card card-pad" style={{ textAlign: 'center', padding: '48px 20px' }}>
      <div className="t-block" style={{ marginBottom: 6 }}>Votre réseau commence ici</div>
      <div className="t-sec" style={{ color: 'var(--mut)', marginBottom: 18 }}>
        Ajoutez une première fiche, collez un texte qui contient des contacts, ou importez depuis l'app iPhone.
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button className="btn btn-primary" onClick={onCreate}><Plus size={15} /> Nouveau contact</button>
        <button className="btn btn-ghost" onClick={() => navigate('/capture')}>Coller un texte</button>
      </div>
    </div>
  );
};

/* Création rapide d'un contact. */
const CreateContactModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const data = useData();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    first_name: '', last_name: '', company: '', job_title: '', email: '', phone: '',
  });
  const personal = data.spaces.find((s) => s.type === 'personal');
  const [spaceId, setSpaceId] = useState<string>(data.selectedSpaceId ?? personal?.id ?? data.spaces[0]?.id ?? '');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.first_name.trim() || !spaceId) return;
    setBusy(true);
    const { data: created, error } = await supabase
      .from('contacts')
      .insert({
        space_id: spaceId,
        owner_id: data.user?.id,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        company: form.company.trim() || null,
        job_title: form.job_title.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        source: 'manual',
      })
      .select('id')
      .single();
    setBusy(false);
    if (error) { toast(`Création impossible : ${error.message}`); return; }
    onClose();
    toast(`${form.first_name} ajouté.`);
    await data.refresh();
    if (created) navigate(`/contacts/${created.id}`);
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="t-block" style={{ marginBottom: 16 }}>Nouveau contact</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <input className="input" placeholder="Prénom" autoFocus value={form.first_name} onChange={(e) => set('first_name', e.target.value)} />
          <input className="input" placeholder="Nom" value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />
          <input className="input" placeholder="Poste" value={form.job_title} onChange={(e) => set('job_title', e.target.value)} />
          <input className="input" placeholder="Entreprise" value={form.company} onChange={(e) => set('company', e.target.value)} />
          <input className="input" placeholder="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          <input className="input" placeholder="Téléphone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
          <span className="t-label">Cercle</span>
          {data.spaces.map((s) => (
            <button
              key={s.id}
              className={`chip clickable chip-filter${spaceId === s.id ? ' on' : ''}`}
              onClick={() => setSpaceId(s.id)}
            >
              <span style={{ width: 8, height: 8, borderRadius: 999, background: circleColor(s), flex: 'none' }} />
              {s.name}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={!form.first_name.trim() || busy} onClick={save}>
            {busy ? 'Création…' : 'Créer la fiche'}
          </button>
        </div>
      </div>
    </div>
  );
};
