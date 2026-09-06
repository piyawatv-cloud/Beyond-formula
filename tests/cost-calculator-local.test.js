'use strict';
// Local-first cost store (ADR 0002). Loads the real CORE and LOCAL blocks out of
// index.html so these assertions cover shipped code, not a copy.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const grab=name=>html.match(new RegExp('// COST_CALCULATOR_'+name+'_START([\\s\\S]*?)// COST_CALCULATOR_'+name+'_END'))[1];
const CORE=grab('CORE'),LOCAL=grab('LOCAL');

function fixture(role='rd',name='Synthetic RD'){
 const backing={};
 const chats=[];
 const c={console,chats,CHAT_SYS_MAX:5000,chatClamp:(t,m)=>String(t).slice(0,m),
  localStorage:{getItem:k=>Object.prototype.hasOwnProperty.call(backing,k)?backing[k]:null,setItem:(k,v)=>{backing[k]=String(v);},removeItem:k=>{delete backing[k];}},
  getChat:id=>chats.find(x=>x.jobId===id)||null,
  createChat:id=>{const room={jobId:id,createdAt:Date.now(),createdBy:name,messages:[],parts:[],approvals:{pd:null,ra:null,rd:null}};chats.unshift(room);return room;},
  saveChats(){backing.fs_chats=JSON.stringify(chats);},
  currentUser:name,currentRole:()=>role,userList:[{name,role}]};
 vm.createContext(c);vm.runInContext(CORE,c);vm.runInContext(LOCAL,c);
 c.backing=backing;c.chats=chats;c.run=s=>vm.runInContext(s,c);
 return c;
}
const offer={id:'O1',version:1,materialId:'M1',name:'สารสกัดทดสอบ',group:'กลุ่มทดสอบ',spec:'Spec A',vendor:'SYNTHETIC VENDOR',vendorId:'V1',tierId:'T1',status:'confirmed',specApproved:true,currency:'THB',scope:{type:'central'},price:100,priceUnit:'kg',priceBasisQuantity:1,moq:2,moqUnit:'kg',increment:1,incrementUnit:'kg',leadTimeDays:10,validUntil:'2999-01-01',evidenceRef:'E1'};

test('store never writes before its loader has run',()=>{const c=fixture();assert.equal(c.run('costStore'),null);assert.equal(c.saveCostStore(),false);assert.equal(c.backing.fs_cost,undefined);c.loadCostStore();assert.equal(c.saveCostStore(),true);});
test('corrupt or foreign stored value falls back without throwing or erasing other keys',()=>{for(const raw of ['{','null','[]','"text"','{"scenarios":{}}']){const c=fixture();c.backing.fs_cost=raw;c.backing.fs_records='[{"id":"A00001"}]';const store=c.loadCostStore();assert.ok(Array.isArray(store.scenarios));assert.ok(Array.isArray(store.outbox));assert.equal(c.backing.fs_records,'[{"id":"A00001"}]');}});
test('open creates a first draft and persists it under the additive key only',async()=>{const c=fixture();const body=await c.costLocalRequest('open',{projectId:'A00001'});assert.equal(body.contract,'cost-v1');assert.equal(body.revision,1);assert.equal(body.view.projectId,'A00001');assert.ok(Array.isArray(body.view.pending));assert.deepEqual(Object.keys(c.backing),['fs_cost']);});
test('save appends an immutable revision and leaves the previous one untouched',async()=>{const c=fixture();await c.costLocalRequest('open',{projectId:'A00001'});await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,patch:{sellingUnits:1000,unitsPerPack:1,fillAmount:1,lines:[]}});const store=c.loadCostStore();assert.equal(store.scenarios.length,2);assert.equal(store.scenarios[0].scenario.sellingUnits,null);assert.equal(store.scenarios[1].scenario.sellingUnits,1000);});
test('editing a superseded revision is refused instead of forking history',async()=>{const c=fixture();await c.costLocalRequest('open',{projectId:'A00001'});await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,patch:{lines:[]}});await assert.rejects(c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,patch:{lines:[]}}),/revision ใหม่กว่า/);assert.equal(c.loadCostStore().scenarios.length,2);});
test('Sales sees adjusted totals only and never a vendor, price or RM line',async()=>{const c=fixture('rd');c.loadCostStore().catalog.push(offer);await c.costLocalRequest('open',{projectId:'A00001'});await c.costLocalRequest('selectRM',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,offerRef:'O1'});const s=fixture('sales','Synthetic Sales');s.backing.fs_cost=c.backing.fs_cost;const body=await s.costLocalRequest('open',{projectId:'A00001'});const text=JSON.stringify(body);assert.ok(!text.includes('SYNTHETIC VENDOR'));assert.ok(!text.includes('สารสกัดทดสอบ'));assert.equal(body.lines.length,0);assert.equal(body.catalog.length,0);assert.equal(body.capabilities.editRM,false);});
test('deep link to an older revision is refused for Sales and allowed for RD',async()=>{const c=fixture();await c.costLocalRequest('open',{projectId:'A00001'});await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,patch:{lines:[]}});const old=await c.costLocalRequest('open',{projectId:'A00001',scenarioId:'S1',expectedRevision:1});assert.equal(old.revision,1);assert.equal(old.capabilities.viewRevision,true);const s=fixture('sales','Synthetic Sales');s.backing.fs_cost=c.backing.fs_cost;assert.equal(s.costCapabilities().viewRevision,false);await assert.rejects(s.costLocalRequest('open',{projectId:'A00001',scenarioId:'S1',expectedRevision:1}),/RD และ Admin/);});
test('roles with no cost capability are refused entirely',async()=>{for(const role of ['pd','ra','mkt']){const c=fixture(role,'Someone');await assert.rejects(c.costLocalRequest('open',{projectId:'A00001'}),/ยังไม่ได้รับสิทธิ์/);}});
test('purchasing holds both RM and PK capabilities but cannot edit the formula',async()=>{const c=fixture('purchasing','Synthetic Buyer');assert.deepEqual(Array.from(c.costBusinessRoles('Synthetic Buyer')),['Procurement RM','PU-PK']);const caps=c.costCapabilities();assert.equal(caps.open,true);assert.equal(caps.editRM,false);assert.equal(caps.adoptPK,true);});
test('an explicit capability assignment overrides the role default',()=>{const c=fixture('sales','Synthetic Sales');c.loadCostStore().caps['Synthetic Sales']=['Finance','CEO','NOT_A_ROLE'];assert.deepEqual(Array.from(c.costBusinessRoles('Synthetic Sales')),['Finance','CEO']);assert.equal(c.costPrimaryRole(c.costBusinessRoles('Synthetic Sales')),'CEO');});
test('summary posts once into the project chat and a retry does not post a second',async()=>{const c=fixture();await c.costLocalRequest('open',{projectId:'A00001'});
 const key='A00001:S1:1:summary';
 const first=await c.costLocalRequest('sendSummary',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,idempotencyKey:key});
 assert.equal(first.sendState,'sent');
 const room=c.chats.find(x=>x.jobId==='A00001');
 assert.equal(room.messages.filter(m=>m.costKey===key).length,1);
 const again=await c.costLocalRequest('sendSummary',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,idempotencyKey:key});
 assert.equal(again.sendState,'sent');
 assert.equal(room.messages.filter(m=>m.costKey===key).length,1,'retry must not post twice');
 const outbox=c.loadCostStore().outbox;
 assert.equal(outbox.length,1);assert.equal(outbox[0].status,'sent');assert.ok(outbox[0].receiptId);});
test('a message already in the chat resolves a retry even if the outbox row is lost',async()=>{const c=fixture();await c.costLocalRequest('open',{projectId:'A00001'});
 const key='A00001:S1:1:summary';
 await c.costLocalRequest('sendSummary',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,idempotencyKey:key});
 c.loadCostStore().outbox.length=0; // simulate the store write failing after the chat write
 const retry=await c.costLocalRequest('sendSummary',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,idempotencyKey:key});
 assert.equal(retry.sendState,'sent');
 assert.equal(c.chats[0].messages.filter(m=>m.costKey===key).length,1,'must not double post');});
