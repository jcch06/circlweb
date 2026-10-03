import React, { useEffect, useMemo, useState } from 'react';
import { X, Upload } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useData } from '../data';
import { useToast } from './Toast';
import { Avatar, SectionLabel } from './Bits';
import { fullName } from './format';

// « Pousser mon réseau » (brief 4.7) : prévisualisation avec liste,
// compteur, doublons détectés et cases à décocher, au lieu du
// window.confirm tout-ou-rien.
//
// Le moteur de dédoublonnage est celui de jcch06 (SpacesPage), porté ici :
// normalisation des vides, comparaison nom + téléphone + email contre les
// contraintes d'unicité, auto-dédoublonnage du lot, chemin rapide puis
// repli ligne par ligne sur collision. On n'y touche pas, on l'expose.

const normalize = (value: any): string | null =>
  (typeof value === 'string' && value.trim()) ? value.trim().toLowerCase() : null;

export const PushNetworkPanel: React.FC<{
  targetSpaceId: string;
  onClose: () => void;
}> = ({ targetSpaceId, onClose }) => {
  const data = useData();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [alreadyThere, setAlreadyThere] = useState<any[]>([]);
  // Sélection positive : rien n'est partagé sans avoir été coché.
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const targetSpace = data.spaceById.get(targetSpaceId);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const personalSpace = data.spaces.find((s) => s.type === 'personal');
        if (!personalSpace) throw new Error('Espace personnel introuvable.');

        const all = async (cols: string, spaceId: string) => {
          const out: any[] = [];
          for (let from = 0; ; from += 1000) {
            const { data: page, error } = await supabase.from('contacts').select(cols).eq('space_id', spaceId).range(from, from + 999);
            if (error) throw error;
            out.push(...(page ?? []));
            if (!page || page.length < 1000) return out;
          }
        };
        const [personalContacts, existingContacts] = await Promise.all([
          all('*', personalSpace.id),
          all('first_name, last_name, phone, email', targetSpaceId),
        ]);

        const existing = existingContacts ?? [];
        const existingPhones = new Set(existing.map((ec: any) => normalize(ec.phone)).filter((v): v is string => v !== null));
        const existingEmails = new Set(existing.map((ec: any) => normalize(ec.email)).filter((v): v is string => v !== null));

        const existingNames = new Set(existing.map((ec: any) => `${ec.first_name ?? ''}|${ec.last_name ?? ''}`.toLowerCase()));
        const dupes: any[] = [];
        const fresh: any[] = [];
        for (const pc of personalContacts ?? []) {
          const phone = normalize(pc.phone);
          const email = normalize(pc.email);
          const sameName = existingNames.has(`${pc.first_name ?? ''}|${pc.last_name ?? ''}`.toLowerCase());
          if (sameName || (phone && existingPhones.has(phone)) || (email && existingEmails.has(email))) {
            dupes.push(pc);
          } else {
            fresh.push(pc);
          }
        }
        setCandidates(fresh);
        setAlreadyThere(dupes);
      } catch (err: any) {
        toast(`Impossible de préparer l'envoi : ${err.message}`);
        onClose();
      } finally {
        setLoading(false);
      }
    })();
  }, [targetSpaceId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const selected = useMemo(
    () => candidates.filter((c) => checked.has(c.id)),
    [candidates, checked]
  );

  const push = async () => {
    setBusy(true);
    try {
      // Auto-dédoublonnage du lot : le carnet perso peut contenir deux fiches
      // avec le même téléphone, elles se percuteraient à l'insertion.
      const seenPhones = new Set<string>();
      const seenEmails = new Set<string>();
      const payload = selected
        .map((c) => ({ ...c, phone: normalize(c.phone), email: normalize(c.email) }))
        .filter((c) => {
          if (c.phone) { if (seenPhones.has(c.phone)) return false; seenPhones.add(c.phone); }
          if (c.email) { if (seenEmails.has(c.email)) return false; seenEmails.add(c.email); }
          return true;
        })
        .map((c) => ({
          space_id: targetSpaceId,
          owner_id: data.user.id,
          first_name: c.first_name,
          last_name: c.last_name,
          company: c.company,
          job_title: c.job_title,
          industry: c.industry,
          location: c.location,
          bio: c.bio,
          email: c.email,
          phone: c.phone,
          linkedin: c.linkedin,
          ai_context: c.ai_context,
          // Relie la copie à la fiche d'origine : une seule personne partout.
          shared_contact_id: c.shared_contact_id ?? c.id,
          source: 'manual',
        }));

      // Chemin rapide : un seul lot. Sur collision réelle (un autre membre
      // pousse au même moment, ou une ligne invisible à ce client), on repasse
      // ligne par ligne pour que les contacts sans conflit passent quand même.
      const { error } = await supabase.from('contacts').insert(payload);

      if (!error) {
        toast(`${payload.length} contact${payload.length > 1 ? 's' : ''} ajouté${payload.length > 1 ? 's' : ''} à ${targetSpace?.name}.`);
        await data.refresh();
        onClose();
        return;
      }
      if (error.code !== '23505') throw error;

      let ok = 0;
      let skipped = 0;
      for (const row of payload) {
        const { error: rowError } = await supabase.from('contacts').insert(row);
        if (rowError) {
          if (rowError.code === '23505') { skipped++; continue; }
          throw rowError;
        }
        ok++;
      }
      toast(
        `${ok} contact${ok > 1 ? 's' : ''} ajouté${ok > 1 ? 's' : ''}.` +
        (skipped > 0 ? ` ${skipped} ignoré${skipped > 1 ? 's' : ''} : déjà présent${skipped > 1 ? 's' : ''} dans le cercle.` : '')
      );
      await data.refresh();
      onClose();
    } catch (err: any) {
      toast(`Envoi impossible : ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="drawer-scrim" onClick={() => !busy && onClose()} />
      <aside className="side-panel" style={{ width: 460 }} role="dialog" aria-label="Pousser mon réseau">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <span className="t-block" style={{ flex: 1, fontSize: 16 }}>
            Pousser mon réseau vers {targetSpace?.name}
          </span>
          <button className="btn btn-quiet" style={{ padding: 6 }} onClick={onClose} disabled={busy}><X size={16} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
          {loading ? (
            <div style={{ display: 'grid', placeItems: 'center', padding: 40 }}>
              <div className="orbit-spinner" />
            </div>
          ) : (
            <>
              <p className="t-sec" style={{ color: 'var(--ink-2)', marginBottom: 16 }}>
                Cochez les contacts personnels à copier dans ce cercle : ils deviendront
                visibles par ses membres. Rien n'est partagé sans être coché.
              </p>

              {candidates.length === 0 ? (
                <div className="t-sec" style={{ color: 'var(--mut)' }}>
                  Tous vos contacts personnels sont déjà dans ce cercle.
                </div>
              ) : (
                <>
                  <SectionLabel>À copier · {selected.length} sur {candidates.length}</SectionLabel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 18 }}>
                    {candidates.map((c) => (
                      <label
                        key={c.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 4px', cursor: 'pointer', minHeight: 36 }}
                      >
                        <input
                          type="checkbox"
                          checked={checked.has(c.id)}
                          onChange={() => setChecked((prev) => {
                            const next = new Set(prev);
                            if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                            return next;
                          })}
                          style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
                        />
                        <Avatar name={fullName(c)} firstName={c.first_name} lastName={c.last_name} photoUrl={c.photo_url} size={24} />
                        <span className="t-sec" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {fullName(c)}
                          {c.company && <span style={{ color: 'var(--mut)' }}> · {c.company}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </>
              )}

              {alreadyThere.length > 0 && (
                <>
                  <SectionLabel>Déjà présents · {alreadyThere.length}</SectionLabel>
                  <p className="t-meta" style={{ color: 'var(--mut)', marginBottom: 8 }}>
                    Repérés par le nom, le téléphone ou l'email. Ils ne seront pas copiés en double.
                  </p>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {alreadyThere.slice(0, 20).map((c) => (
                      <span key={c.id} className="chip" style={{ height: 22, fontSize: 11.5, opacity: 0.7 }}>
                        {fullName(c)}
                      </span>
                    ))}
                    {alreadyThere.length > 20 && (
                      <span className="t-meta" style={{ color: 'var(--faint)', alignSelf: 'center' }}>
                        +{alreadyThere.length - 20}
                      </span>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--line)', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="t-sec tnum" style={{ flex: 1, color: 'var(--ink-2)' }}>
            {selected.length} contact{selected.length > 1 ? 's' : ''} à copier
          </span>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="btn btn-primary" onClick={push} disabled={busy || selected.length === 0}>
            <Upload size={14} /> {busy ? 'Envoi…' : 'Pousser'}
          </button>
        </div>
      </aside>
    </>
  );
};
