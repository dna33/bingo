const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
process.env.NODE_ENV = 'test'; // keeps a local .env (e.g. real provider credentials) out of this run
process.env.DB_SECRET = 'synthetic-t02-secret-only-01234567890123456789';
process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(os.tmpdir(), 'bingo-mongodb-binaries');
const { MongoMemoryReplSet, MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const db = require('../bingo-api/models/db');
const { createApp } = require('../server');
const { runtimeConfig } = require('../bingo-api/config/runtime');
const { bounded, topologyOk, verifyUniqueIndexes, closeServer } = require('../bingo-api/operations');
const { checkEnvironment, verifyDependencies } = require('../scripts/check-environment.cjs');
const {
  writeRelease,
  verifyRelease,
  sourceDigest,
  sourceFiles,
  sourceRoots,
  assets
} = require('../scripts/release.cjs');
const { provision } = require('../bingo-api/pilot/staff');
const M = require('../bingo-api/pilot/models');
let replica, directory, env;

before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bingo-t02-'));
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await db.connect(replica.getUri('t02'));
  env = {
    ...process.env,
    DB_URI: replica.getUri('t02'),
    NODE_ENV: 'production',
    PORT: '0',
    HOST: '127.0.0.1',
    DB_SECRET: process.env.DB_SECRET,
    CONSOLE_URL: 'https://console.example.invalid',
    API_BASE_URL: 'https://api.example.invalid/bingo-api',
    CORS_ALLOWED_ORIGINS: 'https://console.example.invalid',
    SHUTDOWN_TIMEOUT_MS: '3000',
    STARTUP_TIMEOUT_MS: '15000',
    HEALTH_TIMEOUT_MS: '500'
  };
});
after(async () => {
  await db.disconnect();
  if (replica) await replica.stop();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

test('runtime config rejects bad ports, deadlines, missing secrets and unsafe final configuration', () => {
  assert.equal(runtimeConfig(env).port, 0);
  for (const [name, value] of [
    ['PORT', 'socket-name'],
    ['PORT', '65536'],
    ['PORT', '-1'],
    ['HEALTH_TIMEOUT_MS', '0'],
    ['SHUTDOWN_TIMEOUT_MS', 'NaN'],
    ['STARTUP_TIMEOUT_MS', '999'],
    ['NODE_ENV', 'prod'],
    ['DB_SECRET', 'short'],
    ['DB_URI', ''],
    ['CONSOLE_URL', 'http://console.example.invalid'],
    ['API_BASE_URL', undefined]
  ]) {
    assert.throws(() => runtimeConfig({ ...env, [name]: value }), name);
  }
});

test('release binds sources, untracked code, lockfile and assets while excluding secrets/runtime URLs', async () => {
  const fixture = path.join(directory, 'release');
  for (const name of sourceRoots) await fs.mkdir(path.join(fixture, name), { recursive: true });
  for (const name of sourceFiles) {
    await fs.mkdir(path.dirname(path.join(fixture, name)), { recursive: true });
    await fs.copyFile(path.join(__dirname, '..', name), path.join(fixture, name));
  }
  for (const name of assets) {
    await fs.mkdir(path.dirname(path.join(fixture, 'build', name)), { recursive: true });
    await fs.writeFile(path.join(fixture, 'build', name), 'synthetic bundle ' + name);
  }
  const manifest = writeRelease(fixture);
  assert.equal(verifyRelease(fixture).buildId, manifest.buildId);
  await fs.writeFile(path.join(fixture, '.env'), 'DB_SECRET=NEVER-PUBLISH');
  await fs.writeFile(path.join(fixture, 'build/runtime-config.js'), 'synthetic URLs');
  assert.equal(verifyRelease(fixture).buildId, manifest.buildId);
  const originalDigest = sourceDigest(fixture);
  await fs.writeFile(path.join(fixture, 'bingo-api/untracked.js'), 'const newCode = true;');
  assert.notEqual(sourceDigest(fixture), originalDigest);
  assert.throws(() => verifyRelease(fixture));
  writeRelease(fixture);
  await fs.appendFile(path.join(fixture, 'package-lock.json'), '\n');
  assert.throws(() => verifyRelease(fixture));
  writeRelease(fixture);
  await fs.appendFile(path.join(fixture, 'build/js/back-office.js'), 'changed');
  assert.throws(() => verifyRelease(fixture));
  await fs.rm(path.join(fixture, 'build/release.json'));
  assert.throws(() => verifyRelease(fixture));
  assert.ok(!JSON.stringify(manifest).includes('NEVER-PUBLISH'));
});

test('dependency inventory compares installed runtime packages to the lockfile', async () => {
  const fixture = path.join(directory, 'dependencies');
  await fs.mkdir(path.join(fixture, 'node_modules/synthetic'), { recursive: true });
  await fs.writeFile(
    path.join(fixture, 'package.json'),
    JSON.stringify({ dependencies: { synthetic: '^1.0.0' } })
  );
  await fs.writeFile(
    path.join(fixture, 'package-lock.json'),
    JSON.stringify({
      packages: {
        'node_modules/synthetic': { version: '1.2.0' }
      }
    })
  );
  await fs.writeFile(
    path.join(fixture, 'node_modules/synthetic/package.json'),
    JSON.stringify({ version: '1.2.0' })
  );
  assert.equal(verifyDependencies(fixture), 1);
  await fs.writeFile(
    path.join(fixture, 'node_modules/synthetic/package.json'),
    JSON.stringify({ version: '1.3.0' })
  );
  assert.throws(() => verifyDependencies(fixture));
});

test('bounded checks expire; topology requires a writable replica member or mongos', async () => {
  await assert.rejects(
    bounded(() => new Promise(() => {}), 30),
    /timed out/
  );
  assert.equal(topologyOk({ setName: 'test', isWritablePrimary: true }), true);
  assert.equal(topologyOk({ setName: 'test', secondary: true }), false);
  assert.equal(topologyOk({ isWritablePrimary: true }), false);
  assert.equal(topologyOk({ msg: 'isdbgrid' }), true);
});

test('read-only preflight succeeds and detects missing unique indexes without repairing them', async () => {
  const initialCollections = await mongoose.connection.db.listCollections().toArray();
  const report = await checkEnvironment(env);
  assert.equal(report.status, 'ok', JSON.stringify(report));
  assert.equal(report.checks.release.release.status, 'verified');
  assert.ok(report.checks.uniqueIndexes.uniqueIndexes > 20);
  assert.equal(report.checks.database.mongoVersion, '7.0.14');
  assert.equal((await mongoose.connection.db.listCollections().toArray()).length, initialCollections.length);
  assert.ok(!JSON.stringify(report).includes(env.DB_SECRET));
  assert.ok(!JSON.stringify(report).includes('mongodb://'));
  const cli = spawn(process.execPath, ['scripts/check-environment.cjs'], {
    cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  cli.stdout.on('data', chunk => { output += chunk; });
  assert.equal((await once(cli, 'exit'))[0], 0);
  assert.equal(JSON.parse(output).status, 'ok');
  const collection = M.Participant.collection;
  const index = (await collection.indexes()).find((value) => value.unique && value.key.participantKey);
  await collection.dropIndex(index.name);
  try {
    const failed = await checkEnvironment(env);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.checks.uniqueIndexes.status, 'failed');
    assert.ok(!(await collection.indexes()).some((value) => value.name === index.name));
    await assert.rejects(verifyUniqueIndexes(mongoose.connection.db));
  } finally {
    await collection.createIndex(index.key, { name: index.name, unique: true });
  }
});

test('preflight refuses standalone MongoDB and redacts configuration/connection failures', async () => {
  const standalone = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  try {
    const report = await checkEnvironment({ ...env, DB_URI: standalone.getUri() });
    assert.equal(report.status, 'failed');
    assert.equal(report.checks.database.status, 'failed');
  } finally {
    await standalone.stop();
  }
  const bad = await checkEnvironment({
    ...env,
    DB_SECRET: 'do-not-print',
    DB_URI: 'mongodb://private:password@127.0.0.1:1'
  });
  assert.equal(bad.status, 'failed');
  assert.ok(!/do-not-print|password|mongodb:/.test(JSON.stringify(bad)));
});

test('readiness reflects Mongo disconnect/recovery; liveness/version remain safe and draining blocks writes', async () => {
  const runtime = { release: verifyRelease(), healthTimeoutMs: 100 };
  const server = createApp(undefined, runtime).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/health')).status, 200);
    await db.disconnect();
    const response = await fetch(base + '/health/ready');
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).status, 'not_ready');
    assert.equal((await fetch(base + '/health/live')).status, 200);
    assert.equal((await (await fetch(base + '/version')).json()).buildId, runtime.release.buildId);
    await db.connect(env.DB_URI);
    assert.equal((await fetch(base + '/health')).status, 200);
    const original = mongoose.connection.db.command;
    mongoose.connection.db.command = () => new Promise(() => {});
    try {
      assert.equal((await fetch(base + '/health')).status, 503);
    } finally {
      mongoose.connection.db.command = original;
    }
    runtime.draining = true;
    assert.equal((await fetch(base + '/health')).status, 503);
    assert.equal((await fetch(base + '/bingo-api/pilot/editions', { method: 'POST' })).status, 503);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('shutdown drains an in-flight response before disconnecting MongoDB', async () => {
  let release, entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const events = [];
  const server = http
    .createServer(async (req, res) => {
      entered();
      await gate;
      events.push('response');
      res.end('complete');
    })
    .listen(0, '127.0.0.1');
  await once(server, 'listening');
  const response = fetch(`http://127.0.0.1:${server.address().port}`);
  await started;
  const closing = closeServer(
    server,
    async () => {
      events.push('disconnect');
    },
    1000
  );
  assert.deepEqual(events, []);
  release();
  assert.equal(await (await response).text(), 'complete');
  await closing;
  assert.deepEqual(events, ['response', 'disconnect']);
});

async function launch(extra = {}) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...env, ...extra },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '',
    errors = '';
  const exited = once(child, 'exit');
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    errors += chunk;
  });
  const port = await bounded(
    () =>
      new Promise((resolve, reject) => {
        child.stdout.on('data', () => {
          const match = output.match(/Bingo API listening on (\d+)/);
          if (match) resolve(Number(match[1]));
        });
        child.once('exit', () => reject(new Error('Early startup failure: ' + errors)));
      }),
    20000
  ).catch((error) => {
    child.kill('SIGKILL');
    throw error;
  });
  return {
    child,
    exited,
    base: `http://127.0.0.1:${port}`,
    port,
    output: () => output,
    errors: () => errors
  };
}

