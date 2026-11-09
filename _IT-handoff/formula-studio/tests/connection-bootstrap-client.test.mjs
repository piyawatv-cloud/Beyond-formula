import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {harness,job,source,pull,sealedHtml} from './helpers/job-sync-client.mjs';
const bridge=readFileSync(new URL('../runtime/assets/fs-session-bridge.js',import.meta.url),'utf8');
const saveChatsStart=sealedHtml.indexOf('function saveChats(){');
const sealedSaveChats=sealedHtml.slice(saveChatsStart,sealedHtml.indexOf('\n}',saveChatsStart)+2);
const runtime = `
  var __documentEvents={};document.addEventListener=function(name,fn){__documentEvents[name]=fn;};
  const SB_PAGE=1000,SB_LAG_MS=5000,SB_FULL_MS=60000;
  let sbErr='',sbBusy=false,sbLastFull=0,sbCycleN=0,sbCycleRunning=false,sbCycleAgain=false,sbTimer=null;
  let sbLastBusy=0; var __time=100000,__timers=[],__nextTimer=0,__fulls=[],__renders=0;
  Date=class extends Date {static now(){return __time;}};
  setTimeout=function(fn,ms){var t={id:++__nextTimer,fn,ms,at:__time+ms};__timers.push(t);return t.id;};
  clearTimeout=function(id){__timers=__timers.filter(t=>t.id!==id);};
  function loadChats(){chats=JSON.parse(localStorage.getItem('fs_chats') || '[]');} function sbOn(){return true;} function sbNextDelay(){return 9000;} function sbChip(){}
  function sbSchedule(){clearTimeout(sbTimer);sbTimer=setTimeout(()=>sbCycle(false),sbNextDelay());}
  function sbWMBack(v){return v;} function renderChat(){__renders++;}
  ${['sbReqAll','sbPull','sbCycle','sbGroup','sbBuildChat','mergeParts','mergeChatPayload'].map(source).join('\n')}
  var __realPull=sbPull;sbPull=function(full){__fulls.push(full);return __realPull(full);};
  window.__fsRuntimeBoot=async function(){};
  window.__fsSessionActorReady=Promise.resolve(true);
  window.__fsSessionHandshake=Promise.resolve({status:200,authenticated:true});
  window.__scopeReadCount=0;window.__snapshotReadCount=0;window.__scope=['A04042'];window.__snapshot={chats:[],messages:[]};window.__scopeError=0;window.__historyTrace=[];
  var __trackedReq=sbReq;sbReq=function(path,opt){if(/^(fs_chats|fs_messages)\?/.test(path)&&path.includes('job_id='))__historyTrace.push({type:'child',path,range:opt?.headers?.Range});return __trackedReq.apply(this,arguments);};
  window.fetch=async function(path,opt){
    if(path==='/__formula/visible-record-ids'){__historyTrace.push({type:'ids'});__scopeReadCount++;return {ok:!__scopeError,status:__scopeError||200,json:async()=>({ids:__scope})};}
    if(String(path).startsWith('/__formula/scoped-chat-history?')){
      const encoded=/(?:^|&)job_id=([^&]+)/.exec(String(path).split('?')[1]||'');
      if(!encoded)return {ok:false,status:400,json:async()=>({})};
      const filter=decodeURIComponent(encoded[1]),ids=filter.startsWith('eq.')?[filter.slice(3)]:[...filter.matchAll(/"([^"]+)"/g)].map(match=>match[1]);
      __historyTrace.push({type:'history',path,ids});
      if(!ids.length||ids.length>50)return {ok:false,status:400,json:async()=>({})};
      if(ids.some(id=>!__scope.includes(id)))return {ok:false,status:403,json:async()=>({})};
      const load=async(table,select,order)=>{const result=[];for(let from=0;;from+=1000){const range=from+'-'+(from+999),child=table+'?select='+select+'&job_id='+encoded[1]+'&order='+order;__historyTrace.push({type:'child',path:child,range});const rows=await __trackedReq(child,{headers:{'Range-Unit':'items',Range:range}});if(!Array.isArray(rows)||rows.length>1000)throw Error('synthetic scoped page incomplete');result.push(...rows);if(rows.length<1000)return result;}};
      try{const chats=await load('fs_chats','job_id,data,updated_at','job_id.asc'),messages=await load('fs_messages','uid,job_id,ts,data,updated_at','uid.asc');return {ok:true,status:200,json:async()=>({chats,messages})};}
      catch(error){return {ok:false,status:error.status||503,json:async()=>({})};}
    }
    if(path==='/__formula/visible-chat-snapshot'){__snapshotReadCount++;return {ok:true,status:200,json:async()=>__snapshot};}
    return __fetch(path,opt);
  };
`;
const stamp='2026-10-01T00:00:00Z';
async function fixture(mode='healthy',role='sales',storage=new Map(),{allowSave=false,chatSave=false}={}) {
 const rows={fs_records:[{id:'A04042',data:job('A04042'),updated_at:stamp}],fs_chats:[{job_id:'A04042',data:{jobId:'A04042',createdBy:'sales',parts:[]},updated_at:stamp}],fs_messages:Array.from({length:1001},(_,i)=>({job_id:'A04042',uid:'m'+i,ts:i,data:{uid:'m'+i,text:'synthetic '+i,type:'msg',ts:i},updated_at:stamp})),fs_approvals:[],fs_users:[{name:'sales',data:{name:'sales',role},updated_at:stamp}],fs_meta:[],fs_activities:[]};
 let healthy=mode==='healthy', heldUsers=null; const reads=[],writes=[],writeAttempts=[];
 const setup=runtime.replace('function sbWMBack(v){return v;}',`${chatSave?sealedSaveChats:''} function sbWMBack(v){return v;}`).replace('window.__fsRuntimeBoot=async function(){};',`${source('sbBoot')}
 function sbLoadWritePermission(){${allowSave?'sbCanEdit=true;return Promise.resolve();':'return new Promise(()=>{});'}}
 let sbPushTimer=null;const SB_SEND_MS=150;${source('sbQueue')}
 function sbFillIdPool(){return Promise.resolve();} function sbTouchBusy(){}
 window.__bootN=0;window.__fsRuntimeBoot=function(){__bootN++;return sbBoot();};`)
 .replace('window.__fsSessionActorReady=Promise.resolve(true);','').replace('window.__fsSessionHandshake=Promise.resolve({status:200,authenticated:true});','')+`
 var impersonator='';document.querySelectorAll=function(){return [];};document.querySelector=function(){return null;};
 window.currentRole=function(){var user=userList.find(u=>u.name===currentUser);return user?user.role:'';};window.afterUserChange=function(){window.__installs=(window.__installs||0)+1;};window.switchView=function(){};
 window.logoutUser=function(){currentUser='';window.afterUserChange();};window.location={};window.__sessions=0;window.__healthy=${healthy};window.__mode=${JSON.stringify(mode)};window.__sessionName='sales';
 window.__priorFetch=window.fetch;window.fetch=async function(path,opt){
  if(path==='/sb/session'){
   if(opt.method==='DELETE')return {status:200,json:async()=>({})};
   __sessions++;if(!__healthy&&__mode==='network')throw Error('synthetic network');
   if(!__healthy&&__mode==='hung')return new Promise(resolve=>window.__lateSession=resolve);
   var status=!__healthy&&__mode==='session503'?503:__mode==='denied401'?401:__mode==='denied403'?403:200;
   return {ok:status===200,status,json:async()=>!__healthy&&__mode==='hung-body'?new Promise(resolve=>window.__lateBody=resolve):({authenticated:status===200&&__mode!=='anonymous',name:__sessionName,role:${JSON.stringify(role)},centralUserId:'test-'+__sessionName})};
  }return __priorFetch(path,opt);
 };window.__fsSessionFetch=window.fetch;
 ${bridge}`;
 const h=harness({owner:'',storage,beforeAsset:setup,handler:async(path,opt)=>{
  if(opt?.method&&opt.method!=='GET')writeAttempts.push({path,method:opt.method});
  if(allowSave && path==='rpc/fs_save_record'){
   writes.push(structuredClone(opt.body));const row=rows.fs_records.find(row=>row.id===opt.body.p_id);assert.ok(row);row.data=structuredClone(opt.body.p_data);return {status:'saved',id:row.id,data:structuredClone(row.data)};
  }
  if(allowSave&&opt?.method==='POST'&&/^(fs_messages|fs_chats)\?/.test(path))return structuredClone(opt.body);
  assert.ok(!opt?.method || opt.method==='GET','bootstrap must never write synthetic business rows');reads.push(path);
  const table=path.split('?')[0];if(table==='fs_users'&&heldUsers)await heldUsers;if(table==='fs_users'&&!healthy&&mode==='users503')throw Object.assign(Error('users unavailable'),{status:503});
  const params=new URLSearchParams(path.split('?')[1]||'');let selected=rows[table]||[];
  if(mode==='missing')selected=table==='fs_users'?[{name:'other',data:{name:'other',role:'sales'},updated_at:stamp}]:selected;
  const columns=(params.get('select')||'*').split(',');const from=Number(opt?.headers?.Range?.split('-')[0]||0);
  return structuredClone(selected.slice(from,from+1000).map(row=>columns.includes('*')?row:Object.fromEntries(columns.filter(c=>c in row).map(c=>[c,row[c]]))));
 }});
 h.context.__snapshot={chats:rows.fs_chats,messages:rows.fs_messages};
 const settle=async()=>{for(let n=0;n<8;n++)await h.settle();};
 const tick=async(ms)=>{const timer=h.run(`__timers.find(t=>t.ms===${ms})`);assert.ok(timer,'timer '+ms);h.run(`__timers=__timers.filter(t=>t.id!==${timer.id});__time+=${ms}`);const pending=timer.fn();await settle();return {pending};};
 const polls=async()=>{for(let n=0;n<105;n++){if(!h.run('__timers.some(t=>t.ms===200)'))break;await tick(200);}};
 await settle();return {h,rows,reads,writes,writeAttempts,settle,tick,polls,holdUsers(){let release;heldUsers=new Promise(resolve=>release=resolve);return ()=>{heldUsers=null;release();};},recover(){healthy=true;h.context.__healthy=true;}};
}
for(const role of ['sales','pd'])for(const mode of ['session503','network','users503'])test(`${role} recovers ${mode} on existing 20s retry with complete history`,async()=>{
 const f=await fixture(mode,role);await f.polls();assert.equal(f.h.context.__fsCentralReady,false);
 f.recover();await f.tick(20000);await f.polls();await f.settle();
 assert.equal(f.h.run('currentUser'),'sales');assert.equal(f.h.run('currentRole()'),role);assert.equal(f.h.context.__fsCentralReady,true,f.h.run('sbErr'));
 assert.equal(f.h.run("getChat('A04042').messages.length"),1001);assert.equal(f.h.run('__bootN'),1,'never replay sbBoot seed/listeners');
 assert.equal(f.h.run('__timers.filter(t=>t.ms===20000).length'),1);assert.equal(f.h.context.__fsJobSync.canCreate(),false,'unresolved permission remains closed');
 const fulls=f.h.read('__fulls');await f.tick(20000);await f.settle();assert.equal(f.h.read('__fulls').filter(Boolean).length,fulls.filter(Boolean).length,'steady state stays incremental');
});
for(const mode of ['anonymous','denied401','denied403','missing'])test(`${mode} stays closed across retries`,async()=>{
 const f=await fixture(mode);await f.polls();await f.tick(20000);await f.polls();await f.settle();
 assert.equal(f.h.run('currentUser'),'');assert.equal(f.h.context.__fsCentralReady,false);assert.equal(f.h.run('sbReady'),false);assert.equal(f.h.context.__fsJobSync.canCreate(),false);
});
test('hung initial identity expires at 15s and late reply cannot overwrite successful retry',async()=>{
 const f=await fixture('hung');assert.equal(f.h.run('currentUser'),'');await f.tick(15000);f.recover();await f.tick(20000);await f.polls();await f.settle();
 assert.equal(f.h.context.__fsCentralReady,true);const installs=f.h.run('__installs');
 f.h.run("__lateSession({status:200,json:async()=>({authenticated:true,name:'old',centralUserId:'old',role:'admin'})})");await f.settle();assert.equal(f.h.run('currentUser'),'sales');assert.equal(f.h.run('__installs'),installs);
});
test('logout invalidates a pending initial identity even when its profile later arrives',async()=>{
 const f=await fixture('hung');f.h.run('logoutUser()');f.h.run("__lateSession({status:200,json:async()=>({authenticated:true,name:'sales',centralUserId:'test-sales',role:'sales'})})");await f.polls();await f.settle();assert.equal(f.h.run('currentUser'),'');assert.equal(f.h.context.__fsCentralReady,false);
});
test('healthy boot retains one initial bootstrap and one full history',async()=>{
 const f=await fixture();await f.polls();await f.settle();assert.equal(f.h.context.__fsCentralReady,true);assert.deepEqual(f.h.read('__fulls'),[true,true]);assert.equal(f.h.run('__bootN'),1);assert.equal(f.h.run('__sessions'),6,'one initial identity read plus fresh scoped history boundary checks');
 assert.equal(f.h.run('__snapshotReadCount'),0,'ordinary startup never calls the global history snapshot');
 const trace=f.h.read('__historyTrace');assert.equal(trace[0].type,'ids','visible IDs are checked before child history');
 assert.equal(trace.filter(entry=>entry.type==='history').length,1,'ordinary startup requests one scoped history bundle');
 assert.deepEqual(trace.filter(entry=>entry.type==='history').map(entry=>entry.ids.join(',')),['A04042']);
 const children=trace.filter(entry=>entry.type==='child');assert.ok(children.length>=3);
 assert.ok(children.every(entry=>entry.path.includes('job_id=')&&entry.range),'every child page is scoped and bounded');
 assert.deepEqual(children.filter(entry=>entry.path.startsWith('fs_messages?')).map(entry=>entry.range),['0-999','1000-1999']);
});

