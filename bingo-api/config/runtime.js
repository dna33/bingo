const { networkConfig } = require('./network');

function integerSetting(env, name, fallback, min, max) {
  const value = env[name] === undefined ? String(fallback) : env[name];
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw new Error(`Invalid ${name}`);
  return Number(value);
}

function runtimeConfig(env = process.env) {
  if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('Node 22 required');
  const mode = env.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(mode)) throw new Error('Invalid NODE_ENV');
  if (!env.DB_SECRET || !env.DB_SECRET.trim() || (mode === 'production' && env.DB_SECRET.length < 32)) {
    throw new Error('Invalid DB_SECRET');
  }
  if (!env.DB_URI || !/^mongodb(?:\+srv)?:\/\//.test(env.DB_URI)) throw new Error('Invalid DB_URI');
  const settings = networkConfig(env);
  if (
    mode === 'production' &&
    (!env.CONSOLE_URL ||
      !env.API_BASE_URL ||
      !settings.consoleUrl.startsWith('https://') ||
      !settings.apiBaseUrl.startsWith('https://'))
  ) {
    throw new Error('Production requires explicit HTTPS URLs');
  }
  return {
    ...settings,
    mode,
    port: integerSetting(env, 'PORT', 8888, 0, 65535),
    startupTimeoutMs: integerSetting(env, 'STARTUP_TIMEOUT_MS', 30000, 1000, 300000),
    healthTimeoutMs: integerSetting(env, 'HEALTH_TIMEOUT_MS', 1000, 100, 10000),
    shutdownTimeoutMs: integerSetting(env, 'SHUTDOWN_TIMEOUT_MS', 10000, 100, 120000)
  };
}
module.exports = { runtimeConfig };
