import assert from 'node:assert/strict';
import test from 'node:test';
import {harness,job,pull,source} from './helpers/job-sync-client.mjs';

// Exercise the whole approved generateDash, not a copy of its edit/create branch.
const form = `
  let selectedConcepts=[],CONCEPT_KB={};
  window.allocated=0;window.newLogs=0;window.cleared=0;
  document.getElementById=id=>window.fields[id]||(window.fields[id]={value:id==='f_customer'?'Dummy':'',textContent:'',setAttribute(){},classList:{remove(){},add(){}}});
  window.fields={};
  function getRows(){return [{name:'Synthetic ingredient',w:1}];}
  function getTagValues(){return [];}function marketText(){return '';}
  function fmtSize(){return '';}function fmtUW(){return '';}
  function nextRecordId(){window.allocated++;return 'A09002';}
  function saveRecord(d){records.unshift(d);saveRecordsStore();}
  function hideEditingBanner(){window.bannerHidden=true;}
  function renderDashboard(){}function renderRecordsList(){}
  function clearCustomerForm(){window.cleared++;}
  function logAct(_,action){if(action==='สร้างชุดข้อมูลใหม่')window.newLogs++;}
  ${source('generateDash')}
`;

test('Update of a record missing during editing preserves form and never allocates, creates or queues another ID',()=>{
  const h=harness({beforeAsset:form});
  h.run(`window._editingRecordId='A09001';document.getElementById('f_customer').value='Unsaved form';generateDash()`);
  assert.equal(h.run('allocated'),0);
  assert.equal(h.run('newLogs'),0);
  assert.equal(h.run('cleared'),0);
  assert.equal(h.run('_editingRecordId'),'A09001');
  assert.equal(h.run(`document.getElementById('f_customer').value`),'Unsaved form');
  assert.equal(h.run('records.length'),0);
  assert.deepEqual(h.pending(),{});assert.equal(h.calls.length,0);
  assert.match(h.alerts[0],/A09001/);
});

test('guarded normal edit retains its original ID and capture, and intentional create still allocates once',()=>{
  const h=harness({records:[job('A09001')],beforeAsset:form});
  h.run(`_editingRecordId='A09001';generateDash()`);
  assert.equal(h.run('allocated'),0);assert.equal(h.run('records[0].id'),'A09001');
  assert.ok(h.pending().A09001);assert.equal(h.run('_editingRecordId'),null);
  h.run('generateDash()');assert.equal(h.run('allocated'),1);
  assert.ok(h.pending().A09002);assert.equal(h.alerts.length,0);
});

test('full pull verifies an exact original backup before removing a prior-snapshot copy',()=>{
  const original=job('A09001'),h=harness({records:[original]});
  h.run(`sbSnap.records.A09001=stableStr(records[0])`);h.run(pull([]));
  assert.equal(h.run('records.length'),0);
  const versions=JSON.parse(h.storage.get('fs_recbak')).A09001;
  assert.ok(versions.some(v=>JSON.stringify(v.data)===JSON.stringify(original)));
  assert.deepEqual(h.pending(),{});assert.equal(h.calls.length,0);
});

test('removal recovery remains exact after the same full pull prunes legacy history for another changed record',()=>{
  const a={...job('A09001'),notes:'A'.repeat(800000)},b={...job('A09002'),notes:'B'.repeat(800000)};
  const h=harness({records:[a,b]});
  h.run('records.forEach(r=>sbSnap.records[r.id]=stableStr(r))');
  h.run(pull([{...b,notes:'Changed synthetic server copy'}]));
  assert.equal(h.run(`records.some(r=>r.id==='A09001')`),false);
  const copies=[...h.storage].filter(([key])=>key.startsWith('fs_job_recovery_v1:sales:A09001:')).map(([,value])=>JSON.parse(value));
  assert.equal(copies.length,1);assert.deepEqual(copies[0].data,a);
  assert.equal(copies[0].owner,'sales');assert.deepEqual(h.pending(),{});
  const reloaded=harness({storage:h.storage,records:h.read('records')});
  assert.equal(reloaded.run(`records.some(r=>r.id==='A09001')`),false,'recovery archive never auto-seeds records');
  assert.deepEqual(reloaded.pending(),{});
});

test('backup quota failure blocks full-pull removal and preserves local data and edit context',()=>{
  const original=job('A09001'),h=harness({records:[original]});
  const set=h.context.localStorage.setItem;
  h.context.localStorage.setItem=(key,value)=>{if(key==='fs_recbak')throw Error('synthetic quota');set(key,value);};
  h.run(`sbSnap.records.A09001=stableStr(records[0]);_editingRecordId='A09001'`);
  assert.throws(()=>h.run(pull([])),/ไม่สำเร็จ/);
  assert.deepEqual(h.read('records'),[original]);assert.equal(h.run('_editingRecordId'),'A09001');
  assert.equal(h.storage.has('fs_recbak'),false);assert.deepEqual(h.pending(),{});
  assert.equal(h.calls.length,0);assert.match(h.alerts[0],/สำรอง/);
});

