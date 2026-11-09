# Implementation plan — iMac central PostgreSQL

Status: G0 partial / G1 recommendation documented; unresolved source-branch and architecture decisions still block schema, auth, migration, Cloudflare, and production work. No production, Cloudflare account, database, or user changes made.

## Governance scope

- Task ID: not assigned in the request; do not invent one.
- Issue ID: none provided.
- Environment: local feature branch only until a reviewed release is approved.
- Critical change: yes — `index.html`, authentication/authorization, synchronization, database migration, runtime, Cloudflare routing, backup/restore.
- Source of truth: GitHub `origin/main` (`a4a6e1d` at last confirmed fetch). This work is on local branch `codex/imac-central-postgres` at `a3f4859`; it is 24 commits ahead of `origin/main` from a shared ancestor and contains unpublished code changes, including Auth/RLS work. It remains local pending branch reconciliation and review. The original checkout also contains unrelated uncommitted files and is not used for this task.
- Owner: System Owner / project owner.
- The user has offered to approve work in the role of independent human reviewer. Record that review as a separate human gate when the evidence package is ready. It does not approve unpublished commits or replace required CODEOWNER `@phossatron` review (or a formally appointed replacement), and it does not permit author self-approval.
- Production data, credentials, Cloudflare account, production SQL, deployment, and all-user switch are forbidden until their specific gates are satisfied.

## Work sequence

### G0 — Discover (in progress)

- [x] Read project `AGENTS.md`, `CLAUDE.md`, runtime instructions, current schema, and current auth/data boundary.
- [x] Confirm current application uses Supabase Auth + REST/RLS and static Vercel hosting.
- [x] Confirm PostgreSQL 16.14 (Homebrew) is present, Docker CLI/daemon are available, and `cloudflared` is running as a LaunchAgent; do not change service/network settings during discovery.
- [x] Confirm macOS currently prevents system sleep and has about 317 GiB free at the checked volume.
- [ ] Inspect which local PostgreSQL cluster contains Formula data, by approved metadata-only inspection. So far only local PostgreSQL 16.14 service presence has been confirmed; no database contents were queried.
- [ ] Inspect the actual Cloudflare zone/domain, existing routes, Access identity provider, and available account plan through approved read-only evidence.
- [x] Confirm Cloudflare and Supabase management connectors do not grant access to the configured production project/account from this task; no production metadata or data was read.
- [x] Inventory local schema entities and role rules from repository source only; production/staging counts remain unavailable and were not queried.
- [ ] Record current iMac service manager, disk capacity, sleep settings, backup medium, and alert channel without changing them.

### G1 — Architecture and risk review

- [x] Record the working recommendation: self-host the existing Supabase-compatible gateway/Auth/PostgREST/RLS stack on the iMac behind Cloudflare Tunnel, preserving current API contracts. This is not yet an approved production architecture.
- [x] Record that user offered to review independently; CODEOWNER approval and final owner approval remain distinct gates.
- [x] Record branch provenance risk: current work branch includes 24 commits not present on GitHub `origin/main`; do not open a migration PR that silently carries unrelated unpublished changes.
- [x] Independent read-only architecture review found G1 cannot pass yet: active and remote schemas differ materially (`origin/main` lacks Auth/membership/RLS); neither baseline is approved for migration.
- [ ] Verify whether the existing PostgreSQL 16.14 instance contains data and decide whether to reuse it or use the stack's PostgreSQL container; do not replace either before restore rehearsal and owner approval.
- [ ] Reconcile the branch to GitHub: identify the exact Auth/RLS and other commits required, submit them for normal CODEOWNER review, and establish an approved GitHub commit as the migration baseline before creating migration/schema changes.
- [ ] Confirm iMac can support Docker Desktop and the full self-hosted stack within disk, memory, restart, and maintenance constraints.
- [ ] Confirm exact API hostname, Cloudflare zone/route, and account controls for a published application route and least-privilege tunnel; no suitability conclusion until verified.
- [ ] Inventory and rehearse Auth service configuration separately from account-data restore: email delivery and password reset, OAuth providers/callbacks, secret custody, JWT signing keys, reauthentication, and account recovery.
- [ ] Define the role/action matrix, including Admin-only activity reads, and database/API trust boundary.
- [ ] Agree RPO, backup cadence, destination, retention, key owner, alert owner, and maintenance window.
- [ ] Independent architecture/security review before schema or identity implementation. User review may satisfy the human independent-review role if they are not the author; it cannot satisfy CODEOWNER approval unless formally appointed.

