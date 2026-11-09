import assert from 'node:assert/strict';
import test from 'node:test';
import {harness,job,source} from './helpers/job-sync-client.mjs';

// Real sealed pull/merge/scheduler with a synthetic authorized server and clock.
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
  window.__snapshotReads=0;window.__historyRequests=[];window.__scope=['A04042'];window.__snapshot={chats:[],messages:[]};window.__scopeError=0;window.__routeError=0;window.__routeHang=false;
  window.fetch=async function(path,opt){
    if(path==='/__formula/visible-record-ids')return {ok:!__scopeError,status:__scopeError||200,json:async()=>({ids:__scope})};
    if(String(path).startsWith('/__formula/scoped-chat-history?')){
      const encoded=/(?:^|&)job_id=([^&]+)/.exec(String(path).split('?')[1]||'');
      if(!encoded)return {ok:false,status:400,json:async()=>({})};
      const filter=decodeURIComponent(encoded[1]),ids=filter.startsWith('eq.')?[filter.slice(3)]:[...filter.matchAll(/"([^"]+)"/g)].map(match=>match[1]);
      __historyRequests.push({path:String(path),ids});
      if(!ids.length||ids.length>50)return {ok:false,status:400,json:async()=>({})};
      if(ids.some(id=>!__scope.includes(id)))return {ok:false,status:403,json:async()=>({})};
      if(__routeError)return {ok:false,status:__routeError,json:async()=>({})};
      if(__routeHang)return {ok:true,status:200,json:async()=>new Promise(()=>{})};
      const load=async(table,select,order)=>{const result=[];for(let from=0;;from+=1000){const rows=await __request(table+'?select='+select+'&job_id='+encoded[1]+'&order='+order,{headers:{'Range-Unit':'items',Range:from+'-'+(from+999)}});if(!Array.isArray(rows)||rows.length>1000)throw Error('synthetic scoped page incomplete');result.push(...rows);if(rows.length<1000)return result;}};
      try{const chats=await load('fs_chats','job_id,data,updated_at','job_id.asc'),messages=await load('fs_messages','uid,job_id,ts,data,updated_at','uid.asc');return {ok:true,status:200,json:async()=>({chats,messages})};}
      catch(error){return {ok:false,status:error.status||503,json:async()=>({})};}
    }
    if(path==='/__formula/visible-chat-snapshot'){__snapshotReads++;return {ok:true,status:200,json:async()=>__snapshot};}
    return __fetch(path,opt);
  };
