import assert from 'node:assert/strict';
import test from 'node:test';
import {harness} from './helpers/job-sync-client.mjs';

import {form} from './helpers/job-submit-form.mjs';

const parentCalls=h=>h.calls.filter(call=>call.path==='rpc/fs_save_record');
const inputs=h=>h.read(`Object.fromEntries(Object.keys(fields).filter(k=>k.indexOf('f_')===0).map(k=>[k,fields[k].value]))`);

test('create is enabled only after ready and capture/push/generator wrappers are installed',()=>{
  const h=harness({beforeAsset:form});
  assert.equal(h.run('!!__fsJobSync.ready'),true);
  assert.equal(h.run('__fsJobSync.canCreate()'),true,'central allocator can use the healthy installed journal');
  assert.equal(h.run('fields.btnCreate.disabled'),false);
  const observations=h.read('enableObservations');assert.ok(observations.length>=1);
  observations.forEach(observation=>assert.deepEqual(observation,{ready:true,saveWrapped:true,pushWrapped:true,generateWrapped:true}));
});

test('successful durable local journal still clears the form normally and offline sync retains the draft',async()=>{
  const h=harness({beforeAsset:form,handler:async()=>{throw Error('synthetic offline');}});
  h.run('generateDash()');
  assert.equal(h.run('allocated'),1);assert.equal(h.run('cleared'),1);
  assert.equal(h.run('fields.f_customer.value'),'');assert.equal(h.run('_editingRecordId'),null);
  const pending=h.pending().A09001;assert.ok(pending);
  assert.deepEqual(pending.data,h.read('records[0]'));assert.equal(pending.expected,null);
  await h.run('sbPush()');assert.ok(h.pending().A09001);
  h.run(`createChat('A09001')`);assert.equal(h.run('chats.length'),0);
});

for(const mode of ['outbox-quota','outbox-no-op','all-storage-quota'])test(`${mode} retains the complete form, local data and same-ID retry context`,async()=>{
  const h=harness({beforeAsset:form});
  const originalSet=h.context.localStorage.setItem;
  h.context.localStorage.setItem=(key,value)=>{
    if(mode==='all-storage-quota')throw Error('synthetic all-storage quota');
    if(key.startsWith('fs_job_outbox_v1:')){
      if(mode==='outbox-no-op')return;
      throw Error('synthetic outbox quota');
    }
    return originalSet(key,value);
  };
  const before=inputs(h);h.run('generateDash()');
  assert.deepEqual(inputs(h),before);assert.equal(h.run('cleared'),0);
  assert.equal(h.run('allocated'),1);assert.equal(h.run('records.length'),1);
  assert.equal(h.run('_editingRecordId'),'A09001');assert.equal(h.run('_lastDash.id'),'A09001');
  assert.equal(h.run('records[0].customer'),'Synthetic customer');
  assert.equal(h.run('records[0].notes'),'Unsaved synthetic notes');
  assert.equal(h.run('__fsJobSync.canCreate()'),false,'copy/import allocator must see the same storage failure');
  assert.deepEqual(h.pending(),{});assert.match(h.run('fields.gen_err.textContent'),/บันทึก|สำรอง|พื้นที่|รอส่ง/);
  await h.run('sbPush()');assert.equal(parentCalls(h).length,0);
  h.run(`createChat('A09001')`);assert.equal(h.run('chats.length'),0);
  h.run('generateDash()');assert.equal(h.run('allocated'),1,'a known storage failure cannot allocate a replacement ID');
  assert.deepEqual(inputs(h),before);assert.equal(h.run('records.length'),1);
});

test('a storage failure already discovered during bootstrap blocks generation before any allocation',()=>{
  const early={id:'A09009',brand:'Synthetic early',customer:'Dummy',createdBy:'sales',createdAt:1,rows:[]};
  const h=harness({beforeAsset:form+`
    saveRecord(${JSON.stringify(early)});
    var priorSet=localStorage.setItem;
    localStorage.setItem=function(key,value){if(key.indexOf('fs_job_outbox_v1:')===0)throw Error('synthetic quota');return priorSet.call(this,key,value);};
  `});
  const before=inputs(h);h.run('generateDash()');
  assert.equal(h.run('__fsJobSync.canCreate()'),false);
  assert.equal(h.run('allocated'),0);assert.deepEqual(inputs(h),before);
  assert.equal(h.run('cleared'),0);assert.equal(h.run('records.length'),1);assert.equal(parentCalls(h).length,0);
});
