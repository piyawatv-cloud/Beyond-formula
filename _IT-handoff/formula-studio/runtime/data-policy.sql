-- นโยบายของฐานข้อมูล — ด่านชั้นที่สอง ที่บั๊กใน proxy ข้ามไม่ได้
--
-- runtime/data-grants.sql ให้ `grant all` กับ anon ทุกตาราง (เลียนแบบสิ่งที่ Supabase
-- ให้มาแต่เดิม) แปลว่าตอนนี้สิ่งเดียวที่กันข้อมูลไว้คือ proxy — ถ้า proxy หลุด
-- คำขอเดียวลบข้อมูลได้ทั้งตาราง ไฟล์นี้บีบสิทธิ์ลงให้เท่าที่แอปใช้จริง
--
-- ต้องรัน "หลัง" data-grants.sql เสมอ เพราะมันเพิกถอนสิ่งที่ไฟล์นั้นให้ไว้
-- รันซ้ำได้ ไม่ลบข้อมูล ไม่แก้ข้อมูลเดิม
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1) ไม่มีใครต้อง TRUNCATE
--
-- แอปไม่เคยเรียก และไม่มีทางเรียกได้ผ่าน PostgREST ด้วยซ้ำ แต่สิทธิ์ที่ให้ไว้เกิน
-- ความจำเป็นคือสิทธิ์ที่รอวันถูกใช้ผิด — คำสั่งเดียวล้างทั้งตารางโดยไม่มี WHERE ให้พลาด
-- ---------------------------------------------------------------------------
revoke truncate on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate on tables from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Activity Log เพิ่มได้อย่างเดียว
--
-- มันคือบันทึกว่าใครทำอะไรเมื่อไหร่ การแก้ให้ดูเรียบร้อยคือการปลอมประวัติ
-- (กฎ 6.2 ของระบบพี่น้อง: ห้ามเขียนทับ Activity Log)
-- ---------------------------------------------------------------------------
-- ลบไม่ได้ ตัดสิทธิ์ทิ้งไปเลย
revoke delete on fs_activities from anon, authenticated;

-- แต่ "แก้ไม่ได้" ตัดสิทธิ์ UPDATE ทิ้งไม่ได้ — และนี่คือกับดักที่เสียเวลาไปครึ่งวัน
--
-- แอปส่ง Prefer: resolution=merge-duplicates ทุกครั้งที่ซิงก์ ซึ่ง PostgREST แปลเป็น
-- INSERT .. ON CONFLICT DO UPDATE · คำสั่งนั้นต้องการสิทธิ์ UPDATE **ต่อให้ไม่มีแถวไหน
-- ชนกันเลย** เพิกถอน UPDATE ไปแล้วผลคือ 42501 permission denied ทุกคำขอ
-- และเพราะ sbPush() เรียง await เปลือย ๆ ต่อกัน บรรทัดนั้นล้ม = ทุกบรรทัดหลังจากนั้น
-- (ลบใบงาน ลบห้องแชท ลบผู้ใช้ เขียน tags) ไม่ได้ทำงานเลยทั้งรอบ
-- *เกิดขึ้นจริง 24 ส.ค. 2569 ตั้งแต่ 08:20 จนถึงตอนที่ทดสอบเจอตอนบ่าย*
--
-- จึงคืนสิทธิ์ UPDATE ให้ แล้วกันด้วย trigger แทน — และ trigger **ไม่ raise**
-- แต่คืน null ซึ่งแปลว่า "ข้ามแถวนี้ไป ไม่ต้องแก้" คำสั่งทั้งชุดจึงยังสำเร็จ
-- (raise จะทำให้รอบซิงก์พังทั้งรอบอีกแบบหนึ่ง ตามกฎ 3.3)
--
-- ผลที่ได้คือ "คนแรกที่เขียนชนะ" ซึ่งเป็นสิ่งที่ต้องการพอดี: uid ของแอปคำนวณจากเนื้อหา
-- ฝั่งเบราว์เซอร์ก่อนที่เราจะประทับชื่อผู้ทำ · เครื่องของคนอื่นที่ดึงประวัติไปแล้วส่งกลับขึ้นมา
-- จะประทับชื่อ "คนที่ส่ง" ทับ "คนที่ทำ" ได้ ถ้าปล่อยให้เขียนทับ — ข้ามไปจึงถูกกว่า
grant update on fs_activities to anon, authenticated;

