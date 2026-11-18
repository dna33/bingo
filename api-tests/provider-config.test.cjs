const { test } = require('node:test');
const assert = require('node:assert/strict');
const { providerConfig } = require('../bingo-api/config/provider');

test('provider configuration defaults to mock for both channels when unset', () => {
  assert.deepEqual(providerConfig({}), {
    email: { provider: 'mock' },
    whatsapp: { provider: 'mock' }
  });
});

test('smtp configuration is validated only when selected, with sandbox defaulting to true', () => {
  assert.throws(() => providerConfig({ DELIVERY_EMAIL_PROVIDER: 'smtp' }));
  const config = providerConfig({
    DELIVERY_EMAIL_PROVIDER: 'smtp',
    SMTP_HOST: 'smtp.example.invalid',
    SMTP_PORT: '2525',
    SMTP_SECURE: 'true',
    SMTP_USER: 'bingo',
    SMTP_PASS: 'secret',
    SMTP_FROM: 'bingo@example.invalid'
  }).email;
  assert.deepEqual(config, {
    provider: 'smtp',
    smtp: {
      host: 'smtp.example.invalid',
      port: 2525,
      secure: true,
      user: 'bingo',
      pass: 'secret',
      from: 'bingo@example.invalid',
      sandbox: true
    }
  });
  assert.equal(
    providerConfig({
      DELIVERY_EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.example.invalid',
      SMTP_USER: 'bingo',
      SMTP_PASS: 'secret',
      SMTP_FROM: 'bingo@example.invalid',
      SMTP_SANDBOX_MODE: 'false'
    }).email.smtp.sandbox,
    false
  );
});

test('smtp configuration rejects invalid or empty values', () => {
  for (const env of [
    { DELIVERY_EMAIL_PROVIDER: 'other' },
    { DELIVERY_EMAIL_PROVIDER: '' },
    { DELIVERY_EMAIL_PROVIDER: 'smtp', SMTP_HOST: '', SMTP_USER: 'a', SMTP_PASS: 'b', SMTP_FROM: 'c@d.invalid' },
    { DELIVERY_EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'h', SMTP_USER: 'a', SMTP_PASS: 'b', SMTP_FROM: 'c@d.invalid', SMTP_PORT: 'abc' },
    { DELIVERY_EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'h', SMTP_USER: 'a', SMTP_PASS: 'b', SMTP_FROM: 'c@d.invalid', SMTP_SECURE: 'maybe' },
    { DELIVERY_EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'h', SMTP_USER: 'a', SMTP_PASS: 'b', SMTP_FROM: 'c@d.invalid', SMTP_SANDBOX_MODE: 'maybe' }
  ]) {
    assert.throws(() => providerConfig(env), JSON.stringify(env));
  }
});

test('whatsapp configuration is validated only when selected, with sandbox defaulting to true', () => {
  assert.throws(() => providerConfig({ DELIVERY_WHATSAPP_PROVIDER: 'meta_cloud_api' }));
  const config = providerConfig({
    DELIVERY_WHATSAPP_PROVIDER: 'meta_cloud_api',
    WHATSAPP_PHONE_NUMBER_ID: '123456',
    WHATSAPP_ACCESS_TOKEN: 'token',
    WHATSAPP_TEMPLATE_NAME: 'carton_bingo',
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify',
    WHATSAPP_APP_SECRET: 'app-secret'
  }).whatsapp;
  assert.deepEqual(config, {
    provider: 'meta_cloud_api',
    metaCloudApi: {
      phoneNumberId: '123456',
      accessToken: 'token',
      apiVersion: 'v21.0',
      apiBaseUrl: 'https://graph.facebook.com',
      templateName: 'carton_bingo',
      templateLang: 'es',
      webhookVerifyToken: 'verify',
      appSecret: 'app-secret',
      sandbox: true
    }
  });
});

test('whatsapp configuration rejects invalid or empty values', () => {
  for (const env of [
    { DELIVERY_WHATSAPP_PROVIDER: 'other' },
    {
      DELIVERY_WHATSAPP_PROVIDER: 'meta_cloud_api',
      WHATSAPP_PHONE_NUMBER_ID: '',
      WHATSAPP_ACCESS_TOKEN: 'token',
      WHATSAPP_TEMPLATE_NAME: 'carton_bingo',
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify',
      WHATSAPP_APP_SECRET: 'app-secret'
    },
    {
      DELIVERY_WHATSAPP_PROVIDER: 'meta_cloud_api',
      WHATSAPP_PHONE_NUMBER_ID: '123456',
      WHATSAPP_ACCESS_TOKEN: 'token',
      WHATSAPP_TEMPLATE_NAME: 'carton_bingo',
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify',
      WHATSAPP_APP_SECRET: 'app-secret',
      WHATSAPP_SANDBOX_MODE: 'maybe'
    }
  ]) {
    assert.throws(() => providerConfig(env), JSON.stringify(env));
  }
});

test('both channels validate independently of each other', () => {
  const config = providerConfig({
    DELIVERY_EMAIL_PROVIDER: 'smtp',
    SMTP_HOST: 'smtp.example.invalid',
    SMTP_USER: 'bingo',
    SMTP_PASS: 'secret',
    SMTP_FROM: 'bingo@example.invalid'
  });
  assert.equal(config.email.provider, 'smtp');
  assert.equal(config.whatsapp.provider, 'mock');
});
