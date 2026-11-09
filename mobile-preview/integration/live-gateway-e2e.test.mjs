// ไคลเอนต์โหมดระบบจริงของมือถือ (FormulaLive ใน index.html) เทียบกับ proxy ตัวจริง + PostgREST + PostgreSQL บนทรัพยากรสังเคราะห์
// Real HTTP -> real PostgREST -> real PostgreSQL on synthetic isolated resources.
// The cached images are required. Never pull, mount production files, use existing
// volumes/networks, inherit production env, or call a production endpoint.
import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ไฟล์ runtime จริงของ Formula (อ่านอย่างเดียว) — ตั้ง FORMULA_RUNTIME_ROOT เพื่อชี้ไปยัง checkout ที่ต้องการ
const root = new URL('file://' + (process.env.FORMULA_RUNTIME_ROOT || '/Users/user/formula-runtime-worktrees/mkt-oversea-20261028') + '/');
const docker = '/usr/local/bin/docker';
const suffix = randomBytes(6).toString('hex');
const network = `formula-job-sync-test-${suffix}`;
const pg = `${network}-pg`, rest = `${network}-rest`;
const syntheticPassword = `synthetic-${suffix}`;
const sessionSecret = `synthetic-session-${suffix}-only-not-production`;
const created = [];
let networkCreated = false, scratch, restOrigin, gatewayOrigin, gatewayProcess, fakeIam, restRelay;
let proxyBootstrap, gatewayConfig;
let denyIngredientEdit = false;
let databaseUnavailable = false;
const gatewayOutput = [];
function command(args, input) {
  const result = spawnSync(docker, args, { input, encoding: 'utf8', maxBuffer: 4e6 });
  assert.equal(result.error, undefined, `docker executable: ${result.error?.message}`);
  assert.equal(result.status, 0, `synthetic docker command failed: ${result.stderr}`);
  return result.stdout.trim();
}
const sql = input => command(['exec', '-i', pg, 'psql', '-X', '-U', 'synthetic_owner', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], input);
const sqlAsync = input => new Promise((resolve, reject) => {
  const child = spawn(docker, ['exec', '-i', pg, 'psql', '-X', '-U', 'synthetic_owner', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', chunk => out += chunk);
  child.stderr.on('data', chunk => err += chunk);
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err)));
  child.stdin.end(input);
});
const literal = data => `'${JSON.stringify(data).replaceAll("'", "''")}'::jsonb`;
const job = (id = 'A08001', extras = {}) => ({ id, customer: 'Synthetic customer', brand: '', rows: [], ...extras });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label) {
  let last;
  for (let attempt = 0; attempt < 150; attempt++) {
    try { if (await check()) return; } catch (error) { last = error; }
    await delay(100);
  }
  throw new Error(`${label} did not become ready: ${last?.message || gatewayOutput.join('').slice(-1000)}`);
}
async function startLocalServer(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
function decodeChunked(buffer) {
  const chunks = [];
  let offset = 0;
  while (offset < buffer.length) {
    const end = buffer.indexOf('\r\n', offset);
    assert.ok(end >= offset, 'HTTP chunk size line must be complete');
    const size = Number.parseInt(buffer.subarray(offset, end).toString('ascii').split(';')[0], 16);
    assert.ok(Number.isFinite(size), 'HTTP chunk size must be valid');
    if (!size) break;
    chunks.push(buffer.subarray(end + 2, end + 2 + size));
    offset = end + 2 + size + 2;
  }
  return Buffer.concat(chunks);
}
async function relayToInternalRest(request, response) {
  if (databaseUnavailable) { request.resume(); response.writeHead(503); response.end('{}'); return; }
  // Docker Desktop suppresses published ports on --internal networks. This
  // localhost-only transport sends actual HTTP through a synthetic container's
  // network namespace; PostgreSQL/PostgREST still have no external network.
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const headers = [`${request.method} ${request.url} HTTP/1.1`, 'Host: synthetic-rest:3000', 'Connection: close', `Content-Length: ${body.length}`];
  for (const name of ['content-type', 'prefer', 'range', 'range-unit', 'accept']) {
    if (request.headers[name]) headers.push(`${name}: ${request.headers[name]}`);
  }
  const raw = await new Promise((resolve, reject) => {
    const child = spawn(docker, ['exec', '-i', pg, 'busybox', 'nc', '-w', '10', 'synthetic-rest', '3000'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const output = []; let errors = '';
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => errors += chunk);
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(Buffer.concat(output)) : reject(new Error(`Synthetic HTTP transport: ${errors}`)));
    child.stdin.end(Buffer.concat([Buffer.from(`${headers.join('\r\n')}\r\n\r\n`), body]));
  });
  const boundary = raw.indexOf('\r\n\r\n');
  assert.ok(boundary > 0, 'PostgREST must return HTTP headers');
  const lines = raw.subarray(0, boundary).toString('ascii').split('\r\n');
  const status = Number(lines.shift().split(' ')[1]);
  const upstreamHeaders = Object.fromEntries(lines.map(line => { const index = line.indexOf(':'); return [line.slice(0, index).toLowerCase(), line.slice(index + 1).trim()]; }));
  let payload = raw.subarray(boundary + 4);
  if (upstreamHeaders['transfer-encoding'] === 'chunked') payload = decodeChunked(payload);
  delete upstreamHeaders['transfer-encoding']; delete upstreamHeaders.connection;
  upstreamHeaders['content-length'] = String(payload.length);
  response.writeHead(status, upstreamHeaders);
  response.end(payload);
}
function cookie(role = 'sales', name = 'Synthetic actor') {
  const body = Buffer.from(JSON.stringify({ name, role, centralUserId: 'synthetic-actor', exp: Date.now() + 60_000 })).toString('base64url');
  return `fs_session=${body}.${createHmac('sha256', sessionSecret).update(body).digest('base64url')}`;
}
async function rpc(origin, data, expected = null, role = 'sales') {
  const response = await fetch(`${origin}/rpc/fs_save_record`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(role) },
    body: JSON.stringify({ p_id: data.id, p_data: data, p_expected: expected }),
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}
const gatewayRest = () => `${gatewayOrigin}/sb/rest/v1`;

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'formula-job-sync-e2e-'));
  for (const image of ['postgres:16-alpine', 'postgrest/postgrest:v12.2.3']) command(['image', 'inspect', image, '--format', '{{.Id}}']);
  // A dedicated test-only subnet avoids exhausted default Docker pools without
  // reusing any existing network or weakening the synthetic stack's isolation.
  const subnet = process.env.FORMULA_TEST_NETWORK_SUBNET;
  command(['network', 'create', '--internal', '--label', 'com.beyond.synthetic-job-sync=true', ...(subnet ? ['--subnet', subnet] : []), network]);
  networkCreated = true;
  command(['run', '--pull=never', '-d', '--name', pg, '--network', network, '--network-alias', 'synthetic-db',
    '--label', 'com.beyond.synthetic-job-sync=true', '--tmpfs', '/var/lib/postgresql/data:rw',
    '-e', 'POSTGRES_USER=synthetic_owner', '-e', `POSTGRES_PASSWORD=${syntheticPassword}`, 'postgres:16-alpine']);
  created.push(pg);
  await waitFor(() => {
    // The image's temporary initialization server has no TCP listener; waiting
    // on TCP avoids mistaking it for the final database process.
    const result = spawnSync(docker, ['exec', pg, 'pg_isready', '-h', '127.0.0.1', '-U', 'synthetic_owner', '-d', 'postgres'], { encoding: 'utf8' });
    return result.status === 0;
  }, 'synthetic PostgreSQL');
  sql(`create role anon; create role authenticated;
    create role synthetic_authenticator login noinherit password '${syntheticPassword}';
    grant anon to synthetic_authenticator;`);
  for (const file of ['docs/upstream-schema.sql', 'runtime/data-grants.sql', 'runtime/data-policy.sql']) {
    sql(await readFile(new URL(file, root), 'utf8'));
  }
  command(['run', '--pull=never', '-d', '--name', rest, '--network', network, '--network-alias', 'synthetic-rest',
    '--label', 'com.beyond.synthetic-job-sync=true',
    '-e', `PGRST_DB_URI=postgres://synthetic_authenticator:${syntheticPassword}@synthetic-db:5432/postgres`,
    '-e', 'PGRST_DB_ANON_ROLE=anon', '-e', 'PGRST_DB_SCHEMAS=public', 'postgrest/postgrest:v12.2.3']);
  created.push(rest);
  await waitFor(() => command(['inspect', rest, '--format', '{{.State.Running}}']) === 'true', 'synthetic PostgREST process');
  assert.equal(command(['network', 'inspect', network, '--format', '{{.Internal}}']), 'true');
  restRelay = createServer((request, response) => relayToInternalRest(request, response).catch(error => { response.writeHead(502); response.end(error.message); }));
  restOrigin = await startLocalServer(restRelay);
  await waitFor(async () => (await fetch(`${restOrigin}/fs_records?select=id`)).ok, 'synthetic PostgREST');
  const absent = await fetch(`${restOrigin}/rpc/fs_save_record`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ p_id: 'A08001', p_data: job(), p_expected: null }) });
  assert.equal(absent.status, 404, 'new RPC must not exist before approved migration');
  sql(await readFile(new URL('runtime/job-sync.sql', root), 'utf8'));
  await waitFor(async () => {
    const response = await fetch(`${restOrigin}/rpc/fs_save_record`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ p_id: 'invalid', p_data: {}, p_expected: null }) });
    return response.ok && (await response.json()).status === 'invalid';
  }, 'NOTIFY pgrst schema reload');

  fakeIam = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    const payload = JSON.parse(text || '{}');
    assert.equal(payload.central_user_id, 'synthetic-actor');
    assert.equal(payload.system_code, 'FORMULA');
    const allowed = !(denyIngredientEdit && payload.required_permission === 'FORMULA_EDIT');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ allowed, reason_code: allowed ? 'SYNTHETIC_ALLOWED' : 'SYNTHETIC_DENIED' }));
  });
  const iamOrigin = await startLocalServer(fakeIam);
  // Reserve an ephemeral localhost port, then start the actual gateway source.
  const reservation = createServer();
  const reservedOrigin = await startLocalServer(reservation);
  const gatewayPort = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  gatewayOrigin = reservedOrigin;
  // Test bootstrap limits host binding; gateway application source is unchanged.
  const bootstrap = `import http from 'node:http'; const original=http.Server.prototype.listen;
    http.Server.prototype.listen=function(port,host,...args){return original.call(this,port,'127.0.0.1',...args)};
    await import(${JSON.stringify(new URL('runtime/formula-proxy.mjs', root).href)});`;
  proxyBootstrap = bootstrap;
  // The browser harness and actual served gateway must use the same approved
  // application artifact. This temporary sealed fixture is never a release.
  let releaseDir=fileURLToPath(new URL('releases',root));
  if(process.env.FORMULA_JOB_SYNC_TEST_HTML){
    const html=await readFile(process.env.FORMULA_JOB_SYNC_TEST_HTML,'utf8');
    const id=createHash('sha256').update(html).digest('hex').slice(0,12);
    releaseDir=join(scratch,'sealed');
    await mkdir(join(releaseDir,id),{recursive:true});
    await writeFile(join(releaseDir,'CURRENT'),id);
    await writeFile(join(releaseDir,id,'index.html'),html);
    await writeFile(join(releaseDir,id,'meta.json'),JSON.stringify({id}));
  }
  const env = {
    PATH: process.env.PATH, TMPDIR: tmpdir(), PORT: String(gatewayPort), FORMULA_COLOR: 'synthetic', FORMULA_STACK: network,
    FORMULA_RELEASE_DIR: releaseDir, FORMULA_ASSET_DIR: fileURLToPath(new URL('runtime/assets', root)),
    FORMULA_LOG_DIR: join(scratch, 'logs'), FORMULA_PUBLIC_ORIGIN: gatewayOrigin,
    SB_ORIGIN: restOrigin, SB_ANON_KEY: 'synthetic-noncredential', SB_REST_BASE: '/', SB_UPSTREAM_AUTH: 'none',
    IAM_CONSUMER_ORIGIN: iamOrigin, IAM_CONSUMER_SHARED_SECRET: 'synthetic-iam-shared-secret-not-production', FORMULA_IAM_CACHE_MS: '0',
    FORMULA_SESSION_SECRET: sessionSecret, FORMULA_COOKIE_SECURE: 'false', FORMULA_IAM_ENFORCE: 'true',
    FORMULA_PUSH_DIR: join(scratch, 'push'),
  };
  gatewayConfig = env;
  gatewayProcess = spawn(process.execPath, ['--input-type=module', '--eval', bootstrap], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  gatewayProcess.stdout.on('data', chunk => gatewayOutput.push(String(chunk)));
  gatewayProcess.stderr.on('data', chunk => gatewayOutput.push(String(chunk)));
  await waitFor(async () => (await fetch(`${gatewayOrigin}/__formula/health`)).ok, 'synthetic gateway');
  const health=await (await fetch(`${gatewayOrigin}/__formula/health`)).json();
  assert.equal(health.jobSyncCompatible,true,'do not exercise writes against a degraded incompatible app artifact');
});

