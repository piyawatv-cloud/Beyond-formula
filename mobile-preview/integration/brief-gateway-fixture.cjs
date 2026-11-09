'use strict';
// Exercises the actual in-page brief readers against fake form inputs.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const model=html.match(/<script id="model">([\s\S]*?)<\/script>/);
const reader=html.match(/const readRows=\(\)=>[\s\S]*?;const drawRows=/);
const submit=html.match(/let values=Object\.fromEntries\(new FormData\(e\.target\)\);[\s\S]*?;if\(id\)\{/);
if(!model||!reader||!submit)throw Error('mobile brief code not found');
function readBrief(record,fields,rowEdits={}){
 const draftRows=structuredClone(record.rows);
 const ctx={module:{exports:{}},draftRows,j:record,e:{target:{}},id:record.id,role:'sales',can:()=>true,FormData:class{constructor(){return Object.entries(fields)}},$:id=>{
  const match=/^brief-(name|w|o|p|note|hero|remove)-(\d+)$/.exec(id);if(!match)throw Error('unexpected fixture input');
  const index=Number(match[2]),row=draftRows[index];return match[1]==='hero'?{checked:!!row.hero}:match[1]==='remove'?{checked:false}:{value:String(rowEdits[index]?.[match[1]]??row[match[1]]??'')};
 }};
 vm.createContext(ctx);vm.runInContext(model[1],ctx);
 vm.runInContext(reader[0].replace(/;const drawRows=$/,';globalThis.readRows=readRows;'),ctx);
 vm.runInContext('globalThis.collect=()=>{'+submit[0].replace(/;if\(id\)\{$/,';values.rows=rows;return values;}'),ctx);
 return JSON.parse(JSON.stringify(ctx.collect()));
}
module.exports={readBrief};
