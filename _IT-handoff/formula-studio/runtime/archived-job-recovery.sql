-- Archived job recovery procedure for operator review only.
-- This file is intentionally separate from browser RPC/data grants and is not a
-- production execution record. It must be reviewed and installed through the
-- normal migration/release gates before any operator can use it.
--
-- Preconditions:
--   * migration is run by the approved database role `postgres`;
--   * pgcrypto is available for canonical SHA-256 evidence;
--   * fs_archive is immutable and all writes remain inside one transaction;
--   * the caller has separately verified a fresh backup and release/lock evidence.

\set ON_ERROR_STOP on

begin;

do $migration_guard$
begin
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception 'RECOVERY_MIGRATION_REQUIRES_POSTGRES';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'postgres') then
    raise exception 'RECOVERY_OPERATOR_ROLE_MISSING: postgres';
  end if;
end;
$migration_guard$;

create extension if not exists pgcrypto;

-- The database role is the security boundary. There is deliberately no secret
-- or browser-callable bypass. A non-postgres session cannot activate recovery,
-- even if it can set a custom GUC or is not one of the browser roles.
create or replace function public.fs_recovery_operator_check()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception 'RECOVERY_OPERATOR_ROLE_REQUIRED: postgres';
  end if;
end;
$$;

create or replace function public.fs_recovery_canonical_timestamp(p_value timestamptz)
returns text
language sql
immutable
strict
as $$
  select to_char(
    p_value at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
  );
$$;

create or replace function public.fs_recovery_timestamp_from_json(
  p_row jsonb,
  p_field text,
  p_context text
)
returns timestamptz
language plpgsql
immutable
as $$
declare
  v_value text;
  v_result timestamptz;
begin
  if p_row is null
     or jsonb_typeof(p_row -> p_field) is distinct from 'string' then
    raise exception 'ARCHIVE_TIMESTAMP_INVALID: % missing_or_not_string', p_context;
  end if;

  v_value := nullif(btrim(p_row ->> p_field), '');
  if v_value is null then
    raise exception 'ARCHIVE_TIMESTAMP_INVALID: % missing_or_blank', p_context;
  end if;

  begin
    v_result := v_value::timestamptz;
  exception when others then
    raise exception 'ARCHIVE_TIMESTAMP_INVALID: % invalid_value', p_context;
  end;

  return v_result;
end;
$$;

