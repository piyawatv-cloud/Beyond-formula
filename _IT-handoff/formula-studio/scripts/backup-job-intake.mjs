#!/usr/bin/env node
// Copy verified delivery receipts into a private backup, excluding interrupted
// temporary writes. Does not query production or replay any business writes.
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JobIntake, JobIntakeError } from '../runtime/job-intake.mjs';

async function syncDir(path) {
  const handle = await fs.open(path, constants.O_RDONLY | (constants.O_DIRECTORY || 0));
  try { await handle.sync(); } finally { await handle.close(); }
}
async function copyPrivate(source, destination) {
  const before = await fs.lstat(source);
  if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o077)) throw new JobIntakeError('unsafe_file');
  const from = await fs.open(source, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  let to;
  try {
    const stat = await from.stat();
    if (stat.ino !== before.ino || stat.dev !== before.dev || !stat.isFile() || (stat.mode & 0o077) || stat.size > 4 * 1024 * 1024) throw new JobIntakeError('unsafe_file');
    const bytes = await from.readFile();
    to = await fs.open(destination, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0), 0o600);
    await to.writeFile(bytes); await to.sync();
  } finally { await to?.close(); await from.close(); }
}

export async function verifyJobIntake(dir) {
  const intake = await new JobIntake({ dir }).init({ readOnly: true });
  return intake.metadata();
}

export async function backupJobIntake(source, destination) {
  source = resolve(source); destination = resolve(destination);
  if (source === destination || source.startsWith(`${destination}/`) || destination.startsWith(`${source}/`)) throw new JobIntakeError('invalid_backup_target');
  const intake = await new JobIntake({ dir: source }).init({ readOnly: true });
  const snapshot = await intake.list();
  const keys = new Set(snapshot.map(entry => entry.key));
  // Existing backup targets are never overwritten, even when empty.
  await fs.mkdir(destination, { mode: 0o700 });
  await fs.chmod(destination, 0o700);
  for (const part of ['receipts', 'statuses', 'observations']) {
    const target = join(destination, part);
    await fs.mkdir(target, { mode: 0o700 });
    const names = part === 'receipts' ? [...keys].map(key => `${key}.json`) : await fs.readdir(join(source, part));
    for (const name of names) {
      if (name.startsWith('.') && name.endsWith('.tmp')) continue;
      if (part === 'statuses' && !keys.has(name.split('.')[0])) continue;
      await copyPrivate(join(source, part, name), join(target, name));
    }
    await syncDir(target);
  }
  await syncDir(destination); await syncDir(dirname(destination));
  const restored = await new JobIntake({ dir: destination }).init({ readOnly: true });
  const restoredEntries = await restored.list();
  if (restoredEntries.length !== snapshot.length || restoredEntries.some(entry => !keys.has(entry.key))) throw new JobIntakeError('backup_readback');
  return restored.metadata();
}

async function cli() {
  const [command, source, destination, ...extra] = process.argv.slice(2);
  if (extra.length || !['backup', 'verify-only'].includes(command) || !source || (command === 'backup' ? !destination : destination)) {
    process.stderr.write('usage: backup-job-intake.mjs backup SOURCE NEW_DEST | verify-only DIRECTORY\n'); process.exitCode = 2; return;
  }
  try {
    if (command === 'backup') {
      const exists = await fs.lstat(source).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (!exists) { process.stdout.write('job-intake status=not-yet-enabled receipts=0\n'); return; }
    }
    const result = command === 'backup' ? await backupJobIntake(source, destination) : await verifyJobIntake(source);
    process.stdout.write(`job-intake status=verified receipts=${result.total} pending=${result.pending}\n`);
  } catch {
    // Paths, actor identities and payloads must never reach backup logs.
    process.stderr.write('job-intake status=failed why=private-journal-verification\n'); process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await cli();
