# Security and version contract — implementation boundary review

Status: source review complete; proposed integration contract, not approved or deployed security enforcement.

Task labels: P01–P04, P20 (local plan labels, not GitHub Issues). Issue/PR: not assigned. Reviewed baseline: `3a9c32d17ef1626b7955ca9b0334ecd7a010b774`. Environment: isolated local worktree, repository source only; no network, credentials, production records or Sheet rows inspected. Reviewer for Critical Change: CODEOWNER `@phossatron` or formally appointed substitute; author cannot final approve. This review changes only this document.

## Source evidence

Line references are relative to the reviewed baseline, not deployed-state verification.

| Evidence | Finding and implication |
| --- | --- |
| `supabase/schema.sql:7`, `:12` | Records and chats retain full objects in `data jsonb`. Preserve locked keys, field names/types and existing data. |
| `supabase/schema.sql:362`, `:629` | Authenticated users have record SELECT; `records_member_select` checks only active membership. It returns full row JSON, not a role-safe projection. |
| `supabase/schema.sql:374`, `:643` | Chat event and chat SELECT also allow every active member. Historical message text is part of the exposure surface. |
| `index.html:6313` (`sbPull`) | Pulls `fs_records?select=id,data` and `fs_chats?select=job_id,data`, then maps full JSON into client objects. |
| `index.html:3921` (`visibleRecords`), `:3924` (`canSeeRecord`) | Own-record filtering is client-side. It does not restrict the underlying server response. |
| `index.html:3858` (`loadRecords`), `:3865` (`saveRecordsStore`), `:6205` onward | Local record and sync-snapshot caches are additional disclosure surfaces. A later UI change cannot retract information already cached. |
| `index.html:5116` (`chatIngEdit`) | Formula-change message and activity detail incorporate full ingredient names. |
| `index.html:5278` (`exportChatExcel`), `:5314` onward | OPC export permission currently leads to a workbook containing `x.name`, source/origin and formula rows. This conflicts with the newly agreed full-name restriction. |
| `supabase/schema.sql:381` (`fs_append_chat_event`) | Authenticated actor is derived on server; event ID provides basic idempotency. Job ID format is checked, but the RPC does not establish project-scoped access or verify project existence before creating a chat projection. |
| `supabase/schema.sql:428` onward | Message text is client-supplied; the existing RPC is not a trusted cost-summary generator. Existing-event replay checks job equality, not payload equality or original actor equality. |
| `supabase/schema.sql:438` onward | Chat approval keys are `pd`, `ra`, `rd`, `sales`. They are not Procurement commercial confirmation or CEO quotation approval. |
| `supabase/schema.sql:52` onward | Membership role enum has no distinct RM buyer, PK buyer, Production, Finance or CEO capabilities. Do not equate existing admin with those business permissions. |

**Conclusion:** hiding columns, filtering exports in a browser, or adding optional JSON fields cannot satisfy the agreed confidentiality controls while these broad read paths remain. Secure segregation requires a reviewed trusted read/write boundary and changes to grants/policies/API behavior. Physical legacy object shape can be retained, but compatibility of old clients must be explicitly managed. This is a Critical Change even if no locked field is renamed.

## Minimum logical contract

The following are semantic fields for a proposed separate calculator contract, not additions made to locked Formula storage. Names/storage destination require approval. Formula remains the authority for `projectId`; do not create another project master.

- Scenario identity, immutable revision identity, previous revision reference, Formula project reference and source-formula revision/fingerprint. Keep formula identity, revision identity and commercial-offer version distinct.
- Every material line pins material/spec identity and one immutable commercial-offer version containing its linked Tier, price/unit, MOQ/unit, order increment, LT, validity and scope. Never derive a confirmed version from the latest mutable Sheet row alone.
- PK request identity and request version pin packaging spec, sale quantity, units, pack hierarchy and other applicable constraints. A PK response contains source snapshot identity/version, exact request reference, component completeness and confirmation state. Hash/fingerprint equality supplements these fields; it is not evidence of approval.
- Confirmation records bind authenticated actor/capability, server timestamp, evidence reference, exact content version and validity/scope. Corrections create another version; expiry/withdrawal are explicit events. A client boolean or typed name cannot confer confirmation.
- A scenario's PK adoption explicitly pins a compatible snapshot; a new PK response never overwrites an existing adopted revision. RM-only edits can reuse PK if applicability and validity still match. Unconfirmed snapshots may be referenced by drafts only.
- Persist changes with expected previous revision/version. Duplicate same-ID/same-content delivery is idempotent; reused ID with different project, actor or content rejects; stale responses remain history and never replace a current selection silently.
- An approved quotation snapshot pins all input versions, policy versions, quantities, derived totals and approver evidence. Revocation/expiry blocks new ready-to-offer use while preserving the historical approval and its numbers.

