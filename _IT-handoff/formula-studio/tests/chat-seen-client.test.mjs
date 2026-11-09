import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, pull, job, source, sealedHtml } from './helpers/job-sync-client.mjs';

// The sealed page keeps "read" state only in the browser, inside the big
// fs_chats key, and swallows the quota error. These tests run the sealed
// chatUnread/markChatSeen/saveChats (lifted from the release) under the
// runtime asset and prove the seen map survives a failed fs_chats write.
// source() stops at a first line that ends with "}" — saveChats does, so lift it whole.
function liftSaveChats() {
  const start = sealedHtml.indexOf('function saveChats(){');
  assert.ok(start >= 0, 'sealed saveChats');
  return sealedHtml.slice(start, sealedHtml.indexOf('\n}', start) + 2);
}
const sealed = ['chatLastTs', 'chatUnread', 'markChatSeen'].map(source).concat(liftSaveChats()).join('\n');
const quotaOnChats = `
  var __setItem = localStorage.setItem;
  localStorage.setItem = function (k, v) {
    if (k === 'fs_chats') { var e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
    return __setItem.call(localStorage, k, v);
  };
  window.fetch = function (url, opt) { return __fetch(url, opt); };
  function nowTs() { return 9; }`;
const room = { jobId: 'A03430', createdAt: 1, createdBy: 'sales', parts: [], approvals: {}, messages: [{ type: 'msg', user: 'pd', text: 'x', ts: 5 }] };
const reports = h => h.calls.filter(call => call.path === '/__formula/client-diagnostic').map(call => JSON.parse(call.opt.body));

test('the sealed saveChats body is the two statements the runtime replaces', () => {
  assert.equal(liftSaveChats(), "function saveChats(){ try{ localStorage.setItem('fs_chats', JSON.stringify(chats)); }catch(e){}\n  sbQueue();\n}");
  assert.ok(sealedHtml.includes('if(local && local.seen) c.seen = local.seen;'), 'sbBuildChat must still carry local.seen');
});

test('a read room stays read across reloads even when the fs_chats write exceeds the quota', async () => {
  const storage = new Map();
  const first = harness({ records: [job()], chat: [structuredClone(room)], storage, beforeAsset: sealed + quotaOnChats });
  assert.equal(first.run("chatUnread(getChat('A03430'))"), true, 'unread before it is opened');
  first.run("markChatSeen(getChat('A03430')); saveChats();");
  assert.equal(first.run("chatUnread(getChat('A03430'))"), false);
  assert.equal(storage.has('fs_chats'), false, 'the big key really failed to write');
  const seen = JSON.parse(storage.get('fs_chat_seen_v1:sales'));
  assert.ok(seen.A03430 >= 9, 'the seen map is persisted in its own key');
  // The room was marked read before the failing write; the one-time baseline
  // still runs (its marker was absent) and must not lower that room's time.
  // (Every fs_chats write fails here, so the slimmed retry is reported as
  // failed too; the baseline itself lands after IndexedDB answers.)
  assert.ok(reports(first).some(r => r.stage === 'chat-storage' && r.reason === 'quota-exceeded' && /fs_chats chars=\d+/.test(r.detail)));
  assert.ok(reports(first).some(r => r.stage === 'chat-storage' && r.reason === 'slim-failed'));

  // Reload: the browser only has the chat as the server sends it (no seen).
  const second = harness({ records: [job()], chat: [structuredClone(room)], storage, beforeAsset: sealed + quotaOnChats });
  assert.equal(second.run("chatUnread(getChat('A03430'))"), false, 'restored at install');
  // A full pull rebuilds the chat objects; the seen map must survive that too.
  second.run("chats=[" + JSON.stringify(room) + "];");
  second.run(pull([job()]));
  assert.equal(second.run("chatUnread(getChat('A03430'))"), false, 'restored after a pull rebuilt the rooms');
  // A newer message rings the bell again; reading it advances the map.
  second.run("getChat('A03430').messages.push({type:'msg',user:'pd',text:'y',ts:20});");
  assert.equal(second.run("chatUnread(getChat('A03430'))"), true);
  second.run("markChatSeen(getChat('A03430'));");
  assert.ok(JSON.parse(storage.get('fs_chat_seen_v1:sales')).A03430 >= 20);
});

test('a browser over quota with no durable seen map baselines every visible room once; new activity still rings', async () => {
  const storage = new Map();
  const settle = async h => { for (let i = 0; i < 8; i++) await h.settle(); };
  const other = { ...structuredClone(room), jobId: 'A03431', messages: [{ type: 'msg', user: 'pd', text: 'z', ts: 7 }] };
  const h = harness({ records: [job(), job('A03431')], chat: [structuredClone(room), other], storage, beforeAsset: sealed + quotaOnChats });
  assert.equal(h.run("chatUnread(getChat('A03430')) && chatUnread(getChat('A03431'))"), true, 'nothing was ever read on this browser');
  h.run('saveChats();');
  await settle(h); // the baseline waits for IndexedDB to confirm there is no durable map
  assert.equal(h.run("chatUnread(getChat('A03430')) || chatUnread(getChat('A03431'))"), false, 'both rooms count as read from now on');
  const seen = JSON.parse(storage.get('fs_chat_seen_v1:sales'));
  assert.deepEqual(Object.keys(seen).sort(), ['A03430', 'A03431', '__baseline']);
  const baseline = reports(h).find(r => r.stage === 'chat-seen-baseline');
  assert.deepEqual([baseline.reason, baseline.detail], ['quota-exceeded', 'rooms=2']);
  h.run("getChat('A03431').messages.push({type:'msg',user:'pd',text:'new',ts:50});");
  assert.equal(h.run("chatUnread(getChat('A03431'))"), true, 'a message after the baseline rings');
  // The baseline happens once: a later quota failure never marks the new message read.
  h.run('saveChats();');
  assert.equal(h.run("chatUnread(getChat('A03431'))"), true);
  assert.equal(reports(h).filter(r => r.stage === 'chat-seen-baseline').length, 1);
  // A browser that already has a durable map is never baselined, even over quota.
  const later = harness({ records: [job(), job('A03431')], chat: [structuredClone(room), { ...other, messages: [{ type: 'msg', user: 'pd', text: 'new', ts: 50 }] }], storage, beforeAsset: sealed + quotaOnChats });
  await settle(later);
  later.run('saveChats();');
  await settle(later);
  assert.equal(later.run("chatUnread(getChat('A03431'))"), true, 'the unread room survives a reload');
  assert.equal(later.run("chatUnread(getChat('A03430'))"), false);
  assert.equal(reports(later).some(r => r.stage === 'chat-seen-baseline'), false);
});

test('the seen map is per user and never written when nothing changed', () => {
  const storage = new Map();
  const h = harness({ records: [job()], chat: [structuredClone(room)], storage, beforeAsset: sealed + 'function nowTs(){return 9;}' });
  h.run('saveChats();');
  assert.equal(storage.has('fs_chat_seen_v1:sales'), false);
  h.run("markChatSeen(getChat('A03430'));");
  assert.ok(storage.has('fs_chat_seen_v1:sales'));
  assert.equal(storage.has('fs_chat_seen_v1:admin'), false);
  const other = harness({ records: [job()], chat: [structuredClone(room)], storage, owner: 'admin', beforeAsset: sealed + 'function nowTs(){return 9;}' });
  assert.equal(other.run("chatUnread(getChat('A03430'))"), true, 'another user still sees the room as unread');
});