after(async () => {
  if (gatewayProcess && gatewayProcess.exitCode === null) {
    const closed = new Promise(resolve => gatewayProcess.once('close', resolve));
    gatewayProcess.kill('SIGTERM');
    await closed;
  }
  if (fakeIam) { fakeIam.closeAllConnections(); await new Promise(resolve => fakeIam.close(resolve)); }
  if (restRelay) { restRelay.closeAllConnections(); await new Promise(resolve => restRelay.close(resolve)); }
  // Remove exactly the containers/network created above; never prune.
  for (const name of created.reverse()) command(['rm', '-f', name]);
  if (networkCreated) command(['network', 'rm', network]);
  if (scratch) await rm(scratch, { recursive: true, force: true });
});
beforeEach(() => {
  denyIngredientEdit = false;
  databaseUnavailable = false;
  sql('truncate public.fs_records, public.fs_chats, public.fs_messages, public.fs_approvals, public.fs_archive;');
  sql(`insert into public.fs_users(name,data) values ('Synthetic actor', '{"name":"Synthetic actor","role":"sales"}') on conflict (name) do nothing;`);
  sql(`insert into public.fs_users(name,data) values ('sales', '{"name":"sales","role":"sales"}') on conflict (name) do nothing;`);
});

// ---------- ไคลเอนต์มือถือ ----------
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const liveSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8').match(/<script id="live-client">([\s\S]*?)<\/script>/)[1];
const liveCtx = { module: { exports: {} }, Date, Promise, Map, JSON, encodeURIComponent, Number, String, Array, Object, Error, TypeError, Math, Set };
vm.runInNewContext(liveSource, liveCtx);
const FormulaLive = liveCtx.module.exports;
const transportFor = sessionCookie => async (method, path, { headers = {}, body } = {}) => {
  const res = await fetch(gatewayOrigin + path, { method, headers: { ...headers, ...(sessionCookie ? { cookie: sessionCookie } : {}) }, body, redirect: 'manual' });
  return { status: res.status, headers: {}, body: await res.text() };
};
const seed = () => {
  const rec = (id, by, extra = {}) => sql(`insert into public.fs_records(id,data) values ('${id}', ${literal({ id, customer: 'Synthetic ' + id, brand: 'B', createdBy: by, salesOwner: by, rows: [], date: '29/10/2569', ...extra })});`);
  rec('A08001', 'sales'); rec('A08002', 'someone else'); rec('A08003', 'sales', { closed: { by: 'sales', at: 'x', ts: 1 } });
  for (const id of ['A08001', 'A08002', 'A08003']) sql(`insert into public.fs_chats(job_id,data) values ('${id}', ${literal({ jobId: id, createdAt: 1, createdBy: 'sales', parts: [] })});`);
  sql(`insert into public.fs_approvals(job_id,part,data) values ('A08001','pd', ${literal({ by: 'pd user', at: 't', ts: 5 })});`);
  sql(`insert into public.fs_approvals(job_id,part,data) values ('A08001','sales', ${literal({ by: 'sales', at: 't2', ts: 6 })});`);
  sql(`insert into public.fs_messages(uid,job_id,ts,data) values ('MSECRET','A08002',2000, ${literal({ type: 'msg', user: 'someone else', text: 'ข้อความลับของงานคนอื่น', ts: 2000 })});`);
  for (let i = 0; i < 3; i++) sql(`insert into public.fs_messages(uid,job_id,ts,data) values ('M0000${i}','A08001',${1000 + i}, ${literal({ type: 'msg', user: 'sales', text: 'ข้อความ ' + i, ts: 1000 + i })});`);
};

