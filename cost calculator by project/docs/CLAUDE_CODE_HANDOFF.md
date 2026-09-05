# Prompt ส่งต่อ Claude Code

คุณกำลังรับช่วง Cost Calculator ต่อจาก Codex ให้ลงมือปิดงานที่เหลือตามเอกสารและหลักฐานจริง ไม่เริ่มโครงการใหม่และไม่เพียงเสนอแผน

## ขอบเขตบังคับ

- ทำงานเฉพาะ /Users/user/.codex/worktrees/cost-calculator-implementation
- branch: codex/cost-calculator-implementation
- implementation commit: d6b73f5; status clarification: e2898d4; อาจมี commit เอกสารส่งต่อนี้เพิ่ม ให้ตรวจ git log/status ก่อนเริ่ม ห้าม reset กลับไป HEAD เก่า
- baseline เดิม: 3a9c32d; task_id: cost-calculator-implementation-2026-09-05; ยังไม่มี Issue/PR ID ห้ามแต่งขึ้น
- อ่าน AGENTS.md, CLAUDE.md และ cost calculator by project/AGENTS.md ใน worktree นี้ก่อนทำงาน
- ห้ามแก้ checkout เดิมบน Desktop ห้ามอ่าน/เขียนไฟล์นอก path ที่อนุญาต ห้ามคัดลอก confidential archive เข้า Git หรือ prompt
- งานที่อนุญาตคือ local engineering/test/documentation; การยืนยันข้อมูลธุรกิจเป็นหน้าที่เจ้าของข้อมูล การ final review และ deployment ต้องเป็นไปตาม governance ห้ามตีความ prompt นี้เป็น production approval

## อ่านตามลำดับ

1. cost calculator by project/TASK.md — ตาราง Status clarification บนสุดเป็นสถานะล่าสุด
2. cost calculator by project/docs/CODEX_HANDOFF.md — สถานะล่าสุดอยู่บนสุด ส่วนล่างมีข้อบกพร่องและประวัติงานเก่า
3. cost calculator by project/docs/adr/0002-local-first-cost-calculator-without-server-enforcement.md
4. cost calculator by project/docs/IMPLEMENTATION_PLAN.md และ IMPLEMENTATION_EXECUTION.md
5. cost calculator by project/docs/COST_LADDER_MAPPING.md, RD_DATA_CENTER_ASSESSMENT.md, RM_SOURCE_FIX_RUNBOOK.md
6. cost calculator by project/docs/PK_SOURCE_MAPPING.md และ UAT_COST_CALCULATOR.md

ใช้คำตัดสินใหม่เหนือประวัติที่ขัดกัน ระบบยอมรับ local-first และการแยกราคาเป็น display-level permission แล้ว อย่านำ server enforcement ที่ถูกยกเลิกกลับมาเป็น blocker โดยไม่ขอเปลี่ยน architecture

## สิ่งที่เสร็จแล้ว อย่ารื้อหรือทำซ้ำ

- A1: request sourcing มี acknowledgement/list/dedup, แยก notice/error, validation ระบุช่อง, หน่วย kg/g/mg, live partial formula sum, ข้อความ PK not applicable, revision เก่า read-only และเปิดล่าสุดได้, save ไม่เปลี่ยนค่าไม่สร้าง revision
- ความล้มเหลวในการบันทึก catalog/request/revision/chat ไม่รายงานสำเร็จและไม่ทิ้งข้อมูลหลอกใน memory
- A2: mutation regression ทั้งห้าจุดพิสูจน์ baseline ผ่านและ mutation ถูกจับ: validFrom, priceBasisQuantity, comma 1,20, formula mismatch 9.9%, non-RD sendSummary
- Browser และ CLI ใช้ RmSourceMap/RmCatalogBuild ชุดเดียวกัน; import workbook ใช้ Order Increment (kg), Price Valid Until, Spec Approved; ตรวจ Price Date/exclusion/LT units/duplicate identities
- Source reimport พัก Tier เดิมของ material ที่มีอยู่ใน snapshot ก่อน overlay ข้อเสนอปัจจุบัน ไม่เปลี่ยน historical scenario snapshots
- RmConfirmationAdapter.gs มี preview, authorization, lock, verified backup, append/readback, idempotency และ fail-closed gate; RM_CONFIRMATION_BINDING ยังเป็น null โดยตั้งใจ
- Independent bounded review พบและปิด persistence/stale-tier defects แล้ว แต่ไม่ใช่ CODEOWNER final approval

ผลที่รันจริงที่ implementation commit: module 292/292, calculator browser 14/14, parent browser 37/37, required SQL suite PASS; ไม่มี skipped module tests. Commit เอกสารต่อจากนั้นไม่ได้เปลี่ยน runtime และไม่ได้อ้างว่ารันทดสอบใหม่

## งานที่ต้องทำต่อ

