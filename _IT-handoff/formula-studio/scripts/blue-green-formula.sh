#!/bin/sh
# คุมสองสีของ Formula Studio runtime
#
# หลักที่ยกมาจาก OPC และห้ามกลับด้าน:
#   - ด่าน "ก่อนสลับ" คือ รอ  — ไม่ผ่านก็ไม่สลับ ไม่มีการผ่อนด่านให้ deploy ผ่าน
#   - ด่าน "หลังสลับ" คือ ถอย — ไม่ผ่านให้สลับกลับทันทีโดยอัตโนมัติ
#   - ด่านของ rollback ต้อง "หลวมกว่า" ด่านขาไป เพราะรุ่นเก่าที่ยังดีอยู่
#     อาจไม่รู้จักกฎที่เราเพิ่งเขียนเมื่อวาน การถูกกฎใหม่บล็อกไม่ให้ถอย คือกับดัก
#   - สคริปต์นี้ไม่แตะข้อมูล ไม่ลบอะไร ไม่สร้าง image
#
# ใช้: sh scripts/blue-green-formula.sh <คำสั่ง> [สี]
#   active | status | verify <สี> | prepare <สี> | switch <สี> | rollback <สี> | bootstrap

set -eu

say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PREFIX="${FORMULA_PREFIX_OVERRIDE:-}"
STACK_ENV="${FORMULA_STACK_ENV:-$REPO_DIR/runtime/stack.env}"
SECRET_ENV="${FORMULA_ENV_FILE:-$REPO_DIR/runtime/formula.env}"
# ค่าของชั้นข้อมูลในเครื่อง — ต้องเป็นไฟล์ "สุดท้าย" เสมอ เพราะมันมาทับ SB_* ของ Supabase
# หากไฟล์นี้หาย legacy Supabase origin ยังถูกปิด; ต้องเลือก backend/mode รายสีอย่างชัดเจน
DATA_ENV="${FORMULA_DATA_ENV_FILE:-$REPO_DIR/runtime/data.env}"

# Production consumer secrets live in macOS Keychain, not in the repository.
# Load them only into this process so every controlled deploy/recovery keeps the
# IAM connection working without writing credentials to an env file.
if command -v security >/dev/null 2>&1; then
  FORMULA_KEYCHAIN_ACCOUNT="${USER:-$(id -un)}"
  if [ -z "${IAM_CONSUMER_SHARED_SECRET:-}" ]; then
    IAM_CONSUMER_SHARED_SECRET="$(security find-generic-password -a "$FORMULA_KEYCHAIN_ACCOUNT" -s beyond-workflow.iam.production.consumer-hmac -w 2>/dev/null || true)"
    export IAM_CONSUMER_SHARED_SECRET
  fi
  if [ -z "${IAM_ACCESS_CLIENT_ID:-}" ]; then
    IAM_ACCESS_CLIENT_ID="$(security find-generic-password -a "$FORMULA_KEYCHAIN_ACCOUNT" -s beyond-workflow.iam.production.joborder.access-id -w 2>/dev/null || true)"
    export IAM_ACCESS_CLIENT_ID
  fi
  if [ -z "${IAM_ACCESS_CLIENT_SECRET:-}" ]; then
    IAM_ACCESS_CLIENT_SECRET="$(security find-generic-password -a "$FORMULA_KEYCHAIN_ACCOUNT" -s beyond-workflow.iam.production.joborder.access-secret -w 2>/dev/null || true)"
    export IAM_ACCESS_CLIENT_SECRET
  fi
fi

# shellcheck disable=SC1090
. "$STACK_ENV"
[ -n "$PREFIX" ] && FORMULA_PREFIX="$PREFIX"

# ชื่อโปรเจกต์ต้องมาจากไฟล์ env เท่านั้น ห้ามเดา
# ถ้าเดาแล้วเดาไม่ตรงกับตอนยกสแตกขึ้น compose จะไปสร้างคอนเทนเนอร์ใหม่ชนชื่อเดิม
# แล้ว error ที่ได้จะพูดถึง "ชื่อซ้ำ" ซึ่งไม่บอกเลยว่าต้นเหตุคือชื่อโปรเจกต์คนละตัว
if [ -z "${FORMULA_COMPOSE_PROJECT:-}" ]; then
  say "ไฟล์ $STACK_ENV ไม่ได้ตั้ง FORMULA_COMPOSE_PROJECT — ไม่เดาให้ เพราะเดาผิดแล้วชนของเดิม"
  exit 2
