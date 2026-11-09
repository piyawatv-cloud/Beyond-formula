// Actual HTTP proxy processes; upstream PG/IAM responses and every receipt are
// synthetic, localhost-only, and disposed after each test. No production env.
import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {createHmac,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {JobIntake} from '../runtime/job-intake.mjs';

const root=new URL('../',import.meta.url).pathname;
const secret='synthetic-intake-session-01234567890123456789';
const job=(id='A07001',notes='Synthetic private notes')=>({id,customer:'Synthetic private customer',createdBy:'Synthetic Sales',rows:[],notes});
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(check,label){for(let i=0;i<180;i++){if(await check())return;await delay(20);}throw Error(`synthetic timeout: ${label}`);}

async function stack(t,{interval=100,corrupt=false,cacheMs=1}={}){
  const scratch=await mkdtemp(join(tmpdir(),'formula-intake-http-')),dir=join(scratch,'intake');
  const records=new Map(),intents=new Map(),calls=[],children=[],processes=[];
  const state={database:true,view:true,edit:true,iam:true,unavailableUsers:new Set(),profileRole:'sales',profileEmail:null,identityId:'synthetic-user',identityStatus:'ACTIVE',loseAck:false,droppedAcks:0,wrongAck:false,malformed:null,updates:0};
  const snapshot=()=>({version:1,complete:true,total:intents.size,items:[...intents].map(([id,chatRequired])=>({id,exists:records.has(id),valid:records.has(id),closed:!!records.get(id)?.closed,rejected:!!records.get(id)?.rejected,deleted:false,chatRequired,chatExists:children.some(row=>row.job_id===id),chatDeleted:false}))});
  const upstream=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=chunks.length?JSON.parse(Buffer.concat(chunks)):null,url=new URL(req.url,'http://synthetic');
    calls.push({path:url.pathname,method:req.method,body});
    const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
    if(url.pathname==='/consumer/v1/permission-check')return send(state.iam&&!state.unavailableUsers.has(body.central_user_id)?200:503,{allowed:body.required_permission==='FORMULA_VIEW'?state.view:state.edit,reason_code:'SYNTHETIC_ONLY'});
    if(url.pathname==='/consumer/v1/identity/resolve-email')return send(state.iam?200:503,{central_user_id:state.identityId,status:state.identityStatus});
    if(!state.database)return send(503,{});
    if(url.pathname==='/fs_users')return send(200,[{name:'Synthetic Sales',data:{name:'Synthetic Sales',role:state.profileRole,...(state.profileEmail?{email:state.profileEmail}:{})}}]);
    if(url.pathname==='/fs_records'&&req.method==='GET'){
      const filter=url.searchParams.get('id');
      const ids=filter?.startsWith('in.(')?filter.slice(4,-1).split(','):filter?.startsWith('eq.')?[filter.slice(3)]:null;
      return send(200,[...records].filter(([id])=>!ids||ids.includes(id)).map(([id,data])=>({id,data})));
    }
    if(url.pathname==='/rpc/fs_save_record'){
      const current=records.get(body.p_id);
      if(current&&canonical(current)===canonical(body.p_data))return send(200,{status:'saved',id:body.p_id,data:state.wrongAck?{...current,notes:'Mismatched synthetic ACK'}:current});
      if(current?canonical(current)!==canonical(body.p_expected):body.p_expected!==null)return send(200,{status:'conflict',id:body.p_id});
      records.set(body.p_id,structuredClone(body.p_data));state.updates++;
      if(state.loseAck){state.loseAck=false;state.droppedAcks++;res.destroy();return;}
      return send(200,{status:'saved',id:body.p_id,data:state.wrongAck?{...body.p_data,notes:'Mismatched synthetic ACK'}:body.p_data});
    }
    if(url.pathname==='/rpc/fs_job_integrity_snapshot')return send(200,state.malformed??snapshot());
    if(url.pathname==='/fs_chats'){children.push(...body);return send(201,body);}
    if(url.pathname==='/fs_activities'){
      for(const row of Array.isArray(body)?body:[body])if(row.data?.job&&(['สร้างชุดข้อมูลใหม่','คัดลอกงานเป็นรหัสใหม่'].includes(row.data.action)||row.data.action==='สร้างห้องแชท'))intents.set(row.data.job,row.data.action==='สร้างห้องแชท'||intents.get(row.data.job)||false);
      return send(201,body);
    }
    return send(404,{});
  });
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const current=(await readFile(join(root,'releases/CURRENT'),'utf8')).trim();
  const html=await readFile(process.env.FORMULA_JOB_SYNC_TEST_HTML||join(root,'releases',current,'index.html'),'utf8');
  const id=createHash('sha256').update(html).digest('hex').slice(0,12),releaseDir=join(scratch,'sealed');
  await mkdir(join(releaseDir,id),{recursive:true});await writeFile(join(releaseDir,'CURRENT'),id);
  await writeFile(join(releaseDir,id,'index.html'),html);await writeFile(join(releaseDir,id,'meta.json'),JSON.stringify({id}));
  if(corrupt){await mkdir(join(dir,'receipts'),{recursive:true,mode:0o700});await writeFile(join(dir,'receipts',`${'a'.repeat(64)}.json`),'{bad synthetic json',{mode:0o600});}
  async function start(color='blue'){
    const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
    const child=spawn(process.execPath,['runtime/formula-proxy.mjs'],{cwd:root,env:{PATH:process.env.PATH,PORT:String(port),FORMULA_COLOR:color,FORMULA_STACK:'synthetic-intake',FORMULA_RELEASE_DIR:releaseDir,FORMULA_ASSET_DIR:join(root,'runtime/assets'),FORMULA_LOG_DIR:join(scratch,`logs-${color}-${port}`),FORMULA_JOB_INTAKE_DIR:dir,FORMULA_JOB_INTEGRITY_INTERVAL_MS:String(interval),SB_ORIGIN:`http://127.0.0.1:${upstream.address().port}`,SB_SERVICE_KEY:'synthetic-not-a-key',SB_REST_BASE:'/',FORMULA_SESSION_SECRET:secret,FORMULA_IAM_CACHE_MS:String(cacheMs),IAM_CONSUMER_ORIGIN:`http://127.0.0.1:${upstream.address().port}`,IAM_CONSUMER_SHARED_SECRET:'synthetic-iam-secret-01234567890123456789'},stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);processes.push(child);
    const origin=`http://127.0.0.1:${port}`;
    await waitFor(async()=>{if(child.exitCode!==null)throw Error(output);try{return(await fetch(`${origin}/__formula/health`)).ok;}catch{return false;}},'proxy startup');
    assert.equal((await(await fetch(`${origin}/__formula/health`)).json()).jobSyncCompatible,true,'test the approved compatible sealed artifact');
    return{origin,child};
  }
  async function stop(proc){if(proc.child.exitCode===null&&proc.child.signalCode===null){const exited=new Promise(resolve=>proc.child.once('exit',resolve));proc.child.kill();await exited;}}
  t.after(async()=>{for(const child of processes)await stop({child});upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));await rm(scratch,{recursive:true,force:true});});
  const primary=await start();
  const session={name:'Synthetic Sales',role:'sales',centralUserId:'synthetic-user',exp:Date.now()+60_000};
  function call(path,body,{role='sales',method='POST',anonymous=false,exp=session.exp,centralUserId=session.centralUserId,origin=primary.origin}={}){
    const encoded=Buffer.from(JSON.stringify({...session,role,exp,centralUserId})).toString('base64url'),cookie=`fs_session=${encoded}.${createHmac('sha256',secret).update(encoded).digest('base64url')}`;
    return fetch(`${origin}${path.startsWith('/')?path:'/sb/rest/v1/'+path}`,{method,headers:{'content-type':'application/json',Prefer:'return=representation',...(!anonymous?{cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  }
  const save=(data=job(),expected=null,options)=>call('rpc/fs_save_record',{p_id:data.id,p_data:data,p_expected:expected},options).then(response=>response.json());
  const report=options=>call('/__formula/job-integrity',undefined,{role:'admin',method:'GET',...options}).then(response=>response.json());
  const receiptList=async()=>{const journal=await new JobIntake({dir}).init();return journal.list();};
  return{dir,records,intents,calls,children,state,start,stop,primary,call,save,report,receiptList};
}

test('durable queued delivery survives database outage and browser closure; only exact committed parent permits chat',async t=>{
  const s=await stack(t),data=job();s.state.database=false;s.intents.set(data.id,true);
  assert.deepEqual(await s.save(data),{status:'queued',id:data.id});
  const entries=await s.receiptList();assert.equal(entries.length,1);assert.deepEqual(entries[0].args.p_data,data);assert.equal(entries[0].state,'pending');assert.equal(s.records.size,0);
  assert.equal((await s.call('fs_chats',[{job_id:data.id,data:{}}])).status,503);
  s.state.database=true;
  // There is no second browser save. Only the autonomous server worker runs.
  await waitFor(()=>s.records.has(data.id),'autonomous committed delivery');
  await waitFor(async()=>(await s.receiptList())[0].state==='saved','durable exact ACK');
  assert.equal(s.state.updates,1);
  assert.deepEqual(await(await s.call('fs_chats',[{job_id:data.id,data:{}}])).json(),[{job_id:data.id,data:{}}]);
});

test('both colours reopen the same durable intake and replay without a browser save or duplicate commit',async t=>{
  const s=await stack(t),data=job();s.state.database=false;assert.equal((await s.save(data)).status,'queued');
  await s.stop(s.primary);const blue=await s.start('blue'),green=await s.start('green');s.state.database=true;
  await waitFor(()=>s.records.has(data.id),'shared-intake replay');await waitFor(async()=>(await s.receiptList())[0].state==='saved','shared status');
  assert.deepEqual(s.records.get(data.id),data);assert.equal(s.state.updates,1);assert.equal((await readdir(join(s.dir,'receipts'))).length,1);
  assert.equal((await s.call('/__formula/health',undefined,{method:'GET',origin:blue.origin})).status,200);
  assert.equal((await s.call('/__formula/health',undefined,{method:'GET',origin:green.origin})).status,200);
});

test('lost committed HTTP ACK replays idempotently and stale CAS never overwrites',async t=>{
  const s=await stack(t),data=job();s.state.loseAck=true;
  // The worker may lose the reply before the foreground request obtains its
  // exact ACK. Either truthful response is valid; the dropped reply is proven.
  assert.ok(['queued','saved'].includes((await s.save(data)).status));
  await waitFor(async()=>(await s.receiptList())[0].state==='saved','lost ACK retry');
  assert.equal(s.state.droppedAcks,1);assert.equal(s.state.updates,1);assert.deepEqual(s.records.get(data.id),data);
  assert.ok(s.calls.filter(call=>call.path==='/rpc/fs_save_record').length>=2,'the lost reply must be followed by an idempotent exact acknowledgement');
  const changed={...data,notes:'Newer central revision'};s.records.set(data.id,changed);
  const result=await s.save({...data,notes:'Stale browser'},data);assert.equal(result.status,'conflict');assert.deepEqual(s.records.get(data.id),changed);
});

test('HTTP 200 with mismatched data cannot mark the durable receipt saved',async t=>{
  const s=await stack(t);s.state.wrongAck=true;assert.equal((await s.save()).status,'queued');
  await waitFor(()=>s.calls.filter(call=>call.path==='/rpc/fs_save_record').length>=2,'mismatched ACK retry');
  assert.equal((await s.receiptList())[0].state,'pending');assert.equal(s.state.updates,1);
  s.state.wrongAck=false;await waitFor(async()=>(await s.receiptList())[0].state==='saved','exact ACK after mismatch');
  assert.equal(s.state.updates,1);
});

test('concurrent admitted RPC versions commit one value and retain conflicting receipts',async t=>{
  const s=await stack(t),first=job(),second=job('A07001','Different synthetic version');
  const results=await Promise.all([s.save(first),s.save(second)]);
  assert.deepEqual(results.map(result=>result.status).sort(),['conflict','saved']);assert.equal(s.state.updates,1);
  assert.equal((await s.receiptList()).length,2);
});

test('different queued versions of one absent job stop automatic replay rather than select a winner',async t=>{
  const s=await stack(t);s.state.database=false;
  assert.equal((await s.save(job())).status,'queued');
  assert.equal((await s.save(job('A07001','Second private draft'))).status,'queued');
  s.state.database=true;
  await waitFor(async()=>{const entries=await s.receiptList();return entries.length===2&&entries.every(entry=>entry.state==='conflict');},'fork refusal');
  assert.equal(s.records.size,0);assert.equal(s.state.updates,0);
});

test('bounded worker rotates past four unavailable actors to deliver later eligible jobs',async t=>{
  const s=await stack(t);s.state.database=false;
  for(let n=1;n<=6;n++)assert.equal((await s.save(job('A0701'+n),null,{centralUserId:'synthetic-user-'+n})).status,'queued');
  const entries=await s.receiptList();assert.equal(entries.length,6);
  for(const entry of entries.slice(0,4))s.state.unavailableUsers.add(entry.actor.centralUserId);
  s.state.database=true;
  await waitFor(()=>entries.slice(4).every(entry=>s.records.has(entry.args.p_id)),'fair worker rotation');
  for(const entry of entries.slice(0,4))assert.equal(s.records.has(entry.args.p_id),false);
  assert.equal(s.state.updates,2);
});

test('background ingredient edit rechecks revoked EDIT despite a previously allowed sixty-second cache',async t=>{
  const s=await stack(t,{cacheMs:60000}),original=job();s.records.set(original.id,original);
  const first={...original,rows:[{name:'Synthetic first ingredient'}]};
  assert.equal((await s.save(first,original)).status,'saved');
  assert.ok(s.calls.some(call=>call.path==='/consumer/v1/permission-check'&&call.body.required_permission==='FORMULA_EDIT'),'seed a real allowed EDIT decision');
  s.state.database=false;
  const second={...first,rows:[{name:'Synthetic forbidden ingredient'}]};assert.equal((await s.save(second,first)).status,'queued');
  s.state.edit=false;s.state.database=true;
  await waitFor(async()=>(await s.receiptList()).some(entry=>canonical(entry.args.p_data)===canonical(second)&&entry.state==='forbidden'),'fresh revoked EDIT');
  assert.deepEqual(s.records.get(original.id),first);assert.equal(s.state.updates,1);
});

test('wrong role, revoked view and unavailable IAM never receive a durable receipt',async t=>{
  const s=await stack(t);assert.equal((await s.save(job(),null,{role:'ra'})).status,'forbidden');
  s.state.view=false;assert.equal((await s.save()).status,'forbidden');s.state.iam=false;
  await delay(5);assert.equal((await s.save()).status,'retry');assert.equal((await s.receiptList()).length,0);assert.equal(s.state.updates,0);
});

test('background delivery revalidates changed profile, revoked rights and expired receipt actor',async t=>{
  for(const boundary of ['profile','revoked','expired'])await t.test(boundary,async st=>{
    const s=await stack(st),data=job();s.state.database=false;
    assert.equal((await s.save(data,null,boundary==='expired'?{exp:Date.now()+200}:undefined)).status,'queued');
    if(boundary==='profile')s.state.profileRole='ra';if(boundary==='revoked')s.state.view=false;if(boundary==='expired')await delay(250);
    s.state.database=true;await waitFor(async()=>(await s.receiptList())[0].state==='forbidden','actor revalidation');
    assert.equal(s.records.size,0);assert.equal(s.state.updates,0);
  });
});

test('IAM receipts replay using fresh identity and EDIT without storing or reusing raw session tokens',async t=>{
  for(const boundary of ['authorized','revoked-edit','changed-identity','unsupported-role'])await t.test(boundary,async st=>{
    const s=await stack(st);s.state.profileEmail='synthetic@example.invalid';
    if(boundary==='revoked-edit')s.state.edit=false;
    if(boundary==='changed-identity')s.state.identityId='synthetic-different-user';
    const data=job();
    const actor={iam:true,name:'Synthetic Sales',role:boundary==='unsupported-role'?'rd':'admin',email:'synthetic@example.invalid',formulaUserId:'Synthetic Sales',centralUserId:'synthetic-user',exp:Date.now()+60000};
    const journal=await new JobIntake({dir:s.dir}).init();
    const receipt=await journal.capture({p_id:data.id,p_data:data,p_expected:null},{...actor,sessionToken:'synthetic-raw-session-never-persist',authorization:'synthetic-bearer-never-persist'});
    const raw=await readFile(join(s.dir,'receipts',`${receipt.key}.json`),'utf8');
    assert.doesNotMatch(raw,/synthetic-raw-session|synthetic-bearer|sessionToken|authorization/);
    assert.deepEqual(receipt.actor,actor);
    const expected=boundary==='authorized'?'saved':'forbidden';
    await waitFor(async()=>(await s.receiptList())[0].state===expected,`IAM ${boundary}`);
    assert.ok(s.calls.some(call=>call.path==='/consumer/v1/identity/resolve-email'&&call.body.email===actor.email));
    if(boundary==='authorized'){
      assert.deepEqual(s.records.get(data.id),data);assert.equal(s.state.updates,1);
      assert.ok(s.calls.some(call=>call.path==='/consumer/v1/permission-check'&&call.body.required_permission==='FORMULA_EDIT'));
    }else{assert.equal(s.records.size,0);assert.equal(s.state.updates,0);}
  });
});

test('background replay never reopens closed or rejected jobs; identical closed payload is acknowledged without update',async t=>{
  for(const marker of ['closed','rejected'])await t.test(marker,async st=>{
    const s=await stack(st),original=job(),current={...original,[marker]:{by:'Synthetic actor',ts:1}};
    s.records.set(original.id,current);s.intents.set(original.id,false);
    const journal=await new JobIntake({dir:s.dir}).init();
    const actor={name:'Synthetic Sales',role:'sales',centralUserId:'synthetic-user',exp:Date.now()+60000};
    await journal.capture({p_id:original.id,p_data:{...original,notes:'Stale attempt to reopen'},p_expected:original},actor);
    await waitFor(async()=>(await s.receiptList())[0].state==='forbidden',`${marker} preservation`);
    assert.deepEqual(s.records.get(original.id),current);assert.equal(s.state.updates,0);
    assert.equal(s.calls.some(call=>call.path==='/rpc/fs_save_record'),false);
    if(marker==='closed'){
      await journal.capture({p_id:current.id,p_data:current,p_expected:original},actor);
      await waitFor(async()=>(await s.receiptList()).some(entry=>canonical(entry.args.p_data)===canonical(current)&&entry.state==='saved'),'closed exact ACK');
      assert.deepEqual(s.records.get(original.id),current);assert.equal(s.state.updates,0);
    }
  });
});

test('corrupt intake cannot claim healthy delivery or forward a save',async t=>{
  const s=await stack(t,{corrupt:true});const health=await(await s.call('/__formula/health',undefined,{method:'GET'})).json();
  assert.equal(health.status,'degraded');assert.equal(health.jobIntake,'unavailable');assert.equal((await s.save()).status,'retry');assert.equal(s.state.updates,0);
  await waitFor(async()=>(await s.report()).status==='unknown','corrupt report');assert.equal((await s.report()).complete,false);
});

test('corruption discovered after startup withdraws intake health and blocks further acceptance',async t=>{
  const s=await stack(t);assert.equal((await s.save()).status,'saved');
  const [name]=await readdir(join(s.dir,'receipts'));
  await writeFile(join(s.dir,'receipts',name),'{bad synthetic checksum',{mode:0o600});
  await delay(180);await waitFor(async()=>(await s.report()).status==='unknown','live corruption report');
  const health=await(await s.call('/__formula/health',undefined,{method:'GET'})).json();
  assert.equal(health.jobIntake,'unavailable');assert.equal(health.status,'degraded');
  assert.equal((await s.save(job('A07002'))).status,'retry');assert.equal(s.records.has('A07002'),false);
});

test('log-only detection returns metadata, hidden RPC stays blocked and admin GET does not trigger delivery',async t=>{
  const s=await stack(t,{interval:5000});
  const event={uid:'synthetic-create',ts:1,data:{job:'A07009',cat:'job',action:'สร้างชุดข้อมูลใหม่',detail:'Synthetic private formula',user:'Synthetic private actor'}};
  await s.call('fs_activities',[event]);
  await waitFor(async()=>(await s.report()).items.some(item=>item.id==='A07009'),'log-only detection');
  const report=await s.report();assert.equal(report.items[0].state,'missing');assert.doesNotMatch(JSON.stringify(report),/Synthetic private|rows|customer/);
  assert.equal((await s.call('rpc/fs_job_integrity_snapshot',{})).status,403);
  assert.equal((await s.call('/__formula/job-integrity',undefined,{method:'GET'})).status,403);
  assert.equal((await s.call('/__formula/job-integrity',undefined,{method:'GET',anonymous:true})).status,401);
  assert.equal((await s.call('/__formula/job-integrity',{}, {role:'admin'})).status,405);
  s.state.database=false;assert.equal((await s.save()).status,'queued');s.state.database=true;
  const saves=s.calls.filter(call=>call.path==='/rpc/fs_save_record').length;
  for(let i=0;i<5;i++)assert.equal((await s.report()).complete,true);
  assert.equal(s.calls.filter(call=>call.path==='/rpc/fs_save_record').length,saves);assert.equal(s.records.size,0);
});

test('a valid but long activity job ID cannot disable integrity checking or normal durable saves',async t=>{
  const s=await stack(t),longId='A'.repeat(256)+'07001';
  const event={uid:'synthetic-long-job-activity',ts:1,data:{job:longId,cat:'job',action:'สร้างชุดข้อมูลใหม่',detail:'Synthetic long ID'}};
  assert.equal((await s.call('fs_activities',[event])).status,201);
  await waitFor(async()=>{const report=await s.report();return report.complete&&report.items.some(item=>item.id===longId);},'long ID complete report');
  const report=await s.report();assert.equal(report.status,'ok');assert.equal(report.items.find(item=>item.id===longId).state,'missing');
  const health=await(await s.call('/__formula/health',undefined,{method:'GET'})).json();assert.equal(health.jobIntake,'ready');assert.equal(health.status,'ok');
  const data=job('A07002');assert.equal((await s.save(data)).status,'saved');
  const entries=await s.receiptList();assert.equal(entries.length,1);assert.equal(entries[0].state,'saved');assert.deepEqual(entries[0].args.p_data,data);
  assert.deepEqual(s.records.get(data.id),data);assert.equal(s.state.updates,1);
});

test('an oversized metadata observation batch remains unknown without disabling durable job intake',async t=>{
  const s=await stack(t);
  const before=(await s.report()).checkedAt||0;
  const items=Array.from({length:20},(_,i)=>({id:'A'.repeat(320000)+String(7100+i).padStart(5,'0'),exists:false,valid:false,closed:false,rejected:false,deleted:false,chatRequired:false,chatExists:false,chatDeleted:false}));
  s.state.malformed={version:1,complete:true,total:items.length,items};
  // Each observation is below the per-file bound; only the combined batch
  // exceeds 6 MiB. It must not publish a partial successful observation set.
  await waitFor(async()=>{const report=await s.report();return report.checkedAt>before&&report.status==='unknown'&&!report.complete;},'oversized metadata batch');
  assert.equal((await readdir(join(s.dir,'observations'))).length,0);
  const health=await(await s.call('/__formula/health',undefined,{method:'GET'})).json();assert.equal(health.jobIntake,'ready');assert.equal(health.status,'ok');
  const data=job('A07002');assert.equal((await s.save(data)).status,'saved');
  const entries=await s.receiptList();assert.equal(entries.length,1);assert.equal(entries[0].state,'saved');assert.deepEqual(entries[0].args.p_data,data);
  assert.deepEqual(s.records.get(data.id),data);assert.equal(s.state.updates,1);
});

test('an older failed receipt cannot override a newer saved job in the Admin integrity report',async t=>{
  for(const oldState of ['forbidden','conflict'])await t.test(oldState,async st=>{
    const s=await stack(st),original=job();s.records.set(original.id,original);s.intents.set(original.id,false);
    const older={...original,notes:'Old unsuccessful synthetic revision',...(oldState==='forbidden'?{rows:[{name:'Synthetic ingredient'}]}:{})};
    s.state.edit=oldState!=='forbidden';
    const expected=oldState==='conflict'?{...original,notes:'Unknown stale baseline'}:original;
    assert.equal((await s.save(older,expected)).status,oldState);
    await delay(5);s.state.edit=true;
    const latest={...original,notes:'New successful synthetic revision'};
    assert.equal((await s.save(latest,original)).status,'saved');
    await waitFor(async()=>{const report=await s.report();return report.complete&&report.items.some(item=>item.id===original.id&&item.state==='saved');},'latest successful receipt wins report');
    const report=await s.report();assert.deepEqual(report.items.map(item=>({id:item.id,state:item.state})),[{id:original.id,state:'saved'}]);
    assert.equal(report.counts.saved,1);assert.equal(report.counts[oldState]||0,0);
    const entries=await s.receiptList();assert.equal(entries.length,2);assert.ok(entries.some(entry=>entry.state===oldState));assert.ok(entries.some(entry=>entry.state==='saved'));
    assert.deepEqual(s.records.get(original.id),latest);assert.equal(s.state.updates,1);
  });
});

test('receipt-only IDs deduplicate by latest state and old failures disappear after a newer saved receipt',async t=>{
  const s=await stack(t),now=Date.now(),actor={name:'Synthetic Sales',role:'sales',centralUserId:'synthetic-user',exp:now+60000};s.state.database=false;
  // Install historical terminal receipts before starting a worker. Otherwise
  // the intermediate capture-before-mark interval is a genuine pending job.
  await s.stop(s.primary);
  async function capture(id,notes,at,state){
    const journal=await new JobIntake({dir:s.dir,clock:()=>at}).init();
    const data=job(id,notes),entry=await journal.capture({p_id:id,p_data:data,p_expected:null},actor);
    await journal.mark(entry.key,{state,lastAttemptAt:at});return data;
  }
  await capture('A07021','Older forbidden revision',now-1000,'forbidden');
  await capture('A07021','Latest conflict revision',now,'conflict');
  await capture('A07022','Older conflict revision',now-1000,'conflict');
  const saved=await capture('A07022','Latest saved revision',now,'saved');s.records.set(saved.id,saved);s.state.database=true;
  Object.assign(s.primary,await s.start());
  await waitFor(async()=>{const report=await s.report();return report.complete&&report.items.length===1&&report.items[0].id==='A07021'&&report.items[0].state==='conflict';},'receipt-only latest deduplication');
  const report=await s.report();assert.equal(report.counts.conflict,1);assert.equal(report.counts.forbidden||0,0);
  assert.equal(report.items.some(item=>item.id==='A07022'),false);
  assert.equal((await s.receiptList()).length,4,'all historical receipt evidence remains stored');
  assert.equal(s.state.updates,0,'reading and deduplicating terminal receipts does not write PG');
});

test('a saved receipt cannot hide authoritative missing, invalid or missing-chat state',async t=>{
  for(const boundary of ['missing-parent','invalid-parent','missing-chat'])await t.test(boundary,async st=>{
    const s=await stack(st),data=job();s.state.database=false;
    await s.stop(s.primary);
    if(boundary==='invalid-parent')s.records.set(data.id,{});
    if(boundary==='missing-chat')s.records.set(data.id,data);
    s.state.malformed={version:1,complete:true,total:1,items:[{id:data.id,exists:boundary!=='missing-parent',valid:boundary==='missing-chat',closed:false,rejected:false,deleted:false,chatRequired:boundary==='missing-chat',chatExists:false,chatDeleted:false}]};
    const journal=await new JobIntake({dir:s.dir}).init();
    const actor={name:'Synthetic Sales',role:'sales',centralUserId:'synthetic-user',exp:Date.now()+60000};
    const receipt=await journal.capture({p_id:data.id,p_data:data,p_expected:null},actor);await journal.mark(receipt.key,{state:'saved'});s.state.database=true;
    Object.assign(s.primary,await s.start());
    const expected=boundary==='invalid-parent'?'invalid':'missing';
    await waitFor(async()=>{const report=await s.report();return report.complete&&report.items.some(item=>item.id===data.id&&item.state===expected);},`authoritative ${boundary}`);
    const report=await s.report();assert.equal(report.items.length,1);assert.equal(report.counts[expected],1);assert.equal(report.counts.saved||0,0);
    assert.equal(s.state.updates,0);assert.equal(s.calls.some(call=>call.path==='/rpc/fs_save_record'),false);
  });
});

test('partial or malformed authoritative snapshots remain unknown and never claim complete',async t=>{
  const s=await stack(t);
  for(const snapshot of [{version:1,complete:false,items:[]},{version:1,complete:true,items:[{id:'A07001',exists:true}]},{version:2,complete:true,items:[]}]){
    s.state.malformed=snapshot;
    await delay(180);await waitFor(async()=>(await s.report()).complete===false,'incomplete snapshot');
    assert.equal((await s.report()).status,'unknown');assert.equal(s.state.updates,0);
  }
});
