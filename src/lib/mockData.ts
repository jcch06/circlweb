// Données mockées pour construire et vérifier le design en local sans session.
// Branchées via App.tsx en mode ?mock (dev only). Remplacées par le vrai
// DataProvider une fois le design validé.

const DAY = 86400000;
const now = Date.now();
const iso = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString();
const dateOnly = (daysFromNow: number) => new Date(now + daysFromNow * DAY).toISOString().slice(0, 10);

const USER_ID = 'me';

export const mockSpaces = [
  { id: 's-perso', name: 'Personnel', type: 'personal' },
  { id: 's-invest', name: 'Investisseurs', type: 'team' },
  { id: 's-climat', name: 'Climat', type: 'team' },
  { id: 's-anciens', name: 'Anciens collègues', type: 'team' },
];

export const mockTags = [
  { id: 't-vip', name: 'VIP', color_hex: '#171717' },
  { id: 't-suivre', name: 'À suivre', color_hex: '#b7791f' },
  { id: 't-client', name: 'Client', color_hex: '#1a8f4c' },
  { id: 't-presse', name: 'Presse', color_hex: '#8a7fd1' },
];

type C = {
  id: string; space_id: string; owner_id: string; first_name: string; last_name: string;
  job_title?: string | null; company?: string | null; email?: string | null; phone?: string | null;
  photo_url?: string | null; enriched_at?: string | null; last_contacted_at?: string | null;
  shared_contact_id?: string | null; industry?: string | null; bio?: string | null;
  ai_context?: string | null; location?: string | null; linkedin?: string | null;
  skills?: string[] | null; inferred_needs?: string[] | null;
};

const raw: Array<[string, string, string, string, string, number | null]> = [
  // prénom, nom, poste, société, cercle, jours depuis dernier contact (null = jamais)
  ['Claire', 'Fontaine', 'Directrice associée', 'Vinci', 's-invest', 62],
  ['Thomas', 'Reynaud', 'Partner', 'Green Fund', 's-climat', 8],
  ['Marc', 'Ollivier', 'Directeur financier', 'Groupe Rocher', 's-anciens', 95],
  ['Julie', 'Aymard', 'Fondatrice', 'Lumen', 's-invest', 110],
  ['Sophie', 'Lambert', 'Head of Talent', 'AXA', 's-anciens', 12],
  ['Philippe', 'De Gestas', 'Président', 'Cercle Alcuin', 's-perso', 5],
  ['Charles', 'Allioncle', 'Député', 'Assemblée nationale', 's-perso', 64],
  ['Foulques-Antoine', 'Argoeuves', 'Consultant', 'Indépendant', 's-perso', 70],
  ['Olivier', 'Debeney', 'DG', 'Solaris', 's-climat', 68],
  ['Thérèse', 'Brulé', 'Avocate', 'Cabinet Brulé', 's-perso', 73],
  ['Benoît', 'de Balincourt', 'Directeur relations publiques', 'Dalkia', 's-anciens', 1],
  ['Henri', 'Huvey', 'Cofondateur', 'MeetBridge', 's-invest', 30],
  ['Camille', 'Prévost', 'CMO', 'Payfit', 's-invest', 22],
  ['Nicolas', 'Marchand', 'Directeur', 'Saper Vedere', 's-perso', 140],
  ['Léa', 'Fournier', 'Journaliste', 'Les Échos', 's-perso', 40],
  ['Antoine', 'Berger', 'CTO', 'Qonto', 's-invest', 9],
  ['Inès', 'Moreau', 'VC Principal', 'Serena', 's-invest', 54],
  ['Hugo', 'Renard', 'Founder', 'Pennylane', 's-climat', 16],
  ['Chloé', 'Girard', 'DRH', 'Doctolib', 's-anciens', 200],
  ['Lucas', 'Petit', 'Head of Sales', 'Spendesk', 's-anciens', 88],
  ['Emma', 'Roux', 'Analyste', 'Bpifrance', 's-invest', 3],
  ['Paul', 'Vidal', 'Associé', 'Alven', 's-invest', 130],
  ['Manon', 'Faure', 'Déléguée générale', 'France Digitale', 's-perso', 45],
  ['Gabriel', 'Lemoine', 'CEO', 'Alan', 's-climat', 6],
];

const AV = ['#e06666', '#57b06f', '#8a7fd1', '#d9b84a', '#e091c0', '#5b8def', '#4bb3a7', '#d98a4a'];

