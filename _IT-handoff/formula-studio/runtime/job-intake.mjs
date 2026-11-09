// Private delivery journal. PostgreSQL remains the authoritative job store.
// Receipts are immutable; acknowledgement follows fsync and exact readback.
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

const KEY = /^[a-f0-9]{64}$/;
const ID = /^[A-Z]+[0-9]{5}$/;
const TERMINAL = ['deleted', 'saved', 'conflict', 'forbidden', 'invalid'];
const STATES = [...TERMINAL, 'pending', 'retrying'];
const ACTOR_FIELDS = ['name', 'role', 'email', 'centralUserId', 'formulaUserId', 'exp', 'iam'];
const PARTS = ['receipts', 'statuses', 'observations'];

export class JobIntakeError extends Error {
  constructor(code) { super(`job_intake_${code}`); this.name = 'JobIntakeError'; this.code = code; }
}
const fail = code => { throw new JobIntakeError(code); };

// Reject values JSON would silently alter; delivery confirmation must be exact.
function stable(value, depth = 0) {
  if (depth > 100) fail('invalid_json');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) fail('invalid_json');
    return `[${value.map(item => stable(item, depth + 1)).join(',')}]`;
  }
  if (typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key], depth + 1)}`).join(',')}}`;
  }
  fail('invalid_json');
}
const hash = value => createHash('sha256').update(stable(value)).digest('hex');
const seal = value => ({ ...value, checksum: hash(value) });
const observationName = id => `id-${createHash('sha256').update(id).digest('hex')}.json`;
const legacyObservationName = id => Buffer.byteLength(`${id}.json`) <= 255 ? `${id}.json` : null;
function unseal(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') fail('corrupt');
  const { checksum, ...body } = value;
  if (!KEY.test(checksum || '') || hash(body) !== checksum) fail('corrupt');
  return body;
}
function actorIdentity(actor) {
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) fail('invalid_actor');
  const selected = Object.fromEntries(ACTOR_FIELDS.filter(key => actor[key] !== undefined).map(key => [key, actor[key]]));
  if (!selected.name || typeof selected.name !== 'string' || !selected.role || typeof selected.role !== 'string') fail('invalid_actor');
  for (const field of ['email', 'centralUserId', 'formulaUserId']) {
    if (selected[field] !== undefined && typeof selected[field] !== 'string' && typeof selected[field] !== 'number') fail('invalid_actor');
  }
  if (selected.exp !== undefined && (!Number.isFinite(selected.exp) || selected.exp <= 0)) fail('invalid_actor');
  if (selected.iam !== undefined && typeof selected.iam !== 'boolean') fail('invalid_actor');
  return JSON.parse(stable(selected));
}

export class JobIntake {
  constructor({ dir, clock = Date.now, maxEntryBytes = 4 * 1024 * 1024, maxTotalBytes = 256 * 1024 * 1024, minFreeBytes = 16 * 1024 * 1024, io = fs } = {}) {
    if (!dir || typeof dir !== 'string') fail('invalid_directory');
    this.dir = resolve(dir); this.clock = clock; this.io = io;
    this.maxEntryBytes = maxEntryBytes; this.maxTotalBytes = maxTotalBytes; this.minFreeBytes = minFreeBytes;
    this.ready = false;
    this.admissions = Promise.resolve();
  }

  now() { const value = this.clock(); if (!Number.isFinite(value) || value < 0) fail('invalid_clock'); return value; }
  path(part, name) { if (!PARTS.includes(part) || /[/\\]/.test(name)) fail('invalid_path'); return join(this.dir, part, name); }
  assertReady() { if (!this.ready) fail('not_ready'); }

