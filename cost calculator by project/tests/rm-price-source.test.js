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
