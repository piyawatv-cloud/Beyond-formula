'use strict';
// ตัวประกอบแคตตาล็อกจากตารางใน RD Data Center
// ข้อมูลทดสอบเป็นค่าสังเคราะห์ที่มีรูปทรงเดียวกับต้นทาง ไม่มีชื่อสารหรือราคาจริง
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ctx={};vm.createContext(ctx);
for(const f of ['RmSourceMap.gs','RmCatalogBuild.gs'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../apps_script/',f),'utf8'),ctx);
const B=ctx.RmCatalogBuild;
const catalog=[{'RD-Code':'RD-A-001','Ingredient Name':'สารทดสอบ ก.','Category':'A','Price Status':'READY'},
  {'RD-Code':'RD-A-002','Ingredient Name':'สารทดสอบ ข.','Category':'A','Price Status':'REVIEW — CANDIDATE'}];
const priceMap=[
  {'RD-Code':'RD-A-001','Master Ingredient':'สารทดสอบ ก.','Master Supplier':'ผู้ขาย ก.',
   'Price-source Ingredient (editable)':'สารทดสอบ ก.','Price-source Supplier (editable)':'ผู้ขาย ก.',
   'Price Tiers (Raw)':'1000 , 700','MOQ / Qty':'1 , 25','Source':'PRICE','Price Date':'2026-01-01'},
  {'RD-Code':'RD-A-002','Master Ingredient':'สารทดสอบ ข.','Master Supplier':'ผู้ขาย ข.',
   'Price-source Ingredient (editable)':'สารทดสอบ ข.','Price-source Supplier (editable)':'ผู้ขาย ข.',
   'Price Tiers (Raw)':'','MOQ / Qty':'','Source':'PRICE'}];
const offered=[{'Offered Ingredient':'สารทดสอบ ก.','Lead Time':'7-14 วัน'}];

test('อ่าน Lead Time จากข้อความอิสระโดยใช้ค่าสูงสุด ไม่ประเมินต่ำไป',()=>{
  assert.equal(B.leadTimeDays('14 วัน'),14);
  assert.equal(B.leadTimeDays('7-14 วัน'),14);
  assert.equal(B.leadTimeDays('LT 30 วัน'),30);
  assert.equal(B.leadTimeDays('ปกติมี stock แต่ถ้า stock หมดรอของ 7-14 วัน'),14);
  assert.equal(B.leadTimeDays(''),null);
  assert.equal(B.leadTimeDays('รอสอบถาม'),null,'ไม่มีตัวเลขต้องเป็น null ไม่ใช่ 0');
  assert.equal(B.leadTimeDays('9999'),null,'ค่าที่เป็นไปไม่ได้ต้องไม่ถูกรับ');
});
test('RD-Code เป็นตัวตนวัสดุ และทุก Tier ออกมาเป็นคนละข้อเสนอ',()=>{
  const r=B.build({catalog,priceMap,offered});
  assert.equal(r.offers.length,2,'สองราคา = สองข้อเสนอ ไม่ยุบ');
  assert.equal(r.offers[0].materialId,'RD-A-001');
  assert.equal(r.offers[1].materialId,'RD-A-001');
  assert.equal(r.offers.map(o=>o.price).join('|'),'1000|700','ห้ามคัดเหลือ max หรือ min');
  assert.equal(r.offers.map(o=>o.moq).join('|'),'1|25');
  assert.equal(r.offers[0].tierId,'T1');
  assert.equal(r.offers[1].tierId,'T2');
});
test('เติม Lead Time เมื่อจับคู่ชื่อได้ และเป็น null เมื่อจับไม่ได้',()=>{
  const r=B.build({catalog,priceMap,offered});
  assert.equal(r.offers[0].leadTimeDays,14);
  const r2=B.build({catalog,priceMap,offered:[]});
  assert.equal(r2.offers[0].leadTimeDays,null,'จับคู่ไม่ได้ต้องเป็น null ไม่ใช่เดา');
});
test('สารที่ยังไม่มีราคาถูกข้ามพร้อมเหตุผล ไม่หายเงียบ',()=>{
  const r=B.build({catalog,priceMap,offered});
  assert.equal(r.skipped.length,1);
  assert.equal(r.skipped[0].code,'RD-A-002');
  assert.match(r.skipped[0].reason,/ยังไม่มีราคา/);
});
test('ข้อเสนอที่ข้อมูลไม่ครบยังออกมา แต่ใช้ไม่ได้ และบอกว่าขาดอะไร',()=>{
  const r=B.build({catalog,priceMap,offered});
  const o=r.offers[0];
  assert.equal(o.usable,false,'ต้นทางยังไม่มีสามคอลัมน์นี้ จึงต้องใช้ไม่ได้');
  for(const m of ['ขนาดสั่งเพิ่ม','วันหมดอายุราคา','การรับรอง spec']) assert.ok(o.missing.includes(m),m);
  assert.ok(!o.missing.includes('ราคา'),'ราคามีแล้วต้องไม่ถูกนับว่าขาด');
});
test('สถานะราคาที่ยังไม่ READY ต้องไม่กลายเป็น confirmed',()=>{
  const pm=[{...priceMap[0],'RD-Code':'RD-A-002'}];
  const r=B.build({catalog,priceMap:pm,offered});
  assert.equal(r.offers[0].status,'review');
  assert.equal(r.offers[0].usable,false);
});
test('แถวที่ตีความไม่ชัดถูกข้ามพร้อมเหตุผล ไม่ประกอบเป็นข้อเสนอ',()=>{
  const pm=[{...priceMap[0],'MOQ / Qty':'1-10, 100','Price Tiers (Raw)':'1500 , 1300'}];
  const r=B.build({catalog,priceMap:pm,offered});
  assert.equal(r.offers.length,0);
  assert.match(r.skipped[0].reason,/MOQ_IS_A_RANGE/);
});
test('ข้อเสนอที่ประกอบแล้วต้องผ่านเกณฑ์ของเครื่องคำนวณเมื่อเติมข้อมูลครบ',()=>{
  const r=B.build({catalog,priceMap,offered});
  const filled={...r.offers[0],increment:1,incrementUnit:'kg',validUntil:'2999-01-01',specApproved:true};
  const core={};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8')
    .match(/\/\/ COST_CALCULATOR_CORE_START([\s\S]*?)\/\/ COST_CALCULATOR_CORE_END/)[1],core);
  const s=core.CostCalculator.createScenario({projectId:'A00001',scenarioId:'S1',revision:1,currency:'THB',
    sellingUnits:1000,unitsPerPack:1,fillAmount:1,fillUnit:'g',pkSpecVersion:null,pkNotApplicable:true,
    rmLines:[{id:'L1',materialId:filled.materialId,alias:'x',amount:1,unit:'g',lossPercent:0,
      offer:{...filled,scope:{type:'central'},status:'confirmed'}}],
    operation:{mode:'standardRateOnly'},extraCosts:[],extrasReviewed:true,policies:{},pk:null});
  const calc=core.CostCalculator.calculate(s,'2026-09-05');
  assert.equal(calc.rm.baseTotal,1000,'1 g x 1000 หน่วย ที่ 1000 บาท/กก. = 1000 บาท');
  assert.equal(calc.rm.ready,true,'เมื่อเติมครบต้องผ่านเกณฑ์จริง');
});