test('chat summary carries adjusted totals only, never a vendor, base cost or material name',async()=>{const c=fixture();
 c.loadCostStore().catalog.push(offer);
 await c.costLocalRequest('open',{projectId:'A00001'});
 await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,patch:{sellingUnits:1000,unitsPerPack:1,fillAmount:1,fillUnit:'g',pkSpecVersion:'PACK1',lines:[]}});
 await c.costLocalRequest('selectRM',{projectId:'A00001',scenarioId:'S1',expectedRevision:2,offerRef:'O1'});
 await c.costLocalRequest('sendSummary',{projectId:'A00001',scenarioId:'S1',expectedRevision:3,idempotencyKey:'A00001:S1:3:summary'});
 const text=JSON.stringify(c.chats[0].messages);
 for(const secret of ['SYNTHETIC VENDOR','สารสกัดทดสอบ','O1','M1','T1','100'])assert.ok(!text.includes(secret),secret);
 assert.match(c.chats[0].messages[0].text,/ยอดหลังบวกเท่านั้น/);
 const stored=JSON.parse(c.backing.fs_cost).outbox[0].body;
 assert.ok(!Object.hasOwn(stored.rm,'baseTotal'),'outbox body must be the Sales projection');
 assert.ok(!Object.hasOwn(stored,'lines'));});
test('a sender who can see base cost still posts only the Sales projection',async()=>{const c=fixture('admin','Synthetic Admin');
 c.loadCostStore().catalog.push(offer);
 await c.costLocalRequest('open',{projectId:'A00001'});
 const own=await c.costLocalRequest('open',{projectId:'A00001'});
 assert.ok(Object.hasOwn(own.view.rm,'baseTotal'),'admin does see base cost in their own view');
 await c.costLocalRequest('sendSummary',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,idempotencyKey:'A00001:S1:1:summary'});
 const body=JSON.parse(c.backing.fs_cost).outbox[0].body;
 assert.ok(!Object.hasOwn(body.rm,'baseTotal'),'the posted body must not inherit the sender projection');});
test('a failed chat write leaves the summary unsent rather than falsely delivered',async()=>{const c=fixture();await c.costLocalRequest('open',{projectId:'A00001'});
 c.saveChats=()=>{throw Error('DISK_FULL');};
 await assert.rejects(c.costLocalRequest('sendSummary',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,idempotencyKey:'A00001:S1:1:summary'}),/DISK_FULL/);
 const outbox=c.loadCostStore().outbox;
 assert.equal(outbox[0].status,'pending');assert.equal(outbox[0].receiptId,null);});
test('adoptPK refuses rather than inventing a PK result, and PK stays absent',async()=>{const c=fixture();await c.costLocalRequest('open',{projectId:'A00001'});await assert.rejects(c.costLocalRequest('adoptPK',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,snapshotRef:'PK1'}),/ยังไม่มีผล PK/);const body=await c.costLocalRequest('open',{projectId:'A00001'});assert.equal(body.pkCandidate,null);assert.equal(body.view.pk.ready,false);});
test('sourcing request is recorded without adding a price and without a new revision',async()=>{const c=fixture();await c.costLocalRequest('open',{projectId:'A00001'});await c.costLocalRequest('requestMaterial',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,brief:'ต้องการสารสกัด spec ใหม่'});const store=c.loadCostStore();assert.equal(store.requests.length,1);assert.equal(store.requests[0].status,'open');assert.equal(store.scenarios.length,1);});
test('Procurement RM gets RM detail but never PK or Operation base cost',async()=>{const c=fixture('rd');c.loadCostStore().catalog.push(offer);await c.costLocalRequest('open',{projectId:'A00001'});await c.costLocalRequest('selectRM',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,offerRef:'O1'});const b=fixture('purchasing','Synthetic Buyer');b.backing.fs_cost=c.backing.fs_cost;const body=await b.costLocalRequest('open',{projectId:'A00001'});assert.ok(Array.isArray(body.view.pending),'projection must stay a full cost-v1 view');assert.ok(Object.hasOwn(body.view.rm,'baseTotal'));assert.ok(!Object.hasOwn(body.view.pk,'baseTotal'));assert.ok(!Object.hasOwn(body.view.operation,'baseTotal'));});
test('every mapped business role returns a renderable cost-v1 view',async()=>{const c=fixture('rd');await c.costLocalRequest('open',{projectId:'A00001'});for(const [role,name] of [['rd','Synthetic RD'],['purchasing','Synthetic Buyer'],['sales','Synthetic Sales'],['opc','Synthetic OPC'],['admin','Synthetic Admin']]){const u=fixture(role,name);u.backing.fs_cost=c.backing.fs_cost;const body=await u.costLocalRequest('open',{projectId:'A00001'});assert.equal(body.view.projectId,'A00001',role);assert.equal(body.view.revision,body.revision,role);assert.ok(Array.isArray(body.view.pending),role);}});

// Wiring: the UI block on its own has no fallback, so prove the shipped app
// actually routes costRequest into the local store rather than the network.
test('costRequest routes to the local store while no API origin is configured',async()=>{
 const UI=grab('UI'),backing={};
 const panel={innerHTML:'',replaceChildren(){this.innerHTML='';},classList:{add(){},remove(){}}},elements={costView:panel};
 const c={console,currentUser:'Synthetic RD',currentRole:()=>'rd',userList:[{name:'Synthetic RD',role:'rd'}],
  authSession:{user:{id:'T'},access_token:'T'},authMembership:{role:'rd'},impersonator:null,
  records:[{id:'A00001'}],can:()=>true,canSeeRecord:r=>!!r,requirePerm:()=>true,esc:x=>String(x==null?'':x),
  localStorage:{getItem:k=>Object.prototype.hasOwnProperty.call(backing,k)?backing[k]:null,setItem:(k,v)=>{backing[k]=String(v);}},
  document:{getElementById:id=>elements[id],querySelectorAll:()=>[],querySelector:()=>({appendChild(){}}),createElement:()=>({classList:{add(){},remove(){}}})},
  window:{addEventListener(){},location:{hash:''}},setTimeout,clearTimeout,URL,AbortController};
 c.window.window=c.window;vm.createContext(c);vm.runInContext(CORE,c);vm.runInContext(UI,c);vm.runInContext(LOCAL,c);c.run=s=>vm.runInContext(s,c);
 assert.equal(c.run('COST_API_ORIGIN'),'');
 const body=await c.costRequest('open',{projectId:'A00001'});
 assert.equal(body.contract,'cost-v1');
 assert.equal(body.projectId,'A00001');
 assert.ok(backing.fs_cost,'the local store must have persisted the draft');
 assert.deepEqual(Object.keys(backing),['fs_cost'],'no legacy store may be written');
});

const catalogRow=extra=>({id:'O9',materialId:'M9',tierId:'T1',vendorId:'V1',name:'สารทดสอบ',status:'confirmed',currency:'THB',price:'100',priceUnit:'kg',moq:'2',moqUnit:'kg',increment:'1',incrementUnit:'kg',leadTimeDays:'10',validUntil:'2999-01-01',evidenceRef:'E9',specApproved:'true',...extra});

test('catalog import rejects rows missing a commercial field instead of defaulting',()=>{const c=fixture();
 // ตัวตนและราคาบังคับ ส่วน increment/leadTimeDays/validUntil/specApproved ขาดได้
 // แล้วไปตกที่ "นำเข้าได้แต่ยังใช้ไม่ได้" ซึ่งมีเทสต์แยกครอบไว้
 for(const key of ['price','priceUnit','moq','moqUnit','evidenceRef','status','currency','id','materialId','tierId','vendorId']){
  const row=catalogRow();delete row[key];
  const parsed=c.costParseCatalogRows([row]);
  assert.equal(parsed.offers.length,0,key);
  assert.equal(parsed.rejected.length,1,key);
  assert.match(parsed.rejected[0].reason,new RegExp(key));
  assert.equal(parsed.rejected[0].row,2);
 }});
