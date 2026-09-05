'use strict';
// Reconciliation against the RD cost form's own arithmetic.
//
// The form's ladder, read out of its cell formulas:
//   H29 = SUM(lines)          ต้นทุนขั้นต้น
//   H30 = H29*10/100+(H29)    + ค่าเผื่อขั้นต้น
//   H31 = H30                 ต้นทุนสาร
//   H32 = $H$31*2.2           ราคาขายอาหารเสริม
//   H35 = SUM(H32:H34)        + ค่าดำเนินการต่อหน่วย (ที่ต้นทุน)
// The allowance and the factor are per-formula inputs, not constants, so they
// are supplied here as a governed policy record rather than hardcoded.
//
// Ingredient names, suppliers and prices are synthetic. Only the SHAPE of the
// arithmetic comes from the inspected form; no business data is reproduced.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const core={};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../index.html'),'utf8')
  .match(/\/\/ COST_CALCULATOR_CORE_START([\s\S]*?)\/\/ COST_CALCULATOR_CORE_END/)[1],core);
const C=core.CostCalculator;
const ASOF='2026-09-05';
// rounding.basis must name the boundary the policy is applied at, so a category
// policy cannot be reused at the selling-unit boundary by accident.
const gov=basis=>({version:1,owner:'เจ้าของนโยบายราคา',status:'confirmed',currency:'THB',
  validFrom:'2026-01-01',validUntil:'2999-01-01',rounding:{decimals:6,mode:'halfUp',basis}});
const pricing=(allowanceRate,factor)=>({RM:{id:'POL-RM',...gov('categoryTotal'),mode:'factor',rate:factor,allowanceRate},
  Operation:{id:'POL-OP',...gov('categoryTotal'),mode:'passthrough'},
  Final:{id:'POL-FIN',...gov('sellingUnit'),mode:'passthrough'}});
// The sheet carries full float; the engine rounds at the boundary its policy
// declares. Six decimals is the engine's cap, so the sheet value is compared at
// that precision rather than pretending the two agree bit for bit.
const at6=v=>Math.round(v*1e6+Number.EPSILON*Math.max(1,v*1e6))/1e6;
const offer=(id,pricePerGram)=>({id,version:1,materialId:'M-'+id,tierId:'T1',vendorId:'V1',status:'confirmed',
  specApproved:true,currency:'THB',scope:{type:'central'},price:pricePerGram,priceUnit:'g',priceBasisQuantity:1,
  moq:1,moqUnit:'kg',increment:1,incrementUnit:'kg',leadTimeDays:10,validUntil:'2999-01-01',evidenceRef:'E-'+id});
const fee=(id,amount)=>({id,category:'Operation',basis:'perUnit',amount,collection:'included',currency:'THB',status:'confirmed'});

// gPerUnit = ปริมาณที่ใช้ต่อหน่วย, pricePerGram = ราคา (ต่อกรัม)
function build({units,lines,fees,allowance,factor}){
  return C.createScenario({projectId:'A00001',scenarioId:'S1',revision:1,currency:'THB',
    sellingUnits:units,unitsPerPack:1,
    fillAmount:lines.reduce((a,l)=>a+l.gPerUnit,0),fillUnit:'g',pkSpecVersion:null,
    rmLines:lines.map((l,i)=>({id:'L'+(i+1),materialId:'M-O'+(i+1),alias:l.alias,amount:l.gPerUnit,unit:'g',
      lossPercent:0,offer:offer('O'+(i+1),l.pricePerGram)})),
    operation:{mode:'standardRateOnly'},
    extraCosts:fees.map((f,i)=>fee('FEE'+(i+1),f)),extrasReviewed:true,
    // ฟอร์มนี้ไม่มีหมวด PK แยก — ค่าปลอกแคป/ค่าซองถูกคิดเป็นค่าต่อหน่วย
    pkNotApplicable:true,policies:pricing(allowance,factor),pk:null});
}
// The form is per-unit; the engine works per lot and divides. Both must agree.
const near=(a,b,msg)=>assert.ok(Math.abs(a-b)<1e-9,msg+' — ได้ '+a+' ต้องเป็น '+b);

