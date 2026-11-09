# Formula Studio — Gap Analysis

วันที่ตรวจ: 2026-09-18
มาตรฐานอ้างอิง: Shared Architecture Contract, Phase 0 Discovery, Phase 3 Formula Integration

## Summary

**สถานะ: PASS WITH CONDITIONS** สำหรับ Phase 0 discovery baseline และการเริ่มงาน Formula/R&D ต่อในระดับ intake/collaboration
**สถานะ: FAIL** สำหรับการอ้างว่าเป็น ERP-integrated Formula service หรือพร้อมส่งข้อมูลข้ามระบบ/รายงานแบบ canonical

ข้อสรุปนี้อิง code/schema จริงและ test ที่รันแล้ว ไม่ใช่การรับรอง production, UAT หรือ business approval

## Findings

### GAP-01 — ไม่มี shared job identity

**Severity: HIGH**

ปัจจุบัน record/chat ใช้ local `A00001` และ schema ตรวจรูปแบบนี้ (`CLAUDE.md:38-45`, `supabase/schema.sql:200-201,247-248`) แต่ยังไม่พบ `central_job_id`, `source_system` หรือ `source_record_id`

ผลกระทบ: การเชื่อม Formula กับ Central Job/OPC/Job Order และการรวมรายงานข้ามระบบจะต้องพึ่งการจับคู่ด้วย local ID หรือชื่อ ซึ่งไม่ปลอดภัยพอ

คำแนะนำ: เพิ่ม mapping แบบ additive/backward-compatible ใน adapter/contract ก่อน ไม่เปลี่ยน `id` เดิม และกำหนดเจ้าของ `central_job_id` ที่ Central Job Core

### GAP-02 — ไม่มี shared user identity ใน business events

**Severity: HIGH**

Secure mode มี `auth.users.id` ใน `fs_memberships.user_id` แต่ record/user/activity ใช้ชื่อผู้ใช้และ role (`CLAUDE.md:83-97`, `supabase/schema.sql:53-62,149-167`)

ผลกระทบ: owner, assignee และ actor ไม่สามารถ join กับ Central IAM อย่าง deterministic; ชื่อเปลี่ยนหรือซ้ำได้

คำแนะนำ: ให้ Central IAM เป็น authority และเพิ่ม mapping/client contract ที่ส่ง `central_user_id` พร้อมเก็บ legacy name เพื่อ backward compatibility

### GAP-03 — job stage/status ไม่เป็น canonical

**Severity: HIGH**

ปัจจุบัน lifecycle หลักใช้ `closed` และ approval ใน Chat; ไม่มี field ที่แยก `stage` กับ `status` สำหรับ brief, review, formula-ready หรือ handoff (`index.html:3978-4084,4486-4526`)

ผลกระทบ: downstream system ไม่รู้ว่า “เปิดงาน”, “กำลัง review”, “สูตรพร้อม” และ “ส่ง OPC แล้ว” แตกต่างกันอย่างไร

คำแนะนำ: นิยาม state machine ใน contract ก่อน implementation; เก็บ current state แบบ additive และบันทึก transition เป็น events

### GAP-04 — Phase 3 handoff ไป OPC ยังไม่มี contract ที่ใช้งานได้

**Severity: HIGH**

Phase Pack ต้องการ `central_job_id`, `formula_id`, customer ref, requirement summary, selected formula ref, owner, timestamp, attachment refs และ handoff status แต่ source ปัจจุบันไม่มี API/Event client หรือ persisted handoff record ที่พิสูจน์ได้

ผลกระทบ: การส่งต่ออาจเกิดจาก export/manual copy และ traceability ไม่ครบ

คำแนะนำ: ใช้ API/event boundary ตาม `INTEGRATION_CONTRACTS.md`; ห้ามอ่าน OPC database โดยตรงหรือ copy ตารางของ OPC มาไว้ใน Formula

### GAP-05 — Reporting event vocabulary ไม่ครบและไม่เป็นมาตรฐานกลาง

**Severity: HIGH**

มี activity `cat/action` และ chat event `type/action` แต่ไม่มี canonical `event_type`, actor ID, stage, delay reason หรือ source identity (`CLAUDE.md:94-97`, `supabase/schema.sql:381-535`)

ผลกระทบ: KPI layer จะต้องตีความข้อความ/role/ชื่อแบบ ad hoc และเสี่ยงนับเหตุการณ์ซ้ำ

คำแนะนำ: สร้าง event adapter/projection แบบ additive; ให้ raw legacy activity อยู่ต่อ และกำหนด idempotency key กับ event schema กลาง

### GAP-06 — ไม่มี delay reason และ workflow duration ที่เชื่อถือได้

