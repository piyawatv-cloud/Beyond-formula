#!/bin/sh
# ปล่อยของพร้อมทางถอย — Formula Studio runtime
#
# ลำดับที่ห้ามสลับ:
#   1. เทสต์ต้องเขียว                    (ถูกที่สุด ล้มก่อนแตะอะไรทั้งนั้น)
#   2. นโยบายในฐานต้องครบอยู่แล้ว        (ถ้าพังอยู่ก่อน อย่าเพิ่งปล่อยของทับ)
#   3. สำรองข้อมูล + ตรวจ checksum       (จุดกู้คืนที่ยืนยันแล้ว ก่อนของที่ถอยยาก)
#   4. เตรียมสีสำรอง แล้วตรวจด่านรายสี   (ด่านก่อนสลับคือ "รอ")
#   5. สลับ                              (ด่านหลังสลับคือ "ถอย" — blue-green ถอยเองอัตโนมัติ)
#   6. เตรียมสีเก่าให้เท่ากัน + เทียบสองสี
#   7. บันทึกหลักฐานการปล่อยของ
#
# ห้ามผ่อนด่านข้อไหนเพื่อให้ผ่าน (กฎ 4.4) · ถ้าต้องข้ามจริง ให้ข้ามด้วยมือทีละคำสั่ง
# แล้วเขียนไว้ในเอกสารส่งมอบว่าข้ามอะไรและเพราะอะไร ไม่ใช่แก้สคริปต์นี้
#
# ใช้: sh scripts/safe-deploy-formula.sh
set -eu

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STACK=formula
[ "${1:-}" = --stack ] && { STACK="${2:?ต้องระบุชื่อสแตก}"; }

STATE_ROOT="${FORMULA_STATE_ROOT_OVERRIDE:-$HOME/.hermes/apps/formula-studio}"
EVIDENCE_DIR="$STATE_ROOT/releases"
STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
LOCAL_TIME="$(TZ=Asia/Bangkok date '+%Y-%m-%dT%H:%M:%S%z')"

if [ "$STACK" != formula ]; then
  echo "หยุด: มีแต่สแตก formula (formulatest ถูกลบแล้ว 3 ต.ค. 2569)" >&2
  exit 2
fi
STACK_ENV="$REPO_DIR/runtime/stack.env"
BG="FORMULA_STACK_ENV=$STACK_ENV sh $REPO_DIR/scripts/blue-green-formula.sh"

mkdir -p "$EVIDENCE_DIR"
EVIDENCE="$EVIDENCE_DIR/$STAMP-$STACK.txt"

say()  { printf '%s %s\n' "$(TZ=Asia/Bangkok date '+%H:%M:%S')" "$*" | tee -a "$EVIDENCE"; }
step() { say ""; say "=== $* ==="; }
die()  { say "หยุด: $*"; say "หลักฐานถึงจุดที่หยุด: $EVIDENCE"; exit 1; }

say "ปล่อยของ สแตก=$STACK เวลา=$LOCAL_TIME"
say "คอมมิต=$(git -C "$REPO_DIR" rev-parse --short HEAD) ($(git -C "$REPO_DIR" log -1 --format=%s))"
DIRTY="$(git -C "$REPO_DIR" status --short || true)"
if [ -n "$DIRTY" ]; then
  # ไม่ห้าม เพราะไฟล์ env และ releases/ ไม่เข้า git โดยตั้งใจ
  # แต่ต้องบันทึกไว้ เพราะ proxy ถูก mount ตรง — สิ่งที่ขึ้นระบบคือ "ไฟล์บนดิสก์"
  # ไม่ใช่ "สิ่งที่ commit ไว้" ถ้าสองอย่างนี้ต่างกัน คนอ่านย้อนหลังต้องรู้
  say "เตือน: มีไฟล์ที่ยังไม่ commit — สิ่งที่ขึ้นระบบคือไฟล์บนดิสก์ ไม่ใช่ที่ commit ไว้"
  printf '%s\n' "$DIRTY" | sed 's/^/    /' | tee -a "$EVIDENCE"
fi