const SHAPES=[
  {name:'แคปซูลเจลาติน #0',units:250000,allowance:0.10,factor:2.2,fees:[0.15,0.15],
   lines:[{alias:'สารออกฤทธิ์ ก.',gPerUnit:0.25,pricePerGram:8.5},{alias:'สารเพิ่มปริมาณ',gPerUnit:0.25,pricePerGram:0.067},
          {alias:'สารช่วยไหล',gPerUnit:0.004,pricePerGram:0.13},{alias:'ปลอกแคปซูล',gPerUnit:0.096,pricePerGram:0}],
   base:2.14227,buffered:2.356497,marked:5.1842934,total:5.484293400000001},
  {name:'แคปซูลพืช #0 (ค่าปลอกสูงกว่า)',units:250000,allowance:0.10,factor:2.2,fees:[0.15,0.25],
   lines:[{alias:'สารออกฤทธิ์ ก.',gPerUnit:0.25,pricePerGram:8.5},{alias:'สารเพิ่มปริมาณ',gPerUnit:0.25,pricePerGram:0.067},
          {alias:'สารช่วยไหล',gPerUnit:0.004,pricePerGram:0.13},{alias:'ปลอกแคปซูล',gPerUnit:0.096,pricePerGram:0}],
   base:2.14227,buffered:2.356497,marked:5.1842934,total:5.584293400000001},
  {name:'แคปซูลเจลาติน #00 (สูตรหนากว่า)',units:250000,allowance:0.10,factor:2.2,fees:[0.15,0.25],
   lines:[{alias:'สารออกฤทธิ์ ก.',gPerUnit:0.25,pricePerGram:8.5},{alias:'สารเพิ่มปริมาณ',gPerUnit:0.626,pricePerGram:0.067},
          {alias:'สารช่วยไหล',gPerUnit:0.004,pricePerGram:0.13},{alias:'ปลอกแคปซูล',gPerUnit:0.12,pricePerGram:0}],
   base:2.167462,buffered:2.3842082,marked:5.24525804,total:5.64525804},
  {name:'ซอง / Shot drink',units:250000,allowance:0.10,factor:2.2,fees:[0.3,0.9],
   lines:[{alias:'สารให้ความหวาน',gPerUnit:2.4275,pricePerGram:0.077},{alias:'สารให้ความหวานเข้มข้น',gPerUnit:0.005,pricePerGram:1},
          {alias:'กลิ่นผลไม้',gPerUnit:0.1,pricePerGram:1},{alias:'สารกันเสีย',gPerUnit:0.013,pricePerGram:0.14},
          {alias:'สารควบคุมกรด',gPerUnit:0.034,pricePerGram:0.16},{alias:'เกลือ',gPerUnit:0.01,pricePerGram:0.02},
          {alias:'สารสกัด ข.',gPerUnit:0.15,pricePerGram:8.5},{alias:'วิตามิน',gPerUnit:0.02,pricePerGram:1.3},
          {alias:'สารคงสี',gPerUnit:0.15,pricePerGram:2.8},{alias:'กรดอินทรีย์',gPerUnit:0.09,pricePerGram:0.084},
          {alias:'สารสกัดแต่งสี',gPerUnit:0.0005,pricePerGram:2.2},{alias:'น้ำ RO',gPerUnit:17,pricePerGram:0.005}],
   // ชีตนี้ไม่มีสูตรในคอลัมน์ราคาต้นทุน — ค่าถูกพิมพ์มือแบบปัด 3 ตำแหน่ง จึงต่างจาก
   // ผลคูณของช่องข้าง ๆ เอง ค่าที่ใช้ที่นี่คือค่าที่คำนวณถูกต้องจาก ปริมาณ x ราคา
   base:2.1140375,buffered:2.32544125,marked:5.11597075,total:6.31597075,
   sheetShows:{base:2.114,total:6.31588}}];