export const mockContacts: C[] = raw.map(([fn, ln, job, co, space, days], i) => ({
  id: `c-${i}`, space_id: space, owner_id: USER_ID,
  first_name: fn, last_name: ln, job_title: job, company: co,
  // Une partie des contacts sans email / téléphone : montre la recherche
  // FullEnrich au crédit.
  email: i % 3 === 1 ? null : `${fn.toLowerCase().replace(/[^a-z]/g, '')}@${co.toLowerCase().replace(/[^a-z]/g, '') || 'mail'}.com`,
  phone: i % 2 === 0 ? null : '+33 6 12 34 56 78',
  photo_url: null,
  enriched_at: i % 3 === 0 ? iso(10) : null,
  last_contacted_at: days == null ? null : iso(days),
  shared_contact_id: null,
  industry: 'Tech', location: 'Paris', bio: null, ai_context: null, linkedin: `linkedin.com/in/${fn.toLowerCase()}`,
  skills: i % 4 === 0 ? ['levée de fonds', 'climat'] : null,
  inferred_needs: i % 5 === 0 ? ['recrutement CTO'] : null,
}));

// ?mock=big : 10 000 contacts synthétiques pour éprouver l'échelle visée.
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mock') === 'big') {
  const F = ['Jean', 'Marie', 'Pierre', 'Sophie', 'Luc', 'Anne', 'Paul', 'Claire', 'Marc', 'Julie', 'Louis', 'Emma', 'Hugo', 'Léa', 'Tom', 'Chloé'];
  const L = ['Martin', 'Bernard', 'Dubois', 'Durand', 'Lefebvre', 'Moreau', 'Laurent', 'Simon', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent'];
  const J = ['CEO', 'CTO', 'Directeur', 'Associé', 'Consultant', 'Responsable affaires publiques', 'Head of Sales', 'Avocat', 'Analyste', 'Fondateur'];
  const CO = ['Axa', 'BNP', 'Qonto', 'Alan', 'Doctolib', 'Total', 'Orange', 'Danone', 'Capgemini', 'Sanofi', 'Engie', 'Renault'];
  const S = ['s-perso', 's-invest', 's-climat', 's-anciens'];
  for (let i = 0; i < 10000; i++) {
    const fn = F[i % F.length], ln = L[(i * 7) % L.length], co = CO[(i * 3) % CO.length];
    mockContacts.push({
      id: `b-${i}`, space_id: S[i % 4], owner_id: USER_ID, first_name: fn, last_name: `${ln} ${i}`,
      job_title: J[(i * 7) % J.length], company: co, email: i % 3 ? `${fn.toLowerCase()}.${i}@${co.toLowerCase()}.com` : null,
      phone: null, photo_url: null, enriched_at: null, last_contacted_at: i % 4 ? iso((i * 13) % 400) : null,
      shared_contact_id: null, industry: null, location: 'Paris', bio: null, ai_context: null, linkedin: null, skills: null, inferred_needs: null,
    });
  }
}

export const mockNotes = [
  { id: 'n1', contact_id: 'c-0', author_id: USER_ID, is_private: false, created_at: iso(62), content: 'Nous nous sommes revus à plusieurs reprises lors des différents événements de la place. Cherche à investir dans la transition énergétique.' },
  { id: 'n2', contact_id: 'c-7', author_id: USER_ID, is_private: false, created_at: iso(70), content: 'Je vais contacter Foulques-Antoine pour qu\'il puisse tester les nouvelles fonctionnalités.' },
  { id: 'n3', contact_id: 'c-8', author_id: USER_ID, is_private: false, created_at: iso(68), content: 'J\'ai rencontré Olivier aujourd\'hui pour lui présenter la solution. Très intéressé par le volet data.' },
  { id: 'n4', contact_id: 'c-9', author_id: USER_ID, is_private: false, created_at: iso(73), content: 'Ne pas oublier anniversaire le 17 juillet, m\'envoyer une notification.' },
  { id: 'n5', contact_id: 'c-6', author_id: USER_ID, is_private: false, created_at: iso(64), content: 'Échange au dîner du Cercle Alcuin. Ouvert à une mise en relation côté finance verte.' },
  { id: 'n6', contact_id: 'c-10', author_id: 'other', is_private: false, created_at: iso(1), content: 'Occupe le poste de directeur des relations publiques.' },
  { id: 'n7', contact_id: 'c-11', author_id: USER_ID, is_private: false, created_at: iso(30), content: 'Est cofondateur de sa nouvelle structure, MeetBridge.' },
  { id: 'n8', contact_id: 'c-1', author_id: USER_ID, is_private: false, created_at: iso(8), content: 'Lève un fonds climat de 120M. Cherche une associée opérationnelle.' },
];