create or replace function fs_activities_append_only() returns trigger
language plpgsql
as $fn$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  return null;   -- ข้ามการแก้แถวนี้ไปเงียบ ๆ ไม่ใช่ทำให้ทั้งคำสั่งล้ม
end
$fn$;

drop trigger if exists fs_activities_no_update on fs_activities;
create trigger fs_activities_no_update
  before update on fs_activities
  for each row execute function fs_activities_append_only();

-- ---------------------------------------------------------------------------
-- 3) ตัวนับเลขงานเขียนตรงไม่ได้
--
-- เลขงานที่ออกไปแล้วอาจอยู่บนเอกสารที่ออกจากบริษัทไปแล้ว การย้อนตัวนับแปลว่า
-- ใบถัดไปจะได้เลขซ้ำกับใบเก่า · แอปส่ง POST fs_meta คีย์ reccounter ขึ้นมาทุกครั้ง
-- ที่ซิงก์ ซึ่งเป็นการเขียนทับด้วยค่าที่เบราว์เซอร์จำไว้ — ปิดทางนั้น
--
-- fs_next_rec_seq() ยังต้องเขียนได้ จึงให้มันรันด้วยสิทธิ์เจ้าของฐาน (security definer)
-- แทนสิทธิ์ผู้เรียก ตัว trigger จึงเห็นว่าเป็นเจ้าของฐานแล้วปล่อยผ่าน
-- (แก้ที่นี่ ไม่ไปแก้ docs/upstream-schema.sql ซึ่งต้องคงไว้ตรงกับต้นทาง)
-- ---------------------------------------------------------------------------
alter function fs_next_rec_seq() security definer;

-- 3.1) เลขที่ออกต้องสูงกว่ารหัสงานที่มีอยู่จริงเสมอ
--
-- งานที่สร้างตอนออฟไลน์ได้เลขจากเบราว์เซอร์ (recCounter++) แต่เบราว์เซอร์เลื่อนตัวนับ
-- บนเซิร์ฟเวอร์ไม่ได้ (ข้อ 3) ตัวนับจึงค้างต่ำกว่ารหัสนั้น แล้วออกเลขซ้ำให้งานถัดไป
-- ผลคือสองงานรหัสเดียวกัน ฐานเก็บไว้ตัวเดียว อีกงานหายเงียบ ๆ (พบ 3 ต.ค. 2569, D2)
-- ลำดับคำนวณแบบเดียวกับ seqFromRecId() ของแอป: A00001=1 … A99999=99999, B00001=100000 …
-- ตัวนับเดินหน้าอย่างเดียว ไม่ย้อน (กฎข้อ 2 ของ CLAUDE.md)
create or replace function fs_rec_seq_of(rec_id text) returns bigint
language sql immutable
as $fn$
  select case
    when m is null or m[2]::bigint = 0 then 0
    else ((select sum((ascii(substr(m[1], i, 1)) - 64) * power(26::numeric, length(m[1]) - i))::bigint
           from generate_series(1, length(m[1])) i) - 1) * 99999 + m[2]::bigint
  end
  from (select regexp_match(coalesce(rec_id, ''), '^([A-Z]+)(\d{5})$') as m) s
$fn$;

