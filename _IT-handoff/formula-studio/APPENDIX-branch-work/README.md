# ภาคผนวก — งานใน branch `codex/job-alerts-chat-save` (ไม่อยู่ใน baseline)

**สถานะ: ยังไม่ผ่านการ merge/review/deploy · ยังไม่ได้ทดสอบบน baseline · ใช้เป็นข้อมูลอ้างอิงเท่านั้น**
baseline ของแพ็กเกจหลักคือ `phossatron/Beyond-formula` commit `cfa964b` (build 2026-10-07.2)
branch นี้แยกสายตั้งแต่ commit `e2d0302a`: มี 24 commit ที่ baseline ไม่มี และขาด 53 commit ที่ baseline มี

## ผลลองนำมาใช้บน baseline
- ใส่ 24 patch ต่อกันบน `cfa964b` ด้วย `git am --3way` → **ชนที่ patch 0004** (`supabase/schema.sql`)
- ลองนำ 3 commit ล่าสุดทีละตัวลง baseline → **ชนทั้งหมด** (`index.html`, `tests/formula-studio.test.js`, ฯลฯ)
- patch ของงานที่ยังไม่ commit ใช้กับ baseline ตรง ๆ ไม่ได้ (บรรทัดอ้างอิงเลื่อน)
สรุป: ต้องให้นักพัฒนาอ่านแล้ว **เขียนพอร์ตเอง** ไม่ใช่ apply patch

## ในโฟลเดอร์นี้
| ที่ | เนื้อหา |
|---|---|
| `patches/0001–0024` | `git format-patch` ของ 24 commit (อีเมลพนักงานถูกกลบเป็น `example.com`) · `COMMITS.txt` คือรายชื่อ |
| `uncommitted/wip-uncommitted.patch` | งานที่ยังไม่ commit: ปุ่ม "เปิดใน Customer Data" ในหน้ารายละเอียดใบงาน + เทสต์ + เปลี่ยน build stamp เป็น 2026-10-12.1 |
| `cost-calculator-design/` | เอกสารออกแบบเครื่องคำนวณต้นทุน (CONTEXT/SPEC/REGISTRY/TASK/docs) **ไม่มีโค้ด** · ไม่รวมโฟลเดอร์ `local-only/` เพราะเป็นข้อมูลต้นทุนภายใน |

## จัดกลุ่มงาน (ตามค่าที่ควรพิจารณา)
**ฟีเจอร์ที่ผู้ใช้เห็น — น่าพอร์ต**
- `43b5cfb` ช่องค้นหารหัสงานในแชต + ไม่ล้างข้อความที่พิมพ์ค้างตอนวาดหน้าใหม่ (มี branch `feat/chat-job-search` แยกใน GitHub ด้วย)
- `0724d93` เตือนใบงานนิ่งเกิน 7 วัน + กัน Chat จนกว่าบันทึกสำเร็จ · **ซ้อนกับ PR #13 (job-idle-alert) ที่ baseline มีแล้ว** ให้เทียบก่อน ส่วน "กัน Chat จนกว่าบันทึก" ใกล้เคียงงาน save-first ของ runtime (`fs-job-sync.js`) อาจซ้ำ
- ไม่ commit: ปุ่ม "เปิดใน Customer Data" ให้ Sales โหลดใบงานเดิมมาดูราคา

**เครื่องมือวินิจฉัย**
- `a3f4859` `scripts/inspect-job-recovery.js` ตรวจใบงานหายแบบกลบข้อมูล

**สายเก่า Supabase Auth / RLS — น่าจะถูกแทนด้วย runtime แล้ว (ตรวจก่อนใช้)**
- 0001–0021: Supabase Auth + membership + RLS, chat event store, OPC user directory adapter (`api/opc-user-directory.js`), private workspace loader + CSP, สคริปต์ `runtime/*.sh` รุ่นแรก, `tests/sql/*`
- ระบบจริงตอนนี้ใช้ IAM ของ OPC + PostgreSQL ในเครื่อง ผ่าน `formula-proxy` จึงอาจไม่ต้องใช้ส่วนนี้ ให้ IT ถามเจ้าของระบบก่อน

## ข้อห้ามเดิมยังมีผล
ห้ามเปลี่ยนโครงสร้างข้อมูลที่ล็อก (ดู README หลักข้อ 6) และต้องเปลี่ยน build stamp ทุกครั้งที่แก้แอป
