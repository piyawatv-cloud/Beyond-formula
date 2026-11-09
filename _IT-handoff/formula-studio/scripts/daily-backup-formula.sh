#!/bin/sh
# งานสำรองประจำวัน — สำรอง แล้ว "พิสูจน์ว่ากู้กลับได้" ทันทีในรอบเดียวกัน
#
# เหตุผลที่พิสูจน์ทุกรอบ ไม่ใช่เดือนละครั้ง: ไฟล์สำรองที่ไม่เคยกู้กลับ ไม่ใช่จุดกู้คืน
# เป็นแค่ไฟล์ และวันที่จะรู้ว่ามันใช้ไม่ได้ คือวันที่ต้องใช้มันจริง ๆ
# ชุดหนึ่งใหญ่ราวครึ่งเมกะไบต์ พิสูจน์รอบละไม่กี่วินาที ราคาถูกกว่าการเดา
#
# ไม่ลบไฟล์สำรองเก่าโดยอัตโนมัติ — กติกาเดียวกับ OPC โหมดสังเกตอย่างเดียว
# ถ้าพื้นที่เริ่มตึง ให้คนตัดสินใจลบเอง อย่าให้สคริปต์ตัดสินใจแทน
set -eu

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
KIND="${BACKUP_KIND:-daily}"
ROOT="${FORMULA_STATE_DIR:-$HOME/.hermes/apps/formula-studio}"
LOG="$ROOT/monitoring/backup.log"
OFFSITE_ENABLED="${FORMULA_OFFSITE_ENABLED:-1}"
BACKUP_DESTINATION="${FORMULA_BACKUP_DESTINATION:-local}"
mkdir -p "$ROOT/monitoring"

say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG"; }

# ห้ามเดาค่าที่สะกดผิดว่าเท่ากับ "ปิด" เพราะจะทำให้สำเนานอกเครื่องหายโดยไม่ตั้งใจ
case "$OFFSITE_ENABLED" in
  0|1) ;;
  *) say "daily-backup status=fail why=FORMULA_OFFSITE_ENABLED ต้องเป็น 0 หรือ 1"; exit 5 ;;
esac

# ชั้นข้อมูลต้องขึ้นอยู่ก่อน ไม่งั้นสำรองจะได้ไฟล์เปล่าแล้วรายงานว่าสำเร็จ
if ! sh "$REPO_DIR/scripts/healthcheck-data.sh" >/dev/null 2>&1; then
  say "daily-backup status=fail why=ชั้นข้อมูลไม่พร้อม (healthcheck-data ไม่ผ่าน)"
  exit 1
fi

sh "$REPO_DIR/scripts/backup-formula.sh" "$KIND" || {
  say "daily-backup status=fail why=สำรองไม่สำเร็จ"
  exit 2
}

LATEST="$(cat "$ROOT/runtime-state/last-backup-$KIND" 2>/dev/null || true)"
[ -n "$LATEST" ] && [ -d "$LATEST" ] || {
  say "daily-backup status=fail why=ไม่พบชุดสำรองล่าสุดที่จะพิสูจน์"
  exit 3
}

if sh "$REPO_DIR/scripts/verify-restore-formula.sh" "$LATEST" >>"$LOG" 2>&1; then
  say "daily-backup status=ok kind=$KIND dest=$LATEST restore-proof=ok"
  case "$BACKUP_DESTINATION" in
    local)
      # เก็บสำเนาแยกจาก ~/.hermes แต่ยังอยู่บน iMac เดียวกัน จึงไม่เรียกว่า offsite
      sh "$REPO_DIR/scripts/copy-backup-local.sh" "$LATEST" >>"$LOG" 2>&1 \
        || say "daily-backup warn=เก็บสำเนาในโฟลเดอร์แยกบน iMac ไม่สำเร็จ ดู local-backup.log"
      ;;
    drive)
      case "$OFFSITE_ENABLED" in
        0) say "offsite=paused reason=พักการส่งไป Google Drive ตามแผน risk=ไม่มีจุดกู้คืนที่ยืนยันแล้วนอกเครื่อง" ;;
        1)
          sh "$REPO_DIR/scripts/copy-backup-offsite.sh" "$LATEST" >>"$LOG" 2>&1 \
            || say "daily-backup warn=ส่งสำเนาออกนอกเครื่องไม่สำเร็จ ดู offsite.log"
          ;;
        *) say "daily-backup status=fail why=FORMULA_OFFSITE_ENABLED ต้องเป็น 0 หรือ 1"; exit 5 ;;
      esac
      ;;
    *)
      say "daily-backup status=fail why=FORMULA_BACKUP_DESTINATION ต้องเป็น local หรือ drive"
      exit 5
      ;;
  esac
else
  say "daily-backup status=fail why=กู้คืนไม่ผ่าน dest=$LATEST"
  exit 4
fi
