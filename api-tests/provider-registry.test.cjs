const { test } = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../bingo-api/pilot/provider-registry');
const mockProvider = require('../bingo-api/pilot/mock-provider');

test('an invalid channel is rejected before reading any configuration', () => {
  assert.throws(() => registry.forChannel('sms'), /Invalid channel/);
});

test('both channels resolve to the mock provider by default', () => {
  assert.equal(registry.forChannel('email', {}), mockProvider);
  assert.equal(registry.forChannel('whatsapp', {}), mockProvider);
});

test('resolution with a custom env object never touches or caches against process.env', () => {
  const before = registry.forChannel('email', process.env);
  assert.equal(before, mockProvider);
  registry.forChannel('email', { DELIVERY_EMAIL_PROVIDER: 'mock' });
  assert.equal(registry.forChannel('email', process.env), before);
  assert.equal(process.env.DELIVERY_EMAIL_PROVIDER, undefined);
});

test('resetForTests clears the process.env cache so a later env change is picked up', () => {
  registry.forChannel('email', process.env);
  registry.resetForTests();
  assert.equal(registry.forChannel('email', process.env), mockProvider);
});

test('selecting smtp resolves to a real adapter instance with send/lookup, distinct from the mock', () => {
  const email = registry.forChannel('email', {
    DELIVERY_EMAIL_PROVIDER: 'smtp',
    SMTP_HOST: 'smtp.example.invalid',
    SMTP_USER: 'bingo',
    SMTP_PASS: 'secret',
    SMTP_FROM: 'bingo@example.invalid'
  });
  assert.notEqual(email, mockProvider);
  assert.equal(typeof email.send, 'function');
  assert.equal(typeof email.lookup, 'function');
});

test('selecting meta_cloud_api resolves to a real adapter instance with send/lookup, distinct from the mock', () => {
  const whatsapp = registry.forChannel('whatsapp', {
    DELIVERY_WHATSAPP_PROVIDER: 'meta_cloud_api',
    WHATSAPP_PHONE_NUMBER_ID: '123456',
    WHATSAPP_ACCESS_TOKEN: 'token',
    WHATSAPP_TEMPLATE_NAME: 'carton_bingo',
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify',
    WHATSAPP_APP_SECRET: 'secret'
  });
  assert.notEqual(whatsapp, mockProvider);
  assert.equal(typeof whatsapp.send, 'function');
  assert.equal(typeof whatsapp.lookup, 'function');
});
