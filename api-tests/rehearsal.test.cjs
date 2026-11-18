const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(os.tmpdir(), 'bingo-mongodb-binaries');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { MongoClient, ObjectId, Binary } = require('mongodb');
const { random, shuffle } = require('../scripts/rehearsal/random.cjs');
const { theory, simulate, masks } = require('../scripts/rehearsal/annex.cjs');
const { backup, restore, compare } = require('../scripts/rehearsal/backup.cjs');
let replica, client, temp;
before(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  client = await MongoClient.connect(replica.getUri());
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'bingo-s8-backup-test-'));
});
after(async () => {
  if (client) await client.close();
  if (replica) await replica.stop();
  if (temp) await fs.rm(temp, { recursive: true, force: true });
});
test('seeded fixture draws reproduce and preserve a permutation without changing production randomness', () => {
  const a = random('test-seed'),
    b = random('test-seed');
  assert.deepEqual(shuffle([1, 2, 3, 4, 5], a), shuffle([1, 2, 3, 4, 5], b));
  assert.equal(
    new Set(
      shuffle(
        Array.from({ length: 75 }, (_, i) => i + 1),
        random('balls')
      )
    ).size,
    75
  );
  assert.throws(() => a(3, 3));
});
test('annex equations reproduce the brief and simulation calls real generator and evaluator with recorded seed', () => {
  const f = theory(11, 3000),
    l = theory(9, 3000);
  assert.ok(Math.abs(f.at40 - 0.757374103) < 1e-8);
  assert.equal(f.medianDraws, 38);
  assert.equal(l.medianDraws, 33);
  assert.ok(Math.abs(f.tieProbability - 0.143582258) < 1e-8);
  assert.equal(theory(16, 3000).medianDraws, 48);
  const sample = simulate({ cards: 20, trials: 3, seed: 'repeat' });
  assert.deepEqual(sample, simulate({ cards: 20, trials: 3, seed: 'repeat' }));
  assert.equal(sample.checks.engineProgressComparisons, 420);
  assert.equal(Object.keys(masks).length, 7);
});
test('consistent BSON backup restores binary PDFs, ObjectIds, dates, receipts and unique indexes to an empty database', async () => {
  const source = client.db('source'),
    id = new ObjectId(),
    date = new Date('2026-11-17T12:00:00Z');
  await source.collection('cards').createIndex({ owner: 1 }, { unique: true, name: 'one_card_per_person' });
  await source
    .collection('cards')
    .createIndex(
      { optional: 1 },
      { unique: true, name: 'optional_identity', partialFilterExpression: { optional: { $type: 'string' } } }
    );
  await source.collection('cards').insertOne({
    _id: id,
    owner: 'synthetic',
    bytes: new Binary(Buffer.from('%PDF-synthetic')),
    expiresAt: date
  });
  await source
    .collection('receipts')
    .insertOne({ _id: new ObjectId(), key: 'synthetic-replay', result: { id, number: 17, date } });
  await assert.rejects(backup(source, path.join(temp, 'refused')), /Stop API/);
  const directory = path.join(temp, 'backup'),
    manifest = await backup(source, directory, { writersStopped: true });
  const target = client.db('restored');
  await restore(target, directory);
  await compare(target, manifest);
  const restored = await target.collection('cards').findOne({ _id: id });
  assert.equal(restored.expiresAt.getTime(), date.getTime());
  assert.equal(Buffer.from(restored.bytes.buffer).toString(), '%PDF-synthetic');
  await assert.rejects(target.collection('cards').insertOne({ owner: 'synthetic' }), (e) => e.code === 11000);
  await target
    .collection('cards')
    .insertMany([{ owner: 'other-1' }, { owner: 'other-2' }, { owner: 'other-3', optional: 'unique-id' }]);
  await assert.rejects(
    target.collection('cards').insertOne({ owner: 'other-4', optional: 'unique-id' }),
    (e) => e.code === 11000
  );
  assert.deepEqual(
    (await target.collection('cards').listIndexes().toArray()).find((i) => i.name === 'optional_identity')
      .partialFilterExpression,
    { optional: { $type: 'string' } }
  );
  await assert.rejects(restore(target, directory), /must be empty/);
});
test('checksum failure refuses restore before writing any collection', async () => {
  const source = client.db('tamperSource');
  await source.collection('state').insertOne({ value: 'synthetic' });
  const directory = path.join(temp, 'tampered'),
    manifest = await backup(source, directory, { writersStopped: true });
  await fs.appendFile(path.join(directory, manifest.collections[0].filename), 'corrupt');
  const target = client.db('emptyAfterRefusal');
  await assert.rejects(restore(target, directory), /checksum/);
  assert.equal((await target.listCollections().toArray()).length, 0);
});
