// Appended to the immutable upstream job-sync-e2e test in a temporary directory.
// The parent harness owns synthetic containers, IAM, sessions and cleanup.
async function syntheticApprovalSeed(id) {
  const data=job(id,{createdBy:'Synthetic actor',rows:[{name:'Synthetic',w:100,p:50,actual:50}],closed:{by:'Synthetic actor',at:'fixture'}});
  sql(`insert into fs_records(id,data) values ('${id}',${literal(data)});
       insert into fs_chats(job_id,data) values ('${id}',${literal({jobId:id,createdBy:'Synthetic actor',parts:[]})});
       insert into fs_approvals(job_id,part,data) values ('${id}','pd',${literal({by:'Synthetic PD',ts:1})}),('${id}','ra',${literal({by:'Synthetic RA',ts:2})});`);
  return data;
}
function syntheticApprovalView(id) {
  return JSON.parse(sql(`select jsonb_build_object('expected',jsonb_build_object('data',r.data,'updated_at',r.updated_at),'approvals',coalesce((select jsonb_object_agg(a.part,jsonb_build_object('data',a.data,'updated_at',a.updated_at)) from fs_approvals a where a.job_id=r.id),'{}'::jsonb)) from fs_records r where r.id='${id}';`));
}
async function syntheticApprovalRequest(role,body) {
  const response=await fetch(`${gatewayOrigin}/__formula/approval-change`,{method:'POST',headers:{'content-type':'application/json',cookie:cookie(role)},body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
}
test('synthetic approval e2e: withdraw, later approval, replay is safe',async()=>{
  const id='A08301',original=await syntheticApprovalSeed(id),view=syntheticApprovalView(id);
  const withdrawal={id,part:'pd',action:'withdraw',...view,operation:'synthetic_withdraw_e2e_001'};
  const result=await syntheticApprovalRequest('pd',withdrawal);assert.equal(result.status,200);assert.equal(result.body.status,'saved');assert.equal(result.body.replayed,false);
  const stored=JSON.parse(sql(`select data from fs_records where id='${id}';`));const {closed,...unclosed}=original;assert.deepEqual(stored,unclosed);
  assert.equal(sql(`select count(*) from fs_approvals where job_id='${id}';`),'0');
  const next={id,part:'ra',action:'approve',...syntheticApprovalView(id),operation:'synthetic_new_approve_001'};
  const approved=await syntheticApprovalRequest('ra',next);assert.equal(approved.status,200);assert.equal(approved.body.status,'saved');
  const replay=await syntheticApprovalRequest('pd',withdrawal);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);
  assert.equal(sql(`select count(*) from fs_approvals where job_id='${id}' and part='ra';`),'1');
});
test('synthetic approval e2e: denied role cannot change database',async()=>{
  const id='A08302';await syntheticApprovalSeed(id);const initial=syntheticApprovalView(id);
  for(const [role,part] of [['mkt','pd'],['oversea','sales'],['purchasing','ra']]){
    const result=await syntheticApprovalRequest(role,{id,part,action:'approve',...initial,operation:'synthetic_denied_'+role+'_001'});
    assert.equal(result.status,403,role);assert.deepEqual(syntheticApprovalView(id),initial);
  }
});
