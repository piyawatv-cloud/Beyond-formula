import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, job, source, sealedHtml, pull } from './helpers/job-sync-client.mjs';

// 14–16 ต.ค. 2569: every pull refilled fs_chats with all rooms' messages, the
// write hit the quota and the store was slimmed again — for everyone, every day.
// The room store is now written in its slim form every time: messages central
// has acknowledged are dropped (they come back from fs_messages), unsent ones
// are kept, and no quota error is needed.
function liftSaveChats() {
  const start = sealedHtml.indexOf('function saveChats(){');
  return sealedHtml.slice(start, sealedHtml.indexOf('\n}', start) + 2);
}
const sealed = ['chatLastTs', 'chatUnread', 'markChatSeen'].map(source).concat(liftSaveChats()).join('\n');
const fetchHook = 'window.fetch=function(u,o){return __fetch(u,o);}; function nowTs(){return 9;}';
const room = id => ({ jobId: id, createdAt: 1, createdBy: 'sales', parts: [], approvals: {}, messages: [{ type: 'msg', user: 'pd', text: 'acknowledged', ts: 5 }, { type: 'msg', user: 'sales', text: 'unsent', ts: 6 }] });
const reports = h => h.calls.filter(call => call.path === '/__formula/client-diagnostic').map(call => JSON.parse(call.opt.body));
const stored = (storage) => JSON.parse(storage.get('fs_chats'));
const delegatedBoot = `
  let sbErr='',sbBusy=false,sbLastFull=0;
  function sbChip(){} function paint(){} function sbCycle(){}
  function sbReq(path,opt){ return __request(path,opt); }
  async function sbReqAll(path){
    const rows=[]; for(let from=0;;from+=1000){
      const page=await sbReq(path,{headers:{'Range-Unit':'items',Range:from+'-'+(from+999)}});
      if(!Array.isArray(page)) return from===0?page:rows;
      rows.push(...page); if(page.length<1000) return rows;
    }
  }
  async function sbPull(full){
    const [rec,cht,usr]=await Promise.all([
      sbReqAll('fs_records?select=id,data,updated_at&order=id.asc'),
      sbReqAll('fs_chats?select=job_id,data,updated_at&order=job_id.asc'),
      sbReqAll('fs_users?select=name,data,updated_at&order=name.asc')
    ]);
    let msg=null; try { msg=await sbReqAll('fs_messages?select=uid,job_id,ts,data,updated_at&order=uid.asc'); } catch(_) {}
    return {full:true,partial:!msg,rec:rec||[],cht:cht||[],usr:usr||[],act:[],msg,apv:[]};
  }
  sbGroup=function(rows,key){ const grouped={}; (rows||[]).forEach(row=>{(grouped[row[key]]||(grouped[row[key]]=[])).push(row);}); return grouped; };
  window.__fsRuntimeBoot=async function(){ const d=await sbPull(true); sbApply(d); };
  window.__fsSessionHandshake=Promise.resolve({status:200,authenticated:true});
  // This unit fixture already installs its synthetic actor before the asset.
  window.__fsSessionActorReady=Promise.resolve(true);
  window.__serverSnapshot={chats:[],messages:[]}; window.snapshotRequests=[]; window.scopedChildRequests=[];
  const originalRequest=window.__request;
  window.__request=async function(path,opt){
    if(!/^(fs_chats|fs_messages)\?/.test(String(path))) return originalRequest(path,opt);
    const table=String(path).split('?')[0],encoded=/(?:^|&)job_id=([^&]+)/.exec(String(path).split('?')[1]||'');
    if(!encoded) return originalRequest(path,opt); // Sealed partial core pull is deferred by the runtime asset.
    const filter=decodeURIComponent(encoded[1]);
    if(!filter.startsWith('in.(')&&!filter.startsWith('eq.')) throw Error('child read has malformed job scope');
    const ids=filter.startsWith('eq.')?[filter.slice(3)]:[...filter.matchAll(/"([^"]+)"/g)].map(match=>match[1]);
    if(!ids.length) throw Error('child read has no job IDs');
    const range=opt?.headers?.Range||'0-999',from=Number(range.split('-')[0]);
    window.scopedChildRequests.push({path:String(path),range,ids});
    const rows=table==='fs_chats'?window.__serverSnapshot.chats:window.__serverSnapshot.messages;
    return JSON.parse(JSON.stringify(rows.filter(row=>ids.includes(row.job_id)).slice(from,from+1000)));
  };
  window.fetch=async function(path,opt){
    window.snapshotRequests.push(String(path));
    if(String(path)==='/__formula/visible-record-ids') { const rows=await __request('fs_records?select=id&order=id.asc',{}); return {ok:true,status:200,json:async()=>({ids:rows.map(row=>row.id)})}; }
    if(String(path).startsWith('/__formula/scoped-chat-history?')) {
      const encoded=/(?:^|&)job_id=([^&]+)/.exec(String(path).split('?')[1]||'');
      if(!encoded)return {ok:false,status:400,json:async()=>({})};
      const filter=decodeURIComponent(encoded[1]),ids=filter.startsWith('eq.')?[filter.slice(3)]:[...filter.matchAll(/"([^"]+)"/g)].map(match=>match[1]);
      if(!ids.length||ids.length>50)return {ok:false,status:400,json:async()=>({})};
      const load=async(table,select,order)=>{const result=[];for(let from=0;;from+=1000){const rows=await __request(table+'?select='+select+'&job_id='+encoded[1]+'&order='+order,{headers:{'Range-Unit':'items',Range:from+'-'+(from+999)}});if(!Array.isArray(rows)||rows.length>1000)throw Error('synthetic scoped page incomplete');result.push(...rows);if(rows.length<1000)return result;}};
      try {const chats=await load('fs_chats','job_id,data,updated_at','job_id.asc'),messages=await load('fs_messages','uid,job_id,ts,data,updated_at','uid.asc');return {ok:true,status:200,json:async()=>({chats,messages})};}
      catch(error){return {ok:false,status:error.status||503,json:async()=>({})};}
    }
    if(String(path)!=='/__formula/visible-chat-snapshot') return {ok:false,status:404,json:async()=>({})};
    return {ok:true,status:200,json:async()=>JSON.parse(JSON.stringify(window.__serverSnapshot))};
  };
  window.saveChats=function(){ localStorage.setItem('fs_chats',JSON.stringify(chats)); };
`;

