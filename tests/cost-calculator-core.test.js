'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const block=html.match(/\/\/ COST_CALCULATOR_CORE_START([\s\S]*?)\/\/ COST_CALCULATOR_CORE_END/);
assert.ok(block,'Actual application must include deterministic calculator core');
const context={}; vm.runInNewContext(block[1],context); const C=context.CostCalculator;
const offer=()=>({id:'O1',version:1,materialId:'M1',tierId:'T1',vendorId:'PRIVATE_VENDOR',scope:{type:'central'},status:'confirmed',specApproved:true,price:100,priceUnit:'kg',moq:2,moqUnit:'kg',increment:1,incrementUnit:'kg',leadTimeDays:10,validUntil:'2030-01-01',evidenceRef:'E1'});
const line=()=>({id:'L1',materialId:'M1',fullName:'PRIVATE_NAME',alias:'Visible name',amount:1000,unit:'mg',lossPercent:0,offer:offer()});
const input=()=>({projectId:'A00001',scenarioId:'S1',revision:1,sellingUnits:1000,unitsPerPack:10,fillAmount:1,fillUnit:'g',pkSpecVersion:'P1',rmLines:[line()],operation:{status:'confirmed',batchCapacity:5000,setupHoursPerBatch:1,runUnitsPerHour:1000,people:2,dlPerPersonHour:50,ohPerRunHour:10,validUntil:'2030-01-01'},extraCosts:[],extrasReviewed:true,policies:{},pk:null});
const pk=()=>({id:'PK1',version:1,projectId:'A00001',scenarioId:'S1',sellingUnits:1000,unitsPerPack:10,fillAmount:1,fillUnit:'g',specVersion:'P1',status:'confirmed',validUntil:'2030-01-01',evidenceRef:'PE1',baseTotal:500,adjustedTotal:600});
const date='2029-01-01';
test('mass and pack math separates consumption, purchase and leftover',()=>{let x=input(); x.rmLines[0].amount=150;let r=C.calculate(x,date);assert.ok(Math.abs(r.rm.baseTotal-150)<1e-9);assert.equal(r.rm.purchaseCash,200);assert.ok(Math.abs(r.rm.leftoverExposure-50)<1e-9);assert.ok(Math.abs(r.rm.lines[0].requiredKg-1.5)<1e-9);assert.equal(r.productionUnits,10000);assert.equal(r.operation.baseTotal,1300);assert.equal(r.complete,false);});
test('loss is yield-based and missing loss or MOQ units are never zero',()=>{let x=input();x.rmLines[0].lossPercent=20;assert.equal(C.calculate(x,date).rm.lines[0].requiredKg,12.5);x.rmLines[0].lossPercent=null;assert.equal(C.calculate(x,date).rm.baseTotal,null);x=input();delete x.rmLines[0].offer.moqUnit;assert.equal(C.calculate(x,date).rm.baseTotal,null);});
test('PK delayed or draft never prevents RM calculation',()=>{let x=input();assert.equal(C.calculate(x,date).rm.baseTotal,1000);x.pk=pk();x.pk.status='draft';let r=C.calculate(x,date);assert.equal(r.pk.ready,false);assert.equal(r.pk.baseTotal,500);assert.equal(r.rm.baseTotal,1000);});
test('PK adoption is explicit immutable idempotent and rejects conflict',()=>{let a=C.createScenario(input());let b=C.adoptPK(a,pk(),date);assert.equal(a.pk,null);assert.equal(b.revision,2);assert.equal(C.adoptPK(b,pk(),date),b);let changed=pk();changed.baseTotal=1;assert.throws(()=>C.adoptPK(b,changed,date),/CONFLICT/);assert.ok(Object.isFrozen(b));});
test('PK rejects mismatched context and stale price',()=>{for(const patch of [{projectId:'A00002'},{sellingUnits:10},{specVersion:'P2'},{validUntil:'2020-01-01'}]){assert.throws(()=>C.adoptPK(C.createScenario(input()),{...pk(),...patch},date));}});
test('revision copies inputs and cannot mutate identity',()=>{let x=input(),a=C.createScenario(x);x.rmLines[0].amount=99;assert.equal(a.rmLines[0].amount,1000);let b=C.revise(a,{rmLines:[{...line(),amount:500}]});assert.equal(b.revision,2);assert.equal(a.rmLines[0].amount,1000);assert.throws(()=>C.revise(a,{projectId:'A99999'}));});
test('pricing needs explicit confirmed policy; no fabricated default',()=>{let x=input();x.pk=pk();let r=C.calculate(x,date);assert.equal(r.rm.adjustedTotal,null);assert.equal(r.finalTotal,null);x=readyInput();r=C.calculate(x,date);assert.equal(r.finalTotal,3100);assert.equal(r.finalPerSellingUnit,3.1);assert.equal(r.complete,true);});
test('one-time batch and unit extras are explicit and not double counted',()=>{let x=input();x.extraCosts=[{id:'F1',currency:'THB',status:'confirmed',category:'Operation',basis:'perBatch',amount:50,collection:'included'}];assert.equal(C.calculate(x,date).operation.baseTotal,1400);x.extraCosts[0].collection='separate';let r=C.calculate(x,date);assert.equal(r.operation.baseTotal,1300);assert.equal(r.separateCharges,100);x.extraCosts[0].status='pending';assert.equal(C.calculate(x,date).complete,false);});
test('safe projections never expose cross-category base totals or supplier details',()=>{let x=input();x.pk=pk();let r=C.calculate(x,date);for(const role of ['Sales','OPC','RD','PU-PK','unknown']){let p=C.project(r,role);assert.ok(!JSON.stringify(p).includes('PRIVATE'));assert.equal(p.baseTotal,undefined);assert.equal(p.separateCharges,undefined);if(role==='Sales')assert.equal(p.rm.baseTotal,undefined);if(role==='RD')assert.equal(p.pk.baseTotal,undefined);if(role==='PU-PK')assert.equal(p.rm.baseTotal,undefined);}});
test('quotation freeze denies unverifiable browser authority',()=>{let x=input();assert.throws(()=>C.freezeQuotation(x,date,{actor:'CEO',approved:true}),/AUTHORITY/);});

