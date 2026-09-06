'use strict';
// ตัวอ่านตารางราคา RM ต้นฉบับ — ข้อมูลทดสอบเป็นค่าสังเคราะห์ที่มีรูปทรงเดียวกับต้นฉบับ
// ไม่มีชื่อสาร ชื่อผู้ขาย หรือราคาจริงถูกคัดลอกมา
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ctx={};vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../apps_script/RmPriceSource.gs'),'utf8'),ctx);
const P=ctx.RmPriceSource;
const row=(name,supplier,price,moq,extra)=>Object.assign({Name:name,Supplier:supplier,'Price/kg':price,MOQ:moq,Remark:'',Function:''},extra||{});
const opts={priceValidDays:90,asOf:'2026-09-06'};

test('ตัวตนวัสดุคงที่ข้ามการนำเข้าแต่ละรอบ และไม่ขึ้นกับรูปแบบการเขียน',()=>{
  const a=P.materialKey('ผู้ขาย ก.','สารทดสอบ (Powder)');
  assert.equal(a,P.materialKey('ผู้ขาย ก.','สารทดสอบ (Powder)'),'เรียกซ้ำต้องได้ค่าเดิม');
  assert.equal(a,P.materialKey('  ผู้ขาย ก.  ','สารทดสอบ  (Powder)'),'ช่องว่างเกินต้องไม่เปลี่ยนตัวตน');
  assert.notEqual(a,P.materialKey('ผู้ขาย ข.','สารทดสอบ (Powder)'),'คนละผู้ขายต้องคนละตัวตน');
  assert.notEqual(a,P.materialKey('ผู้ขาย ก.','สารทดสอบ 95%'),'ความเข้มข้นต่างต้องคนละตัวตน');
  assert.match(a,/^RMS-[0-9A-Z]+$/);
});
test('อ่านราคาได้ทุกรูปแบบที่พบจริง และปฏิเสธที่ไม่ใช่ราคา',()=>{
  for(const [raw,want] of [['1250',1250],['1250.5',1250.5],['1,250',1250],['1250/kg',1250],
    ['1250 thb/kg',1250],['1250 baht',1250],['THB 1250',1250],['1250/Kg',1250]])
    assert.equal(P.priceOf(raw),want,raw);
  for(const raw of ['','ราคาโทรถาม','-1250','0','1250/ลัง','abc'])
    assert.equal(P.priceOf(raw),null,raw);
});
test('MOQ ที่เป็นช่วงใช้ขอบล่างและถูกทำเครื่องหมายไว้',()=>{
  const r=P.moqOf('1-10 kg');
  assert.equal(r.quantity,1,'MOQ คือปริมาณต่ำสุดที่สั่งได้');
  assert.equal(r.rangeUpper,10);
  assert.equal(r.fromRange,true,'ต้องทำเครื่องหมายไว้ให้ Procurement ยืนยัน');
  assert.equal(P.moqOf('1-10Kg').quantity,1);
  assert.equal(P.moqOf('5 kg').fromRange,undefined,'ค่าปกติต้องไม่ถูกทำเครื่องหมาย');
});
test('MOQ ที่ไม่มีหน่วยถือเป็นกิโลกรัมและถูกทำเครื่องหมาย ส่วนหน่วยที่ไม่ใช่น้ำหนักถูกปฏิเสธ',()=>{
  const bare=P.moqOf('25');
  assert.equal(bare.quantity,25);assert.equal(bare.unit,'kg');assert.equal(bare.assumedUnit,true);
  assert.equal(P.moqOf('500 g').unit,'g');
  for(const raw of ['1 ลัง','2 ชิ้น','1 pack','','ตามตกลง'])
    assert.equal(P.moqOf(raw),null,raw);
  assert.equal(P.moqOf('MOQ 5 kg').quantity,5,'คำนำหน้า MOQ ต้องไม่ทำให้อ่านไม่ได้');
  assert.equal(P.moqOf('Repack MOQ 5 kg').quantity,5);
});
test('แถวที่ ชื่อ+ผู้ขาย เดียวกันแต่ MOQ ต่างกัน กลายเป็น Tier ของวัสดุเดียวกัน',()=>{
  const r=P.build([row('สาร ก.','ผู้ขาย 1','1000','1 kg'),
    row('สาร ก.','ผู้ขาย 1','700','25 kg'),
    row('สาร ก.','ผู้ขาย 2','900','1 kg')],[],opts);
  assert.equal(r.summary.materials,2,'คนละผู้ขาย = คนละวัสดุ');
  assert.equal(r.summary.offers,3);
  const same=r.offers.filter(o=>o.vendor==='ผู้ขาย 1');
  assert.equal(same.length,2);
  assert.equal(same[0].materialId,same[1].materialId,'Tier ของวัสดุเดียวกันต้องใช้ตัวตนเดียวกัน');
  assert.equal(same.map(o=>o.tierId).join(','),'1 kg,25 kg','ชื่อ Tier ผูกกับ MOQ ไม่ใช่ลำดับ');
  assert.equal(same[0].moq,1,'Tier เรียงตาม MOQ จากน้อยไปมาก');
  assert.equal(same[1].moq,25);
});
test('ลำดับแถวในไฟล์ไม่เปลี่ยนหมายเลข Tier',()=>{
  const asc=P.build([row('สาร ก.','ผู้ขาย 1','1000','1 kg'),row('สาร ก.','ผู้ขาย 1','700','25 kg')],[],opts);
  const desc=P.build([row('สาร ก.','ผู้ขาย 1','700','25 kg'),row('สาร ก.','ผู้ขาย 1','1000','1 kg')],[],opts);
  assert.equal(JSON.stringify(asc.offers.map(o=>[o.tierId,o.moq,o.price])),
               JSON.stringify(desc.offers.map(o=>[o.tierId,o.moq,o.price])),
               'สลับลำดับแถวแล้ว Tier ต้องเหมือนเดิม');
});
test('ค่าที่ระบบเติมให้เองต้องถูกทำเครื่องหมายทุกครั้ง ไม่เติมเงียบ',()=>{
  const r=P.build([row('สาร ก.','ผู้ขาย 1','1000','1-10 kg')],[],opts);
  const o=r.offers[0];
  // ขนาดสั่งเพิ่มคือขนาดบรรจุ ซึ่งคนละเรื่องกับ MOQ และต้นฉบับไม่มี จึงต้องไม่เดา
  assert.equal(o.increment,null,'ห้ามเติมขนาดสั่งเพิ่มให้เท่ากับ MOQ');
  assert.equal(o.maxOrderQuantity,10,'ขอบบนของช่วงต้องถูกเก็บไว้ ไม่ทิ้ง');
  assert.ok(o.notes.includes('MOQ_FROM_RANGE'));
  assert.ok(o.notes.includes('VALIDITY_FROM_POLICY'));
  assert.equal(o.validUntil,'2026-12-05','90 วันนับจากวันนำเข้า');
});
test('ไม่มีนโยบายอายุราคา ต้องไม่กำหนดวันหมดอายุให้เอง',()=>{
  const r=P.build([row('สาร ก.','ผู้ขาย 1','1000','1 kg')],[],{});
  assert.equal(r.offers[0].validUntil,'','ค่าว่างแปลว่ายังไม่มีข้อมูล ไม่ใช่ไม่มีวันหมดอายุ');
  assert.ok(!r.offers[0].notes.includes('VALIDITY_FROM_POLICY'));
});
test('Lead Time และการรับรอง spec ต้องเป็น null เพราะต้นฉบับไม่มี',()=>{
  const o=P.build([row('สาร ก.','ผู้ขาย 1','1000','1 kg')],[],opts).offers[0];
  assert.equal(o.leadTimeDays,null);
  assert.equal(o.specApproved,null,'ต้องไม่เป็น false ซึ่งแปลว่าตรวจแล้วไม่ผ่าน');
  assert.equal(o.status,'review','ยังไม่ผ่านการยืนยันจึงยังใช้คิดต้นทุนไม่ได้');
});
test('RD-Code ถูกแนบเมื่อจับคู่ชื่อได้ และเป็น null เมื่อจับไม่ได้',()=>{
  const codes=[{'RD-Code':'BY-X-001','Ingredients Name':'สาร ก.'}];
  const r=P.build([row('สาร ก.','ผู้ขาย 1','1000','1 kg'),row('สาร ข.','ผู้ขาย 1','800','1 kg')],codes,opts);
  assert.equal(r.offers.find(o=>o.name==='สาร ก.').rdCode,'BY-X-001');
  assert.equal(r.offers.find(o=>o.name==='สาร ข.').rdCode,null,'จับไม่ได้ต้องเป็น null ไม่ใช่เดา');
  assert.equal(r.summary.withRdCode,1);
});
test('แถวที่อ่านไม่ได้ถูกข้ามพร้อมเลขแถวและเหตุผล ไม่หายเงียบ',()=>{
  const r=P.build([row('สาร ก.','ผู้ขาย 1','','1 kg'),
    row('สาร ข.','ผู้ขาย 1','ราคาโทรถาม','1 kg'),
    row('สาร ค.','ผู้ขาย 1','1000','1 ลัง'),
    row('','','','')],[],opts);
  assert.equal(r.offers.length,0);
  assert.equal(r.skipped.length,3,'แถวว่างไม่นับเป็นข้อผิดพลาด');
  assert.equal(r.skipped.map(s=>s.row).join(','),'2,3,4');
  assert.match(r.skipped[0].reason,/ยังไม่มีราคา/);
  assert.match(r.skipped[2].reason,/หน่วยไม่ใช่น้ำหนัก/);
});
test('ข้อเสนอที่ได้ต้องเข้าเกณฑ์ของเครื่องคำนวณเมื่อเติมส่วนที่ขาดครบ',()=>{
  const o=P.build([row('สาร ก.','ผู้ขาย 1','1000','1 kg')],[],opts).offers[0];
  const core={};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8')
    .match(/\/\/ COST_CALCULATOR_CORE_START([\s\S]*?)\/\/ COST_CALCULATOR_CORE_END/)[1],core);
  const filled={...o,leadTimeDays:14,specApproved:true,status:'confirmed',scope:{type:'central'},
    increment:o.moq,incrementUnit:o.moqUnit,validUntil:'2999-01-01'};
  const s=core.CostCalculator.createScenario({projectId:'A00001',scenarioId:'S1',revision:1,currency:'THB',
    sellingUnits:1000,unitsPerPack:1,fillAmount:1,fillUnit:'g',pkSpecVersion:null,pkNotApplicable:true,
    rmLines:[{id:'L1',materialId:filled.materialId,alias:'x',amount:1,unit:'g',lossPercent:0,offer:filled}],
    operation:{mode:'standardRateOnly'},extraCosts:[],extrasReviewed:true,policies:{},pk:null});
  const calc=core.CostCalculator.calculate(s,'2026-09-06');
  assert.equal(calc.rm.baseTotal,1000,'1 g x 1000 หน่วย ที่ 1000 บาท/กก.');
  assert.equal(calc.rm.ready,true);
});

