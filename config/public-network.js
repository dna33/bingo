// Browser-safe: only explicitly public settings belong in this module.
function baseUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch (_) {
    throw new Error(`Invalid ${name}`);
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.hostname.includes('*') ||
    url.username ||
    url.password ||
    url.href.includes('?') ||
    url.href.includes('#')
  ) {
    throw new Error(`Invalid ${name}`);
  }
  return url.href.replace(/\/+$/, '');
}

function publicNetwork(settings) {
  if (!settings) throw new Error('Missing BINGO_CONFIG: load build/runtime-config.js before the application');
  const consoleUrl = baseUrl(settings.consoleUrl, 'CONSOLE_URL');
  const apiBaseUrl = baseUrl(settings.apiBaseUrl, 'API_BASE_URL');
  if (new URL(consoleUrl).protocol === 'https:' && new URL(apiBaseUrl).protocol !== 'https:') {
    throw new Error('API_BASE_URL must use HTTPS with an HTTPS console');
  }
  return { consoleUrl, apiBaseUrl };
}

module.exports = { baseUrl, publicNetwork };
