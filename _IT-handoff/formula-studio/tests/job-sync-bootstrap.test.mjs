import assert from 'node:assert/strict';
import test from 'node:test';
import {harness,job,pull,source} from './helpers/job-sync-client.mjs';

// The actual legacy save runs before the deferred bridge, as it can when an
// already-open page is usable while the versioned bridge is still loading.
const earlyCreate = data => `${source('saveRecord')}\nsaveRecord(${JSON.stringify(data)});`;
const parentCalls = h => h.calls.filter(call=>call.path==='rpc/fs_save_record');
const pendingRows = h => [...h.storage].filter(([key])=>key.startsWith('fs_job_outbox_v1:')).map(([,value])=>JSON.parse(value));

test('a current-session NEW save before bridge installation becomes durable without a second edit',async()=>{
  const data=job('A09002'),h=harness({beforeAsset:earlyCreate(data)});
  assert.equal(h.run('recTouched.A09002'),1,'legacy save supplies current-session provenance');
  assert.deepEqual(h.pending().A09002?.data,data);
  assert.equal(h.pending().A09002?.expected,null,'new job is create-only');
  await h.run('sbPush()');
  assert.equal(parentCalls(h).length,1);
  assert.deepEqual(parentCalls(h)[0].opt.body,{p_id:data.id,p_data:data,p_expected:null});
  assert.deepEqual(h.pending(),{});
  h.run(`createChat('A09002')`);assert.equal(h.run('chats.length'),1);
});

test('the pre-bridge create-log-only reproduction commits its parent before uploading the activity',async()=>{
  const data=job('A09002'),h=harness({beforeAsset:earlyCreate(data)+`
    activities.push({uid:'synthetic-created',ts:1,user:'sales',action:'สร้างชุดข้อมูลใหม่',jobId:'A09002'});
  `});
  await h.run('sbPush()');h.run(pull([]));await h.run('sbPush()');
  const parent=h.calls.findIndex(call=>call.path==='rpc/fs_save_record');
  const activity=h.calls.findIndex(call=>call.path==='fs_activities');
  assert.ok(parent>=0,'an activity is never substituted for the parent save');
  assert.ok(activity>parent,'normal sync sends the parent first');
  assert.equal(parentCalls(h).length,1,'no second edit is needed');
});

test('a pre-bridge NEW draft survives browser reopen and normal sync after an empty full pull',async()=>{
  const data=job('A09002'),storage=new Map();
  const first=harness({storage,beforeAsset:earlyCreate(data)});
  assert.equal(parentCalls(first).length,0,'capture must be durable before any network operation');
  assert.deepEqual(first.pending().A09002?.data,data);
  const reloaded=harness({storage});
  reloaded.run(pull([]));
  assert.deepEqual(reloaded.read('records[0]'),data);
  await reloaded.run('sbPush()');
  assert.deepEqual(parentCalls(reloaded)[0]?.opt.body.p_data,data);
  assert.deepEqual(reloaded.pending(),{});
});

test('installation never seeds untouched historic cache, including a cache with a legacy snapshot',async()=>{
  const historic=job('A09001'),h=harness({records:[historic],beforeAsset:'sbSnap.records.A09001=stableStr(records[0]);'});
  assert.deepEqual(h.pending(),{});await h.run('sbPush()');
  assert.equal(parentCalls(h).length,0);assert.equal(pendingRows(h).length,0);
});

test('pre-bridge genuine edit keeps the original legacy snapshot as a CAS condition, not an acknowledgement',async()=>{
  const original=job('A09001'),h=harness({records:[original],beforeAsset:`
    sbSnap.records.A09001=stableStr(records[0]);records[0].notes='Synthetic edit';saveRecordsStore();
  `});
  const changed={...original,notes:'Synthetic edit'};
  assert.deepEqual(h.pending().A09001?.data,changed);
  assert.deepEqual(h.pending().A09001?.expected,original);
  h.run(`createChat('A09001')`);assert.equal(h.run('chats.length'),0,'legacy snapshot is not committed proof');
  await h.run('sbPush()');
  assert.deepEqual(parentCalls(h)[0]?.opt.body.p_expected,original);
  assert.deepEqual(h.pending(),{});
});

