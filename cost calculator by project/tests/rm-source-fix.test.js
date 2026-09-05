'use strict';
// สคริปต์แก้ต้นทางต้องพิสูจน์ได้ว่าปลอดภัยก่อนที่คนจะเอาไปรันกับข้อมูลจริง
// ใช้ mock ของ Sheets ที่บันทึกทุกการเขียน เพื่อยืนยันว่าเขียนเฉพาะที่ตั้งใจ
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function load(){
  const ctx={Logger:{log(){}},Utilities:{formatDate:()=> '20260905_120000'},
    Session:{getActiveUser:()=>({getEmail:()=>'tester@example.test'})},SpreadsheetApp:{flush(){}}};
  vm.createContext(ctx);
  for(const f of ['RmSourceMap.gs','RmSourceFix.gs'])
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../apps_script/',f),'utf8'),ctx);
  return ctx;
}
// mock: บันทึกทุก setValue ที่เกิดขึ้น
function sheetOf(rows,name='หลักฐานราคา'){
  const writes=[];
  return {writes,name,
    getName:()=>name,
    getDataRange:()=>({getValues:()=>rows.map(r=>r.slice())}),
    getRange:(r,c)=>({setValue:v=>{writes.push({row:r,col:c,value:v});rows[r-1][c-1]=v;},
      setValues:v=>{writes.push({row:r,col:c,bulk:v.length});}})};
}
const HEAD=['Source','Source Row','Price Date','Ingredient','Supplier','Price Tiers (Raw)','Costing Price (Max THB/kg)','MOQ / Qty','Condition / Evidence'];
const row=(price,moq)=>['S','1','2026-01-01','สาร','ผู้ขาย',price,'',moq,''];
const grid=rows=>[['RD Data Center'],HEAD,...rows];

test('dry run ต้องไม่เขียนอะไรเลยแม้แต่เซลล์เดียว',()=>{const {RmSourceFix}=load();
  const s=sheetOf(grid([row('1000 , 700','1 , 25'),row('38,500','1 kg')]));
  const p=RmSourceFix.plan(s);
  assert.equal(s.writes.length,0,'plan ต้องไม่เขียน');
  assert.equal(p.changes.length,2,'ควรพบสองแถวที่ต้องปรับ');
  assert.ok(RmSourceFix.report(p).includes('จะเปลี่ยนรูปแบบ'));});
test('เขียนเฉพาะสองคอลัมน์ที่ระบุ ไม่แตะคอลัมน์อื่น',()=>{const {RmSourceFix}=load();
  const s=sheetOf(grid([row('1000 , 700','1 , 25')]));
  const ss={getSheetByName:n=>n===s.name?s:null,insertSheet:()=>({getRange:()=>({setValues(){}}),hideSheet(){}})};
  RmSourceFix.apply(ss,s.name);
  const cols=[...new Set(s.writes.map(w=>w.col))].sort((a,b)=>a-b);
  assert.deepEqual(cols,[6,8],'ต้องเขียนแค่คอลัมน์ Price Tiers (6) และ MOQ (8)');
  assert.equal(s.writes.length,2);});
test('แถวที่ตีความไม่ชัดต้องไม่ถูกแตะ และถูกรายงานให้คนดู',()=>{const {RmSourceFix}=load();
  const s=sheetOf(grid([
    row('1500 , 1300','1-10, 100'),      // MOQ เป็นช่วง
    row('450 / ลัง','1 ลัง'),            // หน่วยไม่ใช่น้ำหนัก
    row('1000 / 700','1 / 25 / 100'),    // จำนวนไม่ตรง
    row('1000 , 700','1 , 25')]));       // อันนี้ปรับได้
  const ss={getSheetByName:n=>n===s.name?s:null,insertSheet:()=>({getRange:()=>({setValues(){}}),hideSheet(){}})};
  RmSourceFix.apply(ss,s.name);
  assert.equal(s.writes.length,2,'ต้องแก้แค่แถวเดียว = สองเซลล์');
  assert.deepEqual([...new Set(s.writes.map(w=>w.row))],[6],'แถวที่ 6 เท่านั้น');
  const p=RmSourceFix.plan(sheetOf(grid([row('1500 , 1300','1-10, 100')])));
  assert.equal(p.skipped.length,1);
  assert.match(p.skipped[0].notes,/MOQ_IS_A_RANGE/);});
