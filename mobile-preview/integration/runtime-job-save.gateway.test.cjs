'use strict';
// Reuse the handoff's local-only HTTP gateway harness without modifying it.
// All identities, session keys, data and upstream services are synthetic.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {pathToFileURL}=require('node:url');
const {spawnSync}=require('node:child_process');
const base=path.resolve(__dirname,'../../_IT-handoff/formula-studio');
const source=fs.readFileSync(path.join(base,'tests/job-integrity-gateway.test.mjs'),'utf8');
const cut=source.indexOf("\ntest('durable queued delivery");assert.ok(cut>0,'handoff gateway harness layout changed');
let harness=source.slice(0,cut);
const relative="'../runtime/job-intake.mjs'", root="new URL('../',import.meta.url).pathname";
assert.ok(harness.includes(relative)&&harness.includes(root),'handoff imports changed');
harness=harness.replace(relative,JSON.stringify(pathToFileURL(path.join(base,'runtime/job-intake.mjs')).href)).replace(root,JSON.stringify(base));
// The original receipt harness did not emulate PostgREST pagination headers;
// add them only to this synthetic upstream so the gateway can perform its
// complete, role-scoped record read. No production service is modified.
const oldRead="      return send(200,[...records].filter(([id])=>!ids||ids.includes(id)).map(([id,data])=>({id,data})));";
const pagedRead="      const list=[...records].filter(([id])=>!ids||ids.includes(id)).sort(([a],[b])=>a.localeCompare(b)).map(([id,data])=>({id,data}));if(req.headers.range){res.writeHead(200,{'content-type':'application/json','content-range':list.length?'0-'+(list.length-1)+'/'+list.length:'*/0'});return res.end(JSON.stringify(list));}return send(200,list);";
assert.ok(harness.includes(oldRead),'handoff record fixture changed');harness=harness.replace(oldRead,pagedRead);

