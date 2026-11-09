# iMac Central PostgreSQL Implementation Plan

> **Superseded execution path (2026-10-17):** Repository discovery found the Formula Runtime repository's project rules designate `/Users/user/formula-runtime` as the Source of Truth for Formula Studio and prohibit editing/deploying from this upstream `Beyond-formula` checkout. The iMac already runs the Formula PostgreSQL/PostgREST service. Do not execute the Task 0/Auth baseline or self-hosted Supabase migration steps in this document. Continue from the existing runtime implementation plan and branch `codex/server-owned-data-2026-10-17`, based on `efd631a`; retain the approval and release gates that still apply.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the iMac-hosted service the single authoritative store for Formula Studio users, with retry-safe offline writes, Admin-only activity-log reads, a repeatable data move, and a tested recovery path.

**Architecture:** Keep the existing Supabase-compatible Auth, REST/RPC, and RLS contract, and stage the full self-hosted Supabase stack on the iMac behind Cloudflare Tunnel. The browser will keep only unacknowledged mutations in IndexedDB; PostgreSQL will own shared records and authorization. Production cutover is a separate operator and human-approval gate after data reconciliation, restore drill, independent review, and role-based UAT.

**Tech Stack:** Existing single-file browser app (`index.html`), JavaScript/IndexedDB, PostgreSQL/Supabase SQL and RLS, Docker Compose with official pinned Supabase images/configuration, Cloudflare Tunnel, existing Node browser harness and isolated PostgreSQL tests.

**Spec:** [`SPEC.md`](../../../SPEC.md), plus repository rules in `AGENTS.md` and data compatibility rules in `CLAUDE.md`.

## Global Constraints

- GitHub is the source of truth; work only on a feature branch and release only an approved immutable commit.
- The current working branch at `a3f4859` is 24 commits ahead of `origin/main` at `a4a6e1d`; its Auth/RLS schema differs materially from `origin/main`. No implementation against either baseline starts until a reviewed GitHub commit is designated as the migration baseline.
- Critical changes to `index.html`, authentication, RLS, schema, migrations, runtime, backup, or Cloudflare configuration require independent review and CODEOWNER `@phossatron` (or formally appointed replacement); the author cannot approve their own work.
- The user has offered to review independently. Record that review as its own gate; it does not bypass CODEOWNER or production approvals.
- Preserve Formula record/chat JSON shapes, IDs, table names, and existing Auth/membership behavior. Schema changes must be additive, rerunnable, and backward-compatible.
- PostgreSQL must remain private. Only the HTTPS Supabase gateway may be routed through Cloudflare Tunnel. No privileged database key may reach the browser or repository.
- Keep recoverable data until it is confirmed by a matching server receipt or explicitly reconciled and approved for removal.
- Use synthetic fixtures in development. Production data and credentials must not enter GitHub, logs, prompts, or test output.
- RPO, backup cadence/destination/retention/key owner, exact API hostname, Auth provider setup, and target PostgreSQL cluster are still unresolved and must be decided before the corresponding staging or production task.
- The accepted maximum iMac/internet outage is 48 hours; estimate the pending-write volume per supported browser over that period before sizing or claiming offline queue capacity.
- System Owner authorization (2026-10-17): continue through preparation and production deployment, within the existing operator mandate. This authorization does not waive CODEOWNER review, required checks, explicit release approval, exact immutable commit, backup/checksum, rollback preflight, or the separate all-user cutover gate.

### Owner decisions recorded 2026-10-17

- Preserve current `origin/main` authorization behavior: Sales/Oversea record visibility remains exact `createdBy`; Reject remains allowed for the exact creator or the current normalized `salesOwner` alias, but ambiguous aliases must fail closed and cannot expose record reads.
- Preserve approval-withdrawal behavior through one authenticated, idempotent server operation: remove the caller's part, clear the other approvals, reopen a closed job, and emit the existing activity and system-chat effects with actor attribution in the same transaction. Do not grant broad direct writes to imitate the browser's current multi-request sequence.
- The user authorized progress through deployment. Only the accountable human/reviewer may satisfy approval gates; the authoring agent must not approve or merge its own change.

## Review Focus

