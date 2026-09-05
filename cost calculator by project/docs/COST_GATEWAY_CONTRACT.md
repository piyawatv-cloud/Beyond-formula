# Cost Calculator — client/gateway contract reconciliation

> **สถานะ: SUPERSEDED สำหรับ Cost Calculator (2026-09-05).** System Owner เลือกสถาปัตยกรรม local-first เต็มรูปแบบ ไม่ใช้ Supabase เป็นผู้ตัดสินสิทธิ์ — ดู [ADR 0002](adr/0002-local-first-cost-calculator-without-server-enforcement.md) เอกสารนี้อธิบาย gateway ที่ calculator **ไม่คุยด้วยแล้ว** เก็บไว้เป็นทางเลือกที่ผ่านการตรวจแล้วสำหรับ server-enforced segregation ในอนาคต migration และ SQL test ที่อ้างถึงยังคงอยู่และยังต้องผ่าน ส่วนการแยกสิทธิ์ที่บรรยายไว้ใน §3 และ §5 **ไม่มีผลบังคับในโหมดปัจจุบัน**

Status: LOCAL_VERIFIED / INTEGRATION_BLOCKED. This document reconciles the browser `cost-v1` client in `index.html` against the local additive migration `supabase/migrations/20260905140000_cost_gateway_contract.sql`. The gateway remains default-deny and was not enabled anywhere outside the synthetic SQL test database. No production schema, grant, secret or record was touched.

Task labels: P02–P04, P20–P23 (local plan labels). Issue/PR: none assigned. Reviewer for Critical Change: CODEOWNER `@phossatron` or a formally appointed substitute. The author cannot final-approve.

Line references are to the current branch state, not to deployed state.

## 1. Transport shape

The client posts JSON to a service that does not exist yet:

- `index.html:1353` — `POST {COST_API_ORIGIN}/v1/cost/{action}`, bearer `authSession.access_token`, body `{...extra, projectId, scenarioId, expectedRevision}`.
- The migration exposes PostgREST-style RPCs instead: `public.fs_cost_open/fs_cost_save/fs_cost_send_summary/fs_cost_approve`.

So `/v1/cost/*` is a **required trusted service layer** between the browser and the RPCs, not a thin proxy. Its obligations are listed in §2 and §3. `COST_API_ORIGIN` is `''` (`index.html:1313`) and `costRequest` throws before any network call, so nothing in this contract is live.

## 2. Action-by-action coverage

| Client action | Server counterpart | State |
| --- | --- | --- |
| `open` | `fs_cost_open(p_project_id,p_scenario_id,p_revision)` | **Partial.** Works only for an exact `(scenario, revision)`. See §2.1. |
| `save` | `fs_cost_save(p_project_id,p_scenario_id,p_expected_revision,p_patch)` | Matches. `expectedRevision` → `p_expected_revision`; `patch` → `p_patch`. |
| `selectRM` | none | **Missing.** No RPC adds a catalog offer to a scenario. |
| `removeRM` | none | **Missing.** Removal is only expressible as a full `lines` patch through `save`. |
| `requestMaterial` | none | **Missing.** No sourcing-request queue exists in the migration. |
| `adoptPK` | none | **Missing.** PK adoption lives only in the synthetic `PkAdapter`. |
| `sendSummary` | `fs_cost_send_summary(...,p_idempotency_key)` | Matches. Client key `projectId:scenarioId:revision:summary` satisfies the server regex and length bound. |
| none | `fs_cost_approve(...)` | **No client caller.** Fail-closed with `CEO_AUTHORITY_NOT_CONFIGURED` (`migration:305`). |

`catalog` is hard-coded `'[]'::jsonb` in `fs_cost_open`, so **RM search, comparison and selection cannot function against this gateway at all**. The calculator's RM workflow is currently backed only by the synthetic browser fixture.

### 2.1 Fresh `open` has no server counterpart

