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
test('A2 open gate: Sales, OPC, Finance และ CEO เปิดเครื่องคำนวณไม่ได้เลย และการปฏิเสธไม่แตะข้อมูล',async()=>{const c=fixture('rd');c.loadCostStore().catalog.push(offer);await c.costLocalRequest('open',{projectId:'A00001'});await c.costLocalRequest('selectRM',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,offerRef:'O1'});
  for(const [role,name,caps] of [['sales','Synthetic Sales',null],['opc','Synthetic OPC',null],['sales','Synthetic Finance',['Finance']],['sales','Synthetic CEO',['CEO']],['pd','Synthetic PD',null],['mkt','Synthetic MKT',null]]){
    const s=fixture(role,name);s.backing.fs_cost=c.backing.fs_cost;if(caps)s.loadCostStore().caps[name]=caps;
    assert.equal(s.costCapabilities().open,false,name);
    const before=s.backing.fs_cost;
    await assert.rejects(s.costLocalRequest('open',{projectId:'A00001'}),/สิทธิ์/,name);
    assert.equal(s.backing.fs_cost,before,name+': การปฏิเสธต้องไม่เขียนอะไร');
  }
  for(const [role,name] of [['rd','Synthetic RD'],['purchasing','Synthetic Buyer'],['admin','Synthetic Admin']]){const u=fixture(role,name);u.backing.fs_cost=c.backing.fs_cost;assert.equal(u.costCapabilities().open,true,name);}});
test('deep link to an older revision is refused for Sales and allowed for RD',async()=>{const c=fixture();await c.costLocalRequest('open',{projectId:'A00001'});await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,patch:{lines:[]}});const old=await c.costLocalRequest('open',{projectId:'A00001',scenarioId:'S1',expectedRevision:1});assert.equal(old.revision,1);assert.equal(old.capabilities.viewRevision,true);const s=fixture('sales','Synthetic Sales');s.backing.fs_cost=c.backing.fs_cost;assert.equal(s.costCapabilities().viewRevision,false);await assert.rejects(s.costLocalRequest('open',{projectId:'A00001',scenarioId:'S1',expectedRevision:1}),/สิทธิ์/);const p=fixture('purchasing','Synthetic Buyer');p.backing.fs_cost=c.backing.fs_cost;assert.equal(p.costCapabilities().viewRevision,false);await assert.rejects(p.costLocalRequest('open',{projectId:'A00001',scenarioId:'S1',expectedRevision:1}),/RD และ Admin/);});
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
test('every mapped business role returns a renderable cost-v1 view',async()=>{const c=fixture('rd');await c.costLocalRequest('open',{projectId:'A00001'});for(const [role,name] of [['rd','Synthetic RD'],['purchasing','Synthetic Buyer'],['admin','Synthetic Admin']]){const u=fixture(role,name);u.backing.fs_cost=c.backing.fs_cost;const body=await u.costLocalRequest('open',{projectId:'A00001'});assert.equal(body.view.projectId,'A00001',role);assert.equal(body.view.revision,body.revision,role);assert.ok(Array.isArray(body.view.pending),role);}});

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
test('ข้อความสรุปที่ RD ส่งให้ Sales มีราคาต่อหน่วยหลังกำหนดกฎ แต่ไม่มีต้นทุนหรืออัตรา',async()=>{const c=fixture();
 await readyScenario(c);seedRates(c);
 setRule(c,RULE);
 const body=await c.costLocalRequest('open',{projectId:'A00001'});
 assert.ok(body.summaryText.includes('5.44'),'ราคาต่อหน่วยต้องถึง Sales ผ่านข้อความสรุป: '+body.summaryText);
 assert.ok(!body.summaryText.includes('เจ้าของอัตรา')&&!/markup|อัตรา/.test(body.summaryText),'อัตราและผู้กำหนดต้องไม่อยู่ในข้อความ');
 const s=fixture('sales','Synthetic Sales');s.backing.fs_cost=c.backing.fs_cost;
 await assert.rejects(s.costLocalRequest('open',{projectId:'A00001'}),/สิทธิ์/,'Sales ไม่เข้าเครื่องคำนวณ');});
test('ค่าตั้งต้นที่แสดงบนฟอร์มกับค่าตั้งต้นของ draft ต้องตรงกัน มิฉะนั้นฟอร์มจะค้างสถานะแก้ไข',()=>{
 // ช่องที่ render ค่าหนึ่งแต่ draft บอกอีกค่าหนึ่ง ทำให้ costDraftDirty เป็นจริงตลอด
 // และบล็อกทุกคำสั่งที่ไม่ใช่ open/save เช่นการรับผล PK
 // E6-01: ส่วนตั้งกฎราคาย้ายไปหน้า "กฎราคา" แล้ว เครื่องคำนวณต้องไม่วาดช่องพวกนี้อีก
 // ไม่งั้นค่าตั้งต้นที่ต่างกันจะทำให้ draft ค้างสถานะแก้ไขและบล็อกการรับผล PK
 const ui=grab('UI');
 const calc=ui.slice(ui.indexOf('function renderCostCalculator'),ui.indexOf('function costCatalogVisible'));
 for(const id of ['costRuleDecimals','costAllowance','costFactor','costRateAmount'])assert.ok(!calc.includes('id="'+id+'"')&&!calc.includes("'"+id+"'"),'เครื่องคำนวณยังวาด '+id);
 const page=ui.slice(ui.indexOf('function renderCostPricing'),ui.indexOf('function costPricingSaveRates'));
 assert.match(page,/id="costRuleDecimals"[^>]*value="\$\{rule&&rule\.decimals!=null\?text\(rule\.decimals\):'2'\}"/,'หน้ากฎราคาแสดงทศนิยมตั้งต้น 2');
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
test('ชื่อผู้ขายและ Tier ไม่หลุดไปในข้อความสรุปที่ Sales จะได้รับ',async()=>{const c=await catalogFixture();
 await c.costLocalRequest('selectRM',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,offerRef:'O1'});
 const body=await c.costLocalRequest('open',{projectId:'A00001'});
 assert.ok(!body.summaryText.includes('SYNTHETIC VENDOR'));
 assert.ok(!/Tier|T1/.test(body.summaryText));
 const s=fixture('sales','Synthetic Sales');s.backing.fs_cost=c.backing.fs_cost;
 await assert.rejects(s.costLocalRequest('open',{projectId:'A00001'}),/สิทธิ์/);});
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
test('ข้อความสรุปสำหรับ Sales ไม่มีตัวเลขปริมาณในสูตร',async()=>{const c=await formulaFixture(0.6);
 seedRates(c);setRule(c);
 const b=await c.costLocalRequest('open',{projectId:'A00001'});
 assert.ok(b.summaryText.includes('ยอดหลังบวกเท่านั้น'));
 assert.ok(!b.summaryText.includes('0.6'),'ปริมาณในสูตรต้องไม่อยู่ในข้อความที่ Sales ได้รับ');
 assert.ok(b.formula,'RD เองยังเห็นตัวเลขสูตร');});
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
 assert.match(ui,/costPricingSaveRates\(\)/,'ต้องมีปุ่มเรียกฟังก์ชันบันทึกอัตรา (หน้ากฎราคา)');
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
  for(const role of ['purchasing']){ // เปิดได้แต่ห้ามส่ง · Sales/OPC ถูกกันตั้งแต่ประตูใน test อื่น
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
 await assert.rejects(s.costLocalRequest('open',{projectId:'A00001'}),/สิทธิ์/,'Sales ไม่เข้าเครื่องคำนวณ จึงไม่เห็นที่มาของแคตตาล็อกโดยปริยาย');});

