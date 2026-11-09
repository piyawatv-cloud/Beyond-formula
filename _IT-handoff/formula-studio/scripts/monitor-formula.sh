#!/bin/sh
# ตัวเฝ้าระวัง Formula Studio runtime — อ่านอย่างเดียว
# (ข้อยกเว้นเดียว: ส่ง Telegram ถึงเจ้าของเมื่อพิสูจน์กู้คืนไม่ผ่าน — ส่งข้อความ ไม่ได้ซ่อมอะไร)
#
# กฎที่ห้ามผ่อน:
#   - ตัวตรวจห้ามซ่อมตัวเอง ห้ามรีสตาร์ตอะไรเพื่อให้ตัวเองผ่าน
#     (ระบบพี่น้องเคยจบลงด้วยการรีสตาร์ตวนไม่หยุด เพราะตัวตรวจแก้ไขให้ตัวเองผ่าน)
#   - ทุกบรรทัดที่ขึ้นว่าไม่ปกติ ต้องมีช่อง why= ติดไปด้วยเสมอ
#     เตือนที่บอกไม่ได้ว่าเจออะไร คือเตือนที่คนเลิกอ่านภายในสองสัปดาห์
#   - ไม่เรียก AI ไม่ต้องมี AI ก็ทำงานได้ครบ
#
# ใช้: sh scripts/monitor-formula.sh
# ออก: 0 = ปกติ · 1 = มีเรื่องต้องดู
set -eu

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_ROOT="${FORMULA_STATE_ROOT_OVERRIDE:-$HOME/.hermes/apps/formula-studio}"
REPORT_DIR="$STATE_ROOT/monitoring"
LOG_FILE="$REPORT_DIR/monitor-$(TZ=Asia/Bangkok date +%Y-%m-%d).log"
STAMP="$(TZ=Asia/Bangkok date '+%Y-%m-%dT%H:%M:%S%z')"
WINDOW_MINUTES="${FORMULA_MONITOR_WINDOW_MINUTES:-15}"
BACKUP_MAX_AGE_HOURS="${FORMULA_BACKUP_MAX_AGE_HOURS:-30}"
OFFSITE_ENABLED="${FORMULA_OFFSITE_ENABLED:-1}"
BACKUP_DESTINATION="${FORMULA_BACKUP_DESTINATION:-local}"

mkdir -p "$REPORT_DIR"
chmod 700 "$REPORT_DIR" 2>/dev/null || true

BAD=0
say()  { printf '%s %s\n' "$STAMP" "$*" | tee -a "$LOG_FILE" >/dev/null; printf '%s\n' "$*"; }
ok()   { say "ok    $*"; }
warn() { BAD=1; say "WARN  $*"; }

# ---------------------------------------------------------------------------
# 0. ผลพิสูจน์กู้คืนของงานสำรองประจำวัน + ส่ง Telegram
#
# อยู่ก่อนด่าน docker โดยตั้งใจ: งานสำรองก็ต้องใช้ docker — "docker ล่ม → สำรองล้ม" คือเหตุ
# เดียวกัน ถ้าวางไว้หลังด่านที่ exit ตอน docker ล่ม เราจะไม่เคยเตือนเรื่องนี้เลย
# ตัวตรวจอ่านแค่ไฟล์ ไม่ต้องใช้ docker
# (ด่านอายุโฟลเดอร์สำรองเดิมยังอยู่ที่ข้อ 5)
# ---------------------------------------------------------------------------
# โฟลเดอร์ใหม่ไม่ได้แปลว่าสำรองใช้ได้ — daily-backup สร้างโฟลเดอร์ก่อนพิสูจน์กู้คืนเสมอ
# เคสจริง 25 ส.ค. – 26 ก.ย. 2569: กู้คืนไม่ผ่าน 13 คืน ด่านอายุโฟลเดอร์ (ข้อ 5) ขึ้น ok ทุกคืน
# จึงต้องอ่านผลที่งานประจำวันจดไว้เองด้วย (ด่านข้อ 5 ยังอยู่ — ไม่ถอดด่านเดิมออก)
PROOF_RC=0
PROOF="$(sh "$REPO_DIR/scripts/check-backup-status.sh" "$REPORT_DIR/backup.log" 2>&1)" || PROOF_RC=$?
if [ "$PROOF_RC" = 0 ]; then
  ok "$PROOF"
