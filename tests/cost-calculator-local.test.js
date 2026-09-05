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
const offer={id:'O1',materialId:'M1',name:'สารสกัดทดสอบ',group:'กลุ่มทดสอบ',spec:'Spec A',vendor:'SYNTHETIC VENDOR',tierId:'T1',status:'confirmed',specApproved:true,currency:'THB',scope:{type:'central'},price:100,priceUnit:'kg',priceBasisQuantity:1,moq:2,moqUnit:'kg',increment:1,incrementUnit:'kg',leadTimeDays:10,validUntil:'2999-01-01',evidenceRef:'E1'};

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
 for(const key of ['price','priceUnit','moq','moqUnit','increment','incrementUnit','leadTimeDays','validUntil','evidenceRef','status','currency','specApproved','id','materialId','tierId','vendorId']){
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
 assert.throws(()=>c.costRecordPk('A00001','S1',{adjustedTotal:300,validUntil:'2999-01-01',evidenceRef:'REQ1'}),/spec บรรจุภัณฑ์/);
 await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,patch:{sellingUnits:1000,unitsPerPack:1,fillAmount:1,fillUnit:'g',pkSpecVersion:'PACK1',lines:[]}});
 for(const bad of ['2030-13-40','2030-02-30','01/01/2030','2030-1-1'])assert.throws(()=>c.costRecordPk('A00001','S1',{adjustedTotal:300,validUntil:bad,evidenceRef:'REQ1'}),/YYYY-MM-DD/,bad);
 assert.throws(()=>c.costRecordPk('A00001','S1',{adjustedTotal:300,validUntil:'2999-01-01',evidenceRef:'  '}),/หลักฐาน/);
 assert.throws(()=>c.costRecordPk('A00001','S1',{validUntil:'2999-01-01',evidenceRef:'REQ1'}),/อย่างน้อยหนึ่งช่อง/);});
test('recorded PK binds the actor and time and can then be adopted',async()=>{const c=fixture();
 await c.costLocalRequest('open',{projectId:'A00001'});
 await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,patch:{sellingUnits:1000,unitsPerPack:1,fillAmount:1,fillUnit:'g',pkSpecVersion:'PACK1',lines:[]}});
 const snap=c.costRecordPk('A00001','S1',{adjustedTotal:300,baseTotal:250,validUntil:'2999-01-01',evidenceRef:'REQ1'});
 assert.equal(snap.confirmedBy,'Synthetic RD');assert.ok(snap.confirmedAt);assert.equal(snap.version,1);assert.equal(snap.specVersion,'PACK1');
 const body=await c.costLocalRequest('adoptPK',{projectId:'A00001',scenarioId:'S1',expectedRevision:2,snapshotRef:snap.id+':1'});
 assert.equal(body.view.pk.adjustedTotal,300);
 assert.equal(body.pkCandidate,null,'adopted candidate must stop being offered');});
test('a renegotiated PK becomes a new version and never rewrites the adopted one',async()=>{const c=fixture();
 await c.costLocalRequest('open',{projectId:'A00001'});
 await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,patch:{sellingUnits:1000,unitsPerPack:1,fillAmount:1,fillUnit:'g',pkSpecVersion:'PACK1',lines:[]}});
 c.costRecordPk('A00001','S1',{adjustedTotal:300,validUntil:'2999-01-01',evidenceRef:'REQ1'});
 await c.costLocalRequest('adoptPK',{projectId:'A00001',scenarioId:'S1',expectedRevision:2});
 const second=c.costRecordPk('A00001','S1',{adjustedTotal:280,validUntil:'2999-01-01',evidenceRef:'REQ2'});
 assert.equal(second.version,2);
 assert.equal(c.loadCostStore().pk[0].adjustedTotal,300,'the earlier snapshot stays untouched');
 const old=await c.costLocalRequest('open',{projectId:'A00001',scenarioId:'S1',expectedRevision:3});
 assert.equal(old.view.pk.adjustedTotal,300,'an already adopted revision keeps its own numbers');});
test('changing pack size after adoption blocks reuse of the old PK snapshot',async()=>{const c=fixture();
 await c.costLocalRequest('open',{projectId:'A00001'});
 await c.costLocalRequest('save',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,patch:{sellingUnits:1000,unitsPerPack:1,fillAmount:1,fillUnit:'g',pkSpecVersion:'PACK1',lines:[]}});
 c.costRecordPk('A00001','S1',{adjustedTotal:300,validUntil:'2999-01-01',evidenceRef:'REQ1'});
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