// เจ้าของระบบตัดสิน 2026-09-06: นำเข้าซ้ำให้ "ยืนยันเฉพาะราคา"
test('นำเข้าซ้ำยกการรับรอง spec และ Lead Time มาให้ แต่ราคาใหม่ยังต้องยืนยันก่อนใช้',()=>{
  const c=fixture();
  c.loadCostStore().catalog.push({...offer,id:'RMS-AAA-5000000UG',materialId:'RMS-AAA',
    price:1000,specApproved:true,leadTimeDays:14,status:'confirmed'});
  c.saveCostStore();
  const applied=c.costApplyCatalog({offers:[{...offer,id:'RMS-AAA-5000000UG',materialId:'RMS-AAA',
    price:1050,status:'review',specApproved:null,leadTimeDays:null,validUntil:''}],
    rejected:[],replaceMaterialIds:['RMS-AAA']},'รอบสอง.xlsx');
  const after=c.loadCostStore().catalog;
  assert.equal(after.length,1,'รหัสที่เสถียรทำให้ทับของเดิม ไม่ทิ้งรายการกำพร้าไว้');
  assert.equal(after[0].price,1050,'ราคาใหม่ต้องเข้ามาจริง');
  assert.equal(after[0].specApproved,true,'การรับรองเป็นคุณสมบัติของสาร ต้องถูกยกมา');
  assert.equal(after[0].leadTimeDays,14,'Lead Time ต้องถูกยกมา');
  assert.equal(after[0].status,'review','ราคาใหม่ยังไม่ผ่านการยืนยัน จึงยังคิดต้นทุนไม่ได้');
  assert.deepEqual([...after[0].carriedFrom.fields],['specApproved','leadTimeDays'],'ต้องบันทึกว่ายกอะไรมา');
  assert.equal(applied.carried,1,'ต้องรายงานจำนวนที่ยกมาให้ผู้นำเข้าเห็น');
  const missing=c.costOfferMissing(after[0]);
  assert.ok(!missing.includes('การรับรอง spec'),'ยกการรับรองมาแล้ว ห้ามสั่งให้ตรวจ spec ซ้ำ');
  assert.ok(missing.includes('การยืนยันราคาใหม่'),'ต้องบอกให้ตรงว่ารออะไร: '+missing.join(','));
});
test('การรับรองที่ตรวจแล้วไม่ผ่าน หรือค่าที่ไฟล์ใหม่ระบุมาเอง ต้องไม่ถูกของเก่าทับ',()=>{
  const c=fixture();
  c.loadCostStore().catalog.push({...offer,id:'O9',materialId:'M9',specApproved:true,leadTimeDays:14});
  c.saveCostStore();
  c.costApplyCatalog({offers:[{...offer,id:'O9',materialId:'M9',status:'review',
    specApproved:false,leadTimeDays:30}],rejected:[],replaceMaterialIds:['M9']},'รอบสอง.xlsx');
  const after=c.loadCostStore().catalog[0];
  assert.equal(after.specApproved,false,'ตรวจแล้วไม่ผ่านคือข้อมูลใหม่ ห้ามให้ของเก่าทับ');
  assert.equal(after.leadTimeDays,30,'ค่าที่ไฟล์ใหม่ระบุมาต้องชนะค่าเดิม');
  assert.equal(after.carriedFrom,undefined,'ไม่ได้ยกอะไรมาก็ต้องไม่ติดร่องรอยว่ายก');
});
test('วัสดุที่ไม่เคยมีในเครื่อง นำเข้าครั้งแรกต้องไม่ได้การรับรองมาฟรี',()=>{
  const c=fixture();
  c.costApplyCatalog({offers:[{...offer,id:'NEW1',materialId:'MNEW',status:'review',
    specApproved:null,leadTimeDays:null}],rejected:[],replaceMaterialIds:['MNEW']},'ครั้งแรก.xlsx');
  const after=c.loadCostStore().catalog[0];
  assert.equal(after.specApproved,null);
  assert.equal(after.leadTimeDays,null);
});

// เจ้าของระบบยืนยัน 2026-09-06: ราคาต้นทางไม่รวม VAT และระบบไม่บวกให้
test('ข้อความสรุปที่ถูกคัดลอกไปเสนอราคา ต้องบอกว่าไม่รวม VAT',async()=>{
  const c=fixture();
  await c.costLocalRequest('open',{projectId:'A00001'});
  const body=await c.costLocalRequest('open',{projectId:'A00001'});
  assert.match(body.summaryText,/ไม่รวม VAT/,'ผู้รับต้องไม่เข้าใจว่ารวมแล้ว: '+body.summaryText);
});

// ---- E1-01 ชั้น "ใบงานต้นทุน" ครอบ revision เดิม (SPEC Grill round 9) ----
test('เปิดโครงการครั้งแรก สร้างใบงานต้นทุนให้ RD คนนั้นเป็นเจ้าของ และ revision ประทับ jobId',async()=>{
  const c=fixture('rd','RD-คนแรก');
  await c.costLocalRequest('open',{projectId:'A00001'});
  const store=c.loadCostStore();
  assert.equal(store.jobs.length,1);
  assert.equal(store.jobs[0].id,'CJ-000001','รหัสใบงานต้นทุนตาม SPEC');
  assert.equal(store.jobs[0].projectId,'A00001');
  assert.equal(store.jobs[0].owner,'RD-คนแรก','เจ้าของสูตร = RD ที่เริ่มงานต้นทุนคนแรก');
  assert.equal(store.scenarios[0].jobId,'CJ-000001','revision ต้องรู้ว่าอยู่ใต้ใบงานไหน');
  assert.equal(store.jobCounter,1);
});
test('RD คนที่สองบันทึก revision ต่อ ไม่เปลี่ยนเจ้าของและไม่สร้างใบงานซ้ำ',async()=>{
  const c=fixture('rd','RD-คนแรก');
  await c.costLocalRequest('open',{projectId:'A00001'});
  const d=fixture('rd','RD-คนที่สอง');d.backing.fs_cost=c.backing.fs_cost;
  await d.costLocalRequest('open',{projectId:'A00001'});
  await d.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,patch:{lines:[]}});
  const store=d.loadCostStore();
  assert.equal(store.jobs.length,1,'โครงการเดียว = ใบงานเดียว');
  assert.equal(store.jobs[0].owner,'RD-คนแรก');
  assert.ok(store.scenarios.every(r=>r.jobId==='CJ-000001'),'ทุก revision อยู่ใต้ใบงานเดียวกัน');
});
test('ข้อมูล fs_cost รุ่นเก่าที่ไม่มี jobs ถูก migrate เป็นใบงานตอนโหลด โดยไม่แตะโครง revision เดิม',()=>{
  const legacy={v:1,catalog:[],outbox:[],requests:[],pk:[],formats:[],caps:{},catalogSource:null,scenarios:[
    {projectId:'A00010',scenarioId:'S1',revision:2,scenario:{projectId:'A00010',revision:2},createdAt:'2026-09-02T00:00:00Z',createdBy:'RD-ข'},
    {projectId:'A00010',scenarioId:'S1',revision:1,scenario:{projectId:'A00010',revision:1},createdAt:'2026-09-01T00:00:00Z',createdBy:'RD-ก'},
    {projectId:'A00020',scenarioId:'S1',revision:1,scenario:{projectId:'A00020',revision:1},createdAt:'2026-09-03T00:00:00Z',createdBy:'RD-ค'}]};
  const c=fixture();c.backing.fs_cost=JSON.stringify(legacy);
  const store=c.loadCostStore();
  assert.equal(store.jobs.length,2,'สองโครงการ = สองใบงาน');
  const j10=store.jobs.find(j=>j.projectId==='A00010'),j20=store.jobs.find(j=>j.projectId==='A00020');
  assert.equal(j10.owner,'RD-ก','เจ้าของ = ผู้สร้าง revision ต่ำสุด ไม่ใช่แถวแรกในไฟล์');
  assert.equal(j10.createdAt,'2026-09-01T00:00:00Z');
  assert.equal(j20.owner,'RD-ค');
  assert.equal(j10.migrated,true,'ต้องรู้ว่าใบไหนเกิดจาก migrate');
  assert.ok(store.scenarios.every(r=>r.jobId===(r.projectId==='A00010'?j10.id:j20.id)));
  assert.equal(store.scenarios.length,3,'ไม่มี revision หาย');
  assert.deepEqual(Object.keys(store.scenarios[0]).sort(),['createdAt','createdBy','jobId','projectId','revision','scenario','scenarioId'],'เพิ่มได้แค่ jobId');
  assert.equal(c.backing.fs_cost,JSON.stringify(legacy),'โหลดอย่างเดียวห้ามเขียนกลับ (กฎข้อ 4)');
});
test('migrate รันซ้ำได้ไม่สร้างใบงานเพิ่ม และตัวนับไม่ถอยหลัง',async()=>{
  const c=fixture('rd','RD-ก');
  await c.costLocalRequest('open',{projectId:'A00001'});
  await c.costLocalRequest('open',{projectId:'A00002'});
  const saved=c.backing.fs_cost;
  const d=fixture('rd','RD-ก');d.backing.fs_cost=saved;
  const s2=d.loadCostStore();
  assert.equal(s2.jobs.length,2);assert.equal(s2.jobCounter,2);
  assert.equal(JSON.stringify(s2.jobs),JSON.stringify(JSON.parse(saved).jobs),'โหลดซ้ำต้องได้ใบงานชุดเดิมเป๊ะ');
  // ตัวนับที่เสียหาย (ต่ำกว่ารหัสที่มีอยู่) ต้องถูกยกขึ้น ไม่งั้นรหัสถัดไปจะซ้ำ
  const broken=JSON.parse(saved);broken.jobCounter=0;
  const e=fixture('rd','RD-ก');e.backing.fs_cost=JSON.stringify(broken);
  e.loadCostStore();
  const job=e.run(`costCreateJob({projectId:null,title:'งานลอย'})`);
  assert.equal(job.id,'CJ-000003','ห้ามออกรหัส CJ-000001 ซ้ำ');
});
test('สร้างงานลอยได้ ผูกโครงการซ้ำไม่ได้พร้อมบอกเจ้าของ และงานลอยไม่โผล่เป็น revision ของโครงการใด',async()=>{
  const c=fixture('rd','RD-ก');
  await c.costLocalRequest('open',{projectId:'A00001'});
  const floating=c.run(`costCreateJob({projectId:null,title:'ทดลองสูตร',form:'แคปซูล'})`);
  assert.equal(floating.projectId,null);assert.equal(floating.owner,'RD-ก');assert.match(floating.id,/^CJ-\d{6}$/);
  assert.throws(()=>c.run(`costCreateJob({projectId:'A00001'})`),/CJ-000001.*เจ้าของสูตร: RD-ก/,'ต้องบอกว่ามีอยู่แล้วและใครเป็นเจ้าของ');
  assert.throws(()=>c.run(`costCreateJob({projectId:'bad'})`),/ไม่ถูกต้อง/);
  assert.throws(()=>c.run(`costCreateJob({projectId:null,clonedFrom:'CJ-999999'})`),/ไม่พบใบงานต้นทุนต้นแบบ/);
  assert.equal(c.costLatestEntry(null,'S1'),null,'งานลอยไม่ใช่โครงการ');
  assert.equal(c.run(`costJobByProject(null)`),null,'null ไม่ใช่โครงการ ห้ามจับคู่กับงานลอย');
});
test('บันทึกไม่สำเร็จ ต้องถอนใบงานที่เพิ่งสร้างและตัวนับคืน ไม่ทิ้งใบงานผีที่ไม่มี revision',async()=>{
  const c=fixture('rd','RD-ก');
  c.loadCostStore();
  c.localStorage.setItem=()=>{throw Error('เต็ม');};
  await assert.rejects(c.costLocalRequest('open',{projectId:'A00001'}),/บันทึก revision ไม่ได้/);
  const store=c.loadCostStore();
  assert.equal(store.jobs.length,0);assert.equal(store.jobCounter,0);assert.equal(store.scenarios.length,0);
});
test('revision ที่โค้ดรุ่นเก่าเพิ่มเข้ามาหลังมีใบงานแล้ว ถูกผูกกับใบงานเดิม ไม่สร้างใบซ้ำ',()=>{
  // เครื่องที่ยังไม่ hard refresh อาจบันทึก revision โดยไม่มี jobId ลงใน store ที่ migrate แล้ว
  const c=fixture('rd','RD-ก');
  c.backing.fs_cost=JSON.stringify({v:1,catalog:[],outbox:[],requests:[],pk:[],formats:[],caps:{},catalogSource:null,jobCounter:1,
    jobs:[{id:'CJ-000001',projectId:'A00010',title:'',form:'',owner:'RD-ก',createdAt:'2026-09-01T00:00:00Z',createdBy:'RD-ก',clonedFrom:null}],
    scenarios:[{projectId:'A00010',scenarioId:'S1',revision:1,scenario:{},createdAt:'2026-09-01T00:00:00Z',createdBy:'RD-ก',jobId:'CJ-000001'},
      {projectId:'A00010',scenarioId:'S1',revision:2,scenario:{},createdAt:'2026-09-05T00:00:00Z',createdBy:'RD-ข'}]});
  const store=c.loadCostStore();
  assert.equal(store.jobs.length,1,'ห้ามสร้างใบงานที่สองให้โครงการเดิม');
  assert.equal(store.scenarios[1].jobId,'CJ-000001','revision ใหม่ต้องเข้าใบงานเดิม');
  assert.equal(store.jobs[0].owner,'RD-ก','เจ้าของไม่เปลี่ยน');
});

