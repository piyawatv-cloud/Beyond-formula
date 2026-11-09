// Isolated synthetic Chromium only. Shared browser transport follows the gateway harness.
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function browserWsFrom(profile, stderr) {
  const fromStderr = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1] || '';
  if (fromStderr) return fromStderr;
  try {
    const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
    if (/^\d+$/.test(port || '') && /^\/devtools\/browser\//.test(path || '')) return `ws://127.0.0.1:${port}${path}`;
  } catch (_) {}
  return '';
}

async function chromeExecutable() {
  const candidates = [
    process.env.FORMULA_BROWSER_TEST_CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch (_) {}
  }
  return null;
}

async function actualBrowser(t, pageUrl) {
  const executable = await chromeExecutable();
  if (!executable) {
    if (process.env.FORMULA_BROWSER_TEST_REQUIRED === '1') throw new Error('FORMULA_BROWSER_TEST_REQUIRED needs a Chromium executable');
    t.skip('Chromium is unavailable; set FORMULA_BROWSER_TEST_CHROME to run the browser contract');
    return null;
  }
  const profile = await mkdtemp(join(tmpdir(), 'formula-chat-journal-browser-'));
  const child = spawn(executable, ['--headless=new', '--no-first-run', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    if (child.exitCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(5_000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
    await rm(profile, { recursive: true, force: true });
  });
  let browserWs = '';
  for (let attempt = 0; attempt < 400; attempt++) {
    browserWs = await browserWsFrom(profile, stderr);
    if (browserWs) break;
    if (child.exitCode !== null) throw new Error(`Chromium exited before DevTools started: ${stderr}`);
    await sleep(25);
  }
  if (!browserWs) throw new Error(`Timed out starting Chromium after 10s: ${stderr}`);
  const origin = browserWs.replace(/^ws:\/\//, 'http://').replace(/\/devtools\/browser\/.+$/, '');
  return connectBrowserPage(t,origin,pageUrl);
}

async function connectBrowserPage(t,origin,pageUrl) {
  const target = await (await fetch(`${origin}/json/new?${pageUrl}`, { method: 'PUT' })).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map(), dialogs = [], exceptions = [], responses = []; let sequence = 0;
  const connected = new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === "Page.javascriptDialogOpening") dialogs.push({type:message.params.type,message:message.params.message});
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails);
    if (message.method === "Network.responseReceived") responses.push({url:message.params.response.url,status:message.params.response.status});
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timeout); request.resolve(message);
  };
  await connected;
  t.after(() => socket.close());
  const browser = {
    dialogs, exceptions, responses, newPage:pageUrl=>connectBrowserPage(t,origin,pageUrl),
    async send(method, params = {}) {
      const id = ++sequence;
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20_000);
        pending.set(id, { resolve, timeout });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
  await browser.send('Runtime.enable');
  await browser.send('Network.enable');
  await waitForDocument(browser,pageUrl);
  return browser;
}

async function browserValue(browser, expression) {
  const response = await browser.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.error) {
    const error = new Error(response.error.message); error.name = 'CdpProtocolError'; error.code = response.error.code; throw error;
  }
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text || 'browser evaluation failed');
  return response.result?.result?.value;
}


// Connecting CDP does not imply that navigation committed. In particular the
// initial about:blank document is already complete while an HTTP response waits.
async function waitForDocument(browser,pageUrl,timeoutMs=10000) {
  const intended=new URL(pageUrl).href, started=performance.now();let state, navigationError;
  do {
    try {
      state=await browserValue(browser,'({url:location.href,ready:document.readyState,api:typeof window.__fsChatJournal,scripts:Array.from(document.scripts,s=>s.src)})');
      if(state?.url===intended && state.ready==='complete')return state;
    } catch(error) {
      if(error.name!=='CdpProtocolError'||error.code!==-32000||error.message!=='Inspected target navigated or closed')throw error;
      navigationError=error.message;
    }
    await sleep(20);
  } while(performance.now()-started<timeoutMs);
  throw new Error('Intended document did not complete: '+JSON.stringify({intended,state,navigationError,exceptions:browser.exceptions,responses:browser.responses}));
}
export {actualBrowser,browserValue,waitForDocument};
