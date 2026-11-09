#!/bin/sh
# ติดตั้งงานสำรองประจำวันเป็น LaunchAgent — รันซ้ำได้ ทับของเดิมเสมอ
#
# ตั้งเวลา 03:15 โดยตั้งใจให้ห่างจากงานสำรองของ OPC (02:30)
# ทั้งสองงานเรียก docker และ pg_dump ถ้าชนกันจะไปแย่ง I/O ของเครื่องเดียวกัน
set -eu

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.beyond.formula-backup"
SRC="$REPO_DIR/runtime/$LABEL.plist"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.hermes/apps/formula-studio/monitoring"
cp "$SRC" "$DEST"
plutil -lint "$DEST" >/dev/null

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DEST"
launchctl enable "gui/$(id -u)/$LABEL"

echo "ติดตั้ง $LABEL แล้ว — สำรองทุกวัน 03:15 พร้อมพิสูจน์การกู้คืนในรอบเดียวกัน"
echo "สั่งรันเดี๋ยวนี้เพื่อทดสอบ: launchctl kickstart -k gui/$(id -u)/$LABEL"
echo "ดูผล: tail -n 40 $HOME/.hermes/apps/formula-studio/monitoring/backup.log"
