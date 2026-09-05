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
  '{"projectId":"A00001","scenarioId":"S1","revision":1,"label":"SUPPLIER_LABEL_SECRET","complete":false,"pending":[{"supplier":"SUPPLIER_PENDING_SECRET"}],"rm":{"adjustedTotal":125,"ready":true},"pk":{"adjustedTotal":null,"ready":false},"operation":{"adjustedTotal":null,"ready":false},"finalPerSellingUnit":null}'::jsonb,
  '{"lines":[{"id":"L1","alias":"รายการวัสดุทดสอบ","amount":1,"unit":"g","supplier":"SUPPLIER_SECRET","supplierPrice":9999}]}'::jsonb,
  '{"supplier":"PK_SECRET","supplierPrice":8888}'::jsonb,
  '{"rate":7777,"owner":"FINANCE_SECRET"}'::jsonb,
  'synthetic-digest',
  '99999999-9999-9999-9999-999999999999'
)
on conflict (project_id,scenario_id,revision) do update
set inputs=excluded.inputs,safe_view=excluded.safe_view,raw_rm=excluded.raw_rm,raw_pk=excluded.raw_pk,raw_operation=excluded.raw_operation;

-- The gateway is default-deny until a trusted owner enables the feature flag.
delete from public.fs_meta where key='cost_gateway_enabled';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-9999-9999-999999999999',true);
do $$
begin
  perform public.fs_cost_open('A00001','S1',1);
  raise exception 'disabled cost gateway unexpectedly allowed access';
exception when others then
  if SQLERRM <> 'COST_PROJECT_ACCESS_DENIED' then raise; end if;
end $$;
rollback;
insert into public.fs_meta(key,value) values('cost_gateway_enabled','{"enabled":true}'::jsonb)
on conflict (key) do update set value=excluded.value;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
do $$
begin
  update public.fs_meta set value='{"enabled":true}'::jsonb where key='cost_gateway_enabled';
  raise exception 'non-admin changed gateway flag';
exception when others then
  if SQLERRM <> 'COST_GATEWAY_FLAG_ADMIN_ONLY' then raise; end if;
end $$;
do $$
begin
  insert into public.fs_meta(key,value) values('temporary_gateway_key','{"enabled":false}'::jsonb)
  on conflict (key) do update set value=excluded.value;
  update public.fs_meta set key='cost_gateway_enabled', value='{"enabled":true}'::jsonb
  where key='temporary_gateway_key';
  raise exception 'non-admin renamed a key into gateway flag';
exception when others then
  if SQLERRM <> 'COST_GATEWAY_FLAG_ADMIN_ONLY' then raise; end if;
end $$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
do $$
declare body jsonb;
begin
  body := public.fs_cost_open('A00001','S1',1);
  if body::text like '%SUPPLIER_SECRET%' or body::text like '%SUPPLIER_LABEL_SECRET%' or body::text like '%SUPPLIER_PENDING_SECRET%' or body::text like '%supplierPrice%' or body::text like '%PK_SECRET%' then
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
  if current_body->'lines'->0->>'alias' <> 'ชื่อ revision' or current_body->'lines'->0->>'amount' <> '2' then
    raise exception 'saved line edits were not reflected in current revision';
  end if;
  if old_body->>'revision' <> '1' or old_body->'inputs'->>'sellingUnits' <> '1000' then raise exception 'old cost revision was changed'; end if;
end $$;
select public.fs_cost_save('A00001','S1',2,'{"lines":[]}'::jsonb);
do $$
declare empty_body jsonb;
begin
  empty_body := public.fs_cost_open('A00001','S1',3);
  if empty_body->'lines' <> '[]'::jsonb then raise exception 'explicit empty line edit restored old RM lines'; end if;
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


-- ---------------------------------------------------------------------------
-- Negative contract tests: role/category boundaries, stale revisions, changed
-- summary content and approval immutability. Synthetic rows only.
-- ---------------------------------------------------------------------------

insert into auth.users(id,email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','purchasing@example.test'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','mkt@example.test')
on conflict do nothing;
insert into public.fs_memberships(user_id,name,role,active) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Synthetic Purchasing','purchasing',true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Synthetic Marketing','mkt',true)
on conflict (user_id) do update set name=excluded.name,role=excluded.role,active=excluded.active;

