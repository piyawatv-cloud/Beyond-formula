'use strict';
// กฎการแปลงข้อความดิบจาก RD Data Center ตามที่เจ้าของระบบยืนยัน 2026-09-05
// รูปแบบข้อความด้านล่างมาจากการสำรวจแหล่งจริง แต่ตัวเลขเป็นค่ากลาง ๆ
// ไม่มีชื่อสาร ชื่อผู้ขาย หรือราคาจริงถูกคัดลอกมา
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const mc={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../apps_script/RmSourceMap.gs'),'utf8'),mc);
const dc={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../apps_script/RmData.gs'),'utf8'),dc);
const M=mc.RmSourceMap,R=dc.RmData;
const join=a=>a.join('|');

test('จุลภาคที่ตามด้วยเลขสามหลักติดกันคือหลักพัน',()=>{
  const r=M.normalisePair('1 kg','38,500');
  assert.equal(join(r.price),'38500');
  assert.equal(r.usable,true);
  assert.ok(!r.notes.includes('COMMA_READ_AS_LIST_SEPARATOR'));
});
test('จุลภาคที่มีช่องว่างหรือตามด้วยเลขไม่ครบสามหลักคือตัวคั่นรายการ',()=>{
  for(const [moq,price,em,ep] of [
    ['1 , 25','1000 , 700','1 kg|25 kg','1000|700'],
    ['10, 50, 100','950, 900, 850','10 kg|50 kg|100 kg','950|900|850'],
    ['1,25','800,600','1 kg|25 kg','800|600']]){
    const r=M.normalisePair(moq,price);
    assert.equal(join(r.moq),em,moq);
    assert.equal(join(r.price),ep,price);
  }
});
test('หลักพันกับคั่นรายการปนกันในช่องเดียวต้องแยกออกได้',()=>{
  const r=M.normalisePair('0.1 / 1','100,000 / 98,000');
  assert.equal(join(r.price),'100000|98000');
  assert.equal(r.usable,true);
});
test('ถ้าอ่านเป็นหลักพันแล้วราคาทะลุเพดาน ให้ถือเป็นตัวคั่นรายการ',()=>{
  // 500,600 อ่านเป็นหลักพันได้ 500600 บาท/กก. ซึ่งเกินเพดานแสน จึงเป็นสองราคา
  const r=M.normalisePair('1 , 25','500,600');
  assert.equal(join(r.price),'500|600');
  assert.ok(r.notes.includes('COMMA_READ_AS_LIST_SEPARATOR'),'ต้องบันทึกไว้ว่าเปลี่ยนการตีความ');
});
test('ราคาที่สูงเกินเพดานและแยกไม่ได้ต้องไม่ถูกเดา',()=>{
  const r=M.normalisePair('1 kg','999999');
  assert.equal(r.usable,false);
  assert.ok(r.notes.includes('PRICE_ABOVE_PLAUSIBLE_CEILING'));
});
test('MOQ ตัวเลขเปล่าถือเป็นกิโลกรัม และต้องบันทึกว่าเติมหน่วยให้',()=>{
  const r=M.normalisePair('25','1400');
  assert.equal(join(r.moq),'25 kg');
  assert.ok(r.notes.includes('BARE_MOQ_ASSUMED_KG'));
  assert.equal(r.usable,true,'เป็นกติกาที่ตกลงแล้ว จึงยังใช้ได้');
});
test('MOQ ที่เป็นช่วงยังไม่ถือเป็นปริมาณขั้นต่ำ',()=>{
  for(const moq of ['1-10','1-10 kg','1-10, 100']){
    const r=M.normalisePair(moq,'1500 , 1300');
    assert.ok(r.notes.includes('MOQ_IS_A_RANGE'),moq);
    assert.equal(r.usable,false,moq);
  }
});
test('หน่วยที่ไม่ใช่น้ำหนักต้องถูกกันไว้ ไม่แปลงมั่ว',()=>{
  for(const [moq,price] of [['125,000 แคป','0.092 บาท/แคป'],['1 ลัง','450 / ลัง']]){
    const r=M.normalisePair(moq,price);
    assert.equal(r.usable,false,moq);
    assert.ok(r.notes.includes('NON_MASS_UNIT')||r.notes.includes('TOKEN_COUNT_MISMATCH'),moq);
  }
});
test('จำนวน MOQ กับราคาไม่เท่ากันต้องถูกจับได้',()=>{
  const r=M.normalisePair('1 / 25 / 100','1000 / 700');
  assert.ok(r.notes.includes('TOKEN_COUNT_MISMATCH'));
  assert.equal(r.usable,false);
});
test('ข้อความที่ปรับแล้วใช้ / อย่างเดียว เพื่อไม่ให้กำกวมอีก',()=>{
  const r=M.normalisePair('1 , 25','1,200 , 900');
  assert.ok(!r.normalisedMoq.includes(','),'MOQ ต้องไม่เหลือจุลภาค');
  assert.ok(!r.normalisedPrice.includes(','),'ราคาต้องไม่เหลือจุลภาค');
  assert.equal(r.normalisedMoq,'1 kg / 25 kg');
  assert.equal(r.normalisedPrice,'1200 / 900');
  assert.equal(r.changed,true);
});
test('ผลลัพธ์ของ mapper ต้องอ่านได้ด้วย RmData จริง',()=>{
  for(const [moq,price,tiers] of [
    ['1 , 25','1000 , 700','1:1000|25:700'],
    ['25','1400','25:1400'],
    ['0.1 / 1','100,000 / 98,000','0.1:100000|1:98000']]){
    const n=M.normalisePair(moq,price);
    const parsed=R.parsePaired(n.moq,n.price);
    assert.equal(parsed.ok,true,moq+' ↔ '+price);
    assert.equal(parsed.positions.map(p=>p.moq+':'+p.price).join('|'),tiers);
  }
});
test('ไม่เลือก Tier ให้เอง — ทุก Tier ต้องถูกส่งต่อไปให้ RD เลือก',()=>{
  const n=M.normalisePair('1 , 25 , 100','1200 , 900 , 800');
  assert.equal(n.moq.length,3,'ต้องไม่ยุบเหลือราคาเดียว');
  const parsed=R.parsePaired(n.moq,n.price);
  assert.equal(parsed.positions.length,3);
  assert.equal(parsed.positions.map(p=>p.price).join('|'),'1200|900|800','ห้ามคัดเหลือ max หรือ min');
});
