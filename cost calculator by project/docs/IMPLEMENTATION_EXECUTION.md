# Cost Calculator — local implementation evidence

Status: LOCAL_IMPLEMENTATION / INTEGRATION_BLOCKED. This is not completion of all 27 delivery tasks. User cancelled Notion and requested implementation of P01–P27 on 2026-09-05. Current work is isolated and reversible; production remains unchanged.

## Scope and traceability

- task_id: cost-calculator-implementation-2026-09-05; original handoff label retained in TASK. P01–P27 are local plan labels.
- issue_id: none assigned; pr_reference: none. No Issue or approval ID invented.
- Baseline: `3a9c32d17ef1626b7955ca9b0334ecd7a010b774`.
- Feature branch: `codex/cost-calculator-implementation` in `/Users/user/.codex/worktrees/cost-calculator-implementation`.
- Environment: local code, isolated synthetic fixtures and source-only review. No production records, credentials, live approvals or messages used.
- Allowed changes: calculator blocks/styles/navigation in `index.html`, focused tests, calculator project modules/docs. Forbidden changes remain production runtime/data/secrets/IAM, protected-branch push and unapproved locked storage migration.
- Owner: System Owner. Required independent final reviewer: CODEOWNER `@phossatron` or formally appointed substitute, plus Security/Platform for their scope. Internal agent review below is not final approval.
- Change type: Critical proposal because integrations touch cost confidentiality, synchronization, export and approval. Current backend/schema/grants are unchanged.
- Public remote verified: no push/public PR/publication performed. Original `local-only/` confidential archive was not copied, staged or uploaded.

## What was implemented

The actual single-file app now contains a deterministic cost engine and project calculator page. It compares governed RM offers, maintains draft revisions, accepts an explicit PK snapshot, prepares safe category projections and separates consumption, pre-stock purchase cash and residual exposure. The page preserves unsaved input across search/failure, prevents stale session/project/scenario responses, and separates pending receipts from sent results. A deep link requires an authenticated server-issued historical-view capability.

GAS-compatible modules implement RM normalization/confirmation/history/refresh contracts, a synthetic PK adapter, and a synthetic transactional summary/CEO-approval workflow. They depend on trusted adapters deliberately not supplied as fake production services. The new calculator gateway defaults to disabled; raw costs are not inserted into legacy shared Formula records or browser storage.

The approved backend contract is now a local additive migration at `supabase/migrations/20260905140000_cost_gateway_contract.sql`. It stores scenario drafts/outbox/approval shapes in the unexposed `private` schema, exposes role-filtered `fs_cost_open`, patch-only `fs_cost_save`, pending-only `fs_cost_send_summary`, and fail-closed `fs_cost_approve` RPCs. The gateway is default-deny until an owner-controlled `fs_meta.cost_gateway_enabled` flag is enabled; generic `purchasing` remains safe-only until RM versus PU-PK capabilities are mapped. A server-side allowlist projection strips arbitrary nested raw data before open/outbox responses, and draft line edits are overlaid into the new revision's returned line projection. It does not revoke legacy raw-table grants yet because the client/cache transition and real capability model are not complete. The migration has a dedicated synthetic SQL test and is applied twice in the local runner to verify idempotent DDL.

The source review of PU-PK confirmed three relevant files and exact function semantics through the existing editor. No Run, Save, deployment or send command was invoked. Source identifiers remain local-only. See [PK source mapping](PK_SOURCE_MAPPING.md).

## Task-by-task remaining work

| Task | Local evidence / result | Still required for full acceptance |
| --- | --- | --- |
| P01 | Baseline, isolated branch, allowed paths and actual Issue absence recorded | Real Issue/PR and final reviewer participation |
| P02 | Immutable scenario copies, stable IDs and exact-revision request design | Approved durable storage/read/write contract and migration compatibility |
| P03 | Source-backed access review; fail-closed disabled gateway | Owner approval and trusted backend enforcement |
| P04 | PU-PK pricing/quote/webapp source inspected; save/send semantics distinguished | Snapshot of approved source revision and non-production integration verification |
| P05 | Positional/multiline parsing, invalid token preservation, explicit denominator tests | Real source mapper and full-field source reconciliation |
| P06 | Exclusion/date tests, invalid/undated records blocked | Current authorized sanitized source coverage |
| P07 | Stable identity/commercial version/LT/history logic | Persistent append-only history and opaque external refs |
| P08 | Exact-version confirmation, scope/time/spec chronology tests | Authenticated Procurement action and durable event append |
| P09 | Missing-material/spec acceptance domain path and request UI | Persistent Data Center request queue, owner routing and acceptance UI |
| P10 | Staging/readback/atomic generation contract, failure preservation | Real lock/CAS store, source completeness/freshness and manual sandbox refresh |
| P11 | Actual searchable RM comparison/selection/alias UI | Authorized catalog adapter, real task UAT and approved name-center command |
| P12 | Unit/pack/loss/price denominator/MOQ math, distinct measures | Approved operating values and reconciliation against mapped source |
| P13 | Immutable revisions and nonblocking RM with missing PK | Durable history, multi-scenario comparison/load integration |
| P14 | Multiple routing steps, ownership/effective units/STD fields | Production/Finance input workflow, supplied rates and flat-STD inclusion mapping |
| P15 | Setup/run/DL/OH/extra-cost bases, overflow/double-charge guards | All job fee categories and separately priced fees once policy supplied |
| P16 | Versioned policy/rounding, base/adjusted/final separation | User-supplied live category/final policies and approval workflow |
| P17 | Source field/status mapping with explicit non-mappings | Project/spec/version bridge, validity, commercial confirmation and consumed PK basis |
| P18 | Synthetic coherent/multi-component PK adapter, immutable candidates | Protected transport, live-source mapping and persistent store in sandbox |
| P19 | Explicit/idempotent adoption; mismatch/withdrawal checks; RM-only reuse | Trusted currentness/withdrawal notifications and persistent adopted snapshot |
| P20 | Additive private cost store, role-filtered RPC projection and patch-only draft write; legacy raw disclosure documented | Coordinated read/patch RPC rollout, revoke raw-access grants after client/cache transition, role-negative backend tests with real capabilities |
| P21 | Actual UI + synthetic durable summary/receipt/idempotency protocol; SQL outbox contract | Protected Formula chat endpoint/worker and receipt storage; authorized sandbox recipients |
| P22 | Synthetic server-adapter authority/current-version/immutable approval protocol | Real CEO capability, transactional persistence and current source validity proof |
| P23 | Focused actual-module/browser tests and internal defect review | Close A01–A10 against integrated system and independent full security review |
| P24 | [UAT worksheet](UAT_COST_CALCULATOR.md) | Business users execute and accept; not simulated by Codex |
| P25 | Local review/rollback packet prepared | Real PR, independent approvals, completed UAT and release artifact |
| P26 | Operator handoff requirements and failure criteria prepared | Authorized operator deploys approved artifact, verifies and records evidence |
| P27 | Repository-native plan/TASK/evidence updated; Notion removed | Done locally; no Notion action remains |

