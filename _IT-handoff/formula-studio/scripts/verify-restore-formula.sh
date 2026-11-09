#!/bin/sh
# พิสูจน์ว่าไฟล์สำรองกู้กลับมาได้จริง — ไม่ใช่แค่มีไฟล์อยู่
#
# วิธี: ยก PostgreSQL ชั่วคราวขึ้นมาหนึ่งตัว (แยกจาก OPC โดยสิ้นเชิง) สร้างตารางตาม
# โครงจริงของ Formula Studio โหลดข้อมูลจากไฟล์สำรอง แล้วนับแถวเทียบกับไฟล์ต้นทาง
# ถ้าตัวเลขไม่ตรงแม้ตารางเดียว ถือว่าไม่ผ่าน
#
# ใช้: sh scripts/verify-restore-formula.sh [โฟลเดอร์สำรอง]
#      ไม่ใส่ = ใช้ชุด manual ล่าสุด

set -eu

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="${FORMULA_STATE_DIR:-$HOME/.hermes/apps/formula-studio}"
SRC="${1:-$(cat "$ROOT/runtime-state/last-backup-manual" 2>/dev/null || true)}"
CONTAINER="formula-restore-proof"
WORK="$(mktemp -d)"

if [ -z "$SRC" ] || [ ! -d "$SRC" ]; then
  echo "verify-restore status=fail why=ไม่พบโฟลเดอร์สำรอง:$SRC" >&2
  exit 2
fi

# ลบด้วย -v เสมอ — image postgres ประกาศ VOLUME ไว้ ลบคอนเทนเนอร์เฉย ๆ จะทิ้งกล่องข้อมูล
# ไร้ชื่อไว้คืนละหนึ่งกล่อง (28 ก.ย. 2569 เจอค้าง 33 กล่อง จากสคริปต์นี้ที่รันทุกตี 3:15)
cleanup() {
  docker rm -fv "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

echo "verify-restore src=$SRC"

# 1) ตรวจ checksum ของชุดสำรองก่อน — ถ้าไฟล์เพี้ยน ไม่ต้องเสียเวลากู้
( cd "$SRC" && shasum -a 256 -c SHA256SUMS >/dev/null ) || {
  echo "verify-restore status=fail why=checksum ของชุดสำรองไม่ตรง" >&2
  exit 3
}
echo "verify-restore checksum=ok"
if [ -n "${FORMULA_VERIFY_PLAN:-}" ] || [ -n "${FORMULA_VERIFY_COMMIT:-}" ]; then
  [ -n "${FORMULA_VERIFY_PLAN:-}" ] && [ -n "${FORMULA_VERIFY_COMMIT:-}" ] || {
    echo "verify-restore status=fail why=plan/commit binding is incomplete" >&2
    exit 3
  }
  if ! node - "$SRC/backup-meta.json" "$FORMULA_VERIFY_PLAN" "$FORMULA_VERIFY_COMMIT" <<'NODE'
const fs = require('node:fs');
const [path, plan, commit] = process.argv.slice(2);
const meta = JSON.parse(fs.readFileSync(path, 'utf8'));
if (meta.approvedPlan !== plan || meta.immutableCommit !== commit) process.exit(1);
NODE
  then
    echo "verify-restore status=fail why=backup plan/commit binding does not match" >&2
    exit 3
  fi
  echo "verify-restore plan=$FORMULA_VERIFY_PLAN"
  echo "verify-restore immutable_commit=$FORMULA_VERIFY_COMMIT"
fi
if [ -d "$SRC/job-intake" ]; then
  node "$REPO_DIR/scripts/backup-job-intake.mjs" verify-only "$SRC/job-intake" || {
    echo "verify-restore status=fail why=ต้นฉบับที่รับเข้าไม่ครบหรืออ่านยืนยันไม่ได้" >&2
    exit 3
  }
fi

# 2) ยกฐานชั่วคราว — ตั้งป้ายของเราเอง ไม่แตะของ OPC ไม่ผูก volume ใด ๆ
#    --tmpfs เก็บข้อมูลไว้ในหน่วยความจำแทนกล่องไร้ชื่อ ถึงสคริปต์ถูกฆ่ากลางทางก็ไม่เหลือซาก
docker rm -fv "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" \
  --tmpfs /var/lib/postgresql/data \
  --label com.beyond.formula-runtime.managed=true \
  --label com.beyond.formula-runtime.role=restore-proof \
  -e POSTGRES_PASSWORD=proof -e POSTGRES_DB=formula_restore_proof \
  postgres:16-alpine >/dev/null

i=0
# -h 127.0.0.1: เซิร์ฟเวอร์ชั่วคราวตอนบูตครั้งแรกไม่ฟัง TCP จึงไม่ผ่านด่านนี้ก่อนเวลา
# (เดิมผ่านตอนมันกำลังปิด แล้วล้มว่า "the database system is shutting down" ~1 ใน 3 คืน)
until docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U postgres -d formula_restore_proof >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -gt 60 ] && { echo "verify-restore status=fail why=ฐานชั่วคราวไม่พร้อมใน 60 วินาที" >&2; exit 4; }
  sleep 1
done