else
  warn "${PROOF:-backup-proof=unknown why=ตัวตรวจผลสำรองไม่พิมพ์อะไรออกมาเลย}"
fi
# บรรทัด WARN ข้างบนไม่มีใครอ่าน — ส่ง Telegram ถึงเจ้าของตรง ๆ ไม่ผ่านโมเดล (กฎ 5.3, 7.3)
# ส่งครั้งเดียวต่อเหตุ และบอกอีกครั้งเมื่อกลับมาผ่าน · ส่งไม่ออก = ไม่จด แล้วลองใหม่รอบหน้า
ALERT_RC=0
ALERT="$(sh "$REPO_DIR/scripts/alert-backup-proof.sh" "$PROOF_RC" "$PROOF" "$REPORT_DIR" 2>&1)" || ALERT_RC=$?
if [ "$ALERT_RC" = 0 ]; then
  case "$ALERT" in backup-alert=idle|backup-alert=already-sent*) ;; *) say "$ALERT" ;; esac
else
  warn "${ALERT:-backup-alert=failed why=ตัวส่งเตือนไม่พิมพ์อะไรออกมาเลย} (ลองใหม่รอบหน้า)"
fi

# สำรองที่ผ่านแล้ว ขึ้นคลาวด์จริงไหม — ดูป้าย item-id บนไฟล์ใน Drive ไม่ใช่เชื่อ offsite.log
# เคสจริง 25 ส.ค. – 28 ก.ย. 2569: log ขึ้น ok ทุกคืน ทั้งที่ Drive gmail ค้างและไม่ได้ไฟล์เลย
# เมื่อเจ้าของพักการส่งออก (0) ให้แสดงสถานะชัดเจนโดยไม่อ่าน/เขียน Drive; ด่าน local proof
# และการเตือนกรณีกู้คืนในเครื่องล้มด้านบนยังคงทำงานเสมอ
case "$BACKUP_DESTINATION" in
  local)
    LOCAL_RC=0
    LOCAL_BACKUP="$(sh "$REPO_DIR/scripts/check-local-backup-status.sh" "$REPORT_DIR/backup.log" 2>&1)" || LOCAL_RC=$?
    if [ "$LOCAL_RC" = 0 ]; then ok "$LOCAL_BACKUP"; else warn "${LOCAL_BACKUP:-local-backup=unknown why=ตัวตรวจสำเนาใน iMac ไม่พิมพ์อะไรออกมาเลย}"; fi
    LOCAL_ALERT_RC=0
    LOCAL_ALERT="$(sh "$REPO_DIR/scripts/alert-backup-proof.sh" "$LOCAL_RC" "$LOCAL_BACKUP" "$REPORT_DIR" local 2>&1)" || LOCAL_ALERT_RC=$?
    if [ "$LOCAL_ALERT_RC" = 0 ]; then
      case "$LOCAL_ALERT" in local-backup-alert=idle|local-backup-alert=already-sent*|local-backup-alert=holding*) ;; *) say "$LOCAL_ALERT" ;; esac
    else
      warn "${LOCAL_ALERT:-local-backup-alert=failed why=ตัวส่งเตือนสำเนาใน iMac ไม่พิมพ์อะไรออกมาเลย} (ลองใหม่รอบหน้า)"
    fi
    ;;
  drive)
    case "$OFFSITE_ENABLED" in
      0)
        ok "offsite=paused reason=พักการส่งไป Google Drive ตามแผน risk=ไม่มีจุดกู้คืนที่ยืนยันแล้วนอกเครื่อง"
        ;;
      1)
        OFFSITE_RC=0
        OFFSITE="$(sh "$REPO_DIR/scripts/check-offsite-status.sh" "$REPORT_DIR/backup.log" 2>&1)" || OFFSITE_RC=$?
        if [ "$OFFSITE_RC" = 0 ]; then ok "$OFFSITE"; else warn "${OFFSITE:-offsite=unknown why=ตัวตรวจสำเนานอกเครื่องไม่พิมพ์อะไรออกมาเลย}"; fi
        OALERT_RC=0
        OALERT="$(sh "$REPO_DIR/scripts/alert-backup-proof.sh" "$OFFSITE_RC" "$OFFSITE" "$REPORT_DIR" offsite 2>&1)" || OALERT_RC=$?
        if [ "$OALERT_RC" = 0 ]; then
          case "$OALERT" in offsite-alert=idle|offsite-alert=already-sent*|offsite-alert=holding*) ;; *) say "$OALERT" ;; esac
        else
          warn "${OALERT:-offsite-alert=failed why=ตัวส่งเตือนสำเนานอกเครื่องไม่พิมพ์อะไรออกมาเลย} (ลองใหม่รอบหน้า)"
        fi
        ;;
      *) warn "offsite=unknown why=FORMULA_OFFSITE_ENABLED ต้องเป็น 0 หรือ 1" ;;
    esac
    ;;
  *)
    warn "backup-destination=unknown why=FORMULA_BACKUP_DESTINATION ต้องเป็น local หรือ drive"
    ;;
