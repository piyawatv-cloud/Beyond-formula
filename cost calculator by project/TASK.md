# Task handoff

## Status clarification — 2026-09-06

The previous combined label is split below. **LOCAL_VERIFIED is a completed verification result, not a blocker.** Integration cannot be marked passed without the listed evidence. Missing per-material data and pricing inputs block only affected calculations/quotation readiness, not all draft Formula/RM work.

| Workstream | Current status | Owner / evidence needed to close |
|---|---|---|
| Local implementation and automated verification | PASS — commit d6b73f5 | 292 module, 14 calculator browser, 37 parent browser tests and SQL suite passed. No local defect remains from the bounded review; this is not UAT. |
| RM price source structure | **DECISION_REQUIRED 2026-09-06** | ตรวจต้นฉบับราคา RM แล้วพบว่ามีราคา 158 รายการ แต่ Data Center พาผ่านมา 23 (~15%) · ตารางราคาไม่มีคอลัมน์รหัสสาร และตาราง RD-Code ไม่มีราคา · ชื่อตรงกันเพียง 3 จาก 158 แม้จับคู่แบบหลวมที่สุดก็ได้ 17 จึงเป็นคนละชุดรายการ ไม่ใช่ปัญหารูปแบบชื่อ · อ่านราคา/MOQ จากต้นฉบับได้ 65.2% ตั้งแต่วันแรก · ต้องตัดสินว่ารหัสสารมาจากไหน ก่อนเขียนตัวอ่าน ดู [ราคา RM ต้องจัดระเบียบอะไร](docs/RM_PRICE_SOURCE_REORG.md) |
| Real RM import / A3 | WAITING_FOR_INPUT | Procurement/RD provide an authorized sanitized corrected export within this worktree. Run shared converter and checker, report usable count and rejection reasons, and reconcile a chosen sample calculation with owner-approved expected results. No required minimum count is invented. |
| Ambiguous RM rows and missing LT | WAITING_FOR_DATA, affected records only | **เจ้าของยืนยันตัวเลขแล้ว 2026-09-06:** 24 แถวกำกวม และ 19 รายการที่ไม่มี LT ถูกต้อง Procurement เป็นผู้แก้ · รายการเหล่านั้นยังเลือกไม่ได้ · วัสดุที่ข้อมูลครบเดินหน้าต่อได้เอง |
| STD and selling-price inputs | WAITING_FOR_DATA, affected cost/quote only | **เจ้าของยืนยันตัวเลขแล้ว 2026-09-06:** ต้องการ 6 ค่า Production/Finance ให้อัตรา หน่วย วันที่มีผล ฐานจัดสรร และกฎราคา · draft และสรุปบางส่วนยังใช้ได้ · ห้ามใส่ศูนย์แทน |
| PK input responsibility | **RESOLVED 2026-09-06 — implemented** | เจ้าของระบบเลือก **PU-PK บันทึกเท่านั้น** แยกเป็น capability `recordPK` ต่างหากจาก `adoptPK` · RD บันทึกผล PK ไม่ได้แล้ว แต่ยังนำผลที่ PU-PK บันทึกไว้มาใส่ scenario ได้ · หลักฐานบันทึกชื่อผู้บันทึกจริง · PK ที่ยังไม่มายังไม่บล็อกงาน Formula/RM |
| Catalog consistency between machines | **RESOLVED 2026-09-06 — accepted with visibility** | เจ้าของระบบยอมรับว่า**แต่ละเครื่องมีแคตตาล็อกของตัวเอง** ไม่ต้องทำ workflow ร่วม · เพิ่มการบันทึกและแสดงที่มา (ชื่อไฟล์ ผู้นำเข้า เวลา จำนวนรายการ) พร้อมคำเตือนบนหน้าจอว่าเครื่องอื่นอาจใช้คนละชุด เพื่อให้ความต่างที่ยอมรับแล้วมองเห็นได้ ไม่ใช่ซ่อนไว้ |
| Live Procurement confirmation / A03–A04 | WAITING_FOR_BINDING_EVIDENCE | Source owner/operator provides sanitized mapping of identity, currentness, log/gate storage, locking and backup interfaces inside this worktree. Implement/review the binding and test in an approved test environment; null binding and synthetic adapter tests alone do not close this item. |
| Live Apps Script installation / A07–A09 | OPERATOR_GATE | Validate approved artifact/routing/configuration and capture operator evidence. Optional live-sync work does not block the existing manual-import local pilot path. |
| User acceptance and release | HUMAN_GATE | Execute existing UAT_COST_CALCULATOR.md with accountable users, resolve failures, obtain CODEOWNER approval, then operator deployment evidence. Codex cannot self-approve or deploy under AGENTS.md. |

Next executable step: obtain the corrected export and sanitized pilot-binding evidence **inside the allowed worktree**, then validate the actual import and confirmation path. Existing external Sheet/script links identify sources but do not prove current values or authorize bypassing the path/data boundary. Never attach confidential prices/supplier/formula values to a shared report; use aggregate counts and sanitized evidence.

This clarification changes documentation only. task_id: cost-calculator-implementation-2026-09-05; issue_id/pr_reference: none. files_changed: TASK.md, CODEX_HANDOFF.md, IMPLEMENTATION_EXECUTION.md. tests_run: documentation consistency checks and git diff --check; test_result: PASS, earlier runtime results retained without claiming a fresh test run. security/database/permission/dependency impact: none. rollback: revert this documentation commit. open_risks: evidence and decisions listed above. No data access, external writes, deployment or final approval performed.



## Phase E — ทางเข้า Cost Calculation, dashboard, tab · จากการย่าง 2026-09-06

สเปกอยู่ใน `SPEC.md` ส่วน "Grill round 9" · ธรรมนูญอยู่ใน `CLAUDE.md` ของโฟลเดอร์นี้ · ยังไม่มีงานใดเริ่ม
ลำดับตามที่บล็อกกัน: E1 ต้องเสร็จก่อนทุกอย่าง (ชั้น "ใบงาน" ครอบ scenario) · E2/E3 ต่อจากนั้น · E6/E7 อิสระ

