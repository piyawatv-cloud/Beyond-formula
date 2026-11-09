# Debug log

## 2026-10-12 — A03119 Sales price-summary access

Status: LOCAL_FIX_VERIFIED_LIVE_DEPLOYMENT_PENDING. No production write, data repair, sync retry, or deployment was performed.

Task: user reports that Sales cannot open an old job and needs the price summary; target observed in the supplied screenshot and connected browser is A03119. No separate Task/Issue ID assigned. Allowed paths: `index.html`, focused browser regression tests, and this debug log. Forbidden: production data mutation, schema/storage-contract changes, permission expansion, and direct runtime patching. Change type: Critical Change because it touches `index.html`; owner/reviewer remain System Owner / CODEOWNER `@phossatron` under the project governance rules.

### Reproduction and evidence

- In the live Formula Studio page, A03119 is present in the Dashboard list and its read-only detail popup renders the target price as `150 บาท/หน่วย`; the record metadata shown in the popup identifies Sales owner `15.Sales แยม`. No customer, formula, message, credential, or raw storage payload was copied into this log.
- The same popup exposes actions for Chat, version history, print, delete, and close, but no action to load the existing record into Customer Data. Source inspection confirms `editRecordInSales(id)` already exists and loads `price` and the other locked record fields, but `openRecordPopup(id)` had no caller for it.
- The live page's separate save-status notice names only A03119 as requiring re-check. A read-only Dashboard scan found 125 unique visible record IDs, no duplicate IDs, and 89 idle-job warnings. The 89 idle warnings are not evidence of failed saves; they are a separate inactivity rule. The currently visible pending-save target was A03119 only.

### Root cause

The immediate Sales access defect is a UI reachability gap: the existing same-ID loader was implemented but was not wired into the record-detail popup. The server-confirmation warning is a separate condition that correctly keeps Chat locked until a fresh matching server acknowledgement; it must not be bypassed to retrieve read-only price data. The first failed save response and the underlying live sync cause for A03119 remain unproven from the available evidence.

### Failing test and fix

Added a focused browser regression test, `Sales can load an existing job from its detail popup to retrieve price`, using a synthetic Sales-owned record with a price. Before the implementation it failed because the popup had no Sales reload action. The minimal fix adds a permission-gated `เปิดใน Customer Data` action to the popup, which calls the existing `editRecordInSales(id)` path after closing the modal. It does not change Sales visibility, Chat confirmation, localStorage keys, record fields, roles, or server behavior. The application build stamp was updated to `2026-10-12.1` as required by project rules.

### Verification

- `node harness.js` — **80 passed, 0 failed**.
- Live read-only inspection — A03119 detail popup shows the stored target price; pending notice names A03119; no live mutation was made.
- `git diff --check` — **PASS**.

### Residual risk and follow-up

- This is source-level work on a Critical Change and is not production-complete. It requires independent review, approved PR/release, controlled deployment, and post-deploy verification before Sales can use the new button on the live build.
- A03119's live save/sync failure still needs an accountable operator to inspect sanitized write acknowledgement/error and current server/local conflict state. Do not retry blindly, create a replacement ID, clear local storage, or mark Chat confirmed from a cached snapshot.
- The broader visible set has many idle jobs, but only A03119 was identified by the current pending-save notice. A separate controlled reconciliation should inspect other pending-save IDs from the authoritative runtime if the notice changes or additional IDs are reported.

```yaml
status: LOCAL_FIX_VERIFIED_LIVE_DEPLOYMENT_PENDING
task_id: null
issue_id: null
files_changed: [index.html, tests/formula-studio.test.js, docs/DEBUG_LOG.md]
tests_run: [node harness.js, live_read_only_A03119_detail_check, live_read_only_pending_notice_scan]
test_result: 80 passed, 0 failed; live target and pending notice observed; deployment not performed
security_impact: permission-gated UI action only; no visibility expansion or auth change
database_impact: none
permission_impact: no role or RLS change; existing createData and canSeeRecord gates retained
dependency_impact: none
rollback: revert the popup action, regression test, and this log entry; no data rollback required
open_risks: [A03119 live save/sync root cause unverified, production deployment and UAT pending, independent review pending]
pr_reference: null
```

## 2026-10-12 — A03119 and related blocked legacy-sync cases

Status: RUNTIME_RECOVERY_CANDIDATE_LOCAL_ONLY. This entry records the cross-repository runtime finding; no production retry, data repair, or deployment was performed.

### Evidence and root cause

- The live page remained on sealed app build `2026-10-07.2` and loaded the separate `fs-job-sync.js` runtime asset. Read-only status showed A03119 as a blocked save requiring inspection. The supplied screenshot shows the same family of state for A03885, where the central system had no row and the UI offered a send-back choice.
- Runtime source confirms the legacy write is intentionally suppressed until the parent record receives an exact central acknowledgement. Chat therefore remains fail-closed. The blocked-warning action only opened the record popup; the popup had no record-specific recovery choice, so a user could inspect A03119 but could not resolve the gate from that screen.
- This is a runtime UI/recovery-path defect affecting a class of blocked legacy records, not evidence that A03119 or A03885 should be overwritten or recreated blindly.

### Candidate repair and verification

- In the separate `/Users/user/formula-runtime` feature branch `codex/job-chat-recovery-20261012`, the popup now exposes explicit, confirmation-gated recovery actions. A fresh central read is required. If a central row exists, the local copy is backed up before using the central copy; if no row exists, the local copy is staged as create-only and must receive an exact save acknowledgement. Central conflicts remain blocked.
- Runtime regression coverage now includes both “central row missing” and “central row exists” cases. The runtime client suite passed `96/96`; syntax and whitespace checks passed. The existing screenshots in the runtime worktree were pre-existing unrelated changes and were not modified by this work.
- The candidate is not deployed. Independent review/CODEOWNER approval, backup and controlled release gates, production UAT, and a read-only reconciliation of all currently listed blocked IDs remain required. No A03119/A03885 business payload was copied into this log.

```yaml
status: RUNTIME_RECOVERY_CANDIDATE_LOCAL_ONLY
task_id: null
issue_id: null
files_changed: [/Users/user/formula-runtime/runtime/assets/fs-job-sync.js, /Users/user/formula-runtime/tests/job-sync-client.test.mjs, /Users/user/formula-runtime/docs/DEBUG_LOG.md]
tests_run: [node --test tests/job-sync-client.test.mjs, node --check runtime/assets/fs-job-sync.js, git diff --check]
test_result: 96 passed, 0 failed; production deployment not performed
security_impact: explicit confirmation and existing session/visibility checks retained; no auth or IAM broadening
database_impact: no production database change; create-only CAS path reused
permission_impact: no role, RLS, or write-policy change
dependency_impact: none
rollback: revert the runtime asset, focused tests, and debug-log entry through the runtime repository release process; preserve browser outbox/recovery data
open_risks: [production runtime still requires controlled release, current blocked-ID inventory needs read-only reconciliation, independent review and UAT pending]
pr_reference: null
```

## 2026-10-07 — A03358 reported in activity log but absent from shared chat

Status: investigation incomplete; source-browser evidence required. No repair or deployment performed.
Task: user-reported A03358 visibility incident; no separate Task/Issue ID assigned.
Scope: browser UI metadata and repository source inspection; no production database/credential access or writes.

### Evidence and reproduction

- User reports Sales chat activity for A03358 in the activity log while others cannot see the room.
- Connected Admin page displayed app build `2026-09-23.1`, a synced indicator, and the Sales filter selected. A03358 was absent from the displayed room list. That initial observation alone does not rule out all filters or prove server absence.
- Attempted to clear the chat filters and search A03358 using the connected Chrome tab. Browser automation timed out/reset and a rebind also timed out. The resulting search state could not be verified; no claim of a completed filtered search is made.
- Source inspection of the development checkout's sealed app (`releases/bd55f3c7077c/index.html`) shows `visibleChats()` requires `canSeeRecord(records.find(x=>x.id===c.jobId))`. `canSeeRecord()` returns false for a missing parent, including for Admin.
- A synthetic Node/VM check executed those actual source functions: one chat without its parent record produces zero visible rooms; adding the parent produces one visible room for a synthetic Admin. No server request or real business data was used.

### Interpretation and limits

The missing-parent visibility behavior is proven in the inspected source. It is a plausible explanation for this report, not a proven incident-specific cause. Activity log persistence does not establish that the parent record, chat and messages were all committed. The currently deployed source digest, full filtered Admin record/chat search, server existence, permissions and source-browser contents remain unverified.

### Safe interim recovery sequence

1. Preserve the original Sales browser/profile and pending work; do not clear browser storage or create a replacement ID as a diagnostic shortcut.
2. Verify A03358 in Customer Data and Chat with all filters cleared in Admin and the original Sales browser. Gather only sanitized existence/count/status metadata.
3. Accountable Runtime Operator verifies parent/chat/message existence, any archived copies, and save rejection metadata using approved access; absence from the Admin screen alone does not establish database absence.
4. If the original valid record is available, prepare reviewed recovery of the same A03358 ID with backup and conflict checks. Do not invent a parent from log text or overwrite a current server record blindly.
5. Prioritize runtime PR #9 review for prevention and controlled release. That PR does not automatically recover this old incident; alert PR #13 does not repair missing records.

