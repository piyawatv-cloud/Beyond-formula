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
  assert.ok(floatRow.includes(`openCostCalculator('CJ-000002')`)&&!floatRow.includes('cost-dash-locked'),'งานลอยเปิดด้วยรหัสของตัวเอง (E3): '+floatRow);
  const boundRow=html.match(/<tr[^>]*data-job="CJ-000001"[^>]*>/)[0];
  assert.ok(boundRow.includes(`openCostCalculator('A00001')`)&&!boundRow.includes('cost-dash-locked'));
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

// ---- E3 หน้าสร้างใบงาน และกล่องผูก ----
test('หน้าสร้างแสดงเฉพาะใบงาน Formula ที่ยังไม่มีใบงานต้นทุน และเปิดได้เฉพาะผู้แก้สูตร',()=>{
  const c=fixture();
  const view={innerHTML:'',classList:{contains:()=>true,add(){},remove(){}}};c.elements.costDashView=view;
  c.records=[{id:'A00001',customer:'ลูกค้า ก',brand:'GLOW',createdBy:'x'},{id:'A00002',customer:'ลูกค้า ข',brand:'VITA',createdBy:'x'},{id:'A00003',customer:'ปิดแล้ว',closed:{by:'x'},createdBy:'x'}];
  c.run(`var costCapabilities=()=>({open:true,editRM:true});var costJobs=()=>[{id:'CJ-000001',projectId:'A00001',owner:'RD-ก'}];
    var costJobByProject=id=>id==='A00001'?{id:'CJ-000001'}:null;var costFormatList=()=>[{label:'แคปซูล'},{label:'ซอง'}];`);
  c.costOpenCreate();
  assert.ok(view.innerHTML.includes('A00002')&&view.innerHTML.includes('A00003'),'ใบที่ยังไม่มีใบงานต้นทุนต้องอยู่');
  assert.ok(!view.innerHTML.includes('value="A00001"'),'ใบที่มีใบงานต้นทุนแล้วต้องไม่อยู่ในรายการอ้างอิง');
  assert.ok(view.innerHTML.includes('ปิดงานแล้ว'),'ใบที่ปิดแล้วยังอ้างอิงได้แต่ต้องบอก');
  c.costCreateMode('float');assert.ok(view.innerHTML.includes('costCreateTitle')&&view.innerHTML.includes('แคปซูล'),'งานลอยมีชื่อและรูปแบบให้เลือก');
  c.costCreateMode('clone');assert.ok(view.innerHTML.includes('CJ-000001')&&view.innerHTML.includes('ราคาที่หมดอายุแล้วจะขึ้น'),'โคลนต้องเตือนเรื่องราคาเก่า');
  c.run('costCapabilities=()=>({open:true,editRM:false});');view.innerHTML='เดิม';let alerted='';c.alert=m=>{alerted=m;};
  c.costOpenCreate();assert.equal(view.innerHTML,'เดิม');assert.match(alerted,/RD และ Admin/);
});
test('กล่องผูกโผล่เฉพาะงานลอยของผู้แก้สูตร และไม่เสนอใบงานที่มีใบงานต้นทุนแล้ว',()=>{
  const c=fixture();
  c.records=[{id:'A00001',customer:'ก',createdBy:'x'},{id:'A00002',customer:'ข',createdBy:'x'}];
  c.run(`var costJobByProject=id=>id==='A00001'?{id:'CJ-000001'}:null;`);
  const floating={job:{id:'CJ-000007',bound:false,projectId:null,title:'ทดลอง'},capabilities:{editRM:true}};
  const html=c.costBindBox(floating);
  assert.ok(html.includes('CJ-000007')&&html.includes('ทดลอง')&&html.includes('value="A00002"')&&!html.includes('value="A00001"'));
  assert.equal(c.costBindBox({job:{id:'CJ-000001',bound:true,projectId:'A00001'},capabilities:{editRM:true}}),'','ผูกแล้วไม่ต้องมีกล่อง');
  assert.equal(c.costBindBox({...floating,capabilities:{editRM:false}}),'','PU-PK/Purchasing ผูกไม่ได้');
});

