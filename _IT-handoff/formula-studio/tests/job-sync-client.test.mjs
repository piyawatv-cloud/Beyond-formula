import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import { job, harness, pull, edit, asset, source, sealedHtml } from './helpers/job-sync-client.mjs';

test('actual bootstrap cycle never pushes after failed full pull and retains newly captured draft',async()=>{
  const h=harness();h.context.__new=job();
  h.run(`sbReady=false;records.push(__new);saveRecordsStore();
    let sbCycleRunning=false,sbCycleAgain=false,sbBusy=false,sbErr='',sbLastFull=0,sbCycleN=0;
    const SB_FULL_MS=60000;
    function sbOn(){return true;}function sbChip(){}function sbSchedule(){window.scheduled=true;}
    async function sbPull(full){window.fullRequested=full;throw Error('synthetic full pull offline');}
    ${source('sbCycle')}`);
  await h.run('sbCycle(true)');
  assert.equal(h.calls.length,0);assert.equal(h.run('sbReady'),false);assert.equal(h.context.fullRequested,true);
  assert.ok(h.pending().A03430);assert.equal(h.context.scheduled,true);
  h.run(`createChat('A03430')`);assert.equal(h.run('chats.length'),0);
  h.run(`sbPull=async function(full){window.fullRequested=full;return {full:true,partial:false,rec:[],cht:[],usr:[],act:[],msg:[],apv:[]};}`);
  await h.run('sbCycle(true)');
  assert.equal(h.calls.length,0);assert.equal(h.run('sbReady'),true);assert.ok(h.pending().A03430);
  assert.equal(h.read('records[0]').id,'A03430');
  await h.run('sbCycle(true)');
  assert.equal(h.calls.filter(call=>call.path==='rpc/fs_save_record').length,1);
  assert.deepEqual(h.pending(),{});
});

test('corrupt owner outbox remains intact, warns and blocks even server-confirmed chat',async()=>{
  const key='fs_job_outbox_v1:sales:corrupt-revision';
  for(const corrupt of ['{bad json',JSON.stringify({version:1,owner:'other',id:'A03430',data:job(),expected:null,status:'pending'}),JSON.stringify({version:1,owner:'sales',id:'A03430',data:job('A03431'),expected:null,status:'pending'})]){
    const storage=new Map([[key,corrupt]]), h=harness({storage,records:[job()]});
    h.run(pull([job()]));await h.run('sbPush()');
    h.run(`openChatRoom('A03430');createChat('A03430');sendChatMsg()`);
    assert.equal(storage.get(key),corrupt,'corrupt evidence is never cleared or replaced');
    assert.equal(h.calls.length,0);assert.equal(h.run('chatOpenId'),null);assert.equal(h.run('chats.length'),0);
    assert.match(h.nodes.fsJobSyncStatus.textContent,/ใบงาน.*ไม่สำเร็จ/);
    assert.match(h.nodes.fsJobSyncStatus.textContent,/ข้อมูลฉบับรอส่งในเบราว์เซอร์อ่านไม่ได้/);
    assert.match(h.alerts[0],/สำรองใบงานก่อนปิด/);
    const reload=harness({storage,records:[job()]});reload.run(pull([job()]));
    reload.run(`openChatRoom('A03430')`);assert.equal(reload.run('chatOpenId'),null);
    assert.equal(storage.get(key),corrupt);
  }
});

test('untouched cache never becomes a durable create or bulk record write',async()=>{
  const h=harness({records:[job()]}); await h.run('sbPush()');
  assert.equal(h.calls.some(c=>c.path==='rpc/fs_save_record'||c.path==='fs_records'),false);
  assert.deepEqual(h.pending(),{});
  h.run(`openChatRoom('A03430')`); assert.equal(h.alerts.length,0); assert.equal(h.run('chatOpenId'),null);
});

test('an exact server acknowledgement clears only the sent draft and enables chat',async()=>{
  const h=harness();h.context.__new=job();h.run('records.push(__new);saveRecordsStore()');
  assert.ok(h.pending().A03430);h.run(`createChat('A03430')`);assert.equal(h.run('chats.length'),0);
  await h.run('sbPush()');assert.deepEqual(h.pending(),{});
  assert.equal(h.calls.find(c=>c.path==='rpc/fs_save_record').opt.body.p_expected,null);
  h.run(`openChatRoom('A03430')`);assert.equal(h.run('chatOpenId'),'A03430');
});

test('captured baseline survives reload and full server pull without rebasing a stale edit',async()=>{
  const original=job(), h=harness({records:[original]});h.run(pull([original]));edit(h);
  const reload=harness({records:[job('A03430','Cached stale')],storage:h.storage,session:h.session});
  reload.run(pull([job('A03430','Changed elsewhere')]));
  assert.equal(reload.read('records[0]').brand,'Edited');
  await reload.run('sbPush()');
  assert.equal(reload.calls[0].opt.body.p_expected.brand,'Synthetic');
  assert.equal(reload.calls[0].opt.body.p_data.brand,'Edited');
});

test('network failure retains durable draft and blocks messages on an already open room',async()=>{
  const original=job(),h=harness({records:[original],chat:[{jobId:'A03430',messages:[],parts:[],approvals:{}}],handler:()=>{throw Error('offline');}});
  h.run(pull([original]));h.run(`chatOpenId='A03430'`);edit(h);await h.run('sbPush()');
  assert.equal(h.pending().A03430.status,'retry');h.run('sendChatMsg()');
  assert.equal(h.run('chats[0].messages.length'),0);assert.equal(h.alerts.length,1);
});

test('HTTP success without a matching saved row does not acknowledge a job',async()=>{
  for(const result of [null,[],{status:'saved',id:'A03430',data:job('A03430','Other')},{status:'conflict'},{status:'invalid'},{status:'forbidden'}]){
    const h=harness({handler:()=>result});h.context.__new=job();h.run('records.push(__new);saveRecordsStore()');await h.run('sbPush()');
    assert.ok(h.pending().A03430);h.run(`openChatRoom('A03430')`);assert.equal(h.run('chatOpenId'),null);
  }
});

// The sealed app currently writes this audit entry inside toggleJobTag(), before
// its asynchronous record write has been verified. These fixtures reproduce that
// legacy ordering. The durable layer must hold this business-success activity
// until fs_save_record returns the exact record it received.
const tagMutationFixture = `
  let tagAuditSeq=0;
  function logAct(cat,action,detail,job){
    activities.push({uid:'tag-audit-'+(++tagAuditSeq),ts:tagAuditSeq,cat,action,detail,job});
  }
  function toggleJobTag(jobId,tagId){
    const record=records.find(r=>r.id===jobId);
    if(!record) return null;
    record.tags=(record.tags||[]).slice();
    if(record.tags.indexOf(tagId)<0) record.tags.push(tagId);
    saveRecordsStore();
    logAct('job','ติด Tag',tagId,jobId);
    return record;
  }
`;

// This has the same causality as the sealed chat formula edit: it changes the
// record, emits a formula activity, then calls saveRecordsStore through the
// formula-save path. The bridge is the only place that can make the activity
// conditional on a durable record acknowledgement.
const formulaMutationFixture = `
  let formulaAuditSeq=0;
  function logAct(cat,action,detail,job){
    activities.push({uid:'formula-audit-'+(++formulaAuditSeq),ts:formulaAuditSeq,cat,action,detail,job});
  }
  function chatSaveFormula(record,detail){
    const idx=records.findIndex(r=>r.id===record.id);
    if(idx>=0){ records[idx]=record; saveRecordsStore(); }
  }
  function chatIngEdit(jobId,index,field,value){
    const record=records.find(r=>r.id===jobId);
    if(!record || !record.rows[index]) return null;
    const before=record.rows[index][field];
    record.rows[index][field]=Number(value);
    const detail=record.rows[index].name+' · '+field+': '+before+' → '+value;
    logAct('formula','แก้สูตรในห้องแชท',detail,record.id);
    chatSaveFormula(record,detail);
    return record;
  }
  function saveChatFormula(jobId){
    const record=records.find(r=>r.id===jobId);
    if(!record || !record.rows[0]) return null;
    const before=record.rows[0].w;
    record.rows[0].w=50;
    const detail=record.rows[0].name+' · w: '+before+' → 50';
    logAct('formula','แก้สูตรในห้องแชท (กดบันทึก)',detail,record.id);
    chatSaveFormula(record,detail);
    return record;
  }
`;

const modifyFormulaFixture = `
  let modifyRec=null, modifyIngs=[], modifyFields=[];
  let modifyAuditSeq=0;
  function logAct(cat,action,detail,job){ activities.push({uid:'modify-audit-'+(++modifyAuditSeq),ts:modifyAuditSeq,cat,action,detail,job}); }
  function renderModify(){}
  function buildModifyData(){ modifyIngs=(modifyRec.rows||[]).map(r=>({name:r.name,w:String(r.w),o:r.o||'',p:String(r.p),actual:String(r.actual||0),note:r.note||'',hero:!!r.hero,fdaIcon:'⚪',editedBy:'',editedAt:'',verifiedBy:'',verifiedAt:''})); }
  function modifyIngToRow(mi,i){ const w=parseFloat(mi.w)||0,p=parseFloat(mi.p)||0; return {num:i+1,name:mi.name||'',w,o:mi.o||'',p,actual:w*p/100,note:mi.note||'',hero:!!mi.hero,fda:{status:'unknown'}}; }
  function renderDashboard(){}
  function renderRecordsList(){}
  function openModifyRecord(id){ modifyRec=records.find(r=>r.id===id); buildModifyData(); renderModify(); }
`;

// The sealed generator logs its create/update activity before saving its
// parent record. Keep this small fixture focused on that ordering: the bridge
// must retain the activity with the pending revision until the exact save ACK.
const generatorActivityFixture = `
  let generatorAuditSeq=0;
  function logAct(cat,action,detail,job){
    activities.push({uid:'generator-audit-'+(++generatorAuditSeq),ts:generatorAuditSeq,cat,action,detail,job});
  }
  function clearCustomerForm(){ window.formWasCleared=true; }
  function generateDash(){
    const record=window._editingRecordId
      ? records.find(r=>r.id===window._editingRecordId)
      : {id:'A03717',brand:'Synthetic new job',customer:'Dummy',createdBy:currentUser,createdAt:1,rows:[]};
    if(!window._editingRecordId) records.push(record);
    record.brand=window._editingRecordId ? 'Edited synthetic job' : record.brand;
    logAct('job',window._editingRecordId ? 'แก้ไขชุดข้อมูล' : 'สร้างชุดข้อมูลใหม่','synthetic',record.id);
    saveRecordsStore();
    window._lastDash=record;
    window._editingRecordId=null;
    clearCustomerForm();
    return record;
  }
`;

// This reproduces the sealed generator's actual create order. It persists the
// record through saveRecord(), emits its Activity, and then calls
// saveRecordsStore() again before clearing the form. The old fixture above
// skipped the first save and therefore could not expose duplicate full-journal
// writes at a tight localStorage budget.
const sealedGeneratorCreateOrderFixture = `
  let generatorAuditSeq=0;
  function logAct(cat,action,detail,job){
    activities.push({uid:'sealed-generator-audit-'+(++generatorAuditSeq),ts:generatorAuditSeq,cat,action,detail,job});
  }
  function clearCustomerForm(){ window.formWasCleared=(window.formWasCleared||0)+1; }
  function hideEditingBanner(){ window.editBannerHidden=true; }
  function saveRecord(record){ records.unshift(record); saveRecordsStore(); }
  function generateDash(){
    const record={id:'A03763',brand:'Synthetic new job',customer:'Dummy',createdBy:currentUser,createdAt:1,rows:[]};
    saveRecord(record);
    logAct('job','สร้างชุดข้อมูลใหม่','synthetic',record.id);
    window._editingRecordId=null;
    hideEditingBanner();
    saveRecordsStore();
    window._lastDash=record;
    clearCustomerForm();
    return record;
  }
`;

// The Customer Data section modal saves the edited record before it records its
// audit entry.  It then stamps `lastActivityAt` and saves the same record a
// second time.  A quota error at either save must journal the *final* record
// together with that one section-edit Activity, rather than preserving the
// pre-audit revision as an unresolved fallback conflict.
const sectionEditMutationFixture = `
  let sectionAuditSeq=0;
  function logAct(cat,action,detail,job){
    const activity={uid:'section-audit-'+(++sectionAuditSeq),ts:sectionAuditSeq,cat,action,detail,job};
    activities.push(activity);
    if(job && cat==='job') noteJobMovement(job,activity.ts);
  }
  function noteJobMovement(jobId,ts){
    const record=records.find(r=>r.id===jobId);
    if(!record) return;
    record.lastActivityAt=ts;
    saveRecordsStore();
  }
  function saveJobSection(jobId,key){
    const record=records.find(r=>r.id===jobId);
    if(!record) return null;
    record.productDetail='Edited product detail';
    saveRecordsStore();
    logAct('job','แก้ไขชุดข้อมูล (รายละเอียดสินค้า)','productDetail: Synthetic → Edited product detail',record.id);
    return record;
  }
`;

const makeQuotaError=()=>{
  const error=Error('synthetic localStorage quota');
  error.name='QuotaExceededError';
  return error;
};
const exhaustOutbox=h=>{
  const set=h.context.localStorage.setItem;
  h.context.localStorage.setItem=(key,value)=>{
    if(key.startsWith('fs_job_outbox_v1:'))throw makeQuotaError();
    return set(key,value);
  };
};
const fallbackJournal=(h,owner='sales',id='A03763')=>h.fallbackEntries(owner).find(entry=>entry.id===id);
const gatewayStampedActivities=rows=>structuredClone(rows).map(row=>({...row,data:{...row.data,user:'sales',role:'sales'}}));

test('quota fallback verifies an exact IndexedDB journal before its first central record request',async()=>{
  const h=harness({beforeAsset:sealedGeneratorCreateOrderFixture});
  const protectedLegacyKey='fs_job_recovery_v1:sales:A00001:preserved';
  const protectedLegacyValue='immutable legacy recovery evidence';
  h.storage.set(protectedLegacyKey,protectedLegacyValue);
  exhaustOutbox(h);

  h.run('generateDash()');
  await h.settle();

  assert.equal(h.calls.some(call=>call.path==='rpc/fs_save_record'),false,
    'a quota path must not contact the central record API before its fallback is verified');
  const journal=fallbackJournal(h);
  assert.ok(journal,'the quota path did not persist an IndexedDB fallback journal');
  const sessionCall=h.calls.find(call=>call.path==='/sb/session');
  assert.ok(sessionCall,'fallback must use the direct same-origin session gate');
  assert.equal(h.calls.some(call=>call.path==='sb/session'),false,'fallback must never send session through the REST prefix');
  assert.equal(sessionCall.opt.credentials,'same-origin');assert.equal(sessionCall.opt.cache,'no-store');
  assert.equal(journal.owner,'sales');
  assert.equal(journal.expected,null);
  assert.deepEqual(journal.data,h.read(`records.find(record=>record.id==='A03763')`));
  assert.equal(journal.activities.length,1);
  const activity=journal.activities[0];
  assert.equal(activity.cat,'job');assert.equal(activity.action,'สร้างชุดข้อมูลใหม่');
  assert.equal(activity.detail,'synthetic');assert.equal(activity.job,'A03763');
  assert.equal(typeof activity.uid,'string','fallback journal did not retain the final Activity UID');
  assert.equal(typeof activity.ts,'number','fallback journal did not retain the final Activity timestamp');
  const put=h.timeline.findIndex(event=>event.type==='idb-put'&&event.value?.id==='A03763');
  const complete=h.timeline.findIndex((event,index)=>index>put&&event.type==='idb-transaction-complete');
  const readback=h.timeline.findIndex((event,index)=>index>complete&&/^idb-get/.test(event.type));
  assert.ok(put>=0&&complete>put&&readback>complete,
    'the fallback write did not commit and read back before it was trusted');
  assert.equal(h.storage.get(protectedLegacyKey),protectedLegacyValue,
    'fallback staging must never remove or rewrite legacy recovery data');
  assert.equal(h.storageOperations.some(operation=>operation.type==='remove'),false,
    'fallback staging deleted a legacy localStorage key');

  await h.run('sbPush()');
  await h.settle();
  const central=h.timeline.findIndex(event=>event.type==='request'&&event.path==='rpc/fs_save_record');
  assert.ok(central>readback,'the record request preceded verified durable fallback persistence');
});

