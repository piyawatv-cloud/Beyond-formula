'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createTestAuthService}=require('./auth-http.cjs');
async function main(){let dir=fs.mkdtempSync(path.join(os.tmpdir(),'formula-auth-fixture-'));const delivered=[];let service=createTestAuthService({dbPath:path.join(dir,'test.sqlite'),transport:async(p,id)=>delivered.push({p,id})});
try{const port=await service.listen();const base='http://127.0.0.1:'+port;async function call(route,body,token){let r=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return {status:r.status,body:await r.json()}};
assert.equal((await call('/login',{user:'sales',password:'ผิด'})).status,401);let sales=(await call('/login',{user:'sales',password:'fixture-sales'})).body.token;let pd=(await call('/login',{user:'pd',password:'fixture-pd'})).body.token;assert.ok(sales&&pd);
assert.equal((await call('/event',{id:'1',jobId:'A00001',kind:'chat',text:'ข้อมูลจำลอง'})).status,401);assert.equal((await call('/event',{id:'1',jobId:'A00001',kind:'chat',text:'ข้อมูลจำลอง'},sales+'tampered')).status,401);
assert.equal((await call('/event',{id:'2',actor:'admin',jobId:'A00002',kind:'chat',text:'ข้อมูลจำลอง'},sales)).status,403);
let e={id:'3',actor:'admin',jobId:'A00001',kind:'chat',text:'ข้อมูลจำลอง'};let ok=await call('/event',e,sales);assert.equal(ok.status,200);assert.equal(ok.body.delivered,1);assert.deepEqual(delivered.map(x=>x.id),['pd-fixture']);assert.ok(!JSON.stringify(delivered).includes('ข้อมูลจำลอง'));
let dupe=await call('/event',e,sales);assert.equal(dupe.status,200);assert.equal(dupe.body.created,false);assert.equal(dupe.body.attempted,0);
service.setActive('pd',false);assert.equal((await call('/event',{id:'4',jobId:'A00001',kind:'chat',text:'หลังถอน'},pd)).status,401);
let next=await call('/event',{id:'5',jobId:'A00001',kind:'update',text:'แก้ไข'},sales);assert.equal(next.status,200);assert.equal(next.body.delivered,0);
await call('/logout',{},sales);assert.equal((await call('/event',{id:'6',jobId:'A00001',kind:'chat',text:'หลังออก'},sales)).status,401);
let beforeRestart=(await call('/login',{user:'sales',password:'fixture-sales'})).body.token;await service.close();service=createTestAuthService({dbPath:path.join(dir,'test.sqlite'),transport:async(p,id)=>delivered.push({p,id})});const secondPort=await service.listen();const after='http://127.0.0.1:'+secondPort;async function post(pathName,data,token){const r=await fetch(after+pathName,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});return {status:r.status,body:await r.json()}};
assert.equal((await post('/login',{user:'pd',password:'fixture-pd'})).status,401,'revoked fixture account must stay revoked after restart');assert.equal((await post('/event',e,beforeRestart)).status,401,'old session must not survive restart');let fresh=(await post('/login',{user:'sales',password:'fixture-sales'})).body.token;let repeated=await post('/event',e,fresh);assert.equal(repeated.status,200);assert.equal(repeated.body.created,false);assert.equal(repeated.body.attempted,0);
console.log('PASS: local real HTTP login, signed session, denied spoof/ownership, revoke and notification fixtures');
}finally{await service.close();fs.rmSync(dir,{recursive:true,force:true})}}
main().catch(e=>{console.error(e);process.exitCode=1});
