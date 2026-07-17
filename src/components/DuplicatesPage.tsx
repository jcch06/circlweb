import React, { useMemo, useState } from 'react';
import { Copy, Users, Check, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface DuplicatesPageProps {
  contacts: any[];
  notes: any[];
  user: any;
  onRefreshData: () => Promise<void>;
}

// Normalize a name for duplicate matching: lowercase, strip accents, collapse
// whitespace. "Jean-Christophe  Radouane" and "jean christophe radouane" match.
function normName(first: string, last: string): string {
  return `${first || ''} ${last || ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Signal richness — used to pre-select the best record to KEEP in a group.
function richness(c: any, noteCountById: Map<string, number>): number {
  const notes = noteCountById.get(c.id) || 0;
  const skills = Array.isArray(c.skills) ? c.skills.filter((s: any) => s && String(s).trim()).length : 0;
  const needs = Array.isArray(c.inferred_needs) ? c.inferred_needs.filter((n: any) => n && String(n).trim()).length : 0;
  const has = (v: any) => (typeof v === 'string' && v.trim() ? 1 : 0);
  return notes * 10 + skills * 2 + needs * 2 + has(c.job_title) + has(c.company) + has(c.bio) + has(c.email) + has(c.ai_context);
}

interface LogicalContact {
  key: string;            // shared_contact_id || id
  rep: any;               // representative row (richest)
  rowIds: string[];       // every contacts row id for this logical contact
  spaceIds: string[];
  noteCount: number;
  owned: boolean;         // user can write it (not a locked/foreign contact)
}

interface DupGroup {
  nameKey: string;
  members: LogicalContact[];
}

export const DuplicatesPage: React.FC<DuplicatesPageProps> = ({ contacts, notes, user, onRefreshData }) => {
  const [keeperByGroup, setKeeperByGroup] = useState<Record<string, string>>({});
  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  const [mergedKeys, setMergedKeys] = useState<Set<string>>(new Set());

  const noteCountById = useMemo(() => {
    const m = new Map<string, number>();
    (notes || []).forEach((n: any) => m.set(n.contact_id, (m.get(n.contact_id) || 0) + 1));
    return m;
  }, [notes]);

  const groups: DupGroup[] = useMemo(() => {
    // 1. Collapse rows into logical contacts (same contact shared across
    //    galaxies = same shared_contact_id → one logical contact, NOT a dup).
    const logicalByKey = new Map<string, LogicalContact>();
    (contacts || []).forEach((c: any) => {
      const key = c.shared_contact_id || c.id;
      const owned = c.is_unlocked !== false && (c.owner_id ? c.owner_id === user?.id : true);
      const existing = logicalByKey.get(key);
      if (!existing) {
        logicalByKey.set(key, {
          key,
          rep: c,
          rowIds: [c.id],
          spaceIds: c.space_id ? [c.space_id] : [],
          noteCount: noteCountById.get(c.id) || 0,
          owned
        });
      } else {
        existing.rowIds.push(c.id);
        if (c.space_id && !existing.spaceIds.includes(c.space_id)) existing.spaceIds.push(c.space_id);
        existing.noteCount += noteCountById.get(c.id) || 0;
        existing.owned = existing.owned && owned;
        // Keep the richest row as representative.
        if (richness(c, noteCountById) > richness(existing.rep, noteCountById)) existing.rep = c;
      }
    });

    // 2. Group logical contacts by normalized name; keep only real duplicates.
    const byName = new Map<string, LogicalContact[]>();
    logicalByKey.forEach(lc => {
      const nk = normName(lc.rep.first_name, lc.rep.last_name);
      if (!nk) return; // ignore nameless rows
      if (!byName.has(nk)) byName.set(nk, []);
      byName.get(nk)!.push(lc);
    });

    const out: DupGroup[] = [];
    byName.forEach((members, nameKey) => {
      if (members.length < 2) return;
      if (mergedKeys.has(nameKey)) return;
      // Richest first so the default keeper is the best record.
      members.sort((a, b) => richness(b.rep, noteCountById) - richness(a.rep, noteCountById));
      out.push({ nameKey, members });
    });
    // Most-duplicated groups first.
    out.sort((a, b) => b.members.length - a.members.length);
    return out;
  }, [contacts, noteCountById, user, mergedKeys]);

  const mergeGroup = async (group: DupGroup) => {
    const keeperKey = keeperByGroup[group.nameKey] || group.members[0].key;
    const keeper = group.members.find(m => m.key === keeperKey) || group.members[0];
    const dups = group.members.filter(m => m.key !== keeper.key);
    if (dups.length === 0) return;

    if (group.members.some(m => !m.owned)) {
      alert("Ce groupe contient un contact verrouillé (que vous ne possédez pas). La fusion n'est possible qu'entre vos propres contacts.");
      return;
    }

    const name = `${keeper.rep.first_name} ${keeper.rep.last_name || ''}`.trim();
    const totalNotes = dups.reduce((s, d) => s + d.noteCount, 0);
    if (!window.confirm(
      `Fusionner ${group.members.length} fiches de « ${name} » en une seule ?\n\n` +
      `• Fiche conservée : ${keeper.rep.company || keeper.rep.job_title || 'la plus complète'}\n` +
      `• ${dups.length} fiche(s) en double seront supprimées\n` +
      `• ${totalNotes} note(s) rattachée(s) aux doublons seront transférées vers la fiche conservée\n\n` +
      `Cette action est irréversible.`
    )) return;

    setBusyGroup(group.nameKey);
    try {
      const keeperRowId = keeper.rep.id;
      const dupRowIds = dups.flatMap(d => d.rowIds);

      // 1. Move notes off the duplicate rows onto the keeper (never delete a note).
      const { error: notesErr } = await supabase
        .from('notes')
        .update({ contact_id: keeperRowId })
        .in('contact_id', dupRowIds);
      if (notesErr) throw notesErr;

      // 2. Move tag links; ignore rows that would collide with an existing
      //    keeper tag (best-effort — a failed tag move must not block the merge).
      try {
        await supabase.from('contact_tags').update({ contact_id: keeperRowId }).in('contact_id', dupRowIds);
      } catch (tagErr) {
        console.warn('DuplicatesPage: tag reassignment skipped (non-fatal).', tagErr);
      }

      // 3. Delete the duplicate contact rows (all their space rows).
      const { error: delErr } = await supabase.from('contacts').delete().in('id', dupRowIds);
      if (delErr) throw delErr;

      setMergedKeys(prev => new Set(prev).add(group.nameKey));
      await onRefreshData();
    } catch (err: any) {
      console.error('DuplicatesPage merge failed', err);
      alert(`Échec de la fusion : ${err.message || 'erreur inconnue'}`);
    } finally {
      setBusyGroup(null);
    }
  };

  const totalDupContacts = groups.reduce((s, g) => s + (g.members.length - 1), 0);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Doublons</h1>
          <p style={styles.subtitle}>
            Fiches en double détectées par nom — fusionnez-les pour garder un réseau propre (les notes sont conservées et transférées).
          </p>
        </div>
        <div style={styles.counter}>
          <Copy size={18} />
          {groups.length} groupe(s) · {totalDupContacts} doublon(s)
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="glass-card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
          <Check size={36} style={{ color: 'var(--teal, #2dd4bf)', marginBottom: 12 }} />
          <h3 style={{ color: 'var(--text-primary)', marginBottom: 6 }}>Aucun doublon détecté</h3>
          <p>Chaque personne n'apparaît qu'une fois dans votre réseau. 🎉</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {groups.map(group => {
            const keeperKey = keeperByGroup[group.nameKey] || group.members[0].key;
            const hasLocked = group.members.some(m => !m.owned);
            return (
              <div key={group.nameKey} className="glass-card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                  <Users size={18} style={{ color: 'var(--accent)' }} />
                  <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.1rem' }}>
                    {group.members[0].rep.first_name} {group.members[0].rep.last_name}
                  </h3>
                  <span style={styles.badge}>{group.members.length} fiches</span>
                  {hasLocked && (
                    <span style={{ ...styles.badge, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <AlertTriangle size={12} /> contact verrouillé — fusion indisponible
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                  {group.members.map(m => {
                    const isKeeper = m.key === keeperKey;
                    return (
                      <label
                        key={m.key}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 8,
                          border: `1px solid ${isKeeper ? 'var(--accent)' : 'var(--border)'}`,
                          background: isKeeper ? 'rgba(45, 212, 191, 0.06)' : 'transparent', cursor: 'pointer'
                        }}
                      >
                        <input
                          type="radio"
                          name={`keeper-${group.nameKey}`}
                          checked={isKeeper}
                          onChange={() => setKeeperByGroup(prev => ({ ...prev, [group.nameKey]: m.key }))}
                          style={{ marginTop: 3 }}
                        />
                        <div style={{ flex: 1, fontSize: '0.85rem' }}>
                          <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                            {m.rep.job_title || 'Poste inconnu'} {m.rep.company ? `· ${m.rep.company}` : ''}
                            {isKeeper && <span style={{ color: 'var(--accent)', marginLeft: 8, fontSize: '0.72rem', fontWeight: 700 }}>À CONSERVER</span>}
                          </div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: 2 }}>
                            {m.rep.email ? `${m.rep.email} · ` : ''}
                            {m.noteCount} note(s) · présent dans {m.spaceIds.length || 1} galaxie(s)
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>

                <button
                  className="btn-primary"
                  disabled={hasLocked || busyGroup === group.nameKey}
                  onClick={() => mergeGroup(group)}
                  style={{ padding: '9px 18px', fontSize: '0.85rem', opacity: hasLocked ? 0.5 : 1 }}
                >
                  {busyGroup === group.nameKey ? 'Fusion…' : `Fusionner en 1 fiche`}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '30px', height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 24 },
  header: { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  title: { fontSize: '2.25rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 },
  subtitle: { fontSize: '0.95rem', color: 'var(--text-secondary)', maxWidth: 620 },
  counter: { display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: 600 },
  badge: {
    fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', padding: '3px 8px', borderRadius: 5,
    background: 'rgba(27, 23, 37, 0.06)', color: 'var(--text-secondary)', border: '1px solid var(--border)'
  }
};
