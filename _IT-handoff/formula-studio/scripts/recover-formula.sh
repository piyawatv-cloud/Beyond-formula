#!/bin/sh
# ตัวกู้คืน Formula Studio runtime — กู้เป็นขั้น ๆ ไม่แตะข้อมูล
#
# ขอบเขตที่ห้ามล้ำ:
#   - สั่งได้แค่ `docker start` กับ `docker restart` ของคอนเทนเนอร์ที่มีอยู่แล้วเท่านั้น
#     **ห้ามใช้ compose up -d เด็ดขาด** เพราะมันสร้างคอนเทนเนอร์ใหม่ ซึ่งจะไปอ่าน
#     runtime/formula-proxy.mjs จากดิสก์ใหม่ทั้งไฟล์ · สถาปัตยกรรมนี้ mount ไฟล์ตรง
#     ไม่มีขั้นตอน build แปลว่าการกู้ผิดจังหวะ = ปล่อยโค้ดที่ยังแก้ไม่เสร็จขึ้นระบบ
#     โดยไม่มีใครสั่ง deploy · การสร้างคอนเทนเนอร์เป็นงานของ blue-green-formula.sh
#   - ไม่ลบอะไร ไม่แตะ volume ไม่แตะไฟล์สำรอง ไม่รัน SQL
#   - ถ้ามีการเปลี่ยนผ่านสีถือล็อกอยู่ ให้ถอยออกมาเฉย ๆ ไม่แย่งกันขับ
#   - นับความล้มเหลวติดต่อกัน แล้วส่งเสียงถึงคนจริงเมื่อครบ 3 ครั้ง
#     (ระบบพี่น้องเคยล้ม 2,994 ครั้งใน 12 วันโดยไม่มีใครรู้ เพราะไม่มีขั้นนี้)
#
# ใช้: sh scripts/recover-formula.sh
# ออก: 0 = ปกติ หรือกู้สำเร็จ · 1 = ยังไม่หาย
set -eu

STATE_ROOT="${FORMULA_STATE_ROOT_OVERRIDE:-$HOME/.hermes/apps/formula-studio}"
REPORT_DIR="$STATE_ROOT/monitoring"
LOG_FILE="$REPORT_DIR/recover-$(TZ=Asia/Bangkok date +%Y-%m-%d).log"
ALERTS_FILE="$REPORT_DIR/alerts.log"
STREAK_FILE="$REPORT_DIR/recover-failure-streak"
STAMP="$(TZ=Asia/Bangkok date '+%Y-%m-%dT%H:%M:%S%z')"
FAIL_THRESHOLD="${FORMULA_RECOVER_FAIL_THRESHOLD:-3}"
ALERT_COOLDOWN="${FORMULA_RECOVER_ALERT_COOLDOWN_SECONDS:-3600}"
STACK="${FORMULA_RECOVER_STACK:-formula}"
# พอร์ตของตัวรับหน้าต้องคำนวณจากสแตก ไม่ใช่ตั้งตายไว้ที่ของจริง
# เดิมตั้ง 3025 ไว้เฉย ๆ ผลคือสั่งให้กู้ testlab แต่ไปตัดสินผลจากสุขภาพของสแตกจริง
# แล้วบรรทัดสรุปเขียนว่า "edge=ตอบปกติ" ทั้งที่พูดถึงคนละตัวกับที่เพิ่งซ่อม
EDGE_PORT=$( [ "$STACK" = formulatest ] && echo 3028 || echo 3025 )
EDGE_URL="${FORMULA_EDGE_HEALTH:-http://127.0.0.1:$EDGE_PORT/__formula_edge/health}"

mkdir -p "$REPORT_DIR"
chmod 700 "$REPORT_DIR" 2>/dev/null || true

log() { printf '%s %s\n' "$STAMP" "$*" | tee -a "$LOG_FILE"; }
alert_line() { printf '%s %s\n' "$STAMP" "$*" >> "$ALERTS_FILE"; }