- A branch or schema with different Auth/RLS rules is not silently accepted as the migration source; verify the exact approved commit before any migration SQL is written.
- Replaying a write after a timeout or browser restart cannot create a second record, chat event, or activity; test server mutation and receipt in the same transaction.
- Switching accounts in the same browser cannot send one user's queued mutation under another user's identity; test ownership mismatch and reauthentication.
- iMac, tunnel, or internet downtime leaves pending work recoverable and visibly unsynced; test disconnect, page close, restart, and reconnect.
- A non-Admin cannot read activity logs through REST, RPC, or the UI; test direct API denial as well as hidden UI.

---

## File and Responsibility Map

- `index.html` — existing UI and Supabase client integration; replace persisted full-data/localStorage synchronization with server reads and IndexedDB pending-write queue only after the approved baseline is established.
- `supabase/schema.sql` — approved GitHub baseline bootstrap. Preserve its existing `fs_chats`, `fs_messages`, `fs_approvals`, `fs_next_rec_seq()`, role/features, and locked JSON objects; do not import the unpublished event-store replacement as part of Auth reconciliation.
- `supabase/migrations/20261017000000_fs_mutation_receipts.sql` — additive receipt storage and retry-safe write functions. Do not add until the approved baseline and permission matrix are reviewed.
- `supabase/self-host/compose.yaml`, `supabase/self-host/.env.example`, `supabase/self-host/README.md` — pinned self-hosted staging stack, secret-free template, and local-only port configuration based on the chosen official Supabase release.
- `supabase/self-host/config/` — only reviewed service configuration needed for Auth, PostgREST, database, and gateway; no real keys or credentials.
- `tests/formula-studio.test.js` — deterministic browser tests for IndexedDB queue, transitions, retries, account changes, and legacy-data handling.
- `tests/sql/auth_rls_test.sql` and new `tests/sql/mutation_receipts_test.sql` — role, denial, idempotency, RLS, and migration rerun tests using synthetic users/data.
- `tests/run-sql-tests.sh` — apply bootstrap/schema/migrations twice, then execute the SQL suites in an isolated temporary database.
- `scripts/central-migration/` — local-only preflight and reconciliation tools; accept explicit input paths and emit masked counts/fingerprints only. Never check in dumps or business payloads.
- `runtime/formula-central/` — reviewed service startup, health, backup, restore, and disk/backup-freshness checks. Templates only until runtime approval.
- `docs/GO_LIVE_FORMULA_CENTRAL.md` — release evidence, immutable revision, backup/checksum, rollback target, approvals, and operator record.

## Execution Plan

### Task 0: Establish the reviewed GitHub code baseline — G0/G1 gate

**Files:** Files required by the commit-group analysis to reconcile the existing Auth/membership/RLS implementation onto `origin/main`; update `TASK.md` with the selected baseline and review references after approval. Do not add central-service migration files in this task.

**Consumes:** Current branch history, `origin/main`, current and remote `supabase/schema.sql`, repository PR/CODEOWNER rules.

**Produces:** A reviewable change based on `origin/main` that adds Supabase Auth and active membership/RLS while preserving `fs_messages`, `fs_approvals`, `fs_next_rec_seq()`, `fs_meta` counter/tags, current JSON contracts, and current app features. Every retained table and RPC must deny anonymous access and enforce role/membership rules. No central-service implementation starts before this commit is reviewed and merged into the GitHub source of truth.

