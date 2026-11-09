import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const assetPath = new URL('../runtime/assets/fs-rollback-chat-recovery.js', import.meta.url);
const source = existsSync(assetPath) ? readFileSync(assetPath, 'utf8') : '';
const session = (role = 'sales', extra = {}) => ({ authenticated: true, name: 'Synthetic user', centralUserId: 'synthetic-user', role, email: 'user@example.test', expiresAt: new Date(Date.now() + 60000).toISOString(), ...extra });
const identity = JSON.stringify(['Synthetic user', 'synthetic-user', 'sales', 'user@example.test']);
const v1Key = 'fs_chat_pending_v1:' + encodeURIComponent(identity);
const v2Key = 'fs_chat_journal_v2:synthetic';
function fixture() {
  return new Map([
    [v2Key, ' { "kind":"pending", "identity":' + JSON.stringify(identity) + ', "jobId":"A00001", "message":{"uid":"new","text":"ข้อความค้าง 🧪"} }\n'],
    [v1Key, '[ {"jobId":"A00001","message":{"uid":"old","text":"v1 pending"}} ]\n'],
    ['fs_chat_journal_v2:other', JSON.stringify({ kind: 'pending', identity: 'other identity', message: { uid: 'foreign', text: 'other private draft' } })],
    ['fs_chat_journal_v2:malformed', '{broken JSON\n'],
    ['fs_chat_unclassified_recovery_v1', '{ "raw": "unknown envelope" }'],
    ['fs_chats', '[ {"jobId":"A00001","messages":[{"text":"old app copy"}]} ]'],
    ['fs_chats_foreign', 'DO_NOT_EXPORT'], ['fs_users', 'DO_NOT_EXPORT'], ['session_token', 'DO_NOT_EXPORT'],
  ]);
}
function harness(storage, { sessions = [session()], unavailable = false, journal = {items:[],raws:[],receipts:[]} } = {}) {
  const writes = [], calls = [], downloads = [], nodes = new Map();
  function node() { return { style: {}, children: [], setAttribute() {}, appendChild(child) { this.children.push(child); if (child.id) nodes.set(child.id, child); }, click() { if (this.download) downloads.push(this.href); }, remove() {} }; }
  const context = { console, Date, JSON, Map, Set, Promise, document: { body: node(), createElement: node, getElementById: id => nodes.get(id) },
    localStorage: { get length() { return storage.size; }, key: i => [...storage.keys()][i], getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem(...args) { writes.push(args); throw new Error('storage mutation forbidden'); }, removeItem(...args) { writes.push(args); throw new Error('storage mutation forbidden'); }, clear() { throw new Error('storage mutation forbidden'); } },
    fetch: async (path, options) => { calls.push({ path, options }); return { ok: !unavailable, json: async () => sessions[Math.min(calls.length - 1, sessions.length - 1)] }; },
    Blob: class { constructor(parts) { this.parts = parts; } }, URL: { createObjectURL: blob => blob.parts.join(''), revokeObjectURL() {} }, setTimeout: fn => fn(), location: { pathname: '/__formula/chat-recovery' },
  };
  context.__fsChatJournal={snapshot:async()=>typeof journal==='function'?journal():journal};context.window = context; vm.runInNewContext(source, context);
  assert.ok(context.__fsRollbackChatRecovery, 'standalone rollback recovery asset must expose its read-only surface');
  return { context, writes, calls, downloads };
}