test('mobile live client: unauthenticated reads are refused by the actual gateway', async () => {
  seed();
  const live = FormulaLive.create({ transport: transportFor(null) });
  assert.equal(await live.session(), null);
  await assert.rejects(() => live.loadJobs(), error => error.code === 'UNAUTHENTICATED' && error.status === 401);
});

test('mobile live client: sales session reads only its own jobs with approvals and messages from the actual gateway', async () => {
  seed();
  const live = FormulaLive.create({ transport: transportFor(cookie('sales', 'sales')) });
  const session = await live.session();
  assert.deepEqual({ name: session.name, role: session.role }, { name: 'sales', role: 'sales' });
  const jobs = await live.loadJobs(100);
  assert.deepEqual(Array.from(jobs.map(job => job.id)), ['A08003', 'A08001'], 'server scope hides jobs created by someone else');
  const a1 = jobs.find(job => job.id === 'A08001');
  assert.deepEqual([a1.approvals.pd, a1.approvals.ra, a1.approvals.rd, a1.approvals.sales], [true, false, false, true]);
  assert.equal(a1.approvalInfo.pd.by, 'pd user');
  assert.equal(jobs.find(job => job.id === 'A08003').closed, true);
  const messages = await live.loadMessages('A08001');
  assert.deepEqual(Array.from(messages.map(message => message.uid)), ['M00000', 'M00001', 'M00002']);
  assert.equal(messages[0].author, 'sales');
  const other = await live.loadMessages('A08002').then(rows => rows, error => error);
  assert.ok(other instanceof Error || (other.length === 0), 'another user\'s chat is refused or empty');
  assert.ok(!JSON.stringify(other instanceof Error ? other.message : other).includes('ข้อความลับ'), 'no content from another user\'s job leaks');
});

