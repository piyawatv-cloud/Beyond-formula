#!/bin/sh
# ดึง "ชื่อเต็ม" กับ "แผนก" จาก OPC Workflow มาเก็บเพิ่มใน fs_users — รันซ้ำได้เสมอ
#
# จับคู่ด้วยอีเมลเท่านั้น และแตะเฉพาะแถวที่มีอยู่แล้วใน Formula Studio
# ไม่สร้างผู้ใช้ใหม่ ไม่ลบใคร ตามที่เจ้าของสั่งไว้ 2026-08-24
#
# สิ่งที่ห้ามแตะ และเหตุผล:
#   name   เป็น primary key และถูก "คัดลอกเป็นข้อความ" ไปฝังในข้อมูลจริงแล้ว
#          (fs_activities.user 4,217 แถว · fs_messages.user) เปลี่ยนชื่อ = ประวัติทั้งหมด
#          ชี้ไปหาคนที่ไม่มีอยู่ กู้กลับไม่ได้
#   role   Formula Studio เป็นเจ้าของบทบาทของตัวเอง OPC มี crm/monitor ที่ที่นี่ไม่มี
#          ดึงมาทับแล้วคนนั้นจะได้ role แปลกปลอมที่ can() คืนเท็จทุกข้อ = ทำอะไรไม่ได้เลย
#   email  เป็นกุญแจที่ใช้จับคู่ ทับแล้วรอบหน้าจะจับคู่ไม่เจอ
#   pass   ไม่มีใครอ่านแล้ว แต่กฎข้อ 2 ห้ามลบฟิลด์เดิมทิ้ง
#
# fullName / department เป็นฟิลด์ใหม่แบบ optional — แถวที่ยังไม่มีต้องแสดงผลได้ตามปกติ
#
# ใช้: sh scripts/sync-user-profile-from-opc.sh [--dry-run]
set -eu

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OPC_CONTAINER="${OPC_PG_CONTAINER:-opc-workflow-db}"
OPC_USER="${OPC_PG_USER:-opc_runtime}"
OPC_DB="${OPC_PG_DB:-opc_workflow}"
FS_CONTAINER="${FORMULA_PG_CONTAINER:-formula-postgres}"
FS_DB="${FORMULA_PG_DB:-formula}"
DRY=""
[ "${1:-}" = "--dry-run" ] && DRY=1
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM

say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# ใช้ COPY TO STDOUT ของ psql ฝั่ง OPC แล้วป้อนเข้า COPY FROM STDIN ฝั่ง Formula
# เพราะสองฝั่งใช้กติกา escape ชุดเดียวกัน — ชื่อไทยที่มีอักขระพิเศษจึงข้ามฝั่งได้ตรง ๆ
# ถ้าประกอบ SQL เป็นสตริงเองจะต้องมานั่งไล่ quote ซึ่งพลาดง่ายและพลาดแล้วเงียบ
docker exec "$OPC_CONTAINER" psql -tAq -U "$OPC_USER" -d "$OPC_DB" -c "
  copy (
    select lower(trim(access_email)), trim(name), coalesce(trim(department), '')
      from users
     where is_active and coalesce(trim(access_email), '') <> '' and coalesce(trim(name), '') <> ''
  ) to stdout
" > "$WORK/profile.tsv"

say "อ่านจาก OPC ได้ $(wc -l < "$WORK/profile.tsv" | tr -d ' ') คน (เฉพาะที่ยังใช้งานและมีอีเมล)"

{
  echo "\\set ON_ERROR_STOP on"
  echo "begin;"
  # ใช้ตารางพักจริงในสคีมา public ไม่ใช่ temp table เพราะเดี๋ยวเราจะ "ลดตัวเองลงเป็น anon"
  # ก่อนสั่ง update แล้ว anon มองไม่เห็นสคีมาชั่วคราวของ postgres
  echo "drop table if exists fs_profile_stage;"
  echo "create table fs_profile_stage (email text primary key, full_name text, department text);"
  echo "grant select on fs_profile_stage to anon;"
  echo "copy fs_profile_stage (email, full_name, department) from stdin;"
  cat "$WORK/profile.tsv"
  echo "\\."
  cat <<'SQL'

-- รายงานก่อนแก้ ว่าจะแตะใครบ้าง
\echo '--- แถวที่จะเปลี่ยน ---'
select u.name as ผู้ใช้, p.full_name as ชื่อเต็ม, nullif(p.department,'') as แผนก
  from fs_users u join fs_profile_stage p
    on lower(trim(coalesce(u.data->>'email',''))) = p.email
 where coalesce(u.data->>'fullName','') is distinct from p.full_name
    or coalesce(u.data->>'department','') is distinct from nullif(p.department,'')
 order by 1;

\echo '--- คนใน Formula Studio ที่จับคู่กับ OPC ไม่ได้ (ไม่ถูกแตะ) ---'
select u.name as ผู้ใช้, coalesce(nullif(u.data->>'email',''),'(ไม่มีอีเมล)') as อีเมล
  from fs_users u
 where not exists (select 1 from fs_profile_stage p where p.email = lower(trim(coalesce(u.data->>'email',''))))
 order by 1;

-- ลดสิทธิ์ตัวเองลงเป็น anon ก่อนเขียน
-- trigger fs_freeze_user_identity ตรึง role กับ pass ไว้ "เฉพาะเมื่อผู้เขียนเป็น anon/authenticated"
-- ถ้าเขียนในนาม postgres ด่านนั้นจะปล่อยผ่านทั้งดุ้น สคริปต์นี้จึงเขียนแค่ fullName/department
-- ก็จริง แต่ความถูกต้องจะขึ้นกับ "ผมเขียน SQL ไม่พลาด" อย่างเดียว ซึ่งไม่ใช่หลักประกัน
-- ลดตัวเองลงมาอยู่ใต้ด่านเดียวกับที่แอปอยู่ แล้วให้ฐานเป็นคนกันแทน
set local role anon;

update fs_users u
   set data = jsonb_set(u.data, '{fullName}', to_jsonb(p.full_name), true)
  from fs_profile_stage p
 where lower(trim(coalesce(u.data->>'email',''))) = p.email
   and coalesce(u.data->>'fullName','') is distinct from p.full_name;

-- แผนกที่ว่างไม่ต้องเขียนคีย์เปล่าลงไป ปล่อยให้ไม่มีคีย์ดีกว่ามีคีย์ที่เป็นค่าว่าง
update fs_users u
   set data = jsonb_set(u.data, '{department}', to_jsonb(p.department), true)
  from fs_profile_stage p
 where lower(trim(coalesce(u.data->>'email',''))) = p.email
   and p.department <> ''
   and coalesce(u.data->>'department','') is distinct from p.department;

reset role;
drop table fs_profile_stage;
SQL
  if [ -n "$DRY" ]; then echo "rollback;"; else echo "commit;"; fi
  cat <<'SQL'
\echo '--- ผลลัพธ์ ---'
select count(*) filter (where coalesce(data->>'fullName','') <> '') as มีชื่อเต็ม,
       count(*) filter (where coalesce(data->>'department','') <> '') as มีแผนก,
       count(*) as ทั้งหมด
  from fs_users;
SQL
} > "$WORK/sync.sql"

docker exec -i "$FS_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d "$FS_DB" < "$WORK/sync.sql"
[ -n "$DRY" ] && say "โหมดลองอย่างเดียว — ย้อนกลับหมด ไม่ได้บันทึกอะไร" || say "sync-user-profile status=ok"