-- Canonical JSON recipe:
--   * input is an explicit jsonb object with exactly the documented fields;
--   * jsonb::text is PostgreSQL's canonical JSONB serialization (sorted object
--     keys, no insignificant whitespace, JSON null for SQL null);
--   * timestamps are normalized to UTC with six fractional digits and a Z;
--   * output is lowercase hexadecimal SHA-256 over UTF-8 canonical JSON bytes.
create or replace function public.fs_recovery_sha256(p_value jsonb)
returns text
language sql
immutable
strict
as $$
  select encode(digest(convert_to(p_value::text, 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function public.fs_recovery_parent_sha256(
  p_id text,
  p_data jsonb,
  p_updated_at timestamptz
)
returns text
language sql
immutable
as $$
  select public.fs_recovery_sha256(jsonb_build_object(
    'id', p_id,
    'data', p_data,
    'updated_at', public.fs_recovery_canonical_timestamp(p_updated_at)
  ));
$$;

create or replace function public.fs_recovery_chat_sha256(
  p_job_id text,
  p_data jsonb,
  p_updated_at timestamptz
)
returns text
language sql
immutable
as $$
  select public.fs_recovery_sha256(jsonb_build_object(
    'job_id', p_job_id,
    'data', p_data,
    'updated_at', public.fs_recovery_canonical_timestamp(p_updated_at)
  ));
$$;

create or replace function public.fs_recovery_message_sha256(
  p_uid text,
  p_job_id text,
  p_ts bigint,
  p_data jsonb,
  p_updated_at timestamptz
)
returns text
language sql
immutable
as $$
  select public.fs_recovery_sha256(jsonb_build_object(
    'uid', p_uid,
    'job_id', p_job_id,
    'ts', p_ts,
    'data', p_data,
    'updated_at', public.fs_recovery_canonical_timestamp(p_updated_at)
  ));
$$;

create or replace function public.fs_recovery_activity_sha256(
  p_uid text,
  p_ts bigint,
  p_data jsonb
)
returns text
language sql
immutable
as $$
  select public.fs_recovery_sha256(jsonb_build_object(
    'uid', p_uid,
    'ts', p_ts,
    'data', p_data
  ));
$$;

create or replace function public.fs_recovery_approval_sha256(
  p_job_id text,
  p_part text,
  p_data jsonb,
  p_updated_at timestamptz
)
returns text
language sql
immutable
as $$
  select public.fs_recovery_sha256(jsonb_build_object(
    'job_id', p_job_id,
    'part', p_part,
    'data', p_data,
    'updated_at', public.fs_recovery_canonical_timestamp(p_updated_at)
  ));
$$;

create or replace function public.fs_recovery_archive_row_sha256(
  p_id bigint,
  p_source text,
  p_row_key text,
  p_archived_at timestamptz,
  p_data jsonb
)
returns text
language sql
immutable
as $$
  select public.fs_recovery_sha256(jsonb_build_object(
    'id', p_id,
    'source', p_source,
    'row_key', p_row_key,
    'archived_at', public.fs_recovery_canonical_timestamp(p_archived_at),
    'data', p_data
  ));
$$;

create or replace function public.fs_recovery_signature_set_sha256(p_signatures jsonb)
returns text
language sql
immutable
strict
as $$
  select public.fs_recovery_sha256(p_signatures);
$$;

create or replace function public.fs_recovery_recipe()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'algorithm', 'SHA-256',
    'encoding', 'lowercase hexadecimal',
    'inputEncoding', 'UTF-8',
    'canonicalJson', 'PostgreSQL jsonb::text from explicit jsonb_build_object fields',
    'nullNormalization', 'SQL null becomes JSON null; no omission of declared fields',
    'timestampNormalization', 'timestamptz rendered as UTC YYYY-MM-DDTHH24:MI:SS.USZ; missing/invalid archive timestamps reject',
    'setOrdering', jsonb_build_object(
      'parent', jsonb_build_array('id'),
      'chat', jsonb_build_array('job_id'),
      'message', jsonb_build_array('uid', 'ts'),
      'activity', jsonb_build_array('uid', 'ts'),
      'approval', jsonb_build_array('job_id', 'part'),
      'archive', jsonb_build_array('source', 'row_key', 'archived_at', 'id')
    ),
    'fields', jsonb_build_object(
      'parent', jsonb_build_array('id', 'data', 'updated_at'),
      'chat', jsonb_build_array('job_id', 'data', 'updated_at'),
      'message', jsonb_build_array('uid', 'job_id', 'ts', 'data', 'updated_at'),
      'activity', jsonb_build_array('uid', 'ts', 'data'),
      'approval', jsonb_build_array('job_id', 'part', 'data', 'updated_at'),
      'archive', jsonb_build_array('id', 'source', 'row_key', 'archived_at', 'data')
    )
  );
$$;

create or replace function public.fs_recovery_archive_signature(p_jobs text[])
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'source', a.source,
      'row_key', a.row_key,
      'archived_at', public.fs_recovery_canonical_timestamp(a.archived_at),
      'sha256', public.fs_recovery_archive_row_sha256(
        a.id, a.source, a.row_key, a.archived_at, a.data
      )
    )
    order by a.source, a.row_key, a.archived_at, a.id
  ), '[]'::jsonb)
  from public.fs_archive a
  where (a.source = 'fs_records' and a.row_key = any (p_jobs))
     or (a.source = 'fs_chats' and a.row_key = any (p_jobs))
     or (a.source = 'fs_messages' and (a.data ->> 'job_id') = any (p_jobs))
     or (a.source = 'fs_approvals' and (a.data ->> 'job_id') = any (p_jobs));
$$;

