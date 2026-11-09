-- Approved-release installation only; apply after data-policy.sql, after a
-- verified backup and before the latest policy verification gate. No data repair.
\set ON_ERROR_STOP on
begin;

-- Read/POST races must preserve the row locked by UPDATE, not an earlier
-- gateway snapshot. INSERT is untouched for signed provisioning. Approved
-- owner restoration and the existing SECURITY DEFINER role RPC remain usable.
create or replace function public.fs_preserve_profile_linkage()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $fn$
declare field text;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  foreach field in array array['central_user_id', 'provisionedBy'] loop
    if old.data ? field then
      new.data := jsonb_set(new.data, array[field], old.data -> field);
    else
      new.data := new.data - field;
    end if;
  end loop;
  return new;
end
$fn$;

drop trigger if exists fs_users_preserve_profile_linkage on public.fs_users;
create trigger fs_users_preserve_profile_linkage
  before update on public.fs_users
  for each row execute function public.fs_preserve_profile_linkage();

commit;