esac

# หา docker socket ให้ครบสามที่ก่อนสรุปว่า docker ตาย
# (colima ย้าย socket มาแล้วครั้งหนึ่ง และเกือบทำให้ตัวเฝ้าประกาศว่าเครื่องที่ยังดีอยู่ล่ม)
if ! docker info >/dev/null 2>&1; then
  for CANDIDATE in "$HOME/.colima/default/docker.sock" "$HOME/.colima/docker.sock" /var/run/docker.sock; do
    if [ -S "$CANDIDATE" ]; then
      DOCKER_HOST="unix://$CANDIDATE"; export DOCKER_HOST
      docker info >/dev/null 2>&1 && break
    fi
  done
fi
if ! docker info >/dev/null 2>&1; then
  warn "docker=unreachable why=ไม่เจอ docker socket ทั้งสามที่ ตรวจอย่างอื่นต่อไม่ได้"
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. คอนเทนเนอร์ทั้งสองสี และตัวรับหน้า
#
# สีสำรองที่ตายอยู่เงียบ ๆ คือเรื่องที่ต้องรู้ "ก่อน" วันที่ต้องใช้มัน ไม่ใช่ตอนนั้น
# ---------------------------------------------------------------------------
for STACK in formula; do  # formulatest removed 2026-10-03 (owner decision)
  for ROLE in blue green edge; do
    NAME="$STACK-runtime-$ROLE"
    # ตัดให้เหลือบรรทัดแรกเสมอ — docker inspect ของคอนเทนเนอร์ที่ไม่มีอยู่ พิมพ์บรรทัดว่าง
    # ออก stdout ก่อนตาย เขียนเป็น `|| echo` จึงได้ค่าสองบรรทัดที่อ่านแล้วงง
    STATUS="$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$NAME" 2>/dev/null | head -1)"
    [ -n "$STATUS" ] || STATUS="missing/none"
    case "$STATUS" in
      running/healthy|running/none) ok "container=$NAME state=$STATUS" ;;
      *) warn "container=$NAME state=$STATUS why=คอนเทนเนอร์ไม่พร้อมใช้งาน" ;;
    esac
  done
done

# ---------------------------------------------------------------------------
# 2. หน้าเว็บและประตูข้อมูลของสแตกจริง
#
# ตรวจ "ความหมาย" ไม่ใช่แค่ว่าพอร์ตเปิด — สีที่เปลี่ยนปลายทางข้อมูลไม่สำเร็จจะเปิด
# หน้าได้ตามปกติ แต่ใช้งานจริงไม่ได้เลย และคีย์อาจหลุดออกไปกับหน้าเว็บด้วย
# ---------------------------------------------------------------------------
for PORT in 3026 3027; do
  HEALTH="$(curl -sS --max-time 10 "http://127.0.0.1:$PORT/__formula/health" 2>/dev/null || echo '{}')"
  get() { printf '%s' "$HEALTH" | sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p"; }
  [ "$(get status)" = ok ] \
    && ok "proxy=$PORT status=ok สี=$(get color) รุ่น=$(get release)" \
    || warn "proxy=$PORT status=$(get status) why=proxy บอกว่าตัวเองไม่พร้อม"
  [ "$(get gateway)" = rewritten ] \
    && ok "proxy=$PORT gateway=rewritten" \
    || warn "proxy=$PORT gateway=$(get gateway) why=เปลี่ยนปลายทางข้อมูลไม่สำเร็จ หน้าเปิดได้แต่ใช้งานไม่ได้"
done

PUBLIC_ACCESS="$(sh "$REPO_DIR/scripts/check-public-access.sh" "https://formula.beyond-workflow.com/" || true)"
case "$PUBLIC_ACCESS" in
  public-access=ok*|public-access=expected-access-redirect*) ok "$PUBLIC_ACCESS" ;;
  *) warn "$PUBLIC_ACCESS" ;;
