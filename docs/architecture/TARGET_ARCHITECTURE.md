# Formula Studio — Target Architecture

สถานะ: proposed target only; ยังไม่ใช่ implementation และไม่เปลี่ยน locked storage/schema contract

## 1. Target role

Formula Studio เป็น **Formula/R&D domain service/UI** ใน Phase 3 ทำหน้าที่รับ Sales Brief, ทำ requirement/formula collaboration, เก็บ Formula-owned evidence และส่ง handoff ไป OPC ผ่าน contract ที่ตรวจสอบย้อนกลับได้

ระบบนี้ไม่ควรเป็นเจ้าของ:

- enterprise identity/permission master — เป็นหน้าที่ Central IAM
- central job master — เป็นหน้าที่ Central Job & Activity Core
- OPC execution/production state — เป็นหน้าที่ OPC
- WMS/production execution — เป็นหน้าที่ WMS/Job Order
- KPI calculation — เป็นหน้าที่ Reporting Layer

## 2. Target logical architecture

```text
User Browser / Formula UI
        |
        | AuthN: SSO/approved Auth boundary
        | AuthZ: Central IAM membership/claims
        v
Formula Domain Adapter
  - legacy record reader/writer
  - identity mapping
  - state transition/event adapter
  - attachment metadata adapter
        |
        +--> Formula-owned PostgreSQL/JSON contract
        |
        +--> Central Job API/Event contract
        |
        +--> OPC handoff API/Event contract
        |
        +--> Reporting event stream/projection
        |
        +--> Object Storage attachment references
```

Core Formula runtime must remain deterministic and useful without AI or external quota. AI, if added later, is advisory and must not be the source of state, permission, approval or calculation truth.

## 3. Canonical identity strategy

Do not replace legacy IDs immediately. Use additive mapping:

| Concept | Target field | Current legacy value | Authority |
|---|---|---|---|
| User | `central_user_id` | OPC Workflow `public.users.id` (Formula keeps a compatibility reference) | Central IAM, sourced from OPC Workflow |
| Formula job | `central_job_id` | `record.id` such as `A00001` | Central Job Core |
| Formula record | `source_system=formula` + `source_record_id` | `record.id` | Formula Studio |
| Formula revision | `formula_id`, `formula_revision` | current record/formula fields | Formula domain owner |
| Actor | `actor_user_id` | activity `user` | Central IAM mapping |

Required behavior:

- legacy IDs remain readable and remain stable;
- mappings are explicit, unique and auditable;
- unknown/unmapped IDs are marked `PENDING_MAPPING`, never guessed;
- no downstream system reads Formula's database directly;
- mapping operations are idempotent and replayable.

## 4. Target state model

The proposed Formula state machine is:

```text
BRIEF_DRAFT
  -> REQUIREMENT_REVIEW
  -> FORMULA_DRAFT
  -> FORMULA_REVIEW
  -> FORMULA_READY
  -> OPC_HANDOFF_PENDING
  -> OPC_HANDOFF_ACCEPTED
  -> CLOSED
```

Every state transition should emit a structured event with:

`event_id`, `event_type`, `source_system`, `source_record_id`, `central_job_id`, `central_user_id`, `actor_user_id`, `owner_user_id`, `assignee_user_id`, `from_stage`, `to_stage`, `status`, `event_at`, `delay_reason_code`, `delay_remark`, `correlation_id` and `schema_version`.

`CLOSED` must not be used to mean “formula ready”, “quote approved” or “OPC accepted”. Those are separate states/events.

## 5. Domain ownership

| Data | Owner | Formula behavior |
|---|---|---|
| User identity and role | OPC Workflow source + Central IAM projection | Cache/reference only; no Formula-local master |
| Central job reference | Central Job Core | Store mapping/reference only |
| Customer brief/formula requirements | Formula | Own and version |
| Formula decision/revision | Formula/R&D | Own and version |
| OPC execution status | OPC | Consume handoff acknowledgement only |
| Attachments | Approved object-storage owner | Store reference, checksum, version and access metadata |
| Raw activity events | Producing system | Formula emits Formula events |
| KPI/aggregates | Reporting | Consume events; do not rewrite Formula logic |

## 6. Compatibility and migration constraints

- Preserve all locked localStorage keys and JSON fields.
- Add optional fields only; old records must render and sync.
- Do not add `service_role` or privileged tokens to browser/repository.
- Any Supabase schema/RLS/sync change is a Critical Change requiring independent review by `@phossatron` or formal delegate.
- New mapping/event projections must be backward-compatible and idempotent.
- Keep existing `fs_chats` as a backward-compatible projection if the append-only event store remains authoritative for chat.
- Do not migrate or copy another system's master tables into Formula.

## 7. Target data flow

```text
Sales creates brief
  -> Formula assigns/links central job reference
  -> Formula emits BRIEF_CREATED
  -> PD/RA/RD review emits REVIEW_STARTED / REQUIREMENT_COMPLETED
  -> Formula revision is approved by Formula-owned rules
  -> Formula emits FORMULA_READY with immutable revision reference
  -> Handoff adapter sends API/event to OPC
  -> OPC returns accepted/rejected + correlation ID
  -> Formula stores acknowledgement and emits HANDOFF_* event
  -> Reporting consumes events from both systems
```

Failures must be visible and retryable. A handoff request must use an idempotency key and must not silently mark Formula ready or accepted.

## 8. Security and operations target

- Authentication and authorization remain separate.
- Browser requests use user-scoped credentials; server-side adapters enforce service-to-service authorization.
- Payloads are role-filtered; internal supplier/cost data must not be exposed to Sales/OPC unless an approved contract permits it.
- Attachments use signed/authorized object-storage references, not binary blobs in chat or prompt.
- Every external call records correlation, result, retry/dead-letter state and redacted error evidence.
- Production release remains GitHub-centered: approved PR/commit/release, Runtime Operator deploy, health check and rollback target.
