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
    'email;telefono\na;b',
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
  assert.ok(normalize({ email: 'bad', telefono: '56900000000' }).issues.length === 2);
  const rows = parseCsv(Buffer.from('email,telefono\na@example.invalid\n\n'));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].structureIssues, ['column_count']);
});