create or replace function fs_next_rec_seq() returns bigint
language plpgsql security definer set search_path = public
as $fn$
declare n bigint; floor_seq bigint;
begin
  select coalesce(max(fs_rec_seq_of(id)), 0) into floor_seq from fs_records;
  insert into fs_meta(key, value) values ('reccounter', to_jsonb(floor_seq + 1))
  on conflict (key) do update
    set value = to_jsonb(greatest((fs_meta.value #>> '{}')::bigint, floor_seq) + 1),
        updated_at = now()
  returning (fs_meta.value #>> '{}')::bigint into n;
  return n;
end
$fn$;

create or replace function fs_guard_meta() returns trigger
language plpgsql
as $fn$
begin
  if new.key = 'reccounter' and current_user in ('anon', 'authenticated') then
    raise exception 'reccounter is issued by fs_next_rec_seq() only'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$fn$;

drop trigger if exists fs_meta_guard on fs_meta;
create trigger fs_meta_guard
  before insert or update on fs_meta
  for each row execute function fs_guard_meta();

-- ---------------------------------------------------------------------------
-- 4) ลบแล้วต้องยังกู้ได้
--
-- แอปสั่ง DELETE จริงเมื่อคนกดลบงาน/ลบห้องแชท/ลบผู้ใช้ ซึ่งลบแล้วหายถาวร
-- ไม่มีถังขยะ ไม่มีประวัติ · เก็บสำเนาไว้ก่อนเสมอ แถวหายจากตารางหลักเหมือนเดิม
-- แอปจึงทำงานเหมือนเดิมทุกประการ แต่ของที่ลบไปยังตามกลับมาได้
--
-- ตัวเก็บรันด้วยสิทธิ์เจ้าของฐาน anon จึงไม่ต้องมีสิทธิ์แตะ fs_archive เลย
-- (และไม่ควรมี ไม่งั้นก็ลบสำเนาทิ้งได้อีก)
-- ---------------------------------------------------------------------------
create table if not exists fs_archive (
  id          bigserial primary key,
  source      text        not null,
  row_key     text,
  data        jsonb       not null,
  archived_at timestamptz not null default now()
);
create index if not exists fs_archive_source_idx on fs_archive (source, archived_at desc);

revoke all on fs_archive from anon, authenticated;
revoke all on sequence fs_archive_id_seq from anon, authenticated;

-- อ่านคีย์จาก jsonb ไม่ใช่จากชื่อคอลัมน์ตรง ๆ
--
-- PL/pgSQL ผูกชื่อคอลัมน์ตอนคอมไพล์ "ทุกกิ่ง" ของ CASE ไม่ใช่เฉพาะกิ่งที่ได้ทำงาน
-- เขียน old.job_id ไว้ในกิ่งของ fs_chats แล้วลบแถวจาก fs_records จึงล้มด้วย
-- "record old has no field job_id" — และเมื่อ trigger ล้ม การลบล้มทั้งคำสั่ง
-- แปลว่าปุ่มลบของแอปพังทั้งปุ่ม ทั้งที่ตั้งใจแค่จะเก็บสำเนา
create or replace function fs_keep_deleted() returns trigger
language plpgsql
security definer
as $fn$
declare
  row_json jsonb := to_jsonb(old);
  key_text text;
begin
  if tg_table_name = 'fs_approvals' then
    key_text := coalesce(row_json ->> 'job_id', '') || '|' || coalesce(row_json ->> 'part', '');
  else
    key_text := coalesce(row_json ->> 'id', row_json ->> 'job_id', row_json ->> 'uid', row_json ->> 'name');
  end if;
  insert into fs_archive (source, row_key, data) values (tg_table_name, key_text, row_json);
  return old;
end
$fn$;

do $keep$
declare t text;
begin
  foreach t in array array['fs_records', 'fs_chats', 'fs_messages', 'fs_approvals', 'fs_users'] loop
    execute format('drop trigger if exists %I_keep_deleted on %I', t, t);
    execute format(
      'create trigger %I_keep_deleted before delete on %I for each row execute function fs_keep_deleted()', t, t);
  end loop;
end
$keep$;

-- ---------------------------------------------------------------------------
-- 5) บทบาทและรหัสผ่านของผู้ใช้ ห้ามถูกเขียนจากเบราว์เซอร์
--
-- แอปส่ง fs_users ขึ้นมาทั้งก้อนทุกครั้งที่ซิงก์ รวม role และ pass ใครแก้ค่าในเครื่อง
-- ตัวเองก็เลื่อนตำแหน่งตัวเองได้ · ตั้งแต่ย้ายการล็อกอินไปที่ OPC Workflow แล้ว
-- ช่อง pass ไม่ได้ถูกใช้ยืนยันตัวตนอีกเลย จึงตรึงไว้ทั้งคู่
--
-- ข้อนี้ตรึงเฉพาะตอน "แก้แถวเดิม" ส่วนตอนสร้างแถวใหม่อยู่ที่ข้อ 5ก ข้างล่าง
--
-- เดิมตรงนี้เขียนไว้ว่า "การสร้างผู้ใช้ใหม่ยังใส่บทบาทได้ เพราะมีด่านของ proxy คุมอยู่"
-- ประโยคนั้นไม่จริง — 24 ส.ค. ผู้ตรวจพิสูจน์ว่าด่านของ proxy ข้ามได้ด้วยการส่งเนื้อคำขอ
-- เป็นก้อนเดียวแทนรายการ · การฝากกฎที่ "จริงเสมอ" ไว้กับชั้นเดียวที่มีรูอยู่ คือสิ่งที่
-- กฎ 3.1 ห้ามไว้ตรง ๆ
-- ---------------------------------------------------------------------------
create or replace function fs_freeze_user_identity() returns trigger
language plpgsql
as $fn$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if old.data ? 'role' then
    new.data := jsonb_set(new.data, '{role}', old.data -> 'role');
  else
    new.data := new.data - 'role';
  end if;
  if old.data ? 'pass' then
    new.data := jsonb_set(new.data, '{pass}', old.data -> 'pass');
  else
    new.data := new.data - 'pass';
  end if;
  return new;
end
$fn$;

drop trigger if exists fs_users_freeze_identity on fs_users;
create trigger fs_users_freeze_identity
  before update on fs_users
  for each row execute function fs_freeze_user_identity();

-- ---------------------------------------------------------------------------
-- 5ก) บทบาทติดมากับ "แถวใหม่" ไม่ได้เช่นกัน
--
-- ข้อ 5 เป็น BEFORE UPDATE จึงไม่แตะการสร้างแถวใหม่เลย · ใครส่ง INSERT พร้อม
-- role:"admin" ขึ้นมา ก็ได้บัญชี admin ทันที แล้วล็อกอินเข้ามาด้วยอีเมลนั้นได้เลย
-- นั่นคือช่องที่ผู้ตรวจเดินผ่านจริงเมื่อ 24 ส.ค. 2569
--
-- ถอด role ออกจากแถวที่ anon ส่งมาเสมอ · บทบาทจึงออกได้ทางเดียวคือ fs_set_user_role()
-- ซึ่ง proxy เรียกให้หลังจากตรวจแล้วว่าคนที่กดเป็น admin จริง (รวมถึงตอนสร้างผู้ใช้ใหม่)
--
-- ทำงานร่วมกับข้อ 5 ได้ถูกต้องบนท่าที่แอปใช้จริง (POST + merge-duplicates ซึ่งลงเอย
-- เป็น INSERT .. ON CONFLICT DO UPDATE): BEFORE INSERT ถอด role ออกจากแถวที่เสนอ
-- แล้ว BEFORE UPDATE เอา role เดิมของแถวนั้นใส่กลับ — แถวเดิมจึงไม่เสียบทบาทไป
-- (ข้อนี้ต้องทดสอบทุกครั้งที่แก้ อย่าเชื่อว่ามันประกอบกันถูก)
-- ---------------------------------------------------------------------------
create or replace function fs_strip_new_user_role() returns trigger
language plpgsql
as $fn$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  new.data := coalesce(new.data, '{}'::jsonb) - 'role';
  return new;
end
$fn$;

drop trigger if exists fs_users_strip_new_role on fs_users;
create trigger fs_users_strip_new_role
  before insert on fs_users
  for each row execute function fs_strip_new_user_role();

-- ---------------------------------------------------------------------------
-- 6) ประตูเดียวที่เปลี่ยนบทบาทได้ — สำหรับ admin เท่านั้น
--
-- ข้อ 5 ตรึง role ไว้ "ทุกกรณี" ที่ผู้เรียกเป็น anon ซึ่งถูกสำหรับเบราว์เซอร์ทั่วไป
-- แต่หน้าจัดการผู้ใช้ของแอปเปลี่ยนบทบาทด้วยคำสั่งเดียวกันเป๊ะ (saveRoles() แก้ค่าใน
-- หน่วยความจำ แล้วปล่อยให้รอบซิงก์ส่ง fs_users ทั้งก้อนขึ้นมา ไม่มีปลายทางแยก)
-- ผลคือถ้าไม่มีประตูนี้ admin กดเปลี่ยนบทบาทแล้ว "ขึ้นว่าบันทึกเรียบร้อย" ทุกครั้ง
-- แต่ค่าเด้งกลับเงียบ ๆ ในการดึงข้อมูลรอบถัดไป — พังแบบที่ไม่มีใครเห็นว่าพัง
--
-- proxy เป็นคนตัดสินว่าคนที่กดเป็น admin จริงไหม เพราะฐานไม่รู้จักใครเลย
-- ทุกคำขอมาถึงในนาม anon เหมือนกันหมด · ฟังก์ชันนี้จึงไม่ใช่ด่าน มันคือ "ประตู"
-- ด่านคือ ALLOWED_RPC ใน formula-proxy.mjs ที่ไม่ปล่อยให้เบราว์เซอร์เรียกชื่อนี้
--
-- จงใจไม่ตรวจว่าบทบาทอยู่ในรายการที่รู้จักไหม — รายชื่อบทบาทเป็นของแอป (ROLE_KEYS)
-- ถ้าคัดลอกมาไว้ที่นี่ วันที่แอปเพิ่มบทบาทใหม่ ฐานจะปฏิเสธโดยไม่มีใครนึกถึงไฟล์นี้
-- การตรวจรายชื่ออยู่ที่ proxy ซึ่งมีเทสต์เทียบกับบันเดิลที่ผนึกไว้จริง
-- ---------------------------------------------------------------------------
create or replace function fs_set_user_role(p_name text, p_role text) returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_role is null or p_role !~ '^[a-z][a-z0-9_]{1,30}$' then
    raise exception 'บทบาท % ผิดรูปแบบ', coalesce(p_role, '(ว่าง)') using errcode = '22023';
  end if;
  update fs_users
     set data = jsonb_set(coalesce(data, '{}'::jsonb), '{role}', to_jsonb(p_role))
   where name = p_name;
  if not found then
    raise exception 'ไม่มีผู้ใช้ชื่อ %', p_name using errcode = 'no_data_found';
  end if;
