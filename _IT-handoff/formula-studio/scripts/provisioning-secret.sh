# ใช้ด้วย `. scripts/provisioning-secret.sh <ชื่อโปรเจกต์ compose>` หลังอ่าน stack env แล้ว
#
# กุญแจประตูสร้างโปรไฟล์ของ OPC (FORMULA_PROVISIONING_SECRET) อยู่ใน Keychain เท่านั้น ไม่อยู่ในไฟล์ env
# ก่อนมีไฟล์นี้ กุญแจมาจากเชลล์ของคนที่สั่ง deploy · ปล่อยรอบไหนลืม export ประตูก็ปิดเงียบ
# แล้วหน้าเพิ่มผู้ใช้ของ OPC ทำงานกับ Formula ไม่ได้ โดยไม่มีด่านไหนทัก (QA 1 ต.ค. 2569 ข้อ S3)
#
# เปิดเฉพาะสแตกจริง (formularuntime) · formulatest ใช้ฐานทดสอบแยก แต่ยังปิดจนกว่าจะตั้ง
# contract สำหรับสร้างโปรไฟล์ทดสอบโดยเฉพาะ แม้ในเชลล์จะมีค่าค้างอยู่ก็ตาม
formula_provisioning_secret_for() {
  case "$1" in
    formularuntime)
      if [ -z "${FORMULA_PROVISIONING_SECRET:-}" ] && command -v security >/dev/null 2>&1; then
        FORMULA_PROVISIONING_SECRET="$(security find-generic-password -a "${FORMULA_KEYCHAIN_ACCOUNT:-${USER:-$(id -un)}}" -s beyond-workflow.formula.provisioning -w 2>/dev/null || true)"
      fi
      ;;
    *)
      FORMULA_PROVISIONING_SECRET=""
      ;;
  esac
  export FORMULA_PROVISIONING_SECRET
}