test('focus visibility and storage wakes share one pending retry and one scheduled timer',async()=>{
 const f=await fixture('session503');f.recover();const release=f.holdUsers();await f.tick(20000);const reads=f.reads.length,sessions=f.h.run('__sessions');
 f.h.listeners.focus({});f.h.run("__documentEvents.visibilitychange({})");f.h.listeners.storage({key:'fs_userlist',oldValue:'[]',newValue:'[]'});f.h.run('sbCycle(true);sbCycle(false)');await f.settle();
 assert.equal(f.reads.length,reads);assert.equal(f.h.run('__sessions'),sessions);assert.equal(f.h.run('__timers.filter(t=>t.ms===20000).length'),0);
 release();await f.polls();await f.settle();assert.equal(f.h.context.__fsCentralReady,true);assert.equal(f.h.run('__timers.filter(t=>t.ms===20000).length'),1);assert.equal(f.h.run('__bootN'),1);
});
test('hung identity JSON has the same 15s deadline and cannot apply a late identity',async()=>{
 const f=await fixture('hung-body');await f.tick(15000);f.recover();await f.tick(20000);await f.polls();await f.settle();assert.equal(f.h.context.__fsCentralReady,true);
 f.h.run("__lateBody({authenticated:true,name:'old',role:'admin',centralUserId:'old'})");await f.settle();assert.equal(f.h.run('currentUser'),'sales');
});
test('retry cannot install a cached matching profile absent from its fresh server read',async()=>{
 const f=await fixture('session503');f.recover();f.rows.fs_users=[];f.h.run("userList=[{name:'sales',role:'sales'}]");await f.tick(20000);await f.polls();await f.settle();assert.equal(f.h.run('currentUser'),'');assert.equal(f.h.context.__fsCentralReady,false);
});

test('a recovered retry installs the current trusted identity instead of the failed attempt name',async()=>{
 const f=await fixture('session503','pd');f.recover();f.h.context.__sessionName='Synthetic PD';f.rows.fs_users=[{name:'Synthetic PD',data:{name:'Synthetic PD',role:'pd'},updated_at:stamp}];
 f.rows.fs_records[0].data.createdBy='Synthetic PD';await f.tick(20000);await f.polls();await f.settle();assert.equal(f.h.run('currentUser'),'Synthetic PD');assert.equal(f.h.run('currentRole()'),'pd');assert.equal(f.h.context.__fsCentralReady,true);
});
test('logout during a held retry prevents late core data from reinstalling the actor',async()=>{
 const f=await fixture('session503');f.recover();const release=f.holdUsers();await f.tick(20000);f.h.run('logoutUser()');release();await f.settle();assert.equal(f.h.run('currentUser'),'');assert.equal(f.h.context.__fsCentralReady,false);
 await f.tick(20000);await f.settle();assert.equal(f.h.run('currentUser'),'');assert.equal(f.h.context.__fsCentralReady,false,'failed remote logout cannot auto-sign the local user back in');
});

test('retry preserves an ordinary unsent immutable parent draft and never auto-saves it',async()=>{
 const storage=new Map(),first=harness({records:[job('A04042')],storage});first.run(pull([job('A04042')]));first.run("records[0].notes='Unsent synthetic draft';saveRecordsStore()");
 const before=[...storage].filter(([key])=>key.startsWith('fs_job_outbox_v1:'));
 assert.ok(before.length);const f=await fixture('session503','sales',storage);f.recover();await f.tick(20000);await f.polls();await f.settle();
 assert.equal(f.h.context.__fsCentralReady,true);assert.equal(f.h.pending().A04042.data.notes,'Unsent synthetic draft');assert.equal(f.h.run('records[0].notes'),'Unsent synthetic draft');
 before.forEach(([key,value])=>assert.equal(storage.get(key),value,'pending immutable evidence retained byte for byte'));
});