// ---- E4-01 tab ภายในแอป ----
function tabFixture(){
  const c=fixture();c.records=[{id:'A00001'},{id:'A00002'}];
  c.window.__costTestRequest=(action,p)=>{const r=c.response();r.projectId=p.projectId;r.view.projectId=p.projectId;r.job={id:'CJ-'+p.projectId.slice(1),projectId:p.projectId,bound:true};r.inputs={sellingUnits:10,unitsPerPack:1,fillAmount:1,fillUnit:'g'};return r;};
  return c;
}
test('เปิดสองใบงานได้สอง tab สลับแล้วค่าที่กรอกค้างของแต่ละ tab ไม่ปนกัน',async()=>{
  const c=tabFixture();
  await c.openCostCalculator('A00001');
  c.elements.costSellingUnits={value:'111'};        // RD พิมพ์ค้างไว้ใน tab แรก
  await c.openCostCalculator('A00002');
  assert.equal(c.run('costTabs.length'),2);
  assert.equal(c.run('costState.projectId'),'A00002');
  assert.equal(c.run("costTabFor('A00001').state.edits.costSellingUnits"),'111','ค่าที่พิมพ์ค้างต้องถูกเก็บก่อนสลับ');
  assert.ok(c.panel.innerHTML.includes('CJ-00001')&&c.panel.innerHTML.includes('CJ-00002'),'แถบ tab แสดงทั้งสองใบ');
  assert.ok(c.panel.innerHTML.includes('cost-tab-dirty'),'tab ที่มีค่าค้างต้องมีจุดบอก');
  c.elements.costSellingUnits={value:'10'};
  c.costActivateTab('A00001');
  assert.equal(c.run('costState.projectId'),'A00001');
  assert.equal(c.run('costDraftValue(\"costSellingUnits\",null)'),'111','กลับมาแล้วค่าค้างยังอยู่');
  assert.equal(c.run("costDraftDirty(costTabFor('A00002').state)"),false,'tab สองไม่ได้พิมพ์อะไร ต้องไม่ติดค่าของ tab แรก');
});
test('เปิดใบเดิมซ้ำ = สลับไป tab เดิมและอ่านซ้ำจาก store ไม่เปิดเป็น tab ใหม่',async()=>{
  const c=tabFixture();let calls=0;const inner=c.window.__costTestRequest;c.window.__costTestRequest=(a,p)=>{calls++;return inner(a,p);};
  await c.openCostCalculator('A00001');await c.openCostCalculator('A00002');await c.openCostCalculator('A00001');
  assert.equal(c.run('costTabs.length'),2);assert.equal(c.run('costState.projectId'),'A00001');assert.equal(calls,3,'เปิดซ้ำต้องอ่านซ้ำเพื่อไม่ค้างภาพเก่า');
  c.elements.costSellingUnits={value:'77'};await c.openCostCalculator('A00002');await c.openCostCalculator('A00001');
  assert.equal(c.run('costDraftValue("costSellingUnits",null)'),'77','อ่านซ้ำต้องไม่ล้างค่าที่กรอกค้าง');
});
test('ปิด tab ที่มีค่าค้างต้องยืนยัน ปฏิเสธแล้วไม่ปิด ยืนยันแล้วปิดโดยไม่บันทึกและไปที่ tab ข้างเคียง',async()=>{
  const c=tabFixture();let asked=0,requests=0;const inner=c.window.__costTestRequest;c.window.__costTestRequest=(a,p)=>{requests++;return inner(a,p);};
  await c.openCostCalculator('A00001');c.elements.costSellingUnits={value:'999'};
  await c.openCostCalculator('A00002');
  c.confirm=()=>{asked++;return false;};c.costCloseTab('A00001');
  assert.equal(asked,1);assert.equal(c.run('costTabs.length'),2,'ปฏิเสธแล้วต้องไม่ปิด');
  c.confirm=()=>{asked++;return true;};const before=requests;c.costCloseTab('A00001');
  assert.equal(c.run('costTabs.length'),1);assert.equal(requests,before,'ปิดต้องไม่ยิง save ให้เอง');
  assert.equal(c.run('costState.projectId'),'A00002','tab ที่เปิดอยู่ยังเป็นใบที่สอง');
  c.elements.costSellingUnits={value:'10'}; // DOM ปลอมยังถือค่าของ tab แรกอยู่ ต้องคืนเป็นค่าตั้งต้นของ tab สอง
  c.costCloseTab('A00002');
  assert.equal(asked,2,'tab ที่ไม่มีค่าค้างปิดได้โดยไม่ถาม');assert.equal(c.run('costTabs.length'),0);assert.equal(c.run('costState.projectId'),null);
});
test('ตัวตนเปลี่ยน (logout) ทิ้งทุก tab',async()=>{
  const c=tabFixture();await c.openCostCalculator('A00001');await c.openCostCalculator('A00002');
  c.currentUser='';c.costCheckSession();assert.equal(c.run('costTabs.length'),0);assert.equal(c.run('costState.response'),null);
});
// ---- E4-02 ใบงาน Formula ปิดแล้ว ----
test('ใบงานที่ล็อกวาดเป็นอ่านอย่างเดียว มีปุ่มโคลนเฉพาะผู้แก้สูตร',async()=>{
  const c=tabFixture();const inner=c.window.__costTestRequest;c.window.__costTestRequest=(a,p)=>{const r=inner(a,p);r.locked=true;return r;};
  await c.openCostCalculator('A00001');
  assert.ok(c.panel.innerHTML.includes('ปิดงานแล้ว · อ่านอย่างเดียว')&&c.panel.innerHTML.includes('costCloneFromView'));
  assert.ok(/id="costSellingUnits"[^>]*disabled/.test(c.panel.innerHTML),'ช่องกรอกต้องปิด');
  c.window.__costTestRequest=(a,p)=>{const r=inner(a,p);r.locked=true;r.capabilities.editRM=false;return r;};
  await c.openCostCalculator('A00002');
  assert.ok(!c.panel.innerHTML.includes('costCloneFromView'),'ไม่มีสิทธิ์แก้สูตร = ไม่มีปุ่มโคลน');
});

