const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { networkConfig } = require('../bingo-api/config/network');
const { writeClientConfig } = require('../scripts/client-config.cjs');
process.env.NODE_ENV = 'test'; // keeps a local .env (e.g. real provider credentials) out of this run
process.env.DB_SECRET = 'synthetic-network-only-secret';
const { createApp } = require('../server');

test('all HTML entries load runtime settings before their application bundle', async () => {
  for (const filename of ['index.html', 'back-office.html', 'discoverer.html']) {
    const html = await fs.readFile(path.join(__dirname, '..', filename), 'utf8');
    const configAt = html.indexOf('<script src="build/runtime-config.js"></script>');
    assert.ok(configAt >= 0 && configAt < html.indexOf('<script src="build/js/'), filename);
  }
});

test('invalid network configuration prevents process startup without printing sensitive URLs', async () => {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      DB_SECRET: 'synthetic-network-only-secret',
      API_BASE_URL: 'https://private-user:private-password@api.example.invalid/bingo-api',
      DB_URI: 'mongodb://127.0.0.1:1/unavailable'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    const [code] = await once(child, 'exit');
    assert.equal(code, 1);
    assert.match(output, /could not start/);
    assert.ok(!/private-user|private-password|synthetic-network-only-secret/.test(output));
  } finally {
    clearTimeout(timer);
  }
});

test('network settings preserve local defaults and normalize final paths/origins', () => {
  assert.deepEqual(networkConfig({}), {
    consoleUrl: 'http://localhost:8000',
    apiBaseUrl: 'http://localhost:8888/bingo-api',
    allowedOrigins: ['http://localhost:8000'],
    host: '127.0.0.1'
  });
  const settings = networkConfig({
    CONSOLE_URL: 'https://Console.example.invalid/event/',
    API_BASE_URL: 'https://api.example.invalid/gateway/bingo-api/',
    HOST: '0.0.0.0',
    CORS_ALLOWED_ORIGINS:
      'https://console.example.invalid, https://support.example.invalid:8443/,https://console.example.invalid'
  });
  assert.equal(settings.consoleUrl, 'https://console.example.invalid/event');
  assert.equal(settings.apiBaseUrl, 'https://api.example.invalid/gateway/bingo-api');
  assert.deepEqual(settings.allowedOrigins, [
    'https://console.example.invalid',
    'https://support.example.invalid:8443'
  ]);
  assert.equal(settings.host, '0.0.0.0');
  assert.deepEqual(
    networkConfig({
      CONSOLE_URL: 'https://console.example.invalid/event',
      API_BASE_URL: 'https://console.example.invalid/bingo-api'
    }).allowedOrigins,
    ['https://console.example.invalid']
  );
});

test('invalid URLs, mixed content, wildcard/path origins and empty configuration fail closed', () => {
  for (const value of [
    '',
    'relative',
    '/bingo-api',
    '//api.example.invalid',
    'javascript:alert(1)',
    'file:///tmp/api',
    'https://user:password@api.example.invalid',
    'https://api.example.invalid?q=x',
    'https://api.example.invalid#fragment',
    'https://api.example.invalid/?',
    'https://api.example.invalid/#'
  ]) {
    assert.throws(() => networkConfig({ API_BASE_URL: value }));
    assert.throws(() => networkConfig({ CONSOLE_URL: value }));
  }
  assert.throws(() => networkConfig({ CONSOLE_URL: 'https://console.example.invalid' }));
  for (const value of [
    '',
    '*',
    'null',
    'https://console.example.invalid/path',
    'https://console.example.invalid,',
    'https://*.example.invalid'
  ]) {
    assert.throws(() => networkConfig({ CORS_ALLOWED_ORIGINS: value }), value);
  }
  assert.throws(() => networkConfig({ HOST: '' }));
});

test('public configuration can be regenerated without bundles and contains no secrets or CORS policy', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bingo-config-'));
  try {
    const env = {
      CONSOLE_URL: 'https://console.example.invalid/event',
      API_BASE_URL: 'https://api.example.invalid/bingo-api',
      DB_SECRET: 'NEVER-PUBLISH',
      DB_URI: 'mongodb://private:NEVER-PUBLISH@internal/db',
      CORS_ALLOWED_ORIGINS: 'https://private.example.invalid'
    };
    await fs.writeFile(path.join(directory, 'bundle.js'), 'unchanged');
    await writeClientConfig(env, directory);
    const context = { window: {} };
    const source = await fs.readFile(path.join(directory, 'runtime-config.js'), 'utf8');
    vm.runInNewContext(source, context);
    assert.deepEqual(JSON.parse(JSON.stringify(context.window.BINGO_CONFIG)), {
      consoleUrl: env.CONSOLE_URL,
      apiBaseUrl: env.API_BASE_URL
    });
    assert.ok(!/NEVER-PUBLISH|mongodb|private.example|DB_SECRET|allowedOrigins/.test(source));
    await writeClientConfig(
      { ...env, API_BASE_URL: 'https://other.example.invalid/proxy/bingo-api' },
      directory
    );
    assert.match(
      await fs.readFile(path.join(directory, 'runtime-config.js'), 'utf8'),
      /other.example.invalid/
    );
    assert.equal(await fs.readFile(path.join(directory, 'bundle.js'), 'utf8'), 'unchanged');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('CORS preflight and authenticated routes respect exact origins without bypassing authentication', async () => {
  const server = createApp(
    networkConfig({
      CORS_ALLOWED_ORIGINS: 'https://console.example.invalid,https://support.example.invalid:8443'
    })
  ).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const origin = 'https://console.example.invalid';
  try {
    for (const allowed of [origin, 'https://support.example.invalid:8443']) {
      const response = await fetch(base + '/bingo-api/pilot/editions', {
        method: 'OPTIONS',
        headers: {
          Origin: allowed,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization, Content-Type, Idempotency-Key'
        }
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('access-control-allow-origin'), allowed);
      assert.match(response.headers.get('vary'), /Origin/);
      assert.match(response.headers.get('vary'), /Access-Control-Request-Headers/);
      assert.match(response.headers.get('access-control-allow-headers'), /Idempotency-Key/);
      assert.equal(response.headers.get('access-control-allow-credentials'), null);
    }
    for (const denied of [
      'https://evil.example.invalid',
      origin + '.evil.invalid',
      'null',
      'http://console.example.invalid',
      'https://console.example.invalid:8443'
    ]) {
      const response = await fetch(base + '/bingo-api/pilot/editions', {
        method: 'POST',
        headers: { Origin: denied, 'Content-Type': 'application/json' },
        body: '{}'
      });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
    }
    for (const headers of [
      { 'Access-Control-Request-Method': 'PATCH' },
      { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'X-Other' }
    ]) {
      assert.equal(
        (
          await fetch(base + '/bingo-api/pilot/editions', {
            method: 'OPTIONS',
            headers: { Origin: origin, ...headers }
          })
        ).status,
        403
      );
    }
    for (const headers of [{}, { Origin: origin }, { Origin: origin, Authorization: 'Bearer invalid' }]) {
      const response = await fetch(base + '/bingo-api/pilot/editions', { headers });
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('access-control-allow-origin'), headers.Origin || null);
    }
    assert.equal((await fetch(base + '/health/live')).status, 200);
    assert.equal((await fetch(base + '/health')).status, 503);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
