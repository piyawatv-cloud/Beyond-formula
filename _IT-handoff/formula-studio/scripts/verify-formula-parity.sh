#!/bin/sh
# ด่านเทียบสองสี — อ่านอย่างเดียว ไม่สตาร์ต ไม่หยุด ไม่แก้อะไรทั้งสิ้น
#
# ตรวจ 5 อย่าง แต่ละอย่างมีที่มาจากเหตุจริงในระบบ OPC:
#   1. image  — สองสีต้องรัน image เดียวกัน
#   2. env    — ค่าที่กำหนดพฤติกรรมต้องตรงกัน (ไม่งั้นสลับสีแล้วพฤติกรรมเปลี่ยน)
#   3. mount  — รายชื่อไฟล์ในคอนเทนเนอร์ต้องเหมือนกัน (ลืม mount สีเดียว = สีนั้นวนรีสตาร์ต)
#   4. serve  — สิ่งที่ "เสิร์ฟออกมาจริง" ต้องเท่ากันไบต์ต่อไบต์
#   5. disk   — สิ่งที่เสิร์ฟต้องตรงกับไฟล์บนดิสก์ ณ ตอนนี้
#               ข้อนี้ข้อเดียวที่จับได้ว่าโปรเซสยังรันโค้ดเก่ากว่าไฟล์ที่เราเพิ่งแก้
#
# ออก: 0 = ผ่าน · 1 = ไม่ผ่าน · 2 = ติดต่อ docker ไม่ได้
#
# ใช้: sh scripts/verify-formula-parity.sh [prefix]      (ไม่ใส่ = formula)

set -eu

PREFIX="${1:-formula}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BLUE="$PREFIX-runtime-blue"
GREEN="$PREFIX-runtime-green"
FAIL=0

# หา docker socket ให้ครบทุกที่ก่อนสรุปว่าติดต่อไม่ได้
# (colima ย้าย socket มาแล้วครั้งหนึ่ง และเกือบทำให้ตัวเฝ้ารีสตาร์ตเครื่องที่ยังดีอยู่ทุก 5 นาที)
if ! docker info >/dev/null 2>&1; then
  for CANDIDATE in "$HOME/.colima/default/docker.sock" "$HOME/.colima/docker.sock" /var/run/docker.sock; do
    if [ -S "$CANDIDATE" ]; then
      DOCKER_HOST="unix://$CANDIDATE"
      export DOCKER_HOST
      docker info >/dev/null 2>&1 && break
    fi
  done
fi
docker info >/dev/null 2>&1 || { echo "parity status=unknown why=ติดต่อ docker ไม่ได้"; exit 2; }

bad() { echo "  ไม่ผ่าน: $*"; FAIL=1; }
good() { echo "  ผ่าน: $*"; }

for NAME in "$BLUE" "$GREEN"; do
  docker inspect "$NAME" >/dev/null 2>&1 || { echo "parity status=fail why=ไม่พบคอนเทนเนอร์ $NAME"; exit 1; }
done

echo "parity prefix=$PREFIX"

# ---- 1. image ----
IMG_B="$(docker inspect -f '{{.Image}}' "$BLUE")"
IMG_G="$(docker inspect -f '{{.Image}}' "$GREEN")"
[ "$IMG_B" = "$IMG_G" ] && good "image ตรงกัน" || bad "image ต่างกัน ($IMG_B / $IMG_G)"

# ---- 2. env ที่กำหนดพฤติกรรม ----
env_of() {
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" \
    | grep -E '^(FORMULA_RELEASE_DIR|FORMULA_ASSET_DIR|FORMULA_PUBLIC_ORIGIN|FORMULA_JOB_INTAKE_DIR|FORMULA_BACKEND|FORMULA_TRAFFIC_MODE|SB_ORIGIN|SB_REST_BASE|SB_UPSTREAM_AUTH)=' \
    | sort
}
env_of "$BLUE" > "$TMP/env-blue"
env_of "$GREEN" > "$TMP/env-green"
if cmp -s "$TMP/env-blue" "$TMP/env-green"; then
  good "ค่า env ที่กำหนดพฤติกรรมตรงกัน"
