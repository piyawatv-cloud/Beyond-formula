import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, pull, job } from './helpers/job-sync-client.mjs';

// A forbidden revision of a job that central does not hold can never be sent
// by this account (16 ต.ค. 2569: ปุ้ม/rd kept a copy of A02423 after the admin
// deleted it; every page load retried once and was refused, and the status box
// offered nothing). The person can retire that local copy: it goes to the
// version history first, the outbox is cleared, nothing is sent to central.
const reportFetch = 'window.fetch=function(url,opt){ return __fetch(url,opt); };';
const reports = h => h.calls.filter(call => call.path === '/__formula/client-diagnostic').map(call => JSON.parse(call.opt.body));
const textOf = node => [node.textContent || ''].concat((node.children || []).map(textOf)).join(' ');
const findControl = (h, attr, id) => {
  let found = null;
  const visit = node => { if (found) return; if (node.getAttribute && node.getAttribute(attr) === id) { found = node; return; } (node.children || []).forEach(visit); };
  visit(h.nodes.fsJobSyncStatus);
  return found;
};
const forbidden = central => (path, opt) => {
  if (path === 'rpc/fs_save_record') return { id: opt.body.p_id, status: 'forbidden', reason_code: 'FORMULA_ROLE_WRITE_DENIED' };
  if (path.startsWith('fs_records?id=eq.')) return central ? [{ id: central.id, data: central }] : [];
  return opt?.method === 'POST' && Array.isArray(opt.body) ? structuredClone(opt.body) : [];
};

test('a forbidden copy of a job central no longer holds gets a remove-local control that keeps a version and sends nothing', async () => {
  const storage = new Map(), idb = new Map();
  const h = harness({ records: [job('A02423', 'Deleted centrally')], storage, idb, handler: forbidden(null), beforeAsset: reportFetch });
  h.run(pull([]));
  h.run("records[0].brand='Edited after the central delete'; saveRecordsStore();");
  await h.run('sbPush();'); await h.settle();
  assert.equal(h.pending().A02423.status, 'forbidden');
  const status = h.nodes.fsJobSyncStatus;
  assert.match(textOf(status), /A02423 · ไม่มีสิทธิ์บันทึก \(FORMULA_ROLE_WRITE_DENIED\) · ระบบกลางไม่มีใบงานนี้ และบัญชีนี้บันทึกใบงานนี้ไม่ได้/);
  assert.equal(findControl(h, 'data-fs-adopt-server', 'A02423'), null, 'there is no central copy to adopt');
  const remove = findControl(h, 'data-fs-remove-local', 'A02423');
  assert.ok(remove, 'the remove-local control must be rendered');
  const before = h.calls.length;
  assert.equal(await remove.onclick(), true); await h.settle();
  assert.deepEqual(h.pending(), {}, 'the forbidden revision is retired');
  assert.deepEqual(h.read('records'), [], 'the local copy is gone');
  assert.equal(storage.get('fs_records'), '[]', 'the removal is persisted');
  const history = JSON.parse(storage.get('fs_recbak') || '{}');
  assert.ok(Array.isArray(history.A02423) && history.A02423.some(v => v.data.brand === 'Edited after the central delete'), 'the edited copy is kept in the version history');
  const requests = h.calls.slice(before).filter(call => call.path !== '/__formula/client-diagnostic');
  assert.deepEqual(requests.map(call => [call.path, call.opt?.method]), [['fs_records?id=eq.A02423&select=id,data', 'GET']], 'one fresh read, no write');
  const trail = reports(h).filter(r => r.stage === 'remove-local').map(r => [r.job, r.reason, r.detail]);
  assert.deepEqual(trail, [['A02423', 'forbidden', 'FORMULA_ROLE_WRITE_DENIED'], ['A02423', 'removed', 'FORMULA_ROLE_WRITE_DENIED']]);
  // A later page load with the same storage finds nothing to retry.
  const again = harness({ records: [], storage, idb, handler: forbidden(null), beforeAsset: reportFetch });
  again.run(pull([]));
  await again.run('sbPush();'); await again.settle();
  assert.ok(!again.calls.some(call => call.path === 'rpc/fs_save_record'), 'nothing is resent');
});

test('the removal stops when a fresh read finds the job in central, and the control is not offered while central holds it', async () => {
  const storage = new Map(), idb = new Map();
  const central = job('A02423', 'Central copy');
  // The status box was painted while central looked empty; by the click, the job exists again.
  const h = harness({ records: [job('A02423', 'Local copy')], storage, idb, handler: forbidden(central), beforeAsset: reportFetch });
  h.run(pull([]));
  h.run("records[0].brand='Edited locally'; saveRecordsStore();");
  await h.run('sbPush();'); await h.settle();
  const remove = findControl(h, 'data-fs-remove-local', 'A02423');
  assert.ok(remove);
  assert.equal(await remove.onclick(), false); await h.settle();
  assert.equal(h.pending().A02423.status, 'forbidden', 'the revision is untouched');
  assert.equal(h.read('records').length, 1, 'the local copy is untouched');
  assert.match(h.alerts.at(-1), /ระบบกลางมีใบงาน A02423 แล้ว/);
  assert.ok(reports(h).some(r => r.stage === 'remove-local' && r.reason === 'central-has-job'));

  // Painted after a pull that holds the job: no remove-local control.
  const held = harness({ records: [job('A02423', 'Local copy')], storage: new Map(), idb: new Map(), handler: forbidden(central), beforeAsset: reportFetch });
  held.run(pull([central]));
  held.run("records[0].brand='Edited locally'; saveRecordsStore();");
  await held.run('sbPush();'); await held.settle();
  assert.equal(held.pending().A02423.status, 'forbidden');
  assert.equal(findControl(held, 'data-fs-remove-local', 'A02423'), null);
  assert.match(textOf(held.nodes.fsJobSyncStatus), /A02423 · ไม่มีสิทธิ์บันทึก \(FORMULA_ROLE_WRITE_DENIED\) · ระบบกลางมีใบงานนี้แล้ว/);
});

test('a copy that cannot be kept in the version history is not removed', async () => {
  const storage = new Map();
  const h = harness({ records: [job('A02423', 'Deleted centrally')], storage, idb: new Map(), indexedDBFailure: true, handler: forbidden(null),
    beforeAsset: reportFetch });
  h.run(pull([]));
  h.run("records[0].brand='Edited'; saveRecordsStore();");
  await h.run('sbPush();'); await h.settle();
  // Both history stores refuse: localStorage version history and the IndexedDB copy.
  h.run('bakRecord=function(){}; saveRecBak=function(){};');
  const remove = findControl(h, 'data-fs-remove-local', 'A02423');
  assert.equal(await remove.onclick(), false); await h.settle();
  assert.equal(h.pending().A02423.status, 'forbidden');
  assert.equal(h.read('records').length, 1);
  assert.ok(reports(h).some(r => r.stage === 'remove-local' && r.reason === 'backup-failed'));
  assert.match(h.alerts.at(-1), /ยังลบสำเนาในเครื่องไม่ได้ ข้อมูลยังอยู่ครบ/);
});
