const { providerConfig } = require('../config/provider');
const mockProvider = require('./mock-provider');
let cache;
function resolve(channel, config) {
  if (config.provider === 'mock') return mockProvider;
  if (channel === 'email') return require('./providers/smtp-provider')(config.smtp);
  return require('./providers/whatsapp-cloud-provider')(config.metaCloudApi);
}
function forChannel(channel, env = process.env) {
  if (!['email', 'whatsapp'].includes(channel)) throw new Error('Invalid channel');
  const config = providerConfig(env)[channel];
  if (env !== process.env) return resolve(channel, config);
  cache = cache || {};
  cache[channel] = cache[channel] || resolve(channel, config);
  return cache[channel];
}
function resetForTests() {
  cache = undefined;
}
function status(env = process.env) {
  const config = providerConfig(env);
  const describe = (c) => ({
    provider: c.provider,
    sandbox: c.provider === 'mock' ? true : Boolean((c.smtp || c.metaCloudApi).sandbox)
  });
  return { email: describe(config.email), whatsapp: describe(config.whatsapp) };
}
module.exports = { forChannel, resetForTests, status };