test('ผูกจากหน้าเครื่องคำนวณ: มี draft ค้างต้องปฏิเสธ · ผูกแล้ว tab คีย์เดิมถูกเกษียณ เหลือ tab เดียวของใบนั้น',async()=>{
  const c=tabFixture();
  const inner=c.window.__costTestRequest;
  c.window.__costTestRequest=(a,p)=>{const r=inner(a,p);if(p.projectId==='CJ-000009'){r.job={id:'CJ-000009',projectId:null,bound:false};}return r;};
  c.run(`var costJobById=id=>id==='CJ-000009'?{id}:null;var costBindJob=(id,pid)=>({id,projectId:pid});var costJobByProject=()=>null;`);
  await c.openCostCalculator('CJ-000009');
  const msg={textContent:''};c.elements.costBindMsg=msg;c.elements.costBindSelect={value:'A00002'};
  c.elements.costSellingUnits={value:'555'};
  await c.costBindFromView();
  assert.match(msg.textContent,/บันทึก revision .* ก่อนผูก/);assert.equal(c.run('costState.projectId'),'CJ-000009','ยังไม่ผูก');
  c.elements.costSellingUnits={value:'10'};
  await c.costBindFromView();
  assert.equal(c.run('costState.projectId'),'A00002');
  assert.equal(c.run('costTabs.length'),1,'tab CJ เดิมต้องหาย เหลือ tab A00002');
  assert.equal(c.run("costTabFor('CJ-000009')"),null);
});