test('a fresh cycle consumes an older real sbQueue timer instead of leaving a delayed redundant pull',async()=>{
 const f=await fixture();await f.polls();await f.settle();f.h.run('sbCanEdit=true;sbQueue();sbCanEdit=false');assert.equal(f.h.run('__timers.filter(t=>t.ms===150).length'),1);
 await f.h.run('sbCycle(false)');await f.settle();assert.equal(f.h.run('__timers.filter(t=>t.ms===150).length'),0,'fresh cycle supersedes the previously queued send/read');assert.equal(f.h.run('__timers.filter(t=>t.ms===20000).length'),1);
});
test('an edit queued during a running read keeps its timer and receives one durable acknowledgement',async()=>{
 const f=await fixture('healthy','sales',new Map(),{allowSave:true});await f.polls();await f.settle();const release=f.holdUsers();const cycle=f.h.run('sbCycle(false)');await f.settle();assert.equal(f.h.run('sbBusy'),true);
 f.h.run("records[0].notes='New intent during read';saveRecordsStore()");assert.equal(f.h.run('__timers.filter(t=>t.ms===150).length'),1);assert.equal(f.h.pending().A04042.data.notes,'New intent during read');
 f.h.run('sbCycle(false)');
 release();await cycle;await f.settle();assert.equal(f.h.run('__timers.filter(t=>t.ms===150).length'),1,'an overlapping read must not consume newer intent');
 await f.tick(150);await f.settle();assert.equal(f.writes.length,1);assert.equal(f.writes[0].p_data.notes,'New intent during read');assert.equal(f.rows.fs_records[0].data.notes,'New intent during read');assert.deepEqual(f.h.pending(),{});assert.equal(f.h.run('__timers.filter(t=>t.ms===20000).length'),1);
});

// Use the sealed saveChats writer so the asset installs its real journal guard.
function pauseChatReadiness(f,{persistent=false,storageEvent=false}={}) {
 f.h.run(`getChat('A04042').messages.push({uid:'durable-before-pause',user:'sales',type:'msg',text:'Earlier unsent synthetic message',ts:8000});saveChats();`);
 const before=[...f.h.storage].filter(([key])=>key.startsWith('fs_chat_journal_v2:'));
 assert.ok(before.length,'the earlier unsent intent has an immutable journal');
 f.h.run(`getChat('A04042').messages.push({uid:'pending-at-pause',user:'sales',type:'msg',text:'Unsent synthetic message',ts:9000});
 var __originalSetItem=localStorage.setItem,__journalFailures=0;
 localStorage.setItem=function(key,value){if(key.indexOf('fs_chat_journal_v2:')===0&&(${persistent}||__journalFailures===0)){__journalFailures++;throw Error('synthetic journal failure');}return __originalSetItem.call(this,key,value);};`);
 if(storageEvent) {
  const oldValue=f.h.storage.get('fs_chats'),next=JSON.parse(oldValue);next[0].seen={...(next[0].seen||{}),syntheticSibling:9001};const newValue=JSON.stringify(next);
  f.h.storage.set('fs_chats',newValue);f.h.listeners.storage({key:'fs_chats',oldValue,newValue});
 }
 else f.h.run('saveChats()');
 assert.equal(f.h.context.__fsCentralReady,false);assert.equal(f.h.run('sbReady'),true,'the real failure only pauses global readiness');
 assert.ok(f.h.run('__journalFailures')>0);assert.equal(f.h.run("getChat('A04042').messages.some(m=>m.uid==='pending-at-pause')"),true);
 if(!persistent)f.h.run('localStorage.setItem=__originalSetItem');
 return before;
}
function assertRetainedChatIntent(f,before) {
 before.forEach(([key,value])=>assert.equal(f.h.storage.get(key),value,'existing immutable journal remains byte exact'));
 const journals=[...f.h.storage].filter(([key])=>key.startsWith('fs_chat_journal_v2:')).map(([,value])=>JSON.parse(value));
 assert.ok(journals.some(item=>item.message?.uid==='pending-at-pause'),'new unsent intent is durable after storage recovery');
 assert.equal(f.h.run("getChat('A04042').messages.some(m=>m.uid==='pending-at-pause')"),true);
}
for(const role of ['sales','pd'])test(`${role} postboot journal recovery uses fresh full history on the next 20s cycle`,async()=>{
 const f=await fixture('healthy',role,new Map(),{chatSave:true});await f.polls();await f.settle();
 assert.equal(f.h.context.__fsCentralReady,true);const before=pauseChatReadiness(f);
 f.rows.fs_messages.push({job_id:'A04042',uid:'fresh-old-history',ts:0,data:{uid:'fresh-old-history',text:'Newly authorized old synthetic history',type:'msg',ts:0},updated_at:stamp});
 const pulls=f.h.read('__fulls').length,sessions=f.h.run('__sessions');
 f.h.run("var __messageTraceStart=__historyTrace.length");
 await f.tick(20000);await f.settle();
 assert.equal(f.h.context.__fsCentralReady,true,f.h.run('sbErr'));assert.equal(f.h.run('sbReady'),true);
 assert.deepEqual(f.h.read('__fulls').slice(pulls),[true],'paused readiness must enter the existing full recovery');
 assert.ok(f.h.run('__sessions')>sessions,'recovery verifies the trusted identity again');assert.deepEqual(f.h.read("__historyTrace.slice(__messageTraceStart).filter(entry=>entry.type==='child'&&entry.path.startsWith('fs_messages?')).map(entry=>entry.range)"),['0-999','1000-1999'],'the synthetic scoped route returns both message pages');
 assert.equal(f.h.run("getChat('A04042').messages.length"),1004,'all 1,002 central messages plus two unsent intents survive pagination');
 assert.equal(f.h.run("getChat('A04042').messages.some(m=>m.uid==='m1000')"),true);
 assert.equal(f.h.run("getChat('A04042').messages.some(m=>m.uid==='fresh-old-history')"),true);assertRetainedChatIntent(f,before);
 assert.equal(f.h.context.__fsJobSync.canCreate(),false,'pending permission is not fabricated by recovery');assert.equal(f.writeAttempts.length,0);
 await f.tick(20000);await f.settle();assert.deepEqual(f.h.read('__fulls').slice(pulls),[true,false],'verified steady cycles remain incremental');assert.equal(f.h.run('__bootN'),1);
});
test('persistent postboot journal failure stays closed and retains all original intent without writes',async()=>{
 const f=await fixture('healthy','sales',new Map(),{chatSave:true,allowSave:true});await f.polls();await f.settle();const before=pauseChatReadiness(f,{persistent:true});
 for(let n=0;n<2;n++){await f.tick(20000);await f.settle();assert.equal(f.h.context.__fsCentralReady,false);assert.equal(f.h.context.__fsJobSync.canCreate(),false);assert.equal(f.writeAttempts.length,0);}
 before.forEach(([key,value])=>assert.equal(f.h.storage.get(key),value));assert.equal(f.h.run("getChat('A04042').messages.some(m=>m.uid==='pending-at-pause')"),true);
 f.h.run('localStorage.setItem=__originalSetItem');await f.tick(20000);await f.settle();assert.equal(f.h.context.__fsCentralReady,true);assertRetainedChatIntent(f,before);
 assert.equal(f.h.context.__fsJobSync.canCreate(),true,'the existing successful permission result still controls creation');f.h.run("chatOpenId=null");await f.h.run("openChatRoom('A04042')");await f.settle();assert.equal(f.h.run('chatOpenId'),'A04042','authorized room opens after complete recovery');
});
for(const status of [401,403])test(`postboot recovery cannot unlock after trusted session denial ${status}`,async()=>{
 const f=await fixture('healthy','sales',new Map(),{chatSave:true,allowSave:true});await f.polls();await f.settle();const before=pauseChatReadiness(f);
 f.h.context.__mode='denied'+status;await f.tick(20000);await f.settle();
 assert.equal(f.h.context.__fsCentralReady,false);assert.equal(f.h.run('sbReady'),false);assert.equal(f.h.context.__fsJobSync.canCreate(),false);assert.equal(f.writeAttempts.length,0);
 before.forEach(([key,value])=>assert.equal(f.h.storage.get(key),value));
});
test('postboot recovery waits for complete full data and rejects a session changed during the read',async()=>{
 const f=await fixture('healthy','sales',new Map(),{chatSave:true,allowSave:true});await f.polls();await f.settle();const before=pauseChatReadiness(f);
 const release=f.holdUsers();await f.tick(20000);assert.equal(f.h.context.__fsCentralReady,false);assert.equal(f.h.run('sbReady'),false);assert.equal(f.writeAttempts.length,0);
 f.h.context.__sessionName='other-synthetic-user';release();await f.settle();assert.equal(f.h.context.__fsCentralReady,false);assert.equal(f.h.context.__fsJobSync.canCreate(),false);assert.equal(f.writeAttempts.length,0);
 before.forEach(([key,value])=>assert.equal(f.h.storage.get(key),value));
});
test('postboot full recovery quarantines a revoked parent without republishing its retained draft',async()=>{
 const f=await fixture('healthy','sales',new Map(),{chatSave:true,allowSave:true});await f.polls();await f.settle();f.h.run("records[0].notes='Unsent parent intent';saveRecordsStore()");
 const parentBefore=[...f.h.storage].filter(([key])=>key.startsWith('fs_job_outbox_v1:'));assert.ok(parentBefore.length);const before=pauseChatReadiness(f);
 f.h.context.__scope=[];f.rows.fs_records=[];f.h.context.__snapshot={chats:[],messages:[]};await f.tick(20000);await f.settle();
 assert.equal(f.h.context.__fsCentralReady,true,'empty authorized scope is a complete result');assert.equal(f.h.run("records.some(r=>r.id==='A04042')"),false);assert.equal(f.h.run("chats.some(c=>c.jobId==='A04042')"),false);
 parentBefore.concat(before).forEach(([key,value])=>assert.equal(f.h.storage.get(key),value,'revoked intent remains private and byte exact'));
 await f.tick(20000);await f.settle();assert.equal(f.writeAttempts.length,0);assert.equal(f.h.run("records.some(r=>r.id==='A04042')"),false);
});
test('an edit arriving during postboot full recovery is retained and acknowledged only after authorized completion',async()=>{
 const f=await fixture('healthy','sales',new Map(),{chatSave:true,allowSave:true});await f.polls();await f.settle();pauseChatReadiness(f);
 const release=f.holdUsers();await f.tick(20000);assert.equal(f.h.context.__fsCentralReady,false);assert.equal(f.h.run('sbReady'),false);
 f.h.run("records[0].notes='New synthetic intent during recovery';saveRecordsStore()");assert.equal(f.h.pending().A04042.data.notes,'New synthetic intent during recovery');assert.equal(f.writeAttempts.length,0);
 const before=[...f.h.storage].filter(([key])=>key.startsWith('fs_job_outbox_v1:'));assert.ok(before.length);
 f.h.run('sbCycle(false)');assert.equal(f.writeAttempts.length,0);before.forEach(([key,value])=>assert.equal(f.h.storage.get(key),value));
 release();await f.settle();assert.equal(f.h.context.__fsCentralReady,true);assert.equal(f.writeAttempts.length,0,'full read does not acknowledge or save new intent');assert.equal(f.h.pending().A04042.data.notes,'New synthetic intent during recovery');before.forEach(([key,value])=>assert.equal(f.h.storage.get(key),value,'full recovery retains the new immutable parent revision byte exact'));
 await f.tick(20000);await f.settle();assert.equal(f.writeAttempts.filter(item=>item.path==='rpc/fs_save_record').length,1);assert.equal(f.writes.length,1);assert.equal(f.rows.fs_records[0].data.notes,'New synthetic intent during recovery');assert.deepEqual(f.h.pending(),{});
});
test('a storage notification journal failure uses the same postboot full recovery',async()=>{
 const f=await fixture('healthy','sales',new Map(),{chatSave:true});await f.polls();await f.settle();const before=pauseChatReadiness(f,{storageEvent:true});const pulls=f.h.read('__fulls').length;
 await f.tick(20000);await f.settle();assert.equal(f.h.context.__fsCentralReady,true);assert.deepEqual(f.h.read('__fulls').slice(pulls),[true]);assertRetainedChatIntent(f,before);assert.equal(f.writeAttempts.length,0);
});

