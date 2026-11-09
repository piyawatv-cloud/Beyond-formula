import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, pull, job } from './helpers/job-sync-client.mjs';

// The browser reports the first gate that stopped the user, and a forbidden
// verdict is retried once per page load instead of silently sticking forever.
const reportFetch = 'window.fetch=function(url,opt){ return __fetch(url,opt); };';
const reports = h => h.calls.filter(call => call.path === '/__formula/client-diagnostic').map(call => JSON.parse(call.opt.body));

test('a forbidden save is reported with the server reason and retried once per page load', async () => {
  const storage = new Map(), idb = new Map();
  let verdict = { status: 'forbidden', reason_code: 'FORMULA_OWNER_IMMUTABLE' };
  const handler = (path, opt) => path === 'rpc/fs_save_record' ? { id: opt.body.p_id, ...verdict } : (opt?.method === 'POST' && Array.isArray(opt.body) ? structuredClone(opt.body) : []);
  const first = harness({ records: [job()], storage, idb, handler, beforeAsset: reportFetch });
  first.run(pull([job()]));
  first.run("records[0].brand='Edited'; saveRecordsStore();");
  await first.run('sbPush();'); await first.settle();
  const saves = () => first.calls.filter(call => call.path === 'rpc/fs_save_record').length;
  assert.equal(saves(), 1);
  assert.equal(first.pending()[job().id].status, 'forbidden');
  assert.equal(first.pending()[job().id].reason, 'FORMULA_OWNER_IMMUTABLE');
  const reported = reports(first);
  assert.deepEqual(reported.map(r => [r.job, r.stage, r.reason, r.detail]), [[job().id, 'save-result', 'forbidden', 'FORMULA_OWNER_IMMUTABLE']]);
  await first.run('sbPush();'); await first.settle();
  assert.equal(saves(), 1, 'the same page must not hammer a forbidden verdict');
  assert.ok(reports(first).some(r => r.stage === 'queue-skip' && r.reason === 'forbidden'), 'the stuck queue entry is reported');
  first.run(`openChatRoom('${job().id}')`);
  const chatReport = reports(first).find(r => r.stage === 'gate:openChatRoom');
  assert.ok(chatReport, 'a blocked chat open is reported');
  assert.equal(chatReport.reason, 'queued:forbidden');
  assert.equal(chatReport.detail, 'FORMULA_OWNER_IMMUTABLE');

  // A new page load (same browser storage) retries exactly once; the server
  // rule has changed and the retry now succeeds, unblocking the chat.
  verdict = { status: 'saved' };
  const second = harness({ records: [{ ...job(), brand: 'Edited' }], storage, idb, handler: (path, opt) => path === 'rpc/fs_save_record' ? { status: 'saved', id: opt.body.p_id, data: structuredClone(opt.body.p_data) } : handler(path, opt), beforeAsset: reportFetch });
  second.run(pull([job()]));
  await second.run('sbPush();'); await second.settle();
  assert.equal(second.calls.filter(call => call.path === 'rpc/fs_save_record').length, 1);
  assert.deepEqual(second.pending(), {});
  second.run(`openChatRoom('${job().id}')`);
  assert.equal(second.run('chatOpenId'), job().id, 'the chat opens once the retried save is acknowledged');
  assert.ok(!reports(second).some(r => r.stage.startsWith('gate:openChatRoom')));
});

test('a save closed in the browser is reported before any request, with the gate that closed it', async () => {
  const h = harness({ records: [job()], beforeAsset: reportFetch });
  h.run(pull([job()]));
  h.run("records[0].brand='Edited'; saveRecordsStore();");
  h.run('sbCanEdit=false;');
  await h.run('sbPush();'); await h.settle();
  assert.equal(h.calls.filter(call => call.path === 'rpc/fs_save_record').length, 0);
  assert.deepEqual(reports(h).map(r => [r.job, r.stage, r.reason]), [['', 'flush-gate', 'cannot-edit']]);
  h.run('sbCanEdit=true;');
  await h.run('sbPush();'); await h.settle();
  assert.equal(h.calls.filter(call => call.path === 'rpc/fs_save_record').length, 1);
});

test('a chat blocked by a stale local copy names that reason without writing anything', async () => {
  const h = harness({ records: [{ ...job(), brand: 'Local only change' }], beforeAsset: reportFetch });
  h.run(pull([job()]));
  h.run(`records[0].brand='Local only change';`);
  h.run(`openChatRoom('${job().id}')`);
  assert.equal(h.run('chatOpenId'), null);
  const report = reports(h).find(r => r.stage === 'gate:openChatRoom');
  assert.ok(report);
  assert.equal(report.reason, 'local-differs');
  assert.ok(!h.calls.some(call => call.path === 'rpc/fs_save_record'));
});

test('reports are deduplicated per job, stage and reason and never throw without fetch', async () => {
  const h = harness({ records: [job()], beforeAsset: reportFetch });
  h.run(pull([job()]));
  h.run(`records[0].brand='Local only change';`);
  h.run(`openChatRoom('${job().id}'); openChatRoom('${job().id}'); openChatRoom('${job().id}');`);
  assert.equal(reports(h).length, 1);
  const quiet = harness({ records: [job()] });
  quiet.run(pull([job()]));
  quiet.run(`records[0].brand='Local only change';`);
  assert.doesNotThrow(() => quiet.run(`openChatRoom('${job().id}')`));
  assert.equal(quiet.calls.filter(call => call.path === '/__formula/client-diagnostic').length, 0);
});