esac

if curl -sS --max-time 20 "https://formula.beyond-workflow.com/" 2>/dev/null | grep -q "sb_publishable"; then
  warn "leak=sb_publishable why=คีย์ Supabase โผล่อยู่ในหน้าเว็บที่เสิร์ฟจริง"
else
  ok "leak=none คีย์ไม่หลุดในหน้าเว็บ"
fi

# ---------------------------------------------------------------------------
# 3. นโยบายในฐานยังอยู่ครบไหม — เรียกด่านกลาง scripts/verify-data-policy.sh
#
# ทำไมต้องตรวจ: runtime/data-grants.sql ให้ `grant all` กับ anon และ data-policy.sql
# เป็นตัวเพิกถอนกลับ · ทางกู้คืนหรือทาง re-init ไหนที่รันไฟล์แรกโดยไม่รันไฟล์ที่สอง
# จะคืนสิทธิ์ TRUNCATE ให้ anon และทิ้ง trigger เก็บสำเนาไป โดย "ไม่มีอาการอะไรเลย"
# จนถึงวันที่มีคนกดลบ แล้วของหายถาวร — ด่านนี้จึงเป็นด่านเดียวที่จับเรื่องนั้นได้
# ---------------------------------------------------------------------------
POLICY_OUT="$(sh "$REPO_DIR/scripts/verify-data-policy.sh" 2>&1 || true)"
printf '%s\n' "$POLICY_OUT" | while IFS= read -r LINE; do printf '  %s\n' "$LINE"; done
case "$POLICY_OUT" in
  *"policy status=ok"*) ok "policy=ครบทุกข้อ" ;;
  *"policy status=unknown"*) warn "policy=unknown why=ติดต่อฐานไม่ได้ ตรวจนโยบายไม่ได้เลย" ;;
  *) warn "policy=fail why=นโยบายในฐานไม่ครบ ดูบรรทัด 'ไม่ผ่าน' ข้างบน" ;;
esac

# ---------------------------------------------------------------------------
# 4. ประตูข้อมูลปฏิเสธหรือกรองอะไรไปบ้างในช่วงที่ผ่านมา
#
# ไม่ใช้ตัวนับใน /__formula/health เพราะมันสะสมตั้งแต่โปรเซสเปิดตัว รีเซ็ตทุกครั้งที่
# recreate และแต่ละสีนับแยกกัน — เอาไปเทียบกับ "ช่วง 15 นาทีที่ผ่านมา" ไม่ได้เลย
#
# อ่านไฟล์สองวันเสมอ เพราะหน้าต่างเวลาคร่อมเที่ยงคืน UTC ได้ทุกวัน
# (ทั้งชื่อไฟล์และเส้นตัดเวลาคิดเป็น UTC เหมือนกัน จึงไม่มีปัญหาเรื่องเขตเวลา
#  แต่คร่อมวันได้อยู่ดี — ตอนเที่ยงคืน UTC ตรงกับ 7 โมงเช้าตามเวลาไทย)
#
# กรองด้วยช่อง stack ด้วย เพราะสองสแตกเขียนกองไฟล์เดียวกัน (mount เดียวกันโดยตั้งใจ)
# ถ้าไม่กรอง การทดลองบน testlab หนึ่งครั้งจะทำให้เตือนว่าสแตกจริงมีปัญหา
# ---------------------------------------------------------------------------
WATCH_STACK="${FORMULA_MONITOR_STACK:-formula}"
CUTOFF="$(date -u -v-"${WINDOW_MINUTES}"M '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
  || date -u -d "$WINDOW_MINUTES minutes ago" '+%Y-%m-%dT%H:%M:%SZ')"