export const mockFollowUps = [
  { id: 'f1', contact_id: 'c-0', user_id: USER_ID, space_id: 's-invest', due_date: dateOnly(0), label: 'Envoyer le deck', status: 'pending' },
  { id: 'f2', contact_id: 'c-2', user_id: USER_ID, space_id: 's-anciens', due_date: dateOnly(0), label: 'Point trimestriel', status: 'pending' },
  { id: 'f3', contact_id: 'c-3', user_id: USER_ID, space_id: 's-invest', due_date: dateOnly(-2), label: 'Relancer sur la série A', status: 'pending' },
];

export const mockUpdates = [
  { id: 'u1', contact_id: 'c-10', space_id: 's-anciens', field: 'job_title', old_value: 'Responsable com', new_value: 'Directeur relations publiques', summary: null, status: 'pending', source: 'linkedin' },
  { id: 'u2', contact_id: 'c-10', space_id: 's-anciens', field: 'company', old_value: 'Veolia', new_value: 'Dalkia', summary: null, status: 'pending', source: 'linkedin' },
  { id: 'u3', contact_id: 'c-11', space_id: 's-invest', field: null, old_value: null, new_value: null, summary: 'Évolue dans le secteur de la mise en relation.', status: 'pending', source: 'web' },
];

export const mockContactTags = [
  { contact_id: 'c-0', tag_id: 't-vip' }, { contact_id: 'c-0', tag_id: 't-suivre' },
  { contact_id: 'c-1', tag_id: 't-vip' }, { contact_id: 'c-5', tag_id: 't-vip' },
  { contact_id: 'c-14', tag_id: 't-presse' }, { contact_id: 'c-4', tag_id: 't-client' },
];

export const mockLinks = [
  { from_contact_id: 'c-0', to_contact_id: 'c-1', created_at: iso(20) },
  { from_contact_id: 'c-5', to_contact_id: 'c-1', created_at: iso(15) },
  { from_contact_id: 'c-2', to_contact_id: 'c-4', created_at: iso(12) },
];

// --- Pipelines : tableaux de contacts par étapes ---
export const mockPipelines = [
  { id: 'p-prospection', name: 'Prospection', space_id: 's-perso' },
  { id: 'p-levee', name: 'Levée de fonds', space_id: 's-invest' },
];

export const mockStages = [
  { id: 'st-1', pipeline_id: 'p-prospection', name: 'À contacter', position: 0, tone: 'neutral' },
  { id: 'st-2', pipeline_id: 'p-prospection', name: 'Contacté', position: 1, tone: 'neutral' },
  { id: 'st-3', pipeline_id: 'p-prospection', name: 'En discussion', position: 2, tone: 'progress' },
  { id: 'st-4', pipeline_id: 'p-prospection', name: 'Proposition', position: 3, tone: 'progress' },
  { id: 'st-5', pipeline_id: 'p-prospection', name: 'Gagné', position: 4, tone: 'won' },
  { id: 'st-6', pipeline_id: 'p-prospection', name: 'Perdu', position: 5, tone: 'lost' },
  { id: 'st-7', pipeline_id: 'p-levee', name: 'Identifié', position: 0, tone: 'neutral' },
  { id: 'st-8', pipeline_id: 'p-levee', name: 'Premier contact', position: 1, tone: 'neutral' },
  { id: 'st-9', pipeline_id: 'p-levee', name: 'Due diligence', position: 2, tone: 'progress' },
  { id: 'st-10', pipeline_id: 'p-levee', name: 'Term sheet', position: 3, tone: 'progress' },
  { id: 'st-11', pipeline_id: 'p-levee', name: 'Closé', position: 4, tone: 'won' },
];

