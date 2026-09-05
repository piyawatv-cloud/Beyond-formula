'use strict';
// The offline checker must agree with the shipped parser and must never write.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const TOOL=path.join(__dirname,'../tools/check-rm-catalog.js');
const HEADER='id,materialId,tierId,vendorId,name,status,currency,price,priceUnit,moq,moqUnit,increment,incrementUnit,leadTimeDays,validUntil,evidenceRef,specApproved,priceBasisQuantity';
const GOOD='O1,M1,T1,V1,สาร A,confirmed,THB,100,kg,2,kg,1,kg,10,2030-01-01,E1,true,1';
function run(csv,args=[]){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rmcheck-'));
  const file=path.join(dir,'catalog.csv');
  fs.writeFileSync(file,csv);
  const before=fs.readdirSync(dir);
  const out=execFileSync(process.execPath,[TOOL,file,...args],{encoding:'utf8'});
  assert.deepEqual(fs.readdirSync(dir),before,'the checker must not create or remove files');
  assert.equal(fs.readFileSync(file,'utf8'),csv,'the checker must not modify the input');
  fs.rmSync(dir,{recursive:true,force:true});
  return out;
}
test('a clean file reports every row accepted and usable',()=>{
  const report=JSON.parse(run(`${HEADER}\n${GOOD}\n`,['--json']));
  assert.equal(report.total,1);assert.equal(report.accepted,1);
  assert.equal(report.rejected,0);assert.equal(report.usable,1);
  assert.deepEqual(report.missingColumns,[]);
});
test('missing columns are named rather than reported as a row problem',()=>{
  const report=JSON.parse(run('id,name\nO1,สาร A\n',['--json']));
  assert.ok(report.missingColumns.includes('price'));
  assert.ok(report.missingColumns.includes('validUntil'));
  assert.equal(report.accepted,0);
});
test('each bad row is reported with its spreadsheet row number and reason',()=>{
  const report=JSON.parse(run(`${HEADER}\n${GOOD}\n${GOOD.replace(',100,kg,',',,kg,')}\n${GOOD.replace('2030-01-01','2030-02-30')}\n`,['--json']));
  assert.equal(report.accepted,1);assert.equal(report.rejected,2);
  assert.equal(report.rows[0].row,3);assert.match(report.rows[0].reason,/price/);
  assert.equal(report.rows[1].row,4);assert.match(report.rows[1].reason,/validUntil/);
});
test('a structurally valid but unconfirmed offer is accepted yet not usable',()=>{
  const report=JSON.parse(run(`${HEADER}\n${GOOD.replace(',confirmed,',',draft,')}\n`,['--json']));
  assert.equal(report.accepted,1);assert.equal(report.usable,0);
});
test('prices and vendors stay hidden unless --show-values is given',()=>{
  const csv=`${HEADER}\n${GOOD.replace('V1','ACME_SUPPLIER')}\n`;
  assert.ok(!run(csv).includes('ACME_SUPPLIER'));
  assert.ok(!run(csv).includes('100 ต่อ'));
  assert.ok(run(csv,['--show-values']).includes('100 ต่อ 1 kg'));
});
test('a per-pack price is converted, not read as a per-kilogram price',()=>{
  // The RM contract calls this out explicitly: 1400/25kg is 56/kg, not 1400/kg.
  const row=GOOD.replace(',100,kg,2,kg,1,kg,',',1400,kg,25,kg,25,kg,').replace(/,1$/,',25');
  const out=run(`${HEADER}\n${row}\n`,['--show-values']);
  assert.match(out,/1400 ต่อ 25 kg/);
  assert.match(out,/56 บาท\/กก\./);
});