// ---- E6-01 หน้ากฎราคา ----
test('เมนูกฎราคาเปิดเฉพาะผู้มีอำนาจด้านราคา และหน้าวาดตารางอัตรากับตัวเลือกใบงาน',()=>{
  const c=fixture();
  assert.equal(c.costPricingMenuAllowed(),false);
  c.run(`var costCapabilities=()=>({open:false,setPricing:true});
    var costFormatList=()=>[{id:'CAP-GEL-0',label:'แคปซูล',version:2,owner:'ฝ่ายผลิต',validUntil:'2999-01-01',charges:[{label:'ค่าอัดแคป',amount:0.15}],ready:true},{id:'SACHET',label:'ซอง',version:0,owner:'',validUntil:null,charges:[{label:'ค่าบรรจุ',amount:null}],ready:false}];
    var costPricingJobs=()=>[{id:'CJ-000001',projectId:'A00001',scenarioId:'S1',owner:'RD-ก',revision:3,customer:'ลูกค้า ก',brand:'B',rule:null},{id:'CJ-000002',projectId:'A00002',scenarioId:'S1',owner:'RD-ข',revision:5,customer:'ลูกค้า ข',brand:'',rule:{version:2,allowancePercent:10,factor:2.2,owner:'Finance-ก',validUntil:'2999-01-01',decimals:6,pkMode:'notApplicable',format:{id:'CAP-GEL-0',label:'แคปซูล',version:2}}}];
    var costFormatCurrent=id=>({id,label:'แคปซูล'});`);
  assert.equal(c.costPricingMenuAllowed(),true,'Finance ที่เปิดเครื่องคำนวณไม่ได้ก็ยังเข้าหน้ากฎราคาได้');
  const view={innerHTML:'',classList:{contains:()=>true,add(){},remove(){}}};c.elements.costPricingView=view;
  c.renderCostPricing();
  assert.ok(view.innerHTML.includes('แคปซูล')&&view.innerHTML.includes('ใช้ได้')&&view.innerHTML.includes('รอกรอก'),'ตารางอัตราแสดงสถานะครบ');
  assert.ok(view.innerHTML.includes('CJ-000001 · A00001')&&view.innerHTML.includes('ยังไม่มีกฎ')&&view.innerHTML.includes('กฎ v2'));
  assert.ok(!view.innerHTML.includes('id="costAllowance"'),'ยังไม่เลือกใบงาน ไม่มีฟอร์มกฎ');
  c.costPricingJobSelect('CJ-000002');
  assert.ok(view.innerHTML.includes('id="costAllowance"')&&view.innerHTML.includes('value="2.2"')&&view.innerHTML.includes('value="10"'),'เลือกใบที่มีกฎแล้วฟอร์มเติมค่าเดิม');
  assert.ok(/id="costPkMode"[\s\S]*value="notApplicable" selected/.test(view.innerHTML));
  // บันทึกกฎเรียก recorder ด้วยค่าที่กรอก
  let got=null;c.run('var costRecordPricingRule=(p,s,input)=>{globalThis.__got={p,s,input};};');
  for(const [id,v] of [['costAllowance','12'],['costFactor','2.5'],['costRuleDecimals','4'],['costRuleOwner','Finance-ข'],['costRuleUntil','2999-12-31'],['costPkMode','separate'],['costFormatId','CAP-GEL-0']])c.elements[id]={value:v};
  c.costPricingSaveRule();got=c.run('globalThis.__got');
  assert.equal(got.p,'A00002');assert.equal(got.s,'S1');assert.equal(got.input.factor,2.5);assert.equal(got.input.allowancePercent,12);assert.equal(got.input.decimals,4);assert.equal(got.input.owner,'Finance-ข');
  assert.ok(view.innerHTML.includes('บันทึกกฎการบวกราคาของ CJ-000002'),'ต้องบอกผลบนหน้า');
  c.run('costRecordPricingRule=()=>{throw Error("ตัวคูณต้องมากกว่า 0");};');c.costPricingSaveRule();
  assert.ok(view.innerHTML.includes('ตัวคูณต้องมากกว่า 0')&&!view.innerHTML.includes('บันทึกกฎการบวกราคาของ'),'ข้อผิดพลาดต้องแทนที่ข้อความสำเร็จ');
  c.run('costCapabilities=()=>({open:true,setPricing:false});');c.renderCostPricing();assert.equal(view.innerHTML,'','ไม่มีอำนาจ = ว่าง');
});
test('เครื่องคำนวณไม่วาดส่วนตั้งกฎราคาอีก แต่ชี้ทางไปเมนูกฎราคาให้ผู้มีอำนาจ',async()=>{
  const c=fixture();const r=c.response();r.capabilities.setPricing=true;r.pricingRule={version:3,factor:2.2,allowancePercent:10};
  c.window.__costTestRequest=()=>r;await c.openCostCalculator('A00001');
  assert.ok(!c.panel.innerHTML.includes('id="costAllowance"')&&!c.panel.innerHTML.includes('costPricingSaveRates'));
  assert.ok(c.panel.innerHTML.includes('เมนู <b>กฎราคา</b>')&&c.panel.innerHTML.includes('กฎเวอร์ชัน 3'));
});

