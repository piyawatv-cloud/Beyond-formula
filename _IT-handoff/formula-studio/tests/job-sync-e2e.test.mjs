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
import { harness, job as clientJob, pull as clientPull, source } from './helpers/job-sync-client.mjs';
import { form } from './helpers/job-submit-form.mjs';

const root = new URL('../', import.meta.url);
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
  command(['network', 'create', '--internal', '--label', 'com.beyond.synthetic-job-sync=true', network]);
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

test('central receipt self-delivers through actual PostgREST/PostgreSQL after outage, without a second browser request', async () => {
  // Separate process for this scenario: subsequent synthetic TRUNCATE resets
  // deliberately have no deletion evidence and must not race an earlier worker.
  const reservation = createServer();
  const origin = await startLocalServer(reservation), port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['--input-type=module', '--eval', proxyBootstrap], {
    env: { ...gatewayConfig, PORT: String(port), FORMULA_JOB_INTAKE_DIR: join(scratch, 'intake'), FORMULA_JOB_INTEGRITY_INTERVAL_MS: '200' }, stdio: 'ignore',
  });
  try {
  await waitFor(async () => (await fetch(`${origin}/__formula/health`)).ok, 'durable delivery proxy');
  const data = job('A08123');
  databaseUnavailable = true;
  assert.deepEqual(await rpc(`${origin}/sb/rest/v1`, data), { status: 'queued', id: data.id });
  assert.equal(sql("select count(*) from fs_records where id='A08123';"), '0');
  databaseUnavailable = false;
  await waitFor(() => sql("select count(*) from fs_records where id='A08123';") === '1', 'server-only replay into actual PostgreSQL');
  assert.deepEqual(JSON.parse(sql("select data from fs_records where id='A08123';")), data);
  const check = await fetch(`${origin}/__formula/job-integrity`, { headers: { cookie: cookie('admin') } });
  assert.equal(check.status, 200);
  await waitFor(async () => {
    const result = await (await fetch(`${origin}/__formula/job-integrity`, { headers: { cookie: cookie('admin') } })).json();
    return result.status === 'ok';
  }, 'authoritative metadata snapshot through actual SQL RPC');
  } finally {
    databaseUnavailable = false;
    if (child.exitCode === null && child.signalCode === null) { const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill(); await stopped; }
  }
});

test('HTTP save endpoint commits actual data, retries idempotently and rejects stale revisions', async () => {
  const original = job();
  assert.deepEqual(await rpc(restOrigin, original), { status: 'saved', id: original.id, data: original });
  assert.deepEqual(await rpc(restOrigin, original), { status: 'saved', id: original.id, data: original });
  const edited = job(undefined, { notes: 'Synthetic edit' });
  assert.equal((await rpc(restOrigin, edited, original)).status, 'saved');
  assert.deepEqual(await rpc(restOrigin, job(undefined, { notes: 'Stale edit' }), original), { status: 'conflict', id: original.id });
  assert.deepEqual(JSON.parse(sql("select data from fs_records where id='A08001';")), edited);
});

test('HTTP CAS respects a prior legacy SQL update and leaves it intact', async () => {
  const original = job();
  await rpc(restOrigin, original);
  const legacy = job(undefined, { notes: 'Legacy write' });
  sql(`update fs_records set data=${literal(legacy)} where id='A08001';`);
  assert.equal((await rpc(restOrigin, job(undefined, { notes: 'Old browser update' }), original)).status, 'conflict');
  assert.deepEqual(JSON.parse(sql("select data from fs_records where id='A08001';")), legacy);
});

test('HTTP CAS waits for an in-flight legacy transaction then rejects stale expected data', async () => {
  const original = job();
  await rpc(restOrigin, original);
  const legacy = job(undefined, { notes: 'Concurrent legacy write' });
  const writer = sqlAsync(`begin; update fs_records set data=${literal(legacy)} where id='A08001'; select pg_sleep(0.8); commit;`);
  await waitFor(() => sql("select count(*) from pg_stat_activity where usename='synthetic_owner' and wait_event='PgSleep';") === '1', 'synthetic transaction row lock');
  const result = await rpc(restOrigin, job(undefined, { notes: 'Stale HTTP update' }), original);
  await writer;
  assert.deepEqual(result, { status: 'conflict', id: original.id });
  assert.deepEqual(JSON.parse(sql("select data from fs_records where id='A08001';")), legacy);
});

