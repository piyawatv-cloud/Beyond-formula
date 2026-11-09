\set ON_ERROR_STOP on
-- Temporary PostgreSQL with synthetic users/data. This probes current schema;
-- an unsafe result is an intentional failure, never a production operation.
insert into public.fs_memberships(user_id,name,role,active) values
 ('22222222-2222-2222-2222-222222222222','Sales One','sales',true),
 ('33333333-3333-3333-3333-333333333333','Sales Two','sales',true)
on conflict (user_id) do update set name=excluded.name,role=excluded.role,active=excluded.active;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
insert into public.fs_records(id,data) values
 ('A00001','{"id":"A00001","customer":"ลูกค้าทดสอบ 1","brand":"ก่อนแก้","notes":"ก่อนแก้","createdBy":"Sales One","rows":[]}'::jsonb),
 ('A00002','{"id":"A00002","customer":"ลูกค้าทดสอบ 2","createdBy":"Sales Two","rows":[]}'::jsonb);
commit;
-- Add only fixture identities missing from the existing test bootstrap.
insert into auth.users(id,email) values
 ('99999999-9999-9999-9999-999999999999','rd@example.test'),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','mkt@example.test'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','purchasing@example.test') on conflict do nothing;
insert into public.fs_memberships(user_id,name,role,active) values
 ('44444444-4444-4444-4444-444444444444','PD One','pd',true),
 ('55555555-5555-5555-5555-555555555555','RA One','ra',true),
 ('88888888-8888-8888-8888-888888888888','OPC One','opc',true),
 ('99999999-9999-9999-9999-999999999999','RD One','rd',true),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','MKT One','mkt',true),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Purchasing One','purchasing',true)
on conflict (user_id) do update set name=excluded.name,role=excluded.role,active=excluded.active;
-- This verifies allowed/denied record operations of the supplied schema;
-- fixture identities and all mutations are rolled back.
begin;
set local role authenticated;
do $$
declare r record; changed integer; allowed boolean; job_id text; i integer:=0;
begin
 for r in select * from (values
   ('admin','11111111-1111-1111-1111-111111111111','Admin Owner',true,true),
   ('sales','22222222-2222-2222-2222-222222222222','Sales One',true,true),
   ('pd','44444444-4444-4444-4444-444444444444','PD One',false,true),
   ('ra','55555555-5555-5555-5555-555555555555','RA One',false,false),
   ('rd','99999999-9999-9999-9999-999999999999','RD One',false,false),
   ('opc','88888888-8888-8888-8888-888888888888','OPC One',true,true),
   ('mkt','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','MKT One',true,true),
   ('purchasing','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Purchasing One',false,false)
 ) as t(role_name,uid,user_name,can_create,can_edit) loop
   i:=i+1;perform set_config('request.jwt.claim.sub',r.uid,true);
   update public.fs_records set data=jsonb_set(data,'{notes}',to_jsonb(r.role_name::text),true) where id='A00001';
   get diagnostics changed=row_count;
   if (changed=1) is distinct from r.can_edit then raise exception 'unexpected update access for %',r.role_name; end if;
   allowed:=true;job_id:='A'||lpad((100+i)::text,5,'0');
   begin
     insert into public.fs_records(id,data) values(job_id,jsonb_build_object('id',job_id,'customer','ตัวอย่าง','createdBy',r.user_name,'rows','[]'::jsonb));
   exception when insufficient_privilege then allowed:=false; end;
   if allowed is distinct from r.can_create then raise exception 'unexpected create access for %',r.role_name; end if;
 end loop;
 raise notice 'PASS create and edit role matrix across 8 fixture accounts';
end $$;
rollback;
-- Existing separate requests: a Sales owner can change its job, but the
-- server rejects the job_edit event that resets approvals. Keep this as a
-- diagnostic, not an assertion about the currently deployed environment.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
select public.fs_append_chat_event('sales-fixture-approval','A00001','{"type":"approval_set","key":"pd"}'::jsonb);
commit;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
update public.fs_records set data=jsonb_set(data,'{notes}','"sales edit fixture"'::jsonb) where id='A00001';
commit;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
do $$
declare blocked boolean:=false; approval jsonb;
begin
 begin
   perform public.fs_append_chat_event('sales-edit-fixture','A00001','{"type":"system","action":"job_edit","text":"fixture"}'::jsonb);
 exception when insufficient_privilege then blocked:=true;
 end;
 select data->'approvals'->'pd' into approval from public.fs_chats where job_id='A00001';
 if blocked and approval is not null and approval<>'null'::jsonb then
   raise notice 'UNSAFE Sales job edit committed while approval-reset event was denied';
 elsif blocked then
   raise notice 'REVIEW Sales job edit event denied; approval state changed elsewhere';
 else
   raise notice 'PASS Sales job edit reset event allowed';
 end if;