**เริ่มได้เลย**

- [x] [E1-01] **เสร็จ 2026-09-07** (รหัส `CJ-000001` ใช้ค่าเริ่มต้นตามที่ตกลง) — เพิ่มชั้น "ใบงานต้นทุน" ใน `fs_cost` (รหัสภายใน · projectId nullable · เจ้าของสูตร · โคลนจาก) ครอบ `scenarios[]` เดิมโดยไม่เปลี่ยนโครง scenario — เสร็จเมื่อ: ข้อมูล `fs_cost` เก่าโหลดแล้ว migrate เป็นใบงานที่ผูก projectId เดิมได้ครบ รันซ้ำไม่พัง มีเทสต์ mutation — ต้องรอ: รูปแบบรหัส (เจ้าของระบบ · ถ้าไม่ตอบใช้ `CJ-000001`)
- [x] [E1-02] **เสร็จ 2026-09-07 — Critical Change รอ CODEOWNER** `costCapabilities().open` ปฏิเสธ Sales/OPC/Finance/CEO/PD/RA/MKT · ซ่อนปุ่ม "คำนวณต้นทุน" ในตาราง Dashboard และปฏิเสธ `#project=` สำหรับ role เหล่านั้น — เสร็จเมื่อ: เทสต์ครบทุก role ทั้ง 3 ชั้น · harness 37/37 ยังผ่าน — ต้องรอ: —
- [x] [E2-01] **เสร็จ 2026-09-07** ปุ่มเมนู Cost Calculation ท้ายซ้ายใกล้ Dashboard · แสดงเฉพาะ RD/Admin/PU-PK/Purchasing — เสร็จเมื่อ: `renderUserUI` ซ่อน/แสดงถูก · เทสต์ browser ตรวจว่า Sales ไม่มีปุ่มใน DOM — ต้องรอ: E1-02
- [x] [E2-02] **เสร็จ 2026-09-07** (งานลอยยังเปิดจาก dashboard ไม่ได้จนกว่า E4) Dashboard ใบงานต้นทุน 9 คอลัมน์ + ค้นหา + 4 สถานะหน้า — เสร็จเมื่อ: AC2 · ค้นหาวาดใหม่เฉพาะตาราง (ใช้แนวเดียวกับ `costCatalogBody`) — ต้องรอ: E1-01
- [x] [E3-01] **เสร็จ 2026-09-07** (งานลอยใช้รหัส CJ เป็นคีย์ scenario เพราะ core ล็อกตัวตนที่ projectId) หน้าสร้างใบงานต้นทุน: อ้างอิง Formula / สร้างลอย / โคลน — เสร็จเมื่อ: AC3 + AC4 · โคลนแล้ว `validUntil` ถูกตรวจใหม่ — ต้องรอ: E1-01
- [x] [E3-02] **เสร็จ 2026-09-07** (ผูก = revision ใหม่ใต้ใบงาน Formula · revision เก่ายังอยู่ใต้ jobId) ผูกใบงานลอยจากใน tab · ปฏิเสธผูกซ้ำพร้อมชื่อเจ้าของ — เสร็จเมื่อ: AC3 — ต้องรอ: E3-01
- [ ] [E4-01] แถบ tab ภายในแอป · หลายงาน · จุดแสดง draft · ปิดต้องยืนยัน — เสร็จเมื่อ: AC5 · `costState` แยกต่อ tab ไม่ปนกัน — ต้องรอ: E2-02
- [ ] [E4-02] ใบงาน Formula ปิดแล้ว → tab อ่านอย่างเดียว โคลนได้ — เสร็จเมื่อ: AC6 — ต้องรอ: E4-01
- [ ] [E5-01] หน้าเอกสารอ่านอย่างเดียวสำหรับ CEO + ลิงก์ในแชทที่ชี้ revision คงที่ — เสร็จเมื่อ: AC7 · Sales เปิดลิงก์ถูกปฏิเสธ — ต้องรอ: E1-02
- [ ] [E6-01] หน้าตั้งค่ากฎราคา/อัตรามาตรฐานสำหรับ Finance/CEO/Admin · ย้ายส่วนตั้งค่าออกจากเครื่องคำนวณ — เสร็จเมื่อ: AC8 · เทสต์เดิมเรื่อง setPricing ยังผ่านหรือถูกย้ายอย่างมีเหตุผล — ต้องรอ: —
- [ ] [E7-01] อัปเดต `docs/UAT_COST_CALCULATOR.md` ให้มีกรณี AC1–AC9 และแบบจับเวลา 30 วินาที — เสร็จเมื่อ: เจ้าของระบบยอมรับแบบฟอร์ม — ต้องรอ: —

**ติดรอคนอื่น**

- [ ] [E0-01] ยืนยันรูปแบบรหัสภายใน · ชื่อปุ่มเมนู · ตำแหน่งปุ่ม — รอ: เจ้าของระบบ (ดู SPEC "ยังไม่ยืนยัน")
- [ ] [E8-01] UAT จริง: RD 1 คน 1 ใบงาน จับเวลา — รอ: RD จริง + เจ้าของระบบตัดสิน (AC10)
- [ ] [E8-02] CODEOWNER `@phossatron` review (แตะ permission = Critical Change) — รอ: หลัง E8-01
- [ ] [E8-03] Runtime Operator deploy — รอ: หลัง E8-02

**จุดถอยกลับ**: ทุก Phase อยู่ใน `fs_cost` และ marker block ของ Cost Calculator ใน `index.html` · ถอย = revert commit ของ Phase นั้น ข้อมูล `fs_cost` รูปแบบใหม่ต้องอ่านด้วยโค้ดเก่าได้ (ชั้นใบงานเป็นฟิลด์เสริม scenario เดิมไม่เปลี่ยน) จึงถอยได้โดยไม่เสียข้อมูล

**เจ็บที่สุดถ้าพัง (ลำดับที่ต้องมีเทสต์ก่อน)**: ราคาผิดถึงลูกค้า → ต้นทุนรั่วไป role ที่ถูกตัด → ของเดิม Formula Studio พัง → งานลอยหาย/ผูกผิด

---