GW_FILES="$REPORT_DIR/gateway-$(date -u '+%Y-%m-%d').ndjson $REPORT_DIR/gateway-$(date -u -v-1d '+%Y-%m-%d' 2>/dev/null || date -u -d yesterday '+%Y-%m-%d').ndjson"

# นับทีเดียวแล้วอ่านผลออกมา ไม่ต้องไล่ไฟล์ซ้ำทุกชนิด
# บรรทัดที่ไม่มีช่อง stack คือบรรทัดจาก proxy รุ่นก่อนเพิ่ม FORMULA_STACK — นับแยกไว้
# แล้วรายงาน ไม่ใช่เมินทิ้ง เพราะ "นับได้ 0 เพราะกรองผิด" หน้าตาเหมือน "ไม่มีอะไรเลย"
GW_COUNTS="$(cat $GW_FILES 2>/dev/null | awk -v cut="$CUTOFF" -v want="$WATCH_STACK" -F'"' '
  {
    at = ""; dec = ""; st = ""; stt = ""; ie = ""; tb = "";
    for (i = 1; i < NF; i++) {
      if ($i == "at") at = $(i + 2);
      if ($i == "decision") dec = $(i + 2);
      if ($i == "stack") st = $(i + 2);
      if ($i == "status") stt = $(i + 2);
      if ($i == "table") tb = $(i + 2);
      # ค่า boolean ไม่มีเครื่องหมายคำพูด: หลัง "ingredientEdit" คือ `:true,` หรือ `:false,`
      if ($i == "ingredientEdit") ie = ($(i + 1) ~ /^:true/) ? "yes" : "no";
    }
    if (at < cut) next;
    if (st == "") { nostack++; next }
    if (st != want) next;
    if (dec == "denied") d++;
    # fs_users จากแท็บที่ไม่ใช่ admin ถูกกรองทุกรอบซิงก์ (16 ต.ค. 2569: 308 ครั้ง/2 ชม.) — นับแยกเพื่อให้เห็นว่ามีแท็บค้าง
    else if (dec == "filtered") { f++; if (tb == "fs_users") uf++ }
    else if (dec == "role-change-failed" || dec == "role-change-skipped") r++;
    else if (dec == "signed-in") si++;
    # การบันทึกใบงานที่ไม่สำเร็จ — ทั้งที่ประตูหยุดไว้ก่อนรับ (job-save-blocked)
    # ที่รับแล้วปฏิเสธ (job-received สถานะไม่ใช่ saved/pending) และที่เบราว์เซอร์หยุดเอง
    # โดยไม่ส่งคำขอเลย (client-blocked) · 14 ต.ค. 2569 ผู้ใช้บันทึกไม่ได้แต่ log ว่างเปล่า
    else if (dec == "job-save-blocked") jb++;
    else if (dec == "job-received" && stt != "saved" && stt != "pending") jf++;
    else if (dec == "job-received" && stt == "saved" && ie == "yes") ied++;
    else if (dec == "client-blocked") cb++;
  }
  # ห้ามตั้งชื่อตัวนับว่า i — มันคือตัวนับรอบของลูปที่ไล่ฟิลด์ข้างบน ค่าที่ค้างอยู่คือ NF
  # ของบรรทัดนั้น แล้ว i++ จะบวกทับค่านั้นไปเรื่อย ๆ ได้ตัวเลขที่ดูสมเหตุสมผลแต่มั่วสนิท
  # (รอบแรกที่รันจริงรายงานว่ามีคนเข้าใช้งานสำเร็จ 35 ครั้ง ทั้งที่ไม่มีสักบรรทัดเดียว)
  END { printf "%d %d %d %d %d %d %d %d %d %d", d + 0, f + 0, r + 0, nostack + 0, si + 0, jb + 0, jf + 0, cb + 0, ied + 0, uf + 0 }')"
