# Cost summary and approval workflow — local implementation

Status: synthetic orchestration verified; live Formula chat, CEO approval, storage and authorization adapters are not connected. This document covers P21/P22 local service behavior, not UAT, release or production readiness. No real message or approval was submitted.

## Source and boundary

`apps_script/CostWorkflow.gs` provides `CostWorkflow.create(config, adapters)`. It has no `doGet`/`doPost`, credentials, live transport, auth implementation or module-level execution. Initialization fails unless `enabled: true` and `environment: 'synthetic'`; all other environments reject. These switches are configuration guards, not authorization.

The module receives the actual `CostCalculator` API. Tests extract the marked block from the application `index.html` and inject it; costing equations are not duplicated. The existing browser approval function remains disabled. The service does not alter locked Formula storage/schema or production permissions.

## Required trusted adapters

All adapters are installed by trusted server code, never supplied by the command request.

| Adapter | Required behavior |
| --- | --- |
| `calculator` | Actual `CostCalculator.calculate` and `project`; use the reviewed immutable application version. |
| `authorize(session, command, projectId)` | Authenticate the server session, check active project membership and the exact command, and return `{actorId, permissions:[command]}` only when granted. `approve-cost-quotation` must require CEO commercial authority; `send-cost-summary` requires the approved sender role. Never trust a browser role/actor string. |
| `now()` | Trusted server UTC timestamp. This synthetic version evaluates date validity against the UTC date; the production business-date/timezone policy must be confirmed before live use. |
| `readCurrentVersion(tx, projectId, scenarioId)` | Return the authoritative current scenario inside the same serializable transaction as the outbox/approval write. Read source confirmations and invalidations consistently; browser status fields are not evidence. |
| `store.transaction(callback)` | Atomic durable transaction with rollback on exceptions and serialized/conflict-retried reads/writes. Provide `tx.get(key)`, `tx.insert(key, value)` (unique insert, never overwrite), and `tx.put(key, value)` for receipt state only. Restrict approval records to append/read; restrict raw snapshots to authorized personnel. |
| `digest(text)` | SHA-256 as lowercase 64-character hex. Used to detect unchanged revision IDs with changed source content. Do not store raw JSON fingerprints in the chat outbox. |
| `sendReceipt(event)` | Authenticated project-chat transport that durably deduplicates `event.idempotencyKey` and rejects different bodies for an existing key. Return `{status:'sent', receiptId}` only after durable acknowledgement; `{status:'failed', receiptId}` means definitive non-delivery. An exception, missing receipt or unknown status means pending/unknown. |

The test harness supplies in-memory synthetic adapters only. It verifies the service protocol; it does not prove a production database's isolation, transport durability or server authentication. Those implementations and independent security checks remain release dependencies.

## Commands

Both commands accept only identity from the caller: `{projectId, scenarioId, expectedRevision}` plus a trusted session handle. Additional body, actor, timestamp, price or scenario fields are ignored. Identities and expected revision are validated. Authentication failures produce no outbox or approval record.

### `sendSummary(request, session)`

1. Authorize the sender and load the exact current scenario inside a transaction.
2. Calculate with the real core, then project the Sales-safe allowlist.
3. Insert a durable pending outbox keyed by `summary:project:scenario:revision` before attempting transport.
4. Send the exact stored event and persist a receipt only when one is definitive.

Summary contents: project/scenario/revision, selling quantity, pack size/units, approved display aliases (otherwise numbered placeholders), adjusted RM/PK/Operation totals, completeness and pending reasons, and the configured Formula reference link. It excludes raw costs, item/source objects, supplier identity, full material names, source documents and purchase exposure. An unapproved calculator result is explicitly labelled as not CEO approval. Missing PK or pricing does not prevent a partial summary; missing adjusted amounts stay null and final unit price is withheld until calculation completeness.

Alias disclosure is a separate trusted fact: the adapter must set `displayNameApproved: true` only for RD-approved public display names. Do not derive it from the presence of an alias. UI rendering must treat all summary strings as text and escape HTML; this module returns structured data, not HTML.

The configured HTTPS Formula base URL receives a project/scenario/revision fragment. This is a deterministic reference format for synthetic trials, not a claim that the current live Formula router resolves it. Live integration must implement and verify that resolver before enabling messages.

A repeated sent/failed command returns its terminal receipt without another send. An ambiguous pending send retries the same body and key, even if a newer draft now exists; it never rebuilds an old event using new prices. Recipient-side durable idempotency is required to ensure one visible chat message after an accepted send loses its acknowledgement. Client-side retry alone cannot guarantee exactly-once delivery. No automatic timer or retry loop is installed.

### `approve(request, session)`

Authorize the dedicated quotation action; load and check the exact current revision inside the transaction; calculate at server time; reject unless `result.complete`. Append an immutable approval keyed by `approval:project:scenario:revision`, including server actor/time, source digest, exact scenario and calculation result. No caller-supplied actor, approval time or price is used.

A repeat on the same unchanged current revision returns the existing approval. A changed expected revision is stale; changed terms under the same revision ID conflict. New revisions receive new approval records and cannot update old snapshots. The snapshot contains confidential raw costing inputs and belongs only in the protected approved store, never Formula chat or a broad browser payload. The module is disabled outside synthetic configuration, so these are local approval protocol tests, not real CEO approval.

## Verification

Command:

`node --test 'cost calculator by project/tests/cost-workflow.test.js'`

Result: 12/12 passing actual-module tests. Cases cover disabled/missing dependencies, safe allowlisting, forged fields ignored, missing alias approval, pending PK, denied authority, stale/concurrent revision, successful/idempotent receipt, ambiguous timeout, definitive failure, unchanged retry body across revisions, recipient deduplication after lost acknowledgement, complete approval, changed terms conflict, immutable old snapshots, and detached repeated approval results with a reference-returning transaction adapter.

Remaining: approved live server adapters, business-date policy, confirmed Formula link resolver, durable outbox/receipt and transaction concurrency integration tests, independent security review, business UAT and operator-controlled release. This work does not change production security/database/permissions/dependencies. Rollback is removal of these new unconnected service/test/document files; no data migration or runtime reversal is required.
