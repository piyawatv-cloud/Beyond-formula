\set ON_ERROR_STOP on

do $$
begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text unique not null
);
create or replace function auth.uid() returns uuid
language sql stable
set search_path = ''
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

insert into auth.users(id,email) values
  ('11111111-1111-1111-1111-111111111111','admin@example.test'),
  ('22222222-2222-2222-2222-222222222222','sales.one@example.test'),
  ('33333333-3333-3333-3333-333333333333','sales.two@example.test'),
  ('44444444-4444-4444-4444-444444444444','pd@example.test'),
  ('55555555-5555-5555-5555-555555555555','ra@example.test'),
  ('66666666-6666-6666-6666-666666666666','inactive@example.test'),
  ('77777777-7777-7777-7777-777777777777','unknown@example.test'),
  ('88888888-8888-8888-8888-888888888888','opc@example.test')
on conflict do nothing;

-- Simulate the existing legacy table/data before the forward migration.
create table if not exists public.fs_users (
  name text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.fs_users(name,data) values
  ('Admin Owner','{"name":"Admin Owner","role":"admin","email":"admin@example.test","pass":"legacy-browser-hash"}'::jsonb)
on conflict (name) do update set data=excluded.data;
