# Cost Calculator by Project — Implementation Plan

Status: LOCAL_IMPLEMENTATION_IN_PROGRESS / G3 with focused G4 evidence. Updated 2026-09-05 after the user requested all 27 tasks and cancelled Notion. Current evidence and exact remaining work: [Execution report](IMPLEMENTATION_EXECUTION.md). Synthetic verification is not business acceptance or release approval.

## Objective and scope

ลดงาน RD ที่ต้องเปิดสอง Sheet เพื่อหา RM ชื่อคล้ายกัน ให้ค้นและเทียบ spec/vendor/Tier/MOQ/LT ได้ในจุดเดียว ทำสูตรและเปรียบเทียบ scenario ตามจำนวนหน่วยขาย รวม PK/Operation และได้ราคาที่ CEO อนุมัติพร้อมให้ Sales นำไปเสนอ พร้อมส่งสรุปเบื้องต้นที่เปิดเผยได้เข้า Formula project chat.

PU-PK เป็นเจ้าของการเจรจา การเลือก PK และผลคำนวณแบบมีเวอร์ชัน; calculator รับเวอร์ชันมาใช้ ไม่สร้าง PK engine ซ้ำ. PK ช้าหรือเชื่อมไม่ได้ต้องไม่หยุดสูตร/RM. ไม่รวม WMS/actual cost, กำหนดส่งมอบรวม, คิวผลิต, การส่งใบเสนอราคาให้ลูกค้าอัตโนมัติ หรือ production deployment โดย Codex.

## Source of truth and traceability

- Requirements: [SPEC](../SPEC.md), confirmed conversation decisions; terminology [CONTEXT](../CONTEXT.md); ownership [REGISTRY](../REGISTRY.md).
- Decision: [Reuse PK, independent RM](adr/0001-reuse-pk-calculation-with-independent-rm-progress.md).
- Evidence: [14-test synthetic trial](PK_WORKFLOW_TRIAL.md); static Formula inspection recorded in [TASK](../TASK.md); historical sanitized audit findings referenced there. Source URLs/headers and legacy raw evidence remain local-only.
- Git/GitHub remains engineering source of truth. Implementation lives on isolated branch `codex/cost-calculator-implementation`; it is not yet an approved GitHub release. Plan task IDs P01–P27 are local labels, NOT invented GitHub Issues.
- User cancelled Notion. P27 now maintains repository-native tracking. No Notion connection/publication is required or attempted.
- Existing task label: cost-calculator-workspace-handoff-2026-09-05. Issue: none. Owner: user/System Owner. CODEOWNER: @phossatron; independent reviewer must be appointed, author cannot final-approve.

## Evidence-led review

| Area | Evidence available | What is NOT proven | Work consequence |
|---|---|---|---|
| Business workflow | Q1–Q31 and later clarifications recorded | Business UAT | Use as plan baseline, test actual workflow later |
| RM Data Center | Historical audit FAIL: A01–A10 | Fixes, current sync, current permissions | Reproduce sanitized failures and close them before trusted costing |
| Formula | Stable record.id and chat jobId in source; rows edited in place | Immutable formula revisions, restricted price payloads | Reuse identity, add reviewed compatible version contract |
| Disclosure | Existing chat/log/export paths show full ingredient names; purchasing role not separated | New RD/PU-PK/Sales restrictions | Secure all relevant read/export paths before user trial with confidential data |
| PU-PK | Metadata + headers + three relevant source files inspected | Stable Formula linkage, separate commercial/spec confirmation and consumed base mapping | See PK_SOURCE_MAPPING; save-time APPROVED does not confirm purchase conditions |
| Prototype | 14 local tests passed | Live adapter, real identity, multi-component PK, pricing engine | Reuse scenarios as acceptance cases, not prototype as approved runtime |

Main review finding: a calculator UI alone cannot satisfy this scope. Reliable RM data, version references and restricted delivery of data are prerequisites. PK source validation is a separate dependency and must not block RM development against an agreed synthetic PK interface.

## Requirements and acceptance groups

