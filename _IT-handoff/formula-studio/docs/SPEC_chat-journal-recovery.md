# Chat quota preservation — additive journal and recovery readers (2026-10-19)

Task `incident-20261019-chat-quota-preservation`, Tasks 1–3 are locally implemented candidates. Task 3 independent review found an unbounded preservation barrier; its focused correction is retained. Final whole-branch findings cover older-page sending, ordinary trusted-role recovery, native document readiness, and slow full-history startup. Their local correction and failed/passing evidence are recorded in the final-fix report. The completed mandatory-browser candidate run passes 955/955; scoped independent review, release and actual-user acceptance remain pending. No Issue ID supplied.
This branch is based on approved PR #87 commit
`baa2ec3e789aef4d3b8cb55990d5f97d81868642`. Current local corrections to that baseline are
described below. The section below records an older rollback
candidate; its statements about omitted gateway features do not describe the
current branch.

## Shared durable local evidence

`/fs-chat-journal.js` exposes `window.__fsChatJournal` version 1. The separate
IndexedDB database is `fs_chat_fallback_v1`, version 1, store `entries` with
key path `id`. This is a new additive browser storage contract; it does not
upgrade the existing job or seen databases, change localStorage keys or payloads,
or change authoritative PostgreSQL, session identity, canonical hashes or UID rules.

The exact public API is:

- `load(): Promise<Snapshot>` and `snapshot(): Promise<Snapshot>` read a completed
  transaction. Opening an absent database aborts its initial upgrade and returns
  verified empty data without creating a persistent empty database. An existing
  unreadable or incompatible database fails closed. Compatibility also requires
  store `entries` to use exactly `keyPath:'id'` and `autoIncrement:false`. A
  mismatch closes the handle and rejects with static `chat-journal-schema`
  before any write; the adapter never repairs or upgrades that database.
  `load()` publishes the controller's verified synchronous index. `snapshot()`
  is an observational read on the same bounded serial queue: it returns freshly
  scanned/decoded defensive copies, but neither closes a previously verified
  index merely by starting nor publishes/reopens that index on success. Its
  failure or versionchange still closes the index. This replaces C1's historical
  `snapshot=load` alias; the API signature, snapshot shape and database bytes are
  unchanged. Controller evidence remains verified as of its own last successful
  load/write, never described as refreshed by an independent reader.
  An owner `load()` also retains a previously completed verified index while its
  readonly scan is in flight. `status().state==='ready'` means completed evidence
  exists as of the last successful owner operation, not that an in-flight read
  is complete or that absence is freshly established. Fresh inventories must
  still await `load()` and use its result. With no verified index, load stays
  loading/closed. Read failure/timeout/versionchange closes the old evidence;
  late completion cannot reopen it. Installed delegated job-sync consumes adapter
  failed/versionchange notifications through its existing monotonic failure
  boundary, so a later healthy storage operation cannot erase a failure from an
  already active cycle/history attempt or revive an earlier event pause.
  Mutating preserve/retire still close the
  index until completion and verified readback. No uncommitted facts are exposed.
- `preserve({items:[{key,raw}],raws:[{sourceKey,raw}],receipts:[string]}): Promise<Snapshot>`
  captures immutable inputs, adds one batch using get/compare/add in one readwrite
  transaction, awaits completion, then independently reads and verifies exact
  envelopes and strings. Identical overlapping requests share the operation and
  return independent defensive copies. Unequal contents under one key reject.
- `verifiedItems(): Entry[]` and `verifiedReceipt(key): boolean` are synchronous.
  They throw `chat-journal-not-ready` until the memory index is verified.
- `retireExact(key,raw): Promise<void>` first reads the exact existing item,
  archives its original string in a completed write, and independently verifies
  that archive. A second exact-match transaction may then delete the item. A
  failure before delete completion retains the item. After committed deletion,
  a later refresh can fail with only the independently verified archive remaining;
  the index stays closed and the caller must retain its memory/cache on error.
  Raw archives are never deleted by this incident repair.
