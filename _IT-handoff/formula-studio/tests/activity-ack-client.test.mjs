import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { asset } from './helpers/job-sync-client.mjs';

// Run the real acknowledgement code (rule 6.2): lift the two functions out of
// the asset and execute them, instead of asserting that some text exists.
function lift(name) {
  const start = asset.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `asset function ${name}`);
  const end = asset.indexOf('\n  }\n', start);
  return asset.slice(start, end + 4);
}
const context = vm.createContext({});
vm.runInContext(`
  var clone = x => JSON.parse(JSON.stringify(x));
  var stableStr = v => JSON.stringify(v, Object.keys(v || {}).sort());
  var json = x => stableStr(x);
  var exact = (l, r) => json(l) === json(r);
  ${lift('businessActivity')}
  ${lift('activityAcknowledged')}
`, context);
const ack = (rows, activity, journal) => vm.runInContext(`activityAcknowledged(${JSON.stringify(rows)}, ${JSON.stringify(activity)}, ${JSON.stringify(journal)})`, context);

const activity = { uid: 'u1', ts: 5, cat: 'formula', action: 'แก้สูตรในห้องแชท', detail: 'd', job: 'A00001' };
const journal = { actor: { name: 'มายด์', role: 'pd' } };

test('a row the gateway stamped for this actor acknowledges the journal entry', () => {
  assert.equal(ack([{ uid: 'u1', ts: 5, data: { ...activity, user: 'มายด์', role: 'pd' } }], activity, journal), true);
});

test('an identical row already stored for another actor also acknowledges (append-only, first writer wins)', () => {
  assert.equal(ack([{ uid: 'u1', ts: 5, data: { ...activity, user: 'โต', role: 'admin' } }], activity, journal), true);
});

test('empty, unstamped, mismatched or altered rows never acknowledge', () => {
  assert.equal(ack([], activity, journal), false);
  assert.equal(ack([{ uid: 'u1', ts: 5, data: { ...activity } }], activity, journal), false, 'no actor stamp');
  assert.equal(ack([{ uid: 'u1', ts: 5, data: { ...activity, user: '', role: 'pd' } }], activity, journal), false, 'blank actor');
  assert.equal(ack([{ uid: 'u2', ts: 5, data: { ...activity, user: 'มายด์', role: 'pd' } }], activity, journal), false, 'other uid');
  assert.equal(ack([{ uid: 'u1', ts: 6, data: { ...activity, user: 'มายด์', role: 'pd' } }], activity, journal), false, 'other ts');
  assert.equal(ack([{ uid: 'u1', ts: 5, data: { ...activity, detail: 'changed', user: 'มายด์', role: 'pd' } }], activity, journal), false, 'business payload differs');
  assert.equal(ack([{ uid: 'u1', ts: 5, data: { ...activity, user: 'มายด์', role: 'pd' } }], activity, {}), false, 'journal without actor');
});
