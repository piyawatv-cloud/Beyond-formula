#!/bin/sh
# ด่านตรวจของชั้นข้อมูลในเครื่อง — ถามจากฝั่งโฮสต์ เพราะ image ของ PostgREST ไม่มี shell
#
# ตรวจความหมาย ไม่ใช่แค่ "คอนเทนเนอร์ยังอยู่ไหม":
#   1) PostgreSQL รับคำสั่งได้จริง
#   2) PostgREST ยังมีชีวิต (/live) และต่อฐานได้ (/ready) — สองอย่างนี้ไม่เหมือนกัน
#      ตัวที่ live แต่ไม่ ready คือตัวที่ยังตอบ 503 ให้ทุกคนโดยที่ docker บอกว่า Up
#   3) อ่านข้อมูลจริงผ่าน PostgREST ได้ และได้ของที่มีอยู่จริง
#
# ใช้: sh scripts/healthcheck-data.sh
set -eu

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_ENV="${FORMULA_DATA_ENV_FILE:-$REPO_DIR/runtime/data.env}"
[ -f "$DATA_ENV" ] || { echo "ไม่พบ $DATA_ENV" >&2; exit 2; }
# shellcheck disable=SC1090
. "$DATA_ENV"

FAIL=0
check() {
  if [ "$2" = "$3" ]; then printf '    ผ่าน: %s\n' "$1"
  else printf '    ตก : %s (ได้ %s ต้องการ %s)\n' "$1" "$2" "$3"; FAIL=$((FAIL + 1)); fi
}

PG="$(docker exec formula-postgres pg_isready -U postgres -d formula >/dev/null 2>&1 && echo ok || echo no)"
check "PostgreSQL รับคำสั่งได้" "$PG" "ok"

LIVE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$FORMULA_POSTGREST_ADMIN_PORT/live" || echo 000)"
check "PostgREST ยังมีชีวิต (/live)" "$LIVE" "200"

READY="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$FORMULA_POSTGREST_ADMIN_PORT/ready" || echo 000)"
check "PostgREST ต่อฐานได้ (/ready)" "$READY" "200"

META="$(curl -sS --max-time 10 "$SB_ORIGIN_HOST/fs_meta?select=key&key=eq.reccounter" 2>/dev/null | grep -c reccounter || true)"
check "อ่าน fs_meta ผ่าน PostgREST ได้จริง" "$META" "1"

# ตัวนับเลขงานห้ามหาย — ถ้าแถวนี้ไม่อยู่ แปลว่าฐานผิดตัวหรือข้อมูลไม่ครบ
COUNTER="$(docker exec formula-postgres psql -tAq -U postgres -d formula \
  -c "select count(*) from fs_meta where key = 'reccounter'" 2>/dev/null | tr -d ' ' || echo 0)"
check "มีตัวนับเลขงาน (fs_meta.reccounter)" "$COUNTER" "1"

if [ "$FAIL" -gt 0 ]; then echo "healthcheck-data status=fail ตก $FAIL ข้อ" >&2; exit 1; fi
echo "healthcheck-data status=ok"
