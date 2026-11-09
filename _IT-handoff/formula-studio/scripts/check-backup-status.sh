#!/bin/sh
# งานสำรองคืนล่าสุด "พิสูจน์กู้คืนผ่าน" จริงไหม — อ่านบรรทัด daily-backup status= ล่าสุด
#
# ทำไมต้องมี: ด่านเดิมดูแค่อายุโฟลเดอร์สำรองล่าสุด แต่ daily-backup-formula.sh สร้างโฟลเดอร์
# ก่อนพิสูจน์กู้คืนเสมอ คืนที่กู้คืนไม่ผ่านจึงยังได้โฟลเดอร์ใหม่ และด่านเดิมขึ้น ok
# *หลักฐาน: 25 ส.ค. – 26 ก.ย. 2569 กู้คืนไม่ผ่าน 13 จาก 36 คืน ไม่มีใครได้เตือนเลยสักคืน
#  (กฎ 5.3 — การเฝ้าระวังที่รายงานความล้มเหลวของตัวเองไม่ได้ ไม่ใช่การเฝ้าระวัง)*
#
# ok ได้ทางเดียว: บรรทัดล่าสุดเป็น status=ok และอายุไม่เกินเกณฑ์
# อย่างอื่นทั้งหมด (fail / ไม่มีไฟล์ / ไม่มีบรรทัด / เก่าเกิน / อ่านเวลาไม่ออก) ไม่ใช่ ok
# เพราะ "เงียบ" หน้าตาเหมือน "ปกติ" ทุกประการ
#
# อ่านอย่างเดียว ไม่เขียนอะไรลง backup.log — ไฟล์นั้นคือบันทึก ไม่ใช่ที่ทดลอง
#
# ใช้: sh scripts/check-backup-status.sh <พาธ backup.log>
# พิมพ์หนึ่งบรรทัด · ออก 0 = ok · 1 = ต้องดู (บรรทัดมี why= เสมอ)
set -eu

LOG="${1:?ต้องระบุพาธของ backup.log}"
MAX_AGE_HOURS="${FORMULA_BACKUP_MAX_AGE_HOURS:-30}"
NOW="${FORMULA_BACKUP_CHECK_NOW:-$(date +%s)}"

if [ ! -f "$LOG" ]; then
  echo "backup-proof=none why=ไม่พบ $LOG งานสำรองประจำวันอาจไม่เคยรันเลย"
  exit 1
fi

# จับเฉพาะบรรทัดของงานประจำวันเอง — ผลของ verify-restore ถูกต่อท้ายไฟล์เดียวกัน
# และบรรทัด "daily-backup warn=" ไม่ใช่บรรทัดสถานะ
PATTERN='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z daily-backup status='
LAST="$(grep -E "$PATTERN" "$LOG" | tail -1 || true)"
if [ -z "$LAST" ]; then
  echo "backup-proof=none why=ไม่มีบรรทัด daily-backup status= ใน $LOG เลย"
  exit 1
fi

# นับคืนที่ล้มติดกันจนถึงบรรทัดล่าสุด — ล้มคืนเดียวกับล้มสัปดาห์หนึ่งไม่เท่ากัน
STREAK="$(grep -E "$PATTERN" "$LOG" | awk '{ if ($0 ~ / daily-backup status=fail/) n++; else n = 0 } END { print n + 0 }')"

AT="${LAST%% *}"
REST="${LAST#* daily-backup status=}"
STATUS="${REST%% *}"

AT_EPOCH="$(date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$AT" +%s 2>/dev/null \
  || date -u -d "$AT" +%s 2>/dev/null || true)"
case "$AT_EPOCH" in
  ''|*[!0-9]*)
    echo "backup-proof=unknown at=$AT why=อ่านเวลาของบรรทัดสถานะล่าสุดไม่ออก"
    exit 1 ;;
esac
AGE_H=$(( (NOW - AT_EPOCH) / 3600 ))

case "$STATUS" in
  ok)
    if [ "$AGE_H" -le "$MAX_AGE_HOURS" ]; then
      echo "backup-proof=ok at=$AT อายุ=${AGE_H}ชม. กู้คืนผ่าน"
      exit 0
    fi
    echo "backup-proof=stale at=$AT อายุ=${AGE_H}ชม. why=ไม่มีผลงานสำรองใหม่เกิน ${MAX_AGE_HOURS} ชม. งานประจำวันไม่ได้รันหรือตายก่อนจดผล"
    exit 1 ;;
  fail)
    case "$REST" in
      *why=*) WHY="${REST#*why=}"; WHY="${WHY%% dest=*}" ;;
      *) WHY="(บรรทัดไม่มีเหตุผลกำกับ)" ;;
    esac
    echo "backup-proof=fail at=$AT ล้มติดกัน=${STREAK}คืน why=งานสำรองคืนล่าสุดล้ม: $WHY — ชุดนี้ไม่นับเป็นจุดกู้คืน"
    exit 1 ;;
  *)
    echo "backup-proof=unknown at=$AT status=$STATUS why=สถานะที่ไม่รู้จัก"
    exit 1 ;;
esac