test('catalog import rejects unusable units, dates and non-positive increments',()=>{const c=fixture();
 for(const bad of [{priceUnit:'ชิ้น'},{moqUnit:'litre'},{incrementUnit:'box'},{validUntil:'01/01/2030'},{validUntil:'2030-02-30'},{validUntil:'2030-13-01'},{increment:'0'},{price:'ราคาโทรถาม'},{leadTimeDays:'-1'}]){
  const parsed=c.costParseCatalogRows([catalogRow(bad)]);
  assert.equal(parsed.offers.length,0,JSON.stringify(bad));
  assert.match(parsed.rejected[0].reason,/ค่าไม่ถูกต้อง|ขาดข้อมูล/);
 }});
test('imported offer produces a real cost and re-import updates rather than duplicates',async()=>{const c=fixture();
 const parsed=c.costParseCatalogRows([catalogRow()]);
 assert.equal(parsed.offers.length,1);assert.equal(parsed.rejected.length,0);
 c.costApplyCatalog(parsed);
 const again=c.costApplyCatalog(c.costParseCatalogRows([catalogRow({price:'150'})]));
 assert.equal(again.total,1,'same offer id must update in place');
 await c.costLocalRequest('open',{projectId:'A00001'});
 await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,patch:{sellingUnits:1000,unitsPerPack:1,fillAmount:1,fillUnit:'g',pkSpecVersion:'PACK1',lines:[]}});
 await c.costLocalRequest('selectRM',{projectId:'A00001',scenarioId:'S1',expectedRevision:2,offerRef:'O9'});
 const body=await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:3,patch:{sellingUnits:1000,unitsPerPack:1,fillAmount:1,fillUnit:'g',pkSpecVersion:'PACK1',lines:[{id:c.loadCostStore().scenarios[2].scenario.rmLines[0].id,alias:'ชื่อแสดง',amount:1,lossPercent:0}]}});
 assert.equal(body.view.rm.baseTotal,150,'1g x 1000 units at 150 THB/kg');
 assert.equal(body.view.rm.ready,true);});
test('PK entry is refused until the scenario carries a spec version and pack figures',async()=>{const c=fixture();
 await c.costLocalRequest('open',{projectId:'A00001'});
 assert.throws(()=>recordPk(c,{adjustedTotal:300,validUntil:'2999-01-01',evidenceRef:'REQ1'}),/spec บรรจุภัณฑ์/);
 await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,patch:{sellingUnits:1000,unitsPerPack:1,fillAmount:1,fillUnit:'g',pkSpecVersion:'PACK1',lines:[]}});
 for(const bad of ['2030-13-40','2030-02-30','01/01/2030','2030-1-1'])assert.throws(()=>recordPk(c,{adjustedTotal:300,validUntil:bad,evidenceRef:'REQ1'}),/YYYY-MM-DD/,bad);
 assert.throws(()=>recordPk(c,{adjustedTotal:300,validUntil:'2999-01-01',evidenceRef:'  '}),/หลักฐาน/);
 assert.throws(()=>recordPk(c,{validUntil:'2999-01-01',evidenceRef:'REQ1'}),/อย่างน้อยหนึ่งช่อง/);});
test('recorded PK binds the actor and time and can then be adopted',async()=>{const c=fixture();
 await c.costLocalRequest('open',{projectId:'A00001'});
 await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,patch:{sellingUnits:1000,unitsPerPack:1,fillAmount:1,fillUnit:'g',pkSpecVersion:'PACK1',lines:[]}});
 const snap=recordPk(c,{adjustedTotal:300,baseTotal:250,validUntil:'2999-01-01',evidenceRef:'REQ1'});
 assert.equal(snap.confirmedBy,'Synthetic PU-PK','หลักฐานต้องบันทึกผู้บันทึกจริง ซึ่งต้องเป็น PU-PK');assert.ok(snap.confirmedAt);assert.equal(snap.version,1);assert.equal(snap.specVersion,'PACK1');
 const body=await c.costLocalRequest('adoptPK',{projectId:'A00001',scenarioId:'S1',expectedRevision:2,snapshotRef:snap.id+':1'});
 assert.equal(body.view.pk.adjustedTotal,300);
 assert.equal(body.pkCandidate,null,'adopted candidate must stop being offered');});
test('a renegotiated PK becomes a new version and never rewrites the adopted one',async()=>{const c=fixture();
 await c.costLocalRequest('open',{projectId:'A00001'});
 await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,patch:{sellingUnits:1000,unitsPerPack:1,fillAmount:1,fillUnit:'g',pkSpecVersion:'PACK1',lines:[]}});
 recordPk(c,{adjustedTotal:300,validUntil:'2999-01-01',evidenceRef:'REQ1'});
 await c.costLocalRequest('adoptPK',{projectId:'A00001',scenarioId:'S1',expectedRevision:2});
 const second=recordPk(c,{adjustedTotal:280,validUntil:'2999-01-01',evidenceRef:'REQ2'});
 assert.equal(second.version,2);
 assert.equal(c.loadCostStore().pk[0].adjustedTotal,300,'the earlier snapshot stays untouched');
 const old=await c.costLocalRequest('open',{projectId:'A00001',scenarioId:'S1',expectedRevision:3});
 assert.equal(old.view.pk.adjustedTotal,300,'an already adopted revision keeps its own numbers');});
test('changing pack size after adoption blocks reuse of the old PK snapshot',async()=>{const c=fixture();
 await c.costLocalRequest('open',{projectId:'A00001'});
 await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,patch:{sellingUnits:1000,unitsPerPack:1,fillAmount:1,fillUnit:'g',pkSpecVersion:'PACK1',lines:[]}});
 recordPk(c,{adjustedTotal:300,validUntil:'2999-01-01',evidenceRef:'REQ1'});
 await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:2,patch:{sellingUnits:2000,unitsPerPack:1,fillAmount:1,fillUnit:'g',pkSpecVersion:'PACK1',lines:[]}});
 await assert.rejects(c.costLocalRequest('adoptPK',{projectId:'A00001',scenarioId:'S1',expectedRevision:3}),/PK_CONTEXT_OR_VALIDITY_MISMATCH/);});
test('a failed chat write is rolled back so a later retry still delivers exactly one message',async()=>{const c=fixture();await c.costLocalRequest('open',{projectId:'A00001'});
 const key='A00001:S1:1:summary';
 const real=c.saveChats;
 c.saveChats=()=>{throw Error('DISK_FULL');};
 await assert.rejects(c.costLocalRequest('sendSummary',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,idempotencyKey:key}),/DISK_FULL/);
 assert.equal(c.chats[0].messages.filter(m=>m.costKey===key).length,0,'the unsaved message must not linger in memory');
 c.saveChats=real;
 const retry=await c.costLocalRequest('sendSummary',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,idempotencyKey:key});
 assert.equal(retry.sendState,'sent');
 assert.equal(c.chats[0].messages.filter(m=>m.costKey===key).length,1);
 assert.ok(JSON.parse(c.backing.fs_chats)[0].messages.some(m=>m.costKey===key),'and it must be persisted');});
test('validUntil survives Excel handing it over as a date serial or a Date object',()=>{const c=fixture();
 for(const value of [47484,'47484',new Date(Date.UTC(2030,0,1))]){
  const parsed=c.costParseCatalogRows([catalogRow({validUntil:value})]);
  assert.equal(parsed.rejected.length,0,String(value));
  assert.equal(parsed.offers[0].validUntil,'2030-01-01',String(value));
 }
 // A bare number outside the plausible date range must stay a rejection rather
 // than silently becoming a validity period.
 for(const value of [5,999,99999])assert.equal(c.costParseCatalogRows([catalogRow({validUntil:value})]).rejected.length,1,String(value));});

// ── กฎการบวกราคา ────────────────────────────────────────────────────────────
const priceOffer=(id,perGram)=>({...offer,id,materialId:'M-'+id,price:perGram,priceUnit:'g',priceBasisQuantity:1,moq:1,moqUnit:'kg',increment:1,incrementUnit:'kg'});
async function readyScenario(c){
 c.loadCostStore().catalog.push(priceOffer('O1',8.5));
 await c.costLocalRequest('open',{projectId:'A00001'});
 await c.costLocalRequest('selectRM',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,offerRef:'O1'});
 const lineId=c.loadCostStore().scenarios[1].scenario.rmLines[0].id;
 await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:2,
   patch:{sellingUnits:250000,unitsPerPack:1,fillAmount:0.25,fillUnit:'g',pkSpecVersion:null,
     lines:[{id:lineId,alias:'สารทดสอบ',amount:0.25,lossPercent:0}]}});
 return 3;
}
// ผล PK บันทึกได้เฉพาะ PU-PK (เจ้าของระบบยืนยัน 2026-09-06)
function recordPk(c,input){
  const pupk=fixture('purchasing','Synthetic PU-PK');
  pupk.backing.fs_cost=c.backing.fs_cost;
  const out=pupk.costRecordPk('A00001','S1',input);
  c.backing.fs_cost=pupk.backing.fs_cost;c.run('costStore=null');
  return out;
}
const RULE={allowancePercent:10,factor:2.2,decimals:6,owner:'เจ้าของอัตรา',validUntil:'2999-01-01',
  pkMode:'notApplicable',formatId:'CAP-GEL-0'};