test('missing or declined actor completion never starts delegated history or scheduled refresh', async () => {
  for (const state of ['delete window.__fsSessionActorReady;', 'window.__fsSessionActorReady=Promise.resolve(false);']) {
    const h=harness({records:[job()],owner:'sales',beforeAsset:delegatedBoot+state,handler:async path=>
      path.startsWith('fs_records?')?[{id:'A03430',data:job()}]:[]});
    await h.settle();
    assert.equal(h.context.__fsCentralReady,false);
    assert.equal(h.run('sbReady'),false,'the sealed partial bootstrap must not leave local queue readiness open');
    assert.equal(h.run('sbErr'),'session actor unavailable');
    const reads=h.context.snapshotRequests.length;
    assert.equal(await h.run('sbCycle(true)'),false);
    assert.equal(h.context.snapshotRequests.length,reads,'focus/scheduled refresh cannot bypass unavailable actor');
    h.listeners.storage({key:'fs_chats',oldValue:'[]',newValue:'[]'}); await h.settle();
    assert.equal(h.context.snapshotRequests.length,reads,'cross-tab refresh also waits for bridge completion');
    assert.equal(h.context.snapshotRequests.includes('/__formula/visible-chat-snapshot'),false);
  }
});

test('the room store is written without acknowledged messages even when the quota is not hit, and reports once', async () => {
  const storage = new Map();
  const h = harness({ records: [job(), job('A03431')], chat: [room('A03430'), room('A03431')], storage, beforeAsset: sealed + fetchHook });
  h.run("sbSnap.msgs[msgUid('A03430', getChat('A03430').messages[0])] = 1;");
  h.run('saveChats();'); await h.settle();
  const rooms = stored(storage);
  assert.deepEqual(rooms.map(c => c.messages.map(m => m.text)), [['unsent'], ['acknowledged', 'unsent']], 'only the acknowledged message of the acknowledged room is dropped');
  assert.deepEqual(h.read('chats').map(c => c.messages.length), [2, 2], 'the page keeps every message in memory');
  h.run('saveChats();'); h.run('saveChats();'); await h.settle();
  assert.equal(reports(h).filter(r => r.stage === 'chat-storage' && r.reason === 'compact').length, 1, 'the compact write is reported once per page');
  assert.ok(!reports(h).some(r => r.reason === 'quota-exceeded' || r.reason === 'slimmed'));
});

test('before the acknowledgement map exists the store is written whole', async () => {
  const storage = new Map();
  const h = harness({ records: [job()], chat: [room('A03430')], storage, beforeAsset: sealed + fetchHook });
  h.run('sbSnap.msgs = null;');
  h.run('saveChats();'); await h.settle();
  assert.deepEqual(stored(storage)[0].messages.map(m => m.text), ['acknowledged', 'unsent']);
  assert.ok(!reports(h).some(r => r.reason === 'compact'));
});

test('delegated history persists only server-visible rooms while retaining pending messages', async () => {
  const storage = new Map();
  const ownerIdentity = JSON.stringify(['sales', 'test-sales', 'sales']);
  storage.set('fs_chat_cache_owner_v1', ownerIdentity);
  storage.set('fs_chat_pending_v1:' + encodeURIComponent(ownerIdentity), JSON.stringify([
    { jobId:'A03430', message:{ type:'msg', uid:'pending', text:'keep pending', ts:6 } },
  ]));
  const local = [
    { ...room('A03430'), messages: [{ type: 'msg', uid: 'acked', text: 'server copy', ts: 5 }, { type: 'msg', uid: 'pending', text: 'keep pending', ts: 6 }] },
    { ...room('A03431'), messages: [{ type: 'msg', uid: 'foreign', text: 'not visible', ts: 7 }] },
  ];
  const h = harness({ records: [job('A03430'), job('A03431')], chat: local, storage, owner: 'sales', beforeAsset: delegatedBoot, handler: async path => {
    if (path.startsWith('fs_records?')) return [
      { id: 'A03430', data: job('A03430') }, { id: 'A03431', data: job('A03431') },
    ];
    if (path.startsWith('fs_chats?') || path.startsWith('fs_users?')) return [];
    return [];
  }});
  h.context.__serverSnapshot = {
    chats: [{ job_id: 'A03430', data: { jobId: 'A03430', createdAt: 1, createdBy: 'sales', parts: [], approvals: {}, messages: [] } }],
    messages: [{ uid: 'acked', job_id: 'A03430', ts: 5, data: { type: 'msg', text: 'server copy', ts: 5 } }],
  };
  await h.settle();
  assert.equal(h.context.__fsCentralReady, true, 'the scoped history completes delegated readiness: '+h.run('sbErr'));
  assert.equal(h.context.snapshotRequests.includes('/__formula/visible-chat-snapshot'),false,
    'normal startup does not request the global history snapshot');
  assert.ok(h.context.snapshotRequests.includes('/__formula/visible-record-ids'));
  assert.equal(h.context.snapshotRequests.filter(path=>path.startsWith('/__formula/scoped-chat-history?')).length,1);
  assert.equal(h.context.scopedChildRequests.map(item=>item.path.split('?')[0]).join(','),'fs_chats,fs_messages');
  assert.ok(h.context.scopedChildRequests.every(item=>item.ids.join(',')==='A03430,A03431'&&item.range==='0-999'));
  const persisted = JSON.parse(storage.get('fs_chats'));
  assert.deepEqual(persisted.map(chat => chat.jobId), ['A03430'], 'no non-visible room is written to the shared chat cache');
  assert.deepEqual(persisted[0].messages.map(message => message.uid), ['pending'], 'acknowledged history is omitted and pending data remains');
});

