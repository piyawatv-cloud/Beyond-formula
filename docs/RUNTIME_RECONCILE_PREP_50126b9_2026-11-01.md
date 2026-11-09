# เตรียม reconcile — formula-runtime commit 50126b9 เทียบ GitHub main (Internal Confidential)

วันที่ 2026-11-01 · Claude Code (Development Agent) · ตรวจแบบอ่านอย่างเดียวจาก git ในเครื่อง · ยังไม่ push / เปิด PR / deploy
การอนุมัติและการ merge เป็นของ System Owner และ CODEOWNER `@phossatron` เท่านั้น

## ข้อเท็จจริงจาก git (ตรวจเอง)
- `50126b93e2781eec505151450f59651f2fad93da` มีอยู่ใน branch ในเครื่อง `codex/mobile-push-20261029` เท่านั้น (ไม่มีบน remote)
- `origin/main` = `91d5fde` เป็นบรรพบุรุษของ 50126b9 (เส้นตรง ไม่มี commit บน main ที่ขาด) → ต่างกัน 14 commit, 28 ไฟล์, +908/−31
- merge-base = `91d5fde` → PR จาก branch นี้เข้า main ไม่ขัดแย้ง (fast-forward ได้ในเชิง git)

## 14 commit ที่ deploy แล้วแต่ยังไม่อยู่ใน main (เก่า→ใหม่)
abc3471, d152191, 91ca82d, 643a1cf, 284fa7b, 9f7b543 (เอกสาร/รายงาน PR115 + monitor) ·
5e5122d, b42a715, 0f07d99, 1a67f67 (chat recovery / New Chat room) ·
a11f0a9 (MKT อนุมัติ PD, Oversea อนุมัติ Sales) · f0a5ade (test fixture) ·
**49a588a** (ดูด้านล่าง) · 50126b9 (อัปเดตเทสต์)

## 49a588a — ส่วนที่เป็น Critical Change
1. `FORMULA_APPROVAL_PARTS`: **mkt = [pd, sales]**, oversea = [sales] (ที่ผมรายงานก่อนหน้านี้ว่า MKT→PD อย่างเดียวนั้นล้าสมัย; production ให้ MKT อนุมัติ Sales ด้วย)
2. Sales/Oversea เขียนแถว chat/room/approval ลงใบงานที่ไม่ใช่ของตน → ถูกปฏิเสธ `JOB_NOT_OWNED` (ดูเหมือนปิดช่องว่าง e2e #8 ที่ผมพบ — **ยังไม่ได้ยืนยันด้วยการรันเทสต์ซ้ำ**)
3. เพิ่ม `POST /__formula/push-register|push-unregister` (ทะเบียน token ผูกกับเซสชัน, เก็บเป็นไฟล์) + `runtime/push-devices.mjs`
4. เพิ่ม `scripts/push-notifier.mjs`, `run-push-notifier.sh`, `com.beyond.formula-push.plist` (ส่ง FCM) — ข้อความ commit ระบุว่า "ยังไม่ติดตั้งจนกว่าจะมี service account" (ต้องตรวจว่า production ไม่ได้ติดตั้ง/รัน; org policy บล็อกคีย์ FCM อยู่)
5. `runtime/job-sync.sql` (gate ฝั่ง SQL), `docker-compose.formula.yml`

## ข้อกังวลด้านการกำกับดูแล
- ข้อความ commit 49a588a อ้างว่า "Released under System Owner section-7 exception formula-mobile-live-readonly-2026-10-29" แต่ข้อยกเว้นนั้นครอบคลุม **ฝั่งแอปมือถือที่ login และอ่านข้อมูลแบบอ่านอย่างเดียว** ไม่ได้ระบุการแก้/deploy runtime, การเปลี่ยนสิทธิ์อนุมัติ หรือ push เพราะฉะนั้นต้องให้ System Owner ยืนยันว่านับเป็นขอบเขตเดียวกันหรือไม่ — ผมไม่สามารถยืนยันแทนได้
- เปลี่ยนสิทธิ์/ SQL gate / endpoint ใหม่ = Critical Change ต้อง independent approval จาก `@phossatron`
- ยังไม่ยืนยัน: `fs_approvals` อ่านผ่านตัวกรองขอบเขตงานหรือไม่ (บรรทัด ~856–861 ยัง gate ตามบทบาทเท่านั้น)

## แนวทาง reconcile ที่แนะนำ (ให้ผู้มีอำนาจเลือก)
A. เปิด PR `codex/mobile-push-20261029` → `main` ของ formula-runtime ย้อนหลัง พร้อมหลักฐานเทสต์ + รายงาน rollback แล้วให้ `@phossatron` รีวิว **ก่อน** อัปเดต `main` (ไม่ force push)
B. หรือถ้า System Owner เห็นว่าไม่อนุมัติ → rollback production ไปที่ `91d5fde` ผ่าน Runtime Operator
คำสั่งที่เตรียมไว้ (ยังไม่รัน, ต้องได้รับคำสั่งจาก System Owner):
`cd /Users/user/formula-runtime && git push origin codex/mobile-push-20261029` แล้ว `gh pr create --repo piyawatv-cloud/formula-runtime --base main --head codex/mobile-push-20261029`

## เทสต์ที่ควรรันซ้ำก่อนรีวิว (ฐานจำลอง ไม่ใช้ production)
approval-change-*, job-sync-gateway, push-devices, push-notifier, missing-chat-creation, `integration/live-gateway-e2e.test.mjs` (docker postgres+postgrest ข้อมูลปลอม)

## สิ่งที่ผมยังไม่ได้ทำ
ไม่ push/เปิด PR ที่ formula-runtime · ไม่แตะ production · ยังไม่รันเทสต์ซ้ำของ runtime
