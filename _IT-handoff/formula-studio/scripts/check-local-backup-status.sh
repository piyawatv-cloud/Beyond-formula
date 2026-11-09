#!/bin/sh
# ตรวจชุดสำรองในโฟลเดอร์แยกบน iMac แบบอ่านอย่างเดียว
# checksum ตรงอย่างเดียวไม่พอ: ต้องมี manifest และไฟล์ครบจากชุดที่กู้คืนผ่านแล้ว
set -eu

LOG="${1:?ต้องระบุพาธของ backup.log}"
. "$(cd "$(dirname "$0")" && pwd)/local-backup-dest.sh"
MAX_LAG_HOURS="${FORMULA_LOCAL_BACKUP_MAX_LAG_HOURS:-${FORMULA_OFFSITE_MAX_LAG_HOURS:-6}}"
NOW="${FORMULA_BACKUP_CHECK_NOW:-$(date +%s)}"

LAST="$(grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z daily-backup status=ok ' "$LOG" 2>/dev/null | tail -1 || true)"
if [ -z "$LAST" ]; then
  echo "local-backup=unknown why=ไม่มีบรรทัด daily-backup status=ok ใน $LOG ไม่รู้ว่าต้องตรวจชุดไหน"
  exit 1
fi

AT="${LAST%% *}"
SOURCE_DIR="${LAST#* dest=}"; SOURCE_DIR="${SOURCE_DIR%% *}"
STAMP="$(basename "$SOURCE_DIR")"
AT_EPOCH="$(date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$AT" +%s 2>/dev/null \
  || date -u -d "$AT" +%s 2>/dev/null || true)"
case "$AT_EPOCH" in ''|*[!0-9]*)
  echo "local-backup=unknown at=$AT why=อ่านเวลาของชุดสำรองล่าสุดไม่ออก"; exit 1 ;;
esac
AGE_H=$(( (NOW - AT_EPOCH) / 3600 ))

DEST_DIR="$LOCAL_BACKUP_DEST_ROOT/$STAMP"
SOURCE_MANIFEST="$SOURCE_DIR/SHA256SUMS"
MANIFEST="$DEST_DIR/SHA256SUMS"
valid_name() {
  case "$1" in
    ''|/*|../*|*/../*|*/..|*'//'*) return 1 ;;
    *) return 0 ;;
  esac
}

STATE=ok
WHY=
N=0
if [ ! -d "$LOCAL_BACKUP_DEST_ROOT" ]; then
  STATE=missing; WHY="ยังไม่มีโฟลเดอร์สำรองใน iMac:$LOCAL_BACKUP_DEST_ROOT"
elif [ ! -f "$SOURCE_MANIFEST" ]; then
  STATE=unknown; WHY="ไม่พบ SHA256SUMS ของชุดต้นทาง:$SOURCE_DIR"
elif ! ( cd "$SOURCE_DIR" && shasum -a 256 -c SHA256SUMS >/dev/null 2>&1 ); then
  STATE=invalid; WHY="SHA256SUMS ของชุดต้นทางไม่ตรง"
elif [ ! -f "$MANIFEST" ]; then
  STATE=missing; WHY="ไม่มี SHA256SUMS ในสำเนา:$DEST_DIR"
elif ! cmp -s "$SOURCE_MANIFEST" "$MANIFEST"; then
  STATE=invalid; WHY="SHA256SUMS ของสำเนาไม่ตรงกับชุดต้นทาง"
else
  while IFS= read -r LINE || [ -n "$LINE" ]; do
    NAME="${LINE#* }"; NAME="${NAME#[ *]}"
    [ -n "$NAME" ] || continue
    N=$((N + 1))
    if ! valid_name "$NAME"; then
      STATE=invalid; WHY="SHA256SUMS มีพาธไม่ปลอดภัย:$NAME"; break
    fi
    if [ ! -f "$DEST_DIR/$NAME" ]; then
      STATE=missing; WHY="ไม่มีไฟล์ตาม SHA256SUMS:$NAME"; break
    fi
  done < "$SOURCE_MANIFEST"
  if [ "$STATE" = ok ] && [ "$N" -eq 0 ]; then
    STATE=invalid; WHY="SHA256SUMS ว่าง จึงยืนยันสำเนาไม่ได้"
  elif [ "$STATE" = ok ] && ! ( cd "$DEST_DIR" && shasum -a 256 -c "$SOURCE_MANIFEST" >/dev/null 2>&1 ); then
    STATE=corrupt; WHY="checksum ของสำเนาใน iMac ไม่ตรง"
  fi
fi

if [ "$STATE" = ok ]; then
  echo "local-backup=ok at=$AT stamp=$STAMP อายุ=${AGE_H}ชม. ที่เก็บ=iMac checksum=ok files=$N"
  exit 0
fi
if [ "$STATE" = missing ] && [ "$AGE_H" -lt "$MAX_LAG_HOURS" ]; then
  echo "local-backup=missing at=$AT stamp=$STAMP อายุ=${AGE_H}ชม. ยังอยู่ในช่วงรอ ${MAX_LAG_HOURS} ชม."
  exit 0
fi
echo "local-backup=$STATE at=$AT stamp=$STAMP อายุ=${AGE_H}ชม. why=$WHY ชุดกู้คืนสำเนาใน iMac ยังยืนยันไม่ได้"
exit 1
