const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(require('node:os').tmpdir(), 'bingo-mongodb-binaries');
process.env.DB_SECRET = 'stage3-synthetic-secret';
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const db = require('../bingo-api/models/db');
const M = require('../bingo-api/pilot/models');
const { provision } = require('../bingo-api/pilot/staff');
const { createEdition, configureEdition } = require('../bingo-api/pilot/persistence');
const I = require('../bingo-api/pilot/imports');
const S = require('../bingo-api/pilot/cards');
const { createApp } = require('../server');
const { matchesVariant, generateCells } = require('../bingo-api/pilot/card-generator');
const parsePdf = require('pdf-parse');
const oid = () => new mongoose.Types.ObjectId();
const settings = {
  minNumber: 1,
  maxNumber: 75,
  columnMode: 'unrestricted',
  confirmationReference: 'Synthetic configuration, not pilot approval'
};
let replica, server, base, actorId;
const tokens = {};
before(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await db.connect(replica.getUri());
  for (const role of ['administrator', 'importer', 'viewer']) {
    const staff = await provision({
      email: `${role}@example.invalid`,
      name: role,
      password: 'synthetic-password-123',
      roles: [role]
    });
    tokens[role] = (await mongoose.model('Admins').findById(staff.id)).generateJwt();
    if (role === 'administrator') actorId = staff.id;
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
async function command(editionId, input = {}) {
  return {
    editionId,
    actorId,
    expectedVersion: (await M.Edition.findById(editionId)).version,
    key: `card-${oid()}`,
    input
  };
}
async function fixture(count = 2, variant = settings) {
  const editionId = oid();
  await createEdition({ editionId, actorId, name: 'Edición sintética' });
  const csv =
    'email,telefono,jugador_id\n' +
    Array.from(
      { length: count },
      (_, i) => `player${i}@example.invalid,+569${String(i).padStart(8, '0')},player-${i}`
    ).join('\n');
  const file = await I.stageImport(
    await command(editionId, {
      filename: 'synthetic.csv',
      contentBase64: Buffer.from(csv).toString('base64'),
      sourceReference: 'Polla synthetic fixture'
    })
  );
  await I.applyImport(await command(editionId, { importId: file.importId }));
  if (variant) await S.configureCards(await command(editionId, { settings: variant }));
  return { editionId, file, csv };
}
async function http(id, route, role = 'administrator', body, key = `http-${oid()}`) {
  const response = await fetch(`${base}/${id}${route}`, {
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
test('issuance requires explicit card rules and a reconciled source list, not a default variant', async () => {
  const { editionId } = await fixture(1, null);
  await assert.rejects(
    S.issueBatch(await command(editionId)),
    (e) => e.publicCode === 'card_confirmation_required'
  );
  await assert.rejects(
    S.configureCards(await command(editionId, { settings: { ...settings, confirmationReference: '' } })),
    (e) => e.publicCode === 'card_confirmation_required'
  );
  await S.configureCards(await command(editionId, { settings }));
  const pending = await I.stageImport(
    await command(editionId, {
      filename: 'pending.csv',
      sourceReference: 'Polla pending correction',
      contentBase64: Buffer.from('email,telefono\nbad,phone').toString('base64')
    })
  );
  assert.ok(pending.importId);
  await assert.rejects(
    S.issueBatch(await command(editionId)),
    (e) => e.publicCode === 'reconciliation_incomplete'
  );
  assert.equal(await M.Card.countDocuments({ editionId }), 0);
});
test('settings are validated, snapshotted and frozen after first issue, including the generic rules endpoint', async () => {
  const { editionId } = await fixture(2, null);
  await assert.rejects(
    S.configureCards(await command(editionId, { settings: { ...settings, eventDate: '2026-02-31' } })),
    (e) => e.status === 400
  );
  await assert.rejects(
    S.configureCards(await command(editionId, { settings: { ...settings, title: 'Emoji 🦊' } })),
    (e) => e.publicCode === 'card_title'
  );
  await S.configureCards(
    await command(editionId, {
      settings: { ...settings, eventDate: '2026-11-16', eventTime: '10:00', timeZone: 'America/Santiago' }
    })
  );
  await S.issueBatch(await command(editionId, { limit: 1 }));
  await assert.rejects(
    S.configureCards(await command(editionId, { settings: { ...settings, minNumber: 2 } })),
    (e) => e.publicCode === 'card_settings_locked'
  );
  await assert.rejects(
    configureEdition(
      await command(editionId, { rules: { minNumber: 1, maxNumber: 90, columnMode: 'unrestricted' } })
    ),
    (e) => e.publicCode === 'card_settings_locked'
  );
  const card = await M.Card.findOne({ editionId });
  assert.equal(card.presentation.eventDate, '2026-11-16');
  assert.equal(card.presentation.timeZone, 'America/Santiago');
  assert.ok((await M.ConfigVersion.find({ editionId })).length >= 2);
});
test('batches resume, retries and concurrent retries keep exactly one card/PDF per person', async () => {
  const { editionId } = await fixture(3);
  const request = await command(editionId, { limit: 2 });
  const [one, two] = await Promise.all([S.issueBatch(request), S.issueBatch(request)]);
  assert.deepEqual(one, two);
  assert.equal(one.created, 2);
  assert.equal(one.remaining, 1);
  const next = await S.issueBatch(await command(editionId, { limit: 2 }));
  assert.equal(next.created, 1);
  assert.equal(next.remaining, 0);
  const all = await M.Card.find({ editionId }).lean();
  assert.equal(new Set(all.map((c) => c.layoutHash)).size, 3);
  assert.equal(await M.CardPdf.countDocuments({ editionId }), 3);
  const finished = await S.issueBatch(await command(editionId, { limit: 2 }));
  assert.equal(finished.processed, 0);
  assert.deepEqual(
    (await M.Card.find({ editionId }).lean()).map((c) => c.cells),
    all.map((c) => c.cells)
  );
  assert.equal(await M.Audit.countDocuments({ editionId, action: 'card.issued' }), 3);
});
test('a failure after saving the first card/PDF rolls back the entire batch and can be retried', async () => {
  const { editionId } = await fixture(2);
  const request = await command(editionId, { limit: 2 });
  const render = require('../bingo-api/pilot/card-pdf').renderCardPdf;
  let calls = 0;
  await assert.rejects(
    S.issueBatch(request, {
      render: async (card) => {
        if (++calls === 2) throw new Error('synthetic renderer failure');
        return render(card);
      }
    }),
    /synthetic/
  );
  assert.equal(await M.Card.countDocuments({ editionId }), 0);
  assert.equal(await M.CardPdf.countDocuments({ editionId }), 0);
  assert.equal((await M.Edition.findById(editionId)).version, request.expectedVersion);
  assert.equal((await S.issueBatch(request)).created, 2);
});
test('layout collisions are retried without duplicates; exhausting retries rolls back partial output', async () => {
  const { editionId } = await fixture(2);
  const fixed = generateCells(settings, (min) => min);
  await assert.rejects(
    S.issueBatch(await command(editionId, { limit: 2 }), { generate: () => fixed }),
    (e) => e.publicCode === 'card_collision'
  );
  assert.equal(await M.Card.countDocuments({ editionId }), 0);
  assert.equal(await M.CardPdf.countDocuments({ editionId }), 0);
  assert.equal((await S.issueBatch(await command(editionId, { limit: 2 }))).created, 2);
});
test('PDF downloads, reconnection, a new round and missing-artifact recovery preserve bytes and assignment', async () => {
  const { editionId } = await fixture(1);
  await S.issueBatch(await command(editionId));
  const card = await M.Card.findOne({ editionId });
  const first = await S.readPdf(editionId, card.id, actorId);
  await M.Round.create({ editionId, ordinal: 1, rulesVersion: 1, minNumber: 1, maxNumber: 75 });
  const uri = replica.getUri();
  await db.disconnect();
  await db.connect(uri);
  assert.ok((await S.readPdf(editionId, card.id, actorId)).bytes.equals(first.bytes));
  await M.CardPdf.deleteOne({ cardId: card._id });
  await assert.rejects(S.readPdf(editionId, card.id, actorId), (e) => e.publicCode === 'pdf_missing');
  await I.closeList(await command(editionId)).then(
    () => assert.fail('missing PDF must block closing'),
    (e) => assert.equal(e.publicCode, 'reconciliation_incomplete')
  );
  await S.recoverPdf(await command(editionId, { cardId: card.id }));
  assert.ok((await S.readPdf(editionId, card.id, actorId)).bytes.equals(first.bytes));
  await I.closeList(await command(editionId));
  await S.recoverPdf(await command(editionId, { cardId: card.id }));
  const unchanged = await M.Card.findById(card.id);
  assert.equal(String(unchanged.participantId), String(card.participantId));
  assert.deepEqual(unchanged.cells.toObject(), card.cells.toObject());
  assert.equal(unchanged.cells[12], null);
  assert.equal(await M.Card.countDocuments({ editionId }), 1);
});
test('reimport and contact corrections preserve card and PDF; additions receive only a new missing card', async () => {
  const { editionId, csv } = await fixture(1);
  await S.issueBatch(await command(editionId));
  const original = await M.Card.findOne({ editionId });
  const bytes = (await S.readPdf(editionId, original.id, actorId)).bytes;
  const repeat = await I.stageImport(
    await command(editionId, {
      filename: 'same.csv',
      sourceReference: 'Polla repeat',
      contentBase64: Buffer.from(csv).toString('base64')
    })
  );
  await I.applyImport(await command(editionId, { importId: repeat.importId }));
  const nextCsv =
    'email,telefono,jugador_id\nupdated@example.invalid,+56900000009,player-0\nextra@example.invalid,+56900000002,extra';
  const file = await I.stageImport(
    await command(editionId, {
      filename: 'correction.csv',
      sourceReference: 'Polla updated version',
      contentBase64: Buffer.from(nextCsv).toString('base64')
    })
  );
  const preview = await I.readPreview(editionId, file.importId, actorId, 100, 0);
  await I.resolveRow(
    await command(editionId, {
      importId: file.importId,
      rowId: preview.rows[0].id,
      decision: {
        kind: 'correct',
        pollaReference: 'Polla contact clarification',
        corrected: { email: 'updated@example.invalid', telefono: '+56900000009', jugador_id: 'player-0' }
      }
    })
  );
  await I.applyImport(await command(editionId, { importId: file.importId }));
  const more = await S.issueBatch(await command(editionId));
  assert.equal(more.created, 1);
  assert.ok((await S.readPdf(editionId, original.id, actorId)).bytes.equals(bytes));
  assert.equal(await M.Card.countDocuments({ editionId }), 2);
});
test('PDF integrity mismatches are reported rather than silently changing numbers or overwriting evidence', async () => {
  const { editionId } = await fixture(1);
  await S.issueBatch(await command(editionId));
  const card = await M.Card.findOne({ editionId });
  // Simulate external storage corruption, which application schema mutations disallow.
  await M.CardPdf.collection.updateOne({ cardId: card._id }, { $set: { bytes: Buffer.from('corrupt') } });
  await assert.rejects(S.readPdf(editionId, card.id, actorId), (e) => e.publicCode === 'pdf_integrity');
  await assert.rejects(
    S.recoverPdf(await command(editionId, { cardId: card.id })),
    (e) => e.publicCode === 'pdf_integrity'
  );
  assert.deepEqual((await M.Card.findById(card.id)).cells.toObject(), card.cells.toObject());
});
test('staff-only HTTP issuance and PDF access are scoped by permissions and edition; code is not a credential', async () => {
  const { editionId } = await fixture(1, null);
  const version = (await M.Edition.findById(editionId)).version;
  assert.equal(
    (await http(editionId, '/card-settings', 'importer', { expectedVersion: version, settings })).status,
    403
  );
  assert.equal(
    (await http(editionId, '/card-settings', 'administrator', { expectedVersion: version, settings })).status,
    200
  );
  const configured = (await S.summary(editionId)).version;
  assert.equal(
    (await http(editionId, '/cards/issue', 'viewer', { expectedVersion: configured })).status,
    403
  );
  const result = await http(editionId, '/cards/issue', 'importer', { expectedVersion: configured, limit: 1 });
  assert.equal(result.status, 200);
  const card = await M.Card.findOne({ editionId });
  const noAuth = await fetch(`${base}/${editionId}/cards/${card.id}/pdf`);
  assert.equal(noAuth.status, 401);
  const response = await fetch(`${base}/${editionId}/cards/${card.id}/pdf`, {
    headers: { Authorization: `Bearer ${tokens.viewer}` }
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type'), /application\/pdf/);
  const buffer = Buffer.from(await response.arrayBuffer());
  assert.equal(S.sha256(buffer), response.headers.get('X-PDF-SHA256'));
  let extractedCells;
  const parsed = await parsePdf(buffer, {
    pagerender: async (page) => {
      const content = await page.getTextContent({ disableCombineTextItems: true });
      extractedCells = content.items
        .map((item) => item.str)
        .filter((value) => /^(?:\d{1,4}|LIBRE)$/.test(value));
      return content.items.map((item) => item.str).join('\n');
    }
  });
  assert.deepEqual(
    extractedCells,
    card.cells.map((value) => (value === null ? 'LIBRE' : String(value)))
  );
  const text = parsed.text;
  assert.ok(!text.includes('player0@example.invalid'));
  assert.ok(!text.includes('+569'));
  const other = await fixture(1);
  const crossed = await fetch(`${base}/${other.editionId}/cards/${card.id}/pdf`, {
    headers: { Authorization: `Bearer ${tokens.viewer}` }
  });
  assert.equal(crossed.status, 404);
  assert.equal((await http(editionId, '/cards/summary', 'viewer')).data.pdfReady, 1);
});
test(
  '3000 participants get 3000 distinct permanent cards and PDFs through resumable batches',
  { timeout: 180000 },
  async () => {
    const { editionId } = await fixture(3000, { ...settings, columnMode: 'american75' });
    let remaining = 3000,
      created = 0;
    while (remaining) {
      const result = await S.issueBatch(await command(editionId, { limit: 100 }));
      created += result.created;
      remaining = result.remaining;
    }
    assert.equal(created, 3000);
    const cards = await M.Card.find({ editionId });
    assert.equal(cards.length, 3000);
    assert.equal(new Set(cards.map((card) => card.layoutHash)).size, 3000);
    assert.ok(cards.every((card) => matchesVariant(card.cells, { ...settings, columnMode: 'american75' })));
    const pdfs = await M.CardPdf.find({ editionId }).select('+bytes');
    assert.equal(pdfs.length, 3000);
    assert.ok(pdfs.every((pdf) => S.sha256(pdf.bytes) === pdf.sha256));
    assert.equal((await S.summary(editionId)).remaining, 0);
    const report = await I.reconciliation(await M.Edition.findById(editionId));
    assert.equal(report.canClose, true);
    assert.equal((await S.issueBatch(await command(editionId))).created, 0);
    await I.closeList(await command(editionId));
  }
);
