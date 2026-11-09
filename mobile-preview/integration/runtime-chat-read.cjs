'use strict';
// Experimental read contract only. No credentials, authorization, or network config.
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
async function readChatHistory(id,read,isCurrent){
 if(typeof id!=='string'||!/^[A-Z]+[0-9]{5}$/.test(id))throw Error('รหัสงานไม่ถูกต้อง');
 if(typeof read!=='function')throw Error('ไม่มีตัวอ่านประวัติ');
 if(typeof isCurrent!=='function')throw Error('ต้องตรวจรุ่นเซสชัน');
 const current=()=>{try{return isCurrent()===true}catch{return false}};
 if(!current())return {status:'session-changed'};
 try{
  const payload=await read('/__formula/scoped-chat-history?job_id='+encodeURIComponent('eq.'+id));
  if(!current())return {status:'session-changed'};
  if(!object(payload)||!Array.isArray(payload.chats)||!Array.isArray(payload.messages)||payload.chats.length>1)return {status:'unconfirmed'};
  const chat=payload.chats[0];
  if(!chat)return payload.messages.length?{status:'unconfirmed'}:{status:'no-chat'};
  if(!object(chat)||chat.job_id!==id||!object(chat.data)||chat.data.jobId!==id)return {status:'unconfirmed'};
  const embedded=chat.data.messages??[];
  if(!Array.isArray(embedded)||embedded.some(m=>!object(m)||(Object.hasOwn(m,'jobId')&&m.jobId!==id)))return {status:'unconfirmed'};
  const ids=new Set();
  for(const row of payload.messages){
   if(!object(row)||row.job_id!==id||typeof row.uid!=='string'||!row.uid||ids.has(row.uid)||!object(row.data)||(Object.hasOwn(row.data,'jobId')&&row.data.jobId!==id)||(Object.hasOwn(row.data,'uid')&&row.data.uid!==row.uid))return {status:'unconfirmed'};
   ids.add(row.uid);
  }
  const status=embedded.length?(payload.messages.length?'requires-reconciliation':'legacy-history'):'ready';
  return {status,chat:structuredClone(chat.data),messages:structuredClone(payload.messages),embeddedMessages:structuredClone(embedded)};
 }catch{return current()?{status:'unconfirmed'}:{status:'session-changed'}}
}
module.exports={readChatHistory};