- `status(): {state:'idle'|'loading'|'ready'|'failed',code:string}` and
  `subscribe(fn): unsubscribe` expose coalesced status notifications only. Focus
  reloads the index through the installed delegated controller's existing focus
  cycle; standalone/legacy shells retain the adapter's focus load. Callers use
  `load()` at startup and ordinary refresh cycles to discover changes missed
  while asleep; no localStorage notification is required.

`Snapshot={items:[{key,raw,value,backend:'indexeddb'}],raws:[{sourceKey,raw}],receipts:[string]}`.
`value` is the parsed original item (null for malformed JSON, which remains raw
Admin evidence). Backend metadata is outside the original item. Internal records
use immutable `item:<legacy key>`, `raw:<SHA256(JSON.stringify([sourceKey,raw]))>`
and `receipt:<key>` namespaces. JSON serialization before UTF-8 hashing preserves
distinct lone UTF-16 surrogates. Hashes index exact strings; they do not replace
content comparison. Each operation has a 10,000ms budget covering queue time,
open, body, completed transactions and readback. Expired operations cannot install
readiness. Handles close on completion/failure/versionchange. Strict durability is
requested; only an unsupported-option TypeError permits the platform default.
This is a browser hint, not an unconditional power-loss guarantee.

## Recovery authorization and release boundaries

The normal app, current recovery shell and standalone rollback shell load the
versioned shared asset before their consumers. Both existing color directory
mounts cover it. The asset remains optional during proxy startup, while its
absence degrades health and returns 503 from both recovery shells. The existing
asset fingerprint map includes it automatically. No data endpoint is added.

The current recovery export retains version 2/source/value/confirmedCount and
adds exact raw evidence with explicit backend/source metadata. It resolves local
asynchronous reads before the final fresh visible-parent and session checks.
Non-admins receive only current-tuple pending items whose parent is visible.
Composite v1 source strings and raw archives are Admin-only; a visible v1 child
cannot expose hidden siblings through its raw array. Existing exact central
job/UID/content confirmation remains authoritative. The standalone rollback
format remains `{format:'formula-rollback-chat-recovery-v1',entries:[{key,raw}]}`
with its prior strict owner tuple and Admin unknown-evidence rules. Neither
reader imports, acknowledges, deletes, migrates or replays data, or posts business
data upstream. Loading and read failure are visible; a failed read never becomes
an empty count.

Task 1 is the **proposed C1 rollback compatibility checkpoint**, to be named by its
reviewed immutable commit after independent task review. It retains PR #87
job-sync behavior plus the shared adapter and both export readers. Tasks 2/3 may
roll back to that named checkpoint while retaining export of the new store.
Unmodified `baa2ec3` and the historical candidate below cannot read this database.
The human reviewer must approve both the final head and named C1 artifact before
release. Task 1 alone does not activate the new writer in job-sync or repair
composer ordering, and cannot establish actual-user restoration.

Acceptance evidence is synthetic only: native Chromium bulk durability,
transaction abort/readback/deadline/concurrency faults, both native HTTP recovery
shells after cold reload, ownership gates, exact Blob exports, desktop/mobile
controls and keyboard operation. No production API/database/profile was used.
The root owns final full checks and independent review; human approval, backup,
parity, release/deployment and actual-user acceptance remain required.

## Task 2 — verified bulk writer integration

`fs-job-sync.js` collects all existing-format journal items, v1 import receipts
and exact original raw sources before attempting any replacement. LocalStorage
remains the first item/receipt backend. Named `QuotaExceededError` alone routes
items/receipts into the shared adapter; an original raw archive uses its new
namespace even if legacy item writes fit. Denied, invalid or mismatched storage
stays closed. `ensureChatDurability(batch, identity, generation)` is closure-local
and returns `Promise<boolean>` only after actual verified evidence and fresh
session checks; legacy `putChatItem`, journal enumeration, stash, import and
preservation callers remain synchronous. An unverified asynchronous attempt is
never a true durability result.

