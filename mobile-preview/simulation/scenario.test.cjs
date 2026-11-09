'use strict';
const assert=require('node:assert/strict');
const {createScenario}=require('./scenario-lab.cjs');
async function main(){
  const observed=[];const lab=createScenario(async (payload,id)=>observed.push({payload,id}));
  lab.register({id:'pd-phone',user:'pd'});lab.register({id:'sales-phone',user:'sales'});lab.register({id:'ra-phone',user:'ra'});
  let result=await lab.perform({id:'e1',actor:'sales',jobId:'A00001',kind:'chat',text:'ข้อความจำลอง'});
  assert.equal(result.delivered,2);assert.deepEqual(observed.map(x=>x.id).sort(),['pd-phone','ra-phone']);
  assert.ok(observed.every(x=>!JSON.stringify(x.payload).includes('ข้อความจำลอง')));
  assert.equal(lab.state.jobs.find(j=>j.id==='A00001').messages.length,2);
  result=await lab.perform({id:'e1',actor:'sales',jobId:'A00001',kind:'chat',text:'ข้อความจำลอง'});
  assert.equal(result.delivered,0);assert.equal(lab.state.jobs.find(j=>j.id==='A00001').messages.length,2);
  await assert.rejects(lab.perform({id:'e2',actor:'sales',jobId:'A00002',kind:'chat',text:'ปฏิเสธ'}));assert.equal(observed.length,2);
  await assert.rejects(lab.perform({id:'e3',actor:'ra',jobId:'A00001',kind:'update',text:'ปฏิเสธ'}));assert.equal(observed.length,2);
  result=await lab.perform({id:'e4',actor:'sales',jobId:'A00001',kind:'update',text:'แก้ไขจำลอง'});assert.equal(result.delivered,2);
  await assert.rejects(lab.perform({id:'e4',actor:'pd',jobId:'A00001',kind:'chat',text:'เปลี่ยนข้อมูล'}));
  result=await lab.perform({id:'e7',actor:'opc',jobId:'A00002',kind:'update',text:'งานผู้อื่น'});assert.equal(result.delivered,2);assert.equal(observed.filter(x=>x.id==='sales-phone').length,0,'Sales ไม่รับงานผู้อื่น');
  lab.revoke('ra-phone');result=await lab.perform({id:'e5',actor:'sales',jobId:'A00001',kind:'chat',text:'ใหม่'});assert.equal(result.delivered,1);
  const t=createScenario(async()=>{throw Error('offline')});t.register({id:'p',user:'pd'});let e={id:'e6',actor:'sales',jobId:'A00001',kind:'chat',text:'ส่งซ้ำ'};result=await t.perform(e);assert.equal(result.failed,1);assert.equal(t.state.jobs[0].messages.length,2);result=await t.perform(e);assert.equal(result.failed,1);assert.equal(t.state.jobs[0].messages.length,2);
  const concurrent=createScenario(async()=>{await Promise.resolve()});concurrent.register({id:'pd',user:'pd'});const same={id:'race',actor:'sales',jobId:'A00001',kind:'chat',text:'พร้อมกัน'};await Promise.all([concurrent.perform(same),concurrent.perform(same)]);assert.equal(concurrent.state.jobs[0].messages.length,2);
  console.log('PASS: เหตุการณ์งาน/แชตเชื่อมแจ้งเตือนจำลอง สิทธิ์ ส่งซ้ำ และคืนตัว');
}
main().catch(e=>{console.error(e);process.exitCode=1});
