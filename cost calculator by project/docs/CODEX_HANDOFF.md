# Prompt สำหรับ Codex — Cost Calculator

## Current verified handoff — 2026-09-06

Status: **LOCAL_VERIFIED / INTEGRATION_BLOCKED**. This section supersedes historical implementation counts and server-gateway descriptions below. The accepted architecture remains ADR 0002: local-first calculator and display-level role projections. This is not confidential server-side isolation and is not a 27/27 production completion claim.

- **A1 complete locally:** sourcing request acknowledgement/list and duplicate prevention; separate success notices; readable pending/field errors; kg/g/mg selectors; live partial formula sum; PK-not-applicable wording; historical revisions visibly read-only with a latest-revision action; unchanged saves do not create revisions. Failed catalog, revision, request and actual chat persistence cannot report success.
- **A2 complete locally:** five mutation regressions prove future validFrom, invalid priceBasisQuantity, malformed comma numbers, 9.9% formula mismatch and direct non-RD sendSummary authorization are detected. Each baseline passes and its corresponding in-memory mutation fails.
- **Source import complete locally:** the browser and CLI share canonical RmSourceMap/RmCatalogBuild code. Direct Data Center workbook import consumes the three added columns, validates dates, exclusions, LT units and duplicate identities, preserves incomplete records for review, and retires previous tiers for represented materials before applying a new source snapshot. Historical scenario snapshots stay unchanged. Duplicate material codes are blocked rather than guessed.
- **C preparation complete locally:** RmConfirmationAdapter provides preview, actor/terms binding, authorization, locking, verified backup, append/readback and idempotent confirmation with fail-closed eligibility. Its real binding is deliberately null. These tests do not prove that A03/A04 are installed or working in the live pilot.
- **A3 blocked by source input:** no corrected, authorized Data Center export was supplied in this worktree. Synthetic successful calculations do not establish a real usable-record count.
- **B decisions pending:** whether RD may enter a PU-PK-backed result and whether independent machine catalogs are acceptable. Preserve current accepted behavior; do not invent answers. LT for 19 records, 24 ambiguous rows and the six STD inputs still need accountable owners; blank is not zero.
- **D remains human/integration work:** actual source/binding validation, A07/A08/A09 installation changes, user UAT, CODEOWNER review and operator deployment. No live Sheet/script writes, messages, production data access, push or deployment occurred.

Verification: **292/292 module tests, 14/14 calculator browser cases, 37/37 parent browser cases and the required SQL suite passed**, with zero skipped module tests. Five mutation checks are included in the module count. Independent bounded agent review found persistence and stale-tier defects; both were fixed with regressions. This does not substitute for CODEOWNER final approval.

Parent browser harness now waits for the existing fixture's completion marker using bounded real-time CDP polling; virtual-time execution could stall on recurring app timers. Test assertions remain intact, network/configuration is scrubbed and browser profiles plus SQL temporary files stay inside this worktree's ignored .runtime directory.

### Traceability and impact

- task_id: cost-calculator-implementation-2026-09-05
- issue_id: none assigned
- branch: codex/cost-calculator-implementation; starting revision this session: bf6a3bb
- files_changed: index.html; harness.js; tests/cost-calculator-{core,local}.test.js; tests/cost-calculator-browser.fixture.js; tests/run-sql-tests.sh; project apps_script/RmCatalogBuild.gs and RmConfirmationAdapter.gs; tools/build-rm-catalog.js and sync-rm-browser-domain.js; focused project tests; TASK and handoff/execution/runbook documentation.
- tests_run/test_result: commands in CODEX_HANDOFF; results above, synthetic local data only.
- security_impact: stricter import eligibility and persistence failure handling; local-first confidentiality limitation unchanged. Critical review required for approval/integration-related changes.
- database_impact: no schema or production-data changes.
- permission_impact: no role grants changed; historical-edit and existing import/send capabilities enforced. Group B authority decision remains open.
- dependency_impact: no new package dependency; browser harness uses the available Node fetch/WebSocket APIs.
- rollback: revert this session's commit(s) after review; no data migration. Existing local catalogs/revisions are not automatically rewritten or deleted by a code rollback.
- open_risks: local browser data is readable by a person with local access; no live source readiness evidence; no real adapter binding; outstanding owner inputs and human gates above.
- pr_reference: none; no push, merge, release or final approval.


