# PU-PK source mapping review — partial evidence, no live activation

## Follow-up 2026-09-08 — requested steps 1–4

Current workbook metadata/header-only inspection confirms PU_Pricing_History has 59 headers, including Snapshot_ID, Req-PK No, Source_Quote_ID, SelectedSellingTotal, QuoteEffectiveCost, RevisionNo and RevisionStatus. Also inspected headers of PK_Quote_Data, Incoming_ReqPK, PO_Price_Reference and PO_Price_Summary. Existing PO_Price_Reference already has Item_Code, UOM, Unit_Price, Receipt_Qty, Receipt_Value, PO_No and Receipt_Voucher_No; reuse it when its synchronization/status semantics are verified. No new PO master/sheet is justified. No business rows, current formulas, secrets or source script were read this round. Earlier source-level findings below remain partial, not a current code audit.

Local implementation now adds optional source request/quote/snapshot/revision references to the existing PU-PK confirmation entry. UI shows current quantity/pack/spec and requires an explicit confirmation to use the entered result for an estimate. Amount entry remains manual; no physical SelectedSellingTotal or QuoteEffectiveCost mapper is enabled. User-entered provenance is not authenticated source confirmation. Legacy manual records remain supported without fabricated source IDs.

Local receipt retry with identical source/content is idempotent. Same source identity with changed scope/amount/evidence is rejected. Ordering checks apply within the same request+quote stream; a different quote may have its own source revision sequence. This is a local guard, not proof of the source's revision semantics. The local sequence stays separate from source revision. A later result becomes a candidate without automatically adopting it, changing the formula or overwriting prior snapshots. Failed persistence rolls back the in-memory append. Closed jobs and stale submitted calculator revisions are rejected. Negative/nonfinite provided totals are rejected; unknown base stays null.

Read-only IN preview is available inside the calculator only to existing procurement capabilities (recordPK or confirmOffer), with no new grants. Paste a bounded tab-separated range with Qty/UOM/Price/Unit Cost headers, up to 1,000 data rows. It checks per-row decimal arithmetic exactly and displays THB with comma grouping/two decimals, including a warning if a nonzero difference rounds to 0.00. Zero/negative quantities, missing values, malformed numbers or missing UOM remain pending. It neither sums inventory nor matches PO nor stores/publishes the pasted data. Every result retains PO evidence pending. Permission gates cover control rendering, preview handler and checking entrypoint; no direct source read is exposed.

Browser tests uncovered and fixed two existing interaction defects: ordinary refresh after PU-PK confirmation requested historical access; hidden pricing-page fields contaminated calculator draft detection and blocked RD adoption. Explicit historical access remains restricted, and calculator draft collection now excludes fields outside its own panel.

Still required before seamless direct retrieval: current sanitized source implementation inside the allowed worktree, verified source context/amount/component/currentness mapping, reviewed authenticated read transport and operator installation. No endpoint, live sheet confirmation button, PO scan extraction or MRP engine was deployed or implied by this local implementation. Source-level request has been sent to the owner; PO scan link remains intentionally deferred.

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