test('history snapshot rows are intersected with the latest parent records before display', async () => {
  const storage = new Map();
  const h = harness({records:[job('A03430')],storage,owner:'sales',beforeAsset:delegatedBoot,handler:async path=>{
    if(path.startsWith('fs_records?select=id&')) return [{id:'A03430',data:job('A03430')}];
    if(path.startsWith('fs_records?select=id,data,')) return [];
    return [];
  }});
  h.context.__serverSnapshot={
    chats:[{job_id:'A03430',data:{jobId:'A03430',messages:[]}}],
    messages:[{uid:'revoked-message',job_id:'A03430',ts:7,data:{type:'msg',uid:'revoked-message',text:'must not display'}}],
  };
  await h.settle();
  assert.deepEqual(h.read('chats'),[],'a room removed from the later parent pull is not installed in memory');
  assert.deepEqual(JSON.parse(storage.get('fs_chats')),[],'a room removed during hydration is not persisted');
  assert.equal(h.context.__fsCentralReady,true,'the valid empty latest parent set can complete hydration');
});

test('same-name trusted role change replaces confirmed cache and isolates old pending data', async () => {
  const storage = new Map(), oldIdentity = JSON.stringify(['sales', 'test-sales', 'sales']);
  storage.set('fs_chat_cache_owner_v1', oldIdentity);
  storage.set('fs_chat_pending_v1:' + encodeURIComponent(oldIdentity), JSON.stringify([
    { jobId:'A03430', message:{type:'msg',uid:'old-pending',text:'keep for old identity',ts:8} },
  ]));
  const h = harness({records:[job('A03430'),job('A03431')],storage,owner:'sales',beforeAsset:delegatedBoot,
    handler:async path=>path.startsWith('fs_records?')
      ? [{id:'A03430',data:job('A03430')},{id:'A03431',data:job('A03431')}]
      : []});
  h.context.__serverSnapshot = {
    chats:[{job_id:'A03430',data:{jobId:'A03430',messages:[]}}],
    messages:[{uid:'old-ack',job_id:'A03430',ts:5,data:{type:'msg',uid:'old-ack',text:'confirmed'}}],
  };
  await h.settle();
  assert.equal(h.context.__fsCentralReady,true);
  h.setTrustedSession({name:'sales',role:'admin',centralUserId:'test-sales',authenticated:true});
  h.context.__serverSnapshot = {
    chats:[{job_id:'A03431',data:{jobId:'A03431',messages:[]}}], messages:[],
  };
  await h.run('sbCycle(true)'); await h.settle();
  const persisted = JSON.parse(storage.get('fs_chats'));
  assert.deepEqual(persisted.map(chat=>chat.jobId),['A03431'],'the newly trusted scope replaces old confirmed rooms');
  assert.deepEqual(JSON.parse(storage.get('fs_chat_pending_v1:'+encodeURIComponent(oldIdentity))).map(item=>item.message.uid),['old-pending'],
    'the prior identity retains only its explicit pending recovery entry');
});

test('same-session owner transfer prunes a room on the next scoped sync cycle', async () => {
  const storage = new Map(); let visible = true;
  const h = harness({records:[job('A03430')],storage,owner:'sales',beforeAsset:delegatedBoot,
    handler:async path=>path.startsWith('fs_records?')
      ? (visible ? [{id:'A03430',data:job('A03430')}] : [])
      : []});
  h.context.__serverSnapshot = {
    chats:[{job_id:'A03430',data:{jobId:'A03430',messages:[]}}],
    messages:[{uid:'confirmed',job_id:'A03430',ts:5,data:{type:'msg',uid:'confirmed',text:'confirmed'}}],
  };
  await h.settle();
  assert.deepEqual(JSON.parse(storage.get('fs_chats')).map(chat=>chat.jobId),['A03430']);
  h.run("chatOpenId='A03430'");
  visible = false;
  const priorScopeReads=h.calls.filter(call=>call.path.startsWith('fs_records?select=id&order=id.asc')).length;
  await Promise.all([h.run('sbCycle(true)'),h.run('sbCycle(true)')]); await h.settle();
  assert.deepEqual(JSON.parse(storage.get('fs_chats')),[], 'the current record scope removes rooms after ownership changes');
  assert.equal(h.run('chatOpenId'),null,'a room open in the interface closes immediately when its access is revoked');
  assert.equal(h.calls.filter(call=>call.path.startsWith('fs_records?select=id&order=id.asc')).length-priorScopeReads,2,
    'overlapping delegated cycles share one preflight and one final scope recheck');
});