// These regressions catch missing/sensitive failure telemetry in the real
// delegated wrappers. Only synthetic transport/storage boundaries are failed.
function connectionDiagnostics(f) {
 return f.h.calls.filter(call=>call.path==='/__formula/client-diagnostic')
  .map(call=>({request:call.opt,...JSON.parse(call.opt.body)})).filter(item=>item.stage.startsWith('connection:'));
}
function assertConnectionDiagnostic(item,stage,reason) {
 assert.ok(item,'failed connection boundary must emit a diagnostic');
 assert.equal(item.job,'');assert.equal(item.stage,stage);assert.equal(item.reason,reason);
 assert.equal(item.request.method,'POST');assert.equal(item.request.credentials,'same-origin');
 assert.ok(item.detail.length<=200);
 const detail=JSON.parse(item.detail);
 assert.deepEqual(Object.keys(detail).sort(),['actorReady','centralReady','chatRecoveryBlocked','hasVisibleScope','permissionReady','sbReady','storageError'].sort());
 Object.values(detail).forEach(value=>assert.equal(typeof value,'boolean'));
 return detail;
}
function failCycleRead(f,errorExpression) {
 f.h.run(`var __diagnosticRead=sbReq;sbReq=function(path,opt){if(path.indexOf('fs_records?')===0)throw ${errorExpression};return __diagnosticRead.apply(this,arguments);};`);
}
test('connection diagnostic identifies bootstrap actor failure and leaves 20s successful recovery unchanged',async()=>{
 const f=await fixture('session503');await f.polls();
 const detail=assertConnectionDiagnostic(connectionDiagnostics(f)[0],'connection:bootstrap','actor-unavailable');
 assert.equal(detail.actorReady,false);assert.equal(detail.centralReady,false);assert.equal(detail.sbReady,false);
 assert.equal(f.h.context.__fsJobSync.canCreate(),false);assert.equal(f.writeAttempts.length,0);
 await f.tick(20000);await f.polls();assert.equal(connectionDiagnostics(f).length,1,'same failure is deduplicated for 60 seconds');
 f.recover();await f.tick(20000);await f.polls();await f.settle();
 assert.equal(f.h.context.__fsCentralReady,true);assert.equal(f.h.run("getChat('A04042').messages.length"),1001);
 assert.equal(f.h.context.__fsJobSync.canCreate(),false);assert.equal(f.h.run('__bootN'),1);
 assert.equal(f.h.run('__timers.filter(t=>t.ms===20000).length'),1);assert.equal(connectionDiagnostics(f).length,1);
 await f.tick(20000);await f.settle();assert.equal(connectionDiagnostics(f).length,1,'healthy incremental path emits no failure');
});
test('connection diagnostic reports full-history journal failure while retaining unsent messages and earlier journal bytes',async()=>{
 const f=await fixture('healthy','sales',new Map(),{chatSave:true});await f.polls();await f.settle();
 const before=pauseChatReadiness(f,{persistent:true});await f.tick(20000);await f.settle();
 const detail=assertConnectionDiagnostic(connectionDiagnostics(f).at(-1),'connection:history','pending-chat-journal');
 assert.equal(detail.chatRecoveryBlocked,true);assert.equal(detail.storageError,false,'chat recovery and parent storage are distinct flags');
 assert.equal(detail.sbReady,false);assert.equal(detail.centralReady,false);assert.equal(f.writeAttempts.length,0);
 before.forEach(([key,value])=>assert.equal(f.h.storage.get(key),value));assert.equal(f.h.run("getChat('A04042').messages.some(m=>m.uid==='pending-at-pause')"),true);
 f.h.run('localStorage.setItem=__originalSetItem');await f.tick(20000);await f.settle();assert.equal(f.h.context.__fsCentralReady,true);assertRetainedChatIntent(f,before);
});
for(const status of [401,403])test(`connection diagnostic reports full-history read denial ${status} without unlocking or losing owned journals`,async()=>{
 const f=await fixture('healthy','sales',new Map(),{chatSave:true});await f.polls();await f.settle();const before=pauseChatReadiness(f);
 f.h.run(`var __diagnosticFetch=window.fetch;var __historyScopeReads=0;window.fetch=function(path,opt){if(path==='/__formula/visible-record-ids'&&++__historyScopeReads===2)return Promise.resolve({ok:false,status:${status},json:async()=>({})});return __diagnosticFetch(path,opt);};`);
 await f.tick(20000);await f.settle();
 const detail=assertConnectionDiagnostic(connectionDiagnostics(f).at(-1),'connection:history',status===401?'unauthorized401':'forbidden403');
 assert.equal(detail.centralReady,false);assert.equal(f.h.context.__fsJobSync.canCreate(),false);assert.equal(f.h.run('sbReady'),false);assert.equal(f.writeAttempts.length,0);
 before.forEach(([key,value])=>assert.equal(f.h.storage.get(key),value));
});
test('connection diagnostic reports full-history legacy preservation failure without deleting its source',async()=>{
 const f=await fixture();await f.polls();await f.settle();
 f.h.run(`window.__fsCentralReady=false;var __diagnosticFetch=window.fetch;window.fetch=function(path,opt){if(path==='/__formula/visible-record-ids')localStorage.setItem('fs_chat_unclassified_recovery_v1','{synthetic-invalid-legacy');return __diagnosticFetch(path,opt);};`);
 await f.tick(20000);await f.settle();
 assertConnectionDiagnostic(connectionDiagnostics(f).at(-1),'connection:history','legacy-chat-preserve');
 assert.equal(connectionDiagnostics(f).find(item=>item.stage==='connection:chat-preserve').reason,'local-json-invalid');
 assert.equal(f.h.storage.get('fs_chat_unclassified_recovery_v1'),'{synthetic-invalid-legacy');assert.equal(f.h.context.__fsCentralReady,false);assert.equal(f.writeAttempts.length,0);
});
test('connection diagnostic covers partial full-history failure without throwing or changing permission gates',async()=>{
 const f=await fixture();await f.polls();await f.settle();f.h.run('window.__fsCentralReady=false;sbCap.apv=false');
 await f.tick(20000);await f.settle();
 assertConnectionDiagnostic(connectionDiagnostics(f).at(-1),'connection:history','central-page-incomplete');
 assert.equal(f.h.run('sbErr'),'ยังโหลดประวัติจากระบบกลางไม่ครบ');assert.equal(f.h.context.__fsCentralReady,false);assert.equal(f.h.run('sbReady'),false);assert.equal(f.h.context.__fsJobSync.canCreate(),false);
 assert.equal(f.h.run('__timers.filter(t=>t.ms===20000).length'),1);assert.equal(f.writeAttempts.length,0);
});
test('connection diagnostic reports incremental failure with exact watermark message and immutable draft retained',async()=>{
 const f=await fixture('healthy','sales',new Map(),{chatSave:true});await f.polls();await f.settle();
 f.h.run("records[0].notes='Unsent synthetic parent';saveRecordsStore();getChat('A04042').messages.push({uid:'pending-diagnostic',text:'Private synthetic draft',ts:9999});saveChats()");
 const journals=[...f.h.storage].filter(([key])=>/^fs_(chat_journal_v2:|job_outbox_v1:)/.test(key));assert.ok(journals.length>=2);
 const wm=f.h.read('sbWM'),messages=f.h.read("getChat('A04042').messages");
 failCycleRead(f,"Object.assign(Error('synthetic unavailable'),{status:503})");await f.tick(20000);await f.settle();
 const detail=assertConnectionDiagnostic(connectionDiagnostics(f).at(-1),'connection:cycle','service-unavailable503');
 assert.equal(detail.hasVisibleScope,true);assert.equal(detail.actorReady,true);assert.equal(detail.permissionReady,false);
 assert.deepEqual(f.h.read('sbWM'),wm);assert.deepEqual(f.h.read("getChat('A04042').messages"),messages);assert.equal(f.h.pending().A04042.data.notes,'Unsent synthetic parent');
 journals.forEach(([key,value])=>assert.equal(f.h.storage.get(key),value));assert.equal(f.writeAttempts.length,0);assert.equal(f.h.context.__fsJobSync.canCreate(),false);
 f.h.run('sbReq=__diagnosticRead');await f.tick(20000);await f.settle();assert.equal(f.h.context.__fsCentralReady,true);assert.equal(connectionDiagnostics(f).length,1);
});
test('connection diagnostic suppresses arbitrary error text even when it contains known signatures and synthetic confidential values',async()=>{
 const f=await fixture();await f.polls();await f.settle();
 const sensitive='pending chat recovery could not be saved customer=SyntheticCustomer token=sk-synthetic-secret email=synthetic@example.invalid https://synthetic.invalid/?secret=hidden fs_private_key';
 failCycleRead(f,`Error(${JSON.stringify(sensitive)})`);await f.tick(20000);await f.settle();
 assertConnectionDiagnostic(connectionDiagnostics(f).at(-1),'connection:cycle','unknown');
 assert.equal(f.h.run('sbErr'),sensitive,'the existing caught error text stays unchanged');
 const body=connectionDiagnostics(f).at(-1).request.body;
 for(const raw of ['SyntheticCustomer','sk-synthetic-secret','synthetic@example.invalid','synthetic.invalid','fs_private_key',sensitive])assert.equal(body.includes(raw),false);
 assert.equal(f.h.run('__timers.filter(t=>t.ms===20000).length'),1);
});
for(const failure of ['throw','reject'])test(`connection diagnostic transport ${failure} cannot block failure handling or the next successful retry`,async()=>{
 const f=await fixture();await f.polls();await f.settle();
 f.h.run(`var __diagnosticAttempts=0,__diagnosticFetch=window.fetch;window.fetch=function(path,opt){if(path==='/__formula/client-diagnostic'){__diagnosticAttempts++;${failure==='throw'?"throw Error('synthetic diagnostic throw');":"return Promise.reject(Error('synthetic diagnostic rejection'));"}}return __diagnosticFetch(path,opt);};`);
 failCycleRead(f,"Object.assign(Error('synthetic unavailable'),{status:503})");await f.tick(20000);await f.settle();
 assert.equal(f.h.run('__diagnosticAttempts'),1);assert.equal(f.h.run('sbErr'),'synthetic unavailable');assert.equal(f.h.run('sbBusy'),false);assert.equal(f.h.run('__timers.filter(t=>t.ms===20000).length'),1);assert.equal(f.writeAttempts.length,0);
 f.h.run('sbReq=__diagnosticRead;window.fetch=__diagnosticFetch');await f.tick(20000);await f.settle();assert.equal(f.h.context.__fsCentralReady,true);assert.equal(f.h.run('sbErr'),'');
});
test('connection diagnostic distinguishes bounded central deadline from an arbitrary status 408 error',async()=>{
 const f=await fixture();await f.polls();await f.settle();
 f.h.run("var __diagnosticFetch=window.fetch;window.fetch=function(path,opt){if(path==='/__formula/visible-record-ids')return new Promise(()=>{});return __diagnosticFetch(path,opt);};");
 await f.tick(20000);await f.tick(15000);await f.settle();
 assertConnectionDiagnostic(connectionDiagnostics(f).at(-1),'connection:cycle','timedout');assert.equal(f.h.context.__fsCentralReady,false);assert.equal(f.h.context.__fsJobSync.canCreate(),false);
 f.h.run('window.fetch=__diagnosticFetch');await f.tick(20000);await f.settle();assert.equal(f.h.context.__fsCentralReady,true);
 failCycleRead(f,"Object.assign(Error('synthetic customer timeout'),{status:408})");await f.tick(20000);await f.settle();assertConnectionDiagnostic(connectionDiagnostics(f).at(-1),'connection:cycle','unknown');
});
test('connection diagnostic identifies an invalid immutable chat entry without exposing or rewriting any stored value',async()=>{
 const storage=new Map([['fs_chat_journal_v2:synthetic-invalid',JSON.stringify({kind:'pending',identity:'private-synthetic-owner',jobId:'private-synthetic-job',message:{uid:'private-synthetic-message',text:'Synthetic confidential customer'}})]]);
 const original=storage.get('fs_chat_journal_v2:synthetic-invalid');
 const f=await fixture('healthy','sales',storage);await f.polls();await f.settle();
 const inner=connectionDiagnostics(f).find(item=>item.stage==='connection:chat-preserve');
 assert.ok(inner,'silent preserve catch must classify its failure');assert.equal(inner.reason,'journal-entry-invalid');assert.equal(inner.detail,'');
 assertConnectionDiagnostic(connectionDiagnostics(f).find(item=>item.stage==='connection:history'),'connection:history','legacy-chat-preserve');
 assert.equal(storage.get('fs_chat_journal_v2:synthetic-invalid'),original);assert.equal(f.h.context.__fsCentralReady,false);assert.equal(f.h.context.__fsJobSync.canCreate(),false);assert.equal(f.writeAttempts.length,0);
 const before=[...storage];await f.tick(20000);await f.settle();assert.deepEqual([...storage],before,'failed retry leaves all raw storage exact');
 const body=JSON.stringify(connectionDiagnostics(f));for(const raw of ['private-synthetic-owner','private-synthetic-job','private-synthetic-message','Synthetic confidential customer','fs_chat_journal_v2:synthetic-invalid'])assert.equal(body.includes(raw),false);
});
test('connection diagnostic identifies real chat journal setItem quota failure while retaining exact original storage and outer closed state',async()=>{
 const f=await fixture('healthy','sales',new Map(),{chatSave:true});await f.polls();await f.settle();
 f.h.run("getChat('A04042').messages.push({uid:'quota-pending',text:'Synthetic confidential draft',ts:9999});window.__fsCentralReady=false;var __quotaSetItem=localStorage.setItem;localStorage.setItem=function(key,value){if(key.indexOf('fs_chat_journal_v2:')===0)throw Object.assign(Error('Synthetic confidential quota payload'),{name:'QuotaExceededError'});return __quotaSetItem.call(this,key,value);};");
 const before=[...f.h.storage];await f.tick(20000);await f.settle();
 const inner=connectionDiagnostics(f).find(item=>item.stage==='connection:chat-stash');assert.ok(inner,'silent stash catch must classify its failure');assert.equal(inner.reason,'quota-exceeded');assert.equal(inner.detail,'');
 const outer=assertConnectionDiagnostic(connectionDiagnostics(f).find(item=>item.stage==='connection:history'),'connection:history','pending-chat-journal');
 assert.equal(outer.chatRecoveryBlocked,true);assert.equal(outer.storageError,false);assert.equal(f.h.context.__fsCentralReady,false);assert.equal(f.h.context.__fsJobSync.canCreate(),false);
 assert.deepEqual([...f.h.storage],before);assert.equal(f.h.run("getChat('A04042').messages.some(m=>m.uid==='quota-pending')"),true);assert.equal(f.writeAttempts.length,0);
 assert.equal(JSON.stringify(connectionDiagnostics(f)).includes('Synthetic confidential'),false);
});