step "1. เทสต์"
# โหลดเครื่องสูง (ชุดเทสต์อื่นบน iMac เครื่องเดียวกัน) ทำให้เทสต์จับเวลา (Chromium, SQL CAS) หลุด
# แล้วต้องรันด่านซ้ำ (16 ต.ค. 2569 สองรอบ) — "รอ" ให้โหลดลง ไม่ใช่ "ผ่อน" ด่าน (กฎ 4.4):
# รอสูงสุด 15 นาที แล้วเดินต่อทุกกรณี เทสต์ยังต้องเขียวครบเหมือนเดิม
LOAD_LIMIT="${FORMULA_DEPLOY_LOAD_LIMIT:-8}"
WAITED=0
while :; do
  LOAD1="$(sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}')"
  [ -n "$LOAD1" ] || LOAD1="$(awk '{print $1}' /proc/loadavg 2>/dev/null || true)"
  [ -n "$LOAD1" ] || break
  if awk -v l="$LOAD1" -v m="$LOAD_LIMIT" 'BEGIN{exit !(l > m)}'; then
    if [ "$WAITED" -ge 900 ]; then say "เตือน: โหลดเครื่องยังสูง ($LOAD1) หลังรอ 15 นาที — เริ่มเทสต์ทั้งที่เทสต์จับเวลาอาจหลุด"; break; fi
    [ "$WAITED" -eq 0 ] && say "โหลดเครื่องสูง ($LOAD1 > $LOAD_LIMIT) — รอให้ลงก่อนเริ่มเทสต์ (สูงสุด 15 นาที)"
    sleep 30; WAITED=$((WAITED + 30))
  else
    [ "$WAITED" -gt 0 ] && say "โหลดเครื่องลงแล้ว ($LOAD1) หลังรอ ${WAITED} วินาที"
    break
  fi
