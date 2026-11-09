# Formula Studio — Current State

วันที่ตรวจ: 2026-09-18
สถานะเอกสาร: Phase 0 discovery baseline
ระบบที่ระบุ: Formula / R&D Briefing (Phase 3)

## 1. ขอบเขตและหลักฐาน

การตรวจนี้เป็น read-only ต่อ application source, database schema, runtime และ deployment configuration ขอบเขตคือ repository ปัจจุบันเท่านั้น ไม่รวม repository หรือ database ของระบบอื่น

หลักฐานหลัก:

- `README.md:1-24,36-76` — ความสามารถ, role, auth และ data mode
- `CLAUDE.md:27-116` — ข้อจำกัด locked storage/schema contract
- `index.html:1-16,1142-1164` — static runtime, CSP, Supabase และ optional workspace configuration
- `index.html:2441-2547` — create/update record
- `index.html:3868-3925` — local record storage และ running id
- `index.html:4513-4560` — chat/approval storage
- `index.html:6045-6220,6268-6418,6855-6919` — Auth, sync, polling และ boot
- `supabase/schema.sql:7-62,340-690` — tables, RLS, guards, RPC และ policies
- `.github/workflows/verify.yml:1-41` — automated checks
- `RUNTIME_OPERATIONS.md:24-112`, `vercel.json:1-12`, `runtime/com.beyond-formula.runtime.plist:5-27` — serving/deployment
- `docs/AUDIT_2026-09-17.md:21-49` — prior read-only audit of brief/costing readiness

ตรวจซ้ำที่ baseline นี้:

- `node harness.js` — PASS, 56 passed / 0 failed
- `./tests/run-sql-tests.sh` — PASS, SQL authorization and rollback contract
- `git diff --check` — PASS

## 2. System identification

Repository นี้ตรงกับ **Formula / R&D Briefing** ใน Phase 3 ไม่ใช่ User Management Center, Central Job Core, OPC, Job Order, WMS หรือ KPI system โดยตรง

ขอบเขตธุรกิจที่พบจริงคือ:

```text
Customer/Sales brief
  -> Formula/R&D record
  -> PD/RA/RD/Sales collaboration in Chat
  -> approval/export/close
  -> optional handoff or private workspace integration
```

Phase 3 Architecture Pack กำหนด flow `Sales Brief -> Requirement Clarification -> RA/PD/RD Review -> Formula Ready -> OPC Handoff` และ reporting events เช่น Brief Created, Review Started, Requirement Completed, Formula Ready และ Handoff to OPC. Repository ปัจจุบันมีบางส่วนของ flow นี้ แต่ยังไม่มี explicit central handoff contract หรือ Formula-ready state ที่เป็น canonical field

## 3. Runtime and application architecture

| Area | Current state | Evidence |
|---|---|---|
| Runtime | Static HTML served unchanged; no build step | `README.md:5-7`, `CLAUDE.md:1-4` |
| Framework | Vanilla HTML/CSS/JavaScript in one `index.html` | `CLAUDE.md:3`, repository tree |
| Browser state | local-first `localStorage`; tab/session auth in `sessionStorage` when secure mode is on | `CLAUDE.md:54-68`, `index.html:6090-6118` |
| Server sync | Optional Supabase REST/Auth sync, polling every 5 seconds | `index.html:1148-1150`, `index.html:6268-6418`, `6855-6883` |
| Optional extension | Session-bound private workspace manifest/bundle loader; disabled when origin is empty | `index.html:1152-1164`, `6690-6825` |
| Core dependency | Core formula runtime does not require AI or a build service | `CLAUDE.md:8` and static runtime design |
| UI | Dashboard, Customer Data, job detail, Chat Message, Activities log, export/import and user UI | `README.md:9-18`, `index.html` views |

## 4. Current data model and source of truth

### Browser contract

The locked browser keys are `fs_records`, `fs_reccounter`, `fs_user`, `fs_userlist`, `fs_chats`, `fs_activities` and `fs_imp`; optional sync/outbox keys are also defined in `CLAUDE.md:54-68`. Existing data must remain backward compatible.

The principal local objects are:

- `record`: local job/brief object with `id`, timestamps, creator/updater, customer/brand, sales owner, product/spec fields, ingredient `rows`, notes and optional `closed` marker (`CLAUDE.md:70-81`)
- `user`: name, role, email and legacy `pass` compatibility field (`CLAUDE.md:83-86`)
- `chat`: `jobId`, timestamps, messages, parts and approvals (`CLAUDE.md:88-92`)
- `activity`: timestamp/display time, user, role, category, action, detail, job and impersonation marker (`CLAUDE.md:94-97`)

The local job identifier is generated in the format `A00001` and must not be renamed or reused (`CLAUDE.md:38-45`, `supabase/schema.sql:200-201,247-248`). It is currently a local/legacy identifier, not proven to be a central ERP job identifier.

### Supabase contract

Supabase preserves the locked JSON shape in `data jsonb` rather than normalizing the record into columns (`supabase/schema.sql:7-60`, `CLAUDE.md:101-113`). Current tables are:

| Table | Purpose | Current authority |
|---|---|---|
| `fs_records` | Formula/customer records | Formula Studio record projection |
| `fs_chats` | Backward-compatible chat projection | Formula Studio chat projection |
| `fs_chat_events` | Append-only chat event store | Server-stamped chat event history |
| `fs_chat_reads` | Per-user chat read marker | User-specific read state |
| `fs_users` | Legacy-compatible user JSON | Application user projection; not Auth authority |
| `fs_memberships` | Auth user UUID, name, role, active flag | Secure-mode authorization source |
| `fs_activities` | Append-only activity rows | Admin-visible application activity log |
| `fs_meta` | Running counter and metadata | Formula Studio metadata |

