\set ON_ERROR_STOP on

-- Seed only synthetic gateway rows as the database owner. Raw fields are
-- intentionally present here to prove the projection boundary.
insert into auth.users(id,email) values ('99999999-9999-9999-9999-999999999999','rd@example.test') on conflict do nothing;
insert into public.fs_memberships(user_id,name,role,active)
values ('99999999-9999-9999-9999-999999999999','Synthetic RD','rd',true)
on conflict (user_id) do update set name=excluded.name,role=excluded.role,active=excluded.active;
insert into public.fs_memberships(user_id,name,role,active)
values ('22222222-2222-2222-2222-222222222222','Sales One','sales',true)
on conflict (user_id) do update set name=excluded.name,role=excluded.role,active=excluded.active;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
insert into public.fs_records(id,data)
values ('A00001','{"id":"A00001","createdBy":"Sales One","salesOwner":"Sales One"}'::jsonb)
on conflict (id) do nothing;
insert into public.fs_records(id,data)
values ('A00002','{"id":"A00002","createdBy":"Sales Two","salesOwner":"Sales Two"}'::jsonb)
on conflict (id) do nothing;
commit;

insert into private.fs_cost_scenarios(project_id,scenario_id,revision,inputs,safe_view,raw_rm,raw_pk,raw_operation,source_digest,created_by)
values (
  'A00001','S1',1,
  '{"sellingUnits":1000,"unitsPerPack":1,"fillAmount":1,"fillUnit":"g"}'::jsonb,
  '{"projectId":"A00001","scenarioId":"S1","revision":1,"label":"ยังไม่ใช่ต้นทุนรวมต่อชิ้นหรือราคาพร้อมเสนอ","complete":false,"pending":["PK รอยืนยัน"],"rm":{"adjustedTotal":125,"ready":true},"pk":{"adjustedTotal":null,"ready":false},"operation":{"adjustedTotal":null,"ready":false},"finalPerSellingUnit":null}'::jsonb,
  '{"lines":[{"id":"L1","alias":"รายการวัสดุทดสอบ","amount":1,"unit":"g","supplier":"SUPPLIER_SECRET","supplierPrice":9999}]}'::jsonb,
  '{"supplier":"PK_SECRET","supplierPrice":8888}'::jsonb,
  '{"rate":7777,"owner":"FINANCE_SECRET"}'::jsonb,
  'synthetic-digest',
  '99999999-9999-9999-9999-999999999999'
)
on conflict (project_id,scenario_id,revision) do update
set inputs=excluded.inputs,safe_view=excluded.safe_view,raw_rm=excluded.raw_rm,raw_pk=excluded.raw_pk,raw_operation=excluded.raw_operation;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
do $$
declare body jsonb;
begin
  body := public.fs_cost_open('A00001','S1',1);
  if body::text like '%SUPPLIER_SECRET%' or body::text like '%supplierPrice%' or body::text like '%PK_SECRET%' then
    raise exception 'Sales projection leaked raw supplier data';
  end if;
  if body->'view'->'rm'->>'adjustedTotal' <> '125' then raise exception 'safe adjusted RM amount missing'; end if;
  if (body->'capabilities'->>'editRM')::boolean then raise exception 'Sales received RM edit capability'; end if;
  if body->'inputs' <> '{}'::jsonb then raise exception 'Sales received scenario inputs'; end if;
end $$;
do $$
begin
  perform public.fs_cost_open('A00002','S1',1);
  raise exception 'Sales opened an unassigned project';
exception when others then
  if SQLERRM <> 'COST_PROJECT_ACCESS_DENIED' then raise; end if;
end $$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-9999-9999-999999999999',true);
do $$
declare body jsonb;
begin
  body := public.fs_cost_open('A00001','S1',1);
  if body::text not like '%SUPPLIER_SECRET%' then raise exception 'RD raw RM projection missing'; end if;
  if not (body->'capabilities'->>'editRM')::boolean then raise exception 'RD edit capability missing'; end if;
end $$;
select public.fs_cost_save('A00001','S1',1,'{"sellingUnits":2000,"lines":[{"id":"L1","alias":"ชื่อ revision","amount":2,"lossPercent":null}]}'::jsonb);
do $$
declare current_body jsonb; old_body jsonb;
begin
  current_body := public.fs_cost_open('A00001','S1',2);
  old_body := public.fs_cost_open('A00001','S1',1);
  if current_body->'inputs'->>'sellingUnits' <> '2000' then
    raise exception 'new cost revision was not append-only saved';
  end if;
  if old_body->>'revision' <> '1' or old_body->'inputs'->>'sellingUnits' <> '1000' then raise exception 'old cost revision was changed'; end if;
end $$;
\set ON_ERROR_STOP off
select public.fs_cost_save('A00001','S1',2,'{"price":9999}'::jsonb);
\if :ERROR
  \echo 'PASS raw price patch rejected'
\else
  \echo 'FAIL raw price patch accepted'
  \quit 1
\endif
\set ON_ERROR_STOP on
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-9999-9999-999999999999',true);
do $$
declare first_body jsonb; second_body jsonb;
begin
  first_body := public.fs_cost_send_summary('A00001','S1',1,'A00001:S1:1:summary');
  second_body := public.fs_cost_send_summary('A00001','S1',1,'A00001:S1:1:summary');
  if first_body->>'status' <> 'pending' or second_body->>'status' <> 'pending' then raise exception 'summary was falsely marked sent'; end if;
  if first_body->>'idempotencyKey' <> second_body->>'idempotencyKey' then raise exception 'summary retry changed identity'; end if;
  if first_body::text like '%SUPPLIER_SECRET%' then raise exception 'summary outbox leaked raw supplier data'; end if;
end $$;
commit;

\set ON_ERROR_STOP off
begin; set local role anon; select public.fs_cost_open('A00001','S1',1);
\if :ERROR
  \echo 'PASS anon cost RPC denied'
\else
  \echo 'FAIL anon cost RPC unexpectedly allowed'
  \quit 1
\endif
rollback;
\set ON_ERROR_STOP on

\echo 'PASS cost gateway projection, revision, patch and outbox contract'
