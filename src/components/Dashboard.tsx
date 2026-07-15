import React, { useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { Database, AlertCircle } from 'lucide-react';

interface DashboardProps {
  contacts: any[];
  spaces: any[];
  notes: any[];
  tags: any[];
  selectedSpaceId: string | null;
  user: any;
  onRefreshData: () => Promise<void>;
  setActiveTab: (tab: any) => void;
  setSelectedSpaceId: (id: string | null) => void;
  onNewContact: () => void;
}

/* Palette d'avatars alignée sur l'app iOS (source de vérité du design system) */
const AVATAR_HUES = [
  '#F27373', '#F29A4D', '#D9B840', '#61C785', '#4FB8D9',
  '#4F8EF7', '#9E7AE6', '#E680BF', '#8C99B3', '#73C7B8',
];
const hueFor = (seed: string) => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
};
const initialsOf = (c: any) =>
  `${(c.first_name || '').charAt(0)}${(c.last_name || '').charAt(0)}`.toUpperCase() || '?';
const fullName = (c: any) => [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Sans nom';

const DAY = 86400000;
const frDate = (iso: string) => {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / DAY);
  if (days === 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 30) return `il y a ${days} j`;
  if (days < 365) return `il y a ${Math.floor(days / 30)} mois`;
  return `il y a ${Math.floor(days / 365)} an${Math.floor(days / 365) > 1 ? 's' : ''}`;
};

const SECTOR_CLASS: Record<string, string> = {
  fintech: 'p-fin', tech: 'p-tech', santé: 'p-sante', sante: 'p-sante',
  politique: 'p-pol', énergie: 'p-ener', energie: 'p-ener',
};