- [ ] Compare all 24 unpublished commits against the 55 commits on `origin/main`; group changes by Auth/RLS, required app behavior, and unrelated work.
- [ ] Prepare the smallest reviewable Auth/RLS change based on `origin/main`; do not import the `fs_chat_events` replacement or change the remote-main split-table contract.
- [ ] Keep `fs_messages`, `fs_approvals`, and `fs_next_rec_seq()`; add active-membership checks and explicit grants/RLS for these existing tables/functions.
- [ ] Remove anonymous access to all retained business tables and privileged RPCs. Keep `fs_activities` SELECT Admin-only and prevent `fs_users.data.pass` from exposing legacy client password hashes after Auth is authoritative.
- [ ] Preserve current origin/main features and role-specific behaviors, including Oversea records, MKT permissions, tags in `fs_meta`, concurrent message inserts, and per-part approval writes.
- [ ] Add failing SQL/browser tests for anon denial on each retained table/RPC, inactive and unknown membership denial, existing role-allowed message/approval behavior, and Admin-only activity reads.
- [ ] Update the authorization/membership runbook with synthetic account provisioning, first Admin setup, password-reset/recovery, and rollback behavior; no production accounts/secrets in Git.
- [ ] Obtain CODEOWNER review and required checks; record the resulting immutable merge commit in `TASK.md`.
- [ ] Confirm the chosen baseline retains Admin-only `fs_activities` reads and the current active-membership authority.
- [ ] Stop this plan here if the branch/schema baseline is not approved. Do not implement schema, auth, or client sync on an unreviewed baseline.

### Task 1: Freeze operational choices and permission contract — G1/G2

**Files:** Modify `SPEC.md`, `TASK.md`; create `docs/architecture/FORMULA_CENTRAL_PERMISSION_MATRIX.md`.

**Consumes:** The Task 0 approved commit.

**Produces:** Reviewed decisions for API hostname/route, target cluster, Auth provider migration/recovery, permission matrix, RPO, backup destination/retention/key owner, alerts, and maintenance window.

- [ ] Inventory the approved schema, functions, grants, triggers, RLS policies, direct REST/RPC calls, and each role's write/read behavior from source.
- [ ] Write a table of role × operation; include denied paths and explicit Admin-only activity reads.
- [ ] Verify the existing iMac PostgreSQL cluster using metadata-only inspection; decide whether staging/production uses it or the official Supabase container cluster. Do not overwrite either cluster.
- [ ] Record the chosen hostname and Cloudflare route design; leave PostgreSQL bound privately and do not claim Cloudflare suitability until account/route controls are checked.
- [ ] Record how email/password reset, OAuth callbacks/secrets, signing keys, user reauthentication, and account recovery will work after Auth restore.
- [ ] Estimate the maximum expected per-browser mutation volume for the accepted 48-hour outage and record supported browser/storage assumptions without treating an estimate as a guarantee.
- [ ] Record RPO, backup schedule, separate destination, retention, encryption-key custody, alert recipient, and maintenance window. These are required inputs to backup and production tasks, not implementation defaults.
- [ ] Obtain independent review of the permission and data-move contract before proceeding to migration SQL.

### Task 2: Build an isolated, reproducible Supabase staging stack — G2/G3

**Files:** Create `supabase/self-host/compose.yaml`, `supabase/self-host/.env.example`, `supabase/self-host/README.md`, and reviewed config files under `supabase/self-host/config/`.

**Consumes:** Task 1 decisions; official Supabase self-hosted deployment files and a pinned release/version set.

**Produces:** A local staging stack that can be started, health-checked, stopped, and recreated without production credentials or open database ports.

- [ ] Pin the official Supabase stack revision and every image version; record the upstream source and compatibility assumptions in the README.
- [ ] Bind gateway/API to loopback for staging, database and internal services to private container networking, and publish no PostgreSQL port.
- [ ] Add only placeholder variable names to `.env.example`; verify it contains no real secret material.
- [ ] Add `npm`/build dependencies only if the official stack or app actually requires them; do not add a second API framework.
- [ ] Start the stack with synthetic configuration and verify Auth, REST, RPC, RLS, and health checks locally.
- [ ] Check the rendered Compose configuration for unexpected public bindings and run secret scanning on tracked config.

### Task 3: Add additive, retry-safe mutation receipts — G2/G3/G4

**Files:** Create `supabase/migrations/20261017000000_fs_mutation_receipts.sql`; modify `supabase/schema.sql`, `tests/sql/mutation_receipts_test.sql`, and `tests/run-sql-tests.sh`.

**Consumes:** Approved schema and permission matrix from Tasks 0–1.

