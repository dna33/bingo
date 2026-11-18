const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const browserify = require('browserify');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function bundle(directory) {
  const repo = path.resolve(__dirname, '../..'),
    entry = path.join(directory, 'console.js');
  await fs.writeFile(
    entry,
    `
    const React=require(${JSON.stringify(require.resolve('react'))});
    const ReactDOM=require(${JSON.stringify(require.resolve('react-dom'))});
    window.BINGO_CONFIG={consoleUrl:location.origin,apiBaseUrl:location.origin+'/bingo-api'};
    const GamePanel=require(${JSON.stringify(path.join(repo, 'src/back-office/components/GamePanel.js'))}).default;
    const nativeFetch=window.fetch.bind(window);
    window.__stage8={snapshot:null,last:null,alerts:null,active:null,measurements:[],errors:[]};
    const lab=window.__stage8;
    window.addEventListener('error',event=>lab.errors.push(event.message));
    window.fetch=async(...args)=>{
      const response=await nativeFetch(...args),url=String(args[0]);
      response.clone().json().then(data=>{
        if(url.endsWith('/game')&&response.ok)lab.snapshot=data;
        if(url.includes('/game/alerts?')&&response.ok)lab.alerts=data;
        if(lab.active&&url.endsWith('/game/draw')&&args[1]&&args[1].method==='POST') {
          if(!response.ok)lab.active.error=data;
          else lab.active.result=data;
        }
        if(lab.active&&url.includes('/game/candidates?'))lab.active.candidatesArrived=true;
        check();
      }).catch(()=>{});
      return response;
    };
    function check(){
      const current=document.querySelector('.game-current'),snapshot=lab.snapshot;
      if(!current||!snapshot||!snapshot.draws.length)return;
      const last=snapshot.draws[snapshot.draws.length-1];
      const status=Array.from(document.querySelectorAll('[role=status]')).some(el=>el.textContent.includes('versión '+snapshot.version+'.'));
      const articles=Array.from(document.querySelectorAll('.game-figures article'));
      const figures=snapshot.results.every(result=>articles.some(article=>
        article.textContent.includes('Figura '+result.figure+' ·')&&
        article.textContent.includes(result.primaryCandidateCount+' candidatos')&&
        article.textContent.includes('Completaciones posteriores en reserva: '+result.reserveCandidateCount+'.')));
      if(status&&figures&&current.textContent.includes(last.number+' · extracción '+last.sequence)) {
        if(!lab.last||lab.last.sequence!==last.sequence||lab.last.version!==snapshot.version)lab.last={sequence:last.sequence,number:last.number,version:snapshot.version,epochMs:performance.timeOrigin+performance.now()};
        const active=lab.active;
        if(active&&active.result&&active.result.sequence===last.sequence&&active.candidatesArrived&&!active.finishing) {
          active.finishing=true;
          requestAnimationFrame(()=>requestAnimationFrame(()=>{
            active.complete=true;active.domAndPaintOpportunityMs=performance.now()-active.start;
            lab.measurements.push({number:last.number,sequence:last.sequence,candidateCount:active.result.candidateCount,
              domAndPaintOpportunityMs:active.domAndPaintOpportunityMs,startEpochMs:active.startEpochMs});
          }));
        }
      }
      const alertSection=document.querySelector('[aria-label="Alertas de candidatos"]');
      if(lab.alerts&&alertSection&&alertSection.textContent.includes(lab.alerts.pendingCount+' alertas sin reconocer.')) {
        if(!lab.alertRendered||lab.alertRendered.count!==lab.alerts.pendingCount)lab.alertRendered={count:lab.alerts.pendingCount,epochMs:performance.timeOrigin+performance.now()};
      }
    }
    new MutationObserver(check).observe(document.getElementById('root'),{childList:true,subtree:true,characterData:true});
    window.__stage8Review=number=>{
      const input=Array.from(document.querySelectorAll('input')).find(i=>i.type==='number');
      if(!input)throw new Error('Manual extraction input unavailable');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(number));
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    };
    window.__stage8Confirm=number=>{
      const button=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Confirmar número '+number);
      if(!button||button.disabled)throw new Error('Confirmation disabled');
      lab.active={start:performance.now(),startEpochMs:performance.timeOrigin+performance.now(),number};button.click();
    };
    async function start(){
      const boot=await(await nativeFetch('/stage8/boot?'+location.search.slice(1))).json();
      let edition=boot.edition;
      function App(){const [current,setCurrent]=React.useState(edition);return React.createElement(GamePanel,{
        edition:current,token:boot.token,permissions:boot.permissions,onChanged:async()=>{
          const response=await window.fetch('/bingo-api/pilot/editions/'+edition._id,{headers:{Authorization:'Bearer '+boot.token}});
          edition=await response.json();setCurrent(edition);
        }});}
      ReactDOM.render(React.createElement(App),document.getElementById('root'));
    }
    start().catch(error=>lab.errors.push(error.message));
  `
  );
  return new Promise((resolve, reject) =>
    browserify(entry, { paths: [path.join(repo, 'node_modules')] })
      .transform(require('babelify'), {
        presets: [require.resolve('@babel/preset-env'), require.resolve('@babel/preset-react')],
        plugins: [require.resolve('@babel/plugin-transform-runtime')]
      })
      .bundle((error, bytes) => (error ? reject(error) : resolve(bytes)))
  );
}
async function launch(directory) {
  const child = spawn(
    process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-sync',
      '--disable-component-update',
      '--metrics-recording-only',
      '--no-pings',
      '--remote-debugging-port=0',
      `--user-data-dir=${path.join(directory, 'chrome')}`,
      'about:blank'
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  let output = '';
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  child.on('error', () => {});
  for (let i = 0; i < 200 && !output.includes('DevTools listening on'); i++) await sleep(50);
  const match = output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
  if (!match) {
    child.kill();
    throw new Error('Chrome could not start: ' + output.slice(-500));
  }
  const debug = `http://127.0.0.1:${match[1]}`,
    sockets = [];
  async function page(url, readyExpression) {
    const target = await (await fetch(debug + '/json/new?about:blank', { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    sockets.push(ws);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    let serial = 0;
    const pending = new Map();
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data),
        call = pending.get(message.id);
      if (call) {
        clearTimeout(call.timer);
        pending.delete(message.id);
        message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result);
      }
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++serial,
          timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error('Chrome command timed out: ' + method));
          }, 90000);
        pending.set(id, { resolve, reject, timer });
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
    const until = async (expression, timeout = 90000) => {
      const start = Date.now();
      let diagnosticLogged = false;
      while (Date.now() - start < timeout) {
        const result = await evaluate(expression);
        if (result) return result;
        if (!diagnosticLogged && Date.now() - start > 5000) {
          diagnosticLogged = true;
          console.log(
            JSON.stringify({
              phase: 'console-wait',
              diagnostic: await evaluate(
                '({visibility:document.visibilityState,text:document.body.innerText.slice(0,1200),lab:window.__stage8&&{last:window.__stage8.last,active:window.__stage8.active,errors:window.__stage8.errors}})'
              )
            })
          );
        }
        await sleep(25);
      }
      throw new Error('Console condition timed out: ' + expression);
    };
    await send('Page.navigate', { url });
    await until(
      readyExpression || 'window.__stage8&&document.querySelector("input[type=number]")&&document.querySelector("section").getAttribute("aria-busy")==="false"'
    );
    return {
      evaluate,
      until,
      focus: () => send('Page.bringToFront'),
      close: async () => {
        ws.close();
        await fetch(debug + '/json/close/' + target.id);
      }
    };
  }
  return {
    page,
    version: await (await fetch(debug + '/json/version')).json(),
    close: async () => {
      for (const ws of sockets) ws.close();
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await once(child, 'exit');
      }
    }
  };
}
module.exports = { bundle, launch, sleep };
