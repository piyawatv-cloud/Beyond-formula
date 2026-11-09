#!/bin/sh
# รวมข้อมูลที่ยังค้างอยู่บน Supabase เข้าฐานในเครื่อง — รันซ้ำได้ ไม่ลบอะไรทั้งสิ้น
#
# ทำไมต้องมี: ตอนย้ายเราย้าย runtime แต่ไม่ได้ย้ายคน — beyond-formula.vercel.app
# ยังเปิดอยู่และคนยังใช้อยู่จริง งานที่เกิดที่นั่นหลังจุดสำรอง 22 ส.ค. จึงไม่มีในฐานใหม่
# ตราบใดที่หน้านั้นยังเปิด ต้องรันตัวนี้ซ้ำก่อนตัดจริงเสมอ รอบเดียวไม่พอ
#
# กติกาการรวม:
#   fs_records · fs_chats · fs_messages · fs_approvals   ใครใหม่กว่าใช้ของคนนั้น (updated_at)
#   fs_activities                                        เติมเฉพาะที่ยังไม่มี (append only)
#   fs_meta.reccounter                                   เอาค่าที่ "มากกว่า" เสมอ ห้ามถอยหลัง
#   fs_users                                             ไม่แตะเลย
#
# ที่ไม่แตะ fs_users เพราะฝั่งเครื่องมี fullName/department ที่ดึงจาก OPC มาเพิ่ม
# ส่วน Supabase ไม่มี ถ้าเอาของมันมาทับจะลบสิ่งที่เพิ่งเติมไปทิ้ง และจำนวนคนเท่ากันอยู่แล้ว
#
# ใช้: sh scripts/merge-from-supabase.sh <โฟลเดอร์ที่ pull มา> [--dry-run]
set -eu

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_ENV="${FORMULA_DATA_ENV_FILE:-$REPO_DIR/runtime/data.env}"
FS_CONTAINER="${FORMULA_PG_CONTAINER:-formula-postgres}"
FS_DB="${FORMULA_PG_DB:-formula}"
SRC="${1:-}"
DRY=""
[ "${2:-}" = "--dry-run" ] && DRY=1
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM

[ -n "$SRC" ] && [ -d "$SRC" ] || { echo "ใช้: sh scripts/merge-from-supabase.sh <โฟลเดอร์ที่ pull มา> [--dry-run]" >&2; exit 2; }
[ -f "$DATA_ENV" ] || { echo "ไม่พบ $DATA_ENV" >&2; exit 2; }

say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
psql_run() { docker exec -i "$FS_CONTAINER" psql -v ON_ERROR_STOP=1 -q -U postgres -d "$FS_DB" "$@"; }

say "แปลง NDJSON เป็นคำสั่ง COPY"
COUNTS="$(node "$REPO_DIR/scripts/ndjson-to-copy.mjs" "$SRC" "$WORK/data.sql")"
say "ที่ดึงมาได้: $COUNTS"

