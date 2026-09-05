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

test('tool uses shared workbook discovery and refuses repeated matching headers',()=>{
  const dir=fs.mkdtempSync(path.join(__dirname,'build-contract-'));
  try{const src=path.join(dir,'ambiguous.csv');const original=`${HEAD}\n${ROW}\n${HEAD}\n${ROW}\n`;fs.writeFileSync(src,original);assert.throws(()=>execFileSync(process.execPath,[TOOL,src],{encoding:'utf8',stdio:'pipe'}),error=>/AMBIGUOUS_TABLE/.test(String(error.stderr)));assert.equal(fs.readFileSync(src,'utf8'),original);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
// Minimal standards-compliant stored ZIP fixture, using Node built-ins only.
function zipFiles(files){let offset=0;const local=[],directory=[];for(const [name,content] of Object.entries(files)){const filename=Buffer.from(name),data=Buffer.from(content);let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;const head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50,0);head.writeUInt16LE(20,4);head.writeUInt32LE(crc,14);head.writeUInt32LE(data.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(filename.length,26);local.push(head,filename,data);const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);directory.push(central,filename);offset+=head.length+filename.length+data.length;}const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,central,end]);}
function xmlSheet(rows){const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;');const col=n=>n<26?String.fromCharCode(65+n):'A'+String.fromCharCode(65+n-26);return '<worksheet><sheetData>'+rows.map((row,r)=>'<row r="'+(r+1)+'">'+row.map((v,c)=>'<c r="'+col(c)+(r+1)+'" t="inlineStr"><is><t>'+esc(v)+'</t></is></c>').join('')+'</row>').join('')+'</sheetData></worksheet>';}
test('synthetic XLSX converts all source sheets to usable imported calculator offers',()=>{
 const dir=fs.mkdtempSync(path.join(__dirname,'build-workbook-'));
 try{
  const xlsx=zipFiles({'xl/workbook.xml':'<workbook><sheets><sheet name="Catalog"/><sheet name="Prices"/><sheet name="LT"/></sheets></workbook>',
   'xl/worksheets/sheet1.xml':xmlSheet([['RD-Code','Ingredient Name','Category','Price Status'],['RD-X-001','Synthetic material','A','READY']]),
   'xl/worksheets/sheet2.xml':xmlSheet([['RD-Code','Master Ingredient','Master Supplier','Price Tiers (Raw)','MOQ / Qty','Source','Price Date','Order Increment (kg)','Price Valid Until','Spec Approved'],['RD-X-001','Synthetic material','Synthetic vendor','100 / 80','1 / 25','SYNTHETIC-EVIDENCE','2026-01-01',1,'2999-01-01','TRUE']]),
   'xl/worksheets/sheet3.xml':xmlSheet([['Offered Ingredient','Lead Time'],['Synthetic material','14 วัน']])});
  const src=path.join(dir,'source.xlsx'),out=path.join(dir,'catalog.csv');fs.writeFileSync(src,xlsx);
  const stdout=execFileSync(process.execPath,[TOOL,src,'-o',out],{encoding:'utf8'});assert.match(stdout,/พร้อมคิดต้นทุนทันที\s+:\s*2/);assert.deepEqual(fs.readFileSync(src),xlsx);
  const {readCsv,gridToObjects}=require('../tools/check-rm-catalog.js');const rows=gridToObjects(readCsv(fs.readFileSync(out,'utf8'))).rows;
  const vm=require('node:vm'),ctx={};const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');for(const part of ['CORE','LOCAL'])vm.runInNewContext(html.match(new RegExp('// COST_CALCULATOR_'+part+'_START([\\s\\S]*?)// COST_CALCULATOR_'+part+'_END'))[1],ctx);
  const imported=ctx.costParseCatalogRows(rows);assert.equal(imported.rejected.length,0);assert.equal(imported.offers.length,2);
  const offer=imported.offers[0];const result=ctx.CostCalculator.calculate({projectId:'A00001',scenarioId:'S1',revision:1,currency:'THB',sellingUnits:1000,unitsPerPack:1,fillAmount:1,fillUnit:'g',rmLines:[{id:'L1',materialId:offer.materialId,amount:1,unit:'g',lossPercent:0,offer}],policies:{},extraCosts:[]},'2026-09-05');assert.equal(result.rm.ready,true);assert.equal(result.rm.baseTotal,100);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
