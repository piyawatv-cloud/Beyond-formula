# RM ingestion and confirmation — local implementation evidence

Date: 2026-09-05. Scope: P05–P10 deterministic core, synthetic tests only. This is a Critical Change preparation because synchronization and permission boundaries are involved. Owner roles: Development / Procurement RM / RD. Independent reviewer: project CODEOWNER. No Issue ID or PR exists for this subtask. No deployment or technical/business approval is claimed.

## Delivered

- `apps_script/RmData.gs`: GAS V8-compatible `RmData` domain module with no external services, source IDs, credentials, sheet names, live data or automatic triggers.
- `tests/rm-data.test.js`: Node built-in test runner; executes the actual `.gs` via `vm` using synthetic observations and injected storage failures.
- This document: integration contracts and boundaries; no duplicate master or physical sheet schema.

| Plan work | Implemented local behavior | Remaining evidence |
|---|---|---|
| P05 | Slash pairs retain invalid positions; full positive numeric parser; explicit multiline MOQ pairs; unit and denominator preserved | Verified source mapper covering every physical price/status/continuation/rich-link field |
| P06 | All supplied raw fields scanned for exclusions; absent/invalid dates distinguished; reconciliation counts | Source completeness and source date interpretation |
| P07 | Existing material identity supplied by authoritative registry; separate raw observation and full commercial version; no row-number-derived identity | Persistent identity resolution across sources; protected append-only storage |
| P08 | Auth callback required, exact version binding, evidence/actor/time, expiry/scope/withdrawal and conditional applicability gate | Authenticated server actor, protected event storage and permissions under real Procurement/RD accounts |
| P09 | Request → Procurement candidate → independent RD spec acceptance → commercial confirmation | Data Center UI, persistence, deep links and notification delivery (no messages sent) |
| P10 | Locked staging → complete readback equality/reconciliation → atomic compare-and-swap commit adapter; failure event retains prior reference | Real adapter crash/lock tests, freshness policy and manual non-production run; no scheduled sync claimed |

The historical audit is not closed by these unit tests. In particular physical source completeness, live authorization and the old Formula Builder route remain unproven.

## API and trust boundary

This module is a domain core, not a security boundary or a public web endpoint. Do not accept normalized records, actors, authorization callbacks, events, or eligibility context directly from client JSON. A server adapter must load those from authoritative protected stores and authenticated membership. Never expose the full record or canonical version to Sales/OPC or a role without RM commercial permission.

- `parsePaired(quantityTextOrArray, priceTextOrArray)`: returns `{ok, positions}`; every position survives even when invalid. String `/` separates list tokens. Pass arrays for prices containing unit denominators, e.g. `['1700/kg', '1400/25kg']`. Never pre-filter invalid input before calling.
- `parseNotes(text)`: accepts one explicit `MOQ quantity unit: price[/basis unit]` per line. An unrecognized line makes the whole result ambiguous. `<100 kg` is not a MOQ. Price without a label is THB/kg. Accepted units are kg/g/mg/piece/pcs/pack/l; unfamiliar units remain DQ rather than guessed.
- `normalize(input)`: preserves raw evidence and returns `accepted`, `excluded` or `dq`, reasons, parsed terms, canonical version and observation. Accepted means structurally parsed, never Procurement-approved.
- `confirm(record, expectedVersion, actor, UTCtimestamp, authorize)`: returns an event only after authorization and validation. The service must append the returned event durably before reporting success; append failure must not change readiness. Do not implement `onEdit` dropdown as authorization.
- `eligible(record, persistedConfirmation, UTCtimestamp, trustedContext)`: the single commercial gate for a loaded record; ignores UI `READY` labels. Context supports project ID, withdrawn/obsolete/syncFailed/stale flags and `conditionsSatisfied`. Nonempty conditions require explicit satisfaction evidence from trusted applicability logic. Service must check selected generation/offer currentness and freshness before passing this context.
- `requestMaterial`, `propose`, `acceptSpec`: return immutable-by-copy workflow records. The service persists each transition as an event with optimistic version checks. Candidate data is never written into the read-only RM source. Existing catalog records rely on the source mapper to supply an authoritative RD-controlled material/spec identity; candidates require a separate spec acceptance bound to that identity.
- `refresh(inputs, storage, generationId, UTCtimestamp)`: builds a full candidate generation, reconciles counts and exact canonical readback, then requests a commit. All reads must use only `storage.current()` to avoid mixed generations.