## Source review consequences

1. `PUPK_pricingHistoryRow_` sets `RevisionStatus=APPROVED` when saving a selected calculation. It is not proof of RD spec acceptance, all purchase conditions, or CEO approval. Outbox `ApprovalState` controls sending a message and also cannot supply those approvals.
2. `QuoteEffectiveCost` includes recovery from surplus. It cannot be mapped to consumed PK cost. Preserve `SelectedSellingTotal` as the candidate adjusted lot result; supply a separately verified consumption basis and commercial exposure handling before combined raw cost is complete.
3. Saving a new PK revision changes the previous row to `SUPERSEDED`. Adopted/approved calculator economics must remain an immutable snapshot; latest-row fallback cannot silently replace them.
4. The observed fingerprint omits some calculator requirements, and the web form rebuilds a current fingerprint. Add explicit Formula project, packaging requirement/version, units, validity and optimistic revision binding; do not assume existing status/fingerprint is sufficient.
5. The existing Formula backend sends full shared JSON to active members. Hiding fields in this new UI cannot secure records/chat/history/export. The reviewed backend contract is a prerequisite to any confidential-data UAT.

## Review and validation

Internal independent read-only review found and prompted regression fixes for price denominators, RM scope/withdrawal, PK withdrawal, future confirmation chronology, lost draft input, scenario mismatch, structural line-buffer corruption and repeated approval reference aliasing. These reviews improve local code evidence; they do not replace CODEOWNER approval or live security testing.

Final local results: 97/97 actual-module tests, 8/8 calculator browser cases and 37/37 required parent browser cases passed; required SQL suite passed with exit 0, including the new gateway migration/projection/patch/outbox checks and idempotent second migration run. `git diff --check`, 27-ID tracking and relative-link/source-reference checks passed. See TASK for the exact breakdown. Reproducible commands from worktree root:

```sh
node --test tests/cost-calculator-core.test.js tests/cost-calculator-ui.test.js 'cost calculator by project/tests/rm-data.test.js' 'cost calculator by project/tests/pk-adapter.test.js' 'cost calculator by project/tests/cost-workflow.test.js'
node tests/run-cost-calculator-browser.js
node harness.js
./tests/run-sql-tests.sh
git diff --check
```

The browser runner scrubs original configuration, forbids fetch, uses synthetic identity/data and a disposable Chrome profile. Generated reports and screenshot live under ignored `.runtime/`. Actual calculator HTML/CSS was visually inspected. No screenshot contains real supplier/formula data. Historical audit remains FAIL at integration level; unknown is not passed.

## Impacts and rollback

files_changed: `index.html`; four root tests/runner; project `apps_script/{RmData,PkAdapter,CostWorkflow}.gs`; their tests; DESIGN, AGENTS, TASK, implementation plan and linked evidence docs. Earlier requirement documents are preserved in this isolated worktree as planning baseline.

security_impact: new client fail-closed boundary plus private-schema role-filtered RPC/projection contract; legacy raw-table access remains open until coordinated transition. No secret or production access added.

database_impact: additive SQL migration and synthetic tests only; no production schema/data changed and locked Formula keys/types remain unchanged. The trusted source/real capability migration is not deployed.

permission_impact: no production grant/role/IAM change. New RPC grants are local migration contract only; existing `can/requirePerm` gates are UI controls and real backend capabilities must be configured before enablement.

dependency_impact: none. Application remains single-file vanilla JavaScript; Node/Chrome/Postgres are existing test tools.

rollback: remove/revert this feature's local changes or revert its eventual feature commit; original checkout is untouched. No production rollback is necessary. Future rollout must retain immutable evidence and never restore broad raw access as a compatibility shortcut.

open_risks: legacy raw-table grant/client transition; missing trusted source/auth/capability adapter; current RM mapper/freshness; PK spec/terms/version bridge and consumption semantics; pending real STD/loss/policy values; unresolved integration audit; real UAT, final review and deployment. This packet must not be labelled 27/27 done or production-ready.