end
$fn$;

-- PostgREST เชื่อมด้วย authenticator แล้วสลับเป็น anon ทุกคำขอ ฟังก์ชันนี้จึงต้องให้
-- anon เรียกได้ ไม่มีทางอื่น · สิ่งที่กันเบราว์เซอร์ไว้คือ allowlist ของ proxy
-- (tests/data-policy.test.mjs มีข้อที่ยืนยันว่าชื่อนี้ไม่อยู่ใน ALLOWED_RPC)
grant execute on function fs_set_user_role(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7) บอก PostgREST ให้อ่านสคีมาใหม่
--
-- PostgREST จำรายชื่อตารางและฟังก์ชันไว้ในแคชตอนเปิดตัว การสร้างฟังก์ชันใหม่จึง
-- "มีในฐานแล้ว แต่ยังเรียกผ่าน REST ไม่ได้" จนกว่ามันจะอ่านใหม่ — อาการที่ได้คือ
-- HTTP 404 PGRST202 ซึ่งอ่านแล้วเหมือนพิมพ์ชื่อฟังก์ชันผิด ทั้งที่ฟังก์ชันอยู่ครบ
--
-- เจอมาแล้ว 24 ส.ค.: ประตูเปลี่ยนบทบาทตอบ 404 ตอนทดสอบจริงรอบแรก
-- บรรทัดนี้จึงต้องอยู่ "ท้ายไฟล์เสมอ" ห้ามย้ายขึ้นไปก่อนคำสั่ง create
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
