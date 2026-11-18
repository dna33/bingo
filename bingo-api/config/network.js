const { baseUrl, publicNetwork } = require('../../config/public-network');

function networkConfig(env = process.env) {
  const settings = publicNetwork({
    consoleUrl: env.CONSOLE_URL === undefined ? 'http://localhost:8000' : env.CONSOLE_URL,
    apiBaseUrl: env.API_BASE_URL === undefined ? 'http://localhost:8888/bingo-api' : env.API_BASE_URL
  });
  const raw =
    env.CORS_ALLOWED_ORIGINS === undefined ? new URL(settings.consoleUrl).origin : env.CORS_ALLOWED_ORIGINS;
  const allowedOrigins = [
    ...new Set(
      raw.split(',').map((value) => {
        const normalized = baseUrl(value.trim(), 'CORS_ALLOWED_ORIGINS');
        if (normalized !== new URL(normalized).origin)
          throw new Error('CORS_ALLOWED_ORIGINS must contain origins only');
        return normalized;
      })
    )
  ];
  const host = env.HOST === undefined ? '127.0.0.1' : env.HOST;
  if (typeof host !== 'string' || !host.trim() || host !== host.trim() || /[\s/]/.test(host)) {
    throw new Error('Invalid HOST');
  }
  return { ...settings, allowedOrigins, host };
}

function corsMiddleware(settings) {
  const allowed = new Set(settings.allowedOrigins);
  const methods = ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'OPTIONS'];
  const headers = ['content-type', 'authorization', 'idempotency-key'];
  return (req, res, next) => {
    res.vary('Origin');
    const origin = req.get('Origin');
    if (!origin) return next();
    if (!allowed.has(origin)) return res.status(403).json({ message: 'Origin not allowed' });
    res.set('Access-Control-Allow-Origin', origin);
    if (req.method !== 'OPTIONS') return next();
    res.vary('Access-Control-Request-Method');
    res.vary('Access-Control-Request-Headers');
    const method = req.get('Access-Control-Request-Method');
    const requestedHeaders = (req.get('Access-Control-Request-Headers') || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (!methods.includes(method) || requestedHeaders.some((value) => !headers.includes(value))) {
      return res.status(403).json({ message: 'Preflight not allowed' });
    }
    res.set('Access-Control-Allow-Methods', methods.join(', '));
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
    return res.sendStatus(204);
  };
}

module.exports = { networkConfig, corsMiddleware };
