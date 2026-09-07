'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').match(/\/\/ COST_CALCULATOR_UI_START([\s\S]*?)\/\/ COST_CALCULATOR_UI_END/)[1];
function fixture(){
 const panel={innerHTML:'',replaceChildren(){this.innerHTML='';},classList:{add(){},remove(){}}},elements={costView:panel};
 const c={currentUser:'Synthetic RD',currentRole:()=> 'rd',authSession:{user:{id:'TEST'},access_token:'TEST_ONLY'},authMembership:{role:'rd'},impersonator:null,records:[{id:'A00001'}],can:()=>true,canSeeRecord:r=>!!r,requirePerm:()=>true,document:{getElementById:id=>elements[id],querySelectorAll:()=>[panel]},window:{__FS_TEST__:true,listeners:{},addEventListener(name,fn){this.listeners[name]=fn;}},esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'),URL,AbortController,setTimeout,clearTimeout,confirm:()=>true,fetch:()=>{throw Error('Network forbidden');}};
 vm.createContext(c);vm.runInContext(source,c);c.run=s=>vm.runInContext(s,c);c.panel=panel;c.elements=elements;
 c.response=()=>({contract:'cost-v1',projectId:'A00001',scenarioId:'S1',revision:1,view:{projectId:'A00001',revision:1,label:'ยังไม่ใช่ต้นทุนรวมต่อชิ้น',pending:['PK รอยืนยัน']},capabilities:{editRM:true,sendSummary:true,adoptPK:true},inputs:{sellingUnits:1000,unitsPerPack:1,fillAmount:1,fillUnit:'g'},lines:[],catalog:[]});
 return c;
}
test('UI block alone has no transport fallback, so it fails closed on its own',async()=>{const c=fixture();await c.openCostCalculator('A00001');assert.match(c.panel.innerHTML,/ยังไม่เชื่อม Data Center/);assert.equal(c.run('costState.response'),null);});
test('unknown project and impersonation cannot call even test transport',async()=>{const c=fixture();let calls=0;c.window.__costTestRequest=()=>{calls++;return c.response();};await c.openCostCalculator('A00002');c.impersonator='TEST';await c.openCostCalculator('A00001');assert.equal(calls,0);});
test('server response must match exact project and revision',async()=>{const c=fixture();let r=c.response();r.view.revision=2;c.window.__costTestRequest=()=>r;await c.openCostCalculator('A00001');assert.equal(c.run('costState.response'),null);assert.match(c.panel.innerHTML,/ไม่ตรงกับโครงการ/);});
test('late result after session change is discarded and sensitive panel cleared',async()=>{const c=fixture();let resolve;c.window.__costTestRequest=()=>new Promise(r=>resolve=r);const pending=c.openCostCalculator('A00001');c.currentUser='Different account';resolve(c.response());await pending;assert.equal(c.run('costState.response'),null);assert.equal(c.panel.innerHTML,'');});
test('late result after switching projects cannot replace new view',async()=>{const c=fixture();let resolve;c.window.__costTestRequest=()=>new Promise(r=>resolve=r);const pending=c.openCostCalculator('A00001');c.costReset();resolve(c.response());await pending;assert.equal(c.run('costState.response'),null);});
test('requests include optimistic revision and preserve old view after failure',async()=>{const c=fixture();c.window.__costTestRequest=()=>c.response();await c.openCostCalculator('A00001');let payload;c.window.__costTestRequest=(a,p)=>{payload=p;throw Error('Offline');};await c.costAction('save',{patch:{sellingUnits:2000}});assert.equal(payload.expectedRevision,1);assert.equal(c.run('costState.response.revision'),1);assert.match(c.panel.innerHTML,/Offline/);});
test('blank numeric field differs from explicit zero',()=>{const c=fixture();c.elements.input={value:''};assert.equal(c.costInputNumber('input'),null);c.elements.input.value='0';assert.equal(c.costInputNumber('input'),0);c.elements.input.value='Infinity';assert.throws(()=>c.costInputNumber('input'));});
test('untrusted strings are escaped in actual renderer',async()=>{const c=fixture();let r=c.response();r.pkNotice='<img src=x onerror=alert(1)>';r.catalog=[{name:'<script>PRIVATE</script>',offerRef:'opaque',eligible:false}];c.window.__costTestRequest=()=>r;await c.openCostCalculator('A00001');assert.ok(!c.panel.innerHTML.includes('<img'));assert.ok(!c.panel.innerHTML.includes('<script>'));assert.match(c.panel.innerHTML,/&lt;img/);});
test('safe response without editing capability does not render catalog or base cost',async()=>{const c=fixture();let r=c.response();r.capabilities.editRM=false;r.catalog=[];r.view.rm={adjustedTotal:100};c.window.__costTestRequest=()=>r;await c.openCostCalculator('A00001');assert.ok(!c.panel.innerHTML.includes('costSearch'));assert.ok(!c.panel.innerHTML.includes('ต้นทุนหมวดที่คุณดูได้'));});
test('send uses project revision idempotency and does not invent successful state',async()=>{const c=fixture();c.window.__costTestRequest=()=>c.response();await c.openCostCalculator('A00001');let p;c.window.__costTestRequest=(a,payload)=>{assert.equal(a,'sendSummary');p=payload;return {...c.response(),sendState:'pending'};};await c.costSendSummary();assert.equal(p.idempotencyKey,'A00001:S1:1:summary');assert.match(c.panel.innerHTML,/รอส่ง/);assert.ok(!c.panel.innerHTML.includes('ส่งสำเร็จ'));});
test('save patch contains user inputs only, no price or authority fields',async()=>{const c=fixture();c.window.__costTestRequest=()=>c.response();await c.openCostCalculator('A00001');for(const id of ['costSellingUnits','costUnitsPerPack','costFillAmount'])c.elements[id]={value:'1'};c.elements.costFillUnit={value:'g'};c.elements.costPkSpecVersion={value:'PACK1'};let patch;c.window.__costTestRequest=(a,p)=>{patch=p.patch;return c.response();};await c.costSave();
// fillUnit and pkSpecVersion were added because a PK snapshot cannot match a
// scenario without them. Both are user-entered descriptors, not prices.
assert.deepEqual(Object.keys(patch).sort(),['fillAmount','fillUnit','lines','pkSpecVersion','sellingUnits','unitsPerPack']);
for(const key of ['price','baseTotal','adjustedTotal','offer','approval','confirmedBy','capabilities'])assert.ok(!Object.hasOwn(patch,key),key);
for(const line of patch.lines)assert.deepEqual(Object.keys(line).sort(),['alias','amount','id','lossPercent']);});
test('non-HTTPS or missing authenticated membership blocks configured network',async()=>{const c=fixture();c.run("COST_API_ORIGIN='http://example.invalid'");await assert.rejects(c.costRequest('open',{projectId:'A00001'}),/ไม่พร้อม/);c.run("COST_API_ORIGIN='https://example.invalid'");c.authMembership=null;await assert.rejects(c.costRequest('open',{projectId:'A00001'}),/บัญชี/);});
test('search preserves unsaved quantity and sourcing brief',async()=>{const c=fixture();c.window.__costTestRequest=()=>c.response();await c.openCostCalculator('A00001');c.elements.costSellingUnits={value:'2500'};c.elements.costRequestBrief={value:'Need custom spec'};c.costSearchChanged('B');assert.match(c.panel.innerHTML,/value="2500"/);assert.match(c.panel.innerHTML,/Need custom spec/);});
test('mutation includes scenario identity and rejects other scenario response',async()=>{const c=fixture();c.window.__costTestRequest=()=>c.response();await c.openCostCalculator('A00001');let payload;c.window.__costTestRequest=(a,p)=>{payload=p;return {...c.response(),scenarioId:'S2'};};await c.costAction('save',{patch:{}});assert.equal(payload.scenarioId,'S1');assert.equal(c.run('costState.response.scenarioId'),'S1');});
test('older response cannot rewind revision',async()=>{const c=fixture();let r=c.response();r.revision=3;r.view.revision=3;c.window.__costTestRequest=()=>r;await c.openCostCalculator('A00001');c.window.__costTestRequest=()=>c.response();await c.costAction('save',{patch:{}});assert.equal(c.run('costState.response.revision'),3);});
test('successful line removal cannot transfer prior line edits by index',async()=>{const c=fixture();let r=c.response();r.lines=[{id:'L1',alias:'ALPHA',amount:1,lossPercent:0},{id:'L2',alias:'BETA',amount:2,lossPercent:0}];c.window.__costTestRequest=()=>r;await c.openCostCalculator('A00001');c.elements.costAlias0={value:'ALPHA'};c.elements.costAmount0={value:'1'};c.elements.costRequestBrief={value:'Preserve brief'};const next={...c.response(),revision:2,view:{...c.response().view,revision:2},lines:[r.lines[1]]};c.window.__costTestRequest=()=>next;await c.costRemove(0);assert.match(c.panel.innerHTML,/value="BETA"/);assert.ok(!c.panel.innerHTML.includes('value="ALPHA"'));assert.match(c.panel.innerHTML,/Preserve brief/);});
test('Formula deep link opens exact scenario/revision only after authenticated readiness',async()=>{const c=fixture();c.window.location={hash:'#project=A00001&scenario=S1&revision=3'};let calls=[];c.window.__costTestRequest=(action,p)=>{calls.push(p);let r=c.response();r.revision=3;r.view.revision=3;r.capabilities.viewRevision=true;return r;};c.authMembership=null;await c.costResolveLink();assert.equal(calls.length,0);c.authMembership={role:'rd'};await c.costResolveLink();assert.equal(calls.length,1);assert.equal(calls[0].scenarioId,'S1');assert.equal(calls[0].expectedRevision,3);assert.equal(c.run('costState.response.revision'),3);await c.costResolveLink();assert.equal(calls.length,1);});
test('malformed unknown and duplicated hash routes are ignored',async()=>{const c=fixture();let calls=0;c.window.__costTestRequest=()=>{calls++;return c.response();};for(const hash of ['#chat','#project=A00001','#project=A00001&scenario=S1&revision=0','#project=A00001&scenario=S1&revision=2&revision=3','#project=A00001&scenario=S1&revision=2&role=CEO','#project=A99999&scenario=S1&revision=2']){c.window.location={hash};await c.costResolveLink();}assert.equal(calls,0);});
test('exact link response rejects newer revision and missing server viewing capability',async()=>{for(const mode of ['newer','capability']){const c=fixture();c.window.__costTestRequest=()=>{let r=c.response();r.capabilities.viewRevision=true;if(mode==='newer'){r.revision=2;r.view.revision=2;}else delete r.capabilities.viewRevision;return r;};await c.openCostCalculator('A00001','S1',1);assert.equal(c.run('costState.response'),null);}});
test('hash switch invalidates older in-flight exact revision and logout clears route state',async()=>{const c=fixture();let resolve;c.window.location={hash:'#project=A00001&scenario=S1&revision=1'};c.window.__costTestRequest=()=>new Promise(r=>resolve=r);let opening=c.costResolveLink();c.window.location.hash='#project=A00001&scenario=S1&revision=2';c.window.__costTestRequest=()=>{let r=c.response();r.revision=2;r.view.revision=2;r.capabilities.viewRevision=true;return r;};await c.costResolveLink();let old=c.response();old.capabilities.viewRevision=true;resolve(old);await opening;assert.equal(c.run('costState.response.revision'),2);c.currentUser='';c.authSession=null;await c.costResolveLink();assert.equal(c.run('costState.response'),null);assert.equal(c.run('costRouteState.handledKey'),'');});
test('exact route is preserved when retrying a failed open',async()=>{const c=fixture();c.window.__costTestRequest=()=>{throw Error('Offline');};await c.openCostCalculator('A00001','S1',3);let payload;c.window.__costTestRequest=(action,p)=>{payload=p;let r=c.response();r.revision=3;r.view.revision=3;r.capabilities.viewRevision=true;return r;};await c.costAction('open',{});assert.equal(payload.scenarioId,'S1');assert.equal(payload.expectedRevision,3);});

test('registered hashchange ignores equivalent route and makes no preauth request',async()=>{const c=fixture();assert.equal(typeof c.window.listeners.hashchange,'function');c.window.location={hash:'#project=A00001&scenario=S1&revision=1'};let calls=0;c.window.__costTestRequest=()=>{calls++;let r=c.response();r.capabilities.viewRevision=true;return r;};c.authSession=null;c.window.listeners.hashchange();await Promise.resolve();assert.equal(calls,0);c.authSession={user:{id:'TEST'},access_token:'TEST_ONLY'};await c.costResolveLink();c.window.listeners.hashchange();await Promise.resolve();assert.equal(calls,1);});
test('incomplete scenario never labels a calculated candidate as final unit price',async()=>{const c=fixture();const r=c.response();r.view.complete=false;r.view.finalPerSellingUnit=987654;c.window.__costTestRequest=()=>r;await c.openCostCalculator('A00001');assert.ok(!c.panel.innerHTML.includes('987,654'));assert.match(c.panel.innerHTML,/ราคาต่อหน่วยขาย: รอกำหนดราคา/);});
test('first open of a project sends no scenario or revision, so the service layer owns resolution',async()=>{const c=fixture();let payload;c.window.__costTestRequest=(action,p)=>{assert.equal(action,'open');payload=p;return c.response();};await c.openCostCalculator('A00001');assert.equal(payload.projectId,'A00001');assert.equal(payload.scenarioId,null);assert.equal(payload.expectedRevision,null);assert.equal(c.run('costState.response.scenarioId'),'S1');});
test('server-resolved scenario on first open is adopted and then pinned for later actions',async()=>{const c=fixture();c.window.__costTestRequest=()=>({...c.response(),scenarioId:'RESOLVED'});await c.openCostCalculator('A00001');assert.equal(c.run('costState.response.scenarioId'),'RESOLVED');let payload;c.window.__costTestRequest=(a,p)=>{payload=p;return {...c.response(),scenarioId:'RESOLVED'};};await c.costAction('save',{patch:{}});assert.equal(payload.scenarioId,'RESOLVED');assert.equal(payload.expectedRevision,1);});
test('a flat catalog with no groups still renders, so the older response shape keeps working',async()=>{const c=fixture();let r=c.response();r.catalog=[{offerRef:'O1',name:'สารทดสอบ',spec:'Spec A',vendor:'V',tierLabel:'T1',price:100,priceUnit:'kg',priceBasisQuantity:1,moq:2,moqUnit:'kg',leadTimeDays:7,eligible:true}];delete r.catalogGroups;c.window.__costTestRequest=()=>r;await c.openCostCalculator('A00001');assert.match(c.panel.innerHTML,/สารทดสอบ/);assert.match(c.panel.innerHTML,/costSelectRef/);});

test('รายงานการนำเข้าไม่แต่งเลขแถวขึ้นมาเมื่อต้นทางบอกได้แค่รหัส',()=>{
  // การนับลำดับใหม่แล้วเรียกว่า "แถว" ทำให้จัดซื้อเปิดชีตไปผิดแถวสนิท
  const c=fixture();
  c.run(`var XLSX={utils:{sheet_to_json:()=>[['RD-Code','Price Tiers (Raw)']]}};
    var costParseCatalogRows=()=>({offers:[],rejected:[]});
    var costToday=()=>'2026-09-06';`);
  c.run(`var RmCatalogBuild={fromSheets:()=>({offers:[],summary:{usable:0},
    skipped:[{code:'RD-A-001',reason:'ยังไม่มีราคา'},{row:47,reason:'อ่าน MOQ ไม่ได้'}]})};`);
  const parsed=c.run(`costParseCatalogWorkbook({SheetNames:['s'],Sheets:{s:{}}})`);
  assert.equal(parsed.rejected.length,2);
  assert.equal(parsed.rejected[0].row,null,'ไม่รู้เลขแถวต้องเป็น null ไม่ใช่ 1');
  assert.equal(parsed.rejected[0].ref,'RD-A-001','ต้องส่งต่อรหัสที่รู้จริง');
  assert.equal(parsed.rejected[1].row,47,'ถ้าต้นทางบอกเลขแถวจริงต้องใช้เลขนั้น');
});

test('หมายเหตุยาวถูกย่อพอให้อ่านในตาราง และ link ไม่ถูกตัดจนเปิดไม่ได้',()=>{
  const c=fixture();
  const brief=t=>c.run(`costBrief(${JSON.stringify(t)})`);
  assert.equal(brief('เงื่อนไขสั้น'),'เงื่อนไขสั้น','ข้อความสั้นต้องไม่ถูกแตะ');
  const long='เงื่อนไขการใช้เครื่องหมายการค้า '.repeat(20);
  const out=brief(long);
  assert.ok(out.length<=95&&out.length>60,'ต้องย่อแต่ยังอ่านได้: ยาว '+out.length);
  assert.ok(out.endsWith('…'),'ต้องบอกว่ายังมีต่อ');
  assert.ok(long.startsWith(out.slice(0,-1).trim()),'ส่วนที่แสดงต้องเป็นต้นข้อความจริง');
  const withLink=long+' https://example.com/spec.pdf';
  const linked=brief(withLink);
  assert.ok(linked.includes('https://example.com/spec.pdf'),'link ต้องอยู่ครบเส้น ไม่ถูกตัดกลาง: '+linked);
});

test('พิมพ์ค้นหาแล้ววาดใหม่เฉพาะเนื้อตาราง ไม่ทับทั้งแผง',()=>{
  const c=fixture();
  const body={innerHTML:'เดิม'};
  const inputs={costSellingUnits:{value:'5000'},costAmount0:{value:'250'},costCatalogBody:body};
  c.elements.costCatalogBody=body;
  Object.assign(c.elements,inputs);
  c.run(`costState.response=${JSON.stringify({contract:'cost-v1',projectId:'A00001',scenarioId:'S1',revision:1,
    catalog:[],catalogGroups:[
      {key:'g1',label:'อัลฟาสกัด',count:1,offers:[{offerRef:'O1',name:'อัลฟาสกัด',vendor:'ผ1',tierLabel:'1 kg',price:100,priceBasisQuantity:1,priceUnit:'kg',moq:1,moqUnit:'kg',leadTimeDays:14,eligible:true,missing:[]}]},
      {key:'g2',label:'เบตาสกัด',count:1,offers:[{offerRef:'O2',name:'เบตาสกัด',vendor:'ผ2',tierLabel:'1 kg',price:200,priceBasisQuantity:1,priceUnit:'kg',moq:1,moqUnit:'kg',leadTimeDays:14,eligible:true,missing:[]}]}],
    view:{},inputs:{sellingUnits:1000,unitsPerPack:1,fillAmount:1,fillUnit:'g'},
    lines:[{id:'L1',alias:'สารหนึ่ง',amount:100,unit:'g',lossPercent:0}],capabilities:{editRM:true}})};`);
  const panelBefore=c.panel.innerHTML;
  c.costSearchChanged('เบตา');
  assert.equal(c.panel.innerHTML,panelBefore,'แผงทั้งหน้าต้องไม่ถูกวาดทับ');
  assert.notEqual(body.innerHTML,'เดิม','เนื้อตารางต้องถูกวาดใหม่');
  assert.ok(body.innerHTML.includes('เบตาสกัด'),'ผลที่ตรงต้องอยู่');
  assert.ok(!body.innerHTML.includes('อัลฟาสกัด'),'ตัวกรองต้องตัดที่ไม่ตรงออกจริง');
  assert.equal(c.run('costState.edits.costAmount0'),'250','ค่าที่กำลังกรอกต้องไม่หายเพราะไปพิมพ์ในช่องค้นหา');
  assert.equal(c.run('costState.edits.costSellingUnits'),'5000');
  assert.equal(c.run('costState.search'),'เบตา');
});
test('ยังไม่มีข้อมูลหรือยังไม่มีตาราง ต้องกลับไปวาดทั้งแผงตามเดิม',()=>{
  const c=fixture();
  c.run('costState.response=null;');
  c.costSearchChanged('อะไรก็ได้');
  assert.equal(c.run('costState.search'),'อะไรก็ได้','ต้องไม่ล้มเมื่อยังไม่มีข้อมูล');
});

test('รายการค้างถูกจัดกลุ่มตามคนที่ต้องลงมือ ไม่กองรวมกัน',()=>{
  const c=fixture();
  const groups=c.run(`costPendingGroups(${JSON.stringify([
    'รอกำหนดราคา','RM 1: รอข้อมูลหรือยืนยันเงื่อนไข','PK: รอยืนยันหรือรอเวอร์ชันที่ตรงเงื่อนไข',
    'ปริมาณ RM ในสูตรยังไม่ตรงกับขนาดบรรจุ','ฝ่ายผลิตและผู้ดูแลต้นทุนยังไม่ได้ยืนยันขั้นตอนผลิตและอัตราค่าดำเนินการ'])})`);
  const own=groups.map(g=>g.owner);
  assert.equal(own[0],'คุณทำต่อได้เลย','สิ่งที่ RD แก้เองได้ต้องอยู่บนสุด');
  assert.equal(groups[0].items.length,2);
  assert.ok(own.includes('รอ PU-PK')&&own.includes('รอผู้ดูแลด้านราคา (Finance หรือ CEO)'));
  assert.equal(groups.reduce((a,g)=>a+g.items.length,0),5,'ต้องไม่มีรายการไหนหายไป');
});
test('ทุกข้อความค้างที่เครื่องคำนวณสร้างได้ ต้องมีเจ้าของ ไม่ตกลงถังรวม',()=>{
  // ถ้ามีคนเพิ่มข้อความใหม่ในเครื่องคำนวณแล้วลืมระบุเจ้าของ เทสต์นี้จะจับได้ทันที
  const core=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8')
    .match(/\/\/ COST_CALCULATOR_CORE_START([\s\S]*?)\/\/ COST_CALCULATOR_CORE_END/)[1];
  const literals=[...core.matchAll(/pending\.push\(\s*(?:[^)]*?\?\s*)?'([^']{6,})'/g)].map(m=>m[1]);
  assert.ok(literals.length>=8,'ต้องอ่านข้อความออกได้จริง พบ '+literals.length);
  const c=fixture();
  const orphan=literals.filter(t=>c.run(`costPendingOwner(${JSON.stringify(t)})`)==='รอตรวจสอบ');
  assert.deepEqual(orphan,[],'ข้อความที่ยังไม่มีเจ้าของ: '+orphan.join(' | '));
  assert.equal(c.run(`costPendingOwner('ข้อความที่ไม่เคยมีมาก่อน')`),'รอตรวจสอบ',
    'ข้อความที่ไม่รู้จักต้องยังแสดง ไม่ใช่หายเงียบ');
});

test('หน้าที่วาดออกมาเรียงตามลำดับการทำงานจริง และรายการค้างแสดงเจ้าของ',async()=>{
  const c=fixture();
  const r=c.response();
  r.view.pending=['RM 1: รอข้อมูลหรือยืนยันเงื่อนไข','PK: รอยืนยันหรือรอเวอร์ชันที่ตรงเงื่อนไข'];
  r.catalog=[{offerRef:'O1',name:'อัลฟาสกัด',vendor:'ผ1',tierLabel:'1 kg',price:100,
    priceBasisQuantity:1,priceUnit:'kg',moq:1,moqUnit:'kg',leadTimeDays:14,eligible:true,missing:[]}];
  c.window.__costTestRequest=()=>r;
  await c.openCostCalculator('A00001');
  const html=c.panel.innerHTML;
  // ยังไม่ได้ค้นหาก็ยังไม่มี RM ที่เลือก ตารางค้นหาจึงต้องมาก่อน
  // ถ้าสลับกัน RD ต้องเลื่อนลงไปหาแล้วเลื่อนกลับขึ้นมาบันทึกทุกรายการ
  const search=html.indexOf('ค้นหาและเทียบ RM'),selected=html.indexOf('RM ที่เลือก');
  const save=html.indexOf('บันทึก revision');
  assert.ok(search>=0&&selected>=0&&save>=0,'ต้องมีครบทั้งสามส่วน');
  assert.ok(search<selected,'ตารางค้นหาต้องอยู่เหนือ RM ที่เลือก');
  assert.ok(selected<save,'ปุ่มบันทึกต้องอยู่ท้ายสุดของกลุ่ม ไม่ใช่ก่อนตารางที่ต้องกรอก');
  assert.ok(html.includes('คุณทำต่อได้เลย'),'รายการที่ RD แก้เองได้ต้องมีหัวข้อกำกับ');
  assert.ok(html.includes('รอ PU-PK'),'รายการที่ต้องรอคนอื่นต้องบอกว่ารอใคร');
  assert.ok(html.indexOf('คุณทำต่อได้เลย')<html.indexOf('รอ PU-PK'),'สิ่งที่ทำเองได้ต้องอยู่บนสุด');
});

// ---- E2 เมนูและ dashboard ----
test('เมนู Cost Calculation เปิดเฉพาะเมื่อชั้นข้อมูลบอกว่าเปิดได้ และปิดไว้เมื่อไม่มีชั้นข้อมูล',()=>{
  const c=fixture();
  assert.equal(c.costMenuAllowed(),false,'ไม่มี costCapabilities = ปิด');
  c.run('var costCapabilities=()=>({open:true,editRM:true});');
  assert.equal(c.costMenuAllowed(),true);
  c.run('costCapabilities=()=>({open:false});');assert.equal(c.costMenuAllowed(),false);
  c.run('costCapabilities=()=>({open:true});');c.impersonator='ใครสักคน';assert.equal(c.costMenuAllowed(),false,'สวมบทบาทอยู่ห้ามเปิด');
  c.impersonator=null;c.currentUser='';assert.equal(c.costMenuAllowed(),false,'ยังไม่ login');
});
test('dashboard วาด 9 คอลัมน์ กรองได้ และค้นหาวาดใหม่เฉพาะเนื้อตาราง',()=>{
  const c=fixture();
  const view={innerHTML:'',classList:{contains:()=>true,add(){},remove(){}}};c.elements.costDashView=view;
  c.run(`var costCapabilities=()=>({open:true,editRM:true});
    var costDashboardRows=()=>[
      {id:'CJ-000001',projectId:'A00001',customer:'ลูกค้า ก',brand:'GLOW',form:'แคปซูล',closed:false,recordMissing:false,owner:'RD-ก',status:'ready',revisions:3,updatedAt:'2026-09-07T10:00:00Z',updatedBy:'RD-ก',pricePerUnit:4.12},
      {id:'CJ-000002',projectId:null,title:'งานลอย',customer:'',brand:'',form:'ซอง',closed:false,recordMissing:false,owner:'RD-ข',status:'draft',revisions:1,updatedAt:'2026-09-06T10:00:00Z',updatedBy:'RD-ข',pricePerUnit:null},
      {id:'CJ-000003',projectId:'A00009',customer:'ลูกค้า ค',brand:'X',form:'เม็ด',closed:true,recordMissing:false,owner:'RD-ก',status:'pk',revisions:2,updatedAt:'2026-09-05T10:00:00Z',updatedBy:'RD-ค',pricePerUnit:null}];`);
  c.renderCostDashboard();
  const html=view.innerHTML;
  for(const h of ['รหัส','ลูกค้า / แบรนด์','รูปแบบ','สถานะใบงาน','สถานะต้นทุน','แก้ล่าสุด','เจ้าของสูตร','Rev','ราคา/หน่วย'])assert.ok(html.includes('<th>'+h+'</th>'),'ขาดคอลัมน์ '+h);
  assert.ok(html.includes('4.12')&&html.includes('เปิดงาน')&&html.includes('ปิดงานแล้ว')&&html.includes('งานลอย')&&html.includes('รอ PK'));
  assert.ok(html.includes(`openCostCalculator('A00001')`),'แถวที่ผูกแล้วต้องเปิดได้');
  const floatRow=html.match(/<tr[^>]*data-job="CJ-000002"[^>]*>/)[0];
  assert.ok(floatRow.includes('cost-dash-locked')&&!floatRow.includes('onclick'),'งานลอยยังเปิดจากที่นี่ไม่ได้จนกว่าจะมี tab (E4): '+floatRow);
  const boundRow=html.match(/<tr[^>]*data-job="CJ-000001"[^>]*>/)[0];
  assert.ok(boundRow.includes('onclick')&&!boundRow.includes('cost-dash-locked'));
  assert.ok(html.includes('+ สร้างใบงานต้นทุน'));
  const body={innerHTML:'x'};c.elements.costDashBody=body;
  view.innerHTML='ไม่ควรถูกแตะ';
  c.costDashSearchChanged('GLOW');
  assert.equal(view.innerHTML,'ไม่ควรถูกแตะ','พิมพ์ค้นหาต้องไม่วาดทั้งหน้า');
  assert.ok(body.innerHTML.includes('CJ-000001')&&!body.innerHTML.includes('CJ-000002'),'กรองด้วยแบรนด์');
  c.costDashSearchChanged('RD-ข');assert.ok(body.innerHTML.includes('CJ-000002')&&!body.innerHTML.includes('CJ-000001'),'กรองด้วยเจ้าของสูตร');
  c.costDashSearchChanged('ไม่มี');assert.ok(body.innerHTML.includes('ไม่พบใบงาน'));
  c.run('costCapabilities=()=>({open:true,editRM:false});');c.renderCostDashboard();
  assert.ok(!view.innerHTML.includes('4.12')&&!view.innerHTML.includes('สร้างใบงานต้นทุน'),'ไม่มีสิทธิ์แก้สูตร = ไม่มีราคาและปุ่มสร้าง');
  c.run('costCapabilities=()=>({open:false});');c.renderCostDashboard();assert.equal(view.innerHTML,'','ไม่มีสิทธิ์ต้องว่างเปล่า');
});
