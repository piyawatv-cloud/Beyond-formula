-- Approved-release installation only. Apply after data-grants.sql/data-policy.sql.
-- This migration preserves the existing JSONB/table contract and existing rows.
\set ON_ERROR_STOP on
begin;

create or replace function public.fs_record_is_valid(p_id text, p_data jsonb)
returns boolean language sql immutable security invoker
set search_path = public, pg_temp
as $fn$
  select coalesce(
    p_id ~ '^[A-Z]+[0-9]{5}$'
    and jsonb_typeof(p_data) = 'object'
    and jsonb_typeof(p_data->'id') = 'string' and p_data->>'id' = p_id
    and ((jsonb_typeof(p_data->'customer') = 'string' and (p_data->>'customer') ~ '[^[:space:]]')
      or (jsonb_typeof(p_data->'brand') = 'string' and (p_data->>'brand') ~ '[^[:space:]]'))
    and jsonb_typeof(p_data->'rows') = 'array', false);
$fn$;
revoke all on function public.fs_record_is_valid(text, jsonb) from public;
grant execute on function public.fs_record_is_valid(text, jsonb) to anon, authenticated;

-- A deleted number is permanently retired. Run AFTER INSERT so unique-index
-- waits have completed: an uncommitted legacy INSERT then DELETE can otherwise
-- hide its archive row from an early check. This trigger reads only a boolean,
-- has no caller-controlled relation names and gives browsers no archive grants.
create index if not exists fs_archive_source_row_key_idx
  on public.fs_archive (source, row_key);
create or replace function public.fs_record_recreation_fence()
returns trigger language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if exists (select 1 from public.fs_archive
    where source = 'fs_records' and row_key = new.id) then
    raise exception using errcode = 'PFS01', message = 'JOB_ID_DELETED';
  end if;
  return new;
end
$fn$;
revoke all on function public.fs_record_recreation_fence() from public, anon, authenticated;
drop trigger if exists fs_records_recreation_fence on public.fs_records;
create trigger fs_records_recreation_fence after insert on public.fs_records
  for each row execute function public.fs_record_recreation_fence();

-- Compare-and-save one record. A lost HTTP reply may be retried with the same
-- data; equal committed data acknowledges that retry without another UPDATE.
-- A null expectation is create-only, never permission to overwrite an existing job.
-- Actor authorization is enforced by the gateway's special authorized save
-- branch, including when the RPC is allowlisted; generic RPC forwarding must
-- never bypass that branch. This function cannot elevate database privileges.
create or replace function public.fs_save_record(p_id text, p_data jsonb, p_expected jsonb)
returns jsonb language plpgsql security invoker
set search_path = public, pg_temp
as $fn$
declare stored jsonb;
begin
  if not public.fs_record_is_valid(p_id, p_data)
     or (p_expected is not null and jsonb_typeof(p_expected) <> 'object') then
    return jsonb_build_object('status', 'invalid', 'id', p_id);
  end if;
  -- Serializes create races between RPC calls. Row locks below also serialize
  -- legacy table writers, which do not acquire this advisory lock.
  perform pg_advisory_xact_lock(hashtextextended('fs_records:' || p_id, 0));
  select data into stored from public.fs_records where id = p_id for update;
  if not found then
    if p_expected is not null then
      return jsonb_build_object('status', 'conflict', 'id', p_id);
    end if;
    begin
      insert into public.fs_records(id, data) values (p_id, p_data)
        on conflict (id) do nothing returning data into stored;
    exception when sqlstate 'PFS01' then
      -- The subtransaction rolls back the attempted insertion. Retain the
      -- existing conflict contract and never expose deleted business data.
      return jsonb_build_object('status', 'conflict', 'id', p_id);
    end;
    if found then
      return jsonb_build_object('status', 'saved', 'id', p_id, 'data', stored);
    end if;
    -- A concurrent legacy INSERT may have won after our absent-row read.
    select data into stored from public.fs_records where id = p_id for update;
    if not found then
      return jsonb_build_object('status', 'invalid', 'id', p_id);
    end if;
  end if;
  if stored = p_data then
    return jsonb_build_object('status', 'saved', 'id', p_id, 'data', stored);
  end if;
  if p_expected is null or stored is distinct from p_expected then
    return jsonb_build_object('status', 'conflict', 'id', p_id);
  end if;
  update public.fs_records set data = p_data where id = p_id returning data into stored;
  if not found then
    -- A policy trigger may intentionally skip a write. Never fabricate an ACK.
    return jsonb_build_object('status', 'invalid', 'id', p_id);
  end if;
  return jsonb_build_object('status', 'saved', 'id', p_id, 'data', stored);