test('mobile live client: admin session sees every job; changesSince uses the supported updated_at filter', async () => {
  seed();
  sql(`insert into public.fs_users(name,data) values ('admin', '{"name":"admin","role":"admin"}') on conflict (name) do nothing;`);
  const live = FormulaLive.create({ transport: transportFor(cookie('admin', 'admin')) });
  const jobs = await live.loadJobs(100);
  assert.deepEqual(Array.from(jobs.map(job => job.id)), ['A08003', 'A08002', 'A08001']);
  const changes = await live.changesSince(new Date(Date.now() - 3_600_000).toISOString());
  assert.ok(changes.jobs.length >= 3 && changes.messages.length >= 3);
  const none = await live.changesSince(new Date(Date.now() + 3_600_000).toISOString());
  assert.equal(none.jobs.length + none.messages.length, 0);
});

test('mobile live client never writes: only GET reads plus /sb/session are used', async () => {
  seed();
  const seen = [];
  const base = transportFor(cookie('admin', 'admin'));
  const live = FormulaLive.create({ transport: async (method, path, extra) => { seen.push(method + ' ' + path.split('?')[0]); return base(method, path, extra); } });
  await live.loadJobs(10); await live.loadMessages('A08001'); await live.changesSince(new Date().toISOString());
  assert.ok(seen.every(entry => entry.startsWith('GET /sb/rest/v1/fs_')), seen.join(', '));
});

