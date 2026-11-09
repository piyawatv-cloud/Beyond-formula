# Handoff ถึง System Owner — ตรวจ Runtime ที่ deploy เทียบ GitHub (Internal Confidential)

วันที่: 2026-11-01 · ผู้จัดทำ: Claude Code (Development Agent, session_01SRfVD9wXin8SNJcNpATCkA) · ไม่คัดลอกเข้า public repo

## สถานะ: ต้องการการตัดสินใจจาก System Owner / CODEOWNER `@phossatron`

## 1. ข้อเท็จจริง (ตามรายงาน Runtime Operator ที่ผู้ใช้ส่งต่อ 2026-11-01 18:39 น. — ผมยังไม่ได้ตรวจเอง)
- Production รัน formula-runtime commit `50126b93e2781eec505151450f59651f2fad93da` (ชุด blue, web release `cf7ab7813cbe`)
- commit นี้มี `a11f0a9` (MKT อนุมัติ PD / Oversea อนุมัติ Sales) และ `f0a5ade` อยู่ในประวัติ
- GitHub `main` ของ formula-runtime ยังอยู่ที่ `91d5fde` ไม่มี commit ที่ deploy
- ยังไม่พบหลักฐาน PR + review ของ `@phossatron` สำหรับ commit ที่ deploy

## 2. ข้อกังวลที่ต้องตรวจ (Critical Change: auth/permission)
1. Deployed ≠ approved: ต้อง reconcile production กับ GitHub ด้วย PR ย้อนหลัง
2. เส้นทางอ่าน `fs_approvals` ไม่ผ่านตัวกรองขอบเขตงานเหมือน records/messages (ตามรายงาน) — ตรวจนโยบายฐานข้อมูลและทดสอบด้วยบัญชี Sales/Oversea ที่ได้รับอนุญาต หรือบนฐานจำลอง
3. e2e #8 (synthetic): ประตูข้อมูลรับ `POST fs_messages` เข้าใบงานของผู้ใช้อื่น
4. e2e #12 push register ล้ม, e2e #13 คาดหวังเก่า (MKT→Sales)

## 3. ผลต่อแอปมือถือ (PR #16 `phossatron/Beyond-formula`)
- แอปโหมดระบบจริงอ่านอย่างเดียว ไม่เขียน ไม่ต้องแก้ runtime
- แอปขอ `fs_approvals` เฉพาะรหัสงานที่ตัวเองเห็น แต่นั่นไม่ใช่การป้องกันฝั่งเซิร์ฟเวอร์
- แอปทนต่อ 403 ของ `fs_approvals` (แสดง "ไม่มีสิทธิ์ดูสถานะอนุมัติ") — เป็นการป้องกันไว้ก่อน

## 4. ข้อยกเว้น §7 (`formula-mobile-live-readonly-2026-10-29`)
- ต่ออายุตามคำสั่งผู้ใช้ถึง 2026-11-07 23:59 (ผู้ช่วยยืนยันตัวตนไม่ได้) · หลังนั้นต้องมี PR + independent review หรือคำสั่ง System Owner ใหม่

## 5. สิ่งที่ผมไม่ได้ทำ
ไม่แก้ runtime/ฐานข้อมูล/สิทธิ์ · ไม่ทดสอบอ่านข้ามใบงานบน production · ไม่ deploy · ไม่ merge PR

## 6. ขอให้ตัดสินใจ
- [ ] เปิด PR ย้อนหลังให้ commit ที่ deploy และให้ `@phossatron` รีวิว
- [ ] ตรวจ `fs_approvals` scope ด้วยบัญชีทดสอบที่ IAM ออกให้
- [ ] ออกบัญชีทดสอบ Sales / OPC / Oversea / MKT
- [ ] ตัดสินต่ออายุ §7 หรือเปลี่ยนเป็น PR ปกติ

Rollback ของงานมือถือ: ถอนการติดตั้งแอป / revert PR #16 (ไม่มีการเปลี่ยนระบบกลาง)