test('failed pending recovery write keeps the previous durable chat cache intact', async () => {
  const storage = new Map(), oldIdentity = JSON.stringify(['sales','test-sales','sales']);
  storage.set('fs_chat_cache_owner_v1',oldIdentity);
  storage.set('fs_chat_pending_v1:'+encodeURIComponent(oldIdentity),JSON.stringify([
    {jobId:'A03430',message:{type:'msg',uid:'pending',text:'must survive',ts:9}},
  ]));
  const h = harness({records:[job('A03430')],storage,owner:'sales',beforeAsset:delegatedBoot,handler:async path=>
    path.startsWith('fs_records?')?[{id:'A03430',data:job('A03430')}]:[]});
  h.context.__serverSnapshot={chats:[{job_id:'A03430',data:{jobId:'A03430',messages:[]}}],messages:[]};
  await h.settle();
  h.run("chats[0].messages.push({uid:'new-before-quota',text:'must remain',ts:10})");
  const durableBefore=storage.get('fs_chats');
  const setItem=h.context.localStorage.setItem;
  h.context.localStorage.setItem=function(key,value){
    if(key.startsWith('fs_chat_journal_v2:')) throw new Error('synthetic quota failure');
    return setItem.call(this,key,value);
  };
  h.setTrustedSession({name:'sales',role:'admin',centralUserId:'test-sales',authenticated:true});
  h.context.__serverSnapshot={chats:[],messages:[]};
  await h.run('sbCycle(true)'); await h.settle();
  assert.equal(storage.get('fs_chats'),durableBefore,'the prior cache stays intact when pending recovery cannot be written');
  assert.equal(h.read('chats[0].messages[0].uid'),'pending','the prior in-memory room remains available when recovery cannot be written');
  assert.equal(h.context.__fsCentralReady,false,'scope stays closed after recovery storage fails');
});

test('snapshot failure preserves the pending message before closing the visible scope', async () => {
  const storage = new Map(), identity = JSON.stringify(['sales','test-sales','sales']);
  storage.set('fs_chat_cache_owner_v1',identity);
  storage.set('fs_chat_pending_v1:'+encodeURIComponent(identity),JSON.stringify([
    {jobId:'A03430',message:{type:'msg',uid:'pending-snapshot',text:'keep me',ts:10}},
  ]));
  const h = harness({records:[job('A03430')],storage,owner:'sales',chat:[{...room('A03430'),messages:[{type:'msg',uid:'pending-snapshot',text:'keep me',ts:10}]}],beforeAsset:delegatedBoot,
    handler:async path=>path.startsWith('fs_records?')?[{id:'A03430',data:job('A03430')}]:[]});
  h.context.__serverSnapshot={chats:[{job_id:'A03430',data:{jobId:'A03430',messages:[]}}],messages:[]};
  await h.settle();
  h.run("chatOpenId='A03430'");
  h.setTrustedSession({name:'sales',role:'admin',centralUserId:'test-sales',authenticated:true});
  h.context.fetch=async()=>({ok:false,status:503,json:async()=>({})});
  await h.run('sbCycle(true)'); await h.settle();
  assert.equal(h.run('chatOpenId'),null,'a snapshot failure closes the previously open room immediately');
  assert.equal(h.context.__fsCentralReady,false,'a failed scoped snapshot keeps central writes closed');
  assert.ok(JSON.parse(storage.get('fs_chat_pending_v1:'+encodeURIComponent(identity))).some(item=>item.message.uid==='pending-snapshot'),
    'the unacknowledged message is saved to identity-isolated recovery before stale rooms are cleared');
  assert.equal(storage.get('fs_chats'),'[]','the shared room cache is cleared after the pending message is safely recovered');
});

test('send-time recovery quota failure closes sync and reports that the message is not safely stored', async () => {
  const storage = new Map(), identity = JSON.stringify(['sales','test-sales','sales']);
  storage.set('fs_chat_cache_owner_v1',identity);
  const beforeAsset = delegatedBoot;
  const h = harness({records:[job('A03430')],storage,owner:'sales',chat:[room('A03430')],beforeAsset,
    handler:async path=>path.startsWith('fs_records?')?[{id:'A03430',data:job('A03430')}]:[]});
  h.context.__serverSnapshot={chats:[{job_id:'A03430',data:{jobId:'A03430',messages:[]}}],messages:[]};
  await h.settle(); h.run("chatOpenId='A03430';var composer=document.createElement('div'),input=document.createElement('textarea');input.id='chatInput';input.value='new message';composer.appendChild(input);document.body.appendChild(composer)");
  const setItem=h.context.localStorage.setItem;
  h.context.localStorage.setItem=function(key,value){
    if(key.startsWith('fs_chat_journal_v2:')) throw new Error('synthetic quota failure');
    return setItem.call(this,key,value);
  };
  assert.equal(await h.run('sendChatMsg()'),false,'the send is not reported as successful when its recovery copy cannot be saved');
  assert.equal(h.context.__fsCentralReady,false,'sync readiness closes after the pending ledger write fails');
  assert.equal(h.read("chats[0].messages.some(message=>message.text==='new message')"),false,'dispatch side effects wait for durable acknowledgement');
  assert.equal(h.run("document.getElementById('chatInput').value"),'new message','failed preservation retains the original composer');
  assert.match(h.run("document.getElementById('fsChatSendStatus').textContent"),/ยังส่งไม่สำเร็จ/,'the composer reports failed preservation');
});

test('unclassified legacy chat bytes are backed up before the scoped cache replaces them', async () => {
  const storage = new Map(), legacyBytes = JSON.stringify([{jobId:'A03430',messages:[{uid:'unknown',text:'unknown owner'}]}]);
  storage.set('fs_chats',legacyBytes);
  const h = harness({records:[job('A03430')],storage,owner:'sales',chat:[room('A03430')],beforeAsset:delegatedBoot,
    handler:async path=>path.startsWith('fs_records?')?[{id:'A03430',data:job('A03430')}]:[]});
  h.context.__serverSnapshot={chats:[{job_id:'A03430',data:{jobId:'A03430',messages:[]}}],messages:[]};
  await h.settle();
  assert.ok(journalRows(storage).some(item=>item.message?.uid==='unknown'),'unknown legacy message remains recoverable outside the visible room cache');
  assert.equal(JSON.parse(storage.get('fs_chats'))[0].jobId,'A03430');
});

