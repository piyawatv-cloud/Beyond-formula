# PK adapter — synthetic integration evidence

2026-09-05. Local preparation for P18–P19. No live PU-PK mapping, formulas, statuses, permissions, callbacks or delivery were verified by this implementation. Historical audit and live P18 remain open.

`apps_script/PkAdapter.gs` provides `PkAdapter.receive(sourceResult, expectedContext, verifiedMapping, storage, nowUTC)`. It is deliberately restricted to `mode: 'synthetic-only'`. A trusted injected mapping must supply a verification evidence reference, a normalizer, and separate confirmation/spec-acceptance verification callbacks. No mapping or confirmation is inferred from a column called Status, CurrentPricingRevisionID, Snapshot_ID or approval. The callbacks are test dependency boundaries, not proof of live identity or an authorization solution.

The normalized envelope is a domain test contract, not a new PU-PK sheet schema. It requires:

- Immutable snapshot ID and positive version; request identity.
- Exact project/scenario/requirement identity and requirement revision, selling quantity, pack units, fill amount/unit, packaging spec version and required component IDs.
- Complete selected components, each with one item/Tier, quantity/unit and evidence reference. Missing, extra or duplicate components reject the entire envelope.
- Explicit draft/confirmed status; validity dates, THB currency, lot-total basis, nullable source-calculated base total and nullable adjusted total. This adapter never recomputes PK MOQ/loss/markup, never sums supplier prices into a new pricing engine and never substitutes base total for absent adjusted total.
- Confirmed envelopes additionally require Procurement actor/time/snapshot/version/evidence and verified RD spec acceptance bound to spec and requirement revision. Neither confirmation nor spec acceptance may be in the future; spec acceptance must precede commercial confirmation.

The output is `AVAILABLE` or `DUPLICATE`, with `autoAdopt: false`. The candidate includes a `coreSnapshot` compatible with the current `CostCalculator.adoptPK` shape and carries `syntheticOnly: true`. Transport availability does not approve, adopt, revise or write any scenario. A new negotiation result creates a new available snapshot, leaving the previous result and scenario intact. Adopting it is a separate explicit calculator operation.

The injected `storage.transaction(fn)` must serialize `get(id)` and insert-if-absent `append(candidate)` durably. Duplicate ID with identical canonical content is idempotent. The same snapshot ID with changed content is rejected even if a version was changed; the verified source mapper must issue immutable identities for each emitted result. If the real source reuses IDs, its separate pricing revision must be incorporated by the reviewed mapper before use; no meaning is guessed here. Store failures throw and never report availability. History is append-only; there is no delete/update or active-scenario operation. Exact-context mismatch rejects late results before storage; quarantine/re-request handling belongs to a future service adapter.

The stored canonical fingerprint and full envelope contain protected commercial details. Keep them server-side in the future integration; only role-filtered DTOs may reach calculator clients, chat or exports. `syntheticOnly` must remain a deployment gate; passing these tests cannot make a record live-ready.

Verification: `node --test 'cost calculator by project/tests/pk-adapter.test.js'` from repository root. **16/16 PASS**, including a test loading the actual calculator core from `index.html` and explicitly adopting a candidate while preserving the old scenario. Initial executable tests failed before module creation; additional coverage exercises future timestamps, null policy amounts and actual-core compatibility. No application source was edited by this subtask.

Files: `apps_script/PkAdapter.gs`, `tests/pk-adapter.test.js`, this document. No real Issue/PR assigned. No new dependencies, schema changes, live data reads/writes, permission changes or messages. Rollback removes these new files. Production requires reviewed physical source mapping, confirmation/auth evidence, protected persistent implementation, freshness/currentness/withdrawal handling, integrated disclosure tests, UAT and operator deployment of an approved release.

Independent-review correction: recursively reject unavailable flags (withdrawn, obsolete, stale, syncFailed, excluded, ambiguous, revoked, superseded) before mapping and again on the normalized envelope, including confirmation/spec-acceptance/component objects. This prevents a mapper dropping flags from producing a confirmed candidate. Two regression tests failed before the change; all adapter regressions pass. Raw source field names still require verified physical mapping; this does not interpret live source status strings.

Subsequent source review is now available in [PK_SOURCE_MAPPING.md](PK_SOURCE_MAPPING.md): save-time APPROVED is not commercial confirmation; effective quote cost includes recovered surplus and is not consumed base. The live mapper remains disabled because identity/spec/validity/confirmation and consumed-base semantics are unresolved.

Adjusted-only source support: explicit null base total is preserved, including after JSON storage roundtrip and actual calculator adoption. The actual core keeps PK readiness/final completeness false. NaN/Infinity are rejected before JSON copying so they cannot silently become null. Confirmation evidence remains mandatory for confirmed status; no live mapping enabled.
