// Synthetic-only database guard experiment; not a migration or production authorization.
test('synthetic chatguard e2e: identical retry allowed, changed or concurrent message rejected',async t=>{
 const fixture=await readFile(new URL(process.env.FORMULA_CHAT_GUARD_SQL_URL),'utf8');sql(fixture);
 t.after(()=>sql('drop trigger if exists synthetic_guard_message_update on public.fs_messages; drop trigger if exists synthetic_retire_message on public.fs_messages; drop trigger if exists synthetic_reject_retired_message on public.fs_messages; drop trigger if exists synthetic_retire_job on public.fs_records; drop trigger if exists synthetic_reject_retired_job on public.fs_records; drop function if exists public.synthetic_guard_message_update(); drop function if exists public.synthetic_retire_id(); drop function if exists public.synthetic_reject_retired_id(); drop table if exists public.synthetic_retired_ids;'));
 const first='A08345',second='A08346';
 for(const id of [first,second]){const record=job(id,{createdBy:'Synthetic actor',customer:'Synthetic',rows:[]});const chat={jobId:id,createdBy:'Synthetic actor',parts:[]};sql(`insert into fs_records(id,data) values ('${id}',${literal(record)}); insert into fs_chats(job_id,data) values ('${id}',${literal(chat)});`)}
 const uid='synthetic_guard_08345',data={uid,type:'msg',user:'Synthetic actor',text:'first synthetic',ts:123};
 const row={uid,job_id:first,ts:123,data};
 const post=async value=>{const response=await fetch(`${gatewayRest()}/fs_messages`,{method:'POST',headers:{'content-type':'application/json',cookie:cookie('sales'),prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify([value])});await response.text();return {ok:response.ok,status:response.status}};
 assert.ok((await post(row)).ok);assert.ok((await post(row)).ok);
 assert.equal((await post({...row,data:{...data,text:'changed synthetic'}})).status,409);
 assert.equal((await post({...row,job_id:second})).status,409);
 assert.deepEqual(JSON.parse(sql(`select data from fs_messages where uid='${uid}';`)),data);
 assert.equal(sql(`select job_id from fs_messages where uid='${uid}';`),first);
 const concurrentUid='synthetic_guard_concurrent';
 const competing=text=>({uid:concurrentUid,job_id:first,ts:124,data:{uid:concurrentUid,type:'msg',user:'Synthetic actor',text,ts:124}});
 const responses=await Promise.all([post(competing('one synthetic')),post(competing('two synthetic'))]);
 const statuses=responses.map(r=>r.status);assert.equal(statuses.filter(s=>s>=200&&s<300).length,1);assert.equal(statuses.filter(s=>s===409).length,1);
 assert.equal(sql(`select count(*) from fs_messages where uid='${concurrentUid}';`),'1');
});

// Owner rule 2026-10-28: a deleted message identifier is never reissued.
test('synthetic chatguard e2e: a deleted message identifier cannot be reused',async t=>{
 const fixture=await readFile(new URL(process.env.FORMULA_CHAT_GUARD_SQL_URL),'utf8');sql(fixture);
 t.after(()=>sql('drop trigger if exists synthetic_guard_message_update on public.fs_messages; drop trigger if exists synthetic_retire_message on public.fs_messages; drop trigger if exists synthetic_reject_retired_message on public.fs_messages; drop trigger if exists synthetic_retire_job on public.fs_records; drop trigger if exists synthetic_reject_retired_job on public.fs_records; drop function if exists public.synthetic_guard_message_update(); drop function if exists public.synthetic_retire_id(); drop function if exists public.synthetic_reject_retired_id(); drop table if exists public.synthetic_retired_ids;'));
 const id='A08347',uid='synthetic_guard_delete_08347';
 const record=job(id,{createdBy:'Synthetic actor',customer:'Synthetic',rows:[]});const chat={jobId:id,createdBy:'Synthetic actor',parts:[]};
 const message={uid,type:'msg',user:'Synthetic actor',text:'first synthetic',ts:123};
 sql(`insert into fs_records(id,data) values ('${id}',${literal(record)}); insert into fs_chats(job_id,data) values ('${id}',${literal(chat)}); insert into fs_messages(uid,job_id,ts,data) values ('${uid}','${id}',123,${literal(message)});`);
 const remove=async role=>{const response=await fetch(`${gatewayRest()}/fs_messages?job_id=eq.${id}&uid=eq.${uid}`,{method:'DELETE',headers:{cookie:cookie(role),prefer:'return=minimal'}});await response.text();return response.status};
 const ownerStatus=await remove('sales');
 assert.equal(ownerStatus,403,'active owner deletion should be denied by the tested gateway');
 assert.equal(sql(`select count(*) from fs_messages where uid='${uid}';`),'1');
 const adminStatus=await remove('admin');
 assert.equal(adminStatus,204,'synthetic administrator deletion should be accepted by the tested gateway');
 assert.equal(sql(`select count(*) from fs_messages where uid='${uid}';`),'0');
 const changed={uid,job_id:id,ts:123,data:{...message,text:'replacement synthetic'}};
 const response=await fetch(`${gatewayRest()}/fs_messages`,{method:'POST',headers:{'content-type':'application/json',cookie:cookie('sales'),prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify([changed])});
 await response.text();assert.equal(response.status,409,'reusing a deleted message identifier is rejected');
 assert.equal(sql(`select count(*) from fs_messages where uid='${uid}';`),'0');
 const sameResend=await fetch(`${gatewayRest()}/fs_messages`,{method:'POST',headers:{'content-type':'application/json',cookie:cookie('sales'),prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify([{uid,job_id:id,ts:123,data:message}])});
 await sameResend.text();assert.equal(sameResend.status,409,'even an identical resend cannot revive a deleted identifier');
});

test('synthetic chatguard e2e: a deleted job number cannot be reissued',async t=>{
 const fixture=await readFile(new URL(process.env.FORMULA_CHAT_GUARD_SQL_URL),'utf8');sql(fixture);
 t.after(()=>sql('drop trigger if exists synthetic_guard_message_update on public.fs_messages; drop trigger if exists synthetic_retire_message on public.fs_messages; drop trigger if exists synthetic_reject_retired_message on public.fs_messages; drop trigger if exists synthetic_retire_job on public.fs_records; drop trigger if exists synthetic_reject_retired_job on public.fs_records; drop function if exists public.synthetic_guard_message_update(); drop function if exists public.synthetic_retire_id(); drop function if exists public.synthetic_reject_retired_id(); drop table if exists public.synthetic_retired_ids;'));
 const id='A08348';
 sql(`insert into fs_records(id,data) values ('${id}',${literal(job(id,{createdBy:'Synthetic actor',customer:'Synthetic',rows:[]}))});`);
 sql(`delete from fs_records where id='${id}';`);
 let rejected=false;try{sql(`insert into fs_records(id,data) values ('${id}',${literal(job(id,{createdBy:'Synthetic actor',customer:'Other synthetic',rows:[]}))});`)}catch{rejected=true}
 assert.equal(rejected,true,'reissuing a deleted job number is rejected');
 assert.equal(sql(`select count(*) from fs_records where id='${id}';`),'0');
});