test('account change closes the old scope and refreshes before the new actor becomes ready', async () => {
  const storage = new Map(), oldIdentity = JSON.stringify(['sales','test-sales','sales']); let owner = 'sales';
  storage.set('fs_chat_cache_owner_v1',oldIdentity);
  storage.set('fs_chat_pending_v1:'+encodeURIComponent(oldIdentity),JSON.stringify([
    {jobId:'A03430',message:{type:'msg',uid:'sales-pending',text:'sales pending',ts:9}},
  ]));
  const h = harness({records:[job('A03430'),job('A03431')],storage,owner:'sales',beforeAsset:delegatedBoot+`window.__chatRenderCalls=0;renderChat=function(){window.__chatRenderCalls++;};`,
    handler:async path=>path.startsWith('fs_records?')
      ? (owner==='sales'?[{id:'A03430',data:job('A03430')}]:[{id:'A03431',data:{...job('A03431'),createdBy:'pd'}}])
      : []});
  h.context.__serverSnapshot={chats:[{job_id:'A03430',data:{jobId:'A03430',messages:[]}}],messages:[]};
  await h.settle(); assert.equal(h.context.__fsCentralReady,true);
  h.run("chatOpenId='A03430';window.__chatRenderCalls=0");
  owner='pd'; h.setTrustedSession({name:'pd',role:'sales',centralUserId:'test-pd',authenticated:true});
  h.run("currentUser='pd'");
  h.context.__serverSnapshot={chats:[{job_id:'A03431',data:{jobId:'A03431',messages:[]}}],messages:[]};
  const switchedCycle=h.run('sbCycle(true)');
  assert.ok(h.context.__chatRenderCalls<10,'actor transition must not recursively redraw thousands of times: '+h.context.__chatRenderCalls);
  assert.equal(h.run('chatOpenId'),null,'actor change closes the old rendered chat before fetching the new scope');
  await switchedCycle;
  await h.settle();
  assert.equal(h.context.__fsCentralReady,true,'the new actor becomes ready only after its own scoped snapshot');
  assert.deepEqual(JSON.parse(storage.get('fs_chats')).map(chat=>chat.jobId),['A03431']);
  assert.deepEqual(JSON.parse(storage.get('fs_chat_pending_v1:'+encodeURIComponent(oldIdentity))).map(item=>item.message.uid),['sales-pending']);
});

test('client loads visible IDs with one coherent scope request instead of paging parent scans',async()=>{
 const h=harness({records:[job()],owner:'sales',beforeAsset:delegatedBoot,handler:async path=>path.startsWith('fs_records?')?[{id:'A03430',data:job()}]:[]});
 await h.settle(); await h.run('sbCycle(true)'); await h.settle();
 assert.ok(h.context.snapshotRequests.includes('/__formula/visible-record-ids'));
 assert.ok(h.calls.filter(c=>c.path==='fs_records?select=id&order=id.asc').every(c=>!c.opt?.headers?.Range));
});

const journalRows = storage => [...storage].filter(([key])=>key.startsWith('fs_chat_journal_v2:')).map(([,raw])=>JSON.parse(raw));
async function pendingTab(storage) {
 const h=harness({records:[job()],storage,owner:'sales',beforeAsset:delegatedBoot,handler:async path=>path.startsWith('fs_records?')?[{id:'A03430',data:job()}]:[]});
 h.context.__serverSnapshot={chats:[{job_id:'A03430',data:{jobId:'A03430',messages:[]}}],messages:[]};
 await h.settle(); return h;
}
test('two tabs interleave pending writes without replacing either message, then reload and replay once',async()=>{
 const storage=new Map();const a=await pendingTab(storage),b=await pendingTab(storage);
 a.run("chats[0].messages.push({uid:'tab-a',text:'first',ts:1})");
 b.run("chats[0].messages.push({uid:'tab-b',text:'second',ts:2})");
 const put=a.context.localStorage.setItem;let interleaved=false;
 a.context.localStorage.setItem=function(key,value){
  if(!interleaved && (key.startsWith('fs_chat_pending_v1:')||key.startsWith('fs_chat_journal_v2:'))){interleaved=true;b.run('saveChats()');}
  return put.call(this,key,value);
 };
 a.run('saveChats()');
 const reopened=await pendingTab(storage);
 assert.deepEqual(reopened.read('chats[0].messages.map(m=>m.uid).sort()'),['tab-a','tab-b']);
 reopened.run('saveChats(); saveChats()');
 assert.equal(journalRows(storage).filter(r=>r.kind==='pending').length,2,'replaying equal bytes is idempotent');
});

test('snapshot reconciliation removes only exact acknowledged job uid and data while retaining concurrent variants',async()=>{
 const storage=new Map(),a=await pendingTab(storage),b=await pendingTab(storage);
 a.run("chats[0].messages.push({uid:'same',text:'first',ts:1});saveChats()");
 b.run("chats[0].messages.push({uid:'same',text:'different',ts:1});saveChats()");
 const ack=harness({records:[job()],storage,owner:'sales',beforeAsset:delegatedBoot,handler:async path=>path.startsWith('fs_records?')?[{id:'A03430',data:job()}]:[]});
 ack.context.__serverSnapshot={chats:[{job_id:'A03430',data:{jobId:'A03430',messages:[]}}],messages:[{job_id:'A03430',uid:'same',data:{uid:'same',text:'first',ts:1}}]};
 await ack.settle();
 assert.ok(journalRows(storage).some(r=>r.message?.text==='different'),'different data with same uid is recoverable');
 assert.ok(!journalRows(storage).some(r=>r.kind==='pending'&&r.message?.text==='first'),'exact confirmed version is retired');
 const reloaded=await pendingTab(storage);
 assert.ok(reloaded.read('chats[0].messages.some(m=>m.text==="different")'));
});

