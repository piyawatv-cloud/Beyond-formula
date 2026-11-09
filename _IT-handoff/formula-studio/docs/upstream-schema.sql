-- ============================================================
-- Formula Studio — โครงสร้างฐานข้อมูลกลาง (Supabase / Postgres)
-- ============================================================
-- วิธีใช้: Supabase Dashboard → SQL Editor → New query → วางทั้งไฟล์ → Run
-- รันซ้ำได้เสมอ ไม่ลบข้อมูลเดิม (ทุกคำสั่งเป็น if not exists / or replace)
--
-- หลักการออกแบบ (ตามกฎข้อ 1 ใน CLAUDE.md — ห้ามแก้ไขโครงสร้างข้อมูล):
--   เก็บ object รูปทรงเดิมของแอปทั้งก้อนไว้ในคอลัมน์ jsonb ชื่อ data
--   ไม่แตกฟิลด์ออกเป็นคอลัมน์ → ชื่อฟิลด์และชนิดข้อมูลเดิมไม่ต้องเปลี่ยนแม้แต่ตัวเดียว
--   สิ่งที่แยกออกมาเป็นตาราง คือสิ่งที่ "หลายคนแก้พร้อมกัน" เท่านั้น
--   (ข้อความแชท / สถานะอนุมัติ) เพื่อไม่ให้ส่งพร้อมกันแล้วทับกัน
-- ============================================================

-- ---------- ชุดข้อมูลงาน (fs_records) ----------
create table if not exists fs_records (
  id         text primary key,          -- รหัสงาน A00001
  data       jsonb not null,            -- record object ทั้งก้อน
  updated_at timestamptz not null default now()
);

-- ---------- ห้องแชท (fs_chats) — เก็บเฉพาะข้อมูลห้อง ----------
-- ข้อความและสถานะอนุมัติแยกไปอยู่ fs_messages / fs_approvals
create table if not exists fs_chats (
  job_id     text primary key,          -- ผูกกับ fs_records.id
  data       jsonb not null,            -- {jobId, createdAt, createdBy, parts}
  updated_at timestamptz not null default now()
);

-- ---------- ข้อความในห้องแชท (fs_messages) — 1 แถว = 1 ข้อความ ----------
-- แยกทีละข้อความ เพื่อให้หลายคนส่งพร้อมกันแล้วไม่มีข้อความไหนหาย
create table if not exists fs_messages (
  uid        text primary key,          -- รหัสประจำข้อความ คำนวณจากเนื้อหา ส่งซ้ำก็ไม่ซ้ำ
  job_id     text not null,
  ts         bigint not null,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists fs_messages_job_idx on fs_messages (job_id, ts);

-- ---------- สถานะอนุมัติรายฝ่าย (fs_approvals) ----------
-- แยกทีละฝ่าย เพื่อให้ PD / RA / RD / Sales กดอนุมัติพร้อมกันแล้วไม่ทับกัน
create table if not exists fs_approvals (
  job_id     text not null,
  part       text not null,             -- pd | ra | rd | sales
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (job_id, part)
);

-- ---------- ผู้ใช้ (fs_users) ----------
create table if not exists fs_users (
  name       text primary key,          -- ชื่อผู้ใช้ (คีย์เดิมของแอป)
  data       jsonb not null,            -- {name, role, email, pass}
  updated_at timestamptz not null default now()
);

-- ---------- Activities log (fs_activities) — append only ----------
create table if not exists fs_activities (
  uid        text primary key,          -- รหัสประจำเหตุการณ์ ส่งซ้ำกี่ครั้งก็ไม่เกิดรายการซ้ำ
  ts         bigint not null,
  data       jsonb not null
);
create index if not exists fs_activities_ts_idx on fs_activities (ts desc);

-- ---------- ค่าอื่น ๆ ของระบบ (fs_meta) ----------
-- ใช้เก็บ reccounter = ตัวนับเลขรันของรหัสงาน (ห้ามย้อนกลับ)
create table if not exists fs_meta (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- ออกเลขงานถัดไปแบบ atomic
-- ผู้ใช้หลายคนกดสร้างงานพร้อมกัน ต่างคนต่างได้คนละเลข ไม่มีทางซ้ำ
-- ============================================================
create or replace function fs_next_rec_seq() returns bigint
language plpgsql
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
grant execute on function fs_next_rec_seq() to anon, authenticated;

-- ============================================================
-- สิทธิ์การเข้าถึง
-- ============================================================
-- โปรเจกต์นี้ใช้ระบบ login ของแอปเอง (ตรวจฝั่ง client) ยังไม่ได้ใช้ Supabase Auth
-- จึงต้องเปิดให้ anon key อ่าน/เขียนได้ มิฉะนั้นแอปจะทำงานไม่ได้
--
-- ⚠️ ใครที่รู้ URL + key (ซึ่งอยู่ในไฟล์ index.html ที่เปิดดูได้) เข้าถึงข้อมูลได้ทั้งหมด
--    เหมาะกับข้อมูลภายในทีมเท่านั้น ถ้าต้องการกันจริงต้องเปลี่ยนไปใช้ Supabase Auth + RLS
-- ============================================================
alter table fs_records    enable row level security;
alter table fs_chats      enable row level security;
alter table fs_messages   enable row level security;
alter table fs_approvals  enable row level security;
alter table fs_users      enable row level security;
alter table fs_activities enable row level security;
alter table fs_meta       enable row level security;

do $pol$
declare t text;
begin
  foreach t in array array['fs_records','fs_chats','fs_messages','fs_approvals',
                           'fs_users','fs_activities','fs_meta'] loop
    execute format('drop policy if exists anon_all on %I', t);
    execute format(
      'create policy anon_all on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end
$pol$;

-- ============================================================
-- อัพเดต updated_at อัตโนมัติทุกครั้งที่มีการแก้ไข
-- (แอปใช้คอลัมน์นี้ดึงเฉพาะข้อมูลที่เปลี่ยน แทนการดึงใหม่ทั้งหมด)
-- ============================================================
create or replace function fs_touch_updated_at() returns trigger
language plpgsql
as $tf$
begin
  new.updated_at = now();
  return new;
end
$tf$;

do $trg$
declare t text;
begin
  foreach t in array array['fs_records','fs_chats','fs_messages','fs_approvals',
                           'fs_users','fs_meta'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format(
      'create trigger %I_touch before update on %I for each row execute function fs_touch_updated_at()', t, t);
  end loop;
end
$trg$;