fi
PROJECT="$FORMULA_COMPOSE_PROJECT"
# shellcheck disable=SC1091
. "$REPO_DIR/scripts/provisioning-secret.sh"
formula_provisioning_secret_for "$PROJECT"
COMPOSE="docker compose -p $PROJECT -f $REPO_DIR/docker-compose.formula.yml --env-file $STACK_ENV --env-file $SECRET_ENV"
if [ -f "$DATA_ENV" ]; then COMPOSE="$COMPOSE --env-file $DATA_ENV"; fi
STATE="$FORMULA_STATE_ROOT/runtime-state/$FORMULA_PREFIX"
LOCK="$STATE/transition.lock"
EDGE="http://127.0.0.1:$FORMULA_EDGE_PORT"

port_for() { [ "$1" = blue ] && printf '%s' "$FORMULA_BLUE_PORT" || printf '%s' "$FORMULA_GREEN_PORT"; }
other_than() { [ "$1" = blue ] && echo green || echo blue; }

require_color() {
  case "${1:-}" in
    blue|green) : ;;
    *) say "ต้องระบุสีเป็น blue หรือ green"; exit 2 ;;
  esac
}

active_color() { tr -d ' \n' < "$STATE/active" 2>/dev/null || echo blue; }

# ---------------------------------------------------------------------------
# ล็อกช่วงเปลี่ยนผ่าน — ตัวเดียวกับที่ edge เคารพ
# heartbeat เดินทุก 5 วินาที เพื่อให้ฝั่ง edge แยกออกว่า "กำลังทำอยู่" กับ "ค้างตาย"
# ---------------------------------------------------------------------------
HEARTBEAT_PID=""
release_lock() {
  [ -n "$HEARTBEAT_PID" ] && kill "$HEARTBEAT_PID" 2>/dev/null || true
  rm -rf "$LOCK" 2>/dev/null || true
}
take_lock() {
  mkdir -p "$STATE"
  if ! mkdir "$LOCK" 2>/dev/null; then
    AGE_FILE="$LOCK/heartbeat"
    if [ -f "$AGE_FILE" ]; then
      NOW="$(date +%s)"; THEN="$(stat -f %m "$AGE_FILE" 2>/dev/null || stat -c %Y "$AGE_FILE")"
      if [ $((NOW - THEN)) -gt 120 ]; then
        say "CRITICAL ล็อกค้างมา $((NOW - THEN)) วินาที — ย้ายทิ้งเป็นหลักฐานแล้วทำต่อ"
        mv "$LOCK" "$LOCK.stale-$NOW"
        mkdir "$LOCK"
      else
        say "มีการเปลี่ยนผ่านอื่นถือล็อกอยู่ — ไม่แย่ง"; exit 73
      fi
    else
      say "มีการเปลี่ยนผ่านอื่นถือล็อกอยู่ — ไม่แย่ง"; exit 73
    fi
  fi
  touch "$LOCK/heartbeat"
  ( while :; do touch "$LOCK/heartbeat" 2>/dev/null || exit 0; sleep 5; done ) &
  HEARTBEAT_PID=$!
  trap 'release_lock' EXIT INT TERM
}

# ---------------------------------------------------------------------------
# ด่านตรวจรายสี — ตรวจ "ความหมาย" ไม่ใช่แค่ว่าพอร์ตเปิด
# ---------------------------------------------------------------------------
# Keep legacy rollback compatibility, but an explicit standby/invalid gate never
# qualifies as rollback-ready. Do not print backend URLs, env values or credentials.
require_serving_color() {
  ELIGIBILITY_HEALTH="$(curl -fsS --max-time 10 "http://127.0.0.1:$(port_for "$1")/__formula/health" 2>/dev/null || true)"
  if printf '%s' "$ELIGIBILITY_HEALTH" | grep -Eq '"(servingEligible|trafficMode|backendConfiguration)"'; then
    if ! printf '%s' "$ELIGIBILITY_HEALTH" | grep -Eq '"servingEligible"[[:space:]]*:[[:space:]]*true' \
      || ! printf '%s' "$ELIGIBILITY_HEALTH" | grep -Eq '"trafficMode"[[:space:]]*:[[:space:]]*"serving"' \
      || ! printf '%s' "$ELIGIBILITY_HEALTH" | grep -Eq '"backendConfiguration"[[:space:]]*:[[:space:]]*"valid"'; then
      say "สี $1 เป็น standby หรือยังไม่พร้อมรับผู้ใช้ — ไม่สลับ"
      return 1
    fi
  elif ! printf '%s' "$ELIGIBILITY_HEALTH" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"(ok|degraded)"'; then
    say "ตรวจสิทธิ์รับผู้ใช้ของสี $1 ไม่ได้ — ไม่สลับ"
    return 1
  fi
}

