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

const grid=rows=>{const keys=[...new Set(rows.flatMap(row=>Object.keys(row)))];return [keys,...rows.map(row=>keys.map(k=>row[k]??''))];};
const completeSource=()=>({catalog:[{...catalog[0]}],priceMap:[{...priceMap[0],'Order Increment (kg)':1,'Price Valid Until':'2999-01-01','Spec Approved':true}],offered:offered.map(row=>({...row}))});
const workbook=input=>Object.entries(input).map(([name,rows])=>({name,grid:grid(rows)}));
test('fromSheets locates headers below titles and returns all tiers with table provenance',()=>{const sheets=workbook(completeSource());sheets[0].grid.unshift(['Synthetic workbook title'],[]);const result=B.fromSheets(sheets,{asOf:'2026-09-05'});assert.equal(result.summary.usable,2);assert.equal(result.tables.catalog.headerRow,3);assert.equal(result.tables.priceMap.rowCount,1);assert.equal(result.offers.map(o=>o.tierId).join('|'),'T1|T2');});
test('fromSheets rejects ambiguous tables and duplicate column headers',()=>{const sheets=workbook(completeSource());assert.throws(()=>B.fromSheets([...sheets,{...sheets[1],name:'Another prices'}]),/AMBIGUOUS_TABLE/);const duplicate=workbook(completeSource());duplicate[1].grid[0].push('Price Valid Until');assert.throws(()=>B.fromSheets(duplicate),/AMBIGUOUS_HEADER/);const repeated=workbook(completeSource());repeated[1].grid.push([...repeated[1].grid[0]]);assert.throws(()=>B.fromSheets(repeated),/AMBIGUOUS_TABLE/);});
test('fromSheets lists incomplete identity and missing-price rows without guessing',()=>{const input=completeSource();input.priceMap.push({...priceMap[0],'RD-Code':''},{...priceMap[0],'RD-Code':'RD-NO-PRICE','Price Tiers (Raw)':'','MOQ / Qty':''});const result=B.fromSheets(workbook(input));assert.equal(result.offers.length,2);assert.equal(result.skipped.length,2);assert.match(result.skipped[0].reason,/RD-Code/);assert.match(result.skipped[1].reason,/ยังไม่มีราคา/);assert.throws(()=>B.fromSheets([{name:'unrelated',grid:[['A'],[1]]}]),/RD-Code/);});
test('added source columns carry through to actual calculator without patching offers',()=>{const core={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8').match(/\/\/ COST_CALCULATOR_CORE_START([\s\S]*?)\/\/ COST_CALCULATOR_CORE_END/)[1],core);const input=completeSource();const compute=offer=>core.CostCalculator.calculate({projectId:'A00001',scenarioId:'S1',revision:1,currency:'THB',sellingUnits:1000,unitsPerPack:1,fillAmount:1,fillUnit:'g',rmLines:[{id:'L1',materialId:offer.materialId,amount:1,unit:'g',lossPercent:0,offer}],operation:{mode:'standardRateOnly'},extraCosts:[],extrasReviewed:true,policies:{},pk:null},'2026-09-05');const good=B.fromSheets(workbook(input),{asOf:'2026-09-05'});assert.equal(good.summary.usable,2);assert.equal(compute(good.offers[0]).rm.ready,true);assert.equal(compute(good.offers[0]).rm.baseTotal,1000);for(const patch of [{'Order Increment (kg)':''},{'Spec Approved':''},{'Spec Approved':false},{'Price Valid Until':''},{'Price Valid Until':'2020-01-01'},{'Price Valid Until':'2026-02-31'}]){const bad=completeSource();Object.assign(bad.priceMap[0],patch);const result=B.fromSheets(workbook(bad),{asOf:'2026-09-05'});assert.equal(result.offers.length,2);assert.equal(result.summary.usable,0);assert.equal(compute(result.offers[0]).rm.ready,false,JSON.stringify(patch));}});
test('order increment column explicitly remains kg when the MOQ is grams',()=>{const input=completeSource();input.priceMap[0]['MOQ / Qty']='100 g';input.priceMap[0]['Price Tiers (Raw)']='1000';const result=B.build(input,{asOf:'2026-09-05'});assert.equal(result.offers[0].moqUnit,'g');assert.equal(result.offers[0].incrementUnit,'kg');assert.equal(result.offers[0].increment,1);});
test('source validity supports Excel serial and Date without accepting invalid asOf',()=>{for(const valid of [new Date('2999-01-01T00:00:00Z'),401404]){const input=completeSource();input.priceMap[0]['Price Valid Until']=valid;const result=B.fromSheets(workbook(input),{asOf:'2026-09-05'});assert.equal(result.summary.usable,2);}assert.throws(()=>B.fromSheets(workbook(completeSource()),{asOf:'2026-02-31'}),/AS_OF/);});

test('duplicate material codes cannot select a master or collapse different vendor offers',()=>{
  for(const duplicate of ['priceMap','catalog']){const input=completeSource();assert.equal(B.build(input,{asOf:'2026-09-05'}).summary.usable,2);const second={...input[duplicate][0]};if(duplicate==='priceMap')second['Master Supplier']='Different synthetic vendor';else second['Price Status']='REVIEW';input[duplicate].push(second);const result=B.fromSheets(workbook(input),{asOf:'2026-09-05'});assert.equal(result.offers.length,0);assert.equal(result.summary.usable,0);assert.ok(result.skipped.length);assert.ok(result.skipped.every(row=>/AMBIGUOUS_RD_CODE/.test(row.reason)));}
});
test('ambiguous material codes do not hide unrelated uniquely identified rows',()=>{const input=completeSource();input.priceMap.push({...input.priceMap[0]});input.catalog.push({...input.catalog[0],'RD-Code':'RD-UNIQUE'});input.priceMap.push({...input.priceMap[0],'RD-Code':'RD-UNIQUE'});const result=B.build(input,{asOf:'2026-09-05'});assert.equal(result.offers.length,2);assert.equal(result.offers.map(o=>o.materialId).join('|'),'RD-UNIQUE|RD-UNIQUE');assert.equal(result.skipped.length,2);});
test('LT rejects weeks months ambiguous prose and mixed units instead of understating days',()=>{for(const accepted of [['7-14 วัน',14],['LT 30 วัน',30],['ปกติมี stock แต่ถ้า stock หมดรอของ 7-14 วัน',14],[14,14],['14',14]])assert.equal(B.leadTimeDays(accepted[0]),accepted[1]);for(const rejected of ['2-3 สัปดาห์','1 เดือน','1 month','2 weeks','1 เดือน / 7 วัน','stock 30 kg ส่ง 7 วัน','7-14','ประมาณ 7 หรือ 30 วัน','7-14 วัน (MOQ 25 kg)','7.5 วัน','14-7 วัน'])assert.equal(B.leadTimeDays(rejected),null,rejected);const input=completeSource();input.offered=[{...offered[0],'Lead Time':'2-3 สัปดาห์'}];const result=B.build(input,{asOf:'2026-09-05'});assert.equal(result.offers[0].leadTimeDays,null);assert.equal(result.summary.usable,0);assert.ok(result.offers[0].missing.includes('Lead Time'));});

test('exclusion evidence in any master or price-map field keeps offers visible but blocked',()=>{assert.equal(B.build(completeSource(),{asOf:'2026-09-05'}).summary.usable,2);for(const where of ['catalog','priceMap'])for(const marker of ['ยกเลิก','ยังไม่เคยซื้อ','ไม่ผ่าน อย.','cancelled','canceled','never purchased','regulatory fail']){const input=completeSource();input[where][0]['Unmapped audit note']=marker;const result=B.build(input,{asOf:'2026-09-05'});assert.equal(result.offers.length,2);assert.equal(result.summary.usable,0,where+' '+marker);assert.equal(result.offers[0].status,'review');assert.equal(result.offers[0].excluded,true);assert.ok(result.offers[0].missing.includes('EXCLUDED_STATUS'));}});
test('Price Date must be real and effective before offers can be locally usable',()=>{const input=completeSource();assert.equal(B.build(input,{asOf:'2026-09-05'}).summary.usable,2);for(const value of ['',null,'2026-02-31','2026-09-06','not-a-date']){input.priceMap[0]['Price Date']=value;const result=B.build(input,{asOf:'2026-09-05'});assert.equal(result.offers.length,2);assert.equal(result.summary.usable,0,String(value));assert.equal(result.offers[0].status,'review');assert.ok(result.offers[0].missing.some(reason=>/PRICE_DATE/.test(reason)));}});