**Produces:** `public.fs_mutation_receipts` keyed by `(actor_user_id, request_id)` and narrowly scoped security-definer RPCs that commit the business mutation and receipt in one transaction. Receipt rows store result identifiers/version only, not formula/chat payload copies. RPCs accept `p_request_id text` plus typed entity parameters, derive actor only from `auth.uid()`, and return JSON `{request_id, entity_id, result_version}`. The browser dispatcher maps queue kinds to approved RPC names; it never sends a browser-supplied role or uses `actorId` for server authorization. All writes preserve the approved `origin/main` split tables and JSON shape.

- [ ] Write failing SQL tests for same-actor replay returning the original result without duplicate rows/events, same request ID under a different actor, transaction rollback, and authorization denial.
- [ ] Write a migration rerun test that applies the new migration twice without errors or duplicate objects.
- [ ] Implement `fs_upsert_record_once(p_request_id text, p_id text, p_data jsonb)`, `fs_delete_record_once(p_request_id text, p_id text)`, `fs_upsert_chat_once(p_request_id text, p_job_id text, p_data jsonb)`, `fs_upsert_message_once(p_request_id text, p_uid text, p_job_id text, p_ts bigint, p_data jsonb)`, `fs_upsert_approval_once(p_request_id text, p_job_id text, p_part text, p_data jsonb)`, `fs_delete_chat_once(p_request_id text, p_job_id text)`, `fs_append_activity_once(p_request_id text, p_uid text, p_ts bigint, p_data jsonb)`, and `fs_upsert_meta_once(p_request_id text, p_key text, p_value jsonb)`; preserve current table shapes and role rules and return the uniform receipt shape.
- [ ] Keep `fs_next_rec_seq()` as the server-side atomic allocator, require active authenticated membership, and remove execute permission from `anon`; prove concurrent calls yield unique values in SQL tests.
- [ ] Revoke direct access to receipt storage from `anon` and `authenticated`; grant only the minimum RPC execution and preserve RLS on business tables.
- [ ] Return a receipt with `request_id`, actor, entity ID, and server version so the client can match acknowledgment exactly.
- [ ] Run `./tests/run-sql-tests.sh`; expected result is both schema/migration applications succeed and all positive/negative SQL assertions pass.

### Task 4: Implement a recoverable IndexedDB outbox — G3/G4

**Files:** Modify `index.html`, `tests/formula-studio.test.js`.

**Consumes:** Task 3 RPC contract and approved client behavior.

**Produces:** IndexedDB database `formula-studio`, object stores `pending` and `rejected`; pending mutation shape `{requestId, actorId, kind, entityId, payload, createdAt, attempts, lastError}`. `requestId` is created once with `crypto.randomUUID()` over HTTPS and retained across retry. Rejected entries preserve original payload and visible reason. Queue kinds are `record_upsert`, `record_delete`, `chat_upsert`, `message_upsert`, `approval_upsert`, `chat_delete`, `activity_append`, and `meta_upsert`; the client dispatches these to the matching typed RPC from Task 3.

- [ ] Write failing browser tests for enqueue persistence, page reload before acknowledgment, duplicate flush, transient network failure, permanent rejection, a 48-hour expected-volume fixture, and IndexedDB quota/error handling.
- [ ] Implement `fsOutbox.enqueue(mutation)`, `fsOutbox.listPending(actorId)`, `fsOutbox.acknowledge(actorId, requestId)`, and `fsOutbox.reject(actorId, requestId, error)` using IndexedDB transactions.
- [ ] Implement `fsFlushOutbox()` to send `{p_request_id, ...typedParameters}` only as the currently authenticated actor, verify exact `{request_id, entity_id, result_version}`, and delete a pending entry only after a matching server acknowledgment.
- [ ] Keep transient failures pending; move permanent server rejection into `rejected` only after the durable IndexedDB transaction succeeds. Show a clear unsynced/rejected state in the existing save status UI.
- [ ] Block replay when the active user differs from `actorId`; require the original account or a reviewed Admin recovery path. Never send as the newly logged-in user.
- [ ] Replace localStorage deferred-write markers and chat outboxes with the single outbox only after parity tests cover existing queue behavior.
- [ ] Keep currently loaded server-owned data in memory. Stop persisting full synced snapshots to localStorage after the compatibility migration task passes.
- [ ] Run `node harness.js`; expected result is all existing and new browser tests pass with test-only Supabase URL/key and no production network access.