// ---- E2-02 แถว dashboard ใบงานต้นทุน ----
test('dashboard รวมใบงานต้นทุนกับข้อมูลอ่านอย่างเดียวจากใบงาน Formula และคำนวณสถานะจากรายการค้าง',async()=>{
  const c=fixture('rd','RD-ก');
  c.records=[{id:'A00001',customer:'ลูกค้าทดสอบ',brand:'แบรนด์ทดสอบ',form:'แคปซูล'},{id:'A00002',customer:'ลูกค้าปิดแล้ว',brand:'B',form:'ซอง',closed:{by:'x',at:'2026-09-01',ts:1}}];
  await c.costLocalRequest('open',{projectId:'A00001'});
  await c.costLocalRequest('open',{projectId:'A00002'});
  c.run(`costCreateJob({projectId:null,title:'ทดลองลอย',form:'เม็ด'});saveCostStore();`);
  const rows=c.run('costDashboardRows()');
  assert.equal(rows.length,3);
  const a=rows.find(r=>r.projectId==='A00001'),b=rows.find(r=>r.projectId==='A00002'),f=rows.find(r=>r.projectId===null);
  assert.equal(a.customer,'ลูกค้าทดสอบ');assert.equal(a.brand,'แบรนด์ทดสอบ');assert.equal(a.form,'แคปซูล');
  assert.equal(a.closed,false);assert.equal(b.closed,true,'สถานะใบงานมาจาก closed ของ Formula');
  assert.equal(a.status,'draft','ยังไม่มี RM = ร่าง');assert.equal(a.revisions,1);assert.equal(a.owner,'RD-ก');
  assert.equal(a.updatedBy,'RD-ก');assert.ok(a.updatedAt);
  assert.equal(f.title,'ทดลองลอย');assert.equal(f.form,'เม็ด','งานลอยใช้รูปแบบที่ตั้งเอง');assert.equal(f.customer,'');
  assert.equal(a.pricePerUnit,null,'ยังไม่ complete ห้ามมีราคา');
});
test('สถานะต้นทุนไล่ตามลำดับ ร่าง → รอ PK → รอกำหนดราคา → พร้อมเสนอ และราคาโผล่เฉพาะเมื่อพร้อม',async()=>{
  const c=fixture();
  await readyScenario(c);
  let row=c.run('costDashboardRows()')[0];
  assert.ok(['pk','price','wait'].includes(row.status),'มี RM แล้วต้องไม่ใช่ร่าง: '+row.status);
  assert.equal(row.pricePerUnit,null);
  seedRates(c);setRule(c,RULE);
  row=c.run('costDashboardRows()')[0];
  assert.equal(row.status,'ready');
  assert.ok(Math.abs(row.pricePerUnit-5.4425)<1e-6,'ราคาต่อหน่วยจาก revision ล่าสุด');
  assert.equal(c.run(`costJobStatus({complete:false,pending:['PK: รอยืนยัน']},{rmLines:[{}]})`),'pk');
  assert.equal(c.run(`costJobStatus({complete:false,pending:['รอกำหนดราคา']},{rmLines:[{}]})`),'price');
  assert.equal(c.run(`costJobStatus(null,{rmLines:[]})`),'draft');
});
test('Purchasing เห็นแถว dashboard แต่ไม่เห็นราคาต่อหน่วย และ role ที่ถูกกันได้รายการว่าง',async()=>{
  const c=fixture();await readyScenario(c);seedRates(c);setRule(c,RULE);
  const p=fixture('purchasing','Synthetic Buyer');p.backing.fs_cost=c.backing.fs_cost;
  const rows=p.run('costDashboardRows()');
  assert.equal(rows.length,1);assert.equal(rows[0].pricePerUnit,null,'ราคาเป็นของ RD/Admin');
  assert.equal(rows[0].status,'ready','สถานะยังเห็นได้');
  const s=fixture('sales','Synthetic Sales');s.backing.fs_cost=c.backing.fs_cost;
  assert.deepEqual(Array.from(s.run('costDashboardRows()')),[],'Sales ไม่ได้แม้แต่รายการ');
});
test('ใบงานที่ผูกกับ Formula ที่หายไปจากเครื่อง ถูกทำเครื่องหมาย ไม่ล้มทั้งหน้า',async()=>{
  const c=fixture();await c.costLocalRequest('open',{projectId:'A00001'});
  c.records=[];
  const row=c.run('costDashboardRows()')[0];
  assert.equal(row.recordMissing,true);assert.equal(row.customer,'');assert.equal(row.status,'draft');
});

