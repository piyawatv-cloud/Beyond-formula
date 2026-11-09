import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { JobIntake } from '../runtime/job-intake.mjs';
import { backupJobIntake, verifyJobIntake } from '../scripts/backup-job-intake.mjs';
const exec = promisify(execFile);
const observationFilename = id => `id-${createHash('sha256').update(id).digest('hex')}.json`;

const args = (id = 'A00001') => ({ p_id: id, p_data: { id, customer: 'Synthetic customer', rows: [{ name: 'Synthetic ingredient' }] }, p_expected: null });
const actor = { name: 'Synthetic Sales', role: 'Sales', email: 'synthetic@example.invalid', formulaUserId: 1, exp: 123456789, iam: true };
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(join(tmpdir(), 'formula-intake-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = join(root, 'private');
  const intake = new JobIntake({ dir, minFreeBytes: 0, ...options });
  await intake.init();
  return { root, dir, intake };
}
const isCode = code => error => error?.code === code;

test('captures full immutable payload durably, restart reads it exactly', async t => {
  const { dir, intake } = await fixture(t, { clock: () => 100 });
  const entry = await intake.capture(args(), actor);
  assert.equal(entry.firstSeenAt, 100); assert.equal(entry.state, 'pending');
  assert.deepEqual(entry.args, args()); assert.deepEqual(entry.actor, actor);
  const recovered = await new JobIntake({ dir, minFreeBytes: 0 }).init();
  assert.deepEqual(await recovered.list(), [entry]);
  assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
  for (const part of ['receipts', 'statuses', 'observations']) assert.equal((await fs.stat(join(dir, part))).mode & 0o777, 0o700);
  assert.equal((await fs.stat(join(dir, 'receipts', `${entry.key}.json`))).mode & 0o777, 0o600);
});

test('same intent duplicate and reordered keys preserve first receipt time and bytes', async t => {
  let now = 100;
  const { dir, intake } = await fixture(t, { clock: () => now });
  const first = await intake.capture(args(), actor);
  const path = join(dir, 'receipts', `${first.key}.json`), original = await fs.readFile(path);
  now = 900;
  const reordered = { p_expected: null, p_data: { rows: [{ name: 'Synthetic ingredient' }], customer: 'Synthetic customer', id: 'A00001' }, p_id: 'A00001' };
  assert.deepEqual(await intake.capture(reordered, { ...actor, sessionToken: 'never-store' }), first);
  assert.deepEqual(await fs.readFile(path), original);
  assert.equal((await fs.readdir(join(dir, 'receipts'))).length, 1);
});

test('concurrent independent instances capture one intent without overwriting immutable receipt', async t => {
  const { dir, intake } = await fixture(t, { clock: () => 100 });
  const other = await new JobIntake({ dir, clock: () => 200, minFreeBytes: 0 }).init();
  const entries = await Promise.all(Array.from({ length: 16 }, (_, i) => (i % 2 ? intake : other).capture(args(), actor)));
  entries.forEach(entry => assert.deepEqual(entry, entries[0]));
  assert.equal((await intake.list()).length, 1);
  assert.equal((await fs.readdir(join(dir, 'receipts'))).length, 1);
});

test('actor identity and expected revision are part of delivery key', async t => {
  const { intake } = await fixture(t);
  const first = await intake.capture(args(), actor);
  const otherRole = await intake.capture(args(), { ...actor, role: 'Admin' });
  const otherUser = await intake.capture(args(), { ...actor, formulaUserId: 2 });
  const otherBaseline = await intake.capture({ ...args(), p_expected: args().p_data }, actor);
  assert.equal(new Set([first.key, otherRole.key, otherUser.key, otherBaseline.key]).size, 4);
});

test('metadata exposes status and timing only, no formula, actor identity or tokens', async t => {
  const { intake, dir } = await fixture(t);
  const entry = await intake.capture(args(), { ...actor, cookie: 'private-cookie', token: 'private-token', password: 'private-password' });
  await intake.mark(entry.key, { state: 'retrying', reason: 'กำลังส่งข้อมูลอีกครั้ง', lastAttemptAt: 100, nextAttemptAt: 200 });
  const meta = await intake.metadata();
  assert.equal(meta.healthy, true); assert.equal(meta.pending, 1);
  assert.deepEqual(Object.keys(meta.entries[0]).sort(), ['firstSeenAt', 'id', 'key', 'lastAttemptAt', 'nextAttemptAt', 'reason', 'state']);
  const text = JSON.stringify(meta);
  for (const excluded of ['Synthetic customer', 'Synthetic ingredient', 'synthetic@example.invalid', 'private-cookie', 'private-token', 'private-password']) assert.equal(text.includes(excluded), false);
  const receipt = await fs.readFile(join(dir, 'receipts', `${entry.key}.json`), 'utf8');
  assert.equal(receipt.includes('private-'), false);
});

test('terminal saved receipt cannot be reset by late pending or forbidden mark', async t => {
  const { intake } = await fixture(t);
  const entry = await intake.capture(args(), actor);
  await intake.mark(entry.key, { state: 'saved' });
  await intake.mark(entry.key, { state: 'pending', reason: 'late retry' });
  await intake.mark(entry.key, { state: 'forbidden' });
  assert.equal((await intake.list())[0].state, 'saved');
  assert.equal((await intake.metadata()).pending, 0);
});

test('terminal status dominates racing pending update across colour instances', async t => {
  const { intake, dir } = await fixture(t);
  const second = await new JobIntake({ dir, minFreeBytes: 0 }).init();
  const entry = await intake.capture(args(), actor);
  await Promise.all([intake.mark(entry.key, { state: 'saved' }), second.mark(entry.key, { state: 'pending' })]);
  assert.equal((await second.list())[0].state, 'saved');
});

test('deleted state fences even an already saved receipt permanently', async t => {
  const { intake } = await fixture(t);
  const entry = await intake.capture(args(), actor);
  await intake.mark(entry.key, { state: 'saved' });
  await intake.mark(entry.key, { state: 'deleted', reason: 'ใบงานถูกลบแล้ว' });
  await intake.mark(entry.key, { state: 'saved' });
  assert.equal((await intake.list())[0].state, 'deleted');
});

test('first-seen observations use server clock and survive restart and concurrency', async t => {
  const { intake, dir } = await fixture(t, { clock: () => 100 });
  const second = await new JobIntake({ dir, clock: () => 900, minFreeBytes: 0 }).init();
  const seen = await Promise.all([intake.firstSeen('A00001'), second.firstSeen('A00001')]);
  assert.equal(seen[0], seen[1]);
  assert.equal(await second.firstSeen('A00001'), seen[0]);
  const third = await new JobIntake({ dir, minFreeBytes: 0 }).init();
  assert.equal(await third.firstSeen('A00001'), seen[0]);
});

test('corrupt receipt fails list, metadata and restart instead of silently dropping data', async t => {
  const { intake, dir } = await fixture(t);
  const entry = await intake.capture(args(), actor);
  await fs.writeFile(join(dir, 'receipts', `${entry.key}.json`), '{"broken":true}', { mode: 0o600 });
  await assert.rejects(intake.list(), isCode('corrupt'));
  await assert.rejects(intake.metadata(), isCode('corrupt'));
  await assert.rejects(new JobIntake({ dir }).init(), isCode('corrupt'));
});

test('payload change keeping original key is detected even with valid recomputed envelope checksum', async t => {
  const { intake, dir } = await fixture(t);
  const entry = await intake.capture(args(), actor);
  const path = join(dir, 'receipts', `${entry.key}.json`);
  const receipt = JSON.parse(await fs.readFile(path, 'utf8'));
  receipt.args.p_data.customer = 'Changed';
  const { checksum, ...body } = receipt;
  const stable = value => value && typeof value === 'object' ? (Array.isArray(value) ? `[${value.map(stable).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`) : JSON.stringify(value);
  receipt.checksum = createHash('sha256').update(stable(body)).digest('hex');
  await fs.writeFile(path, JSON.stringify(receipt), { mode: 0o600 });
  await assert.rejects(intake.list(), isCode('corrupt'));
});

test('corrupt status and observation block health even without an associated listed job', async t => {
  const { intake, dir } = await fixture(t);
  await intake.firstSeen('A00001');
  await fs.writeFile(join(dir, 'observations', observationFilename('A00001')), '{}', { mode: 0o600 });
  await assert.rejects(intake.metadata(), isCode('corrupt'));
  await fs.unlink(join(dir, 'observations', observationFilename('A00001')));
  await fs.writeFile(join(dir, 'statuses', `${'a'.repeat(64)}.saved.json`), '{}', { mode: 0o600 });
  await assert.rejects(intake.metadata(), isCode('corrupt'));
});

test('orphan private temp files are ignored for delivery but included in quota', async t => {
  const { intake, dir } = await fixture(t, { maxTotalBytes: 1000 });
  await fs.writeFile(join(dir, 'receipts', '.interrupted.tmp'), 'x'.repeat(900), { mode: 0o600 });
  assert.deepEqual(await intake.list(), []);
  await assert.rejects(intake.capture(args(), actor), isCode('quota'));
  assert.deepEqual(await intake.list(), []);
});

test('per-file and total quota reject new payload while preserving accepted receipts', async t => {
  const { intake } = await fixture(t, { maxEntryBytes: 4096, maxTotalBytes: 1500 });
  const entry = await intake.capture(args(), actor);
  await assert.rejects(intake.capture({ ...args('A00002'), p_data: { ...args('A00002').p_data, extra: 'x'.repeat(4096) } }, actor), isCode('oversized'));
  await assert.rejects(intake.capture({ ...args('A00002'), p_data: { ...args('A00002').p_data, extra: 'x'.repeat(1000) } }, actor), isCode('quota'));
  assert.deepEqual(await intake.capture(args(), actor), entry);
});

test('disk free-space check rejects admission before creating a receipt', async t => {
  const io = { ...fs, statfs: async () => ({ bavail: 0, bsize: 4096 }) };
  const { intake } = await fixture(t, { io });
  await assert.rejects(intake.capture(args(), actor), isCode('disk_full'));
  assert.deepEqual(await intake.list(), []);
});

test('file fsync failure never acknowledges or delivers a partial receipt', async t => {
  let failSync = false;
  const io = { ...fs, open: async (...call) => {
    const handle = await fs.open(...call);
    if (failSync && String(call[0]).endsWith('.tmp')) return { writeFile: handle.writeFile.bind(handle), close: handle.close.bind(handle), sync: async () => { throw new Error('synthetic_sync_failure'); } };
    return handle;
  } };
  const { intake } = await fixture(t, { io });
  failSync = true;
  await assert.rejects(intake.capture(args(), actor), /synthetic_sync_failure/);
  assert.deepEqual(await intake.list(), []);
  failSync = false;
  assert.equal((await intake.capture(args(), actor)).state, 'pending');
});

test('directory fsync failure is unacknowledged and subsequent duplicate must fsync before acknowledgement', async t => {
  let failSync = false;
  const io = { ...fs, open: async (...call) => {
    const handle = await fs.open(...call);
    if (failSync && call[1] === (constants.O_RDONLY | (constants.O_DIRECTORY || 0))) return { close: handle.close.bind(handle), sync: async () => { throw new Error('synthetic_directory_sync_failure'); } };
    return handle;
  } };
  const { intake } = await fixture(t, { io });
  failSync = true;
  await assert.rejects(intake.capture(args(), actor), /synthetic_directory_sync_failure/);
  await assert.rejects(intake.capture(args(), actor), /synthetic_directory_sync_failure/);
  failSync = false;
  assert.equal((await intake.capture(args(), actor)).state, 'pending');
});

test('write error does not claim acceptance and can be retried after recovery', async t => {
  let failWrite = false;
  const io = { ...fs, open: async (...call) => {
    const handle = await fs.open(...call);
    if (failWrite && String(call[0]).endsWith('.tmp')) return { writeFile: async () => { throw new Error('synthetic_write_failure'); }, close: handle.close.bind(handle), sync: handle.sync.bind(handle) };
    return handle;
  } };
  const { intake } = await fixture(t, { io });
  failWrite = true;
  await assert.rejects(intake.capture(args(), actor), /synthetic_write_failure/);
  assert.deepEqual(await intake.list(), []);
  failWrite = false;
  assert.equal((await intake.capture(args(), actor)).state, 'pending');
});

test('receipt symlink and public permissions are rejected', async t => {
  const { intake, dir, root } = await fixture(t);
  const entry = await intake.capture(args(), actor);
  const path = join(dir, 'receipts', `${entry.key}.json`);
  await fs.chmod(path, 0o644);
  await assert.rejects(intake.list(), isCode('unsafe_file'));
  await fs.rename(path, join(root, 'external.json'));
  await fs.symlink(join(root, 'external.json'), path);
  await assert.rejects(intake.list(), isCode('unsafe_file'));
});

test('root or subdirectory symlinks never become usable journals', async t => {
  const { root, dir } = await fixture(t);
  const linked = join(root, 'linked');
  await fs.symlink(dir, linked);
  await assert.rejects(new JobIntake({ dir: linked }).init(), isCode('unsafe_directory'));
  await fs.rm(join(dir, 'statuses'), { recursive: true });
  await fs.symlink(join(dir, 'receipts'), join(dir, 'statuses'));
  await assert.rejects(new JobIntake({ dir }).init(), isCode('unsafe_directory'));
});

test('path traversal, invalid identity, non-JSON values and unknown states fail closed', async t => {
  const { intake } = await fixture(t);
  await assert.rejects(intake.firstSeen('../A00001'), isCode('invalid_id'));
  await assert.rejects(intake.firstSeen(['A00001']), isCode('invalid_id'));
  await assert.rejects(intake.capture(args(), { role: 'Sales' }), isCode('invalid_actor'));
  await assert.rejects(intake.capture({ ...args(), extra: undefined }, actor), isCode('invalid_json'));
  await assert.rejects(intake.capture({ ...args(), extra: NaN }, actor), isCode('invalid_json'));
  await assert.rejects(intake.mark('../escape', { state: 'saved' }), isCode('invalid_key'));
  await assert.rejects(intake.mark('a'.repeat(64), { state: 'purge' }), isCode('invalid_state'));
  await assert.rejects(intake.mark('a'.repeat(64), { state: 'saved' }), isCode('missing_receipt'));
});


test('independent spawned processes write one shared durable receipt without stale locks', async t => {
  const { dir, intake } = await fixture(t);
  const moduleUrl = new URL('../runtime/job-intake.mjs', import.meta.url).href;
  const script = `import { JobIntake } from ${JSON.stringify(moduleUrl)}; const intake=await new JobIntake({dir:process.argv[1],minFreeBytes:0}).init(); const result=await intake.capture(${JSON.stringify(args())},${JSON.stringify(actor)}); console.log(result.key);`;
  const replies = await Promise.all(Array.from({ length: 6 }, () => exec(process.execPath, ['--input-type=module', '-e', script, dir], { env: { PATH: process.env.PATH } })));
  assert.equal(new Set(replies.map(result => result.stdout.trim())).size, 1);
  assert.equal((await intake.list()).length, 1);
  assert.equal((await fs.readdir(join(dir, 'receipts'))).length, 1);
});

test('trusted successful readback may mark saved after earlier conflict or forbidden', async t => {
  const { intake } = await fixture(t);
  for (const [id, state] of [['A00001', 'conflict'], ['A00002', 'forbidden'], ['A00003', 'invalid']]) {
    const entry = await intake.capture(args(id), actor);
    await intake.mark(entry.key, { state });
    assert.equal((await intake.mark(entry.key, { state: 'saved' })).state, 'saved');
  }
});

test('private backup verifies receipt contents and status after independent directory restore', async t => {
  const { intake, dir, root } = await fixture(t);
  const entry = await intake.capture(args(), actor);
  await intake.mark(entry.key, { state: 'retrying', reason: 'กำลังส่งอีกครั้ง', lastAttemptAt: 100, nextAttemptAt: 200 });
  await intake.firstSeen('A00002');
  await fs.writeFile(join(dir, 'receipts', '.interrupted.tmp'), 'partial', { mode: 0o600 });
  const dest = join(root, 'backup');
  const result = await backupJobIntake(dir, dest);
  assert.equal(result.healthy, true); assert.equal(result.total, 1); assert.equal(result.pending, 1);
  const restored = await new JobIntake({ dir: dest }).init({ readOnly: true });
  assert.deepEqual(await restored.list(), await intake.list());
  assert.equal(await restored.firstSeen('A00002'), await intake.firstSeen('A00002'));
  assert.equal((await fs.stat(dest)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(join(dest, 'receipts', `${entry.key}.json`))).mode & 0o777, 0o600);
  assert.deepEqual(await fs.readdir(join(dest, 'receipts')), [`${entry.key}.json`]);
  assert.equal((await verifyJobIntake(dest)).total, 1);
});

test('backup rejects existing target, overlapping paths, corrupted source and symlinks', async t => {
  const { intake, dir, root } = await fixture(t);
  const entry = await intake.capture(args(), actor);
  const existing = join(root, 'existing'); await fs.mkdir(existing);
  await assert.rejects(backupJobIntake(dir, existing), error => error.code === 'EEXIST');
  await assert.rejects(backupJobIntake(dir, join(dir, 'backup')), isCode('invalid_backup_target'));
  await assert.rejects(backupJobIntake(dir, dir), isCode('invalid_backup_target'));
  const linked = join(root, 'linked'); await fs.symlink(dir, linked);
  await assert.rejects(backupJobIntake(linked, join(root, 'bad-backup')), isCode('unsafe_directory'));
  await fs.writeFile(join(dir, 'receipts', `${entry.key}.json`), '{}', { mode: 0o600 });
  await assert.rejects(backupJobIntake(dir, join(root, 'corrupt-backup')), isCode('corrupt'));
  await assert.rejects(fs.stat(join(root, 'corrupt-backup')), error => error.code === 'ENOENT');
});

test('backup command only prints counts, missing source is explicit and corruption fails', async t => {
  const { intake, dir, root } = await fixture(t);
  const cli = new URL('../scripts/backup-job-intake.mjs', import.meta.url).pathname;
  const env = { PATH: process.env.PATH };
  const missing = await exec(process.execPath, [cli, 'backup', join(root, 'not-enabled'), join(root, 'none')], { env });
  assert.equal(missing.stdout, 'job-intake status=not-yet-enabled receipts=0\n');
  const entry = await intake.capture(args(), actor);
  const result = await exec(process.execPath, [cli, 'backup', dir, join(root, 'backup')], { env });
  assert.equal(result.stdout, 'job-intake status=verified receipts=1 pending=1\n');
  assert.equal(result.stdout.includes('Synthetic'), false);
  await fs.writeFile(join(dir, 'receipts', `${entry.key}.json`), '{}', { mode: 0o600 });
  await assert.rejects(exec(process.execPath, [cli, 'verify-only', dir], { env }), error => error.code === 1 && error.stderr === 'job-intake status=failed why=private-journal-verification\n');
});

test('read-only verification does not create directories or loosen permissions', async t => {
  const { dir, root } = await fixture(t);
  const missing = join(root, 'missing');
  await assert.rejects(new JobIntake({ dir: missing }).init({ readOnly: true }), error => error.code === 'ENOENT');
  await assert.rejects(fs.stat(missing), error => error.code === 'ENOENT');
  await fs.chmod(dir, 0o755);
  await assert.rejects(new JobIntake({ dir }).init({ readOnly: true }), isCode('unsafe_directory'));
  assert.equal((await fs.stat(dir)).mode & 0o777, 0o755);
});

test('quota scan tolerates only disappeared private temp files during concurrent publication', async t => {
  let simulate = false;
  const io = { ...fs, lstat: async path => {
    if (simulate && String(path).endsWith('/.interrupted.tmp')) { await fs.unlink(path); const error = new Error('synthetic race'); error.code = 'ENOENT'; throw error; }
    return fs.lstat(path);
  } };
  const { dir, intake } = await fixture(t, { io });
  await fs.writeFile(join(dir, 'receipts', '.interrupted.tmp'), 'temporary', { mode: 0o600 });
  simulate = true;
  assert.deepEqual(await intake.list(), []);
  assert.equal((await intake.capture(args(), actor)).state, 'pending');
});

test('disappeared committed receipt remains a verification failure', async t => {
  let missingPath;
  const io = { ...fs, lstat: async path => {
    if (path === missingPath) { const error = new Error('synthetic committed disappearance'); error.code = 'ENOENT'; throw error; }
    return fs.lstat(path);
  } };
  const { dir, intake } = await fixture(t, { io });
  const entry = await intake.capture(args(), actor);
  missingPath = join(dir, 'receipts', `${entry.key}.json`);
  await assert.rejects(intake.metadata(), error => error.code === 'ENOENT');
});

test('atomically replaced private status inode is read as a verified FD snapshot', async t => {
  let replacePath;
  const io = { ...fs, lstat: async path => {
    const stat = await fs.lstat(path);
    if (path === replacePath) {
      replacePath = null;
      const text = await fs.readFile(path);
      const temp = `${path}.replace.tmp`;
      await fs.writeFile(temp, text, { mode: 0o600 }); await fs.rename(temp, path);
    }
    return stat;
  } };
  const { dir, intake } = await fixture(t, { io });
  const entry = await intake.capture(args(), actor);
  await intake.mark(entry.key, { state: 'pending' });
  replacePath = join(dir, 'statuses', `${entry.key}.pending.json`);
  assert.equal((await intake.read('statuses', `${entry.key}.pending.json`)).state, 'pending');
  assert.equal((await intake.metadata()).healthy, true);
});

test('verified mutable retry metadata superseded before readback does not reject durable receipt', async t => {
  let other, replaceKey, enable = false;
  const io = { ...fs, rename: async (from, to) => {
    await fs.rename(from, to);
    if (enable && String(to).endsWith(`${replaceKey}.pending.json`)) {
      enable = false;
      await other.mark(replaceKey, { state: 'pending', lastAttemptAt: 900, nextAttemptAt: 1000, reason: 'ข้อมูลรอส่งล่าสุด' });
    }
  } };
  const { dir, intake } = await fixture(t, { io, clock: () => 100 });
  other = await new JobIntake({ dir, minFreeBytes: 0, clock: () => 200 }).init();
  const entry = await intake.capture(args(), actor);
  replaceKey = entry.key; enable = true;
  const result = await intake.mark(entry.key, { state: 'pending', lastAttemptAt: 100, nextAttemptAt: 200 });
  assert.equal(result.lastAttemptAt, 900); assert.equal(result.state, 'pending');
  assert.deepEqual((await intake.list())[0].args, args());
});

test('batch first-seen metadata scales linearly and repeats exact timestamps across instances', async t => {
  let lstats = 0, freeChecks = 0;
  const io = { ...fs, lstat: async (...call) => { lstats++; return fs.lstat(...call); }, statfs: async (...call) => { freeChecks++; return fs.statfs(...call); } };
  const { dir, intake } = await fixture(t, { io, clock: () => 100 });
  const ids = Array.from({ length: 200 }, (_, i) => `A${String(i + 1).padStart(5, '0')}`);
  lstats = 0; freeChecks = 0;
  const first = await intake.firstSeenMany(ids);
  assert.equal(first.size, 200); assert.equal(freeChecks, 1);
  assert.ok(lstats <= 3 * ids.length + 20, `metadata checks must be linear: ${lstats}`);
  ids.forEach(id => assert.equal(first.get(id), 100));
  const second = await new JobIntake({ dir, minFreeBytes: 0, clock: () => 900 }).init();
  assert.deepEqual(await second.firstSeenMany(ids), first);
  assert.equal(await second.firstSeen(ids[0]), first.get(ids[0]));
  assert.equal((await fs.readdir(join(dir, 'observations'))).length, 200);
});

test('concurrent batch observations preserve one immutable first-seen value per id', async t => {
  const { dir, intake } = await fixture(t, { clock: () => 100 });
  const other = await new JobIntake({ dir, minFreeBytes: 0, clock: () => 200 }).init();
  const ids = Array.from({ length: 30 }, (_, i) => `A${String(i + 1).padStart(5, '0')}`);
  const [first, second] = await Promise.all([intake.firstSeenMany(ids), other.firstSeenMany(ids)]);
  assert.deepEqual(first, second);
  assert.equal((await fs.readdir(join(dir, 'observations'))).length, ids.length);
});

test('batch first-seen rejects invalid, duplicate, sparse and unbounded id lists before writing', async t => {
  const { intake, dir } = await fixture(t);
  await assert.rejects(intake.firstSeenMany('A00001'), isCode('invalid_batch'));
  await assert.rejects(intake.firstSeenMany(['A00001', 'A00001']), isCode('invalid_batch'));
  await assert.rejects(intake.firstSeenMany(['A00001', '../A00002']), isCode('invalid_id'));
  await assert.rejects(intake.firstSeenMany(new Array(1)), isCode('invalid_id'));
  await assert.rejects(intake.firstSeenMany(Array.from({ length: 20_001 }, (_, i) => `A${String(i).padStart(5, '0')}`)), isCode('invalid_batch'));
  assert.deepEqual(await fs.readdir(join(dir, 'observations')), []);
});

test('batch corruption and quota failures cannot return a healthy timestamp map or drop evidence', async t => {
  const { intake, dir } = await fixture(t, { maxTotalBytes: 1000 });
  await intake.firstSeen('A00001');
  await fs.writeFile(join(dir, 'observations', observationFilename('A00001')), '{}', { mode: 0o600 });
  await assert.rejects(intake.firstSeenMany(['A00001']), isCode('corrupt'));
  await assert.rejects(intake.firstSeenMany([]), isCode('corrupt'));
  const before = await fs.readFile(join(dir, 'observations', observationFilename('A00001')));
  await assert.rejects(intake.firstSeenMany(['A00002']), isCode('corrupt'));
  assert.deepEqual(await fs.readFile(join(dir, 'observations', observationFilename('A00001'))), before);
  await fs.unlink(join(dir, 'observations', observationFilename('A00001')));
  const ids = Array.from({ length: 20 }, (_, i) => `A${String(i + 1).padStart(5, '0')}`);
  await assert.rejects(intake.firstSeenMany(ids), isCode('quota'));
  assert.deepEqual(await fs.readdir(join(dir, 'observations')), []);
});


test('long canonical ids use bounded observation filenames for single and batch, restart and backup', async t => {
  const { dir, root, intake } = await fixture(t, { clock: () => 100 });
  const singleId = 'A'.repeat(256) + '07001', batchId = 'B'.repeat(1024) + '07002';
  assert.equal(await intake.firstSeen(singleId), 100);
  assert.deepEqual(await intake.firstSeenMany([singleId, batchId]), new Map([[singleId, 100], [batchId, 100]]));
  const names = await fs.readdir(join(dir, 'observations'));
  assert.equal(names.length, 2);
  for (const name of names) { assert.match(name, /^id-[a-f0-9]{64}\.json$/); assert.ok(Buffer.byteLength(name) < 100); }
  const restarted = await new JobIntake({ dir, clock: () => 900 }).init();
  assert.equal(await restarted.firstSeen(singleId), 100);
  assert.deepEqual(await restarted.firstSeenMany([singleId, batchId]), new Map([[singleId, 100], [batchId, 100]]));
  assert.equal((await restarted.metadata()).healthy, true);
  const backup = join(root, 'long-id-backup');
  assert.equal((await backupJobIntake(dir, backup)).healthy, true);
  const restored = await new JobIntake({ dir: backup, clock: () => 2000 }).init({ readOnly: true });
  assert.deepEqual(await restored.firstSeenMany([singleId, batchId]), new Map([[singleId, 100], [batchId, 100]]));
});

test('legacy short-id observations retain timestamps through migration and backup', async t => {
  const { dir, root, intake } = await fixture(t, { clock: () => 100 });
  await intake.firstSeen('A00001');
  await fs.rename(join(dir, 'observations', observationFilename('A00001')), join(dir, 'observations', 'A00001.json'));
  const restarted = await new JobIntake({ dir, clock: () => 900 }).init();
  assert.equal(await restarted.firstSeen('A00001'), 100);
  assert.deepEqual(await restarted.firstSeenMany(['A00001']), new Map([['A00001', 100]]));
  assert.deepEqual(await fs.readdir(join(dir, 'observations')), ['A00001.json']);
  const backup = join(root, 'legacy-backup');
  assert.equal((await backupJobIntake(dir, backup)).healthy, true);
  assert.equal(await (await new JobIntake({ dir: backup }).init({ readOnly: true })).firstSeen('A00001'), 100);
});

test('hashed observation filename must match sealed full identifier even with valid checksum', async t => {
  const { dir, intake } = await fixture(t, { clock: () => 100 });
  const id = 'A'.repeat(256) + '07001';
  await intake.firstSeen(id);
  const wrongId = 'B'.repeat(256) + '07001';
  const original = join(dir, 'observations', observationFilename(id));
  const wrong = join(dir, 'observations', observationFilename(wrongId));
  await fs.rename(original, wrong);
  await assert.rejects(intake.metadata(), isCode('corrupt'));
  await assert.rejects(new JobIntake({ dir }).init({ readOnly: true }), isCode('corrupt'));
  await assert.rejects(intake.firstSeen(wrongId), isCode('corrupt'));
});


test('oversized observation input uses a distinct code and does not corrupt or withdraw existing journal', async t => {
  const { intake, dir } = await fixture(t, { maxEntryBytes: 64 });
  await assert.rejects(intake.firstSeen('A00001'), isCode('oversized_observation'));
  await assert.rejects(intake.firstSeenMany(['A00001']), isCode('oversized_observation'));
  assert.deepEqual(await fs.readdir(join(dir, 'observations')), []);
  assert.equal((await intake.metadata()).healthy, true);
});

test('oversized metadata batch is distinguished from corrupt durable journal files', async t => {
  const { intake, dir } = await fixture(t);
  const ids = Array.from({ length: 200 }, (_, i) => 'A'.repeat(33_000) + String(i).padStart(5, '0'));
  await assert.rejects(intake.firstSeenMany(ids), isCode('oversized_batch'));
  assert.deepEqual(await fs.readdir(join(dir, 'observations')), []);
  assert.equal((await intake.metadata()).healthy, true);
});