// ---------- เขียนกลับ (ผ่านเส้นทางเดียวกับเว็บ; เซิร์ฟเวอร์เป็นผู้ตัดสินสิทธิ์) ----------
test('mobile live client: approve then withdraw clears every Pass through the server approval command', async () => {
  seed();
  sql(`insert into public.fs_users(name,data) values ('admin', '{"name":"admin","role":"admin"}') on conflict (name) do nothing;`);
  const live = FormulaLive.create({ transport: transportFor(cookie('admin', 'admin')) });
  let job = await live.loadJob('A08001');
  assert.deepEqual([job.approvals.pd, job.approvals.ra, job.approvals.sales], [true, false, true]);
  await live.approve(job, 'ra', 'approve');
  job = await live.loadJob('A08001');
  assert.equal(job.approvals.ra, true, 'RA Pass saved by the actual server command');
  await live.approve(job, 'ra', 'withdraw');
  job = await live.loadJob('A08001');
  assert.deepEqual([job.approvals.pd, job.approvals.ra, job.approvals.rd, job.approvals.sales], [false, false, false, false], 'withdraw clears every Pass like the web');
});

test('mobile live client: stale approval is refused as a conflict, not overwritten', async () => {
  seed();
  sql(`insert into public.fs_users(name,data) values ('admin', '{"name":"admin","role":"admin"}') on conflict (name) do nothing;`);
  const live = FormulaLive.create({ transport: transportFor(cookie('admin', 'admin')) });
  const stale = await live.loadJob('A08001');
  const fresh = await live.loadJob('A08001');
  sql(`update public.fs_records set data = jsonb_set(data,'{notes}','"แก้โดยอีกเครื่อง"'::jsonb), updated_at = now() where id='A08001';`);
  await assert.rejects(() => live.approve(stale, 'ra', 'approve'), error => error.code === 'CONFLICT' || error.status === 409 || error.code === 'REJECTED');
  assert.equal((await live.loadJob('A08001')).approvals.ra, false, 'stale write did not land');
  void fresh;
});