// ---- E3-01/E3-02 เริ่มใบงานสามทาง และผูกงานลอย ----
test('สร้างแบบอ้างอิง Formula ได้ revision 1 ทันทีและเปิดด้วยรหัสโครงการ',async()=>{
  const c=fixture('rd','RD-ก');c.records=[{id:'A00005'}];
  const job=c.run(`costStartJob({mode:'ref',projectId:'A00005'})`);
  assert.equal(job.projectId,'A00005');assert.equal(c.run(`costJobKey(costJobById('${job.id}'))`),'A00005');
  const body=await c.costLocalRequest('open',{projectId:'A00005'});
  assert.equal(body.revision,1);assert.equal(body.job.id,job.id);assert.equal(body.job.bound,true);
  assert.throws(()=>c.run(`costStartJob({mode:'ref',projectId:'A00005'})`),/มีใบงานต้นทุน .* อยู่แล้ว เจ้าของสูตร: RD-ก/);
  assert.throws(()=>c.run(`costStartJob({mode:'ref',projectId:'A00099'})`),/ไม่พบใบงาน Formula/);
  assert.equal(c.loadCostStore().jobs.length,1,'สร้างล้มต้องไม่ทิ้งใบงานผี');
});
test('งานลอยเปิดด้วยรหัสของตัวเอง แก้สูตรได้ แต่ส่งสรุปเข้าแชทไม่ได้และไม่สร้างห้องแชท',async()=>{
  const c=fixture('rd','RD-ก');
  const job=c.run(`costStartJob({mode:'float',title:'ทดลอง',form:'แคปซูล'})`);
  assert.equal(job.projectId,null);assert.match(job.id,/^CJ-\d{6}$/);
  const body=await c.costLocalRequest('open',{projectId:job.id});
  assert.equal(body.projectId,job.id);assert.equal(body.job.bound,false);assert.equal(body.job.title,'ทดลอง');
  await c.costLocalRequest('save',{projectId:job.id,scenarioId:'S1',expectedRevision:1,patch:{sellingUnits:1000,unitsPerPack:1,fillAmount:1,fillUnit:'g',lines:[]}});
  assert.equal((await c.costLocalRequest('open',{projectId:job.id})).revision,2);
  await assert.rejects(c.costLocalRequest('sendSummary',{projectId:job.id,scenarioId:'S1',expectedRevision:2,idempotencyKey:'x:1'}),/งานลอยส่งสรุป/);
  assert.equal(c.chats.length,0,'ห้ามสร้างห้องแชทให้งานลอย');
  assert.equal(c.loadCostStore().jobs.length,1,'เปิดด้วยคีย์ CJ ต้องไม่สร้างใบงานซ้อน');
});
test('โคลนติดสูตร ราคา RM และ PK มาทั้งหมด เจ้าของคือผู้โคลน และราคาหมดอายุในต้นแบบขึ้น "รอ" ในใบใหม่',async()=>{
  const c=fixture('rd','RD-ก');
  await readyScenario(c);seedRates(c);setRule(c,RULE);
  const src=c.loadCostStore().jobs[0];
  const stale={...c.loadCostStore().scenarios.at(-1).scenario};
  const d=fixture('rd','RD-ข');d.backing.fs_cost=c.backing.fs_cost;
  const job=d.run(`costStartJob({mode:'clone',from:'${src.id}',title:'สูตรสอง'})`);
  assert.equal(job.clonedFrom,src.id);assert.equal(job.owner,'RD-ข');assert.equal(job.projectId,null);
  const body=await d.costLocalRequest('open',{projectId:job.id});
  assert.equal(body.revision,1);
  assert.equal(body.lines.length,stale.rmLines.length,'สูตรติดมาครบ');
  assert.equal(body.lines[0].offerRef,stale.rmLines[0].offer.id,'ราคาที่เลือกไว้ติดมา');
  assert.equal(body.view.complete,true,'ต้นแบบพร้อมเสนอ ใบโคลนก็พร้อม เมื่อราคายังไม่หมดอายุ');
  // ทำให้ราคาในต้นแบบหมดอายุ แล้วโคลนอีกใบ
  const st=d.loadCostStore();const last=st.scenarios.filter(r=>r.jobId===src.id).at(-1);
  const expired=JSON.parse(JSON.stringify(last.scenario));expired.rmLines[0].offer.validUntil='2000-01-01';
  d.run('costStore=null');const raw=JSON.parse(d.backing.fs_cost);raw.scenarios.find(r=>r.jobId===src.id&&r.revision===last.revision).scenario=expired;d.backing.fs_cost=JSON.stringify(raw);
  const job2=d.run(`costStartJob({mode:'clone',from:'${src.id}'})`);
  const body2=await d.costLocalRequest('open',{projectId:job2.id});
  assert.equal(body2.view.complete,false,'ราคาหมดอายุต้องไม่ผ่านเงียบ');
  assert.ok(body2.view.pending.some(m=>/^RM 1/.test(m)),'ต้องบอกว่า RM รอยืนยัน: '+body2.view.pending.join('|'));
  assert.throws(()=>d.run(`costStartJob({mode:'clone',from:'CJ-999999'})`),/ไม่พบใบงานต้นทุนต้นแบบ/);
});
test('ผูกงานลอย: รหัสไม่เปลี่ยน revision เก่ายังอยู่ ผูกซ้ำ/ผูกใบที่มีแล้ว/ใบที่ไม่มีในเครื่อง ถูกปฏิเสธ และล้มแล้วถอยกลับ',async()=>{
  const c=fixture('rd','RD-ก');c.records=[{id:'A00001'},{id:'A00002'}];
  await c.costLocalRequest('open',{projectId:'A00001'});
  const job=c.run(`costStartJob({mode:'float',title:'ลอย'})`);
  await c.costLocalRequest('save',{projectId:job.id,scenarioId:'S1',expectedRevision:1,patch:{sellingUnits:500,unitsPerPack:1,fillAmount:1,fillUnit:'g',lines:[]}});
  assert.throws(()=>c.run(`costBindJob('${job.id}','A00001')`),/CJ-000001 อยู่แล้ว เจ้าของสูตร: RD-ก/);
  assert.throws(()=>c.run(`costBindJob('${job.id}','A00077')`),/ไม่พบใบงาน Formula/);
  assert.throws(()=>c.run(`costBindJob('CJ-000001','A00002')`),/ผูกกับ A00001 อยู่แล้ว/);
  // ล้มตอนบันทึก → ต้องถอย projectId กลับ
  const setItem=c.localStorage.setItem;c.localStorage.setItem=()=>{throw Error('เต็ม');};
  assert.throws(()=>c.run(`costBindJob('${job.id}','A00002')`),/บันทึก revision ไม่ได้/);
  c.localStorage.setItem=setItem;
  assert.equal(c.run(`costJobById('${job.id}').projectId`),null,'ล้มแล้วต้องยังเป็นงานลอย');
  const bound=c.run(`costBindJob('${job.id}','A00002')`);
  assert.equal(bound.id,job.id,'รหัสไม่เปลี่ยน');assert.equal(bound.projectId,'A00002');
  const body=await c.costLocalRequest('open',{projectId:'A00002'});
  assert.equal(body.revision,3,'ผูก = revision ใหม่ต่อจากของเดิม');assert.equal(body.inputs.sellingUnits,500,'ค่าที่กรอกไว้ตอนลอยติดมา');
  assert.equal(body.job.id,job.id);assert.equal(body.job.bound,true);
  assert.equal(c.run(`costJobEntries('${job.id}').length`),3,'revision เก่าสองอันยังอยู่ใต้ใบงานเดิม');
  assert.equal(c.run(`costDashboardRows().filter(r=>r.id==='${job.id}').length`),1,'dashboard เห็นใบเดียว ไม่แตกเป็นสอง');
  assert.equal(c.run(`costDashboardRows().find(r=>r.id==='${job.id}').revisions`),3);
  const p=fixture('purchasing','Synthetic Buyer');p.backing.fs_cost=c.backing.fs_cost;p.records=[{id:'A00002'}];
  assert.throws(()=>p.run(`costStartJob({mode:'float'})`),/เฉพาะ RD และ Admin/);
});
test('สร้างใบงานแล้วบันทึก revision แรกล้ม ต้องไม่เหลือใบงานผีทั้งสามทาง และตัวนับคืนเดิม',async()=>{
  const c=fixture('rd','RD-ก');c.records=[{id:'A00005'}];
  await readyScenario(c);
  const before=JSON.stringify(c.loadCostStore().jobs),counter=c.loadCostStore().jobCounter;
  const setItem=c.localStorage.setItem;c.localStorage.setItem=()=>{throw Error('เต็ม');};
  for(const call of [`costStartJob({mode:'ref',projectId:'A00005'})`,`costStartJob({mode:'float',title:'x'})`,`costStartJob({mode:'clone',from:'CJ-000001'})`]){
    assert.throws(()=>c.run(call),/บันทึก revision ไม่ได้/,call);
    assert.equal(JSON.stringify(c.loadCostStore().jobs),before,'ใบงานผีจาก '+call);
    assert.equal(c.loadCostStore().jobCounter,counter,'ตัวนับต้องคืน: '+call);
  }
  c.localStorage.setItem=setItem;
  assert.equal(c.run(`costStartJob({mode:'float',title:'ok'}).id`),'CJ-00000'+(counter+1),'รหัสถัดไปต้องต่อจากเดิม ไม่กระโดด');
});