## Historical evidence and original work list


คัดลอกตั้งแต่เส้นด้านล่างจนจบไฟล์ไปวางเป็น prompt ได้เลย เนื้อหาเขียนถึง Codex โดยตรง

---

คุณกำลังทำงานต่อจากงานที่ทำค้างไว้ใน worktree นี้ **ห้ามทำงานนอก path นี้**

```
/Users/user/.codex/worktrees/cost-calculator-implementation
branch: codex/cost-calculator-implementation
HEAD ล่าสุด: 8559adc  (26 commits จาก baseline 3a9c32d)
```

## ลำดับการอ่านเอกสาร และแต่ละฉบับใช้ตัดสินอะไร

อ่านตามลำดับนี้ **ก่อนแตะโค้ดทุกครั้ง** ถ้าเอกสารขัดกัน ให้ยึดตามลำดับนี้ (บนสุดชนะ)

| # | ไฟล์ | ใช้ตัดสินเรื่อง |
|---|---|---|
| 1 | `AGENTS.md` (root) | กฎเหล็กอันดับ 1 · สิ่งที่ Codex ห้ามทำ · contract การรายงาน |
| 2 | `CLAUDE.md` (root) | โครงสร้างข้อมูลที่ล็อก · กฎ 10 ข้อของ Formula Studio |
| 3 | `cost calculator by project/docs/adr/0002-local-first-...md` | **สถาปัตยกรรมปัจจุบัน** local-first ไม่มี server บังคับสิทธิ์ · อะไรถูกยกเลิกไปแล้ว |
| 4 | `cost calculator by project/docs/COST_LADDER_MAPPING.md` | บันไดต้นทุน · การตัดสินใจ 4 ข้อของเจ้าของระบบ · ตารางอัตรามาตรฐาน |
| 5 | `cost calculator by project/docs/RD_DATA_CENTER_ASSESSMENT.md` | สภาพข้อมูลจริง · กติกาอ่านข้อความ · ตัวเลขที่วัดได้ |
| 6 | `cost calculator by project/TASK.md` | หัวข้อ "สถานะรายการค้าง" ท้ายไฟล์คือรายการที่เป็นปัจจุบัน |
| 7 | `cost calculator by project/docs/RM_SOURCE_FIX_RUNBOOK.md` | ขั้นตอนที่ **คนต้องรัน** ไม่ใช่คุณ |

**เอกสารที่ถูกแทนที่แล้ว อย่าทำตาม** `COST_GATEWAY_CONTRACT.md` และหัวข้อ "Trusted access boundary" ใน `SECURITY_VERSION_CONTRACT.md` อธิบายสถาปัตยกรรม server-enforced ที่ถูกยกเลิกโดย ADR 0002 ทั้งสองไฟล์มีแบนเนอร์กำกับไว้แล้ว เก็บไว้เป็นทางเลือกที่ผ่านการตรวจ ไม่ใช่แผนปัจจุบัน `migration` และ SQL test ที่เกี่ยวข้อง**ยังต้องผ่าน** ห้ามลบ

## สถานะปัจจุบัน

**LOCAL_VERIFIED / INTEGRATION_BLOCKED** — ยังไม่เคยคิดต้นทุนจากข้อมูลจริงได้แม้แต่รายการเดียว

ผ่าน: module 239 · calculator browser 8 · parent browser 37 · SQL 33

ตัวขวางเดียวคือ **ต้นทางยังไม่มีสามคอลัมน์**: ขนาดสั่งเพิ่ม · วันหมดอายุราคา · การรับรอง spec ราคาอ่านได้ 91.3% แล้ว แต่ทั้ง 23 ข้อเสนอที่ประกอบได้ยังคิดต้นทุนไม่ได้เพราะขาดสามอย่างนี้

## ข้อห้าม