// ---- ข้อบกพร่องที่ตรวจพบรอบ mutation review — ล็อกไว้ไม่ให้ย้อนกลับ ----

test('รหัสข้อเสนอไม่ชนกัน แม้ MOQ เขียนคนละหน่วยหรือเท่ากันแต่คนละราคา',()=>{
  // รหัสซ้ำหนึ่งคู่ทำให้ตัวนำเข้าปฏิเสธทั้งไฟล์ ไม่ใช่แค่แถวนั้น
  const ids=rows=>P.build(rows,[],opts).offers.map(o=>o.id);
  const sameMass=ids([row('สาร ก.','ผู้ขาย 1','1000','1 kg'),row('สาร ก.','ผู้ขาย 1','950','1000 g')]);
  assert.equal(sameMass.length,2);
  assert.notEqual(sameMass[0],sameMass[1],'1 kg กับ 1000 g เป็นคนละข้อเสนอ');
  const samePrice=ids([row('สาร ก.','ผู้ขาย 1','1000','5 kg'),row('สาร ก.','ผู้ขาย 1','1100','5 kg')]);
  assert.notEqual(samePrice[0],samePrice[1],'MOQ เท่ากันแต่ราคาต่างกันก็ยังคนละข้อเสนอ');
  const sub=ids([row('สาร ก.','ผู้ขาย 1','1000','1 mg'),row('สาร ก.','ผู้ขาย 1','900','400 mg')]);
  assert.notEqual(sub[0],sub[1],'MOQ เล็กกว่ากรัมต้องไม่ยุบเป็นค่าเดียวกัน');
});
test('รหัสข้อเสนอผูกกับเนื้อข้อเสนอ ไม่ใช่ตำแหน่งแถว',()=>{
  const a=row('สาร ก.','ผู้ขาย 1','1000','1 kg'),b=row('สาร ก.','ผู้ขาย 1','950','25 kg');
  const before=P.build([a,b],[],opts).offers;
  const after=P.build([row('สาร ข.','ผู้ขาย 9','500','1 kg'),b,a],[],opts).offers;
  const find=(list,tier)=>list.find(o=>o.tierId===tier&&o.name==='สาร ก.');
  assert.equal(find(before,'1 kg').id,find(after,'1 kg').id,'แทรกแถวหน้าไฟล์ต้องไม่เปลี่ยนรหัสเดิม');
  assert.equal(find(before,'25 kg').id,find(after,'25 kg').id);
  assert.equal(find(after,'1 kg').evidenceRef,'PriceOfRM:'+find(after,'1 kg').id,'หลักฐานต้องชี้กลับที่ข้อเสนอเดิม');
});
test('หน่วยน้ำหนักลอย ๆ ไม่ใช่ราคา และราคาที่เกินความเป็นจริงถูกปฏิเสธ',()=>{
  // คอลัมน์ MOQ ที่ไหลมาอยู่ช่องราคา เคยอ่านเป็น 25 บาท/กก. ต่ำกว่าจริงหลายสิบเท่า
  for(const raw of ['25 kg','500 g','25 กก.','1 กิโล'])
    assert.equal(P.priceOf(raw),null,raw);
  assert.equal(P.priceOf('1250/kg'),1250,'ราคาต่อกิโลที่เขียนถูกต้องยังต้องอ่านได้');
  assert.equal(P.priceOf('1250 thb/kg'),1250);
  assert.equal(P.priceOf('100000'),100000,'เพดานเป็นค่าที่ยอมรับได้ ไม่ใช่ค่าที่ถูกตัด');
  assert.equal(P.priceOf('100001'),null,'เกินเพดานต้องให้คนตรวจ ไม่เดาแทน');
  assert.equal(P.priceOf('999999999999'),null);
});
test('ความเข้มข้นที่ต่างกันเป็นคนละวัสดุ แม้ต่างกันแค่เครื่องหมายเปอร์เซ็นต์',()=>{
  assert.notEqual(P.materialKey('ผู้ขาย ก.','Acid 50%'),P.materialKey('ผู้ขาย ก.','Acid 50'),
    'ถ้าคีย์ชนกัน ราคาของตัวหลังจะกลายเป็น Tier ของตัวแรกและชื่อจริงหายไป');
});
test('MOQ ที่เป็นช่วงและไม่มีหน่วย ถูกทำเครื่องหมายว่าเดาหน่วยให้ทั้งสองอย่าง',()=>{
  const bare=P.moqOf('1-10');
  assert.equal(bare.unit,'kg');
  assert.equal(bare.assumedUnit,true,'เดาหน่วยให้แล้วต้องบอก ไม่ว่าจะเป็นช่วงหรือค่าเดี่ยว');
  assert.equal(bare.rangeUpper,10);
  assert.equal(P.moqOf('1-10 kg').assumedUnit,undefined,'ระบุหน่วยมาเองต้องไม่ถูกทำเครื่องหมาย');
  const notes=P.build([row('สาร ก.','ผู้ขาย 1','1000','1-10')],[],opts).offers[0].notes;
  assert.ok(notes.includes('MOQ_FROM_RANGE')&&notes.includes('MOQ_UNIT_ASSUMED_KG'),
    'ต้องติดทั้งสองเหตุผลถึงมือ Procurement: '+notes.join(','));
});
test('MOQ ศูนย์อ่านไม่ได้ ไม่ใช่สั่งเท่าไรก็ได้',()=>{
  assert.equal(P.moqOf('0'),null);
  assert.equal(P.moqOf('0 kg'),null);
  assert.equal(P.moqOf('0-10 kg'),null,'ขอบล่างศูนย์ทำให้ช่วงไม่มีความหมาย');
  assert.equal(P.moqOf('0.5 kg').quantity,0.5,'ค่าที่น้อยแต่มากกว่าศูนย์ยังใช้ได้');
});
test('Tier เรียงตามน้ำหนักจริง ไม่ใช่ตัวเลขที่พิมพ์',()=>{
  const t=P.build([row('สาร ก.','ผู้ขาย 1','3','25 kg'),row('สาร ก.','ผู้ขาย 1','1','500 g'),
    row('สาร ก.','ผู้ขาย 1','2','1 kg')],[],opts).offers.map(o=>o.tierId);
  assert.equal(t.join(' → '),'500 g → 1 kg → 25 kg','500 g เบากว่า 1 kg แม้ตัวเลขจะมากกว่า');
});
test('แถวที่มีราคาแต่ไม่มีชื่อสาร ถูกนับไว้ ไม่หายเงียบ',()=>{
  const r=P.build([row('','ผู้ขาย 1','1000','1 kg'),row('','','',''),
    row('สาร ก.','ผู้ขาย 1','1000','1 kg')],[],opts);
  assert.equal(r.offers.length,1);
  assert.equal(r.skipped.length,1,'แถวว่างสนิทไม่นับ แต่แถวที่มีราคาต้องนับ');
  assert.equal(r.skipped[0].row,2);
  assert.match(r.skipped[0].reason,/ไม่มีชื่อ/);
  assert.equal(r.summary.offers+r.summary.skipped,2,'ยอดต้องกระทบยอดกับแถวที่มีเนื้อหาได้');
});
test('นโยบายอายุราคาที่ใช้ไม่ได้ ต้องไม่ล้มการนำเข้าและไม่อ้างว่าใช้นโยบายแล้ว',()=>{
  for(const bad of [{priceValidDays:'ninety',asOf:'2026-09-06'},{priceValidDays:90,asOf:'ไม่ทราบ'},
    {priceValidDays:0,asOf:'2026-09-06'},{priceValidDays:90,asOf:'2026-13-45'}]){
    const o=P.build([row('สาร ก.','ผู้ขาย 1','1000','1 kg')],[],bad).offers[0];
    assert.equal(o.validUntil,'',JSON.stringify(bad));
    assert.ok(!o.notes.includes('VALIDITY_FROM_POLICY'),'ไม่มีวันหมดอายุ ห้ามติดป้ายว่ามี: '+JSON.stringify(bad));
  }
  const good=P.build([row('สาร ก.','ผู้ขาย 1','1000','1 kg')],[],opts).offers[0];
  assert.equal(good.validUntil,'2026-12-05','นโยบายที่ใช้ได้ยังต้องทำงานเหมือนเดิม');
});
test('MOQ ต่างหน่วยแปลงเป็นน้ำหนักเดียวกันได้ถูกต้อง',()=>{
  // ผิดพลาดพันเท่าตรงนี้ทำให้ Procurement สั่งของผิดขนาดโดยไม่มีอะไรเตือน
  const o=P.build([row('สาร ก.','ผู้ขาย 1','1000','2000 g'),row('สาร ข.','ผู้ขาย 1','1000','2 kg'),
    row('สาร ค.','ผู้ขาย 1','1000','500 mg')],[],opts).offers;
  assert.equal(o.map(x=>x.moq+' '+x.moqUnit).join(','),'2000 g,2 kg,500 mg','เก็บค่าตามที่ผู้ขายเขียน');
  const ug=id=>Number(id.match(/-(\d+)UG-/)[1]);
  assert.equal(ug(o[0].id),ug(o[1].id),'2000 g กับ 2 kg เป็นน้ำหนักเดียวกัน');
  assert.equal(ug(o[0].id)/ug(o[2].id),4000,'2 kg เป็น 4000 เท่าของ 500 mg');
});
