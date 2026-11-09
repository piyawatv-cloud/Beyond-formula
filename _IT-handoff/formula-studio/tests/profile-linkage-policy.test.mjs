// Real PostgreSQL in a private temporary Unix socket; no production environment,
// credentials, network listener, database or docker access is used.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const username = 'formula_profile_linkage_synthetic';
const port = '65443';
const env = { PATH: process.env.PATH, LC_ALL: 'C', LANG: 'C' };
let scratch, socket, bin, started = false;
const execute = (command, args, input, extra = {}) => spawnSync(command, args, {
  input, encoding: 'utf8', maxBuffer: 4e6, env: { ...env, ...extra },
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
const metadata = { central_user_id: '11111111-1111-4111-8111-111111111111', provisionedBy: 'opc-user-access' };
const original = { name: 'Synthetic', email: 'synthetic@example.invalid', role: 'sales', pass: 'synthetic-inert-hash' };
const upsert = (role, data) => `set role ${role}; insert into public.fs_users(name,data) values ('Synthetic',${literal(data)}) on conflict(name) do update set data=excluded.data;`;
const stored = () => JSON.parse(sql("select data from public.fs_users where name='Synthetic';"));
const migration = () => readFile(new URL('runtime/profile-linkage-policy.sql', root), 'utf8');
const install = async () => sql(await migration());
function connection(text) {
  const child = spawn('psql', args(), { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(errors)));
  });
  if (text !== undefined) child.stdin.end(text);
  return { child, done, output: () => output };
}
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Synthetic interleaving did not reach expected state');
}
const gate = () => execute('sh', [new URL('scripts/verify-data-policy.sh', root).pathname], undefined, {
  PATH: `${bin}:${env.PATH}`, SYNTHETIC_SOCKET: socket, SYNTHETIC_PORT: port, SYNTHETIC_USER: username,
  FORMULA_PG_CONTAINER: 'synthetic-private-cluster', FORMULA_POSTGREST_URL: 'http://synthetic.invalid',
  PGOPTIONS: '-c default_transaction_read_only=on',
});

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'formula-profile-policy-'));
  socket = join(scratch, 'socket'); bin = join(scratch, 'bin');
  await mkdir(socket); await mkdir(bin);
  run('initdb', ['-D', join(scratch, 'data'), '-A', 'trust', '-U', username, '--no-locale']);
  run('pg_ctl', ['-D', join(scratch, 'data'), '-l', join(scratch, 'server.log'), '-o', `-F -p ${port} -k ${socket} -c listen_addresses=''`, '-w', 'start']);
  started = true;
  sql('create role anon; create role authenticated;');
  for (const file of ['docs/upstream-schema.sql', 'runtime/data-grants.sql', 'runtime/data-policy.sql', 'runtime/job-sync.sql']) {
    sql(await readFile(new URL(file, root), 'utf8'));
  }
  await install();
  // Run every real verifier SQL query against this private cluster, enforcing
  // read-only transactions. Never invoke Docker or a real HTTP endpoint.
  await writeFile(join(bin, 'docker'), `#!/bin/sh
set -eu
[ "$1" = exec ]; shift
if [ "$1" = -i ]; then shift; fi
[ "$1" = synthetic-private-cluster ]; shift
case "$1" in
  pg_isready) exec pg_isready -h "$SYNTHETIC_SOCKET" -p "$SYNTHETIC_PORT" -U "$SYNTHETIC_USER" -d postgres ;;
  psql)
    shift
    while [ "$#" -gt 0 ]; do
      if [ "$1" = -c ]; then
        shift
        exec psql -X -h "$SYNTHETIC_SOCKET" -p "$SYNTHETIC_PORT" -U "$SYNTHETIC_USER" -d postgres -Atq -v ON_ERROR_STOP=1 -c "$1"
      fi
      shift
    done ;;
  *) exit 90 ;;
esac
`);
  await writeFile(join(bin, 'curl'), `#!/bin/sh
case "$*" in
  *fs_job_integrity_snapshot*) printf '%s' '{"version":1,"complete":true,"items":[]}' ;;
  *fs_set_user_role*) printf 400 ;;
  *) exit 90 ;;
esac
`);
  await chmod(join(bin, 'docker'), 0o755); await chmod(join(bin, 'curl'), 0o755);
});
after(async () => {
  if (started) run('pg_ctl', ['-D', join(scratch, 'data'), '-m', 'immediate', '-w', 'stop']);
  if (scratch) await rm(scratch, { recursive: true, force: true });
});
beforeEach(() => sql('truncate public.fs_users;'));

test('profile linkage migration reapplies without data or existing privilege changes', async () => {
  sql(`insert into public.fs_users(name,data) values ('Synthetic',${literal({ ...original, ...metadata })});`);
  const before = sql("select to_jsonb(u) from public.fs_users u; select relacl from pg_class where oid='public.fs_users'::regclass;");
  await install(); await install();
  assert.equal(sql("select to_jsonb(u) from public.fs_users u; select relacl from pg_class where oid='public.fs_users'::regclass;"), before);
  assert.equal(sql("select count(*) from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgrelid='public.fs_users'::regclass and t.tgname='fs_users_preserve_profile_linkage' and t.tgtype=19 and t.tgenabled='O' and not p.prosecdef;"), '1');
});

