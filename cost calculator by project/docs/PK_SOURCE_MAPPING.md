# PU-PK source mapping review — partial evidence, no live activation

Date: 2026-09-05. Evidence: root agent's read-only inspection of user-supplied Apps Script source, relayed to this implementation subtask. This document records verified function/field semantics and unresolved integration conditions without source identifiers, business rows, credentials, or full source reproduction. No live mapper was enabled and no spreadsheet or Apps Script was changed.

## What the source establishes

`PUPK_pricingHistoryRow_` writes `RevisionStatus: 'APPROVED'` when pricing is saved. This is a save-time history label, not proof of a separate commercial confirmation by an authenticated PU-PK user. `SelectedStatus` is a pricing-policy ladder outcome (`BLOCK`, `LOW_QTY_EXCEPTION`, `REVIEW`, `STANDARD`), not Procurement confirmation or CEO quotation approval.

Saving a new revision supersedes the previous history row. Economic fields are retained as history, but `RevisionStatus` of the earlier row is mutable. Therefore, a previously observed snapshot is not permanently usable merely because its monetary fields are unchanged. A live integration must re-evaluate withdrawal/supersession/currentness from verified source semantics while preserving an already adopted or approved quotation snapshot historically.

| Observed source field | Meaning supported by source inspection | Integration decision |
|---|---|---|
| `Snapshot_ID`, `RevisionNo`, `ParentRevision_ID` | Snapshot/revision lineage | Candidate identity inputs; uniqueness and immutable mapping still require verification |
| `Req-PK No`, `Source_Quote_ID` | Request and originating quote references | Keep lineage; neither establishes a stable Formula project/scenario/requirement ID |
| `Source_Fingerprint` | Source evidence fingerprint | Retain protected internally; do not treat it as an authentication proof |
| `SelectedSellingTotal` | Selected adjusted lot amount | Authoritative adjusted lot output candidate, subject to confirmed quantity, currency, policy and external confirmation scope |
| `SelectedRate` | Selected rate output | Do not substitute for the lot amount or assume its basis without checking |
| `CustomerQty`, `CustomerUnit` | Customer quantity and unit | Must be reconciled with Formula selling/pack quantities and requirement revision; names alone are insufficient |
| `SupplierCashOut` | Supplier cash measure | Keep separate from consumed cost |
| `QuoteEffectiveCost` | Technical quantity × quote supplier price, plus recovered surplus cost | Not pure consumed base cost; must not map directly to calculator PK consumed `baseTotal` |
| `SurplusCost`, `RecoveredSurplusCost`, `InventoryExposure` | Distinct surplus/recovery/exposure outputs | Preserve separate meanings; never silently add them again to a base already containing recovery |
| `ActualPurchaseUnitPrice` versus quote supplier price | Purchase and quoting bases may differ | Do not mix them or reconstruct consumed cost without explicit quantity/price basis ownership |

## Mapping decisions and blockers

1. `APPROVED` and policy outcomes must never become `status: confirmed` automatically. A reviewed external commercial confirmation event must bind an authorized PU-PK actor, timestamp, snapshot/version and evidence. RD spec suitability is separate.
2. Stable Formula project ID, scenario ID, packaging requirement revision, complete component membership, RD spec acceptance and term validity proof were not established by the inspected source. Until these are mapped and verified, context compatibility and quotation readiness remain blocked.
3. A future draft mapping can expose the correctly scoped adjusted lot amount after its amount/basis mapping is verified. It must remain explicitly pending confirmation until external evidence exists; no save-time label substitutes for that evidence.
4. Consumed PK base remains unknown until a consumed quantity × appropriate unit-price basis is established. `QuoteEffectiveCost` must not be used as a convenient replacement. Unknown base must not become zero. The synthetic adapter now accepts explicit null base total with a known adjusted amount, preserving null through storage and explicit adoption. An actual-calculator regression verifies PK readiness and final completeness stay false when consumed base is unknown. Confirmation still requires its evidence even for an adjusted-only record. This local contract support does not enable a live mapper or infer consumed cost.
5. Mutable supersession status needs separate availability/currentness evidence. An unchanged monetary snapshot can still become unavailable for a new ready quote. Approved quotation history remains immutable; availability for new use and historical reconstruction are different concerns.
6. Currentness and applicability must be checked as of receipt/adoption/quotation evaluation. A stale late reply cannot replace a newer packaging requirement, and transport availability cannot automatically adopt a negotiation result.

## Next verification required

- Prove snapshot identity uniqueness, revision lineage and source-status transition meanings using sanitized non-production fixtures.
- Establish explicit Formula project/scenario/requirement linkage, quantity/unit conversion and complete component boundaries.
- Identify actual commercial confirmation authority/event and RD spec-acceptance evidence; test revocation/supersession and expiry.
- Reconcile adjusted amount, consumed base, supplier cash, recovered surplus and exposure against source calculations without double counting. No inferred defaults or inherited policy approval.
- Implement a reviewed physical mapper and protected storage/auth/currentness adapter; execute non-production integration tests before proposing live activation.

Status: partial source review documented. Live P18/P19 are not complete. `PkAdapter` remains synthetic-only. Security/database/permission/dependency changes: none. Source calculations are not duplicated in the calculator. Rollback: remove this documentation change; no operational data was modified.