- ห้าม deploy · ห้าม push · ห้ามเปิด PR · ห้ามแก้ protected branch
- ห้ามใช้ production secret · ห้ามส่งข้อความหรืออีเมลถึงคนจริง
- **ห้ามเขียนอะไรลง Google Sheets** สคริปต์ที่เขียนไว้ให้คนรัน ไม่ใช่ให้คุณรัน
- **ห้ามแก้ `local-only/legacy-workspace/apps_script/Code.gs`** เป็นสำเนาของ runtime และถูก gitignore
- ห้ามคัดลอกชื่อสาร ชื่อผู้ขาย ราคาจริง หรือ Google Sheets ID ลง repo / commit / log
- ห้ามแตะ locked key ตาม CLAUDE.md ข้อ 2 · key ใหม่ต้องมี loader ของตัวเองและห้ามเขียนก่อนโหลดเสร็จ (ข้อ 4)
- แก้ `index.html` เมื่อไร **ต้อง bump build stamp** (ข้อ 10) ปัจจุบัน `2026-09-05.15-uat-fixes`
- ห้ามอ้างว่าเสร็จหรือ production-ready จนกว่าจะผ่าน UAT / review / deployment

## งานที่ต้องทำ

### กลุ่ม A — ทำได้เลย ไม่ต้องรอใคร

**A1. ปิดช่องที่ผู้ใช้จริงชี้ว่ายังไปต่อไม่ได้**

- **คำขอจัดหาหายเข้ากลีบเมฆ** กด "ส่งคำขอจัดหาให้ Procurement" แล้วไม่มีข้อความยืนยัน และไม่มีหน้าจอไหนแสดงรายการคำขอเลย เก็บอยู่ใน `fs_cost.requests` เฉย ๆ — อย่างน้อยต้องมีข้อความยืนยันและหน้าจอรายการ
- **ช่อง "หน่วยน้ำหนัก" ให้พิมพ์เอง** พิมพ์ `G` ตัวใหญ่หรือ `กรัม` แล้วทั้งจอพังเงียบ ๆ โดยข้อความชี้ไปผิดช่อง ควรเป็น dropdown เหมือนช่อง "หมวด PK"
- **ไม่มียอดรวมสะสมระหว่างกรอก** ต้องกรอกครบทุกบรรทัดก่อนถึงจะเริ่มบอกเกิน/ขาด ซึ่งเป็นช่วงที่ต้องการดูที่สุด
- **ข้อความ pending เป็นภาษาโปรแกรมเมอร์** เช่น `รอ routing/STD version เจ้าของอัตรา หน่วย หรือยืนยันอัตรา` และ `ค่าใช้จ่ายเฉพาะงาน: รอข้อมูลหรือแก้รายการซ้ำ` ที่ขึ้นตั้งแต่เปิดโครงการเปล่า
- **เลือก "ไม่มีหมวด PK แยก" แล้วขึ้น `PK 0 บาท/ล็อต · ข้อมูลต้นทุนครบ`** ซึ่ง Sales อ่านว่าค่าบรรจุภัณฑ์ฟรี ควรแสดงว่า "ไม่มีหมวดนี้" แทนศูนย์
- **ปุ่ม "ลองเชื่อมต่ออีกครั้ง" โผล่ตอนสำเร็จด้วย** เช่นหลังนำเข้าแคตตาล็อกสำเร็จ ทำให้นึกว่าพัง
- **เปิด revision เก่าแล้วติดวน** ไม่มีคำเตือนว่าเป็นของเก่า ปุ่มบันทึกยังกดได้ พอกดแล้วขึ้นว่ามี revision ใหม่กว่า แต่ปุ่มที่ให้กดต่อคือ "ลองเชื่อมต่ออีกครั้ง" ซึ่งวนกลับที่เดิม
- **`กรุณาตรวจค่าตัวเลข` ไม่บอกว่าช่องไหน** ในจอมีช่องตัวเลขเกิน 8 ช่อง
- **กดบันทึกซ้ำสร้าง revision เปล่า** กด 4 ครั้งโดยไม่แก้อะไร revision วิ่งไป 4 เลข ทำให้เลข revision ในสรุปที่ส่ง Sales ไม่ได้แปลว่ามีอะไรเปลี่ยน

**A2. ปิดช่องโหว่การทดสอบที่ QA ชี้ไว้**