test('สำรองค่าเดิมก่อนเขียนเสมอ และเก็บทั้งค่าเดิมและค่าใหม่',()=>{const {RmSourceFix}=load();
  const s=sheetOf(grid([row('1000 , 700','1 , 25')]));
  let backup=null;
  const ss={getSheetByName:n=>n===s.name?s:null,
    insertSheet:n=>{backup={name:n,rows:null};return {getRange:()=>({setValues:v=>{backup.rows=v;}}),hideSheet(){}};}};
  RmSourceFix.apply(ss,s.name);
  assert.ok(backup,'ต้องสร้างแท็บสำรอง');
  assert.match(backup.name,/^_backup_rawtiers_/);
  assert.equal(backup.rows.length,2,'หัวตาราง + หนึ่งแถว');
  assert.equal(backup.rows[1][2],'1 , 25','เก็บ MOQ เดิม');
  assert.equal(backup.rows[1][3],'1000 , 700','เก็บราคาเดิม');
  assert.equal(backup.rows[1][4],'1 kg / 25 kg','เก็บค่าใหม่ด้วย');
  assert.equal(backup.rows[1][7],'tester@example.test','บันทึกผู้รัน');});
test('ปฏิเสธถ้ามีแท็บสำรองชื่อซ้ำ แทนที่จะเขียนทับ',()=>{const {RmSourceFix}=load();
  const s=sheetOf(grid([row('1000 , 700','1 , 25')]));
  const ss={getSheetByName:n=>n===s.name?s:{existing:true},insertSheet:()=>{throw Error('ไม่ควรถูกเรียก');}};
  assert.throws(()=>RmSourceFix.apply(ss,s.name),/มีแท็บสำรอง/);
  assert.equal(s.writes.length,0,'ต้องไม่เขียนอะไรเมื่อสำรองไม่ได้');});
test('รันซ้ำแล้วไม่เขียนอีก เพราะค่าตรงอยู่แล้ว',()=>{const {RmSourceFix}=load();
  const s=sheetOf(grid([row('1000 , 700','1 , 25')]));
  const ss={getSheetByName:n=>n===s.name?s:null,insertSheet:()=>({getRange:()=>({setValues(){}}),hideSheet(){}})};
  RmSourceFix.apply(ss,s.name);
  const first=s.writes.length;
  const p=RmSourceFix.plan(s);
  assert.equal(p.changes.length,0,'รอบสองต้องไม่มีอะไรต้องเปลี่ยน');
  assert.equal(p.unchanged,1);
  assert.equal(s.writes.length,first,'และต้องไม่เขียนเพิ่ม');});
test('คืนค่าเดิมจากแท็บสำรองได้',()=>{const {RmSourceFix}=load();
  const s=sheetOf(grid([row('1000 / 700','1 kg / 25 kg')]));
  const backup=sheetOf([['SourceSheet','Row','MOQ (เดิม)','Price Tiers (เดิม)','MOQ (ใหม่)','Price Tiers (ใหม่)','RunAt','RunBy'],
    ['หลักฐานราคา',3,'1 , 25','1000 , 700','1 kg / 25 kg','1000 / 700','20260905','t']],'_backup_rawtiers_x');
  const ss={getSheetByName:n=>n===s.name?s:n===backup.name?backup:null};
  const out=RmSourceFix.restore(ss,backup.name,s.name);
  assert.match(out,/คืนค่าเดิมแล้ว 1 แถว/);
  assert.deepEqual(s.writes.map(w=>w.value),['1 , 25','1000 , 700']);});
test('ไม่พบหัวคอลัมน์ที่ต้องการ ต้องหยุด ไม่เดาตำแหน่ง',()=>{const {RmSourceFix}=load();
  const s=sheetOf([['A','B'],['1','2']]);
  assert.throws(()=>RmSourceFix.plan(s),/ไม่พบหัวคอลัมน์/);
  assert.equal(s.writes.length,0);});
