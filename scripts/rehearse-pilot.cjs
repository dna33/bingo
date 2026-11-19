// Synthetic lab only. This program creates its own replica sets and never accepts a DB URI.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
process.env.NODE_ENV = 'test'; // synthetic lab: keeps a local .env (e.g. real provider credentials) out of this run
process.env.DB_SECRET = 'stage8-synthetic-lab-secret-not-for-production';
process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(os.tmpdir(), 'bingo-mongodb-binaries');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');
const db = require('../bingo-api/models/db');
const M = require('../bingo-api/pilot/models');
const { provision } = require('../bingo-api/pilot/staff');
const { permissionsFor } = require('../bingo-api/pilot/permissions');
const C = require('../bingo-api/pilot/cards');
const D = require('../bingo-api/pilot/deliveries');
const { generateCells, matchesVariant } = require('../bingo-api/pilot/card-generator');
const { fingerprint } = require('../bingo-api/pilot/commands');
const { createApp } = require('../server');
const { random, shuffle, stats } = require('./rehearsal/random.cjs');
const { masks, simulate } = require('./rehearsal/annex.cjs');
const Browser = require('./rehearsal/browser.cjs');
const Backup = require('./rehearsal/backup.cjs');
const repo = path.resolve(__dirname, '..'),
  oid = () => new mongoose.Types.ObjectId();
const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    if (!/^--(cards|draws|trials|output|mode)=/.test(arg)) throw new Error('Unknown option: ' + arg);
    const at = arg.indexOf('=');
    return [arg.slice(2, at), arg.slice(at + 1)];
  })
);
const volumes = (options.cards || '3000,10000').split(',').map(Number),
  draws = Number(options.draws || 60),
  trials = Number(options.trials || 300);
if (
  volumes.some((n) => !Number.isInteger(n) || n < 2 || n > 10000) ||
  !Number.isInteger(draws) ||
  draws < 1 ||
  draws > 75 ||
  !Number.isInteger(trials) ||
  trials < 1 ||
  trials > 2000 ||
  !['all', 'load'].includes(options.mode || 'all')
)
  throw new Error('Invalid lab parameters');