- `live()` ตรวจ `validFrom` ไม่มีเทสต์ครอบ — เปลี่ยนเงื่อนไขเป็น `true` แล้วเทสต์ยังผ่าน
- ตัวแยกวิเคราะห์ตัด `priceBasisQuantity` validity ออกแล้วยังผ่าน
- `RmSourceMap` กติกาจุลภาคสามหลักไม่มี fixture ที่จุลภาคตามด้วยเลขสองหลัก เช่น `"1,20"`
- `formulaComplete` tolerance `1e-9` เปลี่ยนเป็น `1e-1` แล้วยังผ่าน เพราะ fixture เดียวที่ไม่ตรงห่างแค่ 1 ULP — ความคลาดเคลื่อน 9.9% จะรอดไปได้
- `sendSummary:rd` เปลี่ยนเป็น `true` แล้วยังผ่าน ตัวกันตอนรันมีอยู่ แต่ไม่มีเทสต์ ซึ่งขัดกฎ 3 ชั้นของ CLAUDE.md ข้อ 8

**วิธีตรวจว่าแก้จริง** ทำ mutation ที่จุดนั้นแล้วเทสต์ต้องพัง ถ้าไม่พังแปลว่ายังไม่ได้ทดสอบสิ่งนั้น

**A3. หลังเจ้าของเติมข้อมูลต้นทางแล้ว ตรวจว่าคิดต้นทุนได้จริง**

```sh
node "cost calculator by project/tools/build-rm-catalog.js" <DataCenter export> -o .runtime/catalog.csv
node "cost calculator by project/tools/check-rm-catalog.js" .runtime/catalog.csv --show-values
```

รายงานจำนวน **พร้อมคิดต้นทุนทันที** ถ้ายัง 0 ให้บอกว่าติดอะไร **ห้ามเติมค่าให้เอง** ค่าว่างแปลว่ายังไม่มีข้อมูล

### กลุ่ม B — ต้องถามเจ้าของระบบก่อน ห้ามเดา

- **RD กรอกผล PK เองได้** ทั้งที่ป้ายบอกให้ใส่เฉพาะที่ PU-PK ยืนยันแล้ว ตั้งใจหรือควรกัน
- **Lead Time ของ 19 รายการ** วัดแล้วว่าจับคู่ด้วยชื่อได้ 4/23 และจับคู่บางส่วนได้ 0 แปลว่าเป็นคนละชุดข้อมูล **ห้ามทำ fuzzy matching เพิ่มโดยหวังว่าจะเจอ**
- **แคตตาล็อกอยู่ในเครื่องใครเครื่องมัน** RD สองคนนำเข้าคนละรอบจะได้ราคาต่างกันบนงานเดียวกัน เป็นผลโดยตรงของ local-first จะรับหรือจะแก้
- **24 แถวที่ตีความไม่ได้** MOQ เป็นช่วง 15 · จำนวนไม่ตรง 5 · หน่วยไม่ใช่น้ำหนัก 4 · ราคาเกินเพดาน 1

### กลุ่ม C — Critical Change ต้องผ่าน review

**A03 · A04 ที่ pilot script** — `RmData.gs` มี `confirm()` กับ `eligible()` ที่ปิดสองข้อนี้ในระดับโดเมนแล้ว งานคือเขียน **adapter ที่ให้คนรัน** แบบเดียวกับ `RmSourceFix.gs` และ `RmSchemaExtend.gs` คือ preview ก่อน · สำรองก่อนเขียน · idempotent · ไม่แตะแถวที่ไม่ชัด · เทสต์ใช้ mock บันทึกทุกการเขียน

### กลุ่ม D — ห้ามทำแทน

UAT กับผู้ใช้จริง · independent review จาก CODEOWNER `@phossatron` · deployment โดย Runtime Operator · A07/A08/A09 ที่ต้องแก้การติดตั้ง Apps Script จริง

## คำสั่งตรวจก่อนส่งงานทุกครั้ง

```sh
cd /Users/user/.codex/worktrees/cost-calculator-implementation
node --test tests/cost-calculator-core.test.js tests/cost-calculator-ui.test.js \
  tests/cost-calculator-local.test.js tests/cost-form-reconciliation.test.js \
  'cost calculator by project/tests/'*.test.js
node tests/run-cost-calculator-browser.js
node harness.js
./tests/run-sql-tests.sh
git diff --check
```

ทั้งสี่ชุดต้องผ่าน **ห้ามข้าม browser suite** เหตุผลอยู่ในบทเรียนข้อ 1

## สิ่งที่ต้องรายงานกลับ

files changed · commits · tests และผลจริงเป็นตัวเลข · security/database/permission/dependency impact · rollback · open risks · และระบุชัดว่า **LOCAL_VERIFIED** หรือ **INTEGRATION_BLOCKED** ห้ามรายงานว่า production complete

