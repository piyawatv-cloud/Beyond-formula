'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {createDurableLab}=require('./durable-lab.cjs');
async function main(){
 if(process.argv[2]==='child') {const db=createDurableLab(process.argv[3]);const result=db.submit({id:'event-1',actor:'sales',jobId:'A00001',kind:'chat',text:'ข้อความจำลอง'});assert.equal(result.created,false);const o=await db.dispatch(async()=>{throw Error('must not resend')});assert.equal(o.attempted,0);db.close();console.log('child PASS');return;}
 let dir=fs.mkdtempSync(path.join(os.tmpdir(),'formula-durable-fixture-')),file=path.join(dir,'mock.sqlite');
 try{
  let lab=createDurableLab(file);lab.register({id:'pd-phone',user:'pd'});lab.register({id:'sales-phone',user:'sales'});lab.register({id:'ra-phone',user:'ra'});
  const event={id:'event-1',actor:'sales',jobId:'A00001',kind:'chat',text:'ข้อความจำลอง'};
  assert.equal(lab.submit(event).created,true);let deliveries=[];
  let r=await lab.dispatch(async(payload,id)=>deliveries.push({payload,id}));assert.equal(r.delivered,2);assert.deepEqual(deliveries.map(d=>d.id).sort(),['pd-phone','ra-phone']);assert.ok(!JSON.stringify(deliveries).includes(event.text));lab.close();
  let child=spawnSync(process.execPath,[__filename,'child',file],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/child PASS/);
  lab=createDurableLab(file);assert.throws(()=>lab.submit({...event,text:'ต่างออกไป'}));assert.throws(()=>lab.submit({id:'bad',actor:'sales',jobId:'A00002',kind:'chat',text:'ไม่มีสิทธิ์'}));
  lab.submit({id:'event-2',actor:'sales',jobId:'A00001',kind:'update',text:'เปลี่ยนข้อมูล'});lab.revoke('pd-phone');r=await lab.dispatch(async(p,id)=>{assert.equal(id,'ra-phone')});assert.equal(r.delivered,1);lab.close();
  lab=createDurableLab(file);lab.register({id:'role-change-phone',user:'pd'});lab.submit({id:'role-change-event',actor:'opc',jobId:'A00002',kind:'chat',text:'งานคนอื่น'});lab.register({id:'role-change-phone',user:'sales'});let seen=[];r=await lab.dispatch(async(p,id)=>seen.push(id));assert.ok(!seen.includes('role-change-phone'),'ผู้รับที่เปลี่ยนบทบาทต้องไม่รับงานนอกสิทธิ์');
  lab.submit({id:'event-3',actor:'sales',jobId:'A00001',kind:'chat',text:'ขาดการเชื่อมต่อ'});r=await lab.dispatch(async()=>{throw Error('unknown outcome')});assert.equal(r.uncertain,1);lab.close();
  lab=createDurableLab(file);r=await lab.dispatch(async()=>{throw Error('must not retry uncertain')});assert.equal(r.attempted,0);assert.equal(lab.count('uncertain'),1);
  lab.submit({id:'crash-event',actor:'sales',jobId:'A00001',kind:'chat',text:'จำลองหยุดระหว่างส่ง'});lab.close();
  const {DatabaseSync}=require('node:sqlite');const raw=new DatabaseSync(file);raw.prepare("UPDATE fixture_deliveries SET status='sending' WHERE event_id='crash-event'").run();raw.close();
  lab=createDurableLab(file);assert.equal(lab.count('uncertain'),2,'รายการที่ค้างระหว่างส่งต้องไม่ถูกส่งซ้ำเอง');r=await lab.dispatch(async()=>{throw Error('must not resend interrupted delivery')});assert.equal(r.attempted,0);lab.close();
  let changing=createDurableLab(path.join(dir,'permissions.sqlite'));changing.register({id:'first',user:'pd'});changing.register({id:'second',user:'ra'});changing.submit({id:'changes',actor:'sales',jobId:'A00001',kind:'chat',text:'จำลอง'});let sent=[];await changing.dispatch(async(p,id)=>{sent.push(id);if(id==='first')changing.revoke('second')});assert.deepEqual(sent,['first'],'ตรวจสิทธิ์ล่าสุดก่อนส่งแต่ละอุปกรณ์');changing.close();
  console.log('PASS: durable fixture restart, rights, duplicate, revoked device, uncertain delivery');
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exitCode=1});