### Task 5: Read-through API behavior and legacy browser-data reconciliation — G3/G4

**Files:** Modify `index.html`; create `scripts/central-migration/reconcile-legacy-store.js` and `tests/central-migration/reconcile-legacy-store.test.cjs`.

**Consumes:** Tasks 1, 3, and 4.

**Produces:** The app reads shared records/chats/users/meta from the central API; browser persistence contains only pending/rejected mutations and minimum session state. Legacy data is retained until matched or explicitly recovered.

- [ ] Add tests for empty legacy storage, identical local/server rows, conflicting rows, local-only rows, invalid legacy JSON, interrupted reconciliation, and rerun with no duplicate writes.
- [ ] Implement a dry-run reconciliation report with per-table counts and deterministic salted fingerprints; do not output payloads, email, chat text, tokens, or hashes that reveal record content.
- [ ] Implement apply mode only for synthetic staging fixtures in this task; require explicit input path and produce a resumable report keyed by stable IDs.
- [ ] Route all app mutations through the outbox/RPC contract; eliminate direct business-table writes after each mutation path has a passing test.
- [ ] Ensure legacy localStorage is not cleared until server parity and pending-queue accounting both pass and a recovery export is available.
- [ ] Add an Admin-only view for rejected items that supports retry/reassignment only through a permission-checked audited operation; other roles cannot inspect other users' rejected payloads.

### Task 6: Repeatable migration, parity, and rollback tools — G3/G4/G5

**Files:** Create `scripts/central-migration/preflight.sh`, `scripts/central-migration/reconcile.js`, `scripts/central-migration/README.md`, and `tests/central-migration/` fixtures.

**Consumes:** Approved source/target versions, Task 5 reconciliation contract, synthetic schema fixtures, and Task 7's tested backup/restore harness before final rollback rehearsal.

**Produces:** A dry-run-first and rerunnable migration workflow with masked evidence and a documented rollback/reconciliation target.

- [ ] Write tests for missing required tables/columns, duplicate IDs, mismatched counts/fingerprints, rerun after interruption, and source/target version mismatch.
- [ ] Implement read-only preflight that checks server/version/schema/function/RLS prerequisites and refuses unknown baselines.
- [ ] Implement migration execution with a recorded run ID and checkpoint; make each unit idempotent and stop on unexplained differences.
- [ ] Generate masked reconciliation output (counts, exception IDs, and keyed fingerprints only); never write a database dump or business payload to repository paths.
- [ ] Document the exact source-to-target restore command and the safe point for switching the single writer; prohibit silent dual-write.
- [ ] Exercise migration and rollback on disposable staging copies, then rerun migration to prove idempotency before any UAT data is loaded.
- [ ] Test the post-write rollback path: if the iMac authority has accepted writes, the prior hosted database cannot become writer again until those writes have been reconciled without loss.

### Task 7: iMac service operations, backup, restore, and alerts — G3/G4/G5

**Files:** Create reviewed templates under `runtime/formula-central/`; update `RUNTIME_OPERATIONS.md`; create isolated restore/health tests.

**Consumes:** Task 1 RPO/backup/alert decisions and Task 2 stack.

**Produces:** Restart-safe service templates, private health checks, encrypted backup/restore commands, disk/backup freshness alerts, and a tested recovery drill.

- [ ] Add startup/restart and health checks for gateway, Auth, Postgres, Cloudflare connector, disk space, and backup age without printing secrets or business payloads.
- [ ] Add backup configuration for the selected separate medium and retention; use least-privilege credentials outside Git.
- [ ] If point-in-time recovery is required, configure base backups plus complete WAL archiving and verify an actual point-in-time restore. Otherwise document the approved snapshot RPO honestly.
- [ ] Add restore-drill procedure into an isolated stack and verify row counts/fingerprints and Auth login recovery.
- [ ] Test machine restart, tunnel unavailable, database unavailable, disk threshold, backup failure, and recovery alert delivery in staging.
- [ ] Do not install/enable production launch agents, alter sleep settings, open firewall routes, or change Cloudflare config until the release gate authorizes the exact target.

### Task 8: Full verification and independent review — G4