## Trusted access boundary

Default deny for unknown capability, missing project authorization or unverified source state. Derive actor/capabilities on a trusted service, not from role selectors, localStorage, impersonation display names or request body. Check access on every read, adoption, confirmation, summary send and approval action.

| Audience/capability | Permitted business projection |
| --- | --- |
| RD | RM commercial detail needed for formula selection; packaging specification and adjusted PK totals only; adjusted Operation totals only. |
| Procurement RM | RM commercial confirmation/detail; other categories only adjusted amounts as authorized. |
| PU-PK | PK commercial selection/detail/confirmation; other categories only adjusted amounts as authorized. |
| Production | Operation inputs/costs according to assigned responsibilities; other categories only authorized projections. |
| Finance/CEO | All-category before-markup totals only when explicitly granted; broader supplier evidence access must be separately authorized. |
| Sales/OPC | Approved disclosure names or neutral placeholders, adjusted category totals/overall totals, units, quantities, revision, missing-state labels and authorized links. No supplier identities, raw supplier prices, full material names, raw-line costs or evidence documents. |

Cross-category raw totals, purchase cash and leftover amounts can reveal protected prices by subtraction/division. Do not publish these alongside other reconstructable amounts to restricted roles. Missing markup policy yields `awaiting_price`, never raw-cost fallback or zero markup. A restricted summary must not contain the full source object even in invisible fields, logs or links.

Server responses must be allowlisted projections before browser receipt. Do not put restricted cost documents into current universally readable `fs_records`, `fs_chats` or event JSON. Existing Formula full-name reads and old message/export paths must be addressed before claiming end-to-end confidentiality. Preserve audit evidence in a restricted authoritative location rather than delete history. Existing cache transition, backward-compatible readers and writes from old clients require staged migration tests; never sync a partial redacted record back over a full authoritative record.

## Fail-closed adapter behavior

### Smallest compatible migration candidate (implemented locally, disabled)

It is technically feasible to retain the existing physical tables and locked JSON fields while introducing projection RPCs. The local migration at `supabase/migrations/20260905140000_cost_gateway_contract.sql` implements this additive shape: fixed empty search paths, authenticated identity checks, narrowly granted execution, a default-off owner-controlled gate, role-filtered responses and server-owned projection fields. The gate key has an admin-only trigger because the legacy `fs_meta` policies are broader than this feature. Generic `purchasing` is safe-only until RM versus PU-PK capability mapping is approved.

1. Add reviewed read RPCs for records and chat history/events; revoke browser direct raw SELECT on those tables and remove corresponding broad policies. Preserve raw historical records as authoritative evidence under restricted access.
2. Change `sbPull` and related read callers to consume the correct projection. A projection is not a full authoritative record. Tag/segregate projection cache state and prevent it from entering full-record sync writes. Support old local-only fixtures without permitting old secure-mode clients to bypass the new API.
3. Replace secure-mode full-object record upsert/delete with authorized patch RPCs using server-side merge, per-field write capability and expected version. Direct UPSERT/UPDATE is not safely preserved simply by revoking SELECT: it may need SELECT privileges for referenced/returned fields, and redacted whole JSON would erase omitted private fields. The existing `private.fs_guard_record_json` allows broad sales/OPC/marketing object updates (`schema.sql:169` onward); its guard/write policy must align with the new patch boundary. Do not loosen that trigger just to make sync pass.
4. Tighten `fs_append_chat_event`, `fs_mark_chat_seen` and any chat-delete access for project/capability scope. Add an exact-revision cost-summary endpoint, and separate CEO/cost confirmation capabilities from legacy PD/RA/RD/Sales approvals. Restrict legacy free text and event history to an authorized audience or return safe reviewed projections; do not assume removing known price keys makes arbitrary text safe.
5. Review activity/meta/read/event grants and all exported response paths for secondary leaks. Retain raw audit evidence; neither a destructive chat cleanup nor silent rewriting of historical evidence is an acceptable confidentiality fix.
6. Coordinate backend access changes, compatible client release, stale-client refusal and cache transition in a reviewed rollout. Server access control cannot retract copies a user already possessed. Migration rollback must disable affected features rather than reopen raw reads.

This local migration preserves physical storage shape, but changes authorization and API compatibility. It still needs System Owner contract review, independent security review and staging evidence. Keeping the cost gateway disabled until the client/cache transition and capability mapping exist is the smaller immediately safe action. Local synthetic calculation/projection tests cannot close this integration gate.