// Native fixture executes the same complete sealed-function wrapper as the VM
// controls. Only localhost transport and deterministic timer boundaries differ.
async function nativeQuotaFixture(t,{raw,seed='',extra='',seedFallback=null,quota=true,role='sales'}={}) {
 const {createServer}=await import('node:http');
 const {actualBrowser,browserValue}=await import('./helpers/chat-journal-browser.mjs');
 const adapter=readFileSync(new URL('../runtime/assets/fs-chat-journal.js',import.meta.url),'utf8');
 const f=await fixture('healthy',role,new Map(),{chatSave:true,allowSave:true});
 raw=raw ?? JSON.stringify([{jobId:'old-room',unknown:'original 🧪',messages:[{uid:'old-1',text:'synthetic old'}]}]);
 const nativeTransport=`window.__records=[];window.__owner='';window.__chats=[];window.__rows=${JSON.stringify(f.rows)};
 window.__writes=[];window.__diags=[];window.__fetch=async(path,opt)=>{if(path==='/__formula/client-diagnostic')__diags.push(JSON.parse(opt.body));return {ok:true,status:200,json:async()=>({})}};window.__request=async function(path,opt={}){if(opt.method&&opt.method!=='GET'){__writes.push(path);if(opt.method==='POST'&&/^(fs_chats|fs_messages)([?]|$)/.test(path))return opt.body;throw Error('unexpected synthetic write')}let rows=__rows[path.split('?')[0]]||[];let p=new URLSearchParams(path.split('?')[1]||''),cols=(p.get('select')||'*').split(','),from=Number(opt.headers?.Range?.split('-')[0]||0);return rows.slice(from,from+1000).map(r=>cols.includes('*')?r:Object.fromEntries(cols.filter(c=>c in r).map(c=>[c,r[c]])))};
 window.alert=function(){};window.confirm=()=>true;
 localStorage.setItem('fs_chats',${JSON.stringify(raw)});window.__originalRaw=${JSON.stringify(raw)};
 ${seed}
 window.__chatWrites=0;const nativeTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(this.name==='fs_chat_fallback_v1'&&args[1]==='readwrite')__chatWrites++;return nativeTransaction.apply(this,args)};
 window.__realQuota=false;if(${quota}){let padding='';for(let step=131072;step>=1;step=Math.floor(step/2)){while(true){try{localStorage.setItem('synthetic-padding',padding+'x'.repeat(step));padding+='x'.repeat(step)}catch(error){if(error.name!=='QuotaExceededError')throw error;__realQuota=true;break}}}};
 `;
 const bootstrap=f.h.script.replace('window.location={};','').replace('window.__snapshot={chats:[],messages:[]}',"window.__snapshot={chats:__rows.fs_chats,messages:__rows.fs_messages}");
 const delayed=seedFallback?`__fsChatJournal.preserve(${JSON.stringify(seedFallback)}).then(function(){const script=document.createElement('script');script.textContent=${JSON.stringify(bootstrap)};document.body.appendChild(script)});`:bootstrap;
 const server=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset="utf-8"><body><script>'+adapter+'</script>'+(req.url==='/adapter-only'?'':'<script>'+nativeTransport+extra+delayed+'</script>'));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const browser=await actualBrowser(t,'http://127.0.0.1:'+server.address().port);if(!browser)return;
 const run=x=>browserValue(browser,x);await new Promise(r=>setTimeout(r,100));
 const waitFor=async expression=>{for(let i=0;i<250;i++){await run('if(typeof __timers!=="undefined")__timers.filter(t=>t.ms===200||t.ms===0).forEach(t=>{__timers=__timers.filter(x=>x.id!==t.id);t.fn()});true');if(await run('typeof __timers!=="undefined" && ('+expression+')'))return;await new Promise(r=>setTimeout(r,20));}assert.fail('native condition did not complete: '+expression+'; '+await run('sbErr'));};
 const retry=()=>run(`(()=>{var timer=__timers.find(t=>t.ms===20000);if(!timer)throw Error('20s retry missing');__timers=__timers.filter(t=>t.id!==timer.id);return timer.fn()})()`);
 return {browser,run,waitFor,retry,raw};
}
test('native quota bootstrap preserves a complete 3229-entry batch before resuming scoped history',async t=>{
 const raw=JSON.stringify([{jobId:'old-room',unknown:'original 🧪',messages:Array.from({length:3224},(_,i)=>({uid:i===2?'old-0':'old-'+i,text:'synthetic '+i}))}]);
 const pending=[{jobId:'A04042',message:{uid:'bulk-variant',text:'first',ts:2000}},{jobId:'A04042',message:{uid:'bulk-variant',text:'different',ts:2000}},{jobId:'A04042',message:{uid:'m0',text:'synthetic 0',type:'msg',ts:0}},{jobId:'other-job',message:{uid:'foreign-bulk',text:'quarantined',ts:2001}}];
 const pendingKey='fs_chat_pending_v1:'+encodeURIComponent(JSON.stringify(['sales','test-sales','sales'])),pendingRaw=JSON.stringify(pending);
 const {run,waitFor}=await nativeQuotaFixture(t,{raw,seed:`localStorage.setItem(${JSON.stringify(pendingKey)},${JSON.stringify(pendingRaw)});`});await waitFor('window.__fsCentralReady===true');
 const result=await run(`(async()=>({ready:window.__fsCentralReady,error:sbErr,count:getChat('A04042')?.messages.length,writes:__chatWrites,quota:__realQuota,raw:localStorage.getItem('fs_chats')===__originalRaw,fulls:__fulls,snapshot:await __fsChatJournal.snapshot()}))()`);
 assert.equal(result.ready,true,result.error);assert.equal(result.count,1001);assert.equal(result.writes,1,'one complete batch, no per-item retry');assert.equal(result.quota,true);assert.ok(result.raw||result.snapshot.raws.some(r=>r.sourceKey==='fs_chats'&&r.raw===raw));assert.deepEqual(result.fulls,[true,true]);assert.equal(result.snapshot.items.length,3229);assert.equal(result.snapshot.items.filter(r=>r.value.kind==='pending').length,4);assert.ok(result.snapshot.raws.some(r=>r.sourceKey===pendingKey&&r.raw===pendingRaw));assert.ok(result.snapshot.raws.some(r=>r.sourceKey==='fs_chats'&&r.raw===raw));
 const sendAttempt=await run(`(async()=>{var input=document.createElement('textarea');input.id='chatInput';input.value='new synthetic composer';document.body.appendChild(input);chatOpenId='A04042';var count=getChat(chatOpenId).messages.length;var result=await sendChatMsg();return {sent:result===true,text:input.value,added:getChat(chatOpenId).messages.length===count+1}})()`);
 assert.deepEqual(sendAttempt,{sent:true,text:'',added:true},'quota recovery sends only through the durable-before-clear lifecycle');
 await run('sbCycle(false)');await waitFor('window.__fsCentralReady===true');
 const before=await run('({writes:__chatWrites,fulls:__fulls.filter(Boolean).length})');
 await run('sbCycle(false)');await waitFor('window.__fsCentralReady===true');assert.deepEqual(await run('({writes:__chatWrites,fulls:__fulls.filter(Boolean).length})'),before,'unchanged 20s cycle neither archives generated history nor rebuilds full history');
});
for(const fault of ['abort','readback'])test('native '+fault+' closes quota bootstrap and retries after storage is healthy',async t=>{
 const extra=`window.__fault=true;const faultTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){const tx=faultTransaction.apply(this,args);if(this.name==='fs_chat_fallback_v1'&&__fault){if(args[1]==='readwrite')tx.addEventListener('complete',()=>window.__written=true);const get=tx.objectStore.bind(tx);tx.objectStore=function(n){const store=get(n);${fault==='abort'?"if(args[1]==='readwrite'){const add=store.add.bind(store);store.add=function(v){const r=add(v);r.addEventListener('success',()=>tx.abort(),{once:true});return r}}":"if(args[1]==='readonly'&&window.__written){const all=store.getAll.bind(store);store.getAll=function(){const r=all();r.addEventListener('success',()=>Object.defineProperty(r,'result',{value:[]}));return r}}"};return store}}return tx};`;
 const {run,waitFor,retry}=await nativeQuotaFixture(t,{extra});await waitFor('__fsChatJournal.status().state==="failed"');
 assert.equal(await run('window.__fsCentralReady'),false);assert.equal(await run("localStorage.getItem('fs_chats')===__originalRaw"),true);assert.equal(await run('__fsJobSync.canCreate()'),false);
 await run('__fault=false');await retry();await waitFor('window.__fsCentralReady===true');
 assert.equal(await run("getChat('A04042').messages.length"),1001);assert.equal(await run("__fsChatJournal.snapshot().then(s=>s.raws.some(r=>r.sourceKey==='fs_chats'&&r.raw===__originalRaw))"),true);
});
for(const change of ['session','scope','actor','role','email','central-id'])test('native '+change+' change during committed preservation cannot install stale readiness',async t=>{
 const extra=`const preserve=__fsChatJournal.preserve;__fsChatJournal.preserve=async function(batch){const result=await preserve(batch);window.__held=true;await new Promise(r=>window.__releasePreserve=r);return result};`;
 const {run,waitFor}=await nativeQuotaFixture(t,{extra});await waitFor('window.__held===true');
 assert.equal(await run('window.__fsCentralReady'),false);assert.equal(await run("localStorage.getItem('fs_chats')===__originalRaw"),true);
  const changed={session:"__fsSessionGeneration++",scope:"__scope=[];__rows.fs_records=[]",actor:"currentUser='other'",role:"__fsSessionFetch=async()=>({ok:true,status:200,json:async()=>({authenticated:true,name:'sales',centralUserId:'test-sales',role:'pd'})})",email:"__fsSessionFetch=async()=>({ok:true,status:200,json:async()=>({authenticated:true,name:'sales',centralUserId:'test-sales',role:'sales',email:'synthetic@example.invalid'})})",'central-id':"__fsSessionFetch=async()=>({ok:true,status:200,json:async()=>({authenticated:true,name:'sales',centralUserId:'other-id',role:'sales'})})"};
 await run(changed[change]+';__releasePreserve()');
 await waitFor('__timers.some(t=>t.ms===20000)');assert.equal(await run('window.__fsCentralReady'),false);assert.equal(await run("localStorage.getItem('fs_chats')===__originalRaw"),true);
});
test('native storage notification preserves both sole-copy event values and resumes automatically',async t=>{
 const {run,waitFor}=await nativeQuotaFixture(t);await waitFor('window.__fsCentralReady===true');
 const old=' [{"jobId":"event-old","messages":[{"uid":"sole-old","text":"original 🧪"}]}] ',next='[{"jobId":"event-new","messages":[{"uid":"sole-new","text":"new"}]}]';
 await run(`window.dispatchEvent(new StorageEvent('storage',{key:'fs_chats',oldValue:${JSON.stringify(old)},newValue:${JSON.stringify(next)}}));true`);
 assert.equal(await run('window.__fsCentralReady'),false,'synchronous caller closes before async commit');
 await waitFor('window.__fsCentralReady===true');
 const snapshot=await run('__fsChatJournal.snapshot()');for(const raw of [old,next])assert.ok(snapshot.raws.some(r=>r.sourceKey==='fs_chats'&&r.raw===raw));
 assert.ok(snapshot.items.some(r=>r.value.message?.uid==='sole-old'));assert.ok(snapshot.items.some(r=>r.value.message?.uid==='sole-new'));
});