## Independent verification round — 2026-09-06 (Claude Code)

รับช่วงตาม `docs/CLAUDE_CODE_HANDOFF.md` ตรวจสถานะจริงก่อนแก้ ไม่ reset ไม่รื้อของที่ผ่านแล้ว

**ยืนยันคำกล่าวอ้างของ commit ก่อนหน้าด้วยการรันเอง** module 292/292 · calculator browser 14/14 · parent browser 37/37 · SQL 33 · `git diff --check` clean · skipped 0 ตรงกับที่รายงานไว้ทุกตัว

**พิสูจน์ว่ากลไกใหม่สองตัวจับความพังได้จริง ไม่ใช่เขียวเพราะเลิกตรวจ**

- *parent harness ที่เขียนใหม่* — ทำ mutation ให้ `esc()` ไม่ escape บนสำเนาใน `/tmp` แล้ว harness คืน exit 1 พร้อมระบุชื่อเทสต์ XSS ทั้งสองข้อ (35 ผ่าน 2 ล้ม) การเปลี่ยนจาก virtual-time เป็น real-time CDP polling จึงไม่ได้ลดอำนาจการตรวจ
- *parity guard ระหว่าง canonical `.gs` กับสำเนาใน `index.html`* — แก้เพดานราคาใน canonical โดยไม่ sync แล้วเทสต์ `embedded browser adapters match canonical Apps Script byte-for-byte` ล้มทันที กฎสองชุดจึงแตกกันเงียบ ๆ ไม่ได้

**ยืนยันคุณสมบัติตามข้อ 6 ของ handoff** ด้วย scenario ที่ไม่มี PK ไม่มีกฎราคา และไม่มีอัตรา Operation: บันทึก revision ได้ · เห็นและแก้ตาราง RM ได้ · แถบรวมปริมาณทำงาน · ได้ข้อความสรุปบางส่วน · และราคาต่อหน่วยถูกปิดไว้ถูกต้อง ข้อมูลที่ขาดจึงปิดเฉพาะความพร้อมด้านราคา ไม่ได้ปิดงาน draft

**ยืนยันว่า `RmConfirmationAdapter` fail-closed** ทั้ง `preview` และ `apply` ปฏิเสธด้วย `REVIEWED_PILOT_BINDING_REQUIRED` เมื่อ binding เป็น null

**ข้อ 1–3 ของ handoff ทำต่อไม่ได้** ตรวจแล้วไม่มี corrected Data Center export และไม่มี sanitized binding evidence อยู่ใน worktree จึงเดินท่อทั้งเส้นด้วยไฟล์สังเคราะห์แทน เพื่อพิสูจน์ความพร้อมและถอดข้อกำหนดของไฟล์ที่ต้องส่งมา บันทึกไว้ใน [ประเมิน RD Data Center](docs/RD_DATA_CENTER_ASSESSMENT.md) ท้ายไฟล์ — **ข้อค้นพบสำคัญคือถ้า export ขาดคอลัมน์ `Price Status` จะไม่มีแถวไหนใช้ได้เลย และรายงานจะขึ้นว่า "ยังไม่ confirmed" ซึ่งดูเหมือนปัญหาของข้อมูล ไม่ใช่ปัญหาของไฟล์**

ไม่มีการเขียนลง Google Sheets · ไม่มีการอ่านข้อมูลธุรกิจจริง · ไม่มีตัวเลขธุรกิจถูกสร้างขึ้นแทนข้อมูลที่ไม่มี · สถานะทุก workstream ในตารางด้านบนไม่เปลี่ยน

## Current verified handoff — 2026-09-06

Previous aggregate status: **LOCAL_VERIFIED / INTEGRATION_BLOCKED**; see the workstream statuses above. This section supersedes historical implementation counts and server-gateway descriptions below. The accepted architecture remains ADR 0002: local-first calculator and display-level role projections. This is not confidential server-side isolation and is not a 27/27 production completion claim.

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


## Historical record — superseded where inconsistent

## ส่งมอบพื้นที่ครั้งนี้

- [x] ตรวจparent AGENTS/CLAUDEและtargetว่างก่อนเขียน
- [x] เก็บข้อยืนยันworkflowล่าสุด: Formula→RM/PK/Operation DL+OH→Procurement→Cost→Sales revisions→CEO→actual
- [x] แยกlegacy archiveจากcurrent specificationและignoreจากGit
- [ ] การimplementation, UAT, release: ยังไม่ได้ทำในงานนี้

## ลำดับงานถัดไป (ยังไม่อนุมัติdeployment)

Grill-with-docs continuation 2026-09-05: ใช้ task label เดิมเพื่อความต่อเนื่อง; Issue ID ยังไม่มี. รอบนี้ local documentation only ใน SPEC.md/REGISTRY.md/CONTEXT.md/TASK.md; ห้ามแก้ parent application, runtime, schema, permissions หรือส่งข้อความ/อีเมลจริง. Owner ผู้ใช้; CODEOWNER หลัก @phossatron แต่ independent reviewer สำหรับ implementation ยังไม่แต่งตั้ง. เอกสารรอบนี้ไม่ใช่ Critical runtime change; การเชื่อม chat/identity/permission/sync ในอนาคตต้องประเมิน Critical Change ตาม parent.