  async init({ readOnly = false } = {}) {
    this.ready = false;
    if (!readOnly) await this.io.mkdir(this.dir, { recursive: true, mode: 0o700 });
    for (const dir of [this.dir, ...PARTS.map(part => join(this.dir, part))]) {
      if (!readOnly) await this.io.mkdir(dir, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      const stat = await this.io.lstat(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsafe_directory');
      if (readOnly && (stat.mode & 0o077)) fail('unsafe_directory');
      if (!readOnly) await this.io.chmod(dir, 0o700);
    }
    if (!readOnly) {
      await this.syncPath(this.dir);
      await this.syncPath(dirname(this.dir));
    }
    this.ready = true;
    try { await this.list(); await this.scanBytes(); }
    catch (error) { this.ready = false; throw error; }
    return this;
  }

  async scanBytes() {
    let total = 0;
    const root = await this.io.readdir(this.dir);
    if (root.some(name => !PARTS.includes(name))) fail('unexpected_file');
    for (const part of PARTS) {
      const dir = join(this.dir, part), dirStat = await this.io.lstat(dir);
      if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) fail('unsafe_directory');
      for (const name of await this.io.readdir(dir)) {
        const temporary = /^\.[a-zA-Z0-9._-]+\.tmp$/.test(name);
        const stat = await this.io.lstat(this.path(part, name)).catch(error => {
          // A concurrent successful publish removes its private temp name. Only
          // that disappearance is expected; committed files may never disappear.
          if (temporary && error.code === 'ENOENT') return null;
          throw error;
        });
        if (!stat) continue;
        if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)) fail('unsafe_file');
        // Interrupted temp files count against quota, but are never delivered.
        const valid = part === 'receipts' ? KEY.test(name.replace(/\.json$/, '')) && name.endsWith('.json')
          : part === 'observations' ? /^id-[a-f0-9]{64}\.json$/.test(name) || (ID.test(name.replace(/\.json$/, '')) && name.endsWith('.json'))
          : new RegExp(`^[a-f0-9]{64}\\.(${STATES.join('|')})\\.json$`).test(name);
        if (!valid && !temporary) fail('unexpected_file');
        if (stat.size > this.maxEntryBytes) fail('oversized');
        if (valid) {
          const value = await this.read(part, name);
          if (!value || value.version !== 1) fail('corrupt');
          if (part === 'observations' && (typeof value.id !== 'string' || !ID.test(value.id)
            || ![observationName(value.id), legacyObservationName(value.id)].includes(name) || !Number.isFinite(value.firstSeenAt))) fail('corrupt');
          if (part === 'statuses') {
            const [key, state] = name.split('.');
            if (value.key !== key || value.state !== state || !Number.isFinite(value.updatedAt)
              || (value.reason !== null && (typeof value.reason !== 'string' || value.reason.length > 500))
              || [value.lastAttemptAt, value.nextAttemptAt].some(item => item !== null && (!Number.isFinite(item) || item < 0))) fail('corrupt');
          }
          if (part === 'receipts' && (value.key !== name.slice(0, -5) || !ID.test(value.args?.p_id || '')
            || !Number.isFinite(value.firstSeenAt) || hash({ args: value.args, actor: value.actor }) !== value.key)) fail('corrupt');
        }
        total += stat.size;
      }
    }
    return total;
  }

  async capacity(extraBytes, { aggregate = false } = {}) {
    if (!aggregate && extraBytes > this.maxEntryBytes) fail('oversized');
    // This is an admission threshold, not a cross-process hard quota. Proxy limits
    // active captures; concurrent admission may exceed it by one file per caller.
    const used = await this.scanBytes();
    if (used + extraBytes > this.maxTotalBytes) fail('quota');
    const disk = await this.io.statfs(this.dir);
    if (Number(disk.bavail) * Number(disk.bsize) < this.minFreeBytes + extraBytes) fail('disk_full');
  }

  async syncDirectory(part) { return this.syncPath(join(this.dir, part)); }

  async syncPath(path) {
    const handle = await this.io.open(path, constants.O_RDONLY | (constants.O_DIRECTORY || 0));
    try { await handle.sync(); } finally { await handle.close(); }
  }

  async read(part, name) {
    const path = this.path(part, name);
    const before = await this.io.lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!before) return null;
    if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o077) || before.size > this.maxEntryBytes) fail('unsafe_file');
    const handle = await this.io.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > this.maxEntryBytes || (stat.mode & 0o077)) fail('unsafe_file');
      // Status files are atomically replaced. The opened FD is a consistent
      // snapshot; its inode may legitimately differ from the preliminary lstat.
      const text = await handle.readFile('utf8');
      if (Buffer.byteLength(text) > this.maxEntryBytes) fail('oversized');
      try { return unseal(JSON.parse(text)); } catch { fail('corrupt'); }
    } finally { await handle.close(); }
  }

  async write(part, name, value, immutable = false, syncDirectory = true) {
    const body = stable(seal(value)), bytes = Buffer.byteLength(body);
    if (bytes > this.maxEntryBytes) fail('oversized');
    const temp = this.path(part, `.${name}.${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await this.io.open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0), 0o600);
      await handle.writeFile(body); await handle.sync(); await handle.close(); handle = null;
      if (immutable) {
        await this.io.link(temp, this.path(part, name)).catch(error => { if (error.code !== 'EEXIST') throw error; });
        await this.io.unlink(temp);
      } else await this.io.rename(temp, this.path(part, name));
      if (syncDirectory) await this.syncDirectory(part);
      const result = await this.read(part, name);
      if (!result) fail('readback');
      if (!immutable && stable(result) !== stable(value)) {
        // Pending retry metadata can be superseded by another colour between
        // rename and readback. Accept a sealed, bounded snapshot for this exact
        // key/state; immutable delivery payloads never use this relaxation.
        if (part !== 'statuses' || result.version !== value.version || result.key !== value.key || result.state !== value.state
          || !Number.isFinite(result.updatedAt) || (result.reason !== null && (typeof result.reason !== 'string' || result.reason.length > 500))
          || [result.lastAttemptAt, result.nextAttemptAt].some(item => item !== null && (!Number.isFinite(item) || item < 0))) fail('readback');
      }
      return result;
    } finally {
      if (handle) await handle.close().catch(() => {});
      await this.io.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }

  async capture(args, actor) {
    this.assertReady();
    if (!args || typeof args !== 'object' || Array.isArray(args) || !ID.test(args.p_id || '')) fail('invalid_args');
    const identity = actorIdentity(actor), normalized = JSON.parse(stable(args));
    const key = hash({ args: normalized, actor: identity });
    const op = async () => {
      const prior = await this.receipt(key);
      if (prior) { await this.syncDirectory('receipts'); return this.entry(prior); }
      const value = { version: 1, key, firstSeenAt: this.now(), args: normalized, actor: identity };
      await this.capacity(Buffer.byteLength(stable(seal(value))));
      const stored = await this.write('receipts', `${key}.json`, value, true);
      if (stored.key !== key || hash({ args: stored.args, actor: stored.actor }) !== key) fail('readback');
      return this.entry(stored);
    };
    // Serialize this instance only. Cross-colour immutable links need no locks.
    const pending = this.admissions.then(op, op);
    this.admissions = pending.catch(() => {});
    return pending;
  }

  async receipt(key) {
    if (!KEY.test(key || '')) fail('invalid_key');
    const value = await this.read('receipts', `${key}.json`);
    if (value && (value.version !== 1 || value.key !== key || !Number.isFinite(value.firstSeenAt) || !ID.test(value.args?.p_id || '') || hash({ args: value.args, actor: value.actor }) !== key)) fail('corrupt');
    return value;
  }

  async entry(receipt) {
    const found = [];
    for (const state of STATES) {
      const status = await this.read('statuses', `${receipt.key}.${state}.json`);
      if (!status) continue;
      if (status.version !== 1 || status.key !== receipt.key || status.state !== state || !Number.isFinite(status.updatedAt)) fail('corrupt');
      found.push(status);
    }
    const terminal = TERMINAL.map(state => found.find(item => item.state === state)).find(Boolean);
    const latest = terminal || found.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return { ...receipt, state: latest?.state || 'pending', reason: latest?.reason || null,
      lastAttemptAt: latest?.lastAttemptAt ?? null, nextAttemptAt: latest?.nextAttemptAt ?? null };
  }

  async mark(key, { state, reason = null, lastAttemptAt = null, nextAttemptAt = null } = {}) {
    this.assertReady();
    if (!STATES.includes(state)) fail('invalid_state');
    if (reason !== null && (typeof reason !== 'string' || reason.length > 500)) fail('invalid_reason');
    if ([lastAttemptAt, nextAttemptAt].some(value => value !== null && (!Number.isFinite(value) || value < 0))) fail('invalid_timestamp');
    const receipt = await this.receipt(key); if (!receipt) fail('missing_receipt');
    const current = await this.entry(receipt);
    if (current.state === 'deleted' || (TERMINAL.includes(current.state) && !['saved', 'deleted'].includes(state))) return current;
    const status = { version: 1, key, state, reason, lastAttemptAt, nextAttemptAt, updatedAt: this.now() };
    await this.capacity(Buffer.byteLength(stable(seal(status))));
    await this.write('statuses', `${key}.${state}.json`, status, TERMINAL.includes(state));
    return this.entry(receipt);
  }

  async observation(id) {
    // Never use an unbounded business identifier as a filesystem basename.
    // Read old short-ID files as well so the rollout does not reset prior clocks.
    const names = [observationName(id), legacyObservationName(id)].filter(Boolean);
    const values = [];
    for (const name of names) {
      const value = await this.read('observations', name);
      if (!value) continue;
      if (value.version !== 1 || value.id !== id || !Number.isFinite(value.firstSeenAt)) fail('corrupt');
      values.push(value);
    }
    return values.sort((a, b) => a.firstSeenAt - b.firstSeenAt)[0] || null;
  }

  async firstSeen(id) {
    this.assertReady(); if (typeof id !== 'string' || !ID.test(id)) fail('invalid_id');
    const prior = await this.observation(id);
    if (prior) { if (prior.version !== 1 || prior.id !== id || !Number.isFinite(prior.firstSeenAt)) fail('corrupt'); await this.syncDirectory('observations'); return prior.firstSeenAt; }
    const observation = { version: 1, id, firstSeenAt: this.now() };
    const size = Buffer.byteLength(stable(seal(observation)));
    if (size > this.maxEntryBytes) fail('oversized_observation');
    await this.capacity(size);
    const stored = await this.write('observations', observationName(id), observation, true);
    if (stored.id !== id || !Number.isFinite(stored.firstSeenAt)) fail('corrupt');
    return stored.firstSeenAt;
  }

  async firstSeenMany(ids) {
    this.assertReady();
    if (!Array.isArray(ids) || ids.length > 20_000 || new Set(ids).size !== ids.length) fail('invalid_batch');
    for (let i = 0; i < ids.length; i++) {
      if (!Object.hasOwn(ids, i) || typeof ids[i] !== 'string' || !ID.test(ids[i])) fail('invalid_id');
    }
    const seen = new Map(), missing = [];
    let bytes = 0;
    for (const id of ids) {
      const prior = await this.observation(id);
      if (prior) {
        if (prior.version !== 1 || prior.id !== id || !Number.isFinite(prior.firstSeenAt)) fail('corrupt');
        seen.set(id, prior.firstSeenAt);
      } else {
        const observation = { version: 1, id, firstSeenAt: this.now() };
        const size = Buffer.byteLength(stable(seal(observation)));
        if (size > this.maxEntryBytes) fail('oversized_observation');
        bytes += size;
        missing.push(observation);
      }
    }
    // Bound concurrent metadata-batch admission separately from job payloads.
    // This remains a soft cross-process threshold, with at most 6 MiB per batch.
    if (bytes > 6 * 1024 * 1024) fail('oversized_batch');
    if (missing.length) await this.capacity(bytes, { aggregate: true });
    else await this.scanBytes();
    for (const observation of missing) {
      const stored = await this.write('observations', observationName(observation.id), observation, true, false);
      if (stored.version !== 1 || stored.id !== observation.id || !Number.isFinite(stored.firstSeenAt)) fail('corrupt');
      seen.set(stored.id, stored.firstSeenAt);
    }
    // Individual files were synced before publication. One directory fsync
    // confirms the entire batch before any first-seen timestamps are returned.
    await this.syncDirectory('observations');
    return seen;
  }

  async list() {
    this.assertReady();
    await this.scanBytes();
    const result = [];
    for (const name of (await this.io.readdir(join(this.dir, 'receipts'))).sort()) {
      if (name.startsWith('.') && name.endsWith('.tmp')) continue;
      const receipt = await this.receipt(name.slice(0, -5));
      if (!receipt) fail('corrupt');
      result.push(await this.entry(receipt));
    }
    return result;
  }

  async metadata() {
    const records = await this.list();
    const entries = records.map(({ key, args, firstSeenAt, state, reason, lastAttemptAt, nextAttemptAt }) =>
      ({ key, id: args.p_id, firstSeenAt, state, reason, lastAttemptAt, nextAttemptAt }));
    return { healthy: true, total: entries.length, pending: entries.filter(entry => !TERMINAL.includes(entry.state)).length,
      bytes: await this.scanBytes(), limitBytes: this.maxTotalBytes, entries };
  }
}
