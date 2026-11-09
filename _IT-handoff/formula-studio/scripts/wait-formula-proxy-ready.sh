#!/bin/sh
# รอ HTTP health ของ Formula proxy หลัง Docker รายงาน healthy แล้ว
# ด่านนี้รอ readiness เท่านั้น และไม่แทน verify_color ที่ตรวจความหมายครบชุด
set -eu

COLOR="${1:?ต้องระบุสี}"
PORT="${2:?ต้องระบุพอร์ต}"
ATTEMPTS="${FORMULA_PROXY_READY_ATTEMPTS:-30}"
INTERVAL="${FORMULA_PROXY_READY_INTERVAL_SECONDS:-1}"
BASE="http://127.0.0.1:$PORT"
i=0
STATUS=""

while [ "$i" -lt "$ATTEMPTS" ]; do
  HEALTH="$(curl -sS --max-time 1 "$BASE/__formula/health" 2>/dev/null || true)"
  STATUS="$(printf '%s' "$HEALTH" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')"
  if [ "$STATUS" = ok ]; then
    # Older local releases predate this field; an explicit false never passes.
    if ! printf '%s' "$HEALTH" | grep -q '"servingEligible"' \
      || printf '%s' "$HEALTH" | grep -Eq '"servingEligible"[[:space:]]*:[[:space:]]*true'; then
      exit 0
    fi
  fi
  i=$((i + 1))
  sleep "$INTERVAL"
done

printf '%s สี %s ยังไม่ตอบ HTTP health=ok ใน 60 วินาที (ล่าสุด: %s)\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$COLOR" "${STATUS:-ไม่ทราบ}" >&2
exit 1