verify_color() {
  require_serving_color "$1" || return 1
  COLOR="$1"; PORT="$(port_for "$COLOR")"; BASE="http://127.0.0.1:$PORT"; BAD=0
  check() { if [ "$2" = "$3" ]; then echo "    ผ่าน: $1"; else echo "    ไม่ผ่าน: $1 (ได้ '$2' ต้องการ '$3')"; BAD=1; fi; }

  HEALTH="$(curl -sS --max-time 10 "$BASE/__formula/health" || echo '{}')"
  get() { printf '%s' "$HEALTH" | sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p"; }
  check "proxy บอกว่าตัวเองพร้อม" "$(get status)" "ok"
  check "ประตูข้อมูลถูกต่อสาย" "$(get gateway)" "rewritten"
  check "รายงานสีตรงกับที่สั่ง" "$(get color)" "$COLOR"

  # ปลายทางข้อมูลต้องเป็นฐานในเครื่องจริง ๆ ไม่ใช่แค่ "อ่านข้อมูลได้"
  #
  # ด่านอื่นทุกข้อผ่านเหมือนกันหมดไม่ว่าปลายทางจะเป็น Supabase หรือฐานในเครื่อง
  # ใครยกสแตกด้วย compose มือเปล่าโดยลืม --env-file runtime/data.env จะได้สแตกที่
  # คุยกับ Supabase ด้วยคีย์จริง แล้วด่านทั้ง 17 ข้อกับด่านเทียบสองสีอีก 12 ข้อ
  # ก็ยังเขียวหมด — เขียว เงียบ และผิด ข้อนี้มีไว้กันกรณีนั้นข้อเดียว
  if [ -f "$DATA_ENV" ]; then
    WANT_UPSTREAM="$(sed -n 's/^SB_ORIGIN=//p' "$DATA_ENV" | head -1)"
    GOT_UPSTREAM="$(docker inspect "$FORMULA_PREFIX-runtime-$COLOR" \
      --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
      | sed -n 's/^SB_ORIGIN=//p' | head -1)"
    check "ปลายทางข้อมูลเป็นฐานในเครื่อง" "$GOT_UPSTREAM" "$WANT_UPSTREAM"
    GOT_AUTH="$(docker inspect "$FORMULA_PREFIX-runtime-$COLOR" \
      --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
      | sed -n 's/^SB_UPSTREAM_AUTH=//p' | head -1)"
    check "ไม่แนบคีย์ Supabase ไปกับคำขอ" "$GOT_AUTH" "none"
  fi

  check "หน้าเว็บตอบ 200" "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$BASE/")" "200"

  BODY="$(curl -sS --max-time 20 "$BASE/")"
  # build stamp คือสิ่งที่ผู้ใช้ใช้ยืนยันว่าได้รุ่นใหม่จริงหลังกดรีเฟรช
  # จึงตรวจว่าตัวเลขบนหน้าเว็บ ตรงกับรุ่นที่เราผนึกไว้จริง ไม่ใช่แค่ "มีแถบอยู่"
  WANT_STAMP="$(sed -n 's/.*"buildStamp":"\([^"]*\)".*/\1/p' "$REPO_DIR/releases/$(cat "$REPO_DIR/releases/CURRENT")/meta.json")"
  HAS_STAMP="$(printf '%s' "$BODY" | grep -cF "$WANT_STAMP" >/dev/null 2>&1 && echo yes || echo no)"
  check "หน้าเว็บแสดง build stamp ของรุ่นที่ผนึกไว้ ($WANT_STAMP)" "$HAS_STAMP" "yes"
  MARK="$(printf '%s' "$BODY" | grep -c 'name="fs-shell"' || true)"
  check "หน้าเว็บมีเครื่องหมายของ runtime" "$MARK" "1"

  # คีย์ต้องไม่ปรากฏในหน้าเว็บ ไม่ว่ากรณีใด — ข้อนี้ห้ามผ่อนเด็ดขาด
  # shellcheck disable=SC1090
  . "$SECRET_ENV"
  # ตรวจสองชั้น เพราะวันหนึ่ง SB_ANON_KEY จะถูกล้างทิ้งหลังเพิกถอนคีย์
  # แล้ว grep -c "" จะนับ "ทุกบรรทัด" ว่าเจอ — ด่านที่ควรเข้มที่สุดจะกลายเป็นด่านที่พังเงียบ
  if [ -n "${SB_ANON_KEY:-}" ]; then
    LEAK="$(printf '%s' "$BODY" | grep -c "$SB_ANON_KEY" || true)"
    check "คีย์ Supabase ไม่หลุดอยู่ในหน้าเว็บ" "$LEAK" "0"
  fi
  # ชั้นที่สองไม่พึ่งค่าใด ๆ เลย: คีย์ของ Supabase เป็น JWT ซึ่งขึ้นต้นด้วย eyJ เสมอ
  # ข้อนี้จับได้แม้คีย์จะถูกเปลี่ยน ถูกล้าง หรือมีคีย์ของที่อื่นหลุดเข้ามา
  JWT="$(printf '%s' "$BODY" | grep -c 'eyJ' || true)"
  check "ไม่มีโทเคนหน้าตาแบบ JWT อยู่ในหน้าเว็บ" "$JWT" "0"

  CSP="$(curl -sSI --max-time 10 "$BASE/" | grep -ci 'content-security-policy' || true)"
  check "มีหัวข้อ CSP" "$CSP" "1"
  CONNECT="$(curl -sSI --max-time 10 "$BASE/" | grep -i 'content-security-policy' | grep -c 'supabase' || true)"
  check "CSP ไม่เปิดทางให้ยิงตรงไป Supabase" "$CONNECT" "0"

  # ด่านตรวจใช้โทเคนของตัวเอง ซึ่งอ่านได้แค่ fs_meta และไม่เคยถูกส่งไปกับหน้าเว็บ
  GW="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -H "apikey: $FORMULA_PROBE_TOKEN" "$BASE/sb/rest/v1/fs_meta?select=key")"
  check "ประตูข้อมูลอ่านข้อมูลได้ด้วยคีย์ฝั่งเซิร์ฟเวอร์" "$GW" "200"
  NOTOK="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$BASE/sb/rest/v1/fs_meta?select=key")"
  check "ประตูข้อมูลปฏิเสธคำขอที่ไม่มีเซสชัน" "$NOTOK" "401"

  # โทเคนของด่านตรวจต้องแตะได้แค่ fs_meta เท่านั้น ถ้ามันอ่าน fs_records ได้เมื่อไหร่
  # แปลว่ามันไม่ใช่โทเคนตรวจสุขภาพอีกต่อไป แต่เป็นกุญแจสำรองที่ไม่มีใครดูแล
  PROBE_LIMIT="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -H "apikey: $FORMULA_PROBE_TOKEN" "$BASE/sb/rest/v1/fs_records?select=id&limit=1")"
  check "โทเคนของด่านตรวจแตะตารางอื่นไม่ได้" "$PROBE_LIMIT" "401"

  # หน้าเว็บต้องไม่มีอะไรที่หยิบไปยิงประตูข้อมูลได้ ไม่ว่าจะคีย์ Supabase หรือโทเคนของเรา
  PROBE_LEAK="$(printf '%s' "$BODY" | grep -c "$FORMULA_PROBE_TOKEN" || true)"
  check "โทเคนของด่านตรวจไม่หลุดอยู่ในหน้าเว็บ" "$PROBE_LEAK" "0"

  SESSION_ANON="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$BASE/sb/session")"
  check "ปลายทางเซสชันตอบว่ายังไม่ได้เข้าใช้งาน" "$SESSION_ANON" "401"

  OPCCFG="$(get opcLoginConfigured)"
  OPCOK="$(printf '%s' "$HEALTH" | grep -c '"opcLoginConfigured":true' || true)"
  check "ตั้งปลายทางล็อกอินของ OPC ไว้แล้ว" "$OPCOK" "1"
  SECOK="$(printf '%s' "$HEALTH" | grep -c '"sessionSecretConfigured":true' || true)"
  check "ตั้งกุญแจเซ็นเซสชันไว้แล้ว" "$SECOK" "1"

  for FILE in "$REPO_DIR"/runtime/assets/fs-*; do
    [ -f "$FILE" ] || continue
    BASENAME="$(basename "$FILE")"
    CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/$BASENAME")"
    check "ไฟล์เสริม $BASENAME เสิร์ฟได้" "$CODE" "200"
  done

  [ "$BAD" -eq 0 ]
}