// ตารางอัตรากลางแก้ได้เฉพาะผู้ดูแลระบบ จึงต้องตั้งค่าผ่านบริบท admin ก่อน
function seedRates(c,amounts=[0.15,0.15],validUntil='2999-01-01'){
  const admin=fixture('admin','Synthetic Admin');
  admin.backing.fs_cost=c.backing.fs_cost;
  admin.costRecordOperationFormat({id:'CAP-GEL-0',label:'แคปซูลเจลาติน',owner:'ฝ่ายผลิต',validUntil,
    charges:[{label:'ค่าอัดแคป',amount:amounts[0]},{label:'ค่าแคป',amount:amounts[1]}]});
  c.backing.fs_cost=admin.backing.fs_cost;c.run('costStore=null');
  return admin;
}
// กฎการบวกราคาเป็นสิทธิ์ของผู้มีอำนาจด้านราคา ไม่ใช่ผู้แก้สูตร
function setRule(c,rule){
  const pricer=fixture('admin','Synthetic Admin');
  pricer.backing.fs_cost=c.backing.fs_cost;
  const out=pricer.costRecordPricingRule('A00001','S1',rule||RULE);
  c.backing.fs_cost=pricer.backing.fs_cost;c.run('costStore=null');
  return out;
}

test('กฎการบวกราคาให้ราคาต่อหน่วยตรงกับบันไดของฟอร์ม',async()=>{const c=fixture();
 await readyScenario(c);seedRates(c);
 const before=await c.costLocalRequest('open',{projectId:'A00001'});
 assert.equal(before.view.finalPerSellingUnit,null,'ยังไม่มีกฎ ต้องยังไม่มีราคา');
 assert.equal(before.pricingRule,null);
 setRule(c,RULE);
 const after=await c.costLocalRequest('open',{projectId:'A00001'});
 // 0.25 g x 8.5 บาท/g = 2.125 → x1.1 = 2.3375 → x2.2 = 5.1425 → +0.30 = 5.4425
 assert.ok(Math.abs(after.view.finalPerSellingUnit-5.4425)<1e-6,'ได้ '+after.view.finalPerSellingUnit);
 assert.equal(after.pricingRule.factor,2.2,'ต้องเก็บ 2.2 ตามที่ธุรกิจพูด');
 assert.equal(after.pricingRule.allowancePercent,10);
 assert.equal(after.pricingRule.owner,'เจ้าของอัตรา');});
test('บันทึกกฎซ้ำสร้างเวอร์ชันใหม่ ของเดิมยังอ่านย้อนหลังได้',async()=>{const c=fixture();
 const rev=await readyScenario(c);seedRates(c);
 setRule(c,RULE);
 setRule(c,{...RULE,factor:2.5});
 const latest=await c.costLocalRequest('open',{projectId:'A00001'});
 assert.equal(latest.pricingRule.version,2);
 assert.equal(latest.pricingRule.factor,2.5);
 const old=await c.costLocalRequest('open',{projectId:'A00001',scenarioId:'S1',expectedRevision:rev+1});
 assert.equal(old.pricingRule.version,1);
 assert.equal(old.pricingRule.factor,2.2,'revision เดิมต้องคงอัตราของตัวเอง');});
test('กฎที่กรอกไม่ครบหรือไม่สมเหตุผลถูกปฏิเสธ ไม่บันทึกเวอร์ชัน',async()=>{const c=fixture();
 await readyScenario(c);seedRates(c);
 const pricer=fixture('admin','Synthetic Admin');pricer.backing.fs_cost=c.backing.fs_cost;
 const before=pricer.loadCostStore().scenarios.length;
 for(const [patch,re] of [[{factor:0},/ตัวคูณ/],[{factor:-1},/ตัวคูณ/],[{allowancePercent:-5},/ค่าเผื่อ/],
   [{allowancePercent:150},/ค่าเผื่อ/],[{owner:'   '},/ผู้รับผิดชอบ/],[{validUntil:'2030-02-30'},/YYYY-MM-DD/],
   [{decimals:9},/ทศนิยม/],[{formatId:''},/รูปแบบสินค้า/],[{formatId:'NO-SUCH'},/รูปแบบสินค้า/],[{formatId:'TABLET'},/ยังไม่ได้กรอกอัตรา/],[{pkMode:''},/หมวด PK/],[{pkMode:'maybe'},/หมวด PK/]]){
  assert.throws(()=>pricer.costRecordPricingRule('A00001','S1',{...RULE,...patch}),re,JSON.stringify(patch));
 }
 assert.equal(pricer.loadCostStore().scenarios.length,before,'การปฏิเสธต้องไม่สร้าง revision');});
test('กฎที่หมดอายุแล้วไม่ให้ราคา แม้จะเคยบันทึกไว้',async()=>{const c=fixture();
 await readyScenario(c);seedRates(c);
 setRule(c,{...RULE,validUntil:'2026-09-04'}); // เมื่อวาน
 const body=await c.costLocalRequest('open',{projectId:'A00001'});
 assert.equal(body.view.finalPerSellingUnit,null,'อัตราหมดอายุต้องไม่ออกราคา');
 assert.equal(body.view.complete,false);});
test('ค่าเผื่อขั้นต้นกับ loss รายบรรทัดเป็นคนละตัว และคูณทับกัน',async()=>{const c=fixture();
 await readyScenario(c);seedRates(c);
 setRule(c,RULE);
 const flat=(await c.costLocalRequest('open',{projectId:'A00001'})).view.finalPerSellingUnit;
 const lineId=c.loadCostStore().scenarios[3].scenario.rmLines[0].id;
 const latest=c.loadCostStore().scenarios.at(-1).revision;
 await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:latest,
   patch:{sellingUnits:250000,unitsPerPack:1,fillAmount:0.25,fillUnit:'g',pkSpecVersion:null,
     lines:[{id:lineId,alias:'สารทดสอบ',amount:0.25,lossPercent:5}]}});
 const withLoss=(await c.costLocalRequest('open',{projectId:'A00001'})).view.finalPerSellingUnit;
 // ค่าดำเนินการคงที่ 0.30 ไม่ขึ้นกับ loss ส่วนที่เหลือต้องโตขึ้นตาม 1/0.95
 assert.ok(Math.abs((withLoss-0.30)-(flat-0.30)/0.95)<1e-6,'loss ต้องเพิ่มเฉพาะฝั่งวัตถุดิบ');});
test('บทบาทที่ไม่มีอำนาจด้านราคา กำหนดกฎการบวกราคาและอัตรากลางไม่ได้',async()=>{const c=fixture();
 await readyScenario(c);seedRates(c);
 for(const [role,name] of [['sales','Synthetic Sales'],['purchasing','Synthetic Buyer'],['rd','Synthetic RD']]){
  const u=fixture(role,name);u.backing.fs_cost=c.backing.fs_cost;
  assert.equal(u.costCapabilities().setPricing,false,role);
  assert.throws(()=>u.costRecordPricingRule('A00001','S1',RULE),/อำนาจด้านราคา/,role);
  assert.throws(()=>u.costRecordOperationFormat({id:'CAP-GEL-0',label:'x',owner:'o',validUntil:'2999-01-01',
    charges:[{label:'ค่าอัดแคป',amount:0.15}]}),/อำนาจด้านราคา/,role);
 }});