test('pre-bridge stale edit retains its captured CAS condition through a later server pull and conflict',async()=>{
  const original=job('A09001'),server={...original,notes:'Newer server copy'};
  const h=harness({records:[original],handler:async(path,opt)=>{
    if(path==='rpc/fs_save_record')return {status:'conflict',id:opt.body.p_id};
    return Array.isArray(opt?.body)?opt.body:[];
  },beforeAsset:`sbSnap.records.A09001=stableStr(records[0]);records[0].notes='Local edit';saveRecordsStore();`});
  assert.deepEqual(h.pending().A09001?.expected,original);
  h.run(pull([server]));await h.run('sbPush()');
  assert.deepEqual(parentCalls(h)[0]?.opt.body.p_expected,original);
  assert.equal(h.pending().A09001?.status,'conflict');
  assert.equal(h.run('records[0].notes'),'Local edit');
});

test('a differing owned pre-bridge edit preserves both queued values as a held fork',async()=>{
  const original=job('A09001'),storage=new Map(),first=harness({records:[original],storage});
  first.run(pull([original]));first.run(`records[0].notes='First unsent edit';saveRecordsStore();`);
  assert.deepEqual(first.pending().A09001.expected,original);
  const reloaded=harness({storage,records:first.read('records'),beforeAsset:`records[0].notes='Newest pre-bridge edit';saveRecordsStore();`});
  assert.equal(reloaded.run('records[0].notes'),'Newest pre-bridge edit');
  await reloaded.run('sbPush()');
  assert.equal(parentCalls(reloaded).length,0,'uncertain predecessor relation cannot authorize an automatic save');
  const revisions=pendingRows(reloaded).filter(row=>row.id===original.id);
  assert.ok(revisions.some(row=>row.data.notes==='First unsent edit' && JSON.stringify(row.expected)===JSON.stringify(original)));
  assert.ok(revisions.some(row=>row.data.notes==='Newest pre-bridge edit' && row.expected!==null));
  const again=harness({storage});await again.run('sbPush()');
  assert.equal(parentCalls(again).length,0);assert.ok(pendingRows(again).some(row=>row.data.notes==='Newest pre-bridge edit'));
});

test('an older pre-bridge snapshot never rebases its edited value onto another tabs newer CAS baseline',async()=>{
  const original=job('A09001'),newServer={...original,notes:'New server information'},storage=new Map();
  const other=harness({records:[newServer],storage});other.run(pull([newServer]));
  other.run(`records[0].notes='Other tab draft';saveRecordsStore();`);
  const priorKeys=[...storage].filter(([key])=>key.startsWith('fs_job_outbox_v1:'));
  const stale=harness({records:[original],storage,beforeAsset:`
    sbSnap.records.A09001=stableStr(records[0]);records[0].brand='Stale form edit';saveRecordsStore();
  `});
  await stale.run('sbPush()');assert.equal(parentCalls(stale).length,0);
  const revisions=pendingRows(stale);
  const candidate=revisions.find(row=>row.data.brand==='Stale form edit');
  assert.deepEqual(candidate?.expected,original,'the snapshot is a condition, never replaced by another queue baseline');
  assert.ok(revisions.some(row=>row.data.notes==='Other tab draft' && JSON.stringify(row.expected)===JSON.stringify(newServer)));
  stale.run(pull([newServer]));await stale.run('sbPush()');assert.equal(parentCalls(stale).length,0);
  assert.ok(pendingRows(stale).some(row=>row.data.brand==='Stale form edit'));
  priorKeys.forEach(([key,value])=>assert.equal(storage.get(key),value,'another tab immutable revision must remain unchanged'));
});