# ส่งเสียงถึงคนจริง ช่องทางเดียวกับตัวเฝ้าสำรองของ OPC
# ตัวแจ้งเตือนที่บอกไม่ได้ว่าตัวเองส่งไม่ออก ก็ไม่ใช่ตัวแจ้งเตือน — จึงบันทึกผลทุกครั้ง
notify_user() {
  TITLE="$1"; MESSAGE="$2"
  if [ -x /usr/bin/osascript ]; then
    SAFE_T="$(printf '%s' "$TITLE" | tr '\n\r' '  ' | sed 's/\\/\\\\/g; s/"/\\"/g')"
    SAFE_M="$(printf '%s' "$MESSAGE" | tr '\n\r' '  ' | sed 's/\\/\\\\/g; s/"/\\"/g')"
    if /usr/bin/osascript -e "display notification \"$SAFE_M\" with title \"$SAFE_T\" sound name \"Basso\"" >>"$LOG_FILE" 2>&1; then
      log "phase=notification result=sent channel=macos"
      return 0
    fi
    log "phase=notification result=failed channel=macos"
    return 1
  fi
  log "phase=notification result=failed why=ไม่มีช่องทางถึงคนจริงบนเครื่องนี้"
  return 1
}

read_streak()  { [ -f "$STREAK_FILE" ] && awk -F'|' 'NR==1{print $1+0}' "$STREAK_FILE" 2>/dev/null || printf '0'; }
read_alerted() { [ -f "$STREAK_FILE" ] && awk -F'|' 'NR==1{print $2+0}' "$STREAK_FILE" 2>/dev/null || printf '0'; }
write_streak() { printf '%s|%s|%s\n' "$1" "$2" "$3" > "$STREAK_FILE"; chmod 600 "$STREAK_FILE" 2>/dev/null || true; }

# หา docker socket ให้ครบสามที่ก่อนสรุปว่า docker ตาย
if ! docker info >/dev/null 2>&1; then
  for CANDIDATE in "$HOME/.colima/default/docker.sock" "$HOME/.colima/docker.sock" /var/run/docker.sock; do
    if [ -S "$CANDIDATE" ]; then
      DOCKER_HOST="unix://$CANDIDATE"; export DOCKER_HOST
      docker info >/dev/null 2>&1 && break
    fi
  done
fi
if ! docker info >/dev/null 2>&1; then
  # ไม่สั่ง colima restart เอง — นั่นเป็นการกู้ทั้งเครื่อง ซึ่งกระทบระบบอื่นที่ใช้ docker
  # ตัวเดียวกันอยู่ · หน้าที่ของสคริปต์นี้คือคอนเทนเนอร์ของ Formula เท่านั้น
  N=$(( $(read_streak) + 1 ))
  write_streak "$N" "$(read_alerted)" "docker-unreachable"
  log "stage=0 result=blocked why=ไม่เจอ docker socket ทั้งสามที่ ติดต่อกัน=$N"
  alert_line "recover=blocked why=docker-unreachable consecutive=$N"
  exit 1
fi

# ---------------------------------------------------------------------------
# ถ้ามีการเปลี่ยนผ่านสีอยู่ ให้ถอย
#
# blue-green-formula.sh ถือล็อกพร้อม heartbeat ทุก 5 วินาทีตลอดช่วงสลับสี
# ตัวกู้ที่เข้าไปสั่ง restart ระหว่างนั้น = สองคนขับรถคันเดียวกัน
# ---------------------------------------------------------------------------
LOCK="$STATE_ROOT/runtime-state/$STACK/transition.lock"
if [ -d "$LOCK" ]; then
  HB_AGE=$(( $(date +%s) - $(stat -f %m "$LOCK/heartbeat" 2>/dev/null || stat -c %Y "$LOCK/heartbeat" 2>/dev/null || echo 0) ))
  if [ "$HB_AGE" -lt 120 ]; then
    log "stage=0 result=skipped why=กำลังเปลี่ยนผ่านสีอยู่ (heartbeat ${HB_AGE}s) ไม่แย่งกันขับ"
    exit 0
  fi
  log "stage=0 note=ล็อกค้างมา ${HB_AGE}s ถือว่าไม่มีใครถืออยู่จริง ทำต่อ (ไม่ลบล็อกทิ้ง นั่นเป็นงานของ blue-green)"
fi

ACTED=0
source_sha_of() {
  curl -sS --max-time 10 "http://127.0.0.1:$1/__formula/health" 2>/dev/null \
    | sed -n 's/.*"proxySourceSha":"\([^"]*\)".*/\1/p' | cut -c1-12
}

