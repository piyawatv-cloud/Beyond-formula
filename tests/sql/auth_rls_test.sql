\set ON_ERROR_STOP on
-- Test the complete retained main contract, including objects absent from the old Auth branch.
do $$
declare t text;
begin
  foreach t in array array['fs_records','fs_chats','fs_messages','fs_approvals','fs_users','fs_activities','fs_meta','fs_memberships'] loop
    if has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'anon still has privileges on %', t;
    end if;
  end loop;
  if has_function_privilege('anon','public.fs_next_rec_seq()','EXECUTE') then
    raise exception 'anon can execute sequence RPC';
  end if;
end $$;

-- Runtime authorization is tested under the real database roles, not just by inspecting policy text.
insert into auth.users(id,email) values
 ('99999999-9999-9999-9999-999999999991','oversea@example.test'),
 ('99999999-9999-9999-9999-999999999992','mkt@example.test'),
 ('99999999-9999-9999-9999-999999999993','rd@example.test'),
 ('99999999-9999-9999-9999-999999999994','purchasing@example.test');
insert into public.fs_memberships(user_id,name,role,active) values
 ('22222222-2222-2222-2222-222222222222','Sales One','sales',true),
 ('33333333-3333-3333-3333-333333333333','Sales Two','sales',true),
 ('44444444-4444-4444-4444-444444444444','PD One','pd',true),
 ('55555555-5555-5555-5555-555555555555','RA One','ra',true),
 ('66666666-6666-6666-6666-666666666666','Inactive User','sales',false),
 ('88888888-8888-8888-8888-888888888888','OPC One','opc',true),
 ('99999999-9999-9999-9999-999999999991','Oversea One','oversea',true),
 ('99999999-9999-9999-9999-999999999992','MKT One','mkt',true),
 ('99999999-9999-9999-9999-999999999993','RD One','rd',true),
 ('99999999-9999-9999-9999-999999999994','Purchasing One','purchasing',true);

create function pg_temp.expect_denied(q text) returns void language plpgsql as $$
begin
 begin execute q; exception when insufficient_privilege then return; end;
 raise exception 'operation was not denied: %',q;