// ---- E4-02 ใบงาน Formula ปิดแล้ว = อ่านอย่างเดียว ----
test('ใบงาน Formula ปิดแล้ว: เปิดดูได้ แต่ทุก action ที่เปลี่ยนข้อมูลถูกปฏิเสธ และโคลนไปทำใบใหม่ได้',async()=>{
  const c=fixture('rd','RD-ก');c.records=[{id:'A00001'}];
  await c.costLocalRequest('open',{projectId:'A00001'});
  await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,patch:{sellingUnits:100,unitsPerPack:1,fillAmount:1,fillUnit:'g',lines:[]}});
  c.records[0].closed={by:'Sales',at:'2026-09-07',ts:1};
  const body=await c.costLocalRequest('open',{projectId:'A00001'});
  assert.equal(body.locked,true);assert.equal(body.revision,2,'ยังอ่านของเดิมได้');
  const store=c.backing.fs_cost;
  for(const [action,extra] of [['save',{patch:{sellingUnits:5}}],['selectRM',{offerRef:'O1'}],['removeRM',{lineId:'L1'}],['requestMaterial',{brief:'x'}],['adoptPK',{}],['sendSummary',{idempotencyKey:'k:1'}]]){
    await assert.rejects(c.costLocalRequest(action,{projectId:'A00001',scenarioId:'S1',expectedRevision:2,...extra}),/ปิดงานแล้ว/,action);
  }
  assert.equal(c.backing.fs_cost,store,'การปฏิเสธต้องไม่เขียนอะไร');
  const job=c.run(`costStartJob({mode:'clone',from:'CJ-000001'})`);
  const cloned=await c.costLocalRequest('open',{projectId:job.id});
  assert.equal(cloned.locked,false,'ใบโคลนเป็นงานลอย ไม่ล็อก');assert.equal(cloned.inputs.sellingUnits,100,'ค่าติดมา');
  await c.costLocalRequest('save',{projectId:job.id,scenarioId:'S1',expectedRevision:1,patch:{sellingUnits:7}});
  c.records[0].closed=undefined;
  assert.equal((await c.costLocalRequest('open',{projectId:'A00001'})).locked,false,'เปิดงานใหม่แล้วแก้ได้อีก');
});

// ---- E6-01 หน้ากฎราคา: รายการใบงานสำหรับผู้ตั้งราคา ----
test('costPricingJobs ให้เฉพาะใบที่ผูกแล้ว พร้อมกฎปัจจุบัน ไม่มีต้นทุนดิบ/ผู้ขาย/สูตร และให้เฉพาะผู้มีอำนาจด้านราคา',async()=>{
  const c=fixture('rd','RD-ก');c.records=[{id:'A00001',customer:'ลูกค้า ก',brand:'B'}];
  await readyScenario(c);seedRates(c);
  c.run(`costStartJob({mode:'float',title:'ลอย'})`);
  assert.deepEqual(Array.from(c.run('costPricingJobs()')),[],'RD ไม่มีอำนาจด้านราคา');
  const f=fixture('sales','Synthetic Finance');f.backing.fs_cost=c.backing.fs_cost;f.records=c.records;f.loadCostStore().caps['Synthetic Finance']=['Finance'];
  let jobs=f.run('costPricingJobs()');
  assert.equal(jobs.length,1,'งานลอยต้องไม่อยู่ในรายการ');
  assert.equal(jobs[0].projectId,'A00001');assert.equal(jobs[0].customer,'ลูกค้า ก');assert.equal(jobs[0].rule,null);assert.equal(jobs[0].revision,3);
  const text=JSON.stringify(jobs);assert.ok(!/SYNTHETIC|vendor|rmLines|baseTotal|price/i.test(text),'ต้องไม่มีต้นทุนดิบหรือผู้ขาย: '+text);
  f.costRecordPricingRule('A00001','S1',RULE);
  jobs=f.run('costPricingJobs()');
  assert.equal(jobs[0].rule.factor,2.2);assert.equal(jobs[0].rule.allowancePercent,10);assert.equal(jobs[0].rule.pkMode,'notApplicable');assert.equal(jobs[0].rule.format.id,'CAP-GEL-0');assert.equal(jobs[0].revision,4,'บันทึกกฎ = revision ใหม่');
  assert.equal(f.costCapabilities().open,false,'Finance ยังเปิดเครื่องคำนวณไม่ได้');
});

// ---- E5-01 เอกสารทั้งฉบับสำหรับ CEO + ลิงก์ในแชท ----
test('costDocument ให้เฉพาะ CEO/RD/Admin ชี้ revision คงที่ ไม่ fallback และมีรายละเอียดเต็มรวมผู้ขาย',async()=>{
  const c=fixture('rd','RD-ก');c.records=[{id:'A00001',customer:'ลูกค้า ก',brand:'B',form:'แคปซูล'}];
  await readyScenario(c);seedRates(c);setRule(c,RULE);
  const job=c.loadCostStore().jobs[0];
  const doc=c.run(`costDocument('${job.id}',3)`);
  assert.equal(doc.revision,3);assert.equal(doc.projectId,'A00001');assert.equal(doc.customer,'ลูกค้า ก');assert.equal(doc.preVat,true);
  assert.equal(doc.rm.lines.length,1);assert.equal(doc.rm.lines[0].vendor,'SYNTHETIC VENDOR','CEO เห็นผู้ขาย');
  assert.equal(doc.pricingRule,null,'revision 3 ยังไม่มีกฎ');assert.equal(doc.complete,false);
  const latest=c.run(`costDocument('${job.id}',4)`);
  assert.equal(latest.pricingRule.factor,2.2);assert.equal(latest.complete,true);assert.ok(latest.finalPerSellingUnit>0);
  assert.throws(()=>c.run(`costDocument('${job.id}',99)`),/ไม่พบ revision 99/,'ห้าม fallback ไป revision อื่น');
  assert.throws(()=>c.run(`costDocument('CJ-999999',1)`),/ไม่พบใบงานต้นทุน/);
  const ceo=fixture('sales','Synthetic CEO');ceo.backing.fs_cost=c.backing.fs_cost;ceo.records=c.records;ceo.loadCostStore().caps['Synthetic CEO']=['CEO'];
  assert.equal(ceo.costCapabilities().viewDocument,true);assert.equal(ceo.costCapabilities().open,false,'CEO เปิดเครื่องคำนวณไม่ได้แต่อ่านเอกสารได้');
  assert.equal(ceo.run(`costDocument('${job.id}',4)`).rm.lines[0].vendor,'SYNTHETIC VENDOR');
  for(const [role,name] of [['sales','Synthetic Sales'],['purchasing','Synthetic Buyer'],['opc','Synthetic OPC']]){
    const u=fixture(role,name);u.backing.fs_cost=c.backing.fs_cost;u.records=c.records;
    assert.equal(u.costCapabilities().viewDocument,false,name);
    assert.throws(()=>u.run(`costDocument('${job.id}',4)`),/CEO, RD และ Admin/,name);
  }
});
test('sendDocument โพสต์ข้อความเดียวที่พกอ้างอิง revision คงที่ กันส่งซ้ำ และงานลอยส่งไม่ได้',async()=>{
  const c=fixture('rd','RD-ก');c.records=[{id:'A00001'}];
  await readyScenario(c);
  const base={projectId:'A00001',scenarioId:'S1',expectedRevision:3};
  const sent=await c.costLocalRequest('sendDocument',{...base,idempotencyKey:'A00001:S1:3:doc'});
  assert.equal(sent.sendState,'sent');
  assert.equal(c.chats.length,1);const msg=c.chats[0].messages.filter(m=>m.costDocRef);
  assert.equal(msg.length,1);assert.deepEqual({...msg[0].costDocRef},{jobId:'CJ-000001',revision:3});
  assert.equal(msg[0].type,'sys');assert.match(msg[0].text,/revision 3/);assert.match(msg[0].text,/ไม่รวม VAT/);
  assert.ok(!msg[0].text.includes('SYNTHETIC VENDOR'),'ข้อความในแชทต้องไม่มีผู้ขาย — เห็นได้เฉพาะในเอกสาร');
  await c.costLocalRequest('sendDocument',{...base,idempotencyKey:'A00001:S1:3:doc'});
  assert.equal(c.chats[0].messages.filter(m=>m.costDocRef).length,1,'ส่งซ้ำด้วยคีย์เดิมต้องไม่โพสต์เพิ่ม');
  await c.costLocalRequest('save',{...base,patch:{sellingUnits:1}});
  await assert.rejects(c.costLocalRequest('sendDocument',{projectId:'A00001',scenarioId:'S1',expectedRevision:4,idempotencyKey:'A00001:S1:3:doc'}),/เนื้อหาเปลี่ยนแล้ว/);
  const doc=c.run(`costDocument('CJ-000001',3)`);assert.equal(doc.sentBy,'RD-ก','เอกสารรู้ว่าใครส่ง');
  assert.equal(c.run(`costDocument('CJ-000001',4)`).sentBy,null,'revision ที่ไม่ได้ส่งต้องไม่อ้างว่าส่งแล้ว');
  const job=c.run(`costStartJob({mode:'float',title:'ลอย'})`);
  await assert.rejects(c.costLocalRequest('sendDocument',{projectId:job.id,scenarioId:'S1',expectedRevision:1,idempotencyKey:'x:doc'}),/งานลอยส่งเอกสาร/);
  const p=fixture('purchasing','Synthetic Buyer');p.backing.fs_cost=c.backing.fs_cost;p.chats=c.chats;
  await assert.rejects(p.costLocalRequest('sendDocument',{...base,idempotencyKey:'A00001:S1:3:doc2'}),/ไม่มีสิทธิ์ส่งเอกสาร/);
});
test('sendDocument: outbox หายแต่ข้อความยังอยู่ในแชท ต้องจับจากคีย์ในแชท ไม่โพสต์ซ้ำ',async()=>{
  const c=fixture('rd','RD-ก');c.records=[{id:'A00001'}];
  await readyScenario(c);
  const req={projectId:'A00001',scenarioId:'S1',expectedRevision:3,idempotencyKey:'A00001:S1:3:doc'};
  await c.costLocalRequest('sendDocument',req);
  c.loadCostStore().outbox.length=0;c.saveCostStore(); // จำลอง store ถูกกู้คืนจาก backup ที่เก่ากว่าแชท
  await c.costLocalRequest('sendDocument',req);
  assert.equal(c.chats[0].messages.filter(m=>m.costDocRef).length,1,'ห้องแชทเป็นความจริง ห้ามโพสต์ซ้ำ');
});

