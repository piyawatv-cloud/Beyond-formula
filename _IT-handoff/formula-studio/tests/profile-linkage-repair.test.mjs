// Actual SQL behavior against a disposable cluster with a private Unix socket.
// No inherited database environment, credentials, Docker or TCP listener.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const username = 'formula_profile_repair_synthetic';
const port = '65444';
const env = { PATH: process.env.PATH, LC_ALL: 'C', LANG: 'C' };
let scratch, socket, started = false;
const execute = (command, args, input) => spawnSync(command, args, {
  input, encoding: 'utf8', maxBuffer: 4e6, env,
});
const run = (command, args, input) => {
  const result = execute(command, args, input);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const args = () => ['-X', '-h', socket, '-p', port, '-U', username, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'];
const sql = text => run('psql', args(), text);
const literal = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const names = ['Synthetic Alpha', 'Synthetic Beta'];
const links = i => ({ central_user_id: `${i + 1}1111111-1111-4111-8111-111111111111`, provisionedBy: 'opc-user-access' });
const snapshot = () => sql('set timezone=UTC; select jsonb_agg(to_jsonb(u) order by name) from public.fs_users u;');
const hashes = () => JSON.parse(sql("set timezone=UTC; select jsonb_object_agg(name,encode(sha256(convert_to(to_jsonb(u)::text,'UTF8')),'hex')) from public.fs_users u;"));
function manifest(mode = 'apply') {
  const expected = hashes();
  return { version: 1, mode, authorization_ref: 'synthetic-owner-approval',
    profiles: names.map((name, i) => ({ name, expected_row_sha256: expected[name], restore: links(i) })) };
}
async function repair(value, prefix = '', rawHex) {
  const artifact = await readFile(new URL('runtime/profile-linkage-repair.sql', root), 'utf8');
  const hex = rawHex ?? Buffer.from(JSON.stringify(value), 'utf8').toString('hex');
  // Hex input is synthetic and deliberately contains no executable SQL.
  assert.match(hex, /^[a-zA-Z0-9]*$/);
  return execute('psql', args(), `${prefix}\nset formula.profile_repair_manifest_hex='${hex}';\n${artifact}`);
}
const report = result => {
  assert.equal(result.status, 0, result.stderr);
  const line = result.stderr.split('\n').find(line => line.startsWith('NOTICE:'));
  assert.ok(line, result.stderr);
  return JSON.parse(line.slice('NOTICE:'.length));
};
async function rejected(value, options = {}) {
  const before = snapshot();
  const result = await repair(value, options.prefix, options.rawHex);
  assert.notEqual(result.status, 0, 'unsafe input must fail closed');
  assert.match(result.stderr, /ERROR:  PROFILE_REPAIR_REJECTED/);
  assert.equal(result.stderr.trim(), 'ERROR:  PROFILE_REPAIR_REJECTED', 'errors expose no values, hashes or SQL context');
  assert.equal(snapshot(), before);
}
before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'formula-profile-repair-'));
  socket = join(scratch, 'socket'); await mkdir(socket);
  run('initdb', ['-D', join(scratch, 'data'), '-A', 'trust', '-U', username, '--no-locale']);
  run('pg_ctl', ['-D', join(scratch, 'data'), '-l', join(scratch, 'server.log'), '-o', `-F -p ${port} -k ${socket} -c listen_addresses=''`, '-w', 'start']);
  started = true;
  sql('create role anon; create role authenticated; create role synthetic_unprivileged;');
  for (const file of ['docs/upstream-schema.sql', 'runtime/data-grants.sql', 'runtime/data-policy.sql']) {
    sql(await readFile(new URL(file, root), 'utf8'));
  }
});
after(async () => {
  if (started) run('pg_ctl', ['-D', join(scratch, 'data'), '-m', 'immediate', '-w', 'stop']);
  if (scratch) await rm(scratch, { recursive: true, force: true });
});
beforeEach(async () => {
  sql(await readFile(new URL('runtime/profile-linkage-policy.sql', root), 'utf8'));
  sql('truncate public.fs_users;');
  for (const name of [...names, 'Synthetic Unrelated']) {
    sql(`insert into public.fs_users(name,data,updated_at) values ('${name}',${literal({ name, email: 'synthetic@example.invalid', role: 'sales', pass: 'inert-synthetic', extra: { retained: true } })},'2020-01-01T00:00:00Z');`);
  }
});

test('omitted mode defaults to dry-run with counts only and no row updates', async () => {
  const value = manifest(); delete value.mode;
  const before = snapshot();
  assert.deepEqual(report(await repair(value)), { mode: 'dry-run', target_rows: 2, would_restore: 2, restored: 0, already_present: 0 });
  assert.equal(snapshot(), before);
});

