#!/bin/sh
# สร้างโครงฐานข้อมูลในเครื่องให้เหมือน Supabase เดิมทุกบรรทัด — รันซ้ำได้เสมอ
#
# ลำดับสำคัญ ห้ามสลับ:
#   1) บทบาท anon / authenticated / authenticator   ต้องมีก่อน
#   2) docs/upstream-schema.sql "ทั้งไฟล์ไม่แก้"      เพราะมันอ้างบทบาทพวกนั้น
#   3) สิทธิ์ระดับตาราง                              ต้องหลังตารางเกิดแล้ว
#
# ใช้: sh scripts/init-local-data.sh
set -eu

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_ENV="${FORMULA_DATA_ENV_FILE:-$REPO_DIR/runtime/data.env}"
CONTAINER="${FORMULA_PG_CONTAINER:-formula-postgres}"
DB="${FORMULA_PG_DB:-formula}"

[ -f "$DATA_ENV" ] || { echo "ไม่พบ $DATA_ENV" >&2; exit 2; }
# shellcheck disable=SC1090
. "$DATA_ENV"

say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# เครือข่ายที่ทั้งชั้นข้อมูลและสองสีใช้ร่วมกัน — ต้องมีก่อนยกสแตกเสมอ
# ถ้า colima ถูกสร้างใหม่ เครือข่ายจะหายไปด้วย แล้ว bootstrap จะล้มด้วยคำว่า
# "network formula-data not found" ซึ่งไม่ได้บอกเลยว่าต้องไปสร้างเอง
if ! docker network inspect formula-data >/dev/null 2>&1; then
  say "สร้างเครือข่าย formula-data"
  docker network create formula-data >/dev/null
fi

psql_run() {
  docker exec -i -e PGPASSWORD="$FORMULA_PG_SUPER_PASSWORD" "$CONTAINER" \
    psql -v ON_ERROR_STOP=1 -q -U postgres -d "$DB" "$@"
}

say "1/3 บทบาท"
psql_run -v "authpw=$FORMULA_PG_AUTHENTICATOR_PASSWORD" < "$REPO_DIR/runtime/data-roles.sql"

say "2/3 โครงตาราง (docs/upstream-schema.sql ทั้งไฟล์)"
psql_run < "$REPO_DIR/docs/upstream-schema.sql"

say "3/3 สิทธิ์"
psql_run < "$REPO_DIR/runtime/data-grants.sql"

say "จำนวนแถวตอนนี้"
psql_run -tAq -c "
  select 'fs_records' t, count(*) c from fs_records
  union all select 'fs_chats', count(*) from fs_chats
  union all select 'fs_messages', count(*) from fs_messages
  union all select 'fs_approvals', count(*) from fs_approvals
  union all select 'fs_users', count(*) from fs_users
  union all select 'fs_activities', count(*) from fs_activities
  union all select 'fs_meta', count(*) from fs_meta
  order by 1"