// ---- 3b ค้นหา→เลือก→ใส่ปริมาณ (REGISTRY §3–§6) ----
test('เปิดใบที่ผูกครั้งแรก ดึงเฉพาะชื่อสารจาก Formula ปริมาณว่าง หน่วยตามรูปแบบ และไม่ดึงซ้ำรอบต่อไป',async()=>{
  const c=fixture('rd','RD-ก');
  c.records=[{id:'A00001',form:'แคปซูล',rows:[{name:'Collagen Type II',w:250},{name:'',w:0},{name:'Vitamin C',w:100}]},{id:'A00002',form:'ซอง',rows:[{name:'Fiber',w:5000}]},{id:'A00003'}];
  const b=await c.costLocalRequest('open',{projectId:'A00001'});
  assert.equal(b.lines.length,2,'แถวว่างไม่ดึง');
  assert.equal(b.lines[0].alias,'Collagen Type II');assert.equal(b.lines[0].amount,null,'ปริมาณให้ RD กรอกเอง');assert.equal(b.lines[0].unit,'mg','แคปซูล = mg');
  assert.equal(b.lines[0].hasOffer,false);assert.equal(b.lines[0].fromFormula,true);assert.equal(b.lines[0].baseTotal,null);
  assert.equal((await c.costLocalRequest('open',{projectId:'A00002'})).lines[0].unit,'g','ซอง = g');
  assert.equal((await c.costLocalRequest('open',{projectId:'A00003'})).lines.length,0,'ไม่มีตารางสารก็ไม่ดึง');
  await c.costLocalRequest('removeRM',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,lineId:b.lines[0].id});
  assert.equal((await c.costLocalRequest('open',{projectId:'A00001'})).lines.length,1,'เปิดซ้ำต้องไม่ดึงกลับมา');
  const fl=c.run(`costStartJob({mode:'float'})`);
  assert.equal((await c.costLocalRequest('open',{projectId:fl.id})).lines.length,0,'งานลอยไม่มี Formula ให้ดึง');
});
test('assignRM ใส่ข้อเสนอให้แถวจาก Formula โดยคงชื่อและปริมาณ บันทึกความจำการเลือก และปฏิเสธแถวที่มีข้อเสนอแล้ว',async()=>{
  const c=fixture('rd','RD-ก');c.records=[{id:'A00001',form:'แคปซูล',rows:[{name:'Collagen Type II'}]}];
  c.loadCostStore().catalog.push({...offer,id:'O1',materialId:'M1',name:'BRANDX (Undenatured Collagen Type II)'});
  let b=await c.costLocalRequest('open',{projectId:'A00001'});
  await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,patch:{lines:[{id:b.lines[0].id,alias:'Collagen Type II',amount:40,lossPercent:0}]}});
  b=await c.costLocalRequest('assignRM',{projectId:'A00001',scenarioId:'S1',expectedRevision:2,lineId:b.lines[0].id,offerRef:'O1'});
  assert.equal(b.lines.length,1,'ต้องไม่เพิ่มแถวใหม่');assert.equal(b.lines[0].hasOffer,true);assert.equal(b.lines[0].alias,'Collagen Type II','ชื่อจากสูตรคงอยู่');assert.equal(b.lines[0].amount,40,'ปริมาณที่กรอกไว้คงอยู่');
  const picks=c.loadCostStore().picks;assert.equal(picks.length,1);assert.equal(picks[0].key,'collagen type ii');assert.equal(picks[0].offerId,'O1');assert.equal(picks[0].count,1);assert.equal(picks[0].by,'RD-ก');
  assert.ok(Array.isArray(b.picks)&&b.picks[0].count===1,'envelope พกความจำไปให้จัดอันดับ');
  await assert.rejects(c.costLocalRequest('assignRM',{projectId:'A00001',scenarioId:'S1',expectedRevision:3,lineId:b.lines[0].id,offerRef:'O1'}),/มีข้อเสนอแล้ว/);
  await assert.rejects(c.costLocalRequest('assignRM',{projectId:'A00001',scenarioId:'S1',expectedRevision:3,lineId:'nope',offerRef:'O1'}),/ไม่พบรายการ/);
  await c.costLocalRequest('selectRM',{projectId:'A00001',scenarioId:'S1',expectedRevision:3,offerRef:'O1'});
  assert.equal(c.loadCostStore().picks.find(p=>p.key===c.run(`costNorm('BRANDX (Undenatured Collagen Type II)')`)).count,1,'selectRM ก็จำ ด้วยชื่อข้อเสนอ');
});
test('searchTokens แตกคำจากชื่อ วงเล็บ ชื่อเรียก และ keywords อย. — พิมพ์ไทยเจอชื่อการค้าอังกฤษ',()=>{
  const c=fixture();
  // พจนานุกรม อย. อยู่นอก LOCAL block ในไฟล์จริงแต่ประกาศในสคริปต์เดียวกันก่อนมีใครเรียก
  // โหลดเข้าบริบทเทสต์ก่อนเรียกครั้งแรกให้เหมือน runtime (V8 cache การค้นหาตัวแปรทั่วโลกต่อสคริปต์)
  const fdaStart=html.indexOf('const THAI_FDA_DB');const fdaEnd=html.indexOf('\n];',fdaStart)+3;c.run(html.slice(fdaStart,fdaEnd));
  const t=c.run(`costSearchTokens({name:'BRANDX™ (Undenatured Collagen Type II)/USA',vendor:'ผู้ขาย ก',aliases:'UC-II; คอลลาเจนไก่'})`);
  for(const w of ['brandx','undenatured','collagen','type','ii','usa','uc','คอลลาเจนไก่'])assert.ok(t.includes(w),'ขาด '+w+': '+t.join(','));
  const v=c.run(`costSearchTokens({name:'Ascorbic Acid 99%'})`);
  assert.ok(v.includes('วิตามินซี')&&v.includes('vitamin'),'keywords อย. ต้องติดมา: '+v.join(','));
  assert.equal(c.run(`costNorm('Acid 50 %')`),c.run(`costNorm('acid 50%')`));assert.notEqual(c.run(`costNorm('Acid 50%')`),c.run(`costNorm('Acid 50')`));
  const w=c.run(`costSearchTokens({name:'Zinc Bisglycinate 20%'})`);assert.ok(w.includes('20%'),'คง % ไว้');
});
test('ตัวแปลงไฟล์นำเข้า: specApproved ที่เป็น null คือยังไม่ตรวจ ไม่ใช่ตรวจแล้วไม่ผ่าน · true จริงคือผ่าน',()=>{
  const c=fixture();
  const base={id:'X1',materialId:'M',tierId:'T',vendorId:'V',status:'review',currency:'THB',price:10,priceUnit:'kg',moq:1,moqUnit:'kg',evidenceRef:'E'};
  const out=c.costParseCatalogRows([{...base,specApproved:null},{...base,id:'X2',specApproved:true},{...base,id:'X3',specApproved:false},{...base,id:'X4',specApproved:'ใช่'},{...base,id:'X5'}]).offers;
  assert.equal(out.map(o=>String(o.specApproved)).join(','),'null,true,false,true,null');
});