else
  bad "ค่า env ต่างกัน"
  echo "  ค่า env ถูกปกปิด — ตรวจ configuration ผ่านช่องทางที่อนุมัติ"
fi
# ความลับต้อง "มีทั้งคู่" และ "เท่ากัน" แต่ไม่พิมพ์ค่าออกมา
# กุญแจเซ็นเซสชันสำคัญที่สุด: ถ้าสองสีถือคนละดอก พอสลับสีปุ๊บ ทุกคนหลุดออกจากระบบทันที
secret_hash() { docker exec "$1" sh -c "printf %s \"\$$2\" | sha256sum | cut -c1-16"; }
SEC_B="$(secret_hash "$BLUE" FORMULA_SESSION_SECRET)"
SEC_G="$(secret_hash "$GREEN" FORMULA_SESSION_SECRET)"
[ -n "$SEC_B" ] && [ "$SEC_B" != "$(printf '' | shasum -a 256 | cut -c1-16)" ] && [ "$SEC_B" = "$SEC_G" ] \
  && good "กุญแจเซ็นเซสชันตรงกันทั้งสองสี (สลับสีแล้วผู้ใช้ไม่หลุด)" \
  || bad "กุญแจเซ็นเซสชันไม่ตรงกันหรือว่างเปล่า — สลับสีเมื่อไหร่ทุกคนหลุดออกจากระบบ"
PRB_B="$(secret_hash "$BLUE" FORMULA_PROBE_TOKEN)"
PRB_G="$(secret_hash "$GREEN" FORMULA_PROBE_TOKEN)"
[ "$PRB_B" = "$PRB_G" ] && good "โทเคนของด่านตรวจตรงกัน" || bad "โทเคนของด่านตรวจไม่ตรงกัน"
OPC_B="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$BLUE" | grep -c '^OPC_LOGIN_ORIGIN=http' || true)"
OPC_G="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$GREEN" | grep -c '^OPC_LOGIN_ORIGIN=http' || true)"
[ "$OPC_B" = "1" ] && [ "$OPC_G" = "1" ] && good "ทั้งสองสีรู้ปลายทางล็อกอินของ OPC" || bad "มีสีที่ไม่รู้ปลายทางล็อกอินของ OPC"

# ---- 3. รายชื่อไฟล์ที่ mount ----
mounts_of() { docker exec "$1" sh -c 'ls -1 /assets /proxy /release 2>/dev/null' | sort; }
mounts_of "$BLUE" > "$TMP/mounts-blue"
mounts_of "$GREEN" > "$TMP/mounts-green"
if cmp -s "$TMP/mounts-blue" "$TMP/mounts-green"; then
  good "รายชื่อไฟล์ที่ mount ตรงกัน"
else
  bad "รายชื่อไฟล์ที่ mount ต่างกัน — สีที่ขาดไฟล์จะเสียฟีเจอร์หรือวนรีสตาร์ต"
  diff "$TMP/mounts-blue" "$TMP/mounts-green" || true
fi

# ---- 4. สิ่งที่เสิร์ฟออกมาจริง ----
port_of() { docker inspect -f '{{range $p, $c := .NetworkSettings.Ports}}{{range $c}}{{.HostPort}}{{end}}{{end}}' "$1"; }
PORT_B="$(port_of "$BLUE")"
PORT_G="$(port_of "$GREEN")"

health_of() { curl -sS --max-time 10 "http://127.0.0.1:$1/__formula/health"; }
HEALTH_B="$(health_of "$PORT_B")"
HEALTH_G="$(health_of "$PORT_G")"

field() { printf '%s' "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p"; }