// ---- E5-01 หน้าเอกสาร ----
test('เอกสารเปิดได้เฉพาะผู้มี viewDocument อ่านอย่างเดียว และ revision ที่ไม่มีต้องบอกว่าไม่พบ ไม่แสดงอันอื่น',()=>{
  const c=fixture();
  const view={innerHTML:'',classList:{contains:()=>true,add(){},remove(){}}};c.elements.costDocView=view;
  c.run(`var costCapabilities=()=>({viewDocument:false});`);
  c.openCostDocument('CJ-000003',5);assert.equal(view.innerHTML,'','ไม่มีสิทธิ์ต้องไม่วาดอะไร');
  c.run(`costCapabilities=()=>({viewDocument:true});
    var costDocument=(id,rev)=>{if(rev!==5)throw Error('ไม่พบ revision '+rev+' ของ '+id);return {jobId:id,projectId:'A00587',revision:5,title:'',owner:'RD-ก',createdAt:'2026-09-05T09:30:00Z',createdBy:'RD-ก',sentBy:'RD-ก',sentAt:'x',customer:'ลูกค้า ก',brand:'GLOW',form:'แคปซูล',sellingUnits:5000,unitsPerPack:60,fillAmount:0.5,fillUnit:'g',productionUnits:300000,
      rm:{baseTotal:3680,adjustedTotal:4416,purchaseCash:41500,ready:true,lines:[{alias:'สาร A',name:'สารสกัดตัวอย่าง A',vendor:'ผู้ขายตัวอย่าง 1',tierId:'25 kg',price:980,priceUnit:'kg',amount:250,unit:'mg',lossPercent:2,requiredKg:76.5,purchaseKg:100,baseTotal:2450,purchaseCash:24500,ready:true}]},
      pk:{notApplicable:false,baseTotal:6200,adjustedTotal:7130,ready:true,specVersion:'v2',evidenceRef:'PK-0912',recordedBy:'PU-ก'},operation:{baseTotal:4150,adjustedTotal:4150,ready:true,format:{id:'CAP-GEL-0',label:'แคปซูล',version:3}},
      pricingRule:{version:4,allowancePercent:10,factor:2.2,owner:'Finance-ก',validUntil:'2999-01-01'},finalPerSellingUnit:4.12,finalTotal:20600,complete:true,pending:[],preVat:true};};`);
  c.openCostDocument('CJ-000003',5);
  const h=view.innerHTML;
  for(const t of ['ผู้ขายตัวอย่าง 1','25 kg','สารสกัดตัวอย่าง A','PK-0912','กฎเวอร์ชัน 4','4.12','ไม่รวม VAT','Revision 5 (คงที่)','อ่านอย่างเดียว'])assert.ok(h.includes(t),'ขาด '+t);
  assert.ok(!/<input|<select|<textarea/.test(h),'เอกสารต้องไม่มีช่องกรอก');
  c.openCostDocument('CJ-000003',6);
  assert.ok(view.innerHTML.includes('ไม่พบ revision 6')&&!view.innerHTML.includes('4.12'),'revision ที่ไม่มีต้องไม่แสดงของอันอื่น');
  assert.deepEqual({...c.costDocRoute('#costdoc=CJ-000003&revision=5')},{jobId:'CJ-000003',revision:5});
  for(const bad of ['#costdoc=A00001&revision=5','#costdoc=CJ-000003&revision=0','#costdoc=CJ-000003','#project=A00001&scenario=S1&revision=1'])assert.equal(c.costDocRoute(bad),null,bad);
});

