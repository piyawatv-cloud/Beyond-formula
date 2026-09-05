'use strict';
// Local-first cost store (ADR 0002). Loads the real CORE and LOCAL blocks out of
// index.html so these assertions cover shipped code, not a copy.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const grab=name=>html.match(new RegExp('// COST_CALCULATOR_'+name+'_START([\\s\\S]*?)// COST_CALCULATOR_'+name+'_END'))[1];
const CORE=grab('CORE'),LOCAL=grab('LOCAL');

function fixture(role='rd',name='Synthetic RD'){
 const backing={};
 const c={console,
  localStorage:{getItem:k=>Object.prototype.hasOwnProperty.call(backing,k)?backing[k]:null,setItem:(k,v)=>{backing[k]=String(v);},removeItem:k=>{delete backing[k];}},
  currentUser:name,currentRole:()=>role,userList:[{name,role}]};
 vm.createContext(c);vm.runInContext(CORE,c);vm.runInContext(LOCAL,c);
 c.backing=backing;c.run=s=>vm.runInContext(s,c);
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
test('queued summary is never reported as sent and reuse with changed content conflicts',async()=>{const c=fixture();await c.costLocalRequest('open',{projectId:'A00001'});const first=await c.costLocalRequest('sendSummary',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,idempotencyKey:'A00001:S1:1:summary'});assert.equal(first.sendState,'pending');const again=await c.costLocalRequest('sendSummary',{projectId:'A00001',scenarioId:'S1',expectedRevision:1,idempotencyKey:'A00001:S1:1:summary'});assert.equal(again.sendState,'pending');assert.equal(c.loadCostStore().outbox.length,1);assert.equal(c.loadCostStore().outbox[0].receiptId,null);});
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