# A configured standby is intentionally data-inert, not a failed serving asset.
# Report this before page/data checks; parity is not approval to clear the gate.
for COLOR in blue green; do
  case "$COLOR" in blue) COLOR_HEALTH="$HEALTH_B" ;; green) COLOR_HEALTH="$HEALTH_G" ;; esac
  if printf '%s' "$COLOR_HEALTH" | grep -Eq '"(servingEligible|trafficMode|backendConfiguration)"'; then
    BACKEND="$(field "$COLOR_HEALTH" configuredBackend)"
    case "$BACKEND" in local|supabase) : ;; *) BACKEND=unknown ;; esac
    if ! printf '%s' "$COLOR_HEALTH" | grep -Eq '"servingEligible"[[:space:]]*:[[:space:]]*true' \
      || [ "$(field "$COLOR_HEALTH" trafficMode)" != serving ] \
      || [ "$(field "$COLOR_HEALTH" backendConfiguration)" != valid ]; then
      bad "สี $COLOR backend=$BACKEND เป็น standby หรือ configuration ไม่พร้อม — ยังใช้รับผู้ใช้/rollback ไม่ได้"
      echo "parity status=fail why=traffic-ineligible"
      exit 1
    fi
  fi
done

REL_B="$(field "$HEALTH_B" release)"; REL_G="$(field "$HEALTH_G" release)"
GW_B="$(field "$HEALTH_B" gateway)"; GW_G="$(field "$HEALTH_G" gateway)"
SRC_B="$(field "$HEALTH_B" proxySourceSha)"; SRC_G="$(field "$HEALTH_G" proxySourceSha)"

# โหมดตัวตนต้องตรงกันทั้งสองสี: สีหนึ่งรับ session ของ IAM อีกสีรับ fs_session = ผู้ใช้หลุด/สิทธิ์ต่างกันตามสีที่โดน
# sed -E: /usr/bin/sed บน macOS ไม่รู้จัก \| ในแบบ basic — แบบเดิมคืนค่าว่างทั้งสองสีแล้ว "ผ่าน" เสมอ
bool_field() { printf '%s' "$1" | sed -En "s/.*\"$2\":(true|false).*/\1/p"; }
AUTH_B="$(field "$HEALTH_B" authMode)"; AUTH_G="$(field "$HEALTH_G" authMode)"
IAMM_B="$(bool_field "$HEALTH_B" iamSessionMode)"; IAMM_G="$(bool_field "$HEALTH_G" iamSessionMode)"
PROV_B="$(bool_field "$HEALTH_B" provisioningGateway)"; PROV_G="$(bool_field "$HEALTH_G" provisioningGateway)"
# รุ่นที่ประกาศ authMode=iam-session ต้องบอกค่าทั้งสองช่อง — ว่างคือ "ตรวจไม่ได้" ไม่ใช่ "ตรงกัน"
if [ "$AUTH_B" = iam-session ] || [ "$AUTH_G" = iam-session ]; then
  [ -n "$IAMM_B" ] && [ -n "$IAMM_G" ] && [ -n "$PROV_B" ] && [ -n "$PROV_G" ] \
    || bad "อ่านโหมดตัวตนจาก health ไม่ได้ (blue=$IAMM_B/$PROV_B green=$IAMM_G/$PROV_G)"
fi
[ "$AUTH_B|$IAMM_B|$PROV_B" = "$AUTH_G|$IAMM_G|$PROV_G" ] \
  && good "โหมดตัวตนตรงกันทั้งสองสี ($AUTH_B)" \
  || bad "โหมดตัวตนต่างกัน (blue=$AUTH_B/$IAMM_B/$PROV_B green=$AUTH_G/$IAMM_G/$PROV_G)"
[ "$REL_B" = "$REL_G" ] && good "รุ่นที่เสิร์ฟตรงกัน ($REL_B)" || bad "รุ่นที่เสิร์ฟต่างกัน ($REL_B / $REL_G)"
[ "$GW_B" = rewritten ] && [ "$GW_G" = rewritten ] \
  && good "ประตูข้อมูลถูกต่อสายครบทั้งสองสี" \
  || bad "ประตูข้อมูลไม่ถูกต่อสาย (blue=$GW_B green=$GW_G) — สีนี้จะเปิดหน้าได้แต่ใช้งานจริงไม่ได้"