No new regression test or code fix was added because the incident-specific cause is not established. Synthetic visibility diagnostic passed; no production repair verified.
Security/database/permission/dependency impact: none. Files changed: this local investigation note only; not published to GitHub. Rollback: remove this new note. Owner/reviewer: accountable system owner and Runtime Operator. Open risk: original Sales data may be unavailable; browser connection currently prevents full UI verification.
PR references: https://github.com/piyawatv-cloud/formula-runtime/pull/9 and https://github.com/phossatron/Beyond-formula/pull/13.

## 2026-10-08 — Owner reports PR #13 is not visible for review

Status: public PR availability verified; owner-specific display failure not reproduced. Reviewer request remains absent.
Task: investigate the reported review/approval blocker for PR #13; no separate Task/Issue ID assigned.
Scope: read-only public PR/repository metadata and the previously authorized reviewer-request operation; local evidence note only.

Evidence:

- `gh pr view 13 --repo phossatron/Beyond-formula`: OPEN, not a draft, base `main`, author `piyawatv-cloud`, source fork `piyawatv-cloud/Beyond-formula`, head `48b5ea6ded5d990bd81397eea94b12f84a79824f`, no reviews or reviewer requests.
- Repository metadata: `phossatron/Beyond-formula`, public. The current development account reports pull access, with push/maintain/admin/triage false.
- Unauthenticated HTTPS requests to the PR page and public PR API both return HTTP 200. The page contains the PR title and changed-files navigation; API confirms the PR is based in the owner's repository.
- Authorized reviewer-request retry: `POST repos/phossatron/Beyond-formula/pulls/13/requested_reviewers`, reviewer `phossatron`, returned HTTP 404. No request was successfully created. The PR remains publicly readable; failure of the write operation does not mean the PR itself is missing. Lack of write access is consistent with the operation failure, but the API does not disclose its exact authorization reason.
- Asked whether the owner sees only an empty review-request list, a direct-link 404, or a loading failure. The owner's exact failure remains unverified pending that evidence.

Resolution path:

1. Owner opens https://github.com/phossatron/Beyond-formula/pull/13 directly, rather than relying on a review-request filter or the formula-runtime repository's PR list.
2. If the direct link opens, review through Files changed → Review changes → Approve/Request changes → Submit review while signed in as the accountable reviewer. No reviewer request is required to begin that direct review.
3. If the owner's direct link fails, diagnose that browser/account/network symptom separately; do not create a duplicate PR or change repository permissions as a shortcut.

Reference: https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request

Verification: public page/API availability PASS; reviewer-request creation FAIL (404); owner display and human approval UNVERIFIED. No application regression test is applicable to this external account/display condition. No source, database, security settings, collaborators, dependency or deployment change. Files changed: this local investigation note; rollback: remove this appended incident entry. Existing review/release governance still applies. This note does not claim approval, merge or deployment.

## 2026-10-08 — A03358 original Sales browser photographs received

Status: source-browser UI existence confirmed; persistence/server acknowledgement still unverified.
Task: existing A03358 visibility incident; no separate Task/Issue ID.
Scope: user-supplied screenshots, source inspection and synthetic diagnostics only. Owner/reviewer: system owner and accountable Runtime Operator. No production access or writes.

- User-supplied photographs show A03358 in the original Sales browser's job list and chat, and the displayed app build is `2026-09-23.1`. The chat panel displays one participant. No customer/formula/message contents are transcribed here.
- The version-history dialog explicitly describes browser-local copies. Its current entry and absent historical revisions do not prove any committed server record.
- UI rendering proves data was available to that page. It does not distinguish in-memory state from persisted localStorage and does not establish database absence.
- Source inspection of historical commit `43b5cfb` finds delta selection against `sbSnap.records`, followed by `sbSnapshot()` copying every local record into the baseline. Skipped/unacknowledged saves can therefore become an apparent baseline. This is a source-level risk, not an incident-specific cause or verified deployed digest.
- Prepared a read-only, single-ID A03358 diagnostic from the existing tested recovery inspector in a local artifact outside the repository. It outputs existence/count/status metadata only, performs no fetch/storage writes/credential reads, and does not expose formula/customer/message contents. Synthetic verification recorded separately in that artifact.

Next: preserve browser/profile and obtain a local controlled backup before reload/logout/upgrade; collect sanitized source-browser metadata and operator-confirmed server existence/ACK/conflict status; recover original ID only after conflict and ownership checks. Prior PR #9 prevention package does not itself import an old incident.
Files changed: this local incident entry only; security/database/permission/dependency impact none. Rollback: remove this entry and local inspection artifact. Open risks: source storage durability, precise save failure, server existence, and live release remain unverified. PR references: formula-runtime #9 and Beyond-formula #13.

### Follow-up — persisted owner view and Admin mobile absence

User confirms that after reload the original Sales browser still finds A03358 in Customer Data and opens its chat. The mobile session is Admin and does not find the job. This increases suspicion of an unsent local record or a load/visibility difference; it does not prove database absence.

Inspected development release source `releases/*/index.html` under formula-runtime-job-sync: `sbPush(seed)` skips a parent if its snapshot is undefined, `recTouched[id]` is false, and seed is false. `sbApplyFull` retains local-only parents. Therefore a reload can leave a local job visible while normal sync holds it, if that source is actually executing. The production digest and A03358 gate state remain unverified. Do not run `sbPush(true)`, set `recTouched`, or clear snapshots as a recovery shortcut: doing so can bypass stale-copy protection.

Prepared `inspect-A03358-short.js` outside the repository for user-run browser metadata only. It detects the touched gate in the executing function without printing source or business data; reads only `fs_records`; reports memory/storage/snapshot/editability/error booleans and counts; no fetch or storage writes. Four synthetic tests PASS, zero failures/skips: private content exclusion and gate detection, inaccessible storage, wrong-origin stop, and cached-snapshot non-proof. Actual source-browser execution/result and server repair remain pending.

### Console photograph — client hold confirmed

User-supplied original Sales console shows repeated warning `ไม่ส่งสำเนาเก่าที่ไม่มีใครแก้ในเครื่องนี้ขึ้นเซิร์ฟเวอร์` with IDs A03358 and A03050, and source location `(index):7726`. This matches the inspected legacy release warning location. Combined with retained UI after reload, the client-side selection hold of A03358 is now evidenced rather than hypothetical. It does not establish full server absence, the initial save failure, or full recovery completeness. A03050 is also held; its incident status is not yet assessed.

Three synthetic tests execute the actual legacy `sbPush` record-selection prefix with no network/writes (serializer stub only): untouched absent-baseline parent is held and warns; explicitly edited synthetic parent is selected; changed parent with known baseline is selected. Result: 3 PASS, 0 FAIL/SKIP. Source artifact remains local and no production data or credentials are accessed.

The same photograph shows HTTP416 requests apparently for `fs_activities`. Source `sbReqAll` sends Range pagination headers and catches 416 as end-of-range; actual response payload and range are not shown, so that error cause remains unverified. It is separate evidence from the explicit held-parent warning. Chrome self-XSS paste warning is also visible; further pasted diagnostics are not required to establish the observed hold.

Recovery still requires preservation of local fs_records/fs_chats/fs_recbak and pending event queues in approved local storage, valid ownership and fresh server conflict checks, then controlled same-ID save acknowledgement. Do not bypass the guard by global seed, clearing snapshots, or arbitrary business edits. PR9 deliberately preserves the untouched-cache protection; durable retry prevents new captured drafts from being lost after reload but does not blindly migrate historic cache. No production repair/deploy has been performed.

### Click-path assessment for legacy owner recovery

User requests exact clicks to send A03358 and prevent recurrence. Read-only legacy-source inspection found no dedicated reviewed retry/import action. `openRecordPopup` exposes chat/history/print/delete, not same-ID re-save. `canEditSection` restricts section edits to editFormula (Admin/PD); `saveJobSection` exits on unchanged values. `editRecordInSales` contains a same-ID form-loading path, but its name appears only at its declaration in the inspected source and has no verified rendered button caller. A generic Create click can allocate a replacement ID when editing state is absent. Therefore no unverified button sequence is recommended for production recovery.

Immediate supported GUI route is Application → Storage → Local Storage → Formula origin for preservation. Chrome official documentation verifies this viewing path and describes selecting a pair for a preview; double-clicking a Value cell edits it, so copying should use a read-only preview/context copy action instead. Source: https://developer.chrome.com/docs/devtools/storage/localstorage .

No code or production changes; no additional tests applicable to read-only UI/source assessment. Actual backup, fresh server conflict checks, controlled same-ID restoration, operator rollout and cross-account verification remain pending.

### Backup completion reported; read-only server-ID query prepared

User reports the source backup step completed. Backup file completeness is not independently verified; no contents were requested or read. Prepared user-run `sbReq('fs_records?select=id&id=eq.A03358')` using the existing browser connection. GET selects ID only; output is a count or sanitized HTTP status. Empty result means not returned to this session, not universal database absence. No query has been executed against production by Codex and no restore or deployment performed. Synthetic query tests verify read-only path/projection, empty response, unexpected response and sanitized failure.

