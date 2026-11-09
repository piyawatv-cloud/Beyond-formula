-- MANUAL OPERATOR ARTIFACT ONLY. Never include in startup/deploy/migration.
-- Requires independent review and explicit owner approval of this exact immutable
-- artifact AND the private manifest SHA, verified backup/checksum and target.
-- See docs/profile-linkage-repair.md. No private values belong in Git or output.
\set ON_ERROR_STOP on
\set VERBOSITY terse
\set QUIET on
begin;
set local timezone = 'UTC';
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '2s';
set local statement_timeout = '30s';

do $repair$
declare
  manifest jsonb;
  profile jsonb;
  row_value jsonb;
  encoded text;
  repair_mode text;
  would_restore integer := 0;
  restored integer := 0;
  already_present integer := 0;
begin
  -- Fail closed: an ordinary API role or SET ROLE session is never an operator.
  if current_user in ('anon', 'authenticated') or current_user <> session_user
     or not exists (select 1 from pg_roles where rolname = current_user and rolsuper) then
    raise exception 'PROFILE_REPAIR_REJECTED';
  end if;

  encoded := current_setting('formula.profile_repair_manifest_hex', true);
  if encoded is null or encoded = '' or encoded !~ '^([0-9a-fA-F]{2})+$' then
    raise exception 'PROFILE_REPAIR_REJECTED';
  end if;
  manifest := convert_from(decode(encoded, 'hex'), 'UTF8')::jsonb;
  if jsonb_typeof(manifest) is distinct from 'object' then
    raise exception 'PROFILE_REPAIR_REJECTED';
  end if;
  if exists (select 1 from jsonb_object_keys(manifest) k
             where k not in ('version', 'mode', 'authorization_ref', 'profiles'))
     or manifest -> 'version' is distinct from '1'::jsonb
     or jsonb_typeof(manifest -> 'authorization_ref') is distinct from 'string'
     or jsonb_typeof(manifest -> 'profiles') is distinct from 'array' then
    raise exception 'PROFILE_REPAIR_REJECTED';
  end if;
  if manifest ? 'mode' then
    if jsonb_typeof(manifest -> 'mode') is distinct from 'string' then
      raise exception 'PROFILE_REPAIR_REJECTED';
    end if;
    repair_mode := manifest ->> 'mode';
  else
    repair_mode := 'dry-run';
  end if;
  if repair_mode not in ('dry-run', 'apply')
     or (repair_mode = 'apply' and (manifest ->> 'authorization_ref') !~ '\S')
     or jsonb_array_length(manifest -> 'profiles') <> 2 then
    raise exception 'PROFILE_REPAIR_REJECTED';
  end if;

  for profile in select value from jsonb_array_elements(manifest -> 'profiles') loop
    if jsonb_typeof(profile) is distinct from 'object' then
      raise exception 'PROFILE_REPAIR_REJECTED';
    end if;
    if exists (select 1 from jsonb_object_keys(profile) k
               where k not in ('name', 'expected_row_sha256', 'restore'))
       or jsonb_typeof(profile -> 'name') is distinct from 'string'
       or (profile ->> 'name') !~ '\S'
       or jsonb_typeof(profile -> 'expected_row_sha256') is distinct from 'string'
       or (profile ->> 'expected_row_sha256') !~ '^[0-9a-f]{64}$'
       or jsonb_typeof(profile -> 'restore') is distinct from 'object' then
      raise exception 'PROFILE_REPAIR_REJECTED';
    end if;
    if exists (select 1 from jsonb_object_keys(profile -> 'restore') k
               where k not in ('central_user_id', 'provisionedBy'))
       or jsonb_typeof(profile -> 'restore' -> 'central_user_id') is distinct from 'string'
       or (profile -> 'restore' ->> 'central_user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or profile -> 'restore' -> 'provisionedBy' is distinct from '"opc-user-access"'::jsonb then
      raise exception 'PROFILE_REPAIR_REJECTED';
    end if;
  end loop;
  if (manifest -> 'profiles' -> 0 ->> 'name') = (manifest -> 'profiles' -> 1 ->> 'name') then
    raise exception 'PROFILE_REPAIR_REJECTED';
  end if;

  if repair_mode = 'apply' then
    -- Match the additive Task 1 guard and the read-only deployment policy gate.
    if (select count(*) from pg_trigger t join pg_proc p on p.oid=t.tgfoid
        where t.tgrelid='public.fs_users'::regclass
          and t.tgname='fs_users_preserve_profile_linkage' and not t.tgisinternal
          and t.tgenabled='O' and t.tgtype=19 and t.tgattr=''::int2vector
          and t.tgqual is null and t.tgnargs=0
          and p.oid=to_regprocedure('public.fs_preserve_profile_linkage()')
          and not p.prosecdef and p.prorettype='pg_catalog.trigger'::regtype
          and p.prolang=(select oid from pg_language where lanname='plpgsql')
          and p.proconfig=array['search_path=pg_catalog, pg_temp']::text[]) <> 1 then
      raise exception 'PROFILE_REPAIR_REJECTED';
    end if;
    -- Lock both targets before reading/updating, in the same deterministic order.
    perform u.name from public.fs_users u
      where u.name in (select value ->> 'name' from jsonb_array_elements(manifest -> 'profiles'))
      order by u.name collate "C" for update;
  end if;

  for profile in select value from jsonb_array_elements(manifest -> 'profiles')
                 order by (value ->> 'name') collate "C" loop
    select to_jsonb(u) into row_value from public.fs_users u where u.name = profile ->> 'name';
    if not found or jsonb_typeof(row_value -> 'data') is distinct from 'object' then
      raise exception 'PROFILE_REPAIR_REJECTED';
    end if;
    if (row_value -> 'data' ? 'central_user_id') or (row_value -> 'data' ? 'provisionedBy') then
      if (row_value -> 'data' -> 'central_user_id') is distinct from (profile -> 'restore' -> 'central_user_id')
         or (row_value -> 'data' -> 'provisionedBy') is distinct from (profile -> 'restore' -> 'provisionedBy') then
        raise exception 'PROFILE_REPAIR_REJECTED';
      end if;
      -- An approved repeat retains the original pre-repair hash. Exact linkage
      -- is already present; skip without firing UPDATE/touch again.
      already_present := already_present + 1;
    else
      if encode(sha256(convert_to(row_value::text, 'UTF8')), 'hex') is distinct from (profile ->> 'expected_row_sha256') then
        raise exception 'PROFILE_REPAIR_REJECTED';
      end if;
      would_restore := would_restore + 1;
      if repair_mode = 'apply' then
        update public.fs_users set data = data || (profile -> 'restore') where name = profile ->> 'name';
        restored := restored + 1;
      end if;
    end if;
  end loop;
  raise notice '%', jsonb_build_object('mode', repair_mode, 'target_rows', 2,
    'would_restore', would_restore, 'restored', restored, 'already_present', already_present);
exception when others or query_canceled or assert_failure then
  -- The exception subtransaction reverses any first-row write. Never interpolate
  -- SQLERRM, context, row data, names, IDs, hashes or the private manifest.
  raise exception 'PROFILE_REPAIR_REJECTED';
end
$repair$;
commit;
