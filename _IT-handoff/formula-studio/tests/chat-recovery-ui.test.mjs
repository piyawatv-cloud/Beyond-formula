import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const path=new URL('../runtime/assets/fs-chat-recovery.js',import.meta.url);
const source=existsSync(path)?readFileSync(path,'utf8'):'';
const admin={authenticated:true,name:'Synthetic Admin',role:'admin',centralUserId:'synthetic-admin',expiresAt:new Date(Date.now()+60000).toISOString()};
function harness(storage,{session=admin,ids=['A03430'],messages=[],unavailable=false,journal={items:[],raws:[],receipts:[]},path='/__formula/chat-recovery'}={}){
 const nodes=new Map(),calls=[],writes=[],downloads=[];
 function node(tag='div'){return {tagName:tag.toUpperCase(),children:[],style:{},setAttribute(){},appendChild(c){this.children.push(c);if(c.id)nodes.set(c.id,c);return c;},click(){if(this.download)downloads.push(this.href);},remove(){}};}
 const context={console,Promise,Date,JSON,Map,Set,location:{pathname:path},document:{body:node(),createElement:node,getElementById:id=>nodes.get(id)},addEventListener(){},
 localStorage:{get length(){return storage.size},key:i=>[...storage.keys()][i],getItem:k=>storage.get(k)||null,setItem(...args){writes.push(args)},removeItem(...args){writes.push(args)}},
 fetch:async(path,opt)=>{calls.push({path,opt});return {ok:!unavailable,status:unavailable?503:200,json:async()=>path==='/sb/session'?session:path==='/__formula/visible-chat-snapshot'?{chats:[],messages}:{ids}}},
 Blob:class{constructor(parts){this.parts=parts}},URL:{createObjectURL:blob=>blob.parts.join(''),revokeObjectURL(){}},setTimeout:fn=>fn()};
 context.__fsChatJournal={snapshot:async()=>typeof journal==='function'?journal():journal};context.window=context;vm.runInNewContext(source,context);
 return {context,nodes,calls,writes,downloads};
}
test('dashboard recovery notice keeps the separate route and hides its inline download shortcut',async()=>{
 const h=harness(fixture(),{path:'/'}),panel=()=>h.nodes.get('fsChatRecoveryStatus');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(panel().children.some(child=>child.tagName==='BUTTON'),false);
 const link=panel().children.find(child=>child.tagName==='A');
 assert.ok(link);assert.equal(link.href,'/__formula/chat-recovery');
 assert.match(panel().children[0].textContent,/มีสำเนาแชตในเครื่อง/);
 assert.deepEqual(h.writes,[]);assert.equal(h.downloads.length,0);
});
const identity=JSON.stringify(['sales','test-sales','sales']);
function fixture(){return new Map([
 ['fs_chat_journal_v2:first',JSON.stringify({kind:'pending',identity,jobId:'A03430',message:{uid:'first',text:'pending new journal'}})],
 ['fs_chat_pending_v1:'+encodeURIComponent(identity),JSON.stringify([{jobId:'A03430',message:{uid:'second',text:'pending old array'}}])],
 ['fs_chat_unclassified_recovery_v1',JSON.stringify({raw:JSON.stringify([{jobId:'A03431',messages:[{uid:'unknown',text:'uncertain'}]}])})],
 ['fs_chats',JSON.stringify([{jobId:'A03432',messages:[{uid:'sealed-only',text:'old sealed pending'}]}])],
 ['fs_users','SECRET_MUST_NOT_EXPORT'],['session_token','SECRET_MUST_NOT_EXPORT']
]);}
test('standalone recovery lists and exports all pending formats with no job-sync or sealed functions available',async()=>{
 const storage=fixture(),h=harness(storage);assert.ok(h.context.__fsChatRecovery,'recovery is independent of sealed app and job-sync');
 const result=await h.context.__fsChatRecovery.snapshot();
 assert.equal(result.entries.length,4);
 assert.match(JSON.stringify(result),/pending new journal/);assert.match(JSON.stringify(result),/pending old array/);assert.match(JSON.stringify(result),/uncertain/);assert.match(JSON.stringify(result),/old sealed pending/);
 assert.ok(!JSON.stringify(result).includes('SECRET_MUST_NOT_EXPORT'));
 assert.equal(h.nodes.get('fsChatRecoveryStatus').hidden,false);
 await h.context.__fsChatRecovery.download();assert.equal(h.downloads.length,1);
 assert.deepEqual(h.writes,[],'recovery never deletes or rewrites browser evidence');
 assert.ok(h.calls.every(call=>call.opt.method==='GET'),'no server writes');
});
test('recovery exports only current identity visible pending entries for a non-admin',async()=>{
 const h=harness(fixture(),{session:{...admin,name:'sales',role:'sales',centralUserId:'test-sales'}});
 const result=await h.context.__fsChatRecovery.snapshot();
 assert.equal(result.entries.length,2);assert.ok(!JSON.stringify(result).includes('uncertain'));
 const denied=harness(fixture(),{session:{...admin,name:'sales',role:'sales',centralUserId:'test-sales'},ids:[]});
 assert.equal((await denied.context.__fsChatRecovery.snapshot()).entries.length,0);
});
test('offline or expired recovery refuses payload export and preserves every byte',async()=>{
 const storage=fixture(),before=[...storage];
 for(const options of [{unavailable:true},{session:{...admin,expiresAt:new Date(0).toISOString()}}]){
  const h=harness(storage,options);assert.ok(h.context.__fsChatRecovery);
  await assert.rejects(h.context.__fsChatRecovery.snapshot());assert.deepEqual([...storage],before);assert.deepEqual(h.writes,[]);
 }
});