test('a missing pre-bridge snapshot cannot borrow a different queued revision newer baseline',async()=>{
  const original=job('A09001'),newServer={...original,notes:'New server information'},storage=new Map();
  const other=harness({records:[newServer],storage});other.run(pull([newServer]));
  other.run(`records[0].notes='Other tab draft';saveRecordsStore();`);
  const stale=harness({records:[original],storage,beforeAsset:`records[0].brand='Stale form edit';saveRecordsStore();`});
  await stale.run('sbPush()');assert.equal(parentCalls(stale).length,0);
  const revisions=pendingRows(stale),candidate=revisions.find(row=>row.data.brand==='Stale form edit');
  assert.ok(candidate && candidate.expected!==null);
  assert.notDeepEqual(candidate.expected,newServer,'unknown origin cannot silently inherit a newer baseline');
  assert.ok(revisions.some(row=>row.data.notes==='Other tab draft'));
  const again=harness({storage});await again.run('sbPush()');assert.equal(parentCalls(again).length,0);
  assert.ok(pendingRows(again).some(row=>row.data.brand==='Stale form edit'));
});

test('actor change before installation never imports another actors current-session row into its outbox',async()=>{
  const h=harness({beforeAsset:earlyCreate(job('A09002'))+`currentUser='admin';`});
  await h.run('sbPush()');
  assert.equal(parentCalls(h).length,0);assert.deepEqual(h.pending(),{});
  assert.equal(pendingRows(h).length,0);
});

test('early capture excludes a record hidden from the current actor',async()=>{
  const foreign=job('A09002');foreign.createdBy='other-sales';
  const h=harness({beforeAsset:earlyCreate(foreign)});await h.run('sbPush()');
  assert.equal(parentCalls(h).length,0);assert.equal(pendingRows(h).length,0);
});

test('malformed nonempty legacy baseline retains the early edit and never silently becomes create-only',async()=>{
  const original=job('A09001'),h=harness({records:[original],beforeAsset:`
    sbSnap.records.A09001='{invalid synthetic snapshot';records[0].notes='Local edit';saveRecordsStore();
  `});
  assert.equal(h.pending().A09001?.data.notes,'Local edit');
  assert.equal(h.pending().A09001?.status,'invalid');
  await h.run('sbPush()');assert.equal(parentCalls(h).length,0);
  const reloaded=harness({storage:h.storage});await reloaded.run('sbPush()');
  assert.equal(reloaded.pending().A09001?.status,'invalid');assert.equal(parentCalls(reloaded).length,0);
  assert.equal(reloaded.run('records[0].notes'),'Local edit');
});

test('only an absent snapshot key allows an early create-only save; present uncertain values stay blocked',async t=>{
  const cases=[
    ['absent key',`delete sbSnap.records.A09002;`,true],
    ['present null',`sbSnap.records.A09002=null;`,false],
    ['present empty string',`sbSnap.records.A09002='';`,false],
    ['present undefined',`sbSnap.records.A09002=undefined;`,false],
    ['present array snapshot',`sbSnap.records.A09002='[]';`,false],
    ['present incomplete object snapshot',`sbSnap.records.A09002='{"id":"A09002"}';`,false],
    ['present wrong record snapshot',`sbSnap.records.A09002=${JSON.stringify(JSON.stringify(job('A09001')))};`,false],
  ];
  for(const [name,setSnapshot,createAllowed] of cases)await t.test(name,async()=>{
    const data=job('A09002'),h=harness({beforeAsset:earlyCreate(data)+setSnapshot});
    assert.deepEqual(h.pending().A09002?.data,data);
    if(createAllowed){
      assert.equal(h.pending().A09002?.expected,null);await h.run('sbPush()');
      assert.equal(parentCalls(h).length,1);assert.equal(parentCalls(h)[0].opt.body.p_expected,null);
    }else{
      assert.notEqual(h.pending().A09002?.expected,null);assert.equal(h.pending().A09002?.status,'invalid');
      await h.run('sbPush()');assert.equal(parentCalls(h).length,0);
      const again=harness({storage:h.storage});await again.run('sbPush()');
      assert.notEqual(again.pending().A09002?.expected,null);assert.equal(parentCalls(again).length,0);
    }
  });
});