| Ref | Requirement | Observable acceptance |
|---|---|---|
| R01 | Formula identity and revisions | Project reference reused; older formula/scenario/quote can be reopened unchanged |
| R02 | RM discovery | Search/group comparison shows distinct specs and confirmed Tier terms; no need to consult two sources for the selected line |
| R03 | Governed materials | New requests remain pending until RD spec and Procurement terms pass; exclusion/DQ records cannot make quote ready |
| R04 | Quantities/cost/cash | Selling units and pack conversions reconcile; loss applied once; consumed cost, cash and leftover separate |
| R05 | Operation/other costs | Routing complete; setup/DL/OH not counted twice; missing differs from confirmed not applicable |
| R06 | Pricing policy | Base cost / adjusted category amount / selling price distinct; no absent rate converted to zero |
| R07 | Department permissions | RD raw RM only; PU-PK raw PK only; Operation by duty; finance/CEO scoped full view; Sales adjusted amounts and allowed names only |
| R08 | PK ownership/integration | Negotiate/confirm in PU-PK; adopt exact applicable version; retry/late response cannot overwrite unrelated work |
| R09 | Independent progress | Missing/offline PK does not prevent RM edit/save/compare; partial totals labelled accurately |
| R10 | Formula chat | Correct project/revision, permitted amounts, pending items and reopen link; actual acknowledgement distinguishes pending/failed/sent |
| R11 | CEO quotation | Only eligible complete revision can be approved; changes produce new revision; commercial approval distinct from technical release |
| R12 | Safe delivery | Review/UAT/rollback evidence, immutable approved artifact and Runtime Operator deployment |

## Architecture decisions and boundaries

Use existing Formula application and Google Sheets pilot stack first. Application work stays within parent single-file constraints; no new framework/build step/dependency is selected by this plan. Existing keys and types remain locked. Any necessary optional fields or separate state must have an ownership/version/migration proposal reviewed before implementation.

P02/P03 must resolve where sensitive data is calculated/stored and which server-side or trusted service layer enforces access before payloads reach a browser. A shared Sheet or browser receiving all prices with hidden columns does not satisfy R07. If the present platform cannot enforce this, document the concrete limitation and obtain architecture approval; do not quietly introduce another platform.

Logical references to specify: Formula project ID, formula revision, scenario revision, packaging requirement fingerprint/version, RM material and offer/Tier version, routing/rate version, PU-PK request/quote/snapshot references, adopted PK version, pricing policy version and quote approval event. These are design requirements, not a physical schema migration authorization.

Readiness is per RM / PK / Operation / pricing / other-cost verification. Draft, pending data, pending confirmation, eligible and approved are separate concepts; source states must be mapped from actual code. A response marked sent is not Procurement approval, and Procurement approval is not CEO approval.

## Work streams and milestones

| Milestone | Work | Exit evidence | Status |
|---|---|---|---|
| M0 / G2 | P01–P03, prepare P04 | Scope/reviewer, version and data-access contracts ready for review | REVIEW_READY |
| M1 / G3–G4 RM | P05–P13 | RM search → confirmed selection → cost scenario works with PK absent | LOCAL_PARTIAL |
| M2 / G3–G4 costing | P14–P16 | Operation/other costs and configurable pricing verified | LOCAL_PARTIAL |
| M3 / G3–G4 PK | P04, P17–P19 | Actual source semantics and non-production adapter verified | Source inspected; integration pending |
| M4 / G4 integration | P20–P23 | Restricted views/chat and CEO snapshot tested together | LOCAL_PARTIAL |
| M5 / G5 | P24 | Business acceptance, including RM-only path and full pricing path | LOCAL_PARTIAL |
| M6 / G6–G8 | P25–P26 | Independent release approval, operator deployment, verification | Not authorized by this planning task |
| Tracking | P27 | Repository plan/tasks and evidence maintained | DONE_LOCAL |

Scheduling rule: start M0 and source acquisition first. After contracts are accepted, RM work may advance using synthetic PK fixtures while M3 waits. Formula/RM milestone does not depend on PU-PK adapter delivery. Full quote milestone does depend on verified PK and required pricing data. No committed delivery date; 1–2 engineering days per task below are planning estimates excluding access/review/UAT waiting, not calendar promises.

