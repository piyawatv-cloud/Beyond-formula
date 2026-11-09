import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile, mkdir, writeFile, copyFile, access, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { asset as jobSyncAsset, harness, source } from './helpers/job-sync-client.mjs';

const root = new URL('../', import.meta.url).pathname;
// Test-only latency: slow the deferred bridge response and each history page.
// This models a slow local transport, not host CPU load.
const timingLatency = process.env.FORMULA_TIMING_TEST_LATENCY === '1';
const secret = 'synthetic-session-secret-0123456789abcdef';
const job = (id = 'A00001', label = 'Synthetic customer') => ({ id, customer: label, rows: [], createdBy: 'Synthetic Sales' });
// Independent business expectation: never derive it from the saved map/ACK.
function assertExpectedPdParent(actual, expected, bounds, label) {
  const {lastActivityAt,...parent} = actual;
  assert.deepEqual(parent,expected,label+': preserve original parent and every untouched ingredient field');
  assert.equal(typeof lastActivityAt,'number',label+': movement timestamp must be numeric');
  assert.ok(Number.isFinite(lastActivityAt)&&lastActivityAt>=bounds.min&&lastActivityAt<=bounds.max,label+': generated movement timestamp stays within observed Save bounds');
}

// JSONB compares every nested value, ignoring object key order but preserving arrays.
const stable = data => data && typeof data === 'object'
  ? Array.isArray(data) ? '[' + data.map(stable).join(',') + ']'
    : '{' + Object.keys(data).sort().map(key => JSON.stringify(key) + ':' + stable(data[key])).join(',') + '}'
  : JSON.stringify(data);
// The test upstream also hosts IAM transport; observe everything, but classify
// its two known authorization routes separately from data mutations/RPCs.
const dataOperationAttempts = requests => requests.filter(request => request.path.startsWith('/rpc/')
  || (!['GET','HEAD','OPTIONS'].includes(request.method)
    && !['/consumer/v1/permission-check','/consumer/v2/auth/session/introspect'].includes(request.path)));
const isIdWarmup = request => request.path==='/rpc/fs_next_rec_seq' && request.method==='POST'
  && request.query==='' && JSON.stringify(request.body)==='{}';

async function stopProxyChild(child) {
  if (child.exitCode!==null || child.signalCode!==null) return;
  const stopped = new Promise(resolve => child.once('exit', resolve));
  child.kill(); await stopped;
}

async function stack(t, { transform, releaseRoot, assetDir, assetDelayMs = 0, messageCount = 0, messageDelayMs = 0, messageFailCount = 0, coreDelayMs = 0, iamAllow, ownerDeleteReservationTtlMs, intake = false, users = [], approvals = [], versions = null, iamIntrospection } = {}) {
  const records = new Map(), recordUpdatedAt = new Map(), archives = new Map(), writes = [], permissions = [], activities = new Map(), activityReads = [], scopedReadHeaders = [];
  const scopeRows = { fs_chats: [], fs_messages: [] };
  const archiveReads = [], upstreamRequests = [], recordAcks = [];
  let recordAckGate = null;
  let introspectionCount = 0;
  let scopeFault = '';
  let recordReadCount = 0, chatReadCount = 0, childPageDriftApplied = false, pageDriftApplied = false;
  const filterIds = value => {
    const raw = String(value || '');
    if (raw.startsWith('eq.')) return [raw.slice(3)];
    if (raw.startsWith('in.(') && raw.endsWith(')')) return raw.slice(4, -1).split(',').filter(Boolean);
    return null;
  };
  const messageRows = Array.from({ length: messageCount }, (_, index) => ({
    uid: `synthetic-message-${index}`,
    job_id: 'A00001',
    ts: index + 1,
    data: { uid: `synthetic-message-${index}`, ts: index + 1, text: `Synthetic message ${index}` },
    updated_at: new Date(1_700_000_000_000 + index).toISOString(),
  }));
  if (messageCount) records.set('A00001', job('A00001'));
  let grantEdit = false, databaseReady = true;
  const upstream = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    const url = new URL(req.url, 'http://synthetic');
    upstreamRequests.push({path:url.pathname,method:req.method,query:url.search,body});
    if (['/fs_records', '/fs_chats', '/fs_messages'].includes(url.pathname) && req.method === 'GET') scopedReadHeaders.push({ table: url.pathname, prefer: req.headers.prefer || '', range: req.headers.range || '', query: url.search });
    const send = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (url.pathname === '/fs_activities' && ['GET', 'HEAD'].includes(req.method)) activityReads.push(req.method);
    if (url.pathname === '/consumer/v2/auth/session/introspect' && iamIntrospection) return send(200, iamIntrospection(++introspectionCount));
    if (url.pathname === '/consumer/v1/permission-check') {
      permissions.push(body.required_permission);
      const allowed = typeof iamAllow === 'function'
        ? iamAllow(body.required_permission)
        : body.required_permission === 'FORMULA_VIEW' || grantEdit;
      if(allowed===null)return send(503,{});
      return send(200, { allowed, reason_code: 'SYNTHETIC_DECISION' });
    }
    if (!databaseReady) return send(503, {});
    const ranged = (items, { malformed = false, partial = false } = {}) => {
      const filterColumn=url.pathname==='/fs_records'?'id':'job_id';
      const jobFilter = url.searchParams.get(filterColumn);
      if (jobFilter) {
        const match = /^eq\.(.+)$/.exec(jobFilter);
        const list = /^in\.\((.*)\)$/.exec(jobFilter);
        const ids = match ? [match[1]] : list ? list[1].split(',').map(value => value.replace(/^"|"$/g, '')) : null;
        if (ids) items = items.filter(item => ids.includes(String(item?.[filterColumn] || '')));
      }
      const updatedAt = url.searchParams.get('updated_at');
      const updatedMatch = /^gte\.(.+)$/.exec(updatedAt || '');
      if (updatedMatch) items = items.filter(item => String(item?.updated_at || '') >= updatedMatch[1]);
      if (scopeFault === 'foreign-child-injection' && ['/fs_chats', '/fs_messages'].includes(url.pathname) && items.length) {
        items = [{ ...items[0], job_id: 'A99999', data: { text: 'Injected foreign row' } }, ...items.slice(1)];
      }
      const orderKeys = String(url.searchParams.get('order') || '').split(',').filter(Boolean).map(term => ({ key: term.split('.')[0], desc: term.endsWith('.desc') }));
      if (orderKeys.length) items = items.slice().sort((a, b) => {
        for (const { key, desc } of orderKeys) {
          const comparison = String(a?.[key] ?? '').localeCompare(String(b?.[key] ?? '')) * (desc ? -1 : 1);
          if (comparison) return comparison;
        }
        return 0;
      });
      const rawRange = String(req.headers.range || '0-999').replace(/^items=/, '');
      const [fromText, toText] = rawRange.split('-');
      const from = Number.isFinite(Number(fromText)) ? Number(fromText) : 0;
      const to = Number.isFinite(Number(toText)) ? Number(toText) : from + 999;
      const page = items.slice(from, scopeFault==='oversized-page'&&from===0?from+1001:to + 1);
      const total = partial ? items.length + 1 : items.length;
      res.writeHead(200, { 'content-type': 'application/json', 'content-range': malformed ? 'items 0-0/*' : page.length === 0 && total === 0 ? '*/0' : `items ${from}-${Math.max(from, from + page.length - 1)}/${total}` });
      res.end(JSON.stringify(page));
    };
    if (url.pathname === '/fs_records' && req.method === 'GET') {
      if (coreDelayMs) await new Promise(resolve => setTimeout(resolve, coreDelayMs));
      recordReadCount++;
      if (scopeFault === 'owner-change-on-recheck' && recordReadCount === 2 && records.has('A00001')) {
        records.set('A00001', { ...records.get('A00001'), ownerEmail: 'changed-owner@example.test' });
      }
      if (scopeFault === 'parent-page-drift' && !pageDriftApplied && String(req.headers.range || '').startsWith('1000-') && records.has('A00001')) {
        records.set('A00001', { ...records.get('A00001'), ownerEmail: 'changed-owner@example.test' });
        pageDriftApplied = true;
      }
      const rows = [...records].map(([id, data]) => ({ id, data, ...(recordUpdatedAt.has(id) ? { updated_at: recordUpdatedAt.get(id) } : {}) }));
      if (scopeFault === 'malformed-record') rows.push({ id: 'bad', data: {} });
      if (scopeFault === 'duplicate-record') rows.push(rows[0]);
      if (scopeFault === 'conflicting-parent') rows.push({ ...rows[0], data: { ...rows[0]?.data, ownerEmail: 'conflicting@example.test' } });
      return ranged(rows, { malformed: scopeFault === 'malformed-pagination', partial: scopeFault === 'partial-pagination' });
    }
    if (['/fs_chats', '/fs_users'].includes(url.pathname) && req.method === 'GET') {
      if (coreDelayMs) await new Promise(resolve => setTimeout(resolve, coreDelayMs));
      if (url.pathname === '/fs_users') {
        const names=filterIds(url.searchParams.get('name'));
        return send(200,names ? users.filter(row=>names.includes(row.name)) : users);
      }
      chatReadCount++;
      if (scopeFault === 'child-read-failure' || (scopeFault === 'child-recheck-failure' && chatReadCount === 2)) return send(503, {});
      if (scopeFault === 'child-change-on-recheck' && chatReadCount === 2 && scopeRows.fs_chats.length) {
        scopeRows.fs_chats[0] = { ...scopeRows.fs_chats[0], data: { title: 'Changed during read' } };
      }
      if (scopeFault === 'owner-change-during-child-recheck' && chatReadCount === 2 && records.has('A00001')) {
        records.set('A00001', { ...records.get('A00001'), ownerEmail: 'changed-owner@example.test' });
      }
      const rows = scopeRows.fs_chats.slice();
      if (scopeFault === 'unresolved-chat') rows.push({ job_id: 'A99999', data: {} });
      return ranged(rows, { malformed: scopeFault === 'malformed-pagination', partial: scopeFault === 'partial-pagination' });
    }
    if (url.pathname === '/fs_archive' && req.method === 'GET') {
      archiveReads.push(url.search);
      const ids = filterIds(url.searchParams.get('row_key'));
      const result = [...archives].filter(([id]) => !ids || ids.includes(id)).map(([id, data]) => ({ row_key:id, data:{ id, data } }));
      return send(200, result);
    }
    if (url.pathname === '/fs_messages' && req.method === 'GET') {
      if (messageFailCount > 0) {
        messageFailCount--;
        res.writeHead(503, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'synthetic message history outage' }));
      }
      if (messageDelayMs) await new Promise(resolve => setTimeout(resolve, messageDelayMs));
      if (scopeFault === 'child-page-drift' && !childPageDriftApplied && String(req.headers.range || '').startsWith('1000-') && scopeRows.fs_messages.length) {
        scopeRows.fs_messages[0] = { ...scopeRows.fs_messages[0], data: { text: 'Changed during page scan' } };
        childPageDriftApplied = true;
      }
      if (['child-insert-next-page','child-delete-next-page','child-replace-next-page'].includes(scopeFault) && !childPageDriftApplied && String(req.headers.range || '').startsWith('1000-') && scopeRows.fs_messages.length) {
        if(scopeFault!=='child-insert-next-page')scopeRows.fs_messages.shift();
        if(scopeFault!=='child-delete-next-page')scopeRows.fs_messages.push({job_id:'A00001',uid:'z-new',ts:2000,data:{uid:'z-new',text:'Inserted during offset scan'}});
        childPageDriftApplied=true;
      }
      const rows = scopeRows.fs_messages.length ? scopeRows.fs_messages : messageRows;
      return ranged(rows, { malformed: scopeFault === 'malformed-pagination', partial: scopeFault === 'partial-pagination' });
    }
    if (req.method !== 'GET') writes.push({ path: url.pathname, method: req.method, query: url.search, body, prefer: req.headers.prefer });
    if (url.pathname === '/fs_records' && req.method === 'DELETE') {
      const ids = filterIds(url.searchParams.get('id')) || [];
      for (const id of ids) if (records.has(id)) { archives.set(id, records.get(id)); records.delete(id); }
      return send(204, null);
    }
    if (url.pathname === '/fs_approvals' && req.method === 'GET') return send(200, approvals);
    if (url.pathname === '/fs_approvals' && req.method === 'DELETE') return send(204, null);
    if (['/fs_chats', '/fs_messages'].includes(url.pathname) && req.method === 'DELETE') return send(204, null);
    if (url.pathname === '/rpc/fs_save_record') {
      const current = records.get(body.p_id);
      if (current && stable(current) === stable(body.p_data)) return send(200, { status: 'saved', id: body.p_id, data: current });
      if (current ? stable(current) !== stable(body.p_expected) : body.p_expected !== null) return send(200, { status: 'conflict', id: body.p_id });
      records.set(body.p_id, body.p_data);
      if (recordAckGate) await recordAckGate;
      const ack = { status: 'saved', id: body.p_id, data: structuredClone(body.p_data) };
      recordAcks.push(ack);
      return send(200, ack);
    }
    if (url.pathname === '/rpc/fs_set_user_role') return send(200, {status:'saved'});
    if (url.pathname === '/rpc/fs_record_versions') {
      if (versions === null) return send(404, { message: 'function not installed' });
      const list = (versions.get(String(body?.p_id)) || []).slice(0, Number(body?.p_limit) || 12);
      return send(200, list.map(v => ({ archived_at: new Date(v.at).toISOString(), data: v.data })));
    }
    if (url.pathname === '/fs_activities' && ['GET', 'HEAD'].includes(req.method)) {
      const uids = filterIds(url.searchParams.get('uid')) || [];
      return send(200, uids.filter(uid => activities.has(uid)).map(uid => activities.get(uid)));
    }
    if (url.pathname === '/fs_activities' && req.method === 'POST') {
      // Mirror production: the append-only trigger skips a duplicate uid, so the
      // representation omits it and the request still answers 2xx.
      const fresh = (Array.isArray(body) ? body : [body]).filter(row => !activities.has(String(row?.uid)));
      for (const row of fresh) activities.set(String(row.uid), row);
      return send(fresh.length ? 201 : 200, fresh);
    }
    if (['/fs_chats', '/fs_messages', '/fs_approvals'].includes(url.pathname) && req.method === 'POST') {
      // Match the schema's primary identities and PostgREST merge-duplicates:
      // messages have a global uid; approvals are independent (job_id,part).
      const table = url.pathname.slice(1);
      const rows = table === 'fs_approvals' ? approvals
        : table === 'fs_messages' ? (scopeRows.fs_messages.length ? scopeRows.fs_messages : messageRows) : scopeRows.fs_chats;
      const keys = table === 'fs_messages' ? ['uid'] : table === 'fs_approvals' ? ['job_id','part'] : ['job_id'];
      const candidates = Array.isArray(body) ? body : [body];
      if (candidates.some(row => keys.some(key => !row?.[key]))) return send(400,{code:'23502'});
      if (!String(req.headers.prefer || '').includes('resolution=merge-duplicates')
          && candidates.some(row => rows.some(old => keys.every(key => old[key] === row[key])))) return send(409,{code:'23505'});
      const saved = candidates.map(row => {
        const index = rows.findIndex(old => keys.every(key => old[key] === row[key]));
        const value = structuredClone({...(index >= 0 ? rows[index] : {}),...row,updated_at:new Date().toISOString()});
        if (index >= 0) rows[index] = value; else rows.push(value);
        return structuredClone(value);
      });
      return send(201,saved);
    }
    if (['/fs_users', '/fs_meta'].includes(url.pathname)) return send(201, body || []);
    return send(404, {});
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const log = await mkdtemp(join(tmpdir(), 'job-sync-gateway-'));
  let releaseDir = releaseRoot || join(root, 'releases');
  if(!releaseRoot && (process.env.FORMULA_JOB_SYNC_TEST_HTML || transform)) {
    const current = (await readFile(join(root,'releases/CURRENT'),'utf8')).trim();
    let html = await readFile(process.env.FORMULA_JOB_SYNC_TEST_HTML || join(root,'releases',current,'index.html'), 'utf8');
    if(transform) html = transform(html);
    const id = createHash('sha256').update(html).digest('hex').slice(0,12);
    releaseDir = join(log,'sealed');
    await mkdir(join(releaseDir,id),{recursive:true});
    await writeFile(join(releaseDir,'CURRENT'),id);
    await writeFile(join(releaseDir,id,'index.html'),html);
    await writeFile(join(releaseDir,id,'meta.json'),JSON.stringify({id,buildStamp:html.match(/R&D Briefing Tool · (build [^<]+)/)?.[1]}));
  }
  const child = spawn(process.execPath, ['runtime/formula-proxy.mjs'], {
    cwd: root, env: {
      PATH: process.env.PATH, PORT: String(port), FORMULA_COLOR: 'blue', FORMULA_STACK: 'synthetic',
      FORMULA_RELEASE_DIR: releaseDir, FORMULA_ASSET_DIR: assetDir || join(root, 'runtime/assets'), FORMULA_LOG_DIR: log,
      SB_ORIGIN: `http://127.0.0.1:${upstream.address().port}`, SB_SERVICE_KEY: 'synthetic-not-a-key', SB_REST_BASE: '/',
      FORMULA_SESSION_SECRET: secret, FORMULA_IAM_CACHE_MS: '1',
      ...(iamIntrospection ? { FORMULA_IAM_SESSION_MODE: 'required' } : {}),
      ...(ownerDeleteReservationTtlMs ? { FORMULA_OWNER_DELETE_RESERVATION_TTL_MS: String(ownerDeleteReservationTtlMs) } : {}),
      // Production always runs with the durable intake; tests opt in so the
      // intake code path (not the legacy direct path) is what gets asserted.
      ...(intake ? { FORMULA_JOB_INTAKE_DIR: join(log, 'intake'), FORMULA_JOB_INTEGRITY_INTERVAL_MS: '60000' } : {}),
      IAM_CONSUMER_ORIGIN: `http://127.0.0.1:${upstream.address().port}`, IAM_CONSUMER_SHARED_SECRET: 'synthetic-iam-secret-0123456789abcdef0123',
    }, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let proxyErrors = '';
  child.stderr.on('data', chunk => { proxyErrors += chunk; });
  t.after(async () => {
    await stopProxyChild(child);
    await new Promise(resolve => upstream.close(resolve));
    await rm(log, { recursive: true, force: true });
  });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/__formula/health`)).ok) { ready = true; break; } } catch {}
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.ok(ready, 'isolated proxy process must start: '+proxyErrors.slice(-2000));
  let publicPort = port;
  if (assetDelayMs) {
    const relay = createServer(async (req, res) => {
      try {
        if (req.url.startsWith('/fs-job-sync.js')) await new Promise(resolve => setTimeout(resolve, assetDelayMs));
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const response = await fetch(`http://127.0.0.1:${port}${req.url}`, {
          method: req.method, headers: req.headers,
          ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }),
        });
        const headers = Object.fromEntries(response.headers);
        delete headers['transfer-encoding']; delete headers['content-encoding']; delete headers['content-length'];
        res.writeHead(response.status, headers); res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) { res.writeHead(502); res.end(String(error)); }
    });
    await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
    publicPort = relay.address().port;
    t.after(async () => {
      // Chromium may leave an incomplete preconnect open until its header
      // timeout. This disposable relay owns those sockets; close them before
      // waiting for server shutdown (the browser cleanup runs afterward).
      relay.closeAllConnections();
      await new Promise(resolve => relay.close(resolve));
    });
  }
  const call = (path, body, { role = 'sales', name = 'Synthetic Sales', email = '', method = 'POST', anonymous = false, representation = false, headers = {}, range } = {}) => {
    const value = Buffer.from(JSON.stringify({ name, role, email, centralUserId: 'synthetic-central-user', exp: Date.now() + 60_000 })).toString('base64url');
    const signed = `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`;
    return fetch(`http://127.0.0.1:${port}/sb/rest/v1/${path}`, {
      method, headers: { 'content-type': 'application/json', ...headers, ...(!anonymous ? { cookie: `fs_session=${signed}` } : {}),
        ...(range ? { Range: range } : {}),
        ...(representation ? { Prefer: 'return=representation,resolution=merge-duplicates' } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };
  const internal = (path, { role = 'sales', name = 'Synthetic Sales', email = '', method = 'GET', anonymous = false, expiresIn = 60_000 } = {}) => {
    const value = Buffer.from(JSON.stringify({ name, role, email, centralUserId: 'synthetic-central-user', exp: Date.now() + expiresIn })).toString('base64url');
    const signed = `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`;
    return fetch(`http://127.0.0.1:${port}${path}`, { method, headers: anonymous ? {} : { cookie: iamIntrospection ? 'fs_iam_session=synthetic-opaque-session' : `fs_session=${signed}` } });
  };
  const session = ({ role = 'sales', email = '' } = {}) => {
    const value = Buffer.from(JSON.stringify({ name: 'Synthetic Sales', role, email, centralUserId: 'synthetic-central-user', exp: Date.now() + 60_000 })).toString('base64url');
    const signed = `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`;
    return fetch(`http://127.0.0.1:${port}/sb/session`, { headers: { cookie: `fs_session=${signed}`, accept: 'application/json' } });
  };
  const audit = async () => {
    const { readdir } = await import('node:fs/promises');
    const lines = [];
    for (const name of (await readdir(log)).filter(file => /^gateway-.*\.ndjson$/.test(file))) {
      for (const line of (await readFile(join(log, name), 'utf8')).split('\n').filter(Boolean)) lines.push(JSON.parse(line));
    }
    return lines;
  };
  return { records, recordUpdatedAt, archives, archiveReads, writes, messageRows, upstreamRequests, permissions, activityReads, activities, recordAcks,
    holdRecordAck: () => {
      let release; recordAckGate = new Promise(resolve => { release = resolve; });
      return () => { recordAckGate = null; release(); };
    }, call, internal, session, proxyErrors: () => proxyErrors,
    auditBlocked: async blocked => {
      const path = join(log, `gateway-${new Date().toISOString().slice(0, 10)}.ndjson`);
      if (blocked) await mkdir(path);
      else await rm(path, { recursive: true });
    }, port: publicPort, upstreamOrigin: `http://127.0.0.1:${upstream.address().port}`, audit, scopeRows, scopedReadHeaders, scopeFault: value => { scopeFault = value; recordReadCount = 0; chatReadCount = 0; childPageDriftApplied = false; pageDriftApplied = false; }, edit: value => { grantEdit = value; }, database: value => { databaseReady = value; } };
}

test('isolated proxy cleanup settles when the child exited before cleanup', async () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {stdio:'ignore'});
  await new Promise(resolve => child.once('exit',resolve));
  assert.equal(child.exitCode,0,'the real child must have exited before cleanup begins');
  let timer;
  try {
    await Promise.race([stopProxyChild(child),new Promise((_,reject) => {
      timer=setTimeout(() => reject(new Error('already-exited proxy cleanup did not settle')),1000);
    })]);
  } finally { clearTimeout(timer); }
});

test('isolated proxy cleanup sends SIGTERM to a live child and settles', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'ignore'});
  await new Promise(resolve => child.once('spawn',resolve));
  let timer;
  try {
    await Promise.race([(async () => {
      await stopProxyChild(child);
      assert.equal(child.signalCode,'SIGTERM');
      await stopProxyChild(child);
    })(),new Promise((_,reject) => {
      timer=setTimeout(() => reject(new Error('live proxy cleanup did not settle')),1000);
    })]);
  } finally {
    clearTimeout(timer);
    if (child.exitCode===null && child.signalCode===null) child.kill('SIGKILL');
  }
});

test('isolated proxy startup failure includes captured synthetic stderr and completes cleanup', async t => {
  const missingRoot=await mkdtemp(join(tmpdir(),'job-sync-missing-release-'));
  t.after(() => rm(missingRoot,{recursive:true,force:true}));
  const releaseRoot=join(missingRoot,'missing');
  await assert.rejects(() => stack(t,{releaseRoot}),error => {
    assert.match(error.message,/isolated proxy process must start/);
    assert.match(error.message,/ENOENT/,'the captured child stderr must explain this controlled startup failure');
    assert.ok(error.message.includes(join(releaseRoot,'CURRENT')),'report the actual missing synthetic release path');
    assert.ok(error.message.length<=2100,'startup failure diagnostics stay bounded');
    return true;
  });
});

test('synthetic upstream fixture compares complete nested formula JSON and persists child upserts', async t => {
  await t.test('nested formula CAS distinguishes weights and object key order', async t => {
    const s = await stack(t);
    const original = {...job(),rows:[{name:'Synthetic ingredient',w:10,nested:{retained:[null,false,{dose:2}]}}]};
    s.records.set(original.id, structuredClone(original));
    const changed = {...original,rows:[{...original.rows[0],w:55}]};
    const rpc = async body => (await fetch(s.upstreamOrigin + '/rpc/fs_save_record', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json();
    const saved = await rpc({p_id:original.id,p_data:changed,p_expected:original});
    assert.deepEqual(saved,{status:'saved',id:original.id,data:changed},'a nested-only edit must persist and ACK the changed value');
    assert.deepEqual(s.records.get(original.id),changed);
    const stale = await rpc({p_id:original.id,p_data:{...changed,rows:[{...changed.rows[0],w:70}]},p_expected:original});
    assert.equal(stale.status,'conflict','a stale nested weight must not satisfy CAS');
    assert.deepEqual(s.records.get(original.id),changed);
    const reordered = {createdBy:changed.createdBy,rows:[{nested:{retained:[null,false,{dose:2}]},w:55,name:'Synthetic ingredient'}],customer:changed.customer,id:changed.id};
    assert.deepEqual((await rpc({p_id:original.id,p_data:reordered,p_expected:null})).data,changed,'JSON object order is immaterial at every depth');
    const next = {...changed,rows:[{...changed.rows[0],nested:{retained:[false,null,{dose:2}]}}]};
    assert.equal((await rpc({p_id:original.id,p_data:next,p_expected:reordered})).status,'saved');
    assert.deepEqual(s.records.get(original.id),next,'array order and nested values must remain meaningful');
  });
  await t.test('children use their primary keys and POST changes survive subsequent GET', async t => {
    const s = await stack(t);
    const post = async (table, rows) => {
      const response = await fetch(s.upstreamOrigin + '/' + table,{method:'POST',headers:{'content-type':'application/json',Prefer:'return=representation,resolution=merge-duplicates'},body:JSON.stringify(rows)});
      assert.equal(response.status,201); return response.json();
    };
    for (const [table,first,replacement] of [
      ['fs_chats',{job_id:'A00001',data:{title:'Old room'}},{job_id:'A00001',data:{title:'Changed room',unknown:[null,false]}}],
      ['fs_messages',{uid:'same-primary-message',job_id:'A00001',ts:1,data:{text:'Old message'}},{uid:'same-primary-message',job_id:'A00002',ts:2,data:{text:'Changed message'}}],
      ['fs_approvals',{job_id:'A00001',part:'pd',data:{by:'Old PD'}},{job_id:'A00001',part:'pd',data:{by:'Changed PD'}}],
    ]) {
      await post(table,[first]);
      await post(table,[replacement]);
      const rows = await (await fetch(s.upstreamOrigin + '/' + table)).json();
      assert.equal(rows.length,1,table + ' must upsert by its real primary identity');
      for (const [key,value] of Object.entries(replacement)) assert.deepEqual(rows[0][key],value,table + ' must return durable replacement data');
      assert.deepEqual((await post(table,[replacement]))[0].data,replacement.data,'idempotent upsert retains exact child data');
      const duplicate = await fetch(s.upstreamOrigin+'/'+table,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify([replacement])});
      assert.equal(duplicate.status,409,'an unqualified duplicate POST must not falsely ACK a replacement');
      const invalid = {...replacement}; delete invalid[table==='fs_messages'?'uid':'job_id'];
      const missingKey = await fetch(s.upstreamOrigin+'/'+table,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify([invalid])});
      assert.equal(missingKey.status,400,'a child without its primary identity cannot be ACKed');
      assert.equal((await (await fetch(s.upstreamOrigin+'/'+table)).json()).length,1,'rejected writes preserve the existing child');
    }
    await post('fs_approvals',[{job_id:'A00001',part:'ra',data:{by:'RA'}}]);
    assert.equal((await (await fetch(s.upstreamOrigin + '/fs_approvals')).json()).length,2,'split approval parts must retain independent primary identities');
  });
});

test('upstream request observer records rejected mutation and GET RPC attempts before an outage response', async t => {
  const s = await stack(t);
  const original = job(); s.records.set(original.id, original);
  s.database(false);
  const attempts = [
    {path:'/fs_records',method:'POST',query:'',body:[{id:original.id,data:{...original,customer:'Rejected replacement'}}]},
    {path:'/rpc/fs_next_rec_seq',method:'GET',query:'?synthetic=observer',body:null},
  ];
  for (const request of attempts) {
    const response = await fetch(s.upstreamOrigin + request.path + request.query, {
      method:request.method,headers:{'content-type':'application/json'},
      ...(request.body===null?{}:{body:JSON.stringify(request.body)}),
    });
    assert.equal(response.status,503,'the owned synthetic upstream rejects each attempted operation');
  }
  assert.deepEqual(s.upstreamRequests,attempts,'all attempted method/path/query/body values are observed before the 503 return');
  assert.deepEqual(dataOperationAttempts(s.upstreamRequests).filter(request=>!isIdWarmup(request)),attempts,'rejected mutation and GET RPC both remain forbidden data-operation attempts');
  assert.deepEqual(s.writes,[],'legacy post-availability recorder semantics are unchanged');
  assert.deepEqual([...s.records],[[original.id,original]],'rejected attempts do not mutate synthetic data');
});

test('activity reads use the verified admin session and never forward a filtered read', async t => {
  const s = await stack(t);
  for (const method of ['GET', 'HEAD']) {
    for (const options of [{ role: 'sales' }, { role: 'pd' }, { anonymous: true }, {
      role: 'sales', headers: { role: 'admin', 'x-role': 'admin', 'x-formula-role': 'admin' },
    }]) {
      const readCount = s.activityReads.length;
      const response = await s.call('fs_activities?role=admin', undefined, { ...options, method });
      assert.equal(response.status, options.anonymous ? 401 : 200, `${method} must filter ${JSON.stringify(options)}`);
      assert.equal(s.activityReads.length, readCount, 'filtered reads must stop before the database');
      if (method === 'GET') {
        const body = await response.json();
        if (options.anonymous) assert.deepEqual(Object.keys(body).sort(), ['hint', 'message']);
        else assert.deepEqual(body, [], 'filtered reads must expose no activity payload and keep sync running');
      } else assert.equal(await response.text(), '');
    }
    assert.equal((await s.call('fs_activities?uid=eq.synthetic-activity', undefined, { role: 'admin', method })).status, 200);
    assert.equal(s.activityReads.at(-1), method, 'admin reads reach the database');
  }
  const filtered = (await s.audit()).filter(line => line.decision === 'filtered' && line.table === 'fs_activities');
  assert.equal(filtered.length, 6);
  assert.ok(filtered.every(line => line.by === 'Synthetic Sales' && ['sales', 'pd'].includes(line.byRole) && line.reason === 'FORMULA_ACTIVITY_READ_ADMIN_REQUIRED'));
  assert.ok(filtered.every(line => !Object.hasOwn(line, 'rows') && !Object.hasOwn(line, 'data')));
});

test('a filtered activity read leaves activity writes and unrelated sync requests usable', async t => {
  const s = await stack(t);
  const filtered = await s.call('fs_activities', undefined, { method: 'GET' });
  assert.equal(filtered.status, 200);
  assert.deepEqual(await filtered.json(), []);
  const activity = { uid: 'synthetic-after-denial', ts: 123, data: { uid: 'synthetic-after-denial', ts: 123, user: 'Forged', role: 'admin', action: 'Synthetic action' } };
  const written = await s.call('fs_activities', [activity], { representation: true });
  assert.equal(written.status, 201);
  const rows = await written.json();
  assert.equal(rows[0].data.user, 'Synthetic Sales');
  assert.equal(rows[0].data.role, 'sales');
  assert.equal(rows[0].uid, activity.uid);
  assert.equal(rows[0].ts, activity.ts);
  const record = job('A00901');
  s.records.set(record.id, record);
  const synced = await s.call('fs_records', undefined, { method: 'GET' });
  assert.equal(synced.status, 200);
  assert.deepEqual(await synced.json(), [{ id: record.id, data: record }]);
  assert.ok(s.writes.some(write => write.path === '/fs_activities' && write.method === 'POST'));

});

test('record incremental reads accept the core timestamp query and preserve actor scope', async t => {
  const s = await stack(t);
  for (const [id, ownerEmail, timestamp] of [
    ['A00001', 'sales@example.test', '2026-10-16T07:58:26.289Z'],
    ['A00002', 'sales@example.test', '2026-10-16T07:58:26.290Z'],
    ['A00003', 'sales@example.test', '2026-10-16T07:58:26.291Z'],
    ['A00004', 'other@example.test', '2026-10-16T07:58:26.291Z'],
  ]) {
    s.records.set(id, { ...job(id), ownerEmail });
    s.recordUpdatedAt.set(id, timestamp);
  }
  const originals = structuredClone([...s.records]);
  const query = 'fs_records?select=id,data,updated_at&order=id.asc&updated_at=gte.2026-10-16T07:58:26.290Z';
  for (const [role, expectedIds] of [['admin', ['A00002', 'A00003', 'A00004']], ['sales', ['A00002', 'A00003']]]) {
    await t.test(role, async () => {
      const response = await s.call(query, undefined, { method: 'GET', role, email: 'sales@example.test' });
      assert.equal(response.status, 200, 'the sealed core incremental query must be accepted');
      const rows = await response.json();
      assert.deepEqual(rows.map(row => row.id), expectedIds, 'include the exact boundary and later rows within the verified actor scope');
      assert.equal(rows[0].updated_at, '2026-10-16T07:58:26.290Z');
      assert.deepEqual(rows[0].data, { id: 'A00002', customer: 'Synthetic customer', rows: [], createdBy: 'Synthetic Sales', ownerEmail: 'sales@example.test' });
      assert.equal(response.headers.get('content-range'), `items 0-${expectedIds.length - 1}/${expectedIds.length}`);
      const head = await s.call(query, undefined, { method: 'HEAD', role, email: 'sales@example.test' });
      assert.equal(head.status, 200);
      assert.equal(head.headers.get('content-range'), response.headers.get('content-range'));
      assert.equal(await head.text(), '');
    });
  }
  const projected = await s.call(query.replace('select=id,data,updated_at', 'select=id'), undefined, { method: 'GET', email: 'sales@example.test', range: '1-1' });
  assert.equal(projected.status, 200);
  assert.deepEqual(await projected.json(), [{ id: 'A00003' }], 'filter before projection and paging');
  assert.equal(projected.headers.get('content-range'), 'items 1-1/2');
  const foreign = await s.call(query + '&id=eq.A00004', undefined, { method: 'GET', email: 'sales@example.test' });
  assert.equal(foreign.status, 200);
  assert.deepEqual(await foreign.json(), [], 'a valid timestamp and foreign ID cannot broaden actor scope');
  assert.deepEqual([...s.records], originals, 'incremental reads preserve stored records');
  assert.deepEqual(dataOperationAttempts(s.upstreamRequests), [], 'reads must not perform data writes or RPCs');
});

test('record incremental reads reject malformed duplicate and unsupported filters before upstream data reads', async t => {
  const s = await stack(t);
  for (const filter of [
    'updated_at=', 'updated_at=gte.not-a-date', 'updated_at=gte.2026-13-16T07:58:26.290Z',
    'updated_at=gte.2026-10-16', 'updated_at=gte.2026-10-16T07:58:26.290Ztrailing',
    'updated_at=gt.2026-10-16T07:58:26.290Z', 'updated_at=lte.2026-10-16T07:58:26.290Z',
    'updated_at=gte.2026-10-16T07:58:26.290Z&updated_at=gte.2026-10-16T07:58:26.291Z',
    'updated_at=gte.2026-10-16T07:58:26.290Z&or=(id.eq.A00004)',
    'updated_at=gte.2026-10-16T07:58:26.290Z&not_a_column=eq.value',
  ]) {
    for (const method of ['GET', 'HEAD']) {
      const response = await s.call('fs_records?select=id,data,updated_at&' + filter, undefined, { method, role: 'admin' });
      assert.equal(response.status, 400, `${method} rejects ${filter}`);
    }
  }
  assert.deepEqual(s.scopedReadHeaders, [], 'invalid queries stop before reading any upstream business rows');
  assert.deepEqual(dataOperationAttempts(s.upstreamRequests), []);
});

test('record full reads retain earlier authorized rows without a timestamp filter', async t => {
  const s = await stack(t);
  for (const [id, ownerEmail, timestamp] of [
    ['A00001', 'sales@example.test', '2026-10-16T07:58:26.289Z'],
    ['A00002', 'other@example.test', '2026-10-16T07:58:26.291Z'],
  ]) {
    s.records.set(id, { ...job(id), ownerEmail });
    s.recordUpdatedAt.set(id, timestamp);
  }
  for (const [role, expectedIds] of [['admin', ['A00001', 'A00002']], ['sales', ['A00001']]]) {
    const response = await s.call('fs_records?select=id,data,updated_at&order=id.asc', undefined, { method: 'GET', role, email: 'sales@example.test' });
    assert.equal(response.status, 200);
    const rows = await response.json();
    assert.deepEqual(rows.map(row => row.id), expectedIds);
    assert.equal(rows[0].updated_at, '2026-10-16T07:58:26.289Z', 'full reads keep records older than the incremental boundary');
  }
  assert.deepEqual(dataOperationAttempts(s.upstreamRequests), []);
});

test('scoped generic reads and visible chat snapshot do not expose records outside the session owner scope', async t => {
  const s = await stack(t);
  s.records.set('A00001', { ...job('A00001'), ownerEmail: 'sales@example.test' });
  s.records.set('A00002', { ...job('A00002', 'Foreign'), ownerEmail: 'other@example.test' });
  s.records.set('A00003', { ...job('A00003'), createdBy: 'Synthetic Sales' });
  s.records.set('A00004', { ...job('A00004'), ownerEmail: 'other@example.test', createdBy: 'Synthetic Sales' });
  s.scopeRows.fs_chats.push(
    { job_id: 'A00001', data: { title: 'Visible room' } },
    { job_id: 'A00002', data: { title: 'Foreign room secret' } },
  );
  s.scopeRows.fs_messages.push(
    { uid: 'message-visible', job_id: 'A00001', ts: 1, updated_at: new Date(1_700_000_000_000).toISOString(), data: { text: 'Visible message' } },
    { uid: 'message-visible-later', job_id: 'A00001', ts: 3, updated_at: new Date(1_700_000_000_001).toISOString(), data: { text: 'Visible later message' } },
    { uid: 'message-foreign', job_id: 'A00002', data: { text: 'Foreign message secret' } },
  );

  for (const table of ['fs_records', 'fs_chats', 'fs_messages']) {
    for (const method of ['GET', 'HEAD']) {
      const filter = table === 'fs_records' ? 'id=eq.A00002' : 'job_id=eq.A00002';
      const response = await s.call(`${table}?${filter}&select=*`, undefined, { method, range: '0-100' });
      assert.equal(response.status, 200, `${method} ${table} preserves a supported owner-targeted read`);
      const payload = method === 'HEAD' ? '' : await response.text();
      assert.ok(!payload.includes('A00002'), `${method} ${table} must not return foreign row data`);
      assert.ok(!payload.includes('A00004'), `${method} ${table} must honor canonical owner email over matching legacy names`);
      if (method === 'GET') assert.deepEqual(JSON.parse(payload), [], 'foreign ID plus a broad Range still returns no rows');
      const unsupportedOr = await s.call(`${table}?${filter}&select=*&or=(id.eq.A00002)`, undefined, { method });
      assert.equal(unsupportedOr.status, 400, `${method} ${table} rejects unsupported OR instead of letting it bypass the session scope`);
    }
  }
  const exactRecord = await s.call('fs_records?id=eq.A00001&select=id,data', undefined, { method: 'GET', email: 'sales@example.test' });
  assert.deepEqual(await exactRecord.json(), [{ id: 'A00001', data: s.records.get('A00001') }]);
  const exactChat = await s.call('fs_chats?job_id=eq.A00001&select=job_id,data', undefined, { method: 'GET', email: 'sales@example.test' });
  assert.deepEqual(await exactChat.json(), [{ job_id: 'A00001', data: { title: 'Visible room' } }]);
  const inListChat = await s.call('fs_chats?select=job_id,data&job_id=in.%28%22A00001%22%2C%22A00002%22%29', undefined, { method: 'GET', email: 'sales@example.test' });
  assert.deepEqual(await inListChat.json(), [{ job_id: 'A00001', data: { title: 'Visible room' } }]);
  const exactMessage = await s.call('fs_messages?job_id=eq.A00001&select=job_id,uid,data', undefined, { method: 'GET', email: 'sales@example.test' });
  assert.deepEqual(await exactMessage.json(), [
    { job_id: 'A00001', uid: 'message-visible', data: { text: 'Visible message' } },
    { job_id: 'A00001', uid: 'message-visible-later', data: { text: 'Visible later message' } },
  ]);
  const orderedMessages = await s.call('fs_messages?job_id=eq.A00001&select=uid,ts&order=ts.desc', undefined, { method: 'GET', email: 'sales@example.test' });
  assert.deepEqual(await orderedMessages.json(), [{ uid: 'message-visible-later', ts: 3 }, { uid: 'message-visible', ts: 1 }]);
  const since = encodeURIComponent('gte.' + new Date(1_700_000_000_001).toISOString());
  const readsBeforeIncremental = s.scopedReadHeaders.filter(entry => entry.table === '/fs_messages').length;
  const incremental = await s.call(`fs_messages?updated_at=${since}&select=uid,job_id,updated_at&order=uid.asc`, undefined, { method: 'GET', email: 'sales@example.test', range: '0-0' });
  assert.equal(incremental.status, 200);
  assert.deepEqual(await incremental.json(), [{ uid: 'message-visible-later', job_id: 'A00001', updated_at: new Date(1_700_000_000_001).toISOString() }]);
  assert.equal(incremental.headers.get('content-range'), 'items 0-0/1', 'the exact filtered count and requested page are returned');
  assert.ok(s.scopedReadHeaders.filter(entry => entry.table === '/fs_messages').length - readsBeforeIncremental <= 1,
    'a generic child page fetches only its requested page instead of rescanning the full message table twice');
  const projectedIncremental = await s.call(`fs_messages?updated_at=${since}&select=uid,job_id`, undefined, { method: 'GET', email: 'sales@example.test', range: '0-0' });
  assert.equal(projectedIncremental.status, 200);
  assert.deepEqual(await projectedIncremental.json(), [{ uid: 'message-visible-later', job_id: 'A00001' }],
    'updated_at is selected internally for validation but omitted when the caller did not request it');
  const projectedUpstreamQuery = new URLSearchParams(s.scopedReadHeaders.filter(entry => entry.table === '/fs_messages').at(-1).query);
  assert.equal(projectedUpstreamQuery.get('select'), 'uid,job_id,updated_at', 'the gateway includes updated_at upstream when it needs to validate the filter');
  s.scopeFault('foreign-child-injection');
  const injected = await s.call('fs_messages?select=uid,job_id', undefined, { method: 'GET', email: 'sales@example.test', range: '0-0' });
  assert.equal(injected.status, 503, 'a foreign row injected by upstream fails closed even after server-derived filtering');
  s.scopeFault('');
  s.scopeFault('owner-change-on-recheck');
  const transfer = await s.call('fs_messages?select=uid,job_id', undefined, { method: 'GET', email: 'sales@example.test', range: '0-0' });
  assert.equal(transfer.status, 503, 'a parent owner transfer between lookup and child response fails closed');
  s.scopeFault('');
  s.records.set('A00001', { ...s.records.get('A00001'), ownerEmail: 'sales@example.test' });
  assert.equal((await s.call('fs_messages?select=not_a_column', undefined, { method: 'GET' })).status, 400,
    'unsupported projection columns are rejected instead of returning empty objects');
  assert.ok(s.scopedReadHeaders.length > 0 && s.scopedReadHeaders.every(entry => entry.prefer.includes('count=exact')),
    'server pagination must request exact row counts from PostgREST');
  const snapshot = await s.internal('/__formula/visible-chat-snapshot', { email: 'sales@example.test' });
  assert.equal(snapshot.status, 200);
  const visible = await snapshot.json();
  assert.deepEqual(visible.chats.map(row => row.job_id), ['A00001']);
  assert.deepEqual(visible.messages.map(row => row.uid), ['message-visible', 'message-visible-later']);
  const admin = await s.internal('/__formula/visible-chat-snapshot', { role: 'admin' });
  assert.deepEqual((await admin.json()).chats.map(row => row.job_id), ['A00001', 'A00002']);
  const pd = await s.internal('/__formula/visible-chat-snapshot', { role: 'pd' });
  assert.deepEqual((await pd.json()).chats.map(row => row.job_id), ['A00001', 'A00002']);
});

// These HTTP regressions catch a gateway that treats retained unlinked history
// as a global error, or returns it without a currently authorized parent.
for (const absentParent of ['deleted', 'unexplained']) test(`current-parent history remains available with ${absentParent} parent children retained`, async t => {
  const s = await stack(t);
  s.records.set('A00001', { ...job('A00001'), ownerEmail: 'sales@example.test' });
  s.records.set('A00002', { ...job('A00002', 'Foreign customer'), ownerEmail: 'other@example.test' });
  if (absentParent === 'deleted') s.archives.set('A99999', { ...job('A99999', 'Archived customer'), ownerEmail: 'sales@example.test' });
  s.scopeRows.fs_chats.push(
    { job_id: 'A00001', data: { title: 'Visible room' } },
    { job_id: 'A00002', data: { title: 'Foreign room secret' } },
    { job_id: 'A99999', data: { title: 'Retained room secret' } },
  );
  s.scopeRows.fs_messages.push(
    { uid: 'visible', job_id: 'A00001', data: { text: 'Visible message' } },
    { uid: 'foreign', job_id: 'A00002', data: { text: 'Foreign message secret' } },
    { uid: 'retained', job_id: 'A99999', data: { text: 'Retained message secret' } },
  );
  const before = structuredClone({ records: [...s.records], archives: [...s.archives], rows: s.scopeRows });
  for (const role of ['sales', 'admin']) {
    const response = await s.internal('/__formula/visible-chat-snapshot', { role, email: 'sales@example.test' });
    assert.equal(response.status, 200, `${role} must receive its current-job history`);
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ['chats', 'messages'], 'ordinary responses contain no global retention counts');
    assert.deepEqual(body.chats.map(row => row.job_id), role === 'admin' ? ['A00001', 'A00002'] : ['A00001']);
    assert.deepEqual(body.messages.map(row => row.uid), role === 'admin' ? ['visible', 'foreign'] : ['visible']);
    assert.ok(!JSON.stringify(body).includes('Retained'));
  }
  const audits = (await s.audit()).filter(line => line.decision === 'history-retained-out-of-scope');
  assert.equal(audits.length, 1, 'repeated successful snapshots produce bounded operator retention evidence');
  assert.equal(audits[0].retainedChats, 1);
  assert.equal(audits[0].retainedMessages, 1);
  assert.equal(audits[0].reason, 'FORMULA_HISTORY_PARENT_NOT_CURRENT');
  assert.ok(audits[0].why);
  assert.deepEqual(Object.keys(audits[0]).sort(), ['at', 'color', 'decision', 'reason', 'retainedChats', 'retainedMessages', 'stack', 'why']);
  const auditText = JSON.stringify(audits);
  for (const text of ['A00001', 'A00002', 'A99999', 'sales@example.test', 'Synthetic Sales', 'secret', 'visible', 'foreign', 'retained"']) assert.ok(!auditText.includes(text), `operator evidence excludes ${text}`);
  assert.deepEqual({ records: [...s.records], archives: [...s.archives], rows: s.scopeRows }, before, 'every original row and archive remains unchanged');
  assert.equal(s.writes.length, 0);
  assert.deepEqual(s.archiveReads, [], 'normal history must not expand archive reads or ownership inference');
});

test('unresolved chat and all-unlinked history return only the authorized current-parent subset', async t => {
  const s = await stack(t);
  s.records.set('A00001', job('A00001'));
  s.scopeFault('unresolved-chat');
  const unresolved = await s.internal('/__formula/visible-chat-snapshot');
  assert.equal(unresolved.status, 200);
  assert.deepEqual(await unresolved.json(), { chats: [], messages: [] });
  s.records.clear();
  s.scopeRows.fs_messages.push({ uid: 'retained-only', job_id: 'A99999', data: { text: 'Retained only' } });
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await s.internal('/__formula/visible-chat-snapshot', { role: 'admin' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { chats: [], messages: [] });
  }
  assert.equal((await s.audit()).filter(line => line.decision === 'history-retained-out-of-scope').length, 1, 'changing retained counts cannot bypass the log bound');
  assert.equal(s.scopeRows.fs_messages.length, 1);
  assert.equal(s.writes.length, 0);
});

test('a retention audit append failure reports safe fallback evidence and allows a later log retry', async t => {
  const s = await stack(t);
  s.records.set('A00001', job('A00001'));
  s.scopeRows.fs_chats.push({ job_id: 'A99999', data: { title: 'Retained private payload' } });
  await s.auditBlocked(true);
  const response = await s.internal('/__formula/visible-chat-snapshot');
  assert.equal(response.status, 200, 'audit storage failure does not change authorized history availability');
  assert.deepEqual(await response.json(), { chats: [], messages: [] });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.match(s.proxyErrors(), /history-retained-out-of-scope/);
  assert.match(s.proxyErrors(), /EISDIR/);
  for (const text of ['A99999', 'Retained private payload', 'Synthetic Sales']) assert.ok(!s.proxyErrors().includes(text));
  await s.auditBlocked(false);
  assert.equal((await s.internal('/__formula/visible-chat-snapshot')).status, 200);
  assert.equal((await s.audit()).filter(line => line.decision === 'history-retained-out-of-scope').length, 1, 'failed appends must not consume the successful-audit cooldown');
});

test('malformed and duplicate children fail closed even when their current parent is absent', async t => {
  const s = await stack(t);
  s.records.set('A00001', job('A00001'));
  for (const [table, rows] of [
    ['fs_chats', [{ job_id: 'bad', data: {} }]],
    ['fs_messages', [{ job_id: 'A99999', data: {} }]],
    ['fs_messages', [{ uid: 'bad-parent', job_id: 'bad', data: {} }]],
    ['fs_chats', [{ job_id: 'A99999', data: {} }, { job_id: 'A99999', data: {} }]],
    ['fs_messages', [{ uid: 'duplicate', job_id: 'A99999', data: {} }, { uid: 'duplicate', job_id: 'A99999', data: {} }]],
  ]) {
    s.scopeRows[table] = rows;
    const response = await s.internal('/__formula/visible-chat-snapshot', { role: 'admin' });
    assert.equal(response.status, 503, `${table} invalid identity or duplicate must fail closed`);
    s.scopeRows[table] = [];
  }
  assert.equal((await s.audit()).filter(line => line.decision === 'history-retained-out-of-scope').length, 0);
  assert.equal(s.writes.length, 0);
});

for (const fault of ['child-read-failure', 'child-recheck-failure', 'partial-pagination', 'owner-change-on-recheck', 'owner-change-during-child-recheck', 'child-change-on-recheck']) test(`retained history does not mask ${fault} or record a successful snapshot`, async t => {
  const s = await stack(t);
  s.records.set('A00001', job('A00001'));
  s.scopeRows.fs_chats.push({ job_id: 'A00001', data: { title: 'Visible room' } }, { job_id: 'A99999', data: { title: 'Retained room' } });
  s.scopeFault(fault);
  const response = await s.internal('/__formula/visible-chat-snapshot');
  assert.equal(response.status, 503);
  assert.deepEqual(Object.keys(await response.json()).sort(), ['hint', 'message']);
  assert.equal((await s.audit()).filter(line => line.decision === 'history-retained-out-of-scope').length, 0);
  assert.equal(s.writes.length, 0);
});

test('a retained child mutation remains subject to the complete raw child re-scan', async t => {
  const s = await stack(t);
  s.records.set('A00001', job('A00001'));
  s.scopeRows.fs_chats.push({ job_id: 'A99999', data: { title: 'Retained room' } });
  s.scopeFault('child-change-on-recheck');
  assert.equal((await s.internal('/__formula/visible-chat-snapshot')).status, 503);
  assert.equal((await s.audit()).filter(line => line.decision === 'history-retained-out-of-scope').length, 0);
});

for (const change of ['revoked', 'role', 'identity']) test(`an IAM session with ${change} change cannot return or audit retained history as successful`, async t => {
  const profile = { name: 'Synthetic Admin', data: { name: 'Synthetic Admin', email: 'admin@example.test' } };
  const s = await stack(t, { users: [profile], iamIntrospection: count => ({
    active: count === 1 || change !== 'revoked', status: 'ACTIVE', audience: 'FORMULA',
    central_user_id: count > 1 && change === 'identity' ? 'replacement-user' : 'synthetic-central-user',
    email: 'admin@example.test', expires_at: new Date(Date.now() + 60_000).toISOString(), grant_version: '1',
    app_role: count > 1 && change === 'role' ? 'FORMULA_RD' : 'FORMULA_ADMIN', legacy_user_id: 'Synthetic Admin',
  }) });
  s.records.set('A00001', job('A00001'));
  s.scopeRows.fs_chats.push({ job_id: 'A99999', data: { title: 'Retained room' } });
  assert.equal((await s.internal('/__formula/visible-chat-snapshot')).status, 401);
  assert.equal((await s.audit()).filter(line => line.decision === 'history-retained-out-of-scope').length, 0);
  assert.equal(s.writes.length, 0);
});

test('an actually empty central dataset accepts PostgREST zero-row pagination', async t => {
  const s = await stack(t);
  const response = await s.internal('/__formula/visible-chat-snapshot');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { chats: [], messages: [] });
});

test('visible parents with no chats or messages accept PostgREST zero-row pagination', async t => {
  const s = await stack(t);
  s.records.set('A00001', job('A00001'));
  for (const table of ['fs_chats', 'fs_messages']) {
    const response = await s.call(`${table}?select=*`, undefined, { method: 'GET', range: '0-999' });
    assert.equal(response.status, 200, `${table} returns an empty page for a valid visible parent`);
    assert.deepEqual(await response.json(), []);
    assert.equal(response.headers.get('content-range'), 'items 0-0/0');
  }
});

test('a session expiring during parent lookup prevents returning the earlier session result', async t => {
  const s = await stack(t, { coreDelayMs: 1_200 });
  s.records.set('A00001', job('A00001'));
  s.scopeRows.fs_chats.push({ job_id: 'A99999', data: { title: 'Retained room' } });
  const response = await s.internal('/__formula/visible-chat-snapshot', { expiresIn: 500 });
  assert.equal(response.status, 401);
  assert.ok(s.scopedReadHeaders.some(entry => entry.table === '/fs_records'), 'the session must have passed initial authorization before expiring during the read');
  assert.equal((await s.audit()).filter(line => line.decision === 'history-retained-out-of-scope').length, 0);
});

test('an owner change detected between parent and child reads fails closed', async t => {
  const s = await stack(t);
  s.records.set('A00001', job('A00001'));
  s.scopeRows.fs_chats.push({ job_id: 'A00001', data: { title: 'Owned room' } });
  s.scopeFault('owner-change-on-recheck');
  const response = await s.internal('/__formula/visible-chat-snapshot');
  assert.equal(response.status, 503);
  assert.match((await response.json()).message, /เปลี่ยนระหว่างอ่าน/);
});

test('an owner transfer during the child re-scan is caught by the final parent read', async t => {
  const s = await stack(t);
  s.records.set('A00001', job('A00001'));
  s.scopeRows.fs_chats.push({ job_id: 'A00001', data: { title: 'Owned room' } });
  s.scopeFault('owner-change-during-child-recheck');
  const response = await s.internal('/__formula/visible-chat-snapshot');
  assert.equal(response.status, 503);
  assert.match((await response.json()).message, /เปลี่ยนระหว่างอ่าน/);
});

test('a parent update between stable pagination pages is detected before returning a child snapshot', async t => {
  const s = await stack(t);
  for (let number = 1; number <= 1001; number++) {
    const id = `A${String(number).padStart(5, '0')}`;
    s.records.set(id, job(id));
  }
  s.scopeRows.fs_chats.push({ job_id: 'A00001', data: { title: 'Owned room' } });
  s.scopeFault('parent-page-drift');
  const response = await s.internal('/__formula/visible-chat-snapshot');
  assert.equal(response.status, 503);
  assert.match((await response.json()).message, /เปลี่ยนระหว่างอ่าน/);
});

test('a child row mutation between complete reads is not returned as a stable snapshot', async t => {
  const s = await stack(t);
  s.records.set('A00001', job('A00001'));
  s.scopeRows.fs_chats.push({ job_id: 'A00001', data: { title: 'Original room' } });
  s.scopeFault('child-change-on-recheck');
  const response = await s.internal('/__formula/visible-chat-snapshot');
  assert.equal(response.status, 503);
  assert.match((await response.json()).message, /เปลี่ยนระหว่างอ่าน/);
});

test('a message mutation between stable child pagination pages is detected before returning a snapshot', async t => {
  const s = await stack(t);
  s.records.set('A00001', job('A00001'));
  for (let number = 0; number < 1001; number++) {
    s.scopeRows.fs_messages.push({ uid: `m${String(number).padStart(4, '0')}`, job_id: 'A00001', data: { text: `message ${number}` } });
  }
  s.scopeFault('child-page-drift');
  const response = await s.internal('/__formula/visible-chat-snapshot');
  assert.equal(response.status, 503);
  assert.match((await response.json()).message, /เปลี่ยนระหว่างอ่าน/);
});

test('incomplete pages, duplicate parents and malformed rows fail closed', async t => {
  const s = await stack(t);
  s.records.set('A00001', job('A00001'));
  for (const fault of ['malformed-pagination', 'partial-pagination', 'malformed-record', 'duplicate-record', 'conflicting-parent']) {
    s.scopeFault(fault);
    const response = await s.internal('/__formula/visible-chat-snapshot');
    assert.equal(response.status, 503, `${fault} must not return a partial authorized snapshot`);
    assert.match((await response.json()).message, /ไม่ครบพอ|คลุมเครือ/);
  }
});

test('unknown roles and anonymous users cannot use scoped snapshot or generic reads', async t => {
  const s = await stack(t);
  const anonymous = await s.call('fs_records?select=*', undefined, { method: 'GET', anonymous: true });
  assert.equal(anonymous.status, 401);
  const unknown = await s.call('fs_records?select=*', undefined, { method: 'GET', role: 'auditor' });
  assert.equal(unknown.status, 403);
  const snapshot = await s.internal('/__formula/visible-chat-snapshot', { role: 'auditor' });
  assert.equal(snapshot.status, 403);

});
test('a legacy job adopts the verified owner email on its first non-admin edit and every blocked save is audited', async t => {
  const s = await stack(t, { intake: true });
  const legacy = { ...job('A00301', 'Legacy customer'), createdBy: 'Synthetic Sales' };
  s.records.set(legacy.id, legacy);
  const session = { role: 'sales', email: 'sales@example.test' };
  await t.test('the first edit after the owner-email release is saved, not rejected as an ownership change', async () => {
    const edited = { ...legacy, notes: 'edited after release', ownerEmail: 'sales@example.test' };
    const result = await (await s.call('rpc/fs_save_record', { p_id: legacy.id, p_data: edited, p_expected: legacy }, session)).json();
    assert.equal(result.status, 'saved');
    assert.deepEqual(s.records.get(legacy.id), edited);
  });
  await t.test('a pd editor with the edit grant may change another owner\'s legacy job as long as it does not claim it', async () => {
    s.edit(true);
    await new Promise(resolve => setTimeout(resolve, 3));
    const pd = { role: 'pd', name: 'Synthetic PD', email: 'pd@example.test' };
    // An old client that stamps the editor's email is refused as an ownership change…
    const claimedJob = { ...job('A00305', 'Sales customer'), createdBy: 'Synthetic Sales', salesOwner: '15.Sales Synthetic Sales', rows: [{ name: 'A', w: 1 }] };
    s.records.set(claimedJob.id, claimedJob);
    // (the upstream stub compares rows by shape only, so the edit adds a row rather than changing a weight)
    const claimed = { ...claimedJob, rows: [{ name: 'A', w: 1 }, { name: 'B', w: 2 }], ownerEmail: 'pd@example.test' };
    assert.equal((await (await s.call('rpc/fs_save_record', { p_id: claimedJob.id, p_data: claimed, p_expected: claimedJob }, pd)).json()).status, 'forbidden');
    assert.deepEqual(s.records.get(claimedJob.id), claimedJob);
    // …while the same edit that leaves the owner alone is accepted (separate job: the intake holds one payload per job).
    const theirs = { ...job('A00307', 'Sales customer'), createdBy: 'Synthetic Sales', salesOwner: '15.Sales Synthetic Sales', rows: [{ name: 'A', w: 1 }] };
    s.records.set(theirs.id, theirs);
    const edited = { ...theirs, rows: [{ name: 'A', w: 1 }, { name: 'B', w: 2 }] };
    const result = await (await s.call('rpc/fs_save_record', { p_id: theirs.id, p_data: edited, p_expected: theirs }, pd)).json();
    assert.equal(result.status, 'saved', 'the same edit without the claim is accepted');
    assert.deepEqual(s.records.get(theirs.id), edited);
    s.edit(false);
    await new Promise(resolve => setTimeout(resolve, 3));
  });
  await t.test('a re-sent Activity that the append-only trigger skipped is answered with the stored row, so the journal can acknowledge', async () => {
    const activity = { uid: 'dedup-activity-1', ts: 777, data: { uid: 'dedup-activity-1', ts: 777, cat: 'formula', action: 'แก้สูตรในห้องแชท', detail: 'synthetic', job: legacy.id } };
    const first = await s.call('fs_activities', [activity], { ...session, representation: true });
    assert.equal(first.status, 201);
    const stamped = (await first.json())[0];
    assert.equal(stamped.data.user, 'Synthetic Sales');
    const again = await s.call('fs_activities', [activity], { ...session, representation: true });
    assert.equal(again.status, 200, 'the duplicate still answers success (rule 3.3)');
    const rows = await again.json();
    assert.equal(rows.length, 1, 'the stored row is returned instead of an empty representation');
    assert.deepEqual(rows[0], stamped, 'the stored row is returned unchanged (first writer wins)');
    const dedup = (await s.audit()).filter(line => line.decision === 'activity-dedup');
    assert.deepEqual([dedup.length, dedup[0].rows, dedup[0].by], [1, 1, 'Synthetic Sales']);
    const other = await s.call('fs_activities', [{ ...activity, uid: 'dedup-activity-2', data: { ...activity.data, uid: 'dedup-activity-2' } }], { ...session, representation: true });
    assert.equal(other.status, 201);
    assert.equal((await other.json()).length, 1, 'a fresh uid is unaffected');
  });
  await t.test('adopting a different email, or replacing an existing owner email, remains an ownership change', async () => {
    const current = structuredClone(s.records.get(legacy.id));
    const foreign = { ...legacy, id: 'A00302', customer: 'Foreign adoption' };
    s.records.set(foreign.id, foreign);
    const stolen = { ...foreign, ownerEmail: 'someone-else@example.test' };
    assert.equal((await (await s.call('rpc/fs_save_record', { p_id: foreign.id, p_data: stolen, p_expected: foreign }, session)).json()).status, 'forbidden');
    assert.deepEqual(s.records.get(foreign.id), foreign);
    const replaced = { ...current, ownerEmail: 'another@example.test' };
    assert.equal((await (await s.call('rpc/fs_save_record', { p_id: current.id, p_data: replaced, p_expected: current }, session)).json()).status, 'forbidden');
    assert.deepEqual(s.records.get(current.id), current);
  });
  await t.test('a save stopped before intake still leaves an audit line with the actor and reason', async () => {
    const data = job('A00303', 'Audit customer');
    const args = { p_id: data.id, p_data: data, p_expected: null };
    assert.equal((await (await s.call('rpc/fs_save_record', args, { role: 'ra', name: 'Synthetic RA' })).json()).status, 'forbidden');
    const lines = await s.audit();
    const blocked = lines.filter(line => line.decision === 'job-save-blocked' && line.key === data.id);
    assert.equal(blocked.length, 1, JSON.stringify(lines.slice(-5)));
    assert.equal(blocked[0].reason, 'FORMULA_ROLE_WRITE_DENIED');
    assert.equal(blocked[0].by, 'Synthetic RA');
    assert.equal(blocked[0].byRole, 'ra');
    assert.equal(blocked[0].status, 'forbidden');
  });
  await t.test('a save rejected inside intake is audited with its reason and actor', async () => {
    const data = job('A00304', 'Intake customer');
    const changed = { ...data, rows: [{ name: 'Synthetic ingredient', w: 1 }] };
    assert.equal((await (await s.call('rpc/fs_save_record', { p_id: data.id, p_data: data, p_expected: null })).json()).status, 'saved');
    assert.equal((await (await s.call('rpc/fs_save_record', { p_id: data.id, p_data: changed, p_expected: data })).json()).status, 'forbidden');
    const received = (await s.audit()).filter(line => line.decision === 'job-received' && line.key === data.id);
    assert.equal(received.length, 2);
    assert.equal(received[1].status, 'forbidden');
    assert.equal(received[1].by, 'Synthetic Sales');
    assert.equal(received[1].byRole, 'sales');
    assert.equal(received[1].reason, 'SYNTHETIC_DECISION', 'forbidden intake result must carry the IAM reason code');
    assert.equal(received[0].ingredientEdit, false, 'a create with no rows is not an ingredient edit');
    assert.deepEqual([received[0].rowsBefore, received[0].rowsAfter], [0, 0]);
    assert.ok(received[0].permission, 'an accepted save names the grant that let it through');
  });
  await t.test('an accepted ingredient edit leaves who/which job/that the formula changed in the log, never the rows', async () => {
    s.edit(true);
    await new Promise(resolve => setTimeout(resolve, 3));
    const data = { ...job('A00306', 'Ingredient customer'), createdBy: 'Synthetic OPC' };
    const changed = { ...data, rows: [{ name: 'Synthetic ingredient', w: 1 }, { name: 'Second', w: 2 }] };
    assert.equal((await (await s.call('rpc/fs_save_record', { p_id: data.id, p_data: data, p_expected: null }, { role: 'opc', name: 'Synthetic OPC' })).json()).status, 'saved');
    assert.equal((await (await s.call('rpc/fs_save_record', { p_id: data.id, p_data: changed, p_expected: data }, { role: 'opc', name: 'Synthetic OPC' })).json()).status, 'saved');
    const received = (await s.audit()).filter(line => line.decision === 'job-received' && line.key === data.id);
    assert.equal(received.length, 2);
    assert.deepEqual([received[1].status, received[1].ingredientEdit, received[1].rowsBefore, received[1].rowsAfter, received[1].by, received[1].byRole],
      ['saved', true, 0, 2, 'Synthetic OPC', 'opc']);
    assert.equal(received[1].permission, 'SYNTHETIC_DECISION');
    assert.ok(!JSON.stringify(received).includes('Synthetic ingredient'), 'ingredient names must never reach the gateway log');
    s.edit(false);
  });
  const priorJobStack = s;
  await t.test('the browser can report its first blocking gate; the report is audited, bounded and never a write', async t => {
    const s = await stack(t);
    const post = (body, options = {}) => {
      const value = Buffer.from(JSON.stringify({ name: 'Synthetic Sales', role: 'sales', email: '', centralUserId: 'synthetic-central-user', exp: Date.now() + 60_000 })).toString('base64url');
      const signed = `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`;
      return fetch(`http://127.0.0.1:${s.port}/__formula/client-diagnostic`, {
        method: options.method || 'POST', headers: { 'content-type': 'application/json', ...(options.anonymous ? {} : { cookie: `fs_session=${signed}` }) },
        ...(options.method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      });
    };
    assert.equal((await post({ job: 'A00305', stage: 'gate:openChatRoom', reason: 'local-differs' }, { anonymous: true })).status, 401);
    assert.equal((await post({ job: 'A00305', stage: 'gate:openChatRoom', reason: 'local-differs' }, { method: 'GET' })).status, 405);
    assert.equal((await post('not json')).status, 400);
    assert.equal((await post({ job: 'drop table', stage: 'x', reason: 'y' })).status, 400);
    assert.equal((await post({ stage: 'x' })).status, 400);
    const writes = s.writes.length;
    // Reproduce a checker read from the preceding job fixture while the
    // diagnostic counter is being measured. It must not contaminate that counter.
    const checkerRead = await fetch(`${priorJobStack.upstreamOrigin}/rpc/fs_job_integrity_snapshot`, { method: 'POST', headers: {'content-type':'application/json'}, body: '{}' });
    await checkerRead.arrayBuffer();
    assert.equal((await post({ job: 'A00305', stage: 'gate:openChatRoom', reason: 'local-differs', detail: 'queued:forbidden' })).status, 204);
    assert.equal((await post({ job: '', stage: 'flush-gate', reason: 'cannot-edit' })).status, 204);
    assert.equal(s.writes.length, writes, `a diagnostic report must never reach the database; unexpected requests: ${JSON.stringify(s.writes.slice(writes).map(({path,method}) => ({path,method})))}`);
    const lines = (await s.audit()).filter(line => line.decision === 'client-blocked');
    assert.equal(lines.length, 2);
    assert.deepEqual([lines[0].key, lines[0].stage, lines[0].reason, lines[0].detail, lines[0].by, lines[0].byRole],
      ['A00305', 'gate:openChatRoom', 'local-differs', 'queued:forbidden', 'Synthetic Sales', 'sales']);
    assert.equal(lines[1].key, '');
    for (let i = 0; i < 60; i++) assert.equal((await post({ job: '', stage: 'flood', reason: String(i) })).status, 204);
    const flood = (await s.audit()).filter(line => line.decision === 'client-blocked' && line.stage === 'flood');
    assert.ok(flood.length <= 40 && flood.length >= 30, `rate limit must bound the log (${flood.length})`);
  });
});

test('real HTTP gateway enforces actor, CAS, legacy protocol, and saved-parent prerequisites', async t => {
  const s = await stack(t);
  const data = job();
  const args = { p_id: data.id, p_data: data, p_expected: null };
  await t.test('unauthenticated, malformed and wrong-method requests never reach the save RPC', async () => {
    assert.equal((await s.call('rpc/fs_save_record', args, { anonymous: true })).status, 401);
    assert.equal((await s.call('rpc/fs_save_record', undefined, { method: 'GET' })).status, 405);
    assert.equal((await (await s.call('rpc/fs_save_record', { ...args, extra: 'smuggled' })).json()).status, 'invalid');
    assert.equal((await (await s.call('rpc/fs_save_record', [args])).json()).status, 'invalid');
    assert.equal(s.writes.length, 0);
  });
  await t.test('the direct session gate and server-stamped Activity representation match fallback replay contracts', async () => {
    const session = await s.session();
    assert.equal(session.status,200);
    const identity=await session.json();
    assert.equal(identity.name,'Synthetic Sales');assert.equal(identity.role,'sales');
    assert.equal(identity.centralUserId,'synthetic-central-user');assert.equal(identity.authenticated,true);
    const wrong = await fetch(`http://127.0.0.1:${s.port}/sb/rest/v1/sb/session`);
    assert.notEqual(wrong.status,200,'the session route must never be sent through the PostgREST prefix');
    const activity={uid:'fallback-activity-1',ts:123,data:{uid:'fallback-activity-1',ts:123,cat:'job',action:'สร้างชุดข้อมูลใหม่',detail:'synthetic',job:data.id}};
    const response=await s.call('fs_activities',[activity],{representation:true});
    assert.equal(response.status,201);
    assert.deepEqual(await response.json(),[{...activity,data:{...activity.data,user:'Synthetic Sales',role:'sales'}}]);
  });
  await t.test('unsupported role cannot invoke the new RPC through the allowlist', async () => {
    const count=s.writes.length;
    const result = await (await s.call('rpc/fs_save_record', args, { role: 'ra' })).json();
    assert.equal(result.status, 'forbidden');
    assert.equal(s.writes.length, count);
  });
  await t.test('ordinary Sales save persists and retry is acknowledged without overwriting', async () => {
    const first = await (await s.call('rpc/fs_save_record', args)).json();
    assert.deepEqual(first, { status: 'saved', id: data.id, data });
    assert.deepEqual(await (await s.call('rpc/fs_save_record', args)).json(), first);
  });
  await t.test('equivalent ingredient rows with reordered keys remain a normal Sales save', async () => {
    const initial = { ...data, id: 'A00002', rows: [{ ingredient: 'old', weight: 1 }], notes: 'before' };
    assert.equal((await (await s.call('rpc/fs_save_record', { p_id: initial.id, p_data: initial, p_expected: null })).json()).status, 'saved');
    const reordered = { ...initial, notes: 'after', rows: [{ weight: 1, ingredient: 'old' }] };
    const result = await (await s.call('rpc/fs_save_record', { p_id: reordered.id, p_data: reordered, p_expected: initial })).json();
    assert.equal(result.status, 'saved');
    assert.deepEqual(s.records.get(reordered.id), reordered);
  });
  await t.test('ingredient changes still require the sensitive IAM grant', async () => {
    const changed = { ...data, rows: [{ name: 'Synthetic ingredient', w: 1 }] };
    const result = await (await s.call('rpc/fs_save_record', { ...args, p_data: changed, p_expected: data })).json();
    assert.equal(result.status, 'forbidden');
    assert.deepEqual(s.records.get(data.id), data);
    assert.ok(s.permissions.includes('FORMULA_EDIT'));
    s.edit(true);
    await new Promise(resolve => setTimeout(resolve, 3));
    assert.equal((await (await s.call('rpc/fs_save_record', { ...args, p_data: changed, p_expected: data })).json()).status, 'saved');
  });
  await t.test('caller baseline cannot hide an ingredient change from the sensitive grant check', async () => {
    s.edit(false);
    await new Promise(resolve => setTimeout(resolve, 3));
    const current = structuredClone(s.records.get(data.id));
    const differentBaseline = { ...current, rows: [{ name: 'Concurrent ingredient' }] };
    const count = s.writes.length;
    const result = await (await s.call('rpc/fs_save_record', { ...args, p_data: current, p_expected: differentBaseline })).json();
    assert.equal(result.status, 'forbidden');
    assert.equal(s.writes.length, count, 'must be stopped before the CAS can acquire a newer row');
    s.edit(true);
  });
  await t.test('stale baseline is a conflict; a subsequent legacy blind upsert is rejected', async () => {
    const wanted = { ...data, customer: 'Stale update' };
    assert.deepEqual(await (await s.call('rpc/fs_save_record', { ...args, p_data: wanted, p_expected: data })).json(), { status: 'conflict', id: data.id });
    const before = structuredClone(s.records.get(data.id));
    const legacy = await s.call('fs_records', [{ id: data.id, data: wanted }]);
    assert.equal(legacy.status, 405);
    assert.equal(legacy.headers.get('x-fs-client-reload-required'), 'job-sync-v1');
    assert.deepEqual(s.records.get(data.id), before);
    assert.ok(!s.writes.some(write => write.path === '/fs_records'));
  });
  await t.test('the formula editor is shown to any account IAM granted FORMULA_EDIT, and the role table still rules otherwise', async () => {
    const page = await (await fetch(`http://127.0.0.1:${s.port}/`)).text();
    const capability = page.match(/function can\(cap\)\{[\s\S]*?\n\}/)?.[0];
    assert.ok(capability && /canFormulaEdit===true/.test(capability), 'served can() must consult the session FORMULA_EDIT decision');
    const run = (role, identity, cap) => {
      const context = { ROLES: { sales: { can: { createData: 1, ownOnly: 1 } }, pd: { can: { editFormula: 1 } } }, currentRole: () => role, window: { __fsSessionIdentity: identity } };
      vm.runInNewContext(`${capability};`, context);
      return vm.runInNewContext(`can('${cap}')`, context);
    };
    assert.equal(run('sales', { email: 'x', canFormulaEdit: true }, 'editFormula'), true, 'a granted Sales account sees the editor');
    assert.equal(run('sales', { email: 'x', canFormulaEdit: false }, 'editFormula'), false, 'an ungranted Sales account does not');
    assert.equal(run('sales', { email: 'x' }, 'editFormula'), false, 'no decision yet means hidden');
    assert.equal(run('sales', { email: 'x', canFormulaEdit: 'true' }, 'editFormula'), false, 'only a real boolean counts');
    assert.equal(run('pd', { email: 'x', canFormulaEdit: false }, 'editFormula'), true, 'the role table still grants PD');
    assert.equal(run('sales', { email: 'x', canFormulaEdit: true }, 'manageUsers'), false, 'other capabilities are untouched');
    assert.equal(run('sales', { email: 'x', canFormulaEdit: true }, 'ownOnly'), true);
  });
  await t.test('orphan chats/messages/approvals are filtered; returned rows identify only actual writes', async () => {
    for (const table of ['fs_chats', 'fs_messages', 'fs_approvals']) {
      const valid = table==='fs_messages' ? {uid:'synthetic-saved-child',job_id:data.id,ts:1,data:{}}
        : table==='fs_approvals' ? {job_id:data.id,part:'pd',data:{}} : {job_id:data.id,data:{}};
      const missing = {...valid,job_id:'A00099',...(table==='fs_messages'?{uid:'synthetic-missing-parent-child'}:{})};
      const response = await s.call(table, [valid, missing], { representation: true, role: 'admin' });
      assert.equal(response.headers.get('x-fs-job-write-rejected'), '1', `${table} status ${response.status}`);
      const returned = await response.json();
      assert.equal(returned.length,1,'only the valid-parent child is acknowledged');
      assert.ok(Number.isFinite(Date.parse(returned[0].updated_at)),'durable child has a generated server timestamp');
      const {updated_at,...saved} = returned[0];
      assert.deepEqual([saved], [valid]);
      const empty = await s.call(table, [missing], { representation: true, role: 'admin' });
      assert.deepEqual(await empty.json(), []);
      assert.equal((await s.call(table, [missing], { role: 'admin' })).status, 204);
    }
  });
  await t.test('database read failure cannot be mistaken for a confirmed parent or save', async () => {
    s.database(false);
    assert.equal((await (await s.call('rpc/fs_save_record', args)).json()).status, 'retry');
    assert.equal((await s.call('fs_chats', [{ job_id: data.id, data: {} }], { representation: true })).status, 503);
    s.database(true);
  });
  await t.test('served HTML injects the versioned job bridge after session bridge; health publishes it', async () => {
    const html = await (await fetch(`http://127.0.0.1:${s.port}/`)).text();
    assert.ok(html.indexOf('/fs-job-sync.js?v=') > html.indexOf('/fs-session-bridge.js?v='));
    const create = html.match(/<button\b[^>]*\bid="btnCreate"[^>]*>/g);
    assert.equal(create?.length, 1);
    assert.match(create[0], /\sdisabled(?:\s|>)/);
    assert.match(create[0], /aria-disabled="true"/);
    assert.match(create[0], /aria-describedby="gen_err"/);
    assert.match(html, /<span id="gen_err"[^>]*data-fs-job-preparing="1"[^>]*>กำลังเตรียมระบบบันทึกใบงาน/);
    assert.match(html, /<div class="hdr-sub">ระบบจัดทำใบงานและประสานงาน<\/div>/);
    assert.match(html, /function canDeleteJob\(r\)\{[\s\S]*can\('manageUsers'\)[\s\S]*isJobOwner\(r\)/, 'owner delete capability must be present in the served page');
    assert.match(html, /function fsOwnerName\(v\)\{[\s\S]*function canSeeRecord\(r\)\{[\s\S]*salesOwner/, 'client visibility must use the normalized owner contract');
    const visibility = html.match(/function fsOwnerName\(v\)\{[\s\S]*?\n\}[\s\S]*?function canSeeRecord\(r\)\{[\s\S]*?\n\}/)?.[0];
    assert.ok(visibility, 'served page must expose the bounded owner visibility functions');
    const visibilityContext = { currentUser: 'แยม', window: { __fsSessionIdentity: { email: 'yam@example.test' } }, can: name => name === 'ownOnly' };
    vm.runInNewContext(`${visibility};`, visibilityContext);
    assert.equal(vm.runInNewContext("canSeeRecord({createdBy:'legacy-owner',salesOwner:'15.Sales แยม'})", visibilityContext), true,
      'a decorated salesOwner must remain visible to the matching owner');
    assert.equal(vm.runInNewContext("canSeeRecord({createdBy:'legacy-owner',salesOwner:'15.Sales มาย์'})", visibilityContext), false,
      'normalized ownership must not broaden visibility to another owner');
    assert.equal(vm.runInNewContext("canSeeRecord({createdBy:'legacy-owner',salesOwner:'15.Sales แยม2'})", visibilityContext), false,
      'a near-match owner name must remain hidden');
    assert.equal(vm.runInNewContext("canSeeRecord({createdBy:'แยม',ownerEmail:'yam@example.test',salesOwner:'15.Sales คนอื่น'})", visibilityContext), true,
      'a canonical owner email must grant the matching login even when display names are decorated differently');
    assert.equal(vm.runInNewContext("canSeeRecord({createdBy:'แยม',ownerEmail:'other@example.test',salesOwner:'15.Sales แยม'})", visibilityContext), false,
      'a canonical owner email must reject a same-name but different login');
    assert.match(html, /function doDeleteJob\(r, c, msgN\)\{[\s\S]*__fsBeforeDeleteJob\(id\)[\s\S]*logAct\('job','ลบ Job งาน'/, 'delete confirmation callback must recheck the pending-save gate before logging or deleting');
    assert.match(html, /data-fs-delete-job="1" data-fs-job-id="\$\{esc\(r\.id\)\}" aria-label="ลบงาน \$\{esc\(r\.id\)\}"/, 'delete controls must expose an accessible job identity');
    assert.match(html, /const type = t==='button' \? ' type="button"'/, 'dashboard delete controls must not act as implicit form submitters');
    assert.match(html, /class="rec-actions-head"[^>]*>การทำงาน<\/th>/, 'Customer Data must expose a sticky action column');
    assert.match(html, /class="rec-actions"[^>]*>[\s\S]*jobDelBtnHTML\(r\)/, 'Customer Data rows must keep the scoped delete action in the visible action column');
    assert.match(html, /data-fs-record-actions="1"/, 'Customer Data action-column UX patch must be present');
    const chipSource=html.match(/function sbChip\(\)\{[\s\S]*?\n\}/)?.[0];
    assert.ok(chipSource);
    const chip={};
    const context={document:{getElementById:()=>chip},sbOn:()=>true,sbErr:'synthetic-dev-error',sbBusy:false,sbReady:true,sbCanEdit:true,sbLastPush:0};
    vm.runInNewContext(`${chipSource}; sbChip();`,context);
    assert.match(chip.textContent,/เชื่อมต่อไม่สำเร็จ/);
    assert.doesNotMatch(chip.title,/synthetic-dev-error/,'technical error details stay out of the user tooltip');
    context.sbErr=''; vm.runInNewContext(`${chipSource}; sbChip();`,context);
    assert.match(chip.textContent,/เชื่อมต่อระบบกลางแล้ว/,'connection status cannot claim every pending job saved');
    const health = await (await fetch(`http://127.0.0.1:${s.port}/__formula/health`)).json();
    assert.equal(health.jobSync, 'loaded');
    assert.equal(health.jobSyncCompatible, true);
    assert.ok(health.assets['/fs-job-sync.js']);
    assert.ok(health.buildStamp, 'fixture must carry actual sealed build identity');
    assert.ok(html.includes(`<meta name="fs-build" content="${health.buildStamp}">`), 'deployment identity is retained as non-visible metadata');
    assert.ok(html.includes(health.buildStamp), 'existing immutable-release deployment gate remains intact');
    assert.equal(html.includes('fsJobRecoveryPanel'),false,'the sealed release must not be modified to add recovery UI');
    const runtimeAsset=await (await fetch(`http://127.0.0.1:${s.port}/fs-job-sync.js`)).text();
    assert.match(runtimeAsset,/function paintRecoveryPanel\(state\)/,'the recovery UI must be served as the injected runtime asset');
    assert.doesNotMatch(runtimeAsset.match(/function paintRecoveryPanel[\s\S]*?function paint\(\)/)?.[0] || '',/\.innerHTML/,'recovery UI must not render user-derived data with innerHTML');
    const ingredientRepair = '<script data-fs-ingredient-input-repair="1">';
    assert.equal(html.split(ingredientRepair).length, 2, 'the sealed page receives exactly one ingredient input repair');
    assert.ok(html.indexOf(ingredientRepair) < html.indexOf('<script data-fs-job-sync-bootstrap="1">'),
      'the ingredient repair must install before the job bridge bootstrap');
  });
  await t.test('served allocator gates all creation paths and never falls back to locally invented IDs', async () => {
    const html = await (await fetch(`http://127.0.0.1:${s.port}/`)).text();
    const allocator = html.match(/function nextRecordId\(\)\{[\s\S]*?\n\}/)?.[0];
    assert.ok(allocator, 'execute the actual served allocator');
    const run = ({ready=true, writable=true, seq=true, pool=[]}={}) => {
      const context = {window:{__fsJobSync:{ready,canCreate:()=>writable},alert(){}},document:{getElementById:()=>null},sbCap:{seq},sbIdPool:pool.slice(),recCounter:10,records:[],topups:0,saves:0};
      vm.createContext(context);
      vm.runInContext(`${allocator}\nfunction sbOn(){return true;} function sbTopUpIdPool(){topups++;} function saveRecordsStore(){saves++;} function recIdFromSeq(n){return 'A'+String(n).padStart(5,'0');}`,context);
      return {context, allocate:()=>vm.runInContext('nextRecordId()',context)};
    };
    for(const state of [{ready:false,pool:[17]},{writable:false,pool:[17]},{seq:false},{pool:[]}]) {
      const result=run(state);
      assert.throws(result.allocate,/ระบบ|บันทึก|เลขใบงาน/);
      assert.equal(result.context.recCounter,10,'blocked creation cannot advance a local counter');
      assert.equal(result.context.saves,0,'blocked creation cannot save a new record/counter');
    }
    const allowed=run({pool:[17]});
    assert.equal(allowed.allocate(),'A00017');
    assert.equal(allowed.context.recCounter,17);
    assert.equal(allowed.context.saves,1);
    assert.equal(allowed.context.topups,1);
  });
});

test('approval DELETE parses only job-scoped filters and cannot block the following record delete', async t => {
  await t.test('admin can delete approvals in bulk only when the request scopes jobs', async () => {
    const s=await stack(t,{iamAllow:permission=>permission==='FORMULA_EDIT'});
    const approval=await s.call('fs_approvals?job_id=in.%28%22A00001%22%2C%22A00002%22%29',undefined,{method:'DELETE',role:'admin'});
    assert.equal(approval.status,204,'admin bulk cleanup must reach the upstream approval delete');
    assert.deepEqual([...new Set(s.permissions)],['FORMULA_EDIT'],'bulk approval cleanup uses the administrator delete grant');
    assert.deepEqual(s.writes.map(write=>write.path),['/fs_approvals']);

    const records=await s.call('fs_records?id=eq.A00001',undefined,{method:'DELETE',role:'admin'});
    assert.equal(records.status,204,'the record deletion after approval cleanup must reach upstream');
    assert.deepEqual(s.writes.map(write=>write.path),['/fs_approvals','/fs_records']);
  });

  await t.test('a non-admin can delete only the approval part assigned to that role', async () => {
    const s=await stack(t,{iamAllow:permission=>permission==='FORMULA_APPROVE_PD'});
    const own=await s.call('fs_approvals?job_id=eq.A00001&part=eq.pd',undefined,{method:'DELETE',role:'pd'});
    assert.equal(own.status,204,'PD must be able to withdraw only its PD approval');
    assert.deepEqual([...new Set(s.permissions)],['FORMULA_APPROVE_PD']);
    const writes=s.writes.length;
    const other=await s.call('fs_approvals?job_id=eq.A00001&part=eq.ra',undefined,{method:'DELETE',role:'pd'});
    assert.equal(other.status,403,'PD must not withdraw another role’s approval');
    assert.equal(s.writes.length,writes,'a denied approval delete must never reach upstream');
    const unscoped=await s.call('fs_approvals?job_id=eq.A00001',undefined,{method:'DELETE',role:'pd'});
    assert.equal(unscoped.status,403,'a non-admin must name its own approval part');
    assert.deepEqual([...new Set(s.permissions)],['FORMULA_APPROVE_PD'],'denied scope changes must not probe another permission');
  });

  await t.test('the server permits an owner to delete its job and rejects another owner', async () => {
    let allowView = true;
    const s=await stack(t,{iamAllow:permission=>allowView && permission==='FORMULA_VIEW'});
    s.records.set('A00001', job('A00001', 'Owned by current user'));
    const ownedApproval=await s.call('fs_approvals?job_id=eq.A00001',undefined,{method:'DELETE',role:'sales'});
    assert.equal(ownedApproval.status,204,'the owner cleanup must be allowed without an admin grant');
    const ownedRecord=await s.call('fs_records?id=eq.A00001',undefined,{method:'DELETE',role:'sales'});
    assert.equal(ownedRecord.status,204,'the owner record delete must reach upstream');
    allowView = false;
    await new Promise(resolve => setTimeout(resolve, 3));
    const ownedChat=await s.call('fs_chats?job_id=eq.A00001',undefined,{method:'DELETE',role:'sales'});
    assert.equal(ownedChat.status,403,'a follow-up child delete must recheck current Formula view permission');
    allowView = true;
    const retryChat=await s.call('fs_chats?job_id=eq.A00001',undefined,{method:'DELETE',role:'sales'});
    assert.equal(retryChat.status,204,'the owner follow-up child delete must be acknowledged after the parent reservation');
    const foreignChat=await s.call('fs_chats?job_id=eq.A00002',undefined,{method:'DELETE',role:'sales'});
    assert.equal(foreignChat.status,403,'an owner reservation must not become an arbitrary child-delete capability');

    s.records.set('A00002', {...job('A00002','Other owner'),createdBy:'Someone else'});
    const foreign=await s.call('fs_records?id=eq.A00002',undefined,{method:'DELETE',role:'sales'});
    assert.equal(foreign.status,403,'a non-owner must not delete another user\'s job');
    assert.equal(s.writes.filter(write=>write.path==='/fs_records').length,1,'the denied owner delete must not reach upstream');

    s.records.set('A00003', {...job('A00003','Sales owner'),createdBy:'Someone else',salesOwner:'Sales Synthetic Sales'});
    const namedOwner=await s.call('fs_records?id=eq.A00003',undefined,{method:'DELETE',role:'sales'});
    assert.equal(namedOwner.status,204,'the normalized Sales owner must be allowed to delete');

    s.records.set('A00004', job('A00004','MKT owner'));
    const mktApproval=await s.call('fs_approvals?job_id=eq.A00004',undefined,{method:'DELETE',role:'mkt'});
    assert.equal(mktApproval.status,204,'an owner role without an approval part may still clean up its own job');
  });

  await t.test('canonical owner email separates duplicate display names at the data gate', async () => {
    const s=await stack(t,{iamAllow:permission=>permission==='FORMULA_VIEW'});
    const canonical={...job('A00007','Duplicate display name'),createdBy:'Synthetic Sales',salesOwner:'Sales Synthetic Sales',ownerEmail:'first@example.test'};
    s.records.set(canonical.id, canonical);
    const sameNameOtherLogin=await s.call('fs_records?id=eq.A00007',undefined,{method:'DELETE',role:'sales',name:'Synthetic Sales',email:'second@example.test'});
    assert.equal(sameNameOtherLogin.status,403,'a duplicate display name with another email must be denied');
    const owner=await s.call('fs_records?id=eq.A00007',undefined,{method:'DELETE',role:'sales',name:'Synthetic Sales',email:'first@example.test'});
    assert.equal(owner.status,204,'the canonical email owner must be allowed');
  });

  await t.test('a non-admin cannot rewrite ownership fields before deleting', async () => {
    const s=await stack(t,{iamAllow:permission=>permission==='FORMULA_VIEW'});
    const original=job('A00005','Protected owner');
    s.records.set(original.id, original);
    const tampered={...original,createdBy:'Someone else'};
    const result=await (await s.call('rpc/fs_save_record',{
      p_id: original.id, p_data: tampered, p_expected: original,
    },{role:'sales'})).json();
    assert.equal(result.status,'forbidden');
    assert.equal(result.reason,'FORMULA_OWNER_IMMUTABLE');
    assert.deepEqual(s.records.get(original.id),original);
    const deleteAttempt=await s.call('fs_records?id=eq.A00005',undefined,{method:'DELETE',role:'sales'});
    assert.equal(deleteAttempt.status,204,'the real owner remains able to delete after a blocked rewrite');
  });

  await t.test('archived owner evidence keeps a delayed child delete safe after reservation expiry', async () => {
    const s=await stack(t,{iamAllow:permission=>permission==='FORMULA_VIEW',ownerDeleteReservationTtlMs:20});
    s.records.set('A00006', job('A00006','Archived owner'));
    assert.equal((await s.call('fs_records?id=eq.A00006',undefined,{method:'DELETE',role:'sales'})).status,204);
    await new Promise(resolve=>setTimeout(resolve,35));
    const delayed = await s.call('fs_chats?job_id=eq.A00006',undefined,{method:'DELETE',role:'sales'});
    assert.equal(delayed.status,204,
      'the immutable archive owner check must survive an expired in-memory reservation');
  });

  await t.test('missing or malformed job filters fail closed before IAM or upstream', async () => {
    const s=await stack(t,{iamAllow:permission=>permission==='FORMULA_EDIT'});
    for (const path of [
      'fs_approvals?part=eq.pd',
      'fs_approvals?job_id=eq.not-a-job',
      'fs_approvals?job_id=in.(A00001,not-a-job)',
      'fs_approvals?job_id=in.(%22A00001,A00002)',
      'fs_approvals?job_id=in.(A00001,A00001)',
      'fs_approvals?job_id=gt.A00001',
      'fs_approvals?job_id=eq.A00001&part=eq.unknown',
    ]) {
      const response=await s.call(path,undefined,{method:'DELETE',role:'admin'});
      assert.equal(response.status,403,`unsafe approval delete must be denied: ${path}`);
    }
    assert.deepEqual(s.permissions,[],'an unsafe filter must be rejected before asking IAM');
    assert.deepEqual(s.writes,[],'an unsafe filter must never reach upstream');
  });
});

 test('unknown allocator semantics degrade the release instead of allowing invented IDs', async t => {
  const s = await stack(t, {transform: html => {
    assert.ok(html.includes('const seq = sbIdPool.shift();'));
    return html.replace('const seq = sbIdPool.shift();','const seq = ++recCounter;');
  }});
  const health = await (await fetch(`http://127.0.0.1:${s.port}/__formula/health`)).json();
  assert.equal(health.jobSyncCompatible, false);
  assert.equal(health.status, 'degraded');
});

test('unknown generator activity semantics degrade the release before it can claim job success', async t => {
  const s = await stack(t, {transform: html => {
    const legacy = "logAct('job', editing ? 'แก้ไขชุดข้อมูล' : 'สร้างชุดข้อมูลใหม่',";
    assert.ok(html.includes(legacy));
    return html.replace(legacy, "logAct('job', 'upstream activity changed',");
  }});
  const health = await (await fetch(`http://127.0.0.1:${s.port}/__formula/health`)).json();
  assert.equal(health.jobSyncCompatible, false);
  assert.equal(health.status, 'degraded');
});

test('generator persistence moved outside generateDash degrades the release even when a later function saves', async t => {
  const s = await stack(t, {transform: html => {
    const start=html.indexOf('function generateDash()');
    const end=html.indexOf('// ========== RENDER DASHBOARD',start);
    assert.ok(start>=0&&end>start);
    const generator=html.slice(start,end);
    assert.ok(generator.includes('saveRecordsStore();'));
    return html.slice(0,start)+generator.replace('saveRecordsStore();','saveRecordsStoreMoved();')+html.slice(end);
  }});
  const health = await (await fetch(`http://127.0.0.1:${s.port}/__formula/health`)).json();
  assert.equal(health.jobSyncCompatible, false);
  assert.equal(health.status, 'degraded');
});

test('unknown section-edit Activity semantics degrade the release before the section can claim success', async t => {
  const s = await stack(t, {transform: html => {
    const legacy = "logAct('job','แก้ไขชุดข้อมูล ('+s.title+')'";
    assert.ok(html.includes(legacy),'sealed section editor must retain its labelled Activity anchor');
    return html.replace(legacy, "logAct('job','upstream section activity changed'");
  }});
  const health = await (await fetch(`http://127.0.0.1:${s.port}/__formula/health`)).json();
  assert.equal(health.jobSyncCompatible, false);
  assert.equal(health.status, 'degraded');
});

test('section persistence moved outside saveJobSection degrades the release even when another function saves', async t => {
  const s = await stack(t, {transform: html => {
    const start=html.indexOf('function saveJobSection('), end=html.indexOf('\n}',start);
    assert.ok(start>=0&&end>start,'sealed section editor must remain bounded for the compatibility contract');
    const section=html.slice(start,end+2);
    assert.ok(section.includes('saveRecordsStore();'),'sealed section editor must retain its parent record save');
    return html.slice(0,start)+section.replace('saveRecordsStore();','saveRecordsStoreMoved();')+html.slice(end+2);
  }});
  const health = await (await fetch(`http://127.0.0.1:${s.port}/__formula/health`)).json();
  assert.equal(health.jobSyncCompatible, false);
  assert.equal(health.status, 'degraded');
});

test('a fresh proxy page without the job-sync asset fail-closes job, section, Tag and formula mutations before local changes or activity', async t => {
  const assetDir=await mkdtemp(join(tmpdir(),'formula-no-job-sync-asset-'));
  t.after(()=>rm(assetDir,{recursive:true,force:true}));
  // Keep the independently mounted session bridge. Only the job-sync mount is
  // absent, matching the real recreate/mount failure the inline bootstrap must
  // survive without falling back to legacy record writes.
  await copyFile(join(root,'runtime/assets/fs-session-bridge.js'),join(assetDir,'fs-session-bridge.js'));
  const s=await stack(t,{assetDir});
  const html=await (await fetch(`http://127.0.0.1:${s.port}/`)).text();
  assert.doesNotMatch(html,/\/fs-job-sync\.js\?v=/,'fixture must not serve a job-sync asset');
  const bootstrap=html.match(/<script data-fs-job-sync-bootstrap="1">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(bootstrap,'served page needs an inline fail-closed bootstrap independent of the missing asset');
  for(const action of ['generateDash','saveJobSection','toggleJobTag','chatSaveFormula','saveChatFormula','chatIngEdit','chatIngAdd','chatIngDel']) {
    assert.match(bootstrap,new RegExp(action),`bootstrap must guard ${action}`);
  }

  const context={console,records:[{id:'A03486',brand:'Original',tags:undefined,rows:[{name:'D-Ribose',w:100}]}],activities:[],writes:0,allocated:0,
    document:{getElementById:()=>null,querySelectorAll:()=>[]},alert(){},setTimeout(){},addEventListener(){}};
  vm.createContext(context);
  vm.runInContext(`
    var window=globalThis;
    function saveRecordsStore(){ writes++; }
    function logAct(cat,action,detail,job){ activities.push({cat,action,detail,job}); }
    let _editingRecordId='A03486';
    function nextRecordId(){ allocated++; return 'A09999'; }
    function generateDash(){
      const record=_editingRecordId
        ? records.find(r=>r.id===_editingRecordId)
        : {id:nextRecordId(),brand:'Created without durable bridge',rows:[]};
      if(!record)return null;
      if(!_editingRecordId)records.push(record);
      record.brand='Changed without durable bridge'; saveRecordsStore();
      logAct('job',_editingRecordId?'แก้ไขชุดข้อมูล':'สร้างชุดข้อมูลใหม่','Synthetic',record.id); return record;
    }
    function toggleJobTag(jobId,tagId){
      const record=records.find(r=>r.id===jobId); if(!record)return null;
      record.tags=(record.tags||[]).slice(); record.tags.push(tagId); saveRecordsStore();
      logAct('job','ติด Tag','Priority',jobId); return record;
    }
    function saveJobSection(jobId){
      const record=records.find(r=>r.id===jobId); if(!record)return null;
      record.productDetail='Changed without durable bridge'; saveRecordsStore();
      logAct('job','แก้ไขชุดข้อมูล (รายละเอียดสินค้า)','Synthetic',jobId); return record;
    }
    function chatSaveFormula(record){ const i=records.findIndex(r=>r.id===record.id); records[i]=record; saveRecordsStore(); }
    function chatIngEdit(jobId,index,field,value){
      const record=records.find(r=>r.id===jobId); if(!record)return null;
      record.rows[index][field]=Number(value); logAct('formula','แก้สูตรในห้องแชท','Synthetic',jobId);
      chatSaveFormula(record); return record;
    }
    function saveChatFormula(jobId){ return chatIngEdit(jobId,0,'w','50'); }
    function chatIngAdd(jobId){ return chatIngEdit(jobId,0,'w','101'); }
    function chatIngDel(jobId){ return chatIngEdit(jobId,0,'w','0'); }
    ${bootstrap}
    generateDash(); _editingRecordId=null; generateDash(); saveJobSection('A03486','product'); toggleJobTag('A03486','priority'); chatIngEdit('A03486',0,'w','50'); saveChatFormula('A03486');
  `,context);
  assert.equal(context.records[0].brand,'Original','missing bridge must block optimistic job edit');
  assert.equal(context.records.length,1,'missing bridge must block optimistic job create');
  assert.equal(context.allocated,0,'missing bridge must block server-ID allocation before create');
  assert.equal(context.records[0].productDetail,undefined,'missing bridge must block optimistic section edits');
  assert.equal(context.records[0].tags,undefined,'missing bridge must block optimistic Tag mutation');
  assert.equal(context.records[0].rows[0].w,100,'missing bridge must block optimistic formula mutation');
  assert.equal(context.activities.length,0,'missing bridge must block success activity');
  assert.equal(context.writes,0,'missing bridge must block local record persistence');
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('browser startup reads DevToolsActivePort when Chromium emits no stderr endpoint', async t => {
  const profile = await mkdtemp(join(tmpdir(), 'formula-job-sync-browser-port-'));
  t.after(() => rm(profile, { recursive: true, force: true }));
  await writeFile(join(profile, 'DevToolsActivePort'), '49200\n/devtools/browser/synthetic-browser\n');
  assert.equal(await browserWsFrom(profile, ''), 'ws://127.0.0.1:49200/devtools/browser/synthetic-browser');
});

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
  const profile = await mkdtemp(join(tmpdir(), 'formula-job-sync-browser-'));
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
  return {
    dialogs, exceptions, responses, newPage:pageUrl=>connectBrowserPage(t,origin,pageUrl),
    async send(method, params = {}) {
      const id = ++sequence;
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 5_000);
        pending.set(id, { resolve, timeout });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

async function browserValue(browser, expression) {
  const response = await browser.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.error) {
    const error = new Error(response.error.message); error.name = 'CdpProtocolError'; error.code = response.error.code; throw error;
  }
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text || 'browser evaluation failed');
  return response.result?.result?.value;
}

// A readiness budget is independent of the number/duration of CDP round trips.
// Slow transport may take longer than an arbitrary attempt count; failed state
// still stops the test with the last observed page state and a bounded deadline.
async function waitForBrowserState(browser, expression, ready, label, timeoutMs = 15_000) {
  const started = performance.now();
  let state, lastProtocolError;
  do {
    try {
      const value = await browserValue(browser, `JSON.stringify(${expression})`);
      if (value === undefined) throw new Error('browser evaluation returned no value');
      state = JSON.parse(value);
      if (ready(state)) return state;
    } catch (error) {
      // A reload can invalidate an in-flight evaluation. Only this captured
      // lifecycle response may wait for the replacement page's actual state.
      if (error.name !== 'CdpProtocolError' || error.code !== -32000 || error.message !== 'Inspected target navigated or closed') throw error;
      lastProtocolError = error;
    }
    await sleep(25);
  } while (performance.now() - started < timeoutMs);
  assert.fail(`${label} after ${Math.round(performance.now() - started)}ms; last state: ${JSON.stringify(state)}`
    + (lastProtocolError ? `; last protocol error: ${lastProtocolError.code} ${lastProtocolError.message}` : ''));
}

for(const [label,expression] of [['focus',"document.getElementById('fsJobRecoveryHeading').focus()"],['recovery refresh','__fsChatRecovery.refresh()']])test(`browser helper permits the intentional void result of ${label}`,async()=>{
 const browser={send:async()=>({result:{result:{type:'undefined'}}})};
 assert.equal(await browserValue(browser,expression),undefined);
});
test('browser helper preserves the original top-level CDP error code and message',async()=>{
 const browser={send:async()=>({id:1,error:{code:-32000,message:'Inspected target navigated or closed'}})};
 await assert.rejects(browserValue(browser,'1'),error=>error.name==='CdpProtocolError'&&error.code===-32000&&error.message==='Inspected target navigated or closed');
});
test('browser helper retries the captured navigation error and requires a later actual ready result',async()=>{
 const replies=[{error:{code:-32000,message:'Inspected target navigated or closed'}},{result:{result:{value:'{"ready":false}'}}},{result:{result:{value:'{"ready":true}'}}}];let calls=0;
 const browser={send:async()=>replies[calls++]};
 assert.deepEqual(await waitForBrowserState(browser,'({ready:false})',state=>state.ready,'synthetic navigation readiness'),{ready:true});assert.equal(calls,3);
});
for(const error of [{code:-32602,message:'Inspected target navigated or closed'},{code:-32000,message:'Synthetic unrelated protocol failure'},{code:-32000,message:'Execution context was destroyed.'}])test(`browser helper immediately rejects unrelated protocol error ${error.code} ${error.message}`,async()=>{
 let calls=0;const browser={send:async()=>{calls++;return {error};}};
 await assert.rejects(waitForBrowserState(browser,'({ready:true})',state=>state.ready,'must not retry',0),actual=>actual.name==='CdpProtocolError'&&actual.code===error.code&&actual.message===error.message);assert.equal(calls,1);
});
test('browser helper immediately rejects application evaluation exceptions',async()=>{
 let calls=0;const browser={send:async()=>{calls++;return {result:{exceptionDetails:{exception:{description:'ReferenceError: synthetic application failure'}}}};}};
 await assert.rejects(waitForBrowserState(browser,'({ready:true})',state=>state.ready,'app exception',0),/ReferenceError: synthetic application failure/);assert.equal(calls,1);
});
for(const result of [{},{result:{type:'undefined'}},{result:{value:undefined}}])test(`browser helper immediately rejects missing evaluation value ${JSON.stringify(result)}`,async()=>{
 let calls=0;const browser={send:async()=>{calls++;return {result};}};
 await assert.rejects(waitForBrowserState(browser,'({ready:true})',state=>state.ready,'missing value',0),/browser evaluation returned no value/);assert.equal(calls,1);
});
test('browser helper bounds persistent navigation errors and reports the label and last raw error',async()=>{
 let calls=0;const browser={send:async()=>{calls++;return {error:{code:-32000,message:'Inspected target navigated or closed'}};}};
 await assert.rejects(waitForBrowserState(browser,'({ready:true})',state=>state.ready,'synthetic persistent navigation',40),error=>error.message.includes('synthetic persistent navigation after ')&&error.message.includes('last protocol error: -32000 Inspected target navigated or closed'));
 assert.ok(calls>=1,'the bounded wait observed the real error response');
});

test('the actual job-sync asset replaces a fresh served bootstrap placeholder and initializes', async t => {
  const s=await stack(t);
  const html=await (await fetch(`http://127.0.0.1:${s.port}/`)).text();
  const bootstrap=html.match(/<script data-fs-job-sync-bootstrap="1">([\s\S]*?)<\/script>/)?.[1];
  const route=html.match(/<script src="(\/fs-job-sync\.js\?v=[^"]+)" defer><\/script>/)?.[1];
  assert.ok(bootstrap,'fresh proxy page must serve the fail-closed bootstrap');
  assert.ok(route,'fresh proxy page must serve the durable job-sync asset');
  assert.equal(await (await fetch(`http://127.0.0.1:${s.port}${route}`)).text(),jobSyncAsset,
    'execute the same asset bytes that the proxy served');
  // The page carries the versions it was served with, matching the live health
  // report, so an open tab can notice a later deploy and reload itself.
  const servedVersions=JSON.parse(bootstrap.match(/window\.__fsAssetVersions = (\{[^;]*\});/)?.[1] || 'null');
  const health=await (await fetch(`http://127.0.0.1:${s.port}/__formula/health`)).json();
  assert.deepEqual(servedVersions,health.assets,'served page must carry the same asset versions as /__formula/health');
  assert.equal(route,`/fs-job-sync.js?v=${servedVersions['/fs-job-sync.js']}`);

  const h=harness({records:[{...job('A03486'),createdBy:'sales'}],beforeAsset:bootstrap});
  assert.equal(h.context.__fsJobSync.installed,true,
    'the asset must replace the bootstrap placeholder instead of early-returning');
  assert.equal(h.context.__fsJobSync.ready,true,
    'the asset must initialize after replacing the placeholder');
});

test('startup is owned by the runtime coordinator instead of launching a competing full pull', async t => {
  const s = await stack(t);
  const html = await (await fetch(`http://127.0.0.1:${s.port}/`)).text();
  assert.match(html, /window\.__fsRuntimeBoot\s*=\s*function\(\)\s*\{\s*return sbBoot\(\);\s*\}/,
    'served page must hand the sealed boot entrypoint to the runtime coordinator');
  assert.doesNotMatch(html, /\n\s*sbBoot\(\);\s*\/\/ Refresh only warning nodes/,
    'sealed boot must not run before the runtime bridge installs');
  assert.match(jobSyncAsset, /__fsRuntimeBoot/,
    'the runtime asset must invoke the single delegated startup');
  assert.doesNotMatch(jobSyncAsset, /window\.__fsJobSync\.ready\s*=\s*true;[\s\S]{0,180}sbCycle\(true\);/,
    'the runtime asset must not launch a second full cycle immediately after boot');
});

test('real Chromium current history becomes ready while excluded local originals remain exactly recoverable', async t => {
  const currentApproval = {by:'Visible current approver',at:'Synthetic split approval'};
  const approvals = [{job_id:'A00001',part:'pd',data:currentApproval}];
  const s = await stack(t, { users: [{ name:'Synthetic Sales', data:{name:'Synthetic Sales',role:'sales'} }], approvals });
  const origin = `http://127.0.0.1:${s.port}`;
  const visible = { ...job('A00001', 'Visible current customer'), brand:'Visible current brand', createdAt:1, date:'Synthetic date' };
  s.records.set(visible.id, visible);
  s.records.set('A00002', { ...job('A00002', 'FOREIGN_CURRENT_CUSTOMER'), createdBy:'Other Sales' });
  s.archives.set('A00003', { ...job('A00003', 'ARCHIVED_PARENT_CUSTOMER'), createdBy:'Former Sales' });
  const roomData = id => ({ jobId:id, createdAt:1, createdBy:'Synthetic Sales', parts:[], approvals:{pd:null,ra:null,rd:null,sales:null} });
  const currentMessages = Array.from({length:3}, (_, i) => ({ uid:`current-${i}`, type:'msg', user:'Synthetic Sales', text:`Visible current message ${i}`, ts:i+1 }));
  const excluded = ['A00002','A00003','A00004'].map((id, i) => ({
    ...roomData(id), createdBy:'LEGACY_EXCLUDED_OWNER',
    approvals:{pd:{by:`EXCLUDED_APPROVER_${i}`,at:'old exact approval',extra:{result:['keep',null,0]}},ra:null,rd:null,sales:null},
    parts:[{name:'EXCLUDED_PARTICIPANT',firstAt:1,lastAt:7,msgs:2,activeMs:9}],
    seen:{'Synthetic Sales':17+i}, unknownRoom:{value:`EXCLUDED_ROOM_${i}`,nested:[false,{keep:'🧪'}]},
    messages:[{uid:`excluded-${i}`,type:'msg',user:'EXCLUDED_AUTHOR',text:`EXCLUDED_MESSAGE_${i}`,ts:10+i,unknownMessage:{nested:[null,false,'exact 🧪']}}],
  }));
  for (const id of ['A00001','A00002','A00003','A00004']) s.scopeRows.fs_chats.push({job_id:id,data:roomData(id)});
  for (const [id, messages] of [[visible.id,currentMessages], ...excluded.map(room => [room.jobId,room.messages])]) {
    for (const message of messages) s.scopeRows.fs_messages.push({job_id:id,uid:message.uid,ts:message.ts,data:id==='A00002'?{...message,text:'FOREIGN_SERVER_VARIANT'}:message});
  }
  const upstreamBefore = structuredClone({records:[...s.records],archives:[...s.archives],children:s.scopeRows});
  // Existing sealed startup reserves server-owned IDs; record that one exact
  // metadata operation separately. Observe attempted mutations/RPCs before
  // the upstream can reject them, including GET RPCs and the outage interval.
  const forbiddenAttempts = () => dataOperationAttempts(s.upstreamRequests).filter(request=>!isIdWarmup(request));
  const identity = JSON.stringify(['Synthetic Sales','synthetic-central-user','sales']);
  const pendingKey = 'fs_chat_pending_v1:' + encodeURIComponent(identity);
  const pending = {jobId:'A00004',message:{uid:'excluded-pending',type:'msg',text:'EXCLUDED_PENDING_BYTES',ts:99,unknown:{retain:[1,null,false]}}};
  const pendingRaw = ' [ ' + JSON.stringify(pending) + ' ]\n';
  const seenKey = 'fs_chat_seen_v1:' + encodeURIComponent('Synthetic Sales');
  const seenRaw = JSON.stringify({'A00002':17,'A00003':18,'A00004':19});
  const browser = await actualBrowser(t, 'about:blank'); if (!browser) return;
  await browser.send('Page.enable'); await browser.send('Runtime.enable'); await browser.send('Network.enable');
  await browser.send('Network.setBlockedURLs', {urls:['https://*']});
  await browser.send('Page.navigate', {url:origin + '/__formula/chat-recovery'});
  await waitForBrowserState(browser, '!!window.__fsChatRecovery', Boolean, 'seeding page did not load');
  const setSession = async (role, expiresIn = 300_000) => {
    const value = Buffer.from(JSON.stringify({name:'Synthetic Sales',role,centralUserId:'synthetic-central-user',exp:Date.now()+expiresIn})).toString('base64url');
    await browser.send('Network.setCookie',{name:'fs_session',value:`${value}.${createHmac('sha256',secret).update(value).digest('base64url')}`,url:origin+'/'});
  };
  await setSession('sales');
  await browserValue(browser, `Object.entries(${JSON.stringify({'fs_chats':JSON.stringify(excluded),[pendingKey]:pendingRaw,[seenKey]:seenRaw})}).forEach(([key,raw])=>localStorage.setItem(key,raw));true`);
  const journal = async () => JSON.parse(await browserValue(browser, `JSON.stringify(Object.fromEntries(Object.keys(localStorage).filter(key=>key.startsWith('fs_chat_journal_v2:')).sort().map(key=>[key,localStorage.getItem(key)])))`));
  const assertOriginals = async label => {
    const rows = Object.values(await journal()).map(raw=>JSON.parse(raw));
    for (const room of excluded) {
      const {messages,...metadata} = room;
      assert.deepEqual(rows.find(item=>item.kind==='unclassified-room'&&item.jobId===room.jobId)?.data, metadata, `${label}: all room metadata, approvals and old per-device seen values survive`);
      assert.deepEqual(rows.find(item=>item.kind==='unclassified-message'&&item.jobId===room.jobId)?.message, messages[0], `${label}: excluded originals and the same-uid foreign variant remain unacknowledged`);
    }
    assert.deepEqual(rows.find(item=>item.kind==='pending'&&item.message.uid===pending.message.uid), {kind:'pending',identity,...pending}, `${label}: explicit pending data survives without replay`);
    assert.equal(await browserValue(browser,`localStorage.getItem(${JSON.stringify(pendingKey)})`),pendingRaw,`${label}: mutable legacy pending bytes stay exact`);
    const seen = JSON.parse(await browserValue(browser,`localStorage.getItem(${JSON.stringify(seenKey)})`));
    for (const [id, at] of Object.entries(JSON.parse(seenRaw))) assert.equal(seen[id],at,`${label}: separate per-device seen map survives`);
    return rows;
  };
  const ready = async label => waitForBrowserState(browser, `({complete:document.readyState==='complete',bridge:window.__fsJobSync?.ready===true,core:window.__fsHandshakeReady===true,permission:window.__fsPermissionReady===true,history:window.__fsCentralReady===true,records:typeof records==='undefined'?[]:records.map(r=>r.id),rooms:typeof chats==='undefined'?[]:chats.map(c=>c.jobId),uids:typeof chats==='undefined'?[]:chats.flatMap(c=>c.messages.map(m=>m.uid)),chip:document.getElementById('syncChip')?.textContent||''})`, state=>state.complete&&state.bridge&&state.core&&state.permission&&state.history, label);
  for (const phase of ['startup','reload']) {
    await browser.send('Page.navigate',{url:origin+'/?history-scope='+phase});
    await waitForBrowserState(browser,`location.search==='?history-scope=${phase}'`,Boolean,'navigation did not finish');
    const state = await ready(`${phase}: current history must finish despite retained missing parents`);
    assert.deepEqual(state.records,[visible.id]); assert.deepEqual(state.rooms,[visible.id]);
    assert.deepEqual(state.uids,currentMessages.map(message=>message.uid),'every visible current message loads');
    assert.equal(state.chip,'เชื่อมต่อระบบกลางแล้ว');
    assert.deepEqual(JSON.parse(await browserValue(browser,`JSON.stringify(getChat('A00001').approvals.pd)`)),currentApproval,'current approval is rebuilt from the separate approval table');
    await assertOriginals(phase);
    assert.deepEqual(forbiddenAttempts(),[],`${phase}: startup attempts no business-data mutation or forbidden RPC`);
    const ui = JSON.parse(await browserValue(browser, `JSON.stringify((()=>{openRecordPopup('A00001');var detail=document.getElementById('gModal').textContent;closeGModal();chatOpenId='A00001';switchView('chat');renderChat();return {detail,chat:document.getElementById('chatContent').textContent,body:document.body.textContent,open:chatOpenId};})())`));
    assert.match(ui.detail,/Visible current customer/); assert.match(ui.detail,/Visible current brand/); assert.match(ui.detail,/Visible current approver/);
    assert.equal(ui.open,visible.id);
    for (const message of currentMessages) assert.ok(ui.chat.includes(message.text),'current chat renders every message');
    assert.doesNotMatch(ui.body,/EXCLUDED_|FOREIGN_|ARCHIVED_PARENT_CUSTOMER/,'normal rendered UI exposes no foreign, archived, unexplained or unclassified payload');
    assert.deepEqual(forbiddenAttempts(),[],`${phase}: startup and read-only details attempt no upstream business-data mutation or forbidden RPC`);
  }
  const durableBeforeFailure = await journal();
  const outageStart = s.upstreamRequests.length;
  s.database(false);
  await browserValue(browser,'sbCycle(true);true');
  await waitForBrowserState(browser,`({ready:window.__fsCentralReady,error:typeof sbErr==='undefined'?'':String(sbErr)})`,state=>state.ready===false&&state.error.length>0,'real server failure must finish with closed central readiness and a reported error');
  assert.ok(s.upstreamRequests.slice(outageStart).some(request=>request.path.startsWith('/fs_')),'completed outage actually reaches the observed synthetic data upstream');
  assert.deepEqual(forbiddenAttempts(),[],'outage attempts no business-data mutation or forbidden RPC, including requests rejected with 503');
  await assertOriginals('server failure');
  for (const [key,raw] of Object.entries(durableBeforeFailure)) assert.equal((await journal())[key],raw,'server failure cannot consume or rewrite any original recovery journal');
  s.database(true);
  await browser.send('Page.navigate',{url:origin+'/__formula/chat-recovery'});
  await waitForBrowserState(browser,"location.pathname==='/__formula/chat-recovery' && !!window.__fsChatRecovery",Boolean,'standalone authorized recovery did not load');
  const recoveryOperationsBefore = dataOperationAttempts(s.upstreamRequests).length;
  const recover = () => browserValue(browser,'(async()=>JSON.stringify(await __fsChatRecovery.snapshot()))()').then(JSON.parse);
  const own = await recover();
  assert.equal(own.entries.length,0,'Sales cannot export excluded history with unverifiable current ownership');
  assert.equal(own.confirmedCount,0,'excluded server-equal messages are not marked centrally confirmed');
  await setSession('sales',-1_000);
  await assert.rejects(recover,/recovery authorization unavailable/,'a real expired server session refuses recovery payload export');
  await assertOriginals('expired recovery session');
  for (const [key,raw] of Object.entries(durableBeforeFailure)) assert.equal((await journal())[key],raw,'session failure cannot consume or rewrite original recovery journals');
  await setSession('admin');
  const all = await recover();
  assert.equal(all.confirmedCount,0,'Admin recovery also cannot acknowledge out-of-scope originals as current history');
  for (const [key,raw] of Object.entries(durableBeforeFailure)) assert.deepEqual(all.entries.find(entry=>entry.source===key)?.value,JSON.parse(raw),'authorized Admin recovery exports every exact original journal component');
  const downloaded = JSON.parse(await browserValue(browser, `(async()=>{var saved,old=URL.createObjectURL;URL.createObjectURL=function(blob){saved=blob;return old.call(URL,blob)};await __fsChatRecovery.download();return await saved.text()})()`));
  assert.deepEqual(downloaded,all,'the actual download contains the exact authorized recovery snapshot');
  await assertOriginals('authorized recovery');
  for (const [key,raw] of Object.entries(durableBeforeFailure)) assert.equal((await journal())[key],raw,'authorization and download never consume the original journals');
  assert.equal(dataOperationAttempts(s.upstreamRequests).length,recoveryOperationsBefore,'standalone recovery attempts no upstream data mutation or RPC of any method');
  assert.deepEqual(forbiddenAttempts(),[],'startup, reload, outage, scope authorization and recovery attempt no replay, business-data mutation or forbidden RPC');
  const allocations = dataOperationAttempts(s.upstreamRequests).filter(isIdWarmup);
  assert.ok(allocations.length>0,'established startup ID warmup is separately visible');
  for (const write of allocations) { assert.equal(write.method,'POST'); assert.deepEqual(write.body,{}); }
  assert.equal(s.archiveReads.length,0,'normal scope and local recovery never read the archive');
  assert.deepEqual({records:[...s.records],archives:[...s.archives],children:s.scopeRows},upstreamBefore,'all synthetic server originals remain unchanged');
  const retention = (await s.audit()).filter(line=>line.decision==='history-retained-out-of-scope');
  assert.equal(retention.length,1,'repeated reads share the bounded retention diagnostic');
  t.diagnostic(`Chromium: core/permission/history ready; 3 current messages rendered; 3 excluded room metadata + 3 unknown messages + 1 pending original preserved; Sales denied excluded export, Admin exact download; zero attempted business-data mutations/forbidden RPCs/archive reads; existing ID warmup POST /rpc/fs_next_rec_seq count=${allocations.length}`);
});


// Observe the real DOM/error transitions without assigning application flags.
async function observeStartup(browser) {
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const states = window.__testStartupTransitions = []; let previous = '';
    const record = () => {
      const chip = document.getElementById('syncChip');
      const state = {text:chip?.textContent || '', error:typeof sbErr==='undefined'?'':String(sbErr),
        actor:typeof currentUser!=='undefined'&&!!currentUser, ready:window.__fsCentralReady===true};
      const key = JSON.stringify(state); if (key === previous) return; previous = key;
      states.push({...state,at:performance.now()});
    };
    new MutationObserver(record).observe(document,{subtree:true,childList:true,characterData:true});
  })()` });
}

test('large message history stays off the connection critical path', async t => {
  const s = await stack(t, { messageCount: 5327, messageDelayMs: timingLatency ? 1_000 : 500, users: [{ name: 'Synthetic Sales', data: { name: 'Synthetic Sales', role: 'sales' } }] });
  const browser = await actualBrowser(t, 'about:blank');
  if (!browser) return;
  await browser.send('Page.enable');
  await browser.send('Runtime.enable');
  await browser.send('Network.enable');
  await browser.send('Network.setBlockedURLs', { urls: ['https://*'] });
  await observeStartup(browser);
  const value = Buffer.from(JSON.stringify({ name: 'Synthetic Sales', role: 'sales', centralUserId: 'synthetic-central-user', exp: Date.now() + 60_000 })).toString('base64url');
  const signed = `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`;
  await browser.send('Network.setCookie', { name: 'fs_session', value: signed, url: `http://127.0.0.1:${s.port}/` });
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${s.port}/` });
  const started = Date.now();
  let connectedAt = 0, historyFinished = false;
  await waitForBrowserState(browser, `{text:document.getElementById('syncChip')?.textContent || '',ready:window.__fsCentralReady === true}`, state => {
    if (!connectedAt && /เชื่อมต่อระบบกลางแล้ว/.test(state.text)) connectedAt = Date.now();
    historyFinished = !!(connectedAt && state.ready);
    return historyFinished;
  }, 'deferred history must eventually finish and restore authoritative readiness');
  t.diagnostic(`handshake_ms=${connectedAt - started}; history_ready_ms=${Date.now() - started}`);
  const transitions = await browserValue(browser, 'window.__testStartupTransitions');
  t.diagnostic('startup_transitions=' + JSON.stringify(transitions));
  assert.deepEqual(transitions.filter(state => state.error), [], 'cold authenticated startup must not briefly fail before a scheduled retry');
  assert.ok(connectedAt, 'the browser must expose the central handshake before history finishes');
  assert.ok(connectedAt - started < 2_000, `central handshake took ${connectedAt - started}ms`);
  assert.equal(historyFinished, true, 'deferred history must eventually finish and restore authoritative readiness');
  assert.equal(s.scopedReadHeaders.filter(entry => entry.table.endsWith('/fs_messages')).length, 12,
    'the selected-ID stable bundle performs two six-page scans; startupPull reuses the verified rows');
  assert.equal(await browserValue(browser, `document.getElementById('syncChip')?.textContent || ''`), 'เชื่อมต่อระบบกลางแล้ว', 'final chip returns to the normal ready state');
});

test('central handshake is visible within three seconds while a slow core pull remains read-only', async t => {
  const s = await stack(t, { coreDelayMs: 4_000, users: [{ name: 'Synthetic Sales', data: { name: 'Synthetic Sales', role: 'sales' } }] });
  s.records.set('A00001',job());
  s.scopeRows.fs_chats.push({job_id:'A00001',data:{jobId:'A00001',createdBy:'Synthetic Sales',parts:[]}});
  s.scopeRows.fs_messages.push({job_id:'A00001',uid:'slow-synthetic-message',data:{uid:'slow-synthetic-message',text:'Synthetic slow scoped history'}});
  const browser = await actualBrowser(t, 'about:blank');
  if (!browser) return;
  await browser.send('Page.enable');
  await browser.send('Runtime.enable');
  await browser.send('Network.enable');
  await browser.send('Network.setBlockedURLs', { urls: ['https://*'] });
  await observeStartup(browser);
  // Observe actual fetch/body completion, including the snapshot's final
  // trusted-session check; do not infer order from source text or elapsed time.
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const nativeFetch=window.fetch;
    window.__startupReadOrder=[];
    window.fetch=async function(path,options) {
      const route=new URL(String(path),location.href).pathname;
      const observed=['/__formula/visible-record-ids','/__formula/scoped-chat-history','/sb/session','/sb/rest/v1/fs_records'].includes(route);
      if(observed) window.__startupReadOrder.push({route,phase:'start',at:performance.now()});
      const response=await nativeFetch.apply(this,arguments);
      if(observed) {
        const nativeJson=response.json.bind(response);
        response.json=async function() {
          const data=await nativeJson();
          window.__startupReadOrder.push({route,phase:'body-complete',at:performance.now()});
          return data;
        };
      }
      return response;
    };
  })()` });
  const value = Buffer.from(JSON.stringify({ name: 'Synthetic Sales', role: 'sales', centralUserId: 'synthetic-central-user', exp: Date.now() + 60_000 })).toString('base64url');
  const signed = `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`;
  await browser.send('Network.setCookie', { name: 'fs_session', value: signed, url: `http://127.0.0.1:${s.port}/` });
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${s.port}/` });
  const started = Date.now();
  let connectedAt = 0;
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = JSON.parse(await browserValue(browser, `JSON.stringify({text:document.getElementById('syncChip')?.textContent || '',handshake:window.__fsHandshakeReady === true,ready:window.__fsCentralReady === true,canCreate:!!(window.__fsJobSync && window.__fsJobSync.canCreate && window.__fsJobSync.canCreate())})`));
    if (state.handshake && /เชื่อมต่อระบบกลางแล้ว/.test(state.text)) {
      connectedAt = Date.now();
      assert.equal(state.ready, false, 'the handshake must not unlock writes before the full baseline');
      assert.equal(state.canCreate, false, 'the handshake must not unlock new-job creation before the full baseline');
      break;
    }
    await sleep(50);
  }
  assert.ok(connectedAt, 'the browser must expose the session handshake before the slow core pull finishes');
  assert.ok(connectedAt - started < 3_000, `central handshake took ${connectedAt - started}ms`);
  await waitForBrowserState(browser, '({ready:window.__fsCentralReady===true,sbReady,canCreate:window.__fsJobSync.canCreate()})', state=>{
    if (!state.ready) {
      assert.equal(state.sbReady,false,'writes remain closed throughout the incomplete baseline');
      assert.equal(state.canCreate,false,'creation remains closed throughout the incomplete baseline');
    }
    return state.ready;
  }, 'delayed core must finish with actual authenticated actor and two verified selected history scans', 75_000);
  t.diagnostic(`handshake_ms=${connectedAt-started}; history_ready_ms=${Date.now()-started}`);
  const readOrder=await browserValue(browser,'window.__startupReadOrder');
  t.diagnostic('startup_read_order='+JSON.stringify(readOrder));
  const bundleRead=readOrder.filter(event=>event.route==='/__formula/scoped-chat-history');
  assert.equal(bundleRead.length,2,'one selected bundle starts and completes its body before readiness');
  t.diagnostic('scoped_bundle_ms='+(bundleRead[1].at-bundleRead[0].at));
  const scopeBodies=readOrder.map((event,index)=>({event,index})).filter(({event})=>event.route==='/__formula/visible-record-ids' && event.phase==='body-complete');
  const snapshotComplete=scopeBodies[1]?.index ?? -1;
  const finalSnapshotSession=readOrder.findIndex((event,index)=>index>snapshotComplete && event.route==='/sb/session' && event.phase==='body-complete');
  // The sealed bootstrap first reads core profiles to install the actor.
  // Its following full-history core read is the independent pull under test.
  const corePulls=readOrder.map((event,index)=>({event,index})).filter(({event})=>event.route==='/sb/rest/v1/fs_records' && event.phase==='start');
  assert.equal(corePulls.length,2,'one bootstrap core read and one full-history core read');
  const firstCorePull=corePulls[1].index;
  assert.ok(snapshotComplete>=0 && finalSnapshotSession>snapshotComplete && firstCorePull>finalSnapshotSession,
    'initial and final visible scope checks settle before the independent core pull, including empty scope: '+JSON.stringify(readOrder));
  assert.equal(browser.responses.filter(r=>r.url.includes('/__formula/visible-record-ids')).length,3,'baseline reads initial IDs and rechecks after staged children and final journal preparation');
  const transitions = await browserValue(browser, 'window.__testStartupTransitions');
  assert.deepEqual(transitions.filter(state=>state.error), [], 'delayed core/profile availability must not produce a transient identity failure');
  assert.equal(await browserValue(browser, "currentUser==='Synthetic Sales'"), true, 'the real session bridge must install its authenticated actor');
});

test('startup actor scheduling stays closed for missing profiles, unavailable bridge and changed server sessions', async t => {
  for (const scenario of ['missing-profile','missing-bridge','anonymous','expired-during-core','changed-during-core']) {
    await t.test(scenario, async t => {
      const changesSession = scenario.endsWith('-during-core');
      const name = scenario === 'missing-profile' ? 'Someone else' : 'Synthetic Sales';
      const s = await stack(t, {messageCount:1, coreDelayMs:changesSession ? 600 : 0,
        users:[{name,data:{name,role:'sales'}}]});
      const browser = await actualBrowser(t, 'about:blank'); if (!browser) return;
      await browser.send('Page.enable'); await browser.send('Runtime.enable'); await browser.send('Network.enable');
      await browser.send('Network.setBlockedURLs',{urls:['https://*',...(scenario==='missing-bridge'?['*fs-session-bridge.js*']:[])]});
      const cookie = async (name, exp=Date.now()+60_000) => {
        const value=Buffer.from(JSON.stringify({name,role:'sales',centralUserId:'synthetic-central-user',exp})).toString('base64url');
        await browser.send('Network.setCookie',{name:'fs_session',value:`${value}.${createHmac('sha256',secret).update(value).digest('base64url')}`,url:`http://127.0.0.1:${s.port}/`});
      };
      if (scenario!=='anonymous') await cookie('Synthetic Sales');
      await browser.send('Page.navigate',{url:`http://127.0.0.1:${s.port}/`});
      if(changesSession) {
        await waitForBrowserState(browser,'window.__fsHandshakeReady===true && window.__fsCentralReady!==true',Boolean,'real session handshake must precede delayed core');
        await cookie(scenario==='changed-during-core'?'Different actor':'Synthetic Sales', scenario==='expired-during-core'?Date.now()-1_000:Date.now()+60_000);
      }
      await waitForBrowserState(browser,"({error:typeof sbErr==='undefined'?'':String(sbErr),ready:window.__fsCentralReady===true,bridge:!!window.__fsJobSync?.ready})",
        state=>state.bridge && !state.ready && !!state.error,'unavailable actor/session must report an error without central readiness');
      assert.equal(await browserValue(browser,'window.__fsJobSync.canCreate()'),false,'no actor-ready signal may grant write readiness');
      assert.equal(await browserValue(browser,'sbPush(true)'),false,'actual push stays closed');
      assert.equal(s.scopedReadHeaders.filter(entry=>entry.table==='/fs_messages').length,0,'invalid startup must not fetch message history');
      assert.deepEqual(dataOperationAttempts(s.upstreamRequests).filter(request=>!isIdWarmup(request)),[],'invalid startup attempts no business-data mutation');
    });
  }
});

test('partial startup and pending permission keep the local journal closed to central writes', async t => {
  const s = await stack(t, { assetDelayMs: timingLatency ? 3_000 : 0 });
  const browser = await actualBrowser(t, 'about:blank');
  if (!browser) return;
  await browser.send('Page.enable');
  await browser.send('Runtime.enable');
  await browser.send('Network.enable');
  await browser.send('Network.setBlockedURLs', { urls: ['https://*'] });
  const value = Buffer.from(JSON.stringify({ name: 'Synthetic Sales', role: 'sales', centralUserId: 'synthetic-central-user', exp: Date.now() + 60_000 })).toString('base64url');
  const signed = `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`;
  await browser.send('Network.setCookie', { name: 'fs_session', value: signed, url: `http://127.0.0.1:${s.port}/` });
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${s.port}/` });
  await waitForBrowserState(browser, `{complete:document.readyState === 'complete',bridge:!!(window.__fsJobSync&&window.__fsJobSync.ready)}`,
    state => state.complete && state.bridge, 'job bridge did not become ready before partial-startup inspection');
  const writesBefore = s.writes.filter(write => write.path === '/rpc/fs_save_record' || write.path === '/fs_activities').length;
  await browserValue(browser, `(function () {
    currentUser = 'Synthetic Sales';
    records = [{id:'A03993',customer:'Pending startup',brand:'Pending startup',createdBy:'Synthetic Sales',createdAt:1,rows:[]}];
    recTouched = {'A03993': 1}; saveRecordsStore();
    window.__fsCentralReady = false; window.__fsPermissionReady = false;
    return true;
  }())`);
  const pushResult = await browserValue(browser, 'sbPush(true)');
  const canCreate = await browserValue(browser, 'window.__fsJobSync.canCreate()');
  assert.equal(pushResult, false, 'a partial/permission-pending startup must refuse central push');
  assert.equal(canCreate, false, 'creation must remain closed until full baseline and permission are ready');
  assert.equal(s.writes.filter(write => write.path === '/rpc/fs_save_record' || write.path === '/fs_activities').length, writesBefore, 'partial startup must not write records or Activity');
});

test('a failed deferred history pull recovers on the next full cycle and restores readiness', async t => {
  const s = await stack(t, { messageCount: 5327, messageFailCount: 1, users: [{ name: 'Synthetic Sales', data: { name: 'Synthetic Sales', role: 'sales' } }] });
  const browser = await actualBrowser(t, 'about:blank');
  if (!browser) return;
  await browser.send('Page.enable');
  await browser.send('Runtime.enable');
  await browser.send('Network.enable');
  await browser.send('Network.setBlockedURLs', { urls: ['https://*'] });
  const value = Buffer.from(JSON.stringify({ name: 'Synthetic Sales', role: 'sales', centralUserId: 'synthetic-central-user', exp: Date.now() + 60_000 })).toString('base64url');
  const signed = `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`;
  await browser.send('Network.setCookie', { name: 'fs_session', value: signed, url: `http://127.0.0.1:${s.port}/` });
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${s.port}/` });
  let sawError = false, ready = false;
  for (let attempt = 0; attempt < 300; attempt++) {
    const state = JSON.parse(await browserValue(browser, `JSON.stringify({text:document.getElementById('syncChip')?.textContent || '',ready:window.__fsCentralReady === true,error:typeof sbErr==='undefined'?'':String(sbErr)})`));
    sawError = sawError || !!state.error && /ระบบจะลองใหม่อัตโนมัติ/.test(state.text);
    if (state.ready) { ready = true; break; }
    await sleep(100);
  }
  assert.equal(sawError, true, 'the first deferred history failure must remain visible');
  assert.equal(ready, true, 'a later full cycle must restore authoritative readiness');
  assert.equal(s.scopedReadHeaders.filter(entry => entry.table.endsWith('/fs_messages')).length, 13,
    'one failed bounded request is followed by two complete selected six-page verification scans, with no extra startupPull history read');
  assert.equal(await browserValue(browser, `document.getElementById('syncChip')?.textContent || ''`), 'เชื่อมต่อระบบกลางแล้ว', 'recovered startup returns to the normal ready state');
});


test('a real Chromium page executes the proxy bootstrap and deferred bridge in the page world', async t => {
  const s = await stack(t);
  const browser = await actualBrowser(t, `http://127.0.0.1:${s.port}/`);
  if (!browser) return;
  await browser.send('Page.enable');
  await browser.send('Runtime.enable');
  // The target is created at the given URL, then waits for the actual parser,
  // inline bootstrap, and both deferred scripts in Chromium's page world.
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await browserValue(browser, `JSON.stringify({
      ready: document.readyState,
      installed: !!(window.__fsJobSync && window.__fsJobSync.installed),
      bridgeReady: !!(window.__fsJobSync && window.__fsJobSync.ready),
      asset: Array.from(document.scripts).map(function (script) { return script.src; }).find(function (src) { return /\\/fs-job-sync\\.js\\?v=/.test(src); }) || ''
    })`);
    const parsed = JSON.parse(state);
    if (parsed.ready === 'complete' && parsed.installed && parsed.bridgeReady && parsed.asset) {
      assert.match(parsed.asset, new RegExp(`^http://127\\.0\\.0\\.1:${s.port}/fs-job-sync\\.js\\?v=[a-f0-9]+$`));
      return;
    }
    await sleep(25);
  }
  const observed = await browserValue(browser, `JSON.stringify({
    ready: document.readyState,
    bridge: window.__fsJobSync || null,
    scripts: Array.from(document.scripts).map(function (script) { return { src: script.src, defer: script.defer }; })
  })`);
  assert.fail(`deferred bridge did not install in the real browser page: ${observed}`);
});

test('reopened chat formula rows retain the ingredient chooser from the create form', async t => {
  const s = await stack(t, { assetDelayMs: timingLatency ? 3_000 : 0 });
  const id = 'A03991';
  s.records.set(id, {
    id,
    customer: 'Synthetic reopened formula customer',
    brand: 'Synthetic reopened formula brand',
    createdBy: 'Synthetic Admin',
    createdAt: 1,
    rows: [{name: '', w: 0, o: '', p: 100, note: ''}, {name: '', w: 0, o: '', p: 100, note: ''}]
  });
  const browser = await actualBrowser(t, `http://127.0.0.1:${s.port}/`);
  if (!browser) return;
  await browser.send('Page.enable');
  await browser.send('Runtime.enable');
  const value = Buffer.from(JSON.stringify({name:'Synthetic Admin', role:'admin', centralUserId:'synthetic-central-admin', exp:Date.now()+60_000})).toString('base64url');
  const signed = `${value}.${createHmac('sha256',secret).update(value).digest('base64url')}`;
  await browser.send('Network.enable');
  await browser.send('Network.setCookie',{name:'fs_session',value:signed,url:`http://127.0.0.1:${s.port}/`});
  // /json/new can return the DevTools target before its first navigation has
  // committed. Wait for the local origin before touching localStorage so this
  // browser contract is deterministic when the full suite runs in parallel.
  await waitForBrowserState(browser, `{origin:location.origin}`, state => state.origin === `http://127.0.0.1:${s.port}`,
    'synthetic Formula page did not reach its local origin');
  await browserValue(browser, `localStorage.setItem('fs_user','Synthetic Admin'); localStorage.setItem('fs_userlist', JSON.stringify([{name:'Synthetic Admin',role:'admin'}])); true`);
  await browser.send('Page.navigate',{url:`http://127.0.0.1:${s.port}/`});
  await waitForBrowserState(browser, `{ready:document.readyState,bridge:!!(window.__fsJobSync&&window.__fsJobSync.ready)}`,
    state => state.ready === 'complete' && state.bridge, 'job bridge did not become ready before reopened formula inspection');
  await waitForBrowserState(browser,'window.__fsCentralReady===true',Boolean,'reopened formula needs the authorized server baseline');
  const writesBeforeRender = s.writes.filter(write => write.path === '/rpc/fs_save_record' || write.path === '/fs_activities').length;
  const result = JSON.parse(await browserValue(browser, `JSON.stringify((function () {
    sbApply({full:true, partial:false, rec:[{id:'${id}', data:${JSON.stringify({id,customer:'Synthetic reopened formula customer',brand:'Synthetic reopened formula brand',createdBy:'Synthetic Admin',createdAt:1,rows:[{name:'',w:0,o:'',p:100,note:''},{name:'',w:0,o:'',p:100,note:''}]})}}], cht:[], usr:[], act:[], msg:[], apv:[]});
    currentUser = 'Synthetic Admin';
    userList = [{name:'Synthetic Admin', role:'admin'}];
    var record = records.find(function (candidate) { return candidate.id === '${id}'; });
    if (!record) return {error:'server record was not loaded'};
    chats.push({jobId:'${id}', createdAt:1, createdBy:'Synthetic Admin', messages:[], parts:[], approvals:{pd:null,ra:null,rd:null,sales:null}});
    chatOpenId = '${id}';
    chatJobOpen = true;
    renderChat();
    var first = document.querySelector('input[id="cfin-0-name"]');
    if (first) first.setAttribute('list','stale_list');
    renderChat();
    return {
      error: '',
      datalist: !!document.getElementById('ing_list'),
      options: document.querySelectorAll('#ing_list option').length,
      inputs: Array.from(document.querySelectorAll('input[id^="cfin-"][id$="-name"]')).map(function (input) {
        return {id: input.id, list: input.getAttribute('list')};
      })
    };
  }()))`));
  assert.equal(result.error, '', result.error);
  assert.equal(result.datalist, true, 'the shared ingredient datalist is present');
  assert.ok(result.options > 0, 'the datalist contains selectable ingredients');
  assert.deepEqual(result.inputs, [
    {id: 'cfin-0-name', list: 'ing_list'},
    {id: 'cfin-1-name', list: 'ing_list'}
  ], 'reopened formula rows must expose the same ingredient chooser as create rows');
  assert.equal(s.writes.filter(write => write.path === '/rpc/fs_save_record' || write.path === '/fs_activities').length, writesBeforeRender, 'render-only chooser repair must not write a record or Activity');
});

test('Activities job ID is a button that opens the exact record in the real browser page', async t => {
  const s = await stack(t);
  const id = 'A03996';
  const browser = await actualBrowser(t, `http://127.0.0.1:${s.port}/`);
  if (!browser) return;
  await browser.send('Page.enable');
  await browser.send('Runtime.enable');
  await browser.send('Network.enable');
  const value = Buffer.from(JSON.stringify({ name:'Synthetic Admin', role:'admin', centralUserId:'synthetic-central-admin', exp:Date.now()+60_000 })).toString('base64url');
  const signed = `${value}.${createHmac('sha256',secret).update(value).digest('base64url')}`;
  await browser.send('Network.setCookie',{name:'fs_session',value:signed,url:`http://127.0.0.1:${s.port}/`});
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await browserValue(browser, 'location.origin') === `http://127.0.0.1:${s.port}`) break;
    await sleep(25);
    if (attempt === 99) assert.fail('synthetic Formula page did not reach its local origin');
  }
  await browserValue(browser, `localStorage.setItem('fs_user','Synthetic Admin');localStorage.setItem('fs_userlist',JSON.stringify([{name:'Synthetic Admin',role:'admin'}]));true`);
  await browser.send('Page.navigate',{url:`http://127.0.0.1:${s.port}/`});
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = JSON.parse(await browserValue(browser, `JSON.stringify({ready:document.readyState,bridge:!!(window.__fsJobSync&&window.__fsJobSync.ready),admin:window.__fsAdminActivityLogAllowed?.()===true})`));
    if (state.ready === 'complete' && state.bridge && state.admin) break;
    await sleep(25);
    if (attempt === 99) assert.fail('Admin activity gate and job bridge did not become ready before Activities inspection');
  }
  await browserValue(browser, `(function () {
    currentUser='Synthetic Admin';
    userList=[{name:'Synthetic Admin',role:'admin'}];
    records=[{id:'${id}',customer:'Synthetic activity customer',brand:'Synthetic activity brand',createdBy:'Synthetic Admin',createdAt:1,rows:[]}];
    activities=[{uid:'activity-job-link',ts:Date.now(),at:new Date().toLocaleString('th-TH'),user:'Synthetic Admin',role:'admin',cat:'job',action:'แก้ไขชุดข้อมูล',detail:'Synthetic activity detail',job:'${id}'}];
    window.openedRecordIds=[];
    window.openRecordPopup=function(recordId){window.openedRecordIds.push(recordId);};
    switchView('act');
    return true;
  }())`);
  await waitForBrowserState(browser,
    `{allowed:window.__fsAdminActivityLogAllowed?.()===true,row:document.getElementById('actContent').textContent.includes('Synthetic activity detail')}`,
    state => state.allowed && state.row, 'trusted Admin Activity view did not finish rendering');
  const result = JSON.parse(await browserValue(browser, `JSON.stringify((function () {
    var button=Array.from(document.querySelectorAll('#actContent button')).find(function(candidate){return candidate.textContent.trim()==='${id}';});
    if(button)button.click();
    return {button:!!button,tag:button&&button.tagName,opened:window.openedRecordIds.slice(),panel:!!document.getElementById('fsJobIntegrityPanel'),statusMarker:!!document.getElementById('fsJobSaveState-${id}')};
  }()))`));
  assert.equal(result.button,true,'Activities must render a clickable button for each job ID');
  assert.equal(result.tag,'BUTTON');
  assert.deepEqual(result.opened,[id],'clicking the Activity job ID must open that exact record');
  assert.equal(result.statusMarker,false,'Activity job IDs must not regain the retired central-save status badge');
});

test('Customer Data delete action is rendered and reachable only for Admin or the job owner', async t => {
  const s = await stack(t);
  const browser = await actualBrowser(t, `http://127.0.0.1:${s.port}/`);
  if (!browser) return;
  await browser.send('Page.enable');
  await browser.send('Runtime.enable');
  await browser.send('Network.enable');
  const value = Buffer.from(JSON.stringify({ name:'Synthetic Admin', role:'admin', centralUserId:'synthetic-central-admin', exp:Date.now()+60_000 })).toString('base64url');
  const signed = `${value}.${createHmac('sha256',secret).update(value).digest('base64url')}`;
  await browser.send('Network.setCookie',{name:'fs_session',value:signed,url:`http://127.0.0.1:${s.port}/`});
  await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('fs_user','Synthetic Admin');localStorage.setItem('fs_userlist',JSON.stringify([{name:'Synthetic Admin',role:'admin'}]));`});
  await browser.send('Page.navigate',{url:`http://127.0.0.1:${s.port}/`});
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = JSON.parse(await browserValue(browser, `JSON.stringify({ready:document.readyState,bridge:!!(window.__fsJobSync&&window.__fsJobSync.ready)})`));
    if (state.ready === 'complete' && state.bridge) break;
    await sleep(25);
    if (attempt === 99) assert.fail('job bridge did not become ready before Customer Data delete-action inspection');
  }
  await waitForBrowserState(browser,'window.__fsCentralReady===true',Boolean,'central scope did not become ready for delete fixture');
  const result = JSON.parse(await browserValue(browser, `JSON.stringify((function () {
    var owned='A03981', foreign='A03982';
    records=[
      {id:owned,customer:'Synthetic owned customer',brand:'Owned',createdBy:'Synthetic Owner',createdAt:1,date:'10/10/2026',rows:[]},
      {id:foreign,customer:'Synthetic foreign customer',brand:'Foreign',createdBy:'Synthetic Other',createdAt:1,date:'10/10/2026',rows:[]}
    ];
    userList=[
      {name:'Synthetic Admin',role:'admin'},
      {name:'Synthetic Owner',role:'sales'},
      {name:'Synthetic Viewer',role:'mkt'}
    ];
    function inspect(name){
      currentUser=name; renderRecordsList();
      return Array.from(document.querySelectorAll('#recordsPanel button[data-fs-delete-job="1"]')).map(function(button){
        var label=button.querySelector('.fs-dashboard-delete-label');
        return {id:button.getAttribute('data-fs-job-id'),type:button.getAttribute('type'),aria:button.getAttribute('aria-label'),text:button.textContent.trim(),labelVisible:!!label && getComputedStyle(label).position==='static'};
      });
    }
    var admin=inspect('Synthetic Admin');
    var owner=inspect('Synthetic Owner');
    var viewer=inspect('Synthetic Viewer');
    currentUser='Synthetic Owner';
    sbApply({full:true,partial:false,rec:[{id:owned,data:records.find(function(record){return record.id===owned;})}],cht:[],usr:[],act:[],msg:[],apv:[]});
    renderRecordsList();
    var action=document.querySelector('#recordsPanel button[data-fs-delete-job="1"][data-fs-job-id="'+owned+'"]');
    var actionCell=action&&action.closest('td');
    if(action) action.click();
    return {admin:admin,owner:owner,viewer:viewer,confirmation:!!document.getElementById('gmOk'),recordStillPresent:records.some(function(record){return record.id===owned;}),actionCellSticky:!!actionCell&&getComputedStyle(actionCell).position==='sticky'};
  }()))`).catch(error=>{throw new Error(error.message+'; dialogs='+JSON.stringify(browser.dialogs));}));
  const expectedAction = id => ({id,type:'button',aria:`ลบงาน ${id}`,text:'🗑ลบ',labelVisible:true});
  assert.deepEqual(result.admin,[expectedAction('A03981'),expectedAction('A03982')], 'Admin must see an accessible delete action for every visible Customer Data record');
  assert.deepEqual(result.owner,[expectedAction('A03981')], 'the owner must see a delete action only for its own visible record');
  assert.deepEqual(result.viewer,[], 'a non-owner without Admin capability must not see a delete action');
  assert.equal(result.actionCellSticky,true,'the Customer Data action cell must remain reachable in the sticky action column');
  assert.equal(result.confirmation,true,'activating the delete action must enter the existing confirmation flow');
  assert.equal(result.recordStillPresent,true,'opening confirmation must not delete the record before explicit confirmation');
});

test('legacy-sync warning presents only its affected job and opens it in the real browser page', async t => {
  const s = await stack(t);
  s.edit(true);
  const id = 'A03997';
  const browser = await actualBrowser(t, `http://127.0.0.1:${s.port}/`);
  if (!browser) return;
  await browser.send('Page.enable');
  await browser.send('Runtime.enable');
  await browser.send('Network.enable');
  const value = Buffer.from(JSON.stringify({ name:'Synthetic Admin', role:'admin', centralUserId:'synthetic-central-admin', exp:Date.now()+60_000 })).toString('base64url');
  const signed = `${value}.${createHmac('sha256',secret).update(value).digest('base64url')}`;
  await browser.send('Network.setCookie',{name:'fs_session',value:signed,url:`http://127.0.0.1:${s.port}/`});
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await browserValue(browser, 'location.origin') === `http://127.0.0.1:${s.port}`) break;
    await sleep(25);
    if (attempt === 99) assert.fail('synthetic Formula page did not reach its local origin');
  }
  await browserValue(browser, `localStorage.setItem('fs_user','Synthetic Admin');localStorage.setItem('fs_userlist',JSON.stringify([{name:'Synthetic Admin',role:'admin'}]));true`);
  await browser.send('Page.navigate',{url:`http://127.0.0.1:${s.port}/`});
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = JSON.parse(await browserValue(browser, `JSON.stringify({ready:document.readyState,bridge:!!(window.__fsJobSync&&window.__fsJobSync.ready)})`));
    if (state.ready === 'complete' && state.bridge) break;
    await sleep(25);
    if (attempt === 99) assert.fail('job bridge did not become ready before legacy-warning inspection');
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = JSON.parse(await browserValue(browser, `JSON.stringify({central:window.__fsCentralReady===true,permission:window.__fsPermissionReady===true})`));
    if (state.central && state.permission) break;
    await sleep(25);
    if (attempt === 99) assert.fail('synthetic central and permission readiness did not complete before legacy-warning inspection');
  }
  const result = await browserValue(browser, `(async function () {
    currentUser='Synthetic Admin';
    userList=[{name:'Synthetic Admin',role:'admin'}];
    records=[{id:'${id}',customer:'Synthetic warning customer',brand:'Synthetic warning brand',createdBy:'Synthetic Admin',createdAt:1,rows:[]}];
    chats=[{jobId:'${id}',createdAt:1,createdBy:'Synthetic Admin',messages:[],parts:[],approvals:{}}];
    window.openedRecordIds=[];
    var originalOpenRecordPopup=window.openRecordPopup;
    window.openRecordPopup=function(recordId){window.openedRecordIds.push(recordId);return originalOpenRecordPopup.apply(this,arguments);};
    await sbPush();
    var status=document.getElementById('fsJobSyncStatus');
    var button=status&&status.querySelector('button[aria-label="เปิดตรวจสอบใบงาน ${id}"]');
    var visible=!!status&&!status.hidden;
    var hasButton=!!button;
    var label=button&&button.getAttribute('aria-label');
    if(button)button.click();
    var opened=window.openedRecordIds.slice();
    chats=[];
    await sbPush();
    return {visible:visible,button:hasButton,label:label,opened:opened,cleared:!!status&&status.hidden,clearedText:status&&status.textContent};
  }())`);
  assert.equal(result.visible,true,'a suppressed legacy write must show a warning');
  assert.equal(result.button,true,'the warning must expose a direct record action for its affected ID');
  assert.equal(result.label,`เปิดตรวจสอบใบงาน ${id}`);
  assert.deepEqual(result.opened,[id],'the rendered warning action must open the exact affected record');
  assert.equal(result.cleared,true,'the warning must disappear after the protected legacy state is cleared');
  assert.equal(result.clearedText,'','clearing a warning must not leave stale controls or job IDs');
});

test('independent PD parent preservation oracle rejects unrelated data loss', async t => {
  const expected = {...job('A03998'),createdAt:1,salesOwner:'Original owner',ownerEmail:'owner@example.test',notes:'Original parent notes',phone:'Original phone',
    rows:[{num:1,name:'First ingredient',w:55,p:100,actual:10,note:'Original first note'},
      {num:2,name:'Untouched ingredient',w:20,p:100,actual:20,note:'Original second note'}]};
  const valid = {...structuredClone(expected),lastActivityAt:50}, bounds = {min:40,max:60};
  assertExpectedPdParent(valid,expected,bounds,'complete valid parent');
  for (const [label,corrupt] of [
    ['dropped untouched ingredient',data=>data.rows.splice(1,1)],
    ['changed ingredient note',data=>{data.rows[0].note='Unexpected replacement';}],
    ['changed unrelated parent field',data=>{data.phone='Unexpected replacement';}],
  ]) await t.test(label,()=>{
    const candidate = structuredClone(valid); corrupt(candidate);
    assert.throws(()=>assertExpectedPdParent(candidate,expected,bounds,label),/preserve original parent/,'the independent assertion must reject '+label);
  });
});

test('real Chromium mobile synthetic PD saves through main Chat Message cards and handler-opened Modify compatibility with durable reload readback', async t => {
  const name = 'Synthetic PD', id = 'A03998';
  const approvalRows = [
    {job_id:id,part:'ra',data:{by:'Synthetic RA',at:'Original RA approval',unknown:{keep:[null,false]}}},
    {job_id:id,part:'sales',data:{by:'Different Sales Owner',at:'Original Sales approval'}},
  ];
  const approvalsBefore = structuredClone(approvalRows);
  let diagnosticAssetDir;
  if(process.env.FORMULA_SCOPED_RECEIPT_DIAGNOSTICS==='1') {
    diagnosticAssetDir=await mkdtemp(join(tmpdir(),'scoped-receipt-diagnostic-'));t.after(()=>rm(diagnosticAssetDir,{recursive:true,force:true}));
    for(const file of await readdir(join(root,'runtime/assets')))await copyFile(join(root,'runtime/assets',file),join(diagnosticAssetDir,file));
    let instrumented=await readFile(join(diagnosticAssetDir,'fs-job-sync.js'),'utf8');
    instrumented=instrumented.replace('    var targetedOpenSequence=0, targetedRooms=Object.create(null), targetedOpenWork=null;',`    var targetedOpenSequence=0, targetedRooms=Object.create(null), targetedOpenWork=null;
    window.__testScopedTrace=[];window.__testScopedReceipt=function(stage,id){var r=records.find(function(row){return row.id===id;}),marker=document.getElementById('fxStateChat');window.__testScopedTrace.push({stage:stage,id:id,receipt:receipts[id]?{type:typeof receipts[id],matchesCurrent:!!r&&receipts[id]===json(r)}:null,queue:queue[id]?queue[id].status:null,notice:notices[id]||null,actor:actor,currentUser:currentUser,readOnly:!!readOnlyChatRooms[id],targeted:targetedRooms[id]||null,state:state(id),matchesConfirmed:!!r&&json(confirmed[id])===json(r),marker:marker?{text:marker.textContent,html:marker.outerHTML}:null});};`);
    instrumented=instrumented.replace('      var sequence=++targetedOpenSequence, owner=currentUser',"      window.__testScopedReceipt('open-before',id);var sequence=++targetedOpenSequence, owner=currentUser");
    instrumented=instrumented.replace('      var result = render.apply(this,arguments);',"      if(chatOpenId)window.__testScopedReceipt('render-before',chatOpenId);var result = render.apply(this,arguments);if(chatOpenId)window.__testScopedReceipt('render-after',chatOpenId);");
    await writeFile(join(diagnosticAssetDir,'fs-job-sync.js'),instrumented);
  }
  const s = await stack(t,{assetDir:diagnosticAssetDir,intake:true,users:[{name,data:{name,role:'pd',email:'pd@example.test'}},{name:'Synthetic Admin',data:{name:'Synthetic Admin',role:'admin',email:'admin@example.test'}}],approvals:approvalRows});
  s.edit(true);
  const original = {id,customer:'Synthetic existing PD customer',brand:'Synthetic existing PD brand',form:'capsule',size:'',uw:'',conceptStr:'',allConcepts:[],allBenefits:[],allSP:[],finalTarget:'',gender:'',price:'',notes:'Original notes',cons:[],metaDate:'10/10/2026',date:'10/10/2026',
    createdBy:'Different Sales Owner',salesOwner:'Different Sales Owner',ownerEmail:'owner@example.test',createdAt:1,
    rows:[{num:1,name:'D-Ribose',w:10,o:'base',p:100,actual:10,note:'Original ingredient note',hero:false,fda:{icon:'⚪'}},
      {num:2,name:'Vitamin C',w:20,o:'base',p:100,actual:20,note:'',hero:false,fda:{icon:'⚪'}}]};
  // Static expected values come from this synthetic fixture's known inputs,
  // independently of the runtime request, ACK, server map and render helpers.
  const unknownFda = {status:'unknown',icon:'⚪',cls:'fda-unknown',tip:'"D-Ribose" ไม่พบในฐานข้อมูล อย. ไทย — ตรวจสอบเพิ่มเติมกับ อย. ก่อนขึ้นทะเบียน'};
  const vitaminFda = {status:'ok',icon:'🟢',cls:'fda-ok',tip:'🟢 อนุมัติ: Vitamin C (วิตามินซี)\nใช้จริง: 20.00 mg | ขีดจำกัด: 1000 mg/วัน\nประกาศ ฉบับที่ 448 (2566) มีผล 4 ม.ค. 2567 — สูงสุด 1,000 mg/วัน'};
  const expectedParent = surface => {
    const expected = structuredClone(original);
    expected.rows[0] = {...expected.rows[0],w:surface==='modify'?55:65,actual:surface==='modify'?10:65,fda:structuredClone(unknownFda)};
    expected.rows[1].fda = structuredClone(vitaminFda);
    return {...expected,rdUpdated:true,benefits:[],cons:['ไม่มีข้อจำกัดพิเศษ'],heroes:structuredClone(expected.rows),
      totW:surface==='modify'?75:85,totA:surface==='modify'?30:85,
      fda:{notApproved:[],overLimit:[],unknown:[structuredClone(expected.rows[0])],allOk:[structuredClone(expected.rows[1])]}};
  };
  let acceptedExpectation = null, acceptedBounds = null;
  s.records.set(id,structuredClone(original));
  const oldMessages = [1,2].map(ts=>({uid:'pd-old-'+ts,type:'msg',user:'Different Sales Owner',text:'Original old PD chat message '+ts,ts,unknown:{exact:[false,null,'🧪']}}));
  const room = jobId=>({jobId,createdAt:1,createdBy:'Different Sales Owner',parts:[],approvals:{pd:null,ra:null,rd:null,sales:null}});
  const excluded = ['A03997','A03999'].map((jobId,i)=>({...room(jobId),unknown:{retained:[null,false,{value:i}]},
    approvals:{pd:{by:'Retained approver',at:'Original excluded approval'},ra:null,rd:null,sales:null},
    messages:[{uid:'pd-retained-'+i,type:'msg',user:'Retained author',text:'RETAINED_EXCLUDED_'+i,ts:7+i,unknown:{keep:['exact',null]}}]}));
  s.archives.set(excluded[0].jobId,{...job(excluded[0].jobId),createdBy:'Archived owner'});
  s.scopeRows.fs_chats.push({job_id:id,data:room(id)});
  for (const savedRoom of excluded) s.scopeRows.fs_chats.push({job_id:savedRoom.jobId,data:room(savedRoom.jobId)});
  for (const [jobId,messages] of [[id,oldMessages],...excluded.map(c=>[c.jobId,c.messages])]) {
    for (const message of messages) s.scopeRows.fs_messages.push({job_id:jobId,uid:message.uid,ts:message.ts,data:structuredClone(message)});
  }
  const excludedBefore = structuredClone({archives:[...s.archives],chats:s.scopeRows.fs_chats.filter(c=>c.job_id!==id),messages:s.scopeRows.fs_messages.filter(m=>m.job_id!==id)});
  const browser = await actualBrowser(t,'about:blank'); if (!browser) return;
  await browser.send('Page.enable'); await browser.send('Runtime.enable'); await browser.send('Network.enable');
  await browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await browser.send('Emulation.setTouchEmulationEnabled',{enabled:true});
  await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__testMobileEvents=[];['touchstart','touchend','click'].forEach(type=>document.addEventListener(type,event=>{const el=event.target.closest?.('[onclick],input');window.__testMobileEvents.push({type,at:performance.now(),tag:el?.tagName,id:el?.id,action:el?.getAttribute('onclick'),status:document.getElementById('fxStateChat')?.textContent});},true));`});
  await browser.send('Network.setBlockedURLs',{urls:['https://*']});
  const origin = `http://127.0.0.1:${s.port}`;
  // Seed only pre-existing disk evidence before ordinary application startup.
  await browser.send('Page.navigate',{url:origin+'/__formula/chat-recovery'});
  await waitForBrowserState(browser,'!!window.__fsChatRecovery',Boolean,'recovery seeding page must load');
  await browserValue(browser,`localStorage.setItem('fs_chats',${JSON.stringify(JSON.stringify(excluded))});true`);
  const value = Buffer.from(JSON.stringify({name,role:'pd',email:'pd@example.test',centralUserId:'synthetic-central-pd',exp:Date.now()+300_000})).toString('base64url');
  await browser.send('Network.setCookie',{name:'fs_session',value:`${value}.${createHmac('sha256',secret).update(value).digest('base64url')}`,url:origin+'/'});
  const navigate = async phase => {
    await browser.send('Page.navigate',{url:origin+'/?pd-acceptance='+phase});
    await waitForBrowserState(browser,`({phase:location.search,ready:window.__fsCentralReady===true,permission:window.__fsPermissionReady===true,actor:typeof currentUser==='undefined'?'':currentUser,role:typeof currentRole==='function'?currentRole():'',canEdit:typeof sbCanEdit==='undefined'?false:sbCanEdit,rooms:typeof chats==='undefined'?[]:chats.map(c=>c.jobId)})`,
      state=>state.phase==='?pd-acceptance='+phase&&state.ready&&state.permission&&state.actor===name&&state.role==='pd'&&state.canEdit,'ordinary PD startup must apply the matching real server session/profile');
    assert.deepEqual(await browserValue(browser,'records.map(r=>r.id)'),[id],'archived and unexplained parents never resurrect');
    assert.deepEqual(await browserValue(browser,'chats.map(c=>c.jobId)'),[id],'only current-parent chat enters ordinary scope');
  };
  const assertPreserved = async phase => {
    const stored = s.records.get(id);
    if (acceptedExpectation) assertExpectedPdParent(stored,acceptedExpectation,acceptedBounds,phase);
    else assert.deepEqual(stored,original,phase+': complete original parent stays exact before any Save');
    for (const key of ['createdBy','salesOwner','ownerEmail','createdAt','notes']) assert.deepEqual(stored[key],original[key],phase+': owner/original metadata stays exact');
    assert.deepEqual(approvalRows,approvalsBefore,phase+': separate existing approvals stay exact');
    assert.deepEqual({archives:[...s.archives],chats:s.scopeRows.fs_chats.filter(c=>c.job_id!==id),messages:s.scopeRows.fs_messages.filter(m=>m.job_id!==id)},excludedBefore,phase+': excluded server rows stay exact');
    for (const message of oldMessages) assert.deepEqual(s.scopeRows.fs_messages.find(m=>m.uid===message.uid)?.data,message,phase+': durable old messages stay exact');
    const journals = await browserValue(browser,`Object.keys(localStorage).filter(k=>k.startsWith('fs_chat_journal_v2:')).map(k=>JSON.parse(localStorage.getItem(k)))`);
    for (const savedRoom of excluded) {
      const {messages,...metadata} = savedRoom;
      assert.deepEqual(journals.find(row=>row.kind==='unclassified-room'&&row.jobId===savedRoom.jobId)?.data,metadata,phase+': complete retained room survives locally');
      assert.deepEqual(journals.find(row=>row.kind==='unclassified-message'&&row.jobId===savedRoom.jobId)?.message,messages[0],phase+': complete retained message survives locally');
    }
    assert.equal(await browserValue(browser,`document.body.textContent.includes('RETAINED_EXCLUDED_')`),false,'retained excluded payload is not exposed in normal UI');
  };
  const click = async selector => {
    const target = await browserValue(browser,`(async()=>{let el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;el.scrollIntoView({block:'center',inline:'center'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;const rect=el.getBoundingClientRect(),style=getComputedStyle(el);const layoutX=rect.left+rect.width/2,layoutY=rect.top+rect.height/2,x=layoutX-visualViewport.offsetLeft,y=layoutY-visualViewport.offsetTop;return {x,y,width:rect.width,height:rect.height,action:el.getAttribute('onclick'),eventsBefore:window.__testMobileEvents.length,display:style.display,visibility:style.visibility,inViewport:x>=0&&x<visualViewport.width&&y>=0&&y<visualViewport.height,hit:document.elementFromPoint(layoutX,layoutY)?.closest('[onclick]')===el};})()`);
    assert.ok(target,'visible UI control must exist: '+selector);
    assert.ok(target.width>0&&target.height>0&&target.display!=='none'&&target.visibility==='visible'&&target.inViewport&&target.hit,'mobile control must be visible and tappable: '+selector+' '+JSON.stringify(target));
    // CDP touches use the visual viewport; DOM rects use the layout viewport.
    // Focus on a low mobile input can scroll visualViewport independently.
    await browser.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:target.x,y:target.y}]});
    await browser.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    // A real delta can detach the original touch target before touchend.
    // Chromium still dispatches the requested click; detached touchend need
    // not bubble to document. Require the observed native start and click.
    await waitForBrowserState(browser,`['touchstart','click'].every(type=>window.__testMobileEvents.slice(${target.eventsBefore}).some(event=>event.type===type&&event.action===${JSON.stringify(target.action)}))`,Boolean,'actual mobile touch must dispatch the requested UI click');
  };
  const oldChat = async (role='pd') => {
    await click('#sideChat');
    if (await browserValue(browser,'chatOpenId!==null')) await click('#chatContent button[onclick="backToChatList()"]');
    await waitForBrowserState(browser,"document.getElementById('chatView').classList.contains('on')&&!!document.querySelector('#chatContent .chat-list')",Boolean,'normal Chat Message navigation must show the main room-card list');
    const deletion = await browserValue(browser,`Array.from(document.querySelectorAll('#chatContent .job-del[onclick]')).filter(el=>el.getBoundingClientRect().width>0&&getComputedStyle(el).visibility==='visible').map(el=>el.getAttribute('onclick'))`);
    if (role==='pd') assert.deepEqual(deletion,[],'PD mobile main Chat Message list must expose no unauthorized delete action');
    else assert.ok(deletion.length>0,'Admin mobile main list may present its authorized Delete action without tapping it');
    await click(`#chatContent .chat-list button.chat-item[onclick="openChatRoom('${id}')"]`);
    await waitForBrowserState(browser,`({open:chatOpenId,text:document.getElementById('chatContent').textContent,editor:!!document.getElementById('cfin-0-w')})`,state=>state.open===id&&state.editor&&oldMessages.every(m=>state.text.includes(m.text)),'normal opening must render the existing old chat and PD editor');
    t.diagnostic(role+': actual mobile main Chat Message room-card touch opened existing history; Delete was not tapped');
    const current = await browserValue(browser,`getChat('${id}')`);
    for (const message of oldMessages) assert.deepEqual(current.messages.find(m=>m.uid===message.uid),message,'old rendered message retains all fields');
    for (const row of approvalsBefore) assert.deepEqual(current.approvals[row.part],row.data,'split approvals load into the existing room');
    await click('#chatContent button[onclick="backToChatList()"]');
    if (!await browserValue(browser,"document.getElementById('chatGroup').classList.contains('open')")) await click('#sideChat');
    await click(`#chatJobLinks button[onclick="openChatRoom('${id}')"]`);
    await waitForBrowserState(browser,`({open:chatOpenId,text:document.getElementById('chatContent').textContent,editor:!!document.getElementById('cfin-0-w')})`,state=>state.open===id&&state.editor&&oldMessages.every(m=>state.text.includes(m.text)),'sidebar shortcut must independently open the intended old room and editor');
    const shortcutRoom=await browserValue(browser,`getChat('${id}')`);
    for (const message of oldMessages) assert.deepEqual(shortcutRoom.messages.find(m=>m.uid===message.uid),message,'sidebar opening retains every original message field');
    for (const row of approvalsBefore) assert.deepEqual(shortcutRoom.approvals[row.part],row.data,'sidebar opening retains split approvals');
    t.diagnostic(role+': actual mobile sidebar room shortcut also opened existing history after ordinary Back/list; Delete was not tapped');
  };
  const modify = async () => {
    // This sealed version exposes the Modify view through this existing view
    // handler, but has no sidebar link. Exercise its actual rendered list next.
    await browserValue(browser,"switchView('modify');true");
    await click(`#modContent button[onclick="openModifyRecord('${id}')"]`);
    await waitForBrowserState(browser,"!!document.getElementById('mdin-0-w')",Boolean,'handler-opened Modify compatibility must render its existing editor');
  };
  const editWeight = async (inputId,weight) => {
    await browserValue(browser,`(()=>{const input=document.getElementById(${JSON.stringify(inputId)});input.focus();input.select();return true;})()`);
    await browser.send('Input.insertText',{text:String(weight)});
    await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  };
  const successfulActivities = () => [...s.activities.values()].filter(row=>row.data?.job===id&&row.data?.cat==='formula');
  const recordWrites = () => s.writes.filter(w=>w.path==='/rpc/fs_save_record');
  const readRow = async table => browserValue(browser,`fetch('/sb/rest/v1/'+${JSON.stringify(table)},{credentials:'same-origin'}).then(r=>{if(!r.ok)throw Error('authenticated readback failed');return r.json();})`);
  await navigate('startup');
  assert.deepEqual(s.records.get(id),original,'startup must not change the original formula');
  await oldChat();
  assert.deepEqual(s.records.get(id),original,'opening old chat only changes expected participant/seen metadata');
  await assertPreserved('startup/old-chat');
  const committed = [];
  for (const [surface,weight,inputId,statusId,saveSelector,action] of [
    ['modify',55,'mdin-0-w','fxStateMod',"#modContent button[onclick='saveModifyFormula()']",'แก้สูตร (PD Modify Data)'],
    ['chat',65,'cfin-0-w','fxStateChat',`#chatContent button[onclick="saveChatFormula('${id}')"]`,'แก้สูตรในห้องแชท (กดบันทึก)'],
  ]) {
    if (surface==='modify') await modify(); else await oldChat();
    const baseline = structuredClone(s.records.get(id));
    if (acceptedExpectation) assertExpectedPdParent(baseline,acceptedExpectation,acceptedBounds,surface+': independent pre-Save baseline');
    else assert.deepEqual(baseline,original,'first Save starts from complete original parent');
    const intended = expectedParent(surface), movementMin = await browserValue(browser,'nowTs()');
    const writesBefore = recordWrites().length, activitiesBefore = successfulActivities().length, acksBefore = s.recordAcks.length;
    const messagesBefore = s.scopeRows.fs_messages.filter(m=>m.job_id===id).length;
    await editWeight(inputId,weight);
    assert.equal(await browserValue(browser,`records.find(r=>r.id==='${id}').rows[0].w`),baseline.rows[0].w,'typing/blur must not mutate authoritative browser formula');
    assert.deepEqual(s.records.get(id),baseline,'typing/blur must not mutate central formula');
    assert.equal(recordWrites().length,writesBefore,'typing/blur must not issue record save');
    assert.equal(successfulActivities().length,activitiesBefore,'typing/blur cannot create success Activity');
    assert.equal(s.scopeRows.fs_messages.filter(m=>m.job_id===id).length,messagesBefore,'typing cannot create a formula system message');
    const releaseAck = s.holdRecordAck(); t.after(releaseAck);
    try {
      await click(saveSelector);
      try {
        await waitForBrowserState(browser,`({marker:document.getElementById('${statusId}')?.textContent||'',pending:document.getElementById('fsJobSyncStatus')?.textContent||'',visible:document.getElementById('fsJobSyncStatus')?.hidden===false,open:chatOpenId})`,state=>surface==='modify' ? state.marker==='กำลังบันทึก…' : state.open===id&&state.marker==='กำลังบันทึก…'&&state.visible&&/ใบงานรอการบันทึก/.test(state.pending),surface+': explicit Save must remain visibly pending before exact ACK');
      } catch(error) {
        t.diagnostic('mobile save failure='+JSON.stringify(await browserValue(browser,`({surface:${JSON.stringify(surface)},events:window.__testMobileEvents,dialogs:${JSON.stringify(browser.dialogs)},actor:currentUser,role:currentRole(),sbReady,sbCanEdit,sbErr,central:window.__fsCentralReady,permission:window.__fsPermissionReady,pending:Object.keys(localStorage).filter(k=>k.startsWith('fs_job_outbox_v1:')).map(k=>JSON.parse(localStorage.getItem(k))),open:chatOpenId,weight:records.find(r=>r.id==='${id}')?.rows[0].w,chatWeight:document.getElementById('cfin-0-w')?.value})`)));
        throw error;
      }
      for (let attempt=0;attempt<200&&recordWrites().length===writesBefore;attempt++) await sleep(25);
      assert.equal(recordWrites().length,writesBefore+1,'explicit Save issues exactly one durable RPC');
      assert.equal(s.records.get(id).rows[0].w,weight,'synthetic server commits the requested nested formula');
      assert.equal(s.recordAcks.length,acksBefore,'the changed revision is not ACKed while response is held');
      assert.equal(successfulActivities().length,activitiesBefore,'success Activity must wait for exact parent ACK');
      assert.equal(await browserValue(browser,`activities.filter(a=>a.job==='${id}'&&a.action===${JSON.stringify(action)}).length`),0,'browser success Activity also waits for ACK');
    } finally { releaseAck(); }
    try {
    await waitForBrowserState(browser,`({ready:window.__fsCentralReady===true,error:sbErr,permission:window.__fsPermissionReady,busy:sbBusy,pending:Object.keys(localStorage).filter(k=>k.startsWith('fs_job_outbox_v1:')),statusHidden:document.getElementById('fsJobSyncStatus')?.hidden})`,state=>state.ready&&state.pending.length===0&&state.statusHidden,surface+': exact ACK must clear the durable pending journal and visible pending status');
    } catch(error){t.diagnostic('post-ACK-denials='+JSON.stringify(browser.responses.filter(response=>response.status>=400)));throw error;}
    // The verified room now remains visible while mutation is gated by the
    // pending parent ACK. Reopen through real navigation to inspect the receipt.
    if (surface==='chat') await oldChat();
    if(process.env.FORMULA_SCOPED_RECEIPT_DIAGNOSTICS==='1')t.diagnostic('scoped-receipt-trace='+JSON.stringify(await browserValue(browser,'window.__testScopedTrace')));
    await waitForBrowserState(browser,`document.getElementById('${statusId}')?.textContent||''`,text=>text==='บันทึกแล้ว',surface+': exact ACK must expose its saved receipt');
    for (let attempt=0;attempt<200&&successfulActivities().length!==activitiesBefore+1;attempt++) await sleep(25);
    assert.equal(successfulActivities().length,activitiesBefore+1,'one durable success Activity follows exact ACK');
    const saved = structuredClone(s.records.get(id));
    const movementBounds = {min:movementMin,max:await browserValue(browser,'nowTs()')};
    assertExpectedPdParent(saved,intended,movementBounds,surface+': independent post-Save expected parent');
    acceptedExpectation=intended; acceptedBounds=movementBounds; committed.push(saved);
    assert.deepEqual(s.recordAcks.at(-1),{status:'saved',id,data:saved},'exact ACK contains the complete committed parent JSON');
    assert.deepEqual(recordWrites().at(-1).body.p_data,saved,'server map equals complete immutable requested revision');
    const revisions = recordWrites().slice(writesBefore), acks = s.recordAcks.slice(acksBefore);
    assert.deepEqual(revisions[0].body.p_expected,baseline,'first formula CAS uses the prior complete authoritative revision');
    assert.equal(acks.length,revisions.length,'every committed revision receives its exact ACK');
    const business = data => { const copy=structuredClone(data); delete copy.lastActivityAt; return copy; };
    for (let index=0;index<revisions.length;index++) {
      const revision = revisions[index].body;
      assert.deepEqual(acks[index],{status:'saved',id,data:revision.p_data},'each parent revision has an exact ACK');
      if (index) {
        assert.deepEqual(revision.p_expected,revisions[index-1].body.p_data,'follow-up CAS uses the exact previous revision');
        assert.deepEqual(business(revision.p_data),business(revisions[0].body.p_data),'success Activity follow-up changes only lastActivityAt');
      }
    }
    t.diagnostic(surface+': formula revisions='+revisions.length+'; formula first CAS and metadata-only follow-up ACK chain exact');
    const readbackParent=(await readRow('fs_records')).find(row=>row.id===id)?.data;
    assertExpectedPdParent(readbackParent,intended,movementBounds,surface+': independent authenticated GET');
    assert.deepEqual(readbackParent,saved,'authenticated GET reads the exact saved parent');
    const activity = successfulActivities().at(-1);
    assert.equal(activity.data.action,action); assert.equal(activity.data.user,name); assert.equal(activity.data.role,'pd');
    assert.deepEqual(await readRow('fs_activities?uid=eq.'+encodeURIComponent(activity.uid)),[],'PD retains the existing restriction on reading the admin Activity feed');
    const durableActivity = await (await fetch(s.upstreamOrigin+'/fs_activities?uid=eq.'+encodeURIComponent(activity.uid))).json();
    assert.deepEqual(durableActivity[0],activity,'success Activity survives durable upstream GET without granting PD admin feed access');
    const requests=s.upstreamRequests, saveIndex=requests.findIndex(r=>r.path==='/rpc/fs_save_record'&&stable(r.body.p_data)===stable(revisions[0].body.p_data));
    const activityIndex=requests.findLastIndex(r=>r.path==='/fs_activities'&&r.method==='POST');
    assert.ok(activityIndex>saveIndex,'Activity request follows the exact acknowledged formula save; later movement-only revisions remain separate');
    if (surface==='chat') {
      const newMessages=s.scopeRows.fs_messages.filter(m=>m.job_id===id&&!oldMessages.some(old=>old.uid===m.uid));
      assert.equal(newMessages.length,1,'chat Save adds one durable formula system message');
      assert.equal(newMessages[0].data.type,'sys');
      assert.match(newMessages[0].data.text,/Synthetic PD บันทึกการแก้สูตร:.*55\.00 → 65\.00/);
      assert.deepEqual((await readRow('fs_messages')).find(row=>row.uid===newMessages[0].uid),newMessages[0],'durable new child reads back with exact primary UID/payload');
    }
    await assertPreserved(surface+' saved');
    await navigate(surface+'-reload');
    const reloadedParent=await browserValue(browser,`records.find(r=>r.id==='${id}')`);
    assertExpectedPdParent(reloadedParent,intended,movementBounds,surface+': independent reload expected parent');
    assert.deepEqual(reloadedParent,saved,'ordinary reload reads the exact acknowledged parent');
    await oldChat();
    assert.equal(await browserValue(browser,"document.getElementById('cfin-0-w').value"),weight.toFixed(2),'reopened chat editor reads saved weight');
    if (surface==='modify') {
      await modify();
      assert.equal(await browserValue(browser,"document.getElementById('mdin-0-w').value"),weight.toFixed(2),'reopened PD Modify reads saved weight');
    } else assert.match(await browserValue(browser,"document.getElementById('chatContent').textContent"),/Synthetic PD บันทึกการแก้สูตร:.*55\.00 → 65\.00/,'normal reload renders the durable formula message');
    await assertPreserved(surface+' reload');
  }
  // A signed, matching synthetic Admin session reproduces the role where
  // Delete is legitimately visible. The same mobile room entry must open;
  // never tap Delete or override the application's actor/permission state.
  const adminValue=Buffer.from(JSON.stringify({name:'Synthetic Admin',role:'admin',email:'admin@example.test',centralUserId:'synthetic-central-admin',exp:Date.now()+300_000})).toString('base64url');
  await browser.send('Network.setCookie',{name:'fs_session',value:`${adminValue}.${createHmac('sha256',secret).update(adminValue).digest('base64url')}`,url:origin+'/'});
  await browser.send('Page.navigate',{url:origin+'/?pd-acceptance=admin-mobile'});
  await waitForBrowserState(browser,"({actor:typeof currentUser==='undefined'?'':currentUser,role:typeof currentRole==='function'?currentRole():'',ready:window.__fsCentralReady===true})",state=>state.actor==='Synthetic Admin'&&state.role==='admin'&&state.ready,'ordinary server-authenticated Admin mobile reload must apply its matching profile');
  await oldChat('admin');
  assert.deepEqual(s.records.get(id),committed.at(-1),'opening as Admin changes no business formula');
  await assertPreserved('Admin mobile old-chat');
  assert.equal(committed.length,2,'both explicit formula Saves commit their requested business values');
  assert.deepEqual(browser.dialogs,[],'legitimate PD path encounters no permission or error dialog');
  assert.deepEqual(browser.exceptions,[],'legitimate PD path has no uncaught JavaScript exception');
  t.diagnostic('synthetic PD: visible tappable mobile old-chat UI and handler-opened Modify compatibility only; ordinary server session/profile; both exact parent ACKs; durable child/Activities; reload readback; originals preserved. Modify user-navigation reachability is not proved; actual production PD acceptance remains deferred.');
});

test('formula edits stay local until explicit Save and survive a redraw before central acknowledgement', async t => {
  const s = await stack(t);
  const id = 'A03992';
  const original = {id, customer:'Synthetic explicit-save customer', brand:'Synthetic explicit-save brand', form:'capsule', size:'', uw:'', conceptStr:'', allConcepts:[], allBenefits:[], allSP:[], finalTarget:'', gender:'', price:'', notes:'', cons:[], metaDate:'10/10/2026', createdBy:'Synthetic Admin', createdAt:1,
    rows:[{name:'Base ingredient',w:10,o:'base',p:100,actual:10,note:''},{name:'Second ingredient',w:20,o:'base',p:100,actual:20,note:''}]};
  s.records.set(id, structuredClone(original));
  s.edit(true);
  const browser = await actualBrowser(t, `http://127.0.0.1:${s.port}/`);
  if (!browser) return;
  await browser.send('Page.enable'); await browser.send('Runtime.enable'); await browser.send('Network.enable');
  const value = Buffer.from(JSON.stringify({name:'Synthetic Admin', role:'admin', centralUserId:'synthetic-central-admin', exp:Date.now()+60_000})).toString('base64url');
  const signed = `${value}.${createHmac('sha256',secret).update(value).digest('base64url')}`;
  await browser.send('Network.setCookie',{name:'fs_session',value:signed,url:`http://127.0.0.1:${s.port}/`});
  for (let attempt = 0; attempt < 100; attempt++) {
    const origin = await browserValue(browser, 'location.origin');
    if (origin === `http://127.0.0.1:${s.port}`) break;
    await sleep(25); if (attempt === 99) assert.fail('synthetic Formula page did not reach its local origin');
  }
  await browserValue(browser, `localStorage.setItem('fs_user','Synthetic Admin'); localStorage.setItem('fs_userlist', JSON.stringify([{name:'Synthetic Admin',role:'admin'}])); true`);
  await browser.send('Page.navigate',{url:`http://127.0.0.1:${s.port}/`});
  for (let attempt = 0; attempt < 100; attempt++) {
    const ready = JSON.parse(await browserValue(browser, `JSON.stringify({ready:document.readyState,bridge:!!(window.__fsJobSync&&window.__fsJobSync.ready)})`));
    if (ready.ready === 'complete' && ready.bridge) break;
    await sleep(25); if (attempt === 99) assert.fail('job bridge did not become ready before explicit-save test');
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    const centralReady = await browserValue(browser, `window.__fsCentralReady === true`);
    if (centralReady) break;
    await sleep(25); if (attempt === 99) assert.fail('synthetic central baseline did not become ready before explicit-save test');
  }
  const writesBefore = s.writes.filter(write => write.path === '/rpc/fs_save_record' || write.path === '/fs_activities').length;
  const draftState = JSON.parse(await browserValue(browser, `JSON.stringify((function(){
    var data=${JSON.stringify(original)};
    sbApply({full:true,partial:false,rec:[{id:'${id}',data:data}],cht:[],usr:[],act:[],msg:[],apv:[]});
    currentUser='Synthetic Admin'; userList=[{name:'Synthetic Admin',role:'admin'}]; sbReady=true; sbCanEdit=true;
    chats.push({jobId:'${id}',createdAt:1,createdBy:'Synthetic Admin',messages:[],parts:[],approvals:{pd:null,ra:null,rd:null,sales:null}});
    chatOpenId='${id}'; chatJobOpen=true; renderChat();
    var name=document.getElementById('cfin-0-name'), w=document.getElementById('cfin-0-w');
    name.value='Vitamin C'; name.dispatchEvent(new Event('input',{bubbles:true})); name.dispatchEvent(new Event('change',{bubbles:true})); name.dispatchEvent(new Event('blur',{bubbles:true}));
    w.value='55'; w.dispatchEvent(new Event('input',{bubbles:true})); w.dispatchEvent(new Event('change',{bubbles:true})); w.dispatchEvent(new Event('blur',{bubbles:true}));
    renderChat();
    var beforeSave=records.find(function(x){return x.id==='${id}';});
    return {record:[beforeSave.rows[0].name,beforeSave.rows[0].w],input:document.getElementById('cfin-0-name').value};
  }()))`));
  assert.deepEqual(draftState.record,['Base ingredient',10], 'blur must not mutate the authoritative browser record');
  assert.equal(draftState.input,'Vitamin C', 'the edited value remains visible in the draft');
  assert.equal(s.writes.filter(write => write.path === '/rpc/fs_save_record' || write.path === '/fs_activities').length, writesBefore, 'blur and redraw must not write a record or Activity');
  const savedState = await browserValue(browser, `(async function(){
    saveChatFormula('${id}'); try { await sbPush(); } catch (error) { return {error:String(error), after:null}; }
    var after=records.find(function(x){return x.id==='${id}';});
    return {after:[after.rows[0].name,after.rows[0].w]};
  })()`);
  assert.equal(savedState.error, undefined, JSON.stringify({savedState,writes:s.writes}));
  assert.deepEqual(savedState.after,['Vitamin C',55], 'explicit Save must commit the complete draft');
  assert.ok(s.writes.some(write => write.path === '/rpc/fs_save_record'), 'explicit Save must use the durable record RPC');
  assert.equal(s.records.get(id).rows[0].name,'Vitamin C');
  assert.equal(s.records.get(id).rows[0].w,55);
});


test('a quota-limited Customer Data form renders reviewable recovery evidence without a production write', async t => {
  const sharedEvidenceDir=join(root,'.superpowers/sdd/2026-10-09-formula-storage-fallback/evidence');
  assert.ok(relative(sharedEvidenceDir,tmpdir()).startsWith('..'),'temporary evidence root must be outside repository evidence');
  const evidenceDir=await mkdtemp(join(tmpdir(),'formula-recovery-evidence-'));
  t.after(()=>rm(evidenceDir,{recursive:true,force:true}));
  assert.ok(relative(sharedEvidenceDir,evidenceDir).startsWith('..'),'screenshots must stay outside repository evidence');
  const s=await stack(t);
  s.edit(true); // Explicit synthetic permission; do not race the startup IAM read.
  const browser=await actualBrowser(t,`http://127.0.0.1:${s.port}/`);
  if(!browser) return;
  const observables=[];
  await browser.send('Page.enable');await browser.send('Runtime.enable');await browser.send('Network.enable');
  const value=Buffer.from(JSON.stringify({name:'Synthetic Sales',role:'sales',centralUserId:'synthetic-central-user',exp:Date.now()+60_000})).toString('base64url');
  const signed=`${value}.${createHmac('sha256',secret).update(value).digest('base64url')}`;
  await browser.send('Network.setCookie',{name:'fs_session',value:signed,url:`http://127.0.0.1:${s.port}/`});
  await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('fs_user','Synthetic Sales');localStorage.setItem('fs_userlist',JSON.stringify([{name:'Synthetic Sales',role:'sales'}]));`});
  await browser.send('Page.navigate',{url:`http://127.0.0.1:${s.port}/`});
  for(let attempt=0;attempt<100;attempt++){
    const state=JSON.parse(await browserValue(browser,`JSON.stringify({ready:document.readyState,bridge:!!(window.__fsJobSync&&window.__fsJobSync.ready)})`));
    if(state.ready==='complete'&&state.bridge)break;
    await sleep(25);if(attempt===99)assert.fail('authenticated synthetic Formula page did not become ready');
  }
  await waitForBrowserState(browser,'window.__fsCentralReady===true && window.__fsPermissionReady===true',Boolean,'quota fixture needs a completed authorized baseline');
  const result=JSON.parse(await browserValue(browser,`JSON.stringify((function(){
    window.alert=function(message){ window.__syntheticRecoveryAlert=String(message); };
    currentUser='Synthetic Sales'; userList=[{name:'Synthetic Sales',role:'sales'}]; sbReady=false;
    var originalFetch=window.fetch;
    window.fetch=async function(url,options){
      if(String(url).indexOf('/rpc/fs_save_record')>=0)return new Response('{}',{status:503});
      return originalFetch.call(this,url,options);
    };
    window.__syntheticRestoreFetch=function(){ window.fetch=originalFetch; };
    var original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){
      if(String(key).indexOf('fs_job_outbox_v1:')===0)throw new DOMException('synthetic quota','QuotaExceededError');
      return original.call(this,key,value);
    };
    records.push({id:'A00001',customer:'Synthetic recovery customer',brand:'Synthetic recovery brand',createdBy:'Synthetic Sales',createdAt:1,rows:[]});
    window._editingRecordId='A00001';
    document.getElementById('f_customer').value='Synthetic recovery customer';
    document.getElementById('f_brand').value='Synthetic recovery brand';
    generateDash();
    return {created:!!document.getElementById('fsJobRecoveryPanel'),alert:window.__syntheticRecoveryAlert||null};
  }()))`));
  assert.equal(result.created,true,'quota create must render a local recovery panel before any central write');
  assert.equal(result.alert,null,'a verified durable fallback must not raise a failure alert while it is pending');
  for(let attempt=0;attempt<100;attempt++){
    const heading=await browserValue(browser,`document.getElementById('fsJobRecoveryHeading') && document.getElementById('fsJobRecoveryHeading').textContent`);
    if(heading==='⚠ เก็บสำเนาใบงานในเครื่องแล้ว')break;
    await sleep(25);if(attempt===99)assert.fail('IndexedDB fallback did not reach its verified staged state');
  }
  const inspect=async({width,height,label})=>{
    await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    const state=JSON.parse(await browserValue(browser,`JSON.stringify((function(){
      var panel=document.getElementById('fsJobRecoveryPanel'),error=document.getElementById('gen_err'),expectedBar=error&&error.parentElement,download=document.getElementById('fsJobRecoveryDownload'),heading=document.getElementById('fsJobRecoveryHeading');
      if(panel)panel.scrollIntoView({block:'center'});
      var order=expectedBar?Array.prototype.indexOf.call(expectedBar.children,error)<Array.prototype.indexOf.call(expectedBar.children,panel):false;
      var clear=expectedBar&&Array.from(expectedBar.querySelectorAll('button')).find(function(button){return button.id!=='btnCreate';});
      return {heading:heading&&heading.textContent,status:document.getElementById('fsJobRecoveryStatus')&&document.getElementById('fsJobRecoveryStatus').textContent,
        parentIsCustomerActionBar:!!(panel&&expectedBar&&panel.parentElement===expectedBar&&expectedBar.classList.contains('abar')),
        followsError:order,panelWidth:panel&&Math.round(panel.getBoundingClientRect().width),barWidth:expectedBar&&Math.round(expectedBar.getBoundingClientRect().width),
        button:download&&{width:Math.round(download.getBoundingClientRect().width),height:Math.round(download.getBoundingClientRect().height)},
        overflow:document.documentElement.scrollWidth>window.innerWidth,create:document.getElementById('btnCreate').disabled,clear:clear&&clear.disabled,
        active:document.activeElement&&document.activeElement.id,completeClaim:panel&&/บันทึกแล้ว|สำเร็จ/.test(panel.textContent)};
    }()))`));
    const shot=await browser.send('Page.captureScreenshot',{format:'png'}), file=`task-3-${label}-${width}x${height}.png`;
    assert.ok(shot.result.data.length>1000,'Chromium screenshot must contain rendered recovery evidence');
    await writeFile(join(evidenceDir,file),Buffer.from(shot.result.data,'base64'));
    observables.push({file,width,height,...state});return state;
  };
  const desktop=await inspect({width:1280,height:800,label:'staged-desktop'});
  assert.deepEqual({heading:desktop.heading,status:desktop.status},{heading:'⚠ เก็บสำเนาใบงานในเครื่องแล้ว',status:'ยังไม่ยืนยันในระบบกลาง'});
  assert.equal(desktop.parentIsCustomerActionBar,true);assert.equal(desktop.followsError,true);assert.equal(desktop.overflow,false);assert.equal(desktop.create,true);assert.equal(desktop.clear,true);
  const narrow=await inspect({width:390,height:844,label:'staged-narrow'});
  assert.equal(narrow.parentIsCustomerActionBar,true);assert.equal(narrow.followsError,true);assert.equal(narrow.overflow,false);assert.ok(narrow.button.width>=44&&narrow.button.height>=44);
  assert.equal(narrow.active,'fsJobRecoveryHeading','a user-triggered Create failure must focus the recovery heading once');
  await browser.send('Page.bringToFront');
  for(let attempt=0;attempt<100;attempt++){
    const present=await browserValue(browser,"!!document.getElementById('fsJobRecoveryHeading')");
    if(present)break;
    await sleep(25);
    if(attempt===99){
      assert.fail('recovery heading disappeared before keyboard interaction');
    }
  }
  await browserValue(browser,"document.getElementById('fsJobRecoveryHeading').focus()");
  const press=async(modifiers=0)=>{
    await browser.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9,modifiers});
    await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9,modifiers});
    await sleep(25);
    return browserValue(browser,'document.activeElement&&document.activeElement.id');
  };
  assert.equal(await press(),'fsJobRecoveryDownload','Tab from the programmatic recovery heading must reach Download');
  assert.equal(await press(8),'f_notes','Shift+Tab from Download must return to the preceding editable form field');
  await browserValue(browser,`document.getElementById('fsJobRecoveryDownload').focus();window.dispatchEvent(new Event('online'));`);
  await sleep(20);
  assert.equal(await browserValue(browser,'document.activeElement&&document.activeElement.id'),'fsJobRecoveryDownload','a background online/status update must not steal focus');

  await browserValue(browser,"window.__syntheticRestoreFetch&&window.__syntheticRestoreFetch()");
  s.edit(true);await sleep(3);
  const pending=JSON.parse(await browserValue(browser,`(async function(){
    var realFetch=window.fetch;
    window.fetch=async function(url,options){
      // Keep every authorization/history read real; only suppress write acknowledgements.
      if(!options || !options.method || /^(GET|HEAD)$/i.test(options.method) || String(url).indexOf('/rpc/fs_save_record')>=0)return realFetch.call(this,url,options);
      return new Response('[]',{status:201,headers:{'Content-Type':'application/json'}});
    };
    sbReady=true;await sbPush();
    return JSON.stringify({heading:document.getElementById('fsJobRecoveryHeading')&&document.getElementById('fsJobRecoveryHeading').textContent,status:document.getElementById('fsJobRecoveryStatus')&&document.getElementById('fsJobRecoveryStatus').textContent});
  }())`));
  assert.deepEqual(pending,{heading:'⚠ ระบบกลางรับใบงานแล้ว แต่การบันทึกประวัติยังไม่ครบ',status:'ใบงานนี้ยังไม่เสร็จสมบูรณ์ และยังไม่เปิดใช้งานแชต'});
  const pendingDesktop=await inspect({width:1280,height:800,label:'activity-pending-desktop'});
  assert.equal(pendingDesktop.completeClaim,false);assert.equal(pendingDesktop.create,true);assert.equal(pendingDesktop.clear,true);assert.equal(pendingDesktop.parentIsCustomerActionBar,true);assert.equal(pendingDesktop.followsError,true);
  const pendingNarrow=await inspect({width:390,height:844,label:'activity-pending-narrow'});
  assert.equal(pendingNarrow.completeClaim,false);assert.equal(pendingNarrow.overflow,false);assert.ok(pendingNarrow.button.width>=44&&pendingNarrow.button.height>=44);
  assert.equal(s.records.size,1,'only the synthetic record acknowledgement may reach the isolated gateway before its Activity remains pending');
  await writeFile(join(evidenceDir,'task-3-chromium-observables.json'),JSON.stringify(observables,null,2)+'\n');
});

test('a known ingredient refilled from a template does not throw or unset the ready job bridge', async t => {
  const s = await stack(t);
  const browser = await actualBrowser(t, `http://127.0.0.1:${s.port}/`);
  if (!browser) return;
  await browser.send('Page.enable');
  await browser.send('Runtime.enable');
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = JSON.parse(await browserValue(browser, `JSON.stringify({
      ready: document.readyState,
      bridgeReady: !!(window.__fsJobSync && window.__fsJobSync.ready)
    })`));
    if (result.ready === 'complete' && result.bridgeReady) break;
    await sleep(25);
    if (attempt === 99) assert.fail('job bridge did not become ready before the template interaction');
  }
  const result = JSON.parse(await browserValue(browser, `JSON.stringify((function () {
    loadTemplate('whitening');
    var row = document.querySelector('#ingBody tr');
    var ingredient = row.querySelector('input[list="ing_list"]');
    var inputs = row.querySelectorAll('input');
    inputs[2].value = ''; inputs[3].value = ''; inputs[4].value = '';
    ingredient.value = 'Sodium Ascorbate';
    var error = '';
    try { onIngChange(ingredient, Number(row.id.replace('row_', ''))); }
    catch (caught) { error = String(caught && caught.message || caught); }
    var autofill = {origin: inputs[2].value, purity: inputs[3].value, note: inputs[4].value};
    inputs[2].value = 'Manual origin'; inputs[3].value = '83'; inputs[4].value = 'Manual note';
    try { onIngChange(ingredient, Number(row.id.replace('row_', ''))); }
    catch (caught) { error = error || String(caught && caught.message || caught); }
    try { onIngChange({value:'Sodium Ascorbate'}, 987654); }
    catch (caught) { error = error || String(caught && caught.message || caught); }
    try { onIngChange(null, Number(row.id.replace('row_', ''))); }
    catch (caught) { error = error || String(caught && caught.message || caught); }
    return {
      error: error,
      autofill: autofill,
      origin: row.querySelectorAll('input')[2].value,
      purity: row.querySelectorAll('input')[3].value,
      note: row.querySelectorAll('input')[4].value,
      bridgeReady: !!(window.__fsJobSync && window.__fsJobSync.ready)
    };
  }()))`));
  assert.equal(result.bridgeReady, true, 'the contained ingredient handler exception does not unset the ready bridge');
  assert.equal(result.error, '', 'template/import ingredient input must not throw from an out-of-range field index');
  assert.deepEqual(result.autofill, {origin:'Synthetic / BASF', purity:'99', note:'Buffered – ไม่ระคาย'});
  assert.equal(result.origin, 'Manual origin', 'custom origin is never overwritten');
  assert.equal(result.purity, '83', 'custom purity is never overwritten');
  assert.equal(result.note, 'Manual note', 'custom note is never overwritten');
});

test('a synthetic xlsx File follows the native FileReader import path into known-ingredient autofill', async t => {
  const s = await stack(t);
  const browser = await actualBrowser(t, `http://127.0.0.1:${s.port}/`);
  if (!browser) return;
  await browser.send('Page.enable');
  await browser.send('Runtime.enable');
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = JSON.parse(await browserValue(browser, `JSON.stringify({
      ready: document.readyState,
      bridgeReady: !!(window.__fsJobSync && window.__fsJobSync.ready)
    })`));
    if (state.ready === 'complete' && state.bridgeReady) break;
    await sleep(25);
    if (attempt === 99) assert.fail('job bridge did not become ready before the xlsx import interaction');
  }
  const result = JSON.parse(await browserValue(browser, `(async function () {
    var workbook = {
      SheetNames: ['ข้อมูลสินค้า', 'สารสกัด'],
      Sheets: {
        'ข้อมูลสินค้า': { kind: 'product' },
        'สารสกัด': { kind: 'ingredients' }
      }
    };
    window.XLSX = {
      read: function (bytes, options) {
        window.__xlsxFileReaderEvidence = {
          typedArray: bytes instanceof Uint8Array,
          length: bytes.byteLength,
          type: options.type
        };
        return workbook;
      },
      utils: {
        sheet_to_json: function (sheet, options) {
          if (sheet.kind === 'product') {
            return options && options.header === 1
              ? [['ชื่อลูกค้า', 'ชื่อแบรนด์'], ['Synthetic XLSX Customer', 'Synthetic XLSX Brand']]
              : [];
          }
          return [{
            'ชื่อสาร': 'Sodium Ascorbate',
            'ปริมาณที่ชั่ง (mg)': 250,
            'แหล่งกำเนิด': '',
            'ความเข้มข้น (%)': '',
            'หมายเหตุ': ''
          }];
        }
      }
    };
    var file = new File([new Uint8Array([1, 2, 3])], 'candidate.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    await handleFile(file);
    for (var attempt = 0; attempt < 100; attempt++) {
      if (window.__xlsxFileReaderEvidence && document.querySelector('#ingBody tr')) break;
      await new Promise(function (resolve) { window.setTimeout(resolve, 10); });
    }
    var row = document.querySelector('#ingBody tr');
    if (!row) return JSON.stringify({ timeout: true, evidence: window.__xlsxFileReaderEvidence || null });
    var ingredient = row.querySelector('input[list="ing_list"]');
    var inputs = row.querySelectorAll('input');
    var error = '';
    inputs[2].value = ''; inputs[3].value = ''; inputs[4].value = '';
    ingredient.value = 'Sodium Ascorbate';
    try { onIngChange(ingredient, Number(row.id.replace('row_', ''))); }
    catch (caught) { error = String(caught && caught.message || caught); }
    return JSON.stringify({
      timeout: !window.__xlsxFileReaderEvidence,
      evidence: window.__xlsxFileReaderEvidence || null,
      customer: document.getElementById('f_customer').value,
      brand: document.getElementById('f_brand').value,
      weight: inputs[1].value,
      origin: inputs[2].value,
      purity: inputs[3].value,
      note: inputs[4].value,
      error: error,
      bridgeReady: !!(window.__fsJobSync && window.__fsJobSync.ready)
    });
  }())`));
  assert.equal(result.timeout, false, 'the native FileReader onload route reaches the decoder and creates the imported row');
  assert.deepEqual(result.evidence, {typedArray: true, length: 3, type: 'array'}, 'XLSX.read receives the ArrayBuffer converted by native FileReader');
  assert.equal(result.customer, 'Synthetic XLSX Customer', 'xlsx product fields are retained after import');
  assert.equal(result.brand, 'Synthetic XLSX Brand', 'xlsx product fields are retained after import');
  assert.equal(result.weight, '250', 'xlsx ingredient quantity is retained after import');
  assert.equal(result.error, '', 'known-ingredient edit after xlsx import does not throw');
  assert.deepEqual(
    {origin: result.origin, purity: result.purity, note: result.note},
    {origin: 'Synthetic / BASF', purity: '99', note: 'Buffered – ไม่ระคาย'},
    'known-ingredient edit fills only its blank metadata fields',
  );
  assert.equal(result.bridgeReady, true, 'the import and edit leave the deferred job bridge ready');
});

test('a legacy bridge guard leaves a bootstrap placeholder uninstalled in a real browser', async t => {
  const assetDir = await mkdtemp(join(tmpdir(), 'formula-legacy-job-sync-asset-'));
  t.after(() => rm(assetDir, { recursive: true, force: true }));
  await copyFile(join(root, 'runtime/assets/fs-session-bridge.js'), join(assetDir, 'fs-session-bridge.js'));
  const legacy = jobSyncAsset.replace(
    'if (window.__fsJobSync && window.__fsJobSync.installed) return;',
    'if (window.__fsJobSync) return;',
  );
  assert.notEqual(legacy, jobSyncAsset, 'fixture must preserve the exact pre-fix early-return guard');
  await writeFile(join(assetDir, 'fs-job-sync.js'), legacy);
  const s = await stack(t, { assetDir });
  const browser = await actualBrowser(t, `http://127.0.0.1:${s.port}/`);
  if (!browser) return;
  await browser.send('Page.enable');
  await browser.send('Runtime.enable');
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = JSON.parse(await browserValue(browser, `JSON.stringify({
      ready: document.readyState,
      installed: !!(window.__fsJobSync && window.__fsJobSync.installed),
      bridgeReady: !!(window.__fsJobSync && window.__fsJobSync.ready)
    })`));
    if (state.ready === 'complete') {
      assert.equal(state.installed, false, 'the old guard treats the bootstrap placeholder as an installed bridge');
      assert.equal(state.bridgeReady, false, 'the page remains in the same pending state seen after release');
      return;
    }
    await sleep(25);
  }
  assert.fail('legacy page did not finish loading in Chromium');
});

// The sealed sync cycle awaits its fs_users upsert bare, before fs_activities
// and every delete. A 403 there stops the rest of that tab's cycle and the tab
// resends every cycle (16 ต.ค. 2569: 308 anonymous denials in two hours). A
// non-admin can never write fs_users, so the gateway filters and answers 204,
// naming the person, the row and the differing field names — never values.
test('a non-admin user-list upsert is filtered with an attributed audit line instead of a 403 that breaks the sync cycle', async t => {
  const stored = { name: 'Synthetic Sales', role: 'sales', email: 'stored@example.test', pass: null };
  const s = await stack(t, { users: [{ name: 'Synthetic Sales', data: stored }] });
  const sent = { name: 'Synthetic Sales', role: 'sales', email: 'stored@example.test', pass: 'local-legacy-hash' };
  const filtered = await s.call('fs_users', [{ name: 'Synthetic Sales', data: sent }, { name: 'Synthetic New', data: { name: 'Synthetic New', role: 'sales' } }], { role: 'rd' });
  assert.equal(filtered.status, 204, 'the cycle continues: filtered success, not a refusal');
  assert.equal(await filtered.text(), '');
  const lines = (await s.audit()).filter(line => line.decision === 'filtered' && line.table === 'fs_users');
  assert.equal(lines.length, 1);
  assert.deepEqual([lines[0].by, lines[0].byRole, lines[0].reason], ['Synthetic Sales', 'rd', 'FORMULA_ROLE_WRITE_DENIED']);
  assert.deepEqual(lines[0].dropped.map(d => [d.key, d.fields]), [['Synthetic Sales', ['pass']], ['Synthetic New', []]]);
  assert.ok(!JSON.stringify(lines[0]).includes('local-legacy-hash'), 'field values are never written to the audit log');
  assert.ok(!(await s.audit()).some(line => line.decision === 'denied' && String(line.path).includes('fs_users')));
  assert.ok(!(await s.audit()).some(line => line.decision === 'write' && line.table === 'fs_users'), 'nothing is forwarded upstream');

  // Every other refused write now names the person, so the next anonymous burst can be traced.
  const refused = await s.call('fs_meta', [{ key: 'reccounter', value: 1 }], { role: 'rd' });
  assert.equal(refused.status, 403);
  const denied = (await s.audit()).filter(line => line.decision === 'denied' && String(line.path).includes('fs_meta'));
  assert.deepEqual([denied[0].by, denied[0].byRole, denied[0].reason], ['Synthetic Sales', 'rd', 'FORMULA_ROLE_WRITE_DENIED']);

  // An admin's user-list upsert is unchanged: it still reaches the IAM check, the policy block and the upstream.
  s.edit(true);
  const admin = await s.call('fs_users', [{ name: 'Synthetic Sales', data: { ...stored, email: 'changed@example.test' } }], { role: 'admin', name: 'Synthetic Admin' });
  assert.equal(admin.status, 201);
  assert.ok((await s.audit()).some(line => line.decision === 'write' && line.table === 'fs_users' && line.name === 'Synthetic Admin'));
});

// Version history from central: /__formula/job-versions reads the archive RPC
// (runtime/record-versions.sql) through the proxy only. Visibility follows the
// job: own-only roles must own it; other roles see every job; nothing is
// written. The served page also carries the smaller per-browser history cap.
test('job versions are served through the proxy with the job\'s own visibility and the page carries the smaller local history cap', async t => {
  const versions = new Map([['A03430', [
    { at: 1_700_000_002_000, data: { id: 'A03430', brand: 'Second', createdBy: 'Synthetic Sales', updatedBy: 'Synthetic pd', rows: [] } },
    { at: 1_700_000_001_000, data: { id: 'A03430', brand: 'First', createdBy: 'Synthetic Sales', rows: [] } },
    { at: 1_700_000_000_000, data: { id: 'A09999', brand: 'Wrong job', rows: [] } },
  ]]]);
  const s = await stack(t, { versions });
  s.records.set('A03430', { id: 'A03430', brand: 'Current', createdBy: 'Synthetic Sales', rows: [] });
  const get = (query, opts) => s.call(`../../../__formula/job-versions${query}`, undefined, { method: 'GET', ...opts });
  const admin = await get('?id=A03430', { role: 'admin', name: 'Synthetic Admin' });
  assert.equal(admin.status, 200);
  const body = await admin.json();
  assert.equal(body.id, 'A03430');
  assert.deepEqual(body.versions.map(v => [v.at, v.by, v.data.brand]), [
    [1_700_000_002_000, 'Synthetic pd', 'Second'], [1_700_000_001_000, 'Synthetic Sales', 'First'],
  ], 'newest first, editor taken from the stored data, a foreign row is dropped');
  const owner = await get('?id=A03430', { role: 'sales', name: 'Synthetic Sales' });
  assert.equal(owner.status, 200, 'the owning sales account sees its job history');
  const other = await get('?id=A03430', { role: 'sales', name: 'Someone Else' });
  assert.equal(other.status, 403, 'another sales account does not');
  const pd = await get('?id=A03430', { role: 'pd', name: 'Synthetic pd' });
  assert.equal(pd.status, 200, 'roles that see every job see every history');
  assert.equal((await get('?id=nope', { role: 'admin' })).status, 400);
  assert.equal((await get('?id=A03430', { anonymous: true })).status, 401);
  assert.equal((await s.call('../../../__formula/job-versions?id=A03430', [{}], { role: 'admin' })).status, 405);
  assert.ok(s.writes.every(w => w.path === '/rpc/fs_record_versions'), 'reading history sends nothing upstream but the read-only RPC');
  const denied = (await s.audit()).filter(line => line.decision === 'denied' && String(line.path).includes('job-versions'));
  assert.ok(denied.some(line => line.by === 'Someone Else' && line.reason === 'FORMULA_DATA_SCOPE_DENIED'));

  // Function not installed yet: 503, so the browser keeps showing its own copies.
  const bare = await stack(t);
  bare.records.set('A03430', { id: 'A03430', brand: 'Current', createdBy: 'Synthetic Sales', rows: [] });
  assert.equal((await bare.call('../../../__formula/job-versions?id=A03430', undefined, { method: 'GET', role: 'admin' })).status, 503);

  const page = await fetch(`http://127.0.0.1:${s.port}/`);
  const html = await page.text();
  assert.match(html, /const RECBAK_MAX_CHARS = 500000;/, 'the served page keeps less per-browser history now that central holds it');
  assert.doesNotMatch(html, /RECBAK_MAX_CHARS = 1500000/);
});

test('approved-runtime rollback artifact serves standalone recovery without loading the app or writing upstream', async t => {
  const s = await stack(t);
  const route = `http://127.0.0.1:${s.port}/__formula/rollback-chat-recovery`;
  const page = await fetch(route);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /fs-rollback-chat-recovery\.js/);
  assert.ok(!html.includes('fs-job-sync.js') && !html.includes('fs-session-bridge.js'), 'standalone shell must not run prior app sync');
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const asset = await fetch(`http://127.0.0.1:${s.port}/fs-rollback-chat-recovery.js`);
  assert.equal(asset.status, 200);
  assert.match(await asset.text(), /__fsRollbackChatRecovery/);
  assert.equal((await fetch(route, { method: 'POST' })).status, 405);
  const head = await fetch(route, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  const priorApp = await fetch(`http://127.0.0.1:${s.port}/`);
  assert.equal(priorApp.headers.get('x-formula-release'), 'cf7ab7813cbe');
  assert.ok((await priorApp.text()).includes('fs-chat-recovery.js'), 'recovery remains available after app-only rollback');
  assert.equal((await (await fetch(`http://127.0.0.1:${s.port}/__formula/health`)).json()).rollbackChatRecovery, 'loaded');
  assert.equal(s.writes.length, 0);
});

test('real browser exports exact pending bytes through the prior-runtime recovery route and keeps Admin activity protection', async t => {
  const s = await stack(t), origin = `http://127.0.0.1:${s.port}`;
  const browser = await actualBrowser(t, origin + '/__formula/rollback-chat-recovery'); if (!browser) return;
  await browser.send('Page.enable'); await browser.send('Runtime.enable'); await browser.send('Network.enable');
  await waitForBrowserState(browser, '!!window.__fsRollbackChatRecovery', Boolean, 'rollback recovery asset did not load');
  const identity = JSON.stringify(['Synthetic Sales', 'synthetic-central-user', 'sales']);
  const fixture = {
    'fs_chat_journal_v2:pending': ' {"kind":"pending","identity":' + JSON.stringify(identity) + ',"jobId":"A00001","message":{"uid":"v2","text":"Synthetic v2 🧪"}}\n',
    ['fs_chat_pending_v1:' + encodeURIComponent(identity)]: '[ {"jobId":"A00001","message":{"uid":"v1","text":"Synthetic v1"}} ]\n',
    'fs_chats': '[ {"jobId":"A00001","messages":[{"uid":"old","text":"Synthetic prior app evidence"}]} ]',
    'fs_chat_unclassified_recovery_v1': '{ malformed synthetic evidence',
  };
  await browserValue(browser, `Object.entries(${JSON.stringify(fixture)}).forEach(([key,raw])=>localStorage.setItem(key,raw));true`);
  await browser.send('Page.navigate', { url: origin + '/__formula/rollback-chat-recovery?rehearsal=restored' });
  await waitForBrowserState(browser, "location.search==='?rehearsal=restored' && !!window.__fsRollbackChatRecovery", Boolean, 'same-origin stored evidence must survive recovery-page reload');
  const setRole = async role => {
    const value = Buffer.from(JSON.stringify({ name: 'Synthetic Sales', role, centralUserId: 'synthetic-central-user', exp: Date.now() + 60000 })).toString('base64url');
    await browser.send('Network.setCookie', { name: 'fs_session', value: `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`, url: origin + '/' });
  };
  await setRole('sales');
  const mine = JSON.parse(await browserValue(browser, '(async()=>JSON.stringify(await __fsRollbackChatRecovery.snapshot()))()'));
  assert.equal(mine.entries.length, 2);
  for (const entry of mine.entries) assert.equal(entry.raw, fixture[entry.key]);
  for (const method of ['GET', 'HEAD']) {
    const filtered = await s.call('fs_activities?role=admin', undefined, { role: 'sales', method, headers: { role: 'admin' } });
    assert.equal(filtered.status, 200); assert.equal(await filtered.text(), method === 'GET' ? '[]' : '');
  }
  assert.equal(s.activityReads.length, 0);
  await setRole('admin');
  const all = JSON.parse(await browserValue(browser, '(async()=>JSON.stringify(await __fsRollbackChatRecovery.snapshot()))()'));
  assert.equal(all.entries.length, 4);
  for (const entry of all.entries) assert.equal(entry.raw, fixture[entry.key]);
  // Exercise Blob construction and the download action, retaining the exported
  // bytes in memory so the rehearsal does not create a confidential output file.
  const downloaded = JSON.parse(await browserValue(browser, `(async()=>{var raw='';var old=URL.createObjectURL;URL.createObjectURL=function(blob){blob.text().then(text=>raw=text);return old.call(URL,blob)};await __fsRollbackChatRecovery.download();await new Promise(resolve=>setTimeout(resolve,10));return raw})()`));
  assert.equal(downloaded.entries.length, 4);
  for (const entry of downloaded.entries) assert.equal(entry.raw, fixture[entry.key]);
  const after = JSON.parse(await browserValue(browser, `JSON.stringify(Object.fromEntries(${JSON.stringify(Object.keys(fixture))}.map(key=>[key,localStorage.getItem(key)])))`));
  assert.deepEqual(after, fixture);
  assert.equal(s.writes.length, 0, 'recovery and app-shell fetch must perform no upstream data writes');
  for (const width of [1280, 390]) {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 500 });
    const ui = JSON.parse(await browserValue(browser, `JSON.stringify((function(){var b=document.getElementById('fsRollbackRecoveryDownload');b.focus();return {overflow:document.documentElement.scrollWidth>innerWidth,focus:document.activeElement===b,height:b.getBoundingClientRect().height,leaked:document.body.textContent.includes('Synthetic v2')};})())`));
    assert.equal(ui.overflow, false); assert.equal(ui.focus, true); assert.ok(ui.height >= 44); assert.equal(ui.leaked, false);
    const shot = await browser.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(`/tmp/formula-rollback-recovery-${width}.png`, Buffer.from(shot.result.data, 'base64'));
  }
});


test('rollback recovery fails visibly if its asset is missing while preserving the prior runtime', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'rollback-recovery-assets-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ['fs-job-sync.js', 'fs-session-bridge.js']) await copyFile(join(root, 'runtime/assets', name), join(directory, name));
  const s = await stack(t, { assetDir: directory });
  const health = await (await fetch(`http://127.0.0.1:${s.port}/__formula/health`)).json();
  assert.equal(health.rollbackChatRecovery, 'missing'); assert.equal(health.status, 'degraded');
  assert.equal((await fetch(`http://127.0.0.1:${s.port}/__formula/rollback-chat-recovery`)).status, 503);
  assert.equal(s.writes.length, 0);
});

test('activity UI readiness rejects changed sealed anchors and missing runtime asset', async t => {
  for (const anchor of ['sideActivities', 'actView', 'actContent']) {
    await t.test(`changed ${anchor}`, async t => {
      const s = await stack(t, { transform: html => html.replace(`id="${anchor}"`, `id="changed-${anchor}"`) });
      const health = await (await fetch(`http://127.0.0.1:${s.port}/__formula/health`)).json();
      assert.equal(health.status, 'degraded');
      assert.equal(health.adminActivityLogCompatible, false);
    });
  }
  await t.test('missing activity gate asset', async t => {
    const assetDir = await mkdtemp(join(tmpdir(), 'formula-no-activity-gate-'));
    t.after(() => rm(assetDir, { recursive: true, force: true }));
    for (const name of ['fs-session-bridge.js', 'fs-job-sync.js'])
      await copyFile(join(root, 'runtime/assets', name), join(assetDir, name));
    const s = await stack(t, { assetDir });
    const health = await (await fetch(`http://127.0.0.1:${s.port}/__formula/health`)).json();
    assert.equal(health.status, 'degraded');
    assert.equal(health.adminActivityLog, 'missing');
    assert.equal(health.adminActivityLogCompatible, false);
  });
});

test('a served Activities view follows server admin session even when the local role disagrees', async t => {
  const s = await stack(t, { users: [{ name: 'Synthetic Sales', data: { name: 'Synthetic Sales', role: 'sales', email: 'synthetic@example.test' } }] });
  const browser = await actualBrowser(t, `http://127.0.0.1:${s.port}/`);
  if (!browser) return;
  await browser.send('Page.enable'); await browser.send('Runtime.enable');
  const setSession = async role => {
    const value = Buffer.from(JSON.stringify({ name: 'Synthetic Sales', role, email: 'synthetic@example.test', centralUserId: 'synthetic-central-user', exp: Date.now() + 60_000 })).toString('base64url');
    const signed = `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`;
    await browser.send('Network.setCookie', { name: 'fs_session', value: signed, url: `http://127.0.0.1:${s.port}/` });
  };
  await setSession('admin');
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${s.port}/` });
  await waitForBrowserState(browser, `{ready:window.__fsAdminActivityLogAllowed?.()===true, bridge:window.__fsJobSync?.ready===true}`,
    state => state.ready && state.bridge, 'admin activity gate did not become ready');
  assert.equal(await browserValue(browser, `currentRole()`), 'sales', 'fixture must keep the conflicting local role');
  assert.equal(await browserValue(browser, `getComputedStyle(document.getElementById('sideActivities')).display`), 'flex');
  await browserValue(browser, `(function(){ activities=[{uid:'synthetic-local-pending',ts:Date.now(),user:'Synthetic actor',at:'Synthetic time',role:'sales',cat:'job',action:'Synthetic Activity row',detail:'Synthetic detail'}]; switchView('act'); return true; }())`);
  await waitForBrowserState(browser, `{open:document.getElementById('actView').classList.contains('on'), row:document.getElementById('actContent').textContent.includes('Synthetic Activity row')}`,
    state => state.open && state.row, 'verified admin could not render the served Activity view');
  await setSession('sales');
  await browserValue(browser, `window.dispatchEvent(new Event('focus')); true`);
  await waitForBrowserState(browser, `{hidden:getComputedStyle(document.getElementById('sideActivities')).display==='none', cleared:document.getElementById('actContent').textContent==='', open:document.getElementById('actView').classList.contains('on')}`,
    state => state.hidden && state.cleared && !state.open, 'non-admin session retained Activity UI');
  assert.equal(await browserValue(browser, `activities.some(row=>row.uid==='synthetic-local-pending')`), true, 'revocation must preserve pending local Activity data');
  await browserValue(browser, `switchView('act'); renderActivities(); true`);
  await sleep(100);
  assert.equal(await browserValue(browser, `getComputedStyle(document.getElementById('actView')).display`), 'none');
  assert.equal(await browserValue(browser, `document.getElementById('actContent').textContent`), '');
});

for (const count of [999, 1001, 5327, 6001]) test(`visible ID snapshot reads ${count} parents in bounded linear pages`, async t => {
  const s = await stack(t);
  for (let n=1;n<=count;n++) { const id='A'+String(n).padStart(5,'0'); s.records.set(id,{...job(id),ownerEmail:n%2?'sales@example.test':'foreign@example.test'}); }
  const response=await s.internal('/__formula/visible-record-ids',{email:'sales@example.test'});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.deepEqual(result.ids,[...s.records].filter(([,r])=>r.ownerEmail==='sales@example.test').map(([id])=>id));
  assert.equal(s.scopedReadHeaders.filter(r=>r.table==='/fs_records').length,2*Math.ceil(count/1000),'one complete scan plus one ownership/staleness recheck');
  assert.equal(s.scopedReadHeaders.filter(r=>r.table!=='/fs_records').length,0);
  assert.equal(response.headers.get('cache-control'),'no-store');
});

test('visible ID snapshot rejects ownership drift and unknown roles',async t=>{
  const s=await stack(t);s.records.set('A00001',job());
  s.scopeFault('owner-change-on-recheck');
  assert.equal((await s.internal('/__formula/visible-record-ids')).status,503);
  s.scopeFault('');
  assert.equal((await s.internal('/__formula/visible-record-ids',{role:'auditor'})).status,403);
  assert.equal((await s.internal('/__formula/visible-record-ids',{anonymous:true})).status,401);
  assert.equal((await s.internal('/__formula/visible-record-ids',{expiresIn:-1})).status,401);
  assert.equal((await s.internal('/__formula/visible-record-ids?or=(id.eq.A00001)')).status,400);
  s.scopeFault('malformed-pagination');
  assert.equal((await s.internal('/__formula/visible-record-ids')).status,503);
});

test('rollback recovery page and standalone asset remain available independently of the sealed application',async t=>{
 const s=await stack(t);
 assert.equal((await (await s.internal('/__formula/health')).json()).chatRecovery,'loaded');
 const response=await s.internal('/__formula/chat-recovery');
 assert.equal(response.status,200);
 const html=await response.text();
 assert.match(html,/fs-chat-recovery\.js/);assert.ok(!html.includes('fs-job-sync.js'));
 const asset=await s.internal('/fs-chat-recovery.js');assert.equal(asset.status,200);assert.match(await asset.text(),/__fsChatRecovery/);
});

test('standalone chat recovery renders usable desktop and mobile controls while preserving the pending bytes',async t=>{
 const s=await stack(t),browser=await actualBrowser(t,`http://127.0.0.1:${s.port}/__formula/chat-recovery`);if(!browser)return;
 await browser.send('Page.enable');await browser.send('Runtime.enable');
 await waitForBrowserState(browser,'!!window.__fsChatRecovery',Boolean,'standalone recovery did not load');
 const value=Buffer.from(JSON.stringify({name:'Synthetic Admin',role:'admin',centralUserId:'synthetic-admin',exp:Date.now()+60000})).toString('base64url');
 await browser.send('Network.setCookie',{name:'fs_session',value:`${value}.${createHmac('sha256',secret).update(value).digest('base64url')}`,url:`http://127.0.0.1:${s.port}/`});
 await browserValue(browser,`localStorage.setItem('fs_chat_journal_v2:synthetic',JSON.stringify({kind:'pending',identity:'synthetic',jobId:'A00001',message:{uid:'pending',text:'Synthetic private draft'}}));__fsChatRecovery.refresh();`);
 const readback=JSON.parse(await browserValue(browser,'(async()=>JSON.stringify(await __fsChatRecovery.snapshot()))()'));
 assert.equal(readback.entries[0].value.message.uid,'pending');assert.equal(s.writes.length,0);
 for(const width of [1280,390]){
  await browser.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<500});
  const ui=JSON.parse(await browserValue(browser,`JSON.stringify((function(){var p=document.getElementById('fsChatRecoveryStatus'),b=p.querySelector('button');b.focus();return {overflow:document.documentElement.scrollWidth>innerWidth,visible:!p.hidden,focus:document.activeElement===b,leaked:document.body.textContent.includes('Synthetic private draft'),label:b.textContent,height:b.getBoundingClientRect().height};})())`));
  assert.equal(ui.overflow,false);assert.equal(ui.visible,true);assert.equal(ui.focus,true);assert.equal(ui.leaked,false);assert.match(ui.label,/ดาวน์โหลด/);assert.ok(ui.height>=44,'touch target is at least 44px');
  const shot=await browser.send('Page.captureScreenshot',{format:'png'});await writeFile(`/tmp/formula-chat-recovery-${width}.png`,Buffer.from(shot.result.data,'base64'));
 }
 assert.equal(await browserValue(browser,"!!localStorage.getItem('fs_chat_journal_v2:synthetic')"),true);
});


test('app-only rollback restores the prior sealed pointer on the same origin while retaining recovery and Admin guards',async t=>{
 const prior='cf7ab7813cbe',fixture=join(root,'releases',prior),html=await readFile(join(fixture,'index.html'));
 const digest=createHash('sha256').update(html).digest('hex');
 assert.equal(digest,(await readFile(join(fixture,'MANIFEST.sha256'),'utf8')).split(/\s+/)[0]);
 assert.equal(digest,'cf7ab7813cbe867d9d691f5f97aa2b60e8a9134aa4decc6d4c18575a2e118c64');
 const releaseRoot=await mkdtemp(join(tmpdir(),'formula-app-rollback-'));
 t.after(()=>rm(releaseRoot,{recursive:true,force:true}));
 await mkdir(join(releaseRoot,prior));
 for(const file of ['index.html','meta.json','MANIFEST.sha256']) await copyFile(join(fixture,file),join(releaseRoot,prior,file));
 // Synthetic later shell and old sealed release use the exact same candidate gateway/assets.
 const newer=await stack(t,{transform:source=>source+'\n<!-- synthetic later sealed shell -->'});
 await writeFile(join(releaseRoot,'CURRENT'),'synthetic-later-shell\n');
 await writeFile(join(releaseRoot,'CURRENT'),prior+'\n');
 const older=await stack(t,{releaseRoot});
 let target=newer;
 const edge=createServer(async(req,res)=>{
  try {
   const response=await fetch(`http://127.0.0.1:${target.port}${req.url}`,{method:req.method,headers:req.headers});
   const headers=Object.fromEntries(response.headers);delete headers['transfer-encoding'];delete headers['content-length'];delete headers['content-encoding'];
   res.writeHead(response.status,headers);res.end(Buffer.from(await response.arrayBuffer()));
  } catch(error){res.writeHead(502);res.end(String(error));}
 });
 await new Promise(resolve=>edge.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{edge.closeAllConnections();await new Promise(resolve=>edge.close(resolve));});
 const origin=`http://127.0.0.1:${edge.address().port}`,browser=await actualBrowser(t,origin+'/__formula/chat-recovery');if(!browser)return;
 await browser.send('Page.enable');await browser.send('Runtime.enable');await browser.send('Network.enable');
 await waitForBrowserState(browser,'!!window.__fsChatRecovery',Boolean,'new recovery route did not load');
 const value=Buffer.from(JSON.stringify({name:'Synthetic Admin',role:'admin',centralUserId:'synthetic-admin',exp:Date.now()+60000})).toString('base64url');
 await browser.send('Network.setCookie',{name:'fs_session',value:`${value}.${createHmac('sha256',secret).update(value).digest('base64url')}`,url:origin+'/'});
 const original=await browserValue(browser,`(function(){
  var rows={
   'fs_chat_journal_v2:rollback':JSON.stringify({kind:'pending',identity:'synthetic',jobId:'A00001',message:{uid:'v2',text:'Synthetic v2 draft'}}),
   'fs_chat_pending_v1:synthetic':JSON.stringify([{jobId:'A00001',message:{uid:'v1',text:'Synthetic v1 draft'}}]),
   'fs_chat_unclassified_recovery_v1':JSON.stringify({raw:'Synthetic unknown evidence'}),
   'fs_chats':JSON.stringify([{jobId:'A00001',messages:[{uid:'sealed',text:'Synthetic sealed draft'}]}])
  };Object.keys(rows).forEach(k=>localStorage.setItem(k,rows[k]));localStorage.setItem('session_token','SECRET_SENTINEL');
  return JSON.stringify(rows);
 })()`);
 target=older;
 // Fetch the restored sealed shell through the stable origin without executing its
 // auto-sync: this rollback check must perform no business writes at all.
 const restored=await fetch(origin+'/');assert.equal(restored.headers.get('x-formula-release'),prior);
 const restoredHtml=await restored.text();assert.match(restoredHtml,/sealed:cf7ab7813cbe:blue/);assert.match(restoredHtml,/fs-chat-recovery\.js/);
 assert.equal((await (await fetch(origin+'/__formula/health')).json()).chatRecovery,'loaded');
 await browser.send('Page.navigate',{url:origin+'/__formula/chat-recovery'});
 await waitForBrowserState(browser,'!!window.__fsChatRecovery',Boolean,'recovery must remain reachable after sealed pointer rollback');
 const snapshot=JSON.parse(await browserValue(browser,'(async()=>JSON.stringify(await __fsChatRecovery.snapshot()))()'));
 assert.equal(snapshot.entries.length,4);assert.equal(snapshot.confirmedCount,0);
 const exported=JSON.stringify(snapshot);for(const text of ['Synthetic v2 draft','Synthetic v1 draft','Synthetic unknown evidence','Synthetic sealed draft'])assert.ok(exported.includes(text));
 assert.ok(!exported.includes('SECRET_SENTINEL'));
 const after=await browserValue(browser,`JSON.stringify(Object.fromEntries(${JSON.stringify(Object.keys(JSON.parse(original)))}.map(k=>[k,localStorage.getItem(k)])))`);
 assert.equal(after,original,'rollback recovery leaves every pending byte intact');
 for(const method of ['GET','HEAD']) {
  const denied=await older.call('fs_activities?select=*',undefined,{method,role:'sales'});
  assert.equal(denied.status,200,'legacy sync denial deliberately returns an empty success');
  assert.equal(await denied.text(),method==='GET'?'[]':'');
 }
 assert.equal(older.activityReads.length,0,'non-Admin activity reads never reach upstream after app rollback');
 assert.equal(newer.writes.length,0);assert.equal(older.writes.length,0);
});

test('20-second chat delta preserves rendered desktop and mobile history, composition and draft',async t=>{
  const name='Synthetic Admin',id='A04042';
  const approvalRows=[{job_id:id,part:'pd',data:{by:'Synthetic PD',at:'Synthetic stamp'},updated_at:'2026-10-01T00:00:00Z'}];
  const s=await stack(t,{assetDir:process.env.FORMULA_CHAT_DELTA_BASELINE_ASSET_DIR || undefined,users:[{name,data:{name,role:'admin'}}],approvals:approvalRows});s.edit(true);
  const original={...job(id,'Synthetic refresh customer'),createdBy:name,createdAt:1,rows:[{name:'Synthetic ingredient',w:10,o:'',p:100,actual:10,note:''}]};
  s.records.set(id,structuredClone(original));
  s.scopeRows.fs_chats.push({job_id:id,data:{jobId:id,createdBy:name,createdAt:1,parts:[]},updated_at:'2026-10-01T00:00:00Z'});
  s.scopeRows.fs_messages.push(...Array.from({length:80},(_,index)=>({job_id:id,uid:'synthetic-long-'+index,ts:index+10,data:{uid:'synthetic-long-'+index,user:'Synthetic PD',type:'msg',text:'Synthetic retained long history '+index,ts:index+10},updated_at:'2026-10-01T00:00:00Z'})));
  s.scopeRows.fs_messages.push({job_id:id,uid:'synthetic-old-history',ts:1,data:{uid:'synthetic-old-history',user:'Synthetic PD',type:'msg',text:'Synthetic retained history',ts:1},updated_at:'2026-10-01T00:00:00Z'});
  const origin=`http://127.0.0.1:${s.port}`,browser=await actualBrowser(t,origin+'/');if(!browser)return;
  await browser.send('Page.enable');await browser.send('Runtime.enable');await browser.send('Network.enable');
  const value=Buffer.from(JSON.stringify({name,role:'admin',centralUserId:'synthetic-central-admin',exp:Date.now()+300000})).toString('base64url');
  await browser.send('Network.setCookie',{name:'fs_session',value:`${value}.${createHmac('sha256',secret).update(value).digest('base64url')}`,url:origin+'/'});
  await browser.send('Page.navigate',{url:origin+'/'});
  await waitForBrowserState(browser,"({ready:window.__fsCentralReady===true,actor:typeof currentUser==='undefined'?'':currentUser})",state=>state.ready&&state.actor===name,'synthetic chat baseline');
  const evidence=process.env.FORMULA_CHAT_DELTA_EVIDENCE_DIR || '/tmp/formula-chat-delta-evidence';await mkdir(evidence,{recursive:true});
  const results=[];
  for(const [surface,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
    await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:surface==='mobile'});
    await browserValue(browser,`(async()=>{switchView('chatView');await openChatRoom('${id}');renderChat();return true})()`);
    await browserValue(browser,'(async function(){await sbCycle(false);return true;})()');
    const start=await browserValue(browser,`(function(){var input=document.getElementById('chatInput'),scroller=document.getElementById('chatScroll');if(!input)throw Error('chat input missing');input.value='Synthetic unsent Thai draft ทดสอบ';input.focus();input.setSelectionRange(10,14);input.dispatchEvent(new CompositionEvent('compositionstart',{data:'ท'}));window.__deltaInput=input;window.__deltaScroll=scroller?scroller.scrollTop:null;if(scroller)scroller.scrollTop=123;return {overflow:scroller&&scroller.scrollHeight>scroller.clientHeight,count:getChat('${id}').messages.length,draft:input.value,scroll:scroller?scroller.scrollTop:null};})()`);
    assert.equal(start.overflow,true);assert.ok(start.scroll>=100,'history must really overflow and be scrolled');
    const before=s.upstreamRequests.length;
    const state=await browserValue(browser,`(async function(){sbLastFull=0;for(var i=0;i<3;i++)await sbCycle(false);for(var n=0;n<3;n++)window.dispatchEvent(new StorageEvent('storage',{key:'fs_chats',oldValue:'[]',newValue:'[]'}));await Promise.resolve();var input=document.getElementById('chatInput'),scroller=document.getElementById('chatScroll');return {open:chatOpenId,count:getChat('${id}').messages.length,draft:input&&input.value,focus:document.activeElement===input,sameInput:input===window.__deltaInput,caret:input&&[input.selectionStart,input.selectionEnd],scroll:scroller?scroller.scrollTop:null,delay:sbNextDelay(),text:document.getElementById('chatContent').textContent};})()`);
    assert.equal(state.open,id,JSON.stringify(state));assert.equal(state.count,start.count,JSON.stringify({state,start,reads:s.upstreamRequests.slice(before)}));assert.equal(state.draft,start.draft);assert.equal(state.focus,true);assert.equal(state.sameInput,true,'no-op refresh must preserve the composing DOM node');assert.deepEqual(state.caret,[10,14]);assert.equal(state.scroll,start.scroll);assert.equal(state.delay,20000);assert.match(state.text,/Synthetic retained history/);
    const readMessages=s.upstreamRequests.slice(before).filter(request=>request.path==='/fs_messages'&&request.method==='GET');
    assert.ok(readMessages.length>=3);assert.ok(readMessages.every(request=>request.query.includes('updated_at=gte.')),'routine cycles read incremental messages only');
    s.scopeRows.fs_messages.push({job_id:id,uid:'synthetic-new-'+surface,ts:2,data:{uid:'synthetic-new-'+surface,user:'Synthetic PD',type:'msg',text:'Synthetic changed message '+surface,ts:2},updated_at:new Date().toISOString()});
    const composing=await browserValue(browser,`(async function(){await sbCycle(false);return {same:document.getElementById('chatInput')===window.__deltaInput,value:document.getElementById('chatInput')?.value,diagnostic:{ready:window.__fsCentralReady,sbReady,error:sbErr,open:chatOpenId,journal:__fsChatJournal.status()}};})()`);
    assert.equal(composing.same,true,'changed history must defer destructive redraw during IME composition '+JSON.stringify(composing.diagnostic));assert.equal(composing.value,start.draft);
    await browserValue(browser,`document.getElementById('chatInput').dispatchEvent(new CompositionEvent('compositionend',{data:'ท'}));true`);
    assert.match(await browserValue(browser,"document.getElementById('chatContent').textContent"),new RegExp('Synthetic changed message '+surface));
    const ended=await browserValue(browser,`({value:document.getElementById('chatInput').value,caret:[document.getElementById('chatInput').selectionStart,document.getElementById('chatInput').selectionEnd],focused:document.activeElement===document.getElementById('chatInput'),scroll:document.getElementById('chatScroll').scrollTop})`);
    assert.equal(ended.value,start.draft);assert.deepEqual(ended.caret,[10,14]);assert.equal(ended.focused,true);assert.equal(ended.scroll,start.scroll);

    const shot=await browser.send('Page.captureScreenshot',{format:'png'});await writeFile(join(evidence,`chat-delta-${surface}.png`),Buffer.from(shot.result.data,'base64'));
    results.push({surface,...state,overflow:start.overflow,afterCompositionEnd:ended});
  }
  await writeFile(join(evidence,'chat-delta-rendered.json'),JSON.stringify(results,null,2)+'\n');
  await browserValue(browser,"document.getElementById('chatInput').dispatchEvent(new CompositionEvent('compositionstart',{data:'ท'}));true");
  const beforeHide=await browserValue(browser,`({value:document.getElementById('chatInput').value,caret:[document.getElementById('chatInput').selectionStart,document.getElementById('chatInput').selectionEnd],scroll:document.getElementById('chatScroll').scrollTop})`);
  await browserValue(browser,`window.__healthyFetch=window.fetch;window.__denyScope=true;window.fetch=function(path,opt){if(window.__denyScope&&String(path)==='/__formula/visible-record-ids')return Promise.resolve(new Response('{}',{status:503,headers:{'content-type':'application/json'}}));return window.__healthyFetch(path,opt);};(async function(){await sbCycle(false);return true;})()`);
  assert.equal(await browserValue(browser,"chatOpenId===null&&!document.getElementById('chatInput')"),true,'unknown scope hides the sensitive room');
  await browserValue(browser,`window.__denyScope=false;(async function(){await sbCycle(false);await openChatRoom('${id}');return true;})()`);
  const restored=await browserValue(browser,`({value:document.getElementById('chatInput').value,caret:[document.getElementById('chatInput').selectionStart,document.getElementById('chatInput').selectionEnd],focus:document.activeElement===document.getElementById('chatInput'),scroll:document.getElementById('chatScroll').scrollTop})`);
  assert.equal(restored.value,beforeHide.value);assert.deepEqual(restored.caret,beforeHide.caret);assert.equal(restored.focus,true);assert.equal(restored.scroll,beforeHide.scroll);
  assert.equal(await browserValue(browser,"document.querySelectorAll('#chatContent .ap-btn.on').length"),1);
  approvalRows.length=0;await browserValue(browser,'(async function(){await sbCycle(false);return true;})()');
  assert.equal(await browserValue(browser,"document.querySelectorAll('#chatContent .ap-btn.on').length"),0,'approval-only deletion updates rendered status');
  const siblings=[await browser.newPage(origin+'/'),await browser.newPage(origin+'/')],pages=[browser,...siblings],nativeResults=[];
  for(const page of siblings){await page.send('Page.enable');await page.send('Runtime.enable');await waitForBrowserState(page,"({ready:window.__fsCentralReady===true})",state=>state.ready,'same-profile sibling baseline');}
  for(const page of pages){await page.send('Page.addScriptToEvaluateOnNewDocument',{source:"window.__nativeStorageKeys=[];window.addEventListener('storage',function(e){window.__nativeStorageKeys.push(e.key);},true);"});await page.send('Page.reload');await waitForBrowserState(page,"({ready:window.__fsCentralReady===true,observer:Array.isArray(window.__nativeStorageKeys)})",state=>state.ready&&state.observer,'native event observer baseline');}
  for(let index=0;index<pages.length;index++)await browserValue(pages[index],`(async function(){switchView('chatView');await openChatRoom('${id}');await sbCycle(false);var input=document.getElementById('chatInput');if(!input)throw Error(JSON.stringify({ready:window.__fsCentralReady,sbReady,error:sbErr,open:chatOpenId}));input.value='Native tab ${index} unsent';input.focus();input.setSelectionRange(2,6);window.__nativeInput=input;window.__nativeEvents=0;window.addEventListener('storage',()=>window.__nativeEvents++,true);return true;})()`);
  for(const page of pages)await browserValue(page,'(async function(){await sbCycle(false);return true;})()');
  await sleep(200);
  for(let index=0;index<pages.length;index++)await browserValue(pages[index],`chatJobOpen=true;renderChat();var formula=document.getElementById('cfin-0-w');if(!formula)throw Error(JSON.stringify({ready:window.__fsCentralReady,sbReady,error:sbErr,open:chatOpenId}));formula.value='77';formula.dispatchEvent(new Event('input',{bubbles:true}));formula.dispatchEvent(new Event('change',{bubbles:true}));formula.dispatchEvent(new Event('blur',{bubbles:true}));var input=document.getElementById('chatInput');if(!input)throw Error(JSON.stringify({ready:window.__fsCentralReady,sbReady,error:sbErr,open:chatOpenId}));input.value='Native tab ${index} unsent';input.focus();input.setSelectionRange(2,6);window.__nativeInput=input;true`);
  // Simulate the older tab's legitimate storage write of an obsolete cache.
  await browserValue(siblings[0],`localStorage.setItem('fs_records',JSON.stringify([{...records[0],customer:'Stale native cache'}]));localStorage.setItem('fs_reccounter','1');true`);
  await sleep(250);
  for(const [index,page] of pages.entries()){
    const state=await browserValue(page,`({customer:records.find(r=>r.id==='${id}').customer,draft:document.getElementById('chatInput')&&document.getElementById('chatInput').value,caret:document.getElementById('chatInput')&&[document.getElementById('chatInput').selectionStart,document.getElementById('chatInput').selectionEnd],formula:Number(document.getElementById('cfin-0-w')&&document.getElementById('cfin-0-w').value),parentWeight:records.find(r=>r.id==='${id}').rows[0].w,same:document.getElementById('chatInput')===window.__nativeInput,events:window.__nativeStorageKeys})`);
    nativeResults.push({page:index,...state});assert.equal(state.customer,original.customer,'native record/reccounter events must not install stale cache');assert.equal(state.draft,'Native tab '+index+' unsent');assert.deepEqual(state.caret,[2,6]);assert.equal(state.same,true,'native no-change event keeps editor DOM '+JSON.stringify(state));assert.equal(state.formula,77,'unsaved formula draft stays visible');assert.equal(state.parentWeight,10,'draft must not commit to parent');if(index!==1){assert.ok(state.events.includes('fs_records'));assert.ok(state.events.includes('fs_reccounter'));}
  }
  for(let phase=0;phase<2;phase++){for(const page of pages)await waitForBrowserState(page,"({busy:sbBusy})",state=>!state.busy,'bounded sibling cycles must finish before quiet observation');await Promise.all(pages.map(page=>browserValue(page,'new Promise(resolve=>setTimeout(()=>resolve(true),0))')));}
  const settled=s.upstreamRequests.length;const nativeBefore=await Promise.all(pages.map(page=>browserValue(page,`({busy:sbBusy,chats:chats.map(c=>({jobId:c.jobId,parts:c.parts,seen:c.seen,approvals:c.approvals,uids:c.messages.map(m=>m.uid)})),keys:window.__nativeStorageKeys.slice(-12)})`)));await sleep(350);const nativeAfter=await Promise.all(pages.map(page=>browserValue(page,`({busy:sbBusy,chats:chats.map(c=>({jobId:c.jobId,parts:c.parts,seen:c.seen,approvals:c.approvals,uids:c.messages.map(m=>m.uid)})),keys:window.__nativeStorageKeys.slice(-12)})`)));assert.equal(s.upstreamRequests.length,settled,'native sibling notifications must stop causing immediate pulls '+JSON.stringify({nativeBefore,nativeAfter,writes:s.upstreamRequests.slice(settled).filter(r=>r.method==='POST').map(r=>({path:r.path,body:r.body})),reads:s.upstreamRequests.slice(settled).filter(r=>r.method==='GET').map(r=>r.path)}));
  await browserValue(browser,"backToChatList();true");assert.match(await browserValue(browser,"document.getElementById('chatContent').textContent"),new RegExp(id));
  s.scopeRows.fs_chats.length=0;await browserValue(browser,'(async function(){await sbCycle(false);return true;})()');
  assert.ok(!(await browserValue(browser,"document.getElementById('chatContent').textContent")).includes(id),'chat-only deletion removes the rendered list entry');
  await browserValue(browser,"switchView('dash');true");assert.match(await browserValue(browser,"document.getElementById('recordsPanel').textContent"),new RegExp(id));
  // Native F2: an immutable same-actor outbox notification arriving after a
  // fresh revocation must retain recovery bytes without reinstalling the row.
  for(const page of pages)await browserValue(page,'sbCanEdit=false;true');
  const journal=await browserValue(browser,`records.find(r=>r.id==='${id}').customer='Private pending native edit';recTouched['${id}']=1;saveRecordsStore();Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('fs_job_outbox_v1:')).map(k=>[k,localStorage.getItem(k)]))`);
  assert.ok(Object.keys(journal).length,'native case has an actual pending revision');
  const preservedParent=structuredClone(s.records.get(id));s.records.delete(id);await browserValue(browser,'(async function(){await sbCycle(false);return true;})()');
  const requestsBeforeNative=s.upstreamRequests.length;
  const [journalKey,journalRaw]=Object.entries(journal)[0],siblingKey=journalKey+'-native-sibling';
  await browserValue(siblings[0],`localStorage.setItem(${JSON.stringify(siblingKey)},${JSON.stringify(journalRaw)});true`);
  await waitForBrowserState(browser,`({event:window.__nativeStorageKeys.includes(${JSON.stringify(siblingKey)})})`,state=>state.event,'native immutable outbox notification');
  const revokedNative=await browserValue(browser,`({ids:records.map(r=>r.id),rooms:chats.map(c=>c.jobId),receipts:Object.keys(sbSnap.records),open:chatOpenId,bytes:Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('fs_job_outbox_v1:')).map(k=>[k,localStorage.getItem(k)]))})`);
  assert.ok(!revokedNative.ids.includes(id),'native outbox cannot restore revoked parent');assert.ok(!revokedNative.rooms.includes(id));assert.ok(!revokedNative.receipts.includes(id));assert.equal(revokedNative.open,null);
  assert.deepEqual(revokedNative.bytes,{...journal,[siblingKey]:journalRaw},'native notification preserves every exact private revision');
  await browserValue(browser,'(async function(){await sbCycle(false);return true;})()');
  assert.equal(s.upstreamRequests.slice(requestsBeforeNative).filter(r=>r.method==='POST'&&(r.path==='/rpc/fs_save_record'||['/fs_chats','/fs_messages','/fs_approvals'].includes(r.path))).length,0);

  assert.ok(!(await browserValue(browser,"document.getElementById('recordsPanel').textContent")).includes(id),'scope-only parent revocation removes rendered record');s.records.set(id,preservedParent);
  await writeFile(join(evidence,'chat-delta-round1-rendered.json'),JSON.stringify({surfaces:results,hiddenDraftRestored:restored,nativePages:nativeResults},null,2)+'\n');
  assert.deepEqual(s.records.get(id),original);assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.dialogs,[]);
});

test('shared chat journal is served before both recovery readers and job-sync on each existing color mount',async t=>{
 const compose=await readFile(join(root,'docker-compose.formula.yml'),'utf8');
 const mounts=[...compose.matchAll(/- (\.\/runtime\/assets):\/assets:ro/g)].map(match=>match[1]);assert.equal(mounts.length,2,'both runtime colors use the shared asset directory');
 for(const mount of mounts){
  const s=await stack(t,{assetDir:join(root,mount)});
  const health=await (await s.internal('/__formula/health')).json();assert.equal(health.chatJournal,'loaded');assert.ok(health.assets['/fs-chat-journal.js']);
  const served=await s.internal('/fs-chat-journal.js');assert.equal(served.status,200);assert.equal(await served.text(),await readFile(join(root,mount,'fs-chat-journal.js'),'utf8'));
  for(const route of ['/','/__formula/chat-recovery','/__formula/rollback-chat-recovery']){
   const response=await s.internal(route);assert.equal(response.status,200);const html=await response.text(),scripts=[...html.matchAll(/<script[^>]+src="([^"?]+)/g)].map(m=>m[1]);
   const at=scripts.indexOf('/fs-chat-journal.js');assert.ok(at>=0);for(const consumer of ['/fs-chat-recovery.js','/fs-rollback-chat-recovery.js','/fs-job-sync.js'])if(scripts.includes(consumer))assert.ok(at<scripts.indexOf(consumer));
  }
  assert.equal(s.writes.length,0);
 }
});
test('missing critical shared chat journal degrades real health and both recovery routes return 503',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'chat-journal-missing-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 for(const name of ['fs-chat-recovery.js','fs-rollback-chat-recovery.js','fs-job-sync.js','fs-session-bridge.js','fs-admin-activity-log.js'])await copyFile(join(root,'runtime/assets',name),join(directory,name));
 const s=await stack(t,{assetDir:directory}),health=await (await s.internal('/__formula/health')).json();assert.equal(health.chatJournal,'missing');assert.equal(health.status,'degraded');
 for(const path of ['/__formula/chat-recovery','/__formula/rollback-chat-recovery'])assert.equal((await s.internal(path)).status,503);
 assert.equal(s.writes.length,0);
});

test('native current and C1 rollback shells export cold-reloaded IDB-only exact evidence with scoped permissions and usable controls',async t=>{
 const s=await stack(t),origin=`http://127.0.0.1:${s.port}`;
 s.records.set('A00001',job());
 const browser=await actualBrowser(t,origin+'/__formula/chat-recovery');if(!browser)return;
 await browser.send('Page.enable');await browser.send('Runtime.enable');await browser.send('Network.enable');
 await waitForBrowserState(browser,'document.readyState==="complete" && !!window.__fsChatRecovery && !!window.__fsChatJournal',Boolean,'current journal shell');
 assert.deepEqual(await browserValue(browser,'indexedDB.databases().then(dbs=>dbs.map(db=>db.name))'),[],'empty recovery reader must not create a DB');
 const setRole=async(role,centralUserId='synthetic-central-user')=>{
  const value=Buffer.from(JSON.stringify({name:'Synthetic Sales',role,centralUserId,exp:Date.now()+60000})).toString('base64url');
  await browser.send('Network.setCookie',{name:'fs_session',value:`${value}.${createHmac('sha256',secret).update(value).digest('base64url')}`,url:origin+'/'});
 };
 const owner=JSON.stringify(['Synthetic Sales','synthetic-central-user','sales']);
 const raw=' { "kind":"pending", "identity":'+JSON.stringify(owner)+', "jobId":"A00001", "message":{"uid":"idb-only","text":"Synthetic IDB private 🧪"}}\n',archive='{ malformed original \ud800 🧪\n';
 const key='fs_chat_journal_v2:idb-only';
 await browserValue(browser,`__fsChatJournal.preserve(${JSON.stringify({items:[{key,raw}],raws:[{sourceKey:'fs_chats',raw:archive}],receipts:[]})})`);
 await setRole('sales');
 for(const path of ['/__formula/chat-recovery','/__formula/rollback-chat-recovery']){
  const api=path.includes('rollback')?'__fsRollbackChatRecovery':'__fsChatRecovery';
  await browser.send('Page.navigate',{url:origin+path+'?cold=1'});
  await waitForBrowserState(browser,`location.pathname===${JSON.stringify(path)} && document.readyState==='complete' && !!window.${api}`,Boolean,'cold recovery shell');
  const mine=await browserValue(browser,`${api}.snapshot()`);assert.equal(mine.entries.length,1);assert.equal(mine.entries[0].raw,raw);
  await setRole('sales','different-central-user');assert.equal((await browserValue(browser,`${api}.snapshot()`)).entries.length,0);
  await setRole('admin');
  const all=await browserValue(browser,`${api}.snapshot()`);assert.equal(all.entries.length,2);assert.ok(all.entries.some(entry=>entry.raw===archive));
  const downloaded=JSON.parse(await browserValue(browser,`(async()=>{const native=URL.createObjectURL;window.syntheticDownload='';URL.createObjectURL=function(blob){blob.text().then(text=>syntheticDownload=text);return native.call(this,blob)};await ${api}.download();await new Promise(r=>setTimeout(r,20));URL.createObjectURL=native;return syntheticDownload})()`));
  assert.equal(downloaded.entries.length,2);assert.ok(downloaded.entries.some(entry=>entry.raw===raw));assert.ok(downloaded.entries.some(entry=>entry.raw===archive));
  for(const width of [1280,390]){
   await browser.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<500});
   const controls=await browserValue(browser,`(()=>{const b=document.querySelector('button');b.focus();return {overflow:document.documentElement.scrollWidth>innerWidth,focus:document.activeElement===b,height:b.getBoundingClientRect().height,leaked:document.body.textContent.includes('Synthetic IDB private'),status:!!document.querySelector('[role="status"]'),targets:[...document.querySelectorAll('button,a')].map(n=>n.getBoundingClientRect().height)}})()`);
   assert.equal(controls.overflow,false);assert.equal(controls.focus,true);assert.ok(controls.height>=44);assert.equal(controls.leaked,false);assert.equal(controls.status,true);assert.ok(controls.targets.every(height=>height>=44));
   const shot=await browser.send('Page.captureScreenshot',{format:'png'});await writeFile(`/tmp/chat-quota-task1-${api}-${width}.png`,Buffer.from(shot.result.data,'base64'));
  }
  await browser.send('Page.bringToFront');
  await browserValue(browser,"document.querySelector('button').focus();window.syntheticKeyClicks=0;document.querySelector('button').addEventListener('click',()=>syntheticKeyClicks++);true");
  await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  assert.equal(await browserValue(browser,'syntheticKeyClicks'),1,'native Enter activates the focused download control');
  await setRole('sales');
 }
 assert.equal(await browserValue(browser,'localStorage.length'),0,'IDB-only fixture never relies on a localStorage locator');assert.equal(s.writes.length,0);assert.equal(dataOperationAttempts(s.upstreamRequests).length,0,'export only reads business APIs');
 // Loading and failure are explicit and never display a false zero.
 await browser.send('Page.navigate',{url:origin+'/__formula/chat-recovery?states=1'});
 await waitForBrowserState(browser,'location.search==="?states=1" && document.readyState==="complete" && !!window.__fsChatRecovery',Boolean,'state fixture');
 const loading=await browserValue(browser,`(()=>{window.oldSnapshot=__fsChatJournal.snapshot;__fsChatJournal.snapshot=()=>new Promise((resolve,reject)=>window.failRead=reject);window.refreshing=__fsChatRecovery.refresh();return {text:document.querySelector('[role="status"]').textContent,disabled:document.querySelector('button').disabled,hidden:document.querySelector('[role="status"]').hidden}})()`);
 assert.match(loading.text,/กำลังอ่าน/);assert.equal(loading.disabled,true);assert.equal(loading.hidden,false);
 const loadingShot=await browser.send('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/chat-quota-task1-loading-390.png',Buffer.from(loadingShot.result.data,'base64'));
 await browserValue(browser,"failRead(Error('synthetic'));refreshing");
 const failed=await browserValue(browser,"({text:document.querySelector('[role=\"status\"]').textContent,hidden:document.querySelector('[role=\"status\"]').hidden})");assert.match(failed.text,/อ่านพื้นที่กู้คืนไม่ได้/);assert.equal(failed.hidden,false);
 const failedShot=await browser.send('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/chat-quota-task1-error-390.png',Buffer.from(failedShot.result.data,'base64'));
});

// Runs the production proxy and immutable complete sealed document. Only the
// browser storage fault/latency boundary and the local upstream are synthetic.
async function nativeSenderFixture(t,{name='Synthetic Admin',role='admin'}={}) {
 const id='A04042',s=await stack(t,{users:[{name,data:{name,role}}],transform:html=>html.replace('async function sbPull(full){','async function sbPull(full){if(full)window.__testFullPulls=(window.__testFullPulls||0)+1;')});s.edit(true);
 const original={...job(id),createdBy:name,createdAt:1,rows:[{num:1,name:'Synthetic ingredient',w:10,o:'',p:100,actual:10,note:''}]};
 s.records.set(id,structuredClone(original));
 s.scopeRows.fs_chats.push({job_id:id,data:{jobId:id,createdBy:name,createdAt:1,parts:[]},updated_at:'2026-10-01T00:00:00Z'});
 const origin=`http://127.0.0.1:${s.port}`,browser=await actualBrowser(t,origin+'/');if(!browser)return;
 await browser.send('Page.enable');await browser.send('Runtime.enable');await browser.send('Network.enable');
 const value=Buffer.from(JSON.stringify({name,role,centralUserId:'synthetic-central-admin',exp:Date.now()+300000})).toString('base64url');
 await browser.send('Network.setCookie',{name:'fs_session',value:`${value}.${createHmac('sha256',secret).update(value).digest('base64url')}`,url:origin+'/'});
 await browser.send('Page.navigate',{url:origin+'/'});
 await waitForBrowserState(browser,`window.__fsCentralReady===true && typeof currentUser!=='undefined' && currentUser===${JSON.stringify(name)}`,Boolean,'native sender baseline');
 await browserValue(browser,`(async()=>{window.__senderAlerts=[];window.alert=text=>__senderAlerts.push(text);switchView('chatView');await openChatRoom('${id}');renderChat();return true})()`);
 return {s,browser,id,name,origin,original,run:expression=>browserValue(browser,expression)};
}

test('native sender retains composer and dispatches nothing until completed fallback and exact readback',async t=>{
 const f=await nativeSenderFixture(t);if(!f)return;const {run,s}=f;
 await run(`window.__nativeSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('fs_chat_journal_v2:'))throw new DOMException('synthetic quota','QuotaExceededError');return __nativeSet.call(this,k,v)};window.__preserve=__fsChatJournal.preserve;window.__heldBatch=null;__fsChatJournal.preserve=function(batch){__heldBatch=batch;return new Promise(resolve=>window.__release=()=>__preserve(batch).then(resolve))};document.getElementById('chatInput').value='  Durable native draft ทดสอบ  ';window.__sending=sendChatMsg();true`);
 await sleep(80);
 const before=await run(`({input:document.getElementById('chatInput').value,count:getChat('${f.id}').messages.length,batch:window.__heldBatch})`);
 assert.equal(before.input,'  Durable native draft ทดสอบ  ','composer cannot clear before durable local commit');
 assert.equal(before.count,0,'no message appended before durable local ACK');
 assert.equal(s.writes.filter(r=>r.path==='/fs_messages').length,0,'no central dispatch before durable local ACK');
 assert.equal(before.batch.items.length,1,'one original prepared v2 pending item');
 await run('__release();__sending');
 assert.equal(await run("document.getElementById('chatInput').value"),'');
 const saved=await run(`getChat('${f.id}').messages[0]`);
 assert.deepEqual(saved,before.batch.items.map(e=>JSON.parse(e.raw).message)[0]);
 assert.equal(saved.text,'Durable native draft ทดสอบ');assert.ok(saved.uid);
 const status=await run('({ready:__fsCentralReady,sbReady,sbErr,state:__fsChatJournal.status()})');assert.equal(status.ready,true,JSON.stringify(status));
 const disk=await run('__fsChatJournal.snapshot()');assert.ok(disk.items.some(e=>e.raw===before.batch.items[0].raw));
});


// Defect caught: replacing the sealed sender must preserve its actual trim,
// permission checks, message, activity truncation and participant mutation.
test('native sender normal path matches the executed immutable sealed sender',async t=>{
 const f=await nativeSenderFixture(t);if(!f)return;const text='  '+ 'ส่งข้อความ 🧪 '.repeat(20)+'  ',stamp=1792370000123;
 const initial=await f.run(`getChat('${f.id}')`);
 const baseline={currentUser:f.name,chatOpenId:f.id,CHAT_IDLE_MS:300000,room:structuredClone(initial),input:{value:text,focus(){}},actions:[],nowTs:()=>stamp,requirePerm:()=>true,saveChats(){},renderChat(){},logAct(...args){this.actions.push(args)}};
 baseline.getChat=()=>baseline.room;baseline.document={getElementById:()=>baseline.input};baseline.logAct=(...args)=>baseline.actions.push(args);
 vm.createContext(baseline);vm.runInContext(source('touchChatPart')+'\n'+source('sendChatMsg')+'\n'+source('msgUid')+'\nsendChatMsg();room.messages.forEach(m=>msgUid(chatOpenId,m));',baseline);
 await f.run(`window.__originalNow=nowTs;nowTs=()=>${stamp};document.getElementById('chatInput').value=${JSON.stringify(text)};sendChatMsg()`);
 const actual=await f.run(`({message:getChat('${f.id}').messages[0],parts:getChat('${f.id}').parts,action:activities.find(a=>a.cat==='chat'&&a.action==='ส่งข้อความ'),input:document.getElementById('chatInput').value})`);
 assert.deepEqual(actual.message,JSON.parse(JSON.stringify(baseline.room.messages[0])));
 assert.deepEqual(actual.parts,JSON.parse(JSON.stringify(baseline.room.parts)));
 assert.deepEqual([actual.action.cat,actual.action.action,actual.action.detail,actual.action.job],baseline.actions[0]);assert.equal(actual.input,baseline.input.value);
 await f.run('nowTs=__originalNow;true');
});

const holdSenderFallback=`window.__nativeSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('fs_chat_journal_v2:'))throw new DOMException('synthetic quota','QuotaExceededError');return __nativeSet.call(this,k,v)};window.__preserve=__fsChatJournal.preserve;window.__heldBatch=null;__fsChatJournal.preserve=function(batch){__heldBatch=batch;return new Promise((resolve,reject)=>{window.__release=()=>__preserve(batch).then(resolve,reject);window.__reject=reject})};`;

test('native sender coalesces double click and preserves newer typing and caret',async t=>{
 const f=await nativeSenderFixture(t);if(!f)return;
 const start=await f.run(`(()=>{${holdSenderFallback}document.getElementById('chatInput').value='Original clicked message';window.__firstSend=sendChatMsg();window.__secondSend=sendChatMsg();return __firstSend===__secondSend})()`);assert.equal(start,true);
 await waitForBrowserState(f.browser,'!!window.__heldBatch',Boolean,'sender barrier');
 const original=await f.run('JSON.parse(__heldBatch.items[0].raw).message');
 await f.run(`var input=document.getElementById('chatInput');input.value='Newer draft ทดสอบ';input.setSelectionRange(2,6);input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();__release();__firstSend`);
 const actual=await f.run(`({messages:getChat('${f.id}').messages,input:document.getElementById('chatInput').value,caret:[document.getElementById('chatInput').selectionStart,document.getElementById('chatInput').selectionEnd],focused:document.activeElement===document.getElementById('chatInput'),state:document.getElementById('fsChatSendStatus').textContent})`);
 assert.deepEqual(actual.messages,[original]);assert.equal(actual.input,'Newer draft ทดสอบ');assert.deepEqual(actual.caret,[2,6]);assert.equal(actual.focused,true);assert.match(actual.state,/รอยืนยัน/);
});

for(const change of ['room','actor','role','scope','permission','parent','same-uid-variant'])test('native sender closes after delayed local commit when '+change+' changes',async t=>{
 const f=await nativeSenderFixture(t);if(!f)return;
 await f.run(`${holdSenderFallback}window.__senderOriginalInput=document.getElementById('chatInput');__senderOriginalInput.value='Keep original until authorized';window.__sending=sendChatMsg();true`);
 await waitForBrowserState(f.browser,'!!window.__heldBatch',Boolean,'sender barrier');
 if(change==='scope')f.s.records.delete(f.id);
 else if(change==='role'){
  const value=Buffer.from(JSON.stringify({name:f.name,role:'sales',centralUserId:'synthetic-central-admin',exp:Date.now()+300000})).toString('base64url');
  await f.browser.send('Network.setCookie',{name:'fs_session',value:`${value}.${createHmac('sha256',secret).update(value).digest('base64url')}`,url:f.origin+'/'});
 }else await f.run(change==='room'?"chatOpenId='A00002';true":change==='actor'?"currentUser='Synthetic Other';window.__fsSessionGeneration++;true":change==='permission'?"window.__fsPermissionReady=false;true":change==='parent'?`records.find(r=>r.id==='${f.id}').customer='New parent draft';true`:`getChat('${f.id}').messages.push({...JSON.parse(__heldBatch.items[0].raw).message,text:'Different same UID'});true`);
 assert.equal(await f.run('__release();__sending'),false);
 assert.equal(await f.run('__fsCentralReady'),false,'authority change cannot leave readiness open');
 assert.equal(await f.run('__senderOriginalInput.value'),'Keep original until authorized','authority changes may hide the composer; its original unsent draft remains exact');
 assert.equal(f.s.writes.filter(r=>r.path==='/fs_messages').length,0);
 const disk=await f.run('__fsChatJournal.snapshot()');assert.equal(disk.items.length,1);assert.equal(disk.items[0].value.message.text,'Keep original until authorized');
 if(change!=='same-uid-variant')assert.equal(await f.run(`getChat('${f.id}').messages.length`),0);
});

for(const fault of ['abort','quota','unavailable','readback'])test('native sender retains draft and stable UID on '+fault+' then healthy retry',async t=>{
 const f=await nativeSenderFixture(t);if(!f)return;
 await f.run(`window.__nativeSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('fs_chat_journal_v2:'))throw new DOMException('synthetic quota','QuotaExceededError');return __nativeSet.call(this,k,v)};window.__nativeAdd=IDBObjectStore.prototype.add;window.__nativeGetAll=IDBObjectStore.prototype.getAll;window.__nativeOpen=indexedDB.open;window.__fault=${JSON.stringify(fault)};window.__attemptedRaw='';
 IDBObjectStore.prototype.add=function(value,...args){if(this.transaction.db.name==='fs_chat_fallback_v1'&&value.id.startsWith('item:')){__attemptedRaw=value.raw;if(__fault==='quota')throw new DOMException('quota','QuotaExceededError');const req=__nativeAdd.call(this,value,...args);if(__fault==='abort')req.addEventListener('success',()=>this.transaction.abort());return req}return __nativeAdd.call(this,value,...args)};
 indexedDB.open=function(...args){if(__fault==='unavailable'&&args[0]==='fs_chat_fallback_v1')throw new DOMException('unavailable','UnknownError');return __nativeOpen.apply(this,args)};
 IDBObjectStore.prototype.getAll=function(...args){const req=__nativeGetAll.apply(this,args);if(__fault==='readback'&&this.transaction.db.name==='fs_chat_fallback_v1')req.addEventListener('success',()=>{Object.defineProperty(req,'result',{value:[]})});return req};
 window.__captured=[];window.__oldPreserve=__fsChatJournal.preserve;__fsChatJournal.preserve=function(batch){__captured.push(batch);return __oldPreserve(batch)};document.getElementById('chatInput').value='Stable retry original';window.__failedSend=sendChatMsg();true`);
 assert.equal(await f.run('__failedSend'),false);
 const failed=await f.run(`({input:document.getElementById('chatInput').value,ready:__fsCentralReady,count:getChat('${f.id}').messages.length,item:JSON.parse(__captured[0].items[0].raw),status:document.getElementById('fsChatSendStatus').textContent})`);
 assert.equal(failed.input,'Stable retry original');assert.equal(failed.ready,false);assert.equal(failed.count,0);assert.match(failed.status,/ยังส่งไม่สำเร็จ/);assert.equal(f.s.writes.filter(r=>r.path==='/fs_messages').length,0);
 await f.run(`__fault='';__fsChatJournal.preserve=__oldPreserve;(async()=>{await sbCycle(false);return true})()`);
 await waitForBrowserState(f.browser,'window.__fsCentralReady===true',Boolean,'healthy ordinary retry');
 // A committed item with failed readback can resume through the normal reader.
 await f.run(`(async()=>{await openChatRoom('${f.id}');document.getElementById('chatInput').value='Stable retry original';return sendChatMsg()})()`);
 const messages=await f.run(`getChat('${f.id}').messages.filter(m=>m.text==='Stable retry original')`);
 assert.equal(messages.length,1);assert.equal(messages[0].uid,failed.item.message.uid);assert.equal(messages[0].ts,failed.item.message.ts);
});

test('native sender waits for composed recovery refresh transaction completion without losing pending intent',async t=>{
 const f=await nativeSenderFixture(t);if(!f)return;
 await f.run(`__fsChatJournal.preserve({items:[],raws:[{sourceKey:'synthetic-native-read',raw:'synthetic'}],receipts:[]})`);
 await f.run(`window.__composedSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('fs_chat_journal_v2:'))throw new DOMException('synthetic fallback required','QuotaExceededError');return __composedSet.call(this,key,value)};true`);
 await f.run(`window.__getAll=IDBObjectStore.prototype.getAll;window.__holdNativeRead=true;window.__readHeld=false;IDBObjectStore.prototype.getAll=function(...args){const request=__getAll.apply(this,args);if(this.transaction.db.name==='fs_chat_fallback_v1'&&__holdNativeRead){const store=this;request.addEventListener('success',()=>{__readHeld=true;const keep=()=>{if(__holdNativeRead){const req=store.get('__synthetic_keepalive');req.onsuccess=keep}};keep()})}return request};window.__refreshing=__fsChatRecovery.refresh();true`);
 await waitForBrowserState(f.browser,'__readHeld',Boolean,'real native readonly transaction held');
 await f.run(`document.getElementById('chatInput').value='Composed recovery pending';window.__sending=sendChatMsg();window.__cycle=sbCycle(false);true`);
 await sleep(70);assert.equal(await f.run("document.getElementById('chatInput').value"),'Composed recovery pending');assert.equal(f.s.writes.filter(r=>r.path==='/fs_messages').length,0);
 await f.run('__holdNativeRead=false;Promise.all([__refreshing,__sending,__cycle]).then(()=>true)');
 await f.run('IDBObjectStore.prototype.getAll=__getAll;(async()=>{await sbCycle(false);return true})()');
 await waitForBrowserState(f.browser,'__fsCentralReady===true',Boolean,'complete composed attempt');
 const disk=await f.run('__fsChatJournal.snapshot()'),messages=await f.run(`getChat('${f.id}').messages.filter(m=>m.text==='Composed recovery pending')`);
 assert.equal(messages.length,1);assert.ok(disk.items.some(e=>e.value.message?.uid===messages[0].uid)||[...f.s.scopeRows.fs_messages,...f.s.messageRows].some(m=>m.uid===messages[0].uid));
 const before=f.s.upstreamRequests.length;await sleep(350);assert.equal(f.s.upstreamRequests.length,before,'no immediate wakeup/readiness loop after native storage settles');
 assert.deepEqual(f.browser.exceptions,[]);
});

test('native sender reloads one exact committed message after a lost central HTTP response',async t=>{
 const f=await nativeSenderFixture(t);if(!f)return;
 await f.run(`window.__nativeSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('fs_chat_journal_v2:'))throw new DOMException('quota','QuotaExceededError');return __nativeSet.call(this,k,v)};window.__realFetch=window.fetch;window.__lostResponse=false;window.fetch=async function(path,opt){const response=await __realFetch.apply(this,arguments);if(String(path).includes('/fs_messages')&&opt?.method==='POST'){__lostResponse=true;throw new TypeError('synthetic lost HTTP response')}return response};document.getElementById('chatInput').value='Original survives lost response';sendChatMsg()`);
 const pending=(await f.run('__fsChatJournal.snapshot()')).items.find(e=>e.value.message.text==='Original survives lost response');assert.ok(pending);
 await f.run('(async()=>{try{await sbPush()}catch(error){return false}return true})()');
 assert.equal(await f.run('__lostResponse'),true);assert.equal([...f.s.scopeRows.fs_messages,...f.s.messageRows].filter(m=>m.uid===pending.value.message.uid).length,1);
 await f.browser.send('Page.navigate',{url:f.origin+'/?sender-reload=1'});await waitForBrowserState(f.browser,"location.search==='?sender-reload=1' && document.readyState==='complete' && window.__fsCentralReady===true && typeof getChat==='function'",Boolean,'cold actual sealed reload');
 const after=await f.run(`getChat('${f.id}').messages.filter(m=>m.uid===${JSON.stringify(pending.value.message.uid)})`);assert.deepEqual(after,[pending.value.message]);
 await f.run('(async()=>{await sbCycle(false);await sbPush();return true})()');
 assert.equal([...f.s.scopeRows.fs_messages,...f.s.messageRows].filter(m=>m.uid===pending.value.message.uid).length,1);
 const disk=await f.run('__fsChatJournal.snapshot()');assert.ok(disk.raws.some(e=>e.sourceKey===pending.key&&e.raw===pending.raw));assert.ok(!disk.items.some(e=>e.key===pending.key));
});

test('native sender keeps exact pending until matching job UID and content are centrally read back',async t=>{
 const f=await nativeSenderFixture(t);if(!f)return;
 await f.run(`sbCanEdit=false;window.__nativeSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('fs_chat_journal_v2:'))throw new DOMException('quota','QuotaExceededError');return __nativeSet.call(this,k,v)};document.getElementById('chatInput').value='Exact ACK original';sendChatMsg()`);
 const pending=(await f.run('__fsChatJournal.snapshot()')).items.find(e=>e.value.message.text==='Exact ACK original');assert.ok(pending);
 for(const variant of [{job_id:'A00002',data:pending.value.message},{job_id:f.id,data:{...pending.value.message,text:'Wrong content'}}]){
  f.s.scopeRows.fs_messages.splice(0,Infinity,{...variant,uid:pending.value.message.uid,ts:pending.value.message.ts,updated_at:new Date().toISOString()});
  await f.run('(async()=>{await sbCycle(false);return true})()');
  assert.ok((await f.run('__fsChatJournal.snapshot()')).items.some(e=>e.key===pending.key));
 }
 f.s.scopeRows.fs_messages.splice(0,Infinity,{job_id:f.id,data:pending.value.message,uid:pending.value.message.uid,ts:pending.value.message.ts,updated_at:new Date().toISOString()});
 await f.run('(async()=>{await sbCycle(false);await sbCycle(false);return true})()');
 const disk=await f.run('__fsChatJournal.snapshot()');assert.ok(!disk.items.some(e=>e.key===pending.key),JSON.stringify(await f.run('({ready:__fsCentralReady,error:sbErr,wm:sbWM,state:__fsChatJournal.status()})')));assert.ok(disk.raws.some(e=>e.sourceKey===pending.key&&e.raw===pending.raw));assert.equal(f.s.writes.filter(r=>r.path==='/fs_messages').length,0);
});

test('native sender renders saving failure pending and saved states on desktop and mobile after real localStorage quota',async t=>{
 const f=await nativeSenderFixture(t);if(!f)return;
 const evidence=process.env.FORMULA_CHAT_SENDER_EVIDENCE_DIR || '/tmp/formula-chat-sender-evidence';await mkdir(evidence,{recursive:true});
 await f.run(`window.__nativeSend=sendChatMsg;sendChatMsg=function(){window.__sending=__nativeSend();return __sending};sbCanEdit=false;window.__actualQuota=false;let padding='';for(let step=131072;step>=1;step=Math.floor(step/2)){while(true){try{localStorage.setItem('synthetic-padding',padding+'x'.repeat(step));padding+='x'.repeat(step)}catch(error){if(error.name!=='QuotaExceededError')throw error;__actualQuota=true;break}}};window.__preserve=__fsChatJournal.preserve;window.__holdNew=true;__fsChatJournal.preserve=function(batch){if(!__holdNew)return __preserve(batch);__holdNew=false;window.__uiBatch=batch;return new Promise((resolve,reject)=>{window.__release=()=>__preserve(batch).then(resolve,reject);window.__reject=reject})};true`);
 assert.equal(await f.run('__actualQuota'),true);
 const inspect=async(state,width)=>{
  const ui=await f.run(`(()=>{const input=document.getElementById('chatInput'),button=input.parentNode.querySelector('button'),status=document.getElementById('fsChatSendStatus');status.scrollIntoView({block:'center'});button.focus({preventScroll:true});return {overflow:document.documentElement.scrollWidth>innerWidth,status:status?.textContent,role:status?.getAttribute('role'),live:status?.getAttribute('aria-live'),target:button.getBoundingClientRect().height,width:button.getBoundingClientRect().width,focused:document.activeElement===button,input:input.value,visible:status?.getBoundingClientRect().width>0&&status.getBoundingClientRect().top>=0&&status.getBoundingClientRect().bottom<=innerHeight}})()`);
  assert.equal(ui.overflow,false);assert.equal(ui.role,'status');assert.equal(ui.live,'polite');assert.ok(ui.target>=44);assert.ok(ui.width>=44);assert.equal(ui.focused,true);assert.equal(ui.visible,true);
  assert.match(ui.status,state==='saving'?/กำลังเก็บ/:state==='failed'?/ยังส่งไม่สำเร็จ/:state==='saved'?/ระบบกลางแล้ว/:/รอยืนยัน/);
  const screenshot=await f.browser.send('Page.captureScreenshot',{format:'png'});await writeFile(join(evidence,`sender-${state}-${width}.png`),Buffer.from(screenshot.result.data,'base64'));
  return ui;
 };
 for(const width of [1440,390]){
  await f.browser.send('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:1000,deviceScaleFactor:1,mobile:width===390});
  await f.run(`__holdNew=true;__uiBatch=null;document.getElementById('chatInput').value='Synthetic ${width} durable draft ทดสอบ';window.__sending=sendChatMsg();true`);
  await waitForBrowserState(f.browser,'!!window.__uiBatch',Boolean,'native full quota barrier');
  await inspect('saving',width);
  await f.run("__reject(Error('synthetic'));__sending");await inspect('failed',width);
  await f.run('(async()=>{await sbCycle(false);return true})()');await waitForBrowserState(f.browser,'__fsCentralReady===true',Boolean,'healthy retry after storage reject');
  await f.run(`(async()=>{await openChatRoom('${f.id}');__holdNew=true;__uiBatch=null;document.getElementById('chatInput').parentNode.querySelector('button').focus();return true})()`);
  await f.browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});await f.browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await waitForBrowserState(f.browser,'!!window.__uiBatch',Boolean,'same draft retry');await f.run('__release();__sending');await inspect('pending',width);
  const original=await f.run('JSON.parse(__uiBatch.items[0].raw).message');
  f.s.scopeRows.fs_messages.push({job_id:f.id,uid:original.uid,ts:original.ts,data:original,updated_at:new Date().toISOString()});
  await f.run('(async()=>{await sbCycle(false);return true})()');await f.run(`(async()=>{await openChatRoom('${f.id}');renderChat();return true})()`);await inspect('saved',width);
  await f.run('__uiBatch=null;true');
 }
 assert.deepEqual(f.browser.exceptions,[]);
});


test('native sender fails closed with no IndexedDB API and retries the original prepared UID',async t=>{
 const f=await nativeSenderFixture(t);if(!f)return;
 await f.run(`window.__nativeIdb=indexedDB;window.__nativeSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('fs_chat_journal_v2:'))throw new DOMException('quota','QuotaExceededError');return __nativeSet.call(this,k,v)};window.__captured=null;window.__oldPreserve=__fsChatJournal.preserve;__fsChatJournal.preserve=function(batch){__captured=batch;return __oldPreserve(batch)};Object.defineProperty(window,'indexedDB',{configurable:true,value:undefined});document.getElementById('chatInput').value='No API retains original';sendChatMsg()`);
 const failed=await f.run(`({raw:__captured.items[0].raw,input:document.getElementById('chatInput').value,ready:__fsCentralReady,count:getChat('${f.id}').messages.length})`);
 assert.equal(failed.input,'No API retains original');assert.equal(failed.ready,false);assert.equal(failed.count,0);assert.equal(f.s.writes.filter(r=>r.path==='/fs_messages').length,0);
 await f.run(`Object.defineProperty(window,'indexedDB',{configurable:true,value:__nativeIdb});(async()=>{await sbCycle(false);await openChatRoom('${f.id}');return sendChatMsg()})()`);
 assert.deepEqual(await f.run(`getChat('${f.id}').messages.find(m=>m.text==='No API retains original')`),JSON.parse(failed.raw).message);
});


test('native sender completion preserves a PD formula DOM edit and focus started during the durable await',async t=>{
 const f=await nativeSenderFixture(t,{name:'Synthetic PD',role:'pd'});if(!f)return;
 await f.run(`chatJobOpen=true;renderChat();${holdSenderFallback}document.getElementById('chatInput').value='PD delayed send';window.__sending=sendChatMsg();true`);
 await waitForBrowserState(f.browser,'!!window.__heldBatch',Boolean,'PD durable sender barrier');
 await f.run(`window.__editingField=document.getElementById('cfin-0-w');__editingField.focus();__editingField.select();true`);
 await f.browser.send('Input.insertText',{text:'77'});
 assert.equal(await f.run('__editingField.value'),'77');
 await f.run('__release();__sending');
 const after=await f.run(`({same:document.getElementById('cfin-0-w')===__editingField,value:document.getElementById('cfin-0-w').value,focused:document.activeElement===__editingField,parent:records.find(r=>r.id==='${f.id}').rows[0].w,messages:getChat('${f.id}').messages,input:document.getElementById('chatInput').value})`);
 assert.equal(after.same,true,'async send must not replace a newly focused formula input');assert.equal(after.value,'77');assert.equal(after.focused,true);assert.equal(after.parent,10);assert.equal(f.s.records.get(f.id).rows[0].w,10);assert.equal(after.messages.length,1);assert.equal(after.messages[0].text,'PD delayed send');assert.equal(after.input,'');
});

test('native changed sibling cache archives originals and resumes incremental history without closing the verified room',async t=>{
 const f=await nativeSenderFixture(t);if(!f)return;
 const sibling=await f.browser.newPage(f.origin+'/__formula/chat-recovery');await sibling.send('Runtime.enable');
 await waitForBrowserState(sibling,'document.readyState==="complete" && !!window.__fsChatRecovery',Boolean,'read-only native sibling');
 const originalRaw=JSON.stringify([{jobId:'synthetic-old-original',messages:[{uid:'synthetic-sole-original',text:'Synthetic sole old original'}]}]),replacement=JSON.stringify([{jobId:f.id,messages:[{uid:'synthetic-unknown-native',type:'msg',text:'Synthetic unknown sibling original',ts:17}]}]);
 await f.run(`localStorage.setItem('fs_chats',${JSON.stringify(originalRaw)});true`);
 const snapshotsBefore=(await f.run('window.__testFullPulls||0'));
 await f.run(`window.__archivePreserve=__fsChatJournal.preserve;window.__archiveBatch=null;__fsChatJournal.preserve=function(batch){if(__archiveBatch)return __archivePreserve(batch);__archiveBatch=batch;return new Promise((resolve,reject)=>window.__releaseArchive=()=>{window.__archiveCommitted=__archivePreserve(batch);__archiveCommitted.then(resolve,reject)})};var input=document.getElementById('chatInput');input.value='Keep native sibling draft ทดสอบ';input.focus();input.setSelectionRange(2,8);input.dispatchEvent(new CompositionEvent('compositionstart',{data:'ท'}));window.__siblingInput=input;true`);
 await browserValue(sibling,`localStorage.setItem('fs_chats',${JSON.stringify(replacement)});true`);
 await waitForBrowserState(f.browser,'!!window.__archiveBatch',Boolean,'native changed event barrier');
 assert.equal(await f.run('__fsCentralReady'),false,'writes remain closed before original archival commit');
 await f.run('__releaseArchive();__archiveCommitted');
 await f.run('(async()=>{await sbCycle(false);return true})()');
 const state=await f.run(`({ready:__fsCentralReady,error:sbErr,open:chatOpenId,same:document.getElementById('chatInput')===__siblingInput,draft:document.getElementById('chatInput')?.value,caret:document.getElementById('chatInput')&&[document.getElementById('chatInput').selectionStart,document.getElementById('chatInput').selectionEnd],focused:document.activeElement===__siblingInput})`);
 assert.equal(state.open,f.id,JSON.stringify(state));assert.equal(state.same,true);assert.equal(state.draft,'Keep native sibling draft ทดสอบ');assert.deepEqual(state.caret,[2,8]);assert.equal(state.focused,true);assert.equal(state.ready,true,state.error);
 assert.equal((await f.run('window.__testFullPulls||0')),snapshotsBefore,'known-authority local archival pause needs no full-history rebuild');
 const disk=await f.run('__fsChatJournal.snapshot()');assert.ok(disk.raws.some(r=>r.sourceKey==='fs_chats'&&r.raw===originalRaw));assert.ok(disk.raws.some(r=>r.sourceKey==='fs_chats'&&r.raw===replacement));
 assert.equal(await f.run(`getChat('${f.id}').messages.some(m=>m.uid==='synthetic-unknown-native')`),false,'unknown raw never becomes owned replay');assert.equal(f.s.writes.filter(w=>w.path==='/fs_messages').length,0,'unknown original is quarantined, never promoted to owner pending');
});

async function nativeStoragePause(t,{beforeEvent=''}={}) {
 const f=await nativeSenderFixture(t);if(!f)return;
 const sibling=await f.browser.newPage(f.origin+'/__formula/chat-recovery');await sibling.send('Runtime.enable');
 await waitForBrowserState(sibling,'document.readyState==="complete" && !!window.__fsChatRecovery',Boolean,'native pause sibling');
 await f.run(`document.getElementById('chatInput').value='Original pending through storage pause';sendChatMsg()`);
 const pending=await f.run(`Object.keys(localStorage).filter(k=>k.startsWith('fs_chat_journal_v2:')).map(k=>({key:k,raw:localStorage.getItem(k)})).find(e=>JSON.parse(e.raw).message?.text==='Original pending through storage pause')`);assert.ok(pending);
 const raw=JSON.stringify([{jobId:'synthetic-old',messages:[{uid:'old-pause-original',text:'Synthetic sole pause original'}]}]);
 await f.run(`if(typeof sbPushTimer!=='undefined'){clearTimeout(sbPushTimer);sbPushTimer=null}localStorage.setItem('fs_chats',${JSON.stringify(raw)});window.__eventPreserve=__fsChatJournal.preserve;window.__eventBatch=null;__fsChatJournal.preserve=function(batch){if(__eventBatch)return __eventPreserve(batch);__eventBatch=batch;return new Promise((resolve,reject)=>window.__eventRelease=()=>{window.__eventCommitted=__eventPreserve(batch);__eventCommitted.then(resolve,reject)})};document.getElementById('chatInput').value='Retain pause composer';${beforeEvent};true`);
 const snapshots=(await f.run('window.__testFullPulls||0')),writes=f.s.writes.filter(r=>r.path==='/fs_messages').length;
 await browserValue(sibling,`localStorage.setItem('fs_chats',${JSON.stringify(JSON.stringify([{jobId:'synthetic-new',messages:[{uid:'new-pause-original',text:'Synthetic new pause original'}]}]))});true`);
 await waitForBrowserState(f.browser,'!!window.__eventBatch',Boolean,'changed native event preserved');
 assert.equal(await f.run('__fsCentralReady'),false);
 return {...f,pending,snapshots,writes};
}

for(const fault of ['barrier-abort','final-save','actor-generation','remote-role','scope','permission','unknown-scope','preexisting-failure'])test('native storage pause cannot resume through '+fault,async t=>{
 const f=await nativeStoragePause(t,{beforeEvent:fault==='preexisting-failure'?'window.__fsCentralReady=false':''});if(!f)return;
 if(fault==='barrier-abort')await f.run(`window.__nativeAdd=IDBObjectStore.prototype.add;window.__abortEvent=true;IDBObjectStore.prototype.add=function(...args){const req=__nativeAdd.apply(this,args);if(__abortEvent&&this.transaction.db.name==='fs_chat_fallback_v1')req.addEventListener('success',()=>this.transaction.abort());return req};true`);
 if(fault==='final-save')await f.run(`window.__nativeSet=Storage.prototype.setItem;window.__denyFinal=true;Storage.prototype.setItem=function(k,v){if(__denyFinal&&k==='fs_chats')throw new DOMException('synthetic final cache denial','SecurityError');return __nativeSet.call(this,k,v)};true`);
 if(fault==='actor-generation')await f.run('window.__fsSessionGeneration++;true');
 if(fault==='remote-role'){
  const value=Buffer.from(JSON.stringify({name:f.name,role:'sales',centralUserId:'synthetic-central-admin',exp:Date.now()+300000})).toString('base64url');
  await f.browser.send('Network.setCookie',{name:'fs_session',value:`${value}.${createHmac('sha256',secret).update(value).digest('base64url')}`,url:f.origin+'/'});
 }
 if(fault==='scope')f.s.records.delete(f.id);
 if(fault==='permission')await f.run('window.__fsPermissionReady=false;true');
 if(fault==='unknown-scope')await f.run(`window.__nativeFetch=fetch;window.fetch=function(path,opt){if(String(path)==='/__formula/visible-record-ids')return Promise.resolve(new Response('{}',{status:503,headers:{'content-type':'application/json'}}));return __nativeFetch.apply(this,arguments)};true`);
 assert.equal(f.s.writes.filter(r=>r.path==='/fs_messages').length,f.writes,'nothing dispatches during the paused event');
 await f.run('__eventRelease();__eventCommitted.catch(()=>false)');await f.run('(async()=>{await sbCycle(false);return true})()');
 const state=await f.run('({ready:__fsCentralReady,sbReady,error:sbErr,permission:__fsPermissionReady})');
 const full=(await f.run('window.__testFullPulls||0'))>f.snapshots;
 if(['barrier-abort','final-save','unknown-scope'].includes(fault))assert.equal(state.ready,false,JSON.stringify(state));
 else assert.ok(!state.ready||full,'only a complete new authorized history may reopen readiness; the event marker is invalid');
 assert.equal(await f.run(`localStorage.getItem(${JSON.stringify(f.pending.key)})`),f.pending.raw,'the original pending tuple and bytes survive a rejected resume');
 if(fault==='scope')assert.equal(await f.run(`getChat('${f.id}')?.messages.some(m=>m.text==='Original pending through storage pause')||false`),false,'revoked parent cannot replay retained pending');
 if(fault==='barrier-abort'||fault==='final-save'){
  await f.run(fault==='barrier-abort'?'__abortEvent=false;true':'__denyFinal=false;true');
  await f.run('(async()=>{await sbCycle(false);return true})()');
  assert.ok((await f.run('window.__testFullPulls||0'))>f.snapshots,'failed barrier/save consumes the marker; later health requires a full attempt');
 }
});

for(const operation of ['load','snapshot'])test('native '+(operation==='load'?'initial index':'observational snapshot')+' transaction abort invalidates event pause before later healthy load',async t=>{
 const f=await nativeSenderFixture(t);if(!f)return;
 const sibling=await f.browser.newPage(f.origin+'/__formula/chat-recovery');await sibling.send('Runtime.enable');await waitForBrowserState(sibling,'document.readyState==="complete" && !!window.__fsChatRecovery',Boolean,'native initial-load sibling');
 const old=JSON.stringify([{jobId:'unknown-old',messages:[{uid:'old-load-original',text:'Synthetic old load original'}]}]),next=JSON.stringify([{jobId:'unknown-new',messages:[{uid:'new-load-original',text:'Synthetic new load original'}]}]);
 await f.run(`__fsChatJournal.preserve({items:[],raws:[{sourceKey:'synthetic-seed',raw:'seed'}],receipts:[]})`);
 await f.run(`localStorage.setItem('fs_chats',${JSON.stringify(old)});window.__getAll=IDBObjectStore.prototype.getAll;window.__holdRead=true;IDBObjectStore.prototype.getAll=function(...args){const request=__getAll.apply(this,args);if(this.transaction.db.name==='fs_chat_fallback_v1'&&__holdRead){const store=this;request.addEventListener('success',()=>{window.__heldTransaction=store.transaction;const keep=()=>{if(__holdRead){const r=store.get('__synthetic_hold');r.onsuccess=keep}};keep()})}return request};window.__initialLoad=__fsChatJournal.${operation}().catch(()=>false);true`);
 await waitForBrowserState(f.browser,'!!window.__heldTransaction',Boolean,'native initial load in flight');
 const snapshots=(await f.run('window.__testFullPulls||0'));
 await f.run(`window.__queuedFullFetch=fetch;window.__queuedFullCount=0;window.__queuedFullComplete=false;window.fetch=function(path,opt){if(__queuedFullCount===0&&String(path).includes('/__formula/scoped-chat-history?')){__queuedFullCount++;return new Promise(resolve=>window.__releaseQueuedFull=()=>__queuedFullFetch(path,opt).then(response=>{const json=response.json.bind(response);response.json=()=>json().then(value=>{__queuedFullComplete=true;return value});resolve(response)}))}return __queuedFullFetch.apply(this,arguments)};true`);
 await browserValue(sibling,`localStorage.setItem('fs_chats',${JSON.stringify(next)});true`);await waitForBrowserState(f.browser,'window.__fsCentralReady===false',Boolean,'event paused during initial load');
 await f.run('__holdRead=false;__heldTransaction.abort();__initialLoad');
 // A caller can join an older deferred cycle. Observe the already queued
 // full recovery itself instead of equating that caller's return with it.
 await f.run(`IDBObjectStore.prototype.getAll=__getAll;window.__abortRecovery=sbCycle(false);true`);
 await waitForBrowserState(f.browser,'!!window.__releaseQueuedFull',Boolean,'failed read must queue an actual fresh full recovery');
 assert.equal(await f.run('__fsCentralReady'),false,'old event pause cannot reopen before full response');assert.equal(f.s.writes.filter(r=>r.path==='/fs_messages').length,0);
 await f.run('__releaseQueuedFull();Promise.resolve(__abortRecovery)');
 await waitForBrowserState(f.browser,'({complete:__queuedFullComplete,ready:__fsCentralReady,busy:sbBusy,error:sbErr,count:__queuedFullCount})',state=>state.complete&&state.ready&&!state.busy,'already queued full recovery completes automatically');
 assert.equal(await f.run('__queuedFullCount'),1,'no immediate full retry loop');
 assert.ok((await f.run('window.__testFullPulls||0'))>snapshots,'failed initial load cannot revive an old event marker');
 const disk=await f.run('__fsChatJournal.snapshot()');assert.ok(disk.raws.some(r=>r.raw===old&&r.sourceKey==='fs_chats'));assert.ok(disk.raws.some(r=>r.raw===next&&r.sourceKey==='fs_chats'));
 assert.equal(f.s.writes.filter(r=>r.path==='/fs_messages').length,0);
});

test('native observational failure spanning an active scope read cannot be erased by a later healthy write',async t=>{
 const operation='snapshot';
 const f=await nativeSenderFixture(t);if(!f)return;
 const sibling=await f.browser.newPage(f.origin+'/__formula/chat-recovery');await sibling.send('Runtime.enable');await waitForBrowserState(sibling,'document.readyState==="complete" && !!window.__fsChatRecovery',Boolean,'native initial-load sibling');
 const old=JSON.stringify([{jobId:'unknown-old',messages:[{uid:'old-load-original',text:'Synthetic old load original'}]}]),next=JSON.stringify([{jobId:'unknown-new',messages:[{uid:'new-load-original',text:'Synthetic new load original'}]}]);
 await f.run(`__fsChatJournal.preserve({items:[],raws:[{sourceKey:'synthetic-seed',raw:'seed'}],receipts:[]})`);
 await f.run(`window.__failedReadFetch=fetch;window.__holdFailedScope=true;window.fetch=function(path,opt){if(__holdFailedScope&&String(path)==='/__formula/visible-record-ids'){__holdFailedScope=false;return new Promise(resolve=>window.__failureScopeRelease=()=>__failedReadFetch(path,opt).then(resolve))}return __failedReadFetch.apply(this,arguments)};window.__failureCycle=sbCycle(false);true`);
 await waitForBrowserState(f.browser,'!!window.__failureScopeRelease',Boolean,'current owner attempt waits for fresh scope');
 await f.run(`localStorage.setItem('fs_chats',${JSON.stringify(old)});window.__getAll=IDBObjectStore.prototype.getAll;window.__holdRead=true;IDBObjectStore.prototype.getAll=function(...args){const request=__getAll.apply(this,args);if(this.transaction.db.name==='fs_chat_fallback_v1'&&__holdRead){const store=this;request.addEventListener('success',()=>{window.__heldTransaction=store.transaction;const keep=()=>{if(__holdRead){const r=store.get('__synthetic_hold');r.onsuccess=keep}};keep()})}return request};window.__initialLoad=__fsChatJournal.${operation}().catch(()=>false);true`);
 await waitForBrowserState(f.browser,'!!window.__heldTransaction',Boolean,'native initial load in flight');
 const snapshots=(await f.run('window.__testFullPulls||0'));
 await browserValue(sibling,`localStorage.setItem('fs_chats',${JSON.stringify(next)});true`);await waitForBrowserState(f.browser,'window.__fsCentralReady===false',Boolean,'event paused during initial load');
 await f.run('__holdRead=false;__heldTransaction.abort();__initialLoad');
 await f.run(`IDBObjectStore.prototype.getAll=__getAll;__fsChatJournal.preserve({receipts:['healthy-after-failed-read']})`);
 assert.equal(await f.run('__fsCentralReady'),false,'later healthy storage cannot reopen the app');
 assert.equal(await f.run('__failureScopeRelease();__failureCycle'),false,'an attempt spanning the read failure cannot claim success');
 await f.run(`(async()=>{await sbCycle(false);return true})()`);
 assert.ok((await f.run('window.__testFullPulls||0'))>snapshots,'failed initial load cannot revive an old event marker');
 const disk=await f.run('__fsChatJournal.snapshot()');assert.ok(disk.raws.some(r=>r.raw===old&&r.sourceKey==='fs_chats'));assert.ok(disk.raws.some(r=>r.raw===next&&r.sourceKey==='fs_chats'));
 assert.equal(f.s.writes.filter(r=>r.path==='/fs_messages').length,0);
});

for(const change of ['removal','unequal-format'])test('native journal '+change+' retains exact sole event originals under local quota',async t=>{
 const f=await nativeSenderFixture(t);if(!f)return;
 const sibling=await f.browser.newPage(f.origin+'/__formula/chat-recovery');
 await waitForBrowserState(sibling,'document.readyState==="complete" && !!window.__fsChatRecovery',Boolean,'native journal sibling');
 const item={kind:'opaque',raw:'Synthetic sole journal original 🧪'},raw=JSON.stringify(item),replacement=' { "raw": "Synthetic sole journal original 🧪", "kind": "opaque" } ';
 const canonical=await f.run(`stableStr(${JSON.stringify(item)})`),key='fs_chat_journal_v2:'+createHash('sha256').update(canonical).digest('hex');
 await f.run(`localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(raw)});window.__journalNativeSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('fs_chat_journal_v2:'))throw new DOMException('synthetic quota','QuotaExceededError');return __journalNativeSet.call(this,k,v)};document.getElementById('chatInput').value='Retain notification draft';true`);
 await browserValue(sibling,change==='removal'?`localStorage.removeItem(${JSON.stringify(key)});true`:`localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(replacement)});true`);
 await sleep(80);await f.run('(async()=>{await sbCycle(false);return true})()');
 const disk=await f.run('__fsChatJournal.snapshot()');assert.ok(disk.raws.some(row=>row.sourceKey===key&&row.raw===raw),'sole old journal original must survive exact');
 if(change!=='removal')assert.ok(disk.raws.some(row=>row.sourceKey===key&&row.raw===replacement),'unequal original strings must both survive');
 assert.equal(await f.run(`getChat('${f.id}').messages.length`),0,'opaque evidence cannot become owner replay');
 assert.equal(f.s.writes.filter(row=>row.path==='/fs_messages').length,0);
});

test('native journal arrivals during owner drain defer unapplied watermarks and retain every original',async t=>{
 const f=await nativeSenderFixture(t);if(!f)return;
 const sibling=await f.browser.newPage(f.origin+'/__formula/chat-recovery');
 await waitForBrowserState(sibling,'document.readyState==="complete" && !!window.__fsChatRecovery',Boolean,'native deferred sibling');
 const originals=[];
 for(const n of [1,2]){
  const item={kind:'opaque',raw:'Synthetic deferred original '+n},raw=JSON.stringify(item),canonical=await f.run(`stableStr(${JSON.stringify(item)})`),key='fs_chat_journal_v2:'+createHash('sha256').update(canonical).digest('hex');
  originals.push({key,raw});await f.run(`localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(raw)});true`);
 }
 await f.run(`window.__beforeDrainWM=JSON.stringify(sbWM);window.__beforeDrainCap=JSON.stringify(sbCap);window.__beforeDrainFull=sbLastFull;window.__drainFetch=fetch;window.__scopeReads=0;window.__holdScope=true;window.fetch=function(path,opt){if(String(path)==='/__formula/visible-record-ids'&&++__scopeReads===2&&__holdScope){__holdScope=false;return new Promise(resolve=>window.__releaseScope=()=>__drainFetch(path,opt).then(resolve))}return __drainFetch.apply(this,arguments)};window.__drainPreserve=__fsChatJournal.preserve;window.__holdDrain=true;__fsChatJournal.preserve=function(batch){if(__holdDrain&&batch.raws.some(row=>row.sourceKey===${JSON.stringify(originals[0].key)})){__holdDrain=false;return new Promise((resolve,reject)=>window.__releaseDrain=()=>__drainPreserve(batch).then(resolve,reject))}return __drainPreserve(batch)};window.__deferredWake=[];window.__drainTimeout=setTimeout;window.setTimeout=function(fn,ms){if(ms===0&&String(fn).includes('sbCycle(true)')){__deferredWake.push(fn);return 0}return __drainTimeout.apply(this,arguments)};window.__drainApply=sbApply;window.__drainApplied=0;sbApply=function(...args){__drainApplied++;return __drainApply.apply(this,args)};document.getElementById('chatInput').value='Keep deferred draft';true`);
 const uid='synthetic-delta-after-drain';f.s.scopeRows.fs_messages.push({job_id:f.id,uid,ts:900,data:{uid,type:'msg',user:'Synthetic PD',text:'Synthetic delta after drain',ts:900},updated_at:new Date(Date.now()+1000).toISOString()});
 await f.run('window.__drainCycle=sbCycle(false);true');
 await waitForBrowserState(f.browser,'!!window.__releaseScope',Boolean,'scope after unapplied pull');
 await browserValue(sibling,`localStorage.removeItem(${JSON.stringify(originals[0].key)});true`);await sleep(30);
 await f.run('__releaseScope();true');await waitForBrowserState(f.browser,'!!window.__releaseDrain',Boolean,'captured owner drain');
 await browserValue(sibling,`localStorage.removeItem(${JSON.stringify(originals[1].key)});true`);await sleep(30);
 await f.run('__releaseDrain();__drainCycle');
 const deferred=await f.run(`({applied:__drainApplied,wm:JSON.stringify(sbWM)===__beforeDrainWM,cap:JSON.stringify(sbCap)===__beforeDrainCap,full:sbLastFull===__beforeDrainFull,draft:document.getElementById('chatInput')?.value,wakes:__deferredWake.length,central:getChat('${f.id}').messages.some(m=>m.uid==='${uid}')})`);
 assert.equal(deferred.applied,0,'deferred evidence cannot apply the already-read delta');assert.equal(deferred.wm,true,'unapplied watermarks must roll back');assert.equal(deferred.cap,true);assert.equal(deferred.full,true);assert.equal(deferred.central,false);assert.equal(deferred.draft,'Keep deferred draft');assert.ok(deferred.wakes<=1,'one existing event wake, never a drain loop');assert.equal(f.s.writes.filter(row=>row.path==='/fs_messages').length,0);
 await f.run('window.setTimeout=__drainTimeout;__deferredWake=[];(async()=>{await sbCycle(false);return true})()');
 const disk=await f.run('__fsChatJournal.snapshot()');for(const original of originals)assert.ok(disk.raws.some(row=>row.sourceKey===original.key&&row.raw===original.raw),'every oldValue remains exactly recoverable');
 assert.equal(await f.run(`getChat('${f.id}').messages.filter(m=>m.uid==='${uid}').length`),1,'healthy next read applies the delta exactly once');
 assert.equal(await f.run('sbNextDelay()'),20000);
});

test('native changed cache during fresh scope defers its active barrier without hiding an open draft',async t=>{
 const f=await nativeSenderFixture(t);if(!f)return;
 const sibling=await f.browser.newPage(f.origin+'/__formula/chat-recovery');await waitForBrowserState(sibling,'document.readyState==="complete" && !!window.__fsChatRecovery',Boolean,'scope-event sibling');
 const old='[ {"jobId":"synthetic-sole-old","messages":[]} ]',next='[ {"jobId":"synthetic-sole-new","messages":[]} ]';
 await f.run(`localStorage.setItem('fs_chats',${JSON.stringify(old)});window.__scopeFetch=fetch;window.__holdFirstScope=true;window.fetch=function(path,opt){if(__holdFirstScope&&String(path)==='/__formula/visible-record-ids'){__holdFirstScope=false;return new Promise(resolve=>window.__scopeRelease=()=>__scopeFetch(path,opt).then(resolve))}return __scopeFetch.apply(this,arguments)};window.__scopePreserve=__fsChatJournal.preserve;window.__holdArchive=true;__fsChatJournal.preserve=function(batch){if(__holdArchive&&batch.raws.some(r=>r.sourceKey==='fs_chats')){__holdArchive=false;return new Promise((resolve,reject)=>window.__archiveRelease=()=>__scopePreserve(batch).then(resolve,reject))}return __scopePreserve(batch)};window.__scopeInput=document.getElementById('chatInput');__scopeInput.value='Keep scope-await draft';__scopeInput.focus();__scopeInput.setSelectionRange(2,7);window.__scopeApplied=0;window.__scopeApply=sbApply;sbApply=function(...args){__scopeApplied++;return __scopeApply.apply(this,args)};window.__scopeCycle=sbCycle(false);true`);
 await waitForBrowserState(f.browser,'!!window.__scopeRelease',Boolean,'fresh scope held');
 await browserValue(sibling,`localStorage.setItem('fs_chats',${JSON.stringify(next)});true`);await waitForBrowserState(f.browser,'!!window.__archiveRelease',Boolean,'active archive barrier');
 await f.run('__scopeRelease();__scopeCycle');
 const deferred=await f.run(`({open:chatOpenId,same:document.getElementById('chatInput')===__scopeInput,draft:__scopeInput.value,ready:__fsCentralReady,applied:__scopeApplied})`);
 assert.equal(deferred.open,f.id);assert.equal(deferred.same,true);assert.equal(deferred.draft,'Keep scope-await draft');assert.equal(deferred.ready,false);assert.equal(deferred.applied,0);assert.equal(f.s.writes.filter(row=>row.path==='/fs_messages').length,0);
 await f.run('__archiveRelease();(async()=>{await sbCycle(false);return true})()');
 await waitForBrowserState(f.browser,'__fsCentralReady===true',Boolean,'bounded existing barrier resumes');
 const disk=await f.run('__fsChatJournal.snapshot()');for(const raw of [old,next])assert.ok(disk.raws.some(row=>row.sourceKey==='fs_chats'&&row.raw===raw));
 assert.equal(await f.run(`chatOpenId==='${f.id}'&&document.getElementById('chatInput').value==='Keep scope-await draft'`),true);
});

test('native sender publisher overlapping a normal scope read preserves draft and PD editor until commit',async t=>{
 const f=await nativeSenderFixture(t,{name:'Synthetic PD',role:'pd'});if(!f)return;
 await f.run(`window.__publisherFetch=fetch;window.__holdPublisherScope=true;window.fetch=function(path,opt){if(__holdPublisherScope&&String(path)==='/__formula/visible-record-ids'){__holdPublisherScope=false;return new Promise(resolve=>window.__publisherScopeRelease=()=>__publisherFetch(path,opt).then(resolve))}return __publisherFetch.apply(this,arguments)};window.__publisherCycle=sbCycle(false);true`);
 await waitForBrowserState(f.browser,'!!window.__publisherScopeRelease',Boolean,'publisher scope held');
 await f.run(`window.__publisherSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('fs_chat_journal_v2:'))throw new DOMException('synthetic quota','QuotaExceededError');return __publisherSet.call(this,k,v)};window.__publisherTx=IDBDatabase.prototype.transaction;window.__holdPublisher=true;IDBDatabase.prototype.transaction=function(...args){const tx=__publisherTx.apply(this,args);if(this.name==='fs_chat_fallback_v1'&&args[1]==='readwrite'&&__holdPublisher){__holdPublisher=false;tx.addEventListener('complete',event=>{event.stopImmediatePropagation();window.__publisherCommitRelease=()=>tx.oncomplete(event)})}return tx};document.getElementById('chatInput').value='Synthetic publisher pending';window.__publisherSend=sendChatMsg();true`);
 await waitForBrowserState(f.browser,'!!window.__publisherCommitRelease',Boolean,'native sender commit acknowledgement held');
 await f.run(`chatJobOpen=true;renderChat();window.__publisherField=document.getElementById('cfin-0-w');__publisherField.value='77';__publisherField.focus();__publisherField.dispatchEvent(new Event('input',{bubbles:true}));window.__publisherInput=document.getElementById('chatInput');__publisherInput.value='Newer unsent draft';__publisherScopeRelease();true`);await sleep(50);
 const before=await f.run(`({state:__fsChatJournal.status().state,open:chatOpenId,sameField:document.getElementById('cfin-0-w')===__publisherField,focused:document.activeElement===__publisherField,field:__publisherField.value,draft:__publisherInput.value,messages:getChat('${f.id}').messages.length})`);
 assert.equal(before.state,'loading');assert.equal(before.open,f.id);assert.equal(before.sameField,true);assert.equal(before.focused,true);assert.equal(before.field,'77');assert.equal(before.draft,'Newer unsent draft');assert.equal(before.messages,0);assert.equal(f.s.writes.filter(row=>row.path==='/fs_messages').length,0);
 await f.run('__publisherCommitRelease();Promise.all([__publisherSend,__publisherCycle])');
 assert.equal(await f.run(`chatOpenId==='${f.id}'&&document.getElementById('chatInput').value==='Newer unsent draft'`),true);
 assert.equal(await f.run(`document.getElementById('cfin-0-w')===__publisherField&&__publisherField.value==='77'`),true);
});

test('native revoked scope remains a failure while journal evidence awaits its owner drain',async t=>{
 const f=await nativeSenderFixture(t);if(!f)return;
 const sibling=await f.browser.newPage(f.origin+'/__formula/chat-recovery');await waitForBrowserState(sibling,'document.readyState==="complete" && !!window.__fsChatRecovery',Boolean,'revoked deferred sibling');
 const item={kind:'opaque',raw:'Synthetic revoked sole original'},raw=JSON.stringify(item),canonical=await f.run(`stableStr(${JSON.stringify(item)})`),key='fs_chat_journal_v2:'+createHash('sha256').update(canonical).digest('hex');
 await f.run(`localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(raw)});window.__revokedFetch=fetch;window.__holdRevokedScope=true;window.fetch=function(path,opt){if(__holdRevokedScope&&String(path)==='/__formula/visible-record-ids'){__holdRevokedScope=false;return new Promise(resolve=>window.__revokedScopeRelease=()=>__revokedFetch(path,opt).then(resolve))}return __revokedFetch.apply(this,arguments)};window.__revokedTimeout=setTimeout;window.setTimeout=function(fn,ms){if(ms===0&&String(fn).includes('sbCycle(true)'))return 0;return __revokedTimeout.apply(this,arguments)};document.getElementById('chatInput').value='Private revoked draft';window.__revokedCycle=sbCycle(false);true`);
 await waitForBrowserState(f.browser,'!!window.__revokedScopeRelease',Boolean,'revocation scope held');
 await browserValue(sibling,`localStorage.removeItem(${JSON.stringify(key)});true`);await sleep(30);f.s.records.delete(f.id);
 await f.run('__revokedScopeRelease();__revokedCycle');
 const closed=await f.run('({ready:__fsCentralReady,open:chatOpenId,input:!!document.getElementById("chatInput")})');assert.equal(closed.ready,false);assert.equal(closed.open,null,'known revocation cannot be treated as benign local deferral');assert.equal(closed.input,false);
 await f.run('window.setTimeout=__revokedTimeout;(async()=>{await sbCycle(false);return true})()');
 assert.ok((await f.run('__fsChatJournal.snapshot()')).raws.some(row=>row.sourceKey===key&&row.raw===raw));assert.equal(f.s.writes.filter(row=>row.path==='/fs_messages').length,0);
});


test('native completed cache barrier during preflight resumes the current verified pause without rebuilding the room',async t=>{
 const f=await nativeSenderFixture(t);if(!f)return;
 const sibling=await f.browser.newPage(f.origin+'/__formula/chat-recovery');await waitForBrowserState(sibling,'document.readyState==="complete" && !!window.__fsChatRecovery',Boolean,'scope-event sibling');
 const old='[ {"jobId":"synthetic-sole-old","messages":[]} ]',next='[ {"jobId":"synthetic-sole-new","messages":[]} ]';
 await f.run(`localStorage.setItem('fs_chats',${JSON.stringify(old)});window.__scopeFetch=fetch;window.__holdFirstScope=true;window.fetch=function(path,opt){if(__holdFirstScope&&String(path)==='/__formula/visible-record-ids'){__holdFirstScope=false;return new Promise(resolve=>window.__scopeRelease=()=>__scopeFetch(path,opt).then(resolve))}return __scopeFetch.apply(this,arguments)};window.__scopePreserve=__fsChatJournal.preserve;window.__holdArchive=true;__fsChatJournal.preserve=function(batch){if(__holdArchive&&batch.raws.some(r=>r.sourceKey==='fs_chats')){__holdArchive=false;return new Promise((resolve,reject)=>window.__archiveRelease=()=>__scopePreserve(batch).then(resolve,reject))}return __scopePreserve(batch)};window.__scopeInput=document.getElementById('chatInput');__scopeInput.value='Keep scope-await draft';__scopeInput.focus();__scopeInput.setSelectionRange(2,7);window.__scopeApplied=0;window.__scopeApply=sbApply;sbApply=function(...args){__scopeApplied++;return __scopeApply.apply(this,args)};window.__scopeCycle=sbCycle(false);true`);
 await waitForBrowserState(f.browser,'!!window.__scopeRelease',Boolean,'fresh scope held');
 await browserValue(sibling,`localStorage.setItem('fs_chats',${JSON.stringify(next)});true`);await waitForBrowserState(f.browser,'!!window.__archiveRelease',Boolean,'active archive barrier');
 await f.run(`window.__archiveSessionComplete=false;window.__completionFetch=fetch;window.fetch=function(path,opt){return __completionFetch.apply(this,arguments).then(response=>{if(String(path)==='/sb/session'){const json=response.json.bind(response);response.json=()=>json().then(value=>{window.__archiveSessionComplete=true;return value})}return response})};__archiveRelease();true`);
 await waitForBrowserState(f.browser,'window.__archiveSessionComplete',Boolean,'archive committed, read back and verified fresh session before releasing scope');
 await waitForBrowserState(f.browser,"__fsChatJournal.status().state==='ready'",Boolean,'event commit completed while scope remains held');
 await f.run('new Promise(resolve=>setTimeout(resolve,0))');
 assert.equal(await f.run('__fsCentralReady'),false,'the event pause awaits fresh authority, despite durable completion');
 await f.run('__scopeRelease();__scopeCycle');
 const deferred=await f.run(`({open:chatOpenId,same:document.getElementById('chatInput')===__scopeInput,draft:__scopeInput.value,ready:__fsCentralReady,applied:__scopeApplied})`);
 assert.equal(deferred.open,f.id);assert.equal(deferred.same,true);assert.equal(deferred.draft,'Keep scope-await draft');assert.equal(deferred.ready,true);assert.equal(deferred.applied,1);assert.equal(f.s.writes.filter(row=>row.path==='/fs_messages').length,0);

 await waitForBrowserState(f.browser,'__fsCentralReady===true',Boolean,'bounded existing barrier resumes');
 const disk=await f.run('__fsChatJournal.snapshot()');for(const raw of [old,next])assert.ok(disk.raws.some(row=>row.sourceKey==='fs_chats'&&row.raw===raw));
 assert.equal(await f.run(`chatOpenId==='${f.id}'&&document.getElementById('chatInput').value==='Keep scope-await draft'`),true);
});

test('native mobile sidebar save during a held owner read retains completed evidence and the requested room',async t=>{
 const f=await nativeSenderFixture(t,{name:'Synthetic PD',role:'pd'});if(!f)return;
 await f.browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await f.browser.send('Emulation.setTouchEmulationEnabled',{enabled:true});
 await f.run(`__fsChatJournal.preserve({receipts:['synthetic-owner-read-proof']})`);
 await f.run(`backToChatList();document.getElementById('chatGroup').classList.add('open');window.__ownerTx=IDBDatabase.prototype.transaction;window.__holdOwnerScan=true;IDBDatabase.prototype.transaction=function(...args){const tx=__ownerTx.apply(this,args),get=tx.objectStore.bind(tx);let scanned=false;tx.objectStore=function(name){const store=get(name),all=store.getAll.bind(store);store.getAll=function(){scanned=true;return all()};return store};tx.addEventListener('complete',event=>{if(scanned&&__holdOwnerScan){__holdOwnerScan=false;event.stopImmediatePropagation();window.__releaseOwnerScan=()=>tx.oncomplete(event)}});return tx};window.__ownerRead=__fsChatJournal.load();true`);
 await waitForBrowserState(f.browser,'!!window.__releaseOwnerScan',Boolean,'native owner scan completion is held');
 const target=await f.run(`(()=>{const el=document.querySelector('#chatJobLinks button[onclick="openChatRoom(\\'${f.id}\\')"]');el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.left+r.width/2-visualViewport.offsetLeft,y:r.top+r.height/2-visualViewport.offsetTop}})()`);
 await f.browser.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[target]});await f.browser.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 try {await waitForBrowserState(f.browser,`({open:chatOpenId,ready:__fsCentralReady,input:!!document.getElementById('chatInput')})`,state=>state.open===f.id&&state.input,'actual sidebar touch opens the existing room');assert.equal(await f.run('__fsCentralReady'),true,'an in-flight readonly refresh is not a failed synchronous save');assert.equal(await f.run('__fsChatJournal.verifiedReceipt("synthetic-owner-read-proof")'),true);}
 finally {await f.run('__releaseOwnerScan();__ownerRead');}
 assert.equal(await f.run(`chatOpenId==='${f.id}'&&!!document.getElementById('chatInput')`),true);
});


test('native mobile click observer accepts navigation when a completed delta detaches its touch target',async t=>{
 const f=await nativeSenderFixture(t,{name:'Synthetic PD',role:'pd'});if(!f)return;
 await f.browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await f.browser.send('Emulation.setTouchEmulationEnabled',{enabled:true});
 await f.run(`window.__gestureEvents=[];['touchstart','touchend','click'].forEach(type=>document.addEventListener(type,event=>__gestureEvents.push({type,action:event.target.closest?.('[onclick]')?.getAttribute('onclick')}),true));window.__gestureTarget=document.querySelector('#chatContent button[onclick="backToChatList()"]');__gestureTarget.scrollIntoView({block:'center'});true`);
 const target=await f.run(`(()=>{const el=__gestureTarget,r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return {x:x-visualViewport.offsetLeft,y:y-visualViewport.offsetTop,connected:el.isConnected,hit:document.elementFromPoint(x,y)?.closest('[onclick]')===el,width:r.width,height:r.height}})()`);
 assert.equal(target.connected,true);assert.equal(target.hit,true);assert.ok(target.width>0&&target.height>0);
 await f.browser.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:target.x,y:target.y}]});
 f.s.scopeRows.fs_messages.push({job_id:f.id,uid:'gesture-delta',ts:999,data:{uid:'gesture-delta',user:'Synthetic PD',type:'msg',text:'Changed history during native gesture',ts:999},updated_at:new Date().toISOString()});
 await f.run('sbCycle(false)');
 assert.equal(await f.run('__gestureTarget.isConnected'),false,'actual changed history replaced the original button');assert.equal(await f.run("document.getElementById('chatContent').textContent.includes('Changed history during native gesture')"),true);
 await f.browser.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await waitForBrowserState(f.browser,`['touchstart','click'].every(type=>__gestureEvents.some(event=>event.type===type&&event.action==='backToChatList()'))`,Boolean,'native start and click remain observable after target detach');
 assert.equal(await f.run('chatOpenId'),null,'the actual native click successfully navigates Back');assert.equal(await f.run('window.__fsCentralReady'),true);
 assert.match(await f.run("document.getElementById('chatContent').textContent"),new RegExp(f.id));
});


test('cache durability barrier captures one whole batch and defers later journal arrivals',async()=>{
 const between=(start,end)=>{const a=jobSyncAsset.indexOf(start),b=jobSyncAsset.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return jobSyncAsset.slice(a,b)};
 const production=between('  function mergeChatBatch(', '  function settleChatWaiting(')+between('  function hasChatWaiting(', '  function assertChatWaitingSettled(')+between('  function queueChatDurability(', '  function preserveChatWork(');
 const tick=()=>new Promise(resolve=>setImmediate(resolve));
 for(const outcome of ['success','failure','generation']){
  const box={Promise,CHAT_DEFERRED:{deferred:'chat-evidence'},chatWaiting:{items:[],raws:[],receipts:[]},chatBarrier:null,chatInFlight:null,chatRecoveryBlocked:true,calls:[],releases:[],resumes:0,invalidations:0,generationValid:true,
   chatAdapter:()=>null,chatGeneration:()=>({owner:'synthetic'}),sameChatGeneration:()=>box.generationValid,
   invalidateChatStoragePause(){box.invalidations++},chatConnectionFailure(){},
   ensureChatDurability(batch){box.calls.push(batch);return new Promise(resolve=>box.releases.push(resolve))},resumeChatDurability(){box.resumes++}};
  vm.createContext(box);vm.runInContext(production,box);
  const initial={items:Array.from({length:3229},(_,i)=>({key:'synthetic-'+i,raw:String(i)})),raws:[{sourceKey:'fs_chats',raw:'synthetic-cache-original'}],receipts:['synthetic-receipt']};
  box.queueChatDurability(initial,'synthetic');const barrier=box.chatBarrier;await tick();
  assert.equal(box.calls.length,1);assert.equal(box.calls[0].items.length,3229,'initial complete inventory is one batch');
  const later=[{sourceKey:'fs_chat_journal_v2:removed-one',raw:'synthetic-old-one'},{sourceKey:'fs_chat_journal_v2:removed-two',raw:'synthetic-old-two'}];
  box.mergeChatBatch(box.chatWaiting,{raws:later});
  if(outcome==='generation')box.generationValid=false;
  box.releases.shift()(outcome!=='failure');await tick();
  assert.equal(box.calls.length,1,'one captured barrier never consumes a later journal-event batch');
  assert.equal(box.chatBarrier,null,'barrier terminates without waiting on another batch');assert.equal(box.chatInFlight,null);
  assert.equal(box.chatRecoveryBlocked,true,'unverified later originals cannot clear the block');
  for(const raw of later)assert.ok(box.chatWaiting.raws.some(row=>row.sourceKey===raw.sourceKey&&row.raw===raw.raw));
  if(outcome==='success'){
   assert.equal(await barrier,box.CHAT_DEFERRED);assert.equal(box.resumes,1,'wake owner once, never start another preservation');assert.equal(box.chatWaiting.items.length,0);assert.equal(box.invalidations,0);
  }else{
   assert.equal(await barrier,false);assert.equal(box.resumes,0,'no immediate retry after failed batch');assert.equal(box.chatWaiting.items.length,3229);assert.ok(box.chatWaiting.raws.some(row=>row.raw===initial.raws[0].raw));assert.deepEqual(Array.from(box.chatWaiting.receipts),initial.receipts);assert.ok(box.invalidations>0);
  }
 }
});

test('native active cache barrier defers later journal originals to one healthy owner drain',async t=>{
 const f=await nativeSenderFixture(t);if(!f)return;
 const sibling=await f.browser.newPage(f.origin+'/__formula/chat-recovery');await waitForBrowserState(sibling,'document.readyState==="complete" && !!window.__fsChatRecovery',Boolean,'bounded cache sibling');
 const originals=[];
 for(const n of [1,2]){
  const item={kind:'opaque',raw:'Synthetic bounded barrier original '+n},raw=JSON.stringify(item),canonical=await f.run(`stableStr(${JSON.stringify(item)})`),key='fs_chat_journal_v2:'+createHash('sha256').update(canonical).digest('hex');
  originals.push({key,raw});await f.run(`localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(raw)});true`);
 }
 const old='[ {"jobId":"synthetic-bounded-old","messages":[]} ]',next='[ {"jobId":"synthetic-bounded-new","messages":[]} ]';
 await f.run(`localStorage.setItem('fs_chats',${JSON.stringify(old)});window.__boundedWM=JSON.stringify(sbWM);window.__boundedCap=JSON.stringify(sbCap);window.__boundedFull=sbLastFull;window.__boundedFetch=fetch;window.__boundedHoldScope=true;window.fetch=function(path,opt){if(__boundedHoldScope&&String(path)==='/__formula/visible-record-ids'){__boundedHoldScope=false;return new Promise(resolve=>window.__boundedScopeRelease=()=>__boundedFetch(path,opt).then(resolve))}return __boundedFetch.apply(this,arguments).then(response=>{if(window.__boundedFirstComplete&&String(path)==='/sb/session'){const json=response.json.bind(response);response.json=()=>json().then(value=>{window.__boundedSessionComplete=true;return value})}return response})};window.__boundedPreserve=__fsChatJournal.preserve;window.__boundedBatches=[];__fsChatJournal.preserve=function(batch){__boundedBatches.push(JSON.parse(JSON.stringify(batch)));const n=__boundedBatches.length;return new Promise((resolve,reject)=>window[n===1?'__boundedFirstRelease':'__boundedLaterRelease']=()=>__boundedPreserve(batch).then(value=>{if(n===1)__boundedFirstComplete=true;resolve(value)},reject))};window.__boundedTimeout=setTimeout;window.__boundedWakes=[];window.setTimeout=function(fn,ms){if(ms===0&&String(fn).includes('sbCycle(true)')){__boundedWakes.push(fn);return 0}return __boundedTimeout.apply(this,arguments)};window.__boundedSet=Storage.prototype.setItem;window.__boundedCacheWrites=0;Storage.prototype.setItem=function(k,v){if(k==='fs_chats')__boundedCacheWrites++;return __boundedSet.call(this,k,v)};window.__boundedApply=sbApply;window.__boundedApplied=0;sbApply=function(...args){__boundedApplied++;return __boundedApply.apply(this,args)};window.__boundedInput=document.getElementById('chatInput');__boundedInput.value='Keep bounded barrier draft';window.__boundedCycle=sbCycle(false);true`);
 await waitForBrowserState(f.browser,'!!window.__boundedScopeRelease',Boolean,'owner fresh scope held');
 await browserValue(sibling,`localStorage.setItem('fs_chats',${JSON.stringify(next)});true`);await waitForBrowserState(f.browser,'!!window.__boundedFirstRelease',Boolean,'actual fs_chats barrier active');
 await browserValue(sibling,`${originals.map(o=>`localStorage.removeItem(${JSON.stringify(o.key)})`).join(';')};true`);
 await f.run(`new Promise(resolve=>setTimeout(resolve,30))`);
 await f.run('__boundedFirstRelease();true');await waitForBrowserState(f.browser,'!!window.__boundedSessionComplete',Boolean,'first captured batch committed and session verified');
 await f.run('new Promise(resolve=>setTimeout(resolve,0))');await f.run('__boundedScopeRelease();__boundedCycle');
 const deferred=await f.run(`({batches:__boundedBatches.length,ready:__fsCentralReady,applied:__boundedApplied,writes:__boundedCacheWrites,wm:JSON.stringify(sbWM)===__boundedWM,cap:JSON.stringify(sbCap)===__boundedCap,full:sbLastFull===__boundedFull,open:chatOpenId,same:document.getElementById('chatInput')===__boundedInput,draft:__boundedInput.value,wakes:__boundedWakes.length})`);
 assert.equal(deferred.batches,1,'active cache barrier cannot consume later journal raws');assert.equal(deferred.ready,false);assert.equal(deferred.applied,0);assert.equal(deferred.writes,0);assert.equal(deferred.wm,true);assert.equal(deferred.cap,true);assert.equal(deferred.full,true);assert.equal(deferred.open,f.id);assert.equal(deferred.same,true);assert.equal(deferred.draft,'Keep bounded barrier draft');assert.ok(deferred.wakes<=1);assert.equal(f.s.writes.filter(row=>row.path==='/fs_messages').length,0);
 // An ordinary cycle is the next owner. Its held batch exposes the exact
 // waiting originals while proving no apply/cache write preceded their commit.
 await f.run('window.setTimeout=__boundedTimeout;__boundedWakes=[];window.__boundedResume=sbCycle(false);true');await waitForBrowserState(f.browser,'!!window.__boundedLaterRelease',Boolean,'next owner captures later originals');
 const later=await f.run('__boundedBatches[1]');for(const original of originals)assert.ok(later.raws.some(row=>row.sourceKey===original.key&&row.raw===original.raw));
 assert.equal(await f.run('__fsCentralReady===false&&__boundedApplied===0&&__boundedCacheWrites===0'),true);
 await f.run('__boundedLaterRelease();__boundedResume');await waitForBrowserState(f.browser,'__fsCentralReady===true',Boolean,'healthy ordinary owner resume');
 const disk=await f.run('__fsChatJournal.snapshot()');for(const original of originals)assert.ok(disk.raws.some(row=>row.sourceKey===original.key&&row.raw===original.raw));for(const raw of [old,next])assert.ok(disk.raws.some(row=>row.sourceKey==='fs_chats'&&row.raw===raw));
 assert.equal(await f.run(`chatOpenId==='${f.id}'&&document.getElementById('chatInput')===__boundedInput&&__boundedInput.value==='Keep bounded barrier draft'`),true);assert.equal(await f.run('sbNextDelay()'),20000);assert.equal(f.s.writes.filter(row=>row.path==='/fs_messages').length,0);
});

for(const staged of [false,true])test('native same-name role transition restores fresh history with '+(staged?'staged originals':'no staged originals'),async t=>{
 const f=await nativeSenderFixture(t);if(!f)return;
 await f.run("sbCanEdit=false;document.getElementById('chatInput').value='Old tuple pending';sendChatMsg()");
 const old=await f.run("Object.keys(localStorage).filter(k=>k.startsWith('fs_chat_journal_v2:')).map(key=>({key,raw:localStorage.getItem(key)})).find(e=>JSON.parse(e.raw).message?.text==='Old tuple pending')");assert.ok(old);
 const raw=' {"kind":"opaque","raw":"sole old role original"} ',key='fs_chat_journal_v2:role-transition-event';
 if(staged) await f.run(`window.__roleSession=window.__fsSessionFetch||fetch;window.__roleSessionReads=0;window.__holdRoleSession=false;window.__fsSessionFetch=async function(){const response=await __roleSession.apply(this,arguments);if(__holdRoleSession&&++__roleSessionReads===2)return new Promise(resolve=>window.__releaseOldRoleBarrier=()=>resolve(response));return response;};window.__roleTimeout=setTimeout;window.__roleScheduled=[];window.setTimeout=function(fn,ms){if(ms===0&&String(fn).includes('sbCycle(true)')){__roleScheduled.push(fn);return 0;}return __roleTimeout.apply(this,arguments)};localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(raw)});window.__roleFetch=fetch;window.fetch=function(path,opt){if(String(path)==='/__formula/visible-record-ids'&&!window.__roleScopeStarted){window.__roleScopeStarted=true;return new Promise(resolve=>window.__roleScopeRelease=()=>__roleFetch(path,opt).then(resolve))}return __roleFetch.apply(this,arguments)};window.__roleCycle=sbCycle(false);true`);
 if(staged){
  await waitForBrowserState(f.browser,'!!window.__roleScopeRelease',Boolean,'role preflight held');
  // Event evidence is captured synchronously; this synthetic event isolates
  // the authority transition from unrelated native navigation scheduling.
  await f.run(`window.dispatchEvent(new StorageEvent('storage',{key:${JSON.stringify(key)},oldValue:${JSON.stringify(raw)},newValue:null}));localStorage.removeItem(${JSON.stringify(key)});true`);
 }
 const value=Buffer.from(JSON.stringify({name:f.name,role:'pd',centralUserId:'synthetic-central-admin',exp:Date.now()+300000})).toString('base64url');
 await f.browser.send('Network.setCookie',{name:'fs_session',value:`${value}.${createHmac('sha256',secret).update(value).digest('base64url')}`,url:f.origin+'/'});
 if(staged){await f.run('__holdRoleSession=true;__roleScopeRelease();__roleCycle');assert.equal(await f.run('__fsCentralReady'),false);assert.equal(await f.run('chatOpenId'),null,'changed authority immediately closes the old room');}
 if(staged){
  await waitForBrowserState(f.browser,'!!window.__releaseOldRoleBarrier',Boolean,'old tuple barrier reached its held final authority check');
  await f.run('window.__joinedOldRole=sbCycle(false);true');
  assert.equal(await f.run('__fsCentralReady'),false);
  assert.equal(await f.run('__releaseOldRoleBarrier();__joinedOldRole'),false,'a cycle joining the failed old barrier cannot become recovery success');
  assert.equal(await f.run('__fsCentralReady'),false);assert.equal(await f.run('chatOpenId'),null);
  await f.run('window.setTimeout=__roleTimeout;window.__fsSessionFetch=__roleSession;true');
 }

 await f.run('(async()=>{await sbCycle(false);return true})()');
 await waitForBrowserState(f.browser,`({ready:__fsCentralReady===true&&!sbBusy,error:sbErr,owner:localStorage.getItem('fs_chat_cache_owner_v1'),journal:__fsChatJournal.status()})`,state=>state.ready,'ordinary fresh role recovery');
 const state=await f.run(`({owner:localStorage.getItem('fs_chat_cache_owner_v1'),raw:localStorage.getItem(${JSON.stringify(old.key)}),messages:chats.flatMap(c=>c.messages),open:chatOpenId})`);
 assert.equal(JSON.parse(state.owner)[2],'pd');assert.equal(state.raw,old.raw);assert.equal(state.messages.some(m=>m.text==='Old tuple pending'),false,'old tuple never replays under new role');assert.equal(state.open,null);
 if(staged)assert.ok((await f.run('__fsChatJournal.snapshot()')).raws.some(row=>row.sourceKey===key&&row.raw===raw));
 assert.equal(f.s.writes.filter(w=>w.path==='/fs_messages').length,0);
});

for(const route of ['ids','messages'])for(const outcome of [false,null])test(`scoped ${route} rechecks fresh FORMULA_VIEW after reads, outcome=${outcome}`,async t=>{
 let s; s=await stack(t,{iamAllow:permission=>permission==='FORMULA_VIEW'?(s.scopedReadHeaders.length?outcome:true):false});
 s.records.set('A00001',job());s.scopeRows.fs_chats.push({job_id:'A00001',data:{jobId:'A00001'}});s.scopeRows.fs_messages.push({job_id:'A00001',uid:'synthetic-old',data:{uid:'synthetic-old',text:'old'}});
 const response=route==='ids'?await s.internal('/__formula/visible-record-ids'):await s.call('fs_messages?select=uid,job_id,data&job_id=eq.A00001',undefined,{method:'GET'});
 assert.equal(response.status,outcome===null?503:403);assert.ok(s.permissions.filter(p=>p==='FORMULA_VIEW').length>=2);
});

const scopedHistoryRoute=filter=>'/__formula/scoped-chat-history'+(filter===undefined?'':'?job_id='+encodeURIComponent(filter));
function seedScopedHistory(s,count=1001){
 s.records.set('A00001',job());s.scopeRows.fs_chats.push({job_id:'A00001',data:{jobId:'A00001',parts:[]}});
 s.scopeRows.fs_messages.push(...Array.from({length:count},(_,n)=>({job_id:'A00001',uid:'m'+String(n).padStart(5,'0'),ts:n,data:{uid:'m'+String(n).padStart(5,'0'),text:'Synthetic history '+n}})));
}
test('scoped history returns only requested complete child rows through two bounded filtered scans',async t=>{
 const s=await stack(t);seedScopedHistory(s);s.records.set('A00002',{...job('A00002'),createdBy:'Other Sales'});s.records.set('invalid-unrelated',{});
 s.scopeRows.fs_chats.push({job_id:'A00002',data:{jobId:'A00002'}});s.scopeRows.fs_messages.push({job_id:'A99999',uid:'retained',data:{text:'Retained unrelated'}});
 const response=await s.internal(scopedHistoryRoute('eq.A00001'));assert.equal(response.status,200);const result=await response.json();
 assert.deepEqual(result,{chats:s.scopeRows.fs_chats.filter(row=>row.job_id==='A00001'),messages:s.scopeRows.fs_messages.filter(row=>row.job_id==='A00001')});assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(s.scopedReadHeaders.filter(row=>row.table==='/fs_messages').length,4);assert.equal(s.scopedReadHeaders.filter(row=>row.table==='/fs_chats').length,2);assert.equal(s.scopedReadHeaders.filter(row=>row.table==='/fs_records').length,2);
 for(const read of s.scopedReadHeaders){const query=new URLSearchParams(read.query),key=read.table==='/fs_records'?'id':'job_id';assert.equal(query.get(key),'in.("A00001")');const [from,to]=read.range.split('-').map(Number);assert.ok(to-from<1000);assert.equal(read.prefer,'count=exact');}
 assert.equal(s.writes.length,0);assert.equal(s.archiveReads.length,0);
});
test('scoped history accepts exactly fifty requested IDs and visible parents with missing room references',async t=>{
 const s=await stack(t);const ids=Array.from({length:50},(_,n)=>'A'+String(n+1).padStart(5,'0'));for(const id of ids)s.records.set(id,job(id));
 s.scopeRows.fs_messages.push({job_id:ids[0],uid:'old-orphan-reference',data:{uid:'old-orphan-reference',text:'Keep original old history'}});
 const response=await s.internal(scopedHistoryRoute('in.('+ids.map(id=>JSON.stringify(id)).join(',')+')'));assert.equal(response.status,200);assert.deepEqual(await response.json(),{chats:[],messages:s.scopeRows.fs_messages});
});
for(const filter of [undefined,'','eq.A00001&or=anything','in.()','in.("A00001","A00001")','in.('+Array.from({length:51},(_,n)=>'"A'+String(n+1).padStart(5,'0')+'"').join(',')+')'])test('scoped history rejects invalid or broad exact filter '+filter,async t=>{
 const s=await stack(t);seedScopedHistory(s,1);assert.equal((await s.internal(scopedHistoryRoute(filter))).status,400);assert.equal(s.scopedReadHeaders.length,0);
});
for(const suffix of ['&select=*','&job_id=eq.A00001','&limit=1000'])test('scoped history rejects extra or repeated query '+suffix,async t=>{
 const s=await stack(t);assert.equal((await s.internal(scopedHistoryRoute('eq.A00001')+suffix)).status,400);assert.equal(s.scopedReadHeaders.length,0);
});
for(const identity of [{anonymous:true},{role:'auditor'},{method:'POST'}])test('scoped history keeps existing authentication and read-only route gates '+JSON.stringify(identity),async t=>{
 const s=await stack(t);seedScopedHistory(s,1);assert.equal((await s.internal(scopedHistoryRoute('eq.A00001'),identity)).status,identity.method?405:identity.anonymous?401:403);
});
for(const missing of [false,true])test('scoped history rejects any requested parent outside current scope before child reads, missing='+missing,async t=>{
 const s=await stack(t);seedScopedHistory(s,1);if(!missing)s.records.set('A00002',{...job('A00002'),createdBy:'Other Sales'});
 assert.equal((await s.internal(scopedHistoryRoute('in.("A00001","A00002")'))).status,403);assert.equal(s.scopedReadHeaders.filter(row=>row.table!=='/fs_records').length,0);
});
for(const fault of ['child-page-drift','child-insert-next-page','child-delete-next-page','child-replace-next-page','malformed-pagination','partial-pagination','oversized-page','foreign-child-injection','owner-change-on-recheck','owner-change-during-child-recheck','child-recheck-failure'])test('scoped history rejects '+fault+' without a partial result and retries',async t=>{
 const s=await stack(t);seedScopedHistory(s);s.scopeFault(fault);const response=await s.internal(scopedHistoryRoute('eq.A00001'));assert.equal(response.status,503);const body=await response.json();assert.equal(Object.hasOwn(body,'messages'),false);assert.equal(Object.hasOwn(body,'chats'),false);
 s.scopeFault('');s.records.set('A00001',job());const retry=await s.internal(scopedHistoryRoute('eq.A00001'));assert.equal(retry.status,200);assert.deepEqual((await retry.json()).messages,s.scopeRows.fs_messages);
});
for(const denied of [false,null])test('scoped history fresh VIEW denial/outage after child scans fails closed, denied='+denied,async t=>{
 let s;s=await stack(t,{iamAllow:permission=>permission==='FORMULA_VIEW'?(s.scopedReadHeaders.length?denied:true):false});seedScopedHistory(s,1);
 assert.equal((await s.internal(scopedHistoryRoute('eq.A00001'))).status,denied===null?503:403);assert.ok(s.permissions.filter(permission=>permission==='FORMULA_VIEW').length>=2);
});
for(const change of ['revoked','role','identity'])test('scoped history rejects mid-read trusted session '+change,async t=>{
 const s=await stack(t,{users:[{name:'Synthetic Admin',data:{name:'Synthetic Admin',email:'admin@example.test'}}],iamIntrospection:count=>({active:count===1||change!=='revoked',status:'ACTIVE',audience:'FORMULA',central_user_id:count>1&&change==='identity'?'changed-user':'synthetic-user',email:'admin@example.test',expires_at:new Date(Date.now()+60000).toISOString(),grant_version:'1',app_role:count>1&&change==='role'?'FORMULA_RD':'FORMULA_ADMIN',legacy_user_id:'Synthetic Admin'})});seedScopedHistory(s,1);
 assert.equal((await s.internal(scopedHistoryRoute('eq.A00001'))).status,401);
});