# 3-0) บทบาทที่ฐานเปล่าไม่มี — ดัมป์พา RLS policy ที่อ้าง anon/authenticated มาด้วย
#      ถ้าไม่สร้างไว้ก่อน pg_restore จะข้าม policy พวกนั้นแล้วรายงานว่า "errors ignored"
#      ซึ่งแปลว่าฐานที่กู้ได้ ไม่เหมือนฐานต้นทาง ทั้งที่จำนวนแถวตรงกันทุกตาราง
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -q -U postgres -d formula_restore_proof <<'ROLES'
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end
$roles$;
ROLES

# 3a) ถ้าเป็นดัมป์ของ PostgreSQL (ชุดสำรองของฐานในเครื่อง) กู้ด้วย pg_restore แล้วจบที่นี่
#     ดัมป์พาโครงตารางมาเองอยู่แล้ว จึงไม่ต้องสร้างสคีมาซ้ำ และตัวเลขที่ใช้เทียบ
#     มาจาก row-counts.json ที่เขียนไว้ตอนดัมป์ ไม่ใช่จากตัวดัมป์เอง
if [ -f "$SRC/formula.dump" ]; then
  [ -f "$SRC/row-counts.json" ] || {
    echo "verify-restore status=fail why=ชุดสำรองเป็นดัมป์แต่ไม่มี row-counts.json ให้เทียบ" >&2
    exit 7
  }
  docker exec -i "$CONTAINER" pg_restore --exit-on-error --no-owner --no-privileges -U postgres \
    -d formula_restore_proof < "$SRC/formula.dump" >/dev/null
  echo "verify-restore restore=ok method=pg_dump"

  ACTUAL="$(docker exec "$CONTAINER" psql -tAq -U postgres -d formula_restore_proof -c "
    select json_object_agg(t, c) from (
      select 'fs_records' t, count(*) c from fs_records
      union all select 'fs_chats', count(*) from fs_chats
      union all select 'fs_messages', count(*) from fs_messages
      union all select 'fs_approvals', count(*) from fs_approvals
      union all select 'fs_users', count(*) from fs_users
      union all select 'fs_activities', count(*) from fs_activities
      union all select 'fs_meta', count(*) from fs_meta
    ) s")"
  EXPECTED="$(cat "$SRC/row-counts.json")"
  EXPECTED="$EXPECTED" ACTUAL="$ACTUAL" node -e '
    const want = JSON.parse(process.env.EXPECTED);
    const got = JSON.parse(process.env.ACTUAL);
    let bad = 0;
    for (const [table, rows] of Object.entries(want)) {
      const actual = got[table] ?? 0;
      if (actual !== rows) bad += 1;
      console.log(`  ${table}: ตอนสำรอง ${rows} → กู้ได้ ${actual} (${actual === rows ? "ok" : "ไม่ตรง"})`);
    }
    if (bad) { console.error(`verify-restore status=fail why=มี ${bad} ตารางที่จำนวนแถวไม่ตรง`); process.exit(6); }
    console.log("verify-restore status=ok why=ทุกตารางจำนวนแถวตรงกัน");
  '
  exit 0
fi

# 3b) ชุดสำรองแบบ NDJSON — สร้างโครงตาราง โดยตัดส่วน RLS/สิทธิ์ออก เพราะบทบาท anon ไม่มีในฐานเปล่า
sed -e '/enable row level security/d' "$REPO_DIR/docs/upstream-schema.sql" \
  | awk '/^do \$pol\$/{skip=1} skip && /^\$pol\$;/{skip=0; next} !skip' \
  | sed -e '/grant execute on function/d' > "$WORK/schema.sql"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -q -U postgres -d formula_restore_proof < "$WORK/schema.sql"
echo "verify-restore schema=ok"

# 4) โหลดข้อมูล
EXPECTED="$(node "$REPO_DIR/scripts/ndjson-to-copy.mjs" "$SRC" "$WORK/data.sql")"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -q -U postgres -d formula_restore_proof < "$WORK/data.sql"

# 5) นับแถวในฐานที่กู้แล้ว
ACTUAL="$(docker exec "$CONTAINER" psql -tAq -U postgres -d formula_restore_proof -c "
  select json_object_agg(t, c) from (
    select 'fs_records' t, count(*) c from fs_records
    union all select 'fs_chats', count(*) from fs_chats
    union all select 'fs_messages', count(*) from fs_messages
    union all select 'fs_approvals', count(*) from fs_approvals
    union all select 'fs_users', count(*) from fs_users
    union all select 'fs_activities', count(*) from fs_activities
    union all select 'fs_meta', count(*) from fs_meta
  ) s")"

# 6) เทียบ
EXPECTED="$EXPECTED" ACTUAL="$ACTUAL" node -e '
  const want = JSON.parse(process.env.EXPECTED);
  const got = JSON.parse(process.env.ACTUAL);
  let bad = 0;
  for (const [table, rows] of Object.entries(want)) {
    const actual = got[table] ?? 0;
    const mark = actual === rows ? "ok" : "ไม่ตรง";
    if (actual !== rows) bad += 1;
    console.log(`  ${table}: สำรอง ${rows} → กู้ได้ ${actual} (${mark})`);
  }
  if (bad) { console.error(`verify-restore status=fail why=มี ${bad} ตารางที่จำนวนแถวไม่ตรง`); process.exit(6); }
  console.log("verify-restore status=ok why=ทุกตารางจำนวนแถวตรงกัน");
'