test('unclassified legacy cache reconciles per item and retains unknown bytes rather than a full confirmed history copy',async()=>{
 const storage=new Map();
 storage.set('fs_chats',JSON.stringify([{jobId:'A03430',messages:[{uid:'acked',text:'already central'},{uid:'uncertain',text:'keep me'}]}]));
 const h=harness({records:[job()],storage,owner:'sales',beforeAsset:delegatedBoot,handler:async path=>path.startsWith('fs_records?')?[{id:'A03430',data:job()}]:[]});
 h.context.__serverSnapshot={chats:[{job_id:'A03430',data:{jobId:'A03430'}}],messages:[{job_id:'A03430',uid:'acked',data:{uid:'acked',text:'already central'}}]};
 await h.settle();
 assert.equal(storage.has('fs_chat_unclassified_recovery_v1'),false);
 const saved=journalRows(storage);
 assert.ok(saved.some(r=>r.message?.uid==='uncertain'),'unclassified unacknowledged data is durable');
 assert.ok(!JSON.stringify(saved).includes('already central'),'only exact server-confirmed history is removed');
 assert.ok(!h.read('chats').some(r=>r.messages.some(m=>m.uid==='uncertain')),'unknown authorship never automatically sends or displays the item');
});

test('a stale fs_chats storage event cannot overwrite another tab pending message',async()=>{
 const storage=new Map();
 const beforeAsset=delegatedBoot+`addEventListener('storage',function(e){if(e.key==='fs_chats') chats=JSON.parse(e.newValue);});`;
 const h=harness({records:[job()],storage,owner:'sales',beforeAsset,handler:async path=>path.startsWith('fs_records?')?[{id:'A03430',data:job()}]:[]});
 h.context.__serverSnapshot={chats:[{job_id:'A03430',data:{jobId:'A03430',messages:[]}}],messages:[]};await h.settle();
 h.run("chats[0].messages.push({uid:'unseen-other-tab',text:'must survive',ts:1});saveChats()");
 h.listeners.storage({key:'fs_chats',newValue:'[]'});await h.settle();
 assert.ok(h.read('chats.some(r=>r.messages.some(m=>m.uid==="unseen-other-tab"))'));
});

test('a journal revision inserted during acknowledgement retirement survives reload',async()=>{
 const storage=new Map();const a=await pendingTab(storage),b=await pendingTab(storage);
 a.run("chats[0].messages.push({uid:'race',text:'acked',ts:1});saveChats()");
 b.run("chats[0].messages.push({uid:'race',text:'new revision',ts:1})");
 const h=harness({records:[job()],storage,owner:'sales',beforeAsset:delegatedBoot,handler:async path=>path.startsWith('fs_records?')?[{id:'A03430',data:job()}]:[]});
 h.context.__serverSnapshot={chats:[{job_id:'A03430',data:{jobId:'A03430',messages:[]}}],messages:[{job_id:'A03430',uid:'race',data:{uid:'race',text:'acked',ts:1}}]};
 const remove=h.context.localStorage.removeItem;let interleaved=false;
 h.context.localStorage.removeItem=function(key){if(key.startsWith('fs_chat_journal_v2:')&&!interleaved){interleaved=true;b.run('saveChats()');}return remove.call(this,key);};
 await h.settle();assert.equal(interleaved,true);
 const reopened=await pendingTab(storage);assert.ok(reopened.read('chats.some(r=>r.messages.some(m=>m.text==="new revision"))'));
});

test('matching uid in another job cannot acknowledge unclassified local data',async()=>{
 const storage=new Map([['fs_chats',JSON.stringify([{jobId:'A03431',messages:[{uid:'same',text:'keep'}]}])]]);
 const h=harness({records:[job()],storage,owner:'sales',beforeAsset:delegatedBoot,handler:async path=>path.startsWith('fs_records?')?[{id:'A03430',data:job()}]:[]});
 h.context.__serverSnapshot={chats:[{job_id:'A03430',data:{jobId:'A03430'}}],messages:[{job_id:'A03430',uid:'same',data:{uid:'same',text:'keep'}}]};
 await h.settle();assert.ok(journalRows(storage).some(r=>r.jobId==='A03431'&&r.message?.uid==='same'));
});

test('retired legacy pending entries do not resurrect on another save or reload',async()=>{
 const identity=JSON.stringify(['sales','test-sales','sales']),message={uid:'already-acked',text:'server copy',ts:1};
 const storage=new Map([['fs_chat_pending_v1:'+encodeURIComponent(identity),JSON.stringify([{jobId:'A03430',message}])]]);
 const h=harness({records:[job()],storage,owner:'sales',beforeAsset:delegatedBoot,handler:async path=>path.startsWith('fs_records?')?[{id:'A03430',data:job()}]:[]});
 h.context.__serverSnapshot={chats:[{job_id:'A03430',data:{jobId:'A03430',messages:[]}}],messages:[{job_id:'A03430',uid:message.uid,data:message}]};await h.settle();
 h.run('saveChats()');
 assert.ok(!journalRows(storage).some(r=>r.message?.uid===message.uid),'imported acknowledgement is not recreated from a retained old-tab array');
});

