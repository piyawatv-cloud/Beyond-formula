#!/bin/sh
# ส่งเสียงถึงคนเมื่อผลพิสูจน์กู้คืนไม่ใช่ ok — และบอกอีกครั้งเมื่อกลับมาผ่าน
#
# รับผลจาก check-backup-status.sh (ไม่ตรวจซ้ำเอง จะได้มีความจริงที่เดียว)
# ส่งครั้งเดียวต่อหนึ่งเหตุ:
#   - fail  กุญแจคือ "fail@เวลาของบรรทัด" → คืนถัดไปที่ล้มอีกได้กุญแจใหม่ = เตือนคืนละครั้ง
#   - อื่น ๆ (stale / none / unknown) เวลาของบรรทัดไม่ขยับตลอดเหตุ ถ้าใช้กุญแจเดียวกัน
#     จะเตือนครั้งเดียวแล้วเงียบไปตลอด (งานสำรองตาย = ได้ข้อความเดียวที่ชั่วโมง 30)
#     จึงเติมวันที่ตามเวลาไทย → เตือนซ้ำวันละครั้งจนกว่าจะหาย
#
# กฎ 5.3: จดว่า "เตือนแล้ว" เฉพาะเมื่อ Telegram ยืนยันว่าส่งถึงเท่านั้น
# ส่งไม่ออก = ไม่จด → รอบถัดไป (15 นาที) ลองใหม่เอง · และเด้งบนจอ Mac เป็นทางสำรอง
# ส่งออกแล้วแต่จดไม่ได้ = ต้องบอกตรง ๆ ว่า "ส่งแล้ว" ไม่ใช่ปล่อยให้ set -e ตัดกลางคัน
# (ไม่งั้นเจ้าของได้ข้อความซ้ำทุก 15 นาที ขณะที่ log บอกว่าส่งไม่ออก)
#
# ใช้: sh scripts/alert-backup-proof.sh <exit code ของตัวตรวจ> "<บรรทัดผล>" <โฟลเดอร์ monitoring> [proof|offsite]
#   proof   (ค่าเริ่มต้น) ผลจาก check-backup-status.sh — สำรองคืนล่าสุดกู้คืนไม่ผ่าน
#   offsite ผลจาก check-offsite-status.sh — สำรองไม่ขึ้นคลาวด์ · เตือนวันละครั้งเสมอ
#   local   ผลจาก check-local-backup-status.sh — สำเนาแยกใน iMac ใช้เป็นจุดกู้คืนไม่ได้
#           (ชุดล่าสุดไม่เปลี่ยนจนกว่าจะมีคืนใหม่ที่ผ่าน ถ้าไม่มีวันที่จะเตือนครั้งเดียวแล้วเงียบ)
#   แต่ละแบบมีไฟล์สถานะของตัวเอง เตือนเรื่องหนึ่งแล้วต้องไม่ทำให้อีกเรื่องเงียบ
# พิมพ์หนึ่งบรรทัด · ออก 0 = ไม่มีอะไรต้องส่ง หรือส่งสำเร็จ · 1 = ส่งไม่ออก หรือจดสถานะไม่ได้
set -eu

RC="${1:?ต้องระบุ exit code}"
PROOF="${2:-}"
DIR="${3:?ต้องระบุโฟลเดอร์ monitoring}"
KIND="${4:-proof}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
case "$KIND" in
  proof)   P=backup-alert;  LINE_PREFIX=backup-proof; STATE="$DIR/backup-proof-alerted"
           TITLE_BAD="⚠️ Formula Studio: สำรองประจำวันใช้เป็นจุดกู้คืนไม่ได้"
           TITLE_OK="✅ Formula Studio: สำรองกลับมาพิสูจน์กู้คืนผ่านแล้ว"
           SEE="ดู ~/.hermes/apps/formula-studio/monitoring/backup.log" ;;
  offsite) P=offsite-alert; LINE_PREFIX=offsite;      STATE="$DIR/backup-offsite-alerted"
           TITLE_BAD="⚠️ Formula Studio: สำเนานอกเครื่องบน Google Drive ยังไม่ครบหรือ checksum ไม่ผ่าน — ชุดกู้คืนเต็มที่ตรวจแล้วอยู่ในเครื่อง"
           TITLE_OK="✅ Formula Studio: ชุดสำรองเต็มขึ้น Google Drive และตรวจครบแล้ว"
           SEE="ดู ~/.hermes/apps/formula-studio/monitoring/offsite.log" ;;
  local)   P=local-backup-alert; LINE_PREFIX=local-backup; STATE="$DIR/backup-local-alerted"
           TITLE_BAD="⚠️ Formula Studio: สำเนาสำรองแยกใน iMac ยังไม่ครบหรือ checksum ไม่ผ่าน"
           TITLE_OK="✅ Formula Studio: สำเนาสำรองแยกใน iMac ตรวจครบแล้ว"
           SEE="ดู ~/.hermes/apps/formula-studio/monitoring/local-backup.log" ;;
  *) echo "backup-alert=failed why=ไม่รู้จักชนิดการเตือน: $KIND"; exit 1 ;;