Startup and ordinary cycles reload the verified index. The authorized full
snapshot boundary collects a complete batch, waits for commit/readback, checks
current actor, session generation, visible generation and latest parent scope,
then reruns synchronous reconciliation. A synchronous failure captures the
immutable batch and returns before replacing caches; one coalesced continuation
resumes ordinary history work after verified preservation. Persistent failures
retain sources and wait for existing focus/online/20-second retry opportunities;
an empty pending list cannot make an unreadable index ready. Storage events
capture both oldValue and newValue in the same synchronous callback, before any
await. No localStorage notification write or BroadcastChannel is required.

The merged reader validates each original canonical journal key, preserves
same-UID differing content, and deduplicates equivalent items across backends.
Canonical-equal legacy strings with different property order or whitespace are
accepted without rewriting originals: fallback retains its immutable exact raw,
and a differing legacy raw is separately archived before acknowledged retirement.
V1 source arrays and legacy unclassified envelopes remain untouched. An import
receipt alone cannot suppress a missing item; exact current central content plus
the retained original is required to cover an acknowledged import.

Both full and incremental ACK paths require current visible job + UID + canonical
message content; room ACK also compares its full preserved metadata. Original
journal raw is verified before any exact retirement, and IDB retirement runs at
the asynchronous scoped boundary. Its Task 1 archive-before-delete/post-delete
refresh limitation still applies; failures keep the UI/cache path closed and
retain in-memory/cache evidence. Unknown originals never become owner-pending
items. Local exact-ACK retirement uses fresh scope/tuple checks before and after
the whole batch and local-generation checks after every await. Remote parent or
role revocation during the first retirement may allow a later already-ACKed
local item to retire before the final check detects it. Each raw was independently
verified first; final readiness/apply/replay remains closed, the exact archives
remain, and no upstream mutation is authorized. Per-item server reads are not
part of this boundary. PostgreSQL remains authoritative and the existing IAM/parent gates remain
unchanged.

A metadata-only `fs_chats` quota can retain the old on-disk cache and continue
only after every supplied original and pending item has verified evidence.
Unexpected metadata storage errors close readiness. A monotonic failed-save
counter is captured by each apply/history/cycle attempt, because the sealed
application ignores `saveChats()` return values. A failure during that attempt
cannot be erased by a later successful stash/save or an outer ready assignment;
only a later complete scheduled attempt with actual healthy storage can resume.
This runtime tracks its own successfully generated replaceable cache so unchanged ordinary cycles neither
archive server history repeatedly nor recreate retired entries. Raw deduplication
uses exact source key + string; distinct supplied raw revisions accumulate with
no automatic archive deletion. Growth is proportional to distinct source bytes,
including event-only revisions, not bounded by a retention cap. Retention and
quota monitoring remain a separate human decision.

## Durable-before-clear new messages (Task 3)

The runtime sender replaces the sealed clear-before-save order. It keeps the
existing `getChat` / parent-ready / `requirePerm('chat')` gates, trim semantics,
`nowTs()` click timestamp, `msgUid()` algorithm and message shape
`{type:'msg',user,text,ts,uid}`. It prepares that message once and journals the
existing `{kind:'pending',identity,jobId,message}` item before changing the
composer, room messages, activity or participants. No new draft kind or key is
introduced. LocalStorage item writes require exact readback; quota uses the
shared completed-transaction and independent-readback barrier.

After the await, fresh trusted session/scope checks, current parent readiness,
room and local session generation must still match. Failure closes readiness
and retains the composer. Repeated clicks share the in-flight operation; a
healthy retry of that same prepared message uses its original UID, identity and
timestamp. Same-UID content conflicts remain closed. A new input event, newer
text, replaced input element, changed room or account cannot clear a newer draft.
The existing hidden-draft restoration retains newer typing, caret and focus
across the sealed redraw. If the user enters another formula/worksheet field
during the await, sender completion defers its redraw and preserves that DOM edit
and focus; the next ordinary render displays the durable message. The successful path retains the sealed activity's
160-character truncation and participant update using the existing helpers.

