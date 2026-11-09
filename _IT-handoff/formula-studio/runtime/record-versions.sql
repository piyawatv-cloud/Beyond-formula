-- Approved-release installation only. Apply after job-sync.sql.
-- ประวัติเวอร์ชันของใบงานเก็บที่ระบบกลาง (16 ต.ค. 2569)
-- เก็บแถวเดิมของ fs_records เข้า fs_archive ด้วย source แยก ('fs_records_version') ทุกครั้งที่ data เปลี่ยน
-- ไม่ใช่ 'fs_records' ซึ่งหมายถึง "ถูกลบ" (fs_record_recreation_fence, job-integrity) · เป็นส่วนเพิ่ม
-- ไม่แก้โครงสร้างตาราง/key และไม่ให้สิทธิ์เบราว์เซอร์อ่าน fs_archive ตรง ๆ
\set ON_ERROR_STOP on
begin;

create or replace function public.fs_records_keep_version()
returns trigger language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if old.data is distinct from new.data then
    insert into public.fs_archive (source, row_key, data)
      values ('fs_records_version', old.id, to_jsonb(old));
  end if;
  return new;
end
$fn$;
revoke all on function public.fs_records_keep_version() from public, anon, authenticated;
drop trigger if exists fs_records_keep_version on public.fs_records;
create trigger fs_records_keep_version
  before update on public.fs_records
  for each row execute function public.fs_records_keep_version();

-- อ่านเวอร์ชันเก่าของใบงานหนึ่งใบ ใหม่สุดก่อน · เพดาน 50 · เรียกผ่าน proxy เท่านั้น (proxy ตรวจสิทธิ์)
create or replace function public.fs_record_versions(p_id text, p_limit integer default 12)
returns table(archived_at timestamptz, data jsonb)
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select a.archived_at, a.data -> 'data'
  from public.fs_archive a
  where a.source = 'fs_records_version'
    and p_id ~ '^[A-Z]+[0-9]{5}$'
    and a.row_key = p_id
  order by a.archived_at desc, a.id desc
  limit greatest(1, least(coalesce(p_limit, 12), 50));
$fn$;
revoke all on function public.fs_record_versions(text, integer) from public;
grant execute on function public.fs_record_versions(text, integer) to anon, authenticated;

commit;