test('apply restores exactly four fields, retains all other data, and normal touch advances timestamp', async () => {
  const value = manifest(); const before = JSON.parse(snapshot());
  assert.deepEqual(report(await repair(value, "set timezone='Asia/Bangkok';")), { mode: 'apply', target_rows: 2, would_restore: 2, restored: 2, already_present: 0 });
  const after = JSON.parse(snapshot());
  for (let i = 0; i < names.length; i++) {
    assert.equal(after[i].name, before[i].name);
    assert.deepEqual(after[i].data, { ...before[i].data, ...links(i) });
    assert.ok(Date.parse(after[i].updated_at) > Date.parse(before[i].updated_at));
  }
  assert.deepEqual(after[2], before[2]);
  const once = snapshot();
  assert.deepEqual(report(await repair(value)), { mode: 'apply', target_rows: 2, would_restore: 0, restored: 0, already_present: 2 });
  assert.equal(snapshot(), once, 'idempotent repeat does not fire touch or write rows');
});

test('drift on the second row rolls back the first row write', async () => {
  const value = manifest();
  sql(`update public.fs_users set data=data || '{"changed":"synthetic"}' where name='${names[1]}';`);
  await rejected(value);
  assert.equal(sql("select count(*) from public.fs_users where data ? 'central_user_id';"), '0');
});

test('missing profile and partial or contradictory existing metadata abort unchanged', async () => {
  for (const mutation of [
    `delete from public.fs_users where name='${names[1]}';`,
    ...[{ central_user_id: links(1).central_user_id }, { provisionedBy: 'opc-user-access' },
      { ...links(1), provisionedBy: 'foreign-provisioner' }, { ...links(0) }, { central_user_id: null, provisionedBy: null }]
      .map(fields => `update public.fs_users set data=data || ${literal(fields)} where name='${names[1]}';`),
  ]) {
    const before = snapshot(); const value = manifest(); sql(mutation); await rejected(value);
    sql('truncate public.fs_users;');
    for (const row of JSON.parse(before)) sql(`insert into public.fs_users select * from jsonb_populate_record(null::public.fs_users,${literal(row)});`);
  }
});

test('apply requires installed enabled exact invoker guard, while dry-run can precede installation', async () => {
  for (const mutation of [
    'drop trigger fs_users_preserve_profile_linkage on public.fs_users;',
    'alter table public.fs_users disable trigger fs_users_preserve_profile_linkage;',
    'alter function public.fs_preserve_profile_linkage() security definer;',
    'alter function public.fs_preserve_profile_linkage() set search_path=public;',
  ]) {
    sql(mutation); await rejected(manifest());
    assert.equal(report(await repair(manifest('dry-run'))).would_restore, 2);
    sql(await readFile(new URL('runtime/profile-linkage-policy.sql', root), 'utf8'));
  }
});

test('operator privilege and explicit nonempty apply authorization are mandatory', async () => {
  for (const role of ['anon', 'authenticated', 'synthetic_unprivileged']) {
    await rejected(manifest(), { prefix: `set role ${role};` });
  }
  for (const authorization_ref of ['', '   ', '\t\n', null, false, 1]) {
    await rejected({ ...manifest(), authorization_ref });
  }
});

test('malformed, missing and non-object manifest fail with a static masked error', async () => {
  for (const rawHex of ['', 'zz', '0', 'ff', Buffer.from('{"private":"synthetic-secret"').toString('hex')]) {
    await rejected(null, { rawHex });
  }
  for (const value of [null, false, 1, 'synthetic-secret', [], {}]) await rejected(value);
  const artifact = await readFile(new URL('runtime/profile-linkage-repair.sql', root), 'utf8');
  const missing = execute('psql', args(), artifact);
  assert.notEqual(missing.status, 0);
  assert.equal(missing.stderr.trim(), 'ERROR:  PROFILE_REPAIR_REJECTED');
});

test('unknown keys, invalid modes/version/count and duplicate profiles cannot change rows', async () => {
  for (const change of [
    value => { value.foreign = true; }, value => { value.version = '1'; }, value => { value.version = 2; },
    value => { delete value.version; }, value => { delete value.authorization_ref; },
    ...[false, null, 'APPLY', '', 1].map(mode => value => { value.mode = mode; }),
    value => { value.profiles = {}; }, value => { value.profiles = []; },
    value => { value.profiles.pop(); }, value => { value.profiles.push(value.profiles[0]); },
    value => { value.profiles[1].name = value.profiles[0].name; },
    value => { value.profiles[1].foreign = true; }, value => { value.profiles[1] = null; },
  ]) { const value = manifest(); change(value); await rejected(value); }
});

test('invalid profile names, hashes, restore keys and field types fail unchanged', async () => {
  for (const change of [
    ...['', ' ', '\t\n', null, false, 1].map(name => profile => { profile.name = name; }),
    ...['A'.repeat(64), '0'.repeat(63), null, 1].map(hash => profile => { profile.expected_row_sha256 = hash; }),
    ...[null, false, [], 'synthetic'].map(restore => profile => { profile.restore = restore; }),
    profile => { profile.restore.email = 'forged@example.invalid'; },
    profile => { delete profile.restore.provisionedBy; }, profile => { delete profile.restore.central_user_id; },
    ...['invalid-uuid', null, 1, false].map(id => profile => { profile.restore.central_user_id = id; }),
    ...['foreign', null, false].map(provenance => profile => { profile.restore.provisionedBy = provenance; }),
  ]) { const value = manifest(); change(value.profiles[1]); await rejected(value); }
});