A local acknowledgement means pending, not centrally saved. The adjacent Thai
live status announces saving, failed, pending or saved; saved requires the exact
central job+UID+content readback. The existing send button has a minimum 44px
height and width and remains usable with the keyboard. A failed cache update
still uses Task 2's monotonic failed-save guards and cannot reopen readiness.
No permissions, central write API, formula/system-message handling or ordinary
20-second cadence are changed.

Synthetic real-proxy tests execute the complete immutable sealed document and
native Chromium storage. They compare normal sends with execution of the actual
sealed sender, cover delayed commit, request-success then abort, unavailable/full
storage, failed readback, newer typing, repeated clicks, stale authority, exact
ACK and lost HTTP response followed by ordinary reload. Composed recovery refresh
and a held native read transaction cannot lose intent or cause an immediate
retry loop. Rendered desktop/mobile states and keyboard targets are inspected;
the existing mobile PD Chat Message-card/Modify save and reload acceptance is
rerun as a neighbor. These are synthetic checks, not affected-user acceptance.

The earlier Task 3 handoff at `1238c6c` was blocked by the actual three-tab
acceptance. Its retained traces proved two coordination defects: recovery's
observational reads cleared the controller index, and native journal notifications
attempted synchronous stashing during the controller's own read. The forward
repair separates snapshot publication ownership and lets a newly added immutable
journal notification use its exact current localStorage readback. It schedules the
existing authoritative cycle rather than stashing an unchanged in-memory room.

A journal removal/unequal replacement synchronously captures both supplied string
originals into the existing raw-evidence waiting batch. It never parses these raws
into owner pending messages. Before destructive reconciliation, the owner drains
one captured batch with completed commit/readback and trusted generation/session
checks. The cache preservation barrier captures its whole initial batch before any
await and performs exactly one durability operation. Later arrivals remain waiting:
its explicit deferred outcome keeps recovery blocked and wakes the existing owner
once. Awaiting callers propagate that outcome without draining a second batch in
the same attempt. Only a later owner that actually verifies a captured waiting
batch and passes the settled generation/save checks may clear its recovery block;
an empty drain does not clear it and app readiness still needs fresh authority. A known active barrier, in-flight captured batch, or newer waiting evidence
causes an explicit deferred result before readiness decisions, pruning, retirement
or apply. Deferral rolls back unapplied watermarks, capabilities and full-read time
(and staged hydration obligations), retaining completed durable evidence. It does
not restore unknown readiness or start a drain/retry loop. Existing event work or
the normal 20-second cycle resumes. Known authority revocation and genuine storage,
save or permission failures remain failures, never benign deferrals.

The bounded changed-cache pause still permits read-only reconciliation only for a
previously ready trusted identity/session/generation/scope and unchanged failure
epochs. Its current marker is selected after fresh preflight authority and settled
evidence checks, then that same marker must survive all final checks; a pause
that starts and completes during the await is not mistaken for unknown history. Writes remain closed until its final fresh authority and save checks.
Sender publication can overlap a scope await, so the controller joins a verified
load before synchronous preservation. Recovery reads no longer invalidate it.
Native evidence covers the original unchanged three-tab/draft/formula assertions,
sole event raws under quota, arrivals during drain and watermark rollback, active
cache barriers during scope reads, and sender/PD editing during a native held
transaction. Exact results and earlier failures remain in the Task 3 report;
synthetic acceptance does not constitute actual-user UAT or release approval.

C1 `fe4e1b63e87e23b062f73f5cee4614c2520f33a7` remains the unchanged proposed
rollback artifact. A native cold-read proof verifies its exact adapter and both
reader blobs against Git and its retained manifest, then reads current-writer
item/raw/receipt evidence without mutation. C1 retains its historical read-index
coordination behavior; it is a compatibility rollback, not a claim that this new
coordination fix exists there. Human approval of both exact artifacts is required.

