// Actual SQL on a disposable cluster. No production socket, port, environment
// file, credential, or existing database is used by this test.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
let scratch, socket, started = false;
const port = '65439'; // UNIX-only socket in a unique temporary directory.
const username = 'formula_job_sync_synthetic';
// A shell without LANG/LC_ALL (launchd, some terminal panes) makes the postmaster
// abort with "postmaster became multithreaded during startup"; the deploy gate
// then stops on 19 unrelated failures (14 ต.ค. 2569). Pin a valid locale here so
// the disposable cluster starts the same way everywhere.
const env = { ...process.env, LC_ALL: process.env.LC_ALL || 'C' };
const run = (bin, args, input) => {
  const result = spawnSync(bin, args, { input, encoding: 'utf8', maxBuffer: 4e6, env });
  assert.equal(result.error, undefined, `${bin}: ${result.error?.message}`);
  assert.equal(result.status, 0, `${bin}: ${result.stderr}`);
  return result.stdout.trim();
};
const args = () => ['-X', '-h', socket, '-p', port, '-U', username, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'];
const sql = text => run('psql', args(), text);
const sqlAsync = text => new Promise((resolve, reject) => {
  const child = spawn('psql', args(), { stdio: ['pipe', 'pipe', 'pipe'], env });
  let out = '', err = '';
  child.stdout.on('data', x => out += x);
  child.stderr.on('data', x => err += x);
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err)));
  child.stdin.end(text);
});
const literal = object => `'${JSON.stringify(object).replaceAll("'", "''")}'::jsonb`;
const record = (id = 'A09001', extra = {}) => ({ id, customer: 'Synthetic customer', brand: '', rows: [], ...extra });
const saveQuery = (data, expected = null) => `select public.fs_save_record('${data.id}', ${literal(data)}, ${expected === null ? 'null' : literal(expected)});`;
const save = (data, expected = null) => JSON.parse(sql(`set role anon; ${saveQuery(data, expected)}`));
async function awaitSyntheticSleep() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (sql("select count(*) from pg_stat_activity where usename='formula_job_sync_synthetic' and wait_event='PgSleep';") === '1') return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Synthetic writer did not reach its transaction lock');
}

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'formula-job-sync-'));
  socket = join(scratch, 'socket');
  await mkdir(socket);
  run('initdb', ['-D', join(scratch, 'data'), '-A', 'trust', '-U', username, '--no-locale']);
  run('pg_ctl', ['-D', join(scratch, 'data'), '-l', join(scratch, 'server.log'), '-o', `-F -p ${port} -k ${socket} -c listen_addresses=''`, '-w', 'start']);
  started = true;
  sql('create role anon; create role authenticated;');
  for (const file of ['docs/upstream-schema.sql', 'runtime/data-grants.sql', 'runtime/data-policy.sql', 'runtime/job-sync.sql']) {
    sql(await readFile(new URL(file, root), 'utf8'));
  }
});
after(async () => {
  if (started) run('pg_ctl', ['-D', join(scratch, 'data'), '-m', 'fast', '-w', 'stop']);
  if (scratch) await rm(scratch, { recursive: true, force: true });
});
beforeEach(() => sql('truncate public.fs_records, public.fs_chats, public.fs_messages, public.fs_approvals, public.fs_archive, public.fs_activities;'));

test('migration can be reapplied without changing stored rows or protection grants', async () => {
  const data = record();
  save(data);
  sql(await readFile(new URL('runtime/job-sync.sql', root), 'utf8'));
  assert.deepEqual(JSON.parse(sql("select data from fs_records where id='A09001';")), data);
  assert.equal(sql("select has_table_privilege('anon','fs_records','truncate');"), 'f');
  assert.equal(sql("select prosecdef from pg_proc where oid='public.fs_save_record(text,jsonb,jsonb)'::regprocedure;"), 'f');
  assert.equal(sql("select has_function_privilege('public','public.fs_save_record(text,jsonb,jsonb)','execute');"), 'f');
});

test('create, compare-and-save and duplicate network retry return actual saved JSON', () => {
  const original = record();
  assert.deepEqual(save(original), { status: 'saved', id: original.id, data: original });
  const changed = record(undefined, { notes: 'Synthetic change' });
  assert.deepEqual(save(changed, original), { status: 'saved', id: changed.id, data: changed });
  assert.deepEqual(save(changed, original), { status: 'saved', id: changed.id, data: changed });
});

