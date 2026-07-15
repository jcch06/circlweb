import React, { useEffect, useMemo, useState } from 'react';
import {
  X, Mail, Phone, Link2, MapPin, Briefcase, ChevronDown, ChevronRight,
  Trash2, Sparkles, ArrowLeft, Lock,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useData } from '../data';
import { useToast } from './Toast';
import { Avatar, StatusPill, DecisionPair, DiffLine, AICard, ConfirmModal, SectionLabel } from './Bits';
import { NoteComposer } from './NoteComposer';
import { Timeline } from './Timeline';
import { fullName, lastTouch, relStatus, relativeFR, circleColor } from './format';

// Composant 5 : la fiche contact, unique dans toute l'application.
// Panneau 640 px, Échap ferme, ↑/↓ change de contact, pile de navigation
// interne pour les rebonds contact vers contact.

const FIELD_LABELS: Record<string, string> = {
  company: 'Entreprise', job_title: 'Poste', industry: 'Secteur',
  location: 'Lieu', linkedin: 'LinkedIn', bio: 'Bio',
};

export const ContactDrawer: React.FC<{
  contactId: string;
  siblings?: string[];           // ids ordonnés de la liste courante, pour ↑/↓
  onClose: () => void;
  onNavigate: (id: string) => void;
}> = ({ contactId, siblings, onClose, onNavigate }) => {
  const data = useData();
  const { toast } = useToast();
  const [stack, setStack] = useState<string[]>([]);
  const [infoOpen, setInfoOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [enriching, setEnriching] = useState(false);

  const contact = data.contactById.get(contactId);

  /* Clavier : Échap ferme (ou remonte la pile), ↑/↓ navigue dans la liste. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return;
      if (e.key === 'Escape') {
        if (stack.length > 0) {
          const prev = stack[stack.length - 1];
          setStack((s) => s.slice(0, -1));
          onNavigate(prev);
        } else onClose();
      }
      if (siblings && siblings.length > 1 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const idx = siblings.indexOf(contactId);
        if (idx === -1) return;
        e.preventDefault();
        const next = e.key === 'ArrowDown'
          ? siblings[Math.min(siblings.length - 1, idx + 1)]
          : siblings[Math.max(0, idx - 1)];
        if (next !== contactId) { setStack([]); onNavigate(next); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [contactId, siblings, stack, onClose, onNavigate]);

  const pending = data.pendingByContact.get(contactId) ?? [];
  const links = useMemo(() => {
    const arr = data.linksByContact.get(contactId) ?? [];
    const seen = new Set<string>();
    const out: any[] = [];
    for (const l of arr) {
      const otherId = l.from_contact_id === contactId ? l.to_contact_id : l.from_contact_id;
      if (seen.has(otherId)) continue;
      seen.add(otherId);
      const other = data.contactById.get(otherId);
      if (other) out.push(other);
    }
    return out;
  }, [data.linksByContact, data.contactById, contactId]);

  if (!contact) return null;

  const name = fullName(contact);
  const touch = lastTouch(contact, data.lastNoteByContact.get(contactId));
  const status = relStatus(touch);
  const tags = data.tagsByContact.get(contactId) ?? [];
  const locked = contact.contact_sharing_mode === 'request_only' && !contact.email && !contact.phone;
  const noteCount = (data.notesByContact.get(contactId) ?? []).length;
  const linkCount = links.length;

  const hop = (id: string) => {
    setStack((s) => [...s, contactId]);
    onNavigate(id);
  };

  const decide = async (u: any, confirm: boolean) => {
    const { error } = await supabase.rpc(
      confirm ? 'confirm_contact_update' : 'dismiss_contact_update',
      { p_update_id: u.id }
    );
    if (error) { toast(`Échec : ${error.message}`); return; }
    toast(confirm ? 'Mise à jour appliquée.' : 'Mise à jour écartée.');
    await data.refresh();
  };

  const toggleCircle = async (spaceId: string, member: boolean) => {
    // Architecture actuelle : un contact appartient à UN cercle (space_id).
    // Retirer du dernier cercle est donc impossible ; déplacer = update.
    if (member) {
      toast('Un contact appartient à au moins un cercle. Déplacez-le plutôt vers un autre cercle.');
      return;
    }
    const { error } = await supabase.from('contacts').update({ space_id: spaceId }).eq('id', contactId);
    if (error) { toast(`Déplacement impossible : ${error.message}`); return; }
    toast(`${contact.first_name} déplacé vers ce cercle.`);
    await data.refresh();
  };

  const enrich = async () => {
    setEnriching(true);
    try {
      const res: any = await supabase.functions.invoke('enrich-contact', {
        body: { contact_id: contactId },
      });
      if (res.error) throw res.error;
      toast('Fiche enrichie.');
      await data.refresh();
    } catch (err: any) {
      toast(`Enrichissement impossible : ${err.message ?? 'erreur'}`);
    } finally {
      setEnriching(false);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    const { error } = await supabase.from('contacts').delete().eq('id', contactId);
    setDeleting(false);
    setConfirmDelete(false);
    if (error) { toast(`Suppression impossible : ${error.message}`); return; }
    onClose();
    toast(`${name} supprimé.`);
    await data.refresh();
  };

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={`Fiche de ${name}`}>
        {/* En-tête */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderBottom: '1px solid var(--line)' }}>
          {stack.length > 0 && (
            <button
              className="btn btn-quiet" style={{ padding: 6 }}
              title="Retour"
              onClick={() => {
                const prev = stack[stack.length - 1];
                setStack((s) => s.slice(0, -1));
                onNavigate(prev);
              }}
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <span className="t-label" style={{ flex: 1 }}>Fiche</span>
          {siblings && siblings.length > 1 && (
            <span className="t-meta" style={{ color: 'var(--faint)' }}>↑↓ pour naviguer</span>
          )}
          <button className="btn btn-quiet" style={{ padding: 6 }} onClick={onClose} title="Fermer (Échap)">
            <X size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* 1. Bandeau mises à jour à traiter */}
          {pending.length > 0 && (
            <AICard>
              <SectionLabel>{pending.length > 1 ? `${pending.length} mises à jour à traiter` : 'Mise à jour à traiter'}</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {pending.map((u) => (
                  <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {u.field ? (
                        <DiffLine field={FIELD_LABELS[u.field] ?? u.field} oldValue={u.old_value} newValue={u.new_value ?? ''} />
                      ) : (
                        <span className="t-sec">{u.summary}</span>
                      )}
                    </div>
                    <DecisionPair onNo={() => decide(u, false)} onYes={() => decide(u, true)} />
                  </div>
                ))}
              </div>
            </AICard>
          )}

          {/* 2. Identité et actions */}
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <Avatar name={name} firstName={contact.first_name} lastName={contact.last_name} photoUrl={contact.photo_url} size={56} locked={locked} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="t-page" style={{ fontSize: 20, lineHeight: '26px' }}>{name}</div>
              {(contact.job_title || contact.company) && (
                <div className="t-sec" style={{ color: 'var(--ink-2)', marginTop: 2 }}>
                  {[contact.job_title, contact.company].filter(Boolean).join(' @ ')}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <StatusPill
                  status={status}
                  lastTouchIso={touch?.toISOString()}
                  onMarkContacted={async () => {
                    const now = new Date().toISOString();
                    const { error } = await supabase.from('contacts').update({ last_contacted_at: now }).eq('id', contactId);
                    if (error) toast(`Échec : ${error.message}`);
                    else { toast('Contact marqué comme joint.'); await data.refresh(); }
                  }}
                />
                {touch && <span className="t-meta tnum" style={{ color: 'var(--mut)' }}>dernier échange {relativeFR(touch.toISOString())}</span>}
              </div>
            </div>
          </div>

          {locked ? (
            <div style={{ background: 'var(--orange-soft)', borderRadius: 'var(--r-el)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Lock size={15} color="var(--orange)" />
              <span className="t-sec" style={{ color: 'var(--orange)', flex: 1 }}>
                Ce contact est verrouillé par son propriétaire : seuls le prénom et le nom sont partagés.
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {contact.email && (
                <a className="chip clickable" href={`mailto:${contact.email}`}><Mail size={12} />{contact.email}</a>
              )}
              {contact.phone && (
                <a className="chip clickable" href={`tel:${contact.phone}`}><Phone size={12} />{contact.phone}</a>
              )}
              {contact.linkedin && (
                <a className="chip clickable" href={contact.linkedin} target="_blank" rel="noreferrer"><Link2 size={12} />LinkedIn</a>
              )}
              {contact.location && (
                <span className="chip"><MapPin size={12} />{contact.location}</span>
              )}
            </div>
          )}

          {/* 3. Carte Mémoire : ne s'affiche jamais vide */}
          {contact.ai_context && (
            <AICard>
              <SectionLabel style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={12} /> Mémoire
              </SectionLabel>
              <div className="t-sec" style={{ color: 'var(--ink-2)', lineHeight: '21px' }}>{contact.ai_context}</div>
            </AICard>
          )}

          {/* 4. Composer de note : le geste principal de la fiche */}
          <NoteComposer contactId={contactId} contactFirstName={contact.first_name} />

          {/* 5. Timeline */}
          <div>
            <SectionLabel>Activité</SectionLabel>
            <Timeline contact={contact} onOpenContact={hop} />
          </div>

          {/* 6. Connexions */}
          {links.length > 0 && (
            <div>
              <SectionLabel>Connexions</SectionLabel>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {links.map((other) => (
                  <button key={other.id} className="chip clickable" onClick={() => hop(other.id)}>
                    <Avatar name={fullName(other)} firstName={other.first_name} lastName={other.last_name} photoUrl={other.photo_url} size={24} />
                    <span style={{ marginLeft: 2 }}>{fullName(other)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 7. Infos repliables */}
          <div>
            <button
              className="btn btn-quiet"
              style={{ padding: '4px 0', gap: 5 }}
              onClick={() => setInfoOpen((o) => !o)}
            >
              {infoOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span className="t-label" style={{ color: 'var(--mut)' }}>Infos</span>
            </button>
            {infoOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 10 }}>
                {Array.isArray(contact.skills) && contact.skills.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {contact.skills.map((s: string) => <span key={s} className="chip chip-skill">{s}</span>)}
                  </div>
                )}
                {Array.isArray(contact.inferred_needs) && contact.inferred_needs.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {contact.inferred_needs.map((s: string) => <span key={s} className="chip chip-need">cherche : {s}</span>)}
                  </div>
                )}
                {tags.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {tags.map((t: any) => (
                      <span key={t.id} className="chip" style={t.color_hex ? { borderColor: 'transparent', background: `${t.color_hex}1F`, color: t.color_hex } : undefined}>
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}
                {contact.industry && (
                  <div className="t-sec" style={{ color: 'var(--ink-2)', display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Briefcase size={13} color="var(--mut)" /> {contact.industry}
                    {contact.company_size ? ` · ${contact.company_size}` : ''}
                  </div>
                )}
                {contact.bio && (
                  <div className="t-sec" style={{ color: 'var(--ink-2)', lineHeight: '21px' }}>{contact.bio}</div>
                )}
                {!contact.bio && !contact.industry && tags.length === 0 && (
                  <div className="t-sec" style={{ color: 'var(--mut)' }}>
                    Fiche peu renseignée.
                    <button className="btn btn-ghost" style={{ marginLeft: 10, padding: '4px 10px' }} onClick={enrich} disabled={enriching}>
                      <Sparkles size={13} /> {enriching ? 'Enrichissement…' : 'Compléter via l’IA'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 8. Pied administratif */}
        <div style={{ borderTop: '1px solid var(--line)', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--wash)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="t-label" style={{ marginRight: 2 }}>Cercle</span>
            {data.spaces.map((s) => {
              const member = contact.space_id === s.id;
              return (
                <button
                  key={s.id}
                  className={`chip clickable${member ? ' chip-filter on' : ''}`}
                  onClick={() => toggleCircle(s.id, member)}
                  title={member ? 'Cercle actuel' : `Déplacer vers ${s.name}`}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: circleColor(s), flex: 'none' }} />
                  {s.name}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="t-meta" style={{ color: 'var(--mut)' }}>
              Source : {contact.source === 'iphone_import' ? 'import iPhone' : contact.source === 'enrichment' ? 'enrichissement' : 'manuel'}
              {contact.enriched_at ? ` · enrichi ${relativeFR(contact.enriched_at)}` : ''}
            </span>
            <span style={{ flex: 1 }} />
            <button className="btn btn-danger" style={{ padding: '6px 11px' }} onClick={() => setConfirmDelete(true)}>
              <Trash2 size={13} /> Supprimer
            </button>
          </div>
        </div>
      </aside>

      {confirmDelete && (
        <ConfirmModal
          title={`Supprimer ${name} ?`}
          body={
            <>
              Cette suppression est définitive et emporte tout ce qui est rattaché à cette fiche :{' '}
              <b>{noteCount} note{noteCount > 1 ? 's' : ''}</b>, <b>{linkCount} lien{linkCount > 1 ? 's' : ''}</b>,
              {' '}ses mises à jour et ses relances.
            </>
          }
          confirmLabel="Supprimer définitivement"
          danger
          busy={deleting}
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
};
