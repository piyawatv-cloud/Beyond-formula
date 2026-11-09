# iMac PostgreSQL Central Data Service

Status: proposal for implementation review; not approved for production use.

## Goal

Make the PostgreSQL instance on the iMac the authoritative store for Formula Studio data for all users, including users outside the office. Users accept that service may be unavailable for up to 48 hours when the iMac or internet connection is unavailable.

## Confirmed requirements

- Users must be able to reach the service from outside the office through the existing Cloudflare-managed domain.
- PostgreSQL is the central owner of Formula records, chats, users directory data, activities, and shared metadata after cutover.
- The browser must call an authenticated API. It must never connect directly to PostgreSQL or contain a database credential.
- Preserve the current Supabase Auth identity provider and active-membership behavior for users, while moving the same Supabase-compatible Auth and membership authority together with business data onto the iMac.
- Preserve the Supabase-compatible API contract so the browser continues to use user JWTs, REST/RPC, and RLS; UI visibility is not authorization.
- Only administrators may read activity logs. The API and database boundary must enforce this.
- Preserve existing Formula JSON object shape, local IDs, and existing Supabase table/key/data contract during migration. Any necessary schema change must be additive, backward-compatible, rerunnable, and separately reviewed.
- Queue only unsent changes locally. Sending the same queue item more than once must not create duplicate records, chat messages, or activity events.
- A server rejection must remain recoverable and visible; it must never be shown as synced or silently discarded.
- Before cutover, compare source and destination data, test backup restoration, and complete role-based UAT and independent review.
- Do not move all users until the accountable human approves the completed evidence package.

## Proposed boundary (working recommendation; G1 approval still required)

```text
Browser
  └─ Existing Supabase-compatible HTTPS endpoint on the Cloudflare-managed domain
       └─ Cloudflare Tunnel (outbound connector on iMac)
            └─ Self-hosted Supabase gateway, Auth, REST/RPC, and RLS
                 └─ PostgreSQL on iMac
```

Prefer the existing Supabase-compatible stack over inventing a parallel custom API. This matches the app's current Auth, REST, RPC, JWT, and RLS contracts and the existing `supabase/schema.sql` guards. This is a development planning assumption, not an approved production architecture: the user has asked work to continue and offered to act as an independent human reviewer, but has not yet selected the source branch, API hostname, RPO, or backup destination. Supabase documents a Platform-to-self-hosted restore workflow that includes database roles, schema, data, RLS, functions, triggers, and `auth.users`; keys, email, and custom domains need separate configuration. The source/target versions and compatibility still require staging proof.

Use a dedicated API hostname such as `api.<existing-domain>` after confirming the exact hostname and route. Cloudflare Tunnel supplies the network route and does not replace Supabase Auth or RLS; Cloudflare suitability and account controls have not been verified yet. Publish only the HTTPS API gateway; keep PostgreSQL private and do not publish its port. Cloudflare edge protection is defense in depth. Move Auth, active memberships, and business data together so the existing login and membership logic remain one authority. Account data migration alone does not configure Auth providers: email delivery/reset flows, OAuth credentials and callback URLs, service secrets, JWT signing keys, and user reauthentication must each be inventoried and rehearsed without publishing secrets. Expect reauthentication after signing-key changes and confirm account recovery before cutover.

The iMac currently has a separate PostgreSQL 16.14 service. G0 must determine whether it contains Formula data and whether it is the target cluster. The preferred self-hosted Supabase stack may use its own PostgreSQL container; do not overwrite, delete, or silently abandon the existing instance. The owner must approve which cluster becomes authoritative after inventory and restore rehearsal. The repository branch being inspected is not on GitHub `origin/main`: it is 24 commits ahead of `origin/main` from a shared ancestor and includes unmerged Auth/RLS and other application changes. The current schema on this branch differs materially from `origin/main`, which lacks Auth, membership, and RLS. Neither baseline is approved for migration until an explicit reconciliation plan is reviewed; a migration PR must not accidentally bundle unrelated unpublished work.

## Data and retry contract