end $$;
rollback;
-- Check two other roles allowed to update a record against the same event.
begin;
set local role authenticated;
do $$
declare r record; blocked boolean; changed integer; approval jsonb;
begin
 for r in select * from (values
  ('opc','88888888-8888-8888-8888-888888888888'),
  ('mkt','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
 ) as fixture(role_name,uid) loop
  perform set_config('request.jwt.claim.sub',r.uid,true);
  update public.fs_records set data=jsonb_set(data,'{notes}',to_jsonb(r.role_name::text)) where id='A00001';
  get diagnostics changed=row_count;
  blocked:=false;
  begin
   perform public.fs_append_chat_event('fixture-edit-'||r.role_name,'A00001','{"type":"system","action":"job_edit","text":"fixture"}'::jsonb);
  exception when insufficient_privilege then blocked:=true;
  end;
  select data->'approvals'->'pd' into approval from public.fs_chats where job_id='A00001';
  if changed=1 and blocked and approval is not null and approval<>'null'::jsonb then
    raise notice 'UNSAFE % job edit accepted while approval-reset event was denied',upper(r.role_name);
  elsif blocked then raise notice 'REVIEW % job edit event denied',upper(r.role_name);
  else raise notice 'PASS % job edit reset event allowed',upper(r.role_name); end if;
 end loop;
end $$;
rollback;
-- Two independently held snapshots represent mobile and desktop after both
-- read the same row. The second whole-record write may erase the first edit.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
do $$
declare mobile jsonb; desktop jsonb; actual jsonb;
begin
 select data into mobile from public.fs_records where id='A00001';
 desktop:=mobile;
 update public.fs_records set data=jsonb_set(mobile,'{brand}','"แก้โดยมือถือ"'::jsonb) where id='A00001';
 update public.fs_records set data=jsonb_set(desktop,'{notes}','"แก้โดยคอม"'::jsonb) where id='A00001';
 select data into actual from public.fs_records where id='A00001';
 if actual->>'brand'='แก้โดยมือถือ' and actual->>'notes'='แก้โดยคอม' then
   raise notice 'PASS stale snapshot changes both survived';
 else
   raise notice 'UNSAFE stale whole-record write overwrote another client change';
 end if;
end $$;
commit;
-- Candidate guard, tested only as SQL: a stale snapshot is refused instead of
-- overwriting newer data. It is not installed as an application API.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
do $$
declare snapshot jsonb; count_first integer; count_second integer;
begin
 select data into snapshot from public.fs_records where id='A00001';
 update public.fs_records set data=jsonb_set(snapshot,'{brand}','"แก้แบบตรวจรุ่น"'::jsonb) where id='A00001' and data=snapshot;
 get diagnostics count_first = row_count;
 update public.fs_records set data=jsonb_set(snapshot,'{notes}','"ข้อมูลเก่า"'::jsonb) where id='A00001' and data=snapshot;
 get diagnostics count_second = row_count;
 if count_first<>1 or count_second<>0 then raise exception 'conditional write did not reject stale snapshot'; end if;
 raise notice 'PASS conditional write rejects stale snapshot in temporary database';
end $$;
rollback;
-- The current event RPC deduplicates event IDs even when the text differs.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
do $$
declare first_event jsonb; next_event jsonb;
begin
 first_event:=public.fs_append_chat_event('event-fixture-1','A00001','{"type":"message","text":"ข้อความแรก"}'::jsonb);
 next_event:=public.fs_append_chat_event('event-fixture-1','A00001','{"type":"message","text":"ข้อความต่างกัน"}'::jsonb);
 if next_event=first_event then raise notice 'REVIEW event ID reused with different text returns original event';
 else raise notice 'PASS conflicting event IDs are distinguished'; end if;
end $$;
rollback;
-- Direct database read differs from the existing Sales screen filter.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
do $$
begin
 if exists(select 1 from public.fs_records where id='A00002') then
   raise notice 'REVIEW Sales direct read includes another Sales owner job';
 else
   raise notice 'PASS Sales direct read excludes another owner job';
 end if;
end $$;
rollback;
