#!/bin/sh
# ย้ายข้อมูลจากไฟล์สำรอง (NDJSON) เข้าฐานในเครื่อง แล้วนับแถวเทียบทันที
#
# กติกา: ลงได้เฉพาะฐานที่ยังว่าง ถ้ามีข้อมูลอยู่แล้วให้หยุด ไม่ทับ
# เพราะการ "เติมทับ" ฐานที่มีของอยู่ คือวิธีที่ข้อมูลหายโดยไม่มีใครรู้ตัว
# ถ้าตั้งใจจะลงซ้ำจริง ต้องล้างฐานเองก่อนอย่างจงใจ
#
# ใช้: sh scripts/seed-local-data.sh <โฟลเดอร์สำรอง>
set -eu

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_ENV="${FORMULA_DATA_ENV_FILE:-$REPO_DIR/runtime/data.env}"
CONTAINER="${FORMULA_PG_CONTAINER:-formula-postgres}"
DB="${FORMULA_PG_DB:-formula}"
SRC="${1:-}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM

[ -n "$SRC" ] && [ -d "$SRC" ] || { echo "ใช้: sh scripts/seed-local-data.sh <โฟลเดอร์สำรอง>" >&2; exit 2; }
[ -f "$DATA_ENV" ] || { echo "ไม่พบ $DATA_ENV" >&2; exit 2; }
# shellcheck disable=SC1090
. "$DATA_ENV"

say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

psql_run() {
  docker exec -i -e PGPASSWORD="$FORMULA_PG_SUPER_PASSWORD" "$CONTAINER" \
    psql -v ON_ERROR_STOP=1 -q -U postgres -d "$DB" "$@"
}

say "ตรวจ checksum ของชุดสำรองก่อน — ไฟล์เพี้ยนแล้วไม่ต้องเสียเวลาลง"
( cd "$SRC" && shasum -a 256 -c SHA256SUMS >/dev/null ) || {
  echo "seed status=fail why=checksum ไม่ตรง" >&2; exit 3; }

EXISTING="$(psql_run -tAq -c "select coalesce(sum(c),0) from (
  select count(*) c from fs_records
  union all select count(*) from fs_chats
  union all select count(*) from fs_messages
  union all select count(*) from fs_approvals
  union all select count(*) from fs_users
  union all select count(*) from fs_activities
  union all select count(*) from fs_meta) s" | tr -d ' ')"
[ "$EXISTING" = "0" ] || {
  echo "seed status=fail why=ฐานมีข้อมูลอยู่แล้ว $EXISTING แถว — ไม่ลงทับ" >&2; exit 4; }

say "แปลง NDJSON เป็นคำสั่ง COPY"
EXPECTED="$(node "$REPO_DIR/scripts/ndjson-to-copy.mjs" "$SRC" "$WORK/data.sql")"

say "โหลดเข้าฐาน"
psql_run < "$WORK/data.sql"

ACTUAL="$(psql_run -tAq -c "
  select json_object_agg(t, c) from (
    select 'fs_records' t, count(*) c from fs_records
    union all select 'fs_chats', count(*) from fs_chats
    union all select 'fs_messages', count(*) from fs_messages
    union all select 'fs_approvals', count(*) from fs_approvals
    union all select 'fs_users', count(*) from fs_users
    union all select 'fs_activities', count(*) from fs_activities
    union all select 'fs_meta', count(*) from fs_meta
  ) s")"

EXPECTED="$EXPECTED" ACTUAL="$ACTUAL" node -e '
  const want = JSON.parse(process.env.EXPECTED);
  const got = JSON.parse(process.env.ACTUAL);
  let bad = 0;
  for (const [table, rows] of Object.entries(want)) {
    const actual = got[table] ?? 0;
    if (actual !== rows) bad += 1;
    console.log(`  ${table}: สำรอง ${rows} → ลงฐาน ${actual} (${actual === rows ? "ok" : "ไม่ตรง"})`);
  }
  if (bad) { console.error(`seed status=fail why=มี ${bad} ตารางที่จำนวนแถวไม่ตรง`); process.exit(6); }
  console.log("seed status=ok why=ทุกตารางจำนวนแถวตรงกัน");
'