Closing a page before its first verified durable acknowledgement is not
protected. After acknowledgement, the original pending item or its exact central
copy is available on reload, subject to browser data clearing/eviction, browser
storage failure and hardware loss. Strict durability remains a browser hint.
Distinct original raw archives are retained without cleanup; growth and actual
user acceptance remain explicit human release concerns.

The proposed immutable C1 rollback compatibility artifact is
`fe4e1b63e87e23b062f73f5cee4614c2520f33a7`, independently reviewed for Task 1.
Task 2/3 rollback uses that artifact while retaining new-store export. Both the
final head and named C1 still require exact human release approval; C1 is not
implicitly approved by these synthetic implementation checks.

---

# Historical rollback compatibility artifact — 2026-10-18

This historical candidate was based on approved commit `efd631a863d586b1df03f234c64da8d307014ed4`. It deliberately retains that commit's prior app and job-sync asset; it does not retain the server-owned-data gateway, visible-record/chat endpoints, chat journal writer, or recovery acknowledgement logic.

## Required retained boundaries

1. Verified Admin sessions can read `fs_activities` through the normal IAM gate. Authenticated non-admin GET returns `200 []`; HEAD returns 200 with no body and neither reaches upstream. Anonymous remains 401. Empty success preserves the sealed application's bare-await sync contract; it does not authorize disclosure. POST remains under the prior write policy.
2. `GET|HEAD /__formula/chat-recovery` serves a standalone shell and `/fs-rollback-chat-recovery.js`; it runs no sealed application or job-sync code. Other methods receive 405. Missing asset returns 503 and reports degraded health.
3. Export authorization uses fresh `/sb/session` responses before and after capture. A valid session requires authenticated name, central user ID, role and unexpired expiry. The identity is the existing writer tuple: `JSON.stringify([name, centralUserId, role, normalizedEmail?])`. Identity changes, expiry, unavailable session or inaccessible storage fail closed.
4. Non-admins may export only `fs_chat_journal_v2:*` entries with parsed `kind=pending` and matching identity, and `fs_chat_pending_v1:<encoded identity>` arrays matching the current tuple. Admins may export all these entries plus exact `fs_chats` and `fs_chat_unclassified_recovery_v1`, including malformed and empty strings. Unknown ownership is Admin-only; no role or session claim is read from storage/headers.
5. Each export entry is `{key, raw}`. `raw` is the original localStorage string, not normalized JSON or an inferred message. The recovery utility never writes/removes storage, imports, replays, acknowledges, trims or sends chat data upstream. The downloaded JSON wrapper preserves original string code units when parsed.
6. The export is a point-in-time read of one same-origin browser profile. It cannot recover another origin/profile, deleted data or journals from a different tuple after a role/identity change; Admin review remains available for those local entries. Concurrent tabs can change storage during capture, so the file is not a transactional database snapshot. Existing source keys remain untouched for another attempt.

## Architecture and operational scope

Existing asset directory mounts already cover both runtime colors; no compose change, SQL, new endpoint for data scope, configuration, secret or dependency is needed. `readOptional` avoids startup failure when the asset is absent; health requires it for this artifact. The shell has a same-origin-only network policy and exposes no pending content in the page. Downloads require a deliberate button action and server identity checks.

Build/rehearsal uses synthetic local HTTP/IAM fixtures and headless Chromium only. No production, Docker, database, secret access, push, PR, merge or deployment is authorized by this task. Consequently runtime parity, live operation, independent release review and production readiness remain unproven.

Acceptance: `node --test tests/write-policy.test.mjs tests/rollback-chat-recovery.test.mjs tests/job-sync-gateway.test.mjs`; actual Chromium export/readback, no upstream data writes, Admin-only activity payloads, desktop/mobile visual and keyboard checks. A source package must include the verified prior sealed HTML (`cf7ab7813cbe867d9d691f5f97aa2b60e8a9134aa4decc6d4c18575a2e118c64`), because Git intentionally tracks its manifest rather than HTML bytes.


