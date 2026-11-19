const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, normalize, decodeFile } = require('../bingo-api/pilot/csv');
test('CSV supports BOM, CRLF, quoted commas, escaped quotes and physical source lines', () => {
  const rows = parseCsv(
    Buffer.from(
      '\uFEFFemail,telefono,nombre\r\na@example.invalid,+56900000000,"Ana, ""A"""\r\nb@example.invalid,+56900000001,"Dos\nfilas"\r\nc@example.invalid,+56900000002,C\r\n'
    )
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0].raw.values.nombre, 'Ana, "A"');
  assert.equal(rows[2].rowNumber, 5);
  assert.equal(rows[0].raw.values.telefono, '+56900000000');
});
test('CSV rejects ambiguous syntax, invalid UTF8, invalid headers, and empty tables', () => {
  for (const csv of [
    'nombre;foo\na;b',
    'email,email,telefono\na,b,c',
    'email,telefono\n"a,b',
    'email,telefono\n"a"x,b',
    'email,telefono\n'
  ]) {
    assert.throws(
      () => parseCsv(Buffer.from(csv)),
      (error) => error.status === 400
    );
  }
  assert.throws(
    () => parseCsv(Buffer.from([0xff, 0xfe])),
    (error) => error.publicCode === 'csv_utf8'
  );
  assert.throws(
    () => decodeFile('!not-base64'),
    (error) => error.status === 400
  );
});
test('normalization keeps phone as text and records invalid/blank/short rows', () => {
  assert.deepEqual(normalize({ email: ' A@Example.Invalid ', telefono: '+56 (9) 0000-0000' }).data, {
    email: 'a@example.invalid',
    phone: '+56900000000',
    name: '',
    externalId: ''
  });
  // A phone with no leading '+' is assumed to be missing it, not malformed (Polla's raw export
  // gives bare national numbers), so only the email is reported invalid here.
  assert.equal(normalize({ email: 'bad', telefono: '56900000000' }).issues.length, 1);
  assert.equal(normalize({ email: 'a@example.invalid', telefono: '56900000000' }).data.phone, '+56900000000');
  assert.ok(normalize({ email: 'bad', telefono: '123' }).issues.length === 2);
  const rows = parseCsv(Buffer.from('email,telefono\na@example.invalid\n\n'));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].structureIssues, ['column_count']);
});
test('a semicolon-delimited file with the legacy column names is also accepted', () => {
  const rows = parseCsv(Buffer.from('email;telefono;nombre\na@example.invalid;+56900000000;Ana\n'));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].raw.values, {
    email: 'a@example.invalid',
    telefono: '+56900000000',
    jugador_id: '',
    nombre: 'Ana'
  });
});
test("Polla's raw platform export (Report NNN) is accepted: title row skipped, columns mapped, extras ignored", () => {
  const csv =
    'Report 201;;;;;;;;;;;;\n' +
    'Influencer ID;Influencer Code;Player ID;Player Name;Player Surname;Player RUT;Player Email;' +
    'Player Mobile Phone;Transaction Date;Game;Bets Number;Bet Amount;\n' +
    '12;FORTUNALOTO;1000063111;GLADYS DEL CARMEN;ACEVEDO;130152570;dna33@cornell.edu;56998673105;' +
    '2026-11-11 14:56:53;Loto;1;3500;\n' +
    '12;FORTUNALOTO;1000063111;GLADYS DEL CARMEN;ACEVEDO;130152570;dna33@cornell.edu;56958710337;' +
    '2026-11-11 14:59:51;Loto3;1;200;\n' +
    '12;FORTUNALOTO;1001036470;ROSA ZULEMA;PONCE;103653290;rosa@example.invalid;56994281778;' +
    '2026-11-12 11:51:09;Loto;1;3500;\n';
  const rows = parseCsv(Buffer.from(csv));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].raw.values, {
    email: 'dna33@cornell.edu',
    telefono: '56998673105',
    jugador_id: '1000063111',
    nombre: 'GLADYS DEL CARMEN ACEVEDO'
  });
  assert.equal(normalize(rows[0].raw.values).data.phone, '+56998673105');
  // The same Player ID reappears with a different phone across transaction rows: parseCsv keeps
  // both rows as-is (one per CSV line) and lets the existing import conflict detection, which
  // already matches by jugador_id, decide this needs operator resolution.
  assert.equal(rows[1].raw.values.jugador_id, '1000063111');
  assert.equal(rows[1].raw.values.telefono, '56958710337');
  assert.deepEqual(rows.map((r) => r.structureIssues), [[], [], []]);
  assert.equal(rows[2].raw.values.email, 'rosa@example.invalid');
  assert.equal(rows[2].raw.values.nombre, 'ROSA ZULEMA PONCE');
});
test("Polla's export is rejected if the required Player Email/Mobile Phone columns are missing", () => {
  assert.throws(
    () => parseCsv(Buffer.from('Influencer ID;Player ID;Player Name\n1;2;3\n')),
    (error) => error.publicCode === 'csv_headers'
  );
});
