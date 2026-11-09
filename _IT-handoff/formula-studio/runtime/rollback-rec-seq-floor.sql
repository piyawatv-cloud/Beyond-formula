-- Rollback for 3.1 in data-policy.sql: restore the previous fs_next_rec_seq() (upstream body,
-- security definer as before). The counter is NOT moved back (forward-only, CLAUDE.md rule 2).
-- Run as the database owner: psql -v ON_ERROR_STOP=1 --single-transaction -f this-file
set search_path = public;
create or replace function fs_next_rec_seq() returns bigint
language plpgsql security definer
as $fn$
declare n bigint;
begin
  insert into fs_meta(key, value) values ('reccounter', to_jsonb(1))
  on conflict (key) do update
    set value = to_jsonb(((fs_meta.value #>> '{}')::bigint) + 1),
        updated_at = now()
  returning (fs_meta.value #>> '{}')::bigint into n;
  return n;
end
$fn$;
drop function if exists fs_rec_seq_of(text);