test('mobile live client: owner closes, reopens and rejects through the CAS save; another user cannot', async () => {
  seed();
  const live = FormulaLive.create({ transport: transportFor(cookie('sales', 'sales')) });
  let job = await live.loadJob('A08001');
  await live.setStatus(job, 'close', 'sales');
  job = await live.loadJob('A08001');
  assert.equal(job.closed, true);
  await live.setStatus(job, 'reopen', 'sales');
  job = await live.loadJob('A08001');
  assert.equal(job.closed, false);
  await live.setStatus(job, 'reject', 'sales');
  job = await live.loadJob('A08001');
  assert.ok(job.rejected && job.rejected.by === 'sales');
  const messages = await live.loadMessages('A08001');
  assert.ok(messages.some(message => message.from === 'system' && /Reject/.test(message.text)), 'system message recorded like the web');
  await assert.rejects(() => live.loadJob('A08002'), error => error.code === 'NOT_FOUND', 'Sales cannot see or change another user\'s job');
});

test('mobile live client: chat message is stored for the owner and refused for another user\'s job', async () => {
  seed();
  const live = FormulaLive.create({ transport: transportFor(cookie('sales', 'sales')) });
  const sent = await live.sendMessage('A08001', 'สวัสดีจากมือถือ', 'msg', 'sales');
  const messages = await live.loadMessages('A08001');
  assert.ok(messages.some(message => message.uid === sent.uid && message.text === 'สวัสดีจากมือถือ' && message.author === 'sales'));
  await assert.rejects(() => live.sendMessage('A08002', 'แอบส่ง', 'msg', 'sales'), error => error.code === 'REJECTED' || error.status === 403, 'another user\'s job refuses the message at the gateway');
  assert.equal(sql(`select count(*) from public.fs_messages where job_id='A08002' and data->>'text'='แอบส่ง'`), '0', 'nothing was stored');
});

// ---------- สร้าง / แก้ไขงาน ----------
test('mobile live client: create job uses the server sequence, saves with no prior version and opens the chat room', async () => {
  seed();
  const live = FormulaLive.create({ transport: transportFor(cookie('sales', 'sales')) });
  const first = await live.createJob({ customer: 'ลูกค้าจากมือถือ', brand: 'แบรนด์มือถือ', form: 'แคปซูล', rows: [{ name: 'สารทดสอบ', w: 100, o: 'x', p: 50 }] }, 'sales', true);
  assert.match(first.id, /^A\d{5}$/);
  assert.equal(first.chatRoom, true, 'chat room created');
  const job = await live.loadJob(first.id);
  assert.equal(job.createdBy, 'sales');
  assert.equal(job.salesOwner, 'sales', 'sales-role owner locked to the creator like the web');
  assert.equal(job.customer, 'ลูกค้าจากมือถือ');
  assert.equal(sql(`select count(*) from public.fs_chats where job_id='${first.id}'`), '1');
  const second = await live.createJob({ customer: 'งานที่สอง' }, 'sales', true);
  assert.notEqual(second.id, first.id);
  assert.ok(Number(second.id.slice(1)) > Number(first.id.slice(1)), 'sequence only moves forward');
  const ids = Array.from((await live.loadJobs(100)).map(item => item.id));
  assert.ok(ids.includes(first.id) && ids.includes(second.id));
});

test('mobile live client: a role that cannot create jobs is refused by the server sequence', async () => {
  seed();
  sql(`insert into public.fs_users(name,data) values ('pd', '{"name":"pd","role":"pd"}') on conflict (name) do nothing;`);
  const live = FormulaLive.create({ transport: transportFor(cookie('pd', 'pd')) });
  await assert.rejects(() => live.createJob({ customer: 'ไม่ควรสร้างได้' }, 'pd', false), error => error.status === 403 || error.code === 'FORBIDDEN');
  assert.equal(sql(`select count(*) from public.fs_records where data->>'customer'='ไม่ควรสร้างได้'`), '0');
});