// ---- งานจัดซื้อ 2026-09-08: ยืนยันเงื่อนไขซื้อ · รับรอง spec · ปิดคำขอ ----
test('จัดซื้อยืนยันเงื่อนไขซื้อได้เมื่อครบ ขนาดสั่งเพิ่ม/Lead Time/วันหมดอายุ · ไม่ครบปฏิเสธ ไม่เดา · บันทึกล้มถอยกลับ',()=>{
  const c=fixture('rd','RD-ก');
  c.loadCostStore().catalog.push({...offer,id:'P1',status:'review',increment:null,incrementUnit:'',leadTimeDays:null,validUntil:'',specApproved:null});c.saveCostStore();
  assert.throws(()=>c.run(`costConfirmOffer('P1',{})`),/เฉพาะจัดซื้อ/,'RD ยืนยันเงื่อนไขซื้อไม่ได้');
  const p=fixture('purchasing','Synthetic Buyer');p.backing.fs_cost=c.backing.fs_cost;
  assert.equal(p.costCapabilities().confirmOffer,true);assert.equal(p.costCapabilities().approveSpec,false);
  assert.throws(()=>p.run(`costConfirmOffer('P1',{})`),/ยังขาด: .*ขนาดสั่งเพิ่ม.*Lead Time.*วันหมดอายุราคา/,'ต้องบอกครบว่าขาดอะไร');
  assert.throws(()=>p.run(`costConfirmOffer('P1',{increment:'-1',leadTimeDays:'14',validUntil:'2999-01-01'})`),/มากกว่า 0/);
  assert.throws(()=>p.run(`costConfirmOffer('P1',{increment:'5',incrementUnit:'ลัง',leadTimeDays:'14',validUntil:'2999-01-01'})`),e=>String(e.message).includes('kg/g/mg'));
  assert.throws(()=>p.run(`costConfirmOffer('P1',{increment:'5',leadTimeDays:'14.5',validUntil:'2999-01-01'})`),/จำนวนวันเต็ม/);
  assert.throws(()=>p.run(`costConfirmOffer('P1',{increment:'5',leadTimeDays:'14',validUntil:'2000-01-01'})`),/ผ่านไปแล้ว/);
  assert.throws(()=>p.run(`costConfirmOffer('P1',{increment:'5',leadTimeDays:'14',validUntil:'31/12/2999'})`),/YYYY-MM-DD/);
  const setItem=p.localStorage.setItem;p.localStorage.setItem=()=>{throw Error('เต็ม');};
  assert.throws(()=>p.run(`costConfirmOffer('P1',{increment:'5',leadTimeDays:'14',validUntil:'2999-01-01'})`),/บันทึกการยืนยันไม่ได้/);
  p.localStorage.setItem=setItem;
  assert.equal(p.loadCostStore().catalog[0].status,'review','ล้มแล้วต้องยังไม่ยืนยัน');
  const out=p.run(`costConfirmOffer('P1',{increment:'5',leadTimeDays:'14',validUntil:'2999-01-01'})`);
  assert.equal(out.status,'confirmed');assert.equal(out.increment,5);assert.equal(out.incrementUnit,'kg','หน่วยตาม MOQ เมื่อไม่ระบุ');assert.equal(out.leadTimeDays,14);assert.equal(out.validUntil,'2999-01-01');
  assert.equal(out.confirmedBy,'Synthetic Buyer');assert.ok(out.confirmedAt);
  assert.equal(out.specApproved,null,'จัดซื้อยืนยันไม่ทำให้ spec ผ่านเอง');
  assert.ok(p.costOfferMissing(out).includes('การรับรอง spec')&&p.costOfferMissing(out).length===1,'เหลือรอ RD อย่างเดียว');
});
test('RD รับรอง spec ได้ จัดซื้อไม่ได้ · ครบทั้งสองอย่างแล้วข้อเสนอถึงเลือกได้ในเครื่องคำนวณ',async()=>{
  const c=fixture('rd','RD-ก');c.records=[{id:'A00001'}];
  c.loadCostStore().catalog.push({...offer,id:'P2',status:'review',specApproved:null});c.saveCostStore();
  const p=fixture('purchasing','Synthetic Buyer');p.backing.fs_cost=c.backing.fs_cost;
  assert.throws(()=>p.run(`costApproveSpec('P2',true)`),/เฉพาะ RD และ Admin/);
  p.run(`costConfirmOffer('P2',{})`);c.backing.fs_cost=p.backing.fs_cost;c.run('costStore=null');
  let body=await c.costLocalRequest('open',{projectId:'A00001'});
  assert.equal(body.catalogGroups[0].offers[0].eligible,false,'จัดซื้อยืนยันแล้วแต่ RD ยังไม่รับรอง spec');
  const o=c.run(`costApproveSpec('P2',true)`);assert.equal(o.specApproved,true);assert.equal(o.specApprovedBy,'RD-ก');
  body=await c.costLocalRequest('open',{projectId:'A00001'});
  assert.equal(body.catalogGroups[0].offers[0].eligible,true,'ครบสองอย่างจึงเลือกได้');
  assert.equal(body.capabilities.approveSpec,true);
  assert.throws(()=>c.run(`costApproveSpec('NOPE',true)`),/ไม่พบข้อเสนอ/);
});
test('หน้างานจัดซื้อรวมคำขอทุกโครงการ ปิดคำขอได้ครั้งเดียวพร้อมผู้ปิด และไม่มีต้นทุนหลังบวก',async()=>{
  const c=fixture('rd','RD-ก');c.records=[{id:'A00001',customer:'ลูกค้า ก',brand:'B'},{id:'A00002',customer:'ลูกค้า ข'}];
  await c.costLocalRequest('open',{projectId:'A00001'});await c.costLocalRequest('open',{projectId:'A00002'});
  await c.costLocalRequest('requestMaterial',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,brief:'สาร X spec 95%'});
  await c.costLocalRequest('requestMaterial',{projectId:'A00002',scenarioId:'S1',expectedRevision:1,brief:'สาร Y'});
  c.loadCostStore().catalog.push({...offer,id:'P3',status:'review'});c.saveCostStore();
  assert.deepEqual(Array.from(c.run('costProcurementView().requests')),[],'RD ไม่มีสิทธิ์ดูหน้างานจัดซื้อ');
  const p=fixture('purchasing','Synthetic Buyer');p.backing.fs_cost=c.backing.fs_cost;p.records=c.records;
  let v=p.run('costProcurementView()');
  assert.equal(v.requests.length,2,'เห็นคำขอทุกโครงการในที่เดียว');
  assert.equal(v.requests.find(r=>r.projectId==='A00001').customer,'ลูกค้า ก');assert.equal(v.requests[0].status,'open');
  assert.equal(v.pending.length,1);assert.equal(v.pending[0].offerRef,'P3');
  assert.ok(!/adjusted|markup|policies|finalPer/i.test(JSON.stringify(v)),'ไม่มีต้นทุนหลังบวกหรือกฎราคา');
  const key=v.requests[0].key;
  const closed=p.run(`costCloseRequest('${key}','เพิ่มในชีตแถว 120 แล้ว')`);
  assert.equal(closed.status,'done');assert.equal(closed.closedBy,'Synthetic Buyer');assert.equal(closed.note,'เพิ่มในชีตแถว 120 แล้ว');
  assert.throws(()=>p.run(`costCloseRequest('${key}','')`),/ปิดแล้วโดย Synthetic Buyer/);
  assert.throws(()=>c.run(`costCloseRequest('${key}','')`),/เฉพาะจัดซื้อ/);
  assert.equal(p.loadCostStore().requests.length,2,'ไม่ลบ แค่ทำเครื่องหมาย');
  v=p.run('costProcurementView()');assert.equal(v.requests.filter(r=>r.status==='open').length,1);
});

