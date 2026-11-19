const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const path = require('node:path');
process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(require('node:os').tmpdir(), 'bingo-mongodb-binaries');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { spawn } = require('node:child_process');
process.env.NODE_ENV = 'test'; // keeps a local .env (e.g. real provider credentials) out of this run
process.env.DB_SECRET = 'synthetic-stage0-secret-not-for-production';
const { createApp } = require('../server');
const db = require('../bingo-api/models/db');
let mongo, server, base;
before(async () => {
  mongo = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await db.connect(mongo.getUri());
  await Promise.all([mongoose.model('Users').init(), mongoose.model('Admins').init()]);
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await db.disconnect();
  if (mongo) await mongo.stop();
});
async function request(route, body, token) {
  const response = await fetch(base + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { status: response.status, data: await response.json() };
}
test('health, API 404, unauthenticated access and invalid token', async () => {
  assert.equal((await request('/health')).status, 200);
  assert.equal((await request('/bingo-api/missing')).status, 404);
  assert.equal((await request('/bingo-api/profile')).status, 401);
  assert.equal((await request('/bingo-api/profile', undefined, 'invalid')).status, 401);
});
test('registration, duplicate, login, profile, balance and wins persist in MongoDB', async () => {
  const account = { name: 'Synthetic Player', email: 'player@example.invalid', password: 'local-test-password' };
  assert.equal((await request('/bingo-api/register', {})).status, 400);
  const registered = await request('/bingo-api/register', account);
  assert.equal(registered.status, 200);
  const token = registered.data.token;
  assert.ok(token);
  assert.equal((await request('/bingo-api/register', account)).data.isExisted, true);
  assert.equal((await request('/bingo-api/login', { email: account.email, password: 'wrong' })).status, 401);
  assert.ok((await request('/bingo-api/login', account)).data.token);
  const profile = (await request('/bingo-api/profile', undefined, token)).data;
  assert.equal(profile.email, account.email);
  assert.equal(profile.hash, undefined);
  assert.equal(profile.salt, undefined);
  assert.equal((await request('/bingo-api/setNewBalance', { email: account.email, newSum: 5, spending: true }, token)).data.balance, 45);
  assert.equal((await request('/bingo-api/setWins', { email: account.email, wins: 2 }, token)).data.wins, 2);
  assert.equal((await request('/bingo-api/profile', undefined, token)).data.wins, 2);
});
test('admin login and CRUD use supported Mongoose APIs and surface errors', async () => {
  const account = { name: 'Synthetic Admin', email: 'admin@example.invalid', password: 'local-test-password' };
  assert.equal((await request('/bingo-api/registerAdmin', account)).status, 404);
  await require('../bingo-api/pilot/staff').provision({ ...account, roles: ['administrator'] });
  const login = await request('/bingo-api/loginAdmin', account);
  assert.equal(login.status, 200);
  const token = login.data.token;
  const player = { name: 'CRUD Player', email: 'crud@example.invalid', password: 'local-test-password', balance: 20, wins: 0 };
  assert.ok((await request('/bingo-api/createPlayer', { objPlayerData: player }, token)).data.token);
  assert.equal((await request('/bingo-api/createPlayer', { objPlayerData: player }, token)).data.isExisted, true);
  const list = await request('/bingo-api/getPlayersData', undefined, token);
  assert.equal(list.status, 200);
  assert.ok(list.data.some(item => item.email === player.email));
  assert.ok(list.data.every(item => !item.hash && !item.salt));
  const updated = await request('/bingo-api/updatePlayerData', { objPlayerData: { ...player, balance: 42 } }, token);
  assert.equal(updated.data.balance, 42);
  assert.equal((await request('/bingo-api/updatePlayerData', { objPlayerData: { ...player, email: 'missing@example.invalid' } }, token)).status, 404);
  assert.equal((await request('/bingo-api/createPlayer', { objPlayerData: { ...player, email: 'bad@example.invalid', balance: 'invalid' } }, token)).status, 400);
  assert.equal((await request('/bingo-api/deletePlayer', { email: player.email }, token)).data.deletedCount, 1);
});

test('server.js starts against MongoDB and shuts down on SIGTERM', async () => {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DB_URI: mongo.getUri(), PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const exited = once(child, 'exit');
  try {
    const port = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('API startup timed out')), 10000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`API exited early: ${code}`)); });
      child.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/Bingo API listening on (\d+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(response.status, 200);
    child.kill('SIGTERM');
    const [code] = await exited;
    assert.equal(code, 0);
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});
test('server.js exits nonzero when MongoDB is unavailable', async () => {
  // A non-routable local port exercises startup failure, not a mocked database.
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DB_URI: 'mongodb://127.0.0.1:1/bingo_unavailable', PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stderr.on('data', chunk => { output += chunk; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 1);
  assert.match(output, /could not start/);
  assert.ok(!output.includes(process.env.DB_SECRET));
});
