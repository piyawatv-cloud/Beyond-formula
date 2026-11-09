'use strict';
// Disposable PostgreSQL only; invokes the handed-off fs_save_record directly.
// This bypasses the Runtime gateway and does NOT test authentication or authorization.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {prepareSave,submitSave:submitRaw}=require('./runtime-job-save.js');
const {renderRecord}=require('./legacy-render-fixture.cjs');
const submitSave=(request,send)=>submitRaw(request,send,()=>true);
const root=path.resolve(__dirname,'../../_IT-handoff/formula-studio');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'formula-mobile-rpc-'));
const data=path.join(tmp,'data'),socket=path.join(tmp,'sock'),port='65441',username='formula_mobile_fixture';
const env={...process.env,LC_ALL:process.env.LC_ALL||'C'};
let started=false;
function run(binary,args,input){const r=spawnSync(binary,args,{input,encoding:'utf8',env,maxBuffer:4*1024*1024});if(r.error||r.status!==0)throw Error(binary+' failed: '+(r.error?.message||r.stderr));return r.stdout.trim()}
function sql(text){return run('psql',['-X','-h',socket,'-p',port,'-U',username,'-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],text)}
const literal=x=>x===null?'null':"'"+JSON.stringify(x).replaceAll("'","''")+"'::jsonb";
(async()=>{
 fs.mkdirSync(socket);
 run('initdb',['-D',data,'-A','trust','-U',username,'--no-locale']);
 run('pg_ctl',['-D',data,'-l',path.join(tmp,'server.log'),'-o',`-F -p ${port} -k ${socket} -c listen_addresses=''`,'-w','start']);started=true;
 sql('create role anon; create role authenticated;');
 for(const file of ['docs/upstream-schema.sql','runtime/data-grants.sql','runtime/data-policy.sql','runtime/job-sync.sql'])sql(fs.readFileSync(path.join(root,file),'utf8'));
 const send=async(route,body)=>{assert.equal(route,'rpc/fs_save_record');return JSON.parse(sql(`set role anon; select public.fs_save_record('${body.p_id.replaceAll("'","''")}',${literal(body.p_data)},${literal(body.p_expected)});`))};
 const draft=prepareSave({id:'A00001',baseline:null,changes:{customer:'Synthetic',createdBy:'Synthetic Sales',rows:[],legacyField:{keep:'yes'}}});
 const created=await submitSave(draft,send);assert.equal(created.status,'saved');
 const original=created.data;
 const first=prepareSave({id:'A00001',baseline:original,changes:{brand:'First'}});
 const stale=prepareSave({id:'A00001',baseline:original,changes:{notes:'Stale'}});
 assert.equal((await submitSave(first,send)).status,'saved');
 assert.equal((await submitSave(stale,send)).status,'conflict');
 assert.equal((await submitSave(first,send)).status,'saved');
 const stored=JSON.parse(sql("select data from public.fs_records where id='A00001'"));
 assert.equal(stored.brand,'First');assert.equal(stored.notes,undefined);assert.equal(stored.legacyField.keep,'yes');
 const unsafe=prepareSave({id:'A00002',baseline:null,changes:{customer:'Synthetic',createdBy:'Synthetic Sales',allConcepts:[],allBenefits:[],allSP:[],cons:[],rows:[{name:'Synthetic',w:'100',p:'50',actual:50,fda:{cls:'synthetic',icon:'?',tip:'synthetic'}}]}});
 const unsafeResult=await submitSave(unsafe,send);assert.equal(unsafeResult.status,'saved');
 const storedUnsafe=JSON.parse(sql("select data from public.fs_records where id='A00002'"));
 assert.throws(()=>renderRecord(storedUnsafe),/toFixed/,'SQL acceptance does not imply legacy renderer compatibility');
 console.log('OBSERVED: SQL accepts synthetic mobile row that the handoff renderer cannot display');
 console.log('PASS: mobile save adapter with handoff SQL: create, exact retry, stale conflict and preserved fields');
 console.log('LIMIT: direct temporary PostgreSQL only; gateway, session and production not tested');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{
 if(started){try{run('pg_ctl',['-D',data,'-m','fast','-w','stop'])}catch(e){console.error(e);process.exitCode=1}}
 fs.rmSync(tmp,{recursive:true,force:true});
});
