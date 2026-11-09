import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, pull, job } from './helpers/job-sync-client.mjs';

// A tab left open across a deploy must pick up the new asset by itself when it
// is idle, and only offer a reload when it holds unsent work.
const page = (liveVersion, extra = '') => `
  window.__fsAssetVersions = {'/fs-job-sync.js': 'old-version', '/fs-session-bridge.js': 'same'};
  window.location = { reloads: 0, reload: function () { this.reloads++; } };
  window.fetch = function (url, opt) {
    if (String(url) === '/__formula/health') return Promise.resolve({ ok: true, json: async () => ({ assets: { '/fs-job-sync.js': ${JSON.stringify(liveVersion)}, '/fs-session-bridge.js': 'same' } }) });
    return __fetch(url, opt);
  };
  ${extra}`;
const reports = h => h.calls.filter(call => call.path === '/__formula/client-diagnostic').map(call => JSON.parse(call.opt.body));
const bar = h => h.nodes.fsVersionBar || null;

test('an idle page reloads itself once when the served asset version differs from the live one', async () => {
  const h = harness({ records: [job()], beforeAsset: page('new-version') });
  h.run(pull([job()]));
  assert.equal(await h.run('window.__fsJobSync.checkVersion()'), 'reloading');
  assert.equal(h.run('window.location.reloads'), 1);
  assert.deepEqual(reports(h).map(r => [r.stage, r.reason, r.detail]), [['version-reload', 'auto', 'old-version->new-version']]);
  assert.equal(await h.run('window.__fsJobSync.checkVersion()'), 'reloading', 'the same version never reloads twice');
  assert.equal(h.run('window.location.reloads'), 1);
});

test('a page with unsent work only shows the reload bar, and reloads once the work is gone', async () => {
  const h = harness({ records: [job()], handler: path => path === 'rpc/fs_save_record' ? { status: 'forbidden', reason_code: 'SYNTHETIC' } : [], beforeAsset: page('new-version') });
  h.run(pull([job()]));
  h.run("records[0].brand='Edited'; saveRecordsStore();");
  await h.run('sbPush();'); await h.settle();
  assert.ok(Object.keys(h.pending()).length, 'a revision is queued');
  assert.equal(await h.run('window.__fsJobSync.checkVersion()'), 'deferred');
  assert.equal(h.run('window.location.reloads'), 0, 'unsent work must never be reloaded away');
  assert.ok(bar(h), 'the reload bar is shown');
  assert.match(bar(h).children[0].textContent, /มีรุ่นใหม่/);
  assert.ok(reports(h).some(r => r.stage === 'version-reload' && r.reason === 'deferred'));
  // The person presses the bar's button: a manual reload is their call.
  bar(h).children[1].onclick();
  assert.equal(h.run('window.location.reloads'), 1);
  assert.ok(reports(h).some(r => r.stage === 'version-reload' && r.reason === 'manual'));
});

test('a current page does nothing, and a page without served versions never watches', async () => {
  const same = harness({ records: [job()], beforeAsset: page('old-version') });
  assert.equal(await same.run('window.__fsJobSync.checkVersion()'), 'current');
  assert.equal(same.run('window.location.reloads'), 0);
  assert.equal(bar(same), null);
  const none = harness({ records: [job()], beforeAsset: 'window.location={reloads:0,reload:function(){this.reloads++;}};' });
  assert.equal(await none.run('window.__fsJobSync.checkVersion()'), 'unknown');
  assert.equal(none.run('window.location.reloads'), 0);
});

test('a focused field or a chat draft counts as busy', async () => {
  const h = harness({ records: [job()], beforeAsset: page('new-version', `
    var ta = document.createElement('textarea'); ta.value = 'ยังพิมพ์ไม่เสร็จ'; document.body.appendChild(ta);`) });
  h.run(pull([job()]));
  assert.equal(await h.run('window.__fsJobSync.checkVersion()'), 'deferred');
  assert.equal(h.run('window.location.reloads'), 0);
});
