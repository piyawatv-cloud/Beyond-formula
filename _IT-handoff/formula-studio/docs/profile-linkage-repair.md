# การคืนข้อมูลเชื่อมโยงโปรไฟล์ — สำหรับผู้ดูแลระบบเท่านั้น

Task `incident-20261019-profile-metadata` · ไม่มี Issue ID · Critical Change

`runtime/profile-linkage-repair.sql` เป็นไฟล์ดำเนินการเฉพาะครั้งกับ `public.fs_users`
ห้ามนำไปเรียกอัตโนมัติใน startup, deploy หรือ migration การจัดทำไฟล์นี้ยังไม่ได้อนุมัติ
ให้ใช้กับระบบจริง และยังไม่ได้คืนข้อมูลจริง

ก่อนดำเนินการ ผู้ตรวจอิสระต้องตรวจไฟล์ และ System Owner ต้องอนุมัติ commit/artifact
ที่ระบุแน่นอนพร้อม SHA-256 ของไฟล์ manifest ส่วนตัวสำหรับโหมดที่ใช้ ผู้ดูแลต้องตรวจ
ปลายทาง บัญชีผู้ดำเนินการ สำรองข้อมูลและ checksum ที่กู้คืนได้ พร้อมแผนย้อนกลับ
บันทึกผู้อนุมัติ ผู้ดำเนินการ เวลา และ reference ในหลักฐานส่วนตัวตาม governance
การจำลอง `dry-run` บนระบบจริงก็ต้องได้รับอนุญาตแยกตามขอบเขตเช่นกัน

## ข้อมูลเข้าที่เก็บเป็นส่วนตัว

ใช้ connection-local setting ชื่อ `formula.profile_repair_manifest_hex` เป็นข้อความ hex
ของ JSON UTF-8 เก็บไฟล์และเนื้อหานี้นอก Git และนอก log/prompt/terminal history
hex เป็นเพียงการเข้ารหัสรูปแบบข้อความ ไม่ใช่การปกปิดความลับ ผู้ดูแลต้องตรวจนโยบาย
บันทึกคำสั่งของฐานข้อมูลก่อนส่งค่าลับผ่าน connection ที่ได้รับอนุมัติ

JSON มีเฉพาะ keys ต่อไปนี้:

- root: `version` เป็นเลข `1`, `mode` เป็น `dry-run` หรือ `apply` (ละได้และจะเป็น
  `dry-run`), `authorization_ref` เป็นข้อความ, `profiles` เป็นรายการสองรายการพอดี
- แต่ละ profile: `name` เป็นชื่อที่ไม่ว่างและไม่ซ้ำ, `expected_row_sha256` เป็น hex
  ตัวเล็ก 64 ตัว, `restore` เป็น object
- `restore` มีสอง keys เท่านั้น: `central_user_id` เป็นข้อความ UUID และ
  `provisionedBy` เป็นข้อความ `opc-user-access`
- `apply` ต้องมี `authorization_ref` ที่ไม่เป็นข้อความว่าง/ช่องว่าง และด่านรักษา
  linkage จาก `runtime/profile-linkage-policy.sql` ต้องติดตั้งและเปิดใช้อยู่ในรูปแบบที่ถูกต้อง

ค่า hash ต้องคำนวณใน PostgreSQL ด้วย timezone `UTC` จาก **ทั้งแถว** ตามนิพจน์
`encode(sha256(convert_to(to_jsonb(u)::text, 'UTF8')), 'hex')` โดย `u` คือแถว
ใน `public.fs_users` ห้ามใช้ JSON ที่จัดรูปแบบใหม่ภายนอกฐาน เพราะ hash อาจต่างกัน
หลักฐาน/ค่า hash และข้อมูลจริงต้องอยู่ในพื้นที่ส่วนตัวที่ได้รับอนุมัติเท่านั้น

## วิธีใช้หลังได้รับอนุมัติ

ใช้ `psql -X` ใน connection ใหม่ที่ไม่อยู่ใน transaction อื่น ด้วย operator
ที่เป็น PostgreSQL superuser โดยตรง (ห้าม `SET ROLE`, `anon` หรือ `authenticated`)
ส่ง setting ข้างต้นผ่านช่องทางส่วนตัวที่ไม่แสดงค่า แล้วใช้ `\i` อ่านไฟล์ SQL
จาก approved immutable artifact เดียวกันใน connection นั้น ห้ามใช้ `psql -a/-e`
หรือใส่ private payload ใน command arguments, shell history หรือ log

ไฟล์จัดการ `BEGIN`/`COMMIT` เอง ใช้เวลา UTC เฉพาะ transaction และล็อกแถวตามลำดับ
แน่นอนในโหมด `apply` ข้อมูลอื่นต้องตรง hash ที่อนุมัติ และทั้งสองช่องต้องยังไม่มีอยู่
จึงจะเติมสองช่องนี้ โดยให้ trigger เวลาแก้ไขเดิมทำงานตามปกติ หากแถวใดขัดแย้ง
จะยกเลิกการเขียนทั้งหมด ไม่สร้าง RPC/function/table/grant/trigger ถาวร

ผลแสดงเฉพาะ `mode`, `target_rows`, `would_restore`, `restored`, `already_present`
หากสองช่องมีค่าตรง manifest อยู่แล้วจะข้ามโดยไม่เขียนหรือเปลี่ยนเวลา แม้ hash เดิม
ก่อนซ่อมต่างจากแถวหลังซ่อม การข้ามนี้ไม่ใช่การรับรองว่าช่องข้อมูลอื่นยังตรง baseline
หากมีเพียงช่องเดียวหรือค่าขัดแย้งจะหยุดด้วยข้อความ `PROFILE_REPAIR_REJECTED` เท่านั้น
เมื่อผิดพลาดให้ปิด connection นั้นและตรวจสอบส่วนตัว ห้ามแก้ manifest เพื่อข้ามด่าน
โดยไม่มีการอนุมัติใหม่

หากต้องย้อนกลับหลัง commit ให้หยุดและขออนุมัติแผนกู้คืนจากสำรอง/หลักฐานก่อนดำเนินการ
อย่าลบ linkage คืนด้วย SQL เฉพาะหน้า เพราะอาจทับการเปลี่ยนแปลงที่เกิดหลังการซ่อม