- [x] บันทึกคำตอบ grill รอบ 1 พร้อมแยกข้อเสนอที่ยังไม่ยืนยัน
- [x] บันทึกคำตอบรอบ 2: Data Center only, internal cost chat, Sales/OPC restrictions, reuse scope, STD fields
- [x] รอบ 3: บันทึก Q10–Q13 เรื่องวัสดุใหม่/RD spec, ชื่อแสดงกลางและหน้าสูตร, restricted view, partial estimate, STD states
- [x] รอบ 4: Q14–Q16 ชื่อกลาง/เฉพาะ revision, missing-name placeholder, แยก cost readiness จาก selling-price policy
- [x] รอบ 5: Q17–Q20 หน่วยขาย, loss ownership, WMS ภายหลัง, ค่าใช้จ่ายรอข้อมูล, RM/PK price segregation
- [x] รอบ 6: Q21–Q23 แยกก่อนบวก/หลังบวก/final, RD-PK segregation, Sales adjusted totals, finance/CEO scoped visibility, other-cost gate
- [x] รอบ 7: Q24–Q26 Procurement split/Operation access, pre-WMS purchase basis, confirmed Tier selection
- [x] รอบ 8: Q27–Q29 PK ownership, ตัด delivery LT ออกจาก scope, ใช้ PU-PK แหล่งเดิม
- [x] Source prerequisite: ผู้ใช้ให้ PU-PK source; ตรวจ metadata และหัวคอลัมน์ 7 tabs แบบ read-only
- [x] Q30 PK authority: PU-PK engine/snapshot; PK delay must not block Formula/RM
- [ ] PK validation: requester price/history/status semantics; ไม่รับ policy/rates เดิมอัตโนมัติ
- [ ] ก่อนปิด G2: integration/revision contract, acceptance checks, independent reviewer และ shared-understanding confirmation; pricing/STD/loss ตัวเลขรอกำหนด ไม่สมมติค่า

1. อ่านlocal-only auditและตรวจcurrent code/Sheetsใหม่; ตั้งtask/issue/reviewerตามparent governance.
2. ยืนยันFormula integration, PU-PK source, operation steps/rates/owner และตัวอย่างprojectที่ได้รับอนุญาต.
3. แก้A01–A06 parser/exclusion/version/history/approvalพร้อมtestsและsource reconciliation.
4. แก้A07–A10 single costing route/sync safety/permission evidence/docs consistency; manual runก่อน30-minute schedule.
5. ออกแบบและทดสอบRM+PK+DL+OH cost calculator, unit conversion, yield, setupและbatch allocationตามSPEC.
6. Sales scenarios/revision/customer view; pricing configurationเว้นค่าไว้จนownerกำหนด.
7. CEO approval/immutable quote snapshotและre-approvaltests; role/permissionchangesเป็นCritical Changeตามparent.
8. UATร่วมRD/Procurement RM/PU-PK/Sales/CEO ตาม scope ราคาพร้อมเสนอและ Formula chat; WMS/actual cost mapping แยกไว้หลัง go-live ไม่เป็นเกณฑ์บังคับรอบนี้.

## Verification / impact / rollback

Handoff checks: archiveเทียบเนื้อหาsource, Code.gs SHA256ตรง, Gitignore local-onlyทำงาน, ไม่มีparent application changes. Application testsไม่รันเพราะไม่มีapplication edit; ไม่ถือว่าระบบผ่านtests.
Security: เพิ่มlocal-only ignore; ไม่มีupload. Database/permission/dependency impact: none. Rollback: ลบเฉพาะเอกสาร/สำเนาใหม่ในโฟลเดอร์นี้เมื่อownerร้องขอ; source workspaceเดิมยังอยู่. PR/commit/release: none. Open risk: local archiveมีข้อมูลธุรกิจอ่อนไหว ไม่ได้รับการเข้ารหัสเพิ่มเติมและห้ามforce-add.


Grill round 2 documentation verification: SPEC/REGISTRY/CONTEXT/TASK updated only; checks cover required decisions, pending-proposal labels and whitespace. No application tests or live verification; no security/database/permission/dependency changes applied. Rollback: reverse only this round's document edits. No PR/release. Historical audit FAIL remains unresolved.


Round 3 checks: verified Q10–Q13 recorded and conflicting pending statements updated; four documentation files only. Security/database/permission/dependency runtime impact none; application tests not run. Rollback limited to these edits; no PR or release. Audit FAIL remains open.


Round 4 checks: SPEC/REGISTRY/TASK updated for Q14–Q16; stale pending-name/pricing-separation text removed. Required decision and whitespace checks passed. Documentation only; application tests not run; security/database/permission/dependency impact none. Rollback: reverse only this round's document changes. Task label unchanged; no Issue/PR/release; historical audit FAIL unresolved.


Round 5 verification: SPEC/REGISTRY/CONTEXT/TASK updated only; Q17–Q20 and new undecided price/access requirements checked, whitespace checked. No runtime security/database/permission/dependency changes; application tests not run. Future access-control implementation is Critical Change requiring independent review. Rollback only this round's document edits. Task/Issue/PR status unchanged; audit FAIL unresolved.


Round 6 checks: SPEC/REGISTRY/CONTEXT/TASK updated; Q21–Q23 override older Sales-cost wording explicitly. Four-file whitespace and decision-presence checks passed. Application tests not run; runtime security/database/permission/dependency impact none. Rollback only this round's edits. Existing task label; no Issue/PR/release; audit FAIL still open.


Round 7 checks: SPEC/REGISTRY/TASK only; Q24–Q26 and remaining PK Tier permission boundary recorded. Whitespace/decision checks passed; no application tests. Runtime security/database/permission/dependency unchanged; rollback only these document edits. Task label unchanged, no Issue/PR/release, audit FAIL open.


Read-only Formula source evidence (round 7, not live verification): index.html nextRecordId() around line 3900 persists project id; chat jobId links to record.id (createChat/openChatRoom around 4664/4700). Existing edits overwrite rows (around 2498, chatSaveFormula around 5085); no persisted formula revision identifier found in this inspection. Existing jobDetailHTML/chat/exportChatExcel/buildBriefText paths expose full ingredient names; ROLES around 2741 has one purchasing role, not the proposed RM/PK/Operation scopes. G2 must design backward-compatible revision references and all relevant disclosure paths; hiding the calculator alone is insufficient. These are implementation gaps, not authorization to change parent code. No production records read.


Round 8 checks: SPEC/REGISTRY/TASK updated for Q27–Q29; removed delivery-LT decision and current-release actual integration requirement. Source-location absence remains explicit. Decision/scope/whitespace checks passed. No application tests; security/database/permission/dependency runtime changes none; rollback this round document edits only. Task label unchanged; Issue/PR none; audit FAIL unresolved. Static Formula inspection additionally found rows.p is concentration %, not supplier price; never map it to material price by name. Current RD capability and one purchasing role differ from designed ownership; G2 must cover capability migration through Critical Change review.