test('a same-owner cache marker does not prove that an unjournaled message is safe to discard',async()=>{
 const storage=new Map([['fs_chat_cache_owner_v1',JSON.stringify(['sales','test-sales','sales'])],['fs_chats',JSON.stringify([{jobId:'A03430',messages:[{uid:'unjournaled',text:'not proven central'}]}])]]);
 const h=await pendingTab(storage);
 assert.ok(journalRows(storage).some(r=>r.message?.uid==='unjournaled'),'unknown bytes survive before replacing a cache even if its old owner marker matches');
 assert.ok(!h.read('chats').some(r=>r.messages.some(m=>m.uid==='unjournaled')),'ownership marker alone cannot authorize replay');
});

test('a normal full sync retires a pending entry after exact authorized readback without reloading',async()=>{
 const storage=new Map(),h=await pendingTab(storage);
 h.run("chats[0].messages.push({uid:'ordinary-sync',text:'sent',ts:1});saveChats()");
 await h.run('sbCycle(true)');await h.settle();
 h.context.__full={full:true,partial:false,rec:[{id:'A03430',data:job()}],cht:[{job_id:'A03430',data:{jobId:'A03430',messages:[]}}],msg:[{job_id:'A03430',uid:'ordinary-sync',data:{uid:'ordinary-sync',text:'sent',ts:1}}],usr:[],act:[],apv:[]};
 h.run('sbApply(__full)');
 assert.ok(!journalRows(storage).some(r=>r.kind==='pending'&&r.message?.uid==='ordinary-sync'));
});

test('an old sealed tab cache event is retained before a failed scope refresh clears shared history',async()=>{
 const storage=new Map(),h=await pendingTab(storage);
 const legacy=JSON.stringify([{jobId:'A03430',messages:[{uid:'old-tab-unsent',text:'legacy draft'}]}]);
 storage.set('fs_chats',legacy);h.context.fetch=async()=>({ok:false,status:503,json:async()=>({})});
 h.listeners.storage({key:'fs_chats',newValue:legacy});await h.settle();
 assert.ok(journalRows(storage).some(r=>r.message?.uid==='old-tab-unsent'),'old-tab bytes are preserved before the new tab can clear a failed scope');
});

for (const cleared of ['[]',null]) test(`storage event preserves oldValue when a sibling ${cleared===null?'removes':'empties'} fs_chats`,async()=>{
 const storage=new Map(),h=await pendingTab(storage);
 const previous=JSON.stringify([{jobId:'A03430',messages:[{uid:'only-in-old-value',text:'must remain durable'}]}]);
 if(cleared===null) storage.delete('fs_chats');else storage.set('fs_chats',cleared);
 h.context.fetch=async()=>({ok:false,status:503,json:async()=>({})});
 h.listeners.storage({key:'fs_chats',oldValue:previous,newValue:cleared});await h.settle();
 assert.ok(journalRows(storage).some(r=>r.message?.uid==='only-in-old-value'));
 const reloaded=await pendingTab(storage);
 assert.ok(journalRows(storage).some(r=>r.message?.uid==='only-in-old-value'),'still recoverable after reload');
 assert.ok(!reloaded.read('chats').some(r=>r.messages.some(m=>m.uid==='only-in-old-value')),'unknown old bytes are not automatically replayed');
});


test('supported older-page sender preserves sealed behavior behind confirmed parent and permission gates',async()=>{
 const h=harness({records:[job()],chat:[{...room('A03430'),messages:[]}],beforeAsset:`window.__sealedSend=sendChatMsg;window.senderEvents=[];function logAct(...args){senderEvents.push(['activity',...args]);}function touchChatPart(...args){senderEvents.push(['touch',args[0].jobId,args[1],args[2]]);}function renderChat(){senderEvents.push(['render']);}function saveChats(){senderEvents.push(['save']);}`});
 h.run(pull([job()]));await h.settle();
 const input=h.context.document.createElement('textarea');input.id='chatInput';input.value='  original Thai draft 🧪  ';h.context.document.body.appendChild(input);
 h.run("chatOpenId='A03430';senderEvents=[];");
 await h.run('sendChatMsg()');
 assert.deepEqual(h.read('getChat("A03430").messages'),[{type:'msg',user:'sales',text:'original Thai draft 🧪',ts:1}]);
 assert.equal(input.value,'');assert.equal(h.context.document.activeElement,input);
 const wrappedEvents=h.read('senderEvents');
 h.run('getChat("A03430").messages=[];senderEvents=[];');input.value='  original Thai draft 🧪  ';
 h.run('__sealedSend()');assert.deepEqual(h.read('senderEvents'),wrappedEvents,'actual sealed sender keeps activity/touch/save/render order');
 h.run('getChat("A03430").messages=[];requirePerm=()=>false;');input.value='denied';
 await h.run('sendChatMsg()');assert.equal(input.value,'denied');assert.deepEqual(h.read('getChat("A03430").messages'),[]);
 h.run('requirePerm=()=>true;records[0].brand="unconfirmed local change";');input.value='unconfirmed';
 await h.run('sendChatMsg()');assert.equal(input.value,'unconfirmed');assert.deepEqual(h.read('getChat("A03430").messages'),[]);
 assert.equal([...h.storage.keys()].some(key=>key.startsWith('fs_chat_pending_v1:')||key.startsWith('fs_chat_journal_v2:')),false,'legacy compatibility never invents a trusted tuple');
});

