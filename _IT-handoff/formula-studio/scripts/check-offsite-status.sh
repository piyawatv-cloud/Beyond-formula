#!/bin/sh
# ชุดสำรองล่าสุดที่พิสูจน์กู้คืนผ่านแล้ว ขึ้นคลาวด์จริงหรือยัง — ดูที่ไฟล์บน Drive เอง ไม่ใช่ดู log
#
# ทำไมไม่เชื่อ offsite.log: 25 ส.ค. – 28 ก.ย. 2569 log ขึ้น "offsite status=ok checksum=ok"
# ทุกคืน ทั้งที่ Drive ไม่เคยรู้จักไฟล์เลยสักไฟล์ — checksum ตรวจได้แค่ว่าเขียนลงดิสก์ในเครื่องแล้ว
# ตัวตรวจนี้จึงดูป้าย item-id ที่ Drive for desktop ติดให้ไฟล์ที่มันรู้จักแล้วเท่านั้น
#
# ok ได้เมื่อทุกไฟล์ตาม SHA256SUMS ของชุดล่าสุดตรวจ checksum และมีป้าย Drive ครบ
# ยังไม่ครบแต่ชุดยังใหม่กว่าเกณฑ์ = รอได้ (ok) · เกินเกณฑ์ / ไม่มีโฟลเดอร์ /
# Drive ไม่ได้ mount / หาชุดล่าสุดไม่เจอ = ไม่ ok พร้อม why=
# อ่านอย่างเดียว
#
# ใช้: sh scripts/check-offsite-status.sh <พาธ backup.log>
# พิมพ์หนึ่งบรรทัด · ออก 0 = ok · 1 = ต้องดู
set -eu

LOG="${1:?ต้องระบุพาธของ backup.log}"
. "$(cd "$(dirname "$0")" && pwd)/offsite-dest.sh"
MAX_LAG_HOURS="${FORMULA_OFFSITE_MAX_LAG_HOURS:-6}"
NOW="${FORMULA_BACKUP_CHECK_NOW:-$(date +%s)}"
OFFSITE_ENABLED="${FORMULA_OFFSITE_ENABLED:-1}"

# การพักเป็นคำสั่งผู้ดูแล ไม่ใช่ Drive healthy: ห้ามอ่าน mount หรืออ้าง offsite=ok
case "$OFFSITE_ENABLED" in
  0)
    echo "offsite=paused reason=พักการส่งไป Google Drive ตามแผน risk=ไม่มีจุดกู้คืนที่ยืนยันแล้วนอกเครื่อง"
    exit 0
    ;;
  1) ;;
  *)
    echo "offsite=unknown why=FORMULA_OFFSITE_ENABLED ต้องเป็น 0 หรือ 1"
    exit 1
    ;;
esac

# ชุดล่าสุดที่ "พิสูจน์กู้คืนผ่าน" — ชุดที่ไม่ผ่านไม่ถูกส่งออกอยู่แล้ว ไม่ใช่เรื่องของตัวนี้
LAST="$(grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z daily-backup status=ok ' "$LOG" 2>/dev/null | tail -1 || true)"
if [ -z "$LAST" ]; then
  echo "offsite=unknown why=ไม่มีบรรทัด daily-backup status=ok ใน $LOG ไม่รู้ว่าต้องหาชุดไหนบน Drive"
  exit 1
fi
AT="${LAST%% *}"
SOURCE_DIR="${LAST#* dest=}"; SOURCE_DIR="${SOURCE_DIR%% *}"
STAMP="$(basename "$SOURCE_DIR")"

AT_EPOCH="$(date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$AT" +%s 2>/dev/null \
  || date -u -d "$AT" +%s 2>/dev/null || true)"
case "$AT_EPOCH" in ''|*[!0-9]*)
  echo "offsite=unknown at=$AT why=อ่านเวลาของบรรทัดสำรองล่าสุดไม่ออก"; exit 1 ;;
esac
AGE_H=$(( (NOW - AT_EPOCH) / 3600 ))

if [ ! -d "$OFFSITE_DRIVE_ROOT" ]; then
  echo "offsite=unmounted stamp=$STAMP อายุ=${AGE_H}ชม. why=ไม่เห็นโฟลเดอร์ Drive ($OFFSITE_DRIVE_ROOT) — Drive for desktop ไม่ได้ mount หรือไม่มีสิทธิ์อ่าน"
  exit 1
fi

DEST_DIR="$OFFSITE_DEST_ROOT/$STAMP"
MANIFEST="$DEST_DIR/SHA256SUMS"
SOURCE_MANIFEST="$SOURCE_DIR/SHA256SUMS"
valid_name() {
  case "$1" in
    ''|/*|../*|*/../*|*/..|*'//'*) return 1 ;;
    *) return 0 ;;
  esac
}