test('quota fallback replays automatically after the initial legacy push races its IndexedDB staging',async()=>{
  const h=harness({
    beforeAsset:sealedGeneratorCreateOrderFixture + `
      function sbQueue(){ Promise.resolve().then(function(){ return sbPush(); }).catch(function(){}); }
    `,
    indexedDBDelay:['put'],
    handler:(path,opt)=>{
      if(path==='rpc/fs_save_record') return {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
      if(path==='fs_activities') return gatewayStampedActivities(opt.body);
      return structuredClone(opt.body||[]);
    },
  });
  exhaustOutbox(h);

  h.run('generateDash()');
  await h.settle();

  assert.equal(h.run('window.formWasCleared'),undefined,
    'the form cleared before the delayed IndexedDB journal became durable');
  assert.equal(h.alerts.length,0,
    'a durable fallback in progress warned the user before its outcome was known');
  assert.equal(h.calls.some(call=>call.path==='rpc/fs_save_record'),false,
    'the legacy timer must not send a record before the IndexedDB journal is verified');
  assert.equal(h.releaseIndexedDB('put'),1,'the fallback journal did not pause at its durable write');
  // Keep the synthetic transaction gate closed for every later durable ACK
  // update too. The browser implementation completes those writes normally;
  // this loop only models their completion one at a time.
  for(let released=1;released;released=h.releaseIndexedDB('put')) await h.settle();

  assert.equal(h.calls.filter(call=>call.path==='rpc/fs_save_record').length,1,
    'a verified fallback did not replay after the initial legacy push raced its staging');
  assert.equal(h.calls.filter(call=>call.path==='fs_activities').length,1,
    'the replay did not append the deferred Activity after the parent acknowledgement');
  assert.equal(fallbackJournal(h),undefined,'the acknowledged fallback journal was not cleared');
  assert.equal(h.run('window.formWasCleared'),1,
    'the form did not clear after the exact record and Activity acknowledgements');
  assert.equal(h.alerts.length,0,
    'a successful automatic fallback replay left a stale failure alert');
});

test('a quota during the two-save section edit journals its final record and exact activity, then auto-acknowledges',async()=>{
  const original=job('A03795','Synthetic section job');
  const h=harness({
    records:[original],
    beforeAsset:sectionEditMutationFixture + `
      function sbQueue(){ Promise.resolve().then(function(){ return sbPush(); }).catch(function(){}); }
    `,
    handler:(path,opt)=>{
      if(path==='rpc/fs_save_record') return {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
      if(path==='fs_activities') return gatewayStampedActivities(opt.body);
      return structuredClone(opt.body||[]);
    },
  });
  h.run(pull([original]));
  exhaustOutbox(h);

  h.run(`saveJobSection('A03795','product')`);
  // The fallback performs separate exact IDB readbacks after Record and
  // Activity acknowledgement. Let the automatic queue finish those turns;
  // this deliberately does not call sbPush() a second time.
  for(let turn=0;turn<4&&h.calls.filter(call=>call.path==='fs_activities').length===0;turn++) await h.settle();

  const finalRecord=h.read(`records.find(record=>record.id==='A03795')`);
  assert.equal(finalRecord.productDetail,'Edited product detail');
  assert.equal(finalRecord.lastActivityAt,1,
    'the fallback journal must include the second record save caused by the section audit');
  assert.equal(h.calls.filter(call=>call.path==='rpc/fs_save_record').length,1,
    'a verified section fallback must automatically send its final record once');
  assert.equal(h.calls.filter(call=>call.path==='fs_activities').length,1,
    'a verified section fallback must automatically send its exact audit Activity once');
  const recordCall=h.calls.find(call=>call.path==='rpc/fs_save_record');
  const activityCall=h.calls.find(call=>call.path==='fs_activities');
  assert.deepEqual(recordCall.opt.body.p_data,finalRecord,
    'the fallback replay sent the pre-audit record instead of the final second-save revision');
  assert.equal(activityCall.opt.body.length,1);
  const [activity]=activityCall.opt.body;
  assert.equal(activity.data.action,'แก้ไขชุดข้อมูล (รายละเอียดสินค้า)');
  assert.equal(activity.data.job,'A03795');
  assert.equal(typeof activity.uid,'string');
  assert.equal(typeof activity.ts,'number');
  assert.equal(h.fallbackEntries('sales','A03795').length,0,
    'an exact record and Activity acknowledgement must remove the section fallback journal');
  assert.deepEqual(h.pending(),{},
    'a completed section fallback must not leave a false unresolved save state');
  assert.equal(h.alerts.length,0,
    'a completed section fallback must not warn that the browser save is unresolved');
});

test('fallback acknowledgement never clears form values changed while its durable journal waited',async()=>{
  const h=harness({
    beforeAsset:sealedGeneratorCreateOrderFixture + `
      function sbQueue(){ Promise.resolve().then(function(){ return sbPush(); }).catch(function(){}); }
    `,
    indexedDBDelay:['put'],
    handler:(path,opt)=>{
      if(path==='rpc/fs_save_record') return {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
      if(path==='fs_activities') return gatewayStampedActivities(opt.body);
      return structuredClone(opt.body||[]);
    },
  });
  const view=h.context.document.createElement('div');view.id='inputView';
  const customer=h.context.document.createElement('input');customer.id='f_customer';customer.value='original form value';
  const error=h.context.document.createElement('span');error.id='gen_err';
  view.appendChild(customer);view.appendChild(error);h.context.document.body.appendChild(view);
  exhaustOutbox(h);

  h.run('generateDash()');await h.settle();
  customer.value='new unsaved form value';
  assert.equal(h.releaseIndexedDB('put'),1);
  for(let released=1;released;released=h.releaseIndexedDB('put')) await h.settle();

  assert.equal(h.run('window.formWasCleared'),undefined,
    'the acknowledged fallback erased form data changed while it was pending');
  assert.equal(customer.value,'new unsaved form value');
  assert.match(error.textContent,/คงไว้เป็นฉบับใหม่/);
  assert.equal(h.alerts.length,0,'preserving a changed form raised a false failure alert');
});

test('automatic fallback replay stops on an actor change before its durable journal is verified',async()=>{
  const h=harness({
    beforeAsset:sealedGeneratorCreateOrderFixture + `
      function sbQueue(){ Promise.resolve().then(function(){ return sbPush(); }).catch(function(){}); }
    `,
    indexedDBDelay:['put'],
  });
  exhaustOutbox(h);

  h.run('generateDash()');await h.settle();
  h.run(`currentUser='admin'`);
  assert.equal(h.releaseIndexedDB('put'),1);
  await h.settle();

  assert.equal(h.calls.some(call=>/^(rpc\/fs_save_record|fs_activities)$/.test(call.path)),false,
    'an actor change replayed a journal under the original user');
  assert.equal(h.fallbackEntries('sales').length,1,'the durable journal was removed after an actor change');
  assert.equal(h.run('window.formWasCleared'),undefined,'an actor change cleared the source form');
});

test('automatic fallback replay does not send or clear a competing revision discovered during staging',async()=>{
  const h=harness({
    beforeAsset:sealedGeneratorCreateOrderFixture + `
      function sbQueue(){ Promise.resolve().then(function(){ return sbPush(); }).catch(function(){}); }
    `,
    indexedDBDelay:['put'],
  });
  const set=h.context.localStorage.setItem;exhaustOutbox(h);

  h.run('generateDash()');await h.settle();
  set('fs_job_outbox_v1:sales:competing',JSON.stringify({
    version:1,owner:'sales',id:'A03763',tab:'other',data:{id:'A03763',brand:'Competing',customer:'Dummy',createdBy:'sales',createdAt:2,rows:[]},expected:null,status:'pending',activities:[],at:2,
  }));
  assert.equal(h.releaseIndexedDB('put'),1);
  for(let released=1;released;released=h.releaseIndexedDB('put')) await h.settle();

  assert.equal(h.calls.some(call=>/^(rpc\/fs_save_record|fs_activities)$/.test(call.path)),false,
    'a conflicting fallback revision was sent without review');
  assert.equal(h.fallbackEntries('sales')[0]?.status,'conflict');
  assert.equal(h.run('window.formWasCleared'),undefined,'a conflicting fallback cleared the source form');
});

test('automatic fallback replay retains its journal and form when either exact acknowledgement fails',async t=>{
  for (const failure of ['record','activity']) await t.test(failure,async()=>{
    const h=harness({
      beforeAsset:sealedGeneratorCreateOrderFixture + `
        function sbQueue(){ Promise.resolve().then(function(){ return sbPush(); }).catch(function(){}); }
      `,
      indexedDBDelay:['put'],
      handler:(path,opt)=>{
        if(path==='rpc/fs_save_record') return failure === 'record'
          ? {status:'saved',id:opt.body.p_id,data:{...opt.body.p_data,brand:'different server value'}}
          : {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
        if(path==='fs_activities') return [];
        return structuredClone(opt.body||[]);
      },
    });
    exhaustOutbox(h);

    h.run('generateDash()');await h.settle();
    assert.equal(h.releaseIndexedDB('put'),1);
    for(let released=1;released;released=h.releaseIndexedDB('put')) await h.settle();

    const journal=fallbackJournal(h);
    assert.ok(journal,'an incomplete automatic replay deleted its durable journal');
    assert.equal(h.run('window.formWasCleared'),undefined,'an incomplete automatic replay cleared the source form');
    assert.equal(h.alerts.length,0,'an incomplete automatic replay raised a false success/failure alert');
    if(failure==='record') assert.equal(journal.recordAck,false);
    else assert.equal(journal.recordAck,true);
  });
});

test('an exact fallback record and Activity acknowledgement removes only the acknowledged fallback journal',async()=>{
  const h=harness({beforeAsset:sealedGeneratorCreateOrderFixture,handler:(path,opt)=>{
    if(path==='rpc/fs_save_record')return {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
    if(path==='fs_activities')return gatewayStampedActivities(opt.body);
    return structuredClone(opt.body||[]);
  }});
  exhaustOutbox(h);h.run('generateDash()');await h.settle();
  const staged=fallbackJournal(h);assert.ok(staged,'the test precondition requires a durable fallback journal');
  const activity=staged.activities[0];

  await h.run('sbPush()');
  await h.settle();

  const recordIndex=h.calls.findIndex(call=>call.path==='rpc/fs_save_record');
  const activityIndex=h.calls.findIndex(call=>call.path==='fs_activities');
  assert.ok(recordIndex>=0,'fallback journal did not reach the record gateway');
  assert.ok(activityIndex>recordIndex,'the Activity reached the gateway before the exact parent acknowledgement');
  assert.equal(h.calls.filter(call=>call.path==='rpc/fs_save_record').length,1);
  assert.equal(h.calls.filter(call=>call.path==='fs_activities').length,1);
  assert.deepEqual(h.calls[activityIndex].opt.body,[{uid:activity.uid,ts:activity.ts,data:activity}],
    'the gateway Activity payload differed from the final UID/timestamp journaled before the record request');
  assert.equal(activity.user,undefined);assert.equal(activity.role,undefined,'the browser must not assert its own actor fields');
  assert.equal(fallbackJournal(h),undefined,
    'a gateway representation stamped with the trusted user/role must acknowledge the immutable business Activity once');
});

test('a failed fallback Activity acknowledgement retains the journal and retries only the missing Activity',async()=>{
  let activityAttempts=0;
  const h=harness({beforeAsset:sealedGeneratorCreateOrderFixture,handler:(path,opt)=>{
    if(path==='rpc/fs_save_record')return {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
    if(path==='fs_activities')return ++activityAttempts===1?[]:gatewayStampedActivities(opt.body);
    return structuredClone(opt.body||[]);
  }});
  exhaustOutbox(h);h.run('generateDash()');await h.settle();
  const staged=fallbackJournal(h);assert.ok(staged);
  const finalActivity=staged.activities[0];

  await h.run('sbPush()');
  await h.settle();
  const retained=fallbackJournal(h);
  assert.ok(retained,'a rejected Activity acknowledgement deleted the fallback journal');
  assert.deepEqual(retained.data,h.read(`records.find(record=>record.id==='A03763')`));
  assert.deepEqual(retained.activities,[finalActivity],'the unacknowledged final Activity payload was not retained');
  assert.equal(h.calls.filter(call=>call.path==='rpc/fs_save_record').length,1);
  assert.equal(h.calls.filter(call=>call.path==='fs_activities').length,1);

  await h.run('sbPush()');
  await h.settle();
  assert.equal(h.calls.filter(call=>call.path==='rpc/fs_save_record').length,1,
    'a retry after record acknowledgement resent the parent record');
  assert.equal(h.calls.filter(call=>call.path==='fs_activities').length,2,
    'a retry did not send the retained Activity');
  const activityCalls=h.calls.filter(call=>call.path==='fs_activities');
  assert.deepEqual(activityCalls[0].opt.body,[{uid:finalActivity.uid,ts:finalActivity.ts,data:finalActivity}]);
  assert.deepEqual(activityCalls[1].opt.body,activityCalls[0].opt.body,
    'the retry regenerated the Activity identity or payload');
  assert.equal(fallbackJournal(h),undefined,'fallback journal survived both eventual acknowledgements');
});

test('an IndexedDB journal is actor-scoped and cannot be replayed by a different signed-in user',async()=>{
  const h=harness({beforeAsset:sealedGeneratorCreateOrderFixture});
  exhaustOutbox(h);h.run('generateDash()');await h.settle();
  assert.ok(fallbackJournal(h,'sales'),'sales fallback journal missing');

  h.run(`currentUser='admin'`);
  await h.run('sbPush()');
  await h.settle();
  assert.equal(h.calls.filter(call=>call.path!=='/sb/session').length,0,'an account change replayed another user\'s fallback journal');
  assert.ok(fallbackJournal(h,'sales'),'account change removed the prior actor\'s fallback journal');
  assert.equal(fallbackJournal(h,'admin'),undefined);

  const reopened=harness({idb:h.idb,owner:'admin'});
  await reopened.settle();
  await reopened.run('sbPush()');
  assert.equal(reopened.calls.filter(call=>call.path!=='/sb/session').length,0,'a fresh admin session discovered a sales fallback journal');
  assert.ok(fallbackJournal(reopened,'sales'));
});

test('a trusted session name mismatch blocks fallback staging before IndexedDB or either central gateway',async()=>{
  const h=harness({beforeAsset:sealedGeneratorCreateOrderFixture,trustedSession:{name:'admin',role:'admin',centralUserId:'iam-admin',authenticated:true}});
  exhaustOutbox(h);h.run('generateDash()');await h.settle();
  assert.equal(h.idbOperations.some(operation=>operation.type==='idb-open'||operation.type==='idb-put'),false);
  assert.equal(fallbackJournal(h),undefined);
  assert.equal(h.calls.some(call=>call.path==='rpc/fs_save_record'||call.path==='fs_activities'),false);
  assert.equal(h.context.formWasCleared,undefined,'a stale browser actor cannot stage under a different HTTP session');
});

test('a session switch after Activity acknowledgement retains the exact fallback journal before deletion',async()=>{
  const h=harness({beforeAsset:sealedGeneratorCreateOrderFixture,handler:(path,opt)=>{
    if(path==='rpc/fs_save_record')return {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
    if(path==='fs_activities') {
      const stamped=gatewayStampedActivities(opt.body);
      h.setTrustedSession({name:'admin',role:'admin',centralUserId:'iam-admin',authenticated:true});
      return stamped;
    }
    return structuredClone(opt.body||[]);
  }});
  exhaustOutbox(h);h.run('generateDash()');await h.settle();await h.run('sbPush()');await h.settle();
  const retained=fallbackJournal(h);
  assert.ok(retained,'the journal was deleted after its authenticated session changed');
  assert.equal(retained.recordAck,true,'the exact parent acknowledgement must remain recoverable');
  assert.equal(retained.activities.length,1,'the Activity must remain replayable after the post-ACK session switch');
  assert.equal(h.idbOperations.some(operation=>operation.type==='idb-delete'),false);
  assert.equal(h.calls.filter(call=>call.path==='fs_activities').length,1);
});

test('IndexedDB write failure keeps the existing fail-closed quota behavior and never reaches central save',async()=>{
  const h=harness({beforeAsset:sealedGeneratorCreateOrderFixture,indexedDBFailure:{put:'QuotaExceededError'}});
  exhaustOutbox(h);h.run('generateDash()');await h.settle();
  await h.run('sbPush()');
  await h.settle();

  assert.ok(h.idbOperations.some(operation=>operation.type==='idb-put'),
    'a recognized localStorage quota did not attempt the IndexedDB fallback');
  assert.equal(fallbackJournal(h),undefined,'an unverified IndexedDB write was treated as durable');
  assert.equal(h.calls.some(call=>call.path==='rpc/fs_save_record'),false,
    'a failed IndexedDB fallback still called the central record API');
  assert.equal(h.context.formWasCleared,undefined,'the form cleared after durable fallback failed');
});

test('only a recognized localStorage quota may enter IndexedDB fallback',async()=>{
  const h=harness({beforeAsset:sealedGeneratorCreateOrderFixture});
  const set=h.context.localStorage.setItem;
  h.context.localStorage.setItem=(key,value)=>{
    if(key.startsWith('fs_job_outbox_v1:'))throw Error('synthetic browser storage denied');
    return set(key,value);
  };
  h.run('generateDash()');await h.settle();await h.run('sbPush()');await h.settle();
  assert.equal(h.idbOperations.some(operation=>operation.type==='idb-open'),false,
    'a non-quota localStorage error entered the fallback path');
  assert.equal(h.calls.some(call=>call.path==='rpc/fs_save_record'),false,
    'a non-quota localStorage error reached central save');
  assert.equal(h.context.formWasCleared,undefined,'the form cleared after a non-quota local storage failure');
});

test('a quota reported after the immutable legacy write uses that exact revision without a duplicate fallback',async()=>{
  const h=harness({beforeAsset:sealedGeneratorCreateOrderFixture});
  const set=h.context.localStorage.setItem;
  h.context.localStorage.setItem=(key,value)=>{
    if(!key.startsWith('fs_job_outbox_v1:'))return set(key,value);
    set(key,value);
    throw makeQuotaError();
  };

  h.run('generateDash()');await h.settle();
  const legacy=Array.from(h.storage).filter(([key])=>key.startsWith('fs_job_outbox_v1:sales:'));
  assert.equal(legacy.length,1,'the quota-after-write fixture did not leave its immutable legacy revision');
  const [legacyKey,legacyValue]=legacy[0];
  assert.equal(JSON.parse(legacyValue).id,'A03763');
  assert.equal(h.idbOperations.some(operation=>operation.type==='idb-open'||operation.type==='idb-put'),false,
    'a verified immutable legacy revision was duplicated into IndexedDB after quota was reported');
  assert.equal(h.storage.get(legacyKey),legacyValue,'quota-after-write rewrote its immutable legacy revision');
  assert.equal(h.storageOperations.some(operation=>operation.type==='remove'),false,
    'quota-after-write deleted its immutable legacy revision before acknowledgement');
  assert.equal(h.context.formWasCleared,1,
    'a persisted legacy revision was not allowed to follow the normal durable form lifecycle');

  await h.run('sbPush()');await h.settle();
  assert.equal(h.calls.filter(call=>call.path==='rpc/fs_save_record').length,1,
    'a verified legacy revision did not follow the normal central-save path');
});

test('a competing tab revision arriving while fallback persistence is paused remains a review state with neither revision removed',async()=>{
  const storage=new Map(),idb=new Map();
  const a=harness({storage,idb,beforeAsset:sealedGeneratorCreateOrderFixture,indexedDBDelay:['put']});
  const b=harness({storage,idb,beforeAsset:sealedGeneratorCreateOrderFixture.replace('Synthetic new job','Competing synthetic job')});
  exhaustOutbox(a);a.run('generateDash()');await a.settle();
  assert.ok(a.idbOperations.some(operation=>operation.type==='idb-open'),
    'the first tab did not begin its asynchronous fallback stage');

  b.run('generateDash()');await b.settle();
  const competing=b.pending().A03763;
  assert.equal(competing?.data.brand,'Competing synthetic job','the second tab did not retain its immutable competing revision');
  assert.equal(a.releaseIndexedDB('put'),1,'the first tab did not pause an IndexedDB write for the race fixture');
  await a.settle();await a.run('sbPush()');await a.settle();

  assert.equal(a.calls.some(call=>call.path==='rpc/fs_save_record'),false,
    'a fallback race automatically sent one competing revision to the central API');
  assert.equal(b.pending().A03763?.data.brand,'Competing synthetic job',
    'the first tab overwrote or removed the competing legacy revision');
  assert.equal(fallbackJournal(a)?.data.brand,'Synthetic new job',
    'the first tab did not retain its own fallback revision for review');
  assert.equal(a.idbOperations.some(operation=>operation.type==='idb-delete'),false,
    'a fallback race deleted an IndexedDB revision instead of preserving the review state');
  assert.equal(a.context.formWasCleared,undefined,
    'the first tab cleared its form while the fallback revision had an unresolved competitor');
});

test('a same-actor session index restores a staged cross-tab conflict for review without automatic replay',async()=>{
  const storage=new Map(),idb=new Map();
  const first=harness({storage,idb,beforeAsset:sealedGeneratorCreateOrderFixture,indexedDBDelay:['put']});
  const competitor=harness({storage,idb,beforeAsset:sealedGeneratorCreateOrderFixture.replace('Synthetic new job','Competing synthetic job')});
  exhaustOutbox(first);first.run('generateDash()');await first.settle();
  competitor.run('generateDash()');await competitor.settle();
  assert.equal(first.releaseIndexedDB('put'),1);await first.settle();
  assert.equal(first.releaseIndexedDB('put'),1,'the conflict state must durably update after the initial staging write');await first.settle();
  const staged=fallbackJournal(first);assert.equal(staged?.status,'conflict','the conflict entry must be durably marked for review');
  const reopened=harness({idb,session:first.session,owner:'sales'});
  await reopened.run('sbPush()');await reopened.settle();
  assert.equal(reopened.read('records.find(record=>record.id===\'A03763\')')?.brand,'Synthetic new job');
  assert.equal(reopened.calls.some(call=>call.path==='rpc/fs_save_record'||call.path==='fs_activities'),false,
    'a restored conflict must remain review-only until an explicit resolution');
  assert.equal(reopened.fallbackEntries('sales').find(entry=>entry.id==='A03763')?.status,'conflict');
});

test('a malformed or mismatched IndexedDB readback cannot verify fallback or reach either central gateway',async t=>{
  for(const [name,override] of [
    ['missing readback',({type,value})=>/^get/.test(type)?undefined:value],
    ['different record readback',({type,value})=>{
      if(type==='get')return value&&{...value,data:{...value.data,brand:'tampered durable value'}};
      if(type==='getAll')return (value||[]).map(entry=>({...entry,data:{...entry.data,brand:'tampered durable value'}}));
      return value;
    }],
  ])await t.test(name,async()=>{
    const h=harness({beforeAsset:sealedGeneratorCreateOrderFixture,indexedDBReadOverride:override});
    exhaustOutbox(h);h.run('generateDash()');await h.settle();await h.run('sbPush()');await h.settle();
    assert.ok(h.idbOperations.some(operation=>operation.type==='idb-put'),
      'the malformed-readback fixture did not first persist a candidate fallback journal');
    assert.ok(h.idbOperations.some(operation=>/^idb-get/.test(operation.type)),
      'the fallback candidate was never read back for verification');
    assert.equal(h.calls.some(call=>call.path==='rpc/fs_save_record'||call.path==='fs_activities'),false,
      'a malformed or mismatched readback reached a central gateway');
    assert.equal(h.context.formWasCleared,undefined,
      'the form cleared even though the fallback readback was not exact');
    assert.equal(h.idbOperations.some(operation=>operation.type==='idb-delete'),false,
      'an unverified fallback journal was deleted');
  });
});

test('a corrupt fallback locator does not block a later valid same-actor journal',async()=>{
  const idb=new Map(), session=new Map();
  const staged=harness({idb,session,beforeAsset:sealedGeneratorCreateOrderFixture});
  exhaustOutbox(staged); staged.run('generateDash()'); await staged.settle();
  const validKey=staged.idbOperations.find(operation=>operation.type==='idb-put'&&operation.value?.id==='A03763')?.key;
  assert.ok(validKey,'the valid fallback journal was not staged');
  session.set('fs_job_fallback_index_v1:sales',JSON.stringify([
    {id:'A03762',key:'corrupt-locator',identity:staged.fallbackEntries('sales')[0].identity},
    {id:'A03763',key:validKey,identity:staged.fallbackEntries('sales')[0].identity},
  ]));
  const reopened=harness({idb,session,beforeAsset:sealedGeneratorCreateOrderFixture,indexedDBReadOverride:({type,key,value})=>{
    if(type==='get'&&key==='corrupt-locator') throw Error('synthetic corrupt locator');
    return value;
  }});
  await reopened.run('sbPush()'); await reopened.settle();
  assert.equal(reopened.read("records.some(record=>record.id==='A03763')"),true,
    'a corrupt locator prevented the later valid fallback from being restored');
  assert.equal(JSON.parse(session.get('fs_job_fallback_index_v1:sales')).some(item=>item.key==='corrupt-locator'),true,
    'the corrupt locator remains preserved for operator diagnosis');
  assert.equal(reopened.idbOperations.some(operation=>['idb-put','idb-delete'].includes(operation.type) && operation.key==='corrupt-locator'),false,
    'the corrupt locator is never rewritten or deleted as if it were verified');
});

test('trusted session identity prevents a foreign browser session from enumerating, restoring, exporting, or deleting another actor fallback',async()=>{
  const idb=new Map(),salesSession={name:'sales',role:'sales',centralUserId:'iam-sales',authenticated:true};
  const a=harness({idb,beforeAsset:sealedGeneratorCreateOrderFixture,trustedSession:salesSession});
  exhaustOutbox(a);a.run('generateDash()');await a.settle();
  const own=fallbackJournal(a,'sales');assert.ok(own,'sales trusted session did not stage its fallback journal');
  const ownKey=a.idbOperations.find(operation=>operation.type==='idb-put'&&operation.value?.id==='A03763')?.key;
  assert.ok(ownKey!==undefined,'sales fallback journal has no immutable IndexedDB identity');

  const admin=harness({idb,owner:'admin',trustedSession:{name:'admin',role:'admin',centralUserId:'iam-admin',authenticated:true}});
  await admin.settle();await admin.run('sbPush()');await admin.settle();
  assert.equal(admin.calls.some(call=>call.path==='/sb/session'),false,
    'a session without its own opaque fallback index must not probe another actor journal');
  assert.equal(admin.idbOperations.some(operation=>operation.type==='idb-getAll'),false,
    'a foreign session enumerated fallback journals through IndexedDB');
  assert.equal(admin.idbOperations.some(operation=>operation.type==='idb-get'&&operation.key===ownKey),false,
    'a foreign session read the sales fallback journal by its immutable key');
  assert.equal(admin.idbOperations.some(operation=>operation.type==='idb-delete'),false,
    'a foreign session deleted another actor fallback journal');
  assert.equal(admin.read('records.length'),0,'a foreign fallback journal was restored into the current record list');
  assert.equal(admin.calls.some(call=>call.path==='rpc/fs_save_record'||call.path==='fs_activities'),false,
    'a foreign session replayed another actor fallback journal');
  assert.equal(fallbackJournal(admin,'sales')?.id,'A03763','foreign-session checks changed the sales fallback evidence');

  await a.run('sbPush()');await a.settle();
  assert.equal(a.calls.filter(call=>call.path==='rpc/fs_save_record').length,1,
    'the original trusted session could not resume its own fallback journal');
});

test('sealed create order needs one journal write and includes the deferred Activity before it clears the form',()=>{
  const h=harness({beforeAsset:sealedGeneratorCreateOrderFixture});
  const set=h.context.localStorage.setItem;
  let journalWrites=0;
  h.context.localStorage.setItem=(key,value)=>{
    if(key.startsWith('fs_job_outbox_v1:') && ++journalWrites>1) throw Error('synthetic one-journal storage budget');
    return set(key,value);
  };

  h.run('generateDash()');

  assert.equal(journalWrites,1,'a create must fit a storage budget that accepts its one durable journal');
  assert.equal(h.context.formWasCleared,1,'the form must clear only after that journal is durable');
  assert.equal(h.alerts.length,0,'a successful single journal must not show a recovery warning');
  const pending=h.pending().A03763;
  assert.ok(pending,'the parent record was not journaled');
  assert.equal(pending.activities.length,1,'the create Activity was not stored with the parent journal');
  assert.deepEqual(pending.activities[0],{cat:'job',action:'สร้างชุดข้อมูลใหม่',detail:'synthetic',job:'A03763'});
});

test('sealed create order releases its Activity only after an exact parent acknowledgement',async()=>{
  let exact=false;
  const h=harness({beforeAsset:sealedGeneratorCreateOrderFixture,handler:(path,opt)=>{
    if(path!=='rpc/fs_save_record') return structuredClone(opt.body||[]);
    return exact
      ? {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)}
      : {status:'saved',id:opt.body.p_id,data:{...opt.body.p_data,brand:'different server value'}};
  }});

  h.run('generateDash()');
  await h.run('sbPush()');
  assert.equal(h.pending().A03763.status,'unconfirmed');
  assert.equal(h.calls.some(call=>call.path==='fs_activities'),false,
    'a mismatched parent acknowledgement still sent the create Activity');

  exact=true;
  await h.run('sbPush()');
  const parentSave=h.calls.map((call,index)=>[call,index]).filter(([call])=>call.path==='rpc/fs_save_record');
  const activitySave=h.calls.findIndex(call=>call.path==='fs_activities');
  assert.equal(parentSave.length,2);
  assert.ok(activitySave>parentSave[1][1],'the create Activity was sent before the later exact parent acknowledgement');
  assert.equal(h.run(`activities.filter(a=>a.job==='A03763'&&a.action==='สร้างชุดข้อมูลใหม่').length`),1);
  assert.deepEqual(h.pending(),{});
});

test('a quota-limited generator journal explains the local recovery state without claiming central success',async()=>{
  const h=harness({beforeAsset:sealedGeneratorCreateOrderFixture});
  const create={disabled:false,attrs:{},setAttribute(name,value){this.attrs[name]=value;}};
  const error={textContent:'',attrs:{},setAttribute(name,value){this.attrs[name]=value;}};
  h.nodes.btnCreate=create; h.nodes.gen_err=error;
  h.context.localStorage.setItem=(key,value)=>{
    if(key.startsWith('fs_job_outbox_v1:')) {
      const error=Error('QuotaExceededError'); error.name='QuotaExceededError'; throw error;
    }
  };

  h.run('generateDash()');await h.settle();

  assert.equal(h.context.formWasCleared,undefined,'the source form must remain available when its journal cannot be written');
  assert.equal(h.calls.some(call=>call.path==='rpc/fs_save_record'),false,'a local journal failure must not claim or attempt a central save');
  assert.match(h.nodes.fsJobSyncStatus.textContent,/ใบงานรอการบันทึก/);
  assert.doesNotMatch(h.nodes.fsJobSyncStatus.textContent,/บันทึกใบงานในเครื่องไม่สำเร็จ/,'a verified fallback must not be presented as failed storage');
  assert.equal(h.alerts.length,0,'a durable recovery in progress must not raise a false failure alert');
  assert.equal(create.disabled,true); assert.equal(create.attrs['aria-disabled'],'true');
  assert.equal(error.attrs.role,undefined);
});

test('new job activity waits for its exact parent acknowledgement',async()=>{
  const h=harness({beforeAsset:generatorActivityFixture,handler:(path,opt)=>{
    if(path==='rpc/fs_save_record') return {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
    return structuredClone(opt.body||[]);
  }});
  h.run('generateDash()');

  assert.ok(h.pending().A03717,'new job was not placed in the durable outbox');
  assert.equal(h.run(`activities.filter(a=>a.job==='A03717'&&a.action==='สร้างชุดข้อมูลใหม่').length`),0,
    'a local create displayed success before its parent record acknowledgement');

  await h.run('sbPush()');
  const recordSave=h.calls.findIndex(call=>call.path==='rpc/fs_save_record');
  const activitySave=h.calls.findIndex(call=>call.path==='fs_activities');
  assert.ok(recordSave>=0,'new job did not use fs_save_record');
  assert.ok(activitySave>recordSave,'new job activity was sent before its parent acknowledgement');
  assert.equal(h.run(`activities.filter(a=>a.job==='A03717'&&a.action==='สร้างชุดข้อมูลใหม่').length`),1);
  assert.deepEqual(h.pending(),{});
});

test('mismatched new job acknowledgement never records create success activity',async()=>{
  const h=harness({beforeAsset:generatorActivityFixture,handler:(path,opt)=>{
    if(path==='rpc/fs_save_record') return {status:'saved',id:opt.body.p_id,data:{...opt.body.p_data,brand:'different server value'}};
    return structuredClone(opt.body||[]);
  }});
  h.run('generateDash()');
  await h.run('sbPush()');

  assert.equal(h.pending().A03717.status,'unconfirmed');
  assert.equal(h.run(`activities.filter(a=>a.job==='A03717'&&a.action==='สร้างชุดข้อมูลใหม่').length`),0,
    'a mismatched parent acknowledgement still produced create success');
  assert.equal(h.calls.some(call=>call.path==='fs_activities'),false,
    'a mismatched parent acknowledgement still sent the create activity');
});

test('mismatched new job acknowledgement releases one create activity after a later exact retry',async()=>{
  let exact=false;
  const h=harness({beforeAsset:generatorActivityFixture,handler:(path,opt)=>{
    if(path!=='rpc/fs_save_record') return structuredClone(opt.body||[]);
    return exact
      ? {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)}
      : {status:'saved',id:opt.body.p_id,data:{...opt.body.p_data,brand:'different server value'}};
  }});
  h.run('generateDash()');
  await h.run('sbPush()');
  assert.equal(h.pending().A03717.status,'unconfirmed');
  assert.equal(h.calls.some(call=>call.path==='fs_activities'),false);

  exact=true;
  await h.run('sbPush()');
  const saves=h.calls.map((call,index)=>[call,index]).filter(([call])=>call.path==='rpc/fs_save_record');
  const activitySave=h.calls.findIndex(call=>call.path==='fs_activities');
  assert.equal(saves.length,2);
  assert.ok(activitySave>saves[1][1],'create activity was not deferred until the retry had an exact acknowledgement');
  assert.equal(h.run(`activities.filter(a=>a.job==='A03717'&&a.action==='สร้างชุดข้อมูลใหม่').length`),1);
  assert.deepEqual(h.pending(),{});
});

test('a failed generator journal write keeps the form available for recovery',()=>{
  const h=harness({beforeAsset:generatorActivityFixture});
  const set=h.context.localStorage.setItem;
  let outboxWrites=0;
  h.context.localStorage.setItem=(key,value)=>{
    if(key.startsWith('fs_job_outbox_v1:') && ++outboxWrites >= 1) throw Error('synthetic outbox quota');
    set(key,value);
  };

  h.run('generateDash()');

  assert.equal(h.context.formWasCleared,undefined,
    'the generator cleared the form after the deferred activity could not be stored');
  assert.ok(h.alerts.some(message=>/บันทึกใบงาน.*ในเครื่องไม่สำเร็จ/.test(message)),
    'the user was not warned that the local draft needs recovery');
});

test('job edit activity waits for its exact parent acknowledgement',async()=>{
  const original=job('A03717','Original synthetic job');
  const h=harness({records:[original],beforeAsset:generatorActivityFixture,handler:(path,opt)=>{
    if(path==='rpc/fs_save_record') return {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
    return structuredClone(opt.body||[]);
  }});
  h.run(pull([original]));
  h.run(`window._editingRecordId='A03717';generateDash()`);

  assert.equal(h.pending().A03717.expected.brand,'Original synthetic job');
  assert.equal(h.run(`activities.filter(a=>a.job==='A03717'&&a.action==='แก้ไขชุดข้อมูล').length`),0,
    'a local edit displayed success before its parent record acknowledgement');

  await h.run('sbPush()');
  const recordSave=h.calls.findIndex(call=>call.path==='rpc/fs_save_record');
  const activitySave=h.calls.findIndex(call=>call.path==='fs_activities');
  assert.ok(activitySave>recordSave,'edit activity was sent before its parent acknowledgement');
  assert.equal(h.run(`activities.filter(a=>a.job==='A03717'&&a.action==='แก้ไขชุดข้อมูล').length`),1);
  assert.deepEqual(h.pending(),{});
});

test('mismatched job edit acknowledgement stays silent until a later exact acknowledgement',async()=>{
  const original=job('A03717','Original synthetic job');
  let exact=false;
  const h=harness({records:[original],beforeAsset:generatorActivityFixture,handler:(path,opt)=>{
    if(path!=='rpc/fs_save_record') return structuredClone(opt.body||[]);
    return exact
      ? {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)}
      : {status:'saved',id:opt.body.p_id,data:original};
  }});
  h.run(pull([original]));
  h.run(`window._editingRecordId='A03717';generateDash()`);
  await h.run('sbPush()');

  assert.equal(h.pending().A03717.status,'unconfirmed');
  assert.equal(h.run(`activities.filter(a=>a.job==='A03717'&&a.action==='แก้ไขชุดข้อมูล').length`),0);
  assert.equal(h.calls.some(call=>call.path==='fs_activities'),false,
    'a mismatched edit acknowledgement still sent a success activity');

  exact=true;
  await h.run('sbPush()');
  const saves=h.calls.map((call,index)=>[call,index]).filter(([call])=>call.path==='rpc/fs_save_record');
  const activitySave=h.calls.findIndex(call=>call.path==='fs_activities');
  assert.equal(saves.length,2);
  assert.ok(activitySave>saves[1][1],'edit activity was not deferred until the retry had an exact acknowledgement');
  assert.equal(h.run(`activities.filter(a=>a.job==='A03717'&&a.action==='แก้ไขชุดข้อมูล').length`),1);
  assert.deepEqual(h.pending(),{});
});

test('sealed release exposes the section, Tag and formula mutation anchors that the bridge defers',()=>{
  for(const name of ['logAct','generateDash','saveJobSection','toggleJobTag','chatSaveFormula','saveChatFormula','chatIngEdit','chatIngAdd','chatIngDel']) {
    assert.match(sealedHtml,new RegExp(`function\\s+${name}\\s*\\(`),`sealed application anchor ${name}`);
  }
  const tagStart=sealedHtml.indexOf('function toggleJobTag(');
  const tagEnd=sealedHtml.indexOf('\n}',tagStart)+2;
  const tag=sealedHtml.slice(tagStart,tagEnd);
  assert.match(tag,/saveRecordsStore\(\);[\s\S]*logAct\('job',\s*i>=0 \? 'ถอด Tag' : 'ติด Tag'/,
    'Tag action must remain recognizable so its activity can be deferred');
  const sectionStart=sealedHtml.indexOf('function saveJobSection(');
  const sectionEnd=sealedHtml.indexOf('\n}',sectionStart)+2;
  const section=sealedHtml.slice(sectionStart,sectionEnd);
  assert.match(section,/records\[idx\] = r; saveRecordsStore\(\);/,
    'section edit must retain its first record save for the shared transaction wrapper');
  assert.match(section,/logAct\('job','แก้ไขชุดข้อมูล \('\+s\.title\+'\)', changes\.join\(' \| '\), r\.id\);/,
    'section edit must retain its labelled Activity so the bridge can defer it with the record');
  const generatorStart=sealedHtml.indexOf('function generateDash(');
  const generatorEnd=sealedHtml.indexOf('// ========== RENDER DASHBOARD',generatorStart);
  const generator=sealedHtml.slice(generatorStart,generatorEnd);
  assert.match(generator,/logAct\('job',\s*editing \? 'แก้ไขชุดข้อมูล' : 'สร้างชุดข้อมูลใหม่',[\s\S]*?, d\.id\);[\s\S]*?saveRecordsStore\(\);/,
    'generator create/edit activity must remain recognizable and precede record persistence');
  const formulaStart=sealedHtml.indexOf('function chatIngEdit(');
  const formulaEnd=sealedHtml.indexOf('// ปุ่ม "บันทึกสูตร"',formulaStart);
  const formula=sealedHtml.slice(formulaStart,formulaEnd);
  assert.match(formula,/logAct\('formula','แก้สูตรในห้องแชท'/,
    'formula edit activity must be recognized by the bridge');
  assert.match(formula,/chatSaveFormula\(r, ch\.msg, true\)/,
    'formula edit must still route through the record save path');
  const submitStart=sealedHtml.indexOf('function saveChatFormula(');
  const submitEnd=sealedHtml.indexOf('function chatIngAdd(',submitStart);
  const submit=sealedHtml.slice(submitStart,submitEnd);
  assert.match(submit,/logAct\('formula','แก้สูตรในห้องแชท \(กดบันทึก\)'/,
    'formula submit activity must be recognized by the bridge');
});

test('tag mutation waits for an exact record acknowledgement before recording success activity',async()=>{
  const original=job();
  const h=harness({records:[original],beforeAsset:tagMutationFixture,handler:(path,opt)=>{
    if(path==='rpc/fs_save_record') return {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
    return structuredClone(opt.body||[]);
  }});
  h.run(pull([original]));
  h.run(`toggleJobTag('A03430','customer-priority')`);
  assert.deepEqual(h.read(`records[0].tags`),['customer-priority']);
  assert.equal(h.run(`activities.filter(a=>a.job==='A03430'&&a.action==='ติด Tag').length`),0,
    'a local click must not create a successful Tag activity before the record ACK');
  assert.ok(h.pending().A03430,'tag mutation was not queued for durable save');

  await h.run('sbPush()');
  const rpcIndex=h.calls.findIndex(call=>call.path==='rpc/fs_save_record');
  const activityIndex=h.calls.findIndex(call=>call.path==='fs_activities');
  assert.ok(rpcIndex>=0,'tag mutation did not use fs_save_record');
  assert.ok(activityIndex>rpcIndex,'Tag success activity was sent before record acknowledgement');
  assert.equal(h.run(`activities.filter(a=>a.job==='A03430'&&a.action==='ติด Tag').length`),1);
  assert.deepEqual(h.pending(),{});
});

test('mismatched Tag save stays pending and never records a success activity',async()=>{
  const original=job();
  const h=harness({records:[original],beforeAsset:tagMutationFixture,handler:(path,opt)=>{
    if(path==='rpc/fs_save_record') return {status:'saved',id:opt.body.p_id,data:original};
    return structuredClone(opt.body||[]);
  }});
  h.run(pull([original]));
  h.run(`toggleJobTag('A03430','customer-priority')`);
  await h.run('sbPush()');

  assert.equal(h.pending().A03430.status,'unconfirmed');
  assert.deepEqual(h.pending().A03430.data.tags,['customer-priority']);
  assert.equal(h.run(`activities.filter(a=>a.job==='A03430'&&a.action==='ติด Tag').length`),0,
    'a mismatched server record was displayed as a successful Tag action');
  assert.equal(h.calls.some(call=>call.path==='fs_activities'),false,
    'a mismatched server record still wrote a success audit event');
});

test('unavailable or not-ready job sync blocks a Tag mutation before local record or activity changes',()=>{
  for(const unavailable of ['window.__fsJobSync.ready=false','delete window.__fsJobSync']){
    const original=job();
    const h=harness({records:[original],beforeAsset:tagMutationFixture});
    h.run(pull([original]));
    h.run(`${unavailable};toggleJobTag('A03430','customer-priority')`);

    assert.equal(h.run(`records[0].tags`),undefined,unavailable+' mutated the local record');
    assert.equal(h.run(`activities.length`),0,unavailable+' wrote a success activity');
    assert.deepEqual(h.pending(),{},unavailable+' queued an unapproved mutation');
    assert.equal(h.calls.length,0,unavailable+' contacted the server');
  }
});

test('formula draft stays local until explicit Save, then records success activity after exact acknowledgement',async()=>{
  const original={...job('A03486'),rows:[{name:'D-Ribose',w:100}]};
  const h=harness({records:[original],beforeAsset:formulaMutationFixture,handler:(path,opt)=>{
    if(path==='rpc/fs_save_record') return {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
    return structuredClone(opt.body||[]);
  }});
  h.run(pull([original]));
  h.run(`chatIngEdit('A03486',0,'w','50')`);
  assert.equal(h.run(`records[0].rows[0].w`),100,'blur/change must not mutate the authoritative record');
  assert.equal(h.pending().A03486,undefined,'formula edit must not be queued before explicit Save');
  h.run(`saveChatFormula('A03486')`);
  assert.equal(h.run(`records[0].rows[0].w`),50);
  assert.ok(h.pending().A03486,'explicit formula Save was not queued for durable save');
  assert.equal(h.run(`activities.filter(a=>a.job==='A03486'&&a.action==='แก้สูตรในห้องแชท').length`),0,
    'formula success activity was created before the record ACK');

  await h.run('sbPush()');
  const rpcIndex=h.calls.findIndex(call=>call.path==='rpc/fs_save_record');
  const activityIndex=h.calls.findIndex(call=>call.path==='fs_activities');
  assert.ok(rpcIndex>=0,'formula edit did not use fs_save_record');
  assert.ok(activityIndex>rpcIndex,'formula success activity was sent before the record acknowledgement');
  assert.equal(h.run(`activities.filter(a=>a.job==='A03486'&&a.action==='แก้สูตรในห้องแชท (กดบันทึก)').length`),1);
  assert.deepEqual(h.pending(),{});
});

test('PD Modify formula edits also stay local until its explicit Save',async()=>{
  const original={...job('A03487'),rows:[{name:'D-Ribose',w:100,o:'base',p:100,actual:100,note:''}]};
  const h=harness({records:[original],beforeAsset:modifyFormulaFixture,handler:(path,opt)=>{
    if(path==='rpc/fs_save_record') return {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
    return structuredClone(opt.body||[]);
  }});
  h.run(pull([original])); h.run(`openModifyRecord('A03487');editIng(0,'w','50')`);
  assert.equal(h.run(`records[0].rows[0].w`),100,'PD Modify blur must not mutate the authoritative record');
  assert.equal(h.pending().A03487,undefined,'PD Modify blur must not queue a record');
  h.run(`saveModifyFormula()`);
  assert.equal(h.run(`records[0].rows[0].w`),50,'PD Modify explicit Save commits the draft');
  assert.ok(h.pending().A03487,'PD Modify explicit Save must queue the record');
  await h.run('sbPush()');
  assert.equal(h.calls.filter(call=>call.path==='rpc/fs_save_record').length,1);
  assert.equal(h.run(`activities.filter(a=>a.job==='A03487'&&a.action==='แก้สูตร (PD Modify Data)').length`),1, JSON.stringify(h.read('activities')));
  assert.deepEqual(h.pending(),{});
});

test('PD Modify draft is actor-scoped and Save reports pending until the exact ACK',async()=>{
  const original={...job('A03487'),rows:[{name:'D-Ribose',w:100,o:'base',p:100,actual:100,note:''}]};
  const h=harness({records:[original],beforeAsset:modifyFormulaFixture,handler:(path,opt)=>{
    if(path==='rpc/fs_save_record') return {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
    return structuredClone(opt.body||[]);
  }});
  const marker=h.context.document.createElement('span'); marker.id='fxStateMod'; h.context.document.body.appendChild(marker);
  h.run(pull([original])); h.run(`var fxDirtyOn=true;openModifyRecord('A03487');editIng(0,'w','50');saveModifyFormula()`);
  assert.equal(marker.textContent,'กำลังบันทึก…','Save must remain pending until the record is acknowledged');
  assert.equal(h.read(`records.find(r=>r.id==='A03487').rows[0].w`),50);
  await h.run('sbPush()');
  assert.equal(marker.textContent,'บันทึกแล้ว','the formula status must change only after the exact record ACK');
  h.run(`var fxDirtyOn=true;window.__fsUpdateFormulaSaveStatuses()`);
  assert.equal(marker.textContent,'แก้ไขแล้ว — กด “บันทึกสูตร” เพื่อยืนยัน','focused typing must remain dirty before its change/blur event');
  h.run(`fxDirtyOn=false`);
  h.run(`openModifyRecord('A03487');editIng(0,'w','60');window.__fsUpdateFormulaSaveStatuses()`);
  assert.equal(marker.textContent,'แก้ไขแล้ว — กด “บันทึกสูตร” เพื่อยืนยัน','a new unsaved draft must override the prior saved receipt');
});

test('PD Modify actor switch before Save cannot commit the prior actor draft',()=>{
  const original={...job('A03487'),rows:[{name:'D-Ribose',w:100,o:'base',p:100,actual:100,note:''}]};
  const h=harness({records:[original],beforeAsset:modifyFormulaFixture});
  h.run(pull([original])); h.run(`openModifyRecord('A03487');editIng(0,'w','50');currentUser='other';saveModifyFormula()`);
  assert.equal(h.read(`records.find(r=>r.id==='A03487').rows[0].w`),100,'an unsaved draft must be discarded on actor switch');
  assert.deepEqual(h.pending(),{});
  assert.equal(h.read('activities.length'),0);
});

test('mismatched or retrying formula save never records success activity before a later exact acknowledgement',async t=>{
  for(const [name,result,status] of [
    ['mismatched acknowledgement',original=>({status:'saved',id:'A03486',data:original}),'unconfirmed'],
    ['retryable transport failure',()=>{throw Error('synthetic network');},'retry'],
  ]) await t.test(name,async()=>{
    const original={...job('A03486'),rows:[{name:'D-Ribose',w:100}]};
    let exact=false;
    const h=harness({records:[original],beforeAsset:formulaMutationFixture,handler:(path,opt)=>{
      if(path!=='rpc/fs_save_record') return structuredClone(opt.body||[]);
      if(exact) return {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
      return result(original);
    }});
    h.run(pull([original]));
    h.run(`chatIngEdit('A03486',0,'w','50');saveChatFormula('A03486')`);
    await h.run('sbPush()');
    assert.equal(h.pending().A03486.status,status);
    assert.equal(h.run(`activities.filter(a=>a.job==='A03486'&&a.action==='แก้สูตรในห้องแชท (กดบันทึก)').length`),0,
      name+' still produced a formula success activity');
    assert.equal(h.calls.some(call=>call.path==='fs_activities'),false,
      name+' still sent a formula success audit event');

    exact=true;
    await h.run('sbPush()');
    const rpcCalls=h.calls.filter(call=>call.path==='rpc/fs_save_record');
    const activityIndex=h.calls.findIndex(call=>call.path==='fs_activities');
    assert.equal(rpcCalls.length,2,'the pending formula edit was not retried');
    assert.ok(activityIndex>h.calls.lastIndexOf(rpcCalls.at(-1)),'formula activity was not deferred until the exact retry ACK');
    assert.equal(h.run(`activities.filter(a=>a.job==='A03486'&&a.action==='แก้สูตรในห้องแชท (กดบันทึก)').length`),1);
    assert.deepEqual(h.pending(),{});
  });
});

test('direct formula submit activity waits for exact acknowledgement and stays silent on a mismatch',async t=>{
  const original={...job('A03486'),rows:[{name:'D-Ribose',w:100}]};
  await t.test('exact acknowledgement releases the direct-submit activity',async()=>{
    const h=harness({records:[original],beforeAsset:formulaMutationFixture,handler:(path,opt)=>{
      if(path==='rpc/fs_save_record') return {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
      return structuredClone(opt.body||[]);
    }});
    h.run(pull([original]));
    h.run(`chatIngEdit('A03486',0,'w','50');saveChatFormula('A03486')`);
    assert.equal(h.run(`records[0].rows[0].w`),50);
    assert.ok(h.pending().A03486,'direct formula submit was not queued');
    assert.equal(h.run(`activities.filter(a=>a.job==='A03486'&&a.action==='แก้สูตรในห้องแชท (กดบันทึก)').length`),0,
      'direct formula submit activity was recorded before ACK');

    await h.run('sbPush()');
    const rpcIndex=h.calls.findIndex(call=>call.path==='rpc/fs_save_record');
    const activityIndex=h.calls.findIndex(call=>call.path==='fs_activities');
    assert.ok(activityIndex>rpcIndex,'direct formula submit activity was sent before the record ACK');
    assert.equal(h.run(`activities.filter(a=>a.job==='A03486'&&a.action==='แก้สูตรในห้องแชท (กดบันทึก)').length`),1);
  });
  await t.test('mismatched acknowledgement retains the direct submit without activity',async()=>{
    const h=harness({records:[original],beforeAsset:formulaMutationFixture,handler:(path,opt)=>{
      if(path==='rpc/fs_save_record') return {status:'saved',id:opt.body.p_id,data:structuredClone(original)};
      return structuredClone(opt.body||[]);
    }});
    h.run(pull([original]));
    h.run(`chatIngEdit('A03486',0,'w','50');saveChatFormula('A03486')`);
    await h.run('sbPush()');
    assert.equal(h.pending().A03486.status,'unconfirmed');
    assert.equal(h.run(`activities.filter(a=>a.job==='A03486'&&a.action==='แก้สูตรในห้องแชท (กดบันทึก)').length`),0,
      'mismatched direct submit produced a success activity');
    assert.equal(h.calls.some(call=>call.path==='fs_activities'),false,
      'mismatched direct submit sent a success audit event');
  });
});

test('an edit made while request is in flight stays queued against the acknowledged prior value',async()=>{
  let resolve;const result=new Promise(r=>{resolve=r;});const h=harness({handler:()=>result});
  h.context.__new=job();h.run('records.push(__new);saveRecordsStore()');const flight=h.run('sbPush()');
  edit(h);resolve({status:'saved',id:'A03430',data:job()});await flight;
  assert.equal(h.pending().A03430.data.brand,'Edited');assert.equal(h.pending().A03430.expected.brand,'Synthetic');
  h.run(`createChat('A03430')`);assert.equal(h.run('chats.length'),0);
});

test('account switch never sends another owner queue or uses its in-flight acknowledgement',async()=>{
  let resolve;const flightResult=new Promise(r=>{resolve=r;});const h=harness({handler:()=>flightResult});
  h.context.__new=job();h.run('records.push(__new);saveRecordsStore()');const flight=h.run('sbPush()');
  h.run(`currentUser='admin';createChat('A03430')`);resolve({status:'saved',id:'A03430',data:job()});await flight;
  assert.ok(Array.from(h.storage).some(([key,value])=>key.startsWith('fs_job_outbox_v1:sales:')&&JSON.parse(value).id==='A03430'));
  assert.equal(h.run('chats.length'),0);await h.run('sbPush()');assert.equal(h.calls.length,1);
});

test('local-storage quota failure halts sync and keeps an unsaved chat locked',async()=>{
  const h=harness();h.context.localStorage.setItem=()=>{throw Error('quota');};
  h.context.__new=job();h.run('records.push(__new);saveRecordsStore()');await h.run('sbPush()');
  assert.equal(h.calls.length,0);h.run(`openChatRoom('A03430')`);assert.match(h.alerts[0],/ใบงาน.*ไม่สำเร็จ/);
});

test('server collision/conflict is durable and cannot be resent as an unconditional upsert',async()=>{
  const h=harness({handler:()=>({status:'conflict'})});h.context.__new=job();h.run('records.push(__new);saveRecordsStore()');
  await h.run('sbPush()');await h.run('sbPush()');assert.equal(h.calls.length,1);assert.equal(h.pending().A03430.status,'conflict');
  assert.equal(h.calls.some(c=>c.path==='fs_records'),false);
});

test('server-pulled valid historic empty-form/empty-row job permits chat; invalid job does not',()=>{
  const valid=job();const invalid={...job('A03431'),customer:'',brand:''};
  const h=harness({records:[valid,invalid]});h.run(pull([valid,invalid]));
  h.run(`createChat('A03430')`);assert.equal(h.run('chats.length'),1);
  h.run(`createChat('A03431')`);assert.equal(h.run('chats.length'),1);
});

test('legacy orphan rooms do not get falsely acknowledged and do not block server pull',async()=>{
  const h=harness({chat:[{jobId:'A03132',messages:[{uid:'m1',text:'Dummy',ts:1}],parts:[],approvals:{pd:{by:'Dummy'}}}]});
  await h.run('sbPush()');assert.equal(h.calls.length,0);
  assert.equal(h.run(`Object.prototype.hasOwnProperty.call(sbSnap.chats,'A03132')`),false);
  assert.equal(h.run(`Object.prototype.hasOwnProperty.call(sbSnap.msgs,'m1')`),false);
});

test('child writes require return=representation and exact acknowledgement',async()=>{
  const record=job();const h=harness({records:[record],chat:[{jobId:record.id,messages:[],parts:[],approvals:{}}]});h.run(pull([record]));
  await h.run(`sbUpsert('fs_messages',[{uid:'m1',job_id:'A03430',ts:1,data:{text:'Dummy'}}])`);
  assert.match(h.calls[0].opt.headers.Prefer,/return=representation/);
  const bad=harness({records:[record],handler:()=>[]});bad.run(pull([record]));
  await assert.rejects(bad.run(`sbUpsert('fs_messages',[{uid:'m1',job_id:'A03430',ts:1,data:{text:'Dummy'}}])`),/ไม่สำเร็จ/);
});

test('bulk formula guard and take-server guard do not get bypassed by durable retry',async()=>{
  const records=Array.from({length:13},(_,i)=>({...job('A'+String(i+1).padStart(5,'0')),rows:[{name:'Original'}]}));
  const h=harness({records});h.run(pull(records));h.run(`records.forEach(r=>r.rows=[{name:'Changed'}]);saveRecordsStore()`);await h.run('sbPush()');
  assert.equal(h.calls.length,0);assert.equal(h.read('guardHeld').length,13);
  h.run(`sbGuardOK=true;sbGuardTake=true`);await h.run('sbPush()');assert.equal(h.calls.length,0);
});

test('two tabs capturing before storage events retain disjoint pending jobs after reload',async()=>{
  const storage=new Map(),a=harness({storage}),b=harness({storage});
  a.context.__new=job();a.run('records.push(__new);saveRecordsStore()');
  b.context.__new=job('A03431');b.run('records.push(__new);saveRecordsStore()');
  const reload=harness({storage});assert.equal(reload.run('records.length'),2);
  assert.ok(reload.pending().A03430);assert.ok(reload.pending().A03431);
});

test('a conflicting job does not block another confirmed job chat or append-only activity',async()=>{
  const good=job('A03431'),bad=job();
  const h=harness({records:[bad,good],chat:[{jobId:good.id,createdAt:1,messages:[{uid:'good-message',text:'Dummy',ts:1}],parts:[],approvals:{}}],handler:(path,opt)=>{
    if(path==='rpc/fs_save_record')return {status:'conflict'};
    return structuredClone(opt.body||[]);
  }});
  h.run(pull([bad,good]));h.run(`records.find(r=>r.id==='A03430').brand='Changed';saveRecordsStore();activities.push({uid:'audit-1',ts:1})`);
  // Full pull reconciles rooms; restore a newly-created good room after it.
  h.run(`chats.push({jobId:'A03431',createdAt:1,messages:[{uid:'good-message',text:'Dummy',ts:1}],parts:[],approvals:{}})`);
  await h.run('sbPush()');
  assert.equal(h.pending().A03430.status,'conflict');
  assert.ok(h.calls.some(c=>c.path==='fs_messages'&&c.opt.body.some(r=>r.uid==='good-message')));
  assert.ok(h.calls.some(c=>c.path==='fs_activities'));
  assert.equal(h.run(`sbSnap.records.A03430===stableStr(records.find(r=>r.id==='A03430'))`),false);
  assert.equal(h.run('recTouched.A03430'),1);
  assert.equal(h.calls.some(c=>c.path==='fs_records'),false);
});

test('invalid/forbidden drafts are retained and every wrapped direct chat mutation stays locked',async()=>{
  const h=harness({handler:()=>({status:'forbidden'})});h.context.__new=job();h.run('records.push(__new);saveRecordsStore()');await h.run('sbPush()');
  for(const name of ['newChatFromRecord','chatIngEdit','saveChatFormula','chatIngAdd','chatIngDel','toggleChatApprove','approveOn','approveOff','closeJob','reopenJob','rejectJob','deleteJob','deleteChat','exportChatExcel']) h.run(`${name}('A03430')`);
  assert.equal(h.run('chats.length'),0);assert.equal(h.run('window.edited'),undefined);assert.equal(h.run('window.approved'),undefined);
  assert.ok(h.pending().A03430);
});

test('explicit server choice first persists local version backup then removes pending draft',async()=>{
  const original=job(), latest=job('A03430','Latest');
  const h=harness({records:[original],handler:(path)=>path==='rpc/fs_save_record'?{status:'conflict'}:[{id:latest.id,data:latest}]});
  h.run(pull([original]));edit(h);await h.run('sbPush()');
  assert.equal(await h.run(`window.__fsJobSync.useServer('A03430')`),true);
  assert.deepEqual(h.pending(),{});assert.equal(h.read('records[0]').brand,'Latest');
  assert.ok(JSON.parse(h.storage.get('fs_recbak')).A03430.some(b=>b.data.brand==='Edited'));
  h.run(`records[0].brand='Reviewed';saveRecordsStore()`);assert.equal(h.pending().A03430.expected.brand,'Latest');
});

test('failed server-choice backup preserves queued edit and does not rebase it',async()=>{
  // Neither localStorage nor IndexedDB can keep the retired copy here; with
  // IndexedDB available the copy lands in fs_job_recbak_v1 instead (see
  // tests/full-browser-relief-client.test.mjs).
  const h=harness({records:[job()],indexedDBFailure:true,handler:path=>path==='rpc/fs_save_record'?{status:'conflict'}:[{id:'A03430',data:job('A03430','Latest')}]});
  h.run(pull([job()]));edit(h);await h.run('sbPush()');
  const set=h.context.localStorage.setItem;
  h.context.localStorage.setItem=(k,v)=>{if(k==='fs_recbak')throw Error('quota');set(k,v);};
  assert.equal(await h.run(`window.__fsJobSync.useServer('A03430')`),false);
  assert.equal(h.pending().A03430.data.brand,'Edited');assert.equal(h.read('records[0]').brand,'Edited');
});

test('direct room template cannot render unsaved job controls',()=>{
  const h=harness({records:[job()]});assert.match(h.run(`chatRoomHTML({jobId:'A03430'},records[0])`),/role="status"/);
  h.run(pull([job()]));assert.equal(h.run(`chatRoomHTML({jobId:'A03430'},records[0])`),'allowed');
});

test('multi-letter server-issued job IDs remain supported',async()=>{
  const h=harness();h.context.__new=job('AA00001');h.run('records.push(__new);saveRecordsStore()');await h.run('sbPush()');
  assert.deepEqual(h.pending(),{});h.run(`createChat('AA00001')`);assert.equal(h.run('chats.length'),1);
});

test('account switch during legacy child write aborts before later activities or snapshot acknowledgement',async()=>{
  let resolve;const response=new Promise(r=>{resolve=r;});
  const h=harness({records:[job()],handler:()=>response});h.run(pull([job()]));
  h.run(`chats.push({jobId:'A03430',createdAt:1,messages:[{uid:'m1',text:'Dummy',ts:1}],parts:[],approvals:{}});activities.push({uid:'audit-1',ts:1})`);
  const flight=h.run('sbPush()');
  await new Promise(r=>setImmediate(r));h.run(`currentUser='admin'`);
  resolve([{uid:'m1',job_id:'A03430',data:{uid:'m1',text:'Dummy',ts:1}}]);
  await assert.rejects(flight,/ผู้ใช้งานเปลี่ยน/);
  assert.equal(h.calls.some(c=>c.path==='fs_activities'),false);
  assert.equal(h.run(`Object.prototype.hasOwnProperty.call(sbSnap.msgs,'m1')`),false);
});

test('divergent same-job drafts from two tabs remain durable and cannot auto-overwrite each other',async()=>{
  const storage=new Map(),a=harness({storage}),b=harness({storage});
  a.context.__new=job('A03430','Draft A');a.run('records.push(__new);saveRecordsStore()');
  b.context.__new=job('A03430','Draft B');b.run('records.push(__new);saveRecordsStore()');
  const reload=harness({storage});await reload.run('sbPush()');assert.equal(reload.calls.length,0);
  const brands=new Set(Array.from(storage).filter(([k])=>k.startsWith('fs_job_outbox_v1:sales:')).map(([,v])=>JSON.parse(v).data.brand));
  assert.deepEqual(brands,new Set(['Draft A','Draft B']));
});

test('acknowledgement never removes another tab revision created before its storage event arrives',async()=>{
  let resolve;const response=new Promise(r=>{resolve=r;});
  const storage=new Map(),a=harness({storage,handler:()=>response}),b=harness({storage});
  a.context.__new=job('A03430','Draft A');a.run('records.push(__new);saveRecordsStore()');const flight=a.run('sbPush()');
  b.context.__new=job('A03430','Draft B');b.run('records.push(__new);saveRecordsStore()');
  resolve({status:'saved',id:'A03430',data:job('A03430','Draft A')});await flight;
  assert.ok(Array.from(storage).some(([k,v])=>k.startsWith('fs_job_outbox_v1:sales:')&&JSON.parse(v).data.brand==='Draft B'));
});

test('explicit local deletion of pending draft persists backup and never creates/resurrects job',async()=>{
  const h=harness();h.context.__new=job();h.run('records.push(__new);saveRecordsStore()');
  h.run('records=[];saveRecordsStore()');await h.run('sbPush()');h.run(pull([]));
  assert.equal(h.run('records.length'),0);assert.deepEqual(h.pending(),{});assert.equal(h.calls.length,0);
  assert.ok(JSON.parse(h.storage.get('fs_recbak')).A03430.length);
});

// The proxy inserts __fsBeforeDeleteJob() in this sealed callback. The initial
// gate may admit a confirmed record, while a later local edit makes it pending
// before the confirmation callback runs. The second gate must execute before
// the sealed Activity or row removal.
const sealedDeleteConfirmationFixture=`
  function canDeleteJob(record){
    return !!record && (currentUser==='admin' || record.createdBy===currentUser);
  }
  function logAct(cat,action,detail,job){
    activities.push({uid:'delete-audit-'+(activities.length+1),ts:activities.length+1,cat,action,detail,job});
  }
  function doDeleteJob(record){
    if(typeof window.__fsBeforeDeleteJob!=='function'){
      window.alert('ระบบกำลังเตรียมการบันทึกใบงาน กรุณาลองใหม่อีกครั้ง');
      return;
    }
    if(!window.__fsBeforeDeleteJob(record.id)) return;
    logAct('job','ลบ Job งาน','synthetic delete',record.id);
    records=records.filter(function(row){ return row.id!==record.id; });
    saveRecordsStore();
  }
  function deleteJob(id){
    const record=records.find(function(row){ return row.id===id; });
    if(!record) return;
    window.pendingDeleteConfirmation=function(){ return doDeleteJob(record); };
  }
  function sbInList(keys){ return 'in.'+encodeURIComponent('('+keys.map(function(key){ return '"'+String(key).split('"').join('')+'"'; }).join(',')+')'); }
`;

test('a pending delete stays blocked with a delete-specific preservation message',()=>{
  const h=harness();h.context.__new=job('A03795');h.run('records.push(__new);saveRecordsStore()');

  h.run(`deleteJob('A03795')`);
  assert.equal(h.run('window.jobDeleted'),undefined,'the sealed delete handler ran while the record was pending');
  assert.equal(h.calls.length,0,'a blocked delete reached the central gateway');
  assert.match(h.alerts.at(-1),/A03795/);
  assert.match(h.alerts.at(-1),/ยังลบไม่ได้/);
  assert.match(h.alerts.at(-1),/ข้อมูลยังไม่ถูกลบ/);

  h.run(`createChat('A03795')`);
  assert.match(h.alerts.at(-1),/แชตใช้งานได้หลังบันทึกสำเร็จ/,
    'the non-delete gate wording must retain its existing Chat guidance');
});

test('a confirmation-window pending delete keeps its outbox and never publishes a false delete Activity when recovery backup is unavailable',async()=>{
  const original=job('A03795','Central original');
  const h=harness({records:[original],beforeAsset:sealedDeleteConfirmationFixture,handler:(path,opt)=>{
    if(path==='rpc/fs_save_record') return {status:'queued',id:opt.body.p_id};
    return structuredClone(opt.body||[]);
  }});
  h.run(pull([original]));
  h.run(`deleteJob('A03795')`);
  assert.equal(typeof h.run('window.pendingDeleteConfirmation'),'function','the initial confirmed click did not reach its confirmation callback');
  h.run(`records[0].brand='Edited while confirmation was open';saveRecordsStore()`);
  const before=h.pending().A03795;
  assert.equal(before.data.brand,'Edited while confirmation was open');
  const recoveryHistoryBefore=h.storage.get('fs_recbak');
  const set=h.context.localStorage.setItem;
  h.context.localStorage.setItem=(key,value)=>{
    if(key==='fs_recbak') throw Error('synthetic fs_recbak quota');
    return set(key,value);
  };
  h.run('window.pendingDeleteConfirmation()');
  assert.deepEqual(h.read('records'),[before.data],'the confirmation race removed the pending record');
  assert.deepEqual(h.pending().A03795.data,before.data,'the confirmation race discarded the pending outbox revision');
  assert.deepEqual(h.pending().A03795.expected,before.expected,'the confirmation race rebased the pending record');
  assert.ok(h.alerts.some(message=>/A03795/.test(message) && /ยังลบไม่ได้/.test(message) && /ข้อมูลยังไม่ถูกลบ/.test(message)),
    'the user was not told that delete was blocked while the pending revision was preserved');
  assert.equal(h.storage.get('fs_recbak'),recoveryHistoryBefore,
    'the callback attempted a recovery backup after its pending preflight failed');

  await h.run('sbPush()');
  assert.ok(h.pending().A03795,'the unacknowledged record revision was removed after failed delete backup');
  assert.equal(h.calls.some(call=>call.path.startsWith('fs_records?')&&call.opt.method==='DELETE'),false,
    'a failed backup let the central record delete proceed');
  assert.equal(h.calls.some(call=>call.path==='fs_activities'&&call.opt.body.some(row=>row.data?.action==='ลบ Job งาน')),false,
    'a failed delete backup published a false delete Activity');
});

test('the served delete confirmation callback fails closed when its runtime hook is missing',()=>{
  for(const [name,prepare,notice] of [
    ['missing hook',`window.__fsBeforeDeleteJob=undefined`,'ระบบกำลังเตรียมการบันทึกใบงาน'],
  ]){
    const original=job('A03795','Central original');
    const h=harness({records:[original],beforeAsset:sealedDeleteConfirmationFixture});
    h.run(pull([original]));
    h.run(`deleteJob('A03795')`);
    h.run(prepare);
    h.run('window.pendingDeleteConfirmation()');
    assert.equal(h.run('records.length'),1,`${name} removed the local record`);
    assert.equal(h.run(`activities.filter(row=>row.action==='ลบ Job งาน').length`),0,`${name} emitted a false delete Activity`);
    assert.match(h.alerts.at(-1),new RegExp(notice),`${name} did not explain its fail-closed result`);
  }
});

test('a confirmation-window delete sends its delete Activity only with a verified local backup and central DELETE',async()=>{
  const original=job('A03795','Central original');
  const h=harness({records:[original],beforeAsset:sealedDeleteConfirmationFixture});
  h.run(pull([original]));
  h.run(`deleteJob('A03795')`);
  h.run('window.pendingDeleteConfirmation()');
  assert.deepEqual(h.pending(),{},'verified backup did not retire the local pending revision before delete');
  assert.equal(h.run('records.length'),0);

  await h.run('sbPush()');
  const activity=h.calls.findIndex(call=>call.path==='fs_activities'&&call.opt.body.some(row=>row.data?.action==='ลบ Job งาน'));
  const deletion=h.calls.findIndex(call=>call.path.startsWith('fs_records?')&&call.opt.method==='DELETE');
  assert.ok(activity>=0,'verified delete did not publish its audit Activity');
  assert.ok(deletion>activity,'verified central DELETE did not follow its audit Activity');
});

test('a confirmation-window actor change cannot publish a delete Activity or remove the row',()=>{
  const original=job('A03795','Central original');
  const h=harness({records:[original],beforeAsset:sealedDeleteConfirmationFixture});
  h.run(pull([original]));
  h.run(`deleteJob('A03795')`);
  h.run(`currentUser='pd'`);
  h.run('window.pendingDeleteConfirmation()');
  assert.deepEqual(h.read('records'),[original],'the actor change removed the central row locally');
  assert.equal(h.calls.some(call=>call.path==='fs_activities'&&call.opt.body?.some(row=>row.data?.action==='ลบ Job งาน')),false,
    'a changed actor published a false delete Activity');
  assert.ok(h.alerts.some(message=>/A03795/.test(message) && /สิทธิ์ผู้ใช้ปัจจุบันไม่อนุญาต/.test(message)),
    'the changed actor did not receive an authorization-specific delete message');
});

test('installation after prior bootstrap pull requests full refresh without trusting stale snapshot',()=>{
  const h=harness({records:[job()]});
  // A second asset instance cannot re-install. Verify setup on fresh context
  // with an already-present sbLastFull and runtime scheduler.
  const code=asset.replace('  install();','  window.testInstall=install;');
  const c=vm.createContext({console,Date,Math,setTimeout(){},document:{body:null},localStorage:{length:0,getItem(){return null;}},sessionStorage:{getItem(){return null;},setItem(){}},addEventListener(){}});
  vm.runInContext(`var window=globalThis;let currentUser='',records=[],sbLastFull=123;function stableStr(x){return JSON.stringify(x)};function saveRecordsStore(){};function sbApply(){};function sbPush(){};function sbUpsert(){};function sbReq(){};function sendChatMsg(){};function renderChat(){};function sbCycle(){window.refreshRequested=true;};${code};testInstall();`,c);
  assert.equal(vm.runInContext('sbLastFull',c),0);assert.equal(c.refreshRequested,true);
  h.run(`openChatRoom('A03430')`);assert.equal(h.run('chatOpenId'),null);
  h.run(pull([job()]));h.run(`openChatRoom('A03430')`);assert.equal(h.run('chatOpenId'),'A03430');
});

test('a stale visible record reconciles its parent without flushing any write',async()=>{
  const original=job('A03430');
  const h=harness({records:[original],handler:(path)=>path.startsWith('fs_records?id=eq.A03430')
    ? [{id:'A03430',data:original}] : []});
  // Keep the local record visible without a central acknowledgement. The
  // automatic read-only reconciliation must obtain that acknowledgement before
  // the existing fail-closed Chat gate is evaluated.
  const callsBefore=h.calls.length, storageBefore=h.storageOperations.length, idbBefore=h.idbOperations.length;
  await h.run(`openChatRoom('A03430')`);
  assert.equal(h.run('chatOpenId'),'A03430','central confirmation must reopen Chat without a user source choice');
  assert.equal(h.alerts.length,0,'a recoverable stale snapshot must not show a false permission/unsaved alert');
  const newCalls=h.calls.slice(callsBefore);
  assert.ok(newCalls.some(call=>call.path.startsWith('fs_records?id=eq.A03430') && (!call.opt.method || call.opt.method==='GET')),
    'stale Chat reconciliation must read the target parent');
  assert.equal(newCalls.some(call=>call.opt?.method==='POST'||call.opt?.method==='PATCH'||call.opt?.method==='DELETE'),false,
    'stale Chat reconciliation must not send a central write');
  assert.equal(h.storageOperations.length,storageBefore,'stale Chat reconciliation must not mutate browser storage');
  assert.equal(h.idbOperations.length,idbBefore,'stale Chat reconciliation must not mutate the fallback journal');
});

test('duplicated tabs sharing a cloned session token still cannot remove each other revision',async()=>{
  const storage=new Map(),session=new Map([['fs_job_sync_tab_v1','cloned-tab-token']]);
  const a=harness({storage,session}),b=harness({storage,session:new Map(session)});
  a.context.__new=job('A03430','Draft A');a.run('records.push(__new);saveRecordsStore()');
  b.context.__new=job('A03430','Draft B');b.run('records.push(__new);saveRecordsStore()');
  const key=Array.from(storage.keys()).find(k=>k.startsWith('fs_job_outbox_v1:sales:'));
  a.listeners.storage({key});a.run('saveRecordsStore()');
  const brands=new Set(Array.from(storage).filter(([k])=>k.startsWith('fs_job_outbox_v1:sales:')).map(([,v])=>JSON.parse(v).data.brand));
  assert.deepEqual(brands,new Set(['Draft A','Draft B']));
});

test('stale sibling-tab fs_records event cannot replace an active edit',()=>{
  const original=job('A03430','Synthetic original');
  const h=harness({records:[original],beforeAsset:`
    function sbCycle(){window.refreshRequested=true;}
    addEventListener('storage',function(event){
      if(event.key==='fs_records'){
        records=JSON.parse(localStorage.getItem('fs_records')||'[]');
        window.legacyCacheReloaded=true;
      }
    },false);
  `});
  h.run(pull([original]));edit(h);
  const edited=h.read('records[0]');
  h.context.localStorage.setItem('fs_records',JSON.stringify([original]));
  h.context.refreshRequested=false;
  h.listeners.storage({key:'fs_records'});
  assert.equal(h.context.legacyCacheReloaded,undefined);
  assert.equal(h.read('records[0]').brand,edited.brand);
  assert.equal(h.pending().A03430.data.brand,edited.brand);
  assert.equal(h.context.refreshRequested,true);
});

test('stale sibling-tab cache event preserves an in-progress formula row edit',()=>{
  const original={...job('A03486'),rows:[{name:'D-Ribose',w:'100.00'}]};
  const h=harness({records:[original],beforeAsset:`
    function sbCycle(){window.refreshRequested=true;}
    addEventListener('storage',function(event){
      if(event.key==='fs_records') records=JSON.parse(localStorage.getItem('fs_records')||'[]');
    },false);
  `});
  h.run(pull([original]));
  h.run(`records[0].rows[0].w='50.00';saveRecordsStore()`);
  h.context.localStorage.setItem('fs_records',JSON.stringify([original]));
  h.listeners.storage({key:'fs_records'});

  assert.equal(h.run(`records[0].rows[0].w`),'50.00');
  assert.equal(h.pending().A03486.data.rows[0].w,'50.00');
  assert.equal(h.context.refreshRequested,true);
});

test('account switch restores destination owner pending job instead of cancelling an absent draft',async()=>{
  const storage=new Map(),admin=harness({storage,owner:'admin'});
  admin.context.__new={...job('A03431'),createdBy:'admin'};admin.run('records.push(__new);saveRecordsStore()');
  const sales=harness({storage,records:[job()],handler:()=>({status:'conflict'})});
  sales.run(`currentUser='admin'`);await sales.run('sbPush()');
  assert.ok(sales.pending().A03431);assert.equal(sales.run(`records.some(r=>r.id==='A03431')`),true);
  assert.equal(sales.storage.has('fs_recbak'),false);
});

function forkHarness(handler) {
  const storage=new Map(),a=harness({storage}),b=harness({storage});
  a.context.__new=job('A03430','Draft A');a.run('records.push(__new);saveRecordsStore()');
  b.context.__new=job('A03430','Draft B');b.run('records.push(__new);saveRecordsStore()');
  return harness({storage,handler});
}

test('explicit reviewed local-create choice resolves first-save fork without renumbering',async()=>{
  const h=forkHarness((path,opt)=>path.startsWith('fs_records?')?[]:path==='rpc/fs_save_record'?{status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)}:structuredClone(opt.body||[]));
  const chosen=h.read('records[0]');
  assert.equal(await h.run(`window.__fsJobSync.useLocalCreate('A03430')`),true);
  const stored=Array.from(h.storage).filter(([k])=>k.startsWith('fs_job_outbox_v1:sales:')).map(([,v])=>JSON.parse(v));
  assert.equal(stored.length,1);assert.equal(stored[0].expected,null);assert.equal(stored[0].data.brand,chosen.brand);
  const backups=JSON.parse(h.storage.get('fs_recbak')).A03430;
  assert.ok(backups.some(b=>b.data.brand==='Draft A'));assert.ok(backups.some(b=>b.data.brand==='Draft B'));
  await h.run('sbPush()');assert.deepEqual(h.pending(),{});
  assert.equal(h.calls.find(c=>c.path==='rpc/fs_save_record').opt.body.p_id,'A03430');
  h.run(`createChat('A03430')`);assert.equal(h.run('chats.length'),1);
});

test('local-create choice refuses existing server record and preserves every pending fork',async()=>{
  const h=forkHarness(()=>[{id:'A03430',data:job('A03430','Server')}]);
  const before=Array.from(h.storage).filter(([k])=>k.startsWith('fs_job_outbox_v1:sales:'));
  assert.equal(await h.run(`window.__fsJobSync.useLocalCreate('A03430')`),false);
  assert.deepEqual(Array.from(h.storage).filter(([k])=>k.startsWith('fs_job_outbox_v1:sales:')),before);
  assert.match(h.alerts.at(-1),/มีใบงานนี้แล้ว/);
});

test('failed fork-choice backup retains all original immutable revisions',async()=>{
  const h=forkHarness(()=>[]),set=h.context.localStorage.setItem;
  const before=Array.from(h.storage).filter(([k])=>k.startsWith('fs_job_outbox_v1:sales:'));
  h.context.localStorage.setItem=(k,v)=>{if(k==='fs_recbak')throw Error('backup quota');set(k,v);};
  assert.equal(await h.run(`window.__fsJobSync.useLocalCreate('A03430')`),false);
  assert.deepEqual(Array.from(h.storage).filter(([k])=>k.startsWith('fs_job_outbox_v1:sales:')),before);
});

test('failed persistence of chosen create revision keeps all reviewed revisions',async()=>{
  const h=forkHarness(()=>[]),set=h.context.localStorage.setItem;
  const before=Array.from(h.storage).filter(([k])=>k.startsWith('fs_job_outbox_v1:sales:'));
  h.context.localStorage.setItem=(k,v)=>{if(k.startsWith('fs_job_outbox_v1:'))throw Error('outbox quota');set(k,v);};
  assert.equal(await h.run(`window.__fsJobSync.useLocalCreate('A03430')`),false);
  assert.deepEqual(Array.from(h.storage).filter(([k])=>k.startsWith('fs_job_outbox_v1:sales:')),before);
});

test('server creation racing after reviewed fresh lookup remains protected by create-only CAS',async()=>{
  const h=forkHarness(path=>path.startsWith('fs_records?')?[]:{status:'conflict'});
  assert.equal(await h.run(`window.__fsJobSync.useLocalCreate('A03430')`),true);
  await h.run('sbPush()');assert.equal(h.pending().A03430.status,'conflict');
  assert.equal(h.calls.find(c=>c.path==='rpc/fs_save_record').opt.body.p_expected,null);
  h.run(`createChat('A03430')`);assert.equal(h.run('chats.length'),0);
});

test('canCreate refreshes the current actor before allowing direct copy or import allocation',async t=>{
  await t.test('switching to an actor with an unreadable outbox fails closed without deleting it',()=>{
    const h=harness();
    const key='fs_job_outbox_v1:admin:corrupt',value='{unreadable synthetic revision';
    h.storage.set(key,value);
    assert.equal(h.run('__fsJobSync.canCreate()'),true);
    h.run(`currentUser='admin'`);
    assert.equal(h.run('__fsJobSync.canCreate()'),false);
    assert.equal(h.storage.get(key),value);assert.equal(h.calls.length,0);
    h.run(`currentUser='sales'`);
    assert.equal(h.run('__fsJobSync.canCreate()'),true);
    assert.equal(h.storage.get(key),value);
  });
  await t.test('an absent current actor cannot allocate even after a healthy previous actor',()=>{
    const h=harness();
    assert.equal(h.run('__fsJobSync.canCreate()'),true);
    h.run('currentUser=null');
    assert.equal(h.run('__fsJobSync.canCreate()'),false);
    assert.equal(h.calls.length,0);assert.deepEqual(h.pending(),{});
  });
});

function recoveryActionBar(h){
  const bar=h.context.document.createElement('div');bar.className='abar';
  const create=h.context.document.createElement('button');create.id='btnCreate';create.setAttribute('aria-describedby','gen_err');
  const clear=h.context.document.createElement('button');clear.textContent='ล้างข้อมูล';
  const error=h.context.document.createElement('span');error.id='gen_err';
  bar.appendChild(create);bar.appendChild(clear);bar.appendChild(error);h.context.document.body.appendChild(bar);
  return {bar,create,clear,error};
}

const recoveryResetFixture=`
  function resetForm(){ window.resetCalls=(window.resetCalls||0)+1; }
`;

test('verified quota fallback renders an accessible inline recovery panel and exports an immutable recovery copy',async()=>{
  const h=harness({beforeAsset:sealedGeneratorCreateOrderFixture+recoveryResetFixture});
  const actions=recoveryActionBar(h), downloads=[], urls=[];
  h.context.Blob=class Blob { constructor(parts,options){downloads.push({text:parts.join(''),options});} };
  h.context.URL={createObjectURL(){urls.push('create');return 'blob:synthetic';},revokeObjectURL(url){urls.push('revoke:'+url);}};
  h.context.setTimeout=fn=>{fn();return 1;};
  const originalSet=h.context.localStorage.setItem;
  h.context.localStorage.setItem=(key,value)=>{
    if(key.startsWith('fs_job_outbox_v1:')) { const error=Error('full');error.name='QuotaExceededError';throw error; }
    return originalSet(key,value);
  };

  h.run('generateDash()');await h.settle();

  const panel=h.context.document.getElementById('fsJobRecoveryPanel');
  assert.ok(panel,'the recovery panel was not placed next to the sealed action bar');
  assert.equal(panel.parentNode,actions.bar,'the recovery panel escaped the Customer Data action group');
  assert.equal(h.context.document.getElementById('fsJobRecoveryHeading').textContent,'⚠ เก็บสำเนาใบงานในเครื่องแล้ว');
  assert.equal(h.context.document.getElementById('fsJobRecoveryStatus').textContent,'ยังไม่ยืนยันในระบบกลาง');
  assert.match(h.context.document.getElementById('fsJobRecoveryNext').textContent,/ดาวน์โหลดสำเนาใบงานก่อน/);
  const download=h.context.document.getElementById('fsJobRecoveryDownload');
  assert.ok(download);assert.equal(download.textContent,'ดาวน์โหลดสำเนาใบงาน');
  assert.equal(download.getAttribute('aria-describedby'),'fsJobRecoveryDownloadDescription');
  assert.equal(h.context.document.getElementById('fsJobRecoveryDownloadDescription').textContent,'ไฟล์นี้เป็นสำเนาสำหรับกู้คืน ยังไม่ได้บันทึกในระบบกลาง');
  assert.equal(actions.create.disabled,true);assert.equal(actions.clear.disabled,true);
  assert.equal(actions.create.getAttribute('aria-disabled'),'true');assert.equal(actions.clear.getAttribute('aria-disabled'),'true');
  assert.equal(actions.create.getAttribute('aria-describedby'),'fsJobRecoveryStatus');assert.equal(actions.clear.getAttribute('aria-describedby'),'fsJobRecoveryStatus');
  assert.equal(h.context.document.activeElement,h.context.document.getElementById('fsJobRecoveryHeading'),'a Create-triggered recovery state must move focus once to its heading');

  const storageBefore=Array.from(h.storage.entries()), fallbackBefore=h.fallbackEntries();
  h.run('resetForm()');
  assert.equal(h.context.resetCalls,undefined,'the reset handler bypassed the recovery guard');
  assert.equal(h.context.document.activeElement,h.context.document.getElementById('fsJobRecoveryHeading'),'the guarded reset must focus the recovery explanation');
  download.click();
  assert.deepEqual(Array.from(h.storage.entries()),storageBefore,'export rewrote legacy browser evidence');
  assert.deepEqual(h.fallbackEntries(),fallbackBefore,'export changed the IndexedDB journal');
  assert.deepEqual(urls,['create','revoke:blob:synthetic'],'the temporary object URL was not released after download');
  assert.equal(downloads.length,1);
  const exported=JSON.parse(downloads[0].text), journal=fallbackBefore[0];
  assert.deepEqual(exported.record,journal.data);assert.deepEqual(exported.activities,journal.activities);
  assert.equal(exported.recordId,'A03763');assert.equal(exported.format,'formula-unsent-job-v1');
  assert.equal(h.calls.some(call=>call.path==='rpc/fs_save_record'),false,'a download attempted a central save');
});

test('record acknowledgement without its Activity keeps the inline panel incomplete until the stable Activity is acknowledged',async()=>{
  let acceptActivity=false;
  const h=harness({beforeAsset:sealedGeneratorCreateOrderFixture+recoveryResetFixture,handler:(path,opt)=>{
    if(path==='rpc/fs_save_record') return {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
    if(path==='fs_activities') return acceptActivity ? opt.body.map(row=>({...structuredClone(row),data:{...structuredClone(row.data),user:'sales',role:'sales'}})) : [];
    return [];
  }});
  const actions=recoveryActionBar(h), set=h.context.localStorage.setItem;
  h.context.localStorage.setItem=(key,value)=>{
    if(key.startsWith('fs_job_outbox_v1:')) { const error=Error('full');error.name='QuotaExceededError';throw error; }
    return set(key,value);
  };
  h.run('generateDash()');await h.settle();await h.run('sbPush()');
  const panel=h.context.document.getElementById('fsJobRecoveryPanel');
  assert.ok(panel);assert.equal(h.context.document.getElementById('fsJobRecoveryHeading').textContent,'⚠ ระบบกลางรับใบงานแล้ว แต่การบันทึกประวัติยังไม่ครบ');
  assert.equal(h.context.document.getElementById('fsJobRecoveryStatus').textContent,'ใบงานนี้ยังไม่เสร็จสมบูรณ์ และยังไม่เปิดใช้งานแชต');
  assert.equal(actions.create.disabled,true);assert.equal(actions.clear.disabled,true);
  assert.doesNotMatch(panel.textContent,/บันทึกแล้ว|สำเร็จ/,'partial acknowledgement claimed completed save');
  assert.equal(h.fallbackEntries().length,1,'a failed Activity acknowledgement deleted the durable journal');

  acceptActivity=true;await h.run('sbPush()');
  assert.equal(h.context.document.getElementById('fsJobRecoveryPanel'),null,'the panel survived complete record and Activity acknowledgement');
  assert.equal(actions.create.disabled,false);assert.equal(actions.clear.disabled,false);
  assert.equal(actions.create.getAttribute('aria-describedby'),'gen_err');assert.equal(actions.clear.getAttribute('aria-describedby'),null);
  assert.equal(h.fallbackEntries().length,0);
});

test('an unavailable fallback keeps the form actionable only through an export and never reaches the central save API',async()=>{
  const h=harness({beforeAsset:sealedGeneratorCreateOrderFixture+recoveryResetFixture,indexedDBFailure:{open:true}});
  const actions=recoveryActionBar(h), set=h.context.localStorage.setItem;
  h.context.localStorage.setItem=(key,value)=>{
    if(key.startsWith('fs_job_outbox_v1:')) { const error=Error('full');error.name='QuotaExceededError';throw error; }
    return set(key,value);
  };
  h.run('generateDash()');await h.settle();
  assert.equal(h.context.document.getElementById('fsJobRecoveryHeading').textContent,'⚠ ยังเก็บสำเนาใบงานในเครื่องไม่ได้');
  assert.equal(h.context.document.getElementById('fsJobRecoveryStatus').textContent,'ข้อมูลยังไม่ยืนยันในระบบกลาง');
  assert.equal(actions.create.disabled,true);assert.equal(actions.clear.disabled,true);
  assert.equal(h.context.formWasCleared,undefined);
  assert.equal(h.calls.some(call=>call.path==='rpc/fs_save_record'),false);
});

test('legacy-sync warning lists only safe affected job IDs, opens the exact record, and clears after resolution',async()=>{
  const original=job('A03430'),server={...original,brand:'Central copy'};
  const h=harness({records:[original],handler:(path,opt)=>{
    if(path==='rpc/fs_save_record') return {status:'conflict',id:opt.body.p_id};
    if(path.startsWith('fs_records?')) return [{id:original.id,data:server}];
    return [];
  }});
  h.run(pull([original]));
  h.run(`window.openedRecordIds=[];window.openRecordPopup=function(id){openedRecordIds.push(id);};records[0].brand='Local edit';saveRecordsStore()`);
  await h.run('sbPush()');

  const status=h.nodes.fsJobSyncStatus;
  assert.equal(status.hidden,false,'a suppressed legacy write must remain visible');
  const nodeText=node=>String(node.textContent||'')+(node.children||[]).map(nodeText).join('');
  assert.match(nodeText(status),/ใบงานที่ต้องตรวจสอบ/);
  assert.doesNotMatch(nodeText(status),/ใช้ข้อมูลล่าสุดจากระบบกลาง|บันทึกฉบับที่แสดงในหน้านี้|เลือกใช้ข้อมูลจากระบบกลาง/,'the user-facing recovery surface must not present source choices');
  const findButtons=node=>(node.children||[]).flatMap(child=>[
    ...(child.tagName==='BUTTON'?[child]:[]),...findButtons(child)
  ]);
  const buttons=findButtons(status).filter(button=>button.textContent==='A03430');
  assert.equal(buttons.length,1,'the warning must identify each affected job exactly once');
  const open=buttons[0];
  assert.equal(open.getAttribute('aria-label'),'เปิดตรวจสอบใบงาน A03430');
  const callsBefore=h.calls.length;
  open.click();
  assert.deepEqual(h.read('openedRecordIds'),['A03430'],'the direct warning action must use the existing record opener for the exact job');
  assert.equal(h.calls.length,callsBefore,'opening a warning must not write or fetch through an alternate path');

  assert.equal(await h.run(`window.__fsJobSync.useServer('A03430')`),true,'the existing authorized resolution path must remain available');
  await h.run('sbPush()');
  assert.equal(status.hidden,true,'the legacy warning must disappear after the protected write is cleared');
  assert.equal(status.textContent,'','clearing a warning must not leave stale affected IDs or controls');

  const unsafe=harness({records:[job('A03431')]});
  unsafe.run(`window.openedRecordIds=[];window.openRecordPopup=function(id){openedRecordIds.push(id);};records.push({id:'<img src=x onerror=alert(1)>',brand:'Unsafe',customer:'Unsafe',createdBy:'sales',createdAt:1,rows:[]});recTouched['<img src=x onerror=alert(1)>']=1;`);
  await unsafe.run('sbPush()');
  const unsafeStatus=unsafe.nodes.fsJobSyncStatus;
  assert.equal(unsafeStatus.hidden,false,'an unreadable legacy write still reports the generic warning');
  assert.doesNotMatch(nodeText(unsafeStatus),/img|alert|Unsafe/,'untrusted legacy identifiers must never be rendered');
  assert.equal(findButtons(unsafeStatus).length,0,'invalid affected IDs must fail closed without an open action');
  assert.deepEqual(unsafe.read('openedRecordIds'),[]);
});

test('blocked legacy job with no central row can be explicitly staged as a create-only recovery',async()=>{
  const original=job('A03430'), h=harness({records:[original],handler:(path,opt)=>{
    if(path.startsWith('fs_records?')) return [];
    if(path==='rpc/fs_save_record') return {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
    return [];
  }});
  h.run(pull([original]));
  h.run(`records[0].brand='Local recovery';`);
  await h.run('sbPush()');
  assert.equal(h.run('typeof window.__fsJobSync.recoverLegacy'), 'function');
  assert.equal(await h.run(`window.__fsJobSync.recoverLegacy('A03430','local')`),true);
  assert.equal(h.pending().A03430,undefined);
  assert.equal(h.calls.filter(call=>call.path.startsWith('fs_records?')).length,2,
    'recovery lookup and post-acknowledgement cache verification are separate reads');
  assert.equal(h.calls.filter(call=>call.path==='rpc/fs_save_record').length,1);
  h.run(`openChatRoom('A03430')`);
  assert.equal(h.run('chatOpenId'),'A03430');
});

test('opening a blocked legacy job automatically reconciles to the authorized central copy without a choice prompt',async()=>{
  const original=job('A03430'), server={...original,brand:'Central copy'};
  const h=harness({records:[original],handler:(path,opt)=>{
    if(path.startsWith('fs_records?')) return [{id:original.id,data:server}];
    if(path==='rpc/fs_save_record') return {status:'conflict',id:opt.body.p_id};
    return [];
  }});
  h.run(pull([original]));
  h.run(`records[0].brand='Local recovery';`);
  await h.run('sbPush()');
  h.context.confirm=()=>{ throw Error('automatic recovery must not prompt for a source choice'); };

  await h.run(`openChatRoom('A03430')`);
  assert.equal(h.run('chatOpenId'),'A03430');
  assert.equal(h.nodes.fsJobSyncStatus.hidden,true,'successful readiness must clear the recovery warning');
  assert.doesNotMatch(h.nodes.fsJobSyncStatus.textContent,/ใช้ข้อมูลล่าสุดจากระบบกลาง|บันทึกฉบับที่แสดงในหน้านี้/,'successful recovery must leave no source-choice controls or copy');
  assert.equal(h.read('records[0].brand'),'Central copy');
  assert.ok(JSON.parse(h.storage.get('fs_recbak')).A03430.some(entry=>entry.data.brand==='Local recovery'));
});

test('automatic recovery shows safe pending and retry status while keeping Chat locked',async()=>{
  let resolveLookup;
  const lookup=new Promise(resolve=>{resolveLookup=resolve;});
  const original=job('A03430');
  const h=harness({records:[original],handler:path=>path.startsWith('fs_records?')?lookup:[]});
  h.run(pull([original]));
  h.run(`records[0].brand='Local recovery';`);
  await h.run('sbPush()');
  const recovery=h.run(`openChatRoom('A03430')`);
  const status=h.nodes.fsJobSyncStatus;
  const nodeText=node=>String(node.textContent||'')+(node.children||[]).map(nodeText).join('');
  assert.equal(status.getAttribute('role'),'status');
  assert.equal(status.getAttribute('aria-live'),'polite');
  assert.match(nodeText(status),/กำลังตรวจสอบข้อมูลใบงานก่อนเปิดแชต/);
  assert.match(nodeText(status),/A03430/);
  assert.doesNotMatch(nodeText(status),/Local recovery|ใช้ข้อมูลล่าสุดจากระบบกลาง|บันทึกฉบับที่แสดงในหน้านี้/);
  assert.equal(h.run('chatOpenId'),null);
  resolveLookup(Promise.reject(new Error('synthetic private transport detail')));
  await recovery;
  assert.equal(h.run('chatOpenId'),null);
  assert.match(nodeText(status),/ยังเปิดแชตไม่ได้/);
  assert.match(nodeText(status),/A03430/);
  assert.doesNotMatch(nodeText(status),/synthetic private transport detail|Local recovery|ระบบกลางรับข้อมูลแล้ว/);
});

test('opening a blocked legacy job automatically stages a local create when central has no row',async()=>{
  const original=job('A03430');
  const h=harness({records:[original],handler:(path,opt)=>{
    if(path.startsWith('fs_records?')) return [];
    if(path==='rpc/fs_save_record') return {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
    return [];
  }});
  h.run(pull([original]));
  h.run(`records[0].brand='Local recovery';`);
  await h.run('sbPush()');
  h.context.confirm=()=>{ throw Error('automatic recovery must not prompt for a source choice'); };

  await h.run(`openChatRoom('A03430')`);
  assert.equal(h.run('chatOpenId'),'A03430');
  assert.equal(h.pending().A03430,undefined);
  assert.equal(h.calls.filter(call=>call.path==='rpc/fs_save_record').length,1);
});

test('automatic legacy recovery accepts only a valid matching central row or an explicit empty array',async t=>{
  const original=job('A03430'), server={...original,brand:'Central copy'};
  const cases=[
    ['valid matching central row', [{id:original.id,data:server}], 'complete', true, false],
    ['explicit empty array', [], 'complete', true, true],
    ['different row ID', [{id:'A03431',data:{...server,id:'A03431'}}], 'central-response', false, false],
    ['invalid row data', [{id:original.id,data:{...server,rows:null}}], 'central-response', false, false],
  ];
  for (const [label,response,stage,complete,expectsSave] of cases) await t.test(label,async()=>{
    let saveCount=0;
    const h=harness({records:[original],handler:(path,opt)=>{
      if(path.startsWith('fs_records?')) return response;
      if(path==='rpc/fs_save_record') {
        saveCount++;
        return saveCount===1 ? {status:'conflict',id:opt.body.p_id}
          : {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
      }
      return [];
    }});
    h.run(pull([original]));
    h.run(`records[0].brand='Local recovery';saveRecordsStore()`);
    await h.run('sbPush()');
    const savesBefore=h.calls.filter(call=>call.path==='rpc/fs_save_record').length;
    const recovered=await h.run(`window.__fsJobSync.recoverLegacy('A03430','auto')`);
    const diagnostic=JSON.parse(h.run('JSON.stringify(window.__fsJobSync.recoveryDiagnostic)'));
    assert.deepEqual(Object.keys(diagnostic).sort(),['choice','id','outcome','stage']);
    assert.equal(diagnostic.stage,stage);
    assert.equal(diagnostic.outcome,complete?'complete':'failed');
    assert.equal(recovered,complete);
    assert.equal(h.calls.filter(call=>call.path==='rpc/fs_save_record').length-savesBefore,expectsSave?1:0);
    assert.equal(Object.keys(diagnostic).some(key=>/data|record|error|message|token|payload|response/i.test(key)),false);
  });
});

test('automatic legacy recovery keeps an unauthorized central row blocked',async()=>{
  const original=job('A03430'), server={...original,createdBy:'another-user',brand:'Hidden copy'};
  const h=harness({records:[original],handler:path=>path.startsWith('fs_records?') ? [{id:original.id,data:server}] : []});
  h.run(pull([original]));
  h.run(`records[0].brand='Local recovery';saveRecordsStore()`);
  await h.run('sbPush()');
  const savesBefore=h.calls.filter(call=>call.path==='rpc/fs_save_record').length;
  assert.equal(await h.run(`window.__fsJobSync.recoverLegacy('A03430','auto')`),false);
  assert.deepEqual(h.read('window.__fsJobSync.recoveryDiagnostic'),{
    id:'A03430',choice:'auto',stage:'central-response',outcome:'failed',
  });
  assert.equal(h.calls.filter(call=>call.path==='rpc/fs_save_record').length-savesBefore,0);
});

test('automatic legacy recovery records rejected central lookup and never falls back locally',async()=>{
  const original=job('A03430');
  const h=harness({records:[original],handler:path=>{
    if(path.startsWith('fs_records?')) throw Error('masked synthetic lookup failure');
    return [];
  }});
  h.run(pull([original]));
  h.run(`records[0].brand='Local recovery';saveRecordsStore()`);
  await h.run('sbPush()');
  const savesBefore=h.calls.filter(call=>call.path==='rpc/fs_save_record').length;
  assert.equal(await h.run(`window.__fsJobSync.recoverLegacy('A03430','auto')`),false);
  const diagnostic=h.read('window.__fsJobSync.recoveryDiagnostic');
  assert.deepEqual(diagnostic,{id:'A03430',choice:'auto',stage:'central-lookup',outcome:'failed'});
  assert.equal(h.calls.filter(call=>call.path==='rpc/fs_save_record').length-savesBefore,0);
  assert.deepEqual(Object.keys(diagnostic).sort(),['choice','id','outcome','stage']);
});

test('automatic restored conflict uses strict recovery without a legacy suppression marker',async t=>{
  for(const failure of ['persistence','backup','invalid-response','lookup','acknowledgement','none']) await t.test(failure,async()=>{
    const local=job('A03430','Restored local'), server=job('A03430','Central copy');
    const key='fs_job_outbox_v1:sales:restored-conflict';
    const encoded=JSON.stringify({version:1,owner:'sales',id:local.id,tab:'other',data:local,expected:null,status:'conflict',activities:[],at:1});
    const storage=new Map([[key,encoded]]);
    const h=harness({records:[local],storage,handler:(path,opt)=>{
      if(path.startsWith('fs_records?')) {
        if(failure==='lookup') throw Error('synthetic confidential lookup failure');
        if(failure==='acknowledgement') return [];
        const row={id:server.id,data:server};
        return failure==='invalid-response'?[row,row]:[row];
      }
      if(path==='rpc/fs_save_record') return {status:'saved',id:opt.body.p_id,data:server};
      return [];
    }});
    // Restore directly from durable storage: no sbPush or manufactured suppression marker.
    assert.equal(h.calls.length,0);
    h.context.confirm=()=>{throw Error('automatic recovery must not prompt');};
    const set=h.context.localStorage.setItem;
    h.context.localStorage.setItem=(key,value)=>{
      if((failure==='persistence'&&key==='fs_records')||(failure==='backup'&&key==='fs_recbak')) return;
      set(key,value);
    };
    await h.run(`openChatRoom('A03430')`);
    const success=failure==='none';
    assert.equal(h.run('chatOpenId'),success?'A03430':null);
    assert.equal(!!h.pending().A03430,!success);
    if(!success&&failure!=='acknowledgement') assert.equal(storage.get(key),encoded);
    if(failure==='persistence') {
      assert.equal(h.read('records[0].brand'),'Restored local');
      assert.equal(h.read('sbSnap.records.A03430 || null'),null);
      assert.ok(JSON.parse(storage.get('fs_recbak')).A03430.some(entry=>entry.data.brand==='Restored local'));
    }
    const stages={persistence:'local-persistence',backup:'local-backup','invalid-response':'central-response',lookup:'central-lookup',acknowledgement:'recovery-request',none:'complete'};
    assert.deepEqual(h.read('window.__fsJobSync.recoveryDiagnostic'),{id:local.id,choice:'auto',stage:stages[failure],outcome:success?'complete':'failed'});
    if(failure==='acknowledgement') assert.equal(h.calls.find(call=>call.path==='rpc/fs_save_record').opt.body.p_expected,null);
    else assert.equal(h.calls.some(call=>call.path==='rpc/fs_save_record'),false);
  });
});

test('automatic central recovery detects durable cross-tab revisions before their storage event',async t=>{
  for(const timing of ['during lookup','before lookup']) await t.test(timing,async()=>{
    let resolveLookup, lookupStarted;
    const lookup=new Promise(resolve=>{resolveLookup=resolve;});
    const started=new Promise(resolve=>{lookupStarted=resolve;});
    const local=job('A03430','Local recovery'), other=job('A03430','Other tab revision'), server=job('A03430','Central copy');
    const h=harness({records:[local],handler:path=>{
      if(path.startsWith('fs_records?')) {lookupStarted();return lookup;}
      return [];
    }});
    h.run(pull([local]));
    h.run(`records[0].brand='Blocked local';saveRecordsStore()`);
    await h.run('sbPush()');
    const savesBefore=h.calls.filter(call=>call.path==='rpc/fs_save_record').length;
    const key='fs_job_outbox_v1:sales:delayed-other-tab';
    const encoded=JSON.stringify({version:1,owner:'sales',id:other.id,tab:'other',data:other,expected:local,status:'pending',activities:[],at:2});
    if(timing==='before lookup') h.storage.set(key,encoded);
    const recovery=h.run(`openChatRoom('A03430')`);
    await started;
    if(timing==='during lookup') h.storage.set(key,encoded);
    // Deliberately do not dispatch a storage event while the lookup is paused.
    resolveLookup([{id:server.id,data:server}]);
    await recovery;
    if(timing==='during lookup') {
      assert.equal(h.run('chatOpenId'),null);
      assert.equal(h.storage.get(key),encoded);
      assert.equal(h.read('records[0].brand'),'Blocked local');
      assert.equal(h.read('window.__fsJobSync.recoveryDiagnostic.stage'),'concurrency-check');
      assert.equal(h.read('window.__fsJobSync.recoveryDiagnostic.outcome'),'failed');
    } else {
      assert.equal(h.run('chatOpenId'),'A03430');
      assert.deepEqual(h.pending(),{});
      const backups=JSON.parse(h.storage.get('fs_recbak')).A03430;
      assert.ok(backups.some(entry=>entry.data.brand==='Other tab revision'));
      assert.ok(backups.some(entry=>entry.data.brand==='Blocked local'));
    }
    assert.equal(h.calls.filter(call=>call.path==='rpc/fs_save_record').length,savesBefore);
  });
});

test('automatic central recovery preserves blocked evidence when backup or local persistence fails',async t=>{
  for(const failure of ['backup','persistence']) await t.test(failure,async()=>{
    const original=job('A03430'), server={...original,brand:'Central copy'};
    const h=harness({records:[original],handler:path=>path.startsWith('fs_records?')?[{id:original.id,data:server}]:[]});
    h.run(pull([original]));
    h.run(`records[0].brand='Local recovery';saveRecordsStore()`);
    await h.run('sbPush()');
    const pendingBefore=h.pending().A03430;
    if(failure==='backup') h.run('saveRecBak=function(){}');
    else h.run(`var originalSetItem=localStorage.setItem;localStorage.setItem=function(key,value){if(key==='fs_records')throw Error('synthetic local persistence failure');return originalSetItem.call(this,key,value)}`);
    await h.run(`openChatRoom('A03430')`);
    assert.equal(h.run('chatOpenId'),null);
    assert.equal(h.read('records[0].brand'),'Local recovery');
    assert.equal(JSON.parse(h.read(`recLastJson.A03430`)).brand,'Local recovery','failed persistence must leave version tracking on the local revision');
    assert.equal(h.nodes.fsJobSyncStatus.hidden,false);
    assert.deepEqual(h.pending().A03430,pendingBefore);
    assert.equal(h.read('window.__fsJobSync.recoveryDiagnostic.stage'),failure==='backup'?'local-backup':'local-persistence');
    assert.equal(h.read('window.__fsJobSync.recoveryDiagnostic.outcome'),'failed');
    if(failure==='persistence') assert.ok(JSON.parse(h.storage.get('fs_recbak')).A03430.some(entry=>entry.data.brand==='Local recovery'));
  });
});

test('automatic empty recovery keeps its block and outbox until exact acknowledgement',async()=>{
  const original=job('A03430');
  const h=harness({records:[original],handler:(path,opt)=>{
    if(path.startsWith('fs_records?')) return [];
    if(path==='rpc/fs_save_record') return {status:'saved',id:opt.body.p_id,data:{...opt.body.p_data,brand:'Different acknowledgement'}};
    return [];
  }});
  h.run(pull([original]));
  h.run(`records[0].brand='Local recovery';saveRecordsStore()`);
  await h.run('sbPush()');
  await h.run(`openChatRoom('A03430')`);
  assert.equal(h.run('chatOpenId'),null);
  assert.equal(h.nodes.fsJobSyncStatus.hidden,false);
  assert.ok(h.pending().A03430);
  assert.equal(h.read('window.__fsJobSync.recoveryDiagnostic.stage'),'recovery-request');
  assert.ok(JSON.parse(h.storage.get('fs_recbak')).A03430.some(entry=>entry.data.brand==='Local recovery'));
});

test('automatic recovery retains the original outbox when local staging fails',async()=>{
  const original=job('A03430');
  const h=harness({records:[original],handler:path=>path.startsWith('fs_records?')?[]:[]});
  h.run(pull([original]));
  h.run(`records[0].brand='Local recovery';saveRecordsStore()`);
  await h.run('sbPush()');
  const pendingBefore=h.pending().A03430;
  h.run(`var originalSetItem=localStorage.setItem;localStorage.setItem=function(key,value){if(key.indexOf('fs_job_outbox_v1:')===0)throw Error('synthetic persistence failure');return originalSetItem.call(this,key,value)}`);
  await h.run(`openChatRoom('A03430')`);
  assert.equal(h.run('chatOpenId'),null);
  assert.equal(h.nodes.fsJobSyncStatus.hidden,false);
  assert.deepEqual(h.pending().A03430,pendingBefore);
  assert.equal(h.read('records[0].brand'),'Local recovery');
  assert.equal(h.read('window.__fsJobSync.recoveryDiagnostic.stage'),'local-persistence');
});

test('automatic recovery restores every queued revision when a later outbox removal fails',async t=>{
  for(const centralRow of [true,false]) await t.test(centralRow?'central row':'explicit empty',async()=>{
    const original=job('A03430'), server={...original,brand:'Central copy'}, older={...original,brand:'Older queued'};
    const olderKey='fs_job_outbox_v1:sales:older-variant';
    const storage=new Map([[olderKey,JSON.stringify({version:1,owner:'sales',id:'A03430',tab:'other',data:older,expected:null,status:'pending',activities:[],at:2})]]);
    const h=harness({records:[original],storage,handler:path=>path.startsWith('fs_records?')?(centralRow?[{id:original.id,data:server}]:[]):[]});
    h.run(pull([original]));
    h.run(`records[0].brand='Local recovery';saveRecordsStore()`);
    await h.run('sbPush()');
    const originalEntries=Array.from(storage).filter(([key])=>key.startsWith('fs_job_outbox_v1:sales:'));
    assert.equal(originalEntries.length,2,'fixture must contain two distinct queued revisions');
    const originalKeys=new Set(originalEntries.map(([key])=>key));
    const remove=h.context.localStorage.removeItem;
    let removals=0;
    h.context.localStorage.removeItem=function(key){
      if(originalKeys.has(key) && ++removals===2) throw Error('synthetic second queued-key removal failure');
      return remove.call(this,key);
    };

    assert.equal(await h.run(`window.__fsJobSync.recoverLegacy('A03430','auto')`),false);
    assert.equal(removals,2,'the failure must follow one successful queued-key removal');
    for(const [key,value] of originalEntries) assert.equal(storage.get(key),value,`queued revision ${key} must remain recoverable`);
    const backups=JSON.parse(storage.get('fs_recbak')).A03430.map(entry=>entry.data.brand);
    assert.ok(backups.includes('Older queued'));
    assert.ok(backups.includes('Local recovery'));
    assert.equal(h.read('window.__fsJobSync.recoveryDiagnostic.stage'),'outbox-cleanup');
    assert.equal(h.read('window.__fsJobSync.recoveryDiagnostic.outcome'),'failed');
    assert.equal(h.run('chatOpenId'),null);
    assert.equal(h.nodes.fsJobSyncStatus.hidden,false);
  });
});

test('automatic recovery rejects a concurrent edit and preserves every queued variant',async()=>{
  let resolveLookup;
  const lookup=new Promise(resolve=>{resolveLookup=resolve;});
  const original=job('A03430'), older={...original,brand:'Older queued'}, server={...original,brand:'Central copy'};
  const key='fs_job_outbox_v1:sales:older-variant';
  const storage=new Map([[key,JSON.stringify({version:1,owner:'sales',id:'A03430',tab:'other',data:older,expected:null,status:'pending',activities:[],at:2})]]);
  const h=harness({records:[original],storage,handler:path=>path.startsWith('fs_records?')?lookup:[]});
  h.run(pull([original]));
  h.run(`records[0].brand='Local recovery';saveRecordsStore()`);
  await h.run('sbPush()');
  const recovery=h.run(`openChatRoom('A03430')`);
  h.run(`records[0].brand='Changed during lookup';saveRecordsStore()`);
  resolveLookup([{id:original.id,data:server}]);
  await recovery;
  assert.equal(h.run('chatOpenId'),null);
  assert.equal(h.nodes.fsJobSyncStatus.hidden,false);
  assert.equal(h.read('window.__fsJobSync.recoveryDiagnostic.stage'),'concurrency-check');
  assert.equal(storage.get(key),JSON.stringify({version:1,owner:'sales',id:'A03430',tab:'other',data:older,expected:null,status:'pending',activities:[],at:2}));
  assert.ok(Object.values(h.pending()).some(value=>value.data.brand==='Changed during lookup'));
});

test('automatic recovery retries after success without duplicate save or activity',async()=>{
  const original=job('A03430');
  const h=harness({records:[original],handler:(path,opt)=>path.startsWith('fs_records?')?[]:path==='rpc/fs_save_record'?{status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)}:[]});
  h.run(pull([original]));
  h.run(`records[0].brand='Local recovery';saveRecordsStore()`);
  await h.run('sbPush()');
  await h.run(`openChatRoom('A03430')`);
  assert.equal(h.run('chatOpenId'),'A03430');
  const count=h.calls.length, activities=h.read('activities.length');
  assert.equal(await h.run(`window.__fsJobSync.recoverLegacy('A03430','auto')`),false);
  await h.run(`openChatRoom('A03430')`);
  assert.equal(h.calls.length,count);
  assert.equal(h.read('activities.length'),activities);
});

test('blocked legacy job with a central row can discard local copy only after explicit server choice',async()=>{
  const original=job('A03430'), server={...original,brand:'Central copy'};
  const h=harness({records:[original],handler:(path,opt)=>{
    if(path.startsWith('fs_records?')) return [{id:original.id,data:server}];
    if(path==='rpc/fs_save_record') return {status:'conflict',id:opt.body.p_id};
    return [];
  }});
  h.run(pull([original]));
  h.run(`records[0].brand='Local recovery';`);
  await h.run('sbPush()');
  assert.equal(await h.run(`window.__fsJobSync.recoverLegacy('A03430','server')`),true);
  assert.equal(h.pending().A03430,undefined);
  assert.equal(h.read('records[0].brand'),'Central copy');
  assert.equal(h.calls.filter(call=>call.path==='rpc/fs_save_record').length,0);
  h.run(`openChatRoom('A03430')`);
  assert.equal(h.run('chatOpenId'),'A03430');
  assert.ok(JSON.parse(h.storage.get('fs_recbak')).A03430.some(entry=>entry.data.brand==='Local recovery'));
});

test('automatic legacy recovery cannot open chat before delegated startup readiness',async()=>{
  const original=job('A03430'), server={...original,brand:'Central copy'};
  const h=harness({records:[original],beforeAsset:`
    let sbErr='';
    function sbChip(){}
    function sbPull(){ return Promise.resolve({full:true,partial:false,rec:[],cht:[],usr:[],act:[],msg:[],apv:[]}); }
    window.__fsRuntimeBoot=function(){ return new Promise(function(){}); };
  `,handler:(path,opt)=>{
    if(path.startsWith('fs_records?')) return [{id:original.id,data:server}];
    if(path==='rpc/fs_save_record') return {status:'conflict',id:opt.body.p_id};
    return [];
  }});
  h.run('window.__fsCentralReady=true;window.__fsPermissionReady=true');
  h.run(pull([original]));
  h.run(`records[0].brand='Local recovery';saveRecordsStore()`);
  await h.run('sbPush()');
  assert.ok(h.pending().A03430,'the legacy write must be blocked before recovery');
  h.run('window.__fsCentralReady=false;window.__fsPermissionReady=false');
  const callsBefore=h.calls.length, backupBefore=h.storage.get('fs_recbak');

  await h.run(`openChatRoom('A03430')`);
  assert.equal(h.run('chatOpenId'),null,'automatic recovery must not open chat before delegated startup is ready');
  assert.equal(h.calls.length,callsBefore,'startup failure must not issue a recovery lookup or write');
  assert.equal(h.storage.get('fs_recbak'),backupBefore,'startup failure must not create a recovery backup');
  assert.deepEqual(h.read('window.__fsJobSync.recoveryDiagnostic'),{id:'A03430',choice:'auto',stage:'central-handshake',outcome:'failed'});
});

test('automatic recovery stops if startup readiness disappears during lookup',async()=>{
  let resolveLookup;
  const lookup=new Promise(resolve=>{resolveLookup=resolve;});
  const original=job('A03430'), server={...original,brand:'Central copy'};
  const h=harness({records:[original],beforeAsset:`
    let sbErr='';
    function sbChip(){}
    function sbPull(){ return Promise.resolve({full:true,partial:false,rec:[],cht:[],usr:[],act:[],msg:[],apv:[]}); }
    window.__fsRuntimeBoot=function(){ return new Promise(function(){}); };
  `,handler:path=>path.startsWith('fs_records?')?lookup:[]});
  h.run('window.__fsCentralReady=true;window.__fsPermissionReady=true');
  h.run(pull([original]));
  h.run(`records[0].brand='Local recovery';saveRecordsStore()`);
  await h.run('sbPush()');
  const prior=h.pending().A03430;
  const recovery=h.run(`openChatRoom('A03430')`);
  h.run('window.__fsCentralReady=false;window.__fsPermissionReady=false');
  resolveLookup([{id:original.id,data:server}]);
  await recovery;
  assert.equal(h.run('chatOpenId'),null);
  assert.deepEqual(h.pending().A03430,prior);
  assert.equal(h.read('records[0].brand'),'Local recovery');
  assert.deepEqual(h.read('window.__fsJobSync.recoveryDiagnostic'),{id:'A03430',choice:'auto',stage:'central-handshake',outcome:'failed'});
});

test('legacy server recovery records the first central lookup failure without payloads',async()=>{
  const original=job('A03430');
  const h=harness({records:[original],handler:path=>{
    if(path.startsWith('fs_records?')) throw Error('synthetic central request failure');
    return [];
  }});
  h.run(pull([original]));
  h.run(`records[0].brand='Local recovery';saveRecordsStore()`);
  await h.run('sbPush()');

  assert.equal(await h.run(`window.__fsJobSync.recoverLegacy('A03430','server')`),false);
  assert.deepEqual(h.read('window.__fsJobSync.recoveryDiagnostic'),{
    id:'A03430',choice:'server',stage:'central-lookup',outcome:'failed',
  });
  assert.equal(h.run('Object.keys(window.__fsJobSync.recoveryDiagnostic).some(key=>/data|record|error|message|token|payload/i.test(key))'),false);
});

test('legacy local recovery records a concurrent snapshot failure without clearing the review',async()=>{
  let resolveLookup;
  const lookup=new Promise(resolve=>{resolveLookup=resolve;});
  const original=job('A03430');
  const h=harness({records:[original],handler:path=>path.startsWith('fs_records?') ? lookup : []});
  h.run(pull([original]));
  h.run(`records[0].brand='Local recovery';saveRecordsStore()`);
  await h.run('sbPush()');

  const recovery=h.run(`window.__fsJobSync.recoverLegacy('A03430','local')`);
  h.run(`records[0].brand='Changed during review';saveRecordsStore()`);
  resolveLookup([]);

  assert.equal(await recovery,false);
  assert.deepEqual(h.read('window.__fsJobSync.recoveryDiagnostic'),{
    id:'A03430',choice:'local',stage:'concurrency-check',outcome:'failed',
  });
  assert.ok(h.pending().A03430,'the concurrent edit must remain recoverable');
});

test('blocked legacy server recovery preserves every queued revision before clearing the outbox',async()=>{
  const original=job('A03430'), server={...original,brand:'Central copy'}, older={...original,brand:'Older queued'};
  const storage=new Map([['fs_job_outbox_v1:sales:older-variant',JSON.stringify({version:1,owner:'sales',id:'A03430',tab:'other',data:older,expected:null,status:'pending',activities:[],at:2})]]);
  const h=harness({records:[original],storage,handler:(path,opt)=>{
    if(path.startsWith('fs_records?')) return [{id:original.id,data:server}];
    if(path==='rpc/fs_save_record') return {status:'conflict',id:opt.body.p_id};
    return [];
  }});
  h.run(pull([original]));
  h.run(`records[0].brand='Local recovery';saveRecordsStore()`);
  await h.run('sbPush()');
  assert.ok(h.pending().A03430,'the blocked legacy job must retain its queued revision');
  assert.equal(await h.run(`window.__fsJobSync.recoverLegacy('A03430','server')`),true);
  assert.deepEqual(h.pending(),{});
  const backups=JSON.parse(h.storage.get('fs_recbak')).A03430.map(entry=>entry.data.brand);
  assert.ok(backups.includes('Local recovery'));
  assert.ok(backups.includes('Older queued'));
  assert.equal(h.read('records[0].brand'),'Central copy');
});

test('blocked legacy recovery aborts when the local record changes during the central lookup',async()=>{
  let resolveLookup;
  const lookup=new Promise(resolve=>{resolveLookup=resolve;});
  const original=job('A03430'), server={...original,brand:'Central copy'};
  const h=harness({records:[original],handler:(path,opt)=>{
    if(path.startsWith('fs_records?')) return lookup;
    return [];
  }});
  h.run(pull([original]));
  h.run(`records[0].brand='Local recovery';saveRecordsStore()`);
  await h.run('sbPush()');
  const recovery=h.run(`window.__fsJobSync.recoverLegacy('A03430','server')`);
  h.run(`records[0].brand='Changed during review';saveRecordsStore()`);
  resolveLookup([{id:original.id,data:server}]);
  assert.equal(await recovery,false);
  assert.ok(h.pending().A03430,'the concurrent edit must remain recoverable');
  assert.equal(h.read('records[0]').brand,'Changed during review');
});

function verifier(h) {
  const fn=h.context.__fsJobSync && h.context.__fsJobSync.verifyCentralRecord;
  assert.equal(typeof fn,'function','the runtime must expose the exact central read-back gate');
  return fn;
}

function runtimeSha256Text(text) {
  const start=asset.indexOf('  function sha256RecordData(data) {');
  const end=asset.indexOf('  function writeRecordCacheOmissions',start);
  assert.ok(start>=0&&end>start,'the runtime SHA-256 helper is present');
  const context=vm.createContext({json:value=>value,encodeURIComponent,unescape,Uint8Array,DataView});
  return vm.runInContext(`${asset.slice(start,end)};sha256RecordData(${JSON.stringify(text)})`,context);
}

test('record cache SHA-256 helper matches standard empty and abc vectors',()=>{
  assert.equal(runtimeSha256Text(''),'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(runtimeSha256Text('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('central read-back verifies only the exact authorized ID and canonical data',async()=>{
  const data=job('A03901','Exact'),h=harness({records:[data],handler:path=>
    path==='fs_records?id=eq.A03901&select=id,data'?[{id:'A03901',data:structuredClone(data)}]:[]});
  await h.settle();
  assert.equal(await verifier(h)('A03901',data),true);
  assert.deepEqual(h.calls.filter(call=>call.path.startsWith('fs_records?')).map(call=>call.path),
    ['fs_records?id=eq.A03901&select=id,data'],'read-back uses the authorized, ID-targeted row route');
});

test('confirmed record stays in persisted fs_records until exact authorized read-back, then only the duplicate leaves storage',async()=>{
  let resolveRead;
  const data=job('A03908','Read-back gated'),readback=new Promise(resolve=>{resolveRead=resolve;});
  const h=harness({handler:(path,opt)=>{
    if(path==='rpc/fs_save_record') return {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
    if(path==='fs_records?id=eq.A03908&select=id,data') return readback;
    return [];
  }});
  h.context.__new=data; h.run('records.push(__new);saveRecordsStore()');
  const save=h.run('sbPush()'); await h.settle();
  try {
    assert.ok(h.calls.some(call=>call.path==='fs_records?id=eq.A03908&select=id,data'),
      'a matching HTTP acknowledgement must trigger the authorized central read-back');
    assert.deepEqual(JSON.parse(h.storage.get('fs_records')).map(row=>row.id),['A03908'],
      'the local duplicate remains durable while read-back is unresolved');
  } finally {
    resolveRead([{id:'A03908',data:structuredClone(data)}]);
  }
  await save;
  assert.equal(await verifier(h)('A03908',data),true);
  assert.deepEqual(JSON.parse(h.storage.get('fs_records')),[],
    'only the persisted duplicate is omitted after an exact ID and canonical data match');
  assert.equal(h.read('records[0].id'),'A03908','the active in-memory record remains open and editable');
});

test('a server commit with a lost acknowledgement stays pending until exact retry and read-back',async()=>{
  const data=job('A03907','Committed once'); let central=null,dropAck=true,saveCount=0;
  const h=harness({handler:(path,opt)=>{
    if(path==='rpc/fs_save_record') {
      saveCount++; central={id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
      if(dropAck){dropAck=false;throw new Error('synthetic timeout after commit');}
      return {status:'saved',...structuredClone(central)};
    }
    if(path==='fs_records?id=eq.A03907&select=id,data') return central?[structuredClone(central)]:[];
    return [];
  }});
  h.context.__new=data; h.run('records.push(__new);saveRecordsStore()');
  await h.run('sbPush()');
  assert.ok(h.pending().A03907,'a lost response cannot acknowledge the local journal');
  await h.run('sbPush()');
  assert.deepEqual(h.pending(),{},'an exact idempotent retry clears the matching pending journal');
  assert.equal(saveCount,2,'retry uses the same record ID instead of creating a duplicate');
  assert.equal(await verifier(h)('A03907',data),true,'reduction still waits for a targeted exact central read-back');
});

test('central read-back mismatch, malformed response, or offline timeout never verifies',async t=>{
  for(const [label,result] of [
    ['different data',[{id:'A03902',data:job('A03902','Different')}]],
    ['wrong ID',[{id:'A03903',data:job('A03902','Expected')}]],
    ['missing row',[]],
    ['malformed response',{id:'A03902',data:job('A03902','Expected')}],
  ]) await t.test(label,async()=>{
    const data=job('A03902','Expected'),h=harness({records:[data],handler:()=>result}); await h.settle();
    assert.equal(await verifier(h)('A03902',data),false);
  });
  const offline=harness({records:[job('A03902','Expected')],handler:()=>{throw new Error('synthetic read-back timeout after commit');}});
  await offline.settle();
  assert.equal(await verifier(offline)('A03902',job('A03902','Expected')),false);
});

test('pending and conflicted local writes block cache-reduction verification when central matches',async()=>{
  const data=job('A03904','Expected'),prior=job('A03904','Before edit');
  for(const status of ['pending','conflict']) {
    const h=harness({records:[prior],handler:(path,opt)=>{
      if(path.startsWith('fs_records?')) return [{id:'A03904',data:structuredClone(data)}];
      if(path==='rpc/fs_save_record') return {status:'conflict',id:'A03904'};
      return [];
    }});
    h.run("records[0].brand='Expected';saveRecordsStore()");
    assert.deepEqual(h.pending().A03904?.data,data,'the queue contains exactly the locally current data');
    if(status==='conflict') await h.run('sbPush()');
    if(status==='conflict') assert.equal(h.pending().A03904?.status,'conflict');
    assert.equal(await verifier(h)('A03904',data),false,`${status} local work must remain recoverable`);
  }
});

test('a failed fs_records compaction write keeps the exact original durable bytes',async()=>{
  const data=job('A03909','Exact'),originalBytes=JSON.stringify([data]),storage=new Map([['fs_records','[]']]);
  const h=harness({storage,handler:(path,opt)=>{
    if(path==='rpc/fs_save_record') return {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
    if(path==='fs_records?id=eq.A03909&select=id,data') return [{id:'A03909',data:structuredClone(data)}];
    return [];
  }});
  const setItem=h.context.localStorage.setItem;
  h.context.localStorage.setItem=function(key,value){
    if(key==='fs_records'&&String(value).indexOf('A03909')<0){const error=new Error('synthetic localStorage quota');error.name='QuotaExceededError';throw error;}
    return setItem.call(this,key,value);
  };
  h.context.__new=data; h.run('records.push(__new);saveRecordsStore()');
  await h.run('sbPush()');
  assert.ok(h.calls.some(call=>call.path==='fs_records?id=eq.A03909&select=id,data'),
    'compaction is attempted only after its authorized read-back proof');
  assert.equal(storage.get('fs_records'),originalBytes,'failed compaction leaves the exact prior record cache bytes intact');
});

test('account switch during read-back and newer local edits make verification unusable',async()=>{
  let resolveRead;
  const data=job('A03905','Expected'),lookup=new Promise(resolve=>{resolveRead=resolve;});
  const h=harness({records:[data],handler:path=>path.startsWith('fs_records?')?lookup:[]}); await h.settle();
  const check=verifier(h)('A03905',data);
  h.run("currentUser='pd'");
  resolveRead([{id:'A03905',data:structuredClone(data)}]);
  assert.equal(await check,false,'a read started by one account cannot verify under another account');
  h.run("currentUser='sales'");
  const second=verifier(h)('A03905',data);
  h.run("records[0].brand='Newer edit';saveRecordsStore()");
  assert.equal(await second,false,'a newer local revision cannot use the older read-back');
});

test('replayed verification is idempotent and preserves newer pending revisions',async()=>{
  const data=job('A03906','Expected'),h=harness({records:[data],handler:path=>
    path.startsWith('fs_records?')?[{id:'A03906',data:structuredClone(data)}]:[]});
  await h.settle();
  const check=verifier(h);
  assert.equal(await check('A03906',data),true);
  assert.equal(await check('A03906',data),true,'replay returns the same proof without duplicate side effects');
  h.run("records[0].brand='Newer edit';saveRecordsStore()");
  const before=h.pending().A03906;
  assert.equal(await check('A03906',data),false);
  assert.deepEqual(h.pending().A03906,before,'an older verified revision cannot remove the newer local queue entry');
});

test('cache compaction preserves another tab durable rows not held by this tab',async()=>{
  const data=job('A03910','Acknowledged'),other=job('A03911','Newer sibling tab');
  const storage=new Map([['fs_records','[]']]);
  const h=harness({storage,handler:(path,opt)=>{
    if(path==='rpc/fs_save_record') return {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
    if(path==='fs_records?id=eq.A03910&select=id,data') {
      storage.set('fs_records',JSON.stringify([data,other]));
      return [{id:'A03910',data:structuredClone(data)}];
    }
    return [];
  }});
  h.context.__new=data; h.run('records.push(__new);saveRecordsStore()');
  await h.run('sbPush()');
  assert.deepEqual(JSON.parse(storage.get('fs_records')),[other],
    'compaction removes only the exact acknowledged row and retains a durable row added by another tab');
});

test('a reload and full authorized pull do not repopulate an omitted acknowledged record',async()=>{
  const data=job('A03912','Acknowledged'),storage=new Map([['fs_records','[]']]);
  const first=harness({storage,handler:(path,opt)=>{
    if(path==='rpc/fs_save_record') return {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
    if(path==='fs_records?id=eq.A03912&select=id,data') return [{id:'A03912',data:structuredClone(data)}];
    return [];
  }});
  first.context.__new=data; first.run('records.push(__new);saveRecordsStore()');
  await first.run('sbPush()');
  assert.deepEqual(JSON.parse(storage.get('fs_records')),[],'exact read-back first reduces the duplicate');
  const marker=JSON.parse(storage.get('fs_record_cache_omissions_v1'));
  assert.equal(marker.version,1);
  assert.deepEqual(marker.entries.map(entry=>entry.id),['A03912']);
  assert.equal(marker.entries[0].sha256,createHash('sha256').update(first.run('stableStr(records[0])')).digest('hex'),
    'the compact marker carries the exact SHA-256 of canonical record data');
  assert.ok(storage.get('fs_record_cache_omissions_v1').length<160,
    'the durable marker stores a compact ID and SHA-256 revision signature, not the business record');

  const reload=harness({storage,handler:()=>[]});
  reload.run(pull([data]));
  assert.deepEqual(JSON.parse(storage.get('fs_records')),[],
    'a full authorized pull after reload must retain the durable cache-omission decision');

  const newer={...data,brand:'Newer central revision'};
  const changed=harness({storage,handler:()=>[]});
  changed.run(pull([newer]));
  assert.deepEqual(JSON.parse(storage.get('fs_records')),[newer],
    'a changed central revision is retained instead of matching the old omission marker');
  assert.deepEqual(JSON.parse(storage.get('fs_record_cache_omissions_v1')).entries,[],
    'the stale omission marker is cleared when the revision changes');
});

test('a new local edit clears its old omission marker and remains persisted while pending',async()=>{
  const data=job('A03913','Acknowledged'),h=harness({handler:(path,opt)=>{
    if(path==='rpc/fs_save_record') return {status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)};
    if(path==='fs_records?id=eq.A03913&select=id,data') return [{id:'A03913',data:structuredClone(data)}];
    return [];
  }});
  h.context.__new=data; h.run('records.push(__new);saveRecordsStore()');
  await h.run('sbPush()');
  assert.ok(h.storage.has('fs_record_cache_omissions_v1'));
  h.run("records[0].brand='New pending edit';saveRecordsStore()");
  assert.deepEqual(JSON.parse(h.storage.get('fs_record_cache_omissions_v1')).entries,[],
    'a new pending revision clears the prior revision omission marker');
  assert.equal(JSON.parse(h.storage.get('fs_records'))[0].brand,'New pending edit',
    'pending data remains in the local record cache');
});
