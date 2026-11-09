'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
for(const [id,file] of [['runtime-save-client','runtime-job-save.js'],['fixture-save','ui-save-simulation.js']]){const match=html.match(new RegExp('<script id=\"'+id+'\">\\n([\\s\\S]*?)</script>'));assert.ok(match,id);assert.equal(match[1],fs.readFileSync(path.join(__dirname,file),'utf8'),id+' inline copy must match source');}
const {simulateSave,simulateCreate}=require('./ui-save-simulation.js');
(async()=>{
 const baseline={id:'A00001',customer:'ลูกค้าจำลอง',brand:'เดิม',createdBy:'sales',rows:[],extra:'เก็บไว้'};
 const changes={brand:'ใหม่'};const original=JSON.stringify(baseline);
 for(const scenario of ['saved','queued','conflict','forbidden','invalid','retry','unconfirmed']){
  const result=await simulateSave(scenario,baseline,changes);assert.equal(result.status,scenario);
  if(scenario==='saved'){assert.equal(result.data.brand,'ใหม่');assert.equal(result.data.extra,'เก็บไว้')}
  assert.equal(JSON.stringify(baseline),original,'ข้อมูลตั้งต้นต้องไม่เปลี่ยน');assert.equal(changes.brand,'ใหม่');
 }
 const createData={customer:'ลูกค้าจำลอง',brand:'',createdBy:'sales',rows:[]};
 for(const scenario of ['saved','queued','conflict','forbidden','retry','unconfirmed']){const result=await simulateCreate(scenario,'A00003',createData);assert.equal(result.status,scenario);if(scenario==='saved')assert.equal(result.data.id,'A00003')}
 await assert.rejects(()=>simulateCreate('saved','A00003',{customer:'',rows:[]}),/ข้อมูล/);
 await assert.rejects(()=>simulateSave('other',baseline,changes),/สถานการณ์/);
 console.log('PASS: UI save simulation returns truthful statuses without mutating drafts');
})().catch(e=>{console.error(e);process.exitCode=1});