const meta=()=>({id:'STD1',version:1,routingOwner:'RD1',rateOwner:'FIN1',currency:'THB',validFrom:'2028-01-01',validUntil:'2030-01-01',capacityUnit:'innerUnit',runRateUnit:'innerUnit/hour',dlRateUnit:'THB/person-hour',ohRateUnit:'THB/hour'});
const policy=(mode,rate,basis='categoryTotal')=>({id:'P1',version:1,owner:'FIN1',status:'confirmed',mode,rate,currency:'THB',validFrom:'2028-01-01',validUntil:'2030-01-01',rounding:{decimals:2,mode:'halfUp',basis}});
const readyInput=()=>{let x=input();x.currency='THB';x.rmLines[0].offer.currency='THB';x.operation={...x.operation,...meta()};x.pk={...pk(),currency:'THB'};x.policies={RM:policy('markup',0.2),Operation:policy('markup',0),Final:policy('passthrough',undefined,'sellingUnit')};return x;};
test('routing steps calculate setup and DL/OH once per explicit step',()=>{let x=readyInput();x.operation={steps:[{...x.operation,id:'mix'},{...x.operation,id:'pack',setupHoursPerBatch:0,runUnitsPerHour:2000,people:1,dlPerPersonHour:40,ohPerRunHour:20}]};let r=C.calculate(x,date);assert.equal(r.operation.baseTotal,1600);assert.equal(r.operation.steps.length,2);assert.equal(r.finalTotal,3400);assert.equal(r.complete,true);});
test('formula fill mismatch preserves known RM but blocks completeness',()=>{let x=readyInput();x.rmLines[0].amount=900;let r=C.calculate(x,date);assert.equal(r.rm.baseTotal,900);assert.equal(r.formulaComplete,false);assert.equal(r.complete,false);});
test('missing routing metadata and duplicate steps cannot finalize',()=>{for(const key of ['version','rateOwner','routingOwner','currency','capacityUnit']){let x=readyInput();delete x.operation[key];assert.equal(C.calculate(x,date).operation.ready,false,key);}let x=readyInput();x.operation={steps:[x.operation,x.operation]};assert.equal(C.calculate(x,date).operation.ready,false);});
test('policy identity, owner, validity, currency and rounding are mandatory',()=>{for(const key of ['version','owner','validFrom','validUntil','currency','rounding']){let x=readyInput();delete x.policies.RM[key];assert.equal(C.calculate(x,date).complete,false,key);}let x=readyInput();x.policies.Final.rounding.basis='unknown';assert.equal(C.calculate(x,date).finalTotal,null);});
test('currency is explicit and unsupported currency cannot be mixed',()=>{for(const mutate of [x=>delete x.currency,x=>x.rmLines[0].offer.currency='USD',x=>x.pk.currency='USD',x=>x.operation.currency='USD']){let x=readyInput();mutate(x);assert.equal(C.calculate(x,date).complete,false);}});
test('overflow at any aggregate or price layer is null rather than non-finite',()=>{for(const mutate of [x=>x.policies.RM.rate=Number.MAX_VALUE,x=>x.operation.dlPerPersonHour=Number.MAX_VALUE,x=>x.extraCosts=[{id:'E1',currency:'THB',status:'confirmed',category:'Operation',basis:'perUnit',amount:Number.MAX_VALUE,collection:'included'}]]){let x=readyInput();mutate(x);const r=C.calculate(x,date);assert.equal(r.complete,false);const walk=v=>{if(typeof v==='number')assert.ok(Number.isFinite(v));else if(v&&typeof v==='object')Object.values(v).forEach(walk);};walk(r);}});
test('per-batch extra references its routing step and duplicate fees are blocked',()=>{let x=readyInput();x.operation={steps:[{...x.operation,id:'mix'},{...x.operation,id:'pack',batchCapacity:10000}]};x.extraCosts=[{id:'F1',currency:'THB',status:'confirmed',category:'Operation',basis:'perBatch',stepId:'pack',amount:50,collection:'included'}];assert.equal(C.calculate(x,date).operation.baseTotal,2550);x.extraCosts.push({...x.extraCosts[0]});assert.equal(C.calculate(x,date).complete,false);});
test('unit rounding reconciles final lot and unsupported rounding remains pending',()=>{let x=readyInput();x.pk.adjustedTotal=605;let r=C.calculate(x,date);assert.equal(r.finalPerSellingUnit,3.11);assert.equal(r.finalTotal,3110);x.policies.Final.rounding.mode='unknown';assert.equal(C.calculate(x,date).complete,false);});
test('separately collected fees need their own commercial price before readiness',()=>{let x=readyInput();x.extraCosts=[{id:'F1',currency:'THB',status:'confirmed',category:'Operation',basis:'once',amount:100,collection:'separate'}];let r=C.calculate(x,date);assert.equal(r.separateCharges,100);assert.equal(r.operation.baseTotal,1300);assert.equal(r.complete,false);});
test('RM quoted price denominator is converted as an inseparable term',()=>{let x=readyInput();x.rmLines[0].offer.priceBasisQuantity=25;let r=C.calculate(x,date);assert.equal(r.rm.baseTotal,40);assert.equal(r.rm.purchaseCash,40);for(const denominator of [0,null,-1,Infinity]){x.rmLines[0].offer.priceBasisQuantity=denominator;assert.equal(C.calculate(x,date).rm.baseTotal,null);}});
test('withdrawn obsolete and stale RM offers never finalize',()=>{for(const flag of ['withdrawn','obsolete','stale','syncFailed']){let x=readyInput();x.rmLines[0].offer[flag]=true;assert.equal(C.calculate(x,date).rm.ready,false,flag);assert.equal(C.calculate(x,date).complete,false,flag);}});
test('RM central and project scope are explicit and project-specific terms cannot cross projects',()=>{let x=readyInput();x.rmLines[0].offer.scope={type:'project',projectId:'A99999'};assert.equal(C.calculate(x,date).rm.ready,false);x.rmLines[0].offer.scope.projectId=x.projectId;assert.equal(C.calculate(x,date).rm.ready,true);delete x.rmLines[0].offer.scope;assert.equal(C.calculate(x,date).rm.ready,false);});
test('unverified declared RM constraints block quotation eligibility',()=>{let x=readyInput();x.rmLines[0].offer.constraints={maximumQuantity:5};assert.equal(C.calculate(x,date).rm.ready,false);});
test('withdrawn obsolete stale and sync-failed PK cannot be adopted or ready',()=>{for(const flag of ['withdrawn','obsolete','stale','syncFailed']){let x=readyInput();x.pk[flag]=true;assert.equal(C.calculate(x,date).pk.ready,false,flag);assert.throws(()=>C.adoptPK(C.createScenario(input()),x.pk,date));}});

