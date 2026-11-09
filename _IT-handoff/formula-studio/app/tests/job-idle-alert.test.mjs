import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function fn(name){
 const start=html.indexOf('function '+name+'(');
 assert.ok(start>=0,'missing function '+name);
 const first=html.slice(start,html.indexOf('\n',start));
 if(first.trimEnd().endsWith('}')) return first;
 const end=html.indexOf('\n}',start);
 assert.ok(end>start,'missing function end '+name);
 return html.slice(start,end+2);
}
const DAY=86400000, now=Date.now(), old=now-8*DAY;
function env(extra={}){
 let saved=0, chatSaved=0;
 const c={Date,Number,Object,Array,String,Math,records:[],chats:[],activities:[],currentUser:'Sales A',impersonator:'',modifyRec:null,window:{},ACT_MAX:3000,
  currentRole:()=> 'sales',ownOnly:true,canCreateData:true,can(k){return k==='ownOnly'&&this.ownOnly;},nowTs:()=>now,
  actUid:()=>{},saveActivities:()=>{},saveRecordsStore:()=>{saved++;},saveChats:()=>{chatSaved++;},document:{getElementById:()=>null,querySelectorAll:()=>[]},...extra};
 // Preserve the application permission function instead of a replacement check.
 c.can=k=>k==='ownOnly'?c.ownOnly:k==='createData'&&c.canCreateData;
 vm.createContext(c);
 for(const name of ['esc','getChat','canSeeRecord','jobLastMovement','jobIsStale','jobWarningContentHTML','jobWarningHTML','noteJobMovement','noteChatMovement','refreshJobWarnings','logAct']) vm.runInContext(fn(name),c);
 vm.runInContext('const JOB_IDLE_MS=7*24*60*60*1000;',c);
 c.saved=()=>saved;c.chatSaved=()=>chatSaved;return c;
}
const rec=()=>({id:'A03430',createdBy:'Sales A',createdAt:old,customer:'Synthetic customer',rows:[]});
test('all inline scripts remain syntactically valid',()=>{for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);});
test('strictly more than seven days; exact boundary is not stale',()=>{const c=env(),r=rec();r.createdAt=now-7*DAY;assert.equal(c.jobIsStale(r,now),false);assert.equal(c.jobIsStale(r,now+1),true);});
test('latest numeric job timestamp wins without mutating legacy record',()=>{const c=env(),r=rec(),before=JSON.stringify(r);assert.equal(c.jobLastMovement(r),old);assert.equal(JSON.stringify(r),before);r.updatedAt=now;assert.equal(c.jobIsStale(r,now),false);});
test('message and current approval count as movement; presence and reading do not',()=>{const c=env(),r=rec();c.chats=[{jobId:r.id,createdAt:old,parts:[{lastAt:now}],seen:{'Sales A':now},messages:[],approvals:{}}];assert.equal(c.jobIsStale(r,now),true);c.chats[0].messages.push({ts:now});assert.equal(c.jobIsStale(r,now),false);c.chats[0].messages=[];c.chats[0].approvals.pd={ts:now};assert.equal(c.jobIsStale(r,now),false);});
test('closed and rejected jobs never warn; reopened job can warn again',()=>{const c=env(),r=rec();r.closed={ts:old};assert.equal(c.jobIsStale(r,now),false);delete r.closed;r.rejected={ts:old};assert.equal(c.jobIsStale(r,now),false);delete r.rejected;assert.equal(c.jobIsStale(r,now),true);});
test('missing, malformed and nonfinite timestamps do not invent inactivity',()=>{const c=env();for(const value of [undefined,'bad',Infinity,-5,null])assert.equal(c.jobIsStale({id:'A00001',createdAt:value},now),false);assert.equal(c.jobIsStale(null,now),false);});
test('Sales and Oversea cannot receive a warning for another owner',()=>{const c=env(),r=rec();assert.match(c.jobWarningHTML(r),/เกิน 7 วัน/);r.createdBy='Sales B';assert.equal(c.jobWarningHTML(r),'');});
test('all viewers with existing unrestricted visibility receive the warning',()=>{const c=env(),r=rec();r.createdBy='Sales B';for(const role of ['admin','pd','ra','rd','opc','mkt','purchasing']){c.ownOnly=false;c.currentRole=()=>role;assert.match(c.jobWarningHTML(r),/เกิน 7 วัน/);}});
test('no alert while signed out; IDs are escaped in HTML attributes',()=>{const c=env(),r=rec();r.id='A00001" onmouseover="evil';assert.match(c.jobWarningHTML(r),/&quot;/);assert.doesNotMatch(c.jobWarningHTML(r),/data-job-alert="A00001" onmouseover/);c.currentUser='';assert.equal(c.jobWarningHTML(r),'');});
test('actual business logs durably advance both saved record and editor copies',()=>{const c=env(),r=rec();c.records=[r];c.modifyRec={...r};c.window._lastDash={...r};c.logAct('formula','แก้สูตร','Synthetic edit',r.id);assert.equal(r.lastActivityAt,now);assert.equal(c.modifyRec.lastActivityAt,now);assert.equal(c.window._lastDash.lastActivityAt,now);assert.equal(c.saved(),1);});
test('job and status logs durably advance the parent record',()=>{for(const cat of ['job','close']){const c=env(),r=rec();c.records=[r];c.logAct(cat,'Synthetic business action','',r.id);assert.equal(r.lastActivityAt,now);assert.equal(c.saved(),1);}});
test('chat and approval logs advance chat without dirtying the confirmed parent',()=>{for(const cat of ['approve','chat']){const c=env({canCreateData:false,ownOnly:false}),r=rec(),room={jobId:r.id,createdAt:old,messages:[],approvals:{}};c.records=[r];c.chats=[room];c.logAct(cat,'Synthetic business action','',r.id);assert.equal(room.lastActivityAt,now);assert.equal(r.lastActivityAt,undefined);assert.equal(c.saved(),0);assert.equal(c.chatSaved(),1);assert.equal(c.jobIsStale(r,now),false);}});
test('only an authorized room deleter can advance the parent when chat is gone',()=>{const c=env(),r=rec();c.records=[r];c.logAct('chat','ลบห้องแชท','',r.id);assert.equal(r.lastActivityAt,now);assert.equal(c.saved(),1);const ra=env({canCreateData:false}),other=rec();ra.records=[other];ra.logAct('approve','Synthetic','',other.id);assert.equal(other.lastActivityAt,undefined);assert.equal(ra.saved(),0);});
test('read, export, login and sync logs never advance the business clock',()=>{const c=env(),r=rec();c.records=[r];for(const cat of ['read','export','auth','sync'])c.logAct(cat,'Synthetic','',r.id);assert.equal(r.lastActivityAt,undefined);assert.equal(c.saved(),0);});
test('retained old business logs are a legacy fallback; export does not count',()=>{const c=env(),r=rec();c.activities=[{job:r.id,cat:'export',ts:now},{job:'A09999',cat:'job',ts:now}];assert.equal(c.jobIsStale(r,now),true);c.activities.push({job:r.id,cat:'formula',ts:now});assert.equal(c.jobIsStale(r,now),false);});
test('movement does not overwrite a newer timestamp or a different editor job',()=>{const c=env(),r=rec();r.lastActivityAt=now+1;c.records=[r];c.modifyRec={id:'A00099'};c.noteJobMovement(r.id,now);assert.equal(r.lastActivityAt,now+1);assert.equal(c.modifyRec.lastActivityAt,undefined);assert.equal(c.saved(),0);});
test('minute refresh updates alerts and classes without rendering forms or writing storage',()=>{const c=env(),r=rec();c.records=[r];const warning={dataset:{jobAlert:r.id},innerHTML:''};const changes=[];const row={dataset:{idleJob:r.id},classList:{toggle:(name,on)=>changes.push([name,on])}};c.document.querySelectorAll=s=>s==='[data-job-alert]'?[warning]:[row];c.refreshJobWarnings();assert.match(warning.innerHTML,/เกิน 7 วัน/);assert.deepEqual(changes,[['job-stale',true]]);assert.equal(c.saved(),0);r.lastActivityAt=now;c.refreshJobWarnings();assert.equal(warning.innerHTML,'');assert.deepEqual(changes.at(-1),['job-stale',false]);});
test('refresh removes a warning when visibility is lost',()=>{const c=env(),r=rec();c.records=[r];const warning={dataset:{jobAlert:r.id},innerHTML:'old warning'};c.document.querySelectorAll=s=>s==='[data-job-alert]'?[warning]:[];r.createdBy='Sales B';c.refreshJobWarnings();assert.equal(warning.innerHTML,'');});