### Source-browser ID query returned zero; backend-route mismatch observed

User photograph shows `A03358: 0` from the prepared `sbReq` query. This confirms no ID was returned by the browser's current connection, not absence from authoritative iMac PostgreSQL. The same console photograph includes an fs_activities GET with a `supabase.co` request URL. Existing legacy `sbReq` resolves all normal table requests from `sbBase()`. The runtime gateway rewrites SB_URL to same-site `/sb` and injects the durable sync module. Therefore check the active browser route before any recovery write; a stale or alternate served page could still access the legacy endpoint. Live current SB_URL/backend source and the cause of route mismatch are not yet verified.

Prepared `check-browser-route.js` outputs only same-site and job-sync-loaded booleans, reads no storage/keys/business data and makes no network call. Three synthetic route tests PASS with local gateway, cloud endpoint and same-site-without-module cases. No Supabase administration/query or production operation is performed by Codex. Existing backup completion remains user-reported; restore and deployment still pending.

### Current browser route confirmed; earlier cloud-route inference corrected

User photograph reports `sameSite: true` and `jobSyncLoaded: false`, and the visible request URL is `https://formula.beyond-workflow.com/sb/rest/v1/fs_activities...`. This confirms current same-site API routing. The earlier inference that the browser was sending directly to Supabase was not established and is superseded by this clearer evidence; the final database behind the gateway still requires operator verification. The A03358 zero-result is from this current browser connection.

Source `fs-job-sync.js` sets `window.__fsJobSync` inside install before wrapping saves. False therefore means no installed module marker on this page, not definitive proof that the server lacks its file. Missing deployment, missing/injected/blocked asset, or initialization failure must be distinguished by the operator. PR9/PR13 GitHub metadata rechecked: both MERGED at the previously documented immutable refs. Merge does not prove live installation.

Unauthenticated public-page metadata check returned HTTP200 but no Formula title or external script tags, so it did not yield the running app page and cannot establish asset absence. No credentials, browser session, production business data or operational state were accessed/changed by Codex. Existing exact-ref operator package and deployment runbook remain available. Preserve the original browser and local backups; resolve live module installation, then recover historical A03358 with create-only conflict checks and verify another permitted account. No more user console inspection is necessary to demonstrate the current missing installation marker.


### Owner backups received — A03358 offline recovery prepared

Status: PREPARED_NOT_APPLIED. User supplied three saved owner-browser files and authorized recovery of original A03358. Attachments processed offline; no network/database/credential access. Exactly one target parent and one chat selected. Formula rows: 8; unique message UIDs: 11; participants: 1; source approval object: empty. The purported outbox structurally contains record version history and has no A03358 history; it is not evidence of a pending message queue. Historical approval text/screenshot is not converted into an approval event.

Private recovery bundle stays outside Git, with mode 0700 directory/0600 files. The original files are unchanged. Extracted record and chat equal the original JSON values; all five manifested files pass SHA-256 checks. Revised bundle uses approval reconciliation guard; do not use an older generated bundle. No customer, formula, message, creator or credential content is recorded here.

New generic runtime feature branch codex/a03358-recovery adds offline preparer, SQL template, focused synthetic tests and operator handoff. SQL requires accountable operator confirmation and reviewed PR9 CAS installation; creates only the original parent, inserts missing children, verifies acknowledgements, preserves existing data and atomically rolls back on collisions, filtered writes or legacy message/approval conflicts. No source approval is invented. No schema/permission/dependency change.

Local evidence: recovery suite 16 PASS/0 FAIL/0 SKIP using disposable UNIX-only PostgreSQL and synthetic fixtures; existing CAS SQL regression 13 PASS/0 FAIL/0 SKIP. Mandatory independent formula-runtime-auditor reran 16 cases and returned PASS_LOCAL_AUDIT after closing legacy embedded approval and duplicate JSON field findings. Technical audit is not final owner approval. Exact production installation, target conflict checks, current backup, operator repair and actual Sales/Admin visibility remain pending; Codex did not write live production data or deploy.

Rollback: revert generic tooling before operator use; failed repair transaction leaves no partial import. Successful business repair requires reviewed reconciliation preserving subsequent activity, not blanket deletion. Remaining risk: source approvals/pending queues not supplied, server conflicts, missing initialized live durable-sync module. PR9 merge alone does not prove deployment or recover this historical job.

Recovery tooling PR opened: https://github.com/piyawatv-cloud/formula-runtime/pull/10 ; reviewed local commit 9bf3326cfa31128be60079b600b33db677db8b5d. Four generic files only; base is actual merged PR9 lineage. GitHub state OPEN, no recorded owner approval and no status checks reported at handoff time. Production data application and deployment remain pending.

### Runtime Operator continuation authorized; dispatch recipient pending

User explicitly instructs Runtime Operator to continue the production step. This authorizes preparing/dispatching the recovery handoff, but does not appoint Codex as the production operator or establish GitHub owner review. PR10 checked again: OPEN at 9bf3326cfa31128be60079b600b33db677db8b5d, reviews empty, merge absent. Existing operator runbook names Piyawat; connected task inventory does not establish a Runtime Operator task. Recipient/channel requested once. Private masked handoff prepared outside Git, bundle v2 manifest and permissions rechecked successfully. No message dispatched without a confirmed recipient; no live data access, restore or deployment performed.

### System Owner delegates Codex operator role; actual restoration and rollout

Latest owner instruction explicitly changes the operator role: Codex may carry out commanded operational tasks; user will not operate the system. Delegated policy preserves self-approval/reviewer/security/backup gates; independent policy review PASS and Beyond-formula PR14 records it. Live masked preflight proves A03358 parent absent, chat present, source11 messages exact, normalized12 and approval1 present, no conflicts. Local predeploy backup checksum and isolated round-trip proof PASS for7 tables. Approved PR9 additive migration installed from exact merge; private reviewed recovery commit9bf3326 transaction committed13:18:37 Bangkok, parent exact and child fingerprints unchanged. Approved runtime a46828e and app cfa964b deployed via existing safe Blue/Green gates;172 runtime tests PASS, policy/parity PASS, activegreen and build2026-10-07.2 on both colors. Authenticated existing Admin browser sees original saved job and opens its room;1/4 approval,12 non-system messages, compose enabled; reload PASS. Later live normalized count17 includes5 system events; no approval or test message invented. No login/impersonation, secret exposure, IAM/control change or blanket data deletion performed. Runtime PR10 and policyPR14 remain open; no GitHub human approval/merge is claimed. Source Sales/mobile device and broader production write acceptance remain unverified. Masked post-live report records exact references, backups, rollback and remaining limits.

## 2026-10-28 — แจ้งเตือนทดสอบบน A001T ที่ localhost:8799 ไม่ครบ

- ขอบเขต: Web Push ด้วยบัญชี/ข้อมูลจำลอง ไม่เชื่อม production; ปิด Chrome จากแอปล่าสุด
- อาการ: รอบเดิมบริการรับงานและแชต แต่โทรศัพท์ไม่แสดงทั้งสอง; ทำซ้ำที่ origin เดิมอีกครั้ง บริการรับทั้งสอง แต่ระบบโทรศัพท์และผู้ใช้พบเฉพาะแจ้งเตือนงาน
- เปรียบเทียบ: origin ทดสอบใหม่ 8810 ใช้ข้อมูลจำลองเดียวกัน พบงานและแชตอย่างละหนึ่งหลังปัด Chrome ออก และหลังเริ่มบริการใหม่ไม่ส่งเหตุการณ์งานซ้ำ
- สาเหตุ: **ยังไม่ยืนยัน**; origin, การสมัครรับแจ้งเตือน และสภาพเบราว์เซอร์ไม่ใช่ตัวแปรที่ควบคุมให้เหมือนกันทั้งหมด ไม่มีหลักฐานเพียงพอจะสรุปว่า service worker เก่า, เครือข่าย หรือระบบปลายทางเป็นสาเหตุ
- ยังไม่ได้แก้ปัญหาต้นเหตุ; ต้องเก็บหลักฐาน service worker/version, การจัดการ subscription และสถานะการส่งในสภาพแวดล้อมที่ตรวจสอบได้ แล้วทดลองแบบควบคุมตัวแปรก่อน release
- แยกจากอาการนี้: พบการตรวจสิทธิ์จาก snapshot เก่าระหว่างส่งหลายอุปกรณ์ในคิวจำลอง; เพิ่มกรณีถอนสิทธิ์ระหว่างการส่งใน `durable.test.cjs` ซึ่งล้มเหลวก่อนแก้ แล้วปรับให้ตรวจสิทธิ์ล่าสุดก่อนแต่ละอุปกรณ์และทดสอบผ่าน ความเสี่ยงถอนสิทธิ์ขณะส่งออกไปแล้วและหลายโปรเซสยังเปิดอยู่

## 2026-10-28 — บัญชีจำลองที่ระงับกลับเข้าใช้งานหลังเริ่มบริการทดสอบใหม่

