import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, pull } from './helpers/job-sync-client.mjs';

test('a touched legacy record receives the verified login email before central save', async () => {
  const h = harness({
    owner: 'แยม',
    records: [{ id: 'A09111', brand: 'Synthetic brand', customer: 'Synthetic customer', createdBy: 'แยม', rows: [] }],
    trustedSession: { name: 'แยม', email: 'yam@example.test', role: 'sales', centralUserId: 'iam-yam', authenticated: true },
    beforeAsset: 'window.__fsSessionIdentity={email:"yam@example.test"};',
  });
  h.run(pull([{ id: 'A09111', brand: 'Synthetic brand', customer: 'Synthetic customer', createdBy: 'แยม', rows: [] }]));
  h.run('records[0].brand="Edited brand"; recTouched[records[0].id]=1; saveRecordsStore();');
  await h.run('sbPush();');
  await h.settle();
  const save = h.calls.find(call => call.path === 'rpc/fs_save_record');
  assert.ok(save, 'the touched record did not reach the save gateway');
  assert.equal(save.opt.body.p_data.ownerEmail, 'yam@example.test');
});

test('a touched record owned by someone else is saved without claiming it (pd editing a sales job)', async () => {
  const record = { id: 'A09112', brand: 'Synthetic brand', customer: 'Synthetic customer', createdBy: 'แยม', salesOwner: '15.Sales แยม', rows: [] };
  const h = harness({
    owner: 'มายด์',
    records: [record],
    trustedSession: { name: 'มายด์', email: 'mind@example.test', role: 'pd', centralUserId: 'iam-mind', authenticated: true },
    beforeAsset: 'window.__fsSessionIdentity={email:"mind@example.test"}; function canSeeRecord(r){return !!r;}',
  });
  h.run(pull([record]));
  h.run('records[0].brand="Edited by PD"; recTouched[records[0].id]=1; saveRecordsStore();');
  await h.run('sbPush();');
  await h.settle();
  const save = h.calls.find(call => call.path === 'rpc/fs_save_record');
  assert.ok(save, 'the edit must still be sent');
  assert.equal(save.opt.body.p_data.ownerEmail, undefined, 'a non-owner must never stamp the owner email');
  assert.equal(save.opt.body.p_data.createdBy, 'แยม');
});

test('the salesOwner prefix form still counts as the owner', async () => {
  const record = { id: 'A09113', brand: 'Synthetic brand', customer: 'Synthetic customer', createdBy: 'sales', salesOwner: '22.Sales เอ้', rows: [] };
  const h = harness({
    owner: 'เอ้',
    records: [record],
    trustedSession: { name: 'เอ้', email: 'ae@example.test', role: 'oversea', centralUserId: 'iam-ae', authenticated: true },
    beforeAsset: 'window.__fsSessionIdentity={email:"ae@example.test"}; function canSeeRecord(r){return !!r;}',
  });
  h.run(pull([record]));
  h.run('records[0].brand="Edited by owner"; recTouched[records[0].id]=1; saveRecordsStore();');
  await h.run('sbPush();');
  await h.settle();
  const save = h.calls.find(call => call.path === 'rpc/fs_save_record');
  assert.ok(save);
  assert.equal(save.opt.body.p_data.ownerEmail, 'ae@example.test');
});

