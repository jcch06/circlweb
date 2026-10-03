// Self-check des règles réseau : npx tsx src/lib/networkRules.check.ts
import assert from 'node:assert/strict';
import { computeMilieux, suggestLinks, linkKey, POLITIQUE, COLLABS, MEDIAS } from './networkRules';

const C = [
  { id: '1', first_name: 'Anouk', last_name: '(scout)' },
  { id: '2', first_name: 'Olivier', last_name: '(Scout)' },
  { id: '3', first_name: 'Farid', last_name: '(avec Lunettes)' },
  { id: '4', first_name: 'Charles', last_name: 'Alloncle', company: 'Député UDR' },
  { id: '5', first_name: 'Raphaël', last_name: 'Tabusse', company: 'Collab Charles Alloncle' },
  { id: '6', first_name: 'Marc', last_name: 'T', company: 'LCL' },
  { id: '7', first_name: 'Sophie', last_name: 'R', company: 'lcl ' },
  { id: '8', first_name: 'Paul', last_name: 'Seul', company: 'Acme' },
  { id: '9', first_name: 'Léa', last_name: 'Presse', job_title: 'Journaliste BV' },
  { id: '10', first_name: 'Rémi', last_name: 'Dom', email: 'a@hemicycle.fr' },
  { id: '11', first_name: 'Inès', last_name: 'Dom', email: 'b@hemicycle.fr' },
  { id: '12', first_name: 'Zoé', last_name: 'Gmail', email: 'z@gmail.com' },
];

const r = computeMilieux({ contacts: C, explicit: new Map(), aliases: new Map() });
const of = (id: string) => r.byContact.get(id) ?? [];
assert.deepEqual(of('1'), ['Scout']);                    // tag partagé, casse majoritaire
assert.deepEqual(of('3'), []);                           // « avec Lunettes » n'est pas un milieu
assert.deepEqual(of('4'), [POLITIQUE]);
assert.deepEqual(of('5'), [COLLABS]);
assert.deepEqual(of('6'), ['LCL']);                      // entreprise partagée
assert.deepEqual(of('8'), []);                           // entreprise seule : pas de milieu
assert.deepEqual(of('9'), [MEDIAS]);
assert.deepEqual(of('10'), ['Hemicycle']);               // domaine partagé
assert.deepEqual(of('12'), []);                          // messagerie grand public ignorée
assert.ok(r.unclassified.includes('8') && r.unclassified.includes('3'));

const withAlias = computeMilieux({ contacts: C, explicit: new Map([['8', ['Clients']]]), aliases: new Map([['scout', 'Scouts']]) });
assert.deepEqual(withAlias.byContact.get('1'), ['Scouts']);
assert.deepEqual(withAlias.byContact.get('8'), ['Clients']);

const s = suggestLinks(C, [{ contact_id: '6', content: 'Déjeuner avec Paul Seul, très bien.', created_at: '2026-09-12T10:00:00Z' }], new Set());
assert.ok(s.some((x) => x.kind === 'works_for' && x.a === '5' && x.b === '4'));
assert.ok(s.some((x) => x.kind === 'co_mention' && x.a === '6' && x.b === '8'));
const blocked = suggestLinks(C, [], new Set([linkKey('5', '4', 'works_for')]));
assert.ok(!blocked.some((x) => x.kind === 'works_for'));

console.log('networkRules: OK');

const extra = [
  ...C,
  { id: '20', first_name: 'Florian', last_name: 'Azema', company: 'Collab RN Weber' },
  { id: '21', first_name: 'Hélène', last_name: 'Weber', company: 'RN' },
  { id: '22', first_name: 'Henri', last_name: 'Huvey', company: 'Boîte cofondée avec Paul Seul' },
  { id: '23', first_name: 'Amaury', last_name: 'B', company: 'Rédact Chef Valeurs Actuelles' },
];
const s2 = suggestLinks(extra, [], new Set());
assert.ok(s2.some((x) => x.kind === 'works_for' && x.a === '20' && x.b === '21'));
assert.ok(s2.some((x) => x.kind === 'co_mention' && x.a === '22' && x.b === '8'));
assert.deepEqual(computeMilieux({ contacts: extra, explicit: new Map(), aliases: new Map() }).byContact.get('23'), [MEDIAS]);
console.log('networkRules extra: OK');

// Contre-audit : collaborateur non parlementaire, noms composés, homonymes, échelle.
const ca = computeMilieux({ contacts: [{ id: 'x1', first_name: 'Alice', last_name: 'Martin', company: 'Cabinet Durand', job_title: 'Collaboratrice comptable' }], explicit: new Map(), aliases: new Map() });
assert.ok(!(ca.byContact.get('x1') ?? []).includes(COLLABS));
const comp = suggestLinks([{ id: 'j', first_name: 'Jean-Pierre', last_name: 'Dupont' }, { id: 'a', first_name: 'Alice', last_name: 'Roy' }],
  [{ contact_id: 'a', content: 'Rencontre avec Jean-Pierre Dupont.', created_at: '2026-10-01T10:00:00Z' }], new Set());
assert.ok(comp.some((x) => x.a === 'a' && x.b === 'j'));
const homo = suggestLinks([{ id: 'h1', first_name: 'Alex', last_name: 'Martin' }, { id: 'h2', first_name: 'Alex', last_name: 'Martin' }, { id: 'z', first_name: 'Zoé', last_name: 'Roy' }],
  [{ contact_id: 'z', content: 'Vu Alex Martin hier', created_at: '2026-10-01T10:00:00Z' }], new Set());
assert.equal(homo.length, 0);
const big = Array.from({ length: 50000 }, (_, i) => ({ id: `b${i}`, first_name: `Prenom${i}`, last_name: `Nom${i}`, company: `Societe ${i % 700}`, job_title: 'Directeur' }));
const t0 = Date.now(); suggestLinks(big, [], new Set()); const ms = Date.now() - t0;
assert.ok(ms < 3000, `suggestLinks 50 000 fiches : ${ms} ms`);
console.log(`networkRules contre-audit: OK (50 000 fiches en ${ms} ms)`);
