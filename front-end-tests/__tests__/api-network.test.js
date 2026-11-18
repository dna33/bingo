const original = window.BINGO_CONFIG;
afterEach(() => {
  window.BINGO_CONFIG = original;
  jest.resetModules();
  fetch.resetMocks();
});

test('final runtime URLs drive login, pilot requests, PDF/report base and legacy configuration', async () => {
  jest.resetModules();
  window.BINGO_CONFIG = {
    consoleUrl: 'https://console.example.invalid/event/',
    apiBaseUrl: 'https://api.example.invalid/loginAdmin/gateway/bingo-api/'
  };
  const constants = require('../../src/API/api-consts').default;
  const { login, request, base } = require('../../src/back-office/pilot-api');
  expect(constants.CONF).toBe('https://console.example.invalid/event/config.json');
  expect(constants.PROFILE).toBe('https://api.example.invalid/loginAdmin/gateway/bingo-api/profile');
  expect(base).toBe('https://api.example.invalid/loginAdmin/gateway/bingo-api/pilot');
  fetch.mockResponseOnce(JSON.stringify({ token: 'synthetic' }));
  await login('synthetic@example.invalid', 'synthetic');
  expect(fetch.mock.calls[0][0]).toBe(constants.LOGIN_ADMIN);
  fetch.mockResponseOnce(JSON.stringify([]));
  await request('/editions', 'synthetic');
  expect(fetch.mock.calls[1][0]).toBe(base + '/editions');
  expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer synthetic');
  expect(Object.values(constants).every((url) => !url.includes('localhost'))).toBe(true);
});

test('same-origin URLs work with a console subdirectory', () => {
  jest.resetModules();
  window.BINGO_CONFIG = {
    consoleUrl: 'https://event.example.invalid/console',
    apiBaseUrl: 'https://event.example.invalid/bingo-api'
  };
  const constants = require('../../src/API/api-consts').default;
  expect(constants.LOGIN_ADMIN).toBe('https://event.example.invalid/bingo-api/loginAdmin');
  expect(constants.CONF).toBe('https://event.example.invalid/console/config.json');
});

test('missing or invalid runtime configuration stops initialization instead of contacting localhost', () => {
  for (const settings of [
    undefined,
    {},
    { consoleUrl: 'https://event.example.invalid', apiBaseUrl: 'http://api.example.invalid/bingo-api' }
  ]) {
    jest.resetModules();
    window.BINGO_CONFIG = settings;
    expect(() => require('../../src/API/api-consts')).toThrow();
  }
  expect(fetch).not.toHaveBeenCalled();
});