1. ตรวจว่ามี corrected Data Center export และ sanitized pilot binding evidence ภายใน worktree หรือยัง ตรวจเฉพาะข้อมูลที่ได้รับอนุญาต ห้าม dump ราคา/ชื่อ supplier/formula ลง output
2. ถ้ามี export ให้รัน shared converter/checker แล้วรายงาน usable/rejected counts และเหตุผลแบบปกปิดข้อมูล ตรวจ sample calculation เทียบ expected ที่เจ้าของยืนยัน ไม่มีข้อมูลห้ามสร้างตัวเลขธุรกิจแทน
3. ถ้ามี binding evidence ให้ตรวจ identity/currentness/event log/gate/lock/backup mapping แล้วต่อ RmConfirmationAdapter แบบ minimal พร้อม tests สำหรับ stale terms, failure, retry และ readback; null binding + mock tests ยังไม่ใช่ live A03/A04 complete
4. ติดตามคำตอบที่ Codex ถามไว้แต่ยังไม่ได้รับ ห้ามเดา:
   - PK: ให้ PU-PK บันทึกเท่านั้น หรือ RD บันทึกได้พร้อมหลักฐานที่ PU-PK ยืนยัน?
   - catalog: ยอมรับแต่ละเครื่องมีชุดข้อมูลแยก หรือใช้ common versioned import workflow?
   ถ้ายังไม่มีคำตอบให้คงพฤติกรรมปัจจุบันและเดินงานที่ไม่ขึ้นกับคำตอบต่อ
5. LT 19 records, ambiguous 24 rows และ STD 6 inputs เป็นจำนวนจาก assessment เดิม ไม่ใช่การอ่าน live ล่าสุด ให้เจ้าของยืนยันข้อมูล ค่าว่างไม่ใช่ศูนย์ ไม่ทำ fuzzy matching แก้ความกำกวมเอง
6. Missing PK/STD/pricing/บาง RM ไม่ขวางการทำ draft Formula/RM และ partial summaries; ปิดเฉพาะ affected cost/quotation readiness ตามกฎ ห้ามตีความว่าทั้งระบบไปต่อไม่ได้
7. A07/A08/A09 installation, UAT กับผู้ใช้จริง, CODEOWNER @phossatron review และ operator deployment ต้องมีหลักฐานจากผู้รับผิดชอบ เตรียมสิ่งที่ทำได้แต่ห้าม self-approve
8. อัปเดตตารางสถานะเดิมใน TASK/หลักฐานส่งมอบ ไม่สร้างทะเบียนงานหรือ master ซ้ำ และห้ามปิด 27/27 จาก synthetic tests อย่างเดียว

LOCAL_VERIFIED เป็นผลผ่านแล้ว ไม่ใช่งานแก้ค้าง ส่วน integration ต้องรายงานแยก WAITING_FOR_INPUT / DECISION_REQUIRED / HUMAN_GATE พร้อมผู้รับผิดชอบและหลักฐานที่จะปิดได้ ไม่เปลี่ยนชื่อสถานะเพื่อทำให้ดูเสร็จ

## Verification

จาก root worktree ใช้ temporary files/profile ภายใน .runtime เท่านั้น:

    mkdir -p .runtime
    TMPDIR="$PWD/.runtime" node --test tests/cost-calculator-core.test.js tests/cost-calculator-ui.test.js tests/cost-calculator-local.test.js tests/cost-form-reconciliation.test.js 'cost calculator by project/tests/'*.test.js
    TMPDIR="$PWD/.runtime" node tests/run-cost-calculator-browser.js
    TMPDIR="$PWD/.runtime" node harness.js
    TMPDIR="$PWD/.runtime" ./tests/run-sql-tests.sh
    git diff --check

เมื่อแก้ canonical RmSourceMap/RmCatalogBuild ให้รัน:

    node 'cost calculator by project/tools/sync-rm-browser-domain.js'

แล้วตรวจ embedded parity test ด้วย ห้ามแก้ business rules แยกสองชุด
Parent harness ใช้ bounded real-time CDP polling เพราะ virtual-time เคยค้างบน recurring timers; อย่าลด assertion/ข้าม browser suite เพื่อให้เขียว

## ผลส่งมอบ

ลงมือทำสิ่งที่มีข้อมูลครบจนจบ ตรวจ diff/test และบันทึก commit ใน branch นี้ ส่งกลับ:
status, task_id, issue_id, files_changed, commits, tests_run, test_result, security_impact, database_impact, permission_impact, dependency_impact, rollback, open_risks, pr_reference

ถ้าติดข้อมูลที่ไม่มีจริง ให้ระบุชื่อข้อมูล/path หรือคำตอบที่ต้องการอย่างเฉพาะเจาะจง พร้อมงานที่ทำเสร็จและขั้นตอนที่จะทำทันทีเมื่อได้ข้อมูล ไม่ขออนุมัติซ้ำสำหรับ local work ที่อนุญาตแล้ว และไม่อ้าง production complete