STATE=ok
WHAT=""
if [ ! -f "$SOURCE_MANIFEST" ]; then
  STATE=unknown; WHAT="ไม่พบ SHA256SUMS ของชุดที่พิสูจน์กู้คืนแล้วในเครื่อง:$SOURCE_DIR"
elif ! ( cd "$SOURCE_DIR" && shasum -a 256 -c SHA256SUMS >/dev/null 2>&1 ); then
  STATE=invalid; WHAT="SHA256SUMS ของชุดที่พิสูจน์กู้คืนแล้วในเครื่องไม่ตรง"
elif [ ! -f "$MANIFEST" ]; then
  STATE=missing; WHAT="ไม่มี SHA256SUMS ใน $DEST_DIR — สำเนานอกเครื่องไม่ครบ"
elif ! cmp -s "$SOURCE_MANIFEST" "$MANIFEST"; then
  STATE=invalid; WHAT="SHA256SUMS บน Drive ไม่ตรงกับชุดที่พิสูจน์กู้คืนแล้วในเครื่อง"
else
  N=0
  MISSING=""
  PENDING=""
  MISSING_N=0
  PENDING_N=0
  while IFS= read -r LINE || [ -n "$LINE" ]; do
    NAME="${LINE#* }"; NAME="${NAME#[ *]}"
    [ -n "$NAME" ] || continue
    N=$((N + 1))
    if ! valid_name "$NAME"; then
      STATE=invalid; WHAT="SHA256SUMS มีพาธไม่ปลอดภัย:$NAME"; break
    fi
    if [ ! -f "$DEST_DIR/$NAME" ]; then
      MISSING_N=$((MISSING_N + 1))
      [ "$MISSING_N" -le 3 ] && MISSING="$MISSING $NAME"
    elif ! xattr -p "$OFFSITE_ID_XATTR" "$DEST_DIR/$NAME" >/dev/null 2>&1; then
      PENDING_N=$((PENDING_N + 1))
      [ "$PENDING_N" -le 3 ] && PENDING="$PENDING $NAME"
    fi
  done < "$SOURCE_MANIFEST"
  if [ "$STATE" = ok ] && [ "$N" -eq 0 ]; then
    STATE=invalid; WHAT="SHA256SUMS ว่าง จึงยืนยันสำเนานอกเครื่องไม่ได้"
  elif [ "$STATE" = ok ] && [ "$MISSING_N" -gt 0 ]; then
    STATE=missing; WHAT="ไม่มีไฟล์ตาม SHA256SUMS ${MISSING_N} ไฟล์:$MISSING"
  elif [ "$STATE" = ok ] && [ "$PENDING_N" -gt 0 ]; then
    STATE=pending; WHAT="มีไฟล์บนดิสก์แต่ Drive ยังไม่รับ (ไม่มีป้าย item-id) ${PENDING_N} ไฟล์:$PENDING"
  elif [ "$STATE" = ok ] && ! xattr -p "$OFFSITE_ID_XATTR" "$MANIFEST" >/dev/null 2>&1; then
    STATE=pending; WHAT="มีไฟล์บนดิสก์แต่ Drive ยังไม่รับ (ไม่มีป้าย item-id):SHA256SUMS"
  elif [ "$STATE" = ok ] && ! ( cd "$DEST_DIR" && shasum -a 256 -c "$SOURCE_MANIFEST" >/dev/null 2>&1 ); then
    STATE=corrupt; WHAT="checksum ของสำเนาบน Drive ไม่ตรง"
  fi
fi

if [ "$STATE" = ok ]; then
  echo "offsite=ok stamp=$STAMP อายุ=${AGE_H}ชม. ขึ้นคลาวด์แล้ว checksum=ok files=$N"
  exit 0
fi

case "$STATE" in pending|missing) WAITABLE=1 ;; *) WAITABLE=0 ;; esac
if [ "$WAITABLE" = 1 ] && [ "$AGE_H" -lt "$MAX_LAG_HOURS" ]; then
  echo "offsite=$STATE stamp=$STAMP อายุ=${AGE_H}ชม. ยังอยู่ในช่วงรอ ${MAX_LAG_HOURS} ชม."
  exit 0
fi
if [ "$WAITABLE" = 1 ]; then
  TAIL="เกิน ${MAX_LAG_HOURS} ชม. — สำเนานอกเครื่องไม่ครบ ชุดกู้คืนเต็มยังอยู่ในเครื่อง"
else
  TAIL="สถานะความถูกต้องผิดปกติ ต้องตรวจทันที — สำเนานอกเครื่องยังยืนยันเป็นชุดกู้คืนเต็มไม่ได้"
fi
echo "offsite=$STATE stamp=$STAMP อายุ=${AGE_H}ชม. why=$WHAT $TAIL"
exit 1