`;
const stamp='2026-10-01T00:00:00Z';
const room=id=>({job_id:id,data:{jobId:id,createdBy:'sales',createdAt:1,parts:[]},updated_at:stamp});
const message=(id,uid)=>({job_id:id,uid,ts:1,data:{uid,text:uid,type:'msg',ts:1},updated_at:stamp});
async function fixture({count=1,storage,approvals=[],users=[],ids=['A04042'],intercept,ready=true,renderStatus=false,routeError=0,routeHang=false}={}) {
 const server={records:ids.map(id=>({id,data:job(id),updated_at:stamp})),chats:ids.map(room),messages:Array.from({length:count},(_,i)=>message('A04042','old-'+i)),approvals:structuredClone(approvals),users:structuredClone(users),fail:0,hold:null};
 const h=harness({storage,records:[job('A04042')],beforeAsset:runtime+`\n__scope=${JSON.stringify(ids)};__routeError=${routeError};__routeHang=${routeHang};`+(renderStatus?`\nrenderChat=function(){var marker=document.getElementById('fxStateChat');if(marker)marker.remove();if(chatOpenId){marker=document.createElement('span');marker.id='fxStateChat';marker.textContent='Default formula status';document.body.appendChild(marker);}};`:'' ),handler:async(path,opt)=>{
  if(intercept){const result=await intercept(path,opt);if(result!==undefined)return result;}
  if(path==='rpc/fs_save_record'){const data=structuredClone(opt.body.p_data);server.records=server.records.map(row=>row.id===data.id?{...row,data,updated_at:'2026-10-15T00:00:00Z'}:row);return {status:'saved',id:data.id,data};}
  if(opt?.method==='POST')return opt.body;
  if(server.hold && path.startsWith('fs_messages?'))await server.hold;
  if(server.fail && path.startsWith('fs_messages?'))throw Object.assign(Error('synthetic data unavailable'),{status:server.fail});
  const table=path.split('?')[0],rows=server[({fs_records:'records',fs_chats:'chats',fs_messages:'messages',fs_approvals:'approvals',fs_users:'users'})[table]]||[];
  const params=new URLSearchParams(path.split('?')[1]||'');
  let selected=rows.filter(row=>!params.has('updated_at')||row.updated_at>=params.get('updated_at').replace(/^gte\./,''));
  for(const column of ['id','job_id'])if(params.has(column)){
   const filter=params.get(column),ids=filter.startsWith('eq.')?[filter.slice(3)]:JSON.parse('['+filter.slice(4,-1)+']');selected=selected.filter(row=>ids.includes(row[column]));
  }
  const from=Number(opt?.headers?.Range?.split('-')[0]||0);return structuredClone(selected.slice(from,from+1000));
 }});
 h.context.__snapshot={chats:structuredClone(server.chats),messages:structuredClone(server.messages)};
 for(let turn=0;turn<8;turn++)await h.settle();
 if(ready)assert.equal(h.context.__fsCentralReady,true,h.run('sbErr'));
 return {h,server};
}
const wake=async h=>{await h.run('sbCycle(false)');await h.settle();};

test('routine completion schedules 20 seconds and never repeats full history at the minute',async()=>{
 const {h}=await fixture({count:1001});assert.equal(h.run("getChat('A04042').messages.length"),1001);
 h.run("chatOpenId='A04042';__time+=61000");await wake(h);
 assert.equal(h.run('chatOpenId'),'A04042');
 assert.deepEqual(h.read('__fulls'),[true,false]);
 assert.equal(h.read('__timers').filter(t=>t.ms===20000).length,1);
});

test('sibling cache bursts keep the open history and coalesce into incremental reads',async()=>{
 const {h}=await fixture();h.run("chatOpenId='A04042'");
 for(let i=0;i<6;i++)h.listeners.storage({key:'fs_chats',oldValue:'[]',newValue:'[]'});
 assert.equal(h.run('chatOpenId'),'A04042','storage notification cannot close a verified room');
 await h.settle();await h.settle();assert.deepEqual(h.read('__fulls').filter(Boolean),[true]);
 assert.equal(h.run("getChat('A04042').messages.length"),1);
});

test('scope failure hides old data and always schedules automatic retry',async()=>{
 const {h}=await fixture();h.run("chatOpenId='A04042';__scopeError=503;__timers=[]");await wake(h);
 assert.equal(h.run('chatOpenId'),null);assert.equal(h.context.__fsCentralReady,false);
 assert.equal(h.read('__timers').filter(t=>t.ms===20000).length,1);
 h.run('__scopeError=0');await wake(h);assert.equal(h.context.__fsCentralReady,true);
});

test('data 503 after fresh scope keeps verified display and watermark then recovers automatically',async()=>{
 const {h,server}=await fixture();h.run("chatOpenId='A04042'");const wm=h.read('sbWM');server.fail=503;await wake(h);
 assert.equal(h.run('chatOpenId'),'A04042');assert.equal(h.run("getChat('A04042').messages.length"),1);
 assert.deepEqual(h.read('sbWM'),wm);assert.equal(h.read('__timers').filter(t=>t.ms===20000).length,1);
 server.fail=0;server.messages.push({...message('A04042','new'),updated_at:'2026-10-02T00:00:00Z'});await wake(h);await wake(h);
 assert.deepEqual(h.read("getChat('A04042').messages.map(m=>m.uid)"),['old-0','new']);
});

test('newly granted old job receives all targeted paged history despite newer watermarks',async()=>{
 const {h,server}=await fixture();h.run("sbWM.rec=sbWM.cht=sbWM.msg=sbWM.apv='2026-10-10T00:00:00Z';__scope.push('A04043')");
 server.records.push({id:'A04043',data:job('A04043'),updated_at:stamp});server.chats.push(room('A04043'));
 server.messages.push(...Array.from({length:1001},(_,i)=>message('A04043','granted-'+i)));await wake(h);
 assert.equal(h.run("getChat('A04043').messages.length"),1001);assert.equal(h.run("getChat('A04042').messages.length"),1);
 assert.ok(h.calls.some(c=>c.path.startsWith('fs_messages?')&&/job_id=/.test(c.path)&&!c.path.includes('updated_at=')));
});

test('authoritative inventories remove chat-only deletion and acknowledged approval only',async()=>{
 const {h,server}=await fixture();
 h.run("getChat('A04042').approvals={pd:{by:'pd'}};sbSnap.apvs['A04042|pd']=stableStr({by:'pd'});chatOpenId='A04042'");await wake(h);
 assert.equal(h.run("getChat('A04042').approvals.pd"),undefined);
 server.chats=[];await wake(h);assert.equal(h.run("getChat('A04042')"),undefined);assert.equal(h.run('chatOpenId'),null);
});

test('revoked parent is removed from every exposed record and room collection',async()=>{
 const {h}=await fixture();h.run("chatOpenId='A04042';__scope=[]");await wake(h);
 assert.equal(h.run('records.length'),0);assert.equal(h.run('chats.length'),0);assert.equal(h.run('chatOpenId'),null);
 assert.deepEqual(h.read('sbSnap.records'),{});
});

for(const status of [401,403])test(`data ${status} hides sensitive display without downgrading capabilities`,async()=>{
 const {h,server}=await fixture();h.run("chatOpenId='A04042'");server.fail=status;await wake(h);
 assert.equal(h.run('chatOpenId'),null);assert.equal(h.context.__fsCentralReady,false);
 assert.equal(h.run('sbCap.msg'),true);assert.equal(h.run('sbCap.apv'),true);
});

test('a stalled read times out, releases the cycle and cannot advance a late watermark',async()=>{
 const {h,server}=await fixture();h.run("chatOpenId='A04042'");let release;server.hold=new Promise(resolve=>{release=resolve;});
 const before=h.read('sbWM'),pending=h.run('sbCycle(false)');for(let i=0;i<8;i++)await h.settle();
 const timer=h.run('__timers.find(t=>t.ms===15000)');assert.ok(timer,'bounded read deadline exists');
 timer.fn();await pending;assert.equal(h.run('chatOpenId'),'A04042');
 server.messages.push({...message('A04042','late'),updated_at:'2026-10-12T00:00:00Z'});release();await h.settle();
 assert.deepEqual(h.read('sbWM'),before,'late read completion cannot consume unapplied rows');
 server.hold=null;await wake(h);assert.ok(h.read("getChat('A04042').messages.map(m=>m.uid)").includes('late'));
});

test('permission readiness does not close an already verified same-actor room',async()=>{
 const {h}=await fixture();h.run("chatOpenId='A04042';window.__fsPermissionReady=false;renderChat()");
 assert.equal(h.run('chatOpenId'),'A04042');
 assert.equal(h.run("__fsJobSync.canCreate()"),false,'write gate remains closed');
});

test('same verified room still renders its history while permission check is pending',async()=>{
 const {h}=await fixture();h.run("chatOpenId='A04042';window.__fsPermissionReady=false");
 assert.equal(h.run("chatRoomHTML(getChat('A04042'),records[0])"),'allowed');
});

test('a scope recheck failure after staged data hides the old room and rolls back watermark',async()=>{
 const {h,server}=await fixture();h.run("chatOpenId='A04042'");const before=h.read('sbWM');
 const fetch=h.context.fetch;let calls=0;h.context.fetch=async(...args)=>{if(args[0]==='/__formula/visible-record-ids'&&++calls===2)throw Error('scope recheck offline');return fetch(...args);};
 server.messages.push({...message('A04042','staged'),updated_at:'2026-10-11T00:00:00Z'});await wake(h);
 assert.equal(h.run('chatOpenId'),null);assert.equal(h.context.__fsCentralReady,false);assert.deepEqual(h.read('sbWM'),before);
});

test('partial new-grant second page is retried without consuming its old history',async()=>{
 const {h,server}=await fixture();h.run("__scope.push('A04043');sbWM.msg='2026-10-10T00:00:00Z'");
 server.records.push({id:'A04043',data:job('A04043'),updated_at:stamp});server.chats.push(room('A04043'));server.messages.push(...Array.from({length:1001},(_,i)=>message('A04043','retry-'+i)));
 const request=h.context.__request;let fail=true;h.context.__request=async(path,opt)=>{if(fail&&path.startsWith('fs_messages?')&&path.includes('job_id=')&&opt.headers.Range==='1000-1999')throw Object.assign(Error('page unavailable'),{status:503});return request(path,opt);};
 await wake(h);assert.equal(h.run("!!getChat('A04043')"),false);fail=false;await wake(h);
 assert.equal(h.run("getChat('A04043').messages.length"),1001);
});

test('incremental authorized readback retires exact pending messages and never journals confirmed deltas',async()=>{
 const {h,server}=await fixture();h.run("getChat('A04042').messages.push({uid:'sent-delta',text:'sent-delta',type:'msg',ts:1});saveChats()");
 server.messages.push({...message('A04042','sent-delta'),updated_at:'2026-10-12T00:00:00Z'});await wake(h);h.run('saveChats()');
 const pending=[...h.storage].filter(([key])=>key.startsWith('fs_chat_journal_v2:')).map(([,raw])=>JSON.parse(raw));
 assert.ok(!pending.some(item=>item.kind==='pending'&&item.message?.uid==='sent-delta'));
});


test('legacy window-target listener cannot install slim chat cache before runtime storage handler',async()=>{
 const {h}=await fixture();h.run("chatOpenId='A04042';localStorage.setItem('fs_chats',JSON.stringify([{jobId:'A04042',messages:[]}]));loadChats();renderChat()");
 assert.equal(h.run("getChat('A04042').messages.length"),1);
});


test('three sibling tabs stop cache and journal wakeups after bounded cycles and retain each draft',async()=>{
 const storage=new Map(),tabs=[];for(let i=0;i<3;i++)tabs.push((await fixture({storage})).h);
 let notifications=0;
 for(const tab of tabs){const put=tab.context.localStorage.setItem,remove=tab.context.localStorage.removeItem;
  const broadcast=(key,oldValue,newValue)=>{if(oldValue===newValue)return;if(++notifications>100)throw Error('cross-tab notification loop');for(const sibling of tabs)if(sibling!==tab)Promise.resolve().then(()=>{
   if(key==='fs_chats')sibling.run('loadChats();renderChat()');sibling.listeners.storage({key,oldValue,newValue});
  });};
  tab.context.localStorage.setItem=(key,value)=>{const oldValue=storage.get(key)||null;put(key,value);broadcast(key,oldValue,value);};
  tab.context.localStorage.removeItem=key=>{const oldValue=storage.get(key)||null;remove(key);broadcast(key,oldValue,null);};
 }
 for(let i=0;i<tabs.length;i++)tabs[i].run(`chatOpenId='A04042';getChat('A04042').messages.push({uid:'tab-${i}',text:'draft-${i}',ts:2});saveChats()`);
 for(let turn=0;turn<12;turn++)for(const tab of tabs)await tab.settle();
 const settled=notifications;for(let turn=0;turn<8;turn++)for(const tab of tabs)await tab.settle();assert.equal(notifications,settled,'no continuing ping-pong');
 for(let i=0;i<tabs.length;i++){const tab=tabs[i];assert.equal(tab.run('chatOpenId'),'A04042');assert.ok(tab.read("getChat('A04042').messages.map(m=>m.uid)").includes('tab-'+i));assert.deepEqual(tab.read('__fulls').filter(Boolean),[true]);assert.ok(tab.read('__fulls').length<=3,'one cycle plus at most one queued follow-up per burst');}
});

test('a response whose scope JSON never settles times out and schedules a closed retry',async()=>{
 const {h}=await fixture();h.run("chatOpenId='A04042'");const fetch=h.context.fetch;
 h.context.fetch=async(...args)=>args[0]==='/__formula/visible-record-ids'?{ok:true,status:200,json:()=>new Promise(()=>{})}:fetch(...args);
 const cycle=h.run('sbCycle(false)');await h.settle();const timer=h.run('__timers.find(t=>t.ms===15000)');assert.ok(timer);timer.fn();await cycle;
 assert.equal(h.run('chatOpenId'),null);assert.equal(h.context.__fsCentralReady,false);assert.equal(h.read('__timers').filter(t=>t.ms===20000).length,1);
});

test('explicit use-server recovery retains the authoritative full baseline path',async()=>{
 const {h}=await fixture();h.run('sbGuardTake=true');await wake(h);assert.deepEqual(h.read('__fulls'),[true,true]);assert.equal(h.context.__fsCentralReady,true);
});

for(const ids of [['A04042','A04042'],[42],null])test(`malformed scope ${JSON.stringify(ids)} closes display and writes`,async()=>{
 const {h}=await fixture();h.context.__scope=ids;h.run("chatOpenId='A04042'");await wake(h);assert.equal(h.run('chatOpenId'),null);assert.equal(h.context.__fsCentralReady,false);
});

for(const scenario of ['approval','chat','parent'])test(`inventory-only ${scenario} removal produces one visible refresh and next no-op stays quiet`,async()=>{
 const {h,server}=await fixture();h.run("var __rerenders=0;sbRerender=function(){__rerenders++};sbCanEdit=false;sbWM.rec=sbWM.cht=sbWM.msg=sbWM.apv='2026-10-10T00:00:00Z'");
 if(scenario==='approval')h.run("getChat('A04042').approvals.pd={by:'pd'};sbSnap.apvs['A04042|pd']=stableStr({by:'pd'})");
 if(scenario==='chat')server.chats=[];
 if(scenario==='parent'){h.context.__scope=[];server.records=[];server.chats=[];}
 await wake(h);assert.equal(h.run('__rerenders'),1,'visible rows must update without another delta');await wake(h);assert.equal(h.run('__rerenders'),1,'unchanged cycle must not redraw');
});

for(const malformed of [null,{},[null],[{job_id:'A04043',data:{}}]])test(`malformed targeted page ${JSON.stringify(malformed)} retains old-history hydration obligation`,async()=>{
 const {h,server}=await fixture();h.run("__scope.push('A04043');sbWM.rec=sbWM.cht=sbWM.msg=sbWM.apv='2026-10-10T00:00:00Z'");
 server.records.push({id:'A04043',data:job('A04043'),updated_at:stamp});server.chats.push(room('A04043'));server.messages.push(...Array.from({length:1001},(_,i)=>message('A04043','soft-'+i)));
 const request=h.context.__request;let broken=true;h.context.__request=async(path,opt)=>broken&&path.startsWith('fs_messages?')&&path.includes('job_id=')&&opt.headers.Range==='1000-1999'?malformed:request(path,opt);
 const before=h.read('sbWM');await wake(h);assert.deepEqual(h.read('sbWM'),before);assert.equal(h.run("!!getChat('A04043')"),false,'incomplete staged history must not be committed');
 broken=false;await wake(h);assert.equal(h.run("getChat('A04043').messages.length"),1001);
});

for(const failure of ['503','timeout','malformed','final-recheck'])test(`unsent textarea survives ${failure} scope hide and scheduled recovery`,async()=>{
 const {h}=await fixture();h.run("chatOpenId='A04042';var input=document.createElement('textarea');input.id='chatInput';input.value='ยังไม่ได้ส่ง private draft';input.selectionStart=3;input.selectionEnd=8;input.setSelectionRange=function(s,e){this.selectionStart=s;this.selectionEnd=e};document.body.appendChild(input);input.focus()");
 if(failure==='503')h.run('__documentEvents.compositionstart({target:input})');
 const healthyFetch=h.context.fetch;
 if(failure==='503')h.context.__scopeError=503;
 if(failure==='malformed')h.context.__scope=['A04042','A04042'];
 if(failure==='timeout')h.context.fetch=async(...args)=>args[0]==='/__formula/visible-record-ids'?{ok:true,status:200,json:()=>new Promise(()=>{})}:healthyFetch(...args);
 if(failure==='final-recheck'){let reads=0;h.context.fetch=async(...args)=>{if(args[0]==='/__formula/visible-record-ids'&&++reads===2)throw Error('scope recheck unavailable');return healthyFetch(...args);};}
 if(failure==='timeout'){const cycle=h.run('sbCycle(false)');await h.settle();h.run('__timers.find(t=>t.ms===15000).fn()');await cycle;}else await wake(h);
 assert.equal(h.run('chatOpenId'),null);
 h.run("input.remove();var replacement=document.createElement('textarea');replacement.id='chatInput';replacement.value='';replacement.setSelectionRange=function(s,e){this.selectionStart=s;this.selectionEnd=e};document.body.appendChild(replacement);__scopeError=0;__scope=['A04042']");h.context.fetch=healthyFetch;await h.run('__timers.find(t=>t.ms===20000).fn()');await h.settle();
 await h.run("openChatRoom('A04042')");h.run("renderChat()");assert.equal(h.run('replacement.value'),'ยังไม่ได้ส่ง private draft');assert.deepEqual(h.read('[replacement.selectionStart,replacement.selectionEnd]'),[3,8]);assert.equal(h.run('document.activeElement===replacement'),true);
});

for(const change of ['role','actor','room'])test(`hidden unsent text is never restored into a different ${change}`,async()=>{
 const {h,server}=await fixture();h.run("chatOpenId='A04042';var privateInput=document.createElement('textarea');privateInput.id='chatInput';privateInput.value='private unsent';document.body.appendChild(privateInput);__scopeError=503");await wake(h);
 h.run("privateInput.remove();var cleanInput=document.createElement('textarea');cleanInput.id='chatInput';cleanInput.value='';document.body.appendChild(cleanInput);__scopeError=0");
 if(change==='role')h.setTrustedSession({name:'sales',role:'admin',centralUserId:'test-sales',authenticated:true});
 if(change==='actor'){h.setTrustedSession({name:'admin',role:'admin',centralUserId:'test-admin',authenticated:true});h.run("currentUser='admin'");}
 if(change==='room'){server.records.push({id:'A04043',data:job('A04043'),updated_at:stamp});server.chats.push(room('A04043'));h.context.__scope.push('A04043');h.context.__snapshot={chats:server.chats,messages:server.messages};}
 await wake(h);h.run(`openChatRoom('${change==='room'?'A04043':'A04042'}');renderChat()`);assert.equal(h.run('cleanInput.value'),'');
});

test('a cache write failure cannot retain an open room already revoked by fresh scope',async()=>{
 const {h}=await fixture();const put=h.context.localStorage.setItem;h.context.localStorage.setItem=(key,value)=>{if(key==='fs_chats')throw Error('synthetic cache failure');return put(key,value);};
 h.run("chatOpenId='A04042';__scope=[]");await wake(h);assert.equal(h.run('chatOpenId'),null);assert.equal(h.context.__fsCentralReady,false);
});


test('fresh scope revocation redraws the list even when the following data read fails',async()=>{
 const {h,server}=await fixture();h.run("var __rerenders=0;sbRerender=function(){__rerenders++};sbCanEdit=false;__scope=[]");server.records=[];server.chats=[];
 const request=h.context.__request;h.context.__request=async(path,opt)=>{if(path.startsWith('fs_users?'))throw Object.assign(Error('data unavailable'),{status:503});return request(path,opt);};
 await wake(h);assert.equal(h.run('records.length'),0);assert.equal(h.run('__rerenders'),1);
});


test('parent acknowledgement preserves exact existing child receipts instead of replaying another role approvals',async()=>{
 const {h}=await fixture({approvals:[{job_id:'A04042',part:'ra',data:{by:'Synthetic RA'},updated_at:stamp}]});
 h.run("records[0].brand='Own acknowledged edit';saveRecordsStore()");await wake(h);assert.deepEqual(h.pending(),{});
 assert.equal(h.calls.filter(call=>call.path==='fs_approvals'&&call.opt?.method==='POST').length,0,'unchanged read-confirmed approval must never be replayed as this actor');
 assert.equal(h.calls.filter(call=>call.path==='fs_messages'&&call.opt?.method==='POST').length,0,'unchanged read-confirmed messages keep their receipt');
});


test('metadata inventory removes only acknowledged deleted profiles and preserves unsent profile work',async()=>{
 const rows=[{name:'sales',data:{name:'sales',role:'sales'},updated_at:stamp},{name:'Deleted user',data:{name:'Deleted user',role:'sales'},updated_at:stamp},{name:'Edited user',data:{name:'Edited user',role:'sales'},updated_at:stamp}];
 const {h,server}=await fixture({users:rows});h.run("sbCanEdit=false;sbWM.usr='2026-10-10T00:00:00Z';userList.find(user=>user.name==='Edited user').note='Unsent own draft';userList.push({name:'Local pending',role:'sales'});var __rerenders=0;sbRerender=function(){__rerenders++}");
 server.users=server.users.filter(user=>user.name==='sales');await wake(h);
 assert.deepEqual(h.read('userList.map(user=>user.name)'),['sales','Edited user','Local pending']);assert.equal(h.run('__rerenders'),1);await wake(h);assert.equal(h.run('__rerenders'),1);
 assert.ok(h.calls.some(call=>call.path==='fs_users?select=name,updated_at&order=name.asc'));assert.equal(h.calls.filter(call=>call.path==='fs_users'&&call.opt?.method==='POST').length,0);
});


test('a profile deleted after delta read is not reapplied over its newer inventory omission',async()=>{
 const {h,server}=await fixture({users:[{name:'Deleted user',data:{name:'Deleted user',role:'sales'},updated_at:stamp}]});h.run('sbCanEdit=false');
 const request=h.context.__request;h.context.__request=async(path,opt)=>{const result=await request(path,opt);if(path.startsWith('fs_users?select=name,data'))server.users=[];return result;};
 await wake(h);assert.deepEqual(h.read('userList'),[]);
});

// Final review F1/F2: central deletion and fresh revocation outrank stale staged
// payloads and same-actor immutable recovery notifications.
for(const path of ['delta','targeted','embedded'])test(`newer approval inventory defeats stale ${path} approval without replay`,async()=>{
 const approval={job_id:'A04042',part:'pd',data:{by:'Synthetic PD'},updated_at:stamp};
 const {h,server}=await fixture({approvals:[approval]});h.run('sbCanEdit=false');
 if(path==='targeted')server.chats[0].updated_at='2026-10-18T00:00:00Z';
 const request=h.context.__request;let deleted=false;
 h.context.__request=async(url,opt)=>{
  if(path==='targeted' && url.startsWith('fs_chats?select=job_id,data') && !url.includes('job_id='))return [];
  if(path==='targeted' && url.startsWith('fs_approvals?select=job_id,part,data') && url.includes('job_id='))return [structuredClone(approval)];
  const result=await request(url,opt);
  if(url.startsWith('fs_approvals?select=job_id,part,data')&&!url.includes('job_id=')&&!deleted){deleted=true;server.approvals=[];if(path==='targeted')server.chats[0].updated_at='2026-10-18T00:00:00Z';}
  if(path==='targeted' && url.startsWith('fs_approvals?select=job_id,part,data')&&!url.includes('job_id='))return [];
  return result;
 };
 if(path==='embedded')server.chats[0].data.approvals={pd:approval.data};
 await wake(h);
 assert.equal(h.run("getChat('A04042').approvals.pd"),undefined,'deleted approval cannot enable the Pass state');
 assert.equal(h.run("sbSnap.apvs['A04042|pd']"),undefined,'deleted approval has no receipt');
 h.run('sbCanEdit=true');await wake(h);
 assert.equal(h.calls.filter(c=>c.path==='fs_approvals'&&c.opt?.method==='POST').length,0);
});

test('newer approval omission preserves a differing unacknowledged approval intent',async()=>{
 const approval={job_id:'A04042',part:'pd',data:{by:'Synthetic PD'},updated_at:stamp};
 const {h,server}=await fixture({approvals:[approval]});h.run(source('saveChats')+'\n  sbQueue();\n}');h.run("sbCanEdit=false;getChat('A04042').approvals.pd={by:'Own pending approval'};saveChats()");
 server.chats[0].data.approvals={pd:approval.data};const request=h.context.__request;
 h.context.__request=async(url,opt)=>{const result=await request(url,opt);if(url.startsWith('fs_approvals?select=job_id,part,data')&&!url.includes('job_id='))server.approvals=[];return result;};
 await wake(h);assert.deepEqual(h.read("getChat('A04042').approvals.pd"),{by:'Own pending approval'});
 assert.equal(h.run("sbSnap.apvs['A04042|pd']"),undefined);
 assert.ok(h.storage.get('fs_chats').includes('Own pending approval'),'own intent remains recoverable in the existing room cache');
});
const parentJournal=h=>Object.fromEntries([...h.storage].filter(([key])=>key.startsWith('fs_job_outbox_v1:')));
const parentAttempts=h=>h.calls.filter(c=>c.path==='rpc/fs_save_record'||['fs_chats','fs_messages','fs_approvals'].includes(c.path)&&c.opt?.method==='POST');
async function pendingRevocation({write=false,fail=false}={}){
 const {h,server}=await fixture();h.run("records[0].brand='Own pending parent';saveRecordsStore();chatOpenId='A04042'");
 const bytes=parentJournal(h);assert.ok(Object.keys(bytes).length);h.run(`sbCanEdit=${write};__scope=[]`);
 server.records=[];server.chats=[];server.messages=[];server.fail=fail?503:0;h.calls.length=0;
 return {h,server,bytes};
}
function assertRevoked(h,bytes){
 assert.deepEqual(h.read('records.map(r=>r.id)'),[]);assert.deepEqual(h.read('chats.map(c=>c.jobId)'),[]);assert.deepEqual(h.read('Object.keys(sbSnap.records)'),[]);
 assert.equal(h.run('chatOpenId'),null);
 assert.equal(parentAttempts(h).length,0,'revoked parent and children issue no write request');
 assert.deepEqual(parentJournal(h),bytes,'private immutable journal bytes stay exact');assert.equal(h.pending().A04042.data.brand,'Own pending parent');
}
for(const failure of [false,true])test(`revoked pending parent remains private before/after outbox event, data503=${failure}`,async()=>{
 const {h,bytes}=await pendingRevocation({fail:failure});await wake(h);assertRevoked(h,bytes);
 const [key,raw]=Object.entries(bytes)[0];h.listeners.storage({key,oldValue:null,newValue:raw});assertRevoked(h,bytes);
 await wake(h);assertRevoked(h,bytes);
});
for(const interleave of [false,true])test(`revoked pending parent cannot replay with push-session outbox interleave=${interleave}`,async()=>{
 const {h,bytes}=await pendingRevocation({write:true});const fetch=h.context.__fetch;let sessions=0;
 h.context.__fetch=async(...args)=>{if(args[0]==='/sb/session'&&++sessions===3&&interleave){const [key,raw]=Object.entries(bytes)[0];h.listeners.storage({key,oldValue:null,newValue:raw});}return fetch(...args);};
 const request=h.context.__request;h.context.__request=async(path,opt)=>{if(path==='rpc/fs_save_record'){h.calls.push({path,opt:structuredClone(opt)});return {status:'forbidden',id:opt.body.p_id};}return request(path,opt);};
 await wake(h);assert.ok(sessions>=3);assertRevoked(h,bytes);
});

test('revoked private parent waits through incomplete regrant then hydrates all old history before CAS conflict',async()=>{
 const {h,server,bytes}=await pendingRevocation();await wake(h);assertRevoked(h,bytes);
 h.context.__scope=['A04042'];server.records=[{id:'A04042',data:{...job('A04042'),brand:'New central revision'},updated_at:stamp}];server.chats=[room('A04042')];server.messages=Array.from({length:1001},(_,i)=>message('A04042','regrant-'+i));
 h.run("sbWM.rec=sbWM.cht=sbWM.msg=sbWM.apv='2026-10-10T00:00:00Z'");const request=h.context.__request;let incomplete=true;
 h.context.__request=async(path,opt)=>{if(incomplete&&path.startsWith('fs_messages?')&&path.includes('job_id=')&&opt.headers.Range==='1000-1999')return null;if(path==='rpc/fs_save_record'){h.calls.push({path,opt:structuredClone(opt)});return {status:'conflict',id:opt.body.p_id};}return request(path,opt);};
 await wake(h);assertRevoked(h,bytes);incomplete=false;await wake(h);
 assert.equal(h.run("getChat('A04042').messages.length"),1001);assert.equal(h.run('records[0].brand'),'Own pending parent');assert.equal(parentAttempts(h).length,0,'regrant reads finish before any replay');
 h.run('sbCanEdit=true');await wake(h);assert.equal(h.calls.filter(c=>c.path==='rpc/fs_save_record').length,1);assert.equal(h.pending().A04042.status,'conflict');
 assert.deepEqual(h.calls.find(c=>c.path==='rpc/fs_save_record').opt.body.p_expected,job('A04042'),'CAS retains original acknowledged baseline');
});

test('a legitimate new local parent still saves during a scoped delta cycle',async()=>{
 const {h}=await fixture();h.run("records.push({...records[0],id:'A04043',brand:'New local create'});recTouched.A04043=1;saveRecordsStore()");h.calls.length=0;await wake(h);
 const call=h.calls.find(c=>c.path==='rpc/fs_save_record');assert.ok(call,'create remains eligible outside the prior central scope');assert.equal(call.opt.body.p_id,'A04043');assert.equal(call.opt.body.p_expected,null);
 assert.equal(h.pending().A04043,undefined);
});

test('a late sibling journal for a formerly central omitted parent stays private until complete regrant',async()=>{
 const {h}=await fixture();const data={...job('A04043'),brand:'Late private edit'},key='fs_job_outbox_v1:sales:late-sibling';
 const raw=JSON.stringify({version:1,owner:'sales',id:'A04043',tab:'late',data,expected:job('A04043'),status:'pending',activities:[],at:1});
 h.storage.set(key,raw);h.listeners.storage({key,oldValue:null,newValue:raw});
 assert.deepEqual(h.read('records.map(r=>r.id)'),['A04042']);assert.equal(h.storage.get(key),raw);h.calls.length=0;await wake(h);
 assert.equal(h.calls.filter(c=>c.path==='rpc/fs_save_record').length,0);assert.equal(h.storage.get(key),raw);
});

test('stale revoked delta parent is excluded before the sealed merger can redraw',async()=>{
 const {h,server,bytes}=await pendingRevocation();const stale={id:'A04042',data:job('A04042'),updated_at:stamp},request=h.context.__request;
 h.context.__request=async(path,opt)=>path.startsWith('fs_records?select=id,data')?[stale]:request(path,opt);
 h.run("var __exposedDuringRender=[];sbRerender=function(){__exposedDuringRender.push(records.map(r=>r.id))}");await wake(h);
 assertRevoked(h,bytes);assert.ok(h.read('__exposedDuringRender').every(ids=>!ids.includes('A04042')),'sealed merge never exposes a stale revoked row even temporarily');
});

test('fresh full baseline also quarantines an omitted acknowledged sibling draft',async()=>{
 const key='fs_job_outbox_v1:sales:startup-sibling',data={...job('A04043'),brand:'Startup private edit'};
 const raw=JSON.stringify({version:1,owner:'sales',id:'A04043',tab:'startup',data,expected:job('A04043'),status:'pending',activities:[],at:1});
 const {h}=await fixture({storage:new Map([[key,raw]])});assert.deepEqual(h.read('records.map(r=>r.id)'),['A04042']);assert.equal(h.storage.get(key),raw);
});

// Scoped history contract: production changes below must make these fail.
test('bootstrap reads visible IDs then bounded rooms/messages without global snapshot',async()=>{
 const ids=Array.from({length:51},(_,n)=>'A'+String(4000+n).padStart(5,'0'));
 const {h}=await fixture({ids,count:1001});
 assert.equal(h.run('__snapshotReads'),0);
 const bundles=h.read('__historyRequests');assert.equal(bundles.length,2);assert.ok(bundles.every(bundle=>bundle.ids.length>=1&&bundle.ids.length<=50));
 const reads=h.calls.filter(c=>/^(fs_chats|fs_messages)\?/.test(c.path));
 assert.ok(reads.length);for(const call of reads){const query=new URLSearchParams(call.path.split('?')[1]);assert.ok(query.has('job_id'),call.path);assert.ok(JSON.parse('['+query.get('job_id').slice(4,-1)+']').length<=50);const [lo,hi]=call.opt.headers.Range.split('-').map(Number);assert.ok(hi-lo<1000);}
});
test('scoped history denial keeps startup closed and retries without losing journal bytes',async()=>{
 const identity=JSON.stringify(['sales','test-sales','sales']),key='fs_chat_pending_v1:'+encodeURIComponent(identity),raw=JSON.stringify([{jobId:'A04042',message:{uid:'draft',text:'keep draft'}}]);
 const {h}=await fixture({ready:false,routeError:403,storage:new Map([[key,raw]])});
 assert.equal(h.context.__fsCentralReady,false);assert.equal(h.run('sbReady'),false);assert.equal(h.context.__fsJobSync.canCreate(),false);
 assert.equal(h.storage.get(key),raw);assert.ok(h.read('__historyRequests').length);
 h.run('__routeError=0');await wake(h);
 assert.equal(h.context.__fsCentralReady,true,h.run('sbErr'));assert.equal(h.storage.get(key),raw);
});
test('a stalled scoped history body has a bounded 30 second deadline',async()=>{
 const {h}=await fixture({ready:false,routeHang:true});
 assert.ok(h.run('__timers.some(timer=>timer.ms===30000)'),'scoped history has its own bounded response deadline');
 h.run('__timers.find(timer=>timer.ms===30000).fn()');await h.settle();
 assert.equal(h.context.__fsCentralReady,false);assert.equal(h.run('sbReady'),false);assert.equal(h.context.__fsJobSync.canCreate(),false);
});
test('scheduled refresh joins a running targeted room read after an incomplete baseline',async()=>{
 let releaseTarget;const heldTarget=new Promise(resolve=>releaseTarget=resolve);
 const {h}=await fixture({ready:false,routeError:503,intercept:async path=>{if(path.startsWith('fs_messages?')&&decodeURIComponent(path).includes('A04042'))await heldTarget;}});
 assert.equal(h.context.__fsCentralReady,false);h.run('__routeError=0');
 const opening=h.run("openChatRoom('A04042')");await h.settle();
 const before=h.read('__historyRequests').length;assert.ok(before>=2,'target request begins after failed baseline');
 const cycle=h.run('sbCycle(false)');await h.settle();
 assert.equal(h.read('__historyRequests').length,before,'scheduled refresh waits for the targeted read instead of overlapping it');
 releaseTarget();await opening;await cycle;await h.settle();
 assert.equal(h.run('__timers.filter(timer=>timer.ms===20000).length'),1,'ordinary 20 second schedule remains singular');
});
for(const row of ['foreign','another-batch','duplicate'])test('bootstrap rejects '+row+' scoped rows atomically and retries',async()=>{
 const ids=Array.from({length:51},(_,n)=>'A'+String(4042+n).padStart(5,'0'));let broken=true;
 const {h}=await fixture({ids,ready:false,intercept:(path,opt)=>{if(broken&&path.startsWith('fs_chats?')&&path.includes('job_id=')){return row==='duplicate'?[room(ids[0]),room(ids[0])]:[room(row==='foreign'?'A99999':ids[50])];}}});
 assert.equal(h.context.__fsCentralReady,false);assert.equal(h.run('sbReady'),false);assert.equal(h.context.__fsJobSync.canCreate(),false);assert.equal(h.run('chats.length'),0);
 broken=false;await wake(h);assert.equal(h.context.__fsCentralReady,true);
});
test('bootstrap rejects malformed second page without applying partial history',async()=>{
 let broken=true;const {h}=await fixture({count:1001,ready:false,intercept:(path,opt)=>broken&&path.startsWith('fs_messages?')&&opt?.headers?.Range==='1000-1999'?null:undefined});
 assert.equal(h.context.__fsCentralReady,false);assert.equal(h.run('chats.length'),0);broken=false;await wake(h);assert.equal(h.run("getChat('A04042').messages.length"),1001);
});
test('empty visible scope performs no room or message REST reads',async()=>{
 const {h}=await fixture({ids:[],count:0});assert.equal(h.run('__snapshotReads'),0);assert.equal(h.calls.filter(c=>/^(fs_chats|fs_messages)\?/.test(c.path)).length,0);
});
test('direct open reads only selected complete old history and preserves unrelated state',async()=>{
 const {h,server}=await fixture({ids:['A04042','A04043']});
 h.run("getChat('A04043').approvals={pd:{by:'keep'}};getChat('A04043').seen={sales:99};sbSnap.apvs['A04043|pd']='keep';chatOpenId='A04043';sbWM.msg='2026-10-20T00:00:00Z'");
 const before=h.read("getChat('A04043')"),receipts=h.read('sbSnap.apvs'),journals=[...h.storage].filter(([key])=>key.startsWith('fs_chat_journal'));h.calls.length=0;
 server.messages.push(...Array.from({length:1001},(_,n)=>message('A04042','direct-'+n)));
 await h.run("openChatRoom('A04042')");await h.settle();
 assert.equal(h.run("getChat('A04042').messages.length"),1002);assert.deepEqual(h.read("getChat('A04043')"),before);assert.deepEqual(h.read('sbSnap.apvs'),receipts);assert.deepEqual([...h.storage].filter(([key])=>key.startsWith('fs_chat_journal')),journals);
 const reads=h.calls.filter(c=>/^(fs_chats|fs_messages)\?/.test(c.path));assert.ok(reads.length);for(const call of reads){const p=new URLSearchParams(call.path.split('?')[1]);assert.deepEqual(JSON.parse('['+p.get('job_id').slice(4,-1)+']'),['A04042']);assert.equal(p.has('updated_at'),false);}
});
for(const change of ['session','scope','denied'])test('direct open rejects mid-read '+change+' and can retry',async()=>{
 const {h}=await fixture();const request=h.context.__request;let changed=false;h.context.__request=async(path,opt)=>{const result=await request(path,opt);if(!changed&&path.startsWith('fs_messages?')){changed=true;if(change==='session')h.setTrustedSession({name:'sales',role:'admin',centralUserId:'test-sales',authenticated:true});if(change==='scope')h.context.__scope=[];if(change==='denied')h.context.__scopeError=403;}return result;};
 h.run('chatOpenId=null');await h.run("openChatRoom('A04042')");assert.equal(h.run('chatOpenId'),null);
 h.setTrustedSession({name:'sales',role:'sales',centralUserId:'test-sales',authenticated:true});h.context.__scope=['A04042'];h.context.__scopeError=0;h.context.__request=request;await h.run("openChatRoom('A04042')");assert.equal(h.run('chatOpenId'),'A04042');
});
test('later B open wins over late A response',async()=>{
 const {h}=await fixture({ids:['A04042','A04043']});const request=h.context.__request;let release;const hold=new Promise(resolve=>release=resolve);h.context.__request=async(path,opt)=>{if(path.startsWith('fs_messages?')&&decodeURIComponent(path).includes('"A04042"'))await hold;return request(path,opt);};
 const a=h.run("openChatRoom('A04042')");await h.settle();await h.run("openChatRoom('A04043')");release();await a;assert.equal(h.run('chatOpenId'),'A04043');
});
test('scheduled refresh waits for stale A transport after B opens promptly',async()=>{
 const {h}=await fixture({ids:['A04042','A04043']});
 h.run('sbReady=false;window.__fsCentralReady=false;chatOpenId=null');
 const request=h.context.__request;let releaseA;const heldA=new Promise(resolve=>releaseA=resolve);
 h.context.__request=async(path,opt)=>{if(path.startsWith('fs_messages?')&&decodeURIComponent(path).includes('A04042'))await heldA;return request(path,opt);};
 const openingA=h.run("openChatRoom('A04042')");await h.settle();
 await h.run("openChatRoom('A04043')");assert.equal(h.run('chatOpenId'),'A04043','B remains responsive while A is pending');
 const before=h.read('__historyRequests').length;
 const cycle=h.run('sbCycle(false)');await h.settle();
 assert.equal(h.read('__historyRequests').length,before,'the cycle must not start history while stale A is still in flight');
 assert.equal(h.run('chatOpenId'),'A04043','the cycle cannot render stale A over B');
 releaseA();await openingA;await cycle;await h.settle();
 assert.notEqual(h.run('chatOpenId'),'A04042','late A cannot replace B during the queued baseline recovery');
 assert.equal(h.run('__timers.filter(timer=>timer.ms===20000).length'),1);
});
test('targeted read renders while full baseline is pending and all writes remain closed',async()=>{
 const {h}=await fixture();h.run('sbReady=false;window.__fsCentralReady=false;chatOpenId=null');await h.run("openChatRoom('A04042')");
 assert.equal(h.run('chatOpenId'),'A04042');assert.equal(h.run("chatRoomHTML(getChat('A04042'),records[0])"),'allowed');assert.equal(h.run('sbReady'),false);assert.equal(h.context.__fsCentralReady,false);assert.equal(h.context.__fsJobSync.canCreate(),false);h.calls.length=0;h.run("createChat('A04042');sendChatMsg()");assert.equal(h.calls.filter(c=>c.opt?.method==='POST'&&!c.path.startsWith('/__formula/client-diagnostic')).length,0);
});

test('direct read displays old messages without a room reference without creating a room centrally',async()=>{
 const {h,server}=await fixture();server.chats=[];h.calls.length=0;await h.run("openChatRoom('A04042')");
 assert.equal(h.run('chatOpenId'),'A04042');assert.deepEqual(h.read("getChat('A04042').messages.map(m=>m.uid)"),['old-0']);assert.equal(server.chats.length,0);assert.equal(h.calls.filter(c=>c.opt?.method==='POST'&&!c.path.startsWith('/__formula/client-diagnostic')).length,0);
});
test('targeted read completes independently of a real pending unrelated baseline page',async()=>{
 let release,hold=true;const pending=new Promise(resolve=>release=resolve);
 const {h}=await fixture({ids:['A04042','A04043'],ready:false,intercept:async path=>{if(hold&&path.startsWith('fs_messages?')&&decodeURIComponent(path).includes('"A04042","A04043"'))await pending;}});
 assert.equal(h.context.__fsCentralReady,false);await h.run("openChatRoom('A04042')");assert.equal(h.run('chatOpenId'),'A04042');assert.equal(h.run("chatRoomHTML(getChat('A04042'),records[0])"),'allowed');assert.equal(h.run('sbReady'),false);assert.equal(h.context.__fsJobSync.canCreate(),false);
 hold=false;release();for(let n=0;n<8;n++)await h.settle();assert.equal(h.context.__fsCentralReady,true);
});
test('direct read rejects parent ownership changes even when the visible ID inventory is unchanged',async()=>{
 const {h,server}=await fixture();const request=h.context.__request;h.context.__request=async(path,opt)=>{const result=await request(path,opt);if(path.startsWith('fs_messages?'))server.records[0].data.ownerEmail='other@example.test';return result;};
 h.run('chatOpenId=null');await h.run("openChatRoom('A04042')");assert.equal(h.run('chatOpenId'),null);
});
test('failed direct second page preserves previous room textarea and journal bytes then retries',async()=>{
 const {h,server}=await fixture({ids:['A04042','A04043']});server.messages=Array.from({length:1001},(_,n)=>message('A04042','long-'+n));
 h.run("chatOpenId='A04043';var input=document.createElement('textarea');input.id='chatInput';input.value='Keep unsent';document.body.appendChild(input)");const before=h.read('chats'),journal=[...h.storage];
 const request=h.context.__request;h.context.__request=async(path,opt)=>path.startsWith('fs_messages?')&&opt.headers.Range==='1000-1999'?null:request(path,opt);
 await h.run("openChatRoom('A04042')");assert.equal(h.run('chatOpenId'),'A04043');assert.deepEqual(h.read('chats'),before);assert.equal(h.run('input.value'),'Keep unsent');assert.deepEqual([...h.storage],journal);
 h.context.__request=request;await h.run("openChatRoom('A04042')");assert.equal(h.run("getChat('A04042').messages.length"),1001);
});

test('direct permission revocation closes previously displayed target and every write gate',async()=>{
 const {h}=await fixture();h.run("chatOpenId='A04042';__scopeError=403");await h.run("openChatRoom('A04042')");assert.equal(h.run('chatOpenId'),null);assert.equal(h.context.__fsCentralReady,false);assert.equal(h.context.__fsJobSync.canCreate(),false);
});
test('a missing room reference keeps synthetic display read-only even after the full baseline is ready',async()=>{
 const {h,server}=await fixture();server.chats=[];await h.run("openChatRoom('A04042')");h.calls.length=0;
 h.run("var input=document.createElement('textarea');input.id='chatInput';input.value='Cannot create a missing room';document.body.appendChild(input)");assert.equal(await h.run('sendChatMsg()'),false);h.run("createChat('A04042')");assert.equal(h.calls.filter(c=>c.opt?.method==='POST'&&!c.path.startsWith('/__formula/client-diagnostic')).length,0);assert.equal(server.chats.length,0);
});

test('direct room refresh applies central metadata while preserving current approvals and seen state',async()=>{
 const {h,server}=await fixture();h.run("getChat('A04042').approvals={pd:{by:'Keep approval'}};getChat('A04042').seen={sales:12}");server.chats[0].data.createdAt=99;
 await h.run("openChatRoom('A04042')");assert.equal(h.run("getChat('A04042').createdAt"),99);assert.deepEqual(h.read("getChat('A04042').approvals"),{pd:{by:'Keep approval'}});assert.deepEqual(h.read("getChat('A04042').seen"),{sales:12});
});

test('a new trusted role cannot keep the old global write readiness through direct open',async()=>{
 const {h}=await fixture();h.setTrustedSession({name:'sales',role:'admin',centralUserId:'test-sales',authenticated:true});h.run("chatOpenId='A04042'");await h.run("openChatRoom('A04042')");assert.equal(h.context.__fsCentralReady,false);assert.equal(h.run('sbReady'),false);
});

test('a verified targeted room cannot be replaced by a sibling cache while the initial baseline is pending',async()=>{
 let release;const hold=new Promise(resolve=>release=resolve);const {h}=await fixture({ids:['A04042','A04043'],ready:false,intercept:async path=>{if(path.startsWith('fs_messages?')&&decodeURIComponent(path).includes('"A04042","A04043"'))await hold;}});
 await h.run("openChatRoom('A04042')");h.run("localStorage.setItem('fs_chats',JSON.stringify([{jobId:'A04042',messages:[{uid:'unverified',text:'Wrong sibling cache'}]}]));loadChats();renderChat()");
 assert.deepEqual(h.read("getChat('A04042').messages.map(m=>m.uid)"),['old-0']);release();for(let n=0;n<8;n++)await h.settle();
});

for(const changed of [false,true])test(`reopening after an exact ACK refreshes formula receipt only for its current central revision, changed=${changed}`,async()=>{
 const {h,server}=await fixture({renderStatus:true});h.run("records[0].brand='Synthetic exact acknowledged edit';saveRecordsStore()");await h.run('sbPush()');assert.deepEqual(h.pending(),{});
 h.run("chatOpenId='A04042';renderChat();window.__fsUpdateFormulaSaveStatuses()");assert.equal(h.run("document.getElementById('fxStateChat').textContent"),'บันทึกแล้ว');
 if(changed)server.records[0].data.brand='Newer synthetic central revision';
 await h.run("openChatRoom('A04042')");assert.equal(h.run("document.getElementById('fxStateChat').textContent"),changed?'Default formula status':'บันทึกแล้ว');
 if(changed){h.run('window.__fsUpdateFormulaSaveStatuses()');assert.notEqual(h.run("document.getElementById('fxStateChat').textContent"),'บันทึกแล้ว','an old saved receipt cannot attest the newer central revision');}
});