test('sidebar tooltip changes across the boundary without rebuilding its button',()=>{const c=env(),r=rec();c.records=[r];const el={dataset:{idleJob:r.id,idleTitle:'A03430 · Sales A'},classList:{toggle:()=>{}},title:''};c.document.querySelectorAll=s=>s==='[data-idle-job]'?[el]:[];c.refreshJobWarnings();assert.match(el.title,/เกิน 7 วัน/);r.lastActivityAt=now;c.refreshJobWarnings();assert.equal(el.title,'A03430 · Sales A');});
test('invalid optional movement time is replaced by a real event',()=>{const c=env(),r=rec();r.lastActivityAt=Infinity;c.records=[r];c.noteJobMovement(r.id,now);assert.equal(r.lastActivityAt,now);});
test('bulk tag changes restart only jobs whose tags actually change',()=>{const c=env(),r=rec(),unchanged={...rec(),id:'A03431',tags:['tag-1']};r.tags=[];c.records=[r,unchanged];Object.assign(c,{requirePerm:p=>c.can(p),findVisTag:()=>({name:'Synthetic tag'}),selectedJobIds:()=>[r.id,unchanged.id],updateChatBadge:()=>{},renderRecordsList:()=>{},renderBulkTagBody:()=>{},document:{getElementById:()=>({classList:{contains:()=>false}})}});vm.runInContext(fn('bulkTag'),c);c.bulkTag('tag-1',true);assert.equal(r.lastActivityAt,now);assert.equal(unchanged.lastActivityAt,undefined);assert.equal(c.saved(),1);c.bulkTag('tag-1',true);assert.equal(c.saved(),1);});