test('backup verification rejects a storage API that silently discards the write',()=>{
  const original=job('A09001'),h=harness({records:[original]});
  h.context.localStorage.setItem=()=>{};
  h.run('sbSnap.records.A09001=stableStr(records[0])');
  assert.throws(()=>h.run(pull([])),/ไม่สำเร็จ/);
  assert.deepEqual(h.read('records'),[original]);assert.equal(h.calls.length,0);
});

test('failed immutable recovery storage retains originals before history or full-pull removal',()=>{
  const original=job('A09001'),h=harness({records:[original]});
  const set=h.context.localStorage.setItem;
  h.context.localStorage.setItem=(key,value)=>{if(key.startsWith('fs_job_recovery_v1:'))throw Error('synthetic quota');set(key,value);};
  h.run('sbSnap.records.A09001=stableStr(records[0])');
  assert.throws(()=>h.run(pull([])),/ไม่สำเร็จ/);
  assert.deepEqual(h.read('records'),[original]);assert.equal(h.storage.has('fs_recbak'),false);
});

test('repeated removal reuses an exact recovery copy and never overwrites an unreadable prior candidate',()=>{
  const original=job('A09001'),h=harness({records:[original]});
  const prefix='fs_job_recovery_v1:sales:A09001:';
  h.storage.set(prefix+'old','{invalid synthetic evidence');
  h.run('sbSnap.records.A09001=stableStr(records[0])');h.run(pull([]));
  const before=[...h.storage].filter(([key])=>key.startsWith(prefix));
  assert.equal(before.length,2);
  h.context.__old=original;
  h.run(`records.push(__old);sbSnap.records.A09001=stableStr(__old)`);h.run(pull([]));
  assert.deepEqual([...h.storage].filter(([key])=>key.startsWith(prefix)),before);
  assert.deepEqual(h.pending(),{});assert.equal(h.calls.length,0);
});

test('an already-ready session retries a failed full apply rather than clearing its error through a delta cycle',async()=>{
  const original=job('A09001'),h=harness({records:[original]});
  h.context.localStorage.setItem=(key,value)=>{if(key==='fs_recbak')throw Error('synthetic quota');h.storage.set(key,value);};
  h.run(`sbSnap.records.A09001=stableStr(records[0]);
    let sbCycleRunning=false,sbCycleAgain=false,sbBusy=false,sbErr='',sbLastFull=0,sbCycleN=0;
    const SB_FULL_MS=60000;window.fullFlags=[];
    function sbOn(){return true;}function sbChip(){}function sbSchedule(){}
    async function sbPull(full){fullFlags.push(full);sbApply({full,partial:false,rec:[],cht:[],usr:[],act:[],msg:[],apv:[]});}
    ${source('sbCycle')}`);
  await h.run('sbCycle(true)');await h.run('sbCycle()');
  assert.deepEqual(h.read('fullFlags'),[true,true]);
  assert.match(h.run('sbErr'),/ไม่สำเร็จ/);assert.equal(h.run('sbLastFull'),0);
  assert.deepEqual(h.read('records'),[original]);
});

test('partial full pull retains cached copies without requiring a removal backup',()=>{
  const original=job('A09001'),h=harness({records:[original]});
  h.context.localStorage.setItem=()=>{throw Error('synthetic quota');};
  h.run(`sbSnap.records.A09001=stableStr(records[0]);sbApply({full:true,partial:true,rec:[],cht:[],usr:[],act:[],msg:[],apv:[]})`);
  assert.deepEqual(h.read('records'),[original]);assert.equal(h.alerts.length,0);
});

test('missing-edit rejection does not remove an existing durable pending revision',()=>{
  const h=harness({beforeAsset:form});h.context.__new=job('A09001');
  h.run(`records.push(__new);saveRecordsStore();records=[];_editingRecordId='A09001'`);
  const before=Array.from(h.storage);
  h.run('generateDash()');assert.deepEqual(Array.from(h.storage),before);
  assert.equal(h.run('allocated'),0);assert.equal(h.run('_editingRecordId'),'A09001');
  assert.ok(h.pending().A09001);assert.equal(h.calls.length,0);
});

test('untouched cache and durable pending retain separate preservation paths without auto-seeding',()=>{
  const h=harness({records:[job('A09001')]});h.run(pull([]));
  assert.equal(h.run('records.length'),1);assert.deepEqual(h.pending(),{});
  const pending=harness();pending.context.__new=job('A09002');
  pending.run('records.push(__new);saveRecordsStore()');pending.run(pull([]));
  assert.ok(pending.pending().A09002);assert.equal(pending.run('records.length'),1);
  assert.equal(pending.calls.length,0);
});