- Preserve existing record/chat JSON payloads and their stable keys.
- Each client mutation carries an opaque unique request/event ID and authenticated actor identity.
- The server records an idempotency receipt in the same transaction as the business mutation; replay returns the original receipt/result.
- The browser keeps pending mutations in IndexedDB (transactional, per-origin storage), not an ever-growing per-save collection of `localStorage` keys. Only mutations not yet acknowledged remain queued.
- Acknowledged items are removed only after the API returns a matching receipt and the client confirms the returned entity/version.
- Permanent rejection retains the original payload locally in a visible unresolved queue. Provide an administrator recovery view/action with audit trail before all-user launch.
- Multi-tab concurrency is resolved by server-side idempotency and optimistic version checks; browser locks are an optimization only.
- Legacy localStorage snapshots are not cleared until migration/reconciliation proves all retained local changes are acknowledged or explicitly exported for recovery.

## Authorization contract

- Missing, invalid, expired, inactive, or ambiguous identity fails closed.
- Membership role is derived from the authoritative active membership, never from a browser-supplied role.
- Every API route has an explicit permission matrix and negative tests.
- Activity reads are Admin-only at the API; server-side query must not return other users' logs to non-admin callers.
- Database network binding and database roles remain private to the self-hosted stack. Secret keys are stored only in the iMac service secret/config store, never in GitHub or the browser.
- Error responses and logs contain correlation IDs and sanitized diagnostics, not tokens, formulas, chat text, or personal data.

## Availability, backup, and recovery

- Accepted recovery time objective (RTO): up to 48 hours for iMac or internet outage.
- Data-loss objective (RPO), backup cadence, backup destination, retention, encryption-key owner, alert recipient, and maintenance window remain to be agreed before production cutover.
- API and PostgreSQL start after iMac restart; health checks cover tunnel, API, database, disk space, and backup freshness.
- Maintain encrypted backups on media separate from the iMac. Keep configuration and restore instructions separately. Test a restore into an isolated environment before cutover and on a recurring schedule.
- Do not claim point-in-time recovery until base backups and complete WAL archives exist and an actual recovery drill passes.
- When the iMac or internet is unavailable, users may continue only with locally queued changes; shared reads and central acknowledgment are unavailable. Service resumes after recovery/reconnect and idempotent replay.

## Cutover and rollback

- Restore the current Supabase project to a clean self-hosted staging instance using the reviewed migration workflow, then move approved data to the iMac production instance with pre/post counts, checksums/fingerprints, and an exception report.
- Do not dual-write silently. Use an explicit migration state and one authoritative writer at each stage.
- Pilot in staging, then limited-user UAT, then production cutover only after independent CODEOWNER review, backup/restore evidence, reconciliation, and an approval decision.
- Rollback must identify the previous immutable app release and data authority. If writes have landed in iMac PostgreSQL, rollback includes a safe forward/reconciliation path; never point old code at stale Supabase data and silently lose newer writes.
- All-user switch is the final human-controlled gate, after evidence is presented.

## Acceptance evidence

- API contract and permission matrix reviewed.
- Migrations run repeatedly on synthetic fixtures without loss or duplicate rows.
- All roles pass positive and negative authorization checks; only Admin can read activity logs.
- Offline/reconnect, tab close/reopen, account switch, duplicate replay, concurrent edit, rejected item recovery, and storage quota scenarios pass.
- Source/destination data reconciliation has zero unexplained differences, with masked evidence.
- Backup restore drill, restart recovery, external access, tunnel failure, and disk-space alert are demonstrated.
- Independent CODEOWNER review, staging UAT, approved release identity, rollback reference, and final human approval are recorded.

## Not in scope without separate decision

- Automatic failover to a second database (service downtime up to 48 hours is accepted).
- Replacing the identity provider or changing the user-facing login flow. Moving the existing Supabase-compatible Auth service and its authority to the iMac is part of this proposal and requires separate migration/review evidence.
- Public exposure of PostgreSQL, database port-forwarding, or a privileged browser key.
- Deleting legacy browser data or production Supabase data before reconciliation and approval.
