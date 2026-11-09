// Synthetic, isolated message writes through the inspected gateway and PostgreSQL.
test('synthetic chat e2e: same message retry and changed payload using same identifier',async()=>{
 const id='A08342';const record=job(id,{createdBy:'Synthetic actor',customer:'Synthetic',rows:[]});
 const chat={jobId:id,createdBy:'Synthetic actor',parts:[]};
 sql(`insert into fs_records(id,data) values ('${id}',${literal(record)}); insert into fs_chats(job_id,data) values ('${id}',${literal(chat)});`);
 const uid='synthetic_message_08342';const message={uid,type:'msg',user:'Synthetic actor',text:'first synthetic',ts:123};
 const row={uid,job_id:id,ts:123,data:message};
 const post=async value=>fetch(`${gatewayRest()}/fs_messages`,{method:'POST',headers:{'content-type':'application/json',cookie:cookie('sales'),prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify([value])});
 assert.ok((await post(row)).ok,'initial synthetic message must be accepted');
 assert.ok((await post(row)).ok,'identical retry must be accepted');
 assert.equal(sql(`select count(*) from fs_messages where uid='${uid}';`),'1');
 const changed={...row,data:{...message,text:'different synthetic'}};
 await post(changed);
 assert.equal(JSON.parse(sql(`select data from fs_messages where uid='${uid}';`)).text,'first synthetic','same identifier must not overwrite a different message');
});
test('synthetic chat e2e: same message identifier must not move across jobs',async()=>{
 const first='A08343',second='A08344',uid='synthetic_message_08343';
 for(const id of [first,second]){const record=job(id,{createdBy:'Synthetic actor',customer:'Synthetic',rows:[]});const chat={jobId:id,createdBy:'Synthetic actor',parts:[]};sql(`insert into fs_records(id,data) values ('${id}',${literal(record)}); insert into fs_chats(job_id,data) values ('${id}',${literal(chat)});`)}
 const message={uid,type:'msg',user:'Synthetic actor',text:'original synthetic',ts:123};
 const post=async value=>fetch(`${gatewayRest()}/fs_messages`,{method:'POST',headers:{'content-type':'application/json',cookie:cookie('sales'),prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify([value])});
 assert.ok((await post({uid,job_id:first,ts:123,data:message})).ok);
 await post({uid,job_id:second,ts:123,data:{...message,text:'different job synthetic'}});
 const stored=JSON.parse(sql(`select jsonb_build_object('job_id',job_id,'data',data) from fs_messages where uid='${uid}';`));
 assert.equal(stored.job_id,first,'message identifier must not move to another job');
 assert.equal(stored.data.text,'original synthetic');
});