- ขอบเขต: บริการ HTTP และ SQLite จำลองใน `mobile-preview/simulation` ไม่เชื่อม production
- ทำซ้ำ: ระงับบัญชี PD จำลอง ปิดและเริ่มบริการใหม่ แล้วเข้าสู่ระบบ; ก่อนแก้บริการตอบ 200 แม้ควรถูกปฏิเสธ
- สาเหตุที่ตรวจพบ: ตอนเริ่มบริการสร้างสถานะผู้ใช้จำลองใหม่เป็น active และเรียกลงทะเบียนอุปกรณ์ใหม่โดยไม่อ่านสถานะที่เก็บไว้
- แก้ในตัวจำลอง: อ่านสถานะที่เก็บไว้ก่อนสร้างอุปกรณ์; คงสถานะระงับหลังเริ่มใหม่
- หลักฐาน: เพิ่มกรณีใน `auth-http.test.cjs` พบ 200 แทน 401 ก่อนแก้ และผ่านหลังแก้ พร้อมชุด `durable.test.cjs`
- ความเสี่ยงคงเหลือ: เป็นบริการตัวอย่างเฉพาะเครื่อง ไม่พิสูจน์หรือเปลี่ยน Supabase Auth, authorization production หรือการแข่งกันหลายโปรเซส

## 2026-10-28 — ผลคำนวณสารในหน้าจำลองเมื่อข้อมูลไม่ครบ

- ทำซ้ำด้วยข้อมูลจำลอง: ปริมาณหรือความเข้มข้นว่างถูกแสดงเป็นศูนย์ และข้อความเช่น `100mg` ถูกอ่านเป็น 100
- สาเหตุ: ใช้การแปลงตัวเลขที่ยอมรับบางส่วนของข้อความและแทนค่าว่างด้วยศูนย์; ตัวอ่าน CSV ยังแทนความเข้มข้นว่างเป็น 100
- แก้เฉพาะหน้าทดลองให้ตรวจตัวเลขทั้งค่า แสดง “ยังคำนวณไม่ได้” เมื่อข้อมูลไม่ครบ คงช่องผลคำนวณ Excel ให้ว่าง และปฏิเสธข้อมูลที่ไม่ใช่ตัวเลขก่อนบันทึก ค่าศูนย์จริงยังใช้ได้
- หลักฐาน: ทดสอบโมเดลและ Excel รวมถึงทดลองบนหน้าจอด้วยข้อมูลจำลอง; ยังต้องให้เจ้าของงานยืนยันกติกาข้อมูลว่างและความเข้ากันได้กับระบบเดิม
- ไม่เปลี่ยนระบบหรือฐานข้อมูลจริง และผลคำนวณไม่ใช่การรับรองสูตรหรือสถานะ อย.

## 2026-10-28 — การนำเข้า Excel งานเดียวข้ามข้อมูลสารโดยไม่แจ้ง

- ขอบเขต: หน้าทดลองในเครื่อง ใช้ไฟล์ Excel ข้อมูลสมมติ ไม่เชื่อมฐานข้อมูลจริง
- ทำซ้ำ: ลบชื่อสารแต่คงปริมาณและข้อมูลอื่นในแถวนั้น ผลก่อนแก้ไม่แจ้งข้อผิดพลาดและข้ามทั้งแถว; คอลัมน์ที่ไม่รองรับและหัวคอลัมน์ชื่อสารอีกชื่อหนึ่งก็ถูกละทิ้ง
- สาเหตุ: ตัวอ่านแปลงชีตเป็นรายการแล้วกรองแถวที่ชื่อว่าง โดยไม่ได้ตรวจข้อมูลที่เหลือหรือหัวคอลัมน์ที่ไม่รองรับ
- เพิ่มกรณีทดสอบที่ล้มเหลวก่อนแก้ แล้วแก้ให้ปฏิเสธแถวสารไม่มีชื่อ ข้อมูลในคอลัมน์ที่ไม่รองรับ หัวคอลัมน์ซ้ำ และหัวคอลัมน์สองชื่อที่หมายถึงข้อมูลเดียวกัน
- ตรวจซ้ำด้วย `node mobile-preview/workbook.test.cjs` และ `node mobile-preview/test.cjs`; ตรวจชื่อหัวคอลัมน์แม่แบบเดิมด้วย `test_excel_contract.py` ผ่าน Python ที่จัดเตรียมไว้ใน workspace
- ความเสี่ยงคงเหลือ: ยังไม่ได้ยืนยันไฟล์จริงทุกรูปแบบหรือความเท่าเทียมกับระบบเดิม คอลัมน์สารที่ได้จริงถูกคำนวณใหม่ในตัวอย่าง ไม่ใช่การรับรองสูตรหรือผลตรวจ อย.

## 2026-10-28 — หน้าแก้สูตรจำลองรับรายการสารไม่มีชื่อ

- ทำซ้ำในหน้าจำลอง PD: ลบชื่อสารโดยคงปริมาณ 100 และความเข้มข้น 50 แล้วกดบันทึก ก่อนแก้หน้ารายละเอียดแสดง “ยังไม่ระบุชื่อสาร” พร้อมข้อมูลสารเดิม
- สาเหตุ: หน้าแก้สูตรตรวจค่าตัวเลข แต่ไม่ได้ตรวจว่ารายการที่ยังอยู่มีชื่อ ขณะที่ฟอร์มบรีฟและการนำเข้าบางรูปแบบตรวจแล้ว
- แก้หน้าแก้สูตรตัวอย่างให้แจ้งระบุชื่อหรือเลือกนำรายการออกก่อนบันทึก โดยไม่ลบข้อมูลที่กำลังกรอก; เพิ่มชุดทดสอบชื่อว่างและชื่อที่มีแต่ช่องว่าง
- หลักฐาน: ชุด `mobile-preview/test.cjs`, `workbook.test.cjs`, `integration/ui-save-simulation.test.cjs`, `integration/runtime-job-save.test.cjs` ผ่าน และทดลองในเบราว์เซอร์พบข้อความเตือนพร้อมค่าที่กรอกเดิม เมื่อเลือกนำรายการออกจึงบันทึกได้
- ขอบเขต: ข้อมูลและพฤติกรรมจำลองในหน่วยความจำ ไม่ยืนยันกติกาหรือข้อมูลระบบเดิม และไม่เชื่อมฐานข้อมูลจริง

## 2026-10-28 — ข้อมูลสารมือถือยังไม่เข้ากับหน้าระบบเดิม

- ขอบเขต: ชุดส่งมอบในเครื่องและข้อมูลสมมติ ไม่เชื่อมระบบหรือฐานข้อมูลจริง
- ทำซ้ำ: `node mobile-preview/integration/legacy-render-compat.test.cjs` รัน `renderDashboard` ของสำเนาระบบเดิม พบข้อผิดพลาดสำหรับแถวที่ไม่มี fda, น้ำหนักเป็นข้อความ และ actual ว่าง; แถวที่มีข้อมูลตัวอย่างครบไปถึงขั้นเพิ่มแถวในตาราง
- สาเหตุ: หน้าระบบเดิมเรียก fda และเมธอดของตัวเลขโดยตรง ส่วนหน้ามือถือใช้ข้อความจากช่องกรอกและยอมรับค่าที่คำนวณไม่ได้ ยังไม่มีตัวแปลงที่ยืนยันข้อมูลกับระบบเดิม
- ยังไม่แก้สัญญาข้อมูลหรือกฎ อย.; ต้องยืนยัน baseline และวิธีจัดการค่าที่ไม่ครบกับเจ้าของงาน ก่อนทำตัวแปลงหรือทดสอบทั้ง workflow ผลนี้ไม่พิสูจน์พฤติกรรม production

### หลักฐานเพิ่มเติม — ตัวกลางและ SQL ตอบรับข้อมูลที่หน้าเดิมเปิดไม่ได้

- ทดสอบแยกสองเส้นทางด้วยข้อมูลสมมติ: ตัวกลางจากชุดส่งมอบกับ upstream จำลอง และ SQL จากชุดส่งมอบใน PostgreSQL ชั่วคราว ต่างตอบบันทึกสำเร็จสำหรับรายการสารที่ `w` เป็นข้อความ จากนั้นฟังก์ชันแสดงผลในสำเนาระบบเดิมเกิดข้อผิดพลาด `toFixed`
- หลักฐาน: `runtime-job-save.gateway.test.cjs` 6 ผ่าน และ `runtime-job-save.pg.test.cjs` ผ่าน; SQL ตรวจเพียงรหัส ลูกค้าหรือแบรนด์ และชนิดรายการสาร ไม่ตรวจชนิดข้อมูลภายในสาร การทดลองตัวกลางใช้ upstream จำลอง ส่วนการทดลอง SQL ข้ามตัวกลางและสิทธิ์
- สถานะ: ยังไม่แก้ production หรือสัญญาข้อมูล ยังต้องยืนยัน baseline และกติกาข้อมูลสาร/อย. กับเจ้าของระบบก่อนกำหนดการป้องกันและทดสอบร่วมกันเต็มเส้นทาง

## 2026-10-28 — ฟอร์มจำลองเปลี่ยนชนิดข้อมูลสารที่ไม่ได้แก้