test('mobile live client: owner edits a job through CAS and a stale edit is refused', async () => {
  seed();
  const live = FormulaLive.create({ transport: transportFor(cookie('sales', 'sales')) });
  const stale = await live.loadJob('A08001');
  const fresh = await live.loadJob('A08001');
  await live.editJob(fresh, { notes: 'แก้จากมือถือ' }, 'sales');
  assert.equal((await live.loadJob('A08001')).raw.notes, 'แก้จากมือถือ');
  await assert.rejects(() => live.editJob(stale, { notes: 'ทับของเก่า' }, 'sales'), error => error.code === 'CONFLICT' || error.status === 409);
  assert.equal((await live.loadJob('A08001')).raw.notes, 'แก้จากมือถือ', 'stale edit did not overwrite');
});

// ---------- ทะเบียนอุปกรณ์แจ้งเตือน (FCM) ----------
const pushToken = n => 'device-token-' + n + ':APA91b' + 'z'.repeat(24);
const pushCall = (method, token, who, extraHeaders = {}, path = '/__formula/push-register') => fetch(gatewayOrigin + path, { method, headers: { 'content-type': 'application/json', ...(who ? { cookie: who } : {}), ...extraHeaders }, body: JSON.stringify({ token }) });
const registry = () => { try { return JSON.parse(readFileSync(join(scratch, 'push', 'devices.json'), 'utf8')); } catch { return {}; } };

test('push register: requires a session, binds the device to that user and refuses other users removing it', async () => {
  assert.equal((await pushCall('POST', pushToken(1), null)).status, 401);
  assert.equal((await pushCall('POST', 'short', cookie('sales', 'sales'))).status, 400);
  assert.equal((await pushCall('POST', pushToken(1), cookie('sales', 'sales'), { 'sec-fetch-site': 'cross-site' })).status, 400);
  const ok = await pushCall('POST', pushToken(1), cookie('sales', 'sales'));
  assert.equal(ok.status, 200);
  assert.deepEqual({ name: registry()[pushToken(1)].name, role: registry()[pushToken(1)].role }, { name: 'sales', role: 'sales' });
  assert.equal((await pushCall('DELETE', pushToken(1), cookie('pd', 'pd'))).status, 403, 'another user cannot unregister');
  assert.ok(registry()[pushToken(1)], 'still registered');
  assert.equal((await pushCall('DELETE', pushToken(1), cookie('sales', 'sales'))).status, 200);
  assert.ok(!registry()[pushToken(1)], 'owner removed it on logout');
  // the Android client unregisters with POST (HttpURLConnection cannot send a DELETE body reliably)
  assert.equal((await pushCall('POST', pushToken(2), cookie('sales', 'sales'))).status, 200);
  assert.equal((await pushCall('POST', pushToken(2), cookie('pd', 'pd'), {}, '/__formula/push-unregister')).status, 403);
  assert.equal((await pushCall('POST', pushToken(2), cookie('sales', 'sales'), {}, '/__formula/push-unregister')).status, 200);
  assert.ok(!registry()[pushToken(2)]);
  await pushCall('POST', pushToken(3), cookie('sales', 'sales'));
  const mode = (await import('node:fs')).statSync(join(scratch, 'push', 'devices.json')).mode & 0o777;
  assert.equal(mode.toString(8), '600');
});

test('mobile live client: MKT approves PD and Sales (web rule) through the server command, but not RA or RD', async () => {
  seed();
  sql(`insert into public.fs_users(name,data) values ('mkt', '{"name":"mkt","role":"mkt"}') on conflict (name) do nothing;`);
  sql(`delete from public.fs_approvals where job_id='A08001';`);
  const live = FormulaLive.create({ transport: transportFor(cookie('mkt', 'mkt')) });
  let job = await live.loadJob('A08001');
  await live.approve(job, 'pd', 'approve');
  job = await live.loadJob('A08001');
  await live.approve(job, 'sales', 'approve');
  job = await live.loadJob('A08001');
  assert.deepEqual([job.approvals.pd, job.approvals.sales, job.approvals.ra, job.approvals.rd], [true, true, false, false]);
  for (const part of ['ra', 'rd']) await assert.rejects(() => live.approve(job, part, 'approve'), error => error.status === 403 || error.code === 'FORBIDDEN', 'MKT cannot approve ' + part);
});
