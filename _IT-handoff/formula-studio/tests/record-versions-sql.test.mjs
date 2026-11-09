// Actual SQL on a disposable cluster. No production socket, port, environment
// file, credential, or existing database is used by this test.
//
// runtime/record-versions.sql: every change to fs_records.data keeps the old
// row in fs_archive under its own source ('fs_records_version'), readable only
// through the SECURITY DEFINER RPC the proxy calls. The 'fs_records' source
// still means "deleted" for the recreation fence and job-integrity.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
let scratch, socket, started = false;
const port = '65441';
const username = 'formula_record_versions_synthetic';
const env = { ...process.env, LC_ALL: process.env.LC_ALL || 'C' };
const run = (bin, args, input) => {
  const result = spawnSync(bin, args, { input, encoding: 'utf8', maxBuffer: 4e6, env });
  assert.equal(result.error, undefined, `${bin}: ${result.error?.message}`);
  assert.equal(result.status, 0, `${bin}: ${result.stderr}`);
  return result.stdout.trim();
};
const tryRun = (bin, args, input) => spawnSync(bin, args, { input, encoding: 'utf8', maxBuffer: 4e6, env });
const args = () => ['-X', '-h', socket, '-p', port, '-U', username, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'];
const sql = text => run('psql', args(), text);
const literal = object => `'${JSON.stringify(object).replaceAll("'", "''")}'::jsonb`;
const record = (id = 'A09101', extra = {}) => ({ id, customer: 'Synthetic customer', brand: '', rows: [], ...extra });
const save = (data, expected = null) => JSON.parse(sql(`set role anon; select public.fs_save_record('${data.id}', ${literal(data)}, ${expected === null ? 'null' : literal(expected)});`));

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'formula-record-versions-'));
  socket = join(scratch, 'socket');
  await mkdir(socket);
  run('initdb', ['-D', join(scratch, 'data'), '-A', 'trust', '-U', username, '--no-locale']);
  run('pg_ctl', ['-D', join(scratch, 'data'), '-l', join(scratch, 'server.log'), '-o', `-F -p ${port} -k ${socket} -c listen_addresses=''`, '-w', 'start']);
  started = true;
  sql('create role anon; create role authenticated;');
  for (const file of ['docs/upstream-schema.sql', 'runtime/data-grants.sql', 'runtime/data-policy.sql', 'runtime/job-sync.sql', 'runtime/record-versions.sql']) {
    sql(await readFile(new URL(file, root), 'utf8'));
  }
});
after(async () => {
  if (started) tryRun('pg_ctl', ['-D', join(scratch, 'data'), '-m', 'immediate', 'stop']);
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

test('an update that changes data keeps the previous row as a version; an identical save keeps nothing', () => {
  const first = record('A09101', { brand: 'First', updatedBy: 'Synthetic pd' });
  assert.equal(save(first).status, 'saved');
  assert.equal(sql("select count(*) from public.fs_archive where source='fs_records_version' and row_key='A09101';"), '0', 'an insert is not a version');
  const second = { ...first, brand: 'Second', updatedBy: 'Synthetic sales' };
  assert.equal(save(second, first).status, 'saved');
  assert.equal(sql("select count(*) from public.fs_archive where source='fs_records_version' and row_key='A09101';"), '1');
  assert.equal(save(second, second).status, 'saved', 'a no-op save is still acknowledged');
  assert.equal(sql("select count(*) from public.fs_archive where source='fs_records_version' and row_key='A09101';"), '1', 'unchanged data keeps no version');
  const versions = JSON.parse(sql("set role anon; select coalesce(jsonb_agg(data order by archived_at desc), '[]'::jsonb) from public.fs_record_versions('A09101', 12);"));
  assert.deepEqual(versions.map(v => [v.brand, v.updatedBy]), [['First', 'Synthetic pd']], 'the RPC returns the previous data with its editor');
});

test('versions are newest first, limited, and never confused with a deletion', () => {
  let current = record('A09102', { brand: 'v0' });
  assert.equal(save(current).status, 'saved');
  for (let i = 1; i <= 4; i++) {
    const next = { ...current, brand: `v${i}` };
    assert.equal(save(next, current).status, 'saved');
    current = next;
  }
  const brands = JSON.parse(sql("set role anon; select jsonb_agg(data->'brand' order by archived_at desc) from public.fs_record_versions('A09102', 12);"));
  assert.deepEqual(brands, ['v3', 'v2', 'v1', 'v0']);
  assert.equal(sql("set role anon; select count(*) from public.fs_record_versions('A09102', 2);"), '2', 'the limit is honoured');
  assert.equal(sql("set role anon; select count(*) from public.fs_record_versions('A09102', 500);"), '4', 'the limit is clamped, not an error');
  // A job with versions is not a deleted job: it can still be saved, and the
  // recreation fence only looks at the 'fs_records' source.
  assert.equal(save({ ...current, brand: 'v5' }, current).status, 'saved');
  assert.equal(sql("select count(*) from public.fs_archive where source='fs_records' and row_key='A09102';"), '0');
  assert.equal(sql("select count(*) from public.fs_records where id='A09102';"), '1');
});

test('browsers cannot read the archive directly or call the RPC with a malformed id', () => {
  const direct = tryRun('psql', args(), "set role anon; select count(*) from public.fs_archive;");
  assert.notEqual(direct.status, 0, 'anon has no grant on fs_archive');
  assert.match(direct.stderr, /permission denied/);
  assert.equal(sql("set role anon; select count(*) from public.fs_record_versions('A09102; drop table fs_records', 12);"), '0', 'a malformed id matches nothing');
  assert.equal(sql("select count(*) from public.fs_records;"), '2');
  const owner = sql("select proowner::regrole::text from pg_proc where proname='fs_record_versions';");
  assert.equal(owner, username, 'the RPC runs as the installing owner, not the caller');
});
