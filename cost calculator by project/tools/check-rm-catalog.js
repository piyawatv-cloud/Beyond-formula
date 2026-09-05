#!/usr/bin/env node
'use strict';
// Offline RM catalog checker.
//
// Reads an RD Center export and reports which rows the Cost Calculator would
// accept, and exactly why the rest would be rejected. It IMPORTS NOTHING and
// WRITES NOTHING: no localStorage, no fs_cost, no network. Safe to run on a
// real export.
//
// It loads costParseCatalogRows out of index.html rather than copying the rules,
// so the report is what the application would actually do, not an approximation.
// Node built-ins only — the project forbids new dependencies.
//
//   node "cost calculator by project/tools/check-rm-catalog.js" <file.xlsx|.csv> [--show-values] [--json]
//
// Supplier names and prices are withheld from the report unless --show-values is
// given, so the output can be shared while diagnosing a mapping problem.

const fs=require('fs'),path=require('path'),vm=require('vm'),zlib=require('zlib');

// ---------- minimal xlsx reader (a xlsx file is a zip of xml) ----------
function unzip(buffer){
  const files={};
  let end=buffer.length-22;
  while(end>=0 && buffer.readUInt32LE(end)!==0x06054b50)end--;
  if(end<0)throw Error('ไม่ใช่ไฟล์ .xlsx ที่อ่านได้ (ไม่พบ zip directory)');
  let offset=buffer.readUInt32LE(end+16),count=buffer.readUInt16LE(end+10);
  for(let i=0;i<count;i++){
    if(buffer.readUInt32LE(offset)!==0x02014b50)throw Error('zip directory เสียหาย');
    const method=buffer.readUInt16LE(offset+10),size=buffer.readUInt32LE(offset+20);
    const nameLen=buffer.readUInt16LE(offset+28),extraLen=buffer.readUInt16LE(offset+30);
    const commentLen=buffer.readUInt16LE(offset+32),localOffset=buffer.readUInt32LE(offset+42);
    const name=buffer.toString('utf8',offset+46,offset+46+nameLen);
    const localNameLen=buffer.readUInt16LE(localOffset+26),localExtraLen=buffer.readUInt16LE(localOffset+28);
    const start=localOffset+30+localNameLen+localExtraLen;
    const raw=buffer.subarray(start,start+size);
    files[name]=method===0?raw:zlib.inflateRawSync(raw);
    offset+=46+nameLen+extraLen+commentLen;
  }
  return files;
}
const unescapeXml=text=>text.replace(/&#(\d+);/g,(m,d)=>String.fromCharCode(+d))
  .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
function sharedStrings(xml){
  if(!xml)return [];
  return (xml.toString('utf8').match(/<si[ >][\s\S]*?<\/si>/g)||[]).map(si=>
    (si.match(/<t[^>]*>([\s\S]*?)<\/t>/g)||[]).map(t=>unescapeXml(t.replace(/<[^>]+>/g,''))).join(''));
}
const columnIndex=ref=>{let n=0;for(const ch of ref.replace(/\d+/g,''))n=n*26+(ch.charCodeAt(0)-64);return n-1;};
function readSheet(xml,strings){
  const rows=[];
  for(const rowXml of xml.toString('utf8').match(/<row[ >][\s\S]*?<\/row>/g)||[]){
    const cells=[];
    for(const cellXml of rowXml.match(/<c\s[^>]*\/>|<c\s[^>]*>[\s\S]*?<\/c>/g)||[]){
      const ref=(cellXml.match(/r="([A-Z]+\d+)"/)||[])[1]; if(!ref)continue;
      const type=(cellXml.match(/t="([^"]+)"/)||[])[1];
      const inline=cellXml.match(/<is>[\s\S]*?<\/is>/);
      const raw=(cellXml.match(/<v>([\s\S]*?)<\/v>/)||[])[1];
      let value;
      if(type==='s')value=strings[Number(raw)];
      else if(type==='inlineStr'&&inline)value=(inline[0].match(/<t[^>]*>([\s\S]*?)<\/t>/g)||[]).map(t=>unescapeXml(t.replace(/<[^>]+>/g,''))).join('');
      else if(raw===undefined)value=undefined;
      else value=type==='str'?unescapeXml(raw):(Number.isFinite(Number(raw))?Number(raw):unescapeXml(raw));
      cells[columnIndex(ref)]=value;
    }
    rows.push(cells);
  }
  return rows;
}
// ---------- csv ----------
function readCsv(text){
  const rows=[];let row=[],field='',quoted=false;
  text=text.replace(/^﻿/,'');
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}
      else if(ch==='"')quoted=false;
      else field+=ch;
    } else if(ch==='"')quoted=true;
    else if(ch===','){row.push(field);field='';}
    else if(ch==='\r'){}
    else if(ch==='\n'){row.push(field);rows.push(row);row=[];field='';}
    else field+=ch;
  }
  if(field!==''||row.length){row.push(field);rows.push(row);}
  return rows;
}
function gridToObjects(grid){
  const header=(grid[0]||[]).map(cell=>String(cell===undefined?'':cell).trim());
  const body=grid.slice(1).filter(row=>row&&row.some(cell=>cell!==undefined&&String(cell).trim()!==''));
  return {header,rows:body.map(row=>{
    const object={};
    header.forEach((name,index)=>{if(name)object[name]=row[index];});
    return object;
  })};
}
// ---------- load the shipped parser ----------
function loadParser(){
  const htmlPath=path.resolve(__dirname,'../../index.html');
  const html=fs.readFileSync(htmlPath,'utf8');
  const block=html.match(/\/\/ COST_CALCULATOR_LOCAL_START([\s\S]*?)\/\/ COST_CALCULATOR_LOCAL_END/);
  if(!block)throw Error('ไม่พบบล็อก COST_CALCULATOR_LOCAL ใน index.html');
  const context={console,localStorage:{getItem:()=>null,setItem(){}},currentUser:'',currentRole:()=>'',userList:[]};
  vm.createContext(context);vm.runInContext(block[1],context);
  if(typeof context.costParseCatalogRows!=='function')throw Error('ไม่พบ costParseCatalogRows');
  return context;
}
// ---------- report ----------
function main(){
  const args=process.argv.slice(2);
  const showValues=args.includes('--show-values'),asJson=args.includes('--json');
  const file=args.find(a=>!a.startsWith('--'));
  if(!file){
    console.error('ใช้: node "cost calculator by project/tools/check-rm-catalog.js" <file.xlsx|.csv> [--show-values] [--json]');
    process.exit(2);
  }
  const buffer=fs.readFileSync(file);
  let grid,sheetName='(csv)';
  if(path.extname(file).toLowerCase()==='.csv'){
    grid=readCsv(buffer.toString('utf8'));
  }else{
    const files=unzip(buffer);
    const strings=sharedStrings(files['xl/sharedStrings.xml']);
    const workbook=(files['xl/workbook.xml']||Buffer.from('')).toString('utf8');
    sheetName=(workbook.match(/<sheet[^>]*name="([^"]*)"/)||[])[1]||'(sheet1)';
    const first=Object.keys(files).filter(n=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
    if(!first)throw Error('ไม่พบ worksheet ในไฟล์');
    grid=readSheet(files[first],strings);
  }
  const {header,rows}=gridToObjects(grid);
  const {costParseCatalogRows}=loadParser();
  const parsed=costParseCatalogRows(rows);

  // ตัวตนต้องมีเสมอ ส่วนที่เหลือคือข้อมูลเชิงพาณิชย์ที่ขาดได้แต่จะคิดต้นทุนไม่ได้
  const identity=['id','materialId','tierId','vendorId'];
  const required=identity.concat(['status','currency','price','priceUnit','moq','moqUnit','increment','incrementUnit','leadTimeDays','validUntil','evidenceRef','specApproved']);
  const lower=header.map(h=>h.toLowerCase());
  const missingColumns=required.filter(name=>!lower.includes(name.toLowerCase()));
  const reasons={};
  parsed.rejected.forEach(item=>{reasons[item.reason]=(reasons[item.reason]||0)+1;});
  // A confirmed, spec-approved, in-date offer is what the calculator can price.
  const today=new Date().toISOString().slice(0,10);
  const usable=parsed.offers.filter(o=>o.currency==='THB'&&o.status==='confirmed'&&o.specApproved===true&&o.validUntil>=today);

  if(asJson){
    console.log(JSON.stringify({file:path.basename(file),sheet:sheetName,header,missingColumns,
      total:rows.length,accepted:parsed.offers.length,rejected:parsed.rejected.length,usable:usable.length,
      reasons,rows:parsed.rejected},null,2));
    return;
  }
  const line='─'.repeat(64);
  console.log(`\nตรวจไฟล์แคตตาล็อก RM — ไม่มีการนำเข้าระบบ ไม่มีการเขียนไฟล์ใด ๆ\n${line}`);
  console.log(`ไฟล์      : ${path.basename(file)}   ชีต: ${sheetName}`);
  console.log(`คอลัมน์   : ${header.length} คอลัมน์`);
  if(missingColumns.length)console.log(`\n❌ ขาดคอลัมน์ที่จำเป็น ${missingColumns.length} คอลัมน์: ${missingColumns.join(', ')}\n   ทุกแถวจะถูกปฏิเสธจนกว่าจะเพิ่มคอลัมน์เหล่านี้`);
  else console.log(`✅ มีคอลัมน์ที่จำเป็นครบทั้ง ${required.length} คอลัมน์`);
  console.log(`${line}\nแถวข้อมูล : ${rows.length}`);
  console.log(`ผ่าน      : ${parsed.offers.length}`);
  console.log(`ไม่ผ่าน   : ${parsed.rejected.length}`);
  console.log(`นำไปคิดต้นทุนได้ทันที : ${usable.length}  (confirmed + spec approved + ยังไม่หมดอายุ)`);
  if(parsed.offers.length&&usable.length<parsed.offers.length)
    console.log(`   หมายเหตุ: อีก ${parsed.offers.length-usable.length} แถวรูปแบบถูกต้อง แต่ยังไม่ confirmed / ไม่ผ่าน spec / ราคาหมดอายุ`);
  if(parsed.rejected.length){
    console.log(`${line}\nสาเหตุที่ไม่ผ่าน (เรียงตามจำนวน)`);
    Object.entries(reasons).sort((a,b)=>b[1]-a[1]).forEach(([reason,count])=>console.log(`  ${String(count).padStart(5)} แถว  ${reason}`));
    console.log(`${line}\nรายแถว (30 แถวแรก)`);
    parsed.rejected.slice(0,30).forEach(item=>console.log(`  แถว ${String(item.row).padStart(5)}  ${item.reason}`));
    if(parsed.rejected.length>30)console.log(`  … อีก ${parsed.rejected.length-30} แถว (ใช้ --json เพื่อดูทั้งหมด)`);
  }
  if(showValues&&usable.length){
    console.log(`${line}\nตัวอย่างการตีความราคา (ยืนยันว่าอ่านหน่วยถูก — เปิดด้วย --show-values)`);
    usable.slice(0,5).forEach(o=>{
      const factor={kg:1,g:0.001,mg:0.000001};
      const perKg=o.price/(o.priceBasisQuantity*factor[o.priceUnit]);
      console.log(`  ${o.id}: ${o.price} ต่อ ${o.priceBasisQuantity} ${o.priceUnit}  →  ${perKg.toLocaleString('th-TH',{maximumFractionDigits:2})} บาท/กก.`);
    });
    console.log('  ตรวจบรรทัดบนนี้กับราคาจริง หากผิดแปลว่า priceUnit หรือ priceBasisQuantity ยังแมปไม่ถูก');
  } else if(usable.length){
    console.log(`${line}\nราคาและชื่อซัพพลายเออร์ถูกปิดไว้ — เพิ่ม --show-values หากต้องการตรวจการตีความหน่วย`);
  }
  console.log(`${line}`);
  console.log(parsed.offers.length===rows.length&&!missingColumns.length
    ? 'สรุป: ไฟล์นี้ผ่านทั้งหมด พร้อมนำเข้า'
    : 'สรุป: ยังไม่ผ่านทั้งหมด แก้ตามสาเหตุด้านบนแล้วรันซ้ำได้');
  console.log('เครื่องมือนี้ไม่ได้ยืนยันว่าราคาถูกต้องตามจริง ตรวจเฉพาะรูปแบบและความครบถ้วน\n');
}
module.exports={unzip,sharedStrings,readSheet,readCsv,gridToObjects,loadParser};
if(require.main===module){
  try{main();}catch(error){console.error('\nอ่านไฟล์ไม่สำเร็จ: '+error.message+'\n');process.exit(1);}
}