### Final whole-branch correction contract (2026-10-19)

Supported nondelegated pages retain the actual sealed sender behind the existing
confirmed-parent gate and its own permission check. They do not invent a trusted
history identity. Delegated sending keeps its durable-before-clear contract.

An ordinary cycle that sees a freshly trusted replacement identity closes the
old scope and enters existing complete history recovery. After an earlier failed
attempt has settled, a closed/no-baseline cycle may enter that recovery before
old-tuple draining only when a fresh trusted session confirms a different known
identity. Same-identity recovery retains ordinary preflight/drain ordering. The
captured save-failure epoch and session/visible generation guard each handoff;
a successful later save cannot erase failure of the current attempt. Exact old
pending/raw evidence is retained and never replayed as the replacement identity.

Full history starts only after actor readiness. This attempt's complete authorized
snapshot, including its final trusted-session check, settles before its independent
core pull starts. Chat/message GETs slice that resolved snapshot without another
history scan. A failed snapshot does not start the independent core pull. All
final authority, apply, failure cleanup and durability checks remain mandatory.
An empty exact eligible immutable-retirement set omits only the additional
pre-delete scope read. A nonempty set retains that read before any retirement;
verified reload and final scope/trusted-session/epoch/generation checks remain
mandatory in both cases.

The slow-network native acceptance permits up to 45 seconds for initial complete
baseline readiness, with the session handshake still under 3 seconds and writes
and creation closed throughout the incomplete baseline. This initial-load test
allowance does not change the runtime read deadline or the ordinary incremental
refresh cadence, which remains exactly 20,000 ms. The selected runtime SHA-256 is
`762a73d046af50d6554a034f5cce3c6d0a2d98a00081554a7e1a84bdd518d24a`.

Sequential-startup evidence: the new operation-order assertion failed on frozen
parallel source `22c96a15ad82801265398c57371fb9544ce3d2e0f54ecc1c25ec6efe5be8d5e3`.
On the selected source the handshake took 179 ms and complete baseline 32,246 ms;
snapshot body completion at 20,203.6 ms and final snapshot session completion at
20,206.8 ms preceded the independent history core request at 20,206.9 ms. The
sealed bootstrap core request at 62.2 ms is separately identified. Focused native
startup/authority/exact-original checks passed 31/31, and the compact-client file
passed 31/31 after correcting its two superseded concurrent-start expectations
(the original two failures are retained). The unchanged genuine three-tab
acceptance passed in three fresh serialized runs: 6,576.729 / 6,456.748 / 6,516.107 ms.
Every run retained its log and before/after source hashes; evidence and commands
are in `.superpowers/sdd/2026-10-19-chat-sequential-startup/task-1-report.md`.
The timing-interaction hypothesis is supported, but the actual earlier failing
room-close transition remains unknown; these passes do not prove N1's root cause.
The completed serialized mandatory-browser suite passes 955/955, zero failures,
cancellations or skips, in 476.824 seconds (runner exit 0); its tracked source
manifest is identical before/after. An earlier full attempt was interrupted by
the private HTTP-audit evidence copier treating an intentionally invalid log
directory as a file. That incomplete attempt is retained without a pass claim;
the controller authorized one corrected copier/full invocation, with no app/test
change or further retry. Synthetic acceptance does not establish affected-user
acceptance. Independent review, release and production verification remain
separate gates.

Native test page connections wait for the intended URL and completed document,
not the already-complete initial about:blank. Missing or broken scripts still
fail the API assertion; the wait is bounded and includes document diagnostics.
The final-fix evidence retains repeated unresolved genuine-three-tab setup
failures. A later diagnostic room closure was the test's intentional revoked
parent and does not establish the earlier failure's cause. Passing later runs
must not be represented as causal resolution of that earlier result.