PU-PK inspection checks: metadata success; 7 bounded header reads success; no business rows/formulas read; schema evidence is not a functional test. Updated SPEC/REGISTRY/TASK and local-only/PU_PK_SOURCE_REFERENCE.md. Verify local-only ignore before handoff. Security/database/permission/dependency changes none; no source edits/sends/import/deploy. Rollback only these local doc edits; original source unchanged. No Issue/PR; audit FAIL unresolved. User-provided source location dependency resolved; semantic/runtime validation still open.


Q30 plan boundary: prepare formula/RM/scenario/role-safe chat work independently of PU-PK verification/adapter work; test the interface using synthetic fixtures while PK validation remains pending. This is workstream separation, not approval to implement/deploy or spawn ongoing tasks. Add independent-progress acceptance cases from SPEC. Q31 confirms unchanged-spec/quantity/pack/terms/validity reuse; confirmation-status branch resolved: unconfirmed draft allowed, confirmed applicable version required for ready quote. Record rationale in docs/adr/0001-reuse-pk-calculation-with-independent-rm-progress.md.

Q30 verification: SPEC/REGISTRY/TASK + one accepted architectural decision record; required decision/whitespace checks passed. No application tests run or runtime security/database/permission/dependency changes. Rollback only these local docs. Existing task label; Issue/PR none; audit FAIL and PK formula/runtime validation remain open.


Q31 documentation check: SPEC/REGISTRY/TASK updated; unchanged PK applicability recorded, ambiguous confirmation phrase explicitly unresolved. Required-text/whitespace checks passed. No application tests or runtime security/database/permission/dependency changes; rollback this round docs only. Existing task label; Issue/PR none; audit FAIL unchanged.


Q31 clarification recorded. New requested design topic: repeated PK sourcing/negotiation/version changes. SPEC now proposes single-source PU-PK confirmation plus calculator adoption; no runtime implementation or actual source-state assumptions. Next evidence required: sanitized PU-PK formulas/code/state transitions and stable project/request mapping before final adapter design. Checks: clarified gate and proposal labels present; three doc whitespace checks passed. No application tests; runtime security/database/permission/dependency unchanged. Rollback these doc edits only; task label unchanged, Issue/PR none, audit FAIL unresolved.


## User-authorized trial — current turn

Scope now includes a bounded local synthetic workflow prototype under local-only/pk-workflow-trial and evidence report docs/PK_WORKFLOW_TRIAL.md, authorized by user request to try the accepted flow. Parent source/runtime/schema/permissions, Sheets writes, real messages/emails and production deployment remain forbidden in this trial. Environment local; synthetic data only; no production secrets. Existing task label/Issue status unchanged; owner user; no independent final approval claimed.

- [x] Implement local version-negotiation/adoption model consuming synthetic PK totals (no PK pricing engine).
- [x] Run 14 contract tests; retain red/green logs and 5-step walkthrough.
- [x] Check parent source hashes unchanged and trial ignored by Git.
- [x] Record limitations: no live integration, source-formula, real permission or UAT validation.
- [ ] Next integration evidence: approved/sanitized PU-PK code/formulas and status semantics, then non-production adapter verification under parent governance.

Outcome PASS_LOCAL_PROTOTYPE_ONLY. No application regression suite run because parent application unchanged. No security/database/permission/dependency runtime impact. Rollback new trial/report and this turn's doc edits only. No PR/release; historical audit FAIL remains unresolved.


## Implementation planning verification — 2026-09-05

Requested skill notion-spec-to-implementation applied using local SPEC/REGISTRY and recorded trial/static evidence. Notion search for Cost Calculator and Beyond Formula both returned USER_NOT_LOGGED_IN; no further Notion mutations attempted. Local plan prepared while Notion workflow awaits connection.

Checks: 27 unique task labels; every dependency resolves; graph acyclic; RM tasks P05–P13 have no transitive dependency on PK source/adapter tasks P04/P17–P19; R01–R12 covered; local document links resolve; whitespace valid; no exact confidential source IDs/URLs copied into plan. No application tests rerun for unchanged code. Planning test_result PASS_DOCUMENT_CHECKS, NOTION_NOT_CREATED. Files changed: docs/IMPLEMENTATION_PLAN.md, SPEC.md, REGISTRY.md, TASK.md. Runtime security/database/permission/dependency impact none. Rollback only new plan and this turn's documentation edits. Existing task label/Issue/PR unchanged; audit FAIL and live PK integration remain unresolved.

## Local implementation execution — 2026-09-05

User requested all P01–P27 and cancelled Notion. Work continues in isolated branch `codex/cost-calculator-implementation`, baseline `3a9c32d17ef1626b7955ca9b0334ecd7a010b774`. Source-of-work path: `/Users/user/.codex/worktrees/cost-calculator-implementation`. See [execution report](docs/IMPLEMENTATION_EXECUTION.md) and [current 27-task plan](docs/IMPLEMENTATION_PLAN.md).

Implemented and tested actual app core/UI, RM domain, PK contract adapter, and summary/approval workflow domain. Gateway remains disabled; trusted auth/persistence/projections and actual integration remain incomplete. No Notion work, production writes, real messages, Issue/PR/publication or deployment occurred. PU-PK source provided later in the session was read in the editor; mapping consequences are recorded in docs/PK_SOURCE_MAPPING.md.

Final local verification after changes:

- Actual-module Node tests: **97 passed / 0 failed** (core 28, UI 23, RM 18, PK 16, workflow 12).
- Actual calculator browser fixture: **8 passed / 0 failed**, synthetic configuration/identity/network only; desktop layout screenshot inspected.
- Required parent browser suite `node harness.js`: **37 passed / 0 failed**.
- Required local SQL suite: **PASS SQL authorization and rollback contract** plus **PASS cost gateway projection, revision, patch and outbox contract**, exit 0; migration idempotency, default-deny gate, role-boundary, projection allowlist, line-overlay and expected denied-access assertions included. Production SQL/schema unchanged; migration is not deployed.
- `git diff --check`: PASS. Plan: 27 unique IDs, relative evidence links resolve, no confidential source reference IDs in 24 inspected project files.
- Internal independent review: original identified defects closed with focused regression evidence; latest touched review **51/51 PASS**, no new blocking finding within its scope. This is not human final review or live security approval.