// ---- 3b แถวค้นหาต่อบรรทัด ----
function lineFixture(){
  const c=tabFixture();
  c.window.__costTestRequest=(action,p)=>{const r=c.response();r.projectId=p.projectId;r.view.projectId=p.projectId;r.job={id:'CJ-000001',projectId:p.projectId,bound:true};
    r.inputs={sellingUnits:1000,unitsPerPack:1,fillAmount:1,fillUnit:'g'};
    r.lines=[{id:'F1',alias:'Collagen Type II',amount:null,unit:'mg',lossPercent:0,hasOffer:false,fromFormula:true},{id:'L2',alias:'Vitamin C',amount:100,unit:'mg',lossPercent:0,hasOffer:true,offerRef:'O4',offerPrice:320,offerPriceBasis:1,offerPriceUnit:'kg',tierLabel:'25 kg'}];
    r.picks=[{key:'collagen type ii',offerId:'O2',count:5}];
    r.catalogGroups=[{key:'g',label:'x',count:4,offers:[
      {offerRef:'O1',name:'BRANDX (Undenatured Collagen Type II)',vendor:'ผ1',tierLabel:'0.1 kg',pricePerKg:45000,moq:100,moqUnit:'g',leadTimeDays:21,eligible:true,missing:[],tokens:['brandx','undenatured','collagen','type','ii','คอลลาเจน']},
      {offerRef:'O2',name:'Collagen Type II Powder',vendor:'ผ5',tierLabel:'1 kg',pricePerKg:3200,moq:1,moqUnit:'kg',leadTimeDays:14,eligible:true,missing:[],tokens:['collagen','type','ii','powder','chicken','คอลลาเจน']},
      {offerRef:'O3',name:'Marine Collagen 95%',vendor:'ผ2',tierLabel:'5 kg',pricePerKg:1450,moq:5,moqUnit:'kg',leadTimeDays:10,eligible:false,missing:['การรับรอง spec'],tokens:['marine','collagen','95%','คอลลาเจน']},
      {offerRef:'O4',name:'Ascorbic Acid 99%',vendor:'ผ3',tierLabel:'25 kg',pricePerKg:320,moq:25,moqUnit:'kg',leadTimeDays:7,eligible:true,missing:[],tokens:['ascorbic','acid','99%','vitamin','c','วิตามินซี']}]}];
    return r;};
  return c;
}
test('แถวที่ยังไม่มีข้อเสนอมีช่องค้นหาของตัวเอง ค่าเริ่มต้นค้นจากชื่อสาร เรียงตามที่เคยเลือกแล้วราคา และไม่เลือกให้เอง',async()=>{
  const c=lineFixture();await c.openCostCalculator('A00001');
  const h=c.panel.innerHTML;
  assert.ok(h.includes('id="costLineSearch0"'),'แถว F1 ต้องมีช่องค้นหา');assert.ok(!h.includes('id="costLineSearch1"'),'แถวที่มีข้อเสนอแล้วไม่ต้องมี');
  const sug=h.slice(h.indexOf('id="costLineSug0"'),h.indexOf('cost-sug-foot'));
  const order=['O2','O1'].map(id=>sug.indexOf(`costAssignRef('F1','${id}')`));
  assert.ok(order[0]>=0&&order[1]>=0&&order[0]<order[1],'ตัวที่เคยเลือก 5 ครั้งต้องอยู่ก่อนแม้แพงกว่าหรือถูกกว่า');
  assert.ok(sug.includes('เคยเลือก 5 ครั้ง'));
  // ความจำต้องชนะราคา: ให้ O1 (45,000) เป็นตัวที่เคยเลือก แล้ว O1 ต้องขึ้นก่อน O2 (3,200)
  const d=lineFixture();d.window.__costTestRequest=((inner)=>(a,p)=>{const r=inner(a,p);r.picks=[{key:'collagen type ii',offerId:'O1',count:2}];return r;})(d.window.__costTestRequest);
  await d.openCostCalculator('A00001');const h2=d.panel.innerHTML,sug2=h2.slice(h2.indexOf('id="costLineSug0"'),h2.indexOf('cost-sug-foot'));
  assert.ok(sug2.indexOf(`costAssignRef('F1','O1')`)<sug2.indexOf(`costAssignRef('F1','O2')`),'ตัวที่เคยเลือกต้องขึ้นก่อนแม้แพงกว่า 14 เท่า');
  assert.ok(!sug.includes('O3'),'Marine Collagen ไม่มีคำว่า type จึงไม่ตรงกับชื่อในสูตรทั้งสามคำ');
  assert.ok(!sug.includes('O4'),'วิตามินซีไม่ตรงกับ Collagen');
  assert.ok(h.includes('ระบบไม่เลือกให้ กดเองเสมอ'));
});
test('พิมพ์ในช่องค้นหาของแถว: ทุกคำต้องเจอไม่สนลำดับ พิมพ์ไทยได้ วาดใหม่เฉพาะกล่องตัวเลือก และกดเลือกยิง assignRM',async()=>{
  const c=lineFixture();await c.openCostCalculator('A00001');
  const box={innerHTML:''};c.elements.costLineSug0=box;
  const before=c.panel.innerHTML;
  c.costLineSearchChanged('F1',0,'type ii collagen');
  assert.equal(c.panel.innerHTML,before,'ทั้งแผงต้องไม่ถูกวาดใหม่');
  assert.ok(box.innerHTML.includes('O1')&&box.innerHTML.includes('O2')&&!box.innerHTML.includes('O3'),'สลับคำก็เจอ · marine ไม่มี type');
  c.costLineSearchChanged('F1',0,'คอลลาเจน');
  assert.ok(box.innerHTML.includes('O1')&&box.innerHTML.includes('O3'),'พิมพ์ไทยผ่าน keywords');
  assert.ok(/costAssignRef\('F1','O3'\)"[^>]*>ใช้ไม่ได้/.test(box.innerHTML)&&/disabled onclick="costAssignRef\('F1','O3'\)/.test(box.innerHTML),'ตัวที่ขาด spec แสดงแต่กดไม่ได้');
  c.costLineSearchChanged('F1',0,'ไม่มีแน่');assert.ok(box.innerHTML.includes('ไม่พบข้อเสนอที่ตรง'));
  let sent=null;c.window.__costTestRequest=(a,p)=>{sent={a,p};const r=c.response();r.projectId=p.projectId;r.view.projectId=p.projectId;return r;};
  await c.costAssignRef('F1','O3');assert.equal(sent,null,'ตัวที่ใช้ไม่ได้ต้องไม่ยิง');
  await c.costAssignRef('F1','O2');assert.equal(sent.a,'assignRM');assert.equal(sent.p.lineId,'F1');assert.equal(sent.p.offerRef,'O2');
});
test('ราคาต่อหน่วยผลิตขึ้นทันทีที่พิมพ์ปริมาณ สำหรับแถวที่มีข้อเสนอ',async()=>{
  const c=lineFixture();await c.openCostCalculator('A00001');
  const out={textContent:''};c.elements.costLineUnit1=out;c.elements.costAmount1={value:'250'};c.elements.costFormulaPreview={innerHTML:''};
  c.costUpdateFormulaPreview();
  assert.match(out.textContent,/0\.08 บาท\/หน่วยผลิต/,'250 mg × 320 บาท/kg = 0.08: '+out.textContent);
  c.elements.costAmount1={value:''};c.costUpdateFormulaPreview();assert.equal(out.textContent,'','ไม่มีปริมาณ = ไม่มีตัวเลข');
});