# ---------------------------------------------------------------------------
# ขั้นที่ 1 — คอนเทนเนอร์ที่หยุดไปแล้ว ให้สตาร์ตกลับ
#
# รวมชั้นข้อมูลด้วย เพราะ proxy ที่สุขภาพดีแต่ฐานไม่ขึ้น คือเว็บที่เปิดได้แต่ว่างเปล่า
# ---------------------------------------------------------------------------
for NAME in formula-postgres formula-postgrest "$STACK-runtime-blue" "$STACK-runtime-green" "$STACK-runtime-edge"; do
  # docker inspect ของคอนเทนเนอร์ที่ไม่มีอยู่ พิมพ์บรรทัดว่างออก stdout แล้วค่อยตายที่ stderr
  # เขียนเป็น `|| echo missing` จึงได้ค่า "ว่างขึ้นบรรทัดใหม่ missing" ซึ่งไม่ตรงกับกิ่งไหนเลย
  # แล้วกิ่ง missing ไม่เคยทำงาน — ต้องตัดให้เหลือบรรทัดแรกแล้วเติมค่าเริ่มต้นเอง
  STATE="$(docker inspect -f '{{.State.Status}}' "$NAME" 2>/dev/null | head -1)"
  [ -n "$STATE" ] || STATE=missing
  case "$STATE" in
    running) : ;;
    missing)
      # ไม่สร้างให้ — การสร้างคอนเทนเนอร์เป็นงานของ blue-green-formula.sh bootstrap
      log "stage=1 container=$NAME result=cannot-fix why=ไม่มีคอนเทนเนอร์นี้อยู่เลย ต้องยกสแตกด้วย bootstrap"
      ;;
    *)
      log "stage=1 container=$NAME state=$STATE action=start"
      docker start "$NAME" >>"$LOG_FILE" 2>&1 || log "stage=1 container=$NAME result=start-failed"
      ACTED=1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# ขั้นที่ 2 — คอนเทนเนอร์ที่รันอยู่แต่ป่วย ให้รีสตาร์ต
#
# บันทึกค่าแฮชของซอร์สก่อนและหลังทุกครั้ง เพราะไฟล์ proxy ถูก mount ตรง
# ถ้ามันเปลี่ยนไปหลังรีสตาร์ต แปลว่าคอนเทนเนอร์เพิ่งหยิบโค้ดใหม่จากดิสก์ขึ้นมา
# ซึ่งอาจเป็นโค้ดที่ยังไม่มีใครตั้งใจปล่อย — ต้องมีร่องรอยไว้ให้ตามได้
# ---------------------------------------------------------------------------
for COLOR in blue green; do
  NAME="$STACK-runtime-$COLOR"
  PORT=$( [ "$COLOR" = blue ] && echo 3026 || echo 3027 )
  [ "$STACK" = formulatest ] && PORT=$( [ "$COLOR" = blue ] && echo 3029 || echo 3030 )
  HEALTH="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$NAME" 2>/dev/null | head -1)"
  [ -n "$HEALTH" ] || HEALTH=missing
  [ "$HEALTH" = unhealthy ] || continue
  BEFORE="$(source_sha_of "$PORT")"
  log "stage=2 container=$NAME health=unhealthy action=restart srcก่อน=${BEFORE:-อ่านไม่ได้}"
  docker restart "$NAME" >>"$LOG_FILE" 2>&1 || log "stage=2 container=$NAME result=restart-failed"
  ACTED=1
  sleep 12
  AFTER="$(source_sha_of "$PORT")"
  log "stage=2 container=$NAME srcหลัง=${AFTER:-อ่านไม่ได้}"
  [ -n "$BEFORE" ] && [ -n "$AFTER" ] && [ "$BEFORE" != "$AFTER" ] \
    && alert_line "recover=source-changed container=$NAME ก่อน=$BEFORE หลัง=$AFTER why=รีสตาร์ตแล้วหยิบโค้ดจากดิสก์ที่ต่างจากเดิม" \
    || true
done

