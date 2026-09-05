# Task handoff

## Current implementation status

[27-task plan](docs/IMPLEMENTATION_PLAN.md) and [execution evidence](docs/IMPLEMENTATION_EXECUTION.md) are current. User cancelled Notion and authorized local implementation. This worktree contains actual app core/UI and synthetic integration modules; previous handoff/planning entries below are historical.

- Local checks: 97 module tests, 8 calculator browser cases, 37 parent browser cases and required SQL checks passed. SQL now includes the additive cost-gateway migration twice plus default-deny flag, projection, role-boundary, draft-line overlay, patch and outbox checks.
- Full integration is not complete. Trusted data access/persistence, real RM/PK mapping and confirmation, live policy inputs, human UAT/review and operator deployment remain open.
- P27 repository-native tracking is complete locally. Other tasks retain evidence-scoped status; no 27/27 delivery claim.
- Branch: `codex/cost-calculator-implementation`; no Issue/PR/public push or real messages. Git/GitHub remains engineering source of truth; Notion is no longer a dependency.

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

Code changes: `tests/sql/cost_gateway_test.sql` (+1 snapshot check, 33 total), `tests/cost-calculator-ui.test.js` (+2 client tests, 99 module tests total). No migration or application change in this round.

Verification: module 99/99, calculator browser 8/8, parent browser 37/37, SQL 33 named checks exit 0, `git diff --check` clean. Security/database/permission/dependency impact: none — tests only. Rollback: revert this round's commit.

Status unchanged: LOCAL_VERIFIED / INTEGRATION_BLOCKED.