- ทำซ้ำด้วย `mobile-preview/integration/ui-row-preservation.test.cjs`: แถวสารสมมติเดิมมีน้ำหนัก 100 และความเข้มข้น 50 เป็นตัวเลข ก่อนแก้การอ่านค่าฟอร์มบรีฟเปลี่ยนเป็นข้อความและเพิ่มช่องว่าง แม้ไม่ได้แก้สาร
- สาเหตุ: ฟอร์มเขียนค่าจากช่องกรอกทุกช่องกลับลงรายการเสมอ; หน้าแก้สูตรมีรูปแบบเดียวกันและคำนวณ actual ใหม่ทุกแถวแม้ไม่มีการเปลี่ยนปริมาณหรือความเข้มข้น
- แก้เฉพาะหน้าจำลองให้เก็บค่าและช่องที่ไม่ได้เปลี่ยนตามต้นฉบับ และคำนวณ actual ใหม่เฉพาะเมื่อแก้ปริมาณหรือความเข้มข้น; ไม่ลบข้อมูลแฝงในสาร
- ทดสอบผ่าน: ชุดตรวจการเก็บแถวบรีฟ/สูตร, โมเดล 8 บทบาท, Excel, จำลองการบันทึก, ความเข้ากันได้ของตัวแสดงผลเดิม และตัวกลางจำลอง 6 กรณี; ทดลองเปลี่ยนแบรนด์ในเบราว์เซอร์แล้วบันทึกตัวอย่างได้
- ข้อจำกัด: ช่องที่ผู้ใช้เปลี่ยนยังเป็นข้อความในตัวอย่าง และข้อมูล อย. ไม่ได้ตรวจใหม่ จึงยังห้ามเชื่อมการเขียนกับระบบจริงจนยืนยันและแก้สัญญาข้อมูลครบ การทดสอบนี้ไม่ได้ยืนยันระบบ production

## 2026-10-28 — ฟอร์มบรีฟจำลองเปลี่ยนค่าที่ไม่ได้แก้

- ทำซ้ำด้วย `node mobile-preview/integration/ui-brief-preservation.test.cjs`: ค่า price เป็นเลข 0 และ uw เป็นเลข 100 กลับเป็นข้อความหลังอ่านฟอร์ม แม้แก้เฉพาะแบรนด์; รายการข้อความเดิมอาจถูกตัดช่องว่างโดยไม่ตั้งใจ
- สาเหตุ: อ่านข้อมูลจากฟอร์มเป็นข้อความทุกช่องและแปลงรายการข้อความทุกครั้งโดยไม่เปรียบเทียบค่าที่แสดงกับข้อมูลต้นฉบับ
- แก้เฉพาะฟอร์มแก้ไขจำลองให้คงค่าและชนิดเดิมเมื่อผู้ใช้ไม่เปลี่ยนช่อง รวมรายการข้อความ; การล้างช่องโดยตั้งใจและรายการที่แก้ยังส่งตามข้อมูลที่กรอก
- ตรวจผ่าน: ชุดทดสอบคงค่าบรีฟรวมบันทึกโดยไม่แก้แล้วไม่ล้างอนุมัติจำลอง, ชุดคงข้อมูลสาร, โมเดล, Excel และจำลองการบันทึก; ในเบราว์เซอร์แก้แบรนด์ตัวอย่างและบันทึกได้
- ข้อจำกัด: ยังไม่ยืนยันชนิดและกติกาของค่าที่เปลี่ยนกับระบบเดิม ตัวเชื่อมยังห้ามเขียนข้อมูลจริงจนแก้ประเด็น session, สูตร และ อย.

### หลักฐานเพิ่มเติม — ฟอร์มบรีฟแก้น้ำหนักแต่คงผลคำนวณเดิม

- `runtime-job-save.gateway.test.cjs` ใช้โค้ดอ่านฟอร์มมือถือจริงกับข้อมูลสมมติ แก้น้ำหนัก 100 → 120 ขณะที่ความเข้มข้น 50 พบว่าน้ำหนักเป็นข้อความและ `actual` ยังคง 50; ตัวกลางทดลองรับข้อมูล แต่ตัวแสดงผลเดิมไม่สามารถแสดงแถวได้
- เพิ่มข้อความในฟอร์มตัวอย่างแจ้งข้อจำกัด ยังไม่ได้แก้การบันทึกจริงหรือกำหนดกฎ อย. โดยพลการ ต้องให้เจ้าของงานยืนยันกติกาข้อมูลและ baseline ก่อนสร้างตัวแปลงและทดสอบ workflow ครบ

## 2026-10-28 — Excel หลังอนุมัติจำลองไม่มีคอลัมน์ครบ

- ทำซ้ำ: `node mobile-preview/workbook.test.cjs` เปรียบเทียบหัวคอลัมน์กับ `CHAT_XLS_HEAD` จากสำเนาระบบเดิม ก่อนแก้พบว่าขาดคอลัมน์ต่อท้ายรวมตลาด ประเทศ และสารหลัก
- สาเหตุ: ตัวส่งออกหน้าทดลองสร้างเฉพาะหัวคอลัมน์ชุดแรก จึงไม่ส่งข้อมูลที่เพิ่งเพิ่มไปยังไฟล์หลังอนุมัติ
- แก้เฉพาะไฟล์ตัวอย่างให้มีหัวคอลัมน์ตามลำดับในสำเนา ใส่ข้อมูลที่มีและใช้ป้ายอนุมัติจำลอง ช่องประวัติที่ไม่มีข้อมูลเว้นว่าง อย. ยังระบุว่ายังไม่ตรวจ
- ตรวจด้วยชุด workbook และเปิดไฟล์ข้อมูลสมมติด้วย openpyxl ผ่าน; ยังไม่ได้ยืนยันรูปแบบกับระบบใช้งานจริงหรือให้เจ้าของงานรับรอง

## 2026-10-28 — ตรวจการเปลี่ยนรอบ session กับ gateway รุ่น GitHub และฐานจำลอง

- จำลองการเปลี่ยนบทบาทในตัวส่งหลังตัวเชื่อมตรวจรอบและก่อนส่ง: ผลสถานะฝั่งตัวเชื่อมไม่ยืนยัน แต่คำขอผ่าน gateway/PostgREST และเขียน PostgreSQL ชั่วคราว; ก่อนส่งถ้ารอบไม่ตรง ตัวส่งไม่ถูกเรียกและข้อมูลเดิมคงอยู่
- หลักฐาน `mobile-preview/integration/run-current-approval-e2e.py`: 4/4 ผ่าน รวม 2 กรณี session; ใช้ central user ID จำลองเดิมและเปลี่ยนบทบาท เป็นการจำลองแบบควบคุม ไม่ใช่การทดสอบบัญชีจริงหรือคุกกี้เบราว์เซอร์
- ยังไม่แก้ authentication หรือระบบจริง ต้องรอ System Owner อนุมัติต้นแบบและ baseline ตาม `SESSION_BOUNDARY_PROPOSAL.md`; ห้ามใช้ตัวเชื่อมนี้เขียน production

### หลักฐาน session สองผู้ใช้จำลอง

- ใช้ gateway commit คงที่และ PostgreSQL ชั่วคราวผ่าน PostgREST โดยปรับเฉพาะ fake IAM ใน test harness ชั่วคราวให้รับผู้ใช้สมมติสองคน
- เปลี่ยนเป็นผู้ใช้อีกคนหลัง client ตรวจรอบก่อนส่ง: บัญชี Admin จำลองทำให้คำขอบันทึกแม้ client ไม่ยืนยันผล; บัญชี RA จำลองถูกปฏิเสธโดยข้อมูลไม่เปลี่ยน
- `run-current-approval-e2e.py` ผ่าน 6/6; ไม่ใช่การทดสอบคุกกี้เบราว์เซอร์ บัญชีจริง หรือ production และยังไม่แก้ session binding

### หลักฐานจาก Chromium profile จำลอง

- เพิ่ม browser harness โหลดตัวเชื่อมมือถือเดิม หยุดระหว่าง precheck กับ fetch แล้วเปลี่ยนคุกกี้ผู้ใช้จำลอง ตรวจว่า relay รับคุกกี้ผู้ใช้ใหม่ก่อนส่ง gateway และฐานข้อมูลชั่วคราวถูกบันทึก ขณะที่ client รายงานไม่ยืนยันผล
- รอบแรก test harness อ่านผลตอบ CDP ผิด; ปรับให้ตรวจคุกกี้ที่เบราว์เซอร์เก็บจริง ชุดอนุมัติ/session `run-current-approval-e2e.py` ผ่าน 7/7
- การทดลองควบคุมด้วยเครื่องมือ ไม่ใช่ flow ล็อกอินหน้ามือถือจริงและไม่ใช้ข้อมูล/บัญชี production ยังไม่ได้แก้ session binding และยังรออนุมัติ

## 2026-10-28 — ไฟล์ Excel ตัวอย่างอาจถูกตัดแถวท้ายโดยไม่แจ้ง

