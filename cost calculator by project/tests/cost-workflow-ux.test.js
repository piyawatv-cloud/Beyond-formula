'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.resolve(__dirname,'../../index.html'),'utf8');
function fixture(role='rd'){
  const backing={},elements={costView:{innerHTML:'',replaceChildren(){this.innerHTML='';},classList:{add(){},remove(){}}}},chats=[];
  const c={currentUser:'Synthetic User',currentRole:()=>role,userList:[{name:'Synthetic User',role}],authSession:{user:{id:'synthetic'}},authMembership:{role},impersonator:null,records:[{id:'A00001'}],can:()=>true,canSeeRecord:r=>!!r,requirePerm:()=>true,confirm:()=>true,
    window:{addEventListener(){}},document:{getElementById:id=>elements[id],querySelectorAll:()=>[elements.costView]},URL,AbortController,setTimeout,clearTimeout,
    esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'),
    localStorage:{getItem:k=>backing[k]||null,setItem:(k,v)=>{backing[k]=v;}},chats,CHAT_SYS_MAX:5000,chatClamp:t=>t,getChat:id=>chats.find(r=>r.jobId===id),createChat:id=>{const chat={jobId:id,messages:[]};chats.push(chat);return chat;},sbQueue(){},};
  vm.createContext(c);vm.runInContext(html.match(/\/\/ COST_RM_SOURCE_DOMAIN_START([\s\S]*?)\/\/ COST_RM_SOURCE_DOMAIN_END/)[1],c);for(const block of ['CORE','UI','LOCAL'])vm.runInContext(html.match(new RegExp('// COST_CALCULATOR_'+block+'_START([\\s\\S]*?)// COST_CALCULATOR_'+block+'_END'))[1],c);
  vm.runInContext(html.match(/function saveChats\(strict\)[\s\S]*?(?=function sbChatEventsOn)/)[0],c);
  c.run=s=>vm.runInContext(s,c);return Object.assign(c,{elements,backing});
}
const patch={sellingUnits:100,unitsPerPack:60,fillAmount:1,fillUnit:'g',pkSpecVersion:'S1',lines:[]};
test('identical draft save does not consume revision; a changed quantity does',async()=>{
  const c=fixture();await c.costLocalRequest('open',{projectId:'A00001'});
  const a=await c.costLocalRequest('save',{projectId:'A00001',expectedRevision:1,patch});
  const b=await c.costLocalRequest('save',{projectId:'A00001',expectedRevision:a.revision,patch});
  assert.equal(a.revision,2);assert.equal(b.revision,2);assert.equal(c.loadCostStore().scenarios.length,2);
  const d=await c.costLocalRequest('save',{projectId:'A00001',expectedRevision:2,patch:{...patch,sellingUnits:101}});assert.equal(d.revision,3);
});
test('request saved once, listed to requester and Procurement, absent from Sales projection',async()=>{
  const c=fixture();await c.openCostCalculator('A00001');c.elements.costRequestBrief={value:'Synthetic spec <b>'};
  await c.costRequestMaterial();assert.match(c.elements.costView.innerHTML,/บันทึกคำขอจัดหาแล้ว/);assert.match(c.elements.costView.innerHTML,/Synthetic spec &lt;b&gt;/);
  assert.equal(c.loadCostStore().requests.length,1);assert.equal(c.chats.length,0);
  c.elements.costRequestBrief.value='Synthetic spec <b>';await c.costRequestMaterial();assert.equal(c.loadCostStore().requests.length,1);
  const buyer=fixture('purchasing');buyer.backing.fs_cost=c.backing.fs_cost;assert.equal((await buyer.costLocalRequest('open',{projectId:'A00001'})).requests.length,1);
  const sales=fixture('sales');sales.backing.fs_cost=c.backing.fs_cost;await assert.rejects(sales.costLocalRequest('open',{projectId:'A00001'}),/สิทธิ์/,'Sales ไม่เข้าเครื่องคำนวณ จึงไม่เห็นคำขอจัดหา');
});
test('failed request and revision writes leave no success or in-memory phantom',async()=>{
  const c=fixture();await c.openCostCalculator('A00001');const initial=c.backing.fs_cost;c.localStorage.setItem=()=>{throw Error('Quota');};
  await assert.rejects(c.costLocalRequest('save',{projectId:'A00001',expectedRevision:1,patch}),/บันทึก revision ไม่ได้/);
  await assert.rejects(c.costLocalRequest('requestMaterial',{projectId:'A00001',expectedRevision:1,brief:'synthetic'}),/บันทึกคำขอจัดหาไม่ได้/);
  assert.equal(c.loadCostStore().scenarios.length,1);assert.equal(c.loadCostStore().requests.length,0);assert.equal(c.backing.fs_cost,initial);
});
test('actual saveChats failure cannot report cost summary sent',async()=>{
  const c=fixture();await c.costLocalRequest('open',{projectId:'A00001'});const write=c.localStorage.setItem;c.localStorage.setItem=(k,v)=>{if(k==='fs_chats')throw Error('Quota');write(k,v);};
  await assert.rejects(c.costLocalRequest('sendSummary',{projectId:'A00001',expectedRevision:1,idempotencyKey:'synthetic:summary'}),/Quota/);
  assert.equal(c.chats[0].messages.length,0);assert.equal(c.loadCostStore().outbox[0].status,'pending');
});
test('history is visibly read-only and latest action escapes exact revision route',async()=>{
  const c=fixture();await c.costLocalRequest('open',{projectId:'A00001'});await c.costLocalRequest('save',{projectId:'A00001',expectedRevision:1,patch});
  await c.openCostCalculator('A00001','S1',1);assert.match(c.elements.costView.innerHTML,/กำลังดู revision เก่า/);assert.match(c.elements.costView.innerHTML,/เปิด revision ล่าสุด 2/);
  await c.costAction('save',{patch});assert.equal(c.loadCostStore().scenarios.length,2);
  await c.costOpenLatest();assert.equal(c.run('costState.response.revision'),2);assert.equal(c.run('costState.route'),null);
});
test('unit uses a select, invalid direct unit gives a field-specific error',async()=>{
  const c=fixture();await c.openCostCalculator('A00001');assert.match(c.elements.costView.innerHTML,/<select id="costFillUnit"/);
  for(const unit of ['G','กรัม'])await assert.rejects(c.costLocalRequest('save',{projectId:'A00001',expectedRevision:1,patch:{...patch,fillUnit:unit}}),/เลือกหน่วยน้ำหนัก/);
  c.elements.costSellingUnits={value:'-1'};assert.throws(()=>c.costInputNumber('costSellingUnits'),/จำนวนหน่วยขาย/);
});
test('partial typed quantities update sum without saving and distinguish unfilled from zero',async()=>{
  const c=fixture();await c.openCostCalculator('A00001');c.run("costState.response.lines=[{amount:null,unit:'mg'},{amount:null,unit:'g'}]; costState.response.inputs={fillAmount:1,fillUnit:'g'}");
  c.elements.costAmount0={value:'400'};c.elements.costAmount1={value:''};let text=c.costFormulaPreview();assert.match(text,/0.4/);assert.match(text,/ยังไม่กรอก 1 รายการ/);assert.match(text,/ยังขาด 0.6/);
  c.elements.costAmount1.value='0.7';text=c.costFormulaPreview();assert.match(text,/เกิน 0.1/);assert.doesNotMatch(text,/ยังไม่กรอก/);assert.equal(c.loadCostStore().scenarios.length,1);
});
test('PK not-applicable is rendered consistently in summary and category without a zero price',async()=>{
  const c=fixture();await c.costLocalRequest('open',{projectId:'A00001'});c.loadCostStore().scenarios[0].scenario={...c.loadCostStore().scenarios[0].scenario,pkNotApplicable:true};
  await c.openCostCalculator('A00001');assert.equal(c.run('costState.response.view.pk.notApplicable'),true);assert.match(c.elements.costView.innerHTML,/ไม่มีหมวดนี้/);assert.match(c.run('costState.response.summaryText'),/PK: ไม่มีหมวดนี้/);assert.doesNotMatch(c.run('costState.response.summaryText'),/PK 0 บาท/);
});
function workbook(c,complete=true){
  c.XLSX={read:()=>book,utils:{sheet_to_json:grid=>grid}};
  const book={SheetNames:['map','catalog','lt'],Sheets:{
    map:[['RD-Code','Master Ingredient','Master Supplier','Price Tiers (Raw)','MOQ / Qty','Source','Order Increment (kg)','Price Valid Until','Spec Approved','Price Date'],['SYN-1','Synthetic RM','Synthetic Vendor','100','1','SYN-E',complete?1:'',complete?'2999-01-01':'',complete?true:'','2026-01-01']],
    catalog:[['RD-Code','Ingredient Name','Price Status'],['SYN-1','Synthetic RM','READY']],
    lt:[['Offered Ingredient','Lead Time'],['Synthetic RM','7 วัน']]
  }};return book;
}
test('embedded browser adapters match canonical Apps Script byte-for-byte',()=>{
  const expected=require('../tools/sync-rm-browser-domain.js').expected();assert.ok(html.includes(expected));
});
test('direct Data Center workbook consumes added columns and keeps missing records unselectable',async()=>{
  const c=fixture();await c.openCostCalculator('A00001');let parsed=c.costParseCatalogWorkbook(workbook(c));assert.equal(parsed.offers.length,1);assert.equal(parsed.sourceSummary.usable,1);c.costApplyCatalog(parsed);
  let response=await c.costLocalRequest('open',{projectId:'A00001'});assert.equal(response.catalogGroups[0].offers[0].eligible,true);
  parsed=c.costParseCatalogWorkbook(workbook(c,false));assert.equal(parsed.sourceSummary.usable,0);c.costApplyCatalog(parsed);
  response=await c.costLocalRequest('open',{projectId:'A00001'});assert.equal(response.catalogGroups[0].offers[0].eligible,false);assert.match(response.catalogGroups[0].offers[0].missing.join(','),/ขนาดสั่งเพิ่ม/);
});
test('import success has a notice with no retry button and failed write restores catalog',async()=>{
  const c=fixture();await c.openCostCalculator('A00001');workbook(c);await c.costImportCatalogFile({arrayBuffer:async()=>new ArrayBuffer(0)});
  assert.match(c.elements.costView.innerHTML,/นำเข้า 1 รายการ/);assert.equal(c.run('costState.error'),'');assert.doesNotMatch(c.elements.costView.innerHTML,/ลองเปิดอีกครั้ง|ลองเชื่อมต่ออีกครั้ง/);
  const previous=JSON.stringify(c.loadCostStore().catalog);c.localStorage.setItem=()=>{throw Error('Quota');};await c.costImportCatalogFile({arrayBuffer:async()=>new ArrayBuffer(0)});assert.match(c.run('costState.error'),/บันทึกแคตตาล็อกไม่ได้/);assert.equal(JSON.stringify(c.loadCostStore().catalog),previous);
});
test('late file read cannot import after account changes',async()=>{
  const c=fixture();await c.openCostCalculator('A00001');workbook(c);let resolve;const pending=c.costImportCatalogFile({arrayBuffer:()=>new Promise(r=>resolve=r)});c.currentUser='Other';c.costReset();resolve(new ArrayBuffer(0));await pending;assert.equal(c.loadCostStore().catalog.length,0);
});
test('duplicate imported offer IDs fail without silently collapsing suppliers',()=>{
 const c=fixture(),parsed=c.costParseCatalogWorkbook(workbook(c));const before=JSON.stringify(c.loadCostStore().catalog);
 assert.throws(()=>c.costApplyCatalog({...parsed,offers:[parsed.offers[0],{...parsed.offers[0],vendorId:'OTHER'}]}),/รหัสข้อเสนอซ้ำ/);assert.equal(JSON.stringify(c.loadCostStore().catalog),before);
 const sales=fixture('sales');assert.throws(()=>sales.costApplyCatalog(parsed),/ไม่มีสิทธิ์/);
});
test('ambiguous source reimport disables an older catalog offer instead of retaining eligibility',async()=>{
 const c=fixture();await c.openCostCalculator('A00001');
 c.costApplyCatalog(c.costParseCatalogWorkbook(workbook(c)));
 let response=await c.costLocalRequest('open',{projectId:'A00001'});assert.equal(response.catalogGroups[0].offers[0].eligible,true);
 const book=workbook(c);book.Sheets.map.push([...book.Sheets.map[1]]);
 const parsed=c.costParseCatalogWorkbook(book);assert.equal(parsed.offers.length,0);assert.ok(parsed.invalidMaterialIds.includes('SYN-1'));
 c.costApplyCatalog(parsed);response=await c.costLocalRequest('open',{projectId:'A00001'});
 assert.equal(response.catalogGroups[0].offers[0].eligible,false);
});
test('source snapshot retires disappeared tiers without changing stored scenario snapshots',async()=>{
 const c=fixture();await c.openCostCalculator('A00001');
 const parsed=c.costParseCatalogWorkbook(workbook(c));const current=parsed.offers[0],old={...current,id:current.id+'-old',tierId:'old'};
 c.costApplyCatalog({offers:[current,old],rejected:[]});
 const frozen=JSON.stringify(c.loadCostStore().scenarios);
 c.costApplyCatalog(parsed);
 assert.equal(c.loadCostStore().catalog.find(x=>x.id===old.id).status,'review');
 assert.equal(c.loadCostStore().catalog.find(x=>x.id===current.id).status,'confirmed');
 assert.equal(JSON.stringify(c.loadCostStore().scenarios),frozen);
});