test('a revision an earlier page stamped by mistake is un-claimed and retried as the owner\'s job', async () => {
  const record = { id: 'A09114', brand: 'Synthetic brand', customer: 'Synthetic customer', createdBy: 'แยม', salesOwner: '15.Sales แยม', rows: [] };
  const storage = new Map();
  const session = { name: 'มายด์', email: 'mind@example.test', role: 'pd', centralUserId: 'iam-mind', authenticated: true };
  const before = 'window.__fsSessionIdentity={email:"mind@example.test"}; window.fetch=function(u,o){return __fetch(u,o);}; function canSeeRecord(r){return !!r;}';
  // Yesterday's page (older asset) left a refused revision that carries the editor's email.
  storage.set('fs_job_outbox_v1:' + encodeURIComponent('มายด์') + ':tab:x', JSON.stringify({ version: 1, owner: 'มายด์', id: record.id, tab: 'tab',
    data: { ...record, brand: 'Edited by PD', ownerEmail: 'mind@example.test' }, expected: record, status: 'forbidden', reason: 'FORMULA_OWNER_IMMUTABLE', activities: [], at: 1 }));
  // Today's page: the same browser storage, the gateway unchanged for owners.
  const fresh = harness({ owner: 'มายด์', storage, records: [{ ...record, brand: 'Edited by PD', ownerEmail: 'mind@example.test' }], trustedSession: session,
    handler: (path, opt) => path === 'rpc/fs_save_record' ? (opt.body.p_data.ownerEmail ? { status: 'forbidden', id: record.id, reason_code: 'FORMULA_OWNER_IMMUTABLE' } : { status: 'saved', id: record.id, data: structuredClone(opt.body.p_data) }) : [], beforeAsset: before });
  fresh.run(pull([record]));
  await fresh.run('sbPush();'); await fresh.settle();
  const save = fresh.calls.find(call => call.path === 'rpc/fs_save_record');
  assert.ok(save, 'the edit is retried');
  assert.equal(save.opt.body.p_data.ownerEmail, undefined, 'the mistaken claim is removed before the retry');
  assert.equal(save.opt.body.p_data.brand, 'Edited by PD', 'the edit itself is kept');
  assert.deepEqual(fresh.pending(), {}, 'the refused revision is retired');
  assert.ok(fresh.calls.some(call => call.path === '/__formula/client-diagnostic' && JSON.parse(call.opt.body).stage === 'owner-email'));
});

test('a refused stamped revision is revived even after the row was replaced by the central copy on reload', async () => {
  const record = { id: 'A09115', brand: 'Synthetic brand', customer: 'Synthetic customer', createdBy: 'แยม', salesOwner: '15.Sales แยม', rows: [] };
  const storage = new Map();
  const session = { name: 'มายด์', email: 'mind@example.test', role: 'pd', centralUserId: 'iam-mind', authenticated: true };
  const before = 'window.__fsSessionIdentity={email:"mind@example.test"}; window.fetch=function(u,o){return __fetch(u,o);}; function canSeeRecord(r){return !!r;}';
  storage.set('fs_job_outbox_v1:' + encodeURIComponent('มายด์') + ':tab:x', JSON.stringify({ version: 1, owner: 'มายด์', id: record.id, tab: 'tab',
    data: { ...record, rows: [{ name: 'A', w: 1 }], ownerEmail: 'mind@example.test' }, expected: record, status: 'forbidden', reason: 'FORMULA_OWNER_IMMUTABLE', activities: [], at: 1 }));
  // The page loads the central copy (no edit, no email) into records; only the revision holds the edit.
  const h = harness({ owner: 'มายด์', storage, records: [structuredClone(record)], trustedSession: session,
    handler: (path, opt) => path === 'rpc/fs_save_record' ? (opt.body.p_data.ownerEmail ? { status: 'forbidden', id: record.id, reason_code: 'FORMULA_OWNER_IMMUTABLE' } : { status: 'saved', id: record.id, data: structuredClone(opt.body.p_data) }) : [], beforeAsset: before });
  h.run(pull([record]));
  h.run('records[0]=' + JSON.stringify(record) + '; recLastJson[records[0].id]=JSON.stringify(records[0]);'); // the central copy (no email, no edit) is what the page holds
  await h.run('sbPush();'); await h.settle();
  const save = h.calls.find(call => call.path === 'rpc/fs_save_record');
  assert.ok(save, 'the edit held only by the refused revision is sent again');
  assert.equal(save.opt.body.p_data.ownerEmail, undefined);
  assert.deepEqual(save.opt.body.p_data.rows, [{ name: 'A', w: 1 }], 'the edit from the revision is what gets saved');
  assert.deepEqual(h.pending(), {});
});
