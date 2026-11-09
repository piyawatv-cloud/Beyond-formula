#!/bin/sh
# ให้ Hermes รายงานสถานะ Formula Studio — และส่งเสียงเมื่อมีอะไรผิด
#
# ทำไมต้องมี: ตัวเฝ้าระวังที่มีอยู่เขียนผลลง log และเด้งแจ้งเตือนบนหน้าจอ Mac เครื่องนี้
# เท่านั้น ถ้าระบบล่มตอนตีสามหรือวันหยุด จะไม่มีใครรู้จนกว่าจะมีคนมานั่งหน้าเครื่อง
#
# ตัวนี้ "ไม่ตรวจซ้ำ" สิ่งที่ monitor/recover ตรวจอยู่แล้ว — มันอ่านผลของสองตัวนั้น
# บวกกับข้อเท็จจริงที่ถามได้เร็ว แล้วส่งให้ Hermes เป็นคนเรียบเรียงและรายงาน
# ตรวจซ้ำซ้อนกันแปลว่ามีสองความจริงที่อาจไม่ตรงกัน ซึ่งแย่กว่ามีที่เดียว
#
# โหมด:
#   watch  (ค่าเริ่มต้น) เรียก Hermes เฉพาะเมื่อพบปัญหา — รันบ่อยได้ ไม่เปลืองอะไรตอนปกติ
#   daily  รายงานสรุปประจำวันเสมอ ต่อให้ทุกอย่างปกติ
#   now    รายงานเดี๋ยวนี้ ใช้ตอนอยากดูเอง
set -eu

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-watch}"
ROOT="${FORMULA_STATE_DIR:-$HOME/.hermes/apps/formula-studio}"
BRIEF_DIR="$ROOT/ai-briefs"
LOG="$ROOT/monitoring/hermes-report.log"
HERMES="${HERMES_BIN:-$HOME/.hermes/hermes-agent/venv/bin/hermes}"
TODAY="$(date +%Y-%m-%d)"
mkdir -p "$BRIEF_DIR" "$(dirname "$LOG")"
say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG"; }