esac
ALERTS="$DIR/alerts.log"
STAMP="$(TZ=Asia/Bangkok date '+%Y-%m-%dT%H:%M:%S%z')"
TODAY="${FORMULA_ALERT_TODAY:-$(TZ=Asia/Bangkok date +%Y-%m-%d)}"   # ตั้งได้เฉพาะเทสต์

# ครอบวงเล็บปีกกา: ถ้าเขียน 2>/dev/null ต่อท้ายตรง ๆ เชลล์เปิดไฟล์ก่อนจะปิด stderr
# ข้อความ "Permission denied" ของเชลล์จึงหลุดเข้า log ของ monitor เป็นบรรทัดไม่มี why=
alert_line() { { printf '%s %s\n' "$STAMP" "$*" >> "$ALERTS"; } 2>/dev/null || true; }
save_state() { { printf '%s\n' "$1" > "$STATE"; } 2>/dev/null && { chmod 600 "$STATE" 2>/dev/null || true; }; }
send() { sh "$REPO_DIR/scripts/notify-telegram.sh" "$1" 2>&1; }

# ทางสำรองเมื่อ Telegram ส่งไม่ออก — ถึงแค่คนที่นั่งหน้าเครื่อง แต่ดีกว่าเงียบ
# (ทางเดียวกับ recover-formula.sh) · ข้ามได้ด้วย FORMULA_ALERT_NO_DESKTOP=1 สำหรับเทสต์
# เด้งไม่เกินชั่วโมงละครั้ง — ส่ง Telegram ไม่ออกทั้งคืน ไม่ควรมีเสียง Basso ทุก 15 นาที
DESKTOP_AT="$DIR/backup-proof-desktop-at"
desktop() {
  [ "${FORMULA_ALERT_NO_DESKTOP:-0}" = 1 ] && return 1
  [ -x /usr/bin/osascript ] || return 1
  LAST="$(head -1 "$DESKTOP_AT" 2>/dev/null || echo 0)"
  case "$LAST" in ''|*[!0-9]*) LAST=0 ;; esac
  [ $(( $(date +%s) - LAST )) -ge 3600 ] || return 2
  M="$(printf '%s' "$1" | tr '\n\r' '  ' | sed 's/\\/\\\\/g; s/"/\\"/g')"
  /usr/bin/osascript -e "display notification \"$M\" with title \"Formula Studio: สำรองมีปัญหา (Telegram ส่งไม่ออก)\" sound name \"Basso\"" >/dev/null 2>&1 \
    && { { date +%s > "$DESKTOP_AT"; } 2>/dev/null || true; }
}

PREV="$(head -1 "$STATE" 2>/dev/null || true)"

if [ "$RC" = 0 ]; then
  [ -n "$PREV" ] || { echo "$P=idle"; exit 0; }
  # ตัวตรวจสำเนานอกเครื่องออก 0 ได้สองแบบ: ขึ้นคลาวด์แล้ว (offsite=ok) กับ "ยังรอได้"
  # (ชุดใหม่ที่ยังไม่มีป้ายแต่อยู่ในช่วงรอ) — แบบหลังยังไม่ใช่การหาย ห้ามส่ง ✅ แล้วล้างสถานะ
  # ไม่งั้นเจ้าของได้ "ขึ้น Drive แล้ว" ทั้งที่ไฟล์ยังอยู่แค่ในเครื่อง แล้วอีก 6 ชม. ก็เตือนใหม่
  case "$KIND:$PROOF" in
    offsite:offsite=ok*|local:local-backup=ok*) ;;
    offsite:*|local:*) echo "$P=holding prev=$PREV"; exit 0 ;;
  esac
  if OUT="$(send "$TITLE_OK