test('multiletter job prefix from sealed app sequence remains supported', () => {
  const data = record('AA00001');
  assert.deepEqual(save(data), { status: 'saved', id: data.id, data });
  assert.deepEqual(JSON.parse(sql("select data from fs_records where id='AA00001';")), data);
});

test('stale expected data, missing expected row and create collision never overwrite', () => {
  const original = record();
  const changed = record(undefined, { notes: 'Conflicting update' });
  save(original);
  assert.deepEqual(save(changed), { status: 'conflict', id: changed.id });
  assert.deepEqual(save(changed, { ...original, notes: 'Unknown revision' }), { status: 'conflict', id: changed.id });
  assert.deepEqual(save(record('A09002'), record('A09002')), { status: 'conflict', id: 'A09002' });
  assert.deepEqual(JSON.parse(sql("select data from fs_records where id='A09001';")), original);
});

test('invalid ID, wrong ID, absent name, nonobject, malformed rows are rejected without writes', () => {
  const invalid = [record('a09001'), record('A9001'), record('A090001'), record(undefined, { customer: '', brand: '  ' }), record(undefined, { customer: '\t\n', brand: '' }), record(undefined, { customer: 12 }), record(undefined, { rows: {} }), record(undefined, { rows: null })];
  for (const data of invalid) assert.equal(save(data).status, 'invalid');
  assert.equal(JSON.parse(sql(`set role anon; select fs_save_record('A09001', ${literal(record('A09002'))}, null);`)).status, 'invalid');
  assert.equal(JSON.parse(sql("set role anon; select fs_save_record('A09001', '[]', null);" )).status, 'invalid');
  assert.equal(JSON.parse(sql(`set role anon; select fs_save_record('A09001', ${literal(record())}, '[]');`)).status, 'invalid');
  assert.equal(sql('select count(*) from fs_records;'), '0');
  assert.equal(save(record(undefined, { customer: '', brand: 'Synthetic brand' })).status, 'saved');
});

test('concurrent CAS updates permit one winner and expose no record on conflict', async () => {
  const original = record();
  save(original);
  const results = await Promise.all(['First', 'Second'].map(notes => sqlAsync(`set role anon; ${saveQuery(record(undefined, { notes }), original)}`).then(JSON.parse)));
  assert.deepEqual(results.map(r => r.status).sort(), ['conflict', 'saved']);
  assert.equal(Object.hasOwn(results.find(r => r.status === 'conflict'), 'data'), false);
  assert.deepEqual(JSON.parse(sql("select data from fs_records where id='A09001';")), results.find(r => r.status === 'saved').data);
});

test('concurrent create calls cannot overwrite different records sharing the same job number', async () => {
  const results = await Promise.all(['First', 'Second'].map(notes => sqlAsync(`set role anon; ${saveQuery(record(undefined, { notes }))}`).then(JSON.parse)));
  assert.deepEqual(results.map(r => r.status).sort(), ['conflict', 'saved']);
  assert.equal(sql('select count(*) from fs_records;'), '1');
});

test('concurrent legacy insertion wins safely without RPC overwriting unseen data', async () => {
  const legacy = record(undefined, { notes: 'Legacy committed first' });
  const writer = sqlAsync(`begin; insert into fs_records(id,data) values ('A09001',${literal(legacy)}); select pg_sleep(0.4); commit;`);
  await awaitSyntheticSleep();
  const result = await sqlAsync(`set role anon; ${saveQuery(record())}`).then(JSON.parse);
  await writer;
  assert.deepEqual(result, { status: 'conflict', id: 'A09001' });
  assert.deepEqual(JSON.parse(sql("select data from fs_records where id='A09001';")), legacy);
});

test('CAS waits for a legacy update and detects its stale expected revision', async () => {
  const original = record();
  save(original);
  const legacy = record(undefined, { notes: 'Legacy update' });
  const writer = sqlAsync(`begin; update fs_records set data=${literal(legacy)} where id='A09001'; select pg_sleep(0.4); commit;`);
  await awaitSyntheticSleep();
  const result = await sqlAsync(`set role anon; ${saveQuery(record(undefined, { notes: 'Stale RPC' }), original)}`).then(JSON.parse);
  await writer;
  assert.deepEqual(result, { status: 'conflict', id: 'A09001' });
  assert.deepEqual(JSON.parse(sql("select data from fs_records where id='A09001';")), legacy);
});