test('Sales เห็นราคาต่อหน่วยหลังกำหนดกฎ แต่ยังไม่เห็นต้นทุนหรืออัตรา',async()=>{const c=fixture();
 await readyScenario(c);seedRates(c);
 setRule(c,RULE);
 const s=fixture('sales','Synthetic Sales');s.backing.fs_cost=c.backing.fs_cost;
 const body=await s.costLocalRequest('open',{projectId:'A00001'});
 assert.ok(Math.abs(body.view.finalPerSellingUnit-5.4425)<1e-6);
 assert.equal(body.pricingRule,null,'Sales ต้องไม่เห็นอัตราหรือผู้กำหนด');
 assert.ok(!Object.hasOwn(body.view.rm,'baseTotal'));
 assert.ok(!JSON.stringify(body).includes('เจ้าของอัตรา'));});
test('ค่าตั้งต้นที่แสดงบนฟอร์มกับค่าตั้งต้นของ draft ต้องตรงกัน มิฉะนั้นฟอร์มจะค้างสถานะแก้ไข',()=>{
 // ช่องที่ render ค่าหนึ่งแต่ draft บอกอีกค่าหนึ่ง ทำให้ costDraftDirty เป็นจริงตลอด
 // และบล็อกทุกคำสั่งที่ไม่ใช่ open/save เช่นการรับผล PK
 const ui=grab('UI');
 const rendered=ui.match(/costField\('ทศนิยมที่ปัด','costRuleDecimals',([^,]+),/)[1];
 assert.match(rendered,/data\.pricingRule\?data\.pricingRule\.decimals:2/);
 assert.match(ui,/costRuleDecimals:rule\.decimals\?\?2/,'draft default ต้องเป็น 2 เท่ากับที่แสดง');
});

// ── ตารางอัตรามาตรฐานกลาง ──────────────────────────────────────────────────
test('ตารางกลางมาพร้อมโครงรูปแบบสินค้า แต่ไม่มีตัวเลขค่าใช้จ่ายติดมากับโปรแกรม',()=>{const c=fixture();
 const list=c.costFormatList();
 assert.equal(list.length,12);
 assert.ok(list.every(f=>f.ready===false),'ทุกรูปแบบต้องยังใช้ไม่ได้จนกว่าจะกรอกอัตรา');
 assert.ok(list.every(f=>f.charges.every(ch=>ch.amount===null)),'ห้ามมีอัตราตั้งต้นติดมา');
 assert.ok(list.some(f=>f.id==='CAP-GEL-0')&&list.some(f=>f.id==='SACHET'));});
test('แก้อัตรากลางได้เฉพาะผู้มีอำนาจด้านราคา',()=>{
 for(const role of ['rd','purchasing','sales','opc']){
  const c=fixture(role,'ผู้ใช้ '+role);
  assert.throws(()=>c.costRecordOperationFormat({id:'CAP-GEL-0',label:'x',owner:'o',validUntil:'2999-01-01',
    charges:[{label:'ค่าอัดแคป',amount:0.15}]}),/อำนาจด้านราคา/,role);
 }});
test('อัตรากลางที่กรอกไม่ครบถูกปฏิเสธ',()=>{const c=fixture('admin','Synthetic Admin');
 const ok={id:'CAP-GEL-0',label:'แคปซูลเจลาติน',owner:'ฝ่ายผลิต',validUntil:'2999-01-01',charges:[{label:'ค่าอัดแคป',amount:0.15}]};
 for(const [patch,re] of [[{owner:'  '},/ผู้รับผิดชอบ/],[{label:''},/ชื่อรูปแบบ/],[{id:'bad id'},/รหัสรูปแบบ/],
   [{validUntil:'2030-02-30'},/YYYY-MM-DD/],[{charges:[]},/อย่างน้อยหนึ่งรายการ/],
   [{charges:[{label:'',amount:1}]},/ทั้งชื่อและจำนวนเงิน/],[{charges:[{label:'ค่าอัดแคป',amount:-1}]},/ทั้งชื่อและจำนวนเงิน/]]){
  assert.throws(()=>c.costRecordOperationFormat({...ok,...patch}),re,JSON.stringify(patch));
 }
 assert.equal(c.costFormatCurrent('CAP-GEL-0').version,0,'การปฏิเสธต้องไม่สร้างเวอร์ชัน');});
test('แก้อัตรากลางภายหลังไม่เปลี่ยนราคาที่บันทึกไปแล้ว',async()=>{const c=fixture();
 await readyScenario(c);seedRates(c,[0.15,0.15]);
 setRule(c,RULE);
 const first=(await c.costLocalRequest('open',{projectId:'A00001'})).view.finalPerSellingUnit;
 const pinned=c.loadCostStore().scenarios.at(-1).revision;
 seedRates(c,[0.50,0.50]); // ฝ่ายผลิตปรับอัตราขึ้น
 assert.equal(c.costFormatCurrent('CAP-GEL-0').version,2);
 const old=await c.costLocalRequest('open',{projectId:'A00001',scenarioId:'S1',expectedRevision:pinned});
 assert.equal(old.view.finalPerSellingUnit,first,'revision เดิมต้องคงราคาเดิม');
 assert.equal(old.pricingRule.format.version,1,'และคงเวอร์ชันอัตราที่ใช้ตอนนั้น');
 setRule(c,RULE); // เลือกใหม่จึงจะรับอัตราใหม่
 const now=await c.costLocalRequest('open',{projectId:'A00001'});
 assert.equal(now.pricingRule.format.version,2);
 assert.ok(now.view.finalPerSellingUnit>first,'เลือกใหม่แล้วต้องได้อัตราใหม่');});
test('อัตรากลางที่หมดอายุเลือกมาใช้ไม่ได้',async()=>{const c=fixture();
 await readyScenario(c);seedRates(c,[0.15,0.15],'2026-09-04');
 const pricer=fixture('admin','Synthetic Admin');pricer.backing.fs_cost=c.backing.fs_cost;
 assert.throws(()=>pricer.costRecordPricingRule('A00001','S1',RULE),/หมดอายุ/);});

// ── จัดกลุ่มชื่อคล้ายกัน และเปลี่ยน Tier ได้ทีหลัง ────────────────────────────
const tierOffer=(id,mat,name,price,moq,lt,ok=true)=>({...offer,id,materialId:mat,name,price,priceUnit:'kg',
  priceBasisQuantity:1,moq,moqUnit:'kg',increment:1,incrementUnit:'kg',leadTimeDays:lt,tierId:'T'+id.slice(-1),
  status:ok?'confirmed':'draft',specApproved:ok});
async function catalogFixture(){
 const c=fixture();
 c.loadCostStore().catalog.push(
   tierOffer('O1','M1','สารสกัดใบบัวบก 10%',1850,5,14),
   tierOffer('O2','M1','สารสกัดใบบัวบก 10%',1600,25,21),
   tierOffer('O3','M2','สารสกัดใบบัวบก (Powder)',1900,5,10),
   tierOffer('O4','M3','กลีเซอรีน USP',68,25,7),
   tierOffer('O5','M3','กลีเซอรีน USP',61,100,7,false));
 await c.costLocalRequest('open',{projectId:'A00001'});
 return c;
}
test('Tier ของชื่อเดียวกันอยู่กลุ่มเดียวกัน เรียงราคาให้เทียบง่าย',async()=>{const c=await catalogFixture();
 const body=await c.costLocalRequest('open',{projectId:'A00001'});
 const g=body.catalogGroups.find(x=>x.offers.some(o=>o.offerRef==='O1'));
 assert.equal(g.count,2,'สองเทียร์ของชื่อเดียวกันต้องอยู่ด้วยกัน');
 assert.equal(Array.from(g.offers.map(o=>o.price)).join(','),'1600,1850','เรียงราคาต่ำไปสูงเพื่อเทียบ');
 assert.equal(g.distinctNames,1,'ชื่อเดียวกันทั้งกลุ่ม หัวกลุ่มจึงใช้ชื่อนั้นได้');});
// UAT พบว่าการตัดตัวเลขออกจากชื่อทำให้ความเข้มข้นและเลขวิตามินหายไป
// แล้ววัสดุคนละตัวถูกจับรวมกันโดยตัวถูกสุดลอยขึ้นบนสุด ซึ่งชวนให้กดผิด
test('ความเข้มข้นและเลขที่ต่างกันต้องไม่ถูกจับรวมเป็นวัสดุเดียวกัน',async()=>{const c=fixture();
 c.loadCostStore().catalog.push(
   tierOffer('X1','MX1','สารสกัดขมิ้นชัน 95%',9800,1,14),
   tierOffer('X2','MX2','สารสกัดขมิ้นชัน 10%',1200,1,14),
   tierOffer('B1','MB1','วิตามินบี 1',300,1,7),
   tierOffer('B12','MB12','วิตามินบี 12',120,1,7));
 await c.costLocalRequest('open',{projectId:'A00001'});
 const body=await c.costLocalRequest('open',{projectId:'A00001'});
 const groupOf=ref=>body.catalogGroups.find(g=>g.offers.some(o=>o.offerRef===ref));
 assert.notEqual(groupOf('X1').key,groupOf('X2').key,'95% กับ 10% ต้องคนละกลุ่ม');
 assert.notEqual(groupOf('B1').key,groupOf('B12').key,'บี 1 กับ บี 12 ต้องคนละกลุ่ม');
 assert.equal(groupOf('X1').label,'สารสกัดขมิ้นชัน 95%','หัวกลุ่มต้องตรงกับของจริง');});
test('ถ้าชื่อในกลุ่มไม่เหมือนกัน หัวกลุ่มต้องไม่ยืมชื่อตัวใดตัวหนึ่งมาแทน',async()=>{const c=fixture();
 c.loadCostStore().catalog.push(
   tierOffer('Y1','MY1','กลีเซอรีน USP',68,25,7),
   tierOffer('Y2','MY2','กลีเซอรีน (Pure)',61,25,7));
 await c.costLocalRequest('open',{projectId:'A00001'});
 const body=await c.costLocalRequest('open',{projectId:'A00001'});
 const g=body.catalogGroups.find(x=>x.offers.some(o=>o.offerRef==='Y1'));
 assert.equal(g.distinctNames,2);
 assert.ok(g.label.includes('USP')&&g.label.includes('Pure'),'หัวกลุ่มต้องบอกทั้งสองชื่อ ได้ '+g.label);});
test('ระบบไม่เลือก Tier ให้ — ทุก Tier ถูกส่งมาให้เลือกครบ',async()=>{const c=await catalogFixture();
 const body=await c.costLocalRequest('open',{projectId:'A00001'});
 const all=body.catalogGroups.flatMap(g=>g.offers);
 assert.equal(all.length,5,'ต้องไม่คัดเหลือ max หรือ min');
 assert.equal(all.filter(o=>!o.eligible).length,1,'ตัวที่ยังไม่ยืนยันต้องยังแสดงแต่กดไม่ได้');
 all.forEach(o=>{assert.ok(o.moq!=null&&o.leadTimeDays!=null&&o.price!=null,'ต้องมีข้อมูลพอให้ตัดสินใจ');});});
test('เปลี่ยน Tier ของบรรทัดที่ลงสูตรแล้วได้ โดยคงปริมาณและชื่อแสดงเดิม',async()=>{const c=await catalogFixture();
 await c.costLocalRequest('selectRM',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,offerRef:'O1'});
 const id=c.loadCostStore().scenarios[1].scenario.rmLines[0].id;
 await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:2,
   patch:{sellingUnits:1000,unitsPerPack:1,fillAmount:1,fillUnit:'g',pkSpecVersion:null,
     lines:[{id,alias:'ชื่อที่ RD ตั้ง',amount:1,lossPercent:2}]}});
 const before=await c.costLocalRequest('open',{projectId:'A00001'});
 assert.equal(before.lines[0].offerRef,'O1');
 assert.ok(before.lines[0].alternatives.some(a=>a.offerRef==='O2'),'ต้องเสนอ Tier อื่นของสารตัวเดียวกัน');
 assert.ok(!before.lines[0].alternatives.some(a=>a.offerRef==='O3'),'ต้องไม่เสนอ Tier ของสารคนละรหัส');
 const after=await c.costLocalRequest('changeTier',{projectId:'A00001',scenarioId:'S1',
   expectedRevision:before.revision,lineId:id,offerRef:'O2'});
 assert.equal(after.lines[0].offerRef,'O2');
 assert.equal(after.lines[0].alias,'ชื่อที่ RD ตั้ง','ชื่อแสดงต้องไม่หาย');
 assert.equal(after.lines[0].amount,1);
 assert.equal(after.lines[0].lossPercent,2,'loss ต้องไม่หาย');
 assert.ok(after.lines[0].baseTotal<before.lines[0].baseTotal,'ราคาถูกลงต้องสะท้อนในต้นทุน');});
