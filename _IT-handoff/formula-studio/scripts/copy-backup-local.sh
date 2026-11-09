#!/bin/sh
# คัดลอกชุดสำรองที่พิสูจน์กู้คืนแล้วมาเก็บในโฟลเดอร์แยกบน iMac
# ใช้ SHA256SUMS เป็นรายการไฟล์ที่ต้องคัดลอกและตรวจซ้ำหลังคัดลอกทุกครั้ง
set -eu
umask 077

SRC="${1:-}"
. "$(cd "$(dirname "$0")" && pwd)/local-backup-dest.sh"
ROOT="${FORMULA_STATE_DIR:-$HOME/.hermes/apps/formula-studio}"
LOG="$ROOT/monitoring/local-backup.log"
mkdir -p "$(dirname "$LOG")" "$LOCAL_BACKUP_DEST_ROOT"
chmod 700 "$LOCAL_BACKUP_DEST_ROOT" 2>/dev/null || true
say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG"; }

[ -n "$SRC" ] && [ -d "$SRC" ] || { say "local-backup status=fail why=ไม่พบโฟลเดอร์สำรอง:$SRC"; exit 2; }
[ -f "$SRC/SHA256SUMS" ] || { say "local-backup status=fail why=ชุดสำรองไม่มี SHA256SUMS จึงยืนยันสำเนาไม่ได้"; exit 1; }

valid_name() {
  case "$1" in
    ''|/*|../*|*/../*|*/..|*'//'*) return 1 ;;
    *) return 0 ;;
  esac
}

N=0
while IFS= read -r LINE || [ -n "$LINE" ]; do
  NAME="${LINE#* }"; NAME="${NAME#[ *]}"
  [ -n "$NAME" ] || continue
  N=$((N + 1))
  if ! valid_name "$NAME" || [ ! -f "$SRC/$NAME" ]; then
    say "local-backup status=fail why=SHA256SUMS มีพาธไม่ปลอดภัยหรือไม่มีไฟล์ต้นทาง:$NAME"
    exit 1
  fi
done < "$SRC/SHA256SUMS"
[ "$N" -gt 0 ] || { say "local-backup status=fail why=SHA256SUMS ว่าง จึงยืนยันสำเนาไม่ได้"; exit 1; }

STAMP="$(basename "$SRC")"
DEST="$LOCAL_BACKUP_DEST_ROOT/$STAMP"
mkdir -p "$DEST"
chmod 700 "$DEST" 2>/dev/null || true

while IFS= read -r LINE || [ -n "$LINE" ]; do
  NAME="${LINE#* }"; NAME="${NAME#[ *]}"
  [ -n "$NAME" ] || continue
  mkdir -p "$DEST/$(dirname "$NAME")"
  cp "$SRC/$NAME" "$DEST/$NAME"
done < "$SRC/SHA256SUMS"
cp "$SRC/SHA256SUMS" "$DEST/SHA256SUMS"

if ! ( cd "$DEST" && shasum -a 256 -c SHA256SUMS >/dev/null 2>&1 ); then
  say "local-backup status=fail why=checksum ของสำเนาใน iMac ไม่ตรง dest=$DEST"
  exit 1
fi

say "local-backup status=ok stamp=$STAMP dest=$DEST checksum=ok files=$N"