// PK source lineage and IN checks: all inputs below are synthetic.
async function pkSourceFixture(){const c=fixture('rd','Synthetic PU');await c.costLocalRequest('open',{projectId:'A00001'});c.run("costStore.scenarios[0].scenario=CostCalculator.revise(costStore.scenarios[0].scenario,{sellingUnits:100,unitsPerPack:1,fillAmount:1,fillUnit:'g',pkSpecVersion:'PACK1'});costStore.scenarios[0].revision=2;costStore.caps[currentUser]=['PU-PK']");return c;}
const sourcedPk=()=>({adjustedTotal:1234.56,baseTotal:null,validUntil:'2999-01-01',evidenceRef:'SYN-E',expectedRevision:2,source:{requestId:'SYN-REQ',quoteId:'SYN-Q',snapshotId:'SYN-SNAP',revision:1}});
test('PK source retry is idempotent and conflicting content is refused',async()=>{const c=await pkSourceFixture(),p=sourcedPk();const a=c.costRecordPk('A00001','S1',p);assert.equal(a.source.snapshotId,'SYN-SNAP');assert.equal(a.source.mode,'manual-reference');assert.equal(c.costRecordPk('A00001','S1',p).version,a.version);assert.equal(c.loadCostStore().pk.length,1);assert.throws(()=>c.costRecordPk('A00001','S1',{...p,adjustedTotal:9}),/PK_SOURCE_CONFLICT/);});
test('PK source versions are separate from local sequence and old replies rejected',async()=>{const c=await pkSourceFixture(),p=sourcedPk();p.source.revision=5;c.costRecordPk('A00001','S1',p);assert.equal(c.loadCostStore().pk[0].version,1);assert.throws(()=>c.costRecordPk('A00001','S1',{...p,source:{...p.source,snapshotId:'OLDER',revision:4}}),/PK_SOURCE_STALE/);const next=c.costRecordPk('A00001','S1',{...p,source:{...p.source,snapshotId:'NEXT',revision:6}});assert.equal(next.version,2);assert.equal(c.loadCostStore().scenarios.length,1,'receipt never auto adopts');});
test('PK requires complete lineage, nonnegative amounts, current revision and an open job',async()=>{const c=await pkSourceFixture(),p=sourcedPk();assert.throws(()=>c.costRecordPk('A00001','S1',{...p,source:{...p.source,quoteId:''}}),/PK_SOURCE_REQUIRED/);assert.throws(()=>c.costRecordPk('A00001','S1',{...p,baseTotal:-1}),/ยอด PK/);assert.throws(()=>c.costRecordPk('A00001','S1',{...p,expectedRevision:1}),/revision/);assert.throws(()=>c.costRecordPk('A00001','S1',{...p,expectedRevision:undefined}),/revision/);c.records=[{id:'A00001',closed:{by:'Synthetic'}}];assert.throws(()=>c.costRecordPk('A00001','S1',p),/ปิด/);});
test('PK failed persistence cannot leave a phantom candidate',async()=>{const c=await pkSourceFixture();c.localStorage.setItem=()=>{throw Error('full');};assert.throws(()=>c.costRecordPk('A00001','S1',sourcedPk()),/บันทึกผล PK/);assert.equal(c.loadCostStore().pk.length,0);});
test('IN exact decimals keep unit precision and report PO pending independently',()=>{const c=fixture('purchasing');const r=c.costCheckInText('Qty\tUOM\tPrice\tUnit Cost\n100\tpiece\t123.45\t1.2345');assert.equal(r[0].status,'MATCHED_ARITHMETIC');assert.equal(r[0].expected,'123.45');assert.equal(r[0].poStatus,'PENDING_EVIDENCE');assert.equal(c.loadCostStore().scenarios.length,0);});
test('IN commas and two decimals format money but never round away a variance',()=>{const c=fixture('purchasing');let r=c.costCheckInText('Qty\tUOM\tPrice\tUnit Cost\n1\tbox\t1,234.56\t1234.56\n1\tbag\t1.001\t1');assert.equal(r[0].amount,'1,234.56');assert.equal(r[1].status,'VARIANCE');assert.equal(r[1].delta,'0.00');assert.equal(r[1].subCent,true);});
test('IN missing values, malformed numbers and returns stay pending',()=>{const c=fixture('purchasing');for(const row of ['1\t\t10\t10','1\tkg\t\t10','1\tkg\t1,00\t100','-1\tkg\t-10\t10','0\tkg\t0\t10'])assert.equal(c.costCheckInText('Qty\tUOM\tPrice\tUnit Cost\n'+row)[0].status,'PENDING_EVIDENCE');assert.throws(()=>c.costCheckInText('Qty\tUOM\tPrice\tPrice\tUnit Cost\n1\tkg\t1\t1\t1'),/หัวตาราง/);});
test('IN is limited to procurement capabilities and never persisted',()=>{for(const role of ['rd','sales','opc','pd'])assert.throws(()=>fixture(role).costCheckInText('Qty\tUOM\tPrice\tUnit Cost\n1\tkg\t1\t1'),/สิทธิ์/);const c=fixture('purchasing');c.costCheckInText('Qty\tUOM\tPrice\tUnit Cost\n1\tkg\t1\t1');assert.equal(c.backing.fs_cost,undefined);assert.throws(()=>c.costCheckInText('x'.repeat(200001)),/ขนาด/);});

test('PK different quote streams do not invent a shared revision counter',async()=>{const c=await pkSourceFixture(),p=sourcedPk();p.source.revision=5;c.costRecordPk('A00001','S1',p);const next=c.costRecordPk('A00001','S1',{...p,source:{...p.source,quoteId:'OTHER-Q',snapshotId:'OTHER-S',revision:1}});assert.equal(next.source.revision,1);assert.equal(next.version,2);});
test('IN money uses decimal half-up for positive and negative differences',()=>{const c=fixture('purchasing');assert.equal(c.costInMoney(1234565n,3),'1,234.57');assert.equal(c.costInMoney(-1234565n,3),'-1,234.57');assert.equal(c.costInMoney(0n,0),'0.00');const row=c.costCheckInText('Qty\tUOM\tPrice\tUnit Cost\n1\tbox\t9\t10')[0];assert.equal(row.delta,'-1.00');assert.equal(row.status,'VARIANCE');});
test('copy summary shows latest confirmed PK pending adoption without altering revision or chat summary',async()=>{const c=await pkSourceFixture();c.costRecordPk('A00001','S1',sourcedPk());const entry=c.costLatestEntry('A00001','S1');let text=c.costEnvelope(entry).summaryText;assert.match(text,/1,234.56/);assert.match(text,/รอ RD นำมาใช้/);assert.match(text,/ยังไม่ใช่ต้นทุนรวม/);assert.equal(entry.scenario.pk,null);assert.ok(!c.costSummaryText(c.costSalesView(entry)).includes('1,234.56'));const p=sourcedPk();p.adjustedTotal=1100;p.source.snapshotId='SYN-NEXT';p.source.revision=2;c.costRecordPk('A00001','S1',p);assert.match(c.costEnvelope(entry).summaryText,/1,100.00/);assert.ok(!c.costEnvelope(entry).summaryText.includes('SYN-NEXT'));});
test('copy preview cannot show a different-context PK as applicable or alter historical summaries',async()=>{const c=await pkSourceFixture();c.costRecordPk('A00001','S1',sourcedPk());const e=c.costLatestEntry('A00001','S1');c.loadCostStore().pk[0].sellingUnits=999;assert.ok(!c.costEnvelope(e).summaryText.includes('1,234.56'));c.loadCostStore().pk[0].sellingUnits=100;c.run("costStore.scenarios.push({...costStore.scenarios[0],revision:3,scenario:CostCalculator.revise(costStore.scenarios[0].scenario,{})})");assert.ok(!c.costEnvelope(e).summaryText.includes('1,234.56'));});

test('copy summary is adjusted-only and stops showing pending after adoption',async()=>{const c=await pkSourceFixture(),p=sourcedPk();p.baseTotal=9876.54;c.costRecordPk('A00001','S1',p);let e=c.costLatestEntry('A00001','S1');assert.ok(!c.costEnvelope(e).summaryText.includes('9876'));c.loadCostStore().pk[0].status='draft';assert.ok(!c.costEnvelope(e).summaryText.includes('1,234.56'));c.loadCostStore().pk[0].status='confirmed';c.run("costStore.scenarios[0].scenario=CostCalculator.adoptPK(costStore.scenarios[0].scenario,costStore.pk[0],costToday());costStore.scenarios[0].revision=costStore.scenarios[0].scenario.revision");e=c.costLatestEntry('A00001','S1');assert.match(c.costEnvelope(e).summaryText,/PK 1,234.56/);assert.ok(!c.costEnvelope(e).summaryText.includes('รอ RD นำมาใช้'));});

const inLookupRows=()=>[{id:'IN-A',date:'2026-09-01',docNo:'DOC-A',ref:'PO1',newCode:'PK1',oldCode:'OLD1',name:'Synthetic box',lot:'L1',qty:'10',uom:'piece',price:'1100',unitCost:'110'},{id:'IN-B',date:'2026-09-02',docNo:'D2',ref:'PO1',newCode:'PK1',oldCode:'OLD1',name:'Synthetic box',lot:'L2',qty:'10',uom:'piece',price:'1101',unitCost:'110'}];
test('IN lookup returns all receipt rounds and searches old code or document with date bounds',()=>{const c=fixture('purchasing');const rows=c.costInSearch(inLookupRows(),{query:'OLD1'});assert.equal(rows.length,2);assert.equal(rows[0].id,'IN-B');assert.equal(c.costInSearch(inLookupRows(),{query:'DOC-A'})[0].id,'IN-A');assert.equal(c.costInSearch(inLookupRows(),{query:'PK1',from:'2026-09-02',to:'2026-09-02'}).length,1);assert.equal(c.costInSearch(inLookupRows(),{query:'absent'}).length,0);});
test('IN lookup refuses invalid dates, duplicate identities and forbidden roles',()=>{const c=fixture('purchasing');assert.throws(()=>c.costInSearch(inLookupRows(),{from:'2026-02-30'}),/วันที่/);assert.throws(()=>c.costInSearch(inLookupRows(),{from:'2026-09-03',to:'2026-09-01'}),/วันที่/);assert.throws(()=>c.costInSearch([inLookupRows()[0],inLookupRows()[0]],{}),/ตัวตน/);assert.throws(()=>fixture('rd').costInSearch(inLookupRows(),{}),/สิทธิ์/);});
test('IN selection reuses decimal checker and never treats a selected receipt as PO matched',()=>{const c=fixture('purchasing');const result=c.costInCheckSelected(inLookupRows(),'IN-B');assert.equal(result.delta,'1.00');assert.equal(result.poStatus,'PENDING_EVIDENCE');assert.throws(()=>c.costInCheckSelected(inLookupRows(),'missing'),/ไม่พบ/);assert.equal(c.backing.fs_cost,undefined);});

test('saved monetary summary always has two decimals and thousands separators',()=>{assert.equal(fixture().costMoney(1100),'1,100.00');assert.equal(fixture().costMoney(12.5),'12.50');});