end
$fn$;
revoke all on function public.fs_save_record(text, jsonb, jsonb) from public;
grant execute on function public.fs_save_record(text, jsonb, jsonb) to anon, authenticated;

-- Existing orphan rows are retained. Future child writes require a valid saved
-- parent. Intentionally filtered legacy writes remain 2xx: returning NULL skips
-- the row instead of aborting the rest of sbPush(). The explicit gateway save
-- route reports rejection and must never infer persistence from HTTP 2xx alone.
create or replace function public.fs_chat_requires_saved_record()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp
as $fn$
declare parent jsonb;
begin
  select data into parent from public.fs_records where id = new.job_id for share;
  if not public.fs_record_is_valid(new.job_id, parent) then
    return null;
  end if;
  return new;
end
$fn$;
revoke all on function public.fs_chat_requires_saved_record() from public;

drop trigger if exists fs_chats_saved_record on public.fs_chats;
create trigger fs_chats_saved_record before insert or update on public.fs_chats
  for each row execute function public.fs_chat_requires_saved_record();
drop trigger if exists fs_messages_saved_record on public.fs_messages;
create trigger fs_messages_saved_record before insert or update on public.fs_messages
  for each row execute function public.fs_chat_requires_saved_record();
drop trigger if exists fs_approvals_saved_record on public.fs_approvals;
create trigger fs_approvals_saved_record before insert or update on public.fs_approvals
  for each row execute function public.fs_chat_requires_saved_record();

-- Narrow server-only ownership proof for child cleanup after a parent delete.
-- The gateway calls this RPC directly with its trusted upstream connection;
-- it is intentionally absent from the browser RPC allow-list and returns only
-- deleted job IDs owned by the supplied session name, never archive rows.
create or replace function public.fs_owner_deleted_jobs(p_ids text[], p_owner text)
returns jsonb language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select coalesce(jsonb_agg(a.row_key order by a.row_key), '[]'::jsonb)
  from public.fs_archive a
  where a.source = 'fs_records'
    and a.row_key = any(coalesce(p_ids, array[]::text[]))
    and (
      a.data->'data'->>'createdBy' = p_owner
      or (
        lower(trim(regexp_replace(regexp_replace(regexp_replace(coalesce(a.data->'data'->>'salesOwner',''), E'^\\d+\\.', ''), E'^(Sales|MKT)\\s*', '', 'i'), '^พี่', ''))) <> ''
        and lower(trim(regexp_replace(regexp_replace(regexp_replace(coalesce(p_owner,''), E'^\\d+\\.', ''), E'^(Sales|MKT)\\s*', '', 'i'), '^พี่', ''))) <> ''
        and lower(trim(regexp_replace(regexp_replace(regexp_replace(coalesce(a.data->'data'->>'salesOwner',''), E'^\\d+\\.', ''), E'^(Sales|MKT)\\s*', '', 'i'), '^พี่', '')))
            = lower(trim(regexp_replace(regexp_replace(regexp_replace(coalesce(p_owner,''), E'^\\d+\\.', ''), E'^(Sales|MKT)\\s*', '', 'i'), '^พี่', '')))
      )
    );
$fn$;
revoke all on function public.fs_owner_deleted_jobs(text[], text) from public;
grant execute on function public.fs_owner_deleted_jobs(text[], text) to anon, authenticated;