Status: LOCAL_VERIFIED_COMPONENTS / INTEGRATION_BLOCKED, not 27/27 delivery complete. P27 repository tracking done. P20 trusted access contract plus PK confirmation/context mapping and supplied operating policies remain required before confidential-data UAT. P24 business UAT, P25 independent release approval and P26 operator deployment remain unperformed. Full fields/impacts/rollback in execution report.

## Client/gateway contract reconciliation — 2026-09-05

Continuation of the same task label `cost-calculator-implementation-2026-09-05`; no Issue/PR assigned, no Notion. Scope: reconcile the browser `cost-v1` client against the local additive gateway migration, build the capability matrix, plan the client/cache transition, and add server-layer negative tests. The gateway was **not** enabled outside the synthetic SQL test database; no production runtime, schema, grant, secret or message was touched.

New evidence document: [gateway contract](docs/COST_GATEWAY_CONTRACT.md).

- [x] Rerun the full suite before editing: 97 module, 8 calculator browser, 37 parent browser, SQL exit 0
- [x] Reconcile client actions/fields against the RPCs; record gaps instead of inventing endpoints
- [x] Capability matrix for RD / Procurement RM / PU-PK / Production / Finance / CEO / Sales-OPC against the real role check
- [x] Ordered client/cache transition plan that never writes a redacted projection over an authoritative record
- [x] Ten added server-layer negative tests (role boundaries, stale revision, idempotency conflict, approval immutability, private-store access)
- [x] Verify the safe projection hides supplier name/price, full material name, nested raw JSON and source document
- [x] Verify an approved snapshot stays byte-stable across a new revision and a changed source
- [x] Update implementation/UAT/security docs to match the source
- [ ] Blocked: Procurement RM vs PU-PK split, Production/Finance/CEO role values, CEO approval authority, `viewRevision` assignment, project scoping beyond Sales, the `/v1/cost/*` service layer, legacy raw-grant revocation

Code changes: `supabase/migrations/20260905140000_cost_gateway_contract.sql` (explicit `viewRevision` deny; raw-Operation role trapdoor removed; explicit `COST_STALE_REVISION`), `tests/sql/cost_gateway_test.sql` (+10 checks), `tests/run-sql-tests.sh` (pin `LC_ALL`). `index.html` unchanged, so no build stamp bump was required.

Verification: module 97/97, calculator browser 8/8, parent browser 37/37, SQL 32 named checks exit 0 (22 before), `git diff --check` clean. Security impact: strictly narrowing — one dead raw-disclosure branch removed, one capability made an explicit deny, one error contract corrected; no grant widened. Database impact: the additive migration is unchanged in shape and still not deployed; locked Formula keys/types untouched. Permission impact: no production grant/role/IAM change; no new role value invented. Dependency impact: none.

Rollback: revert this round's commit; the gateway stays default-deny either way and no production rollback is needed.

Status: LOCAL_VERIFIED / INTEGRATION_BLOCKED. Not 27/27, not production-ready. P24 UAT, P25 independent review and P26 operator deployment remain unperformed.

## Capability snapshot and fresh-open contract — 2026-09-05

Same task label; still no Issue/PR, no Notion, no deployment, gateway never enabled outside the synthetic SQL test database.

- [x] Verify the claimed module-level negatives are real, not just well-named: `exact project scenario requirement and quantity context required` genuinely patches `specVersion`/`sellingUnits`/`unitsPerPack`/`fillAmount`/`fillUnit`/`requirementRevision` and asserts a `/CONTEXT/` throw; `duplicate result is idempotent; changed bytes under same ID are rejected` asserts `CONTENT_CONFLICT` and that the stored total is unchanged
- [x] Pin the capability surface of every schema role value with an exact-object snapshot test, plus a drift check that fails if a role allowed by the `fs_memberships` role check is missing from the snapshot
- [x] Mutation-test that guard twice: granting `rd` a `viewRevision` and adding a new `rawPkView` capability key are both caught, the second with an explicit expected-versus-got diff
- [x] Pin the fresh-open client contract (`scenarioId: null`, `expectedRevision: null`) and server-resolved scenario adoption with two client tests
- [x] Replace the hand-written role list in the drift check with `pg_get_constraintdef` on the `fs_memberships` role check, so a role added to the schema and not to the snapshot fails by name; mutation-tested by dropping `mkt` from the snapshot
- [x] Record that the browser entry gate is still the legacy `chat` permission, so rule 8's three-layer requirement is met by the RPCs rather than the client

Code changes: `tests/sql/cost_gateway_test.sql` (+1 snapshot check, 33 total), `tests/cost-calculator-ui.test.js` (+2 client tests, 99 module tests total). No migration or application change in this round.

Verification: module 99/99, calculator browser 8/8, parent browser 37/37, SQL 33 named checks exit 0, `git diff --check` clean. Security/database/permission/dependency impact: none — tests only. Rollback: revert this round's commit.

Status unchanged: LOCAL_VERIFIED / INTEGRATION_BLOCKED.

## Local-first pivot — 2026-09-05

System Owner ตอบคำถามสถาปัตยกรรม 4 ข้อ: ตารางสิทธิ์แยกต่างหาก, **local-first เต็มรูปแบบไม่ใช้ Supabase**, RD เปิดได้ทุกโครงการ, deep link เฉพาะ RD/Admin. บันทึกใน [ADR 0002](docs/adr/0002-local-first-cost-calculator-without-server-enforcement.md) พร้อมผลกระทบที่เจ้าของรับทราบแล้วว่าการแยกสิทธิ์กลายเป็น display control ไม่ใช่ access control

