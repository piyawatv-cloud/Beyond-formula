# Formula Studio — เอกสารส่งมอบทีม IT

เครื่องมือ R&D Briefing ของ Beyond Laboratory · ฉบับส่งมอบ ณ 2026-10-21
แพ็กเกจนี้ตัดเอกสารเฉพาะกิจของเครื่องมือ AI ออกแล้ว เหลือเฉพาะสิ่งที่ทีมพัฒนาด้วยมือต้องใช้

## 1. รุ่นที่ใช้งานจริง (baseline)

| ส่วน | ที่มา | รุ่น |
|---|---|---|
| หน้าเว็บ `app/index.html` (ไฟล์เดียว HTML+CSS+JS ไม่มี build) | repo `phossatron/Beyond-formula` commit `cfa964b` | build 2026-10-07.2 · SHA-256 ขึ้นต้น `cf7ab7813cbe` |
| ชั้น runtime (`runtime/`, `scripts/`, `tests/`, compose) | repo `piyawatv-cloud/formula-runtime` (private) commit `8e5cbd4` (PR #91) | main ล่าสุด 2026-10-20 |

ไฟล์ `releases/cf7ab7813cbe/index.html` กับ `app/index.html` คือไฟล์เดียวกัน (ตรวจด้วย `MANIFEST.sha256` แล้ว)

**ข้อควรรู้:** เครื่อง production ที่ตรวจเมื่อ 2026-10-21 รันโค้ด runtime ที่ commit `4b121c1` (PR #88) ส่วน PR #89–#91 ถูก merge ใน GitHub แล้ว แต่ยังไม่ได้ยืนยันว่า deploy ขึ้นเครื่องจริงหรือยัง ให้ตรวจก่อนอ้างว่ารุ่นไหนใช้งานอยู่

## 2. สถาปัตยกรรม

```
เบราว์เซอร์ ──► formula-edge (เลือก blue/green) ──► formula-proxy (Node 22, ไม่มี dependency)
                                                         │  1) เสิร์ฟ index.html ที่ผนึกไว้ + แทรก runtime/assets/*.js
                                                         │  2) เป็นประตูข้อมูล: ถือคีย์ไว้ฝั่งเซิร์ฟเวอร์
                                                         │  3) /__formula/health ให้ด่านตรวจอ่านสถานะ
                                                         ▼
                                       PostgREST ──► PostgreSQL 16 (ในเครื่อง, volume formula_pgdata)
                                       (Supabase เดิมเหลือเป็น standby/สำรอง)
```

- `index.html` ยังมีตัวแปร `SB_URL`/`SB_KEY` ตามเดิม แต่ proxy จะ **แทนค่า `SB_URL` ให้ชี้มาที่ gateway ของ runtime** ตอนเสิร์ฟ (ดู `formula-proxy.mjs` ส่วน `SB_URL_NEEDLE`) เบราว์เซอร์จึงไม่เห็นคีย์จริง
- สคริปต์ฝั่งหน้าเว็บที่ runtime แทรกเข้าไป: `runtime/assets/fs-job-sync.js` (ซิงก์ใบงาน/แชต), `fs-chat-journal.js`, `fs-chat-recovery.js`, `fs-session-bridge.js` (ล็อกอินผ่าน IAM ของ OPC), `fs-admin-activity-log.js`, `fs-rollback-chat-recovery.js`
- **พฤติกรรมของระบบ = index.html + assets ที่แทรก + proxy** ดังนั้นแก้ที่ `index.html` อย่างเดียวจะไม่ครบ ต้องรันเทสต์ของ runtime ด้วยเสมอ

## 3. ผังโฟลเดอร์

| โฟลเดอร์/ไฟล์ | หน้าที่ |
|---|---|
| `app/` | `index.html` (รุ่นที่ใช้), `supabase/schema.sql` (โครงสร้างเดิมของ Supabase), `tests/job-idle-alert.test.mjs` |
| `runtime/` | `formula-proxy.mjs`, `formula-edge.mjs`, `job-intake.mjs`, `assets/*.js`, `*.sql` (นโยบาย/สิทธิ์/ฟังก์ชันฐานข้อมูล), `*.plist` (launchd), `data.env.example` |
| `scripts/` | seal / safe-deploy / blue-green / backup / monitor / recover |
| `tests/` | เทสต์ `node:test` 1,047 ข้อ (ไม่ต้องติดตั้ง package) |
| `releases/` | index.html ที่ผนึกแล้วแยกตามรหัส hash · `CURRENT` ชี้รุ่นที่เสิร์ฟอยู่ · (ไฟล์ index.html ของรุ่นเก่าไม่ได้แนบ มีแต่ meta) |
| `docs/FORMULA-RUNTIME-RULES.md` | **อ่านก่อนแตะอะไร** กฎที่มาจากเหตุจริง |
| `docs/RECOVERY-FORMULA.md` | วิธีกู้คืนระบบ |
| `docs/DECISION_*.md` | เหตุผลของการตัดสินใจสำคัญ (สิทธิ์แก้สูตร, ประวัติเวอร์ชันกลาง, release ที่เซิร์ฟเวอร์เป็นเจ้าของ) |
| `docs/SPEC_chat-journal-recovery.md` | สเปก API ของ `fs-chat-journal.js` (IndexedDB `fs_chat_fallback_v1`) |
| `docs/migrations/`, `docs/upstream-schema.sql` | migration และ schema ต้นทาง |
| `REGISTRY.md` | กติการหัสเจ้าของใบงาน (`ownerEmail`) |
| `docker-compose.data.yml` / `docker-compose.formula.yml` | ฐานข้อมูล+PostgREST / blue-green+edge |

## 4. รันเทสต์

```sh
node --version        # ต้อง 22+
node --test tests/*.test.mjs
```
ผลที่ได้จากสำเนาแพ็กเกจนี้เอง (หลังตัดเอกสารและกลบอีเมล): **1,047 ผ่าน / 0 ไม่ผ่าน**
เทสต์ SQL บางข้อใช้ Postgres ชั่วคราว ต้องมี `postgres` ติดตั้งในเครื่อง

## 5. ขั้นตอนปล่อยของ

1. นำ `index.html` รุ่นใหม่เข้าระบบด้วย `sh scripts/seal-release.sh <git-ref>` — สคริปต์ดึงจาก `phossatron/Beyond-formula`, ตรวจว่ามี `let SB_URL`, `let SB_KEY` ครบ, คำนวณ hash, เขียน `releases/<hash>/` แล้วชี้ `releases/CURRENT`
2. `sh scripts/safe-deploy-formula.sh` — ลำดับห้ามสลับ: เทสต์เขียว → นโยบายฐานครบ → สำรอง+checksum → เตรียมสีสำรอง → สลับ (ถอยเองถ้าด่านหลังสลับไม่ผ่าน) → เทียบสองสี → บันทึกหลักฐาน
3. ถอยกลับ: ชี้ `releases/CURRENT` กลับรหัสเดิมแล้ว deploy ซ้ำ หรือใช้ blue-green สลับสีกลับ
4. รัน `scripts/*.sh` ที่อ้าง `$HOME/.hermes/...` ต้องปรับ path ให้ตรงเครื่องของ IT (ดูหัวข้อ 8)

## 6. กฎที่ห้ามละเมิด

**โครงสร้างข้อมูลถูกล็อก** ข้อมูลผู้ใช้เก่าอ่านไม่ออกถ้าเปลี่ยน:
- localStorage key: `fs_records`, `fs_reccounter`, `fs_user`, `fs_userlist`, `fs_chats`, `fs_activities`, `fs_imp`
- ห้ามเปลี่ยนชื่อ/ชนิด/ลบฟิลด์ของ record, user, chat, activity — เพิ่มฟิลด์ใหม่ที่เป็น optional ได้เท่านั้น
- รหัสงาน `A00001` (ตัวอักษร A–Z + เลข 5 หลัก) และตัวนับ `fs_reccounter` ห้ามย้อน
- ฝั่งเซิร์ฟเวอร์: ตาราง `fs_records`, `fs_chats`, `fs_users`, `fs_activities`, `fs_meta`, `fs_memberships` เก็บ object ทั้งก้อนใน `data jsonb` ห้ามแตกเป็นคอลัมน์
- ห้ามเรียก `saveRecordsStore()` ก่อน `loadRecords()` เสร็จ (เคยเกือบเขียนทับข้อมูลทั้งหมดด้วย array ว่าง)
- Export Excel เพิ่มคอลัมน์ได้เฉพาะต่อท้าย
- ทุกค่าที่ผู้ใช้พิมพ์ต้องผ่าน `esc()` ก่อนประกอบ HTML
- สิทธิ์ต้องเช็กใน `can()` / `requirePerm()` ที่ฟังก์ชันที่ลงมือทำจริง ไม่ใช่แค่ซ่อนปุ่ม
- แก้แอปทุกครั้งต้องเปลี่ยน build stamp ใน header (`hdr-sub`)

**ฝั่ง runtime** (รายละเอียดใน `docs/FORMULA-RUNTIME-RULES.md`):
- `runtime/data-policy.sql` ต้องรันหลัง `data-grants.sql` เสมอ
- สแตกทดสอบใช้ฐานข้อมูลเดียวกับของจริง อย่ายิงทดลองใส่ปลายทางที่เขียนข้อมูล
- ตัวกู้คืนห้ามใช้ `docker compose up -d` (proxy mount ตรงไม่มี build)
- ห้าม `docker system prune --volumes`, ห้ามลบไฟล์สำรองเพื่อเอาพื้นที่คืน
- ห้ามผ่อนด่านเพื่อให้ deploy ผ่าน

## 7. งานที่ค้างอยู่

| รายการ | สถานะ |
|---|---|
| `formula-runtime` PR #78 (บันทึกผล deploy) | เปิดค้าง เป็นเอกสารอย่างเดียว |
| `phossatron/Beyond-formula` PR #5 (rework PR #2) และ #1 (login ค้างเมื่อเซิร์ฟเวอร์ต่อไม่ได้) | เปิดค้างตั้งแต่ ก.ย. ต้องตัดสินใจ merge หรือปิด |
| ประวัติเวอร์ชันกลาง (`runtime/record-versions.sql`) | ต้องให้เจ้าของระบบ apply SQL บนฐานจริงก่อนฟีเจอร์ทำงานเต็ม ตรวจสถานะจริงก่อนเริ่ม |
| PR #89–#91 (Supabase standby, ประวัติแชตตามสิทธิ์, ซ่อนปุ่มกู้แชต) | merge แล้ว ยังไม่ยืนยัน deploy |
| งานใน branch ท้องถิ่นของผู้ว่าจ้าง | อยู่ใน `APPENDIX-branch-work/` (ยังไม่ได้ review/ทดสอบบน baseline และ apply patch ตรง ๆ ไม่ได้ ต้องพอร์ตเอง) · Cost Calculator มีเฉพาะเอกสารออกแบบ |
| ยืนยันว่าแชตใบงาน `A03984` ของผู้ใช้จริงเปิดได้ครบ | ยังไม่ยืนยัน |

## 8. สิ่งที่ต้องปรับเมื่อย้ายมาเครื่อง/ทีมใหม่

- Path `~/.hermes/apps/formula-studio` ใน `runtime/stack.env`, `scripts/safe-deploy-formula.sh` ฯลฯ เป็นของเครื่อง iMac เดิม — แก้ที่ `FORMULA_STATE_ROOT`
- `scripts/hermes-report-formula.sh`, `scripts/notify-telegram.sh` ส่งรายงานผ่านบอท Telegram ของ Hermes (ตัวเฝ้าระวังเดิม) ถ้าไม่ใช้ให้ปิด `*.plist` ที่เกี่ยวข้อง หรือเขียนตัวแจ้งเตือนใหม่ (เทสต์ `telegram-alert` จะต้องปรับตาม)
- `scripts/offsite-dest.sh` ชี้ Google Drive ของผู้ดูแลเดิม (ใส่เป็น `<account>`) — ตั้ง `FORMULA_DRIVE_ROOT` ใหม่
- `runtime/stack.env`: `FORMULA_EDIT_PROBE_USER` ถูกแทนด้วย UUID ศูนย์ ต้องใส่ id บัญชีตัวอย่างจริงของระบบใหม่
- การล็อกอินพึ่ง IAM ของ OPC (`IAM_CONSUMER_ORIGIN`) ต้องมี IAM ให้ต่อ หรือออกแบบ auth ใหม่
- ต้องสร้างไฟล์ `runtime/data.env` และ `runtime/formula.env` เองจาก `data.env.example` (ไม่มีความลับในแพ็กเกจนี้)

## 9. สิ่งที่ตัดออกจากแพ็กเกจ

เอกสารและโฟลเดอร์สำหรับเครื่องมือ AI (`AGENTS.md`, `.claude/`, `.superpowers/`, `docs/superpowers/`, prompt ของ Codex), รายงาน POSTLIVE/UAT/AUDIT/RECONCILE/EDGECASE รายวัน, `docs/evidence/`, `docs/handoff/` (รวม cloudflare-portal-worker ซึ่งเป็นระบบแยก), `DEBUG_LOG.md` (155 KB), `vercel.json` (ไม่ได้ deploy ผ่าน Vercel), ไฟล์ทดสอบชั่วคราว (งาน branch ปัจจุบันและเอกสาร Cost Calculator อยู่ใน `APPENDIX-branch-work/`)
อีเมลพนักงานจริงใน docs/tests ถูกแทนด้วย `example.com`; ชื่อโดเมนบริษัทคงไว้เพราะเป็นค่าตั้งค่า ไม่ใช่ความลับ
ประวัติเต็มดูได้จาก git ของ repo ต้นทาง