- ทำซ้ำด้วยไฟล์สมมติที่มีงานแถว 2 และอีกงานแถว 1005 โดยเว้นช่องระหว่างกลาง: ก่อนแก้ตัวอ่านเห็นเฉพาะงานแรกและไม่แจ้งว่ามีข้อมูลท้ายไฟล์ ชีตสารของไฟล์งานเดียวมีอาการเดียวกัน
- สาเหตุ: ตัวอ่านจำกัดจำนวนแถวที่อ่านเพื่อจำกัดขนาด แต่ตรวจเฉพาะข้อมูลที่อ่านแล้ว ไม่ตรวจช่วงเต็มของชีตที่ตัวอ่านรายงาน
- แก้ในหน้าทดลองให้ปฏิเสธเมื่อช่วงเต็มของชีตที่เกี่ยวข้องไปถึงแถว 1003 หรือหลังจากนั้น เพื่อไม่สร้างข้อมูลไม่ครบ แทนการพยายามอ่านไฟล์ทั้งหมด
- หลักฐาน: กรณี XLSX หลายงานและงานเดียว รวม XLS หลายงาน ล้มเหลวก่อนแก้และผ่านหลังแก้ใน `node mobile-preview/workbook.test.cjs`; ชุดโมเดลและจำลองการบันทึกผ่าน
- ข้อจำกัด: ช่วงชีตที่ยาวเพราะรูปแบบเซลล์ แม้ข้อมูลท้ายว่าง อาจถูกปฏิเสธ ต้องแบ่งไฟล์หรือลบช่วงส่วนเกิน; ไม่ยืนยัน Excel ทุกรุ่นหรือความเข้ากันได้กับระบบจริง

## 2026-10-28 — CSV ตัวอย่างข้ามข้อมูลและล้างรายการรอตรวจเมื่ออ่านไม่สำเร็จ

- ทำซ้ำด้วย CSV สมมติที่มีชื่อลูกค้าและข้อมูลในช่องไม่รู้จัก ก่อนแก้ตัวอ่านไม่แจ้งและละข้อมูลนั้น; หัวข้อซ้ำและแถวสารไม่มีชื่อก็ถูกเขียนทับหรือข้าม
- ทำซ้ำใน harness ของตัวจัดการนำเข้า: เมื่อนำเข้าไฟล์ที่ไม่ผ่าน หลังจากมีรายการหลายงานรอตรวจ ตัวจัดการล้างรายการเดิมก่อนตรวจไฟล์ใหม่
- แก้หน้าทดลองให้ปฏิเสธข้อมูลในช่องไม่รองรับ หัวข้อซ้ำ แถวสารไม่มีชื่อหรือคอลัมน์สารเกิน และรักษาฟอร์มกับรายการรอตรวจเมื่ออ่านไฟล์ใหม่ไม่สำเร็จ
- หลักฐาน: `node mobile-preview/test.cjs`, `workbook.test.cjs`, `integration/csv-import-state.test.cjs`, `integration/ui-save-simulation.test.cjs`, `integration/ui-brief-preservation.test.cjs` ผ่าน กรณีตรวจจับข้อมูลสูญหายและการรักษารายการรอตรวจล้มเหลวก่อนแก้
- ข้อจำกัด: รูปแบบ CSV บางแบบที่มีช่องเพิ่มจะถูกปฏิเสธ ต้องตรวจไฟล์และปรับแม่แบบ ยังไม่ได้ยืนยันกับไฟล์จริงหรือระบบ production

## 2026-10-28 — ไฟล์ที่อ่านช้ากว่าเขียนทับฟอร์มจำลอง

- ทำซ้ำด้วยตัวจัดการนำเข้าและไฟล์สมมติ: เลือกไฟล์แรกให้รอ แล้วเลือกไฟล์ที่สองซึ่งอ่านเสร็จก่อน; เมื่อไฟล์แรกอ่านเสร็จทีหลัง ค่าของไฟล์แรกเขียนทับฟอร์มที่มีค่าล่าสุด
- สาเหตุ: หลังรอการอ่านไฟล์ ไม่มีการตรวจว่าผู้ใช้เลือกไฟล์อื่น แก้ฟอร์ม หรือออกไปเปิดฟอร์มใหม่แล้ว
- แก้เฉพาะหน้าทดลองให้ตรวจลำดับไฟล์ ตัวตนของฟอร์ม และการแก้ไขระหว่างอ่าน หากมีการแก้ระหว่างรอจะแจ้งให้เลือกไฟล์อีกครั้ง และไม่ทับข้อมูล
- หลักฐาน: `integration/csv-import-state.test.cjs` ทดสอบ CSV/Excel ที่อ่านเสร็จสลับลำดับ ข้อผิดพลาดเก่า การแก้ฟอร์มและการเปลี่ยนฟอร์ม; กรณีลำดับไฟล์ล้มเหลวก่อนแก้ และชุดนี้พร้อมโมเดล, workbook และจำลองการบันทึกผ่านหลังแก้
- ข้อจำกัด: ทดสอบใน harness ด้วยข้อมูลสมมติ ยังไม่ได้ทดสอบไฟล์ขนาดใหญ่บนอุปกรณ์จริง และไม่เกี่ยวข้องกับการเชื่อมฐานข้อมูลจริง

## 2026-10-28 — รีโหลดอาจทำให้ข้อมูลหน้าทดลองหายโดยไม่เตือน

- หน้าทดลองเก็บข้อมูลในหน่วยความจำ จึงสูญหายเมื่อรีโหลด แต่เดิมมีคำเตือนเฉพาะการย้ายหน้าภายในแอป
- เพิ่มการขอให้เบราว์เซอร์เตือนเมื่อมีร่างค้างหรือข้อมูลจำลองเปลี่ยน แม้กดบันทึกในตัวอย่างแล้ว
- หลักฐาน: `integration/unload-guard.test.cjs` ตรวจเงื่อนไขร่าง ข้อมูลเปลี่ยน และสถานะเริ่มต้น; `integration/unload-native.test.mjs` ตรวจ Chrome จริงว่าปรากฏคำเตือนและยกเลิกรีโหลดเพื่อรักษาฟอร์ม รวมถึงเตือนหลังบันทึกข้อมูลจำลอง
- ข้อจำกัด: เบราว์เซอร์หรือระบบมือถืออาจไม่แสดงคำเตือน โดยเฉพาะเมื่อระบบปิดแอป การแก้นี้ไม่ได้เพิ่มการบันทึกถาวร และยังไม่ได้ตรวจบนอุปกรณ์จริง

## 2026-10-28 — เลือกไฟล์นำเข้าเดิมซ้ำหลังอ่านไม่สำเร็จ

- ตรวจตัวจัดการนำเข้าในหน้าทดลอง พบว่าช่องเลือกไฟล์ยังเก็บชื่อไฟล์เดิมหลังอ่านไม่ผ่านหรือฟอร์มเปลี่ยนระหว่างอ่าน ซึ่งทำให้การเลือกไฟล์เดิมซ้ำอาจไม่เกิดเหตุการณ์เปลี่ยนไฟล์
- ทดสอบด้วยตัวจัดการจำลอง: การตรวจว่าช่องพร้อมเลือกไฟล์เดิมล้มเหลวก่อนแก้ จึงแก้ให้ล้างช่องหลังเก็บไฟล์ที่เลือก โดยยังคงตัวไฟล์ไว้สำหรับอ่านและไม่ล้างฟอร์ม
- หลังแก้ `integration/csv-import-state.test.cjs` ผ่านทั้งไฟล์ไม่ผ่าน ฟอร์มเปลี่ยนและเลือกไฟล์ใหม่; `integration/import-retry-native.test.mjs` ผ่านใน Chrome โดยเลือกไฟล์จำลองที่ไม่ผ่านไฟล์เดิมสองครั้ง และตรวจว่าเกิดเหตุการณ์ทั้งสองครั้ง ชุดโมเดล workbook และการรักษาข้อมูลบรีฟผ่าน
- ข้อจำกัด: ใช้ไฟล์จำลองในเครื่อง ยังไม่ได้ทดสอบตัวเลือกไฟล์บน Android หรือไฟล์ธุรกิจจริง และไม่เปลี่ยนการเชื่อมต่อระบบจริง

## 2026-10-28 — ขอบเขตการนำเข้าทับฟอร์มไม่ชัดเจน

- เมื่อเปิดแก้งานเดิมแล้วนำเข้าไฟล์งานเดียว ระบบแทนเฉพาะช่องที่มีในไฟล์ แต่แทนรายการสารทั้งชุด แม้ไฟล์ไม่มีสาร และเดิมไม่ถามยืนยันหากยังไม่ได้แก้ฟอร์มในหน้านั้น
- ชุด `integration/csv-import-state.test.cjs` ตรวจคำยืนยันในสถานการณ์นี้และล้มเหลวก่อนแก้ เพราะไม่มีคำถามปรากฏ แก้ให้ถามทั้งเมื่อมีการแก้ฟอร์มหรือเปิดงานเดิม พร้อมอธิบายผลต่อช่องและรายการสารในหน้าและคำถาม
- หลังแก้ชุดดังกล่าวผ่าน และ `integration/import-edit-native.test.mjs` ผ่านใน Chrome: ยกเลิกแล้วลูกค้าและสารเดิมยังอยู่; ยืนยันแล้วลูกค้าเปลี่ยน แบรนด์ที่ไม่มีในไฟล์คงเดิม และรายการสารถูกแทนตามคำอธิบาย ชุดโมเดล workbook การรักษาบรีฟ และการทดลอง 8 บทบาทผ่าน
- ข้อจำกัด: พฤติกรรมยังเป็นตัวอย่างข้อมูลจำลอง ไม่ใช่การยืนยันรูปแบบนำเข้าระบบเดิม ยังไม่ได้ทดสอบ Android หรือไฟล์ธุรกิจจริง