# ด่านของ rollback — หลวมกว่าโดยตั้งใจ ดูแค่ว่า "ยังรับคนได้"
verify_rollback_color() {
  require_serving_color "$1" || return 1
  COLOR="$1"; PORT="$(port_for "$COLOR")"; BASE="http://127.0.0.1:$PORT"
  CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$BASE/" || echo 000)"
  case "$CODE" in
    200|302) echo "    ผ่าน: หน้าเว็บของสี $COLOR ยังรับคนได้ ($CODE)"; return 0 ;;
    *) echo "    ไม่ผ่าน: หน้าเว็บของสี $COLOR ตอบ $CODE"; return 1 ;;
  esac
}

wait_healthy() {
  NAME="$FORMULA_PREFIX-runtime-$1"; i=0
  while [ "$i" -lt 30 ]; do
    STATUS="$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null || echo missing)"
    [ "$STATUS" = healthy ] && return 0
    i=$((i + 1)); sleep 2
  done
  say "สี $1 ไม่ขึ้นสถานะ healthy ใน 60 วินาที (ล่าสุด: ${STATUS:-ไม่ทราบ})"
  return 1
}

atomic_switch() {
  require_serving_color "$1" || return 1
  printf '%s\n' "$1" > "$STATE/active.tmp"
  mv "$STATE/active.tmp" "$STATE/active"
  printf '{"at":"%s","color":"%s","reason":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "$STATE/switches.ndjson"
}