// ---- หน้างานจัดซื้อ ----
test('หน้างานจัดซื้อวาดคำขอและข้อเสนอค้าง กรอกเฉพาะที่ขาด กดยืนยันเรียก recorder และข้อผิดพลาดแสดง',()=>{
  const c=fixture();
  const view={innerHTML:'',classList:{contains:()=>true,add(){},remove(){}}};c.elements.costDashView=view;
  c.run(`var costCapabilities=()=>({open:true,confirmOffer:true,closeRequest:true});
    var costProcurementView=()=>({requests:[{key:'K1',projectId:'A00001',jobId:'CJ-000001',customer:'ลูกค้า ก',brand:'B',brief:'สาร X',by:'RD-ก',at:'2026-09-08T09:00:00Z',status:'open'},{key:'K2',projectId:'A00002',jobId:null,customer:'',brand:'',brief:'สาร Y',by:'RD-ข',at:'2026-09-07T09:00:00Z',status:'done',closedBy:'จัดซื้อ',closedAt:'2026-09-08T10:00:00Z',note:'เพิ่มแล้ว'}],
      pending:[{offerRef:'P1',name:'สาร ก',vendor:'ผ1',tierId:'25 kg',price:980,priceUnit:'kg',priceBasisQuantity:1,moq:25,moqUnit:'kg',increment:null,incrementUnit:'',leadTimeDays:14,validUntil:'',specApproved:null,status:'review',notes:['MOQ_FROM_RANGE'],condition:'',sourceRow:12,missing:['ขนาดสั่งเพิ่ม','วันหมดอายุราคา'],specPending:true}]});
    var costConfirmOffer=(id,input)=>{globalThis.__c={id,input};};var costCloseRequest=(k,n)=>{globalThis.__x={k,n};};`);
  c.renderCostProcurement();
  const h=view.innerHTML;
  assert.ok(h.includes('สาร X')&&h.includes('ลูกค้า ก')&&!h.includes('สาร Y'),'คำขอที่ปิดแล้วซ่อนไว้ก่อน');
  assert.ok(h.includes('id="costProcInc-P1"')&&h.includes('id="costProcUntil-P1"')&&!h.includes('id="costProcLt-P1"'),'กรอกเฉพาะที่ขาด Lead Time มีแล้วไม่ต้องกรอก');
  assert.ok(h.includes('ชีตแถว 12')&&h.includes('รอ RD รับรอง spec')&&h.includes('MOQ_FROM_RANGE'));
  c.elements['costProcInc-P1']={value:'25'};c.elements['costProcIncUnit-P1']={value:'kg'};c.elements['costProcUntil-P1']={value:'2027-01-31'};
  c.costProcConfirm('P1');const got=c.run('globalThis.__c');
  assert.equal(got.id,'P1');assert.equal(got.input.increment,'25');assert.equal(got.input.validUntil,'2027-01-31');assert.equal(got.input.leadTimeDays,'');
  assert.ok(view.innerHTML.includes('ยืนยันเงื่อนไขซื้อแล้ว · P1'));
  c.elements['costProcNote-K1']={value:'เพิ่มในชีตแล้ว'};c.costProcClose('K1');assert.deepEqual({...c.run('globalThis.__x')},{k:'K1',n:'เพิ่มในชีตแล้ว'});
  c.run('costConfirmOffer=()=>{throw Error("ยังขาด: ขนาดสั่งเพิ่ม");};');c.costProcConfirm('P1');
  assert.ok(view.innerHTML.includes('ยังขาด: ขนาดสั่งเพิ่ม')&&!view.innerHTML.includes('ยืนยันเงื่อนไขซื้อแล้ว'));
  c.run('costProcState.showClosed=true;');c.renderCostProcurement();assert.ok(view.innerHTML.includes('สาร Y')&&view.innerHTML.includes('เพิ่มแล้ว'));
  c.run('costCapabilities=()=>({open:true});');c.renderCostProcurement();assert.equal(view.innerHTML,'','ไม่มีสิทธิ์ต้องว่าง');
});
test('ตารางแคตตาล็อกของ RD มีปุ่มรับรอง spec เฉพาะแถวที่ยังไม่รับรอง และเฉพาะผู้มีสิทธิ์',async()=>{
  const c=tabFixture();
  const inner=c.window.__costTestRequest;
  c.window.__costTestRequest=(a,p)=>{const r=inner(a,p);r.capabilities.approveSpec=true;r.catalogGroups=[{key:'g',label:'x',count:2,offers:[
    {offerRef:'O1',name:'สาร ก',vendor:'ผ1',tierLabel:'1 kg',price:100,priceBasisQuantity:1,priceUnit:'kg',moq:1,moqUnit:'kg',leadTimeDays:14,eligible:false,missing:['การรับรอง spec'],tokens:['สาร','ก']},
    {offerRef:'O2',name:'สาร ข',vendor:'ผ1',tierLabel:'1 kg',price:100,priceBasisQuantity:1,priceUnit:'kg',moq:1,moqUnit:'kg',leadTimeDays:14,eligible:true,missing:[],tokens:['สาร','ข']}]}];return r;};
  await c.openCostCalculator('A00001');
  assert.ok(c.panel.innerHTML.includes(`costApproveSpecRef('O1')`)&&!c.panel.innerHTML.includes(`costApproveSpecRef('O2')`));
  c.window.__costTestRequest=(a,p)=>{const r=inner(a,p);r.capabilities.approveSpec=false;r.catalogGroups=[{key:'g',label:'x',count:1,offers:[{offerRef:'O1',name:'สาร ก',vendor:'ผ1',tierLabel:'1 kg',price:100,priceBasisQuantity:1,priceUnit:'kg',moq:1,moqUnit:'kg',leadTimeDays:14,eligible:false,missing:['การรับรอง spec'],tokens:['สาร']}]}];return r;};
  await c.openCostCalculator('A00002');
  assert.ok(!c.panel.innerHTML.includes('costApproveSpecRef'),'ไม่มีสิทธิ์ต้องไม่มีปุ่ม');
});