**Files:** Updated tests and review evidence only.

**Consumes:** Tasks 2–7.

**Produces:** A clean-checkout test record, security review, edge-case report, and CODEOWNER approval on the exact branch commit.

- [ ] Run `node harness.js` and `./tests/run-sql-tests.sh` from a clean checkout of the approved implementation branch.
- [ ] Verify all app and SQL permission cases, especially that non-Admins cannot read logs through table REST, RPC, or UI.
- [ ] Verify close/reopen, offline > reconnect, retry after timeout, duplicate replay, account switch, concurrent edit, quota exhaustion, rejected-write recovery, and legacy reconciliation rerun.
- [ ] Verify no production endpoints/keys are embedded in test output or artifacts.
- [ ] Run independent `edgecase` review and security review; fix blockers and rerun affected suites.
- [ ] Obtain CODEOWNER review and required GitHub checks. Separately present evidence to the user for their offered independent review; do not self-approve.

### Task 9: Staging data rehearsal, UAT, and final approval — G5/G6

**Files:** Create masked `docs/UAT_FORMULA_CENTRAL.md` and `docs/GO_LIVE_FORMULA_CENTRAL.md` from approved evidence.

**Consumes:** Approved release candidate, chosen RPO/backup settings, and staging environment.

**Produces:** Zero-unexplained-difference reconciliation, successful restore drill, role UAT, rollback plan, and explicit human release decision.

- [ ] Restore/migrate only into isolated staging using authorized masked or synthetic data.
- [ ] Confirm per-entity counts/fingerprints match with zero unexplained differences; account for pending local mutations separately.
- [ ] Complete Admin, PD, RA, RD, Sales, OPC, MKT, and Purchasing UAT for allowed/denied operations and Admin-only logs.
- [ ] Test external HTTPS access through the intended Cloudflare route, iMac restart, outage/reconnect, restore, and alert delivery.
- [ ] Present commit, PR, CODEOWNER review, test results, backup checksum, restore evidence, migration report, rollback target, remaining risk, and operator identity to the user.
- [ ] Stop for explicit approval before any production data migration or all-user switch.

### Task 10: Controlled production migration and post-live — G7/G8

**Files:** No source changes except reviewed fixes through a new PR; append masked operational evidence to the approved go-live record.

**Consumes:** Explicit Task 9 approval and immutable reviewed release artifact.

**Produces:** One controlled switch with a recorded authority, verified health/parity, and an available rollback/reconciliation path.

- [ ] Runtime Operator verifies target, approved commit, backup/checksum, and rollback target immediately before mutation; abort if any mismatch exists.
- [ ] Run the approved migration once, validate health/parity and admin log visibility, and begin with the approved pilot scope.
- [ ] Keep one authoritative writer; retain the previous store read-only for the approved reconciliation period.
- [ ] Present pilot evidence and obtain the final human authorization before switching all users.
- [ ] Record deployment identity/time, revision, service health, backup freshness, queue/rejection counts, and rollback readiness.
- [ ] Complete post-live review and confirm outcomes; rollback or pause if health, parity, or rejected-queue thresholds fail.

## Self-Review and Coverage

- Source baseline and approval: Task 0.
- Data, permissions, Admin-only logs, Auth settings, and operational choices: Task 1.
- Central API and private PostgreSQL path: Tasks 2–3.
- Local-only unsent data, idempotent retry, account switching, rejection handling, and quota failures: Task 4.
- Legacy data, server-owned reads, and no silent cleanup: Task 5.
- Repeatable migration, reconciliation, and rollback: Task 6, with Task 7's restore harness completed before the final rollback rehearsal.
- Restart, sleep/availability, backup, restore, and monitoring: Task 7.
- Tests, independent review, CODEOWNER gate, UAT, approval, deployment, and post-live: Tasks 8–10.
- Open decisions are explicit prerequisites in Task 1. A missing value blocks only dependent work and must not be replaced by an undocumented default.

## Handoff

Implementation method: subagent-driven development, followed by an independent whole-branch review. The implementation is high risk and the browser, database, migration, and runtime tasks have separate review boundaries. Before any implementation, the user should review this plan and the approved GitHub baseline must be established.