CMD="${1:-status}"
case "$CMD" in
  active)
    active_color
    ;;

  status)
    say "สแตก=$FORMULA_PREFIX โปรเจกต์=$PROJECT สีที่ใช้อยู่=$(active_color)"
    docker ps --filter "label=com.beyond.formula-runtime.stack=$FORMULA_PREFIX" \
      --format 'table {{.Names}}\t{{.Status}}'
    curl -sS --max-time 10 "$EDGE/__formula_edge/health" || say "edge ไม่ตอบ"
    echo
    ;;

  verify)
    require_color "${2:-}"
    say "ตรวจสี $2"
    verify_color "$2" && say "สี $2 ผ่านด่าน" || { say "สี $2 ไม่ผ่านด่าน"; exit 1; }
    ;;

  prepare)
    require_color "${2:-}"
    [ "$2" = "$(active_color)" ] && { say "สี $2 กำลังรับคนอยู่ — ห้าม prepare สีที่ใช้งานอยู่"; exit 2; }
    take_lock
    say "เตรียมสี $2"
    $COMPOSE up -d --force-recreate "runtime-$2"
    wait_healthy "$2"
    sh "$REPO_DIR/scripts/wait-formula-proxy-ready.sh" "$2" "$(port_for "$2")"
    verify_color "$2" || { say "สี $2 ไม่ผ่านด่าน — ยังไม่สลับ"; exit 1; }
    say "สี $2 พร้อมแล้ว (ยังไม่สลับ)"
    ;;

  switch)
    require_color "${2:-}"
    FROM="$(active_color)"
    [ "$2" = "$FROM" ] && { say "สี $2 รับคนอยู่แล้ว ไม่ต้องสลับ"; exit 0; }
    take_lock
    say "ตรวจสี $2 ก่อนสลับ"
    verify_color "$2" || { say "สี $2 ไม่ผ่านด่าน — ไม่สลับ (ด่านก่อนสลับคือรอ ไม่ใช่ผ่อน)"; exit 1; }
    atomic_switch "$2" "manual-switch"
    sleep 4
    CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$EDGE/" || echo 000)"
    if [ "$CODE" != 200 ]; then
      say "หลังสลับ edge ตอบ $CODE — ถอยกลับสี $FROM ทันที"
      atomic_switch "$FROM" "automatic-rollback:post-switch-health"
      exit 1
    fi
    say "สลับไปสี $2 เรียบร้อย (edge ตอบ $CODE)"
    ;;

  rollback)
    require_color "${2:-}"
    FROM="$(active_color)"
    take_lock
    say "ถอยกลับไปสี $2 (ด่านหลวมกว่าขาไปโดยตั้งใจ)"
    verify_rollback_color "$2" || { say "สี $2 รับคนไม่ได้เลย — ถอยไม่ได้"; exit 1; }
    atomic_switch "$2" "rollback-from:$FROM"
    sleep 3
    curl -sS -o /dev/null -w '' --max-time 20 "$EDGE/" || true
    say "ถอยกลับสี $2 แล้ว"
    ;;

  bootstrap)
    take_lock
    say "ยกสแตก $FORMULA_PREFIX ขึ้นทั้งชุด"
    $COMPOSE up -d
    wait_healthy blue
    wait_healthy green
    verify_color blue || { say "สี blue ไม่ผ่านด่าน"; exit 1; }
    verify_color green || { say "สี green ไม่ผ่านด่าน"; exit 1; }

    # ด่านเทียบสองสีต่อท้าย — จำเป็นเพราะ verify_color ไม่มีข้อที่เทียบ "ของที่เสิร์ฟจริง
    # กับไฟล์บนดิสก์" · คำสั่งข้างบนคือ `compose up -d` เฉย ๆ ไม่มี --force-recreate
    # คอนเทนเนอร์ที่ขึ้นอยู่แล้วจึงไม่ถูกสร้างใหม่ และยังเสิร์ฟไฟล์ฉบับเก่าต่อไปเงียบ ๆ
    # ถึงจะแก้ไฟล์บนดิสก์ไปแล้วก็ตาม (เจอจริง 24 ส.ค. บน testlab)
    #
    # จงใจไม่เติม --force-recreate ให้ bootstrap — คุณสมบัติที่ต้องรักษาคือ
    # "bootstrap ไม่ล้มของที่ยังดีอยู่" ถ้าให้มัน recreate ทั้งชุด ทั้งสองสีจะลงพร้อมกัน
    # ตอนที่คนกำลังใช้งานอยู่ ซึ่งแย่กว่าปัญหาที่แก้ · ตรวจแล้วบอกให้คนไปสั่ง prepare เอง
    #
    # และไม่ปล่อยให้เป็นขั้นตอนที่คนต้องจำ — ขั้นตอนที่คนต้องจำ คือขั้นตอนที่จะถูกลืม
    # ในคืนที่ระบบล่ม ซึ่งเป็นคืนเดียวที่มันสำคัญ
    if sh "$REPO_DIR/scripts/verify-formula-parity.sh" "$FORMULA_PREFIX"; then
      say "ทั้งสองสีผ่านด่าน · สีที่ใช้อยู่=$(active_color)"
    else
      say "คอนเทนเนอร์ขึ้นครบและผ่านด่านรายสีแล้ว แต่ด่านเทียบสองสีไม่ผ่าน"
      say "ระบบใช้งานได้อยู่ — ไม่ต้องไปรื้ออย่างอื่น"
      say "ถ้าข้อที่ตกคือ 'เสิร์ฟไม่ตรงกับไฟล์บนดิสก์' แปลว่าคอนเทนเนอร์ยังถือไฟล์เก่า"
      say "แก้ด้วย: sh scripts/blue-green-formula.sh prepare <สีที่ไม่ได้ให้บริการ> แล้วสลับ"
      exit 1
    fi
    ;;

  *)
    say "ไม่รู้จักคำสั่ง '$CMD' — ใช้: active | status | verify <สี> | prepare <สี> | switch <สี> | rollback <สี> | bootstrap"
    exit 2
    ;;
esac