test('เปลี่ยน Tier ข้ามสารไม่ได้ และ revision เดิมยังคงราคาเดิม',async()=>{const c=await catalogFixture();
 await c.costLocalRequest('selectRM',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,offerRef:'O1'});
 const id=c.loadCostStore().scenarios[1].scenario.rmLines[0].id;
 await assert.rejects(c.costLocalRequest('changeTier',{projectId:'A00001',scenarioId:'S1',
   expectedRevision:2,lineId:id,offerRef:'O4'}),/สารตัวเดียวกัน/);
 await assert.rejects(c.costLocalRequest('changeTier',{projectId:'A00001',scenarioId:'S1',
   expectedRevision:2,lineId:'ไม่มีจริง',offerRef:'O2'}),/ไม่พบรายการ/);
 await c.costLocalRequest('changeTier',{projectId:'A00001',scenarioId:'S1',expectedRevision:2,lineId:id,offerRef:'O2'});
 const old=await c.costLocalRequest('open',{projectId:'A00001',scenarioId:'S1',expectedRevision:2});
 assert.equal(old.lines[0].offerRef,'O1','revision เดิมต้องยังใช้ Tier เดิม');});
test('Sales ไม่เห็นทั้งกลุ่มแคตตาล็อกและตัวเลือก Tier',async()=>{const c=await catalogFixture();
 await c.costLocalRequest('selectRM',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,offerRef:'O1'});
 const s=fixture('sales','Synthetic Sales');s.backing.fs_cost=c.backing.fs_cost;
 const body=await s.costLocalRequest('open',{projectId:'A00001'});
 assert.deepEqual(Array.from(body.catalogGroups),[]);
 assert.deepEqual(Array.from(body.lines),[]);
 assert.ok(!JSON.stringify(body).includes('SYNTHETIC VENDOR'));});
test('สารที่ข้อมูลไม่ครบยังปรากฏในรายการ แต่เลือกไม่ได้และบอกว่าขาดอะไร',async()=>{const c=fixture();
 const partial={...tierOffer('O9','M9','สารที่ข้อมูลไม่ครบ',900,5,7)};
 delete partial.leadTimeDays;delete partial.validUntil;
 c.loadCostStore().catalog.push(tierOffer('O1','M1','สารครบถ้วน',1850,5,14),partial);
 await c.costLocalRequest('open',{projectId:'A00001'});
 const body=await c.costLocalRequest('open',{projectId:'A00001'});
 const all=body.catalogGroups.flatMap(g=>g.offers);
 assert.equal(all.length,2,'ต้องยังเห็นทั้งสองตัว ไม่ใช่ซ่อนตัวที่ไม่ครบ');
 const bad=all.find(o=>o.offerRef==='O9');
 assert.equal(bad.eligible,false,'ข้อมูลไม่ครบต้องเลือกไม่ได้');
 assert.ok(bad.missing.includes('Lead Time'));
 assert.ok(bad.missing.includes('วันหมดอายุราคา'));
 assert.equal(all.find(o=>o.offerRef==='O1').eligible,true);
 await assert.rejects(c.costLocalRequest('selectRM',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,offerRef:'O9'})
   .then(b=>{const line=c.loadCostStore().scenarios.at(-1).scenario.rmLines.at(-1);
     if(line&&line.offer&&line.offer.id==='O9'&&b.view.rm.baseTotal!==null)throw Error('ไม่ควรคิดต้นทุนได้');
     throw Error('EXPECTED_NO_COST');}),/EXPECTED_NO_COST/);});