**Severity: MEDIUM**

มี timestamps และ Chat `activeMs` บางส่วน แต่ไม่พบ `delay_reason_code`, `delay_remark` และ duration ของแต่ละ stage

ผลกระทบ: รายงาน bottleneck และ SLA ของ Formula/OPC จะยังไม่พร้อม

คำแนะนำ: เก็บ state transition timestamps และ reason event แบบ structured; ห้ามคำนวณ KPI ซ้ำใน UI ของ Formula

### GAP-07 — ownership ยังเป็นชื่อ/role มากกว่า user reference

**Severity: MEDIUM**

มี `salesOwner` และ `createdBy/updatedBy` เป็น human-readable value และ user role (`CLAUDE.md:70-86`) แต่ไม่มี generic owner/assignee model

ผลกระทบ: reassignment, audit และ cross-system join ไม่ deterministic

คำแนะนำ: เพิ่ม owner/assignee mapping ที่อ้าง Central IAM โดยยังคงชื่อ legacy ไว้แสดงผลและอ่านข้อมูลเก่าได้

### GAP-08 — attachment/file evidence ยังไม่เป็น object-storage contract

**Severity: MEDIUM**

Phase 3 ต้องรองรับ `attachment_refs`; จาก source/schema ที่ตรวจไม่พบ object-storage table/bucket contract หรือ attachment reference ใน locked record

ผลกระทบ: เอกสารประกอบสูตร/brief อาจอยู่ใน export/manual channel และย้อนกลับยาก

คำแนะนำ: กำหนด metadata-only attachment reference contract; binary ต้องอยู่ใน approved object storage และสิทธิ์ต้องมาจาก owner system

### GAP-09 — secure authorization มีหลักฐานดี แต่การยืนยัน real environment ยังขาด

**Severity: MEDIUM**

Browser harness 56/56 และ SQL/RLS test ผ่าน แต่ไม่ใช่หลักฐานว่า deployed Supabase/Vercel configuration ปัจจุบันตรงกับ repository หรือ production health

ผลกระทบ: ยังสรุป production readiness, UAT หรือ live integration ไม่ได้

คำแนะนำ: ทำ staging UAT และ deployment evidence ตาม Runtime Operator workflow; Codex ไม่ deploy และไม่อ่าน production data

### GAP-10 — locked JSON/blob contract จำกัดการทำ cross-system query

**Severity: MEDIUM**

`data jsonb` เป็น contract ที่ต้องรักษา (`CLAUDE.md:27-50,101-116`) และห้ามแตก field/เปลี่ยน key โดยไม่มี approval

ผลกระทบ: การเพิ่ม identity/event fields ต้อง additive และอาจทำให้ reporting query บน JSON ซับซ้อน

คำแนะนำ: ใช้ adapter/projection/event tables สำหรับ integration/reporting โดยไม่ทำลาย locked payload; ทุก schema change ถือเป็น Critical Change

## Strengths / controls ที่ผ่านหลักฐานปัจจุบัน

- Secure Auth/session boundary และ no first-admin in browser มี browser tests รองรับ
- RLS/forced RLS, server-side actor checks และ RPC-only chat event path มี SQL tests รองรับ
- Legacy/local-first contract มีข้อกำหนด backward compatibility ชัดเจน
- CI ตรวจ browser auth และ PostgreSQL authorization ทุก PR (`.github/workflows/verify.yml:14-41`)
- Runtime deploy/rollback ถูกแยกจาก source change และมี clean-tree guard (`RUNTIME_OPERATIONS.md:61-99`)

## Quick wins ที่ไม่เปลี่ยน locked contract

1. อนุมัติ vocabulary ของ Phase 3 event/state และ owner ของแต่ละ field
2. เพิ่ม contract tests/fixtures สำหรับ `central_job_id`/`central_user_id` mapping โดยใช้ synthetic data
3. สร้าง adapter/projection ที่อ่าน legacy record แล้วปล่อย canonical event payload โดยยังไม่เขียน source/schema จริง
4. เพิ่ม documentation และ negative tests สำหรับ missing/unknown/delay state
5. ตกลง handoff acknowledgement/idempotency/rollback กับ OPC owner

## Evidence missing / decisions required

- ผู้ถือครอง Central Job และ Central IAM ที่จะออก IDs
- Formula ID/Formula revision และสถานะที่เป็น authority
- API gateway/event bus และ authentication ระหว่างระบบ
- Attachment/object storage owner และ retention/access policy
- Canonical Phase 3 state machine และ event vocabulary
- Staging environment, sanitized UAT data และ independent reviewer
- วิธีรองรับ historical records ที่ไม่มี central IDs