-- Canonical owner proof for archived child cleanup. The old two-argument
-- function remains available for rollback compatibility until the approved
-- owner-identity migration is installed; new gateway code uses this function.
-- A row with ownerEmail never falls back to a display-name comparison.
create or replace function public.fs_owner_deleted_jobs(p_ids text[], p_owner_email text, p_owner_name text)
returns jsonb language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select coalesce(jsonb_agg(a.row_key order by a.row_key), '[]'::jsonb)
  from public.fs_archive a
  where a.source = 'fs_records'
    and a.row_key = any(coalesce(p_ids, array[]::text[]))
    and (
      (
        nullif(trim(a.data->'data'->>'ownerEmail'), '') is not null
        and lower(trim(a.data->'data'->>'ownerEmail')) = lower(trim(coalesce(p_owner_email, '')))
      )
      or (
        nullif(trim(a.data->'data'->>'ownerEmail'), '') is null
        and (
          a.data->'data'->>'createdBy' = p_owner_name
          or (
            lower(trim(regexp_replace(regexp_replace(regexp_replace(coalesce(a.data->'data'->>'salesOwner',''), E'^\\d+\\.', ''), E'^(Sales|MKT)\\s*', '', 'i'), '^พี่', ''))) <> ''
            and lower(trim(regexp_replace(regexp_replace(regexp_replace(coalesce(p_owner_name,''), E'^\\d+\\.', ''), E'^(Sales|MKT)\\s*', '', 'i'), '^พี่', ''))) <> ''
            and lower(trim(regexp_replace(regexp_replace(regexp_replace(coalesce(a.data->'data'->>'salesOwner',''), E'^\\d+\\.', ''), E'^(Sales|MKT)\\s*', '', 'i'), '^พี่', '')))
                = lower(trim(regexp_replace(regexp_replace(regexp_replace(coalesce(p_owner_name,''), E'^\\d+\\.', ''), E'^(Sales|MKT)\\s*', '', 'i'), '^พี่', '')))
          )
        )
      )
    );
$fn$;
revoke all on function public.fs_owner_deleted_jobs(text[], text, text) from public;
grant execute on function public.fs_owner_deleted_jobs(text[], text, text) to anon, authenticated;

-- Runtime-only metadata scan. The gateway must NOT add this function to its
-- browser RPC allowlist. All-history intent scanning avoids client-clock loss;
-- exceeding the explicit bound reports incompleteness instead of a partial set.
create or replace function public.fs_job_integrity_snapshot()
returns jsonb language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  with intents as (
    select data->>'job' as id,
      bool_or(data->>'cat' = 'chat' and data->>'action' = 'สร้างห้องแชท') as chat_required
    from public.fs_activities
    where data->>'job' ~ '^[A-Z]+[0-9]{5}$'
      and ((data->>'cat' = 'job' and data->>'action' in ('สร้างชุดข้อมูลใหม่', 'คัดลอกงานเป็นรหัสใหม่'))
        or (data->>'cat' = 'chat' and data->>'action' = 'สร้างห้องแชท'))
    group by data->>'job'
  ), cardinality as (select count(*) as total from intents),
  items as (
    select i.id, jsonb_build_object(
      'id', i.id, 'exists', r.id is not null,
      'valid', public.fs_record_is_valid(i.id, r.data),
      'closed', coalesce(r.data->'closed' not in ('null'::jsonb, 'false'::jsonb, '0'::jsonb, '""'::jsonb), false),
      'rejected', coalesce(r.data->'rejected' not in ('null'::jsonb, 'false'::jsonb, '0'::jsonb, '""'::jsonb), false),
      'deleted', exists(select 1 from public.fs_archive a where a.source='fs_records' and a.row_key=i.id),
      'chatRequired', i.chat_required, 'chatExists', c.job_id is not null,
      'chatDeleted', exists(select 1 from public.fs_archive a where a.source='fs_chats' and a.row_key=i.id)
    ) as item
    from intents i left join public.fs_records r on r.id=i.id
      left join public.fs_chats c on c.job_id=i.id
    where (select total from cardinality) <= 20000
  )
  select jsonb_build_object('version',1, 'complete', total <= 20000, 'total',total,
    'items',coalesce((select jsonb_agg(item order by id) from items),'[]'::jsonb))
  from cardinality;
$fn$;
revoke all on function public.fs_job_integrity_snapshot() from public;
grant execute on function public.fs_job_integrity_snapshot() to anon, authenticated;

notify pgrst, 'reload schema';
commit;
