#!/bin/sh
# Tests a candidate SQL pattern only, using two concurrent PostgreSQL sessions.
# It is not an API, migration, production fix, or proof about deployed systems.
set -eu
export LC_ALL="${LC_ALL:-C}"
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/formula-race.XXXXXX")
port=$((50000 + ($$ % 10000)))
writer_pid=''
cleanup(){
 if [ -n "$writer_pid" ]; then kill "$writer_pid" 2>/dev/null || true; wait "$writer_pid" 2>/dev/null || true; fi
 if [ -f "$tmp/data/postmaster.pid" ]; then pg_ctl -D "$tmp/data" -m fast -w stop >/dev/null 2>&1 || true; fi
 rm -rf -- "$tmp"
}
trap cleanup EXIT HUP INT TERM
initdb -D "$tmp/data" -A trust --no-locale >/dev/null
pg_ctl -D "$tmp/data" -l "$tmp/postgres.log" -o "-F -k $tmp -p $port -c listen_addresses=''" -w start >/dev/null
createdb -h "$tmp" -p "$port" formula_race
export PGHOST="$tmp" PGPORT="$port" PGDATABASE=formula_race
psql -X -q -v ON_ERROR_STOP=1 -f "$root/tests/sql/bootstrap.sql" > "$tmp/setup.log" 2>&1
psql -X -q -v ON_ERROR_STOP=1 -f "$root/supabase/schema.sql" >> "$tmp/setup.log" 2>&1
psql -X -q -v ON_ERROR_STOP=1 > "$tmp/seed.log" <<'SQL'
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
insert into public.fs_records(id,data) values ('A00001','{"id":"A00001","customer":"fixture","brand":"start","notes":"start","createdBy":"Admin Owner","rows":[]}'::jsonb);
commit;
SQL
# First session writes conditionally and holds the row lock long enough for
# the second session to issue the same stale conditional update.
PGAPPNAME=formula_race_first psql -X -q -v ON_ERROR_STOP=1 > "$tmp/first.log" 2>&1 <<'SQL' &
begin;
set local role authenticated;
set local statement_timeout='10s';
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
with changed as (update public.fs_records set data=jsonb_set(data,'{brand}','"first"') where id='A00001' and data='{"id":"A00001","customer":"fixture","brand":"start","notes":"start","createdBy":"Admin Owner","rows":[]}'::jsonb returning id) select count(*) as changed_first from changed;
select pg_sleep(3);
commit;
SQL
writer_pid=$!
ready=''
for n in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
 ready=$(psql -X -A -t -q -v ON_ERROR_STOP=1 -c "select count(*) from pg_stat_activity where application_name='formula_race_first' and wait_event='PgSleep'")
 [ "$ready" = 1 ] && break
 sleep 0.1
done
if [ "$ready" != 1 ]; then printf '%s\n' 'FAIL: first test session did not reach the lock barrier'; exit 1; fi
PGAPPNAME=formula_race_second psql -X -A -t -q -v ON_ERROR_STOP=1 > "$tmp/second.log" 2>&1 <<'SQL'
begin;
set local role authenticated;
set local statement_timeout='10s';
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
with changed as (update public.fs_records set data=jsonb_set(data,'{notes}','"second"') where id='A00001' and data='{"id":"A00001","customer":"fixture","brand":"start","notes":"start","createdBy":"Admin Owner","rows":[]}'::jsonb returning id) select count(*) from changed;
commit;
SQL
wait "$writer_pid"
writer_pid=''
if ! grep -qx '0' "$tmp/second.log"; then printf '%s\n' 'FAIL: second stale update was not rejected'; exit 1; fi
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
do $$ begin
 if not exists(select 1 from public.fs_records where id='A00001' and data->>'brand'='first' and data->>'notes'='start') then
   raise exception 'concurrent update result was unexpected';
 end if;
end $$;
rollback;
SQL
# Test whether job change and approval invalidation can commit or roll back
# together when both run inside a single database transaction.
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
select public.fs_append_chat_event('fixture-approval','A00001','{"type":"approval_set","key":"pd"}'::jsonb);
do $$
declare original jsonb; before_approval jsonb; rejected boolean:=false;
begin
 select data into original from public.fs_records where id='A00001';
 select data->'approvals'->'pd' into before_approval from public.fs_chats where job_id='A00001';
 if before_approval is null or before_approval='null'::jsonb then raise exception 'fixture approval missing'; end if;
 begin
   update public.fs_records set data=jsonb_set(data,'{notes}','"should roll back"') where id='A00001' and data=original;
   perform public.fs_append_chat_event('invalid event !','A00001','{"type":"system","action":"job_edit","text":"fixture"}'::jsonb);
 exception when insufficient_privilege then rejected:=true;
 end;
 if not rejected then raise exception 'fixture failure was not observed'; end if;
 if (select data from public.fs_records where id='A00001') is distinct from original then raise exception 'failed operation left a changed job'; end if;
 if (select data->'approvals'->'pd' from public.fs_chats where job_id='A00001') is distinct from before_approval then raise exception 'failed operation changed approval'; end if;
 update public.fs_records set data=jsonb_set(data,'{notes}','"confirmed fixture"') where id='A00001' and data=original;
 perform public.fs_append_chat_event('fixture-job-edit','A00001','{"type":"system","action":"job_edit","text":"fixture"}'::jsonb);
 if (select data->'approvals'->'pd' from public.fs_chats where job_id='A00001') is distinct from 'null'::jsonb then raise exception 'approval was not reset'; end if;
 if (select data->>'notes' from public.fs_records where id='A00001') <> 'confirmed fixture' then raise exception 'job change missing'; end if;
 raise notice 'PASS job edit and approval invalidation commit or roll back together in one transaction';
end $$;
rollback;
SQL
printf '%s\n' 'PASS: two overlapping SQL clients; first write kept, stale second write rejected'