The canonical `version` is collision-free sorted serialization, not a public opaque ID, digest, credential, or signature. It contains commercial terms. The eventual protected store may assign an opaque ID while retaining exact canonical comparison internally. It must never send canonical versions through redacted messages/exports. Do not derive material identity from name, physical row, price or vendor; `materialId` and `specVersion` must come from the approved identity resolution route. Moving a physical row changes observation provenance only.

## Input is a domain mapping, not a spreadsheet schema

`normalize` accepts authoritative `materialId`, `specVersion`, `vendorId`, `sourceRef`, ISO `sourceDate`, UTC `observedAt`, `quantityText`/`priceText` or `tierNotes`, numeric `leadTimeDays`, `validUntil`, `scope`, and `evidenceRef`. Optional `fields` preserves all source evidence; `constraints` and `orderIncrement` carry commercial conditions. `unresolvedEvidence: true` forces DQ when a mapper detects additional conflicting evidence.

Physical source adapters must:

1. Read every relevant source field including continuation rows and rich link metadata into `fields`; supply a complete source reference. Retain original date values and map to ISO only after an explicit source date format is known. Invalid or ambiguous source dates remain DQ.
2. Resolve identities through the existing authoritative data ownership route. Ambiguous name/spec matches are not auto-merged.
3. Explicitly reconcile primary prices with note/continuation evidence. Choosing `tierNotes` must not silently discard conflicting `priceText` or another source's quote; set unresolved evidence and retain both.
4. Preserve separate source offers/observations. Do not choose the first/latest row as approval. Procurement resolves conflicting offers and one Tier is adopted per scenario line.
5. Use parsed `priceBasisQuantity` and `priceUnit` when converting to calculator unit price. Never treat `1400/25kg` as 1400/kg.
6. Preserve proposed/withdrawn records and DQ resolutions in append-only history; absence from a new current generation removes current availability, not historical quotations.

## Storage adapter contract

`withLock(fn)` serializes refresh. `current()` returns the prior successful generation. `stage(generation)` writes an isolated immutable candidate; `readStage(id)` reads it back. `commit(id, expectedPreviousId)` must atomically verify the old pointer, retain append-only observations/version history, and advance the pointer once. A rejected/failed commit must leave the previous pointer intact. A storage implementation that clears or overwrites active tables fails this contract. Google Sheets multi-range writes are not intrinsically transactional; the adapter must implement an immutable generation plus protected pointer protocol and prove recovery before deployment.

`failure(event)` writes a sanitized attempt failure with previous-success reference. The service must show failed/stale status and apply a defined freshness gate. If failure logging also fails, surface the error; never interpret unavailable status as healthy. This core intentionally does not claim a 30-minute refresh or manufacture an ACTIVE status.

## Verification and rollback

Command: `node --test 'cost calculator by project/tests/rm-data.test.js'` from repository root, or `node --test tests/rm-data.test.js` from project directory.

Result: 18/18 passing synthetic tests. Initial 10 tests failed with missing core before implementation; subsequent timestamp/order-increment, conditional-scope and spec-acceptance regressions failed before correction. A missing-identity DQ JSON-roundtrip regression also failed before correction. Added checks prove historical generations survive source edits/removal, staged loss prevents commit, and commit conflicts preserve previous success.

Security/permission impact: explicit authorization and protected-store contracts added in local code; no live IAM changes. Database impact: no schema/migration. Dependency impact: none. Rollback: remove these new local files or revert their eventual commit; no production state was modified. Open risks: real source mapping, persistent confirmation/history, live account permissions, currentness/freshness rules, and integration/UAT are still required.

Independent-review regression: future-dated Procurement confirmation and later RD spec acceptance now fail current eligibility/confirmation. Reproduced failing before correction; timestamp comparisons use parsed UTC instants.
