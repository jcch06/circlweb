// Self-check de l'import : npx tsx src/lib/importFile.check.ts
import assert from 'node:assert/strict';
import { parseCsv, guessMapping, buildContacts } from './importFile';

const csv = '﻿Prénom;Nom;E-mail;Société;Fonction\r\nJean;Dupont;jean@acme.fr;"Acme; SA";"Directeur ""Ventes"""\r\nMarie;Curie;;Institut;\r\nJean;Dupont;JEAN@acme.fr;Acme;\r\n;;;Orpheline;\r\n';
const rows = parseCsv(csv);
assert.equal(rows.length, 5);
assert.deepEqual(rows[1], ['Jean', 'Dupont', 'jean@acme.fr', 'Acme; SA', 'Directeur "Ventes"']);
const map = guessMapping(rows[0]);
assert.deepEqual(map, ['first_name', 'last_name', 'email', 'company', 'job_title']);
const out = buildContacts(rows.slice(1), map);
assert.equal(out.contacts.length, 2);
assert.equal(out.duplicatesInFile, 1);   // même email, casse différente
assert.equal(out.withoutName, 1);
assert.equal(out.contacts[0].company, 'Acme; SA');

const comma = parseCsv('Name,Email,Title\n"Ada Lovelace",ada@x.io,"Engineer, lead"\n');
const m2 = guessMapping(comma[0]);
assert.deepEqual(m2, ['full_name', 'email', 'job_title']);
const b2 = buildContacts(comma.slice(1), m2);
assert.deepEqual(b2.contacts[0], { email: 'ada@x.io', job_title: 'Engineer, lead', first_name: 'Ada', last_name: 'Lovelace' });
console.log('importFile: OK');
