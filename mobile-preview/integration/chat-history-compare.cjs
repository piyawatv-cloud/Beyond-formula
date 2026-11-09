'use strict';
// Read-only experimental comparison; the caller supplies the legacy ID function.
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(object(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
function compareChatHistory(job,history,getUid){
 if(typeof job!=='string'||!/^[A-Z]+[0-9]{5}$/.test(job)||!object(history?.chat)||history.chat.jobId!==job)throw Error('รหัสงานไม่ตรง');
 if(!['ready','legacy-history','requires-reconciliation'].includes(history.status)||!Array.isArray(history.embeddedMessages)||!Array.isArray(history.messages)||typeof getUid!=='function')throw Error('ข้อมูลเปรียบเทียบไม่ครบ');
 const content=m=>{const copy=structuredClone(m);delete copy.uid;return canonical(copy)};
 const embedded=new Map(),table=new Map(),duplicates=new Set(),conflicts=new Set();
 for(const item of history.embeddedMessages){
  if(!object(item)||(Object.hasOwn(item,'jobId')&&item.jobId!==job))throw Error('ข้อมูลข้อความไม่ตรงงาน');
  const uid=getUid(job,structuredClone(item));if(typeof uid!=='string'||!uid||(Object.hasOwn(item,'uid')&&item.uid!==uid))throw Error('รหัสข้อความไม่ถูกต้อง');
  if(embedded.has(uid)){duplicates.add(uid);if(content(embedded.get(uid))!==content(item))conflicts.add(uid)}else embedded.set(uid,item);
 }
 for(const row of history.messages){
  if(!object(row)||row.job_id!==job||!object(row.data)||typeof row.uid!=='string'||!row.uid||(Object.hasOwn(row.data,'uid')&&row.data.uid!==row.uid)||(Object.hasOwn(row.data,'jobId')&&row.data.jobId!==job)||table.has(row.uid))throw Error('ข้อมูลข้อความไม่ตรงงาน');
  if(Object.hasOwn(row.data,'ts')&&(row.ts==null||String(row.ts)!==String(row.data.ts)))throw Error('เวลาข้อความไม่ตรง');
  table.set(row.uid,row.data);
 }
 const matching=[],embeddedOnly=[],tableOnly=[];
 for(const [uid,item] of embedded){if(!table.has(uid))embeddedOnly.push(uid);else if(content(item)===content(table.get(uid))&&!conflicts.has(uid))matching.push(uid);else conflicts.add(uid)}
 for(const uid of table.keys())if(!embedded.has(uid))tableOnly.push(uid);
 return {status:'compared',matching,embeddedOnly,tableOnly,conflicting:[...conflicts],duplicateEmbedded:[...duplicates]};
}
module.exports={compareChatHistory};
