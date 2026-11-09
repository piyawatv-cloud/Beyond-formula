#!/bin/sh
# พิสูจน์ว่า "ท่าเขียน" ที่แอปใช้จริง ยังทำงานเหมือนเดิมหลังย้ายจาก Supabase มา PostgREST
#
# ด่านอื่นทั้งหมดเป็นการอ่าน (fs_meta ผ่านโทเคนด่านตรวจ) ซึ่งพิสูจน์แค่ว่า "ต่อฐานติด"
# สิ่งที่การย้ายครั้งนี้เสี่ยงจริงคือไวยากรณ์ฝั่งเขียน — upsert ด้วย on_conflict +
# Prefer: resolution=merge-duplicates, PATCH, DELETE และการดึงเฉพาะที่เปลี่ยน (updated_at=gt.)
# ถ้าท่าใดท่าหนึ่งเพี้ยน อาการคือข้อมูลหายเงียบ ๆ ไม่ใช่ error
#
# ทำกับแถวของตัวเองในตาราง fs_meta คีย์ __writeprobe แล้วลบทิ้งเมื่อจบ
# ไม่แตะข้อมูลของแอปแม้แถวเดียว และไม่เรียก fs_next_rec_seq (เรียกแล้วเลขงานเดินหน้าถาวร)
#
# ใช้: sh scripts/verify-write-path.sh
set -eu

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_ENV="${FORMULA_DATA_ENV_FILE:-$REPO_DIR/runtime/data.env}"
[ -f "$DATA_ENV" ] || { echo "ไม่พบ $DATA_ENV" >&2; exit 2; }
# shellcheck disable=SC1090
. "$DATA_ENV"

BASE="$SB_ORIGIN_HOST"
KEY="__writeprobe"
FAIL=0
check() {
  if [ "$2" = "$3" ]; then printf '    ผ่าน: %s\n' "$1"
  else printf '    ตก : %s (ได้ %s ต้องการ %s)\n' "$1" "$2" "$3"; FAIL=$((FAIL + 1)); fi
}

cleanup() { curl -sS -o /dev/null --max-time 10 -X DELETE "$BASE/fs_meta?key=eq.$KEY" || true; }
trap cleanup EXIT INT TERM

BEFORE="$(docker exec formula-postgres psql -tAq -U postgres -d formula \
  -c "select count(*) from fs_meta where key <> '$KEY'" | tr -d ' ')"
COUNTER_BEFORE="$(docker exec formula-postgres psql -tAq -U postgres -d formula \
  -c "select value #>> '{}' from fs_meta where key = 'reccounter'" | tr -d ' ')"

