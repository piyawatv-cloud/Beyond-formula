#!/bin/sh
# ส่งสำเนาสำรองออกนอกเครื่อง — Google Drive for desktop (Drive บริษัท)
#
# ทำไมต้องมี: ฐานอยู่ใน VM ของ colima สำรองอยู่ที่ ~/.hermes ทั้งคู่อยู่บนดิสก์ลูกเดียวกัน
# ดิสก์เสียหรือเครื่องหาย = หายพร้อมกันทั้งคู่ สำรองที่อยู่ข้างของจริง ไม่ใช่สำรอง
#
# กติกา:
#   - ส่งเฉพาะชุดที่ "พิสูจน์กู้คืนผ่านแล้ว" เท่านั้น ชุดที่ยังไม่ได้ตรวจไม่ใช่จุดกู้คืน
#   - ตรวจ checksum ซ้ำ "หลังคัดลอก" ไม่ใช่เชื่อว่า cp สำเร็จแปลว่าไฟล์ถูก
#   - **ok ได้เมื่อ Drive รู้จักไฟล์แล้วเท่านั้น** (มีป้าย item-id) — checksum บอกได้แค่ว่า
#     เขียนลงดิสก์ในเครื่องแล้ว *หลักฐาน: 25 ส.ค. – 28 ก.ย. 2569 ขึ้น ok ทุกคืน ทั้งที่ Drive
#     gmail ค้างและไม่เคยได้ไฟล์เลยสักไฟล์*
#   - ไม่ลบอะไรบน Drive เลย ทั้งของเก่าและของที่ดูซ้ำ — ให้คนตัดสินใจลบเอง
#   - Drive ไม่ได้ mount = บอกแล้วออกอย่างสงบ ห้ามทำให้สำรองในเครื่องล้มตาม
#     (ตัวตรวจ check-offsite-status.sh ใน monitor จะเตือนเองถ้าค้างเกินเกณฑ์)
#
# ใช้: sh scripts/copy-backup-offsite.sh <โฟลเดอร์สำรองที่ตรวจแล้ว>
# ออก: 0 = ขึ้นคลาวด์แล้ว หรือข้ามเพราะ Drive ไม่ได้ mount · 1 = ล้ม · 2 = ไม่มีโฟลเดอร์ต้นทาง
#      3 = เขียนลง Drive ในเครื่องแล้ว แต่ Drive ยังไม่รับภายในเวลารอ
set -eu

SRC="${1:-}"
. "$(cd "$(dirname "$0")" && pwd)/offsite-dest.sh"
DRIVE_ROOT="$OFFSITE_DRIVE_ROOT"
DEST_ROOT="$OFFSITE_DEST_ROOT"
UPLOAD_WAIT="${FORMULA_OFFSITE_UPLOAD_WAIT_SECONDS:-180}"
LOG="${FORMULA_STATE_DIR:-$HOME/.hermes/apps/formula-studio}/monitoring/offsite.log"
mkdir -p "$(dirname "$LOG")"
say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG"; }

[ -n "$SRC" ] && [ -d "$SRC" ] || { say "offsite status=fail why=ไม่พบโฟลเดอร์สำรอง:$SRC"; exit 2; }

# Drive for desktop ไม่ได้ mount ถือเป็นเรื่องปกติ (เน็ตหลุด / ยังไม่ล็อกอิน)
# ไม่ใช่เหตุให้งานสำรองทั้งรอบล้ม — สำรองในเครื่องยังใช้ได้อยู่
if [ ! -d "$DRIVE_ROOT" ]; then
  say "offsite status=skip why=ยังไม่ได้ mount Google Drive ($DRIVE_ROOT)"
  exit 0
fi

STAMP="$(basename "$SRC")"
DEST="$DEST_ROOT/$STAMP"

