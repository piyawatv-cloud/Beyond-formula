# ปลายทางสำเนานอกเครื่อง — ที่เดียว ใช้ร่วมกันระหว่างตัวส่ง (copy-backup-offsite.sh)
# และตัวตรวจ (check-offsite-status.sh) จะได้ไม่มีวันชี้คนละที่
#
# Drive บริษัท ไม่ใช่ gmail ส่วนตัว (เจ้าของเลือก 28 ก.ย. 2569)
# *หลักฐาน: Drive gmail หยุดอัปโหลดของที่สร้างในเครื่องตั้งแต่ราว 30 ก.ค. — ตัวซิงก์ของ macOS
#  ไม่รับรู้การเปลี่ยนแปลงของบัญชีนั้นนานเป็นวัน ๆ ("Slow working set change acknowledgment")
#  สำเนา 22 ชุดจึงอยู่แค่บนดิสก์เครื่องนี้ ทั้งที่ log ขึ้น offsite status=ok ทุกคืน*
#
# ใช้ด้วย `. scripts/offsite-dest.sh` แล้วอ่าน $OFFSITE_DRIVE_ROOT และ $OFFSITE_DEST_ROOT
OFFSITE_DRIVE_ROOT="${FORMULA_DRIVE_ROOT:-$HOME/Library/CloudStorage/GoogleDrive-<account>/ไดรฟ์ของฉัน}"
OFFSITE_DEST_ROOT="$OFFSITE_DRIVE_ROOT/Formula Studio Backups"
# ป้ายที่ Drive for desktop ติดให้ไฟล์ที่มันรู้จักแล้ว — ไม่มีป้าย = ยังไม่ถึงคลาวด์
OFFSITE_ID_XATTR="com.google.drivefs.item-id#S"
