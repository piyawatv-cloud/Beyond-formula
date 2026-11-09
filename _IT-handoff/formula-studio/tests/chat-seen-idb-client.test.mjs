import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, job, source, sealedHtml } from './helpers/job-sync-client.mjs';

// When localStorage is completely full (16:21 เชอรี่: even the small seen key
// hit quota-exceeded) the read-state must still survive through IndexedDB.
function liftSaveChats() {
  const start = sealedHtml.indexOf('function saveChats(){');
  return sealedHtml.slice(start, sealedHtml.indexOf('\n}', start) + 2);
}
const sealed = ['chatLastTs', 'chatUnread', 'markChatSeen'].map(source).concat(liftSaveChats()).join('\n');
const fullStorage = `
  localStorage.setItem = function (k, v) { var e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
  window.fetch = function (url, opt) { return __fetch(url, opt); };
  function nowTs() { return 9; }`;
const room = { jobId: 'A03430', createdAt: 1, createdBy: 'sales', parts: [], approvals: {}, messages: [{ type: 'msg', user: 'pd', text: 'x', ts: 5 }] };
const reports = h => h.calls.filter(call => call.path === '/__formula/client-diagnostic').map(call => JSON.parse(call.opt.body));
const settle = async h => { for (let i = 0; i < 8; i++) await h.settle(); };

test('with localStorage completely full the read-state is kept in IndexedDB and restored on reload', async () => {
  const storage = new Map(), idb = new Map();
  const first = harness({ records: [job()], chat: [structuredClone(room)], storage, idb, beforeAsset: sealed + fullStorage });
  await settle(first);
  first.run("markChatSeen(getChat('A03430'));");
  await settle(first);
  assert.equal(storage.has('fs_chat_seen_v1:sales'), false, 'localStorage really refused the write');
  const db = idb.get('fs_chat_seen_v1');
  assert.ok(db, 'the seen database exists');
  const map = db.stores.get('seen').values.get('sales');
  assert.ok(map && map.A03430 >= 9, 'the map landed in IndexedDB');
  assert.ok(reports(first).some(r => r.stage === 'chat-seen-storage' && r.reason === 'quota-exceeded' && r.detail === 'indexeddb-fallback'));

  const second = harness({ records: [job()], chat: [structuredClone(room)], storage, idb, beforeAsset: sealed + fullStorage });
  assert.equal(second.run("chatUnread(getChat('A03430'))"), true, 'before IndexedDB answers the room looks unread');
  await settle(second);
  assert.equal(second.run("chatUnread(getChat('A03430'))"), false, 'restored from IndexedDB');
  second.run("getChat('A03430').messages.push({type:'msg',user:'pd',text:'y',ts:20});");
  assert.equal(second.run("chatUnread(getChat('A03430'))"), true, 'newer activity still rings');
});

test('a full browser with no durable map anywhere is baselined once IndexedDB has answered, and only once', async () => {
  const storage = new Map(), idb = new Map();
  const other = { ...structuredClone(room), jobId: 'A03431' };
  const h = harness({ records: [job(), job('A03431')], chat: [structuredClone(room), other], storage, idb, beforeAsset: sealed + fullStorage });
  // The quota failure arrives before IndexedDB has been read: the baseline is deferred, not skipped.
  h.run('saveChats();');
  await settle(h);
  assert.equal(h.run("chatUnread(getChat('A03430')) || chatUnread(getChat('A03431'))"), false, 'both rooms baselined as read');
  assert.equal(reports(h).filter(r => r.stage === 'chat-seen-baseline').length, 1);
  assert.deepEqual(Object.keys(idb.get('fs_chat_seen_v1').stores.get('seen').values.get('sales')).sort(), ['A03430', 'A03431', '__baseline']);
  h.run("getChat('A03431').messages.push({type:'msg',user:'pd',text:'new',ts:50}); saveChats();");
  await settle(h);
  assert.equal(h.run("chatUnread(getChat('A03431'))"), true, 'a later quota failure does not baseline again');
  assert.equal(reports(h).filter(r => r.stage === 'chat-seen-baseline').length, 1);
  // Reload with the durable map present: no baseline, unread room survives.
  const again = harness({ records: [job(), job('A03431')], chat: [structuredClone(room), { ...other, messages: [{ type: 'msg', user: 'pd', text: 'new', ts: 50 }] }], storage, idb, beforeAsset: sealed + fullStorage });
  again.run('saveChats();');
  await settle(again);
  assert.equal(again.run("chatUnread(getChat('A03431'))"), true);
  assert.equal(again.run("chatUnread(getChat('A03430'))"), false);
  assert.equal(reports(again).some(r => r.stage === 'chat-seen-baseline'), false);
});

test('a room opened while the central pull is still running gets a waiting message, not a failure', () => {
  const h = harness({ records: [job()], chat: [structuredClone(room)], beforeAsset: sealed + 'window.__fsRuntimeBoot=function(){}; window.__fsCentralReady=false; window.__fsPermissionReady=false;' });
  h.run("openChatRoom('A03430')");
  assert.equal(h.run('chatOpenId'), null);
});
