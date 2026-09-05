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