-- RD may read raw RM but must never receive raw PK or raw Operation, and no
-- mapped role may claim the historical-view capability the client requires.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-9999-9999-999999999999',true);
do $$
declare body jsonb;
begin
  body := public.fs_cost_open('A00001','S1',1);
  if body ? 'rawPK' or body::text like '%PK_SECRET%' then raise exception 'RD received raw PK data'; end if;
  if body ? 'rawOperation' or body::text like '%FINANCE_SECRET%' then raise exception 'RD received raw Operation data'; end if;
  if (body->'capabilities'->>'viewRevision')::boolean then raise exception 'RD was granted an unreviewed historical-view capability'; end if;
  if (body->'capabilities'->>'approveCEO')::boolean then raise exception 'RD was granted CEO approval'; end if;
end $$;
commit;
\echo 'PASS RD denied raw PK and raw Operation'

-- The generic legacy purchasing role cannot express Procurement RM versus
-- PU-PK separation, so it must receive no raw category at all.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true);
do $$
declare body jsonb;
begin
  body := public.fs_cost_open('A00001','S1',1);
  if body ? 'rawRM' or body ? 'rawPK' or body ? 'rawOperation' then raise exception 'purchasing received a raw category'; end if;
  if body::text like '%SUPPLIER_SECRET%' or body::text like '%PK_SECRET%' or body::text like '%FINANCE_SECRET%' then
    raise exception 'purchasing projection leaked raw source data';
  end if;
  if body->'inputs' <> '{}'::jsonb or body->'lines' <> '[]'::jsonb then raise exception 'purchasing received scenario inputs or lines'; end if;
  if (body->'capabilities'->>'editRM')::boolean or (body->'capabilities'->>'adoptPK')::boolean
     or (body->'capabilities'->>'sendSummary')::boolean or (body->'capabilities'->>'viewRevision')::boolean then
    raise exception 'purchasing received an unmapped capability';
  end if;
end $$;
commit;
\echo 'PASS purchasing denied every raw category'

-- Roles with no reviewed cost mapping fail closed rather than defaulting open.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',true);
do $$
begin
  perform public.fs_cost_open('A00001','S1',1);
  raise exception 'unmapped role opened the cost gateway';
exception when others then
  if SQLERRM <> 'COST_PROJECT_ACCESS_DENIED' then raise; end if;
end $$;
commit;
\echo 'PASS unmapped role denied'

-- Sales must not receive the safe projection of a project it does not own, and
-- must never be handed a historical-view capability.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
do $$
declare body jsonb;
begin
  body := public.fs_cost_open('A00001','S1',1);
  if (body->'capabilities'->>'viewRevision')::boolean then raise exception 'Sales was granted a historical-view capability'; end if;
  if body->'view' ? 'baseTotal' or body->'view'->'rm' ? 'baseTotal' then raise exception 'Sales projection carried a base cost field'; end if;
end $$;
commit;
\echo 'PASS Sales denied historical-view capability and base cost'

-- A non-admin cannot remove the gateway flag to reach the default-deny branch
-- from the other direction either.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-9999-9999-999999999999',true);
-- The delete policy filters the row out before the guard trigger can fire, so
-- assert the surviving state rather than a specific error.
do $$
begin
  delete from public.fs_meta where key='cost_gateway_enabled';
  if not exists (select 1 from public.fs_meta where key='cost_gateway_enabled' and value->>'enabled'='true') then
    raise exception 'non-admin removed the gateway flag';
  end if;
end $$;
commit;
\echo 'PASS non-admin cannot remove gateway flag'

-- Editing an outdated revision must be refused explicitly, not collide on the
-- primary key and reach the client as a generic retryable failure.
-- Build the newer revision in its own committed transaction. The earlier block
-- deliberately raises inside its transaction, so its revisions are rolled back
-- and cannot be relied on here.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-9999-9999-999999999999',true);
select public.fs_cost_save('A00001','S1',1,'{"sellingUnits":3000}'::jsonb);
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-9999-9999-999999999999',true);
do $$
begin
  perform public.fs_cost_save('A00001','S1',1,'{"sellingUnits":4242}'::jsonb);
  raise exception 'stale revision edit was accepted';
exception when others then
  if SQLERRM <> 'COST_STALE_REVISION' then raise; end if;