### G2 — Specification and migration design

- [x] Create `SPEC.md` with preferred Supabase-compatible service boundary, data/retry/authorization contract, and acceptance evidence.
- [ ] Freeze service/API contract compatibility and role permission matrix against existing Supabase REST/RPC/RLS behavior.
- [ ] Inventory current Supabase schema/functions/guards and map to iMac PostgreSQL without breaking the locked JSON contract.
- [ ] Design idempotent migration, reconciliation report, rollback, and one-writer cutover sequence.
- [ ] Approve backup and restore runbook before touching production data.

### G3 — Implementation (not started; blocked on branch/review and G1/G2 approvals)

- [ ] Prepare a pinned, reproducible self-hosted Supabase stack using official deployment files; keep all service and database ports local except the Cloudflare Tunnel gateway.
- [ ] Add Cloudflare Tunnel configuration template and health/alert checks; do not place tunnel credentials in Git.
- [ ] Preserve authentication, membership/role checks, Admin-only log reads, RPC guards, and RLS; do not replace them with UI-only checks.
- [ ] Move pending writes to a bounded/recoverable IndexedDB outbox and add a visible admin dead-letter recovery flow.
- [ ] Keep application/browser database credentials absent and preserve a reversible transition flag.
- [ ] Add migration/backfill and reconciliation tooling with synthetic fixtures only.

### G4 — Test / independent review / edge cases

- [ ] Run `node harness.js` and `./tests/run-sql-tests.sh` from a clean checkout.
- [ ] Add API and SQL tests for roles, rejection paths, duplicate replay, concurrent writes, and migration reruns.
- [ ] Verify offline, internet loss, iMac outage, restart, account switch, cross-tab, quota, and dead-letter recovery.
- [ ] Run security review and `edgecase` review; resolve blockers.
- [ ] Independent CODEOWNER review and required GitHub checks.

### G5 — Staging UAT and restore drill

- [ ] Stage data migration with synthetic or approved masked fixtures.
- [ ] Reconcile counts and per-item fingerprints with zero unexplained differences.
- [ ] Run restore drill, iMac restart drill, Cloudflare Tunnel/API access from outside the office, and alert checks.
- [ ] UAT every role and confirm non-admin cannot read activity logs.
- [ ] Prepare reviewable UAT/backup/rollback evidence and receive human approval to schedule production migration.

### G6–G8 — Production release, all-user switch, and post-live

- [ ] Runtime Operator applies only approved immutable release/migration after backup and rollback preflight.
- [ ] Start with an explicitly defined pilot, verify health/parity, then present the complete evidence package for final human approval.
- [ ] Switch all users only after that final approval; retain the old source read-only for the agreed reconciliation window.
- [ ] Record production health, backup freshness, sync queue/rejection counts, and incident/rollback owner.
- [ ] Complete post-live review and document measured outcome.

## Current checkpoint

The deferred-write change is an uncommitted prototype in `index.html`. It uses localStorage markers and is not the final design for reducing local browser storage. The intended final design keeps only unacknowledged mutations in IndexedDB and removes them only after a matching server receipt. Repository-source inspection confirms the current schema defines `fs_records`, `fs_chats`, `fs_chat_events`, `fs_chat_reads`, `fs_users`, `fs_activities`, `fs_meta`, and `fs_memberships`; `activities_admin_select` limits activity reads to Admin, while membership and mutation policies are role-based. The app calls Supabase REST/RPC directly, so replacing only the database would break its contract. Docker, local PostgreSQL, `cloudflared`, and a no-sleep setting are present, but the actual Cloudflare route, PostgreSQL data ownership, backup destination/retention, and alert channel remain unknown. No tests have been run for this branch yet. No PR, migration, Cloudflare route, backup, or deployment exists for this work.

The user's latest instruction is to continue and that they can review/approve work independently. An independent read-only architecture review has been completed; it found G1 cannot pass because the source branch/schema baseline and several operating decisions remain unresolved. We proceed with reversible local preparation and evidence on the current feature branch, but do not treat the offer to review as approval of the architecture, unpublished base commits, production changes, or all-user cutover. G0/G1 remain open until branch reconciliation and missing operational choices are resolved.

The detailed step-by-step coding plan is [`docs/superpowers/plans/2026-10-17-imac-central-postgres.md`](docs/superpowers/plans/2026-10-17-imac-central-postgres.md). It is ready for review; implementation still begins only after Task 0 establishes an approved GitHub code baseline.