export const mockPipelineItems = [
  { id: 'pi-1', pipeline_id: 'p-prospection', stage_id: 'st-1', contact_id: 'c-13', position: 0, updated_at: iso(3) },
  { id: 'pi-2', pipeline_id: 'p-prospection', stage_id: 'st-1', contact_id: 'c-22', position: 1, updated_at: iso(5) },
  { id: 'pi-3', pipeline_id: 'p-prospection', stage_id: 'st-1', contact_id: 'c-19', position: 2, updated_at: iso(9) },
  { id: 'pi-4', pipeline_id: 'p-prospection', stage_id: 'st-2', contact_id: 'c-7', position: 0, updated_at: iso(2) },
  { id: 'pi-5', pipeline_id: 'p-prospection', stage_id: 'st-2', contact_id: 'c-14', position: 1, updated_at: iso(6) },
  { id: 'pi-6', pipeline_id: 'p-prospection', stage_id: 'st-3', contact_id: 'c-8', position: 0, updated_at: iso(1) },
  { id: 'pi-7', pipeline_id: 'p-prospection', stage_id: 'st-3', contact_id: 'c-6', position: 1, updated_at: iso(4) },
  { id: 'pi-8', pipeline_id: 'p-prospection', stage_id: 'st-4', contact_id: 'c-9', position: 0, updated_at: iso(2) },
  { id: 'pi-9', pipeline_id: 'p-prospection', stage_id: 'st-5', contact_id: 'c-4', position: 0, updated_at: iso(12) },
  { id: 'pi-10', pipeline_id: 'p-levee', stage_id: 'st-7', contact_id: 'c-16', position: 0, updated_at: iso(4) },
  { id: 'pi-11', pipeline_id: 'p-levee', stage_id: 'st-8', contact_id: 'c-21', position: 0, updated_at: iso(7) },
  { id: 'pi-12', pipeline_id: 'p-levee', stage_id: 'st-8', contact_id: 'c-3', position: 1, updated_at: iso(10) },
  { id: 'pi-13', pipeline_id: 'p-levee', stage_id: 'st-9', contact_id: 'c-0', position: 0, updated_at: iso(1) },
  { id: 'pi-14', pipeline_id: 'p-levee', stage_id: 'st-10', contact_id: 'c-1', position: 0, updated_at: iso(2) },
];

// --- Index dérivés (mêmes formes que data.tsx) ---
function buildMaps() {
  const contactById = new Map(mockContacts.map((c) => [c.id, c]));
  const spaceById = new Map(mockSpaces.map((s) => [s.id, s]));
  const notesByContact = new Map<string, any[]>();
  const lastNoteByContact = new Map<string, string>();
  for (const n of [...mockNotes].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))) {
    (notesByContact.get(n.contact_id) ?? notesByContact.set(n.contact_id, []).get(n.contact_id)!).push(n);
    const prev = lastNoteByContact.get(n.contact_id);
    if (!prev || n.created_at > prev) lastNoteByContact.set(n.contact_id, n.created_at);
  }
  const tagById = new Map(mockTags.map((t) => [t.id, t]));
  const tagsByContact = new Map<string, any[]>();
  for (const ct of mockContactTags) {
    const tag = tagById.get(ct.tag_id); if (!tag) continue;
    (tagsByContact.get(ct.contact_id) ?? tagsByContact.set(ct.contact_id, []).get(ct.contact_id)!).push(tag);
  }
  const linksByContact = new Map<string, any[]>();
  for (const l of mockLinks) for (const id of [l.from_contact_id, l.to_contact_id]) {
    (linksByContact.get(id) ?? linksByContact.set(id, []).get(id)!).push(l);
  }
  const pendingByContact = new Map<string, any[]>();
  for (const u of mockUpdates) (pendingByContact.get(u.contact_id) ?? pendingByContact.set(u.contact_id, []).get(u.contact_id)!).push(u);
  const followUpsByContact = new Map<string, any[]>();
  for (const f of mockFollowUps) (followUpsByContact.get(f.contact_id) ?? followUpsByContact.set(f.contact_id, []).get(f.contact_id)!).push(f);
  return { contactById, spaceById, notesByContact, lastNoteByContact, tagsByContact, linksByContact, pendingByContact, followUpsByContact };
}

export function buildMockBase() {
  const maps = buildMaps();
  return {
    session: { user: { id: USER_ID } },
    user: { id: USER_ID, email: 'anselme.boussuge@gmail.com', user_metadata: { full_name: 'Anselme Boussuge' } },
    loading: false,
    errorMsg: null as string | null,
    spaces: mockSpaces,
    contacts: mockContacts,
    notes: mockNotes,
    tags: mockTags,
    contactTags: mockContactTags,
    contactLinks: mockLinks,
    pendingUpdates: mockUpdates,
    followUps: mockFollowUps,
    pipelines: mockPipelines,
    pipelineStages: mockStages,
    pipelineItems: mockPipelineItems,
    avatarColorFor: (i: number) => AV[i % AV.length],
    ...maps,
  };
}