## Task backlog

Statuses below distinguish tested local components from complete acceptance. LOCAL_VERIFIED does not mean the full task is integrated/live; the execution report records missing adapters and gates. Original “Initial status” in each task is historical planning metadata. No final review, UAT or deployment is claimed.

| ID | Task | Priority | Status | Effort days | Dependencies |
|---|---|---|---|---|---|
| [P01](#p01) | Review baseline and establish GitHub task scope | P0 | LOCAL_VERIFIED | 1 | — |
| [P02](#p02) | Define compatible project/scenario/version contract | P0 | REVIEW_READY | 2 | P01 |
| [P03](#p03) | Design field access and trusted calculation boundary | P0 | REVIEW_READY | 2 | P01 |
| [P04](#p04) | Obtain and inspect PU-PK source and status semantics | P0 | SOURCE_REVIEWED | 2 | P01 |
| [P05](#p05) | Repair RM parser and source field coverage | P0 | LOCAL_VERIFIED | 2 | P01 |
| [P06](#p06) | Enforce exclusions and date validity | P0 | LOCAL_VERIFIED | 1 | P05 |
| [P07](#p07) | Preserve RM identity and commercial history | P0 | LOCAL_VERIFIED | 2 | P02,P05 |
| [P08](#p08) | Implement RM commercial confirmation | P0 | LOCAL_PARTIAL | 2 | P03,P06,P07 |
| [P09](#p09) | Implement missing-material sourcing and RD spec acceptance | P1 | LOCAL_PARTIAL | 2 | P08 |
| [P10](#p10) | Make RM refresh coherent and reconcile costing route | P0 | LOCAL_PARTIAL | 2 | P06,P07,P08 |
| [P11](#p11) | Build RM compare/select and disclosure-name UI | P1 | LOCAL_PARTIAL | 2 | P02,P03,P08 |
| [P12](#p12) | Implement RM unit, loss and purchase calculations | P0 | LOCAL_VERIFIED | 2 | P02,P08 |
| [P13](#p13) | Implement independent scenario revisions | P0 | LOCAL_PARTIAL | 2 | P02,P11,P12 |
| [P14](#p14) | Prepare routing and versioned STD inputs | P1 | LOCAL_PARTIAL | 2 | P02,P03 |
| [P15](#p15) | Calculate Operation and job-specific costs | P0 | LOCAL_VERIFIED | 2 | P12,P14 |
| [P16](#p16) | Implement configurable pricing policy layers | P0 | LOCAL_VERIFIED | 2 | P02,P03 |
| [P17](#p17) | Specify PU-PK snapshot adapter mapping | P0 | REVIEW_READY | 1 | P02,P03,P04 |
| [P18](#p18) | Implement restricted PK read adapter in test environment | P0 | LOCAL_PARTIAL | 2 | P17 |
| [P19](#p19) | Implement explicit PK adoption and reuse | P0 | LOCAL_VERIFIED | 2 | P13,P18 |
| [P20](#p20) | Enforce permissions across Formula and exports | P0 | BLOCKED_CONTRACT | 2 | P03 |
| [P21](#p21) | Send revision summary to Formula project chat | P1 | LOCAL_PARTIAL | 2 | P13,P16,P20 |
| [P22](#p22) | Implement CEO quotation snapshot and reapproval | P0 | LOCAL_PARTIAL | 2 | P13,P15,P16,P19,P20 |
| [P23](#p23) | Verify end-to-end and close audit regressions | P0 | LOCAL_PARTIAL | 2 | P10,P15,P19,P20,P21,P22 |
| [P24](#p24) | Run role-based UAT with agreed projects | P0 | WAITING_UAT | 2 | P23 |
| [P25](#p25) | Prepare independent release and rollback evidence | P0 | REVIEW_PACK_PREPARED | 1 | P24 |
| [P26](#p26) | Deploy approved artifact and verify live outcome | P0 | WAITING_OPERATOR | 1 | P25 |
| [P27](#p27) | Maintain repository-native plan and evidence | P2 | DONE_LOCAL | 1 | — |

### P01

**Review baseline and establish GitHub task scope**

Owner role: System Owner + Development. Priority: P0. Initial status: TO_DO. Estimate: 1 days. Depends on: —. Requirements: R01,R12.

Objective: Pin current commit/diff and approved scope; appoint independent reviewer and link real Issue when created. Confirm allowed paths, synthetic environment and no local-only staging.

Acceptance: Baseline reference, Issue field truthfully populated or pending; reviewer and Critical Change list recorded; no protected-branch direct push.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P02

**Define compatible project/scenario/version contract**

Owner role: Development + RD. Priority: P0. Initial status: PLANNED. Estimate: 2 days. Depends on: P01. Requirements: R01,R08,R09.

Objective: Specify stable references, revision adoption and optimistic conflict handling without changing locked keys/types. Define quantities/spec fingerprint needed for PK applicability.

Acceptance: Old record fixtures readable; duplicate/late updates cannot erase a revision; approved snapshot reopening and RM-only PK reuse cases specified.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P03

**Design field access and trusted calculation boundary**

Owner role: Development + Owner/Security. Priority: P0. Initial status: PLANNED. Estimate: 2 days. Depends on: P01. Requirements: R07,R10.

Objective: Map all roles and raw/adjusted/name/evidence payloads, including legacy chat/log/export. Verify existing platform capability before choosing storage/transport.

Acceptance: Role-by-field matrix and read/write tests approved for implementation; browser payload plan excludes forbidden values; aggregate-inference risk addressed.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P04

**Obtain and inspect PU-PK source and status semantics**

Owner role: PU-PK owner + Development. Priority: P0. Initial status: BLOCKED. Estimate: 2 days. Depends on: P01. Requirements: R08.

Objective: Read approved repository/Apps Script/formulas and sanitized fixtures; map requester prices, confirmed snapshots, negotiation, expiry, withdrawal and multiple components.

Acceptance: Equations/units/status transitions traced to source; email approval not misclassified; no real record/secret copied. Missing source remains explicit.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P05

**Repair RM parser and source field coverage**

Owner role: Development + Procurement RM. Priority: P0. Initial status: PLANNED. Estimate: 2 days. Depends on: P01. Requirements: R02,R03.

Objective: Reproduce A01/A02 with synthetic slash/multiline/invalid-token examples, then repair complete positional tier extraction.

Acceptance: Digits not truncated; invalid tokens cannot shift pairs; continuation/status fields covered; unreadable data goes to DQ with source reference.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P06

**Enforce exclusions and date validity**

Owner role: Development + Procurement RM. Priority: P0. Initial status: PLANNED. Estimate: 1 days. Depends on: P05. Requirements: R03.

Objective: Close A05 using all relevant fields and explicit valid date rules.

Acceptance: Cancelled/never purchased/regulatory fail/missing-date rows excluded; excluded and DQ counts reconcile with input; no silent loss.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P07

**Preserve RM identity and commercial history**

Owner role: Development. Priority: P0. Initial status: PLANNED. Estimate: 2 days. Depends on: P02,P05. Requirements: R01,R03.

Objective: Close A04/A06: identity stable across row reorder; version all commercial terms, including LT; preserve source observation/DQ history.

Acceptance: Reorder keeps identity; LT/price/MOQ change invalidates only affected confirmation; old observations and versions remain reproducible.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P08

**Implement RM commercial confirmation**

Owner role: Development + Procurement RM. Priority: P0. Initial status: PLANNED. Estimate: 2 days. Depends on: P03,P06,P07. Requirements: R03,R07.

Objective: Close A03/A09: identity-bound confirmation of exact terms and scope; enforce writes beyond cell edits/UI toggles.

Acceptance: Unconfirmed/changed/expired terms cannot become ready by paste or status change; authorized confirmation records actor/time/version/evidence.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P09

**Implement missing-material sourcing and RD spec acceptance**

Owner role: Development + RD/Procurement RM. Priority: P1. Initial status: PLANNED. Estimate: 2 days. Depends on: P08. Requirements: R02,R03.

Objective: Create governed candidate in Data Center from project request; retain original RM read-only; message/email links point to one request.

Acceptance: No free-text item bypass into ready quote; RD suitability and Procurement terms are separate; tests use delivery stubs and never contact real recipients.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P10

**Make RM refresh coherent and reconcile costing route**

Owner role: Development. Priority: P0. Initial status: PLANNED. Estimate: 2 days. Depends on: P06,P07,P08. Requirements: R03,R04,R12.

Objective: Close A07/A08/A10 with one consumed costing route and coherent generation/failure state. Manual non-production run before schedule.

Acceptance: Input = accepted/excluded/DQ; interrupted sync never exposes mixed ready generation; failed/stale status true; 30-minute schedule not claimed without evidence.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P11

**Build RM compare/select and disclosure-name UI**

Owner role: Development + RD. Priority: P1. Initial status: PLANNED. Estimate: 2 days. Depends on: P02,P03,P08. Requirements: R02,R07.

Objective: One search/compare surface for group/name/spec/vendor and eligible tiers. Default safe name from Data Center with revision-only override.

Acceptance: Similar names remain distinct; one price+MOQ Tier selected; missing alias never falls back to full name; PK absent does not block selection.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P12

**Implement RM unit, loss and purchase calculations**

Owner role: Development + RD/Production. Priority: P0. Initial status: PLANNED. Estimate: 2 days. Depends on: P02,P08. Requirements: R04.

Objective: Convert selling quantity/pack to RM use; explicit loss basis; separate consumed cost, pre-stock cash and leftover.

Acceptance: Hand-calculated synthetic cases reconcile; missing MOQ unit/increment blocks affected output; no automatic overbuy/Tier change; no stock deduction before WMS.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P13

**Implement independent scenario revisions**

Owner role: Development. Priority: P0. Initial status: PLANNED. Estimate: 2 days. Depends on: P02,P11,P12. Requirements: R01,R09.

Objective: Persist compare/edit/reopen with separate category readiness and explicit adopted versions. Use synthetic PK interface initially.

Acceptance: RM edit/save works without PK; wrong project/spec/quantity PK rejected; conflicts do not overwrite work; unconfirmed PK draft labelled and not ready.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P14

**Prepare routing and versioned STD inputs**

Owner role: Development + RD/Production/Finance. Priority: P1. Initial status: PLANNED. Estimate: 2 days. Depends on: P02,P03. Requirements: R05.

Objective: Model routing steps, setup/run/crew/capacity and DL/OH rates with units, effective dates and test/approved states.

Acceptance: No default rates inserted; required owner/state explicit; absent input remains missing; flat rates state included components.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P15

**Calculate Operation and job-specific costs**

Owner role: Development + Production/Finance. Priority: P0. Initial status: PLANNED. Estimate: 2 days. Depends on: P12,P14. Requirements: R04,R05.

Objective: Apply batch/setup/DL/OH and one-time/per-batch/per-unit costs; distinguish pending, amount confirmed and not applicable.

Acceptance: No duplicate setup/loss/overhead or fee allocation+charge; lot/per-selling-unit reconciliation; pending data permits draft but blocks required final completeness.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P16

**Implement configurable pricing policy layers**

Owner role: Development + System Owner/Finance. Priority: P0. Initial status: PLANNED. Estimate: 2 days. Depends on: P02,P03. Requirements: R06.

Objective: Separate base/adjusted/final amounts; version policy by category without preset rates. Preserve PU-PK ownership for PK uplift.

Acceptance: Missing policy returns pending not raw or zero; rounding/currency basis explicit; no PK uplift twice; live values only after owner provides policy.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P17

**Specify PU-PK snapshot adapter mapping**

Owner role: Development + PU-PK. Priority: P0. Initial status: PLANNED. Estimate: 1 days. Depends on: P02,P03,P04. Requirements: R08.

Objective: Map verified source keys/statuses and unit/currency semantics to request and adopted result. Include multi-component completeness and validity.

Acceptance: Trace each mapped field to source evidence; latest row not automatically approved; source fingerprint and project/requirement linkage documented.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P18

**Implement restricted PK read adapter in test environment**

Owner role: Development + PU-PK. Priority: P0. Initial status: PLANNED. Estimate: 2 days. Depends on: P17. Requirements: R07,R08.

Objective: Read coherent source versions through approved transport; retry/failure/idempotency, raw vs adjusted payloads per scope.

Acceptance: Sandbox adapter passes confirmed/draft/withdrawn/expired/duplicate/malformed/multi-component cases; no production credential or writes.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P19

**Implement explicit PK adoption and reuse**

Owner role: Development + PU-PK/RD. Priority: P0. Initial status: PLANNED. Estimate: 2 days. Depends on: P13,P18. Requirements: R01,R08,R09.

Objective: Notify available result, adopt selected version, preserve negotiation history and unchanged PK across RM-only revisions.

Acceptance: New negotiation never auto-replaces adopted version; mismatch cannot mark ready; expired/withdrawn blocks new quote; RM remains editable offline.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P20

**Enforce permissions across Formula and exports**

Owner role: Development + Owner/Security. Priority: P0. Initial status: PLANNED. Estimate: 2 days. Depends on: P03. Requirements: R07.

Objective: Implement reviewed capability model and restricted projections in shared detail/chat/activity/dashboard/print/export paths, preserving audit evidence.

Acceptance: Negative role tests on payloads and actions; no full-name/raw-price leaks; no deletion of historical audit evidence; approved migration compatibility checked.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P21

**Send revision summary to Formula project chat**

Owner role: Development + RD/Sales. Priority: P1. Initial status: PLANNED. Estimate: 2 days. Depends on: P13,P16,P20. Requirements: R09,R10.

Objective: Reuse project chat with approved-safe summary, revision link, missing categories, confirmation preview and observable send status.

Acceptance: Correct project/revision; no duplicate retry sends; failed/pending not reported sent; reopened link enforces permissions; test recipients only in authorized sandbox.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P22

**Implement CEO quotation snapshot and reapproval**

Owner role: Development + CEO/Finance. Priority: P0. Initial status: PLANNED. Estimate: 2 days. Depends on: P13,P15,P16,P19,P20. Requirements: R06,R11.

Objective: Aggregate eligible exact versions, validate mandatory data/policy and record commercial approval separately from technical release.

Acceptance: Incomplete/expired/unconfirmed results cannot approve; actor authorized; changed terms require new revision; approved output immutable and appropriately redacted.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P23

**Verify end-to-end and close audit regressions**

Owner role: Development + independent QA. Priority: P0. Initial status: PLANNED. Estimate: 2 days. Depends on: P10,P15,P19,P20,P21,P22. Requirements: R01–R12.

Objective: Run meaningful calculation/reconciliation/security/concurrency/adapter cases and required parent regression suites.

Acceptance: A01–A10 mapped to current evidence; node harness.js and ./tests/run-sql-tests.sh pass when applicable; no browser errors; trial results not substituted for integration.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P24

**Run role-based UAT with agreed projects**

Owner role: RD/Procurement RM/PU-PK/Sales/CEO. Priority: P0. Initial status: PLANNED. Estimate: 2 days. Depends on: P23. Requirements: R02,R09,R10,R11.

Objective: Exercise RM-only path before delayed PK and complete quote path with authorized sanitized inputs and user-supplied policies.

Acceptance: User records acceptance/rejections; incorrect-material selection avoided; no source-sheet switching needed for chosen line; PK delay does not halt RM; critical defects resolved.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P25

**Prepare independent release and rollback evidence**

Owner role: Development + independent reviewer. Priority: P0. Initial status: PLANNED. Estimate: 1 days. Depends on: P24. Requirements: R12.

Objective: Prepare PR/release evidence, migration/backup/rollback plan and immutable target for operator; author never final-approves.

Acceptance: CODEOWNER/required reviewers approve, checks pass, rollback target verified; no unresolved critical release risk; no secrets in artifacts.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P26

**Deploy approved artifact and verify live outcome**

Owner role: Runtime Operator + business owners. Priority: P0. Initial status: PLANNED. Estimate: 1 days. Depends on: P25. Requirements: R12.

Objective: Operator deploys only after explicit approval; verify health, access, workflow and audit correlation; rollback on agreed failure conditions.

Acceptance: Record release/commit/deployer/time/health/rollback; post-live business check; not an action authorized to Codex by this plan.

Resources: [Specification](../SPEC.md), [Registry](../REGISTRY.md), this plan. Current implementation/validation evidence: [execution report](IMPLEMENTATION_EXECUTION.md).

### P27

**Maintain repository-native implementation tracking**

Owner role: Development + System Owner. Priority: P2. Status: DONE_LOCAL. Depends on: —. Requirements: R12.

Objective: Follow the user's cancellation of Notion; maintain the existing plan, TASK and evidence links without a second task system.

Acceptance: All 27 local labels have honest status/evidence/remaining work; links resolve; no source URLs, confidential archive or invented Issues are published. No external notification created.

Resources: this plan and [Execution report](IMPLEMENTATION_EXECUTION.md).

## Blockers, assumptions and risk boundaries

| Item | Impact | Owner/action | Blocks |
|---|---|---|---|
| B01 Notion cancelled by user | No dependency | Track in repository | Resolved |
| B02 PU-PK source inspected; integration semantics incomplete | Save-time APPROVED is not terms/spec confirmation; effective cost includes recovery | Implement explicit confirmation, immutable economic snapshot/context mapping, verify sandbox | Live P17/P18/P19; not RM work |
| B03 Pricing/STD/loss values intentionally deferred | Cannot claim ready real selling price | User + department owners define versioned inputs | Complete-price UAT/final quote, not input UI or synthetic development |
| B04 Version/storage and data-access design pending | Existing JSON/roles cannot be casually repurposed | P02/P03; Owner reviews any locked-contract impact | Corresponding production-capable implementation |
| B05 Historical audit FAIL | Wrong data could yield wrong cost | P05–P10 reproduce and fix; P23 verify | Trusted RM costing/release |
| B06 Real Issue/reviewer/dates absent | Engineering traceability not approved | P01 with System Owner | PR/release, not local planning |

No overall project BLOCKED claim: documentation and bounded foundation work remain possible. A browser or shared Sheet must not receive disallowed prices merely because the UI hides them. Currency/tax/freight validity and allocation must be explicitly covered in the contracts where applicable; unknown values stay missing rather than implied zero. Existing PK policies do not become approved by import.

## Verification and release gates

Planning checks: every requirement mapped to tasks; dependencies valid and acyclic; every task has objective/owner role/acceptance and estimated 1–2-day size; no false Issue IDs/dates; no source URLs/values from local-only. The 14-test prototype is historical evidence only and is not rerun for unchanged prose.

Implementation checks: focused tests at each task, then parent required suites for relevant application/SQL changes. Security/data/sync/export/approval modifications are Critical Changes. Internal tests do not replace independent review, business UAT or explicit release approval.

G2 exit: contracts accepted with remaining configuration/source blockers named. G4 exit: actual implemented paths tested and audit regressions closed. G5 exit: business acceptance recorded. G6 exit: independent release approval. G7/G8 performed by authorized Runtime Operator and business owners, not self-approved by Codex.

Rollback is risk-scaled: local plan changes revert individually; future runtime rollback uses approved previous artifact and a tested compatible state/data strategy. Never delete approval/history evidence to make rollback convenient.

## Status and tracking contract

Current status is the 27-row task table above and [Execution report](IMPLEMENTATION_EXECUTION.md). P27 is done locally. All other statuses are evidence-scoped; none implies an accepted deployed workflow. No Notion work remains. Engineering source must still pass independent review and the appropriate human gates.

## Delivery record

See [Execution report](IMPLEMENTATION_EXECUTION.md) for files, tests, security/database/permission/dependency impact, rollback and remaining risks. No deployment or external publication has occurred.