## บทเรียนจากรอบที่แล้ว อ่านก่อนเขียนโค้ด

ทั้งเจ็ดข้อนี้มาจากบั๊กจริงที่หลุดรอดเทสต์ไปแล้ว

1. **เทสต์เขียวหมดไม่ได้แปลว่าไม่พัง** ค่าดำเนินการเคยคิดต่ำไป **60 เท่า** โดยหน้าจอขึ้นว่า "ราคาพร้อมตรวจอนุมัติ" ไม่มี pending เลย เทสต์ 228 ข้อผ่านหมด เพราะทุกข้อใช้ `unitsPerPack = 1` ซึ่งเป็นค่าที่ทำให้จำนวนหน่วยขายเท่ากับจำนวนหน่วยที่ผลิตพอดี **เวลาเขียน fixture ให้ใช้ค่าที่แยกสองสิ่งออกจากกันได้**
2. **เทสต์ที่ผ่านเพราะสมมติฐานตายไปแล้ว** มี 4 assertion ที่ตรวจค่าที่เป็น `false` อยู่แล้วก่อนเทสต์จะทำอะไร (เพราะ fixture ไม่มี `currency`) ลบทิ้งทั้งสี่แล้วเทสต์ยังผ่าน **ทุกเทสต์ที่ยืนยันว่า "ต้องเป็น false" ต้องมี control assertion ก่อนว่า baseline เป็น true**
3. **อย่าไว้ใจชื่อเทสต์** มีเทสต์ชื่อ "fails closed without persistence" ที่ยังเขียวหลังระบบมี persistence แล้ว ถ้าเปลี่ยนพฤติกรรม ให้แก้ทั้งชื่อและ assertion
4. **`finite()` ในแกนปฏิเสธค่าติดลบ** เพราะ `num()` บังคับ ≥ 0 เคยทำให้ระบบบอก "เกิน" ได้แต่ไม่เคยบอก "ขาด" เลย **อย่าใช้กับผลต่างที่มีเครื่องหมาย**
5. **ระวัง cross-realm** `deepEqual` กับ array ที่สร้างใน `vm` ไม่ผ่าน และ `instanceof Date` ใช้ไม่ได้ ใช้ `.join()` หรือ duck typing
6. **ค่าที่แสดงบนฟอร์มกับค่าตั้งต้นของ draft ต้องตรงกัน** ไม่งั้น `costDraftDirty()` เป็นจริงตลอดและบล็อกทุกคำสั่งรวมถึงการรับผล PK
7. **อย่าเดาแทนคน** ทุกครั้งที่ข้อมูลกำกวม ให้ปฏิเสธพร้อมเหตุผลที่ตามต่อได้ ดีกว่าเดาแล้วได้ต้นทุนผิดแบบมองไม่ออก ตัวเลขที่ผิดเงียบ ๆ อันตรายกว่าระบบที่ไม่ยอมทำงาน

## หลักการออกแบบที่ต้องรักษาไว้

อย่ารื้อของพวกนี้ทิ้ง เป็นสิ่งที่ผู้ใช้จริงบอกว่าดีแล้ว

- **ข้อมูลไม่ครบ = คิดต้นทุนไม่ได้** แต่ยังต้องเห็นว่ามีของอยู่ พร้อมบอกว่าขาดอะไร
- **ไม่เดาค่าให้** ช่องว่างแปลว่ายังไม่มีข้อมูล ไม่ใช่ศูนย์
- **ราคาถูกตรึงใน revision** แก้อัตรากลางภายหลังไม่กระทบราคาที่บันทึกไปแล้ว
- **สรุปที่ส่ง Sales ประกอบจาก projection ของ Sales เสมอ** แม้ผู้ส่งจะเห็นต้นทุนดิบ
- **ระบบไม่เลือก Tier ให้** แสดงทุกตัวเลือกพร้อมข้อมูลที่ตัดสินใจได้
- **คนทำสูตรตั้งตัวคูณราคาเองไม่ได้** เป็นสิทธิ์แยก
- **ทุกอัตราและทุกกฎมีเจ้าของ เวอร์ชัน และวันหมดอายุ** หมดอายุแล้วไม่ให้ราคา ไม่ใช่ใช้ของเก่าต่อ