- [x] เขียน ADR ก่อนแตะโค้ด และระบุผลกระทบด้วยถ้อยคำของตัวเลือกที่เจ้าของเลือก
- [x] ติดสถานะ SUPERSEDED ให้ COST_GATEWAY_CONTRACT.md และปรับ acceptance ข้อ 2–4 ใน SECURITY_VERSION_CONTRACT.md ว่า "ทำไม่ได้ในโหมดนี้" ไม่ใช่ TODO ค้าง
- [x] เก็บ migration และ SQL test 33 ข้อไว้ทั้งหมด ยังต้องผ่านตามกฎข้อ 7 และเป็นทางเลือก server-enforced ที่ผ่านการตรวจแล้ว
- [x] เพิ่ม `COST_CALCULATOR_LOCAL` block: store `fs_cost` (key ใหม่แบบ additive), loader แยกที่ห้ามเขียนก่อนโหลดเสร็จ, ตารางสิทธิ์ `COST_ROLE_DEFAULTS`, transport ท้องถิ่นครบ 7 action
- [x] ต่อ `costRequest` ให้เข้า local store เมื่อยังไม่ตั้ง `COST_API_ORIGIN` โดยคง network path ไว้เป็นทางเลือกที่ตรวจแล้ว
- [x] เพิ่ม `Procurement RM` ใน `CostCalculator.project()` — พบว่าเดิมบทบาทนี้ได้ shape "ไม่มีสิทธิ์" ที่ UI จะปฏิเสธ
- [x] bump build stamp เป็น `2026-09-05.3-cost-local` (กฎข้อ 10 มีผลรอบนี้)
- [ ] ยังไม่ตัดสิน: สรุปที่ค้างใน outbox จะส่งเข้า `fs_chats` ในเครื่องหรือไม่ (แตะ store ที่ล็อก ต้องตัดสินแยก)
- [ ] ยังไม่มีแหล่ง RM catalog และ PK ในเครื่อง — `adoptPK` ปฏิเสธตรง ๆ แทนการสมมติผล

Files: `index.html` (core `project()`, local block, transport, build stamp), `tests/cost-calculator-local.test.js` (ใหม่ 16 ข้อ), `tests/cost-calculator-ui.test.js` (เปลี่ยนชื่อ test ให้ตรงกับสิ่งที่ทดสอบจริง), ADR 0002, COST_GATEWAY_CONTRACT.md, SECURITY_VERSION_CONTRACT.md

Verification: module 115/115, calculator browser 8/8, parent browser 37/37, SQL 33 exit 0, `git diff --check` clean

Security impact: **ลดลงโดยเจตนาตามการตัดสินใจของเจ้าของระบบ** — ข้อมูลต้นทุนดิบอยู่ใน `localStorage` ของเครื่องผู้ใช้ ไม่มี server บังคับสิทธิ์ การแยก RM/PK/Sales เป็นการควบคุมการแสดงผล Database/permission impact: ไม่มี ไม่แตะ schema, grant หรือ locked key เดิม Dependency: ไม่มี Rollback: revert commit นี้ `fs_cost` เป็น key ใหม่ ลบได้โดยไม่กระทบข้อมูลเดิม

Status: LOCAL_VERIFIED / INTEGRATION_BLOCKED (UAT, independent review, deployment ยังไม่ได้ทำ)

## ปิด 3 เรื่องที่ค้าง — 2026-09-05

เจ้าของระบบตอบ: สรุปเข้าแชท **เขียนแต่ยอดหลังบวก**, แคตตาล็อก RM **นำเข้า Excel/CSV**, ผล PK **กรอกยอดที่ยืนยันแล้ว**

- [x] แคตตาล็อก RM: นำเข้าไฟล์ด้วย SheetJS ที่มีอยู่ ไม่เพิ่ม dependency แถวที่ขาดฟิลด์เชิงพาณิชย์ถูก **ปฏิเสธพร้อมเลขแถว ไม่ใส่ค่าแทน** และนำเข้าซ้ำเป็นการอัปเดตไม่ใช่เพิ่มซ้ำ
- [x] ผล PK: เก็บเป็น snapshot ที่ผูกผู้กรอกและเวลา พร้อมเลขอ้างอิงหลักฐาน การต่อราคาใหม่เป็นเวอร์ชันใหม่และไม่ทับของเดิม ความเข้ากันของ context/ความถูกต้องตัดสินโดย core
- [x] สรุปเข้าแชท: ประกอบจาก projection ของ Sales เสมอ กันส่งซ้ำด้วย `costKey` บนตัวข้อความ และถอนข้อความคืนถ้า `saveChats()` ล้มเหลว
- [x] เพิ่ม `fillUnit` และ `pkSpecVersion` เข้า save patch เพราะ PK snapshot จับคู่ scenario ไม่ได้ถ้าขาดสองค่านี้ อัปเดต test ที่ตรึง patch shape อย่างตั้งใจ
- [x] แก้ช่องโหว่ที่ test จับได้: `validUntil` เดิมตรวจแค่รูปทรงตัวเลข ทำให้ `2030-13-40` และ `2030-02-30` ผ่าน ตอนนี้ใช้การตรวจปฏิทินจริงทั้งใน PK entry และ catalog import

Commits: `f14b315` (catalog + PK), `487b46f` (chat summary) แยกกันเพราะอันหลังแตะ `fs_chats` ที่ล็อกไว้ จึงควรตรวจแยก

Verification: module 127/127, calculator browser 8/8, parent browser 37/37, SQL 33 exit 0, `git diff --check` clean

**ข้อควรรู้เรื่องการเปิดเผย:** `fs_chats` ไหลออกทาง `exportChatExcel` ที่ OPC ใช้ได้ เส้นทางนี้ไม่ได้ถูกจำกัดเพิ่ม สิ่งที่ป้องกันคือเนื้อหาของข้อความล้วน ๆ บันทึกไว้ใน ADR 0002 แล้ว

Status: LOCAL_VERIFIED / INTEGRATION_BLOCKED — UAT, independent review และ deployment ยังไม่ได้ทำ

## เครื่องมือตรวจไฟล์แคตตาล็อก RM แบบ offline — 2026-09-05