$PROOF
(เหตุก่อนหน้า: $PREV)")"; then
    if save_state ""; then
      alert_line "$P=recovered prev=$PREV $OUT"
      echo "$P=recovered-sent prev=$PREV"
      exit 0
    fi
    alert_line "$P=recovered-sent-state-unwritable prev=$PREV"
    echo "$P=recovered-sent-state-unwritable prev=$PREV why=ส่งข้อความกลับมาผ่านแล้ว แต่ล้างไฟล์ $STATE ไม่ได้ รอบหน้าจะส่งซ้ำ"
    exit 1
  fi
  alert_line "$P=recovery-notification-failed prev=$PREV $OUT"
  echo "$P=recovery-notification-failed $OUT"
  exit 1
fi

# อ่านเฉพาะช่องแรกหลังชื่อสถานะ — ตัวตรวจพิมพ์ at= ต่อจากสถานะเสมอ
# ห้ามใช้ .* ข้างหน้า ไม่งั้นถ้าข้อความ why= วันหนึ่งมีคำว่า " at=" กุญแจจะค้างที่ค่านั้นตลอดไป
STATUS="$(printf '%s' "$PROOF" | sed -n "s/^$LINE_PREFIX=\([a-z-]*\).*/\1/p")"
# proof ใช้ at= · offsite ใช้ stamp= (ชุดไหนไม่ขึ้น) — sed ของ macOS ไม่รับ \| จึงแยกเป็นสองรอบ
AT="$(printf '%s' "$PROOF" | sed -n "s/^$LINE_PREFIX=[a-z-]* at=\([^ ]*\).*/\1/p")"
[ -n "$AT" ] || AT="$(printf '%s' "$PROOF" | sed -n "s/^$LINE_PREFIX=[a-z-]* stamp=\([^ ]*\).*/\1/p")"
STATUS="${STATUS:-unknown}"
# fail ที่ค้างเกินเกณฑ์ = งานสำรองล้มแล้วไม่ได้รันอีกเลย (docker/colima ล่ม) เวลาของบรรทัด
# จะไม่ขยับ → ต้องเติมวันที่เหมือน stale ไม่งั้นเตือนครั้งเดียวแล้วเงียบไปตลอด
MAX_AGE_HOURS="${FORMULA_BACKUP_MAX_AGE_HOURS:-30}"
AT_EPOCH="$(date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$AT" +%s 2>/dev/null || date -u -d "$AT" +%s 2>/dev/null || echo 0)"
NOW="${FORMULA_BACKUP_CHECK_NOW:-$(date +%s)}"
if [ "$KIND" = proof ] && [ "$STATUS" = fail ] && [ -n "$AT" ] && [ $(( (NOW - AT_EPOCH) / 3600 )) -le "$MAX_AGE_HOURS" ]; then
  KEY="fail@$AT"
else
  KEY="$STATUS@${AT:-none}@$TODAY"
fi

if [ "$KEY" = "$PREV" ]; then
  echo "$P=already-sent key=$KEY"
  exit 0
fi

TEXT="$TITLE_BAD
${PROOF:-$LINE_PREFIX=unknown why=ตัวตรวจไม่พิมพ์อะไรออกมา}
$SEE"

if OUT="$(send "$TEXT")"; then
  if save_state "$KEY"; then
    alert_line "$P=sent key=$KEY $OUT"
    echo "$P=sent key=$KEY"
    exit 0
  fi
  alert_line "$P=sent-state-unwritable key=$KEY"
  echo "$P=sent-state-unwritable key=$KEY why=ส่ง Telegram แล้ว แต่จดลง $STATE ไม่ได้ รอบหน้าจะส่งซ้ำ"
  exit 1
fi
# ห้ามจดกุญแจ — รอบหน้าต้องลองส่งใหม่
DRC=0; desktop "$PROOF" || DRC=$?
case "$DRC" in 0) FALLBACK="desktop=sent" ;; 2) FALLBACK="desktop=skipped-hourly" ;; *) FALLBACK="desktop=failed" ;; esac
alert_line "$P=notification-failed key=$KEY $FALLBACK $OUT"
echo "$P=notification-failed key=$KEY $FALLBACK $OUT"
exit 1