## 2026-10-28 — ผลบันทึกจำลองที่กลับช้าอาจทำให้ฟอร์มใหม่หาย

- หน่วงผลตัวจำลองใน Chrome แล้วแก้ฟอร์มสร้างงานระหว่างรอ: ก่อนแก้หน้าจอย้ายไปแสดงข้อมูลจากตอนกดบันทึกและค่าที่แก้ภายหลังหาย ชุด `integration/save-inflight-native.test.mjs` ล้มเหลวก่อนแก้
- เพิ่มการตรวจว่าฟอร์มยังเป็นหน้าเดิมและไม่มีการแก้หรือนำเข้าระหว่างรอ ก่อนนำผลจำลองไปใช้ หากฟอร์มเปลี่ยนให้คงข้อมูลและแจ้งให้ตรวจอีกครั้ง หากออกจากหน้าแล้วไม่เปลี่ยนหน้าหรือข้อมูลจากผลจำลองที่กลับมาภายหลัง
- หลังแก้ ทดสอบ Chrome ผ่านทั้งสร้างงาน แก้สูตร เปลี่ยนบทบาทก่อนผลกลับ และนำเข้าแบบหลายงานระหว่างรอ; ชุด 8 บทบาท โมเดล การนำเข้าและรักษาแถวสารผ่าน
- ข้อจำกัด: เป็นการหน่วงตัวจำลองในหน้า ไม่มีการส่งจริง การตรวจฝั่งหน้าจอไม่ยกเลิกหรือพิสูจน์ผลการเขียนที่บริการจริง หากเชื่อมบริการในอนาคตต้องออกแบบการติดตามผลและ session ร่วมกับตัวกลางก่อน ห้ามใช้พฤติกรรมนี้เป็นหลักฐานว่าไม่มีการเขียนข้อมูลจริง

## 2026-10-28 — อ่านรายการงานอย่างเดียวไม่บอกว่าคิวบันทึกขัดแย้ง

- ทดสอบตัวเชื่อมมือถือกับ gateway จากชุดส่งมอบและบริการ/บัญชีสมมติใน localhost: ปิดฐานข้อมูลจำลอง ส่งสร้างงานเดียวกันซ้ำ และส่งรหัสเดิมด้วยข้อมูลอีกชุด ก่อนเปิดฐานข้อมูลจำลอง
- คำขอเดิมซ้ำใช้ใบรับเดียวกัน แต่คำขอข้อมูลต่างกันทำให้ใบรับทั้งสองเป็น conflict และไม่มีการเขียน ขณะที่ `reconcileSave` อ่านไม่พบรายการและคืน `pending` ทั้งคู่ โดยไม่ได้ส่งบันทึกซ้ำ
- รอบแรกชุดทดสอบตั้งสมมติฐานว่าจะมีคำขอหนึ่งชนะ จึงไม่ผ่าน; ตรวจชุดทดสอบ gateway เดิมพบว่าการหยุดทั้งสองเป็นพฤติกรรมที่ออกแบบไว้ แก้ความคาดหวังตามหลักฐานแล้ว `runtime-job-save.gateway.test.cjs` ผ่าน 9/9
- ข้อจำกัด: `pending` บอกเพียงข้อมูลยังไม่ตรง ไม่ยืนยันว่าคิวกำลังทำงาน หน้าทดลองยังไม่ใช้ฟังก์ชันนี้ ต้องออกแบบการติดตามใบรับที่จำกัดสิทธิ์และตรวจรุ่นระบบก่อนเชื่อม ไม่เปลี่ยน gateway หรือสิทธิ์จริงในรอบนี้

## 2026-10-28 — ตัวเลขที่ไม่เป็นค่าจำกัดถูกแปลงเป็นค่าว่าง

- จำลองส่งค่าตัวเลข NaN และบวก/ลบอนันต์ในรายการสารเข้า `prepareSave`: ก่อนแก้การคัดลอกข้อมูลด้วย JSON แปลงค่าเป็น null โดยไม่แจ้ง ชุด `runtime-job-save.test.cjs` ที่คาดให้ปฏิเสธจึงล้มเหลว
- ปรับตัวเชื่อมจำลองให้ตรวจตัวเลขทุกระดับก่อนแปลงข้อมูล และแจ้งข้อผิดพลาดก่อนส่งหรือตรวจอ่าน ค่าศูนย์ยังผ่านตามเดิม โดยไม่ได้ตัดสินกติกาความเข้มข้นศูนย์ทางธุรกิจ
- หลังแก้ ชุดตัวเชื่อม สถานการณ์บันทึก โมเดล 8 บทบาท และ gateway จำลอง 9/9 ผ่าน รวมกรณีข้อมูลตั้งต้นและข้อมูลส่งที่มีตัวเลขผิดปกติ โดยยืนยันว่าไม่ได้เรียกตัวส่ง
- ข้อจำกัด: เป็นการป้องกันในตัวเชื่อมตัวอย่าง ไม่ใช่การตรวจครบทุกชนิดข้อมูลหรือหลักฐานการเชื่อมระบบจริง ยังต้องแก้ความเข้ากันได้กับระบบเดิมและทดสอบสิทธิ์ก่อนใช้งานจริง

## 2026-10-28 — แก้ข้อความคอนเซปแต่ข้อมูลที่สร้างจากคอนเซปยังเป็นของเดิม

- ตรวจ `generateDash` ในสำเนาเว็บเดิม: ขณะสร้างหรือแก้บรีฟ มีการสร้างรายการคอนเซป สรรพคุณและจุดขายจากการเลือกคอนเซปและชุดข้อมูลในโค้ดเดิม ส่วนตัวอ่านฟอร์มมือถือแก้ข้อความคอนเซปแต่ไม่ได้สร้างช่องเหล่านั้นใหม่
- ชุด `integration/runtime-job-save.gateway.test.cjs` ใช้ตัวอ่านฟอร์มจริงกับงานสมมติที่มีข้อมูลคอนเซปเดิม ส่งผ่านตัวกลางและฐานข้อมูลจำลอง: ตัวกลางตอบ saved ขณะที่ข้อความคอนเซปเปลี่ยน แต่รายการคอนเซป สรรพคุณและจุดขายยังคงเดิม ชุดรวมผ่าน 10/10 โดยกรณีนี้เป็นการยืนยันช่องว่าง ไม่ใช่การยืนยันว่าปลอดภัย
- ข้อจำกัด: ไม่ยืนยันพฤติกรรมรุ่นที่ deploy หรือการใช้งานจริง ยังไม่ได้แก้กติกาหรือคัดลอกฐานความรู้ ต้องยืนยันแหล่งข้อมูลและวิธีประมวลผลที่เป็นเจ้าของเดียวก่อนเชื่อมระบบ

### มาตรการชั่วคราวในตัวเชื่อมจำลอง

- เพิ่มการหยุดก่อนส่งเมื่อข้อความคอนเซปเปลี่ยนในงานเดิมที่มี `allConcepts` หรือ `allSP` และแจ้งให้ตรวจในระบบเดิม ตรวจซ้ำทั้งตอนเตรียมและก่อนส่งคำขอโดยตรง โดยไม่สร้างสรรพคุณหรือจุดขายแทน
- `runtime-job-save.test.cjs` ล้มเหลวก่อนเพิ่มการป้องกันและผ่านหลังแก้ รวมกรณีส่งตรง แก้ช่องอื่น และงานตัวอย่างที่มีสรรพคุณกรอกเอง; gateway จำลองผ่าน 10/10 และ Chrome ผ่านการเดินงาน 8 บทบาท
- เป็นมาตรการจำกัดชั่วคราว ไม่พิสูจน์ว่างานที่ไม่มีช่องดังกล่าวเข้ากันได้ และไม่แก้รูปแบบสาร สถานะ อย. หรือกติกาในระบบจริง ต้องยืนยันแหล่งข้อมูลและพัฒนาการแก้คอนเซปให้ครบต่อไป

## 2026-10-28 — โฟกัสแป้นพิมพ์หลุดจากเมนูซ้าย

- เมนูบังหน้าหลักแต่เดิมไม่มีการระบุว่าเป็นหน้าต่างเมนูแบบปิดทับ และไม่มีการจำกัดโฟกัสแป้นพิมพ์ จึงอาจเลื่อนไปยังส่วนที่ถูกบังได้ ชุด `integration/drawer-keyboard-native.test.mjs` ล้มเหลวก่อนแก้เมื่อไม่พบสถานะหน้าต่างเมนู
- ปรับเมนูให้ระบุสถานะหน้าต่างปิดทับ ปิดการโต้ตอบกับพื้นหลังเมื่อเปิด วน Tab ภายในเมนู และคืนโฟกัสให้ปุ่มเปิดเมื่อกด Escape หรือปิดเมนู
- ทดสอบ Chrome ผ่าน Shift-Tab/Tab/Escape การเปิดและคืนพื้นหลัง พร้อมตรวจความกว้างที่จำลอง 320 พิกเซล; ชุดเดินงาน 8 บทบาทผ่าน และตรวจภาพเมนูในเบราว์เซอร์
- ข้อจำกัด: ยังไม่ได้ทดสอบโปรแกรมอ่านหน้าจอหรืออุปกรณ์มือถือจริง และการตรวจนี้ไม่ใช่การรับรองการเข้าถึงทั้งหมด

