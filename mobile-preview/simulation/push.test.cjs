'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {createLab}=require('./push-lab.cjs');
async function main(){
 let captured=[],handlers={};
 let self={registration:{showNotification:async(title,opts)=>captured.push({title,opts})},addEventListener:(name,fn)=>{handlers[name]=fn},location:{origin:'https://simulation.invalid'},clients:{matchAll:async()=>[],openWindow:async url=>captured.push({opened:url})}};
 vm.runInNewContext(fs.readFileSync(__dirname+'/notification-worker.js','utf8'),{self,URL,Promise});
 const sendToWorker=async payload=>{let pending;handlers.push({data:{json:()=>payload},waitUntil:p=>{pending=p}});await pending};
 let lab=createLab(sendToWorker);lab.register({id:'d-pd',user:'pd',allowedJobs:['A00001']});lab.register({id:'d-sales',user:'sales',allowedJobs:['A00001']});lab.register({id:'d-ra',user:'ra',allowedJobs:['A00002']});
 let event={id:'event-1',jobId:'A00001',actor:'sales',kind:'chat',message:'ข้อมูลลับจำลอง'};
 await lab.deliver(event);await lab.deliver(event);
 assert.equal(captured.length,1,'ส่งเฉพาะผู้รับที่มีสิทธิ์ ไม่ส่งตนเอง และไม่ส่งซ้ำ');
 assert.equal(captured[0].title,'Formula Studio'); assert.ok(!JSON.stringify(captured[0]).includes('ข้อมูลลับจำลอง'),'หน้าล็อกไม่แสดงข้อมูลลับ');
 lab.revoke('d-pd');await lab.deliver({id:'event-2',jobId:'A00001',actor:'sales',kind:'update'});assert.equal(captured.length,1,'อุปกรณ์ถอนสิทธิ์ต้องไม่ได้รับ');
 let badWait;handlers.push({data:{json:()=>{throw Error('bad fixture')}},waitUntil:p=>{badWait=p}});await badWait;assert.equal(captured.at(-1).opts.body,'มีความเคลื่อนไหวใน Formula Studio');
 let notificationClosed=false,pending;handlers.notificationclick({notification:{data:captured[0].opts.data,close:()=>{notificationClosed=true}},waitUntil:p=>{pending=p}});await pending;assert.equal(notificationClosed,true);assert.equal(captured[2].opened,'https://simulation.invalid/');
 let broken=createLab(async()=>{throw Error('offline')});broken.register({id:'d',user:'pd',allowedJobs:['A00001']});let outcome=await broken.deliver(event);assert.equal(outcome.failed,1);assert.equal(outcome.delivered,0);
 let retries=0;let recovering=createLab(async()=>{if(++retries===1)throw Error('offline')});recovering.register({id:'d',user:'pd',allowedJobs:['A00001']});assert.equal((await recovering.deliver(event)).failed,1);assert.equal((await recovering.deliver(event)).delivered,1);assert.equal((await recovering.deliver(event)).delivered,0);
 let deliveries=0;const parallel=createLab(async()=>{deliveries++;await Promise.resolve()});parallel.register({id:'d',user:'pd',allowedJobs:['A00001']});await Promise.all([parallel.deliver(event),parallel.deliver(event)]);assert.equal(deliveries,1,'การส่งพร้อมกันต้องไม่ซ้ำ');
 console.log('PASS: isolated push simulator, closed-client worker, duplicate, permission, privacy, failure and retry');
}
main().catch(e=>{console.error(e);process.exitCode=1});