end $$;
create function pg_temp.assert_true(v boolean, message text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception '%',message; end if; end $$;

set role anon;
do $$
declare t text;
begin
 foreach t in array array['fs_records','fs_chats','fs_messages','fs_approvals','fs_users','fs_activities','fs_meta','fs_memberships'] loop
  perform pg_temp.expect_denied(format('select * from public.%I',t));
  perform pg_temp.expect_denied(format('delete from public.%I',t));
 end loop;
 perform pg_temp.expect_denied('select public.fs_next_rec_seq()');
 perform pg_temp.expect_denied($q$select public.fs_withdraw_approval('A00001','ra','anon-event')$q$);
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select pg_temp.assert_true((select data->'pass'='null'::jsonb from fs_users where name='Admin Owner'),'legacy hash not scrubbed');
insert into fs_records(id,data) values
 ('A00001','{"id":"A00001","createdBy":"Sales One","customer":"Synthetic One","rows":[],"closed":{"by":"Admin Owner"}}'),
 ('A00002','{"id":"A00002","createdBy":"Sales Two","customer":"Synthetic Two","rows":[]}'),
 ('A00003','{"id":"A00003","createdBy":"Oversea One","customer":"Synthetic Overseas","rows":[]}');
insert into fs_chats(job_id,data) values ('A00001','{"jobId":"A00001","createdBy":"Admin Owner","parts":[]}');
insert into fs_activities(uid,ts,data) values ('synthetic-admin',1,'{"user":"Admin Owner","role":"admin"}');
select pg_temp.assert_true((select count(*)=1 from fs_activities),'Admin cannot read activity');
select pg_temp.expect_denied($q$update fs_users set data=jsonb_set(data,'{pass}','"forbidden-test-hash"')$q$);
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select pg_temp.assert_true((select count(*)=1 from fs_records),'Sales read scope differs from exact creator');
select pg_temp.assert_true((select count(*)=0 from fs_activities),'non-Admin activity read leak');
insert into fs_messages(uid,job_id,ts,data) values ('sales-message','A00001',2,'{"user":"Sales One","type":"msg","text":"synthetic"}');
insert into fs_approvals(job_id,part,data) values ('A00001','sales','{"by":"Sales One","ts":2}');
select pg_temp.expect_denied($q$insert into fs_messages(uid,job_id,ts,data) values ('spoof','A00001',3,'{"user":"Sales Two","type":"msg","text":"spoof"}')$q$);
select pg_temp.expect_denied($q$insert into fs_approvals(job_id,part,data) values ('A00001','pd','{"by":"Sales One"}')$q$);
select pg_temp.expect_denied($q$insert into fs_records(id,data) values ('A00009','{"id":"A00009","createdBy":"Sales Two"}')$q$);
select pg_temp.assert_true(fs_next_rec_seq()>0,'Sales sequence rejected');

select set_config('request.jwt.claim.sub','99999999-9999-9999-9999-999999999991',false);
select pg_temp.assert_true((select count(*)=1 from fs_records),'Oversea read scope differs from exact creator');
insert into fs_records(id,data) values ('A00004','{"id":"A00004","createdBy":"Oversea One","rows":[]}');
insert into fs_approvals(job_id,part,data) values ('A00003','sales','{"by":"Oversea One","ts":3}');
select pg_temp.assert_true(fs_next_rec_seq()>0,'Oversea sequence rejected');
update fs_records set data=data||'{"closed":{"by":"Oversea One"}}' where id='A00003';

select set_config('request.jwt.claim.sub','99999999-9999-9999-9999-999999999992',false);
insert into fs_approvals(job_id,part,data) values ('A00001','pd','{"by":"MKT One","ts":4}');
update fs_approvals set data='{"by":"MKT One","ts":4}' where job_id='A00001' and part='sales';
update fs_records set data=data||'{"rows":[{"name":"synthetic"}]}' where id='A00001';
select pg_temp.assert_true(fs_next_rec_seq()>0,'MKT sequence rejected');

select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
update fs_records set data=data||'{"form":"synthetic","lastActivityAt":5}' where id='A00001';
select pg_temp.expect_denied($q$update fs_records set data=data||'{"customer":"forbidden"}' where id='A00001'$q$);
select pg_temp.expect_denied('select fs_next_rec_seq()');

select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',false);
insert into fs_approvals(job_id,part,data) values ('A00001','ra','{"by":"RA One","ts":6}');
select pg_temp.expect_denied($q$insert into fs_records(id,data) values ('A00010','{"id":"A00010","createdBy":"RA One"}')$q$);
select fs_withdraw_approval('A00001','ra','synthetic-withdraw');
select pg_temp.assert_true((select count(*)=0 from fs_approvals where job_id='A00001'),'withdraw did not clear all parts');
select pg_temp.assert_true((select not(data ? 'closed') from fs_records where id='A00001'),'withdraw did not reopen job');
-- A retry after a new approval must not remove the new approval or duplicate audit/chat.
insert into fs_approvals(job_id,part,data) values ('A00001','ra','{"by":"RA One","ts":7}');
select fs_withdraw_approval('A00001','ra','synthetic-withdraw');
select pg_temp.assert_true((select count(*)=1 from fs_approvals where job_id='A00001'),'retry erased new approval');
select pg_temp.assert_true((select count(*)=1 from fs_messages where uid='withdraw:synthetic-withdraw'),'system message retry duplicated');
select pg_temp.expect_denied($q$select fs_withdraw_approval('A00001','pd','bad-role')$q$);
select pg_temp.expect_denied($q$delete from fs_approvals where job_id='A00001'$q$);
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select pg_temp.assert_true((select count(*)=1 from fs_activities where uid='withdraw:synthetic-withdraw'),'withdraw audit missing/duplicated');
select pg_temp.assert_true((select data->>'user'='RA One' from fs_activities where uid='withdraw:synthetic-withdraw'),'withdraw audit actor spoofed');

-- Both inactive and unknown identities fail closed on every read path and privileged RPC.
do $$
declare id text; t text; n bigint;
begin
 foreach id in array array['66666666-6666-6666-6666-666666666666','77777777-7777-7777-7777-777777777777'] loop
  perform set_config('request.jwt.claim.sub',id,false);
  foreach t in array array['fs_records','fs_chats','fs_messages','fs_approvals','fs_users','fs_activities','fs_meta','fs_memberships'] loop
   execute format('select count(*) from public.%I',t) into n;
   perform pg_temp.assert_true(n=0,'inactive/unknown read leak: '||t);
  end loop;
  perform pg_temp.expect_denied('select fs_next_rec_seq()');
  perform pg_temp.expect_denied($q$select fs_withdraw_approval('A00001','ra','inactive-event')$q$);
 end loop;
end $$;
reset role;
\echo 'PASS retained-table authorization and atomic withdrawal'