# SHA256SUMS คือรายการสิ่งที่ต้องขึ้น Drive ทั้งหมด ไม่ใช้ glob: backup ปัจจุบันมี
# job-intake/ ซ้อนอยู่ และ glob ระดับบนทำให้ตรวจ checksum ไม่ผ่านหลังคัดลอก
if [ ! -f "$SRC/SHA256SUMS" ]; then
  say "offsite status=fail why=ชุดสำรองไม่มี SHA256SUMS จึงยืนยันสำเนาไม่ได้"
  exit 1
fi

# พาธใน manifest ต้องเป็น relative file ใต้ชุดสำรองเดียวกันเท่านั้น เพื่อไม่ให้ manifest
# ที่เสียพา cp ออกนอก SRC/DEST หรือข้ามไฟล์ที่ควรตรวจป้าย
valid_name() {
  case "$1" in
    ''|/*|../*|*/../*|*/..|*'//'*) return 1 ;;
    *) return 0 ;;
  esac
}

# ตรวจทั้งรายการก่อนเขียนปลายทาง: ไฟล์จาก Drive ที่กู้กลับมาห้ามถูกนำไปเป็นหลักฐาน
# สำเนารอบใหม่ เพราะ cp ของ macOS อาจพาป้าย item-id ไปด้วย
N=0
while IFS= read -r LINE || [ -n "$LINE" ]; do
  NAME="${LINE#* }"; NAME="${NAME#[ *]}"
  [ -n "$NAME" ] || continue
  N=$((N + 1))
  if ! valid_name "$NAME" || [ ! -f "$SRC/$NAME" ]; then
    say "offsite status=fail why=SHA256SUMS มีพาธไม่ปลอดภัยหรือไม่มีไฟล์ต้นทาง:$NAME"
    exit 1
  fi
  if xattr -p "$OFFSITE_ID_XATTR" "$SRC/$NAME" >/dev/null 2>&1; then
    say "offsite status=fail why=ไฟล์ต้นทาง $NAME มีป้าย Drive ติดมา ตรวจไม่ได้ว่าสำเนาขึ้นจริง src=$SRC"
    exit 1
  fi
done < "$SRC/SHA256SUMS"
[ "$N" -gt 0 ] || { say "offsite status=fail why=SHA256SUMS ว่าง จึงยืนยันสำเนาไม่ได้"; exit 1; }
if xattr -p "$OFFSITE_ID_XATTR" "$SRC/SHA256SUMS" >/dev/null 2>&1; then
  say "offsite status=fail why=ไฟล์ต้นทาง SHA256SUMS มีป้าย Drive ติดมา ตรวจไม่ได้ว่าสำเนาขึ้นจริง src=$SRC"
  exit 1
fi

mkdir -p "$DEST"

# คัดลอกตาม manifest เท่านั้น พร้อมสร้างโฟลเดอร์แม่ของไฟล์ nested ทีละพาธ
while IFS= read -r LINE || [ -n "$LINE" ]; do
  NAME="${LINE#* }"; NAME="${NAME#[ *]}"
  [ -n "$NAME" ] || continue
  mkdir -p "$DEST/$(dirname "$NAME")"
  cp "$SRC/$NAME" "$DEST/$NAME"
done < "$SRC/SHA256SUMS"
cp "$SRC/SHA256SUMS" "$DEST/SHA256SUMS"

# ตรวจซ้ำหลังคัดลอก — Drive คือระบบไฟล์ที่ซิงก์อยู่เบื้องหลัง เขียนเสร็จไม่ได้แปลว่าอ่านกลับได้
if ! ( cd "$DEST" && shasum -a 256 -c SHA256SUMS >/dev/null 2>&1 ); then
  say "offsite status=fail why=checksum ของสำเนาบน Drive ไม่ตรง dest=$DEST"
  exit 1
fi