On the first open of a project, `costState.response` and `costState.route` are both null, so `costAction` sends `scenarioId: null, expectedRevision: null`. `fs_cost_open` rejects both with `INVALID_COST_IDENTITY`. The primary entry path is therefore unimplemented. Both values are pinned by client tests so the service-layer input contract cannot drift silently.

**Reconciliation direction:** do not relax the RPC's identity check. Project → scenario → latest-revision resolution belongs to the `/v1/cost/open` service layer, which must:

1. Authorize the caller for the project before resolving anything.
2. Resolve the caller's current scenario and its highest revision, or create the first draft through `fs_cost_save(project, scenario, null, patch)`.
3. Call `fs_cost_open` with the resolved exact triple and return its result unchanged.

Resolution must never be inferred client-side; the browser has no authority to name a scenario.

### 2.2 `viewRevision` is required by the client and granted to nobody

`costValidateResponse` (`index.html:1358`) requires `capabilities.viewRevision === true` whenever an exact revision is requested — that is, for every Formula deep link. `fs_cost_capabilities` now emits `viewRevision` explicitly as `false` for **every** mapped role (`migration:97–120`).

This is deliberate and is the stricter reconciliation: *which role may view an arbitrary historical revision* is an unmapped capability decision (§3). Until an owner approves it, deep-link open is **inert against this gateway** — the client rejects the response and shows a mismatch error. The client check must not be weakened to make the two line up; that would be a security regression disguised as a contract fix.

### 2.3 Response fields the client reads but the gateway never emits

`pkNotice`, `pkCandidate.{versionLabel,snapshotRef}`, `sendState`, `inputs.fillUnit`, `line.{unit,baseTotal,purchaseCash,leftoverExposure}`, `view[key].baseTotal`.

All degrade safely today: the PK adoption button and the per-category base-cost line are hidden when the field is absent, and `sendState` falls back to “ยังไม่ได้ส่ง”. But `private.fs_cost_scenarios.raw_rm` is unconstrained `jsonb`, so the line shape a trusted writer must produce is not pinned anywhere. Before a trusted calculator writes `raw_rm`, pin:

```
raw_rm.lines[] = { id, alias, unit, amount, lossPercent,
                   baseTotal, purchaseCash, leftoverExposure }
```

`baseTotal`/`purchaseCash`/`leftoverExposure` are raw-category values and are correctly reachable only through the `rawRM` path (`migration:219`), never through `safe_view`.

## 3. Capability matrix

The `fs_memberships` role check (`supabase/schema.sql:56`) allows exactly `admin, pd, ra, rd, sales, opc, mkt, purchasing`. **Four of the seven business roles this feature needs do not exist as role values at all.** No new role value was invented here.

| Business role | Schema role today | Gateway capability today | Blocker |
| --- | --- | --- | --- |
| RD | `rd` | open, editRM, adoptPK, sendSummary; raw RM only | Not project-scoped (§3.1) |
| Procurement RM | — (`purchasing` is generic) | open + safe projection only; **no raw category** | No RM-vs-PK capability split exists |
| PU-PK | — (`purchasing` is generic) | open + safe projection only; **no raw category** | Same generic role as Procurement RM |
| Production | — | denied (`open:false`) | No `production` role value |
| Cost Accounting / Finance | — | denied (`open:false`) | No `finance` role value; before-markup totals ungranted |
| CEO | — | denied; `fs_cost_approve` fail-closed | No CEO authority contract |
| Sales / OPC | `sales`, `opc` | open + safe projection; sales is owner-scoped | Legacy raw read paths still open (§4) |

**Guard.** A capability snapshot test pins the exact capability object for every role value the `fs_memberships` role check allows. It reads the permitted role values out of the check constraint with `pg_get_constraintdef` rather than repeating them, so a role added to the schema and not to the snapshot fails the suite by name. Granting an existing capability, adding a new capability key, or introducing a new role value therefore cannot land without updating that table deliberately. All three paths were mutation-tested: granting `rd` a `viewRevision` is caught, adding a `rawPkView` key to `purchasing` is caught with an expected-versus-got diff, and dropping `mkt` from the snapshot fails with `schema role values missing from the capability snapshot: mkt`.