cleanup
# เวลาต้องอยู่ในรูปที่ใส่ใน query string ได้ตรง ๆ — now() ให้ "…+00" ซึ่งเครื่องหมาย +
# ใน query string แปลว่าช่องว่าง ตัวกรองจะเพี้ยนโดยไม่มี error ให้เห็น จึงบังคับเป็น …Z
T0="$(docker exec formula-postgres psql -tAq -U postgres -d formula \
  -c "select to_char(now() at time zone 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')" | tr -d '[:space:]')"

# 1) upsert รอบแรก — ท่าเดียวกับที่แอปใช้บันทึกงาน/ห้องแชท/ข้อความ
S1="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -X POST \
  -H 'content-type: application/json' -H 'Prefer: resolution=merge-duplicates,return=minimal' \
  -d "[{\"key\":\"$KEY\",\"value\":1}]" "$BASE/fs_meta?on_conflict=key")"
check "upsert รอบแรก" "$S1" "201"

# 2) upsert รอบสองด้วยคีย์เดิม — ต้องทับของเดิม ไม่ใช่เพิ่มแถวใหม่และไม่ใช่ 409
S2="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -X POST \
  -H 'content-type: application/json' -H 'Prefer: resolution=merge-duplicates,return=minimal' \
  -d "[{\"key\":\"$KEY\",\"value\":2}]" "$BASE/fs_meta?on_conflict=key")"
# PostgREST ตอบ 201 เมื่อแทรกแถวใหม่ และ 200 เมื่อไปทับของเดิม — ถูกทั้งคู่
case "$S2" in 200|201) UPSERT2=ok ;; *) UPSERT2="$S2" ;; esac
check "upsert คีย์ซ้ำแล้วทับของเดิม" "$UPSERT2" "ok"
ROWS="$(docker exec formula-postgres psql -tAq -U postgres -d formula \
  -c "select count(*) from fs_meta where key = '$KEY'" | tr -d ' ')"
check "ยังมีแถวเดียว ไม่ซ้ำ" "$ROWS" "1"
VAL="$(docker exec formula-postgres psql -tAq -U postgres -d formula \
  -c "select value #>> '{}' from fs_meta where key = '$KEY'" | tr -d ' ')"
check "ค่าถูกทับเป็นรอบล่าสุด" "$VAL" "2"

# 3) ดึงเฉพาะที่เปลี่ยน — ท่าที่แอปใช้ซิงก์ ถ้าเพี้ยนคือซิงก์ไม่เห็นของใหม่
DELTA="$(curl -sS --max-time 15 "$BASE/fs_meta?select=key&updated_at=gt.$T0" | grep -c "$KEY" || true)"
check "ดึงเฉพาะที่เปลี่ยน (updated_at=gt.) เห็นแถวใหม่" "$DELTA" "1"

# 4) PATCH
S3="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -X PATCH \
  -H 'content-type: application/json' -d '{"value":3}' "$BASE/fs_meta?key=eq.$KEY")"
check "PATCH" "$S3" "204"
VAL2="$(docker exec formula-postgres psql -tAq -U postgres -d formula \
  -c "select value #>> '{}' from fs_meta where key = '$KEY'" | tr -d ' ')"
check "ค่าหลัง PATCH" "$VAL2" "3"

# 5) DELETE
S4="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -X DELETE "$BASE/fs_meta?key=eq.$KEY")"
check "DELETE" "$S4" "204"
GONE="$(docker exec formula-postgres psql -tAq -U postgres -d formula \
  -c "select count(*) from fs_meta where key = '$KEY'" | tr -d ' ')"
check "แถวหายไปจริง" "$GONE" "0"

# 5b) เส้นทาง /rpc/ ของ PostgREST — ทดสอบด้วยฟังก์ชันของตัวเองแล้วลบทิ้ง
#
# ตัวจริงที่แอปเรียกคือ fs_next_rec_seq ซึ่ง "เรียกแล้วเลขงานเดินหน้าถาวร"
# จึงเรียกไม่ได้ในด่านที่ต้องรันซ้ำได้ทุกวัน สิ่งที่ยังไม่รู้จริง ๆ มีอย่างเดียวคือ
# PostgREST ยอมให้ POST /rpc/<ชื่อ> ผ่านและ anon สั่งได้ไหม — ฟังก์ชันเปล่าตอบข้อนั้นได้ครบ
# ส่วนสิทธิ์ของตัวจริงตรวจแยกด้วย has_function_privilege ด้านล่าง
docker exec -i formula-postgres psql -v ON_ERROR_STOP=1 -q -U postgres -d formula <<'PROBEFN'
create or replace function fs_rpc_probe() returns bigint language sql as $fn$ select 1::bigint $fn$;
grant execute on function fs_rpc_probe() to anon, authenticated;
PROBEFN
# PostgREST จำรายการฟังก์ชันไว้ ต้องบอกให้อ่านสคีมาใหม่ ไม่งั้นจะตอบ 404 ทั้งที่ฟังก์ชันมีอยู่
docker exec formula-postgres psql -q -U postgres -d formula -c "notify pgrst, 'reload schema'" >/dev/null
# การอ่านสคีมาใหม่เป็นงานเบื้องหลัง ยิงทันทีจะได้ PGRST202 "ไม่พบฟังก์ชัน" ทั้งที่มันมีอยู่
RPC=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  RPC="$(curl -sS --max-time 15 -X POST -H 'content-type: application/json' -d '{}' \
    "$BASE/rpc/fs_rpc_probe" 2>/dev/null | tr -d '[:space:]')"
  [ "$RPC" = "1" ] && break
  sleep 1
done
check "เส้นทาง /rpc/ ของ PostgREST เรียกได้" "$RPC" "1"
docker exec formula-postgres psql -q -U postgres -d formula -c "drop function if exists fs_rpc_probe()" >/dev/null
docker exec formula-postgres psql -q -U postgres -d formula -c "notify pgrst, 'reload schema'" >/dev/null

GRANT="$(docker exec formula-postgres psql -tAq -U postgres -d formula \
  -c "select has_function_privilege('anon','fs_next_rec_seq()','execute')" | tr -d '[:space:]')"
check "anon สั่ง fs_next_rec_seq ได้ (ไม่ได้เรียกจริง เรียกแล้วเลขงานเดินถาวร)" "$GRANT" "t"

# ตัวนับเลขงานต้องไม่ตามหลังรหัสงานที่มีอยู่แล้ว
# ถ้าตามหลัง งานใบถัดไปจะได้รหัสที่มีคนใช้อยู่ แล้ว upsert จะทับงานเก่าทิ้ง
AHEAD="$(docker exec formula-postgres psql -tAq -U postgres -d formula -c "
  select ((select (value #>> '{}')::bigint from fs_meta where key = 'reccounter')
       >= coalesce((select max(substring(id from 2)::bigint) from fs_records
                     where id ~ '^[A-Z][0-9]{5}\$'), 0))" | tr -d '[:space:]')"
check "ตัวนับเลขงานไม่ตามหลังรหัสงานที่มีอยู่" "$AHEAD" "t"

# 6) ของเดิมต้องไม่ถูกแตะ — โดยเฉพาะตัวนับเลขงานที่ห้ามขยับ
AFTER="$(docker exec formula-postgres psql -tAq -U postgres -d formula \
  -c "select count(*) from fs_meta where key <> '$KEY'" | tr -d ' ')"
check "จำนวนแถวอื่นใน fs_meta ไม่เปลี่ยน" "$AFTER" "$BEFORE"
COUNTER_AFTER="$(docker exec formula-postgres psql -tAq -U postgres -d formula \
  -c "select value #>> '{}' from fs_meta where key = 'reccounter'" | tr -d ' ')"
check "ตัวนับเลขงานไม่ขยับ" "$COUNTER_AFTER" "$COUNTER_BEFORE"

if [ "$FAIL" -gt 0 ]; then echo "verify-write-path status=fail ตก $FAIL ข้อ" >&2; exit 1; fi
echo "verify-write-path status=ok"