create or replace function public.fs_recovery_archive_message_uid_set(p_job_id text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(jsonb_agg(a.data ->> 'uid' order by a.data ->> 'uid', (a.data ->> 'ts')::bigint), '[]'::jsonb)
  from public.fs_archive a
  where a.source = 'fs_messages'
    and a.row_key = p_job_id;
$$;

create or replace function public.fs_recovery_current_snapshot(p_job_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_chat jsonb;
  v_messages jsonb;
  v_activities jsonb;
  v_approvals jsonb;
begin
  select coalesce(jsonb_agg(
    public.fs_recovery_chat_sha256(c.job_id, c.data, c.updated_at)
    order by c.job_id
  ), '[]'::jsonb)
  into v_chat
  from public.fs_chats c
  where c.job_id = p_job_id;

  select coalesce(jsonb_agg(
    public.fs_recovery_message_sha256(m.uid, m.job_id, m.ts, m.data, m.updated_at)
    order by m.uid, m.ts
  ), '[]'::jsonb)
  into v_messages
  from public.fs_messages m
  where m.job_id = p_job_id;

  select coalesce(jsonb_agg(
    public.fs_recovery_activity_sha256(a.uid, a.ts, a.data)
    order by a.uid, a.ts
  ), '[]'::jsonb)
  into v_activities
  from public.fs_activities a
  where coalesce(a.data ->> 'job', a.data ->> 'jobId') = p_job_id;

  select coalesce(jsonb_agg(
    public.fs_recovery_approval_sha256(a.job_id, a.part, a.data, a.updated_at)
    order by a.job_id, a.part
  ), '[]'::jsonb)
  into v_approvals
  from public.fs_approvals a
  where a.job_id = p_job_id;

  return jsonb_build_object(
    'jobId', p_job_id,
    'chat', jsonb_build_object(
      'count', jsonb_array_length(v_chat),
      'sha256', public.fs_recovery_signature_set_sha256(v_chat)
    ),
    'messages', jsonb_build_object(
      'count', jsonb_array_length(v_messages),
      'sha256', public.fs_recovery_signature_set_sha256(v_messages),
      'uidSet', (
        select coalesce(jsonb_agg(m.uid order by m.uid, m.ts), '[]'::jsonb)
        from public.fs_messages m where m.job_id = p_job_id
      )
    ),
    'activities', jsonb_build_object(
      'count', jsonb_array_length(v_activities),
      'sha256', public.fs_recovery_signature_set_sha256(v_activities)
    ),
    'approvals', jsonb_build_object(
      'count', jsonb_array_length(v_approvals),
      'sha256', public.fs_recovery_signature_set_sha256(v_approvals)
    )
  );
end;
$$;

create or replace function public.fs_recovery_archive_message_set_sha256(p_job_id text)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select public.fs_recovery_signature_set_sha256(coalesce(jsonb_agg(
    public.fs_recovery_message_sha256(
      a.data ->> 'uid',
      a.data ->> 'job_id',
      (a.data ->> 'ts')::bigint,
      a.data -> 'data',
      public.fs_recovery_timestamp_from_json(a.data, 'updated_at', p_job_id || ':message')
    )
    order by a.data ->> 'uid', (a.data ->> 'ts')::bigint
  ), '[]'::jsonb))
  from public.fs_archive a
  where a.source = 'fs_messages'
    and a.row_key = p_job_id;
$$;

create or replace function public.fs_recovery_assert_parent_children(
  p_job_id text,
  p_expected_chat_count integer,
  p_expected_message_count integer,
  p_expected_message_uids jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_chat_count integer;
  v_message_count integer;
  v_uids jsonb;
begin
  if exists (
    select 1
    from public.fs_chats c
    left join public.fs_records r on r.id = c.job_id
    where c.job_id = p_job_id and r.id is null
  ) or exists (
    select 1
    from public.fs_messages m
    left join public.fs_records r on r.id = m.job_id
    where m.job_id = p_job_id and r.id is null
  ) then
    raise exception 'PARENT_CHILD_ORPHAN: %', p_job_id;
  end if;

  select count(*) into v_chat_count
  from public.fs_chats c where c.job_id = p_job_id;
  if v_chat_count <> p_expected_chat_count then
    raise exception 'PARENT_CHILD_CHAT_COUNT_INVALID: % expected=% actual=%',
      p_job_id, p_expected_chat_count, v_chat_count;
  end if;

  select count(*) into v_message_count
  from public.fs_messages m where m.job_id = p_job_id;
  if v_message_count <> p_expected_message_count then
    raise exception 'PARENT_CHILD_MESSAGE_COUNT_INVALID: % expected=% actual=%',
      p_job_id, p_expected_message_count, v_message_count;
  end if;

  select coalesce(jsonb_agg(m.uid order by m.uid, m.ts), '[]'::jsonb)
  into v_uids
  from public.fs_messages m
  where m.job_id = p_job_id;
  if v_uids is distinct from p_expected_message_uids then
    raise exception 'PARENT_CHILD_MESSAGE_UID_SET_INVALID: %', p_job_id;
  end if;
end;
$$;

create or replace function public.fs_recovery_assert_archive(
  p_job_id text,
  p_expected_message_count integer
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_parent jsonb;
  v_chat jsonb;
  v_parent_count integer;
  v_chat_count integer;
  v_message_count integer;
  v_message_row_count integer;
  v_ts bigint;
  v_row jsonb;
begin
  select count(*) into v_parent_count
  from public.fs_archive a
  where a.source = 'fs_records' and a.row_key = p_job_id;
  if v_parent_count <> 1 then
    raise exception 'ARCHIVE_PARENT_COUNT_INVALID: % expected=1 actual=%', p_job_id, v_parent_count;
  end if;

  select a.data into v_parent
  from public.fs_archive a
  where a.source = 'fs_records' and a.row_key = p_job_id;
  if v_parent is null then
    raise exception 'ARCHIVE_PARENT_MISSING: %', p_job_id;
  end if;
  if v_parent ->> 'id' is distinct from p_job_id then
    raise exception 'ARCHIVE_PARENT_ID_MISMATCH: %', p_job_id;
  end if;
  if not public.fs_record_is_valid(v_parent ->> 'id', v_parent -> 'data') then
    raise exception 'ARCHIVE_PARENT_DATA_INVALID: %', p_job_id;
  end if;
  if (v_parent -> 'data' ->> 'id') is distinct from v_parent ->> 'id'
     or jsonb_typeof(v_parent -> 'data') is distinct from 'object'
     or jsonb_typeof(v_parent -> 'data' -> 'rows') is distinct from 'array'
     or not (
       jsonb_typeof(v_parent -> 'data' -> 'customer') = 'string'
       or jsonb_typeof(v_parent -> 'data' -> 'brand') = 'string'
     ) then
    raise exception 'ARCHIVE_PARENT_NESTED_SHAPE_INVALID: %', p_job_id;
  end if;
  perform public.fs_recovery_timestamp_from_json(v_parent, 'updated_at', p_job_id || ':parent');

  select count(*) into v_chat_count
  from public.fs_archive a
  where a.source = 'fs_chats' and a.row_key = p_job_id;
  if v_chat_count <> 1 then
    raise exception 'ARCHIVE_CHAT_COUNT_INVALID: % expected=1 actual=%', p_job_id, v_chat_count;
  end if;

  select a.data into v_chat
  from public.fs_archive a
  where a.source = 'fs_chats' and a.row_key = p_job_id;
  if v_chat is null then
    raise exception 'ARCHIVE_CHAT_MISSING: %', p_job_id;
  end if;
  if v_chat ->> 'job_id' is distinct from p_job_id then
    raise exception 'ARCHIVE_CHAT_JOB_MISMATCH: %', p_job_id;
  end if;
  perform public.fs_recovery_timestamp_from_json(v_chat, 'updated_at', p_job_id || ':chat');

  select count(*) into v_message_row_count
  from public.fs_archive a
  where a.source = 'fs_messages'
    and a.row_key = p_job_id;
  if v_message_row_count <> p_expected_message_count then
    raise exception 'ARCHIVE_MESSAGE_COUNT_MISMATCH: % expected=% actual=%',
      p_job_id, p_expected_message_count, v_message_row_count;
  end if;

  select count(*) into v_message_count
  from public.fs_archive a
  where a.source = 'fs_messages'
    and a.row_key = p_job_id
    and a.data ->> 'job_id' = p_job_id;
  if v_message_count <> p_expected_message_count then
    raise exception 'ARCHIVE_MESSAGE_COUNT_MISMATCH: % expected=% actual=%',
      p_job_id, p_expected_message_count, v_message_count;
  end if;

  if exists (
    select 1 from public.fs_archive a
    where a.source = 'fs_messages'
      and a.data ->> 'job_id' = p_job_id
      and a.row_key is distinct from p_job_id
  ) then
    raise exception 'ARCHIVE_MESSAGE_ROW_KEY_SHAPE_INVALID: %', p_job_id;
  end if;

  if exists (
    select a.data ->> 'uid'
    from public.fs_archive a
    where a.source = 'fs_messages' and a.row_key = p_job_id
    group by a.data ->> 'uid'
    having count(*) > 1
  ) then
    raise exception 'ARCHIVE_MESSAGE_UID_AMBIGUOUS: %', p_job_id;
  end if;

  for v_row in
    select a.data
    from public.fs_archive a
    where a.source = 'fs_messages' and a.row_key = p_job_id
    order by a.data ->> 'uid', (a.data ->> 'ts')::bigint
  loop
    if nullif(v_row ->> 'uid', '') is null
       or v_row ->> 'job_id' is distinct from p_job_id
       or jsonb_typeof(v_row -> 'data') is distinct from 'object'
       or (v_row -> 'data' ->> 'uid') is distinct from v_row ->> 'uid' then
      raise exception 'ARCHIVE_MESSAGE_EMBEDDED_FIELDS_INVALID: %', p_job_id;
    end if;
    if v_row ->> 'ts' is null then
      raise exception 'ARCHIVE_MESSAGE_TS_INVALID: %', p_job_id;
    end if;
    begin
      v_ts := (v_row ->> 'ts')::bigint;
    exception when others then
      raise exception 'ARCHIVE_MESSAGE_TS_INVALID: %', p_job_id;
    end;
    perform public.fs_recovery_timestamp_from_json(
      v_row, 'updated_at', p_job_id || ':message:' || (v_row ->> 'uid')
    );
  end loop;
end;
$$;

create or replace function public.fs_record_recreation_fence()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if current_setting('formula.archived_job_recovery', true) = 'fs_archive:v2'
     and session_user = 'postgres'
     and current_user = 'postgres' then
    return new;
  end if;

  if exists (
    select 1 from public.fs_archive a
    where a.source = 'fs_records' and a.row_key = new.id
  ) then
    raise exception 'JOB_ID_DELETED: %', new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists fs_records_recreation_fence on public.fs_records;
drop trigger if exists fs_record_recreation_fence on public.fs_records;
create trigger fs_records_recreation_fence
after insert on public.fs_records
for each row execute function public.fs_record_recreation_fence();

create or replace function public.fs_archived_job_recovery_plan()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.fs_recovery_operator_check();
  return jsonb_build_object(
    'procedure', 'operator-only archived job recovery',
    'role', 'postgres',
    'defaultMode', 'dry-run',
    'transactionScope', jsonb_build_array('A03119 parent + chat + 18 messages', 'A02588 parent only'),
    'archiveRowKeyShape', 'fs_messages.row_key=job_id; match embedded uid+job_id+ts+data',
    'archivePreservation', 'exact id/source/row_key/archived_at/data SHA-256 signature set before/after',
    'integrity', public.fs_recovery_recipe(),
    'browserPath', 'fenced; no browser RPC or grant added'
  );
end;
$$;

create or replace function public.fs_archived_job_recovery_report()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_archive jsonb;
begin
  perform public.fs_recovery_operator_check();
  perform public.fs_recovery_assert_archive('A03119', 18);
  perform public.fs_recovery_assert_archive('A02588', 12);
  v_archive := public.fs_recovery_archive_signature(array['A03119', 'A02588']);

  return jsonb_build_object(
    'mode', 'read-only report',
    'recipe', public.fs_recovery_recipe(),
    'targets', jsonb_build_object(
      'A03119', jsonb_build_object(
        'current', public.fs_recovery_current_snapshot('A03119'),
        'archiveMessageSetSha256', public.fs_recovery_archive_message_set_sha256('A03119')
      ),
      'A02588', jsonb_build_object(
        'current', public.fs_recovery_current_snapshot('A02588'),
        'scope', 'parent-only; current chat/messages are not compared with archived chat/messages'
      )
    ),
    'archiveSignatureSet', v_archive,
    'archiveSignatureSetSha256', public.fs_recovery_signature_set_sha256(v_archive)
  );
end;
$$;

create or replace function public.fs_restore_archived_jobs()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_parent jsonb;
  v_chat jsonb;
  v_row jsonb;
  v_before_archive jsonb;
  v_after_archive jsonb;
  v_a03119_before jsonb;
  v_a03119_after jsonb;
  v_a02588_before jsonb;
  v_a02588_after jsonb;
  v_archive_preserved boolean;
begin
  perform public.fs_recovery_operator_check();

  if current_setting('formula.archived_job_recovery', true) <> 'fs_archive:v2' then
    raise exception 'RECOVERY_MARKER_REQUIRED: fs_archive:v2';
  end if;

  -- Bound both lock acquisition and all statements in the one caller-owned
  -- transaction. The values are local to this recovery call/transaction.
  perform set_config('lock_timeout', '2s', true);
  perform set_config('statement_timeout', '30s', true);
  perform pg_advisory_xact_lock(hashtextextended('archived-job-recovery:A03119,A02588', 0));

  perform public.fs_recovery_assert_archive('A03119', 18);
  perform public.fs_recovery_assert_archive('A02588', 12);

  v_before_archive := public.fs_recovery_archive_signature(array['A03119', 'A02588']);
  v_a03119_before := public.fs_recovery_current_snapshot('A03119');
  v_a02588_before := public.fs_recovery_current_snapshot('A02588');

  if exists (select 1 from public.fs_records where id = 'A03119')
     or exists (select 1 from public.fs_chats where job_id = 'A03119')
     or exists (select 1 from public.fs_messages where job_id = 'A03119') then
    raise exception 'A03119_CURRENT_PARENT_OR_CHILD_EXISTS';
  end if;
  if exists (select 1 from public.fs_records where id = 'A02588') then
    raise exception 'A02588_CURRENT_PARENT_EXISTS';
  end if;

  -- A03119: restore parent, chat and messages from the approved archive rows.
  select a.data into v_parent
  from public.fs_archive a
  where a.source = 'fs_records' and a.row_key = 'A03119';
  insert into public.fs_records (id, data, updated_at)
  values (
    v_parent ->> 'id',
    v_parent -> 'data',
    public.fs_recovery_timestamp_from_json(v_parent, 'updated_at', 'A03119:parent')
  );

  select a.data into v_chat
  from public.fs_archive a
  where a.source = 'fs_chats' and a.row_key = 'A03119';
  insert into public.fs_chats (job_id, data, updated_at)
  values (
    v_chat ->> 'job_id',
    v_chat -> 'data',
    public.fs_recovery_timestamp_from_json(v_chat, 'updated_at', 'A03119:chat')
  );

  for v_row in
    select a.data
    from public.fs_archive a
    where a.source = 'fs_messages' and a.row_key = 'A03119'
    order by a.data ->> 'uid', (a.data ->> 'ts')::bigint
  loop
    insert into public.fs_messages (uid, job_id, ts, data, updated_at)
    values (
      v_row ->> 'uid',
      v_row ->> 'job_id',
      (v_row ->> 'ts')::bigint,
      v_row -> 'data',
      public.fs_recovery_timestamp_from_json(
        v_row, 'updated_at', 'A03119:message:' || (v_row ->> 'uid')
      )
    );
  end loop;

  -- A02588: parent only. Its current chat/messages/activities/approvals are
  -- retained and are proven unchanged by exact signature sets below.
  select a.data into v_parent
  from public.fs_archive a
  where a.source = 'fs_records' and a.row_key = 'A02588';
  insert into public.fs_records (id, data, updated_at)
  values (
    v_parent ->> 'id',
    v_parent -> 'data',
    public.fs_recovery_timestamp_from_json(v_parent, 'updated_at', 'A02588:parent')
  );

  v_a03119_after := public.fs_recovery_current_snapshot('A03119');
  v_a02588_after := public.fs_recovery_current_snapshot('A02588');
  v_after_archive := public.fs_recovery_archive_signature(array['A03119', 'A02588']);

  perform public.fs_recovery_assert_parent_children(
    'A03119', 1, 18, public.fs_recovery_archive_message_uid_set('A03119')
  );
  perform public.fs_recovery_assert_parent_children(
    'A02588',
    (v_a02588_before -> 'chat' ->> 'count')::integer,
    (v_a02588_before -> 'messages' ->> 'count')::integer,
    v_a02588_before -> 'messages' -> 'uidSet'
  );

  if v_before_archive is distinct from v_after_archive then
    raise exception 'ARCHIVE_PRESERVATION_FAILED';
  end if;
  v_archive_preserved := v_before_archive is not distinct from v_after_archive;

  if (v_a03119_before -> 'activities') is distinct from (v_a03119_after -> 'activities')
     or (v_a03119_before -> 'approvals') is distinct from (v_a03119_after -> 'approvals') then
    raise exception 'A03119_ACTIVITY_APPROVAL_PRESERVATION_FAILED';
  end if;

  if v_a02588_before is distinct from v_a02588_after then
    raise exception 'A02588_CURRENT_CHILD_OR_ACTIVITY_APPROVAL_CHANGED';
  end if;

  select a.data into v_parent
  from public.fs_archive a
  where a.source = 'fs_records' and a.row_key = 'A02588';
  if not exists (
    select 1 from public.fs_records r
    where r.id = 'A02588'
      and public.fs_recovery_parent_sha256(r.id, r.data, r.updated_at) =
          public.fs_recovery_parent_sha256(
            v_parent ->> 'id', v_parent -> 'data',
            public.fs_recovery_timestamp_from_json(v_parent, 'updated_at', 'A02588:parent')
          )
  ) then
    raise exception 'A02588_PARENT_INTEGRITY_FAILED';
  end if;

  select a.data into v_parent
  from public.fs_archive a
  where a.source = 'fs_records' and a.row_key = 'A03119';
  if not exists (
    select 1 from public.fs_records r
    where r.id = 'A03119'
      and public.fs_recovery_parent_sha256(r.id, r.data, r.updated_at) =
          public.fs_recovery_parent_sha256(
            v_parent ->> 'id', v_parent -> 'data',
            public.fs_recovery_timestamp_from_json(v_parent, 'updated_at', 'A03119:parent')
          )
  ) then
    raise exception 'A03119_PARENT_INTEGRITY_FAILED';
  end if;

  select a.data into v_chat
  from public.fs_archive a
  where a.source = 'fs_chats' and a.row_key = 'A03119';
  if not exists (
    select 1 from public.fs_chats c
    where c.job_id = 'A03119'
      and public.fs_recovery_chat_sha256(c.job_id, c.data, c.updated_at) =
          public.fs_recovery_chat_sha256(
            v_chat ->> 'job_id', v_chat -> 'data',
            public.fs_recovery_timestamp_from_json(v_chat, 'updated_at', 'A03119:chat')
          )
  ) then
    raise exception 'A03119_CHAT_INTEGRITY_FAILED';
  end if;

  if (v_a03119_after -> 'messages' ->> 'sha256') <>
     public.fs_recovery_archive_message_set_sha256('A03119') then
    raise exception 'A03119_MESSAGE_INTEGRITY_FAILED';
  end if;

  return jsonb_build_object(
    'status', 'recovered_in_transaction',
    'operatorRole', 'postgres',
    'targets', jsonb_build_object(
      'A03119', jsonb_build_object(
        'scope', 'parent+chat+18 messages',
        'currentBefore', v_a03119_before,
        'currentAfter', v_a03119_after,
        'messageSha256', v_a03119_after -> 'messages' ->> 'sha256'
      ),
      'A02588', jsonb_build_object(
        'scope', 'parent-only',
        'currentBefore', v_a02588_before,
        'currentAfter', v_a02588_after,
        'currentSnapshotUnchanged', v_a02588_before is not distinct from v_a02588_after
      )
    ),
    'archiveSignatureSetSha256Before', public.fs_recovery_signature_set_sha256(v_before_archive),
    'archiveSignatureSetSha256After', public.fs_recovery_signature_set_sha256(v_after_archive),
    'archivePreserved', v_archive_preserved
  );
end;
$$;

alter function public.fs_recovery_operator_check() owner to postgres;
alter function public.fs_recovery_canonical_timestamp(timestamptz) owner to postgres;
alter function public.fs_recovery_timestamp_from_json(jsonb, text, text) owner to postgres;
alter function public.fs_recovery_sha256(jsonb) owner to postgres;
alter function public.fs_recovery_parent_sha256(text, jsonb, timestamptz) owner to postgres;
alter function public.fs_recovery_chat_sha256(text, jsonb, timestamptz) owner to postgres;
alter function public.fs_recovery_message_sha256(text, text, bigint, jsonb, timestamptz) owner to postgres;
alter function public.fs_recovery_activity_sha256(text, bigint, jsonb) owner to postgres;
alter function public.fs_recovery_approval_sha256(text, text, jsonb, timestamptz) owner to postgres;
alter function public.fs_recovery_archive_row_sha256(bigint, text, text, timestamptz, jsonb) owner to postgres;
alter function public.fs_recovery_signature_set_sha256(jsonb) owner to postgres;
alter function public.fs_recovery_recipe() owner to postgres;
alter function public.fs_recovery_archive_signature(text[]) owner to postgres;
alter function public.fs_recovery_archive_message_uid_set(text) owner to postgres;
alter function public.fs_recovery_current_snapshot(text) owner to postgres;
alter function public.fs_recovery_archive_message_set_sha256(text) owner to postgres;
alter function public.fs_recovery_assert_parent_children(text, integer, integer, jsonb) owner to postgres;
alter function public.fs_recovery_assert_archive(text, integer) owner to postgres;
alter function public.fs_record_recreation_fence() owner to postgres;
alter function public.fs_archived_job_recovery_plan() owner to postgres;
alter function public.fs_archived_job_recovery_report() owner to postgres;
alter function public.fs_restore_archived_jobs() owner to postgres;

revoke all on function public.fs_recovery_operator_check() from public, anon, authenticated;
revoke all on function public.fs_recovery_canonical_timestamp(timestamptz) from public, anon, authenticated;
revoke all on function public.fs_recovery_timestamp_from_json(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.fs_recovery_sha256(jsonb) from public, anon, authenticated;
revoke all on function public.fs_recovery_parent_sha256(text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.fs_recovery_chat_sha256(text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.fs_recovery_message_sha256(text, text, bigint, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.fs_recovery_activity_sha256(text, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.fs_recovery_approval_sha256(text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.fs_recovery_archive_row_sha256(bigint, text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.fs_recovery_signature_set_sha256(jsonb) from public, anon, authenticated;
revoke all on function public.fs_recovery_recipe() from public, anon, authenticated;
revoke all on function public.fs_recovery_archive_signature(text[]) from public, anon, authenticated;
revoke all on function public.fs_recovery_archive_message_uid_set(text) from public, anon, authenticated;
revoke all on function public.fs_recovery_current_snapshot(text) from public, anon, authenticated;
revoke all on function public.fs_recovery_archive_message_set_sha256(text) from public, anon, authenticated;
revoke all on function public.fs_recovery_assert_parent_children(text, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.fs_recovery_assert_archive(text, integer) from public, anon, authenticated;
revoke all on function public.fs_archived_job_recovery_plan() from public, anon, authenticated;
revoke all on function public.fs_archived_job_recovery_report() from public, anon, authenticated;
revoke all on function public.fs_restore_archived_jobs() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