for(const s of SHAPES){
  test('บันไดต้นทุนตรงกับฟอร์ม: '+s.name,()=>{
    const r=C.calculate(build(s),ASOF);
    near(r.rm.baseTotal/r.sellingUnits,s.base,'ต้นทุนขั้นต้นต่อหน่วย (H29)');
    near(r.rm.baseTotal*(1+s.allowance)/r.sellingUnits,s.buffered,'ต้นทุนสารต่อหน่วย (H31)');
    near(r.rm.adjustedTotal/r.sellingUnits,s.marked,'ราคาขายอาหารเสริมต่อหน่วย (H32)');
    near(r.operation.baseTotal/r.sellingUnits,s.fees.reduce((a,b)=>a+b,0),'ค่าดำเนินการต่อหน่วย (H33+H34)');
    near(r.finalPerSellingUnit,at6(s.total),'รวมราคาขายต่อหน่วย (H35)');
    assert.equal(r.complete,true,'สูตรที่ข้อมูลครบต้องคำนวณได้จริง');
  });
}
test('ค่าเผื่อขั้นต้นแยกจาก loss รายบรรทัด และคูณกันเมื่อใส่ทั้งคู่',()=>{
  const s=SHAPES[0];
  const withLoss=build(s);
  const lossy=C.createScenario({...withLoss,rmLines:withLoss.rmLines.map(l=>({...l,lossPercent:5}))});
  const a=C.calculate(withLoss,ASOF),b=C.calculate(lossy,ASOF);
  near(b.rm.baseTotal,a.rm.baseTotal/0.95,'loss รายบรรทัดต้องเพิ่มปริมาณที่ต้องใช้');
  // ค่าเผื่อ 10% ยังคูณทับอีกชั้น — ตั้งใจให้แยกกัน ไม่ใช่ตัวเดียวกัน
  near(b.rm.adjustedTotal,at6(b.rm.baseTotal*1.1*2.2),'ค่าเผื่อและตัวคูณคิดบนฐานที่รวม loss แล้ว');
});
test('ตัวคูณเก็บค่าตามที่ธุรกิจพูด: 2.2 คือ 2.2',()=>{
  const r=C.calculate(build(SHAPES[0]),ASOF);
  const policy=build(SHAPES[0]).policies.RM;
  assert.equal(policy.rate,2.2,'policy ต้องอ่านได้ว่า 2.2 ไม่ใช่ 1.2');
  near(r.rm.adjustedTotal/r.rm.baseTotal,1.1*2.2,'ผลลัพธ์ต้องเท่ากับ ค่าเผื่อ x ตัวคูณ');
});
test('ตัวคูณและค่าเผื่อเปลี่ยนตามสูตรได้ ไม่ใช่ค่าคงที่ของระบบ',()=>{
  for(const [allowance,factor] of [[0,1],[0.05,1.8],[0.15,3]]){
    const r=C.calculate(build({...SHAPES[0],allowance,factor}),ASOF);
    near(r.rm.adjustedTotal/r.rm.baseTotal,(1+allowance)*factor,'allowance '+allowance+' factor '+factor);
  }
});
test('PK ที่หายไปเฉย ๆ ยังบล็อกราคา ต้องประกาศว่าไม่เกี่ยวข้องเท่านั้นจึงข้ามได้',()=>{
  const base=build(SHAPES[0]);
  const forgotten=C.createScenario({...base,pkNotApplicable:false});
  const r=C.calculate(forgotten,ASOF);
  assert.equal(r.pk.ready,false);
  assert.equal(r.finalPerSellingUnit,null,'PK ที่ลืมใส่ต้องไม่ถูกคิดเป็นศูนย์');
  assert.ok(r.pending.some(m=>m.includes('PK')));
  assert.equal(C.calculate(base,ASOF).pk.notApplicable,true);});
test('ไม่มีอัตรามาตรฐาน Operation ที่ยืนยันแล้ว = ยังไม่ใช่ราคาพร้อมเสนอ',()=>{
  const r=C.calculate(build({...SHAPES[0],fees:[]}),ASOF);
  assert.equal(r.operation.ready,false);
  assert.equal(r.finalPerSellingUnit,null,'ต้องไม่ออกราคาต่อหน่วยเมื่อ Operation ยังไม่พร้อม');
  assert.ok(r.pending.some(m=>m.includes('อัตรามาตรฐาน Operation')));
});
test('นโยบายราคาที่ยังไม่ยืนยันหรือหมดอายุ ไม่ให้ราคา',()=>{
  for(const patch of [{status:'draft'},{validUntil:'2020-01-01'},{owner:''},{rounding:{decimals:6,mode:'halfUp',basis:'sellingUnit'}},{rate:0}]){
    const base=build(SHAPES[0]);
    const scenario=C.createScenario({...base,policies:{...base.policies,RM:{...base.policies.RM,...patch}}});
    assert.equal(C.calculate(scenario,ASOF).rm.adjustedTotal,null,JSON.stringify(patch));
  }
});

// ค่าที่พิมพ์มือในฟอร์มไม่ตรงกับผลคูณของช่องข้าง ๆ เอง — บันทึกส่วนต่างไว้ให้เห็น
// แทนที่จะปรับเครื่องคำนวณให้ผิดตาม
test('ชี้ส่วนต่างของชีตที่พิมพ์ค่าเอง แทนที่จะทำให้เครื่องคำนวณผิดตาม',()=>{
  const s=SHAPES.find(x=>x.sheetShows);
  const r=C.calculate(build(s),ASOF);
  const computed=r.rm.baseTotal/r.sellingUnits;
  near(computed,s.base,'เครื่องคำนวณต้องได้ค่าที่ถูกต้องจาก ปริมาณ x ราคา');
  assert.ok(Math.abs(computed-s.sheetShows.base)>1e-6,'ชีตกับผลคำนวณต้องต่างกันจริง');
  const driftPerLot=(s.total-s.sheetShows.total)*s.units;
  assert.ok(driftPerLot>0 && driftPerLot<100,'ส่วนต่างต่อล็อตอยู่ราว '+driftPerLot.toFixed(2)+' บาท');
});