test('child insertion waits for concurrent parent deletion, then skips the orphan write', async () => {
  save(record());
  const writer = sqlAsync("begin; delete from fs_records where id='A09001'; select pg_sleep(0.4); commit;");
  await awaitSyntheticSleep();
  await sqlAsync("set role anon; insert into fs_chats(job_id,data) values ('A09001','{}');");
  await writer;
  assert.equal(sql('select count(*) from fs_chats;'), '0');
});

test('lost create ACK followed by deletion cannot recreate the archived job or expose its payload', async () => {
  const original = record();
  save(original); // The caller loses this successful response.
  sql("set role anon; delete from fs_records where id='A09001';");
  const archive = sql("select data from fs_archive where source='fs_records' and row_key='A09001';");
  assert.deepEqual(save(original), {status:'conflict',id:'A09001'});
  assert.deepEqual(save({...original, notes:'A different create-only retry'}), {status:'conflict',id:'A09001'});
  assert.equal(sql('select count(*) from fs_records;'), '0');
  assert.equal(sql("select data from fs_archive where source='fs_records' and row_key='A09001';"), archive);
  // Reinstalling an approved migration must preserve the deletion fence.
  sql(await readFile(new URL('runtime/job-sync.sql', root), 'utf8'));
  assert.deepEqual(save(original), {status:'conflict',id:'A09001'});
  assert.equal(sql("select has_table_privilege('anon','fs_archive','select');"), 'f');
  assert.equal(sql("select has_table_privilege('authenticated','fs_archive','select');"), 'f');
  assert.equal(sql("select prosecdef from pg_proc where oid='public.fs_save_record(text,jsonb,jsonb)'::regprocedure;"), 'f');
  assert.equal(sql("select has_function_privilege('anon','public.fs_record_recreation_fence()','execute');"),'f');
  assert.equal(sql("select proconfig from pg_proc where oid='public.fs_record_recreation_fence()'::regprocedure;"),'{"search_path=pg_catalog, pg_temp"}');
  const legacy=spawnSync('psql',args(),{input:`set role anon; insert into fs_records(id,data) values ('A09001',${literal(original)});`,encoding:'utf8'});
  assert.notEqual(legacy.status,0,'legacy direct insertion cannot bypass the fence');
  assert.match(legacy.stderr,/JOB_ID_DELETED/);
  assert.equal(sql('select count(*) from fs_records;'),'0');
});

test('retry waiting for a concurrent delete observes its tombstone and cannot resurrect the row', async () => {
  const original = record();save(original);
  const deletion = sqlAsync("begin; delete from fs_records where id='A09001'; select pg_sleep(0.4); commit;");
  await awaitSyntheticSleep();
  const retry = await sqlAsync(`set role anon; ${saveQuery(original)}`).then(JSON.parse);
  await deletion;
  assert.deepEqual(retry,{status:'conflict',id:'A09001'});
  assert.equal(sql('select count(*) from fs_records;'),'0');
  assert.equal(sql("select count(*) from fs_archive where source='fs_records' and row_key='A09001';"),'1');
});

test('unique-index waiting for an uncommitted legacy insert then delete cannot bypass the deletion fence', async () => {
  const original=record();
  const writer=sqlAsync(`begin; insert into fs_records(id,data) values ('A09001',${literal(original)}); select pg_sleep(0.4); delete from fs_records where id='A09001'; commit;`);
  await awaitSyntheticSleep();
  const retry=await sqlAsync(`set role anon; ${saveQuery(original)}`).then(JSON.parse);
  await writer;
  assert.deepEqual(retry,{status:'conflict',id:'A09001'});
  assert.equal(sql('select count(*) from fs_records;'),'0');
  assert.equal(sql("select count(*) from fs_archive where source='fs_records' and row_key='A09001';"),'1');
});