test('native pending-v1 imports use fallback receipts and both ACK paths preserve same-uid variants',async t=>{
 const identity=JSON.stringify(['sales','test-sales','sales']);
 const exact={uid:'m0',text:'synthetic 0',type:'msg',ts:0},variant={...exact,text:'different original'};
 const pending=[{jobId:'A04042',message:exact},{jobId:'A04042',message:variant},{jobId:'other-job',message:exact},{jobId:'A04042',message:{uid:'later',text:'pending later',ts:2001}}];
 const key='fs_chat_pending_v1:'+encodeURIComponent(identity),raw=JSON.stringify(pending);
 const {run,waitFor}=await nativeQuotaFixture(t,{seed:`localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(raw)});`});await waitFor('window.__fsCentralReady===true');
 const initial=await run('__fsChatJournal.snapshot()');assert.ok(initial.receipts.length>=4);assert.ok(initial.raws.some(r=>r.sourceKey===key&&r.raw===raw));assert.equal(await run(`localStorage.getItem(${JSON.stringify(key)})`),raw);
 assert.equal(await run("getChat('A04042').messages.filter(m=>m.uid==='m0').length"),1,'same UID variant is quarantined, not replayed');
 await run('sbCycle(false)');await waitFor('window.__fsCentralReady===true');let snapshot=await run('__fsChatJournal.snapshot()');
 assert.ok(snapshot.items.some(r=>r.value.kind==='pending'&&r.value.message.text==='different original'));assert.ok(snapshot.items.some(r=>r.value.jobId==='other-job'&&r.value.message.uid==='m0'));
 await run("__rows.fs_messages.push({job_id:'A04042',uid:'later',ts:2001,data:{uid:'later',text:'pending later',ts:2001},updated_at:'2026-10-19T03:00:00Z'});sbCycle(false)");
 await waitFor('window.__fsCentralReady===true');await run('sbCycle(false)');await waitFor('window.__fsCentralReady===true');snapshot=await run('__fsChatJournal.snapshot()');
 assert.equal(snapshot.items.some(r=>r.value.kind==='pending'&&r.value.jobId==='A04042'&&r.value.message.uid==='later'),false,'incremental exact ACK retires only the exact pending item; '+await run('sbErr+" "+JSON.stringify(__diags)+" "+JSON.stringify(__writes)'));
 assert.ok(snapshot.raws.some(r=>r.sourceKey.startsWith('fs_chat_journal_v2:')&&JSON.parse(r.raw).message?.uid==='later'));assert.equal(await run(`localStorage.getItem(${JSON.stringify(key)})`),raw);
});

