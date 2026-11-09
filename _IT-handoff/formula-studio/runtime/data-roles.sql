-- บทบาทที่ Supabase มีมาให้ในตัว แต่ PostgreSQL เปล่าไม่มี
--
-- สร้างชื่อเดิมทั้ง anon และ authenticated โดยตั้งใจ เพื่อให้ docs/upstream-schema.sql
-- รันลงฐานนี้ได้ "ทั้งไฟล์โดยไม่ต้องแก้แม้บรรทัดเดียว" ทั้ง grant และ RLS policy
-- ถ้าตัดบรรทัดพวกนั้นทิ้งเหมือนที่ verify-restore ทำ สคีมาสองฝั่งจะเริ่มไม่เหมือนกัน
-- แล้ววันหนึ่งจะไม่มีใครตอบได้ว่าฐานจริงมีกฎอะไรบ้าง
--
-- authenticator คือบทบาทเดียวที่ login ได้ — PostgREST ใช้ตัวนี้ต่อฐาน แล้ว
-- switch ไปเป็น anon ตามที่ PGRST_DB_ANON_ROLE กำหนด (noinherit จึงไม่ได้สิทธิ์ติดตัวมา)
\set ON_ERROR_STOP on

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$roles$;

select case
  when exists (select 1 from pg_roles where rolname = 'authenticator')
    then format('alter role authenticator with login noinherit password %L', :'authpw')
  else format('create role authenticator login noinherit password %L', :'authpw')
end \gexec

grant anon, authenticated to authenticator;