test('server-confirmed v1 entries are not exported as pending and mutable legacy evidence stays unchanged',async()=>{
 const message={uid:'confirmed-v1',text:'already on server',ts:1},other={uid:'still-pending',text:'keep',ts:2};
 const key='fs_chat_pending_v1:'+encodeURIComponent(identity),raw=JSON.stringify([{jobId:'A03430',message},{jobId:'A03430',message:other}]);
 const storage=new Map([[key,raw]]),h=harness(storage,{messages:[{job_id:'A03430',uid:message.uid,data:message}]});
 const result=await h.context.__fsChatRecovery.snapshot();
 assert.equal(result.entries.length,1);assert.equal(result.entries[0].value.message.uid,other.uid);
 assert.equal(result.confirmedCount,1);assert.equal(storage.get(key),raw);assert.deepEqual(h.writes,[]);
});
test('recovery acknowledgement requires matching job uid and data; uncertain variants remain exportable',async()=>{
 const storage=fixture(),h=harness(storage,{messages:[{job_id:'A03431',uid:'first',data:{uid:'first',text:'pending new journal'}},{job_id:'A03430',uid:'second',data:{uid:'second',text:'changed server data'}}]});
 const result=await h.context.__fsChatRecovery.snapshot();
 assert.equal(result.entries.length,4);assert.equal(result.confirmedCount,0);
});

test('current recovery merges IDB items and Admin exact raw archives while restricting pending to visible owner',async()=>{
 const raw=' {"kind":"pending","identity":'+JSON.stringify(identity)+',"jobId":"A03430","message":{"uid":"fallback","text":"ไทย🧪"}}\n';
 const journal={items:[{key:'fs_chat_journal_v2:fallback',raw,value:JSON.parse(raw),backend:'indexeddb'}],raws:[{sourceKey:'fs_chats',raw:'{bad original\n'}],receipts:[]};
 const h=harness(new Map(),{journal}),result=await h.context.__fsChatRecovery.snapshot();assert.equal(result.version,2);assert.equal(result.entries.length,2);assert.ok(result.entries.some(e=>e.raw===raw));assert.ok(result.entries.some(e=>e.sourceKey==='fs_chats'&&e.raw==='{bad original\n'));
 const mine=harness(new Map(),{journal,session:{...admin,name:'sales',role:'sales',centralUserId:'test-sales'}});assert.equal((await mine.context.__fsChatRecovery.snapshot()).entries.length,1);
 const denied=harness(new Map(),{journal,ids:[],session:{...admin,name:'sales',role:'sales',centralUserId:'test-sales'}});assert.equal((await denied.context.__fsChatRecovery.snapshot()).entries.length,0);
});
test('local async reads finish before fresh scope; failed fallback is visible and never exported',async()=>{
 let done;const waiting=new Promise(resolve=>done=resolve);const h=harness(new Map(),{journal:()=>waiting});
 const pending=h.context.__fsChatRecovery.snapshot();for(let i=0;i<8;i++)await Promise.resolve();assert.equal(h.calls.some(c=>c.path==='/__formula/visible-record-ids'),false);done({items:[],raws:[],receipts:[]});await pending;
 const failed=harness(new Map(),{journal:()=>{throw Error('chat-journal-open')}});await assert.rejects(failed.context.__fsChatRecovery.snapshot());await failed.context.__fsChatRecovery.refresh();assert.equal(failed.nodes.get('fsChatRecoveryStatus').hidden,false);
});
test('non-admin v1 export cannot expose nonvisible siblings through additive raw metadata',async()=>{
 const key='fs_chat_pending_v1:'+encodeURIComponent(identity),storage=new Map([[key,JSON.stringify([{jobId:'A03430',message:{uid:'mine',text:'visible'}},{jobId:'A99999',message:{uid:'foreign',text:'HIDDEN_PARENT_SECRET'}}])]]);
 const h=harness(storage,{session:{...admin,name:'sales',role:'sales',centralUserId:'test-sales'}}),result=await h.context.__fsChatRecovery.snapshot();assert.equal(result.entries.length,1);assert.ok(!JSON.stringify(result).includes('HIDDEN_PARENT_SECRET'));
});
test('a changed session or revoked parent during delayed local read cannot export the captured pending item',async()=>{
 for(const change of ['session','scope']){
  let done;const delayed=new Promise(resolve=>done=resolve),ids=['A03430'],sales={...admin,name:'sales',role:'sales',centralUserId:'test-sales'};
  const h=harness(new Map(),{journal:()=>delayed,ids,session:sales}),original=h.context.fetch;let changed=false;
  h.context.fetch=async(path,opt)=>path==='/sb/session'&&changed&&change==='session'?{ok:true,json:async()=>({...sales,centralUserId:'changed'})}:original(path,opt);
  const pending=h.context.__fsChatRecovery.snapshot();for(let i=0;i<8;i++)await Promise.resolve();changed=true;if(change==='scope')ids.length=0;
  done({items:[{key:'fs_chat_journal_v2:delayed',raw:'{}',value:{kind:'pending',identity,jobId:'A03430',message:{uid:'delayed'}}}],raws:[],receipts:[]});
  if(change==='session')await assert.rejects(pending,/session changed/);else assert.equal((await pending).entries.length,0);assert.equal(h.downloads.length,0);
 }
});
