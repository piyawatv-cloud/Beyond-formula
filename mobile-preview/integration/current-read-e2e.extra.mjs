// Read paths only; synthetic records, synthetic IAM and disposable database.
const mobileChatRead=(await import(process.env.FORMULA_CHAT_READ_URL)).default;
const mobileChatCompare=(await import(process.env.FORMULA_CHAT_COMPARE_URL)).default;
test('synthetic read e2e: job and approvals remain separate and require a session',async()=>{
 const id='A08334';const record=job(id,{createdBy:'Synthetic actor',customer:'Synthetic',rows:[]});
 const chat={jobId:id,createdBy:'Synthetic actor',parts:[]};
 const approval={by:'Synthetic PD',ts:1};
 sql(`insert into fs_records(id,data) values ('${id}',${literal(record)}); insert into fs_chats(job_id,data) values ('${id}',${literal(chat)}); insert into fs_approvals(job_id,part,data) values ('${id}','pd',${literal(approval)});`);
 const get=async(path,headers={})=>{const response=await fetch(`${gatewayRest()}/${path}`,{headers});return {status:response.status,body:await response.json()}};
 const requests=['fs_records?select=id,data&id=eq.'+id,'fs_chats?select=job_id,data&job_id=eq.'+id,'fs_approvals?select=job_id,part,data&job_id=eq.'+id];
 const anonymous=await get(requests[0]);assert.equal(anonymous.status,401);
 const [recordReply,chatReply,approvalReply]=await Promise.all(requests.map(path=>get(path,{cookie:cookie('sales')})));
 assert.equal(recordReply.status,200);assert.equal(chatReply.status,200);assert.equal(approvalReply.status,200);
 assert.equal(recordReply.body.length,1);assert.deepEqual(recordReply.body[0].data,record);
 assert.equal(chatReply.body.length,1);assert.deepEqual(chatReply.body[0].data,chat);
 assert.equal(approvalReply.body.length,1);assert.equal(approvalReply.body[0].part,'pd');assert.deepEqual(approvalReply.body[0].data,approval);
 assert.equal(Object.hasOwn(recordReply.body[0].data,'approvals'),false,'approval state must not be invented from the job');
});
test('synthetic read e2e: gateway record read does not supply embedded approvals',async()=>{
 const id='A08337';await syntheticApprovalSeed(id);
 const query=new URLSearchParams({select:'id,data,fs_approvals(part,data)',id:'eq.'+id});
 const response=await fetch(`${gatewayRest()}/fs_records?${query}`,{headers:{cookie:cookie('sales')}});
 assert.equal(response.status,400,'unsupported embedded selection must not be mistaken for a snapshot');
 const ordinary=await fetch(`${gatewayRest()}/fs_records?select=id,data&id=eq.${id}`,{headers:{cookie:cookie('sales')}});
 assert.equal(ordinary.status,200);assert.equal((await ordinary.json()).length,1);
});
test('synthetic read e2e: existing scoped chat snapshot returns messages but not approvals',async()=>{
 const id='A08338';await syntheticApprovalSeed(id);
 const msg={uid:'synthetic_message_08338',jobId:id,text:'synthetic message',user:'Synthetic actor',ts:123};
 sql(`insert into fs_messages(uid,job_id,ts,data) values ('${msg.uid}','${id}',123,${literal(msg)});`);
 const url=`${gatewayOrigin}/__formula/scoped-chat-history?job_id=eq.${id}`;
 const anonymous=await fetch(url);assert.equal(anonymous.status,401);
 const response=await fetch(url,{headers:{cookie:cookie('sales')}});assert.equal(response.status,200);
 const result=await response.json();assert.ok(Array.isArray(result.chats));assert.ok(Array.isArray(result.messages));
 assert.equal(result.chats.some(row=>row.job_id===id),true);assert.equal(result.messages.some(row=>row.uid===msg.uid),true);
 assert.equal(Object.hasOwn(result,'approvals'),false);assert.equal(Object.hasOwn(result,'records'),false);
 const scopedReader=async path=>{const reply=await fetch(gatewayOrigin+path,{headers:{cookie:cookie('sales')}});if(!reply.ok)throw Error('read failed');return reply.json()};
 const observed=await mobileChatRead.readChatHistory(id,scopedReader,()=>true);assert.equal(observed.status,'ready');assert.equal(observed.messages.length,1);assert.equal(observed.messages[0].uid,msg.uid);
 const otherId='A08339';const other=job(otherId,{createdBy:'Synthetic Other',customer:'Other synthetic',rows:[]});
 sql(`insert into fs_records(id,data) values ('${otherId}',${literal(other)});`);
 const denied=await fetch(`${gatewayOrigin}/__formula/scoped-chat-history?job_id=eq.${otherId}`,{headers:{cookie:cookie('sales')}});
 assert.equal(denied.status,403,'a synthetic Sales user cannot read another owner’s history');
 assert.equal((await mobileChatRead.readChatHistory(otherId,scopedReader,()=>true)).status,'unconfirmed');
 let valid=true;assert.equal((await mobileChatRead.readChatHistory(id,async path=>{const value=await scopedReader(path);valid=false;return value},()=>valid)).status,'session-changed');
});
test('synthetic read e2e: embedded and separate chat history are not silently dropped',async()=>{
 const id='A08340';const record=job(id,{createdBy:'Synthetic actor',customer:'Synthetic',rows:[]});
 const chat={jobId:id,createdBy:'Synthetic actor',parts:[],messages:[{text:'old synthetic',ts:100}]};
 sql(`insert into fs_records(id,data) values ('${id}',${literal(record)}); insert into fs_chats(job_id,data) values ('${id}',${literal(chat)});`);
 const reader=async path=>{const reply=await fetch(gatewayOrigin+path,{headers:{cookie:cookie('sales')}});if(!reply.ok)throw Error('read failed');return reply.json()};
 const old=await mobileChatRead.readChatHistory(id,reader,()=>true);assert.equal(old.status,'legacy-history');assert.equal(old.embeddedMessages[0].text,'old synthetic');
 const msg={uid:'synthetic_message_08340',jobId:id,text:'new synthetic',user:'Synthetic actor',ts:200};
 sql(`insert into fs_messages(uid,job_id,ts,data) values ('${msg.uid}','${id}',200,${literal(msg)});`);
 const mixed=await mobileChatRead.readChatHistory(id,reader,()=>true);assert.equal(mixed.status,'requires-reconciliation');assert.equal(mixed.embeddedMessages[0].text,'old synthetic');assert.equal(mixed.messages[0].data.text,'new synthetic');
});
test('synthetic read e2e: compare embedded and table messages without modifying either',async()=>{
 const id='A08341';const original=readFileSyncForCopy.bytes;
 const start=original.indexOf('function msgUid(jobId, m){'),end=original.indexOf('// ข้อมูลระดับห้อง',start);assert.ok(start>=0&&end>start);
 const legacyUid=copyVm.runInNewContext('('+original.slice(start,end).trim()+')');
 const message={text:'shared synthetic',user:'Synthetic actor',ts:123,type:'msg'};const uid=legacyUid(id,structuredClone(message));
 const oldOnly={text:'embedded only synthetic',ts:124};const newer={uid:'synthetic-only-08341',text:'table only synthetic',ts:125};
 const record=job(id,{createdBy:'Synthetic actor',customer:'Synthetic',rows:[]}),chat={jobId:id,createdBy:'Synthetic actor',parts:[],messages:[message,oldOnly]};
 sql(`insert into fs_records(id,data) values ('${id}',${literal(record)}); insert into fs_chats(job_id,data) values ('${id}',${literal(chat)}); insert into fs_messages(uid,job_id,ts,data) values ('${uid}','${id}',123,${literal({...message,uid})}),('${newer.uid}','${id}',125,${literal(newer)});`);
 const reader=async path=>{const reply=await fetch(gatewayOrigin+path,{headers:{cookie:cookie('sales')}});if(!reply.ok)throw Error('read failed');return reply.json()};
 const history=await mobileChatRead.readChatHistory(id,reader,()=>true);assert.equal(history.status,'requires-reconciliation');
 const comparison=mobileChatCompare.compareChatHistory(id,history,legacyUid);
 assert.deepEqual(comparison.matching,[uid]);assert.equal(comparison.embeddedOnly.length,1);assert.deepEqual(comparison.tableOnly,[newer.uid]);assert.deepEqual(comparison.conflicting,[]);
 assert.deepEqual(JSON.parse(sql(`select data from fs_chats where job_id='${id}';`)),chat);assert.equal(sql(`select count(*) from fs_messages where job_id='${id}';`),'2');
});
test('synthetic read e2e: separate reads can combine old job with newer approvals',async()=>{
 const id='A08335';await syntheticApprovalSeed(id);const initial=syntheticApprovalView(id);
 const get=async path=>{const response=await fetch(`${gatewayRest()}/${path}`,{headers:{cookie:cookie('sales')}});assert.equal(response.status,200);return response.json()};
 const [prior]=await get('fs_records?select=id,data&id=eq.'+id);assert.ok(prior.data.closed);
 const changed=await syntheticApprovalRequest('pd',{id,part:'pd',action:'withdraw',...initial,operation:'synthetic_read_race_001'});
 assert.equal(changed.status,200);assert.equal(changed.body.status,'saved');
 const approvals=await get('fs_approvals?select=job_id,part,data&job_id=eq.'+id);assert.equal(approvals.length,0);
 const [current]=await get('fs_records?select=id,data&id=eq.'+id);assert.equal(current.data.closed,undefined);
 assert.ok(prior.data.closed,'first read is a valid but older snapshot, not the current job');
});
test('synthetic read e2e: one PostgreSQL statement sees one snapshot during withdrawal',async()=>{
 const id='A08336';await syntheticApprovalSeed(id);const initial=syntheticApprovalView(id);
 const query=`set application_name='formula_synthetic_snapshot'; with gate as materialized (select pg_sleep(4)) select jsonb_build_object('job',r.data,'approvals',coalesce((select jsonb_object_agg(a.part,a.data) from fs_approvals a where a.job_id=r.id),'{}'::jsonb)) from fs_records r cross join gate where r.id='${id}';`;
 const pending=sqlAsync(query);
 await waitFor(()=>sql("select count(*) from pg_stat_activity where application_name='formula_synthetic_snapshot' and wait_event='PgSleep';")==='1','synthetic snapshot query sleeping');
 const changed=await syntheticApprovalRequest('pd',{id,part:'pd',action:'withdraw',...initial,operation:'synthetic_snapshot_race_001'});
 assert.equal(changed.status,200);assert.equal(changed.body.status,'saved');
 const snapshot=JSON.parse(await pending);assert.ok(snapshot.job.closed);assert.deepEqual(Object.keys(snapshot.approvals).sort(),['pd','ra']);
 const current=syntheticApprovalView(id);assert.equal(current.expected.data.closed,undefined);assert.deepEqual(current.approvals,{});
});