export const Dashboard: React.FC<DashboardProps> = ({
  contacts,
  spaces,
  notes,
  tags,
  selectedSpaceId,
  user,
  onRefreshData,
  setActiveTab,
  setSelectedSpaceId,
  onNewContact,
}) => {
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [tab, setTab] = useState<'recontacter' | 'recents'>('recontacter');
  const [spaceMenuOpen, setSpaceMenuOpen] = useState(false);

  const displayedContacts = useMemo(
    () => (selectedSpaceId ? contacts.filter((c) => c.space_id === selectedSpaceId) : contacts),
    [contacts, selectedSpaceId]
  );
  const displayedNotes = useMemo(
    () => (selectedSpaceId ? notes.filter((n) => displayedContacts.some((c) => c.id === n.contact_id)) : notes),
    [notes, displayedContacts, selectedSpaceId]
  );

  /* Dernier échange par contact, calculé depuis les notes */
  const lastNoteByContact = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of displayedNotes) {
      const prev = m.get(n.contact_id);
      if (!prev || new Date(n.created_at) > new Date(prev)) m.set(n.contact_id, n.created_at);
    }
    return m;
  }, [displayedNotes]);

  /* --- Tuiles : uniquement des chiffres réellement calculables --- */
  const completude = useMemo(() => {
    if (!displayedContacts.length) return 0;
    const filled = displayedContacts.filter(
      (c) => c.company && c.job_title && (c.bio || c.ai_context)
    ).length;
    return Math.round((filled / displayedContacts.length) * 100);
  }, [displayedContacts]);

  const aRecontacter = useMemo(
    () =>
      displayedContacts
        .map((c) => ({ c, last: lastNoteByContact.get(c.id) }))
        .filter(({ last }) => !last || Date.now() - new Date(last).getTime() > 90 * DAY)
        .sort((a, b) => {
          if (!a.last) return -1;
          if (!b.last) return 1;
          return new Date(a.last).getTime() - new Date(b.last).getTime();
        }),
    [displayedContacts, lastNoteByContact]
  );

  const recents = useMemo(
    () =>
      displayedContacts
        .map((c) => ({ c, last: lastNoteByContact.get(c.id) }))
        .filter(({ last }) => !!last)
        .sort((a, b) => new Date(b.last!).getTime() - new Date(a.last!).getTime()),
    [displayedContacts, lastNoteByContact]
  );

  const nouveauxCeMois = useMemo(() => {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return displayedContacts.filter((c) => c.created_at && new Date(c.created_at) >= start).length;
  }, [displayedContacts]);

  /* --- Activité : notes du mois vs mois précédent --- */
  const activity = useMemo(() => {
    const now = new Date();
    const startThis = new Date(now.getFullYear(), now.getMonth(), 1);
    const startPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const thisMonth = displayedNotes.filter((n) => new Date(n.created_at) >= startThis).length;
    const prevMonth = displayedNotes.filter((n) => {
      const d = new Date(n.created_at);
      return d >= startPrev && d < startThis;
    }).length;
    const delta = prevMonth === 0 ? (thisMonth > 0 ? 100 : 0) : Math.round(((thisMonth - prevMonth) / prevMonth) * 100);
    return { thisMonth, delta };
  }, [displayedNotes]);

  /* --- Heatmap : 6 derniers mois × 4 semaines, comptage réel des notes --- */
  const heat = useMemo(() => {
    const now = new Date();
    const months: { label: string; weeks: number[] }[] = [];
    for (let i = 5; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const weeks = [0, 0, 0, 0];
      for (const n of displayedNotes) {
        const d = new Date(n.created_at);
        if (d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth()) {
          weeks[Math.min(3, Math.floor((d.getDate() - 1) / 7))]++;
        }
      }
      months.push({ label: m.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''), weeks });
    }
    const max = Math.max(1, ...months.flatMap((m) => m.weeks));
    return { months, max };
  }, [displayedNotes]);

  const prenom =
    user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || '';
  const spaceLabel = selectedSpaceId
    ? spaces.find((s) => s.id === selectedSpaceId)?.name || 'Espace'
    : 'Toutes les galaxies';

  const handleGenerateDemoData = async () => {
    setLoadingDemo(true);
    setDemoError(null);

    try {
      let targetSpaceId = selectedSpaceId;
      if (!targetSpaceId) {
        const { data: personalSpace } = await supabase
          .from('spaces')
          .select('id')
          .eq('type', 'personal')
          .eq('created_by', user.id)
          .maybeSingle();

        targetSpaceId = personalSpace?.id || (spaces.length > 0 ? spaces[0].id : null);
      }

      if (!targetSpaceId) {
        throw new Error('Aucun espace trouvé pour insérer les données. Veuillez recharger la page.');
      }

      const demoContacts = [
        {
          space_id: targetSpaceId, owner_id: user.id,
          first_name: 'Alice', last_name: 'Martin',
          company: 'GreenTech Solutions', job_title: 'Fondatrice & CEO',
          industry: 'Santé', location: 'Paris, France',
          bio: 'Développe un produit SaaS de gestion de carbone pour entreprises. Cherche des fonds et un développeur.',
          source: 'manual',
          ai_context: 'Profil dynamique. Alice cherche un associé technique (Dev React/Node) pour finaliser son MVP et se prépare pour une levée de fonds en septembre.',
        },
        {
          space_id: targetSpaceId, owner_id: user.id,
          first_name: 'Bob', last_name: 'Dubois',
          company: 'FreeCode', job_title: 'Architecte Software',
          industry: 'Tech', location: 'Lyon, France',
          bio: 'Développeur FullStack chevronné. Passionné par les projets écologiques et la transition écologique.',
          source: 'manual',
          ai_context: 'Bob cherche un projet à impact à rejoindre en tant que cofondateur technique ou consultant senior. Il maîtrise Node.js, React et PostgreSQL.',
        },
        {
          space_id: targetSpaceId, owner_id: user.id,
          first_name: 'Chloé', last_name: 'Bernard',
          company: 'Galactic Ventures', job_title: 'VC Investor',
          industry: 'Fintech', location: 'Paris, France',
          bio: 'Investit en Pre-seed et Seed dans des projets SaaS B2B, climatetech et fintech.',
          source: 'manual',
          ai_context: "Investisseur à l'écoute. Chloé cherche de nouveaux projets GreenTech ou SaaS à financer. Ticket moyen : 250k€.",
        },
        {
          space_id: targetSpaceId, owner_id: user.id,
          first_name: 'Damien', last_name: 'Petit',
          company: 'FlowPay', job_title: 'Directeur Marketing',
          industry: 'Fintech', location: 'Bordeaux, France',
          bio: 'Expert en acquisition digitale, SEO et Growth Hacking B2B. Auparavant chez Stripe.',
          source: 'manual',
          ai_context: "Damien peut aider sur la stratégie d'acquisition. Il cherche des freelances UI/UX pour refondre le site web de FlowPay.",
        },
        {
          space_id: targetSpaceId, owner_id: user.id,
          first_name: 'Elsa', last_name: 'Morel',
          company: 'Studio Pixel', job_title: 'Product Designer UI/UX',
          industry: 'Tech', location: 'Marseille, France',
          bio: "Designer d'interfaces mobiles et web. Spécialisée en design systems et SaaS.",
          source: 'manual',
          ai_context: 'Elsa cherche des projets SaaS B2B ou Fintech en freelance. Elle a un excellent portfolio et cherche des intros auprès de boîtes comme FlowPay.',
        },
      ];

      const { data: insertedContacts, error: insertError } = await supabase
        .from('contacts')
        .insert(demoContacts)
        .select();

      if (insertError) throw insertError;
      if (!insertedContacts || insertedContacts.length === 0) throw new Error("Erreur d'insertion");

      const demoNotes = [
        {
          contact_id: insertedContacts[0].id, author_id: user.id,
          content: "Rencontrée au Meetup Tech de Paris. Elle cherche désespérément un CTO associé pour coder la version 2. Elle a déjà des marques d'intérêt de 5 clients.",
          context: 'professional', is_private: false,
        },
        {
          contact_id: insertedContacts[1].id, author_id: user.id,
          content: "Bob veut s'investir dans un projet écologique. Il m'a dit être disponible immédiatement pour faire du conseil ou s'associer si l'équipe est bonne.",
          context: 'professional', is_private: false,
        },
        {
          contact_id: insertedContacts[2].id, author_id: user.id,
          content: "Chloé cherche des deals dans la ClimateTech en France. Elle m'a demandé si je connaissais des projets sérieux en cours de création.",
          context: 'professional', is_private: false,
        },
        {
          contact_id: insertedContacts[3].id, author_id: user.id,
          content: 'Damien cherche un designer UI/UX pour une mission de 3 semaines sur leur nouveau dashboard de paiement.',
          context: 'professional', is_private: false,
        },
        {
          contact_id: insertedContacts[4].id, author_id: user.id,
          content: 'Elsa cherche des clients en freelance dans le domaine Fintech. Elle est très réactive.',
          context: 'professional', is_private: false,
        },
      ];

      const { error: notesError } = await supabase.from('notes').insert(demoNotes);
      if (notesError) throw notesError;

      const techTag = tags.find((t) => t.name.toLowerCase() === 'tech' && t.space_id === targetSpaceId);
      const fintechTag = tags.find((t) => t.name.toLowerCase() === 'fintech' && t.space_id === targetSpaceId);
      const contactTagRows: any[] = [];

      if (techTag) {
        contactTagRows.push(
          { contact_id: insertedContacts[1].id, tag_id: techTag.id, tagged_by: user.id },
          { contact_id: insertedContacts[4].id, tag_id: techTag.id, tagged_by: user.id }
        );
      }
      if (fintechTag) {
        contactTagRows.push(
          { contact_id: insertedContacts[2].id, tag_id: fintechTag.id, tagged_by: user.id },
          { contact_id: insertedContacts[3].id, tag_id: fintechTag.id, tagged_by: user.id }
        );
      }
      if (contactTagRows.length > 0) {
        await supabase.from('contact_tags').insert(contactTagRows);
      }

      await onRefreshData();
    } catch (err: any) {
      console.error(err);
      setDemoError(err.message || 'Une erreur est survenue.');
    } finally {
      setLoadingDemo(false);
    }
  };

  const rows = tab === 'recontacter' ? aRecontacter : recents;

  return (
    <div className="main">
      {/* ---------- en-tête ---------- */}
      <div className="top">
        <div>
          <div className="h">{prenom ? `Bonjour, ${prenom}` : 'Bonjour'}</div>
          <div className="sub">Voici l'état de votre réseau aujourd'hui</div>
        </div>
        <div className="toolbar">
          <div style={{ position: 'relative' }}>
            <button className="pillbtn" onClick={() => setSpaceMenuOpen((o) => !o)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                <path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" />
              </svg>
              {spaceLabel}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {spaceMenuOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setSpaceMenuOpen(false)} />
                <div
                  style={{
                    position: 'absolute', top: 'calc(100% + 6px)', left: 0, minWidth: 220,
                    background: '#fff', border: '1px solid var(--line)', borderRadius: 12,
                    padding: 6, boxShadow: '0 12px 30px -14px rgba(20,30,30,.3)', zIndex: 11,
                  }}
                >
                  <button
                    className={`nav-i${selectedSpaceId === null ? ' on' : ''}`}
                    onClick={() => { setSelectedSpaceId(null); setSpaceMenuOpen(false); }}
                  >
                    <span className="t">Toutes les galaxies</span>
                  </button>
                  {spaces.map((s) => (
                    <button
                      key={s.id}
                      className={`nav-i${selectedSpaceId === s.id ? ' on' : ''}`}
                      onClick={() => { setSelectedSpaceId(s.id); setSpaceMenuOpen(false); }}
                    >
                      <span className="t">{s.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button className="btn-teal" onClick={onNewContact}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Nouveau contact
          </button>
        </div>
      </div>

      {demoError && (
        <div
          className="card"
          style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, borderColor: 'var(--red)' }}
        >
          <AlertCircle size={18} color="var(--red)" />
          <span style={{ fontSize: 13.5, color: 'var(--red)' }}>{demoError}</span>
        </div>
      )}

      {/* ---------- état vide ---------- */}
      {displayedContacts.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 20px' }}>
          <div className="mic" style={{ marginBottom: 18 }}>
            <span className="in">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                <circle cx="12" cy="8" r="3.2" /><path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
              </svg>
            </span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Votre réseau est vide</div>
          <div style={{ fontSize: 13.5, color: 'var(--mut)', marginBottom: 20 }}>
            Ajoutez un premier contact, ou générez un jeu de données pour explorer la galaxie et l'Oracle.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button className="btn-teal" onClick={onNewContact}>Ajouter un contact</button>
            <button className="btn-ghost2" onClick={handleGenerateDemoData} disabled={loadingDemo}>
              <Database size={15} />
              {loadingDemo ? 'Génération...' : 'Générer des données démo'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ---------- tuiles ---------- */}
          <div className="tiles">
            <div className="tile" style={{ cursor: 'pointer' }} onClick={() => setActiveTab('contacts')}>
              <div className="lab">
                <span className="ic" style={{ background: 'var(--teal)' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="9" cy="8" r="3" /><path d="M4 20c0-3 2.5-5 5-5s5 2 5 5" /><path d="M16 6a3 3 0 0 1 0 6" />
                  </svg>
                </span>
                Contacts
              </div>
              <div className="v">{displayedContacts.length.toLocaleString('fr-FR')}</div>
              <div className={`d ${nouveauxCeMois > 0 ? 'up' : 'flat'}`}>
                {nouveauxCeMois > 0 ? `▲ ${nouveauxCeMois} ce mois` : 'aucun ce mois'}
              </div>
            </div>

            <div className="tile">
              <div className="lab">
                <span className="ic" style={{ background: 'var(--blue)' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 12l5 5L20 6" />
                  </svg>
                </span>
                Complétude
              </div>
              <div className="v">{completude}%</div>
              <div className="d flat">poste, entreprise et contexte</div>
            </div>

            <div className="tile" style={{ cursor: 'pointer' }} onClick={() => setActiveTab('notes')}>
              <div className="lab">
                <span className="ic" style={{ background: 'var(--violet)' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 3h9l4 4v14H6z" /><path d="M9 12h7M9 16h5" />
                  </svg>
                </span>
                Notes
              </div>
              <div className="v">{displayedNotes.length.toLocaleString('fr-FR')}</div>
              <div className={`d ${activity.thisMonth > 0 ? 'up' : 'flat'}`}>
                {activity.thisMonth > 0 ? `▲ ${activity.thisMonth} ce mois` : 'aucune ce mois'}
              </div>
            </div>

            <div className="tile" style={{ cursor: 'pointer' }} onClick={() => setTab('recontacter')}>
              <div className="lab">
                <span className="ic" style={{ background: 'var(--orange)' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M13 2L3 14h7l-1 8 10-12h-7z" />
                  </svg>
                </span>
                À recontacter
              </div>
              <div className="v">{aRecontacter.length}</div>
              <div className="d flat">sans échange depuis 90 j</div>
            </div>
          </div>

          {/* ---------- activité + derniers échanges ---------- */}
          <div className="cols">
            <div className="card">
              <div className="ch"><span className="t">Activité du réseau</span></div>
              <div className="att-big">
                <span className="n">{activity.thisMonth}</span>
                {activity.delta !== 0 && (
                  <span
                    className="p"
                    style={
                      activity.delta < 0
                        ? { color: 'var(--red)', background: 'var(--rose-soft)' }
                        : undefined
                    }
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                      <path d={activity.delta < 0 ? 'M4 6l10 10 4-4 4 8' : 'M4 18L14 8l4 4 4-8'} />
                    </svg>
                    {Math.abs(activity.delta)}%
                  </span>
                )}
              </div>
              <div className="att-sub">notes enregistrées ce mois-ci</div>
              <div className="heat">
                {[0, 1, 2, 3].map((w) => (
                  <React.Fragment key={w}>
                    <span className="yl">S{w + 1}</span>
                    {heat.months.map((m) => (
                      <span
                        key={`${m.label}-${w}`}
                        className="cell"
                        title={`${m.weeks[w]} note${m.weeks[w] > 1 ? 's' : ''} · ${m.label}, semaine ${w + 1}`}
                        style={{ opacity: m.weeks[w] === 0 ? 0.06 : 0.2 + 0.8 * (m.weeks[w] / heat.max) }}
                      />
                    ))}
                  </React.Fragment>
                ))}
                <span />
                {heat.months.map((m) => (
                  <span key={m.label} className="xl">{m.label}</span>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="ch">
                <span className="t">Derniers échanges</span>
                <span className="dots" style={{ fontSize: 13, color: 'var(--teal)' }} onClick={() => setActiveTab('notes')}>
                  Tout voir
                </span>
              </div>
              {displayedNotes.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--mut)', padding: '12px 0' }}>Aucune note pour l'instant.</div>
              ) : (
                [...displayedNotes]
                  .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                  .slice(0, 4)
                  .map((n) => {
                    const c = displayedContacts.find((x) => x.id === n.contact_id);
                    return (
                      <div className="note" key={n.id}>
                        <span className="av" style={{ background: hueFor(c ? fullName(c) : n.id) }}>
                          {c ? initialsOf(c) : '?'}
                        </span>
                        <div className="body">
                          <div className="hd">
                            <span className="nm">{c ? fullName(c) : 'Contact inconnu'}</span>
                            <span className="dt">{frDate(n.created_at)}</span>
                          </div>
                          <div className="tx">
                            {n.content?.length > 120 ? `${n.content.slice(0, 120)}…` : n.content}
                          </div>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>

          {/* ---------- tableau ---------- */}
          <div className="tcard">
            <div className="tabs">
              <button className={`tab${tab === 'recontacter' ? ' on' : ''}`} onClick={() => setTab('recontacter')}>
                À recontacter
              </button>
              <button className={`tab${tab === 'recents' ? ' on' : ''}`} onClick={() => setTab('recents')}>
                Récents
              </button>
              <button className="upd" onClick={() => onRefreshData()}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" />
                </svg>
                Actualiser
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Contact</th><th>Entreprise</th><th>Secteur</th><th>Statut</th><th>Dernier échange</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--mut)', textAlign: 'center', padding: '26px 16px' }}>
                      {tab === 'recontacter' ? 'Tous vos contacts sont à jour.' : 'Aucun échange enregistré.'}
                    </td>
                  </tr>
                ) : (
                  rows.slice(0, 8).map(({ c, last }) => {
                    const sector = (c.industry || '').toLowerCase();
                    return (
                      <tr key={c.id}>
                        <td>
                          <div className="who">
                            <span className="av" style={{ background: hueFor(fullName(c)) }}>{initialsOf(c)}</span>
                            <div>
                              <div className="nm">{fullName(c)}</div>
                              {c.job_title && (
                                <div style={{ fontSize: 12, color: 'var(--mut)' }}>{c.job_title}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>{c.company || <span className="muted">—</span>}</td>
                        <td>
                          {c.industry ? (
                            <span className={`pill ${SECTOR_CLASS[sector] || 'p-pol'}`}>{c.industry}</span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>
                          <span className={`pill ${tab === 'recontacter' ? 'p-relance' : 'p-act'}`}>
                            {tab === 'recontacter' ? 'À relancer' : 'Actif'}
                          </span>
                        </td>
                        <td>{last ? frDate(last) : <span className="muted">jamais</span>}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