const client=pathToFileURL(path.join(__dirname,'runtime-job-save.js')).href;
const renderer=pathToFileURL(path.join(__dirname,'legacy-render-fixture.cjs')).href;
const briefFixture=pathToFileURL(path.join(__dirname,'brief-gateway-fixture.cjs')).href;
const rowAdapter=pathToFileURL(path.join(__dirname,'legacy-row-adapter.cjs')).href;
const calcFixture=pathToFileURL(path.join(__dirname,'legacy-calculator-fixture.cjs')).href;
const tests=`
import adapter from ${JSON.stringify(client)};
import legacyRenderer from ${JSON.stringify(renderer)};
import mobileBrief from ${JSON.stringify(briefFixture)};
import legacyRows from ${JSON.stringify(rowAdapter)};
import legacyCalculatorFixture from ${JSON.stringify(calcFixture)};
const {prepareSave,submitSave:submitRaw,reconcileSave}=adapter;
const submitSave=(request,send)=>submitRaw(request,send,()=>true);
const make=(id='A07001')=>({id,customer:'Synthetic customer',createdBy:'Synthetic Sales',rows:[],hidden:{keep:'fixture'}});
const sender=(s,options)=>async(route,body)=>{const res=await s.call(route,body,options);return res.json()};
test('synthetic legacy record survives mobile brief edit, scoped gateway readback and legacy table rendering',async t=>{
  const s=await stack(t),id='A07007';
  const original={id,customer:'Synthetic',brand:'Before',createdBy:'Synthetic Sales',price:0,uw:100,allConcepts:[],allBenefits:[' A ','B'],allSP:[],cons:[],rows:[{name:'Synthetic',w:100,p:50,actual:50,fda:{cls:'synthetic',icon:'?',tip:'synthetic'},extra:'preserve'}],hidden:'preserve'};
  s.records.set(id,structuredClone(original));
  const read=async()=>{const response=await s.call('fs_records?select=id,data&id=eq.'+id,undefined,{method:'GET'});assert.equal(response.status,200);const rows=await response.json();assert.equal(rows.length,1);return rows[0].data};
  const baseline=await read();assert.deepEqual(baseline,original);
  const fields={customer:'Synthetic',brand:'After',price:'0',uw:'100',allBenefits:' A \\nB'};
  const changes=mobileBrief.readBrief(baseline,fields),request=prepareSave({id,baseline,changes});
  assert.equal((await submitSave(request,sender(s))).status,'saved');
  const after=await read();assert.deepEqual(after,{...original,brand:'After'});
  assert.throws(()=>legacyRenderer.renderRecord(after),new RegExp(legacyRenderer.sentinel));
});
test('mobile connector stops a concept edit before gateway when legacy derived fields exist',async t=>{
  const s=await stack(t),id='A07010';
  const original={id,customer:'Synthetic',createdBy:'Synthetic Sales',conceptStr:'แนวคิดเดิม',allConcepts:['แนวคิดเดิม'],allBenefits:['สรรพคุณเดิม'],allSP:['จุดขายเดิม'],cons:[],rows:[]};
  s.records.set(id,structuredClone(original));
  const changes=mobileBrief.readBrief(original,{customer:'Synthetic',conceptStr:'แนวคิดใหม่',allBenefits:'สรรพคุณเดิม'});
  assert.throws(()=>prepareSave({id,baseline:original,changes}),/คอนเซป/);
  assert.equal(s.state.updates,0);assert.deepEqual(s.records.get(id),original);
});
test('editing an ingredient through the mobile brief remains incompatible after gateway acceptance',async t=>{
  const s=await stack(t),id='A07008';
  const original={id,customer:'Synthetic',brand:'Before',createdBy:'Synthetic Sales',allConcepts:[],allBenefits:[],allSP:[],cons:[],rows:[{name:'Synthetic',w:100,p:50,actual:50,fda:{cls:'synthetic',icon:'?',tip:'synthetic'}}]};
  s.records.set(id,structuredClone(original));
  const changes=mobileBrief.readBrief(original,{customer:'Synthetic',brand:'Before'},{0:{w:'120'}});
  assert.equal(changes.rows[0].w,'120');assert.equal(changes.rows[0].actual,60,'illustrative calculation is updated, while compatibility remains unresolved');
  const request=prepareSave({id,baseline:original,changes});assert.equal((await submitSave(request,sender(s))).status,'saved');
  assert.throws(()=>legacyRenderer.renderRecord(s.records.get(id)),/toFixed/);
});
test('experimental adapter uses handoff calculator with fake reference data before synthetic gateway save',async t=>{
  const s=await stack(t),id='A07011';
  const original={id,customer:'Synthetic',brand:'Before',createdBy:'Synthetic Sales',allConcepts:[],allBenefits:[],allSP:[],cons:[],rows:[{name:'Synthetic',w:100,p:50,o:'fixture',note:'fixture',hero:false,actual:50,fda:{status:'fixture',cls:'fixture',icon:'?',tip:'fixture'},extra:'preserve'}]};
  s.records.set(id,structuredClone(original));
  const changes=mobileBrief.readBrief(original,{customer:'Synthetic',brand:'Before'},{0:{w:'120'}});
  changes.rows=legacyRows.adaptLegacyRows(changes.rows,legacyCalculatorFixture.derive);
  const request=prepareSave({id,baseline:original,changes});assert.equal((await submitSave(request,sender(s))).status,'saved');
  const row=s.records.get(id).rows[0];assert.equal(row.w,120);assert.equal(row.actual,60);assert.equal(row.fda.status,'over');assert.equal(row.extra,'preserve');
  assert.throws(()=>legacyRenderer.renderRecord(s.records.get(id)),new RegExp(legacyRenderer.sentinel));
});
test('gateway success does not prove the legacy renderer can display a mobile-shaped row',async t=>{
  const s=await stack(t);const draft=prepareSave({id:'A07006',baseline:null,changes:{customer:'Synthetic',createdBy:'Synthetic Sales',allConcepts:[],allBenefits:[],allSP:[],cons:[],rows:[{name:'Synthetic',w:'100',p:'50',actual:50,fda:{cls:'synthetic',icon:'?',tip:'synthetic'}}]}});
  assert.equal((await submitSave(draft,sender(s))).status,'saved');
  assert.throws(()=>legacyRenderer.renderRecord(s.records.get('A07006')),/toFixed/);
});
test('mobile client uses real test gateway for save and stale conflict',async t=>{
  const s=await stack(t); const draft=prepareSave({id:'A07001',baseline:null,changes:{customer:'Synthetic customer',createdBy:'Synthetic Sales',rows:[],hidden:{keep:'fixture'}}});
  const created=await submitSave(draft,sender(s));assert.equal(created.status,'saved');
  const baseline=created.data;const first=prepareSave({id:baseline.id,baseline,changes:{notes:'newer'}});const stale=prepareSave({id:baseline.id,baseline,changes:{brand:'stale'}});
  assert.equal((await submitSave(first,sender(s))).status,'saved');assert.equal((await submitSave(stale,sender(s))).status,'conflict');
  assert.equal(s.records.get('A07001').notes,'newer');assert.equal(s.records.get('A07001').hidden.keep,'fixture');
});
test('gateway role denial does not write or become a saved result',async t=>{
  const s=await stack(t);const r=prepareSave({id:'A07002',baseline:null,changes:{customer:'Synthetic',createdBy:'Synthetic Sales',rows:[]}});
  assert.equal((await submitSave(r,sender(s,{role:'ra'}))).status,'forbidden');assert.equal(s.records.has('A07002'),false);
});
test('gateway queued receipt remains queued while database is unavailable',async t=>{
  const s=await stack(t);s.state.database=false;const r=prepareSave({id:'A07003',baseline:null,changes:{customer:'Synthetic',createdBy:'Synthetic Sales',rows:[]}});
  assert.equal((await submitSave(r,sender(s))).status,'queued');assert.equal(s.records.has('A07003'),false);
  s.state.database=true;await waitFor(()=>s.records.has('A07003'),'synthetic queued replay');assert.equal(s.state.updates,1);
  const read=async route=>{const response=await s.call(route,undefined,{method:'GET'});if(!response.ok)throw Error('read unavailable');return response.json()};
  const acknowledgement=await reconcileSave(r,read,()=>true);assert.equal(acknowledgement.status,'record-confirmed');
  s.records.set('A07003',{...r.p_data,notes:'Newer data'});assert.equal((await reconcileSave(r,read,()=>true)).status,'pending');
  assert.equal(s.state.updates,1,'readback must not cause a second save');
  const anonymousRead=async route=>{const response=await s.call(route,undefined,{method:'GET',anonymous:true});if(!response.ok)throw Error('not authorized');return response.json()};
  assert.equal((await reconcileSave(r,anonymousRead,()=>true)).status,'unconfirmed');

});
test('queued changed creates stop replay and client readback cannot distinguish conflict',async t=>{
  const s=await stack(t);s.state.database=false;
  const first=prepareSave({id:'A07009',baseline:null,changes:{customer:'Synthetic',createdBy:'Synthetic Sales',rows:[]}});
  const changed=prepareSave({id:'A07009',baseline:null,changes:{customer:'Synthetic changed',createdBy:'Synthetic Sales',rows:[]}});
  assert.equal((await submitSave(first,sender(s))).status,'queued');
  assert.equal((await submitSave(first,sender(s))).status,'queued');
  assert.equal((await s.receiptList()).length,1,'identical retries share the same receipt');
  assert.equal((await submitSave(changed,sender(s))).status,'queued');
  s.state.database=true;
  await waitFor(async()=>{const entries=await s.receiptList();return entries.length===2&&entries.every(e=>e.state==='conflict');},'queued duplicate and changed request');
  assert.equal(s.state.updates,0,'conflicting queued creates must not select a winner');
  assert.equal(s.records.has('A07009'),false);
  const read=async route=>{const response=await s.call(route,undefined,{method:'GET'});if(!response.ok)throw Error('read unavailable');return response.json()};
  const statuses=await Promise.all([reconcileSave(first,read,()=>true),reconcileSave(changed,read,()=>true)]);
  assert.deepEqual(statuses.map(x=>x.status),['pending','pending'],'readback alone cannot see receipt conflicts');
  assert.equal(s.state.updates,0,'readback must remain read-only');
});
test('session change suppresses the result but cannot undo an already sent request',async t=>{
  const s=await stack(t);const r=prepareSave({id:'A07005',baseline:null,changes:{customer:'Synthetic',createdBy:'Synthetic Sales',rows:[]}});
  let current=true;
  const result=await submitRaw(r,async(route,body)=>{current=false;const response=await s.call(route,body,{role:'admin',centralUserId:'another-synthetic-user'});return response.json()},()=>current);
  assert.equal(result.status,'session-changed-unconfirmed');assert.equal(s.records.has('A07005'),true,'post-response session checking cannot prevent a request under the changed cookie');
});
test('missing session and lost response are not treated as confirmed saves',async t=>{
  const s=await stack(t);const r=prepareSave({id:'A07004',baseline:null,changes:{customer:'Synthetic',createdBy:'Synthetic Sales',rows:[]}});
  assert.notEqual((await submitSave(r,sender(s,{anonymous:true}))).status,'saved');assert.equal(s.state.updates,0);
  s.state.loseAck=true;const result=await submitSave(r,sender(s));assert.ok(['saved','queued'].includes(result.status));
  await waitFor(async()=>(await s.receiptList()).some(x=>x.state==='saved'),'synthetic lost response retry');
  assert.equal(s.state.droppedAcks,1);assert.equal(s.state.updates,1);
});
`;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'formula-mobile-gateway-'));
try{
 const file=path.join(tmp,'gateway.test.mjs');fs.writeFileSync(file,harness+tests);
 const result=spawnSync(process.execPath,['--test',file],{cwd:base,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
 if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
 if(result.error)throw result.error;if(result.status!==0)process.exitCode=result.status||1;
}finally{fs.rmSync(tmp,{recursive:true,force:true})}