const output = path.resolve(
  options.output ||
    path.join(repo, 'docs/evidencias/etapa8', `ensayo-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
);
let source, restored, server, childServer, chrome, base, lab, adminId;
const tokens = {},
  boots = new Map(),
  results = {
    version: 1,
    syntheticOnly: true,
    realMessagesSent: 0,
    realCreditsExecuted: 0,
    startedAt: new Date().toISOString(),
    parameters: { volumes, draws, trials, mode: options.mode || 'all' },
    loads: [],
    checks: [],
    status: 'running'
  };
const log = (phase, details = {}) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), phase, ...details }));
const hash = (value) => createHash('sha256').update(value).digest('hex');
async function save() {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(results, null, 2) + '\n');
}
async function request(tail, { method = 'GET', body, role = 'administrator', key, status = 200 } = {}) {
  const response = await fetch(base + '/bingo-api/pilot' + tail, {
    method,
    headers: {
      Authorization: `Bearer ${tokens[role]}`,
      'Content-Type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(180000)
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = text;
  }
  if (status !== null)
    assert.equal(
      response.status,
      status,
      `${method} ${tail}: ${response.status} ${JSON.stringify(data).slice(0, 300)}`
    );
  return { status: response.status, data, headers: Object.fromEntries(response.headers) };
}
const get = async (tail, role) => (await request(tail, { role })).data;
async function post(id, tail, input = {}, opts = {}) {
  const expectedVersion =
    opts.expectedVersion === undefined ? (await M.Edition.findById(id)).version : opts.expectedVersion;
  return request(`/editions/${id}${tail}`, {
    method: 'POST',
    body: { expectedVersion, ...input },
    key: opts.key || `s8-${randomUUID()}`,
    ...opts
  });
}
const check = (id, details) => {
  results.checks.push({ id, status: 'passed', ...details });
  log('acceptance-check', { id });
};
function rules({ functional = false } = {}) {
  return {
    roundMode: functional ? 'independent' : 'simultaneous',
    extractionMode: 'manual',
    order: Object.keys(masks),
    repeatWinners: true,
    pauseDuringContact: false,
    roundingPolicy: 'auditable_residual_draw',
    discardPolicy: functional ? 'redispute_remainder' : 'redistribute_confirmed',
    noResponsePolicy: 'advance_keep_unassigned',
    contactClockStart: 'operator_confirms_notice',
    maskReviewConfirmed: true,
    confirmationReference: 'SYNTHETIC REHEARSAL ONLY; not final Fabuloso rule approval',
    figures: Object.entries(masks).map(([name, mask]) => ({
      name,
      mask: functional ? ['10000', '00000', '00100', '00000', '00000'] : mask,
      poolClp: name === 'O' ? 100000 : 50000
    }))
  };
}
async function edition(count, label, { functional = false } = {}) {
  const id = oid(),
    seed = `bingo-etapa8-${label}-cards-v1`,
    draw = random(seed),
    sourceName = `synthetic-${label}.csv`;
  await request('/editions', {
    method: 'POST',
    body: { editionId: id.toString(), name: `ENSAYO SINTETICO ${label}` },
    status: 201
  });
  const csv =
    'email,telefono,jugador_id,nombre\n' +
    Array.from(
      { length: count },
      (_, i) =>
        `s8.${label}.${i}@example.invalid,+569${String(i).padStart(8, '0')},s8-${label}-${String(i).padStart(5, '0')},Sintetico ${i}`
    ).join('\n');
  const content = {
    filename: sourceName,
    contentBase64: Buffer.from(csv).toString('base64'),
    sourceReference: 'SYNTHETIC LIST; NO REAL PARTICIPANTS'
  };
  const start = performance.now(),
    staged = (await post(id, '/imports', content, { status: 201 })).data;
  await post(id, `/imports/${staged.importId}/apply`);
  const importMs = performance.now() - start;
  await fs.mkdir(path.join(lab, 'inputs'), { recursive: true });
  await fs.writeFile(path.join(lab, 'inputs', sourceName), csv, { mode: 0o600 });
  await post(id, '/card-settings', {
    settings: {
      minNumber: 1,
      maxNumber: 75,
      columnMode: 'unrestricted',
      confirmationReference: 'SYNTHETIC VARIANT; NOT APPROVED PILOT RULES'
    }
  });
  let index = 0;
  const generate = (settings) => {
    const cells = generateCells(settings, draw);
    if (functional) {
      const n = [1, 1, 2, 2, 3, 3][index++ % 6],
        old = cells.indexOf(n);
      if (old >= 0) [cells[old], cells[0]] = [cells[0], cells[old]];
      else cells[0] = n;
    }
    return cells;
  };
  const command = async (limit) => ({
    editionId: id,
    actorId: adminId,
    key: `s8-${randomUUID()}`,
    expectedVersion: (await M.Edition.findById(id)).version,
    input: { limit }
  });
  const generateStart = performance.now();
  let batch = await C.issueBatch(await command(1), { generate });
  await post(id, '/game/configure', { settings: rules({ functional }) });
  const blocked = await post(id, '/game/prepare', {}, { status: 409 });
  assert.equal(blocked.data.code, 'reconciliation_incomplete');
  assert.equal(await M.GameRoster.countDocuments({ editionId: id }), 0);
  while (batch.remaining) {
    batch = await C.issueBatch(await command(100), { generate });
    if (batch.totalParticipants % 1000 === 0 || !batch.remaining)
      log('pdf-generation', { count, remaining: batch.remaining });
  }
  const generationMs = performance.now() - generateStart;
  const cards = await M.Card.find({ editionId: id }).sort({ participantId: 1 });
  assert.equal(cards.length, count);
  assert.equal(new Set(cards.map((c) => c.layoutHash)).size, count);
  assert.equal(new Set(cards.map((c) => String(c.participantId))).size, count);
  const artifacts = await M.CardPdf.find({ editionId: id }).select('+bytes'),
    byCard = new Map(artifacts.map((p) => [String(p.cardId), p]));
  let pdfBytes = 0;
  for (const card of cards) {
    assert.ok(matchesVariant(card.cells, { minNumber: 1, maxNumber: 75, columnMode: 'unrestricted' }));
    const pdf = byCard.get(card.id);
    assert.ok(pdf);
    assert.equal(hash(pdf.bytes), card.pdf.sha256);
    assert.equal(pdf.sha256, card.pdf.sha256);
    pdfBytes += pdf.bytes.length;
  }
  const parsed = await require('pdf-parse')(Buffer.from(byCard.get(cards[0].id).bytes));
  assert.ok(parsed.text.includes(cards[0].cardCode));
  const reimport = await post(id, '/imports', content, { status: 201 });
  assert.equal(reimport.data.importId, staged.importId);
  assert.equal(await M.Participant.countDocuments({ editionId: id }), count);
  assert.equal(await M.Card.countDocuments({ editionId: id }), count);
  assert.equal(await M.Delivery.countDocuments({ editionId: id }), 0);
  const reconciliation = await get(`/editions/${id}/reconciliation`);
  assert.equal(reconciliation.canClose, true);
  assert.equal(reconciliation.uniqueParticipants, count);
  await post(id, '/participants/close');
  const preparedAt = performance.now();
  await post(id, '/game/prepare');
  await post(id, '/game/start');
  return {
    id,
    seed,
    cards,
    sourceName,
    sourceSha256: hash(csv),
    layoutSha256: hash(cards.map((c) => c.cells.join(',')).join('\n')),
    importMs,
    generationMs,
    pdfBytes,
    prepareMs: performance.now() - preparedAt,
    reconciliation
  };
}
async function deliveries(fixture, { failure = false } = {}) {
  const { id, cards } = fixture,
    count = cards.length,
    start = performance.now();
  if (failure) {
    await post(id, '/deliveries/enqueue', {
      channel: 'email',
      simulation: 'permanent_failure',
      participantIds: [String(cards[0].participantId)]
    });
  }
  let queued;
  do {
    queued = (
      await post(id, '/deliveries/enqueue', { channel: 'email', simulation: 'delivered', limit: 100 })
    ).data;
  } while (queued.remaining);
  const queuedMs = performance.now() - start;
  const originalCount = await M.Delivery.countDocuments({ editionId: id });
  assert.equal(originalCount, count);
  await post(id, '/deliveries/enqueue', { channel: 'email', simulation: 'delivered', limit: 100 });
  assert.equal(await M.Delivery.countDocuments({ editionId: id }), count);
  let clock = Date.now() + 1000,
    processed = 0;
  const workerStart = performance.now();
  while (true) {
    const batch = await D.processBatch(id, { limit: 100, now: () => new Date((clock += 110)) });
    processed += batch.processed;
    if (processed % 1000 === 0) log('mock-delivery', { count, processed });
    if (!batch.processed) break;
  }
  const workerMs = performance.now() - workerStart;
  const counts = Object.fromEntries(
    (
      await M.Delivery.aggregate([
        { $match: { editionId: id } },
        { $group: { _id: '$state', count: { $sum: 1 } } }
      ])
    ).map((g) => [g._id, g.count])
  );
  assert.equal(counts.delivered, count - (failure ? 1 : 0));
  if (failure) assert.equal(counts.failed, 1);
  const receipts = await M.MockReceipt.find({ editionId: id }).select('+recipient');
  for (const receipt of receipts) {
    assert.ok(receipt.recipient.endsWith('@example.invalid'));
    assert.equal(receipt.contentType, 'application/pdf');
  }
  return {
    count,
    queuedMs,
    workerMs,
    totalMs: performance.now() - start,
    processed,
    counts,
    initialJobs: originalCount,
    clock: 'worker-only virtual clock advances 110ms per clock read; no pacing sleeps',
    configuredSpacingMs: D.SPACING_MS,
    minimumConfiguredPacingMs: Math.max(0, count - 1) * D.SPACING_MS,
    limitation: 'Mock provider receipt only; not email/WhatsApp throughput or proof of real delivery'
  };
}
async function oracle(fixture, numbers) {
  const rank = new Map(numbers.map((n, i) => [n, i + 1])),
    snapshot = await get(`/editions/${fixture.id}/game`),
    summary = [];
  for (const [name, mask] of Object.entries(masks)) {
    const times = fixture.cards.map((card) => ({
      id: card.id,
      time: Math.max(
        ...card.cells.map((n, i) =>
          i === 12 || mask[Math.floor(i / 5)][i % 5] !== '1' ? 0 : rank.get(n) || 76
        )
      )
    }));
    const first = Math.min(...times.map((t) => t.time)),
      expected =
        first > numbers.length
          ? []
          : times
              .filter((t) => t.time === first)
              .map((t) => t.id)
              .sort();
    const actual = (await M.Candidate.find({ editionId: fixture.id, figure: name, cohort: 'primary' }))
      .map((c) => String(c.cardId))
      .sort();
    assert.deepEqual(actual, expected);
    const result = snapshot.results.find((r) => r.figure === name);
    assert.equal(result.primaryCandidateCount, expected.length);
    summary.push({
      figure: name,
      firstSequence: expected.length ? first : null,
      primaryCandidates: expected.length
    });
  }
  return summary;
}
async function load(fixture) {
  const key = 'e' + fixture.id,
    editionData = await get(`/editions/${fixture.id}`);
  for (const role of ['operator', 'operator2'])
    boots.set(key + '-' + role, {
      edition: editionData,
      token: tokens[role],
      permissions: [...permissionsFor({ roles: ['operator'] })]
    });
  const pages = await Promise.all(
    ['operator', 'operator2'].map((role) => chrome.page(base + '/stage8/?boot=' + key + '-' + role))
  );
  await pages[0].focus();
  const seed = `bingo-etapa8-${fixture.cards.length}-draws-v1`,
    numbers = shuffle(
      Array.from({ length: 75 }, (_, i) => i + 1),
      random(seed)
    ).slice(0, draws),
    samples = [];
  try {
    for (const [index, number] of numbers.entries()) {
      await pages[0].until('document.querySelector("section").getAttribute("aria-busy")==="false"');
      await pages[0].evaluate(`window.__stage8Review(${number})`, true);
      await pages[0].evaluate(`window.__stage8Confirm(${number})`, true);
      const measured = await pages[0].until(
        'window.__stage8.active&&(window.__stage8.active.error?{failure:window.__stage8.active.error}:window.__stage8.active.complete&&window.__stage8.measurements.at(-1))'
      );
      assert.ok(!measured.failure, JSON.stringify(measured.failure));
      assert.equal(measured.sequence, index + 1);
      const peer = await pages[1].until(
        `window.__stage8.last&&window.__stage8.last.sequence===${index + 1}&&window.__stage8.last`
      );
      let alertMs = null,
        peerAlertMs = null;
      if (measured.candidateCount) {
        const expected = await M.CandidateAlert.countDocuments({ editionId: fixture.id });
        const alert = await pages[0].until(
          `window.__stage8.alertRendered&&window.__stage8.alertRendered.count===${expected}&&window.__stage8.alertRendered`
        );
        alertMs = alert.epochMs - measured.startEpochMs;
        const peerAlert = await pages[1].until(
          `window.__stage8.alertRendered&&window.__stage8.alertRendered.count===${expected}&&window.__stage8.alertRendered`
        );
        peerAlertMs = peerAlert.epochMs - measured.startEpochMs;
      }
      samples.push({
        ...measured,
        peerConsoleMs: Math.max(0, peer.epochMs - measured.startEpochMs),
        alertMs,
        peerAlertMs
      });
      if ((index + 1) % 10 === 0)
        log('browser-load', {
          cards: fixture.cards.length,
          draws: index + 1,
          primaryMs: Math.round(measured.domAndPaintOpportunityMs),
          peerMs: Math.round(samples.at(-1).peerConsoleMs)
        });
    }
    for (const page of pages) assert.deepEqual(await page.evaluate('window.__stage8.errors'), []);
    const primary = stats(samples.map((s) => s.domAndPaintOpportunityMs)),
      peer = stats(samples.map((s) => s.peerConsoleMs)),
      alerts = stats(samples.filter((s) => s.alertMs !== null).map((s) => s.alertMs)),
      peerAlerts = stats(samples.filter((s) => s.peerAlertMs !== null).map((s) => s.peerAlertMs));
    return {
      cards: fixture.cards.length,
      seed,
      numbers,
      maskProfile:
        'brief reference masks, seven simultaneous figures; rules confirmed only for this synthetic edition',
      consoles: 2,
      playerSessions: 0,
      extractionMode: 'manual real React review/confirm control; HTTP and MongoDB are real',
      primaryConsole: primary,
      peerConsole: peer,
      persistentAlerts: alerts,
      peerPersistentAlerts: peerAlerts,
      underTwoSeconds: {
        primary: primary.p95Ms < 2000,
        peer: peer.p95Ms < 2000,
        alerts: alerts.p95Ms === null ? null : alerts.p95Ms < 2000,
        peerAlerts: peerAlerts.p95Ms === null ? null : peerAlerts.p95Ms < 2000
      },
      firstCandidates: await oracle(fixture, numbers),
      samples
    };
  } finally {
    for (const page of pages) await page.close();
  }
}
async function conflicts() {
  const id = oid();
  await request('/editions', {
    method: 'POST',
    body: { editionId: id.toString(), name: 'SYNTHETIC INVALID CSV' },
    status: 201
  });
  const content =
    'email,telefono,jugador_id\nshared@example.invalid,+56900000001,one\nshared@example.invalid,+56900000001,two\ninvalid,broken,three';
  const file = (
    await post(
      id,
      '/imports',
      {
        filename: 'synthetic-invalid.csv',
        contentBase64: Buffer.from(content).toString('base64'),
        sourceReference: 'SYNTHETIC CONFLICTS ONLY'
      },
      { status: 201 }
    )
  ).data;
  const preview = await get(`/editions/${id}/imports/${file.importId}/preview`);
  assert.ok(preview.rows.some((r) => r.status === 'invalid'));
  assert.ok(preview.rows.some((r) => r.status === 'conflict'));
  await post(id, `/imports/${file.importId}/apply`, {}, { status: 409 });
  assert.equal(await M.Participant.countDocuments({ editionId: id }), 0);
  for (const row of preview.rows)
    await post(id, `/imports/${file.importId}/rows/${row.id}/resolve`, {
      decision: { kind: 'exclude', pollaReference: 'SYNTHETIC EXCLUSION APPROVED FOR TEST ONLY' }
    });
  return { id: String(id), invalidAndSharedRowsReported: true, noSilentMerge: true };
}
async function notify(id, candidate, { failFirst = false } = {}) {
  await post(id, `/game/candidates/${candidate._id}/begin`, {
    channel: 'email',
    evidence: 'SIMULACION: intento, sin contacto real'
  });
  if (failFirst) {
    await post(id, `/game/candidates/${candidate._id}/notice`, {
      success: false,
      evidence: 'SIMULACION: aviso fallido'
    });
    assert.equal((await M.Candidate.findById(candidate._id)).expiresAt, undefined);
  }
  return (
    await post(id, `/game/candidates/${candidate._id}/notice`, {
      success: true,
      evidence: 'SIMULACION: aviso exitoso sin envio real'
    })
  ).data;
}
async function resolveNow(id, candidate) {
  const notice = await notify(id, candidate);
  await post(id, `/game/candidates/${candidate._id}/respond`, {
    receivedAt: new Date().toISOString(),
    evidence: 'SIMULACION: recepcion oportuna; no se contacto a nadie'
  });
  if (!(await M.PollaAccount.exists({ editionId: id, participantId: candidate.participantId })))
    await post(id, '/prizes/accounts', {
      participantId: String(candidate.participantId),
      accountReference: 'SYNTHETIC-NO-CREDIT-' + candidate.participantId,
      evidence: 'SIMULACION: cuenta ficticia; no verificada contra Polla real',
      verifiedWithPolla: true
    });
  assert.equal(new Date(notice.expiresAt) - new Date(notice.contactStartedAt), 60000);
}
async function settle(id, result) {
  const prepared = (
    await post(id, '/prizes/prepare', {
      resultId: String(result._id),
      reason: 'SIMULACION de reparto, no es pago real'
    })
  ).data;
  const proposal = await get(`/editions/${id}/prizes/proposals/${prepared.proposalId}`);
  return post(id, '/prizes/confirm', {
    proposalId: proposal._id,
    reviewed: true,
    reviewedSnapshotHash: proposal.snapshotHash,
    reason: 'SIMULACION: revision de todas las partes y saldos'
  });
}
async function startChild(uri, port) {
  const child = spawn(process.execPath, [path.join(repo, 'server.js')], {
    cwd: repo,
    env: { ...process.env, DB_URI: uri, PORT: String(port), DB_SECRET: process.env.DB_SECRET },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', () => {});
  for (let i = 0; i < 200; i++) {
    if (output.includes('Bingo API listening on')) return child;
    if (child.exitCode !== null) throw new Error('Restored server exited');
    await Browser.sleep(50);
  }
  child.kill();
  throw new Error('Restored server did not start');
}
async function integralRecovery() {
  const fixture = await edition(6, 'integral', { functional: true }),
    id = fixture.id;
  const send = await deliveries(fixture, { failure: true });
  check('PA-16', { failedInitialDoesNotRemoveParticipant: true });
  const original = await M.Delivery.findOne({ editionId: id, state: 'failed' }),
    beforePdf = fixture.cards.map((c) => [c.id, c.pdf.sha256]);
  await post(id, `/deliveries/${original.id}/resend`, {
    channel: 'whatsapp',
    simulation: 'delivered',
    reason: 'SIMULACION: canal alternativo, mismo carton'
  });
  const resent = await M.Delivery.findOne({ parentId: original._id });
  assert.equal(String(resent.participantId), String(original.participantId));
  assert.equal(resent.pdfSha256, original.pdfSha256);
  let clock = Date.now() + 100000;
  await D.processBatch(id, { limit: 100, now: () => new Date((clock += 110)) });
  await D.processBatch(id, { limit: 100, now: () => new Date((clock += 110)) });
  check('PA-22', { resendOriginalParticipantAndPdf: true });
  const frame = await get(`/editions/${id}/game`),
    expectedVersion = frame.version,
    roundId = frame.round._id;
  const keys = ['s8-race-' + randomUUID(), 's8-race-' + randomUUID()];
  const raced = await Promise.all(
    ['operator', 'operator2'].map((role, i) =>
      post(id, '/game/draw', { roundId, number: 1 }, { role, key: keys[i], expectedVersion, status: null })
    )
  );
  assert.deepEqual(raced.map((r) => r.status).sort(), [200, 409]);
  const winner = raced.findIndex((r) => r.status === 200);
  const replay = await post(
    id,
    '/game/draw',
    { roundId, number: 1 },
    { role: winner ? 'operator2' : 'operator', key: keys[winner], expectedVersion }
  );
  assert.deepEqual(replay.data, raced[winner].data);
  assert.equal(await M.Draw.countDocuments({ editionId: id }), 1);
  assert.equal(await M.CandidateAlert.countDocuments({ editionId: id }), 1);
  const candidates = await M.Candidate.find({ editionId: id, cohort: 'primary' }).sort({ _id: 1 });
  assert.equal(candidates.length, 2);
  await request(`/editions/${id}/game/candidates/${candidates[0].id}/contact`, {
    role: 'viewer',
    status: 403
  });
  await request(`/editions/${id}/prizes/reports/pending`, { role: 'importer', status: 403 });
  const privateView = await get(`/editions/${id}/game/candidates/${candidates[0].id}/contact`);
  assert.equal(privateView.participantId, String(candidates[0].participantId));
  assert.ok(privateView.deliveries.length);
  const blocked = await post(
    id,
    '/prizes/prepare',
    {
      resultId: (await M.FigureResult.findOne({ editionId: id })).id,
      reason: 'SIMULACION respuesta pendiente'
    },
    { status: 409 }
  );
  assert.equal(blocked.data.code, 'prize_pending_responses');
  for (const number of [2, 3]) await post(id, '/game/draw', { roundId, number });
  assert.equal(await M.Candidate.countDocuments({ editionId: id, cohort: 'reserve' }), 4);
  const first = await notify(id, candidates[0], { failFirst: true });
  await Browser.sleep(1500);
  const second = await notify(id, candidates[1]);
  const receiptTime = new Date().toISOString();
  assert.ok(Date.parse(second.expiresAt) > Date.parse(first.expiresAt));
  await post(id, '/game/pause');
  const deadlines = await M.Candidate.find({ _id: { $in: candidates.map((c) => c._id) } }).lean();
  const drawBefore = await M.Draw.find({ editionId: id }).sort({ sequence: 1 }).lean();
  const paused = await get(`/editions/${id}/game`);
  const sourcePort = server.address().port;
  await chrome.close();
  chrome = null;
  const outageStart = performance.now();
  await new Promise((resolve) => server.close(resolve));
  server = null;
  const backupStart = performance.now(),
    backupDir = path.join(lab, 'backup');
  const manifest = await Backup.backup(mongoose.connection.db, backupDir, { writersStopped: true });
  const backupMs = performance.now() - backupStart;
  log('backup-created', {
    collections: manifest.collections.length,
    bytes: manifest.collections.reduce((s, c) => s + c.compressedBytes, 0)
  });
  await db.disconnect();
  await source.stop();
  source = null;
  const restoreProcedureStart = performance.now();
  restored = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  const uri = restored.getUri('stage8-restored'),
    client = await MongoClient.connect(uri),
    restoreStart = performance.now();
  try {
    await Backup.restore(client.db(), backupDir);
    results.backup = {
      backupMs,
      restoreMs: performance.now() - restoreStart,
      bytes: manifest.collections.reduce((s, c) => s + c.compressedBytes, 0),
      manifest,
      collections: await Backup.compare(client.db(), manifest)
    };
  } finally {
    await client.close();
  }
  await db.connect(uri);
  const recoveryStart = performance.now();
  childServer = await startChild(uri, sourcePort);
  base = `http://127.0.0.1:${sourcePort}`;
  results.backup.serverRestartMs = performance.now() - recoveryStart;
  results.backup.restorePlusRestartMs = results.backup.restoreMs + results.backup.serverRestartMs;
  const recovered = await get(`/editions/${id}/game`);
  results.backup.fullLabOutageMs = performance.now() - outageStart;
  results.backup.restoreProcedureMs = performance.now() - restoreProcedureStart;
  assert.equal(recovered.version, paused.version);
  assert.equal(recovered.state, 'paused');
  assert.deepEqual(
    (await M.Draw.find({ editionId: id }).sort({ sequence: 1 }).lean()).map((d) => [d.number, d.sequence]),
    drawBefore.map((d) => [d.number, d.sequence])
  );
  for (const before of deadlines) {
    const after = await M.Candidate.findById(before._id);
    assert.equal(after.expiresAt.getTime(), before.expiresAt.getTime());
    assert.equal(after.contactStartedAt.getTime(), before.contactStartedAt.getTime());
  }
  for (const [cardId, sha256] of beforePdf) assert.equal((await M.Card.findById(cardId)).pdf.sha256, sha256);
  const replayAfter = await post(
    id,
    '/game/draw',
    { roundId, number: 1 },
    { role: winner ? 'operator2' : 'operator', key: keys[winner], expectedVersion }
  );
  assert.deepEqual(replayAfter.data, replay.data);
  results.backup.originalDeadlines = deadlines.map((c) => ({
    candidateId: String(c._id),
    contactStartedAt: c.contactStartedAt,
    expiresAt: c.expiresAt
  }));
  check('PA-11', { restoredNewReplicaAndRealServerProcess: true, allCollectionHashesAndIndexesMatch: true });
  check('PA-10', { twoOperatorsStatuses: [200, 409], replayedBeforeAndAfterRestore: true });
  const expires = Math.max(...deadlines.map((c) => c.expiresAt.getTime()));
  while (Date.now() <= expires) {
    log('waiting-original-deadline', { remainingMs: expires - Date.now() });
    await Browser.sleep(Math.min(10000, Math.max(2, expires - Date.now() + 2)));
  }
  await post(id, `/game/candidates/${candidates[0].id}/respond`, {
    receivedAt: receiptTime,
    evidence: 'SIMULACION: respuesta recibida a tiempo y registrada despues del vencimiento'
  });
  await post(id, `/game/candidates/${candidates[1].id}/respond`, {
    receivedAt: new Date().toISOString(),
    evidence: 'SIMULACION: respuesta realmente tardia, no confirma premio'
  });
  assert.equal((await M.Candidate.findById(candidates[0]._id)).state, 'confirmed');
  assert.equal((await M.Candidate.findById(candidates[1]._id)).state, 'discarded');
  await post(id, '/prizes/accounts', {
    participantId: String(candidates[0].participantId),
    accountReference: 'SYNTHETIC-NO-CREDIT-' + candidates[0].participantId,
    evidence: 'SIMULACION: no es cuenta real',
    verifiedWithPolla: true
  });
  await settle(id, await M.FigureResult.findOne({ editionId: id }));
  const promoted = await M.Candidate.find({ editionId: id, cohort: 'primary', allocationCycle: 1 });
  assert.equal(promoted.length, 2);
  assert.ok(promoted.every((c) => !c.expiresAt && c.evidence.sequence === 2));
  for (const c of promoted) await resolveNow(id, c);
  await settle(id, await M.FigureResult.findOne({ editionId: id }));
  for (let ordinal = 1; ordinal < 7; ordinal++) {
    await post(id, '/game/next-round');
    const frame = await get(`/editions/${id}/game`);
    assert.equal(frame.draws.length, 0);
    assert.equal(frame.round.lastSequence, 0);
    await post(id, '/game/draw', { roundId: frame.round._id, number: 1 });
    const result = await M.FigureResult.findOne({ editionId: id, roundId: frame.round._id });
    for (const c of await M.Candidate.find({ roundId: frame.round._id, cohort: 'primary' }))
      await resolveNow(id, c);
    await settle(id, result);
  }
  const budget = await get(`/editions/${id}/prizes`);
  assert.equal(budget.totals.allocatedClp, 400000);
  assert.equal(budget.totals.availableClp, 0);
  const awards = await M.Award.find({ editionId: id }).select('+accountReference');
  for (const award of awards) {
    const key = 's8-synthetic-credit-' + randomUUID(),
      input = {
        awardId: award.id,
        amountClp: award.amountClp,
        accountReference: award.accountReference,
        reference: 'SIMULATION-NO-REAL-CREDIT-' + award.id,
        evidence: 'SIMULACION EXCLUSIVAMENTE: no se abono dinero en Polla',
        creditedAt: new Date().toISOString(),
        creditedToPolla: true
      };
    const version = (await M.Edition.findById(id)).version;
    const result = await post(id, '/prizes/credits', input, { key, expectedVersion: version });
    assert.deepEqual(
      (await post(id, '/prizes/credits', input, { key, expectedVersion: version })).data,
      result.data
    );
  }
  await post(id, '/game/finish', { reason: 'SIMULACION FINALIZADA; sin pagos reales' });
  const final = await get(`/editions/${id}/prizes`),
    pending = await get(`/editions/${id}/prizes/reports/pending`),
    discarded = await get(`/editions/${id}/prizes/reports/discarded`);
  assert.equal(final.totals.deliveredClp, 400000);
  assert.equal(pending.total, 0);
  assert.equal(discarded.total, 1);
  const exported = await request(`/editions/${id}/prizes/reports/delivered?format=csv`);
  assert.ok(exported.data.includes('SIMULATION-NO-REAL-CREDIT-'));
  assert.ok(exported.data.includes('polla.cl'));
  assert.equal(await mongoose.model('Users').countDocuments(), 0);
  for (const [cardId, sha256] of beforePdf) {
    const card = await M.Card.findById(cardId),
      pdf = await M.CardPdf.findOne({ cardId }).select('+bytes');
    assert.equal(card.pdf.sha256, sha256);
    assert.equal(hash(pdf.bytes), sha256);
  }
  for (const idPA of [
    'PA-05',
    'PA-06',
    'PA-07',
    'PA-08',
    'PA-09',
    'PA-12',
    'PA-13',
    'PA-19',
    'PA-20',
    'PA-21',
    'PA-23',
    'PA-24'
  ])
    check(idPA, {
      scope: 'synthetic integral HTTP flow, real MongoDB, restored snapshot; no real provider or credits'
    });
  return {
    editionId: String(id),
    participants: 6,
    independentRounds: 7,
    prizes: awards.length,
    discarded: 1,
    simulatedAllocatedClp: 400000,
    simulatedRecordedCreditsClp: 400000,
    actualCreditsExecuted: 0,
    delivery: send,
    exportSha256: hash(exported.data),
    backupDirectory: backupDir
  };
}
async function main() {
  lab = await fs.mkdtemp(path.join(os.tmpdir(), 'bingo-etapa8-'));
  results.labDirectory = lab;
  results.environment = {
    node: process.version,
    platform: os.platform(),
    arch: os.arch(),
    osRelease: os.release(),
    cpu: os.cpus()[0].model,
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    mongodb: '7.0.14',
    transport: 'loopback HTTP; one-node local replica set; Chrome headless'
  };
  try {
    results.sourceFiles = {};
    for (const name of [
      'package-lock.json',
      'server.js',
      'bingo-api/pilot/game.js',
      'bingo-api/pilot/game-engine.js',
      'bingo-api/pilot/game-routes.js',
      'bingo-api/pilot/contacts.js',
      'bingo-api/pilot/card-generator.js',
      'bingo-api/pilot/cards.js',
      'bingo-api/pilot/deliveries.js',
      'bingo-api/pilot/prizes.js',
      'src/back-office/components/GamePanel.js',
      'src/back-office/components/CandidateAlerts.js',
      'scripts/rehearse-pilot.cjs',
      'scripts/rehearsal/browser.cjs',
      'scripts/rehearsal/backup.cjs',
      'scripts/rehearsal/annex.cjs'
    ])
      results.sourceFiles[name] = hash(await fs.readFile(path.join(repo, name)));
    log('starting', { volumes, draws, lab, output });
    source = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
    await db.connect(source.getUri('stage8-source'));
    for (const role of ['administrator', 'operator', 'operator2', 'viewer', 'importer', 'auditor']) {
      const actualRole = role === 'operator2' ? 'operator' : role,
        account = await provision({
          email: `s8-${role}@example.invalid`,
          name: 'SYNTHETIC ' + role,
          password: 'Synthetic-only-stage8-password',
          roles: [actualRole]
        });
      const staff = await mongoose.model('Admins').findById(account.id);
      tokens[role] = staff.generateJwt();
      if (role === 'administrator') adminId = account.id;
    }
    const code = await Browser.bundle(lab);
    server = require('node:http').createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = 'http://127.0.0.1:' + server.address().port;
    const app = createApp(require('../bingo-api/config/network').networkConfig({
      CONSOLE_URL: base, API_BASE_URL: base + '/bingo-api'
    }));
    app.get('/stage8/boot', async (req, res) => {
      const boot = boots.get(req.query.boot);
      if (!boot) return res.sendStatus(404);
      res.set('Cache-Control', 'no-store').json(boot);
    });
    app.get('/stage8/console.js', (req, res) => res.type('application/javascript').send(code));
    app.get('/stage8/style.css', (req, res) => res.sendFile(path.join(repo, 'build/styles/back-office.css')));
    app.get('/stage8/', (req, res) =>
      res
        .type('html')
        .send(
          '<meta charset="utf-8"><link rel="stylesheet" href="/stage8/style.css"><div id="root"></div><script src="/stage8/console.js"></script>'
        )
    );
    server.on('request', app);
    chrome = await Browser.launch(lab);
    results.environment.chrome = chrome.version.Browser;
    for (const count of volumes) {
      log('volume-start', { count });
      const fixture = await edition(count, String(count));
      check('PA-01', { participants: count });
      check('PA-02', { participants: count, reimportWithoutDuplicates: true });
      check('PA-04', { cards: count, allLayoutsUnique: true, allPdfHashesVerified: true });
      check('PA-15', { participants: count, reconciliationCanClose: true });
      check('PA-17', { missingCardsBlockedStart: true });
      const delivery = await deliveries(fixture);
      check('PA-18', { participants: count, simulatedProviderOnly: true });
      const measurement = await load(fixture);
      results.loads.push({
        ...measurement,
        preparation: {
          importMs: fixture.importMs,
          generationMs: fixture.generationMs,
          pdfBytes: fixture.pdfBytes,
          readyMs: fixture.prepareMs,
          seed: fixture.seed,
          csvSha256: fixture.sourceSha256,
          layoutSha256: fixture.layoutSha256
        },
        delivery
      });
      await save();
      log('volume-finished', {
        count,
        primaryP95: measurement.primaryConsole.p95Ms,
        peerP95: measurement.peerConsole.p95Ms,
        alertP95: measurement.persistentAlerts.p95Ms
      });
    }
    check('PA-14', { volumes, rnf02: results.loads.map((l) => ({ cards: l.cards, ...l.underTwoSeconds })) });
    if ((options.mode || 'all') === 'all') {
      results.conflicts = await conflicts();
      check('PA-03', results.conflicts);
      results.integral = await integralRecovery();
    }
    log('annex-start', { trials });
    const annexStart = performance.now();
    results.annex = simulate({ cards: 3000, trials });
    results.annex.elapsedMs = performance.now() - annexStart;
    results.status = 'passed-functional-checks';
    results.finishedAt = new Date().toISOString();
    results.pilotAuthorized = false;
    results.pending = [
      'Final Fabuloso rule approval, including exhaustion/reserve policy',
      'Live provider enablement and measured limits',
      'Production infrastructure/network and backup RPO/RTO agreement',
      'Human rehearsal of roles, contact workload, physical sound and actual Polla receipt references',
      ...results.loads.flatMap((l) =>
        Object.entries(l.underTwoSeconds)
          .filter(([, pass]) => pass === false)
          .map(([metric]) => `RNF-02 not met locally: ${l.cards} cards ${metric}`)
      )
    ];
    results.processMemory = {
      ...process.memoryUsage(),
      maxRssKiB: process.resourceUsage().maxRSS,
      scope: 'Node rehearsal/API process only; excludes MongoDB and Chrome'
    };
    await save();
    log('finished', { output, status: results.status, pending: results.pending });
  } catch (error) {
    results.status = 'failed';
    results.failure = { message: error.message, stack: error.stack };
    results.finishedAt = new Date().toISOString();
    await save();
    throw error;
  } finally {
    if (chrome) await chrome.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    if (childServer && childServer.exitCode === null) {
      childServer.kill('SIGTERM');
      await once(childServer, 'exit');
    }
    await db.disconnect();
    if (source) await source.stop();
    if (restored) await restored.stop();
    await fs.rm(path.join(lab, 'chrome'), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
main().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
