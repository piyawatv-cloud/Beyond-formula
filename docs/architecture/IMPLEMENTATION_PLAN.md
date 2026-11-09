# Formula Studio — Implementation Plan

สถานะ: proposed plan after Phase 0; ยังไม่อนุมัติให้แก้ source/schema หรือ deploy

## 1. Gate status

| Gate | Status | Evidence / next action |
|---|---|---|
| G0 Discover | PASS WITH CONDITIONS | Current state and gap baseline completed |
| G1 Expert review | DECISION REQUIRED | Confirm owners, state model and contract boundaries |
| G2 Specification | NOT STARTED | Approve contracts and registry before code |
| G3 Implementation | NOT STARTED | Feature branch + Critical Change review where applicable |
| G4 Test/review | NOT STARTED | Contract, migration, security and regression checks |
| G5 UAT | BLOCKED UNTIL G1/G2 | Sanitized project and business owners required |
| G6 Release | NOT STARTED | PR, CODEOWNER and checks required |
| G7/G8 Deploy/post-live | OUT OF SCOPE | Runtime Operator only after approval |

## 2. Work packages

### WP-1 — Confirm ownership and registry

**Owner needed:** System Owner + Central IAM owner + Central Job owner + Formula owner + OPC owner

Decide:

- authority and format for `central_user_id` and `central_job_id`;
- Formula project/formula/revision identifiers;
- canonical Phase 3 stages/statuses;
- owner/assignee semantics;
- event vocabulary and retention;
- handoff acceptance/rejection owner;
- attachment owner and access boundary.

**Verification:** approved registry/decision record; no implementation yet.

### WP-2 — Define contract fixtures

Create synthetic JSON fixtures for:

- brief created;
- requirement review started/completed;
- formula ready;
- OPC handoff request/accepted/rejected;
- owner/assignee changed;
- delay reason added;
- unmapped legacy record;
- retry and duplicate delivery.

**Verification:** schema validation, required-field matrix and idempotency examples pass.

### WP-3 — Build a read-only adapter/projection first

Implement only after G2 approval:

- read current locked records;
- attach mapping fields without renaming old fields;
- emit canonical events from existing create/edit/chat/close paths;
- keep adapter failure from disabling local Formula operation;
- record outbox/dead-letter state without losing the raw legacy activity.

**Verification:** browser regression tests, fixture contract tests, replay/idempotency tests, role-filter tests.

### WP-4 — Add OPC handoff boundary

Implement API/event client only; do not access OPC database directly. The client must:

- send a versioned, role-filtered payload;
- include `central_job_id`, Formula reference/revision, owner, timestamp, attachment refs and idempotency key;
- require explicit acknowledgement;
- preserve rejected/pending states;
- retry safely and expose dead-letter/manual recovery state.

**Verification:** mocked OPC endpoint for success, duplicate, timeout, 4xx authorization, 5xx retry and schema rejection.

### WP-5 — Reporting projection readiness

Expose raw structured events to Reporting without calculating cross-system KPIs in Formula. Include stage/status, actor/owner/assignee IDs, timestamps, delay reason and correlation ID.

**Verification:** event completeness query/fixture; no duplicate event on replay; no sensitive fields in role-filtered payload.

## 3. Required change controls

The following paths are Critical Change under project governance:

- `index.html` when application/auth/sync behavior changes;
- `supabase/schema.sql` or migrations;
- `.github/`, `runtime/`, deployment/config or secret handling;
- any permission, auth, audit-log or data synchronization change.

Such work requires feature branch, PR, focused tests, independent review and CODEOWNER approval. Codex must not final-approve or deploy its own change.

## 4. Test plan

### Existing baseline checks

- `node harness.js`
- `./tests/run-sql-tests.sh`
- `git diff --check`

### New checks before implementation is accepted

- legacy record without new optional fields still loads, edits, syncs and exports;
- unmapped user/job is not guessed or escalated;
- event replay is idempotent;
- state transitions reject invalid order;
- handoff success is not inferred from request submission;
- unauthorized role cannot read or send restricted handoff payload;
- timeout/5xx retry does not duplicate handoff;
- activity/chat raw evidence is retained;
- no secret or production data enters fixtures/logs.

## 5. Rollback strategy

- Before any schema/sync release, capture approved commit, migration version and rollback SQL/contract version.
- Prefer additive fields/tables and feature flags that can be disabled without rewriting legacy data.
- If adapter/handoff fails, disable the adapter and keep local Formula workflow available; retain outbox for controlled replay.
- If a database migration is needed, use a backward-compatible, idempotent migration and test `supabase/rollback_auth_rls.sql`-style recovery in staging.
- Runtime rollback is by approved commit only through the Runtime Operator scripts (`RUNTIME_OPERATIONS.md:83-99`).

## 6. Open risks

- No accountable owners or approved cross-system endpoints have been provided.
- Historical records have no proven central ID mapping.
- The locked JSON contract makes analytics projection more complex.
- Current local-first mode can create divergent records before sync/identity mapping.
- Live deployment/config parity has not been verified in this read-only task.