test('real production-mode processes stop/restart with the same build, records, receipts and audit', async () => {
  await provision({
    name: 'Synthetic T02',
    email: 't02@example.invalid',
    password: 'synthetic-test-password',
    roles: ['administrator']
  });
  const actor = await mongoose.model('Admins').findOne({ email: 't02@example.invalid' });
  const headers = { Authorization: 'Bearer ' + actor.generateJwt(), 'Content-Type': 'application/json' };
  let process1 = await launch();
  const editionId = String(new mongoose.Types.ObjectId());
  const post = (instance) =>
    fetch(instance.base + '/bingo-api/pilot/editions/' + editionId + '/configuration', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': 'synthetic-restart-key' },
      body: JSON.stringify({ expectedVersion: 0, rules: { minNumber: 1, maxNumber: 75 } })
    });
  let receipt;
  try {
    assert.equal((await fetch(process1.base + '/health')).status, 200);
    assert.equal((await (await fetch(process1.base + '/version')).json()).status, 'verified');
    assert.equal(
      (
        await fetch(process1.base + '/bingo-api/pilot/editions', {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: 'Synthetic restart', editionId })
        })
      ).status,
      201
    );
    const response = await post(process1);
    assert.equal(response.status, 200);
    receipt = await response.json();
    process1.child.kill('SIGTERM');
    assert.equal((await bounded(() => process1.exited, 5000))[0], 0);
    assert.match(process1.output(), /api.stopped/);
  } finally {
    if (process1.child.exitCode === null) process1.child.kill('SIGKILL');
  }
  const process2 = await launch();
  try {
    assert.equal((await (await fetch(process2.base + '/version')).json()).buildId, verifyRelease().buildId);
    assert.deepEqual(await (await post(process2)).json(), receipt);
    assert.equal((await M.Edition.findById(editionId)).version, 1);
    assert.equal(await M.ConfigVersion.countDocuments({ editionId, version: 1 }), 1);
    assert.equal(await M.Audit.countDocuments({ editionId, action: 'edition.configured' }), 1);
    process2.child.kill('SIGINT');
    assert.equal((await bounded(() => process2.exited, 5000))[0], 0);
  } finally {
    if (process2.child.exitCode === null) process2.child.kill('SIGKILL');
  }
});

test('real shutdown deadline exits nonzero when a request cannot finish', async () => {
  const instance = await launch({ SHUTDOWN_TIMEOUT_MS: '150' });
  const socket = net.connect(instance.port, '127.0.0.1');
  socket.on('error', () => {});
  try {
    await once(socket, 'connect');
    socket.write(
      'POST /bingo-api/loginAdmin HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 2000\r\nExpect: 100-continue\r\n\r\n'
    );
    const [chunk] = await bounded(() => once(socket, 'data'), 1000);
    assert.match(chunk.toString(), /100 Continue/);
    instance.child.kill('SIGTERM');
    assert.equal((await bounded(() => instance.exited, 3000))[0], 1);
    assert.match(instance.errors(), /shutdown exceeded/);
  } finally {
    socket.destroy();
    if (instance.child.exitCode === null) instance.child.kill('SIGKILL');
  }
});