DENIED="$(printf '%s' "$GW_COUNTS" | cut -d' ' -f1)"
FILTERED="$(printf '%s' "$GW_COUNTS" | cut -d' ' -f2)"
ROLE_FAILED="$(printf '%s' "$GW_COUNTS" | cut -d' ' -f3)"
NO_STACK="$(printf '%s' "$GW_COUNTS" | cut -d' ' -f4)"
SIGNED_IN="$(printf '%s' "$GW_COUNTS" | cut -d' ' -f5)"
JOB_BLOCKED="$(printf '%s' "$GW_COUNTS" | cut -d' ' -f6)"
JOB_REFUSED="$(printf '%s' "$GW_COUNTS" | cut -d' ' -f7)"
CLIENT_BLOCKED="$(printf '%s' "$GW_COUNTS" | cut -d' ' -f8)"
INGREDIENT_EDITS="$(printf '%s' "$GW_COUNTS" | cut -d' ' -f9)"
USERS_FILTERED="$(printf '%s' "$GW_COUNTS" | cut -d' ' -f10)"

say "gateway สแตก=$WATCH_STACK หน้าต่าง ${WINDOW_MINUTES} นาที: เข้าใช้งานสำเร็จ=$SIGNED_IN ปฏิเสธ=$DENIED กรอง=$FILTERED เปลี่ยนบทบาทไม่สำเร็จ=$ROLE_FAILED บันทึกใบงานถูกหยุด=$JOB_BLOCKED/$JOB_REFUSED เบราว์เซอร์หยุดเอง=$CLIENT_BLOCKED แก้สารสำเร็จ=$INGREDIENT_EDITS"
[ "$((JOB_BLOCKED + JOB_REFUSED))" = 0 ] \
  || warn "gateway=job-save-blocked n=$((JOB_BLOCKED + JOB_REFUSED)) why=มีการบันทึกใบงานที่ถูกปฏิเสธ — อ่าน by/key/reason จาก decision=job-save-blocked และ job-received ใน gateway-<วัน>.ndjson"
[ "$CLIENT_BLOCKED" = 0 ] \
  || warn "gateway=client-blocked n=$CLIENT_BLOCKED why=เบราว์เซอร์ของผู้ใช้หยุดการบันทึก/เปิดแชตก่อนส่งคำขอ — อ่าน by/key/stage/reason จาก decision=client-blocked"
[ "$ROLE_FAILED" = 0 ] \
  || warn "gateway=role-change-failed n=$ROLE_FAILED why=admin กดเปลี่ยนบทบาทแล้วไม่ติด ค่าจะเด้งกลับเงียบ ๆ"
[ "$FILTERED" -lt 20 ] \
  || warn "gateway=filtered n=$FILTERED why=ถูกกรองมากผิดปกติ อาจมีคนพยายามทำสิ่งที่ทำไม่ได้ หรือ rpc ออกเลขงานมีปัญหา"
[ "$USERS_FILTERED" = 0 ] \
  || warn "gateway=filtered-fs_users n=$USERS_FILTERED why=แท็บของผู้ใช้ที่ไม่ใช่ admin ส่งรายชื่อผู้ใช้ขึ้นมาทุกรอบซิงก์ (สำเนาในเครื่องต่างจากของกลาง) — อ่าน by และ dropped[].fields จาก decision=filtered table=fs_users"
[ "$NO_STACK" = 0 ] \
  || warn "gateway=บรรทัดไม่มีช่อง stack n=$NO_STACK why=proxy ยังไม่ได้ recreate หลังเพิ่ม FORMULA_STACK — ตัวเลขข้างบนจึงยังไม่ครบ"

# ---------------------------------------------------------------------------
# 5. ไฟล์สำรองล่าสุดเก่าเกินไปหรือยัง
#
# สำรองที่ไม่ได้ทำ ไม่มีอาการอะไรเลยจนถึงวันที่ต้องใช้ — ซึ่งเป็นวันที่สายเกินไปแล้ว
# ---------------------------------------------------------------------------
LATEST="$(ls -1dt "$STATE_ROOT"/backups/*/*/ 2>/dev/null | head -1 || true)"
if [ -z "$LATEST" ]; then
  warn "backup=none why=ไม่มีไฟล์สำรองเลยสักชุด"