// เขียนใหม่จากเทสต์เดิมสี่ข้อที่ assert ค่าที่เป็น false อยู่แล้ว เพราะ input() ไม่มี currency
// ทุกข้อเริ่มด้วย control assertion ว่า baseline เป็น true มิฉะนั้นก็จับอะไรไม่ได้เหมือนเดิม
test('baseline ที่ใช้ทดสอบต้องพร้อมจริง มิฉะนั้น assertion ด้านล่างไม่มีความหมาย',()=>{
  const r=C.calculate(readyInput(),date);
  assert.equal(r.rm.ready,true,'RM ต้องพร้อมบน baseline');
  assert.equal(r.pk.ready,true,'PK ต้องพร้อมบน baseline');
});
test('ข้อเสนอที่ยังไม่ยืนยันหรือหมดอายุแล้วต้องไม่พร้อมใช้',()=>{
  assert.equal(C.calculate(readyInput(),date).rm.ready,true);
  let x=readyInput();x.rmLines[0].offer.status='draft';
  assert.equal(C.calculate(x,date).rm.ready,false,'สถานะ draft ต้องทำให้ไม่พร้อม');
  assert.equal(C.calculate(readyInput(),'2031-01-01').rm.ready,false,'ราคาหมดอายุต้องทำให้ไม่พร้อม');
});
test('ราคาที่ยังไม่เริ่มมีผลต้องใช้ไม่ได้ และวันที่ไม่มีจริงต้องโยนข้อผิดพลาด',()=>{
  assert.throws(()=>C.calculate(readyInput(),'2029-02-31'));
  let x=readyInput();x.rmLines[0].offer.validFrom='2029-06-01';
  assert.equal(C.calculate(x,date).rm.ready,false,'validFrom ที่ยังมาไม่ถึงต้องทำให้ไม่พร้อม');
  x=readyInput();x.rmLines[0].offer.validFrom='2028-06-01';
  assert.equal(C.calculate(x,date).rm.ready,true,'validFrom ที่ผ่านมาแล้วต้องยังพร้อม');
});
test('รหัสบรรทัดซ้ำทำให้ RM ไม่ครบ และตัวเลขล้นต้องไม่กลายเป็นตัวเลข',()=>{
  let x=readyInput();x.rmLines.push({...x.rmLines[0]});
  assert.equal(C.calculate(x,date).rm.ready,false,'บรรทัดที่ id ซ้ำต้องทำให้ไม่พร้อม');
  x=readyInput();x.rmLines[0].offer.price=Number.MAX_VALUE;
  assert.equal(C.calculate(x,date).rm.baseTotal,null,'ค่าที่ล้นต้องเป็น null ไม่ใช่ตัวเลขมั่ว');
});
test('PK ที่ไม่มีตัวตนคงที่ต้องใช้ไม่ได้',()=>{
  assert.equal(C.calculate(readyInput(),date).pk.ready,true);
  for(const mutate of [x=>delete x.pk.id,x=>x.pk.version=0,x=>delete x.pk.version]){
    let x=readyInput();mutate(x);
    assert.equal(C.calculate(x,date).pk.ready,false);
  }
});
// QA ชี้ว่า allowanceRate ที่เป็น string ทำให้ 1+allowance ต่อสตริงแล้วราคาพุ่ง 4.5 เท่า
// โดยยังรายงานว่าคำนวณสำเร็จ — ต้องปฏิเสธ ไม่ใช่แปลงชนิดให้
test('ค่าเผื่อขั้นต้นต้องเป็นตัวเลขเท่านั้น ค่าชนิดอื่นหรือติดลบต้องไม่ให้ราคา',()=>{
  const base=readyInput();
  const ok=C.calculate({...base,policies:{...base.policies,RM:{...base.policies.RM,allowanceRate:0.1}}},date);
  assert.ok(ok.rm.adjustedTotal>0,'ตัวเลขปกติต้องคำนวณได้');
  for(const bad of ['0.1','',null,true,{},[],NaN,Infinity,-0.5]){
    let x=readyInput();x.policies.RM={...x.policies.RM,allowanceRate:bad};
    assert.equal(C.calculate(x,date).rm.adjustedTotal,null,'allowanceRate = '+JSON.stringify(bad));
  }
});
// QA ชี้ว่า specApproved ไม่มี negative coverage ทั้งในแกนและตัวนำเข้า
test('ข้อเสนอที่ยังไม่ผ่านการรับรอง spec ต้องใช้ไม่ได้ ไม่ว่าเขียนมาแบบไหน',()=>{
  assert.equal(C.calculate(readyInput(),date).rm.ready,true);
  for(const bad of [false,'no',0,'',null,undefined,'true']){
    let x=readyInput();x.rmLines[0].offer.specApproved=bad;
    assert.equal(C.calculate(x,date).rm.ready,false,'specApproved = '+JSON.stringify(bad));
  }
  let x=readyInput();delete x.rmLines[0].offer.specApproved;
  assert.equal(C.calculate(x,date).rm.ready,false,'ไม่มีฟิลด์เลยก็ต้องไม่พร้อม');
});
// ค่าธรรมเนียมต่อหน่วยผลิตกับต่อหน่วยขายเป็นคนละฐาน — UAT พบว่าคิดต่ำไป 60 เท่า
test('ค่าธรรมเนียมต่อหน่วยผลิตต้องคูณด้วยจำนวนที่ผลิต ไม่ใช่จำนวนหน่วยขาย',()=>{
  const base=readyInput();
  const fee=basis=>({...base,extraCosts:[{id:'F1',currency:'THB',status:'confirmed',
    category:'Operation',basis,amount:0.6,collection:'included'}],extrasReviewed:true});
  const perProd=C.calculate(fee('perProductionUnit'),date),perSell=C.calculate(fee('perUnit'),date);
  const units=perProd.productionUnits,sold=perProd.sellingUnits;
  assert.ok(units>sold,'ตัวอย่างต้องมีหลายหน่วยย่อยต่อหน่วยขาย มิฉะนั้นเทียบไม่ได้');
  assert.equal(perProd.operation.baseTotal-C.calculate(base,date).operation.baseTotal,0.6*units);
  assert.equal(perSell.operation.baseTotal-C.calculate(base,date).operation.baseTotal,0.6*sold);
});
test('ฐานค่าธรรมเนียมที่ไม่รู้จักต้องไม่ถูกคิดเป็นศูนย์เงียบ ๆ',()=>{
  const base=readyInput();
  for(const basis of ['perCapsule','',null,undefined,'PERUNIT']){
    const x={...base,extraCosts:[{id:'F1',currency:'THB',status:'confirmed',
      category:'Operation',basis,amount:0.6,collection:'included'}],extrasReviewed:true};
    assert.equal(C.calculate(x,date).complete,false,'basis = '+JSON.stringify(basis));
  }
});