// ── xlsx cell reader ──────────────────────────────────────────────────────
// Excel writes a filled-down formula as a self-closing <f t="shared" si="n"/>.
// A reader that stops at the first "/>" drops the cached <v> and reports a
// populated cell as empty, which turns a correct file into a wall of bogus
// "ขาดข้อมูล" rejections. Regression for that.
const {readSheet,gridToObjects}=require('../tools/check-rm-catalog.js');
const sheet=cells=>Buffer.from('<worksheet><sheetData><row r="1">'+cells+'</row></sheetData></worksheet>');

test('a shared-formula cell keeps its cached value',()=>{
  const rows=readSheet(sheet('<c r="A1" s="1"><f t="shared" si="0"/><v>5.2E-4</v></c>'),[]);
  assert.equal(rows[0][0],5.2e-4);
});
test('a normal formula cell keeps its cached value',()=>{
  const rows=readSheet(sheet('<c r="A1"><f>130/1000</f><v>0.13</v></c>'),[]);
  assert.equal(rows[0][0],0.13);
});
test('an empty self-closing cell does not swallow the cells after it',()=>{
  const rows=readSheet(sheet('<c r="A1" s="2"/><c r="B1"><v>7</v></c>'),[]);
  assert.equal(rows[0][0],undefined);
  assert.equal(rows[0][1],7);
});
test('shared strings, inline strings and column letters resolve correctly',()=>{
  const rows=readSheet(sheet('<c r="A1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>สด</t></is></c><c r="AA1"><v>9</v></c>'),['ก','ข']);
  assert.equal(rows[0][0],'ข');
  assert.equal(rows[0][2],'สด');
  assert.equal(rows[0][26],9);
});
test('a row of shared-formula cells still maps onto its header',()=>{
  const xml=Buffer.from('<worksheet><sheetData>'
    +'<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
    +'<row r="2"><c r="A2"><v>4</v></c><c r="B2"><f t="shared" si="0"/><v>0.5</v></c></row>'
    +'</sheetData></worksheet>');
  const {header,rows}=gridToObjects(readSheet(xml,['price','cost']));
  assert.deepEqual(header,['price','cost']);
  assert.equal(rows[0].cost,0.5,'the computed column must not read as blank');
});

// QA พบว่า specApproved ไม่มีการทดสอบฝั่งปฏิเสธเลย ทั้งที่เป็นด่านตัดสินว่าใช้ได้หรือไม่
const rowObj=extra=>({id:'O1',materialId:'M1',tierId:'T1',vendorId:'V1',status:'confirmed',currency:'THB',
  price:'100',priceUnit:'kg',moq:'2',moqUnit:'kg',increment:'1',incrementUnit:'kg',leadTimeDays:'10',
  validUntil:'2030-01-01',evidenceRef:'E1',specApproved:'true',...extra});
test('specApproved ที่ไม่ใช่คำยืนยันต้องแปลว่ายังไม่รับรอง',()=>{
  const {costParseCatalogRows}=require('../tools/check-rm-catalog.js').loadParser();
  for(const value of ['no','false','FALSE','0','ไม่','ยังไม่','pending','-']){
    const parsed=costParseCatalogRows([rowObj({specApproved:value})]);
    assert.equal(parsed.offers.length,1,value+' ต้องยังนำเข้าได้');
    assert.equal(parsed.offers[0].specApproved,false,value+' ต้องไม่ถือว่ารับรองแล้ว');
  }
  for(const value of ['true','TRUE','yes','1','ใช่']){
    const parsed=costParseCatalogRows([rowObj({specApproved:value})]);
    assert.equal(parsed.offers[0].specApproved,true,value);
  }
});
test('แถวที่ยังไม่รับรอง spec ต้องไม่ถูกนับว่าพร้อมคิดต้นทุน',()=>{
  const report=JSON.parse(run(`${HEADER}\n${GOOD.replace(',true,1',',false,1')}\n`,['--json']));
  assert.equal(report.accepted,1,'ยังนำเข้าได้');
  assert.equal(report.usable,0,'แต่ต้องไม่พร้อมใช้');
});