else
  AGE_H=$(( ( $(date +%s) - $(stat -f %m "$LATEST" 2>/dev/null || stat -c %Y "$LATEST") ) / 3600 ))
  [ "$AGE_H" -le "$BACKUP_MAX_AGE_HOURS" ] \
    && ok "backup=$(basename "$LATEST") อายุ=${AGE_H}ชม." \
    || warn "backup=$(basename "$LATEST") อายุ=${AGE_H}ชม. why=เกิน ${BACKUP_MAX_AGE_HOURS} ชม. งานสำรองประจำวันน่าจะไม่ได้รัน"
fi

# ---------------------------------------------------------------------------
# 5.1 ไม่มีใครเขียนข้อมูลลงฐานนานแค่ไหนแล้ว
#
# เคสจริง 19-21 ก.ย. 2026: ด่านสิทธิ์ปฏิเสธการเขียนของทุกคน แอปยังเปิดได้ ยังอ่านได้
# ทุกด่านของ monitor เดิมจึงเขียวหมด ทั้งที่ไม่มีงานขึ้นเซิร์ฟเวอร์เลยสามวัน
# เงียบแบบนี้ต้องดังตั้งแต่ชั่วโมงแรก ไม่ใช่รอให้คนมาสังเกตเอง
# ---------------------------------------------------------------------------
WRITE_MAX_AGE_HOURS="${FORMULA_WRITE_MAX_AGE_HOURS:-12}"
LAST_WRITE_EPOCH="$(docker exec formula-postgres psql -U postgres -d formula -At -c \
  "select floor(extract(epoch from greatest(coalesce(max(updated_at), 'epoch'::timestamptz), 'epoch'::timestamptz)))::bigint from fs_records" 2>/dev/null | tr -d ' \n' || true)"
case "$LAST_WRITE_EPOCH" in
  ''|*[!0-9]*)
    warn "write=unknown why=ถามฐานเรื่องเวลาที่เขียนล่าสุดไม่ได้ (formula-postgres ไม่ตอบ)" ;;
  *)
    WRITE_AGE_H=$(( ( $(date +%s) - LAST_WRITE_EPOCH ) / 3600 ))
    if [ "$WRITE_AGE_H" -le "$WRITE_MAX_AGE_HOURS" ]; then
      ok "write=fs_records เขียนล่าสุด ${WRITE_AGE_H}ชม.ที่แล้ว"
    else
      warn "write=fs_records เขียนล่าสุด ${WRITE_AGE_H}ชม.ที่แล้ว why=เกิน ${WRITE_MAX_AGE_HOURS} ชม. — อาจมีด่านสิทธิ์บล็อกการเขียนอยู่ ให้เช็ก /sb/session ว่า canEdit เป็นอะไร"
    fi ;;
esac

# ---------------------------------------------------------------------------
# 6. ล็อกช่วงเปลี่ยนผ่านค้างอยู่ไหม
#
# ล็อกที่ค้างแปลว่า edge จะหลบไม่สลับสีให้ ทั้งที่ไม่มีใครกำลังเปลี่ยนผ่านอยู่จริง
# ---------------------------------------------------------------------------
for STACK in formula; do  # formulatest removed 2026-10-03 (owner decision)
  LOCK="$STATE_ROOT/runtime-state/$STACK/transition.lock"
  if [ -d "$LOCK" ]; then
    HB="$LOCK/heartbeat"
    AGE=$(( $(date +%s) - $(stat -f %m "$HB" 2>/dev/null || stat -c %Y "$HB" 2>/dev/null || echo 0) ))
    [ "$AGE" -lt 120 ] \
      && ok "lock=$STACK กำลังเปลี่ยนผ่านอยู่จริง (heartbeat ${AGE}s)" \
      || warn "lock=$STACK ค้างมา ${AGE}s why=ไม่มีใครถือล็อกอยู่จริง แต่ edge จะหลบไม่สลับสีให้"
  else
    ok "lock=$STACK ไม่มีล็อกค้าง"
  fi
done

say "monitor status=$( [ "$BAD" = 0 ] && echo ok || echo attention )"
exit "$BAD"