// A2: controls are fully eligible before varying the effective-from boundary.
test('A2 effective-from dates gate each otherwise-ready cost category',()=>{
  assert.equal(C.calculate(readyInput(),date).complete,true);
  for(const target of ['rm','pk','operation','policy']){
    const set=(x,value)=>{const terms=target==='rm'?x.rmLines[0].offer:target==='pk'?x.pk:target==='operation'?x.operation:x.policies.RM;terms.validFrom=value;};
    const eligibility=r=>target==='policy'?r.rm.adjustedTotal!==null:r[target].ready;
    for(const valid of ['2028-12-31',date]){const x=readyInput();set(x,valid);assert.equal(eligibility(C.calculate(x,date)),true,target+' active control');}
    for(const invalid of ['2029-01-02','2029-02-31','not-a-date']){const x=readyInput();set(x,invalid);const result=C.calculate(x,date);assert.equal(eligibility(result),false,target+' '+invalid);assert.equal(result.complete,false);}
  }
});
test('A2 formula tolerance rejects 9.9 percent underfill and overfill',()=>{
  assert.equal(C.calculate(readyInput(),date).complete,true);
  for(const amount of [901,1099]){const x=readyInput();x.rmLines[0].amount=amount;const r=C.calculate(x,date);assert.ok(r.rm.baseTotal>0,'draft still has the known consumed cost');assert.equal(r.formulaComplete,false,amount+' mg against 1000 mg target');assert.equal(r.complete,false);}
  const x=readyInput();x.rmLines[0].amount=1000*(1+1e-12);assert.equal(C.calculate(x,date).formulaComplete,true,'representation-level arithmetic noise remains tolerated');
});