# ---------------------------------------------------------------------------
# ขั้นที่ 3 — ตัวรับหน้าตอบไม่ได้ ทั้งที่สองสีปกติ
# ---------------------------------------------------------------------------
# "ผู้ใช้ยังใช้งานได้ไหม" ไม่เท่ากับ "สีที่ประกาศว่า active สุขภาพดีไหม"
#
# formula-edge.mjs ตั้ง status เป็น ok/degraded จากสี active เท่านั้น แต่ตัวส่งต่อคำขอ
# หันไปใช้สีสำรองให้เองเมื่อสี active ป่วย · ถ้าดูแค่ status=ok เราจะรีสตาร์ตตัวรับหน้า
# ที่ยังดีอยู่ทุก 5 นาที (ตัดคำขอที่ค้างอยู่ทิ้งทุกครั้ง) แล้วเด้งกล่องเตือนว่าเว็บล่ม
# ทั้งที่คนยังใช้งานได้ปกติ — ใกล้เคียงกับสิ่งที่กฎ 5.1 ห้ามไว้
edge_health() { curl -sS --max-time 10 "$EDGE_URL" 2>/dev/null || printf '{}'; }
edge_serving()   { edge_health | grep -q '"healthy":true'; }   # มีสีใดสีหนึ่งรับคนได้
edge_active_ok() { edge_health | grep -q '"status":"ok"'; }    # สีที่ประกาศไว้ยังดีอยู่

if ! edge_serving; then
  log "stage=3 edge=ไม่มีสีไหนรับคนได้เลย action=restart"
  docker restart "$STACK-runtime-edge" >>"$LOG_FILE" 2>&1 || log "stage=3 result=restart-failed"
  ACTED=1
  sleep 12
elif ! edge_active_ok; then
  # ไม่แตะอะไร — ขั้นที่ 1 กับ 2 ดูแลสีที่ป่วยไปแล้ว และผู้ใช้ยังใช้งานได้อยู่
  log "stage=3 edge=สีที่ประกาศไว้ป่วย แต่สีสำรองรับคนอยู่ result=no-action why=รีสตาร์ตตอนนี้คือตัดคำขอของคนที่ใช้งานได้อยู่ทิ้ง"
  alert_line "recover=serving-from-standby why=สี active ป่วย ผู้ใช้ยังใช้ได้ผ่านสีสำรอง"
fi

# ---------------------------------------------------------------------------
# สรุป และนับความล้มเหลวติดต่อกัน
# ---------------------------------------------------------------------------
PREV="$(read_streak)"
LAST_ALERT="$(read_alerted)"
NOW="$(date +%s)"

if edge_serving; then
  if [ "$PREV" -ge "$FAIL_THRESHOLD" ]; then
    notify_user "Formula Studio กลับมาใช้งานได้" "หลังจากล้มติดกัน $PREV ครั้ง" || alert_line "recover=recovery-notification-failed after=$PREV"
    alert_line "recover=recovered after=$PREV"
  fi
  write_streak 0 "$LAST_ALERT" ok
  log "result=$( [ "$ACTED" = 1 ] && echo repaired || echo ok ) สแตก=$STACK edge=$EDGE_URL รับคนได้"
  exit 0
fi

N=$(( PREV + 1 ))
log "result=still-down สแตก=$STACK ติดต่อกัน=$N why=ไม่มีสีไหนรับคนได้เลยหลังกู้ครบทุกขั้น"
alert_line "recover=still-down consecutive=$N"

if [ "$N" -ge "$FAIL_THRESHOLD" ] && [ $(( NOW - LAST_ALERT )) -ge "$ALERT_COOLDOWN" ]; then
  if notify_user "Formula Studio ใช้งานไม่ได้" "กู้อัตโนมัติแล้วไม่สำเร็จ $N ครั้งติดกัน ต้องเข้าไปดูด้วยมือ"; then
    write_streak "$N" "$NOW" still-down
  else
    # ส่งไม่ออก = ห้ามจดว่าเตือนแล้ว ไม่งั้นรอบหน้าจะนิ่งเพราะติด cooldown
    alert_line "recover=notification-failed consecutive=$N"
    write_streak "$N" "$LAST_ALERT" notification-failed
  fi
else
  write_streak "$N" "$LAST_ALERT" still-down
fi
exit 1
