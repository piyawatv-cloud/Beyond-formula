#!/bin/sh
# ติดตั้งงานตามเวลาของ Formula Studio runtime — รันซ้ำได้ ทับของเดิมเสมอ
#
#   com.beyond.formula-monitor   เฝ้าระวัง ทุก 15 นาที (นาที 7/22/37/52)
#   com.beyond.formula-recover   กู้คืน ทุก 5 นาที (นาที 3/8/13/...)
#
# งานสำรองประจำวันติดตั้งแยกด้วย scripts/install-backup-schedule.sh (03:15)
# ทั้งสามงานไม่ตรงนาทีกัน และไม่ตรงกับงานของ OPC ที่ใช้ StartInterval
#
# plist ชี้ไปที่สคริปต์ "ในเรโป" ตรง ๆ ไม่ใช่สำเนาที่ติดตั้งไว้ที่อื่น — จงใจ
# ระบบพี่น้องเคยแก้สคริปต์ใน repo แล้วไม่มีผลอะไรเลย เพราะ launchd รันสำเนาที่ติดตั้ง
# คนละไฟล์กัน แล้วไม่มีใครรู้จนกว่าจะไปเทียบทีละบรรทัด
set -eu

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UID_NUM="$(id -u)"
LOG_DIR="$HOME/.hermes/apps/formula-studio/monitoring"

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

for LABEL in com.beyond.formula-monitor com.beyond.formula-recover; do
  SRC="$REPO_DIR/runtime/$LABEL.plist"
  DEST="$HOME/Library/LaunchAgents/$LABEL.plist"

  [ -f "$SRC" ] || { echo "ไม่มีไฟล์ $SRC"; exit 2; }

  # ตรวจว่าสคริปต์ที่ plist ชี้ไปหา มีอยู่จริงและรันได้ ก่อนติดตั้ง
  # งานตามเวลาที่ชี้ไปหาไฟล์ที่ไม่มี จะตายเงียบทุกครั้งโดยไม่มีใครเห็น
  TARGET="$(sed -n 's|.*<string>\(/Users/[^<]*\.sh\)</string>.*|\1|p' "$SRC" | head -1)"
  [ -n "$TARGET" ] && [ -f "$TARGET" ] || { echo "$LABEL ชี้ไปหา '$TARGET' ซึ่งไม่มีอยู่จริง"; exit 2; }
  sh -n "$TARGET" || { echo "$TARGET ไวยากรณ์ไม่ผ่าน — ไม่ติดตั้งของที่รันไม่ได้"; exit 2; }

  cp "$SRC" "$DEST"
  plutil -lint "$DEST" >/dev/null

  launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_NUM" "$DEST"
  launchctl enable "gui/$UID_NUM/$LABEL"
  echo "ติดตั้ง $LABEL แล้ว → $TARGET"
done

echo
echo "สั่งรันเดี๋ยวนี้เพื่อทดสอบ:"
echo "  launchctl kickstart -k gui/$UID_NUM/com.beyond.formula-monitor"
echo "  launchctl kickstart -k gui/$UID_NUM/com.beyond.formula-recover"
echo "ดูผล: tail -n 40 $LOG_DIR/monitor-\$(TZ=Asia/Bangkok date +%Y-%m-%d).log"
echo "เสียงเตือนถึงคนจริงจะถูกจดไว้ที่: $LOG_DIR/alerts.log"
