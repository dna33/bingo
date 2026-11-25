const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Static, DB-free guard against the regression behind "Revisa los datos e inténtalo de nuevo.":
// a publicCode thrown by the backend (bingo-api/pilot/*.js) must be in server.js's response
// allowlist, or the HTTP layer silently drops it and the back-office shows a useless generic
// message instead of the real reason. Every allowlisted code must also have a Spanish message
// in pilot-api.js, or the console falls back to the same generic text for a different reason.
const root = path.join(__dirname, '..');
function backendCodes() {
  const dir = path.join(root, 'bingo-api/pilot');
  const codes = new Set();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const match of source.matchAll(/publicCode:\s*'([a-z_]+)'|publicCode\s*=\s*'([a-z_]+)'|\bfail\('([a-z_]+)'\)|\binvalid\('([a-z_]+)'/g))
      codes.add(match[1] || match[2] || match[3] || match[4]);
  }
  return codes;
}
function serverAllowlist() {
  const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const block = source.match(/const codes = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(block, 'server.js must define the "codes" response allowlist');
  return new Set([...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
}
function frontendMessageKeys() {
  const source = fs.readFileSync(path.join(root, 'src/back-office/pilot-api.js'), 'utf8');
  return new Set([...source.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]));
}
test('every backend publicCode reaches the HTTP response, and every allowlisted code has a console message', () => {
  const backend = backendCodes(),
    allowlist = serverAllowlist(),
    messages = frontendMessageKeys();
  const droppedByServer = [...backend].filter((c) => !allowlist.has(c));
  const missingMessage = [...allowlist].filter((c) => !messages.has(c));
  assert.deepEqual(
    droppedByServer,
    [],
    'these publicCodes are thrown by the backend but missing from server.js\'s allowlist, so the HTTP response silently drops the code and the console shows the generic fallback message instead of the real reason'
  );
  assert.deepEqual(
    missingMessage,
    [],
    'these publicCodes are in server.js\'s allowlist but have no matching message in pilot-api.js, so the console falls back to the generic message'
  );
});