test('native canonical-equal legacy and fallback raw variants are preserved without changing the key contract',async t=>{
 const {createHash}=await import('node:crypto');const value={kind:'pending',identity:JSON.stringify(['sales','test-sales','sales']),jobId:'A04042',message:{uid:'raw-variant',text:'original',ts:2000}};
 const h=harness(),canonical=h.run(`stableStr(${JSON.stringify(value)})`),key='fs_chat_journal_v2:'+createHash('sha256').update(canonical).digest('hex');
 const legacy=' '+JSON.stringify({...value,message:{text:'original',ts:2000,uid:'raw-variant'}})+'\n',fallback=JSON.stringify(value);
 const {run,waitFor}=await nativeQuotaFixture(t,{seed:`localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(legacy)});`,seedFallback:{items:[{key,raw:fallback}]}});await waitFor('window.__fsCentralReady===true');
 assert.equal(await run(`localStorage.getItem(${JSON.stringify(key)})`),legacy);assert.equal(await run("getChat('A04042').messages.filter(m=>m.uid==='raw-variant').length"),1);
 const snapshot=await run('__fsChatJournal.snapshot()');assert.ok(snapshot.items.some(r=>r.key===key&&r.raw===fallback));assert.ok(snapshot.raws.some(r=>r.sourceKey===key&&r.raw===legacy));
});
test('native second-tab writes during a preservation barrier and missed notifications are found by ordinary cycles',async t=>{
 const extra=`const preserve=__fsChatJournal.preserve;__fsChatJournal.preserve=async function(batch){const result=await preserve(batch);window.__held=true;await new Promise(r=>window.__releasePreserve=r);return result};`;
 const {browser,run,waitFor}=await nativeQuotaFixture(t,{extra});await waitFor('window.__held===true');
 // A second native handle uses the adapter without installing the app or any
 // localStorage event/broadcast delivery to the first tab.
 const origin=await run('location.origin'),sibling=await browser.newPage(origin+'/adapter-only');
 const {browserValue}=await import('./helpers/chat-journal-browser.mjs');
 for(let i=0;i<100;i++){if(await browserValue(sibling,'typeof __fsChatJournal!=="undefined"'))break;await new Promise(r=>setTimeout(r,20));}
 const value={kind:'pending',identity:JSON.stringify(['sales','test-sales','sales']),jobId:'A04042',message:{uid:'sibling-only',text:'separate tab',ts:2002}};
 const {createHash}=await import('node:crypto');const h=harness(),key='fs_chat_journal_v2:'+createHash('sha256').update(h.run(`stableStr(${JSON.stringify(value)})`)).digest('hex');
 await browserValue(sibling,`__fsChatJournal.preserve({items:[{key:${JSON.stringify(key)},raw:${JSON.stringify(JSON.stringify(value))}}]})`);
 await run('__releasePreserve()');await waitFor('window.__fsCentralReady===true');
 assert.equal(await run("getChat('A04042').messages.some(m=>m.uid==='sibling-only')"),true);
});

