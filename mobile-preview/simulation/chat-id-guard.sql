-- EXPERIMENTAL TEST FIXTURE ONLY. Apply only to a disposable synthetic database.
-- Not a migration or authorization control. Owner rule 2026-10-28: a message id or job number, once used, is never reissued.
create function public.synthetic_guard_message_update() returns trigger
language plpgsql as $$
begin
  if row(new.uid, new.job_id, new.ts, new.data) is distinct from row(old.uid, old.job_id, old.ts, old.data) then
    raise exception 'synthetic message identifier conflict' using errcode = '23505';
  end if;
  return old;
end
$$;
create trigger synthetic_guard_message_update
before update on public.fs_messages
for each row execute function public.synthetic_guard_message_update();

create table public.synthetic_retired_ids(kind text not null, id text not null, primary key(kind,id));
create function public.synthetic_retire_id() returns trigger
language plpgsql security definer as $$
begin
  insert into public.synthetic_retired_ids(kind,id)
  values (tg_argv[0], to_jsonb(old)->>(case tg_argv[0] when 'message' then 'uid' else 'id' end))
  on conflict do nothing;
  return old;
end
$$;
create function public.synthetic_reject_retired_id() returns trigger
language plpgsql security definer as $$
begin
  if exists (select 1 from public.synthetic_retired_ids
             where kind = tg_argv[0] and id = to_jsonb(new)->>(case tg_argv[0] when 'message' then 'uid' else 'id' end)) then
    raise exception 'synthetic identifier already used' using errcode = '23505';
  end if;
  return new;
end
$$;
create trigger synthetic_retire_message after delete on public.fs_messages
for each row execute function public.synthetic_retire_id('message');
create trigger synthetic_reject_retired_message before insert on public.fs_messages
for each row execute function public.synthetic_reject_retired_id('message');
create trigger synthetic_retire_job after delete on public.fs_records
for each row execute function public.synthetic_retire_id('job');
create trigger synthetic_reject_retired_job before insert on public.fs_records
for each row execute function public.synthetic_reject_retired_id('job');