test('stale upsert after committed provisioning or approved restoration preserves current links', () => {
  for (const role of ['anon', 'authenticated']) {
    for (const flow of ['provision', 'restore']) {
      sql('truncate public.fs_users;');
      if (flow === 'restore') {
        sql(`insert into public.fs_users(name,data) values ('Synthetic',${literal(original)});`);
        assert.equal(Object.hasOwn(stored(), 'central_user_id'), false, 'gateway snapshot has no linkage');
        sql(`update public.fs_users set data=data || ${literal(metadata)} where name='Synthetic';`);
      } else {
        // The signed provisioning INSERT uses the ordinary anon connection.
        sql(upsert(role, { ...original, ...metadata }));
        sql("set role anon; select public.fs_set_user_role('Synthetic','sales');");
      }
      sql(upsert(role, { ...original, name: 'Edited', email: 'edited@example.invalid' }));
      assert.deepEqual(stored(), { ...original, name: 'Edited', email: 'edited@example.invalid', ...metadata });
    }
  }
});

test('waiting stale upsert uses the committed row after concurrent provisioning or restoration', async () => {
  for (const role of ['anon', 'authenticated']) {
    for (const flow of ['provision', 'restore']) {
      sql('truncate public.fs_users;');
      if (flow === 'restore') sql(`insert into public.fs_users(name,data) values ('Synthetic',${literal(original)});`);
      const writer = connection();
      const mutation = flow === 'provision'
        ? `insert into public.fs_users(name,data) values ('Synthetic',${literal({ ...original, ...metadata })});`
        : `update public.fs_users set data=data || ${literal(metadata)} where name='Synthetic';`;
      writer.child.stdin.write(`begin; ${mutation} select 'writer-ready';\n`);
      let browser;
      try {
        await until(() => writer.output().includes('writer-ready'));
        browser = connection(`set application_name='profile-stale-browser'; ${upsert(role, { ...original, name: 'Edited' })}`);
        await until(() => sql("select count(*) from pg_stat_activity where application_name='profile-stale-browser' and wait_event_type='Lock';") === '1');
        writer.child.stdin.end('commit;\n');
        await Promise.all([writer.done, browser.done]);
        assert.deepEqual(stored(), { ...original, name: 'Edited', ...metadata });
      } finally {
        if (writer.child.exitCode === null) { writer.child.stdin.end('rollback;\n'); await writer.done; }
        if (browser?.child.exitCode === null) { browser.child.kill(); await browser.done.catch(() => {}); }
      }
    }
  }
});

test('unprivileged updates preserve exact old linkage values or absence and keep role/password frozen', () => {
  for (const role of ['anon', 'authenticated']) {
    for (const fields of [{}, metadata, { central_user_id: null, provisionedBy: '' }, { central_user_id: 'partial-stored' }]) {
      sql('truncate public.fs_users;');
      sql(`insert into public.fs_users(name,data) values ('Synthetic',${literal({ ...original, ...fields })});`);
      sql(upsert(role, { name: 'Edited', email: 'edited@example.invalid', role: 'admin', pass: 'forged',
        central_user_id: 'forged', provisionedBy: 'forged', extra: 'browser-editable' }));
      assert.deepEqual(stored(), { name: 'Edited', email: 'edited@example.invalid', role: 'sales', pass: 'synthetic-inert-hash',
        extra: 'browser-editable', ...fields });
    }
  }
});

test('ordinary provisioning INSERT and security-definer role RPC remain compatible', () => {
  for (const role of ['anon', 'authenticated']) {
    sql('truncate public.fs_users;');
    sql(upsert(role, { name: 'Synthetic', email: 'synthetic@example.invalid', ...metadata }));
    assert.deepEqual(stored(), { name: 'Synthetic', email: 'synthetic@example.invalid', ...metadata });
    sql(`set role ${role}; select public.fs_set_user_role('Synthetic','pd');`);
    assert.deepEqual(stored(), { name: 'Synthetic', email: 'synthetic@example.invalid', ...metadata, role: 'pd' });
    // Approved privileged repair stays possible without disabling any trigger.
    sql(`update public.fs_users set data=data || '{"central_user_id":"approved-new-id"}';`);
    assert.equal(stored().central_user_id, 'approved-new-id');
  }
});

test('real read-only policy gate rejects missing, disabled or incorrectly shaped linkage guard', async () => {
  assert.equal(gate().status, 0, gate().stdout);
  const mutations = [
    'drop trigger if exists fs_users_preserve_profile_linkage on public.fs_users;',
    'alter table public.fs_users disable trigger fs_users_preserve_profile_linkage;',
    'alter function public.fs_preserve_profile_linkage() security definer;',
    "alter function public.fs_preserve_profile_linkage() set search_path=public;",
    `drop trigger fs_users_preserve_profile_linkage on public.fs_users;
      create trigger fs_users_preserve_profile_linkage after update on public.fs_users for each row execute function public.fs_preserve_profile_linkage();`,
    `drop trigger fs_users_preserve_profile_linkage on public.fs_users;
      create trigger fs_users_preserve_profile_linkage before update of name on public.fs_users for each row execute function public.fs_preserve_profile_linkage();`,
  ];
  for (const mutation of mutations) {
    try {
      sql(mutation);
      const result = gate();
      assert.equal(result.status, 1, `${mutation}\n${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /policy status=fail/);
    } finally { await install(); }
  }
  assert.equal(gate().status, 0, gate().stdout);
});