end $$;
do $$
begin
  perform public.fs_cost_save('A00001','S1',99,'{"sellingUnits":4242}'::jsonb);
  raise exception 'edit against a missing revision was accepted';
exception when others then
  if SQLERRM <> 'COST_STALE_REVISION' then raise; end if;
end $$;
do $$
declare body jsonb;
begin
  body := public.fs_cost_open('A00001','S1',2);
  if body->'inputs'->>'sellingUnits' <> '3000' then raise exception 'refused stale edit still changed the current revision'; end if;
end $$;
-- The private scenario store itself stays unreadable to the authenticated role;
-- only the projection RPCs may reach it.
do $$
begin
  perform 1 from private.fs_cost_scenarios;
  raise exception 'authenticated role read the private scenario store directly';
exception when insufficient_privilege then
  null;
end $$;
commit;
-- Fork check runs as the owner, because authenticated cannot read the store.
do $$
begin
  if exists (select 1 from private.fs_cost_scenarios where project_id='A00001' and scenario_id='S1' and revision>2) then
    raise exception 'refused stale edit still forked a new revision';
  end if;
end $$;
\echo 'PASS stale revision edit rejected without forking history'
\echo 'PASS private cost store unreadable to authenticated role'

-- Reusing one idempotency key for different content must conflict instead of
-- silently returning the earlier receipt for the newer revision.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-9999-9999-999999999999',true);
do $$
begin
  perform public.fs_cost_send_summary('A00001','S1',2,'A00001:S1:1:summary');
  raise exception 'changed summary content reused an existing idempotency key';
exception when others then
  if SQLERRM <> 'COST_SUMMARY_IDEMPOTENCY_CONFLICT' then raise; end if;
end $$;
do $$
declare body jsonb;
begin
  body := public.fs_cost_send_summary('A00001','S1',2,'A00001:S1:2:summary');
  if body->>'status' <> 'pending' or body->>'receiptId' is not null then raise exception 'a queued summary was reported as delivered'; end if;
end $$;
commit;
\echo 'PASS summary idempotency conflict and pending receipt contract'

-- CEO approval stays fail-closed for every currently mapped role.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-9999-9999-999999999999',true);
do $$
begin
  perform public.fs_cost_approve('A00001','S1',1);
  raise exception 'CEO approval endpoint was reachable';
exception when others then
  if SQLERRM <> 'CEO_AUTHORITY_NOT_CONFIGURED' then raise; end if;
end $$;
commit;
\echo 'PASS CEO approval fail-closed'

-- An approved snapshot must survive both a later revision and a change to the
-- underlying source row. Seeded as owner because no public path can approve.
insert into private.fs_cost_approvals(project_id,scenario_id,revision,source_digest,snapshot,approved_by)
values ('A00001','S1',1,'synthetic-digest',
  '{"projectId":"A00001","scenarioId":"S1","revision":1,"rm":{"adjustedTotal":125},"finalPerSellingUnit":null}'::jsonb,
  '99999999-9999-9999-9999-999999999999')
on conflict (project_id,scenario_id,revision) do nothing;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-9999-9999-999999999999',true);
select public.fs_cost_save('A00001','S1',2,'{"sellingUnits":5000}'::jsonb);
commit;

-- Simulate the upstream source being renegotiated after approval.
update private.fs_cost_scenarios
set raw_rm='{"lines":[{"id":"L1","alias":"เงื่อนไขใหม่","amount":1,"unit":"g","supplier":"SUPPLIER_SECRET_V2","supplierPrice":1234}]}'::jsonb,
    raw_pk='{"supplier":"PK_SECRET_V2","supplierPrice":4321}'::jsonb,
    source_digest='synthetic-digest-v2'
where project_id='A00001' and scenario_id='S1' and revision=1;

do $$
declare approved private.fs_cost_approvals%rowtype;
begin
  select * into approved from private.fs_cost_approvals where project_id='A00001' and scenario_id='S1' and revision=1;
  if approved.source_digest <> 'synthetic-digest' then raise exception 'approved snapshot digest followed the changed source'; end if;
  if approved.snapshot->'rm'->>'adjustedTotal' <> '125' then raise exception 'approved snapshot numbers were rewritten'; end if;
  if approved.snapshot->>'revision' <> '1' then raise exception 'approved snapshot was repointed to another revision'; end if;
  if not exists (select 1 from private.fs_cost_scenarios where project_id='A00001' and scenario_id='S1' and revision=3) then
    raise exception 'new revision after approval was not recorded';
  end if;