Local modules can deterministically validate units, totals, immutable snapshots, applicability, transitions, redacted projections and retry state with synthetic fixtures. They can demonstrate intended logic, not authenticate a real purchaser, secure a shared Sheet, confirm current validity or enforce remote grants.

A real adapter must remain disabled until approved backend/source configuration exists. Reject malformed IDs/units, unknown source status, mismatched project/request/spec/quantity, incomplete components, conflicting versions and expired/withdrawn confirmation. Missing PK remains pending without stopping RM work. Do not manufacture `confirmed` from email replies, an outbox row, a timestamp, or a column heading.

For project chat, accept a revision reference and idempotency key at a trusted endpoint, authorize the sender/project, generate the safe projection from that revision, and append it exactly once. Transport error or timeout remains pending/unknown until receipt lookup; never display “sent” from local enqueue alone. Reopened links recheck authorization. Existing `fs_append_chat_event` may remain underlying transport only after required review; its current free-text interface alone is not this contract.

## PU-PK source availability

Repository-scoped `rg --files --hidden -g '*.gs'` found no Apps Script source in this worktree. PK workflow trial documentation exists, but does not establish actual Sheet equations/status transitions. The named source columns from earlier metadata review are candidate mapping inputs only. P04 remains blocked on approved PU-PK source/formula/status evidence and synthetic or sanitized fixtures. No attempt was made to inspect excluded archives or production data.

## Acceptance before integration can be called complete

1. Old Formula fixtures load without renamed keys/types or clearing stores; partial projections cannot overwrite authoritative records. Approved snapshots remain byte-stable after source updates.
2. Authenticated synthetic accounts exercise raw REST/RPC requests, not just UI checks. Sales/OPC cannot obtain forbidden fields through records, chat/events, activities, exports, print, cache or error payloads. Cross-project requests and forged capabilities fail.
3. RD cannot retrieve raw PK/Operation prices and PU-PK cannot retrieve raw RM prices; totals do not permit simple subtraction/division reconstruction. Unknown roles fail closed.
4. Forged confirmation, unauthorized CEO approval, replay across jobs/actors, reused event IDs with changed content, stale expected revisions and malformed source statuses reject on the trusted server.
5. PK pending does not block formula/RM drafts; negotiation creates versions; acceptance is explicit; quantity/spec change invalidates reuse; RM-only change reuses eligible confirmed PK; expired/withdrawn data cannot produce a new ready quotation.
6. Retry sends one safe message in the correct synthetic project with exact revision reference; failed/unknown sends remain visibly unresolved. No messages are sent to real people in this review.
7. Actual PU-PK equations and units reconcile against independent expected results before real adapters are enabled. Approval semantics are traced to code, not inferred from headings.
8. Owner approves version/storage and capability mapping; independent Security/Platform/CODEOWNER review and non-production migration checks precede UAT/release. Runtime Operator performs any later approved deployment. Codex does not self-approve or deploy.

## Outstanding gates and rollback

P02/P03 have a reviewable logical proposal, not approved architecture. P04 source evidence and P20 trusted enforcement remain open. P01 real Issue/reviewer assignment remains the root task's responsibility. A local synthetic implementation can proceed against this interface without asserting these gates passed. Production integration requires an approved, backward-compatible, idempotent migration/access plan and real backend negative tests. Restoring broad reads as a rollback would restore the confidentiality defect; safe rollout must support disabling the new feature without reopening forbidden access.

Review checks: repository source searches and targeted reads only; no application/security runtime tests executed by this review. Security/database/permission/dependency runtime impact: none. Rollback for this contribution: remove this new document. Residual risk: deployed state unverified, existing read paths conflict with requested segregation, PU-PK source unavailable. PR reference: none.

## Contract reconciliation addendum — 2026-09-05

The client/gateway reconciliation, the capability matrix against the actual `fs_memberships` role check, the ordered client/cache transition steps, and the confidentiality and immutability verification results are recorded in [gateway contract](COST_GATEWAY_CONTRACT.md). Three items in this document are now narrowed by that round: raw Operation disclosure is restricted to the reviewed `admin` path, `viewRevision` is emitted as an explicit deny for every mapped role, and stale-revision edits fail with an explicit error. Acceptance items 1–8 above remain open.

## Source-access addendum — later in the same implementation session

The user subsequently supplied the PU-PK Apps Script editor link. The root agent opened it read-only and inspected pricing, quote-service and webapp source. The earlier source-absence statement above is historical. See PK_SOURCE_MAPPING.md and IMPLEMENTATION_EXECUTION.md for verified status and cost semantics. Trusted integration and final security approval remain open.