# รอจน Drive รู้จักทุกไฟล์ (มีป้าย item-id) — นี่คือหลักฐานเดียวว่ามันจะขึ้นคลาวด์
# ชุดหนึ่งราว 1–2 MB บน Drive ที่ปกติได้ป้ายภายในไม่กี่วินาที
# ไล่ตามรายชื่อใน SHA256SUMS (ซึ่ง shasum -c เพิ่งยืนยันว่ามีครบ) แล้วเปิดตามพาธตรง ๆ
# ห้ามไล่ด้วย glob ของโฟลเดอร์: ใต้ launchd macOS ไม่ให้อ่านรายการโฟลเดอร์ใน CloudStorage
# (Operation not permitted) glob จึงได้ว่างเปล่า = "ไม่มีไฟล์ไหนขาดป้าย" = ok ปลอม
# ซึ่งคืออาการเดียวกับที่ไฟล์นี้ตั้งใจจะกำจัด · และต้องเจออย่างน้อยหนึ่งไฟล์เสมอ
missing_ids() {
  N=0
  # "|| [ -n ]": บรรทัดสุดท้ายที่ไม่มีขึ้นบรรทัดใหม่ read จะทิ้ง = ไฟล์นั้นไม่ถูกตรวจป้าย = ok ปลอม
  # รูปบรรทัดของ shasum: "<hash>  <ชื่อ>" (ข้อความ) หรือ "<hash> *<ชื่อ>" (ไบนารี)
  while IFS= read -r LINE || [ -n "$LINE" ]; do
    NAME="${LINE#* }"; NAME="${NAME#[ *]}"
    [ -n "$NAME" ] || continue
    N=$((N + 1))
    xattr -p "$OFFSITE_ID_XATTR" "$DEST/$NAME" >/dev/null 2>&1 || printf '%s ' "$NAME"
  done < "$SRC/SHA256SUMS"
  xattr -p "$OFFSITE_ID_XATTR" "$DEST/SHA256SUMS" >/dev/null 2>&1 || printf '%s ' SHA256SUMS
  [ "$N" -gt 0 ] || printf '%s ' "(SHA256SUMS ว่าง)"
}
WAITED=0
PENDING="$(missing_ids)"
while [ -n "$PENDING" ] && [ "$WAITED" -lt "$UPLOAD_WAIT" ]; do
  sleep 5; WAITED=$((WAITED + 5))
  PENDING="$(missing_ids)"
done

# นับชุดบน Drive — ถ้าอ่านรายการไม่ได้ให้บอกเหตุผล ไม่ใช่กลืน error แล้วพิมพ์ 0
# *หลักฐาน: เดิม 2>/dev/null ทำให้ขึ้น "ทั้งหมด 0 ชุด" ทุกคืน ทั้งที่มีอยู่ 22 ชุด*
# ใต้ launchd อ่านรายการไม่ได้เสมอ (สิทธิ์ความเป็นส่วนตัวของ macOS) — เป็นข้อมูลประกอบ
# ไม่ใช่ความผิดปกติ จึงไม่ใส่ why= ในบรรทัด ok (why= ที่ขึ้นทุกคืนสอนให้คนเลิกอ่าน why=)
if LIST="$(ls -1 "$DEST_ROOT" 2>/dev/null)"; then
  COUNT_NOTE="สำเนาบน Drive ทั้งหมด $(printf '%s\n' "$LIST" | grep -c .) ชุด"
else
  COUNT_NOTE="จำนวนชุดบน Drive: นับไม่ได้จากงานเบื้องหลัง (macOS ไม่ให้อ่านรายการโฟลเดอร์ ไม่กระทบการตรวจป้าย)"
fi

if [ -z "$PENDING" ]; then
  say "offsite status=ok stamp=$STAMP dest=$DEST checksum=ok uploaded=ok waited=${WAITED}s · $COUNT_NOTE"
  exit 0
fi
say "offsite status=pending stamp=$STAMP dest=$DEST checksum=ok why=Drive ยังไม่รับไฟล์ ($PENDING) ภายใน ${UPLOAD_WAIT} วิ — ตอนนี้ยังอยู่แค่ในเครื่อง · $COUNT_NOTE"
exit 3