ผู้ใช้ถามว่า RD Center ต่อเข้าระบบได้ 100% หรือยัง คำตอบตามหลักฐานคือ **ยัง** — `docs/IMPLEMENTATION_PLAN.md:25` ระบุ audit A01–A10 เป็น FAIL, `REGISTRY.md:8` ระบุ governed RM price ว่า audit FAIL และ sync ไม่ยืนยัน, `SPEC.md:43` ระบุว่า sync 30 นาทีเป็นเป้าหมายไม่ใช่สถานะ และยังไม่เคยมีการเปิดฐานข้อมูลจริงใน session ใด จึงตอบเป็นเปอร์เซ็นต์ไม่ได้โดยไม่เดา

- [x] `tools/check-rm-catalog.js`: รับ .xlsx/.csv รายงานว่าแถวไหนผ่าน/ไม่ผ่านเพราะอะไร อ่านอย่างเดียว ไม่นำเข้าระบบ ไม่เขียนไฟล์ ไม่ต่อเน็ต
- [x] ใช้ `costParseCatalogRows` จริงจาก `index.html` ไม่คัดลอกกฎ รายงานจึงตรงกับผลนำเข้าจริงเสมอ
- [x] อ่าน .xlsx ด้วย `zlib` ที่มากับ node (xlsx คือ zip ของ xml) จึงไม่เพิ่ม dependency ตามกฎข้อ 3 ทดสอบกับ .xlsx จริงในโปรเจกต์แล้ว
- [x] ปิดราคาและชื่อซัพพลายเออร์เป็นค่าเริ่มต้น เปิดด้วย `--show-values` เพื่อให้ส่งผลตรวจต่อได้
- [x] `docs/RM_CATALOG_FILE_FORMAT.md` สำหรับส่งต่อ Procurement พร้อมเตือนกับดัก `1400/25kg`
- [x] แก้บั๊กที่พบระหว่างทำ: Excel ส่งเซลล์วันที่มาเป็น serial number ทำให้ `validUntil` ถูกปฏิเสธทุกแถวถ้า Procurement จัดรูปแบบเป็นวันที่จริง แก้ให้รับทั้ง serial, Date object และข้อความ

Files: `cost calculator by project/tools/check-rm-catalog.js` (ใหม่), `cost calculator by project/tests/check-rm-catalog.test.js` (ใหม่ 6 ข้อ), `cost calculator by project/docs/RM_CATALOG_FILE_FORMAT.md` (ใหม่), `index.html` (รับวันที่จาก Excel + build stamp), `tests/cost-calculator-local.test.js`

Verification: module 134/134, calculator browser 8/8, parent browser 37/37, SQL 33 exit 0, `git diff --check` clean

Security/database/permission/dependency impact: ไม่มี เครื่องมือเป็น read-only ใช้ node built-in ล้วน มี test ยืนยันว่าไม่สร้าง ไม่ลบ และไม่แก้ไฟล์ input

Status: LOCAL_VERIFIED / INTEGRATION_BLOCKED — RD Center ยังไม่ผ่าน audit และยังไม่มีการต่อจริง

## สถานะรายการค้าง — ปรับให้ตรงกับการตัดสินใจถึง 2026-09-05

รายการค้างในหัวข้อเก่าด้านบนหลายข้อถูกแทนที่ด้วยการตัดสินใจของเจ้าของระบบไปแล้ว บันทึกไว้ที่นี่เพื่อไม่ให้คนอ่านทีหลังไปทำงานที่ยกเลิกแล้ว

**ปิดแล้วด้วยการตัดสินใจ ไม่ต้องทำต่อ**

- สิทธิ์ Procurement RM แยกจาก PU-PK · Production/Finance/CEO · `viewRevision` · project scoping · `/v1/cost/*` · การถอน raw grant — **ยกเลิกทั้งชุด** เพราะเลือกสถาปัตยกรรม local-first ตาม [ADR 0002](docs/adr/0002-local-first-cost-calculator-without-server-enforcement.md) migration และ SQL test เก็บไว้เป็นทางเลือก server-enforced ที่ผ่านการตรวจแล้ว
- สรุปที่ค้างใน outbox จะส่งเข้า `fs_chats` หรือไม่ — **ตัดสินแล้ว** เขียนเข้าโดยส่งเฉพาะยอดหลังบวก
- แหล่ง RM catalog และ PK ในเครื่อง — **ตัดสินแล้ว** นำเข้า Excel/CSV และกรอกผล PK ที่ยืนยันแล้ว
- ผู้มีอำนาจตั้งอัตราขาย — **ตัดสินแล้ว** เป็น capability `setPricing` แยก ค่าเริ่มต้น Finance และ CEO
- MOQ ตัวเลขเปล่า · การตีความจุลภาค · การเลือก Tier — **ตัดสินแล้ว** ดู [ประเมิน RD Data Center](docs/RD_DATA_CENTER_ASSESSMENT.md)

**ยังค้างจริง — ผมทำต่อได้เอง**

- [ ] ต่อผลของ `RmCatalogBuild` เข้ากับปุ่มนำเข้าในแอปโดยตรง แทนการส่งไฟล์ให้กรอกมือ (รอให้ต้นทางมีสามคอลัมน์ก่อนจึงจะมีประโยชน์)

**ยังค้างจริง — ต้องให้เจ้าของระบบหรือกระบวนการ**

- [ ] เพิ่มสามคอลัมน์ที่ต้นทาง: ขนาดสั่งเพิ่ม · วันหมดอายุราคา · การรับรอง spec — **ตัวนี้บล็อกทุกอย่าง** ไม่มีรายการใดคิดต้นทุนได้จนกว่าจะมี
- [ ] Lead Time ของ 19 รายการที่จับคู่ไม่ได้ — ตารางที่มี Lead Time เป็นคนละชุดกับสารที่มีราคา
- [ ] รัน `previewSourceFix()` แล้ว `applySourceFix()` ตาม [runbook](docs/RM_SOURCE_FIX_RUNBOOK.md)
- [ ] กรอกอัตรามาตรฐาน Operation 6 รูปแบบในแอป
- [ ] ตัดสิน 24 แถวที่ตีความไม่ได้
- [ ] แก้ A03 · A04 · A07 · A08 · A09 ที่ pilot script และการติดตั้ง — Critical Change
- [ ] UAT · independent review จาก CODEOWNER · deployment โดย Runtime Operator