test('ตั้งอัตราขายเป็นคนละสิทธิ์กับแก้สูตร — RD ตั้งเองไม่ได้',async()=>{const c=fixture();
 await readyScenario(c);seedRates(c);
 assert.equal(c.costCapabilities().editRM,true,'RD แก้สูตรได้');
 assert.equal(c.costCapabilities().setPricing,false,'แต่ตั้งอัตราขายไม่ได้');
 assert.throws(()=>c.costRecordPricingRule('A00001','S1',RULE),/อำนาจด้านราคา/);
 const fin=fixture('admin','Synthetic Admin');fin.backing.fs_cost=c.backing.fs_cost;
 assert.equal(fin.costCapabilities().setPricing,true,'Admin ถือ Finance/CEO จึงตั้งได้');});
test('ผู้ถือ capability ด้านราคาโดยตรงตั้งอัตราได้ แม้แก้สูตรไม่ได้',async()=>{const c=fixture();
 await readyScenario(c);seedRates(c);
 const f=fixture('sales','Synthetic Finance');f.backing.fs_cost=c.backing.fs_cost;
 f.loadCostStore().caps['Synthetic Finance']=['Finance'];
 assert.equal(f.costCapabilities().setPricing,true);
 assert.equal(f.costCapabilities().editRM,false,'ตั้งราคาได้ไม่ได้แปลว่าแก้สูตรได้');
 f.costRecordPricingRule('A00001','S1',RULE);
 c.backing.fs_cost=f.backing.fs_cost;c.run('costStore=null');
 const body=await c.costLocalRequest('open',{projectId:'A00001'});
 assert.ok(Math.abs(body.view.finalPerSellingUnit-5.4425)<1e-6,'อัตราที่ตั้งโดยผู้มีอำนาจต้องมีผลจริง');});

// ── ช่องรวมปริมาณ · เกิน/ขาด · ข้อความสรุปที่คัดลอกได้ ───────────────────────
async function formulaFixture(fill){
 const c=fixture();
 c.loadCostStore().catalog.push(tierOffer('O1','M1','สาร ก.',1000,1,7),tierOffer('O2','M2','สาร ข.',500,1,7));
 await c.costLocalRequest('open',{projectId:'A00001'});
 await c.costLocalRequest('selectRM',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,offerRef:'O1'});
 await c.costLocalRequest('selectRM',{projectId:'A00001',scenarioId:'S1',expectedRevision:2,offerRef:'O2'});
 const ls=c.loadCostStore().scenarios[2].scenario.rmLines;
 await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:3,
   patch:{sellingUnits:1000,unitsPerPack:1,fillAmount:fill,fillUnit:'g',pkSpecVersion:null,
     lines:[{id:ls[0].id,alias:'ก',amount:0.4,lossPercent:0},{id:ls[1].id,alias:'ข',amount:0.2,lossPercent:0}]}});
 return c;
}
test('บอกผลรวมในสูตรและเป้าหมายต่อหน่วยเป็นตัวเลข',async()=>{const c=await formulaFixture(0.6);
 const b=await c.costLocalRequest('open',{projectId:'A00001'});
 assert.ok(Math.abs(b.formula.sumKg-0.0006)<1e-12,'0.4 + 0.2 กรัม');
 assert.ok(Math.abs(b.formula.targetKg-0.0006)<1e-12);
 assert.ok(Math.abs(b.formula.differenceKg)<1e-12,'ตรงพอดีต้องเป็นศูนย์');
 assert.equal(b.view.complete!==undefined,true);});
test('บอกว่าเกินเท่าไรเมื่อสูตรมากกว่าปริมาณต่อหน่วย',async()=>{const c=await formulaFixture(0.5);
 const b=await c.costLocalRequest('open',{projectId:'A00001'});
 assert.ok(b.formula.differenceKg>0,'ต้องเป็นบวกเมื่อเกิน');
 assert.ok(Math.abs(b.formula.differenceKg-0.0001)<1e-12,'เกิน 0.1 กรัม');});
test('บอกว่าขาดเท่าไรเมื่อสูตรน้อยกว่าปริมาณต่อหน่วย',async()=>{const c=await formulaFixture(1);
 const b=await c.costLocalRequest('open',{projectId:'A00001'});
 assert.ok(b.formula.differenceKg<0,'ต้องเป็นลบเมื่อขาด');
 assert.ok(Math.abs(b.formula.differenceKg+0.0004)<1e-12,'ขาด 0.4 กรัม');});
test('สูตรที่ปริมาณไม่ตรงถูกทำเครื่องหมายว่ายังไม่สมบูรณ์ และหน้าจอไม่แสดงราคา',async()=>{
 const c=await formulaFixture(0.5);seedRates(c);setRule(c);
 const b=await c.costLocalRequest('open',{projectId:'A00001'});
 assert.equal(b.view.complete,false,'ปริมาณไม่ตรงต้องไม่ถือว่าสมบูรณ์');
 assert.ok(b.view.pending.some(m=>m.includes('ปริมาณ')),'ต้องบอกเหตุผลว่าปริมาณไม่ตรง');
 assert.ok(b.formula.differenceKg>0,'และบอกด้วยว่าเกินเท่าไร');
 // ตัวเรนเดอร์เป็นด่านที่ปิดการแสดงราคาเมื่อยังไม่สมบูรณ์ ไม่ใช่ให้ engine คืน null
 const ui=grab('UI');
 assert.match(ui,/!view\.complete\|\|view\.finalPerSellingUnit==null\?'รอกำหนดราคา'/,
   'renderCostCalculator ต้องซ่อนราคาเมื่อ complete เป็น false');});
test('เมื่อปริมาณตรงพอดีจึงจะสมบูรณ์และให้ราคาได้',async()=>{
 const c=await formulaFixture(0.6);seedRates(c);setRule(c);
 const b=await c.costLocalRequest('open',{projectId:'A00001'});
 assert.equal(b.view.complete,true);
 assert.ok(b.view.finalPerSellingUnit>0);
 assert.ok(Math.abs(b.formula.differenceKg)<1e-12);});
test('ข้อความสรุปคัดลอกได้ และมีแต่ยอดหลังบวก',async()=>{const c=await formulaFixture(0.6);
 seedRates(c);setRule(c);
 const b=await c.costLocalRequest('open',{projectId:'A00001'});
 assert.ok(b.summaryText.includes('ยอดหลังบวกเท่านั้น'));
 assert.ok(b.summaryText.includes('revision'));
 for(const secret of ['SYNTHETIC VENDOR','สาร ก.','1000','500'])
   assert.ok(!b.summaryText.includes(secret),secret+' ต้องไม่อยู่ในข้อความสรุป');});
test('Sales ก็ได้ข้อความสรุปเดียวกัน แต่ไม่ได้ตัวเลขปริมาณในสูตร',async()=>{const c=await formulaFixture(0.6);
 seedRates(c);setRule(c);
 const s=fixture('sales','Synthetic Sales');s.backing.fs_cost=c.backing.fs_cost;
 const b=await s.costLocalRequest('open',{projectId:'A00001'});
 assert.ok(b.summaryText.includes('ยอดหลังบวกเท่านั้น'));
 assert.equal(b.formula,null,'Sales ต้องไม่เห็นตัวเลขปริมาณในสูตร');});
test('รูปแบบสินค้ามี 12 แบบ และพกปริมาณต่อหน่วยตั้งต้นมาด้วย',()=>{const c=fixture();
 const list=c.costFormatList();
 assert.equal(list.length,12);
 const cap=list.find(f=>f.id==='CAP-GEL-0');
 assert.equal(cap.fillAmount,0.6,'แคปซูล #0 ตั้งต้น 0.6 g ต่อเม็ด');
 assert.equal(cap.fillUnit,'g');
 assert.ok(list.every(f=>f.ready===false),'ยังต้องกรอกอัตราก่อนใช้');
 assert.ok(list.some(f=>f.fillAmount===null),'รูปแบบที่ยังไม่รู้ปริมาณต้องเป็น null ไม่ใช่เดา');});
