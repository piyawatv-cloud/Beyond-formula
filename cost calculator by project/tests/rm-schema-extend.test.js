'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function load(){
  const ctx={Logger:{log(){}},SpreadsheetApp:{flush(){},newDataValidation:()=>({requireValueInList(){return this;},
    requireDate(){return this;},requireNumberGreaterThan(){return this;},setAllowInvalid(){return this;},build:()=>({})})}};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../apps_script/RmSchemaExtend.gs'),'utf8'),ctx);
  return ctx.RmSchemaExtend;
}
function sheetOf(rows){
  const writes=[];let maxCols=Math.max(...rows.map(r=>r.length));
  return {writes,getMaxColumns:()=>maxCols,insertColumnsAfter:(a,n)=>{maxCols+=n;writes.push({op:'insert',n});},
    getDataRange:()=>({getValues:()=>rows.map(r=>r.slice())}),
    getRange:(r,c,nr)=>({setValue:v=>writes.push({op:'set',row:r,col:c,value:v}),setNote:v=>writes.push({op:'note',col:c}),
      setNumberFormat:()=>writes.push({op:'format',col:c}),setDataValidation:()=>writes.push({op:'validate',col:c,rows:nr})})};
}
const HEAD=['RD-Code','Master Ingredient','Price Tiers (Raw)','MOQ / Qty'];
const grid=()=>[['ชื่อไฟล์'],HEAD,['RD-A-001','สาร ก.','1000','1'],['RD-A-002','สาร ข.','700','25']];

test('dry run ไม่เขียนอะไร และบอกตำแหน่งคอลัมน์ที่จะเพิ่ม',()=>{const X=load();
  const s=sheetOf(grid());const p=X.plan(s);
  assert.equal(s.writes.length,0);
  assert.equal(p.additions.length,3);
  assert.equal(p.additions.map(a=>a.column).join(','),'5,6,7','ต่อท้ายจากสี่คอลัมน์เดิม');
  assert.equal(p.headerRow,2);assert.equal(p.dataRows,2);
  assert.match(X.report(p),/Order Increment/);});
test('เพิ่มต่อท้ายเท่านั้น คอลัมน์เดิมต้องไม่ถูกเขียนทับ',()=>{const X=load();
  const s=sheetOf(grid());X.apply(s);
  const setCols=s.writes.filter(w=>w.op==='set').map(w=>w.col);
  assert.deepEqual(setCols,[5,6,7]);
  assert.ok(!setCols.some(c=>c<=4),'ห้ามแตะคอลัมน์เดิม');});
test('ใส่ตัวช่วยกรอกให้ทุกคอลัมน์ แต่ไม่เติมค่าลงในช่องข้อมูล',()=>{const X=load();
  const s=sheetOf(grid());X.apply(s);
  assert.equal(s.writes.filter(w=>w.op==='validate').length,3,'ทั้งสามคอลัมน์ต้องมี validation');
  assert.ok(s.writes.filter(w=>w.op==='validate').every(w=>w.rows===2),'ครอบเฉพาะแถวข้อมูล');
  const dataWrites=s.writes.filter(w=>w.op==='set'&&w.row>2);
  assert.equal(dataWrites.length,0,'ต้องไม่เติมค่าให้ — ว่างแปลว่ายังไม่มีข้อมูล');});
test('รันซ้ำไม่เพิ่มคอลัมน์ซ้ำ',()=>{const X=load();
  const withCols=[['x'],[...HEAD,'Order Increment (kg)','Price Valid Until','Spec Approved'],['RD-A-001','ก','1000','1','1','2027-01-01','TRUE']];
  const s=sheetOf(withCols);const out=X.apply(s);
  assert.match(out,/ไม่มีอะไรต้องเพิ่ม/);
  assert.equal(s.writes.length,0);});
test('เพิ่มเฉพาะคอลัมน์ที่ยังขาด เมื่อมีอยู่แล้วบางส่วน',()=>{const X=load();
  const s=sheetOf([['x'],[...HEAD,'Price Valid Until'],['RD-A-001','ก','1000','1','2027-01-01']]);
  const p=X.plan(s);
  assert.equal(p.additions.length,2);
  assert.equal(p.alreadyPresent.join(','),'Price Valid Until');});
test('หาหัวตารางไม่เจอต้องหยุด ไม่เดาตำแหน่ง',()=>{const X=load();
  const s=sheetOf([['a','b'],['1','2']]);
  assert.throws(()=>X.plan(s),/ไม่พบหัวตาราง/);
  assert.equal(s.writes.length,0);});
