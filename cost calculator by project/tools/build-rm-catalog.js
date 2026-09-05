#!/usr/bin/env node
'use strict';
// แปลง export จาก RD Data Center ให้เป็นไฟล์นำเข้าแคตตาล็อกของเครื่องคำนวณ
//
// อ่านอย่างเดียว ไม่เขียนกลับต้นทาง ไม่ต่อเน็ต ใช้ตัวอ่านและตรรกะเดียวกับที่ทดสอบไว้
// (RmSourceMap + RmCatalogBuild) จึงไม่มีกฎสองชุดให้เพี้ยนกัน
//
//   node "cost calculator by project/tools/build-rm-catalog.js" <DataCenter.xlsx> [-o catalog.csv]
//
// หาแท็บเอง: แท็บที่มี RD-Code + Price Tiers (Raw) คือตารางจับคู่ราคา
//            แท็บที่มี RD-Code + Ingredient Name คือแคตตาล็อกสาร
//            แท็บที่มี Offered Ingredient + Lead Time คือแหล่ง Lead Time
const fs=require('fs'),path=require('path'),vm=require('vm');
const {unzip,sharedStrings,readSheet,readCsv}=require('./check-rm-catalog.js');

function loadDomain(){
  const ctx={};vm.createContext(ctx);
  for(const f of ['RmSourceMap.gs','RmCatalogBuild.gs'])
    vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../apps_script/',f),'utf8'),ctx);
  return ctx;
}
function sheetsOf(file){
  if(path.extname(file).toLowerCase()==='.csv')
    return [{name:path.basename(file),grid:readCsv(fs.readFileSync(file,'utf8'))}];
  const files=unzip(fs.readFileSync(file));
  const strings=sharedStrings(files['xl/sharedStrings.xml']);
  const wb=(files['xl/workbook.xml']||Buffer.from('')).toString('utf8');
  const names=[...wb.matchAll(/<sheet[^>]*name="([^"]*)"/g)].map(m=>m[1]);
  return Object.keys(files).filter(n=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a,b)=>a.length-b.length||a.localeCompare(b))
    .map((n,i)=>({name:names[i]||n,grid:readSheet(files[n],strings)}));
}
// Keep the helper export compatible; discovery belongs to the shared domain.
function findTable(sheets,required){return loadDomain().RmCatalogBuild.findTable(sheets,required);}
function csv(rows,cols){
  const q=v=>{const s=v===null||v===undefined?'':String(v);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
  return '﻿'+[cols.join(','),...rows.map(r=>cols.map(c=>q(r[c])).join(','))].join('\n');
}
function main(){
  const args=process.argv.slice(2);
  const outAt=args.indexOf('-o');
  const out=outAt>=0?args[outAt+1]:null;
  // เมื่อไม่มี -o ค่า outAt เป็น -1 จึงต้องไม่ตัด index 0 ซึ่งคือไฟล์อินพุต
  const skip=outAt>=0?outAt+1:-1;
  const file=args.find((a,i)=>!a.startsWith('-')&&i!==skip);
  if(!file){
    console.error('ใช้: node "cost calculator by project/tools/build-rm-catalog.js" <DataCenter.xlsx> [-o catalog.csv]');
    process.exit(2);
  }
  const sheets=sheetsOf(file);
  const {RmCatalogBuild}=loadDomain();
  const built=RmCatalogBuild.fromSheets(sheets);
  const {priceMap,catalog,offered}=built.tables;
  const cols=['id','materialId','tierId','vendorId','name','group','spec','vendor','status','specApproved',
    'currency','price','priceUnit','priceBasisQuantity','moq','moqUnit','increment','incrementUnit',
    'leadTimeDays','validUntil','evidenceRef'];
  const line='─'.repeat(64);
  console.log(`\nประกอบแคตตาล็อกจาก RD Data Center — อ่านอย่างเดียว ไม่เขียนกลับต้นทาง\n${line}`);
  console.log(`ตารางจับคู่ราคา : ${priceMap.sheet} (${priceMap.rowCount} แถว)`);
  console.log(`แคตตาล็อกสาร   : ${catalog?catalog.sheet+' ('+catalog.rowCount+' แถว)':'ไม่พบ — ชื่อสารจะมาจากตารางจับคู่ราคาแทน'}`);
  console.log(`แหล่ง Lead Time : ${offered?offered.sheet+' ('+offered.rowCount+' แถว)':'ไม่พบ — Lead Time จะว่างทุกแถว'}`);
  console.log(`${line}`);
  console.log(`สารทั้งหมด            : ${built.summary.materials}`);
  console.log(`ข้อเสนอที่ประกอบได้   : ${built.summary.offers}`);
  console.log(`  เติม Lead Time ได้  : ${built.summary.withLeadTime}`);
  console.log(`  พร้อมคิดต้นทุนทันที : ${built.summary.usable}`);
  console.log(`ข้าม                  : ${built.summary.skipped}`);
  if(built.summary.offers){
    const miss={};built.offers.forEach(o=>o.missing.forEach(m=>{miss[m]=(miss[m]||0)+1;}));
    if(Object.keys(miss).length){
      console.log(`${line}\nยังขาดอะไร (ต้องเติมก่อนจึงจะคิดต้นทุนได้)`);
      Object.entries(miss).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`  ${String(v).padStart(4)} แถว  ${k}`));
    }
  }
  const reasons={};built.skipped.forEach(s=>{reasons[s.reason]=(reasons[s.reason]||0)+1;});
  if(Object.keys(reasons).length){
    console.log(`${line}\nเหตุผลที่ข้าม`);
    Object.entries(reasons).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([k,v])=>console.log(`  ${String(v).padStart(4)} แถว  ${k}`));
  }
  if(out){
    fs.writeFileSync(out,csv(built.offers,cols.concat(['missing'])
      .map(c=>c)) .replace('missing','ต้องกรอกอะไร'));
    console.log(`${line}\nเขียนไฟล์นำเข้าแล้ว: ${out}`);
    console.log('เติมคอลัมน์ที่ยังว่าง แล้วนำเข้าผ่านปุ่มนำเข้าแคตตาล็อกในแอปได้เลย');
  } else {
    console.log(`${line}\nเพิ่ม -o <ไฟล์.csv> เพื่อเขียนไฟล์สำหรับนำเข้า`);
  }
  console.log('');
}
module.exports={findTable,sheetsOf};
if(require.main===module){
  try{main();}catch(e){console.error('\nทำไม่สำเร็จ: '+e.message+'\n');process.exit(1);}
}
