import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, pull, job } from './helpers/job-sync-client.mjs';

// Two browser revisions of the same job (a conflict) can only be resolved by a
// person. When central already holds the job, the status box must offer the
// server copy; the automatic path cannot and the chat stays locked otherwise.
// The harness element keeps only its own text in textContent; gather the subtree.
const textOf = node => [node.textContent || ''].concat((node.children || []).map(textOf)).join(' ');
const findAdopt = (h, id) => {
  let found = null;
  const visit = node => { if (found) return; if (node.getAttribute && node.getAttribute('data-fs-adopt-server') === id) { found = node; return; } (node.children || []).forEach(visit); };
  visit(h.nodes.fsJobSyncStatus);
  return found;
};

test('a conflicted job with a central copy gets an adopt-server control that clears the queue and unlocks the chat', async () => {
  const storage = new Map(), session = new Map([['fs_job_sync_tab_v1', 'cloned-tab-token']]);
  const a = harness({ storage, session }), b = harness({ storage, session: new Map(session) });
  a.context.__new = job('A03430', 'Draft A'); a.run('records.push(__new);saveRecordsStore()');
  b.context.__new = job('A03430', 'Draft B'); b.run('records.push(__new);saveRecordsStore()');
  const central = job('A03430', 'Central copy');
  const h = harness({ storage, records: [job('A03430', 'Draft A')], handler: path => path.startsWith('fs_records?id=eq.A03430') ? [{ id: 'A03430', data: central }] : [],
    beforeAsset: 'window.fetch=function(u,o){return __fetch(u,o);};' });
  h.run(pull([central]));
  const status = h.nodes.fsJobSyncStatus;
  assert.match(textOf(status), /ต้องตรวจสอบ 1 ใบ/);
  assert.match(textOf(status), /A03430 · ข้อมูลหลายฉบับ · ระบบกลางมีใบงานนี้แล้ว/);
  const adopt = findAdopt(h, 'A03430');
  assert.ok(adopt, 'the adopt-server control must be rendered');
  h.run(`openChatRoom('A03430')`);
  assert.equal(h.run('chatOpenId'), null, 'the chat is locked while the conflict stands');
  await adopt.onclick(); await h.settle();
  assert.deepEqual(h.pending(), {}, 'both local revisions are retired');
  assert.ok(Array.from(storage.keys()).some(k => k === 'fs_recbak'), 'the local copies were kept in the version history');
  assert.ok(!h.calls.some(call => call.opt?.method === 'POST' && call.path !== '/__formula/client-diagnostic'), 'adopting the server copy sends no central write');
  const report = h.calls.filter(call => call.path === '/__formula/client-diagnostic').map(call => JSON.parse(call.opt.body)).find(r => r.stage === 'adopt-server');
  assert.deepEqual([report.job, report.reason], ['A03430', 'conflict']);
  h.run(`openChatRoom('A03430')`);
  assert.equal(h.run('chatOpenId'), 'A03430', 'the chat opens once the server copy is adopted');
  // (The harness element keeps stale children when textContent is reassigned,
  // unlike a real DOM, so the control's removal is not asserted here.)
});

test('a conflicted job edited again (status back to pending, variants kept) still gets the adopt-server control', async () => {
  const storage = new Map(), session = new Map([['fs_job_sync_tab_v1', 'cloned-tab-token']]);
  const a = harness({ storage, session }), b = harness({ storage, session: new Map(session) });
  a.context.__new = job('A03430', 'Draft A'); a.run('records.push(__new);saveRecordsStore()');
  b.context.__new = job('A03430', 'Draft B'); b.run('records.push(__new);saveRecordsStore()');
  const central = job('A03430', 'Central copy');
  const h = harness({ storage, records: [job('A03430', 'Draft A')], handler: path => path.startsWith('fs_records?id=eq.A03430') ? [{ id: 'A03430', data: central }] : [],
    beforeAsset: 'window.fetch=function(u,o){return __fetch(u,o);};' });
  h.run(pull([central]));
  // The person edits the job once more: capture() resets the status to pending but keeps the variants.
  h.run("records[0].brand='Edited again'; recTouched['A03430']=1; saveRecordsStore();");
  await h.run('sbPush();'); await h.settle();
  assert.ok(!h.calls.some(call => call.path === 'rpc/fs_save_record'), 'a revision with variants is never sent');
  h.run(`openChatRoom('A03430')`);
  const report = h.calls.filter(call => call.path === '/__formula/client-diagnostic').map(call => JSON.parse(call.opt.body)).find(r => r.stage === 'gate:openChatRoom');
  assert.equal(report.reason, 'queued:variants');
  assert.match(textOf(h.nodes.fsJobSyncStatus), /A03430 · ข้อมูลหลายฉบับ · ระบบกลางมีใบงานนี้แล้ว/);
  const adopt = findAdopt(h, 'A03430');
  assert.ok(adopt, 'the control is offered although the status is pending');
  await adopt.onclick(); await h.settle();
  assert.deepEqual(h.pending(), {});
  h.run(`openChatRoom('A03430')`);
  assert.equal(h.run('chatOpenId'), 'A03430');
});

test('without a central copy the row keeps the automatic wording and no control', () => {
  const storage = new Map(), session = new Map([['fs_job_sync_tab_v1', 'cloned-tab-token']]);
  const a = harness({ storage, session }), b = harness({ storage, session: new Map(session) });
  a.context.__new = job('A03430', 'Draft A'); a.run('records.push(__new);saveRecordsStore()');
  b.context.__new = job('A03430', 'Draft B'); b.run('records.push(__new);saveRecordsStore()');
  const h = harness({ storage, records: [job('A03430', 'Draft A')] });
  h.run(pull([]));
  assert.match(textOf(h.nodes.fsJobSyncStatus), /A03430 · ข้อมูลหลายฉบับ · ระบบจะตรวจสอบข้อมูลกลาง/);
  assert.equal(findAdopt(h, 'A03430'), null);
});