test('a deletion following a retry lock completes without advisory/row-lock inversion', async () => {
  const original=record();save(original);
  const retry=sqlAsync(`begin; set role anon; ${saveQuery(original)} select pg_sleep(0.4); commit;`);
  await awaitSyntheticSleep();
  const deletion=sqlAsync("set statement_timeout='2s'; delete from fs_records where id='A09001';");
  await Promise.all([retry,deletion]);
  assert.equal(sql('select count(*) from fs_records;'),'0');
  assert.deepEqual(save(original),{status:'conflict',id:'A09001'});
});

test('integrity snapshot is complete all-history metadata and distinguishes log-only, saved, closed, rejected, deleted and chat intent', () => {
  const addIntent=(id,action='สร้างชุดข้อมูลใหม่',cat='job',ts=1)=>sql(`insert into fs_activities(uid,ts,data) values ('${id}-${cat}-${ts}',${ts},${literal({job:id,cat,action,detail:'Synthetic private detail',user:'Synthetic private actor'})});`);
  addIntent('A09001');
  save(record('A09002'));addIntent('A09002','คัดลอกงานเป็นรหัสใหม่','job',-999);
  save(record('A09003',{closed:{by:'Synthetic private actor',ts:1}}));addIntent('A09003',undefined,undefined,9999999999999);
  save(record('A09004',{rejected:{by:'Synthetic private actor',ts:1}}));addIntent('A09004');
  save(record('A09005'));addIntent('A09005');sql("delete from fs_records where id='A09005';");
  assert.equal(sql("set role anon; select public.fs_owner_deleted_jobs(array['A09005']::text[],'');"),'[]');
  save(record('A09011',{createdBy:'Synthetic private owner'}));
  sql("delete from fs_records where id='A09011';");
  assert.equal(sql("set role anon; select public.fs_owner_deleted_jobs(array['A09011']::text[],'Synthetic private owner');"),'[\"A09011\"]');
  assert.equal(sql("set role anon; select public.fs_owner_deleted_jobs(array['A09011']::text[],'Another owner');"),'[]');
  save(record('A09012',{createdBy:'Archive marker',salesOwner:'1.Sales Owner'}));
  sql("delete from fs_records where id='A09012';");
  assert.equal(sql("set role anon; select public.fs_owner_deleted_jobs(array['A09012']::text[],'Owner');"),'[\"A09012\"]');
  assert.equal(sql("set role anon; select public.fs_owner_deleted_jobs(array['A09012']::text[],'MKT');"),'[]');
  addIntent('A09006','สร้างห้องแชท','chat');
  save(record('A09007'));addIntent('A09007','สร้างห้องแชท','chat');sql("insert into fs_chats(job_id,data) values ('A09007','{}');");
  save(record('A09008'));addIntent('A09008','สร้างห้องแชท','chat');sql("insert into fs_chats(job_id,data) values ('A09008','{}'); delete from fs_chats where job_id='A09008';");
  sql("insert into fs_records(id,data) values ('A09009','{}');");addIntent('A09009');
  addIntent('A09002','สร้างห้องแชท','chat',2); // Distinct intents aggregate one ID.
  addIntent('A09010','ส่งข้อความ','chat'); // Noncreation events do not fabricate intent.
  addIntent('a09011'); // Invalid IDs never enter the metadata scan.
  const before=sql('select (select count(*) from fs_records),(select count(*) from fs_activities),(select count(*) from fs_archive);');
  const snapshot=JSON.parse(sql('set role anon; select public.fs_job_integrity_snapshot();'));
  assert.equal(snapshot.version,1);assert.equal(snapshot.complete,true);assert.equal(snapshot.total,9);assert.equal(snapshot.items.length,9);
  const byId=Object.fromEntries(snapshot.items.map(item=>[item.id,item]));
  assert.deepEqual(byId.A09001,{id:'A09001',exists:false,valid:false,closed:false,rejected:false,deleted:false,chatRequired:false,chatExists:false,chatDeleted:false});
  assert.equal(byId.A09002.valid,true);assert.equal(byId.A09002.chatRequired,true);assert.equal(byId.A09002.chatExists,false);
  assert.equal(byId.A09003.closed,true);assert.equal(byId.A09004.rejected,true);
  assert.equal(byId.A09005.deleted,true);assert.equal(byId.A09005.exists,false);
  assert.equal(byId.A09006.chatRequired,true);assert.equal(byId.A09006.valid,false);
  assert.equal(byId.A09007.chatExists,true);
  assert.equal(byId.A09008.chatExists,false);assert.equal(byId.A09008.chatDeleted,true);
  assert.equal(byId.A09009.exists,true);assert.equal(byId.A09009.valid,false);
  for(const item of snapshot.items)assert.deepEqual(Object.keys(item).sort(),['id','exists','valid','closed','rejected','deleted','chatRequired','chatExists','chatDeleted'].sort());
  assert.equal(JSON.stringify(snapshot).includes('Synthetic private'),false);
  assert.equal(sql('select (select count(*) from fs_records),(select count(*) from fs_activities),(select count(*) from fs_archive);'),before);
  assert.equal(sql("select has_function_privilege('public','public.fs_job_integrity_snapshot()','execute');"),'f');
  assert.equal(sql("select has_table_privilege('anon','fs_archive','select');"),'f');
});

