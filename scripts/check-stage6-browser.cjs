// Local synthetic component check. Uses installed Chrome; no participant data or messages.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const browserify = require('browserify');
const repo = path.resolve(__dirname, '..');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'bingo-stage6-browser-'));
  let server, chrome, ws;
  try {
    const entry = path.join(temp, 'entry.js');
    await fs.writeFile(
      entry,
      `
      window.BINGO_CONFIG={consoleUrl:location.origin,apiBaseUrl:location.origin+'/bingo-api'};
      const React = require(${JSON.stringify(require.resolve('react'))});
      const ReactDOM = require(${JSON.stringify(require.resolve('react-dom'))});
      const Alerts = require(${JSON.stringify(path.join(repo, 'src/back-office/components/CandidateAlerts.js'))}).default;
      const Workflow = require(${JSON.stringify(path.join(repo, 'src/back-office/components/ContactWorkflow.js'))}).default;
      const NativeAudioContext = window.AudioContext;
      window.audioStarts = 0;
      window.AudioContext = function() {
        const ctx = new NativeAudioContext(); window.nativeAudio = ctx;
        const create = ctx.createOscillator.bind(ctx);
        ctx.createOscillator = function() {
          const osc = create(), start = osc.start.bind(osc);
          osc.start = function(...args) { window.audioStarts++; return start(...args); };
          return osc;
        };
        return ctx;
      };
      let acknowledged = false;
      const contact = {candidateId:'synthetic-c1', email:'synthetic@example.invalid', serverTime:new Date().toISOString(),
        workflow:{state:'awaiting_response',cohort:'primary',contactStartedAt:new Date().toISOString(),
          expiresAt:new Date(Date.now()+60000).toISOString()},events:[]};
      window.fetch = async path => ({ok:true, json: async () => path.includes('/alerts?') ? {
        pendingCount:acknowledged?0:1, rows:acknowledged?[]:[{_id:'synthetic-a1',figure:'F',candidateCount:3,
        cohort:'primary',sequence:5,roundId:'synthetic-r1'}]
      } : {...contact,serverTime:new Date().toISOString()}});
      window.mutations = [];
      const props = {root:'/editions/synthetic/game',token:'synthetic',canOperate:true,busy:false,
        run:work=>work(),mutate:async path=>{window.mutations.push(path);acknowledged=true;}};
      ReactDOM.render(React.createElement('main', null,
        React.createElement(Alerts,props), React.createElement(Workflow, {...props,contact,
          permissions:['game:operate','results:confirm'],onContact:()=>{}})), document.getElementById('root'));
    `
    );
    const bundle = await new Promise((resolve, reject) =>
      browserify(entry, { paths: [path.join(repo, 'node_modules')] })
        .transform(require('babelify'), {
          global: false,
          presets: [require.resolve('@babel/preset-env'), require.resolve('@babel/preset-react')],
          plugins: [require.resolve('@babel/plugin-transform-runtime')]
        })
        .bundle((error, buffer) => (error ? reject(error) : resolve(buffer)))
    );
    server = http
      .createServer((req, res) => {
        res.setHeader('Content-Type', req.url === '/bundle.js' ? 'application/javascript' : 'text/html');
        res.end(
          req.url === '/bundle.js'
            ? bundle
            : '<meta charset="utf-8"><div id="root"></div><script src="/bundle.js"></script>'
        );
      })
      .listen(0, '127.0.0.1');
    await once(server, 'listening');
    chrome = spawn(
      process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${path.join(temp, 'profile')}`,
        'about:blank'
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    let stderr = '';
    chrome.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    for (let i = 0; i < 100 && !stderr.includes('DevTools listening on'); i++) await delay(100);
    const match = stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
    if (!match) throw new Error(`Chrome did not start: ${stderr.slice(-1000)}`);
    const targets = await (await fetch(`http://127.0.0.1:${match[1]}/json/list`)).json();
    ws = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (pending.has(message.id)) {
        const p = pending.get(message.id);
        pending.delete(message.id);
        message.error ? p.reject(new Error(message.error.message)) : p.resolve(message.result);
      }
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        pending.set(++id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression, userGesture = false) => {
      const result = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture
      });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    for (let i = 0; i < 100; i++) {
      if (await evaluate('document.body.innerText.includes("Figura F · 3 candidatos")')) break;
      await delay(50);
    }
    assert.equal(await evaluate('window.audioStarts'), 0);
    await evaluate('document.querySelector("button").click()', true);
    await delay(500);
    assert.equal(await evaluate('window.nativeAudio.state'), 'running');
    assert.equal(await evaluate('window.audioStarts'), 1);
    await delay(4100);
    assert.ok(await evaluate('window.audioStarts>=2'));
    assert.ok(
      await evaluate('document.querySelector("[role=timer]").textContent.includes("segundos restantes")')
    );
    await evaluate(
      'Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("Reconocer alerta F")).click()',
      true
    );
    await delay(200);
    assert.equal(await evaluate('window.mutations[0]'), 'alerts/synthetic-a1/acknowledge');
    assert.ok(await evaluate('document.body.innerText.includes("0 alertas sin reconocer")'));
    const starts = await evaluate('window.audioStarts');
    await delay(4100);
    assert.equal(await evaluate('window.audioStarts'), starts);
    console.log(
      JSON.stringify({
        browser: 'Chrome headless',
        audioContext: 'running',
        realOscillators: starts,
        repeatBeforeAcknowledgement: true,
        silenceAfterAcknowledgement: true,
        countdownRendered: true,
        scope: 'synthetic components; no real provider; physical audibility not verified'
      })
    );
  } finally {
    if (ws) ws.close();
    if (chrome && chrome.exitCode === null) {
      chrome.kill('SIGTERM');
      await once(chrome, 'exit');
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