test('PostgREST representation proves skipped orphan writes and successful valid-parent writes', async () => {
  const sendChild = () => fetch(`${restOrigin}/fs_chats`, { method: 'POST', headers: { 'content-type': 'application/json', prefer: 'return=representation,resolution=merge-duplicates' }, body: JSON.stringify({ job_id: 'A08001', data: { jobId: 'A08001' } }) });
  let response = await sendChild();
  assert.equal(response.ok, true);
  assert.deepEqual(await response.json(), []);
  assert.equal(sql('select count(*) from fs_chats;'), '0');
  await rpc(restOrigin, job());
  response = await sendChild();
  const rows = await response.json();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].job_id, 'A08001');
});

test('actual gateway and synthetic IAM authorize save, committed ACK, retry and CAS conflict', async () => {
  const original = job('AA00001');
  assert.deepEqual(await rpc(gatewayRest(), original), { status: 'saved', id: original.id, data: original });
  const edited = job('AA00001', { notes: 'Gateway edit' });
  assert.equal((await rpc(gatewayRest(), edited, original)).status, 'saved');
  assert.equal((await rpc(gatewayRest(), edited, original)).status, 'saved');
  assert.equal((await rpc(gatewayRest(), original, original)).status, 'conflict');
  assert.deepEqual(JSON.parse(sql("select data from fs_records where id='AA00001';")), edited);
});

test('actual gateway denies unauthorized save and sensitive ingredient edit without writes', async () => {
  const original = job();
  assert.equal((await rpc(gatewayRest(), original, null, 'ra')).status, 'forbidden');
  assert.equal(sql('select count(*) from fs_records;'), '0');
  await rpc(gatewayRest(), original);
  denyIngredientEdit = true;
  assert.equal((await rpc(gatewayRest(), job(undefined, { rows: [{ name: 'Synthetic ingredient', w: 1 }] }), original)).status, 'forbidden');
  assert.deepEqual(JSON.parse(sql("select data from fs_records where id='A08001';")), original);
});

test('actual gateway cannot create orphan chat or overwrite jobs through legacy POST', async () => {
  const headers = { 'content-type': 'application/json', cookie: cookie() };
  let response = await fetch(`${gatewayRest()}/fs_chats`, { method: 'POST', headers, body: JSON.stringify([{ job_id: 'A08001', data: { jobId: 'A08001' } }]) });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('x-fs-job-write-rejected'), '1');
  assert.equal(sql('select count(*) from fs_chats;'), '0');
  const original = job();
  await rpc(gatewayRest(), original);
  response = await fetch(`${gatewayRest()}/fs_records`, { method: 'POST', headers, body: JSON.stringify([{ id: original.id, data: job(undefined, { notes: 'Legacy overwrite' }) }]) });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('x-fs-client-reload-required'), 'job-sync-v1');
  assert.match((await response.json()).message, /โหลดเว็บรุ่นใหม่/);
  assert.deepEqual(JSON.parse(sql("select data from fs_records where id='A08001';")), original);
});

test('save RPC remains unavailable to unauthenticated and GET requests through actual gateway', async () => {
  let response = await fetch(`${gatewayRest()}/rpc/fs_save_record`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ p_id: 'A08001', p_data: job(), p_expected: null }) });
  assert.equal(response.status, 401);
  response = await fetch(`${gatewayRest()}/rpc/fs_save_record?p_id=A08001`, { headers: { cookie: cookie() } });
  assert.equal(response.status, 405);
  assert.equal(sql('select count(*) from fs_records;'), '0');
});

test('actual visible-chat snapshot feeds the client only the current session room set', async () => {
  const salesJob = job('A08101', {createdBy:'Synthetic actor'}), pdJob = job('A08102', {createdBy:'Other actor'});
  sql(`insert into fs_records(id,data) values
    ('A08101', ${literal(salesJob)}),
    ('A08102', ${literal(pdJob)});
    insert into fs_chats(job_id,data) values
    ('A08101', ${literal({jobId:'A08101',createdBy:'Synthetic actor',messages:[]})}),
    ('A08102', ${literal({jobId:'A08102',createdBy:'Other actor',messages:[]})});
    insert into fs_messages(uid,job_id,ts,data) values
    ('m-sales','A08101',1,${literal({uid:'m-sales',text:'synthetic sales'})}),
    ('m-pd','A08102',1,${literal({uid:'m-pd',text:'synthetic pd'})});`);
  const response = await fetch(`${gatewayOrigin}/__formula/visible-chat-snapshot`, {headers:{cookie:cookie('sales')}});
  assert.equal(response.status, 200);
  const snapshot = await response.json();
  assert.deepEqual(snapshot.chats.map(row=>row.job_id), ['A08101']);
  assert.deepEqual(snapshot.messages.map(row=>row.uid), ['m-sales']);
  sql("update fs_records set data=jsonb_set(data,'{createdBy}','\"Other actor\"'::jsonb) where id='A08101';");
  const scopeResponse = await fetch(`${gatewayRest()}/fs_records?select=id&order=id.asc`, {headers:{cookie:cookie('sales')}});
  assert.equal(scopeResponse.status, 200);
  assert.deepEqual(await scopeResponse.json(), [], 'a same-session owner transfer removes the job from its visible ID scope');
});

