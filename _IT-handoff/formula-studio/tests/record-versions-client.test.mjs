import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, job } from './helpers/job-sync-client.mjs';

// The sealed history popup lists recBakList(id): this browser's copies only, so
// an admin never saw what a pd changed on her own machine (16 ต.ค. 2569 A02071).
// The runtime merges the central versions (/__formula/job-versions) into that
// list when the popup opens. Restore keeps the sealed path, which saves through
// the normal gate.
const reports = h => h.calls.filter(call => call.path === '/__formula/client-diagnostic').map(call => JSON.parse(call.opt.body));
// Stand-ins for the sealed popup: the real ones render HTML the harness cannot.
const sealedStubs = `
  function recBakList(id){ return recBak[id] || []; }
  function openRecordHistory(id){ var box=document.createElement('div'); box.id='verBody'; document.body.appendChild(box); window.opened=id; renderRecordHistory(id); }
  function renderRecordHistory(id){ window.rendered=(window.rendered||0)+1; window.renderedList=JSON.stringify(recBakList(id)); }
`;
const versionsFetch = `
  window.__versionsStatus = 200;
  window.fetch = function (u, o) {
    if (String(u).indexOf('/__formula/job-versions?id=') === 0) {
      __fetchLog.push(String(u));
      return Promise.resolve({ ok: window.__versionsStatus === 200, status: window.__versionsStatus, json: function () { return Promise.resolve(JSON.parse(JSON.stringify(__versions))); } });
    }
    return __fetch(u, o);
  };`;
const settle = async h => { for (let i = 0; i < 8; i++) await h.settle(); };
const findNote = (h, id) => {
  let found = null;
  const visit = node => { if (found) return; if (node.getAttribute && node.getAttribute('data-fs-central-versions') === id) { found = node; return; } (node.children || []).forEach(visit); };
  visit(h.context.document.body);
  return found;
};

test('opening the history merges the central versions newest first, deduplicates copies this browser also holds, and re-renders', async () => {
  const h = harness({ records: [job('A02071', 'Current')], beforeAsset: sealedStubs + versionsFetch, owner: 'admin' });
  h.context.__fetchLog = [];
  // One local copy (kept by this browser) and two central versions, one of which is the same data as the local copy.
  h.run("recBak['A02071']=[{ts:5000,by:'admin',why:'แก้ไขในเครื่องนี้',data:Object.assign({}, records[0], {brand:'Shared copy'})}];");
  h.context.__versions = { id: 'A02071', versions: [
    { at: 9000, by: 'มายด์', data: { ...job('A02071', 'Edited by pd on her machine') } },
    { at: 5000, by: 'admin', data: { ...job('A02071', 'Shared copy') } },
  ] };
  h.run("openRecordHistory('A02071')");
  assert.equal(h.run('window.rendered'), 1, 'the sealed popup rendered first with local data');
  await settle(h);
  assert.deepEqual(h.context.__fetchLog, ['/__formula/job-versions?id=A02071']);
  assert.equal(h.run('window.rendered'), 2, 'the popup is re-rendered once the central versions arrive');
  const list = JSON.parse(h.run('window.renderedList'));
  assert.deepEqual(list.map(v => [v.ts, v.by, v.why, v.data.brand]), [
    [9000, 'มายด์', 'บันทึกในระบบกลาง', 'Edited by pd on her machine'],
    [5000, 'admin', 'แก้ไขในเครื่องนี้', 'Shared copy'],
  ], 'central versions appear, newest first, and an identical local copy is not duplicated');
  assert.equal(h.read("recBakList('A02071')[0].central"), true, 'the merged entry is marked as central');
  const note = findNote(h, 'A02071');
  assert.ok(note && /รวมเวอร์ชันจากระบบกลาง 2 รายการ/.test(note.textContent));
  assert.ok(!reports(h).some(r => r.stage === 'job-versions'), 'nothing to report on success');
});

test('when central cannot answer the popup keeps this browser\'s copies and the gap is reported once', async () => {
  const h = harness({ records: [job('A02071', 'Current')], beforeAsset: sealedStubs + versionsFetch });
  h.context.__fetchLog = []; h.context.__versions = {};
  h.run("window.__versionsStatus = 503; recBak['A02071']=[{ts:1,by:'sales',why:'แก้ไขในเครื่องนี้',data:Object.assign({}, records[0], {brand:'Local'})}];");
  h.run("openRecordHistory('A02071')");
  await settle(h);
  assert.deepEqual(h.read("recBakList('A02071')").map(v => v.data.brand), ['Local']);
  assert.equal(h.run('window.rendered'), 1, 'no re-render without central data');
  assert.deepEqual(reports(h).filter(r => r.stage === 'job-versions').map(r => [r.job, r.reason]), [['A02071', 'unavailable']]);
  // A malformed answer is treated the same way: nothing foreign enters the list.
  h.run("window.__versionsStatus = 200;");
  h.context.__versions = { id: 'A02071', versions: [{ at: 'soon', by: 'x', data: { id: 'A09999', brand: 'Other job' } }, { at: 7, by: 'y', data: { id: 'A02071', brand: 'Valid' } }] };
  h.run("openRecordHistory('A02071')");
  await settle(h);
  assert.deepEqual(h.read("recBakList('A02071')").map(v => v.data.brand), ['Valid', 'Local'], 'only well-formed versions of this job are merged');
});

test('the history list is unchanged for pages without the sealed popup functions', () => {
  const h = harness({ records: [job()] });
  assert.equal(h.run("typeof window.recBakList"), 'undefined');
});