The database uses RLS, forced RLS, trigger guards, server-stamped chat actors and RPC-only chat event writes (`supabase/schema.sql:340-379,381-586,616-688`).

## 5. Current data flow

```text
Browser UI
  -> localStorage locked objects
  -> optional local outbox/snapshot
  -> Supabase Auth (secure mode)
  -> Supabase REST/RPC + RLS
  -> local merge/persist/render
```

Secure boot restores an Auth session, resolves active membership, pulls records/chats/users/meta/activity, applies a merge, then pushes local deltas and starts polling (`index.html:6855-6889`). Chat events use the append RPC and are not direct-upserted to the legacy `fs_chats` projection in secure mode (`index.html:6459-6576`, tests/formula-studio.test.js chat sync tests).

## 6. Identity, authentication and authorization

- Secure authentication is Supabase Auth email/password; session data is kept in `sessionStorage`, not `localStorage` (`README.md:36-41`, `index.html:6090-6178`).
- Authorization is separate from authentication and is based on active `fs_memberships` plus database RLS/guards (`index.html:6180-6208`, `supabase/schema.sql:69-97,616-688`).
- Secure mode does not offer browser-side first-admin creation or password reset; membership management is Dashboard/Owner controlled (`README.md:15-17`, tests/formula-studio.test.js).
- Roles present are Admin, PD, RA, RD, Sales, OPC, MKT and Purchasing (`README.md:20-34`).
- Local-only mode retains legacy browser identity/`pwHash()` compatibility; this is not a central IAM source and must not be used as the long-term ERP identity model.
- `auth.users.id` exists as `fs_memberships.user_id`, but no `central_user_id` field exists in the locked record, chat or activity JSON contracts.

## 7. Workflow and operational model

Current workflow evidence:

1. Create/update a customer/product/formula brief record.
2. Assign a Sales owner using the local `salesOwner` field.
3. Open a per-job Chat room with messages, participant parts and PD/RA/RD/Sales approvals.
4. Log user actions in `fs_activities`.
5. Export brief/chat data and optionally close/reopen the job.

The job lifecycle is currently represented by the optional `closed` object and UI-derived active/closed views, not by a canonical `stage` and `status` pair. Approval states live in the Chat object. Existing audit evidence also shows that current approval is not equivalent to CEO commercial quotation approval (`docs/AUDIT_2026-09-17.md:95-101`).

## 8. Integration and deployment

### Existing integrations

- Supabase Auth, REST, RPC and RLS are the only evidenced shared backend integration.
- The optional private workspace integration asks an allowed origin for a manifest and bundle after membership/role checks; it is an adapter boundary, not a documented ERP contract (`index.html:6690-6825`).
- No direct OPC, Job Order, WMS, IAM Center or Reporting API client is present in the repository based on source/config inspection.

### Serving and release

- Vercel configuration serves the static site with revalidation headers (`vercel.json:1-12`).
- A local macOS launchd/Python HTTP server is configured for `127.0.0.1:4173` (`runtime/com.beyond-formula.runtime.plist:5-27`, `RUNTIME_OPERATIONS.md:27-51`).
- Controlled deploy/rollback scripts require a clean tree and approved commit; runtime files must not be used to patch application source (`RUNTIME_OPERATIONS.md:61-99`).
- GitHub Actions runs deterministic browser and PostgreSQL/RLS checks on pull requests (`.github/workflows/verify.yml:1-41`).
- `.github/CODEOWNERS:1-10` requires independent owner review, especially for `index.html`, `supabase/`, runtime and workflow paths.

## 9. Reporting readiness against Shared Architecture Contract

| Contract field | Current evidence | Assessment |
|---|---|---|
| `central_job_id` | Not found in source/schema | GAP |
| `central_user_id` | Not found in application JSON; Auth UUID only in membership table | GAP |
| `source_system` | Not found in record/activity contract | GAP |
| `source_record_id` | Not found as a distinct field | GAP |
| `owner_user_id` | Human-readable `salesOwner`; no canonical user ID | PARTIAL |
| `assignee_user_id` | No generic assignee field found | GAP |
| `stage` | No canonical job stage field | GAP |
| `status` | `closed` and approval state exist; no canonical job status | PARTIAL |
| `actor_user_id` | Activity actor is human-readable `user`; secure Auth UUID is not emitted into the event shape | PARTIAL |
| `event_type` | Activity `cat/action` and chat event `type/action` exist | PARTIAL |
| `event_at` | Activity/chat timestamps exist | PASS for local events |
| `duration` | Chat participant `activeMs` exists; no canonical workflow duration | PARTIAL |
| `delay_reason_code` / `delay_remark` | Not found | GAP |

Conclusion: the repository has useful raw activity/chat data for later reporting, but it is not yet conformant to the shared cross-system reporting contract.

## 10. Known boundaries and non-findings

- No production data was read.
- No other repository or external database was modified.
- The publishable Supabase key is static browser configuration; this baseline does not treat it as a service secret. Privileged keys must remain absent from browser/repository per project governance.
- The untracked `cost calculator by project/` directory was not treated as the Formula Studio runtime or modified by this baseline.