BAD=0
FACTS=""
add()  { FACTS="$FACTS
$1"; }
bad()  { BAD=$((BAD + 1)); add "[ผิดปกติ] $1"; }

# --- ข้อเท็จจริงที่ถามได้เร็ว ------------------------------------------------
if colima status >/dev/null 2>&1; then add "colima: ทำงานปกติ"; else bad "colima ไม่ทำงาน — ทุกคอนเทนเนอร์บนเครื่องนี้ดับหมด"; fi

for pair in "formula 3025"; do  # formulatest removed 2026-10-03 (owner decision)
  set -- $pair
  CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$2/__formula_edge/health" 2>/dev/null || echo 000)"
  if [ "$CODE" = 200 ]; then add "สแตก $1: edge ตอบ 200"; else bad "สแตก $1: edge ตอบ $CODE"; fi
done

if sh "$REPO_DIR/scripts/healthcheck-data.sh" >/dev/null 2>&1; then add "ชั้นข้อมูล: ปกติ"; else bad "ชั้นข้อมูล (PostgreSQL/PostgREST) ไม่ผ่านด่านตรวจ"; fi

# ข้อมูลค้างนานผิดปกติไหม — ระบบที่ยังมีคนใช้ ควรมีการเขียนภายในไม่กี่ชั่วโมง
STALE="$(docker exec formula-postgres psql -tAq -U postgres -d formula \
  -c "select round(extract(epoch from (now() - to_timestamp(max(ts)/1000)))/60)::int from fs_activities" 2>/dev/null || echo "")"
if [ -n "$STALE" ]; then
  add "เขียนข้อมูลล่าสุดเมื่อ $STALE นาทีที่แล้ว"
  [ "$STALE" -gt 1440 ] 2>/dev/null && bad "ไม่มีการเขียนข้อมูลเลยเกิน 24 ชั่วโมง"
else
  bad "ถามฐานข้อมูลไม่ได้"
fi

COUNTS="$(docker exec formula-postgres psql -tAq -U postgres -d formula -c \
  "select 'งาน ' || (select count(*) from fs_records) || ' · ห้องแชท ' || (select count(*) from fs_chats)
       || ' · ข้อความ ' || (select count(*) from fs_messages) || ' · ประวัติ ' || (select count(*) from fs_activities)
       || ' · ผู้ใช้ ' || (select count(*) from fs_users)" 2>/dev/null || echo "")"
[ -n "$COUNTS" ] && add "ข้อมูลในฐาน: $COUNTS"

# ตัวนับเลขงานห้ามตามหลังรหัสที่ออกไปแล้ว
SEQ_OK="$(docker exec formula-postgres psql -tAq -U postgres -d formula -c \
  "select ((select (value #>> '{}')::bigint from fs_meta where key='reccounter')
         > coalesce((select max(substring(id from 2)::bigint) from fs_records),0))" 2>/dev/null || echo "")"
[ "$SEQ_OK" = "t" ] && add "ตัวนับเลขงาน: นำหน้ารหัสสูงสุด (ปกติ)" || bad "ตัวนับเลขงานตามหลังรหัสที่ออกไปแล้ว — งานใบถัดไปจะได้รหัสซ้ำ"

# ผลของตัวเฝ้าระวัง/กู้คืน ที่มีอยู่แล้ว
add "monitor ล่าสุด: $(tail -1 "$ROOT/monitoring/monitor-launchd.log" 2>/dev/null || echo '(ไม่มีบันทึก)')"
add "recover ล่าสุด: $(tail -1 "$ROOT/monitoring/recover-launchd.log" 2>/dev/null || echo '(ไม่มีบันทึก)')"

# สำรอง — ในเครื่องและนอกเครื่อง
LASTB="$(cat "$ROOT/runtime-state/last-backup-daily" 2>/dev/null || echo '')"
if [ -n "$LASTB" ]; then
  add "สำรองประจำวันล่าสุด: $(basename "$LASTB")"
  AGE_H=$(( ( $(date +%s) - $(stat -f %m "$LASTB" 2>/dev/null || echo 0) ) / 3600 ))
  [ "$AGE_H" -gt 30 ] 2>/dev/null && bad "สำรองประจำวันเก่าเกิน 30 ชั่วโมง (อายุ $AGE_H ชม.)"
else
  bad "ไม่พบบันทึกว่าเคยสำรองประจำวันสำเร็จ"
fi
# last-backup-daily ถูกเขียนก่อนพิสูจน์กู้คืน — อายุของมันบอกไม่ได้ว่าชุดนั้นใช้ได้
# ต้องอ่านผลที่งานประจำวันจดเอง (ตัวเดียวกับที่ monitor ใช้ จะได้มีความจริงที่เดียว)
if PROOF="$(sh "$REPO_DIR/scripts/check-backup-status.sh" "$ROOT/monitoring/backup.log" 2>&1)"; then
  add "พิสูจน์กู้คืนล่าสุด: $PROOF"
else
  bad "พิสูจน์กู้คืนล่าสุดไม่ผ่าน: ${PROOF:-ตัวตรวจไม่พิมพ์อะไรออกมาเลย}"
fi
add "สำเนานอกเครื่องล่าสุด: $(tail -1 "$ROOT/monitoring/offsite.log" 2>/dev/null || echo '(ยังไม่เคยส่ง)')"

# การเข้าใช้งานวันนี้
GW="$ROOT/monitoring/gateway-$TODAY.ndjson"
if [ -f "$GW" ]; then
  add "วันนี้: เข้าใช้งานสำเร็จ $(grep -c '"decision":"signed-in"' "$GW" || echo 0) ครั้ง · ถูกปฏิเสธ $(grep -c '"decision":"denied"' "$GW" || echo 0) ครั้ง · เขียนข้อมูล $(grep -c '"decision":"write"' "$GW" || echo 0) ครั้ง"
fi

# พื้นที่ดิสก์ใน VM (ฐานข้อมูลอยู่ตรงนั้น ไม่ใช่ดิสก์เครื่อง)
VMFREE="$(colima ssh -- df -h /var/lib/docker 2>/dev/null | tail -1 | awk '{print $4" เหลือ ("$5" ใช้ไป)"}' || echo '')"
[ -n "$VMFREE" ] && add "พื้นที่ใน VM: $VMFREE"

# --- ตัดสินใจว่าจะเรียก Hermes ไหม -------------------------------------------
BRIEF="$BRIEF_DIR/$TODAY.md"
NEED=0
case "$MODE" in
  now)   NEED=1 ;;
  daily) NEED=1 ;;
  watch) [ "$BAD" -gt 0 ] && NEED=1 ;;
esac
# โหมด watch: ถ้าวันนี้ยังไม่มีสรุปประจำวัน และเลย 08:00 แล้ว ให้ทำสรุปด้วย
if [ "$MODE" = watch ] && [ ! -f "$BRIEF" ] && [ "$(date +%H)" -ge 08 ] 2>/dev/null; then NEED=1; fi

if [ "$NEED" = 0 ]; then
  say "watch status=ok ไม่มีอะไรผิดปกติ ไม่ต้องรบกวน Hermes"
  exit 0
fi

HEAD="รายงานสถานะ Formula Studio runtime บน iMac · $(date '+%Y-%m-%d %H:%M') น."
if [ "$BAD" -gt 0 ]; then
  ASK="พบเรื่องผิดปกติ $BAD ข้อ ช่วยสรุปสั้น ๆ เป็นภาษาไทยว่าอะไรพัง กระทบใคร และควรทำอะไรก่อนเป็นอันดับแรก"
else
  ASK="ทุกอย่างปกติ ช่วยสรุปสั้น ๆ เป็นภาษาไทยว่าระบบเป็นอย่างไร และมีอะไรที่ควรจับตาไหม"
fi

OUT="$("$HERMES" --safe-mode --ignore-rules -z "$HEAD

ข้อเท็จจริงที่เก็บได้:$FACTS

$ASK ห้ามแต่งข้อมูลที่ไม่ได้อยู่ในรายการข้างบน" 2>&1 || echo "(เรียก Hermes ไม่สำเร็จ)")"

{
  echo "# $HEAD"
  echo
  echo "$OUT"
  echo
  echo '---'
  echo '```'
  echo "$FACTS"
  echo '```'
} > "$BRIEF"

say "report mode=$MODE ผิดปกติ=$BAD brief=$BRIEF"
[ "$BAD" -gt 0 ] && say "ALERT: $(echo "$FACTS" | grep '\[ผิดปกติ\]' | tr '\n' ' ')"
exit 0