test('first local create survives offline reload and lost committed HTTP ACK before enabling original chat', async () => {
  const storage = new Map(), session = new Map(), original = clientJob('A08001');
  let offline = true, loseCommittedAck = true;
  const handler = async (path, opt = {}) => {
    if (offline) throw new Error('synthetic offline');
    const response = await fetch(`${gatewayRest()}/${path}`, {
      method: opt.method || 'GET',
      headers: { 'content-type': 'application/json', cookie: cookie(), ...(opt.headers || {}) },
      body: opt.body ? JSON.stringify(opt.body) : undefined,
    });
    const text = await response.text();
    assert.equal(response.ok, true, `synthetic HTTP ${response.status}: ${text}`);
    const value = text ? JSON.parse(text) : null;
    if (path === 'rpc/fs_save_record' && loseCommittedAck) {
      assert.equal(value.status, 'saved');
      loseCommittedAck = false;
      throw new Error('synthetic response lost after database commit');
    }
    return value;
  };
  const first = harness({ storage, session, handler });
  first.run('sbReady=false');first.context.__new = original;
  first.run('records.push(__new);saveRecordsStore()');
  await first.run('sbPush()');
  assert.equal(first.calls.length, 0, 'bootstrap without full read cannot write');
  assert.equal(sql('select count(*) from fs_records;'), '0');
  first.run(`createChat('A08001')`);assert.equal(first.run('chats.length'), 0);

  const reloaded = harness({ storage, session, handler });
  reloaded.run('sbReady=false');reloaded.run(clientPull([]));reloaded.run('sbReady=true');
  assert.deepEqual(reloaded.read('records[0]'), original, 'empty full pull preserves captured draft');
  await reloaded.run('sbPush()');
  assert.equal(reloaded.pending().A08001.status, 'retry');
  assert.equal(sql('select count(*) from fs_records;'), '0');
  assert.match(reloaded.nodes.fsJobSyncStatus.textContent,/รอการบันทึก|ส่งอัตโนมัติ/);

  offline = false;
  await reloaded.run('sbPush()'); // database commits; browser does not receive ACK
  assert.deepEqual(JSON.parse(sql("select data from fs_records where id='A08001';")), original);
  assert.equal(reloaded.pending().A08001.status, 'retry');
  reloaded.run(`createChat('A08001')`);assert.equal(reloaded.run('chats.length'), 0);
  assert.equal(sql('select count(*) from fs_chats;'), '0');

  const afterAckLoss = harness({ storage, session, handler });
  const saved = JSON.parse(sql("select data from fs_records where id='A08001';"));
  afterAckLoss.run(clientPull([saved]));
  afterAckLoss.run(`openChatRoom('A08001')`);assert.equal(afterAckLoss.run('chatOpenId'), null);
  await afterAckLoss.run('sbPush()'); // exact retry ACK, no replacement or new number
  assert.deepEqual(afterAckLoss.pending(), {});
  assert.equal(sql('select count(*) from fs_records;'), '1');
  afterAckLoss.run(`createChat('A08001')`);assert.equal(afterAckLoss.run('chats.length'), 1);
  await afterAckLoss.run('sbPush()');
  assert.equal(sql("select count(*) from fs_chats where job_id='A08001';"), '1');
  assert.notEqual(sql("select count(*) from fs_messages where job_id='A08001';"), '0');
  assert.equal(sql('select count(*) from fs_chats c left join fs_records r on r.id=c.job_id where r.id is null;'), '0');
  assert.equal(afterAckLoss.calls.some(call => call.path === 'fs_records'), false);
});

