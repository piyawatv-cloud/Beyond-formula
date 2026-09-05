'use strict';
// Regressions for the RD Data Center audit findings A01/A02/A05.
//
// The inputs below are the exact shapes the audit recorded as producing wrong
// results in the pilot parser (parseRmTiers_). They are kept here so the
// replacement RmData module can never regress to that behaviour. No supplier,
// material or price from the live source is reproduced — these are the malformed
// TEXT PATTERNS the audit named, with neutral figures where a figure was needed.
//
// Old pilot behaviour, for reference:
//   'MOQ 1 kg: 1700/kg'            -> 1 -> 170        ราคาต่ำกว่าจริง 90%
//   '<100 kg. : 175.-'             -> MOQ 100 -> 175  ขอบเขต "น้อยกว่า" กลายเป็น MOQ
//   qty '25 kg / BAD / 1 kg'       -> 25->1100, 1->1400, ok=true   จับคู่ข้ามตำแหน่ง
//   price '-1400'                  -> 1400            ติดลบกลายเป็นบวก
//   two explicit tiers             -> ok=false        ทั้งที่อ่านได้ทั้งคู่
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ctx={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../apps_script/RmData.gs'),'utf8'),ctx);
const R=ctx.RmData;

test('A01 — token ที่อ่านไม่ได้ต้องไม่ทำให้จับคู่ข้ามตำแหน่ง',()=>{
  const r=R.parsePaired('25 kg / BAD / 1 kg','1100 / 1400 / BAD');
  assert.equal(r.ok,false,'ความสัมพันธ์ไม่ครบทั้งแถวต้องไม่ผ่าน');
  assert.equal(r.positions.length,3,'ทุกตำแหน่งต้องอยู่ครบ ไม่หายเงียบ');
  assert.equal(r.positions[0].moq,25);assert.equal(r.positions[0].price,1100);
  assert.equal(r.positions[1].valid,false,'BAD ต้องอยู่ตำแหน่งเดิม');
  assert.equal(r.positions[2].moq,1);
  assert.equal(r.positions[2].price,null,'1 kg ต้องไม่ถูกจับคู่กับ 1400 ของตำแหน่งก่อนหน้า');
  assert.ok(!r.positions.some(p=>p.moq===1&&p.price===1400),'คู่ที่ไม่มีต้นทางรองรับต้องไม่เกิดขึ้น');
});
test('A01 — ราคาติดลบต้องไม่กลายเป็นบวก',()=>{
  for(const raw of ['-1400','-1,400','- 1400']){
    const r=R.parsePaired('1 kg',raw);
    assert.equal(r.ok,false,raw);
    assert.equal(r.positions[0].price,null,raw+' ต้องไม่ถูกอ่านเป็นราคา');
  }
});
test('A01 — ราคาสี่หลักต้องอ่านครบ ไม่ถูกตัดเหลือสามหลัก',()=>{
  const r=R.parseNotes('MOQ 1 kg: 1700/kg');
  assert.equal(r.ok,true);
  assert.equal(r.positions[0].price,1700,'เคยอ่านได้ 170 ซึ่งต่ำกว่าจริง 90%');
  assert.equal(r.positions[0].moq,1);
  assert.equal(r.positions[0].priceUnit,'kg');
  assert.equal(r.positions[0].priceBasisQuantity,1);
});
test('A01 — "น้อยกว่า" ไม่ใช่ MOQ และต้องไม่ถูกแปลงเป็น MOQ',()=>{
  for(const note of ['<100 kg. : 175.-','< 100 kg : 175','ต่ำกว่า 100 kg : 175']){
    const r=R.parseNotes(note);
    assert.equal(r.ok,false,note);
    assert.ok(!r.positions.some(p=>p.moq===100),note+' ต้องไม่ให้ MOQ 100');
  }
});
test('A02 — สอง Tier ที่เขียนชัดเจนต้องอ่านได้ทั้งคู่',()=>{
  const r=R.parseNotes('MOQ (1Kg.): 1700/Kg.\nMOQ (25Kg.): 1400/Kg');
  assert.equal(r.ok,true,'เคยถูกปฏิเสธทั้งก้อนว่ากำกวม');
  assert.equal(r.positions.length,2);
  assert.equal(r.positions.map(p=>p.moq+':'+p.price).join('|'),'1:1700|25:1400');
});
test('A02 — สอง Tier ในบรรทัดเดียวต้องไม่เก็บมาแค่อันเดียวเงียบ ๆ',()=>{
  const r=R.parseNotes('MOQ 1 kg: 1000, MOQ 20 kg: 800');
  assert.equal(r.ok,false,'อ่านไม่ชัดต้องเป็น DQ');
  assert.ok(!r.positions.some(p=>p.valid),'ห้ามเก็บ Tier เดียวแล้วรายงานว่าสำเร็จ');
});
test('A02 — ราคาที่มีตัวหารหน่วยในลิสต์ต้องส่งเป็น array มิฉะนั้นต้องปฏิเสธ',()=>{
  // '/' เป็นตัวคั่นลิสต์ ถ้าส่งเป็นสตริงเดียวจะแตกเป็น 4 token ไม่ตรงกับ 2 ปริมาณ
  assert.equal(R.parsePaired('1 kg / 25 kg','1700/kg / 1400/kg').ok,false,'ต้องปฏิเสธแทนที่จะจับคู่ผิด');
  const r=R.parsePaired('1 kg / 25 kg',['1700/kg','1400/kg']);
  assert.equal(r.ok,true);
  assert.equal(r.positions.map(p=>p.moq+':'+p.price).join('|'),'1:1700|25:1400');
});
test('A02 — ราคาต่อแพ็กต้องเก็บตัวหารไว้ ไม่ยุบเป็นราคาต่อกิโล',()=>{
  const r=R.parseNotes('MOQ 25 kg: 1400/25kg');
  assert.equal(r.ok,true);
  assert.equal(r.positions[0].price,1400);
  assert.equal(r.positions[0].priceBasisQuantity,25,'1400 ต่อ 25 กก. ไม่ใช่ 1400 ต่อ 1 กก.');
});
test('A05 — หลักฐานที่ขัดกันซึ่ง mapper ตรวจพบต้องเข้า DQ ไม่ใช่ผ่านไป',()=>{
  const base={materialId:'M1',specVersion:'S1',vendorId:'V1',sourceRef:'SR1',sourceDate:'2026-09-01',
    observedAt:'2026-09-01T00:00:00Z',tierNotes:'MOQ 1 kg: 1700/kg',leadTimeDays:14,validUntil:'2999-01-01',
    scope:{type:'central'},evidenceRef:'E1'};
  assert.equal(R.normalize(base).classification,'accepted');
  const flagged=R.normalize({...base,unresolvedEvidence:true});
  assert.equal(flagged.classification,'dq','หลักฐานเพิ่มเติมที่ขัดกันต้องเข้า DQ');
  assert.ok(flagged.reasons.includes('UNRESOLVED_EVIDENCE'),'ต้องบอกเหตุผลไว้ให้ตามได้');
  assert.ok(flagged.observation&&flagged.observation.includes('1700'),'หลักฐานดิบต้องยังถูกเก็บไว้ ไม่ถูกทิ้ง');
  assert.equal(flagged.terms.materialId,'M1','เงื่อนไขที่อ่านได้ต้องยังอยู่ให้ review');
  const ambiguous=R.normalize({...base,tierNotes:'<100 kg. : 175.-'});
  assert.equal(ambiguous.classification,'dq');
  assert.ok(ambiguous.reasons.includes('AMBIGUOUS_TIERS'),'ข้อความที่อ่านไม่ชัดต้องเข้า DQ ไม่ใช่หายไป');
});
