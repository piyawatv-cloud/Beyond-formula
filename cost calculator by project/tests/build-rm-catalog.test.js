'use strict';
// เครื่องมือแปลง export จาก RD Data Center เป็นไฟล์นำเข้า
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const TOOL=path.join(__dirname,'../tools/build-rm-catalog.js');
const HEAD='RD-Code,Master Ingredient,Master Supplier,Price-source Ingredient (editable),Price-source Supplier (editable),Source,Price Tiers (Raw),MOQ / Qty,Price Date';
const ROW='RD-A-001,สาร ก.,ผู้ขาย ก.,สาร ก.,ผู้ขาย ก.,PRICE,"1000 , 700","1 , 25",2026-01-01';
function run(csv,withOut){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rmbuild-'));
  const src=path.join(dir,'dc.csv');fs.writeFileSync(src,csv);
  const out=withOut?path.join(dir,'catalog.csv'):null;
  const stdout=execFileSync(process.execPath,out?[TOOL,src,'-o',out]:[TOOL,src],{encoding:'utf8'});
  assert.equal(fs.readFileSync(src,'utf8'),csv,'ต้องไม่แก้ไฟล์ต้นทาง');
  const written=out&&fs.existsSync(out)?fs.readFileSync(out,'utf8'):null;
  fs.rmSync(dir,{recursive:true,force:true});
  return {stdout,written};
}
test('หาตารางจับคู่ราคาเจอเองและรายงานจำนวนที่ประกอบได้',()=>{
  const {stdout}=run(`${HEAD}\n${ROW}\n`);
  assert.match(stdout,/ตารางจับคู่ราคา/);
  assert.match(stdout,/ข้อเสนอที่ประกอบได้\s+:\s*2/,'สองราคา = สองข้อเสนอ');
});
test('เขียนไฟล์นำเข้าที่มีคอลัมน์ครบตามรูปแบบที่ตัวนำเข้าต้องการ',()=>{
  const {written}=run(`${HEAD}\n${ROW}\n`,true);
  assert.ok(written);
  const cols=written.replace(/^﻿/,'').split('\n')[0].split(',');
  for(const c of ['id','materialId','tierId','vendorId','price','priceUnit','moq','moqUnit',
    'increment','incrementUnit','leadTimeDays','validUntil','evidenceRef','specApproved'])
    assert.ok(cols.includes(c),c);
  assert.ok(cols.includes('ต้องกรอกอะไร'),'ต้องบอกด้วยว่าแต่ละแถวขาดอะไร');
  const rows=written.trim().split('\n').slice(1);
  assert.equal(rows.length,2);
  assert.ok(rows[0].startsWith('RD-A-001-T1,RD-A-001,T1,'),'ตัวตนต้องมาจาก RD-Code');
});
test('ไม่พบตารางที่ต้องการต้องหยุดพร้อมบอกว่าต้องมีคอลัมน์อะไร',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rmbuild-'));
  const src=path.join(dir,'x.csv');fs.writeFileSync(src,'a,b\n1,2\n');
  let failed=false;
  try{execFileSync(process.execPath,[TOOL,src],{encoding:'utf8',stdio:'pipe'});}
  catch(e){failed=true;assert.match(String(e.stderr),/RD-Code/);}
  fs.rmSync(dir,{recursive:true,force:true});
  assert.ok(failed,'ต้องจบด้วยความล้มเหลว ไม่ใช่เขียนไฟล์ว่าง');
});
test('แถวที่ตีความไม่ได้ถูกข้ามพร้อมเหตุผล ไม่เงียบ',()=>{
  const {stdout}=run(`${HEAD}\nRD-A-002,ข,ผ,ข,ผ,PRICE,"1500 , 1300","1-10, 100",2026-01-01\n`);
  assert.match(stdout,/เหตุผลที่ข้าม/);
  assert.match(stdout,/MOQ_IS_A_RANGE/);
  assert.match(stdout,/ข้อเสนอที่ประกอบได้\s+:\s*0/);
});
test('บอกจำนวนที่ยังคิดต้นทุนไม่ได้ และขาดอะไรบ้าง',()=>{
  const {stdout}=run(`${HEAD}\n${ROW}\n`);
  assert.match(stdout,/พร้อมคิดต้นทุนทันที\s+:\s*0/);
  assert.match(stdout,/ขนาดสั่งเพิ่ม/);
  assert.match(stdout,/วันหมดอายุราคา/);
  assert.match(stdout,/การรับรอง spec/);
});
