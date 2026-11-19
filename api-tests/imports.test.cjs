const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const path = require('node:path');
process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(require('node:os').tmpdir(), 'bingo-mongodb-binaries');
process.env.NODE_ENV = 'test'; // keeps a local .env (e.g. real provider credentials) out of this run
process.env.DB_SECRET = 'synthetic-stage2-secret';
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const db = require('../bingo-api/models/db');
const M = require('../bingo-api/pilot/models');
const { createEdition, cardRecord } = require('../bingo-api/pilot/persistence');
const { provision } = require('../bingo-api/pilot/staff');
const I = require('../bingo-api/pilot/imports');
const { createApp } = require('../server');
let replica, server, base, actorId;
const tokens = {};
const oid = () => new mongoose.Types.ObjectId();
before(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await db.connect(replica.getUri());
  for (const role of ['administrator', 'importer', 'auditor', 'viewer']) {
    const staff = await provision({
      email: `${role}@example.invalid`,
      name: role,
      password: 'synthetic-password-123',
      roles: [role]
    });
    tokens[role] = (await mongoose.model('Admins').findById(staff.id)).generateJwt();
    if (role === 'importer') actorId = staff.id;
  }
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/bingo-api/pilot/editions`;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.disconnect();
  if (replica) await replica.stop();
});
async function edition() {
  const id = oid();
  await createEdition({ editionId: id, name: 'Stage 2', actorId });
  return id;
}
async function command(editionId, input = {}) {
  return {
    editionId,
    expectedVersion: (await M.Edition.findById(editionId)).version,
    actorId,
    key: `operation-${oid()}`,
    input
  };
}
async function stage(editionId, csv, ref = 'Polla synthetic version') {
  return I.stageImport(
    await command(editionId, {
      contentBase64: Buffer.from(csv).toString('base64'),
      filename: 'synthetic.csv',
      sourceReference: ref
    })
  );
}
async function apply(editionId, importId) {
  return I.applyImport(await command(editionId, { importId }));
}
async function preview(editionId, importId) {
  return I.readPreview(editionId, importId, actorId, 500, 0);
}
async function report(editionId) {
  return I.reconciliation(await M.Edition.findById(editionId));
}
async function resolve(editionId, importId, rowId, decision) {
  return I.resolveRow(
    await command(editionId, {
      importId,
      rowId,
      decision: { ...decision, pollaReference: 'Polla synthetic clarification' }
    })
  );
}
async function http(editionId, route, role = 'importer', body, key = `http-${oid()}`) {
  const response = await fetch(`${base}/${editionId}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${tokens[role]}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': key
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { status: response.status, data: await response.json() };
}
test(
  'upload previews rows before inclusion and applies 3000 players without treating capacity as a selection',
  { timeout: 60000 },
  async () => {
    const id = await edition();
    const csv =
      'email,telefono,jugador_id,nombre\n' +
      Array.from(
        { length: 3000 },
        (_, i) => `player${i}@example.invalid,+569${String(i).padStart(8, '0')},id-${i},Player ${i}`
      ).join('\n');
    const uploaded = await stage(id, csv);
    assert.equal(uploaded.summary.valid, 3000);
    assert.equal(await M.Participant.countDocuments({ editionId: id }), 0);
    const original = await M.ImportVersion.findById(uploaded.importId).select('+originalFile');
    assert.ok(original.originalFile.equals(Buffer.from(csv)));
    const applied = await apply(id, uploaded.importId);
    assert.equal(applied.summary.uniqueParticipants, 3000);
    assert.equal(await M.Participant.countDocuments({ editionId: id }), 3000);
    assert.equal(await M.Card.countDocuments({ editionId: id }), 0);
    const receipt = await report(id);
    assert.equal(receipt.uniqueParticipants, 3000);
    assert.equal(receipt.withoutCardIds.length, 3000);
    assert.equal(receipt.canClose, false);
    assert.equal(receipt.untraceableParticipantIds.length, 0);
    const reused = await stage(id, csv);
    assert.equal(reused.importId, uploaded.importId);
    await apply(id, reused.importId);
    assert.equal(await M.Participant.countDocuments({ editionId: id }), 3000);
    assert.equal(await M.ImportRow.countDocuments({ editionId: id }), 3000);
  }
);
test('exact normalized duplicates in a file or reimport use one participant and keep every source row', async () => {
  const id = await edition();
  const csv = 'email,telefono\nA@example.invalid,+56 (9) 0000-0000\na@example.invalid,+56900000000\n';
  const file = await stage(id, csv);
  assert.equal(file.summary.valid, 1);
  assert.equal(file.summary.duplicates, 1);
  const request = await command(id, { importId: file.importId });
  const first = await I.applyImport(request);
  assert.deepEqual(await I.applyImport(request), first);
  const rows = await M.ImportRow.find({ importId: file.importId });
  assert.equal(String(rows[0].participantId), String(rows[1].participantId));
  const second = await stage(id, 'email,telefono\na@example.invalid,+56900000000\n');
  await apply(id, second.importId);
  assert.equal(await M.Participant.countDocuments({ editionId: id }), 1);
});
test('invalid rows and shared contacts are retained; correction/separation requires Polla evidence', async () => {
  const id = await edition();
  const file = await stage(
    id,
    'email,telefono,jugador_id\na@example.invalid,+56900000000,a\na@example.invalid,+56900000001,b\nbad,not-a-phone,c\n'
  );
  let view = await preview(id, file.importId);
  assert.equal(view.summary.conflicts, 1);
  assert.equal(view.summary.invalid, 1);
  await assert.rejects(apply(id, file.importId), (e) => e.publicCode === 'import_unresolved');
  await assert.rejects(
    I.resolveRow(
      await command(id, { importId: file.importId, rowId: view.rows[1].id, decision: { kind: 'separate' } })
    ),
    (e) => e.status === 400
  );
  await resolve(id, file.importId, view.rows[1].id, { kind: 'separate' });
  await resolve(id, file.importId, view.rows[2].id, {
    kind: 'correct',
    corrected: { email: 'c@example.invalid', telefono: '+56900000002', jugador_id: 'c' }
  });
  await apply(id, file.importId);
  assert.equal(await M.Participant.countDocuments({ editionId: id }), 3);
  view = await preview(id, file.importId);
  assert.equal(view.rows[2].values.email, 'bad');
  assert.equal(view.rows[2].effective.email, 'c@example.invalid');
  assert.ok(view.rows[2].decisions[0].operatorId);
  const audit = JSON.stringify(await M.Audit.find({ editionId: id }).lean());
  assert.ok(!audit.includes('c@example.invalid'));
  assert.ok(!audit.includes('synthetic clarification'));
});
test('a stable ID with a new contact merges automatically, preserving participant and cartón', async () => {
  const id = await edition();
  const one = await stage(id, 'email,telefono,jugador_id\na@example.invalid,+56900000000,stable\n');
  await apply(id, one.importId);
  const person = await M.Participant.findOne({ editionId: id });
  const cells = Array.from({ length: 25 }, (_, i) => (i === 12 ? null : i + 1));
  const card = await M.Card.create(
    cardRecord({ editionId: id, participantId: person._id, sourceRowId: person.sourceRowId, cells })
  );
  const two = await stage(id, 'email,telefono,jugador_id\nnew@example.invalid,+56900000001,stable\n');
  const view = await preview(id, two.importId);
  // Same jugador_id, a different email/phone: not a conflict, no administrator needed - the
  // new contact is merged into the same person automatically.
  assert.deepEqual(view.rows[0].issues, []);
  assert.equal(view.rows[0].status, 'duplicate');
  await apply(id, two.importId);
  const updated = await M.Participant.findById(person.id).select('+emails +phones +contactHistory');
  assert.deepEqual(updated.emails, ['a@example.invalid', 'new@example.invalid']);
  assert.deepEqual(updated.phones, ['+56900000000', '+56900000001']);
  assert.equal(updated.contactHistory.length, 2);
  assert.deepEqual((await M.Card.findById(card.id)).cells.toObject(), cells);
  assert.equal(await M.Participant.countDocuments({ editionId: id }), 1);
});
test('missing people are not removed; reconciliation requires an explicit supported activity change', async () => {
  const id = await edition();
  const initial = await stage(
    id,
    'email,telefono,jugador_id\na@example.invalid,+56900000000,a\nb@example.invalid,+56900000001,b\n'
  );
  await apply(id, initial.importId);
  const second = await stage(id, 'email,telefono,jugador_id\na@example.invalid,+56900000000,a\n');
  await apply(id, second.importId);
  assert.equal(await M.Participant.countDocuments({ editionId: id, active: true }), 2);
  let diff = await report(id);
  assert.equal(diff.extraParticipantIds.length, 1);
  await assert.rejects(
    I.setActivity(await command(id, { participantId: diff.extraParticipantIds[0], active: false })),
    (e) => e.status === 400
  );
  await I.setActivity(
    await command(id, {
      participantId: diff.extraParticipantIds[0],
      active: false,
      pollaReference: 'Polla corrected final list'
    })
  );
  diff = await report(id);
  assert.equal(diff.extraParticipantIds.length, 0);
  assert.equal(await M.Participant.countDocuments({ editionId: id }), 2);
});
test('explicit exclusion is traceable and never silently removes an existing participant', async () => {
  const id = await edition();
  const file = await stage(id, 'email,telefono\na@example.invalid,+56900000000\ninvalid,phone\n');
  const view = await preview(id, file.importId);
  await resolve(id, file.importId, view.rows[1].id, { kind: 'exclude' });
  await apply(id, file.importId);
  assert.equal((await report(id)).excludedRows, 1);
  assert.equal(await M.ImportRow.countDocuments({ importId: file.importId }), 2);
});
test('closure blocks missing cards and unresolved newer versions; successful closure freezes all participant changes', async () => {
  const id = await edition();
  const file = await stage(id, 'email,telefono\na@example.invalid,+56900000000\n');
  await apply(id, file.importId);
  await assert.rejects(I.closeList(await command(id)), (e) => e.publicCode === 'reconciliation_incomplete');
  const p = await M.Participant.findOne({ editionId: id });
  const cards = require('../bingo-api/pilot/cards');
  await cards.configureCards(await command(id, { settings: { minNumber: 1, maxNumber: 75, columnMode: 'unrestricted', confirmationReference: 'Synthetic rules' } }));
  await cards.issueBatch(await command(id, { limit: 50 }));
  assert.equal((await report(id)).canClose, true);
  const pending = await stage(id, 'email,telefono\nbad,phone\n');
  assert.equal((await report(id)).canClose, false);
  await assert.rejects(I.closeList(await command(id)), (e) => e.publicCode === 'reconciliation_incomplete');
  const final = await stage(id, 'email,telefono,nombre\na@example.invalid,+56900000000,\n');
  await assert.rejects(apply(id, pending.importId), (e) => e.publicCode === 'import_superseded');
  await apply(id, final.importId);
  assert.equal((await report(id)).canClose, true);
  const close = await command(id);
  await I.closeList(close);
  await I.closeList(close);
  assert.equal((await report(id)).listClosed, true);
  await assert.rejects(
    stage(id, 'email,telefono\nb@example.invalid,+56900000001\n'),
    (e) => e.publicCode === 'list_frozen'
  );
  await assert.rejects(
    I.setActivity(await command(id, { participantId: p.id, active: false, pollaReference: 'test' })),
    (e) => e.publicCode === 'list_frozen'
  );
  assert.equal((await M.Edition.findById(id)).state, 'preparation');
});
test('HTTP permissions, original download, actionable errors and cross-edition references are enforced', async () => {
  const id = await edition();
  const body = {
    expectedVersion: 0,
    filename: 'synthetic.csv',
    sourceReference: 'Polla synthetic list',
    contentBase64: Buffer.from('email,telefono\na@example.invalid,+56900000000\n').toString('base64')
  };
  assert.equal((await http(id, '/imports', 'viewer', body)).status, 403);
  assert.equal((await http(id, '/imports', 'auditor', body)).status, 403);
  const uploaded = await http(id, '/imports', 'importer', body);
  assert.equal(uploaded.status, 201);
  const fileId = uploaded.data.importId;
  assert.equal((await http(id, `/imports/${fileId}/preview`, 'viewer')).status, 403);
  assert.equal((await http(id, `/imports/${fileId}/preview`, 'auditor')).status, 200);
  const original = await fetch(`${base}/${id}/imports/${fileId}/original`, {
    headers: { Authorization: `Bearer ${tokens.importer}` }
  });
  assert.equal(original.status, 200);
  assert.equal(await original.text(), Buffer.from(body.contentBase64, 'base64').toString());
  const other = await edition();
  assert.equal((await http(other, `/imports/${fileId}/preview`)).status, 404);
  const bad = await http(other, '/imports', 'importer', {
    ...body,
    contentBase64: Buffer.from('wrong,headers\na,b').toString('base64')
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.code, 'csv_headers');
  const applyBody = { expectedVersion: uploaded.data.version };
  assert.equal((await http(id, `/imports/${fileId}/apply`, 'importer', applyBody)).status, 200);
  assert.equal((await http(id, '/reconciliation')).data.uniqueParticipants, 1);
  assert.equal((await http(id, `/imports/${fileId}/preview?limit=99999`)).status, 400);
});
test('simultaneous upload/apply and stale commands cannot duplicate or partially incorporate people', async () => {
  const id = await edition();
  const input = {
    contentBase64: Buffer.from('email,telefono\na@example.invalid,+56900000000\n').toString('base64'),
    filename: 'same.csv',
    sourceReference: 'Polla list'
  };
  const first = await command(id, input);
  const results = await Promise.all([I.stageImport(first), I.stageImport(first)]);
  assert.equal(results[0].importId, results[1].importId);
  const action = await command(id, { importId: results[0].importId });
  const applied = await Promise.all([I.applyImport(action), I.applyImport(action)]);
  assert.deepEqual(applied[0], applied[1]);
  assert.equal(await M.Participant.countDocuments({ editionId: id }), 1);
  await assert.rejects(I.stageImport({ ...first, key: `stale-${oid()}` }), (e) => e.status === 409);
  const newer = await stage(id, 'email,telefono\nbad,phone\n');
  assert.equal((await report(id)).pendingFiles, 1);
  await assert.rejects(apply(id, newer.importId), (e) => e.publicCode === 'import_unresolved');
  assert.equal(await M.Participant.countDocuments({ editionId: id }), 1);
});

test('a new external ID is not silently attached by contacts; explicit link preserves the internal person', async () => {
  const id = await edition();
  const first = await stage(id, 'email,telefono\na@example.invalid,+56900000000\n');
  await apply(id, first.importId);
  const person = await M.Participant.findOne({ editionId: id });
  const second = await stage(id, 'email,telefono,jugador_id\na@example.invalid,+56900000000,official-id\n');
  const view = await preview(id, second.importId);
  assert.equal(view.summary.conflicts, 1);
  await resolve(id, second.importId, view.rows[0].id, { kind: 'link', participantId: person.id });
  await apply(id, second.importId);
  assert.equal(await M.Participant.countDocuments({ editionId: id }), 1);
  assert.equal((await M.Participant.findById(person.id)).externalId, 'official-id');
  const other = await edition();
  const otherFile = await stage(other, 'email,telefono\nb@example.invalid,+56900000001\n');
  const otherView = await preview(other, otherFile.importId);
  await assert.rejects(
    resolve(other, otherFile.importId, otherView.rows[0].id, { kind: 'link', participantId: person.id }),
    (e) => e.status === 404
  );
});
test('rows sharing one external ID merge into a single person; explicit separation is still blocked', async () => {
  const id = await edition();
  const first = await stage(
    id,
    'email,telefono,jugador_id\na@example.invalid,+56900000000,same\nb@example.invalid,+56900000001,same\n'
  );
  const view = await preview(id, first.importId);
  // Same jugador_id, different contacts across rows: merges automatically, no conflict.
  assert.equal(view.summary.conflicts, 0);
  assert.deepEqual(view.rows[1].issues, []);
  await apply(id, first.importId);
  assert.equal(await M.Participant.countDocuments({ editionId: id }), 1);
  const person = await M.Participant.findOne({ editionId: id }).select('+emails +phones');
  assert.deepEqual(person.emails, ['a@example.invalid', 'b@example.invalid']);
  assert.deepEqual(person.phones, ['+56900000000', '+56900000001']);
  // An operator who explicitly insists a same-ID row is a different person is still blocked:
  // one external ID can never resolve to two participants.
  const second = await stage(id, 'email,telefono,jugador_id\nc@example.invalid,+56900000002,same\n', 'Second batch');
  const secondView = await preview(id, second.importId);
  await resolve(id, second.importId, secondView.rows[0].id, { kind: 'separate' });
  const resolvedView = await preview(id, second.importId);
  assert.deepEqual(resolvedView.rows[0].issues, ['external_id_already_used']);
});

test('three rows sharing one external ID merge every distinct contact exactly once, without duplicates', async () => {
  const id = await edition();
  const file = await stage(
    id,
    'email,telefono,jugador_id\na@example.invalid,+56900000000,same\nb@example.invalid,+56900000001,same\na@example.invalid,+56900000000,same\n'
  );
  const view = await preview(id, file.importId);
  assert.equal(view.summary.conflicts, 0);
  assert.equal(view.rows[2].status, 'duplicate');
  await apply(id, file.importId);
  assert.equal(await M.Participant.countDocuments({ editionId: id }), 1);
  const person = await M.Participant.findOne({ editionId: id }).select('+emails +phones');
  // The third row repeats the first row's contact exactly: it does not add a duplicate entry.
  assert.deepEqual(person.emails, ['a@example.invalid', 'b@example.invalid']);
  assert.deepEqual(person.phones, ['+56900000000', '+56900000001']);
});

test('a name difference alone, with the same external ID or the same exact contact pair, never blocks', async () => {
  const id = await edition();
  const first = await stage(
    id,
    'email,telefono,jugador_id,nombre\na@example.invalid,+56900000000,same,Original Name\n' +
      'a@example.invalid,+56900000000,same,Totally Different Name\n'
  );
  const view = await preview(id, first.importId);
  assert.equal(view.summary.conflicts, 0);
  await apply(id, first.importId);
  assert.equal(await M.Participant.countDocuments({ editionId: id }), 1);
  const byId = await M.Participant.findOne({ editionId: id, externalId: 'same' }).select('+name');
  assert.equal(byId.name, 'Totally Different Name');

  // Same exact email+phone pair, no external ID at all: a later name-only difference is the
  // same person too.
  const second = await stage(
    id,
    'email,telefono,nombre\nc@example.invalid,+56900000099,First\nc@example.invalid,+56900000099,Second\n',
    'No external id batch'
  );
  const secondView = await preview(id, second.importId);
  assert.equal(secondView.summary.conflicts, 0);
  await apply(id, second.importId);
  assert.equal(await M.Participant.countDocuments({ editionId: id, externalId: { $exists: false } }), 1);
});

test('RUT is captured from Polla\'s raw export as a reference datum but never used to match or merge people', async () => {
  const id = await edition();
  const csv =
    'Player ID;Player Name;Player Surname;Player RUT;Player Email;Player Mobile Phone\n' +
    'p1;Ana;Lopez;11111111-1;ana@example.invalid;56900000001\n' +
    'p2;Beto;Soto;11111111-1;beto@example.invalid;56900000002\n';
  const file = await stage(id, csv, 'Polla RUT batch');
  const view = await preview(id, file.importId);
  // Two different Player IDs sharing the same RUT (e.g. a shared household ID in the export)
  // are not merged: jugador_id remains the identity, RUT is only stored alongside it.
  assert.equal(view.summary.conflicts, 0);
  assert.equal(view.summary.uniqueParticipants, 2);
  await apply(id, file.importId);
  assert.equal(await M.Participant.countDocuments({ editionId: id }), 2);
  const ana = await M.Participant.findOne({ editionId: id, externalId: 'p1' }).select('+rut +emails');
  assert.equal(ana.rut, '11111111-1');
  assert.deepEqual(ana.emails, ['ana@example.invalid']);
});
