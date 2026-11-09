# คำตัดสิน — ผู้ใช้ที่เป็นเจ้าของใบงานต้องแก้แถวสารได้ (`FORMULA_EDIT`) · 2026-10-14

ผู้ตัดสิน: System Owner (piyawat.v) ยืนยันในที่ประชุมงาน 14 ต.ค. 2569 ว่า "user ต้องแก้สารได้"
และมอบให้ผู้ช่วยกำหนดรายละเอียด grant ใน IAM
สถานะ: **DECIDED / NOT APPLIED** — grant ต้องทำโดย IAM Admin ผ่านหน้า IAM (มี audit) ไม่ใช่ SQL ตรง

## สิ่งที่เปลี่ยนจากนโยบายเดิม

นโยบาย 22 ก.ย. 2569 (`docs/UAT_2026-09-22_formula-role-writes.md`, IAM
`docs/PROTECTED_BASELINE_2026-09-22.md`) ให้ Sales/Oversea สร้างใบงาน แชต อนุมัติขั้น Sales ได้
แต่ **แก้แถวสารไม่ได้** เว้นแต่ได้ grant แยก · หลักฐานจริง 12 ต.ค.: `A03885` ของเอ้ (oversea) ถูก
`job-received forbidden` 9 ครั้งใน 3 ชั่วโมงเพราะแก้แถวสาร, `แกง` (sales) 1 ครั้ง, `มายด์` (pd) 3 ครั้ง
→ ผู้ใช้ตีความว่า "ระบบบันทึกไม่ได้" ไม่ใช่ "ไม่มีสิทธิ์"

คำตัดสินใหม่: **ผู้ที่สร้าง/เป็นเจ้าของใบงาน (บทบาท `sales`, `oversea`) ได้ `FORMULA_EDIT` เป็น
direct grant รายคน** · ขอบเขตแถวยังถูกคุมโดย runtime (เจ้าของตามชื่อ/อีเมลเท่านั้น,
`FORMULA_OWNER_IMMUTABLE`, ใบงานที่ปิดแล้วแก้ไม่ได้) grant นี้จึงไม่เปิดให้แก้ใบงานของคนอื่น

**เพิ่มเติม 14 ต.ค. (เจ้าของสั่ง):** `opc` ได้ `FORMULA_EDIT` ด้วย โดยมีเงื่อนไขว่า **ทุกการแก้สารต้องมี
หลักฐานใน log** · เงื่อนไขนี้ถูกบังคับที่ runtime (PR ถัดจาก #57): บรรทัด `job-received status=saved`
มี `ingredientEdit=true/false`, `rowsBefore`, `rowsAfter`, `permission` (ที่มาของสิทธิ์จาก IAM) พร้อม
`by`/`byRole`/`key` เสมอ — บันทึก **ว่าใครแก้สูตรของใบไหนเมื่อไร** ไม่บันทึกตัวสูตร · เนื้อหาการแก้
อยู่ใน `fs_activities` (append-only ตามกฎ 2.8 ประทับชื่อจากเซสชันตามกฎ 2.5 เช่น `แก้สูตรในห้องแชท`)
และใน `fs_records` เอง · monitor รายงาน `แก้สารสำเร็จ=n` ทุก 15 นาที

ไม่รวม: `ra`/`rd`/`purchasing` (runtime ไม่ให้เขียน `fs_records` อยู่แล้ว) · `pd`/`mkt`/`admin` มีอยู่แล้วตาม bundle

## ข้อกำหนดทางเทคนิคของ grant (จากโค้ด IAM ที่รันอยู่)

- permission `FORMULA_EDIT` class `SENSITIVE_USER_ONLY` → ต้องเป็น **USER_SPECIFIC** grant รายคน
  role bundle ไม่พอ (`permission-evaluator.js: SENSITIVE_GRANT_REQUIRED`)
- proxy ส่ง `record_scope: "ALL"` → grant ต้องมี **`dataScope = ALL`** ไม่งั้นถูกปฏิเสธ `DATA_SCOPE_DENIED`
- ผูกกับระบบ `FORMULA` · ไม่กำหนดวันหมดอายุ (`validUntil = null`) · ใส่ `reason` อ้างเอกสารนี้
- ทำผ่านหน้า IAM → ผู้ใช้ → "สิทธิ์เฉพาะบุคคล" (`SpecialAccessPanel`, API `POST /users/:id/special-access`)
  ซึ่งบันทึก audit event ให้ · โหมด IAM ของ Formula ไม่มีแคชการอนุญาต มีผลคำขอถัดไปทันที

## รายชื่อที่ต้อง grant (จาก `signed-in` ใน gateway log 1–14 ต.ค. 2569)

| บทบาท | ชื่อใน Formula | อีเมล IAM |
|---|---|---|
| oversea | เอ้ | user@example.com |
| oversea | ไท | user@example.com |
| sales | แยม | user@example.com |
| sales | ฝน | user@example.com |
| sales | ไวท์ | user@example.com |
| sales | บ๊อบ | user@example.com |
| sales | แกง | user@example.com |
| opc | บุ๋มบิ๋ม | user@example.com |
| opc | เชอรี่ | user@example.com |

reason ที่ให้กรอก: `DECISION_2026-10-14_formula-edit-grants: job owner may edit ingredient rows`
(สำหรับ opc ใช้: `DECISION_2026-10-14_formula-edit-grants: OPC may edit ingredient rows; every edit audited`)

## การตรวจหลัง grant (ไม่แตะข้อมูลธุรกิจ)

1. ผู้ใช้คนนั้น hard refresh → ป้ายซิงก์ต้องไม่ใช่ "อ่านอย่างเดียว" และ `/sb/session` ต้องตอบ `canFormulaEdit: true`
2. แก้แถวสารของใบงานตัวเอง 1 ใบแล้วบันทึก → log ต้องมี `job-received status=saved by=<ชื่อ>`
3. monitor 15 นาทีถัดไป `บันทึกใบงานถูกหยุด=0/0` สำหรับคนนั้น
4. บันทึกผลลง `docs/POSTLIVE_2026-10-14_user-save-first-failure.md`

## ทางถอย

revoke grant รายคนผ่านหน้าเดียวกัน (`/users/:id/special-access/:grantId/revoke`) พร้อม reason ·
ไม่มีผลย้อนหลังกับใบงานที่บันทึกไปแล้ว