**Client-side entry gate.** `costAllowed` checks `can('chat') && canSeeRecord(...)` and `openCostCalculator` calls `requirePerm('chat', ...)` (`index.html:1342`, `:1365`), so the browser entry point to the calculator is currently the **legacy chat permission**, not any cost capability. That is a fail-closed placeholder rather than the real gate — `COST_API_ORIGIN` is empty and every capability decision is made server-side by `fs_cost_capabilities` — but it means CLAUDE.md rule 8's three-layer requirement is satisfied by the RPCs, not by the client. Replace this gate as part of the capability mapping above.

Splitting `purchasing` into Procurement RM and PU-PK, and adding Production / Finance / CEO, are **Critical Changes** requiring owner approval and independent review. Until then the generic `purchasing` role deliberately receives no raw category — a wrong guess would hand PU-PK the RM supplier prices it must never see, or the reverse.

**Trapdoor closed this round.** `fs_cost_open` previously read `if r in ('admin','production','finance','ceo') then ... rawOperation`. Those role names cannot exist yet, so the branch was unreachable — but adding any one of them during the capability mapping above would have shipped raw Operation JSON as a silent side effect, with no separate review. Raw Operation is now on the reviewed `admin` path only (`migration:225`), with a comment stating why the list must not be restored.

### 3.1 Project scoping is only implemented for Sales

`fs_cost_capabilities` scopes `sales` to records where the caller is `createdBy` or `salesOwner` (`migration:105–110`). `admin`, `rd` and `purchasing` are scoped only by *active membership plus project existence*: any RD may open any project that has a scenario row, and receive its raw RM.

The security contract requires default-deny on missing project authorization. Closing this needs a per-project assignment field that **does not exist** in the locked `fs_records` shape (`createdBy` and `salesOwner` are Sales-side fields). This is recorded as a blocker rather than guessed at; inventing an RD-assignment field would be a locked-schema change.

## 4. Client and cache transition plan

The governing rule: **a redacted projection must never be written back over an authoritative Formula record.**

Today `sbPull` reads `fs_records?select=id,data` and maps full JSON into `records[]`, which `saveRecordsStore()` persists to `localStorage.fs_records` and `fs_sync_snapshot`. A projection returned by a future read RPC has the same outward shape but omits fields. If it entered that path, the omitted fields would be erased from the local store and could be pushed back as a full-object upsert.

Ordered, reversible steps:

1. **Tag projections at the boundary.** Every projection response carries an explicit marker (e.g. `contract:'cost-v1'`, already present). `records[]` entries derived from a projection must be held in a separate structure, never merged into the full-record array.
2. **Make the write path refuse partial objects.** Secure-mode record writes move from full-object upsert to a patch RPC with server-side merge, per-field write capability and expected version. `private.fs_guard_record_json` (`schema.sql:169`) must be aligned to that patch boundary and must not be loosened to make sync pass.
3. **Version the local cache.** Bump the sync-snapshot marker so a client that has cached full records under the old contract discards them rather than diffing them against projections. Locked keys `fs_records`/`fs_reccounter`/`fs_chats` keep their names and types; only cache freshness metadata is added.
4. **Refuse stale clients server-side.** An old client that still issues full-object upserts must be rejected by the API, not silently allowed. Server access control cannot retract copies a user already holds, so this step gates any confidentiality claim.
5. **Revoke legacy raw grants last.** `fs_records`/`fs_chats` member SELECT stays until steps 1–4 ship and are verified. Revoking earlier breaks the working app; revoking never leaves the disclosure open. Rollback disables the calculator feature and must **not** restore broad raw reads.

Steps 2–5 are not implemented. The calculator writes nothing into `fs_records`, `fs_chats` or `localStorage` today, which is what keeps the current state safe.

## 5. Confidentiality verification (safe projection)