body_sha() { curl -sS --max-time 20 "http://127.0.0.1:$1$2" | shasum -a 256 | cut -d' ' -f1; }
HTML_B="$(body_sha "$PORT_B" /)"
HTML_G="$(body_sha "$PORT_G" /)"
# หน้าเว็บของสองสีต่างกันได้แค่คำว่า blue/green ในแท็ก fs-shell — จึงเทียบหลังตัดคำนั้นออก
norm_html() { curl -sS --max-time 20 "http://127.0.0.1:$1/" | sed 's/sealed:[0-9a-f]*:[a-z]*/sealed:X:X/' | shasum -a 256 | cut -d' ' -f1; }
[ "$(norm_html "$PORT_B")" = "$(norm_html "$PORT_G")" ] \
  && good "หน้าเว็บที่เสิร์ฟเหมือนกันไบต์ต่อไบต์" \
  || bad "หน้าเว็บที่เสิร์ฟต่างกัน ($HTML_B / $HTML_G)"

# ---- 5. เทียบของที่เสิร์ฟกับไฟล์บนดิสก์ ----
DISK_SRC="$(shasum -a 256 "$REPO_DIR/runtime/formula-proxy.mjs" | cut -d' ' -f1)"
if [ "$SRC_B" = "$DISK_SRC" ] && [ "$SRC_G" = "$DISK_SRC" ]; then
  good "โปรเซสทั้งสองสีรันซอร์สรุ่นเดียวกับไฟล์บนดิสก์"
else
  SHORT() { printf '%s' "$1" | cut -c1-12; }
  bad "โปรเซสรันซอร์สเก่ากว่าไฟล์บนดิสก์ — ต้อง recreate คอนเทนเนอร์ (blue=$(SHORT "$SRC_B") green=$(SHORT "$SRC_G") disk=$(SHORT "$DISK_SRC"))"
fi

DISK_REL="$(cat "$REPO_DIR/releases/CURRENT" 2>/dev/null || echo unknown)"
INTAKE_DISK="$(shasum -a 256 "$REPO_DIR/runtime/job-intake.mjs" | cut -d' ' -f1)"
INTAKE_B="$(field "$HEALTH_B" jobIntakeSourceSha)"; INTAKE_G="$(field "$HEALTH_G" jobIntakeSourceSha)"
[ "$INTAKE_B" = "$INTAKE_DISK" ] && [ "$INTAKE_G" = "$INTAKE_DISK" ] \
  && good "ตัวรับข้อมูลใบงานทั้งสองสีตรงกับ source ที่อนุมัติ" \
  || bad "ตัวรับข้อมูลใบงานที่รันไม่ตรงกับ source บนดิสก์"
[ "$(field "$HEALTH_B" jobIntake)" = ready ] && [ "$(field "$HEALTH_G" jobIntake)" = ready ] \
  && good "ที่รับข้อมูลกลางพร้อมทั้งสองสี" \
  || bad "มีสีที่ยังไม่เปิดหรือไม่พร้อมรับข้อมูลใบงาน"
[ "$REL_B" = "$DISK_REL" ] \
  && good "รุ่นที่เสิร์ฟตรงกับ releases/CURRENT ($DISK_REL)" \
  || bad "รุ่นที่เสิร์ฟ ($REL_B) ไม่ตรงกับ releases/CURRENT ($DISK_REL)"

# ไฟล์เสริมทุกตัว: ที่เสิร์ฟออกมา ต้องตรงกับไฟล์ในโฟลเดอร์ assets ตอนนี้
for FILE in "$REPO_DIR"/runtime/assets/fs-*; do
  [ -f "$FILE" ] || continue
  BASE="$(basename "$FILE")"
  ROUTE="/$BASE"
  DISK="$(shasum -a 256 "$FILE" | cut -d' ' -f1)"
  SERVED_B="$(body_sha "$PORT_B" "$ROUTE")"
  SERVED_G="$(body_sha "$PORT_G" "$ROUTE")"
  if [ "$SERVED_B" = "$DISK" ] && [ "$SERVED_G" = "$DISK" ]; then
    good "$BASE ที่เสิร์ฟตรงกับไฟล์บนดิสก์ทั้งสองสี"
  else
    bad "$BASE ที่เสิร์ฟไม่ตรงกับไฟล์บนดิสก์ (blue/green/disk ไม่เท่ากัน)"
  fi
done

if [ "$FAIL" -eq 0 ]; then
  echo "parity status=ok"
  exit 0
fi
echo "parity status=fail why=ดูรายการ 'ไม่ผ่าน' ข้างบน"
exit 1