{
  echo "\\set ON_ERROR_STOP on"
  echo "begin;"
  # ตารางพักอยู่คนละสคีมา แล้วใช้ search_path พาคำสั่ง COPY ที่ ndjson-to-copy สร้างไว้เข้าที่นั่น
  # จะได้ไม่ต้องแก้ตัวสร้าง และไม่มีทางพลาดไปเขียนทับตารางจริงตอน COPY
  cat <<'SQL'
drop schema if exists sbstage cascade;
create schema sbstage;
create table sbstage.fs_records    (id text primary key, data jsonb, updated_at timestamptz);
create table sbstage.fs_chats      (job_id text primary key, data jsonb, updated_at timestamptz);
create table sbstage.fs_messages   (uid text primary key, job_id text, ts bigint, data jsonb, updated_at timestamptz);
create table sbstage.fs_approvals  (job_id text, part text, data jsonb, updated_at timestamptz, primary key (job_id, part));
create table sbstage.fs_users      (name text primary key, data jsonb, updated_at timestamptz);
create table sbstage.fs_activities (uid text primary key, ts bigint, data jsonb);
create table sbstage.fs_meta       (key text primary key, value jsonb, updated_at timestamptz);
set local search_path = sbstage;
SQL
  cat "$WORK/data.sql"
  cat <<'SQL'
set local search_path = public;

-- ปิด trigger ที่ประทับ updated_at = now() ระหว่างรวมข้อมูล
-- ไม่งั้นแถวที่รวมเข้ามาจะถูกประทับเป็นเวลาปัจจุบันทั้งหมด แล้วรอบหน้าจะเทียบ "ใครใหม่กว่า" ไม่ได้อีก
alter table fs_records   disable trigger fs_records_touch;
alter table fs_chats     disable trigger fs_chats_touch;
alter table fs_messages  disable trigger fs_messages_touch;
alter table fs_approvals disable trigger fs_approvals_touch;
alter table fs_meta      disable trigger fs_meta_touch;

\echo '--- จะเปลี่ยนอะไรบ้าง ---'
select 'fs_records เพิ่มใหม่' k, count(*) n from sbstage.fs_records s where not exists (select 1 from fs_records t where t.id = s.id)
union all select 'fs_records อัปเดต', count(*) from sbstage.fs_records s join fs_records t on t.id = s.id where t.updated_at < s.updated_at
union all select 'fs_chats เพิ่มใหม่', count(*) from sbstage.fs_chats s where not exists (select 1 from fs_chats t where t.job_id = s.job_id)
union all select 'fs_chats อัปเดต', count(*) from sbstage.fs_chats s join fs_chats t on t.job_id = s.job_id where t.updated_at < s.updated_at
union all select 'fs_messages เพิ่มใหม่', count(*) from sbstage.fs_messages s where not exists (select 1 from fs_messages t where t.uid = s.uid)
union all select 'fs_approvals เพิ่มใหม่', count(*) from sbstage.fs_approvals s where not exists (select 1 from fs_approvals t where t.job_id = s.job_id and t.part = s.part)
union all select 'fs_approvals อัปเดต', count(*) from sbstage.fs_approvals s join fs_approvals t on t.job_id = s.job_id and t.part = s.part where t.updated_at < s.updated_at
union all select 'fs_activities เพิ่มใหม่', count(*) from sbstage.fs_activities s where not exists (select 1 from fs_activities t where t.uid = s.uid);

insert into fs_records (id, data, updated_at)
select id, data, updated_at from sbstage.fs_records
on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at
where fs_records.updated_at < excluded.updated_at;

insert into fs_chats (job_id, data, updated_at)
select job_id, data, updated_at from sbstage.fs_chats
on conflict (job_id) do update set data = excluded.data, updated_at = excluded.updated_at
where fs_chats.updated_at < excluded.updated_at;

insert into fs_messages (uid, job_id, ts, data, updated_at)
select uid, job_id, ts, data, updated_at from sbstage.fs_messages
on conflict (uid) do update set data = excluded.data, updated_at = excluded.updated_at
where fs_messages.updated_at < excluded.updated_at;

insert into fs_approvals (job_id, part, data, updated_at)
select job_id, part, data, updated_at from sbstage.fs_approvals
on conflict (job_id, part) do update set data = excluded.data, updated_at = excluded.updated_at
where fs_approvals.updated_at < excluded.updated_at;

-- ประวัติเติมอย่างเดียว ห้ามทับ — ของเดิมคือของที่เกิดขึ้นจริงแล้ว
insert into fs_activities (uid, ts, data)
select uid, ts, data from sbstage.fs_activities
on conflict (uid) do nothing;

-- ตัวนับเลขงานต้องเดินหน้าอย่างเดียว เอาค่าที่มากกว่าเสมอ
-- ข้อนี้สำคัญที่สุดในไฟล์: ถ้าตัวนับตามหลังรหัสที่ออกไปแล้ว งานใบถัดไปจะได้รหัสซ้ำ
-- แล้ว upsert จะทับงานเก่าทิ้งโดยไม่มีใครเห็น
update fs_meta t
   set value = to_jsonb(greatest((t.value #>> '{}')::bigint, (s.value #>> '{}')::bigint))
  from sbstage.fs_meta s
 where t.key = 'reccounter' and s.key = 'reccounter'
   and (s.value #>> '{}')::bigint > (t.value #>> '{}')::bigint;

insert into fs_meta (key, value, updated_at)
select key, value, updated_at from sbstage.fs_meta where key <> 'reccounter'
on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at
where fs_meta.updated_at < excluded.updated_at;

alter table fs_records   enable trigger fs_records_touch;
alter table fs_chats     enable trigger fs_chats_touch;
alter table fs_messages  enable trigger fs_messages_touch;
alter table fs_approvals enable trigger fs_approvals_touch;
alter table fs_meta      enable trigger fs_meta_touch;
drop schema sbstage cascade;
SQL
  if [ -n "$DRY" ]; then echo "rollback;"; else echo "commit;"; fi
  cat <<'SQL'
\echo '--- ผลลัพธ์ ---'
select 'fs_records' t, count(*) c from fs_records
union all select 'fs_chats', count(*) from fs_chats
union all select 'fs_messages', count(*) from fs_messages
union all select 'fs_approvals', count(*) from fs_approvals
union all select 'fs_users', count(*) from fs_users
union all select 'fs_activities', count(*) from fs_activities
union all select 'reccounter', (select (value #>> '{}')::bigint from fs_meta where key='reccounter')
union all select 'รหัสงานสูงสุด', (select max(substring(id from 2)::bigint) from fs_records) order by 1;
SQL
} > "$WORK/merge.sql"

psql_run < "$WORK/merge.sql"
[ -n "$DRY" ] && say "โหมดลองอย่างเดียว — ย้อนกลับหมด" || say "merge-from-supabase status=ok"
