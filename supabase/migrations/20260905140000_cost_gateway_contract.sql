-- Cost Calculator gateway contract (additive, disabled until the trusted
-- source adapter and client transition are approved).
-- Critical Change: review in staging before production. This migration does
-- not alter the locked fs_records/fs_chats JSON contract or their legacy grants.

begin;

create table if not exists private.fs_cost_scenarios (
  project_id text not null check (project_id ~ '^[A-Z][0-9]{5}$'),
  scenario_id text not null check (scenario_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  revision integer not null check (revision > 0),
  inputs jsonb not null check (jsonb_typeof(inputs) = 'object'),
  safe_view jsonb not null check (jsonb_typeof(safe_view) = 'object'),
  raw_rm jsonb,
  raw_pk jsonb,
  raw_operation jsonb,
  source_digest text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (project_id, scenario_id, revision)
);

create table if not exists private.fs_cost_outbox (
  idempotency_key text primary key check (idempotency_key ~ '^[A-Za-z0-9:_-]{1,160}$'),
  project_id text not null check (project_id ~ '^[A-Z][0-9]{5}$'),
  scenario_id text not null check (scenario_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  revision integer not null check (revision > 0),
  source_digest text not null,
  body jsonb not null check (jsonb_typeof(body) = 'object'),
  status text not null check (status in ('pending','sent','failed')) default 'pending',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  receipt_id text,
  received_at timestamptz
);

create table if not exists private.fs_cost_approvals (
  project_id text not null check (project_id ~ '^[A-Z][0-9]{5}$'),
  scenario_id text not null check (scenario_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  revision integer not null check (revision > 0),
  source_digest text not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  primary key (project_id, scenario_id, revision)
);

alter table private.fs_cost_scenarios enable row level security;
alter table private.fs_cost_scenarios force row level security;
alter table private.fs_cost_outbox enable row level security;
alter table private.fs_cost_outbox force row level security;
alter table private.fs_cost_approvals enable row level security;
alter table private.fs_cost_approvals force row level security;
revoke all on table private.fs_cost_scenarios, private.fs_cost_outbox, private.fs_cost_approvals from public, anon, authenticated;

create or replace function private.fs_cost_capabilities(p_project_id text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare r text := private.fs_current_role();
begin
  if auth.uid() is null or not private.fs_is_active_member() then
    return jsonb_build_object('open',false,'editRM',false,'adoptPK',false,'sendSummary',false,'approveCEO',false);
  end if;
  if not exists (select 1 from public.fs_records where id=p_project_id) then
    return jsonb_build_object('open',false,'editRM',false,'adoptPK',false,'sendSummary',false,'approveCEO',false);
  end if;
  if r='sales' and not exists (
    select 1 from public.fs_records f
    where f.id=p_project_id and (f.data->>'createdBy'=private.fs_current_name() or f.data->>'salesOwner'=private.fs_current_name())
  ) then
    return jsonb_build_object('open',false,'editRM',false,'adoptPK',false,'sendSummary',false,'approveCEO',false);
  end if;
  return case
    when r in ('admin','rd') then jsonb_build_object('open',true,'editRM',true,'adoptPK',true,'sendSummary',true,'approveCEO',false)
    when r='purchasing' then jsonb_build_object('open',true,'editRM',false,'adoptPK',false,'sendSummary',true,'approveCEO',false)
    when r in ('sales','opc') then jsonb_build_object('open',true,'editRM',false,'adoptPK',false,'sendSummary',false,'approveCEO',false)
    -- Future role values are intentionally not added to the locked legacy
    -- role check here. Owner must define and review them before enablement.
    else jsonb_build_object('open',false,'editRM',false,'adoptPK',false,'sendSummary',false,'approveCEO',false)
  end;
end $$;

create or replace function private.fs_cost_authorized(p_project_id text, p_action text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((private.fs_cost_capabilities(p_project_id)->>p_action)::boolean,false)
$$;

create or replace function private.fs_cost_pending_view(p_project_id text, p_scenario_id text, p_revision integer, p_reason text)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'projectId',p_project_id,'scenarioId',p_scenario_id,'revision',p_revision,
    'label','ยังไม่ใช่ต้นทุนรวมต่อชิ้นหรือราคาพร้อมเสนอ',
    'complete',false,'pending',jsonb_build_array(p_reason),
    'rm',jsonb_build_object('adjustedTotal',null,'ready',false),
    'pk',jsonb_build_object('adjustedTotal',null,'ready',false),
    'operation',jsonb_build_object('adjustedTotal',null,'ready',false),
    'finalPerSellingUnit',null
  )
$$;

create or replace function private.fs_cost_open(p_project_id text, p_scenario_id text, p_revision integer)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare row_data private.fs_cost_scenarios%rowtype; caps jsonb; result jsonb; r text := private.fs_current_role();
begin
  if p_project_id is null or p_project_id !~ '^[A-Z][0-9]{5}$' or p_scenario_id is null or p_scenario_id !~ '^[A-Za-z0-9_-]{1,80}$' or p_revision is null or p_revision < 1 then raise exception 'INVALID_COST_IDENTITY' using errcode='22023'; end if;
  caps := private.fs_cost_capabilities(p_project_id);
  if coalesce((caps->>'open')::boolean,false) is not true then raise exception 'COST_PROJECT_ACCESS_DENIED' using errcode='42501'; end if;
  select * into row_data from private.fs_cost_scenarios where project_id=p_project_id and scenario_id=p_scenario_id and revision=p_revision;
  if not found then
    return jsonb_build_object('contract','cost-v1','projectId',p_project_id,'scenarioId',p_scenario_id,'revision',p_revision,
      'view',private.fs_cost_pending_view(p_project_id,p_scenario_id,p_revision,'ยังไม่มี revision ใน trusted cost gateway'),
      'capabilities',caps,'inputs','{}'::jsonb,'lines','[]'::jsonb,'catalog','[]'::jsonb);
  end if;
  result := jsonb_build_object('contract','cost-v1','projectId',p_project_id,'scenarioId',p_scenario_id,'revision',p_revision,
    'view',row_data.safe_view,'capabilities',caps,'inputs',row_data.inputs,
    'lines',case when r in ('admin','rd','purchasing') then coalesce(row_data.raw_rm->'lines','[]'::jsonb) else '[]'::jsonb end,
    'catalog','[]'::jsonb);
  if r in ('admin','rd','purchasing') then result := result || jsonb_build_object('rawRM',row_data.raw_rm); end if;
  if r in ('admin','purchasing') then result := result || jsonb_build_object('rawPK',row_data.raw_pk); end if;
  if r in ('admin','production','finance','ceo') then result := result || jsonb_build_object('rawOperation',row_data.raw_operation); end if;
  return result;
end $$;

create or replace function private.fs_cost_patch_allowed(p_patch jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select jsonb_typeof(p_patch)='object'
     and (select coalesce(bool_and(key in ('sellingUnits','unitsPerPack','fillAmount','lines')),true) from jsonb_object_keys(p_patch) key)
     and (not (p_patch ? 'lines') or (jsonb_typeof(p_patch->'lines')='array' and not exists (
       select 1 from jsonb_array_elements(p_patch->'lines') line
       where jsonb_typeof(line) <> 'object'
          or exists (select 1 from jsonb_object_keys(line) key where key not in ('id','alias','amount','lossPercent'))
     )))
$$;

create or replace function public.fs_cost_open(p_project_id text, p_scenario_id text, p_revision integer)
returns jsonb language sql security definer set search_path = '' as $$ select private.fs_cost_open(p_project_id,p_scenario_id,p_revision) $$;

create or replace function public.fs_cost_save(p_project_id text, p_scenario_id text, p_expected_revision integer, p_patch jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare current_row private.fs_cost_scenarios%rowtype; next_revision integer; merged_inputs jsonb; new_view jsonb;
begin
  if not private.fs_cost_authorized(p_project_id,'editRM') then raise exception 'COST_EDIT_DENIED' using errcode='42501'; end if;
  if not private.fs_cost_patch_allowed(p_patch) then raise exception 'COST_PATCH_FIELDS_REJECTED' using errcode='22023'; end if;
  select * into current_row from private.fs_cost_scenarios where project_id=p_project_id and scenario_id=p_scenario_id and revision=p_expected_revision for update;
  if p_expected_revision is null then
    if exists (select 1 from private.fs_cost_scenarios where project_id=p_project_id and scenario_id=p_scenario_id) then raise exception 'COST_EXPECTED_REVISION_REQUIRED' using errcode='40001'; end if;
    next_revision := 1; merged_inputs := p_patch;
    new_view := private.fs_cost_pending_view(p_project_id,p_scenario_id,next_revision,'รอ trusted calculator คำนวณ revision นี้');
    insert into private.fs_cost_scenarios(project_id,scenario_id,revision,inputs,safe_view,created_by)
      values (p_project_id,p_scenario_id,next_revision,merged_inputs,new_view,auth.uid());
  else
    if not found then raise exception 'COST_STALE_REVISION' using errcode='40001'; end if;
    next_revision := p_expected_revision + 1;
    merged_inputs := current_row.inputs || p_patch;
    new_view := private.fs_cost_pending_view(p_project_id,p_scenario_id,next_revision,'รอ trusted calculator คำนวณ revision นี้');
    insert into private.fs_cost_scenarios(project_id,scenario_id,revision,inputs,safe_view,raw_rm,raw_pk,raw_operation,source_digest,created_by)
      values (p_project_id,p_scenario_id,next_revision,merged_inputs,new_view,current_row.raw_rm,current_row.raw_pk,current_row.raw_operation,current_row.source_digest,auth.uid());
  end if;
  return private.fs_cost_open(p_project_id,p_scenario_id,next_revision);
end $$;

create or replace function public.fs_cost_send_summary(p_project_id text, p_scenario_id text, p_revision integer, p_idempotency_key text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare row_data private.fs_cost_scenarios%rowtype; body jsonb; existing private.fs_cost_outbox%rowtype; digest text;
begin
  if not private.fs_cost_authorized(p_project_id,'sendSummary') then raise exception 'COST_SUMMARY_DENIED' using errcode='42501'; end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9:_-]{1,160}$' then raise exception 'INVALID_COST_IDEMPOTENCY_KEY' using errcode='22023'; end if;
  select * into row_data from private.fs_cost_scenarios where project_id=p_project_id and scenario_id=p_scenario_id and revision=p_revision;
  if not found then raise exception 'COST_REVISION_NOT_FOUND' using errcode='22023'; end if;
  body := jsonb_build_object('projectId',p_project_id,'scenarioId',p_scenario_id,'revision',p_revision,'view',row_data.safe_view,'label','สรุปเบื้องต้น — ยังไม่ใช่ต้นทุนรวมต่อชิ้น');
  digest := md5(body::text);
  select * into existing from private.fs_cost_outbox where idempotency_key=p_idempotency_key;
  if found then
    if existing.source_digest <> digest then raise exception 'COST_SUMMARY_IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
    return jsonb_build_object('idempotencyKey',existing.idempotency_key,'status',existing.status,'receiptId',existing.receipt_id,'summary',existing.body);
  end if;
  insert into private.fs_cost_outbox(idempotency_key,project_id,scenario_id,revision,source_digest,body,created_by)
    values (p_idempotency_key,p_project_id,p_scenario_id,p_revision,digest,body,auth.uid());
  return jsonb_build_object('idempotencyKey',p_idempotency_key,'status','pending','receiptId',null,'summary',body);
end $$;

create or replace function public.fs_cost_approve(p_project_id text, p_scenario_id text, p_revision integer)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  -- The locked legacy membership enum has no CEO/Finance authority yet. Keep
  -- this endpoint fail-closed until that role/capability is owner-approved.
  raise exception 'CEO_AUTHORITY_NOT_CONFIGURED' using errcode='42501';
end $$;

revoke all on function private.fs_cost_capabilities(text) from public,anon,authenticated;
revoke all on function private.fs_cost_authorized(text,text) from public,anon,authenticated;
revoke all on function private.fs_cost_pending_view(text,text,integer,text) from public,anon,authenticated;
revoke all on function private.fs_cost_open(text,text,integer) from public,anon,authenticated;
revoke all on function private.fs_cost_patch_allowed(jsonb) from public,anon,authenticated;
revoke all on function public.fs_cost_open(text,text,integer) from public,anon;
revoke all on function public.fs_cost_save(text,text,integer,jsonb) from public,anon;
revoke all on function public.fs_cost_send_summary(text,text,integer,text) from public,anon;
revoke all on function public.fs_cost_approve(text,text,integer) from public,anon;
grant execute on function public.fs_cost_open(text,text,integer) to authenticated;
grant execute on function public.fs_cost_save(text,text,integer,jsonb) to authenticated;
grant execute on function public.fs_cost_send_summary(text,text,integer,text) to authenticated;
grant execute on function public.fs_cost_approve(text,text,integer) to authenticated;

commit;
