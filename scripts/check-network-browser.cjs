// Local HTTP/Chrome check only; no database, participants, deliveries or credits.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const express = require('express');
const { networkConfig } = require('../bingo-api/config/network');
const { writeClientConfig } = require('./client-config.cjs');
const Browser = require('./rehearsal/browser.cjs');
process.env.DB_SECRET = 'synthetic-network-browser-only';
const { createApp } = require('../server');
const repo = path.resolve(__dirname, '..');

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bingo-network-browser-'));
  let consoleServer, apiServer, chrome;
  try {
    consoleServer = http.createServer().listen(0, '127.0.0.1');
    apiServer = http.createServer().listen(0, '127.0.0.1');
    await Promise.all([once(consoleServer, 'listening'), once(apiServer, 'listening')]);
    const consoleOrigin = `http://127.0.0.1:${consoleServer.address().port}`;
    const apiOrigin = `http://127.0.0.1:${apiServer.address().port}`;
    const env = { CONSOLE_URL: consoleOrigin + '/console', API_BASE_URL: apiOrigin + '/bingo-api' };
    apiServer.on('request', createApp(networkConfig(env)));
    await writeClientConfig(env, directory);
    const app = express();
    app.get('/console/build/runtime-config.js', (req, res) =>
      res.set('Cache-Control', 'no-store').sendFile(path.join(directory, 'runtime-config.js'))
    );
    app.use('/console/build', express.static(path.join(repo, 'build')));
    app.get('/console/back-office.html', (req, res) => res.sendFile(path.join(repo, 'back-office.html')));
    consoleServer.on('request', app);
    chrome = await Browser.launch(directory);
    const page = await chrome.page(
      consoleOrigin + '/console/back-office.html',
      '!!(window.BINGO_CONFIG && document.querySelector("input[type=password]"))'
    );
    const result = await page.evaluate(`(async () => {
      const base = window.BINGO_CONFIG.apiBaseUrl;
      const health = await fetch(new URL(base).origin + '/health/live');
      const editions = await fetch(base + '/pilot/editions', { headers: { Authorization: 'Bearer invalid' } });
      const login = await fetch(base + '/loginAdmin', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'synthetic-only' }, body: '{}' });
      return { health: health.status, editions: editions.status, login: login.status,
        consoleUrl: window.BINGO_CONFIG.consoleUrl, apiBaseUrl: base,
        loginVisible: document.body.innerText.includes('Iniciar sesión') };
    })()`);
    assert.deepEqual(result, {
      health: 200,
      editions: 401,
      login: 401,
      consoleUrl: env.CONSOLE_URL,
      apiBaseUrl: env.API_BASE_URL,
      loginVisible: true
    });
    console.log(
      JSON.stringify({
        check: 'T-01 local cross-origin browser',
        chrome: chrome.version.Browser,
        result,
        realMessages: 0,
        realCredits: 0
      })
    );
  } finally {
    if (chrome) await chrome.close();
    for (const server of [consoleServer, apiServer]) {
      if (server) await new Promise((resolve) => server.close(resolve));
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