test('integrity snapshot reports incomplete with no subset when the explicit bound is exceeded', () => {
  sql("insert into fs_activities(uid,ts,data) select 'synthetic-'||g,1,jsonb_build_object('job','A'||lpad(g::text,5,'0'),'cat','job','action','สร้างชุดข้อมูลใหม่') from generate_series(1,20001) g;");
  const snapshot=JSON.parse(sql('set role authenticated; select public.fs_job_integrity_snapshot();'));
  assert.deepEqual(snapshot,{version:1,complete:false,total:20001,items:[]});
});

test('saved response uses trigger-normalized stored data; skipped update is not acknowledged', () => {
  sql(`create function synthetic_normalize() returns trigger language plpgsql as $$ begin new.data := new.data || '{"serverNormalized":true}'::jsonb; return new; end $$;
    create trigger synthetic_normalize before insert on fs_records for each row execute function synthetic_normalize();`);
  const original = record();
  try { assert.deepEqual(save(original).data, { ...original, serverNormalized: true }); }
  finally { sql('drop trigger synthetic_normalize on fs_records; drop function synthetic_normalize();'); }
  sql(`create function synthetic_skip() returns trigger language plpgsql as $$ begin return null; end $$;
    create trigger synthetic_skip before update on fs_records for each row execute function synthetic_skip();`);
  try {
    const stored = { ...original, serverNormalized: true };
    assert.equal(save({ ...stored, notes: 'Cannot store' }, stored).status, 'invalid');
    assert.deepEqual(JSON.parse(sql("select data from fs_records where id='A09001';")), stored);
  } finally { sql('drop trigger synthetic_skip on fs_records; drop function synthetic_skip();'); }
});

test('chat, message and approval writes are skipped for missing or invalid parents without aborting legacy sync', () => {
  sql(`insert into fs_records(id,data) values ('A09002','{"id":"A09002","customer":"","rows":[]}');`);
  for (const id of ['A09001', 'A09002']) {
    sql(`set role anon; begin;
      insert into fs_chats(job_id,data) values ('${id}','{}');
      insert into fs_messages(uid,job_id,ts,data) values ('${id}-message','${id}',1,'{}');
      insert into fs_approvals(job_id,part,data) values ('${id}','pd','{}');
      insert into fs_activities(uid,ts,data) values ('${id}-activity',1,'{}') on conflict do nothing;
      commit;`);
  }
  assert.equal(sql('select (select count(*) from fs_chats)+(select count(*) from fs_messages)+(select count(*) from fs_approvals);'), '0');
  assert.equal(sql('select count(*) from fs_activities;'), '2');
});

test('valid parent permits child writes; later invalid parent prevents child updates and retains legacy rows', () => {
  save(record());
  sql(`set role anon;
    insert into fs_chats(job_id,data) values ('A09001','{}');
    insert into fs_messages(uid,job_id,ts,data) values ('synthetic-message','A09001',1,'{}');
    insert into fs_approvals(job_id,part,data) values ('A09001','pd','{}');`);
  assert.equal(sql('select (select count(*) from fs_chats)+(select count(*) from fs_messages)+(select count(*) from fs_approvals);'), '3');
  sql(`update fs_records set data='{}' where id='A09001'; set role anon;
    update fs_chats set data='{"changed":true}';
    update fs_messages set data='{"changed":true}';
    update fs_approvals set data='{"changed":true}';`);
  assert.equal(sql("select count(*) from (select data from fs_chats union all select data from fs_messages union all select data from fs_approvals) s where data='{}';"), '3');
});