test('a later edit and browser reopen never turn an unknown early baseline into a create-only save',async()=>{
  const original=job('A09001'),h=harness({records:[original],beforeAsset:`
    sbSnap.records.A09001='{invalid synthetic snapshot';records[0].notes='Early edit';saveRecordsStore();
  `});
  assert.ok(h.pending().A09001,'the unknown-baseline draft is retained');
  assert.notEqual(h.pending().A09001.expected,null,'unknown is not proof the server row is absent');
  h.run(`records[0].notes='Second explicit edit';saveRecordsStore();`);
  assert.equal(h.pending().A09001?.status,'invalid');
  assert.notEqual(h.pending().A09001?.expected,null);
  await h.run('sbPush()');assert.equal(parentCalls(h).length,0);
  const reloaded=harness({storage:h.storage});await reloaded.run('sbPush()');
  assert.equal(reloaded.pending().A09001?.data.notes,'Second explicit edit');
  assert.equal(reloaded.pending().A09001?.status,'invalid');
  assert.notEqual(reloaded.pending().A09001?.expected,null);
  assert.equal(parentCalls(reloaded).length,0);
});

test('a pre-bridge NEW ID collision is create-only and retains the draft without replacing the server copy',async()=>{
  const data=job('A09002'),server={...data,brand:'Preexisting synthetic server copy'};
  const h=harness({beforeAsset:earlyCreate(data),handler:async(path,opt)=>{
    if(path==='rpc/fs_save_record')return {status:'conflict',id:opt.body.p_id};
    return Array.isArray(opt?.body)?opt.body:[];
  }});
  assert.deepEqual(h.pending().A09002?.data,data);
  await h.run('sbPush()');
  assert.equal(parentCalls(h)[0]?.opt.body.p_expected,null);
  assert.equal(h.pending().A09002?.status,'conflict');
  h.run(pull([server]));
  assert.deepEqual(h.read('records[0]'),data);assert.equal(h.pending().A09002?.status,'conflict');
  assert.deepEqual(h.pending().A09002?.data,data);
});

test('outbox quota failure during early capture preserves the local row and visibly halts parent sync',async()=>{
  const data=job('A09002'),h=harness({beforeAsset:earlyCreate(data)+`
    var priorSet=localStorage.setItem;
    localStorage.setItem=function(key,value){if(key.indexOf('fs_job_outbox_v1:')===0)throw Error('synthetic quota');return priorSet.call(this,key,value);};
  `});
  await h.run('sbPush()');
  assert.deepEqual(h.read('records'),[data]);assert.equal(parentCalls(h).length,0);
  assert.deepEqual(h.pending(),{});
  assert.match(h.nodes.fsJobSyncStatus.textContent,/ใบงาน.*ไม่สำเร็จ/);
  assert.equal(h.nodes.fsJobSyncStatus.hidden,false);
});

test('outbox write silently discarded during early capture is detected and cannot enable parent sync',async()=>{
  const data=job('A09002'),h=harness({beforeAsset:earlyCreate(data)+`
    var priorSet=localStorage.setItem;
    localStorage.setItem=function(key,value){if(key.indexOf('fs_job_outbox_v1:')===0)return;return priorSet.call(this,key,value);};
  `});
  await h.run('sbPush()');
  assert.deepEqual(h.read('records'),[data]);assert.deepEqual(h.pending(),{});
  assert.equal(parentCalls(h).length,0);assert.match(h.nodes.fsJobSyncStatus.textContent,/ใบงาน.*ไม่สำเร็จ/);
  h.run(`createChat('A09002')`);assert.equal(h.run('chats.length'),0);
});
