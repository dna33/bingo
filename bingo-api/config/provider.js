function booleanSetting(env, name, fallback) {
  const value = env[name] === undefined ? fallback : env[name];
  if (value !== true && value !== false && value !== 'true' && value !== 'false') {
    throw new Error(`Invalid ${name}`);
  }
  return value === true || value === 'true';
}

function integerSetting(env, name, fallback, min, max) {
  const value = env[name] === undefined ? String(fallback) : env[name];
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw new Error(`Invalid ${name}`);
  return Number(value);
}

function stringSetting(env, name, fallback) {
  if (env[name] === undefined) return fallback;
  if (typeof env[name] !== 'string' || !env[name].trim()) throw new Error(`Invalid ${name}`);
  return env[name].trim();
}

function requiredString(env, name) {
  if (typeof env[name] !== 'string' || !env[name].trim()) throw new Error(`Invalid ${name}`);
  return env[name].trim();
}

function emailProviderConfig(env) {
  const provider = stringSetting(env, 'DELIVERY_EMAIL_PROVIDER', 'mock');
  if (!['mock', 'smtp'].includes(provider)) throw new Error('Invalid DELIVERY_EMAIL_PROVIDER');
  if (provider === 'mock') return { provider };
  return {
    provider,
    smtp: {
      host: requiredString(env, 'SMTP_HOST'),
      port: integerSetting(env, 'SMTP_PORT', 587, 1, 65535),
      secure: booleanSetting(env, 'SMTP_SECURE', false),
      user: requiredString(env, 'SMTP_USER'),
      pass: requiredString(env, 'SMTP_PASS'),
      from: requiredString(env, 'SMTP_FROM'),
      sandbox: booleanSetting(env, 'SMTP_SANDBOX_MODE', true)
    }
  };
}

function whatsappProviderConfig(env) {
  const provider = stringSetting(env, 'DELIVERY_WHATSAPP_PROVIDER', 'mock');
  if (!['mock', 'meta_cloud_api'].includes(provider)) throw new Error('Invalid DELIVERY_WHATSAPP_PROVIDER');
  if (provider === 'mock') return { provider };
  return {
    provider,
    metaCloudApi: {
      phoneNumberId: requiredString(env, 'WHATSAPP_PHONE_NUMBER_ID'),
      accessToken: requiredString(env, 'WHATSAPP_ACCESS_TOKEN'),
      apiVersion: stringSetting(env, 'WHATSAPP_API_VERSION', 'v21.0'),
      apiBaseUrl: stringSetting(env, 'WHATSAPP_API_BASE_URL', 'https://graph.facebook.com'),
      templateName: requiredString(env, 'WHATSAPP_TEMPLATE_NAME'),
      templateLang: stringSetting(env, 'WHATSAPP_TEMPLATE_LANG', 'es'),
      webhookVerifyToken: requiredString(env, 'WHATSAPP_WEBHOOK_VERIFY_TOKEN'),
      appSecret: requiredString(env, 'WHATSAPP_APP_SECRET'),
      sandbox: booleanSetting(env, 'WHATSAPP_SANDBOX_MODE', true)
    }
  };
}

function providerConfig(env = process.env) {
  return { email: emailProviderConfig(env), whatsapp: whatsappProviderConfig(env) };
}

module.exports = { providerConfig };