end $$;
\echo 'PASS approved snapshot immutable across new revision and changed source'


-- ---------------------------------------------------------------------------
-- Capability surface snapshot. Every role value allowed by the fs_memberships
-- role check is pinned to its exact capability object, so adding a capability
-- key, granting an existing one, or introducing a new role cannot pass review
-- unnoticed. This is the guard for the class of defect where a dead role branch
-- silently starts disclosing raw data once the role name becomes reachable.
-- ---------------------------------------------------------------------------

insert into auth.users(id,email) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','caps.admin@example.test'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','caps.pd@example.test'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','caps.ra@example.test'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff','caps.opc@example.test')
on conflict do nothing;
insert into public.fs_memberships(user_id,name,role,active) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','Caps Admin','admin',true),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','Caps PD','pd',true),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','Caps RA','ra',true),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff','Caps OPC','opc',true)
on conflict (user_id) do update set name=excluded.name,role=excluded.role,active=excluded.active;

begin;
set local role authenticated;
do $$
declare
  -- One row per role value in the fs_memberships role check. 'denied' means the
  -- role must not reach the gateway at all. Update this table only together
  -- with an approved capability-mapping change.
  spec jsonb := '[
    {"role":"admin",     "uid":"cccccccc-cccc-cccc-cccc-cccccccccccc","open":true, "editRM":true, "adoptPK":true, "sendSummary":true, "approveCEO":false,"viewRevision":false},
    {"role":"rd",        "uid":"99999999-9999-9999-9999-999999999999","open":true, "editRM":true, "adoptPK":true, "sendSummary":true, "approveCEO":false,"viewRevision":false},
    {"role":"purchasing","uid":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","open":true, "editRM":false,"adoptPK":false,"sendSummary":false,"approveCEO":false,"viewRevision":false},
    {"role":"sales",     "uid":"22222222-2222-2222-2222-222222222222","open":true, "editRM":false,"adoptPK":false,"sendSummary":false,"approveCEO":false,"viewRevision":false},
    {"role":"opc",       "uid":"ffffffff-ffff-ffff-ffff-ffffffffffff","open":true, "editRM":false,"adoptPK":false,"sendSummary":false,"approveCEO":false,"viewRevision":false},
    {"role":"pd",        "uid":"dddddddd-dddd-dddd-dddd-dddddddddddd","denied":true},
    {"role":"ra",        "uid":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","denied":true},
    {"role":"mkt",       "uid":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","denied":true}
  ]'::jsonb;
  item jsonb; caps jsonb; expected jsonb; covered text[];
begin
  for item in select value from jsonb_array_elements(spec) loop
    perform set_config('request.jwt.claim.sub', item->>'uid', true);
    if coalesce((item->>'denied')::boolean,false) then
      begin
        perform public.fs_cost_open('A00001','S1',1);
        raise exception 'role % reached the cost gateway without a reviewed mapping', item->>'role';
      exception when others then
        if SQLERRM <> 'COST_PROJECT_ACCESS_DENIED' then raise; end if;
      end;
    else
      caps := public.fs_cost_open('A00001','S1',1)->'capabilities';
      expected := jsonb_build_object(
        'open',item->'open','editRM',item->'editRM','adoptPK',item->'adoptPK',
        'sendSummary',item->'sendSummary','approveCEO',item->'approveCEO','viewRevision',item->'viewRevision');
      if caps <> expected then
        raise exception 'capability surface for role % changed. expected % got %', item->>'role', expected, caps;
      end if;
    end if;
  end loop;

  -- Any role value the schema permits but this snapshot does not list would go
  -- unreviewed, so fail if the two ever drift apart.
  select array_agg(value->>'role' order by value->>'role') into covered from jsonb_array_elements(spec);
  if exists (
    select 1 from unnest(array['admin','pd','ra','rd','sales','opc','mkt','purchasing']) role_value
    where role_value <> all(covered)
  ) then
    raise exception 'a schema role value is missing from the capability snapshot';
  end if;
end $$;
commit;
\echo 'PASS capability surface snapshot pinned for every schema role'

\echo 'PASS cost gateway projection, revision, patch and outbox contract'