for(const status of [401,503])test('a failed '+status+' visible-ID read never starts independent core history or advances unapplied progress',async()=>{
 const boot=delegatedBoot+`
 window.__fsRuntimeBoot=async function(){};
 sbPull=async function(){window.__coreStarted=true;await new Promise(resolve=>window.__releaseCore=resolve);sbWM.rec='late-unapplied';sbCap.msg=false;sbLastFull=77;return {full:true,partial:false,rec:[],cht:[],usr:[],act:[],msg:[],apv:[]};};
 const nativeFetch=window.fetch;window.fetch=async function(path,opt){if(path==='/__formula/visible-record-ids')return {ok:false,status:${status},json:async()=>({})};return nativeFetch(path,opt);};`;
 const h=harness({records:[job()],owner:'sales',beforeAsset:boot});await h.settle();
 assert.equal(h.context.__coreStarted,undefined,'failed authorized snapshot prevents independent core history from starting');
 assert.equal(h.context.__releaseCore,undefined,'there is no pending late core operation to escape failure cleanup');
 assert.equal(h.context.__fsCentralReady,false);assert.equal(h.run('sbReady'),false,'visible-ID failure keeps writes closed');
 assert.equal(h.run('sbWM.rec'),'');assert.equal(h.run('sbCap.msg'),true,'failed scope cannot advance core capability progress');assert.equal(h.run('sbLastFull'),0,'failed scope cannot advance full-read progress');
 assert.equal(h.context.__fsCentralReady,false);assert.match(h.run('sbErr'),/visible record scope/);
});

test('role change while scoped child history waits cannot apply old history and fresh ordinary recovery succeeds',async()=>{
 const boot=delegatedBoot+`
 window.__fsRuntimeBoot=async function(){};
 const nativeRequest=window.__request;window.__request=async function(path,opt){if(path.startsWith('fs_messages?')&&!window.__snapshotHeld){window.__snapshotHeld=true;await new Promise(resolve=>window.__releaseSnapshot=resolve);}return nativeRequest(path,opt);};`;
 const h=harness({records:[job()],owner:'sales',beforeAsset:boot,handler:async path=>path.startsWith('fs_records?')?[{id:'A03430',data:job()}]:[]});
 h.context.__serverSnapshot={chats:[{job_id:'A03430',data:{jobId:'A03430',messages:[]}}],messages:[{uid:'prior-role',job_id:'A03430',data:{uid:'prior-role',text:'old authority',ts:1}}]};
 await h.settle();assert.equal(typeof h.context.__releaseSnapshot,'function');assert.equal(h.context.__fsCentralReady,false);
 h.setTrustedSession({name:'sales',role:'pd',centralUserId:'test-sales',authenticated:true});h.run('__releaseSnapshot()');await h.settle();
 assert.equal(h.context.__fsCentralReady,false);assert.equal(h.read('chats').some(c=>c.messages.some(m=>m.uid==='prior-role')),false);
 h.context.__serverSnapshot={chats:[{job_id:'A03430',data:{jobId:'A03430',messages:[]}}],messages:[]};
 await h.run('sbCycle(false)');await h.settle();assert.equal(h.context.__fsCentralReady,true);
 assert.equal(JSON.parse(h.storage.get('fs_chat_cache_owner_v1'))[2],'pd');
});


test('same-name role handoff cannot erase a failed save during its scope await',async()=>{
 const h=harness({records:[job()],owner:'sales',beforeAsset:delegatedBoot,handler:async path=>path.startsWith('fs_records?')?[{id:'A03430',data:job()}]:[]});
 h.context.__serverSnapshot={chats:[{job_id:'A03430',data:{jobId:'A03430',messages:[]}}],messages:[]};
 await h.settle();assert.equal(h.context.__fsCentralReady,true);
 h.setTrustedSession({name:'sales',role:'pd',centralUserId:'test-sales',authenticated:true});
 h.run(`window.__realFetch=window.fetch;window.fetch=async function(path,opt){if(path==='/__formula/visible-record-ids'&&!window.__scopeHeld){window.__scopeHeld=true;await new Promise(resolve=>window.__releaseScope=resolve);}return window.__realFetch(path,opt);};`);
 const attempt=h.run('sbCycle(false)');await h.settle();assert.equal(typeof h.context.__releaseScope,'function');
 h.run(`window.__realSet=localStorage.setItem;localStorage.setItem=function(key,value){if(key==='fs_chats')throw new Error('synthetic save denial');return window.__realSet(key,value);};saveChats();localStorage.setItem=window.__realSet;`);
 assert.equal(h.context.__fsCentralReady,false,'the real save failure closes writes');
 h.run('__releaseScope()');const result=await attempt;await h.settle();
 assert.equal(h.context.__fsCentralReady,false,'the captured attempt cannot adopt a new failure epoch through fresh history');assert.equal(result,false);assert.match(h.run('sbErr'),/chat cache save failed/);
 await h.run('sbCycle(false)');await h.settle();assert.equal(h.context.__fsCentralReady,true,'a genuinely fresh ordinary attempt may recover');
 assert.equal(JSON.parse(h.storage.get('fs_chat_cache_owner_v1'))[2],'pd');
});


test('same-identity closed scope keeps ordinary preflight before complete history recovery',async()=>{
 const h=harness({records:[job()],owner:'sales',beforeAsset:delegatedBoot,handler:async path=>path.startsWith('fs_records?')?[{id:'A03430',data:job()}]:[]});
 h.context.__serverSnapshot={chats:[{job_id:'A03430',data:{jobId:'A03430',messages:[]}}],messages:[]};
 await h.settle();assert.equal(h.context.__fsCentralReady,true);
 h.run(`window.__realFetch=window.fetch;window.fetch=async function(path,opt){if(path==='/__formula/visible-record-ids')return {ok:false,status:503,json:async()=>({})};return window.__realFetch(path,opt);};`);
 assert.equal(await h.run('sbCycle(false)'),false);assert.equal(h.context.__fsCentralReady,false);
 h.run('window.fetch=window.__realFetch;window.snapshotRequests=[];');
 await h.run('sbCycle(false)');await h.settle();
 assert.equal(h.context.snapshotRequests[0],'/__formula/visible-record-ids','same identity uses the existing ordinary preflight before any complete history rebuild');
 assert.equal(h.context.__fsCentralReady,true);
});