test('มีหน้าจอกรอกอัตรามาตรฐานจริง และผู้มีอำนาจด้านราคาใช้ได้ครบวงจร',async()=>{
 const ui=grab('UI');
 assert.match(ui,/costSaveRates\(\)/,'ต้องมีปุ่มเรียกฟังก์ชันบันทึกอัตรา');
 assert.match(ui,/costRateAmount/,'ต้องมีช่องกรอกจำนวนเงิน');
 assert.match(ui,/ต่อหน่วยที่ผลิต/,'ต้องบอกฐานให้ชัดว่าเป็นต่อหน่วยที่ผลิต');
 // เดินครบวงจร: ตั้งอัตรา แล้วตั้งกฎราคา แล้วต้องได้ราคาต่อหน่วยจริง
 const c=fixture();await readyScenario(c);
 const admin=fixture('admin','Synthetic Admin');admin.backing.fs_cost=c.backing.fs_cost;
 admin.costRecordOperationFormat({id:'CAP-GEL-0',label:'แคปซูลเจลาติน #0',owner:'ฝ่ายผลิต',
   validUntil:'2999-01-01',charges:[{label:'ค่าอัดแคป',amount:0.15},{label:'ค่าแคป',amount:0.15}]});
 admin.costRecordPricingRule('A00001','S1',RULE);
 c.backing.fs_cost=admin.backing.fs_cost;c.run('costStore=null');
 const body=await c.costLocalRequest('open',{projectId:'A00001'});
 assert.ok(body.view.finalPerSellingUnit>0,'ต้องได้ราคาต่อหน่วยออกมาจริง');});
test('ค่าดำเนินการคิดต่อหน่วยที่ผลิต ไม่ใช่ต่อหน่วยขาย',async()=>{const c=fixture();
 c.loadCostStore().catalog.push(tierOffer('O1','M1','สาร ก.',1000,1,7));
 await c.costLocalRequest('open',{projectId:'A00001'});
 await c.costLocalRequest('selectRM',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,offerRef:'O1'});
 const id=c.loadCostStore().scenarios[1].scenario.rmLines[0].id;
 // 100 ขวด x 60 แคปซูล = 6,000 แคปซูล
 await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:2,
   patch:{sellingUnits:100,unitsPerPack:60,fillAmount:0.6,fillUnit:'g',pkSpecVersion:null,
     lines:[{id,alias:'ก',amount:0.6,lossPercent:0}]}});
 const admin=fixture('admin','Synthetic Admin');admin.backing.fs_cost=c.backing.fs_cost;
 admin.costRecordOperationFormat({id:'CAP-GEL-0',label:'แคปซูลเจลาติน #0',owner:'ฝ่ายผลิต',
   validUntil:'2999-01-01',charges:[{label:'ค่าอัดแคป',amount:0.25},{label:'ค่าแคป',amount:0.35}]});
 admin.costRecordPricingRule('A00001','S1',RULE);
 c.backing.fs_cost=admin.backing.fs_cost;c.run('costStore=null');
 const sc=c.loadCostStore().scenarios.at(-1).scenario;
 const calc=c.CostCalculator.calculate(sc,new Date().toISOString().slice(0,10));
 assert.equal(calc.productionUnits,6000);
 assert.equal(calc.operation.baseTotal,0.6*6000,'ต้องคิด 0.60 x 6,000 แคปซูล ไม่ใช่ x 100 ขวด');});

test('A2 catalog denominator validity rejects invalid explicit price bases',()=>{
  const c=fixture();
  for(const value of [1,25]){const parsed=c.costParseCatalogRows([catalogRow({priceBasisQuantity:value})]);assert.equal(parsed.offers.length,1);assert.equal(parsed.offers[0].priceBasisQuantity,value);assert.equal(parsed.rejected.length,0);}
  for(const value of [0,-1,'','not-a-number','Infinity',null]){const parsed=c.costParseCatalogRows([catalogRow({priceBasisQuantity:value})]);assert.equal(parsed.offers.length,0,'invalid denominator '+String(value));assert.equal(parsed.rejected.length,1);assert.match(parsed.rejected[0].reason,/priceBasisQuantity/);}
});
test('A2 non-RD direct summary command is denied before any write',async()=>{
  const c=fixture();await c.costLocalRequest('open',{projectId:'A00001'});
  assert.equal(c.costCapabilities().sendSummary,true,'RD control can send');
  const base={projectId:'A00001',scenarioId:'S1',expectedRevision:1};
  const sent=await c.costLocalRequest('sendSummary',{...base,idempotencyKey:'A00001:S1:1:rd-control'});assert.equal(sent.sendState,'sent');
  for(const role of ['sales','opc']){
    c.currentRole=()=>role;c.userList[0].role=role;
    const before=JSON.stringify({backing:c.backing,chats:c.chats,store:c.loadCostStore()});
    await assert.rejects(c.costLocalRequest('sendSummary',{...base,idempotencyKey:'A00001:S1:1:'+role}),/ไม่มีสิทธิ์ส่งสรุป/);
    assert.equal(JSON.stringify({backing:c.backing,chats:c.chats,store:c.loadCostStore()}),before,'denial must not touch chat, outbox or storage');
  }
});
test('ผล PK บันทึกได้เฉพาะ PU-PK — RD และบทบาทอื่นถูกปฏิเสธ',async()=>{const c=fixture();
 await c.costLocalRequest('open',{projectId:'A00001'});
 await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,
   patch:{sellingUnits:1000,unitsPerPack:1,fillAmount:1,fillUnit:'g',pkSpecVersion:'PACK1',lines:[]}});
 const entry={adjustedTotal:300,validUntil:'2999-01-01',evidenceRef:'REQ1'};
 for(const [role,name] of [['rd','Synthetic RD'],['sales','Synthetic Sales'],['opc','Synthetic OPC']]){
  const u=fixture(role,name);u.backing.fs_cost=c.backing.fs_cost;
  assert.equal(u.costCapabilities().recordPK,false,role);
  assert.throws(()=>u.costRecordPk('A00001','S1',entry),/เฉพาะ PU-PK/,role);
 }
 const pupk=fixture('purchasing','Synthetic PU-PK');pupk.backing.fs_cost=c.backing.fs_cost;
 assert.equal(pupk.costCapabilities().recordPK,true);
 assert.ok(pupk.costRecordPk('A00001','S1',entry).version>=1,'PU-PK ต้องบันทึกได้');});
test('RD ยังนำผล PK ที่ PU-PK บันทึกไว้มาใช้ใน scenario ได้',async()=>{const c=fixture();
 await c.costLocalRequest('open',{projectId:'A00001'});
 await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,
   patch:{sellingUnits:1000,unitsPerPack:1,fillAmount:1,fillUnit:'g',pkSpecVersion:'PACK1',lines:[]}});
 recordPk(c,{adjustedTotal:300,validUntil:'2999-01-01',evidenceRef:'REQ1'});
 assert.equal(c.costCapabilities().recordPK,false,'RD บันทึกไม่ได้');
 assert.equal(c.costCapabilities().adoptPK,true,'แต่รับมาใช้ได้');
 const body=await c.costLocalRequest('adoptPK',{projectId:'A00001',scenarioId:'S1',expectedRevision:2});
 assert.equal(body.view.pk.adjustedTotal,300);});
test('หน้าจอบอกว่าแคตตาล็อกมาจากไฟล์ไหน เพราะแต่ละเครื่องเก็บแยกกัน',async()=>{const c=fixture();
 c.costApplyCatalog({offers:[tierOffer('O1','M1','สาร ก.',1000,1,7)],rejected:[]},'RM_2026-09.xlsx');
 await c.costLocalRequest('open',{projectId:'A00001'});
 const body=await c.costLocalRequest('open',{projectId:'A00001'});
 assert.equal(body.catalogSource.file,'RM_2026-09.xlsx');
 assert.equal(body.catalogSource.by,'Synthetic RD');
 assert.ok(body.catalogSource.at,'ต้องบันทึกเวลาไว้');
 assert.equal(body.catalogSource.total,1);
 const ui=grab('UI');
 assert.match(ui,/แคตตาล็อกเก็บแยกในแต่ละเครื่อง/,'ต้องเตือนบนหน้าจอว่าเครื่องอื่นอาจใช้คนละชุด');
 const s=fixture('sales','Synthetic Sales');s.backing.fs_cost=c.backing.fs_cost;
 assert.equal((await s.costLocalRequest('open',{projectId:'A00001'})).catalogSource,null,'Sales ไม่ต้องเห็นที่มาของแคตตาล็อก');});