done
if ! ( cd "$REPO_DIR" && node --test --test-concurrency=1 tests/*.test.mjs >>"$EVIDENCE" 2>&1 ); then
  tail -20 "$EVIDENCE"
  die "เทสต์ไม่ผ่าน"
fi
say "เทสต์ผ่านทั้งหมด"

# รันคำสั่ง แสดงผลให้เห็น เก็บลงหลักฐาน และ "คืนค่าของคำสั่งนั้นจริง ๆ"
#
# รูปแบบเดิมคือ `คำสั่ง 2>&1 | tee -a "$EVIDENCE" | sed 's/^/  /' || die "..."`
# ซึ่งในเชลล์ `||` ดูค่าคืนของคำสั่งสุดท้ายในท่อ = `sed` ซึ่งสำเร็จเสมอ
# ผลคือด่านขั้นสำรองข้อมูล ขั้นเตรียมสี และขั้นสลับ **ไม่เคยหยุดอะไรเลย**
# สคริปต์เดินต่อไปจนพิมพ์ว่า "ปล่อยของเสร็จ" ได้ทั้งที่สำรองข้อมูลไม่ผ่าน checksum
# หรือสีสำรองไม่ผ่านด่าน · /bin/sh ไม่มี pipefail จึงต้องเขียนแบบนี้แทน
run_step() {
  OUT="$(mktemp)"
  if "$@" >"$OUT" 2>&1; then
    RC=0
  else
    RC=$?
  fi
  tee -a "$EVIDENCE" < "$OUT" | sed 's/^/  /'
  rm -f "$OUT"
  return "$RC"
}

# ด่านสิทธิ์: ถ้ายังเปิดบังคับ IAM อยู่ ต้องมีคนที่ IAM ยอมให้เขียนจริงอย่างน้อยหนึ่งคน
#
# เคสจริง 19-21 ก.ย. 2026: cutover สำเร็จทุกด่าน ทั้งที่ IAM ปฏิเสธ FORMULA_EDIT ของทุกคน
# ผลคือขึ้นระบบแล้วทั้งองค์กรกลายเป็นอ่านอย่างเดียว โดยไม่มีด่านไหนทักเลย
# ตั้ง FORMULA_EDIT_PROBE_USER เป็น central_user_id ของบัญชีตัวอย่างที่ต้องเขียนได้
step "1.5 สิทธิ์เขียนของบัญชีตัวอย่าง"
PROBE="${FORMULA_EDIT_PROBE_USER:-}"
# ค่าปกติตั้งไว้ใน stack.env ไม่ใช่ใน shell ที่รันสคริปต์ จึงต้องอ่านจากไฟล์ด้วย
[ -n "$PROBE" ] || PROBE="$(sed -n 's/^FORMULA_EDIT_PROBE_USER=//p' "$STACK_ENV" 2>/dev/null | tr -d ' \r\n' || true)"
IAM_ENFORCED="$(docker exec "formula-runtime-$(eval "$BG active" 2>/dev/null | tr -d ' \n')" printenv FORMULA_IAM_ENFORCE 2>/dev/null | tr -d ' \n' || true)"
if [ "$IAM_ENFORCED" = "false" ]; then
  say "ข้าม: ปิดการบังคับ IAM ไว้ (FORMULA_IAM_ENFORCE=false) — สิทธิ์คุมด้วย can()/requirePerm() ของแอป"
elif [ -z "$PROBE" ]; then
  say "เตือน: ไม่ได้ตั้ง FORMULA_EDIT_PROBE_USER จึงตรวจไม่ได้ว่ามีใครเขียนได้จริง"
else
  PROBE_OUT="$(docker exec "formula-runtime-$(eval "$BG active" 2>/dev/null | tr -d ' \n')" node -e '
    const {createHmac}=require("crypto");
    const p="/consumer/v1/permission-check";
    const b=JSON.stringify({central_user_id:process.argv[1],system_code:"FORMULA",required_permission:"FORMULA_EDIT",record_scope:"ALL"});
    const ts=String(Math.floor(Date.now()/1000));
    const h={"content-type":"application/json","x-iam-consumer":process.env.IAM_CONSUMER_NAME,"x-iam-timestamp":ts,
      "x-iam-signature":createHmac("sha256",process.env.IAM_CONSUMER_SHARED_SECRET).update(`POST\n${p}\n${ts}\n${b}`).digest("hex"),
      "CF-Access-Client-Id":process.env.IAM_ACCESS_CLIENT_ID,"CF-Access-Client-Secret":process.env.IAM_ACCESS_CLIENT_SECRET};
    fetch(process.env.IAM_CONSUMER_ORIGIN+p,{method:"POST",headers:h,body:b})
      .then(async r=>{const j=await r.json().catch(()=>({}));console.log(r.status===200&&j.allowed===true?"allowed":("denied:"+(j.reason_code||r.status)));})
      .catch(e=>console.log("unreachable:"+e.message));' "$PROBE" 2>/dev/null | tr -d ' \n' || true)"
  case "$PROBE_OUT" in
    allowed) say "ผ่าน: IAM ให้บัญชีตัวอย่างเขียนได้" ;;
    denied:*) die "IAM ปฏิเสธสิทธิ์เขียนของบัญชีตัวอย่าง ($PROBE_OUT) — ปล่อยของไปก็จะกลายเป็นอ่านอย่างเดียวทั้งองค์กร" ;;
    *) die "ถาม IAM เรื่องสิทธิ์เขียนไม่ได้ ($PROBE_OUT) — ไม่ปล่อยของโดยไม่รู้ว่าคนจะเขียนได้หรือไม่" ;;
  esac
fi

step "2. นโยบายในฐาน (ก่อนปล่อยของ)"
run_step sh "$REPO_DIR/scripts/verify-data-policy.sh" \
  || die "นโยบายในฐานไม่ครบอยู่แล้วตั้งแต่ก่อนปล่อยของ — แก้ตรงนั้นก่อน (รัน runtime/data-policy.sql)"

step "3. สำรองข้อมูลก่อนปล่อย (predeploy)"
# A deploy requires its own verified recovery point.  The predeploy mode
# fails if another backup owns the lock; the default manual mode may skip.
run_step sh "$REPO_DIR/scripts/backup-formula.sh" predeploy \
  || die "สำรองข้อมูลไม่สำเร็จหรือตรวจ checksum ไม่ผ่าน — ไม่ปล่อยของโดยไม่มีจุดกู้คืนที่ยืนยันแล้ว"

ACTIVE="$(eval "$BG active" 2>/dev/null | tr -d ' \n')"
# อ่านไม่ได้ = ไม่รู้ว่ากำลังจะสลับจากอะไรไปอะไร · เดาแล้วอาจ "สลับ" ไปสีที่ให้บริการอยู่
# และบรรทัดบอกทางถอยท้ายไฟล์จะกลายเป็นคำสั่งที่ใช้ไม่ได้ตอนที่ต้องใช้จริง
case "$ACTIVE" in
  blue) TARGET=green ;;
  green) TARGET=blue ;;
  *) die "อ่านสีที่ให้บริการอยู่ไม่ได้ (ได้ '$ACTIVE') — ไม่เดา" ;;
esac
say "สีที่ให้บริการอยู่=$ACTIVE · จะเตรียมและสลับไปสี=$TARGET"

step "4. เตรียมสี $TARGET"
run_step sh -c "$BG prepare $TARGET" \
  || die "สี $TARGET ไม่ผ่านด่าน — ยังไม่สลับ ของเดิมยังให้บริการอยู่ตามปกติ"

step "5. สลับไปสี $TARGET"
run_step sh -c "$BG switch $TARGET" \
  || die "สลับไม่สำเร็จ — blue-green ถอยกลับสี $ACTIVE ให้แล้วโดยอัตโนมัติ ตรวจว่าเว็บใช้งานได้"

step "6. เตรียมสี $ACTIVE ให้รันโค้ดเดียวกัน"
run_step sh -c "$BG prepare $ACTIVE" \
  || say "เตือน: เตรียมสี $ACTIVE ไม่สำเร็จ — สีที่ให้บริการยังปกติ แต่ตอนนี้ไม่มีสีสำรองที่พร้อมถอย"

step "7. เทียบสองสี"
if ! run_step sh "$REPO_DIR/scripts/verify-formula-parity.sh" "$STACK"; then
  say "เตือน: สองสีไม่ตรงกัน — ยังไม่ถอย เพราะสีที่ให้บริการผ่านด่านมาแล้ว"
  say "แต่ห้ามปล่อยรอบถัดไปจนกว่าจะแก้ให้ตรงกัน (กฎ 4.1)"
fi

step "8. ตรวจซ้ำหลังปล่อยของ"
run_step sh "$REPO_DIR/scripts/verify-data-policy.sh" || say "เตือน: นโยบายในฐานไม่ครบหลังปล่อยของ — ตรวจทันที"
if [ "$STACK" = formula ]; then
  PUBLIC_ACCESS="$(sh "$REPO_DIR/scripts/check-public-access.sh" https://formula.beyond-workflow.com/ || true)"
  say "$PUBLIC_ACCESS"
  case "$PUBLIC_ACCESS" in
    public-access=ok*|public-access=expected-access-redirect*) ;;
    *) say "เตือน: $PUBLIC_ACCESS — ตรวจ cloudflared หรือ Cloudflare Access" ;;
  esac
  # ประตูสร้างโปรไฟล์ของ OPC ต้องเปิดทั้งสองสี — ปิดเงียบ = หน้าเพิ่มผู้ใช้ของ OPC ทำงานกับ Formula ไม่ได้
  for PORT_VAR in FORMULA_BLUE_PORT FORMULA_GREEN_PORT; do
    PORT="$(sed -n "s/^$PORT_VAR=//p" "$STACK_ENV" | tr -d ' \r\n')"
    GW="$(curl -sS --max-time 10 "http://127.0.0.1:$PORT/__formula/health" 2>/dev/null | grep -o '"provisioningGateway":[a-z]*' || true)"
    if [ "$GW" = '"provisioningGateway":true' ]; then
      say "ประตูสร้างโปรไฟล์ของ OPC เปิดอยู่ (พอร์ต $PORT)"
    else
      say "เตือน: ประตูสร้างโปรไฟล์ของ OPC ปิดอยู่ที่พอร์ต $PORT ($GW) — ตรวจ Keychain beyond-workflow.formula.provisioning"
    fi
  done
fi

say ""
say "ปล่อยของเสร็จ · สีที่ให้บริการ=$TARGET"
# ด่าน 6 เตรียมสีเดิมให้รันโค้ดใหม่ไปแล้ว — rollback สีอย่างเดียวจึงไม่ได้พาโค้ดเก่ากลับมา (3 ต.ค. 2569)
say "ถ้าต้องถอย: ทั้งสองสีรันรุ่นใหม่แล้ว — สลับสีอย่างเดียวไม่ใช่การถอยโค้ด"
say "  ชี้ releases/CURRENT กลับรุ่นเดิม + เอา runtime/formula-proxy.mjs ของ commit เดิมกลับ แล้ว prepare/switch สี $ACTIVE"
say "  ขั้นตอนเต็ม: docs/handoff/2026-10-03-production-deploy-D1-D2.md หัวข้อ Rollback"
say "หลักฐาน (จะถูกตั้งเป็นอ่านอย่างเดียวหลังจากบรรทัดนี้): $EVIDENCE"
# ตั้งอ่านอย่างเดียวเป็นคำสั่งสุดท้ายจริง ๆ — เขียนอะไรหลังจากนี้ tee จะขึ้น Permission denied
chmod 444 "$EVIDENCE" 2>/dev/null || true