test('native healthy localStorage journaling writes only required original-raw archives and unchanged cycles do not grow them',async t=>{
 const {run,waitFor}=await nativeQuotaFixture(t,{quota:false});await waitFor('window.__fsCentralReady===true');
 assert.equal(await run('__scopeReadCount'),3,'startup, complete history, and final current scope are read separately');
 const initial=await run('__fsChatJournal.snapshot()');assert.equal(initial.items.length,0,'LS-first evidence does not create redundant fallback items');assert.equal(initial.raws.length,1,'only the supplied original cache requires its archive');
 assert.ok(await run("Object.keys(localStorage).some(k=>k.startsWith('fs_chat_journal_v2:'))"));
 const writes=await run('__chatWrites');await run('sbCycle(false)');await waitFor('window.__fsCentralReady===true');
 assert.equal(await run('__chatWrites'),writes);assert.equal((await run('__fsChatJournal.snapshot()')).raws.length,1);
});
test('native unrelated journal denial stays closed without using fallback as a bypass',async t=>{
 const extra=`const originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('fs_chat_journal_v2:'))throw new DOMException('synthetic denial','SecurityError');return originalSet.call(this,k,v)};`;
 const {run,waitFor}=await nativeQuotaFixture(t,{quota:false,extra});await waitFor('__timers.some(t=>t.ms===20000)');
 assert.equal(await run('window.__fsCentralReady'),false);assert.equal(await run('__chatWrites'),0);assert.equal(await run("localStorage.getItem('fs_chats')===__originalRaw"),true);
});
test('native failed index reload cannot turn an empty continuation into ready or a tight retry loop',async t=>{
 const {run,waitFor}=await nativeQuotaFixture(t,{quota:false});await waitFor('window.__fsCentralReady===true');
 await run(`const healthyTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(this.name==='fs_chat_fallback_v1')throw new DOMException('synthetic read failure','UnknownError');return healthyTransaction.apply(this,args)};true`);
 const fulls=await run('__fulls.filter(Boolean).length');await run('sbCycle(false)');
 await new Promise(r=>setTimeout(r,100));
 assert.equal(await run('window.__fsCentralReady'),false);assert.equal(await run('__fulls.filter(Boolean).length'),fulls);assert.equal(await run('__timers.filter(t=>t.ms===0).length'),0);assert.equal(await run('__timers.filter(t=>t.ms===20000).length'),1);
});

for(const failure of ['cache','preservation'])for(const phase of ['startup','cycle'])test('native final '+failure+' denial stays closed through '+phase+' apply and recovers only after storage is healthy',async t=>{
 const boundary=failure==='cache'?`const originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='fs_chats'&&__denyCache){__cacheFailures++;throw new DOMException('synthetic final cache denial','SecurityError')}return originalSet.call(this,k,v)};`:`const originalGet=Storage.prototype.getItem;Storage.prototype.getItem=function(k){if(k.startsWith('fs_chat_journal_v2:')&&__denyCache&&typeof sbApplying!=='undefined'&&sbApplying){__cacheFailures++;throw new DOMException('synthetic final preservation denial','SecurityError')}return originalGet.call(this,k)};`;
 const extra=`window.__denyCache=${phase==='startup'};window.__cacheFailures=0;`+boundary;
 const {run,waitFor,retry}=await nativeQuotaFixture(t,{quota:false,extra});
 if(phase==='cycle') {
  await waitFor('window.__fsCentralReady===true');
  await run("window.__beforeCache=localStorage.getItem('fs_chats');__denyCache=true;__rows.fs_messages.push({job_id:'A04042',uid:'cache-failure-delta',ts:2001,data:{uid:'cache-failure-delta',text:'synthetic delta',ts:2001},updated_at:'2026-10-19T03:00:00Z'});sbCycle(false)");
 }
 await waitFor('__cacheFailures>0 && __timers.some(t=>t.ms===20000)');
 const closed=await run(`({ready:window.__fsCentralReady,sbReady:sbReady,err:sbErr,original:localStorage.getItem('fs_chats')===${phase==='startup'?'__originalRaw':'__beforeCache'},zero:__timers.filter(t=>t.ms===0).length,ordinary:__timers.filter(t=>t.ms===20000).length})`);
 assert.equal(closed.ready,false,'failed final cache write cannot be overwritten by outer ready');assert.equal(closed.sbReady,false);assert.notEqual(closed.err,'');assert.equal(closed.original,true);assert.equal(closed.zero,0);assert.equal(closed.ordinary,1);
 // A later read-state UI action must not reopen this failed round.
 await run('markChatSeen()');assert.equal(await run('window.__fsCentralReady'),false);
 await retry();await waitFor('__cacheFailures>1 && __timers.some(t=>t.ms===20000)');assert.equal(await run('window.__fsCentralReady'),false);
 await run('__denyCache=false');await retry();await waitFor('window.__fsCentralReady===true');assert.equal(await run('sbReady'),true);assert.equal(await run('sbErr'),'');
 assert.equal(await run("getChat('A04042').messages.length"),phase==='startup'?1001:1002);
});

test('native one failed final save cannot be hidden by a later successful save in the same sealed apply',async t=>{
 const extra=`window.__cacheFailures=0;window.__cacheSuccesses=0;window.__repeatSave=false;const originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='fs_chats'&&!__cacheFailures){__cacheFailures++;__repeatSave=true;throw new DOMException('synthetic one-time denial','SecurityError')}if(k==='fs_chats')__cacheSuccesses++;return originalSet.call(this,k,v)};`;
 const {run,waitFor,retry}=await nativeQuotaFixture(t,{quota:false,extra:extra+`window.__laterSave=function(){if(__repeatSave){__repeatSave=false;saveChats()}};`});
 // The native bootstrap calls the sealed saveUsers during apply; set its
 // harmless fixture body before startup actor polling releases the history.
 await run('saveUsers=function(){if(window.__laterSave)__laterSave()}');
 await waitFor('__cacheFailures>0 && __timers.some(t=>t.ms===20000)');
 assert.ok(await run('__cacheSuccesses>0'),'the later save actually succeeded inside the same sealed apply');
 assert.equal(await run('window.__fsCentralReady'),false);assert.equal(await run('sbReady'),false);assert.notEqual(await run('sbErr'),'');
 assert.equal(await run("__fsChatJournal.snapshot().then(s=>s.raws.some(r=>r.sourceKey==='fs_chats'&&r.raw===__originalRaw))"),true);
 await retry();await waitFor('window.__fsCentralReady===true');
});

for(const revocation of ['parent','role'])test('native '+revocation+' revocation during two-item ACK retirement retains archives and closes final apply',async t=>{
 const {createHash}=await import('node:crypto'),h=harness(),identity=JSON.stringify(['sales','test-sales','sales']);
 const entries=[0,1].map(i=>{const value={kind:'pending',identity,jobId:'A04042',message:{uid:'m'+i,text:'synthetic '+i,type:'msg',ts:i}};return {key:'fs_chat_journal_v2:'+createHash('sha256').update(h.run(`stableStr(${JSON.stringify(value)})`)).digest('hex'),raw:JSON.stringify(value)};});
 const extra=`window.__retireCalls=0;const retire=__fsChatJournal.retireExact;__fsChatJournal.retireExact=async function(key,raw){const result=await retire(key,raw);__retireCalls++;if(__retireCalls===1){window.__retireHeld=true;await new Promise(r=>window.__releaseRetire=r)}return result};`;
 const {run,waitFor}=await nativeQuotaFixture(t,{quota:false,extra,seedFallback:{items:entries}});await waitFor('window.__retireHeld===true');
 assert.equal(await run('__scopeReadCount'),3,'nonempty retirement follows startup, complete history, and final scope checks');
 const generation=await run('__fsSessionGeneration'),beforeMemory=await run('JSON.stringify(chats)');assert.equal(await run('window.__fsCentralReady'),false);assert.equal(await run('__writes.length'),0);
 const before=await run('__fsChatJournal.snapshot()');for(const entry of entries)assert.ok(before.raws.some(r=>r.sourceKey===entry.key&&r.raw===entry.raw),'both original raws verified before retirement batch continues');
 await run((revocation==='parent'?"__scope=[];__rows.fs_records=[]":"__fsSessionFetch=async()=>({ok:true,status:200,json:async()=>({authenticated:true,name:'sales',centralUserId:'test-sales',role:'pd'})})")+';__releaseRetire()');
 await waitFor('__retireCalls===2 && __timers.some(t=>t.ms===20000)');
 assert.equal(await run('__scopeReadCount'),4,'retirement reaches a separate final fresh authority read after three earlier scope checks');
 assert.equal(await run('__fsSessionGeneration'),generation,'remote authority change does not alter the local generation');assert.equal(await run('window.__fsCentralReady'),false);assert.equal(await run('sbReady'),false);assert.notEqual(await run('sbErr'),'');assert.equal(await run("localStorage.getItem('fs_chats')===__originalRaw"),true);assert.equal(await run('__writes.length'),0);
 assert.equal(await run('JSON.stringify(chats)'),beforeMemory,'the earlier partial core cache remains unchanged; revoked full snapshot is not applied');assert.equal(await run('chatOpenId'),null);
 const after=await run('__fsChatJournal.snapshot()');for(const entry of entries){assert.ok(after.raws.some(r=>r.sourceKey===entry.key&&r.raw===entry.raw));assert.equal(after.items.some(r=>r.key===entry.key),false,'batch ruling permits redundant ACK item retirement before final remote-revocation detection');}
});

test('initial sealed boot never reads global chats before verified visible IDs',async()=>{
 const f=await fixture();await f.polls();await f.settle();
 const children=f.reads.filter(path=>/^(fs_chats|fs_messages)\?/.test(path));
 assert.ok(children.length,f.h.run('sbErr'));assert.ok(children.every(path=>path.includes('job_id=')),children.join('\n'));
});