`private.fs_cost_view_projection` (`migration:148`) is a fixed allowlist: it rebuilds the object field by field and maps `pending[]` through a closed Thai vocabulary, discarding any unrecognised entry. Arbitrary nested source data cannot survive it into `safe_view`.

Scope of the guarantees below: they cover every response reachable **without** the `editRM` capability. `fs_cost_open` additionally returns `inputs` verbatim and `lines` merged from `raw_rm` to `admin`/`rd` only (`migration:216–218`); those are raw-side paths by design, gated on `editRM`, and are not claimed to be allowlisted.

Verified by SQL test against a seeded row whose `label`, `pending[]`, `raw_rm`, `raw_pk` and `raw_operation` all contain secret markers:

| Must not leak | Result |
| --- | --- |
| Supplier name | Not present for `sales`, `opc`, `purchasing`; `SUPPLIER_SECRET` reaches `rd` only through the separate `rawRM` key |
| Supplier price | Same boundary; never in `safe_view` or the outbox body |
| Full raw material name | `lines` is `[]` for every role without `editRM` |
| Nested raw JSON | Allowlist rebuild discards unknown keys; `source_digest` is never returned |
| Source document | No source reference field appears in any projection reachable without `editRM`; `source_digest` is never returned at all |
| Category base cost | `view[key].baseTotal` is never emitted; the client renders that line only when the key is present |

RD is additionally denied `rawPK` and `rawOperation`; `purchasing` is denied all three; unmapped roles (`pd`, `ra`, `mkt`) fail closed; the private scenario store is unreadable to the `authenticated` role directly.

## 6. Immutability verification

`fs_cost_save` is insert-only into `(project_id, scenario_id, revision)`; no UPDATE path to a stored revision exists in the migration.

- Editing an outdated revision now raises `COST_STALE_REVISION` explicitly. Previously the insert only collided on the primary key, which reached the client as the generic “ยังทำรายการไม่สำเร็จ กรุณาลองใหม่” retry message rather than a stale-view message.
- An approved snapshot seeded in `private.fs_cost_approvals` stays byte-stable across a later `fs_cost_save` **and** across a change to the underlying `raw_rm`/`raw_pk`/`source_digest` of the revision it approved.
- Reusing one idempotency key with changed content raises `COST_SUMMARY_IDEMPOTENCY_CONFLICT` instead of returning the earlier receipt for the newer revision. A queued summary reports `pending` with a null receipt; it is never reported as delivered.

Changed **PK terms** and changed **spec/packaging conditions** have no server representation in this migration — there is no PK snapshot or packaging-requirement table. Those negatives are covered at the domain layer by `PkAdapter`/`CostWorkflow` module tests and remain **blocked** at the server layer until the PK source mapping in `PK_SOURCE_MAPPING.md` is verified.

## 7. Open blockers

1. `/v1/cost/*` trusted service layer does not exist; `open` resolution, `selectRM`, `removeRM`, `requestMaterial` and `adoptPK` have no server implementation.
2. Procurement RM vs PU-PK capability split, and `production`/`finance`/`ceo` role values, are unmapped. CEO approval authority is undefined.
3. Historical-revision view capability (`viewRevision`) is unassigned, so Formula deep links cannot open.
4. Project-level authorization is implemented for `sales` only.
5. Legacy `fs_records`/`fs_chats` raw member SELECT remains open pending the §4 transition.
6. PK source semantics (`APPROVED` label, supersession, consumed base) remain unverified — see `PK_SOURCE_MAPPING.md`.
7. No Issue/PR, no independent CODEOWNER or security review, no UAT, no deployment.

Test-maintenance note: the pre-existing block in `tests/sql/cost_gateway_test.sql` ends with a deliberate `COST_PATCH_FIELDS_REJECTED`, which aborts its enclosing transaction. Its revision-2/3 assertions run and pass, but the resulting rows are rolled back at `commit`. That is not a false pass, but it makes the file order-fragile: any later test that assumes revisions 2–3 exist will fail confusingly. The negatives added in §6 build their own committed state for this reason.
