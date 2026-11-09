// Real proxy/edge processes; every endpoint, credential, receipt and CLI state is synthetic.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobIntake } from '../runtime/job-intake.mjs';

const root = new URL('../', import.meta.url).pathname;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check) {
  for (let i = 0; i < 150; i++) { if (await check()) return; await delay(20); }
  throw Error('synthetic process did not become ready');
}
async function listen(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
async function scratch(t) {
  const dir = await mkdtemp(join(tmpdir(), 'formula-backend-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function processAt(t, script, env, healthPath) {
  const portProbe = createServer();
  await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const port = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  const child = spawn(process.execPath, [script], { cwd: root, env: { PATH: process.env.PATH, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => output += chunk);
  child.stderr.on('data', chunk => output += chunk);
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited;
    }
  });
  const origin = `http://127.0.0.1:${port}`;
  await waitFor(async () => {
    if (child.exitCode !== null) throw Error(output);
    try { return (await fetch(origin + healthPath)).ok; } catch { return false; }
  });
  return { origin, output: () => output };
}
async function proxy(t, env = {}, dir) {
  dir ||= await scratch(t);
  const release = join(dir, 'release');
  await mkdir(join(release, 'synthetic'), { recursive: true });
  await writeFile(join(release, 'CURRENT'), 'synthetic');
  await copyFile(join(root, 'tests/fixtures/backend-shell.html'), join(release, 'synthetic/index.html'));
  await writeFile(join(release, 'synthetic/meta.json'), JSON.stringify({ id: 'synthetic', buildStamp: 'synthetic' }));
  return processAt(t, 'runtime/formula-proxy.mjs', {
    FORMULA_STACK: 'synthetic-backend', FORMULA_RELEASE_DIR: release,
    FORMULA_ASSET_DIR: join(root, 'runtime/assets'), FORMULA_LOG_DIR: join(dir, 'logs'),
    SB_ORIGIN: 'http://127.0.0.1:1', SB_SERVICE_KEY: 'synthetic-server-secret',
    FORMULA_SESSION_SECRET: 'synthetic-session-secret', FORMULA_PROBE_TOKEN: 'synthetic-probe',
    FORMULA_JOB_INTEGRITY_INTERVAL_MS: '50', ...env,
  }, '/__formula/health');
}
async function tree(dir) {
  const result = {};
  for (const name of (await readdir(dir)).sort()) {
    const path = join(dir, name), info = await stat(path);
    result[name] = info.isDirectory() ? await tree(path) : { text: await readFile(path, 'utf8'), mode: info.mode, mtime: info.mtimeMs };
  }
  return result;
}

test('local default remains serving, requires browser authentication and never exposes server credentials', async t => {
  const calls = [];
  const upstream = await listen(t, (req, res) => { calls.push({ path: req.url, headers: req.headers }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('[]'); });
  const p = await proxy(t, { SB_ORIGIN: upstream.origin });
  const health = await (await fetch(p.origin + '/__formula/health')).json();
  assert.equal(health.gateway, 'rewritten');
  assert.equal(health.status, 'degraded', 'synthetic shell deliberately cannot prove sealed-app readiness');
  assert.equal(health.configuredBackend, 'local');
  assert.equal(health.backendConfiguration, 'valid');
  assert.equal(health.servingEligible, true);
  assert.equal((await fetch(p.origin + '/sb/rest/v1/fs_meta')).status, 401);
  assert.equal((await fetch(p.origin + '/sb/rest/v1/fs_meta', { headers: { apikey: 'synthetic-probe' } })).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.authorization, undefined);
  assert.equal(calls[0].headers.apikey, undefined);
  const page = await (await fetch(p.origin + '/')).text();
  assert.match(page, /session-cookie/);
  assert.ok(!page.includes('synthetic-server-secret'));
  assert.ok(!JSON.stringify(health).includes('synthetic-server-secret'));
});

test('explicit Supabase serving uses only server-side bearer compatibility path', async t => {
  const calls = [];
  const upstream = await listen(t, (req, res) => { calls.push({ path: req.url, headers: req.headers }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('[]'); });
  const p = await proxy(t, { FORMULA_BACKEND: 'supabase', FORMULA_TRAFFIC_MODE: 'serving', SB_ORIGIN: upstream.origin, SB_REST_BASE: '/rest/v1', SB_UPSTREAM_AUTH: 'bearer' });
  const health = await (await fetch(p.origin + '/__formula/health')).json();
  assert.equal(health.configuredBackend, 'supabase');
  assert.equal(health.servingEligible, true);
  assert.equal((await fetch(p.origin + '/sb/rest/v1/fs_meta')).status, 401);
  assert.equal((await fetch(p.origin + '/sb/rest/v1/fs_meta', { headers: { apikey: 'synthetic-probe' } })).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/rest/v1/fs_meta');
  assert.equal(calls[0].headers.authorization, 'Bearer synthetic-server-secret');
  assert.equal(calls[0].headers.apikey, 'synthetic-server-secret');
  const page = await (await fetch(p.origin + '/')).text();
  assert.ok(!page.includes('synthetic-server-secret'));
  assert.ok(!JSON.stringify(health).includes(upstream.origin));
});

test('standby cannot serve any route, contact upstream, replay pending receipts or modify shared intake', async t => {
  const dir = await scratch(t), intakeDir = join(dir, 'intake');
  const journal = await new JobIntake({ dir: intakeDir }).init();
  await journal.capture({ p_id: 'A07001', p_data: { id: 'A07001', customer: 'Synthetic', rows: [] }, p_expected: null }, { name: 'Synthetic', role: 'sales', centralUserId: 'synthetic-user' });
  // Detect even init() chmods and replay status/observation writes.
  await chmod(join(intakeDir, 'receipts'), 0o750);
  const before = await tree(intakeDir);
  const calls = [];
  const upstream = await listen(t, (req, res) => { calls.push(req.url); res.writeHead(200, { 'content-type': 'application/json' }); res.end('[]'); });
  const p = await proxy(t, { FORMULA_BACKEND: 'supabase', FORMULA_TRAFFIC_MODE: 'standby', SB_ORIGIN: upstream.origin, SB_REST_BASE: '/rest/v1', SB_UPSTREAM_AUTH: 'bearer', FORMULA_JOB_INTAKE_DIR: intakeDir, IAM_CONSUMER_ORIGIN: upstream.origin, IAM_CONSUMER_SHARED_SECRET: 'synthetic-iam' }, dir);
  const health = await (await fetch(p.origin + '/__formula/health')).json();
  assert.equal(health.configuredBackend, 'supabase');
  assert.equal(health.backendConfiguration, 'valid');
  assert.equal(health.status, 'standby');
  assert.equal(health.servingEligible, false);
  assert.equal(health.jobIntake, 'standby');
  for (const [path, method] of [['/', 'GET'], ['/sb/session', 'POST'], ['/sb/rest/v1/fs_meta', 'GET'], ['/sb/rest/v1/rpc/fs_save_record', 'POST'], ['/__formula/job-integrity', 'GET'], ['/__formula/job-versions', 'GET'], ['/__formula/visible-record-ids', 'GET'], ['/__formula/provisioning/profile/find', 'POST'], ['/__formula/client-diagnostic', 'POST'], ['/__formula/rollback-chat-recovery', 'GET']]) {
    const response = await fetch(p.origin + path, { method, headers: { apikey: 'synthetic-probe', 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
    assert.equal(response.status, 503, path);
  }
  await delay(220);
  assert.deepEqual(calls, []);
  assert.deepEqual(await tree(intakeDir), before);
  assert.equal((await stat(join(intakeDir, 'receipts'))).mode & 0o777, 0o750);
  assert.ok(!p.output().includes('synthetic-server-secret'));
});

for (const [name, env] of [
  ['implicit Supabase origin', { SB_ORIGIN: 'https://synthetic.supabase.co' }],
  ['implicit Supabase origin with DNS trailing dot', { SB_ORIGIN: 'https://synthetic.supabase.co.' }],
  ['public plaintext bearer transport', { FORMULA_BACKEND: 'supabase', FORMULA_TRAFFIC_MODE: 'serving', SB_ORIGIN: 'http://synthetic.supabase.co', SB_REST_BASE: '/rest/v1', SB_UPSTREAM_AUTH: 'bearer' }],
  ['unknown upstream auth', { SB_UPSTREAM_AUTH: 'typo-secret-marker' }],
  ['Supabase without explicit traffic mode', { FORMULA_BACKEND: 'supabase', SB_REST_BASE: '/rest/v1', SB_UPSTREAM_AUTH: 'bearer' }],
  ['Supabase without bearer auth', { FORMULA_BACKEND: 'supabase', FORMULA_TRAFFIC_MODE: 'serving', SB_REST_BASE: '/rest/v1' }],
  ['Supabase wrong REST path', { FORMULA_BACKEND: 'supabase', FORMULA_TRAFFIC_MODE: 'serving', SB_UPSTREAM_AUTH: 'bearer' }],
  ['unknown backend', { FORMULA_BACKEND: 'typo-secret-marker' }],
  ['unknown traffic mode', { FORMULA_TRAFFIC_MODE: 'typo-secret-marker' }],
  ['URL with credentials', { SB_ORIGIN: 'http://synthetic-secret:password@127.0.0.1:1' }],
  ['missing credential', { SB_SERVICE_KEY: '' }],
]) {
  test(`misconfiguration fails closed before intake or upstream access: ${name}`, async t => {
    const dir = await scratch(t), intake = join(dir, 'must-not-exist');
    const p = await proxy(t, { FORMULA_JOB_INTAKE_DIR: intake, ...env }, dir);
    const response = await fetch(p.origin + '/__formula/health'), text = await response.text(), health = JSON.parse(text);
    assert.equal(health.status, 'degraded');
    assert.equal(health.backendConfiguration, 'invalid');
    assert.equal(health.servingEligible, false);
    assert.equal((await fetch(p.origin + '/sb/rest/v1/fs_meta', { headers: { apikey: 'synthetic-probe' } })).status, 503);
    assert.equal((await fetch(p.origin + '/')).status, 503);
    await assert.rejects(stat(intake), { code: 'ENOENT' });
    assert.ok(!text.includes('synthetic-secret'));
    assert.ok(!text.includes('typo-secret-marker'));
    assert.ok(!p.output().includes('synthetic-secret'));
    assert.ok(!p.output().includes('typo-secret-marker'));
  });
}

async function edge(t, { blueMode = 'standby', blueEligible = true, greenEligible = true } = {}) {
  const dir = await scratch(t), userCalls = [], state = { greenHealthy: true, greenBreak: false };
  await writeFile(join(dir, 'active'), 'green\n');
  const blue = await listen(t, (req, res) => {
    if (req.url === '/__formula/health') return res.end(JSON.stringify({ status: 'ok', release: 'synthetic', configuredBackend: 'supabase', servingEligible: blueEligible }));
    userCalls.push('blue'); res.end('blue-user-data');
  });
  const green = await listen(t, (req, res) => {
    if (req.url === '/__formula/health') return res.end(JSON.stringify({ status: state.greenHealthy ? 'ok' : 'degraded', release: 'synthetic', configuredBackend: 'local', servingEligible: greenEligible }));
    userCalls.push('green'); if (state.greenBreak) return res.destroy(); res.end('green-user-data');
  });
  const p = await processAt(t, 'runtime/formula-edge.mjs', { FORMULA_STATE_DIR: dir, FORMULA_LOG_DIR: join(dir, 'logs'), FORMULA_BLUE_ORIGIN: blue.origin, FORMULA_GREEN_ORIGIN: green.origin, FORMULA_BLUE_TRAFFIC_MODE: blueMode, FORMULA_HEALTH_INTERVAL_MS: '40', FORMULA_FAILURE_THRESHOLD: '1', FORMULA_UNAVAILABLE_PAGE: join(root, 'runtime/formula-unavailable.html') }, '/__formula_edge/health');
  return { ...p, dir, userCalls, state };
}

test('edge excludes standby from routing, cross-color retry and automatic failover even if old proxy says ok', async t => {
  const p = await edge(t);
  assert.equal(await (await fetch(p.origin + '/')).text(), 'green-user-data');
  p.state.greenBreak = true;
  assert.equal((await fetch(p.origin + '/')).status, 503, 'no retry into standby');
  p.state.greenHealthy = false;
  await delay(160);
  assert.equal((await fetch(p.origin + '/')).status, 503, 'no passive fallback');
  assert.equal(await readFile(join(p.dir, 'active'), 'utf8'), 'green\n', 'no automatic failover');
  assert.ok(!p.userCalls.includes('blue'));
  const health = await (await fetch(p.origin + '/__formula_edge/health')).json();
  assert.equal(health.backends.blue.servingEligible, false);
  assert.equal(health.backends.green.configuredBackend, 'local');
  assert.equal(health.backends.green.servingEligible, true);
});

test('edge respects proxy serving eligibility and rejects malformed local traffic mode', async t => {
  for (const options of [{ blueMode: '', blueEligible: false }, { blueMode: 'typo-secret-marker' }]) {
    const p = await edge(t, options); p.state.greenHealthy = false;
    await delay(140);
    assert.equal((await fetch(p.origin + '/')).status, 503);
    assert.ok(!p.userCalls.includes('blue'));
    const health = await (await fetch(p.origin + '/__formula_edge/health')).json();
    assert.ok(!JSON.stringify(health).includes('typo-secret-marker'));
  }
});

test('edge normal serving color still receives automatic failover and retry', async t => {
  const p = await edge(t, { blueMode: 'serving' });
  p.state.greenBreak = true;
  assert.equal(await (await fetch(p.origin + '/')).text(), 'blue-user-data');
  p.state.greenHealthy = false;
  await waitFor(async () => (await readFile(join(p.dir, 'active'), 'utf8')).trim() === 'blue');
  assert.equal(await (await fetch(p.origin + '/')).text(), 'blue-user-data');
});

function compose(env = {}) {
  const result = spawnSync('docker', ['compose', '-p', 'synthetic-formula', '--env-file', '/dev/null', '-f', join(root, 'docker-compose.formula.yml'), 'config', '--format', 'json'], { cwd: tmpdir(), env: { PATH: process.env.PATH, FORMULA_PREFIX: 'synthetic-formula', FORMULA_STATE_ROOT: '/tmp/synthetic-formula', FORMULA_BLUE_PORT: '18081', FORMULA_GREEN_PORT: '18082', FORMULA_EDGE_PORT: '18080', SB_ORIGIN: 'http://synthetic-postgrest:3000', SB_REST_BASE: '/', SB_UPSTREAM_AUTH: 'none', SB_SERVICE_KEY: 'synthetic-local-key', ...env }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).services;
}
test('compose defaults preserve both local upstreams; Blue overrides never change Green or shared authentication', () => {
  const normal = compose();
  const configured = compose({ FORMULA_BLUE_BACKEND: 'supabase', FORMULA_BLUE_TRAFFIC_MODE: 'standby', FORMULA_BLUE_SB_ORIGIN: 'https://synthetic.supabase.co', FORMULA_BLUE_SB_REST_BASE: '/rest/v1', FORMULA_BLUE_SB_UPSTREAM_AUTH: 'bearer', FORMULA_BLUE_SB_SERVICE_KEY: 'synthetic-cloud-key' });
  assert.deepEqual(normal['runtime-green'].environment, configured['runtime-green'].environment);
  for (const color of ['blue', 'green']) {
    assert.equal(normal[`runtime-${color}`].environment.FORMULA_BACKEND, 'local');
    assert.equal(normal[`runtime-${color}`].environment.SB_ORIGIN, 'http://synthetic-postgrest:3000');
  }
  assert.equal(configured['runtime-blue'].environment.SB_ORIGIN, 'https://synthetic.supabase.co');
  assert.equal(configured['runtime-blue'].environment.SB_SERVICE_KEY, 'synthetic-cloud-key');
  assert.equal(configured['runtime-blue'].environment.FORMULA_TRAFFIC_MODE, 'standby');
  assert.equal(configured.edge.environment.FORMULA_BLUE_TRAFFIC_MODE, 'standby');
  const anonOnly = compose({ FORMULA_BLUE_SB_ANON_KEY: 'synthetic-cloud-anon', FORMULA_BLUE_SB_SERVICE_KEY: '' });
  assert.equal(anonOnly['runtime-blue'].environment.SB_ANON_KEY, 'synthetic-cloud-anon');
  assert.equal(anonOnly['runtime-blue'].environment.SB_SERVICE_KEY, '', 'explicit empty must clear inherited local service key');
  assert.equal(anonOnly['runtime-green'].environment.SB_SERVICE_KEY, 'synthetic-local-key');
});

for (const command of ['switch', 'rollback']) {
  test(`manual ${command} cannot promote a standby color even if page status is 200`, async t => {
    const dir = await scratch(t), scripts = join(dir, 'scripts'), bin = join(dir, 'bin'), state = join(dir, 'state/runtime-state/synthetic');
    await mkdir(scripts, { recursive: true }); await mkdir(bin); await mkdir(state, { recursive: true });
    for (const name of ['blue-green-formula.sh', 'provisioning-secret.sh']) await copyFile(join(root, 'scripts', name), join(scripts, name));
    await writeFile(join(state, 'active'), 'green\n');
    await writeFile(join(dir, 'stack.env'), `FORMULA_PREFIX=synthetic\nFORMULA_COMPOSE_PROJECT=synthetic\nFORMULA_STATE_ROOT=${dir}/state\nFORMULA_BLUE_PORT=18081\nFORMULA_GREEN_PORT=18082\nFORMULA_EDGE_PORT=18080\n`);
    await writeFile(join(dir, 'secret.env'), 'FORMULA_PROBE_TOKEN=synthetic\n');
    for (const [name, body] of [['security', 'exit 1'], ['docker', 'exit 0'], ['curl', `case "$*" in *'__formula/health'*) printf '{"status":"ok","trafficMode":"standby","servingEligible":false}' ;; *) printf '200' ;; esac`]]) {
      await writeFile(join(bin, name), '#!/bin/sh\n' + body + '\n'); await chmod(join(bin, name), 0o755);
    }
    const result = spawnSync('sh', [join(scripts, 'blue-green-formula.sh'), command, 'blue'], { env: { PATH: `${bin}:/usr/bin:/bin`, FORMULA_STACK_ENV: join(dir, 'stack.env'), FORMULA_ENV_FILE: join(dir, 'secret.env'), FORMULA_DATA_ENV_FILE: join(dir, 'missing.env') }, encoding: 'utf8', timeout: 10000 });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.equal(await readFile(join(state, 'active'), 'utf8'), 'green\n');
    assert.match(result.stdout + result.stderr, /standby|รับผู้ใช้|รับคน/);
  });
}

test('readiness rejects an explicit standby gate even when status alone says ok', async t => {
  const dir = await scratch(t), bin = join(dir, 'bin'); await mkdir(bin);
  await writeFile(join(bin, 'curl'), '#!/bin/sh\nprintf \'{"status":"ok","servingEligible":false,"trafficMode":"standby"}\'\n'); await chmod(join(bin, 'curl'), 0o755);
  const result = spawnSync('sh', [join(root, 'scripts/wait-formula-proxy-ready.sh'), 'blue', '18081'], { env: { PATH: `${bin}:/usr/bin:/bin`, FORMULA_PROXY_READY_ATTEMPTS: '1', FORMULA_PROXY_READY_INTERVAL_SECONDS: '0' }, encoding: 'utf8' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
});

async function parity(t, standby = false, differentRest = false) {
  const dir = await scratch(t), bin = join(dir, 'bin'), calls = join(dir, 'calls'); await mkdir(bin); await writeFile(calls, '');
  const release = (await readFile(join(root, 'releases/CURRENT'), 'utf8')).trim();
  const docker = `#!/usr/bin/env node
const args=process.argv.slice(2), text=args.join(' ');
if(args[0]==='info')process.exit(0);
if(args[0]==='exec') {
  if(text.includes('sha256sum'))process.stdout.write('synthetic-nonempty-hash');
  else process.stdout.write('same-synthetic-mounts');
} else if(text.includes('.Image'))process.stdout.write('synthetic-image');
else if(text.includes('.Config.Env'))process.stdout.write('SB_ORIGIN=http://synthetic-local:3000\\nFORMULA_RELEASE_DIR=/release\\nOPC_LOGIN_ORIGIN=http://synthetic-identity\\nFORMULA_BACKEND=local\\nFORMULA_TRAFFIC_MODE=serving\\nSB_UPSTREAM_AUTH=none\\nSB_REST_BASE='+ (process.env.SYNTHETIC_DIFFERENT_REST==='true' && text.includes('green')?'/rest/v1':'/') +'\\n');
else if(text.includes('.NetworkSettings.Ports'))process.stdout.write(text.includes('green')?'18082':'18081');
`;
  const curl = `#!/usr/bin/env node
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const url=new URL(process.argv.at(-1)), root=process.env.SYNTHETIC_ROOT;
fs.appendFileSync(process.env.SYNTHETIC_CALLS,url.pathname+'\\n');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if(url.pathname==='/__formula/health') {
  const standby=process.env.SYNTHETIC_STANDBY==='true' && url.port==='18081';
  process.stdout.write(JSON.stringify({status:standby?'standby':'ok',gateway:'rewritten',release:process.env.SYNTHETIC_RELEASE,proxySourceSha:hash(path.join(root,'runtime/formula-proxy.mjs')),jobIntakeSourceSha:hash(path.join(root,'runtime/job-intake.mjs')),jobIntake:standby?'standby':'ready',authMode:'opc-session',iamSessionMode:false,provisioningGateway:false,configuredBackend:standby?'supabase':'local',backendConfiguration:'valid',trafficMode:standby?'standby':'serving',servingEligible:!standby}));
} else if(url.pathname==='/')process.stdout.write('<html><head></head><body>synthetic parity page</body></html>');
else if(url.pathname.startsWith('/fs-'))process.stdout.write(fs.readFileSync(path.join(root,'runtime/assets',url.pathname.slice(1))));
else process.exit(1);
`;
  for (const [name, body] of [['docker', docker], ['curl', curl]]) { await writeFile(join(bin, name), body); await chmod(join(bin, name), 0o755); }
  const result = spawnSync('sh', [join(root, 'scripts/verify-formula-parity.sh'), 'synthetic'], { env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, SYNTHETIC_ROOT: root, SYNTHETIC_CALLS: calls, SYNTHETIC_RELEASE: release, SYNTHETIC_STANDBY: String(standby), SYNTHETIC_DIFFERENT_REST: String(differentRest) }, encoding: 'utf8', timeout: 15000 });
  return { ...result, calls: await readFile(calls, 'utf8') };
}

test('default parity gates still pass with two identical serving local colors', async t => {
  const result = await parity(t);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /parity status=ok/);
});

test('parity identifies configured standby as ineligible before attempting any served page checks', async t => {
  const result = await parity(t, true);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /standby/);
  assert.deepEqual(result.calls.trim().split('\n'), ['/__formula/health', '/__formula/health']);
});

test('container liveness accepts valid standby without making readiness pass', async t => {
  const services = compose(), dir = await scratch(t), bin = join(dir, 'bin'); await mkdir(bin);
  await writeFile(join(bin, 'wget'), '#!/bin/sh\nprintf \'%s\' "$SYNTHETIC_HEALTH"\n'); await chmod(join(bin, 'wget'), 0o755);
  for (const color of ['blue', 'green']) {
    const command = services[`runtime-${color}`].healthcheck.test[1];
    for (const [status, want] of [['ok', 0], ['standby', 0], ['degraded', 1]]) {
      const result = spawnSync('sh', ['-c', command], { env: { PATH: `${bin}:/usr/bin:/bin`, SYNTHETIC_HEALTH: JSON.stringify({ status }) } });
      assert.equal(result.status, want, `${color} liveness status=${status}`);
    }
  }
});

for (const backend of ['local', 'supabase']) {
  test(`serving ${backend} preserves authenticated durable save and automatic replay after an outage`, async t => {
    const dir = await scratch(t), intakeDir = join(dir, 'intake'), records = new Map(), writes = [];
    let available = false;
    const upstream = await listen(t, async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
      const path = new URL(req.url, 'http://synthetic').pathname;
      const send = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
      if (path === '/consumer/v1/permission-check') return send(200, { allowed: true, reason_code: 'SYNTHETIC_ALLOWED' });
      if (!available) return send(503, {});
      const prefix = backend === 'supabase' ? '/rest/v1' : '';
      if (path === prefix + '/fs_users') return send(200, [{ name: 'Synthetic', data: { name: 'Synthetic', role: 'sales' } }]);
      if (path === prefix + '/fs_records') return send(200, [...records].map(([id, data]) => ({ id, data })));
      if (path === prefix + '/rpc/fs_job_integrity_snapshot') return send(200, { version: 1, complete: true, total: 0, items: [] });
      if (path === prefix + '/rpc/fs_save_record') {
        writes.push({ body, authorization: req.headers.authorization, apikey: req.headers.apikey });
        records.set(body.p_id, body.p_data);
        return send(200, { status: 'saved', id: body.p_id, data: body.p_data });
      }
      return send(404, {});
    });
    const p = await proxy(t, { FORMULA_BACKEND: backend, FORMULA_TRAFFIC_MODE: 'serving', SB_ORIGIN: upstream.origin, SB_REST_BASE: backend === 'supabase' ? '/rest/v1' : '/', SB_UPSTREAM_AUTH: backend === 'supabase' ? 'bearer' : 'none', FORMULA_JOB_INTAKE_DIR: intakeDir, IAM_CONSUMER_ORIGIN: upstream.origin, IAM_CONSUMER_SHARED_SECRET: 'synthetic-iam-secret-01234567890123456789' }, dir);
    const actor = { name: 'Synthetic', role: 'sales', centralUserId: 'synthetic-user', exp: Date.now() + 60_000 };
    const encoded = Buffer.from(JSON.stringify(actor)).toString('base64url');
    const cookie = `fs_session=${encoded}.${createHmac('sha256', 'synthetic-session-secret').update(encoded).digest('base64url')}`;
    const data = { id: 'A07002', customer: 'Synthetic', createdBy: 'Synthetic', rows: [] };
    const response = await fetch(p.origin + '/sb/rest/v1/rpc/fs_save_record', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ p_id: data.id, p_data: data, p_expected: null }) });
    assert.deepEqual(await response.json(), { status: 'queued', id: data.id });
    available = true;
    const journal = await new JobIntake({ dir: intakeDir }).init({ readOnly: true });
    await waitFor(async () => (await journal.list())[0]?.state === 'saved');
    assert.deepEqual(records.get(data.id), data);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].authorization, backend === 'supabase' ? 'Bearer synthetic-server-secret' : undefined);
    assert.equal(writes[0].apikey, backend === 'supabase' ? 'synthetic-server-secret' : undefined);
    assert.equal((await (await fetch(p.origin + '/__formula/health')).json()).jobIntake, 'ready');
  });
}


test('parity refuses different REST routing even when origin and code are identical', async t => {
  const result = await parity(t, false, true);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /ค่า env ต่างกัน/);
  assert.ok(!result.stdout.includes('SB_REST_BASE=/rest/v1'));
});
