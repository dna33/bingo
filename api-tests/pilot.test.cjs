const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
const { fork, spawn } = require('node:child_process');
process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(require('node:os').tmpdir(), 'bingo-mongodb-binaries');
process.env.NODE_ENV = 'test'; // keeps a local .env (e.g. real provider credentials) out of this run
process.env.DB_SECRET = 'synthetic-stage1-secret';
const { MongoMemoryReplSet, MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const db = require('../bingo-api/models/db');
const models = require('../bingo-api/pilot/models');
const { provision } = require('../bingo-api/pilot/staff');
const { execute } = require('../bingo-api/pilot/commands');
const { createEdition, configureEdition, cardRecord, recordEvaluatedDraw } = require('../bingo-api/pilot/persistence');
const { createApp } = require('../server');
const oid = () => new mongoose.Types.ObjectId();
const cells = offset => Array.from({ length: 25 }, (_, i) => i === 12 ? null : offset + i + 1);
let replica, server, base, staffId;
const tokens = {};
before(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await db.connect(replica.getUri());
  await mongoose.connection.db.admin().command({ setParameter: 1, transactionLifetimeLimitSeconds: 3 });
  for (const role of ['administrator', 'operator', 'viewer', 'importer', 'auditor']) {
    const credentials = { email: `${role}@example.invalid`, name: role, password: 'synthetic-password-123', roles: [role] };
    const account = await provision(credentials);
    if (role === 'administrator') staffId = account.id;
    const doc = await mongoose.model('Admins').findById(account.id);
    tokens[role] = doc.generateJwt();
  }
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/bingo-api`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await db.disconnect();
  if (replica) await replica.stop();
});
async function http(route, { method = 'GET', token, body, key } = {}) {
  const response = await fetch(base + route, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json() };
}
async function edition(name = 'Synthetic edition') {
  const editionId = oid();
  await createEdition({ editionId, name, actorId: staffId });
  return editionId;
}
async function playerFixture(editionId, offset = 0) {
  const importId = oid(), sourceRowId = oid();
  const participant = await models.Participant.create({ editionId, sourceRowId, participantKey: `person-${oid()}`,
    emails: ['shared@example.invalid'], phones: ['+56900000000'], name: 'Private name' });
  const card = await models.Card.create(cardRecord({ editionId, participantId: participant._id, sourceRowId, cells: cells(offset) }));
  return { participant, card, importId, sourceRowId };
}
async function gameFixture() {
  const editionId = await edition();
  const player = await playerFixture(editionId);
  await models.Edition.updateOne({ _id: editionId }, { state: 'playing' });
  const round = await models.Round.create({ editionId, ordinal: 0, state: 'playing', rulesVersion: 0, minNumber: 1, maxNumber: 75 });
  const command = { editionId: String(editionId), key: `draw-${oid()}`, expectedVersion: 0, actorId: staffId,
    input: { roundId: String(round._id), number: 11, origin: 'manual' } };
  return { editionId, ...player, round, command };
}
const duplicate = error => error.code === 11000;

test('public registration cannot elevate a player; staff/player tokens and ownership are separated', async () => {
  assert.equal((await http('/registerAdmin', { method: 'POST', body: {} })).status, 404);
  const account = { email: 'legacy-player@example.invalid', name: 'Legacy', password: 'synthetic-password-123', roles: ['administrator'], active: true };
  const token = (await http('/register', { method: 'POST', body: account })).data.token;
  assert.ok(token);
  assert.equal((await http('/pilot/editions', { token })).status, 401);
  assert.equal((await http('/getPlayersData', { token })).status, 401);
  assert.equal((await http('/profile', { token: tokens.administrator })).status, 401);
  assert.equal((await http('/setNewBalance', { method: 'POST', token, body: { email: 'someone-else@example.invalid', newSum: 99 } })).status, 404);
  assert.equal((await http('/pilot/editions')).status, 401);
  const legacyJwt = jwt.sign({ _id: staffId }, process.env.DB_SECRET);
  assert.equal((await http('/pilot/editions', { token: legacyJwt })).status, 401);
});

test('roles enforce configuration, contact, export and audit permissions with explicit projections', async () => {
  const editionId = await edition();
  const { participant } = await playerFixture(editionId);
  const root = `/pilot/editions/${editionId}`;
  for (const role of ['viewer', 'operator', 'importer', 'auditor']) {
    assert.equal((await http(root + '/configuration', { method: 'POST', token: tokens[role], key: 'denied-command', body: { expectedVersion: 0, rules: {} } })).status, 403);
  }
  const list = await http(root + '/participants', { token: tokens.viewer });
  assert.equal(list.status, 200);
  assert.ok(!JSON.stringify(list.data).includes('shared@example.invalid'));
  assert.ok(!JSON.stringify(list.data).includes('Private name'));
  assert.equal((await http(root + `/participants/${participant.id}/contact`, { token: tokens.viewer })).status, 403);
  const contact = await http(root + `/participants/${participant.id}/contact`, { token: tokens.operator });
  assert.equal(contact.status, 200, JSON.stringify(contact));
  assert.deepEqual(contact.data.emails, ['shared@example.invalid'], JSON.stringify(contact));
  assert.equal((await http(root + '/exports/participants', { token: tokens.operator })).status, 403);
  assert.equal((await http(root + '/audit', { token: tokens.operator })).status, 403);
  assert.deepEqual((await http(root + '/exports/participants', { token: tokens.auditor })).data[0].phones, ['+56900000000']);
  const other = await edition('Other edition');
  assert.equal((await http(`/pilot/editions/${other}/participants/${participant.id}/contact`, { token: tokens.operator })).status, 404);
  const trail = await http(root + '/audit', { token: tokens.auditor });
  assert.equal(trail.status, 200);
  assert.equal((await http('/pilot/audit', { token: tokens.viewer })).status, 403);
  const globalTrail = await http('/pilot/audit', { token: tokens.auditor });
  assert.equal(globalTrail.status, 200);
  assert.ok(globalTrail.data.some(event => event.action === 'staff.created'));
  assert.ok(trail.data.some(item => item.action === 'participant.contact_viewed'));
  assert.ok(trail.data.some(item => item.action === 'participants.exported'));
  assert.ok(!JSON.stringify(trail.data).includes('shared@example.invalid'));
  assert.ok(!JSON.stringify(trail.data).includes(process.env.DB_SECRET));
  assert.equal((await http(root + '/participants?limit=99999', { token: tokens.viewer })).status, 400);
  assert.equal((await http('/pilot/editions/not-an-id', { token: tokens.viewer })).status, 400);
});

test('disabled, deleted, unprovisioned and re-provisioned staff lose access immediately', async () => {
  const Admin = mongoose.model('Admins');
  const account = await Admin.create({ email: 'old@example.invalid', name: 'Old' });
  account.setPassword('synthetic-password-123'); await account.save();
  assert.equal((await http('/loginAdmin', { method: 'POST', body: { email: account.email, password: 'synthetic-password-123' } })).status, 401);
  await provision({ email: account.email, name: 'Old', password: 'synthetic-password-123', roles: ['viewer'] });
  const active = await Admin.findById(account.id);
  const token = active.generateJwt();
  assert.equal((await http('/pilot/me', { token })).status, 200);
  await provision({ email: account.email, name: 'Old', password: 'replacement-password-123', roles: ['operator'] });
  assert.equal((await http('/pilot/me', { token })).status, 401);
  const newToken = (await Admin.findById(account.id)).generateJwt();
  await Admin.updateOne({ _id: account._id }, { active: false });
  assert.equal((await http('/pilot/me', { token: newToken })).status, 401);
  await Admin.deleteOne({ _id: account._id });
  assert.equal((await http('/pilot/me', { token: newToken })).status, 401);
});

test('HTTP edition creation/configuration is versioned, idempotent, constrained and audited', async () => {
  const editionId = String(oid());
  const body = { editionId, name: 'HTTP edition' };
  assert.equal((await http('/pilot/editions', { method: 'POST', token: tokens.administrator, body })).status, 201);
  assert.equal((await http('/pilot/editions', { method: 'POST', token: tokens.administrator, body })).status, 201);
  assert.equal(await models.Audit.countDocuments({ editionId, action: 'edition.created' }), 1);
  const root = `/pilot/editions/${editionId}`;
  const options = { method: 'POST', token: tokens.administrator, key: 'configuration-001', body: { expectedVersion: 0, rules: { minNumber: 1, maxNumber: 75 } } };
  const first = await http(root + '/configuration', options);
  assert.equal(first.status, 200);
  assert.equal(first.data.version, 1);
  assert.deepEqual((await http(root + '/configuration', options)).data, first.data);
  assert.equal((await http(root + '/configuration', { ...options, body: { expectedVersion: 0, rules: {} } })).status, 409);
  assert.equal((await http(root + '/configuration', { ...options, key: 'different-key' })).status, 409);
  assert.equal((await http(root + '/configuration', { ...options, key: 'unknown-field', body: { expectedVersion: 1, rules: { password: 'private' } } })).status, 400);
  const versions = await http(root + '/configurations', { token: tokens.viewer });
  assert.equal(versions.data.length, 2);
  assert.equal(versions.data[1].rules.maxNumber, 75);
  assert.equal(await models.Command.countDocuments({ editionId }), 1);
  assert.equal(await models.Audit.countDocuments({ editionId, action: 'edition.configured' }), 1);
  await models.Edition.updateOne({ _id: editionId }, { state: 'ready' });
  assert.equal((await http(root + '/configuration', { ...options, key: 'frozen-config', body: { expectedVersion: 1, rules: {} } })).status, 409);
  assert.equal((await models.Edition.findById(editionId)).version, 1);
});

test('concurrent commands serialize in MongoDB; exactly one stale-version competitor wins', async () => {
  const editionId = await edition();
  const base = { editionId, expectedVersion: 0, actorId: staffId, input: { rules: { minNumber: 1 } } };
  const results = await Promise.allSettled([
    configureEdition({ ...base, key: 'concurrent-one' }), configureEdition({ ...base, key: 'concurrent-two' })
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  assert.equal((await models.Edition.findById(editionId)).version, 1);
  const retry = { ...base, expectedVersion: 1, key: 'same-command-race' };
  const same = await Promise.all([configureEdition(retry), configureEdition(retry)]);
  assert.deepEqual(same[0], same[1]);
  assert.equal((await models.Edition.findById(editionId)).version, 2);
  await assert.rejects(configureEdition({ ...retry, actorId: String(oid()) }), error => error.status === 409);
  assert.equal(await models.Command.countDocuments({ editionId }), 2);
});

test('unique indexes prevent participant/card/draw/award/send duplicates while contacts can be shared', async () => {
  const editionId = await edition();
  const first = await playerFixture(editionId);
  const second = await playerFixture(editionId, 25);
  assert.equal(await models.Participant.countDocuments({ editionId }), 2);
  assert.equal((await models.Participant.findById(first.participant.id)).emails, undefined);
  await assert.rejects(models.Participant.create({ editionId, sourceRowId: oid(), participantKey: first.participant.participantKey,
    emails: ['other@example.invalid'], phones: ['+56911111111'] }), duplicate);
  await assert.rejects(models.Card.create(cardRecord({ editionId, participantId: first.participant._id, sourceRowId: first.sourceRowId, cells: cells(50) })), duplicate);
  await assert.rejects(models.Card.create(cardRecord({ editionId, participantId: oid(), sourceRowId: oid(), cells: cells(0) })), duplicate);
  const invalid = cells(0); invalid[12] = 12;
  await assert.rejects(models.Card.create(cardRecord({ editionId, participantId: oid(), sourceRowId: oid(), cells: invalid })), /null center/);
  const roundId = oid(), draw = { editionId, roundId, sequence: 1, number: 11, operatorId: staffId, origin: 'manual', drawnAt: new Date(), evaluationComplete: true };
  await models.Draw.create(draw);
  await assert.rejects(models.Draw.create({ ...draw, sequence: 2 }), duplicate);
  await assert.rejects(models.Draw.create({ ...draw, number: 12 }), duplicate);
  const award = { editionId, operationKey: 'award-001', candidateId: oid(), poolKey: 'F', amountClp: 50000, state: 'confirmed', confirmedAt: new Date(), confirmedBy: staffId };
  await models.Award.create(award);
  await assert.rejects(models.Award.create({ ...award, candidateId: oid() }), duplicate);
  const send = { editionId, operationKey: 'send-001', participantId: second.participant._id, cardId: second.card._id,
    attempt: 1, channel: 'email', recipient: 'shared@example.invalid', state: 'pending', attemptedAt: new Date() };
  await models.SendAttempt.create(send);
  await assert.rejects(models.SendAttempt.create(send), duplicate);
  const importId = oid();
  const row = { editionId, importId, rowNumber: 1, raw: { email: 'private@example.invalid' } };
  await models.ImportRow.create(row);
  await assert.rejects(models.ImportRow.create(row), duplicate);
  assert.equal((await models.ImportRow.findOne({ importId })).raw, undefined);
  const imported = { editionId, version: 1, sourceHash: 'synthetic-file-hash', originalFile: Buffer.from('private CSV'), filename: 'synthetic.csv', receivedAt: new Date() };
  await models.ImportVersion.create(imported);
  await assert.rejects(models.ImportVersion.create({ ...imported, version: 2 }), duplicate);
  assert.equal((await models.ImportVersion.findOne({ editionId })).originalFile, undefined);
  const fixed = await models.Card.findById(first.card.id);
  fixed.cells = cells(100); fixed.participantId = oid(); await assert.rejects(fixed.save(), /immutable/);
  assert.deepEqual((await models.Card.findById(first.card.id)).cells.toObject(), cells(0));
  assert.equal(String((await models.Card.findById(first.card.id)).participantId), first.participant.id);
  const candidate = { editionId, roundId, drawId: oid(), participantId: first.participant._id, cardId: first.card._id,
    figure: 'F', maskVersion: 1, evidence: { synthetic: true }, state: 'awaiting_response',
    contactStartedAt: new Date('2026-11-16T12:00:00Z'), expiresAt: new Date('2026-11-16T12:01:00Z') };
  const stored = await models.Candidate.create(candidate);
  await assert.rejects(models.Candidate.create({ ...candidate, drawId: oid() }), duplicate);
  assert.equal((await models.Candidate.findById(stored.id)).expiresAt.toISOString(), '2026-11-16T12:01:00.000Z');
});

test('draw, all candidates, edition version, receipt and audit commit together; failures roll back', async () => {
  const game = await gameFixture();
  const second = await playerFixture(game.editionId, 25);
  const evaluate = async () => [game.card, second.card].map(card => ({ cardId: card.id, figure: 'F', maskVersion: 1, evidence: { synthetic: true } }));
  await assert.rejects(recordEvaluatedDraw(game.command, async () => { throw new Error('synthetic evaluator failure'); }), /synthetic/);
  assert.equal(await models.Draw.countDocuments({ editionId: game.editionId }), 0);
  assert.equal((await models.Round.findById(game.round.id)).lastSequence, 0);
  assert.equal((await models.Edition.findById(game.editionId)).version, 0);
  await assert.rejects(recordEvaluatedDraw(game.command, async () => [
    { cardId: game.card.id, figure: 'F', maskVersion: 1, evidence: { synthetic: true } },
    { cardId: String(oid()), figure: 'F', maskVersion: 1, evidence: { synthetic: true } }
  ]), error => error.status === 400);
  assert.equal(await models.Candidate.countDocuments({ editionId: game.editionId }), 0);
  assert.equal(await models.Draw.countDocuments({ editionId: game.editionId }), 0);
  const result = await recordEvaluatedDraw(game.command, evaluate);
  assert.equal(result.candidateCount, 2);
  assert.equal(await models.Candidate.countDocuments({ editionId: game.editionId }), 2);
  assert.deepEqual(await recordEvaluatedDraw(game.command, () => { throw new Error('must not reevaluate replay'); }), result);
  assert.equal(await models.Draw.countDocuments({ editionId: game.editionId }), 1);
  const duplicates = { ...game.command, expectedVersion: 1, key: 'duplicate-number-001' };
  await assert.rejects(recordEvaluatedDraw(duplicates, evaluate), duplicate);
  assert.equal((await models.Edition.findById(game.editionId)).version, 1);
  assert.equal(await models.Audit.countDocuments({ editionId: game.editionId, action: 'draw.evaluated' }), 1);
});

test('a process killed during an uncommitted draw leaves no partial state and the command can be retried', { timeout: 20000 }, async () => {
  const game = await gameFixture();
  const worker = fork(path.join(__dirname, 'helpers/crash-draw.cjs'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const exited = once(worker, 'exit');
  try {
    const message = once(worker, 'message');
    worker.send({ uri: replica.getUri(), command: game.command });
    const [ready] = await message;
    assert.equal(ready.uncommitted, true);
    worker.kill('SIGKILL');
    await exited;
    assert.equal(await models.Draw.countDocuments({ editionId: game.editionId }), 0);
    assert.equal((await models.Edition.findById(game.editionId)).version, 0);
    const result = await recordEvaluatedDraw(game.command, async () => []);
    assert.equal(result.sequence, 1);
    const uri = replica.getUri();
    await db.disconnect(); await db.connect(uri);
    const replay = await recordEvaluatedDraw(game.command, () => { throw new Error('must use durable receipt'); });
    assert.deepEqual(replay, result);
    assert.equal(await models.Draw.countDocuments({ editionId: game.editionId }), 1);
    assert.equal(await models.Command.countDocuments({ editionId: game.editionId }), 1);
  } finally { if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL'); }
});

test('audit cannot be edited/deleted through models; a failed command leaves no success event', async () => {
  const editionId = await edition();
  const event = await models.Audit.findOne({ editionId });
  await assert.rejects(models.Audit.updateOne({ _id: event._id }, { action: 'altered' }), /append-only/);
  await assert.rejects(models.Audit.deleteMany({ editionId }), /append-only/);
  await assert.rejects(event.deleteOne(), /append-only/);
  event.action = 'altered'; await assert.rejects(event.save(), /append-only/);
  await assert.rejects(execute({ editionId, actorId: staffId, key: 'failed-audit-command', expectedVersion: 0, action: 'synthetic.failure', input: {} }, async () => {
    throw new Error('rollback');
  }), /rollback/);
  assert.equal(await models.Audit.countDocuments({ editionId }), 1);
  assert.equal(await models.Command.countDocuments({ editionId }), 0);
});

test('local staff CLI provisions atomically through stdin without printing credentials', async () => {
  async function cli(input) {
    const child = spawn(process.execPath, ['scripts/provision-staff.cjs'], {
      cwd: path.join(__dirname, '..'), env: { ...process.env, DB_URI: replica.getUri() },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const exited = once(child, 'exit');
    child.stdin.end(JSON.stringify(input));
    const [code] = await exited;
    return { code, output };
  }
  const credentials = { email: 'cli@example.invalid', name: 'CLI', password: 'synthetic-cli-password', roles: ['viewer'] };
  const good = await cli(credentials);
  assert.equal(good.code, 0);
  assert.match(good.output, /Staff account provisioned/);
  assert.ok(!good.output.includes(credentials.password));
  assert.ok(!good.output.includes(process.env.DB_SECRET));
  const account = await mongoose.model('Admins').findOne({ email: credentials.email });
  assert.ok(account.validPassword(credentials.password));
  assert.equal(await models.Audit.countDocuments({ resourceId: account._id, action: 'staff.created' }), 1);
  const bad = await cli({ ...credentials, roles: ['invented'] });
  assert.equal(bad.code, 1);
  assert.ok(!bad.output.includes(credentials.password));
  assert.equal((await mongoose.model('Admins').findById(account.id)).tokenVersion, account.tokenVersion);
});

test('a standalone MongoDB is explicitly rejected instead of silently weakening transactions', async () => {
  await db.disconnect();
  const standalone = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  try { await assert.rejects(db.connect(standalone.getUri()), /replica set/); }
  finally { await standalone.stop(); await db.connect(replica.getUri()); }
});
