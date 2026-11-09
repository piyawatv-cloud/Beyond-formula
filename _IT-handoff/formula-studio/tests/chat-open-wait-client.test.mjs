import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, pull, job } from './helpers/job-sync-client.mjs';

// A room requested while the central baseline is still loading (page just
// opened, or a history pull failed under load) opens by itself once the next
// full pull lands, instead of a hard refusal the person has to retry by hand.
const booting = 'window.__fsRuntimeBoot=function(){}; window.__fsCentralReady=false; window.__fsPermissionReady=true; window.fetch=function(u,o){return __fetch(u,o);};';
const reports = h => h.calls.filter(call => call.path === '/__formula/client-diagnostic').map(call => JSON.parse(call.opt.body));
const textOf = node => [node.textContent || ''].concat((node.children || []).map(textOf)).join(' ');

test('a chat requested before the baseline waits and opens once the full pull applies', () => {
  const h = harness({ records: [job()], beforeAsset: booting });
  h.run(`openChatRoom('A03430')`);
  assert.equal(h.run('chatOpenId'), null, 'not open yet');
  assert.match(textOf(h.nodes.fsJobSyncStatus), /กำลังโหลดข้อมูลจากระบบกลาง/);
  assert.deepEqual(reports(h).map(r => [r.stage, r.reason]), [['gate:openChatRoom', 'central-not-ready:waiting']]);
  h.run('window.__fsCentralReady=true;');
  h.run(pull([job()]));
  assert.equal(h.run('chatOpenId'), 'A03430', 'opened by itself after the pull');
  assert.ok(reports(h).some(r => r.reason === 'opened-after-wait'));
  // (The harness element keeps stale children when textContent is reassigned, so the notice's removal is not asserted here.)
});

test('a pending request older than two minutes is dropped quietly', () => {
  const h = harness({ records: [job()], beforeAsset: booting + 'var __now=Date.now; Date.now=function(){return __now()-200000;};' });
  h.run(`openChatRoom('A03430')`);
  h.run('Date.now=__now; window.__fsCentralReady=true;');
  h.run(pull([job()]));
  assert.equal(h.run('chatOpenId'), null, 'a stale request must not pop a room open later');
  assert.ok(!reports(h).some(r => r.reason === 'opened-after-wait'));
});

test('a room with a queued revision never waits: the real reason is reported at once', () => {
  const storage = new Map(), session = new Map([['fs_job_sync_tab_v1', 'cloned-tab-token']]);
  const a = harness({ storage, session }), b = harness({ storage, session: new Map(session) });
  a.context.__new = job('A03430', 'Draft A'); a.run('records.push(__new);saveRecordsStore()');
  b.context.__new = job('A03430', 'Draft B'); b.run('records.push(__new);saveRecordsStore()');
  const h = harness({ storage, records: [job('A03430', 'Draft A')], beforeAsset: booting });
  h.run(`openChatRoom('A03430')`);
  assert.equal(h.run('chatOpenId'), null);
  assert.ok(!reports(h).some(r => /waiting/.test(r.reason)), 'a queued room is not a readiness wait');
  assert.ok(reports(h).some(r => r.stage === 'gate:openChatRoom' && /^(queued:|central-not-ready$)/.test(r.reason)), JSON.stringify(reports(h)));
});
