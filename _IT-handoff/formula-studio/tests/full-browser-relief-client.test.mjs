import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, pull, job, source, sealedHtml } from './helpers/job-sync-client.mjs';

// A browser whose localStorage is full: the read-state baseline must still
// run for the rooms that keep ringing, fs_chats must shrink to what central
// does not already hold, and a conflicted draft must still be retirable.
function liftSaveChats() {
  const start = sealedHtml.indexOf('function saveChats(){');
  return sealedHtml.slice(start, sealedHtml.indexOf('\n}', start) + 2);
}
const sealed = ['chatLastTs', 'chatUnread', 'markChatSeen'].map(source).concat(liftSaveChats()).join('\n');
const fetchHook = 'window.fetch=function(u,o){return __fetch(u,o);}; function nowTs(){return 9;}';
const quotaOn = keys => `
  var __setItem = localStorage.setItem;
  localStorage.setItem = function (k, v) {
    if (${JSON.stringify(keys)}.some(function (p) { return k === p || k.indexOf(p + ':') === 0; })) { var e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
    return __setItem.call(localStorage, k, v);
  };`;
const room = id => ({ jobId: id, createdAt: 1, createdBy: 'sales', parts: [], approvals: {}, messages: [{ type: 'msg', user: 'pd', text: 'x', ts: 5 }, { type: 'msg', user: 'pd', text: 'y', ts: 6 }] });
const reports = h => h.calls.filter(call => call.path === '/__formula/client-diagnostic').map(call => JSON.parse(call.opt.body));
const settle = async h => { for (let i = 0; i < 8; i++) await h.settle(); };

test('a partial seen map (a few rooms opened after the fix) is still baselined once for the rooms that keep ringing', async () => {
  const storage = new Map([['fs_chat_seen_v1:sales', JSON.stringify({ A03430: 7 })]]), idb = new Map();
  const h = harness({ records: [job(), job('A03431'), job('A03432')], chat: [room('A03430'), room('A03431'), room('A03432')], storage, idb, beforeAsset: sealed + quotaOn(['fs_chats']) + fetchHook });
  await settle(h);
  assert.equal(h.run("chatUnread(getChat('A03431')) && chatUnread(getChat('A03432'))"), true, 'the other rooms still ring');
  h.run('saveChats();');
  await settle(h);
  assert.equal(h.run("chatUnread(getChat('A03431')) || chatUnread(getChat('A03432'))"), false, 'baselined despite the partial map');
  const seen = JSON.parse(storage.get('fs_chat_seen_v1:sales'));
  assert.ok(seen.__baseline >= 9 && seen.A03430 >= 9 && seen.A03431 >= 9, JSON.stringify(seen));
  h.run("getChat('A03432').messages.push({type:'msg',user:'pd',text:'new',ts:50}); saveChats();");
  await settle(h);
  assert.equal(h.run("chatUnread(getChat('A03432'))"), true, 'a later quota failure does not baseline again');
  assert.equal(reports(h).filter(r => r.stage === 'chat-seen-baseline').length, 1);
});

test('a full browser never reaches the quota for the room store: the slim form is written first, and the quota path still stands behind it', () => {
  const storage = new Map();
  const h = harness({ records: [job()], chat: [room('A03430')], storage,
    beforeAsset: sealed + `
      var __setItem = localStorage.setItem, __full = true;
      localStorage.setItem = function (k, v) {
        // "Full" means: the acknowledged message no longer fits; the slimmed copy does.
        if (k === 'fs_chats' && __full && v.indexOf('"text":"x"') >= 0) { var e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
        return __setItem.call(localStorage, k, v);
      };` + fetchHook });
  // The first message is acknowledged by central; the second is still local-only.
  h.run("sbSnap.msgs[msgUid('A03430', getChat('A03430').messages[0])] = 1;");
  h.run('saveChats();');
  const stored = JSON.parse(storage.get('fs_chats'));
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0].messages.map(m => m.text), ['y'], 'only the unacknowledged message is kept on disk');
  assert.equal(h.run("getChat('A03430').messages.length"), 2, 'the in-memory room is untouched');
  // The slim form is written directly (16 ต.ค. 2569: every pull used to hit the
  // quota first and slim afterwards, for everyone, every day), so no quota error
  // and no "slimmed" report; the compact write is reported with the profile.
  assert.ok(!reports(h).some(r => r.reason === 'quota-exceeded' || r.reason === 'slimmed'), 'the quota is never hit');
  const compact = reports(h).find(r => r.stage === 'chat-storage' && r.reason === 'compact');
  assert.ok(compact, 'the compact write is reported');
  assert.match(compact.detail, /fs_chats \d+ .*total=\d+/);
  // Without the acknowledgement map the whole store is written and the quota path takes over as before.
  h.run("sbSnap.msgs = null; getChat('A03430').messages.push({type:'msg', user:'pd', text:'x', ts:7});");
  h.run('saveChats();');
  assert.ok(reports(h).some(r => r.reason === 'quota-exceeded'), 'the quota failure is still reported when it happens');
});

test('a conflicted draft can be retired on a full browser: the retired copy goes to IndexedDB', async () => {
  const storage = new Map(), idb = new Map(), session = new Map([['fs_job_sync_tab_v1', 'cloned-tab-token']]);
  const a = harness({ storage, session }), b = harness({ storage, session: new Map(session) });
  a.context.__new = job('A03430', 'Draft A'); a.run('records.push(__new);saveRecordsStore()');
  b.context.__new = job('A03430', 'Draft B'); b.run('records.push(__new);saveRecordsStore()');
  const central = job('A03430', 'Central copy');
  const h = harness({ storage, idb, records: [job('A03430', 'Draft A')], handler: path => path.startsWith('fs_records?id=eq.A03430') ? [{ id: 'A03430', data: central }] : [],
    beforeAsset: quotaOn(['fs_recbak']) + 'window.fetch=function(u,o){return __fetch(u,o);};' });
  h.run(pull([central]));
  let adopt = null;
  const visit = node => { if (adopt) return; if (node.getAttribute && node.getAttribute('data-fs-adopt-server') === 'A03430') { adopt = node; return; } (node.children || []).forEach(visit); };
  visit(h.nodes.fsJobSyncStatus);
  assert.ok(adopt);
  await adopt.onclick(); await settle(h);
  assert.deepEqual(h.pending(), {}, 'the conflicted revisions are retired');
  assert.equal(storage.has('fs_recbak'), false, 'localStorage really refused the version history');
  const copies = idb.get('fs_job_recbak_v1').stores.get('copies').values;
  const brands = new Set(Array.from(copies.values()).map(v => v.data.brand));
  assert.deepEqual(brands, new Set(['Draft A', 'Draft B']), 'both local revisions are kept durably');
  assert.ok(reports(h).some(r => r.stage === 'adopt-server' && r.reason === 'backup-indexeddb'));
  h.run(`openChatRoom('A03430')`);
  assert.equal(h.run('chatOpenId'), 'A03430');
});