test('approved generateDash creates a durable job that auto sync commits before chat and another client reads it after reopen', async () => {
  const storage=new Map(), session=new Map();
  let offline=true, wrongAckOnce=true, committed;
  const handler=async(path,opt={},role='sales')=>{
    if(offline)throw Error('synthetic offline');
    const response=await fetch(`${gatewayRest()}/${path}`,{
      method:opt.method||'GET',headers:{'content-type':'application/json',cookie:cookie(role,'sales'),...(opt.headers||{})},
      body:opt.body?JSON.stringify(opt.body):undefined,
    });
    const text=await response.text();assert.equal(response.ok,true,`synthetic HTTP ${response.status}: ${text}`);
    const value=text?JSON.parse(text):null;
    if(path==='rpc/fs_save_record'){
      assert.equal(value.status,'saved');committed=structuredClone(value);
      if(wrongAckOnce){wrongAckOnce=false;return {...value,data:{...value.data,notes:'Mismatched synthetic acknowledgement'}};}
    }
    return value;
  };
  const first=harness({storage,session,handler,beforeAsset:form});
  assert.equal(first.run('fields.btnCreate.disabled'),false);
  first.run('generateDash()');
  assert.equal(first.run('allocated'),1);assert.equal(first.run('cleared'),1);
  const original=first.read('records[0]'),id=original.id;
  assert.deepEqual(first.pending()[id].data,original);
  first.run(`createChat('${id}')`);assert.equal(first.run('chats.length'),0);
  await first.run('sbPush()');
  assert.ok(first.pending()[id]);assert.equal(sql('select count(*) from fs_records;'),'0');

  const reopened=harness({storage,session,handler,beforeAsset:form});
  reopened.run(clientPull([]));assert.deepEqual(reopened.read('records[0]'),original);
  assert.equal(reopened.run('allocated'),0,'browser reopen performs no replacement create');
  offline=false;
  // Normal auto-sync entry point: no second generator/edit/manual export.
  await reopened.run('sbPush()');
  assert.deepEqual(JSON.parse(sql(`select data from fs_records where id='${id}';`)),original);
  assert.equal(reopened.pending()[id].status,'unconfirmed','HTTP 200 with wrong data cannot unlock chat');
  reopened.run(`createChat('${id}')`);assert.equal(reopened.run('chats.length'),0);
  await reopened.run('sbPush()');
  assert.deepEqual(committed,{status:'saved',id,data:original});
  assert.deepEqual(reopened.pending(),{});assert.equal(sql('select count(*) from fs_records;'),'1');
  reopened.run(`createChat('${id}')`);assert.equal(reopened.run('chats.length'),1);
  await reopened.run('sbPush()');
  assert.equal(sql(`select count(*) from fs_chats where job_id='${id}';`),'1');
  assert.equal(reopened.calls.some(call=>call.path==='fs_records'),false,'no legacy blind record POST');

  const fetchSaved=async client=>{
    const parents=await client.run(`sbReq('fs_records?id=eq.${id}&select=id,data',{method:'GET'})`);
    const rooms=await client.run(`sbReq('fs_chats?job_id=eq.${id}&select=job_id,data',{method:'GET'})`);
    assert.deepEqual(parents.map(row=>row.data),[original]);assert.equal(rooms.length,1);
    client.context.__parents=parents;client.context.__rooms=rooms;
    client.run('sbApply({full:true,partial:false,rec:__parents,cht:__rooms,usr:[],act:[],msg:[],apv:[]})');
  };
  // Reopen after confirmation too: server reads reconstruct the original ID
  // and existing room; no local creation/export is involved.
  const afterConfirmation=harness({storage,session,handler,beforeAsset:form+source('sbBuildChat')});
  await fetchSaved(afterConfirmation);
  afterConfirmation.run(`openChatRoom('${id}')`);assert.equal(afterConfirmation.run('chatOpenId'),id);
  assert.equal(afterConfirmation.run('allocated'),0);assert.deepEqual(afterConfirmation.pending(),{});
  assert.equal(afterConfirmation.calls.some(call=>call.path==='rpc/fs_save_record'),false);

  const reader=harness({owner:'admin',handler:(path,opt)=>handler(path,opt,'admin'),beforeAsset:source('sbBuildChat')});
  await fetchSaved(reader);
  assert.deepEqual(reader.read('records[0]'),original);
  reader.run(`openChatRoom('${id}')`);assert.equal(reader.run('chatOpenId'),id);assert.equal(reader.run('chats.length'),1);
  assert.equal(reader.calls.some(call=>call.path==='rpc/fs_save_record'),false,'reader cannot masquerade as another new create');
});