## 2026-10-28 — บรีฟเก็บค่าคำนวณสารเก่าหลังแก้ปริมาณ

- ทำซ้ำด้วยแถวสมมติ น้ำหนัก 100 ความเข้มข้น 50 และผล 50: เมื่อแก้น้ำหนักเป็น 120 ตัวอ่านบรีฟเดิมยังเก็บผล 50 ขณะที่หน้าสูตรคำนวณใหม่ ชุด `ui-row-preservation.test.cjs` ล้มเหลวก่อนแก้
- ให้ตัวอ่านบรีฟคำนวณตามสูตรตัวอย่างเดิมเมื่อปริมาณหรือความเข้มข้นเปลี่ยน หากข้อมูลไม่ครบเก็บผลเป็น null; แถวที่ไม่ได้แก้และข้อมูลประกอบอื่นคงเดิม
- หลังแก้ ชุดรักษาแถวผ่าน รวมทั้งกรณีความเข้มข้นว่าง; `brief-calculation-native.test.mjs` ตรวจใน Chrome ว่าแก้น้ำหนักแล้วข้อมูลและหน้าจอแสดง 60; workbook, โมเดล 8 บทบาท และ gateway จำลอง 10/10 ผ่าน
- ข้อจำกัด: การคำนวณเป็นตัวอย่าง ไม่ใช่การรับรองสูตรหรือ อย. ข้อมูล อย. เดิมยังไม่ได้ตรวจใหม่และชนิดน้ำหนักยังไม่เข้ากันกับตัวแสดงผลเดิม ต้องแก้และยืนยันก่อนเชื่อมระบบจริง

## 2026-10-28 — ตัวอ่านแชตทดลองไม่แยกประวัติที่ฝังในห้อง

- สำเนาระบบเดิมมีการอ่าน `data.messages` หากไม่มีข้อความในตารางแยก ตัวอ่านทดลองเดิมคืน `ready` พร้อมรายการตารางว่างแม้มีข้อความฝัง ชุด `runtime-chat-read.test.cjs` ล้มเหลวก่อนแก้
- เพิ่มสถานะ `legacy-history` เมื่อมีแต่ข้อความฝัง และ `requires-reconciliation` เมื่อมีทั้งสองแหล่ง โดยคืนข้อมูลทั้งสองชุดเพื่อตรวจต่อ และปฏิเสธรหัสงานหรือรหัสข้อความภายในที่ขัดแย้งกับแถว
- หลังแก้ชุดตัวอ่านผ่าน และทดลองผ่าน gateway กับ PostgreSQL ชั่วคราวทั้งสองสภาพ ชุดรวมผ่าน 18/18; ไม่มีข้อมูลหรือบัญชีจริง
- ข้อจำกัด: ยังไม่ได้รวม ลำดับ หรือเชื่อมประวัติเข้าหน้าจอ และไม่ได้ยืนยันกติกากับรุ่นที่ใช้งานจริง การรวมสองแหล่งต้องตรวจซ้ำและหลีกเลี่ยงข้อความซ้ำก่อนใช้งาน

## 2026-10-28 — การส่งข้อความรหัสเดิมด้วยข้อมูลต่างกัน

- ใน gateway commit `91d5fde5a17abf70d9ac5764b6b31529d69f913c` กับ PostgreSQL และ IAM สมมติ ส่งข้อความซ้ำเนื้อหาเดิมได้หนึ่งแถว แต่ส่งรหัสเดิมด้วยข้อความต่างกันทำให้แถวเดิมถูกเขียนทับ; การส่งรหัสเดิมไปงานอีกใบก็ทำให้ข้อมูลเดิมเปลี่ยน ชุด `run-current-approval-e2e.py` รอบตรวจ baseline จึงไม่ผ่าน 2 กรณีจาก 21
- ผู้ใช้อนุญาตให้ทดลองตัวป้องกันเฉพาะพื้นที่จำลอง จึงสร้าง `simulation/chat-id-guard.sql` เป็น fixture สำหรับฐานข้อมูลทิ้งหลังทดสอบเท่านั้น ไม่ใช่ migration และไม่เปลี่ยนระบบจริง
- ขณะรันทดสอบตัวป้องกัน พบข้อมูลจำลองคงข้อความแรกและมีเพียงหนึ่งแถวในการส่งพร้อมกัน แต่กระบวนการยังไม่จบและยังไม่มีผลทดสอบสุดท้าย จึงยังไม่ถือว่าผ่าน ต้องตรวจการล้างบริการและผลทดสอบก่อนสรุป
- ตรวจซ้ำแบบแยกกรณี: รายงานระหว่างรันทดสอบแสดง `ok` สำหรับการส่งเดิมซ้ำ การปฏิเสธข้อมูลต่างกันและการส่งพร้อมกัน แต่ชุดทดสอบยังไม่จบและไม่มีสรุปผลหรือรหัสออกที่สำเร็จ จึงยังไม่ถือว่าชุดทดสอบผ่าน สังเกตว่าบริการจำลองยังทำงานหลังกรณีทดสอบเสร็จ; ทดลองปรับการปิดบริการในสำเนาชุดทดสอบชั่วคราวแล้วอาการยังเกิด จึงนำการปรับที่พิสูจน์ไม่ได้ออกและยังไม่สรุปสาเหตุ
- หยุดชุดทดสอบที่ค้างและลบเฉพาะ container กับ network จำลองที่ตรวจชื่อและ image แล้วว่าเป็นของการทดสอบครั้งนั้น ไม่ได้แก้บริการจริง เพิ่มการเก็บผลรายงานในไฟล์ชั่วคราวเพื่อให้ตรวจกรณีที่ค้างได้
- ตรวจลำดับด้วยจุดบันทึกชั่วคราวพบว่าขั้นตอนปิดส่วนรวมทำงานก่อนกรณีที่เพิ่มภายหลัง ทำให้บริการจำลองถูกเปิดค้างในภายหลัง ชุดทดสอบเดิมมีการเตรียมข้อมูลแบบรอผลระหว่างการลงทะเบียนกรณี จึงปรับเฉพาะสำเนาชุดทดสอบให้เตรียมข้อมูลก่อนและจัดกรณีที่เลือกไว้ในชุดเดียวกับขั้นตอนเปิด/ปิดบริการ ไม่แก้ gateway หรือฐานข้อมูลจริง
- หลังปรับ `--chat-guard-only` จบด้วย exit 0 และผ่าน 1/1 กรณี ครอบคลุมส่งซ้ำเหมือนเดิม ข้อมูลต่างกัน งานต่างกัน และส่งพร้อมกัน; ชุดรวมจบด้วย exit 1 ผ่าน 20/22 โดยยังพบสองกรณี baseline ที่เขียนทับเนื้อหาและย้ายข้อความข้ามงานได้ตามเดิม และกรณีตัวป้องกันจำลองผ่าน ตรวจไม่พบ container ทดสอบที่ยังรันหลังจบ ทั้งสองผลเป็นหลักฐานเฉพาะข้อมูลจำลองและรุ่นที่ตรึงไว้
- ตรวจขอบเขตการลบเพิ่มเติมกับ gateway และ IAM สมมติ: บัญชี Sales เจ้าของงานที่ยังเปิดอยู่ถูกปฏิเสธเมื่อพยายามลบข้อความ ส่วน Admin สมมติลบข้อความได้ แล้ว Sales ส่งข้อความเนื้อหาใหม่โดยใช้รหัสเดิมได้ แม้เปิดตัวป้องกัน UPDATE อยู่ ชุดเฉพาะผ่าน 2/2 กรณี; ผลนี้อธิบายพฤติกรรมที่พบ ไม่ใช่การรับรองว่านโยบายดังกล่าวถูกต้องหรือใช้กับทุกบทบาท
- สำเนาหน้าเดิมมีขั้นตอนลบข้อความตามรหัสงานเมื่อซิงก์การลบห้องแชท (`sbDelete('fs_messages', 'job_id', chtDel)`) ดังนั้นการห้าม DELETE ทั้งหมดอาจกระทบการลบงานเดิม การตัดสินใจว่าจะห้ามใช้รหัสเดิมหลังลบ และวิธีรักษาหลักฐานโดยยังรองรับการลบงาน ต้องให้เจ้าของกระบวนการกำหนดก่อนออกแบบการเปลี่ยนแปลงถาวร
- ข้อจำกัด: ตัวป้องกันทดลองไม่ครอบคลุมการลบแล้วสร้างใหม่ และไม่ได้พิสูจน์การยืนยันตัวตน สิทธิ์ ผลแจ้งเตือน หรือรุ่นที่ deploy จริง การแก้ถาวรต้องทบทวนสิทธิ์ migration การย้อนกลับและผลต่อระบบเดิม
