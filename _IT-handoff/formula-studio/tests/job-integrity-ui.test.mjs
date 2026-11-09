import assert from 'node:assert/strict';
import test from 'node:test';
import {harness,job} from './helpers/job-sync-client.mjs';

test('Activities never renders or fetches the central job-save status panel',async()=>{
  const h=harness({owner:'admin',beforeAsset:`
    window.integrityCalls=[];window.integrityTimers=[];
    window.fetch=async function(path,options){integrityCalls.push({path:path,options:options});return {ok:true,status:200,json:async function(){return {version:1,complete:true,status:'ok',checkedAt:Date.now(),counts:{},items:[]};}};};
    window.setTimeout=function(fn,ms){integrityTimers.push({fn:fn,ms:ms});return integrityTimers.length;};window.clearTimeout=function(){};
    var activitiesHost=document.createElement('div');activitiesHost.id='actView';document.body.appendChild(activitiesHost);
  `});
  for(let i=0;i<12;i++)await Promise.resolve();
  assert.equal(h.run(`integrityCalls.filter(function(call){return call.path==='/__formula/job-integrity';}).length`),0,
    'Activities must not fetch central job-save status metadata');
  assert.equal(h.run(`document.getElementById('fsJobIntegrityPanel')`),null,
    'Activities must not render the removed job-save status panel');
  assert.doesNotMatch(h.nodes.actView.textContent,/สถานะการบันทึกใบงานในระบบกลาง|ตรวจสอบสถานะการบันทึกใบงาน/,
    'removed job-save status copy must not leak into Activities');
  assert.equal(h.run(`integrityTimers.filter(function(timer){return timer.ms===60000;}).length`),0,
    'Activities must not schedule a central job-save status poll');
});

test('queued central intake retains exact client value and locks chat until an exact saved response',async()=>{
  let queued=true;
  const h=harness({handler:(path,opt)=>path==='rpc/fs_save_record'?queued?{status:'queued',id:opt.body.p_id}:{status:'saved',id:opt.body.p_id,data:structuredClone(opt.body.p_data)}:structuredClone(opt?.body||[])});
  h.context.__new=job('A09001');h.run('records.push(__new);saveRecordsStore()');
  await h.run('sbPush()');assert.equal(h.pending().A09001.status,'queued');
  assert.deepEqual(h.pending().A09001.data,h.read('records[0]'));
  h.run(`createChat('A09001')`);assert.equal(h.run('chats.length'),0);
  assert.match(h.alerts.at(-1),/รับข้อมูลแล้ว กำลังบันทึกใบงาน/);
  queued=false;await h.run('sbPush()');assert.deepEqual(h.pending(),{});
  h.run(`createChat('A09001')`);assert.equal(h.run('chats.length'),1);
});


test('queued receipt survives reload and never confirms chat from intake alone',async()=>{
  const h=harness({handler:(path,opt)=>path==='rpc/fs_save_record'?{status:'queued',id:opt.body.p_id}:[]});
  h.context.__new=job('A09001');h.run('records.push(__new);saveRecordsStore()');await h.run('sbPush()');
  const reopened=harness({storage:h.storage,handler:(path,opt)=>path==='rpc/fs_save_record'?{status:'queued',id:opt.body.p_id}:[]});
  assert.equal(reopened.pending().A09001.status,'queued');reopened.run(`createChat('A09001')`);
  assert.equal(reopened.run('chats.length'),0);assert.match(reopened.alerts.at(-1),/รับข้อมูลแล้ว กำลังบันทึกใบงาน/);
});

test('queued receipt for a different ID cannot be accepted as this jobs central intake',async()=>{
  const h=harness({handler:()=>({status:'queued',id:'A09002'})});
  h.context.__new=job('A09001');h.run('records.push(__new);saveRecordsStore()');await h.run('sbPush()');
  assert.equal(h.pending().A09001.status,'unconfirmed');h.run(`createChat('A09001')`);assert.equal(h.run('chats.length'),0);
});