test('non-admin recovery exports only its exact v1/v2 pending strings using a fresh server identity', async () => {
  const storage = fixture(), before = [...storage], h = harness(storage);
  const result = await h.context.__fsRollbackChatRecovery.snapshot();
  assert.equal(result.entries.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(result.entries)), [{ key: v2Key, raw: storage.get(v2Key) }, { key: v1Key, raw: storage.get(v1Key) }]);
  assert.ok(!JSON.stringify(result).includes('other private draft'));
  assert.deepEqual([...storage], before); assert.deepEqual(h.writes, []);
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls.every(call => call.path === '/sb/session' && call.options.method === 'GET' && call.options.credentials === 'same-origin' && call.options.cache === 'no-store'));
});
test('Admin can export all allowlisted formats including malformed and empty evidence with exact raw bytes', async () => {
  const storage = fixture(); storage.set('fs_chat_journal_v2:empty', '');
  const before = [...storage], h = harness(storage, { sessions: [session('admin')] });
  await h.context.__fsRollbackChatRecovery.download();
  assert.equal(h.downloads.length, 1);
  const payload = JSON.parse(h.downloads[0]);
  assert.equal(payload.entries.length, 7);
  for (const entry of payload.entries) assert.equal(entry.raw, storage.get(entry.key));
  assert.ok(!h.downloads[0].includes('DO_NOT_EXPORT'));
  assert.deepEqual([...storage], before); assert.deepEqual(h.writes, []);
});
test('unavailable expired anonymous or changed sessions fail closed without consuming pending bytes', async () => {
  for (const options of [{ unavailable: true }, { sessions: [session('sales', { authenticated: false })] }, { sessions: [session('sales', { expiresAt: new Date(0).toISOString() })] },
    { sessions: [session(), session('sales', { centralUserId: 'changed' })] }, { sessions: [session('admin'), session()] }]) {
    const storage = fixture(), before = [...storage], h = harness(storage, options);
    await assert.rejects(h.context.__fsRollbackChatRecovery.download());
    assert.equal(h.downloads.length, 0); assert.deepEqual(h.writes, []); assert.deepEqual([...storage], before);
  }
});
test('non-admin role and identity claims in local storage cannot authorize old or foreign evidence', async () => {
  const storage = fixture(); storage.set('role', 'admin'); storage.set('currentUser', 'Synthetic Admin');
  const h = harness(storage, { sessions: [session('sales', { centralUserId: 'other-session' })] });
  assert.equal((await h.context.__fsRollbackChatRecovery.snapshot()).entries.length, 0);
  assert.deepEqual(h.writes, []);
});

test('a storage read failure blocks export without changing or discarding any captured evidence', async () => {
  const storage = fixture(), before = [...storage], h = harness(storage);
  h.context.localStorage.getItem = () => { throw new Error('synthetic storage unavailable'); };
  await assert.rejects(h.context.__fsRollbackChatRecovery.download());
  assert.equal(h.downloads.length, 0); assert.deepEqual(h.writes, []); assert.deepEqual([...storage], before);
});

test('rollback fallback exports exact item raw and admin-only archived raw with no storage writes',async()=>{
 const raw=fixture().get(v2Key),archive='{broken original 🧪\n';
 const journal={items:[{key:v2Key,raw,value:JSON.parse(raw),backend:'indexeddb'}],raws:[{sourceKey:'fs_chats',raw:archive}],receipts:[]};
 const mine=harness(new Map(),{journal});assert.deepEqual(JSON.parse(JSON.stringify((await mine.context.__fsRollbackChatRecovery.snapshot()).entries)),[{key:v2Key,raw}]);
 const all=harness(new Map(),{journal,sessions:[session('admin')]});assert.deepEqual(JSON.parse(JSON.stringify((await all.context.__fsRollbackChatRecovery.snapshot()).entries)),[{key:v2Key,raw},{key:'fs_chats',raw:archive}]);assert.deepEqual(all.writes,[]);
});
test('rollback waits for local async snapshot before final session validation and denies changed owner',async()=>{
 let finish;const delayed=new Promise(r=>finish=r);const h=harness(new Map(),{journal:()=>delayed,sessions:[session(),session('sales',{centralUserId:'changed'})]});
 const pending=h.context.__fsRollbackChatRecovery.snapshot();await Promise.resolve();finish({items:[],raws:[],receipts:[]});await assert.rejects(pending,/session changed/);
});
test('rollback unavailable fallback blocks export even with readable localStorage',async()=>{
 const h=harness(fixture(),{journal:()=>{throw Error('chat-journal-open')}});await assert.rejects(h.context.__fsRollbackChatRecovery.snapshot());assert.equal(h.downloads.length,0);
});
