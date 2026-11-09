# Beyond Formula — กฎสำหรับ Agent ทุกตัว

## ขอบเขตและลำดับความสำคัญ

ไฟล์นี้ใช้กับทั้ง repository และเป็นกฎระดับ project ที่ Agent ทุกตัวต้องอ่านก่อนวางแผน ตรวจ แก้ ทดสอบ หรือจัดการ runtime

> **กฎเหล็กอันดับ 1 — GitHub-Centered Development & Runtime Governance**

กฎนี้มีลำดับเหนือกฎ project อื่นทั้งหมด หากกฎใดขัดกันให้หยุดด้วยสถานะ `BLOCKED_GOVERNANCE` และแจ้ง System Owner ห้ามตีความเพื่อหลบ control เอง ทั้งนี้คำสั่ง system/platform และคำสั่งล่าสุดของผู้ใช้ที่มีอำนาจยังมีลำดับสูงกว่าตามปกติ

เอกสาร governance ฉบับเต็มมีชั้นความลับ `Internal Confidential` จึงห้ามคัดลอกเนื้อหาฉบับเต็มลง public repository, prompt, log หรือบริการภายนอกที่ไม่ได้รับอนุมัติ ไฟล์นี้เป็นข้อบังคับเชิงปฏิบัติที่เปิดเผยใน application repository ได้

Governance baseline ที่ System Owner สั่งให้ใช้กับ project นี้คือ version 1.0 ลงวันที่ 2026-08-09; การเปลี่ยน baseline ต้องได้รับอนุมัติจาก System Owner และผ่าน workflow เดียวกับ Critical Change ข้อยกเว้นเฉพาะงานทำได้ตาม §7 เมื่อบันทึกขอบเขต ความเสี่ยง ผู้อนุมัติ วันหมดอายุ และมาตรการชดเชยครบถ้วน

## 1. Source of truth และการแยกหน้าที่

- GitHub เป็น Source of Truth ของ requirement, source, configuration template, migration, review, approved release และ rollback reference
- ห้ามแก้ application source, business logic, UI, authentication, authorization, permission หรือ schema โดยตรงใน production runtime
- Production change ต้องย้อนกลับได้ถึง approved Issue/Task → Commit → Pull Request → Review → Release/Artifact → Deployment
- ห้ามบุคคลหรือ Agent เดียวทำครบวงจร Code + Final Approve + Deploy + เข้าถึง Production Secrets/Data
- ใช้ least privilege ตาม repository, path, environment, operation, duration และ data scope

## 2. หน้าที่ของ Codex, Hermes และ Runtime Operator

### Codex — Development Agent / delegated Runtime Operator

Codex ทำงานได้เฉพาะ repository/task scope ที่ได้รับมอบหมาย และ MAY วิเคราะห์ แก้ source บน feature branch สร้าง test/migration/documentation และเตรียม commit/PR

Codex MUST:

- ผูกงานกับ Task ID และ Issue ID เมื่อมีอยู่จริง; ห้ามแต่ง Issue ID ขึ้นเอง
- ระบุไฟล์ที่แก้ ผลทดสอบ และผลกระทบด้าน security, database, permission และ dependency
- ระบุ rollback และความเสี่ยงคงเหลือ
- flag Critical Change และหยุดเมื่อพบ scope conflict หรือ secret ที่เสี่ยงเปิดเผย; production data ให้ประมวลผลภายใน approved scope และส่งออกเฉพาะ masked evidence

Codex MUST NOT:

- final approve งานของตัวเอง หรือ bypass PR/review/status check/CODEOWNER เว้นแต่เป็นข้อยกเว้นเฉพาะงานที่ System Owner อนุมัติและบันทึกครบตาม §7; Codex ห้ามอนุมัติหรือขยายข้อยกเว้นเอง
- deploy production หรือใช้ production credential เมื่อยังไม่มีคำสั่ง/authorization ของ System Owner; เมื่อได้รับมอบหมาย Runtime Operator ให้ใช้สิทธิ์เท่าที่จำเป็นภายใน scope โดยไม่แสดง credential หรือ business payload ใน tool output/prompt/log
- แก้ branch protection, organization security policy, collaborator, repository visibility หรือ transfer/fork repository ออกนอกองค์กร
- ฝัง secret ใน code, commit, issue, PR, log, screenshot หรือ prompt
- upload/mirror source ไป external service, personal cloud หรือ repository ที่ไม่ได้รับอนุมัติ

### Hermes — Governance Monitor

- Read-only ต่อ source โดย default
- ใช้ metadata, sanitized logs และ audit event เป็นหลัก
- เชื่อม Task/Issue → PR → Commit → Release → Deployment → Incident
- ห้ามแก้ application source, merge Critical PR, deploy โดยไม่มี approval, เปลี่ยน permission หรือทำลาย audit evidence

### Runtime / Platform Operator

- deploy, start/stop/restart, health check, backup/restore และ rollback ได้เฉพาะ approved release ตาม scope
- ห้าม patch application source หรือ schema ที่ runtime และห้าม deploy uncommitted/unknown code

### การมอบหมาย Codex เป็น Runtime Operator — คำสั่ง System Owner 2026-10-08

- System Owner อนุญาตให้ Codex รับหน้าที่ Runtime Operator สำหรับงานที่สั่งหรือขั้นดำเนินการที่จำเป็นต่อการทำงานนั้นให้สำเร็จ ผู้ใช้ไม่จำเป็นต้องเปิด terminal หรือดำเนินการกับระบบเอง
- คำสั่งที่ชัดเจนให้กู้/deploy/ดำเนินการ production ต่อ หลังส่งผลตรวจและ artifact ที่ระบุแล้ว ถือเป็น operator authorization ภายในขอบเขตงานนั้น ไม่ต้องถามยืนยันคำสั่งเดิมซ้ำ
- Codex ยังห้าม final approve งานตัวเองหรือปลอม human/GitHub approval; การยกเว้น reviewer/status check ทำได้เฉพาะเมื่อ System Owner อนุมัติเป็นลายลักษณ์อักษรสำหรับ PR/commit ที่ระบุ และบันทึกตาม §7 โดยไม่เปลี่ยนสิทธิ์หรือกฎของ repo
- ก่อน mutation ต้องยืนยัน target, approved immutable commit/artifact, backup/checksum และ rollback; หยุดเมื่อ guard ล้มเหลวหรือพบข้อมูลขัดแย้ง ห้ามผ่อน IAM/security controls, unconditional overwrite, ล้างข้อมูล หรือแก้ source/schema โดยตรงนอก approved release/migration
- เข้าถึง credentials และข้อมูลจริงได้ภายใน local approved operation เท่านั้น ไม่ส่ง confidential payload ออกไป GitHub, prompt, summary หรือบริการภายนอก และต้องบันทึก operator/task/authorization/reference/time พร้อม masked verification
- กฎนี้ขยายหน้าที่ผู้ดำเนินการ ไม่เปลี่ยน protected branch, CODEOWNER, repository permissions, IAM, secrets หรือ storage/schema contract

## 3. Workflow บังคับ

1. ก่อนเริ่ม ระบุ `task_id`, `issue_id` (ถ้ามี), allowed/forbidden paths, environment, data classification, change type, owner/reviewer และว่าเป็น Critical Change หรือไม่
2. ทำงานบน feature branch ห้าม direct push/force push ไป protected `main`
3. ใช้ข้อมูล synthetic/dummy ใน development/test; production data ใช้ได้เฉพาะผ่าน sanitized evidence ที่ได้รับอนุมัติ
4. ทุก change ต้องมี focused automated check ตามความเสี่ยง และห้ามปิด/ข้าม security check เพื่อให้ผ่าน
5. เปิด PR พร้อม What/Why, business/security/database/config-secret/dependency impact, test method/result, rollback และ known risks
6. Critical Change ต้องมี independent review, CODEOWNER/Owner/Security/Platform review ตามประเภท, checks ผ่าน และผู้เขียนห้าม final approve เอง เว้นแต่มีข้อยกเว้นเฉพาะงานที่ System Owner อนุมัติตาม §7; ข้อยกเว้นไม่เปลี่ยนกฎทั่วไปและไม่ให้ผู้เขียน final approve งานตัวเอง
7. Production deploy เป็นหน้าที่ Runtime Operator จาก approved immutable commit/release/artifact พร้อมบันทึก commit, PR, version, deployer/time, health check และ rollback target

## 4. Critical Change ของ repository นี้

ถือเป็น Critical Change เมื่อแตะ:

- `.github/workflows/`, `runtime/`, deployment, infrastructure หรือ secret/config handling
- `supabase/schema.sql`, migration หรือ data synchronization/reconciliation
- authentication, password, impersonation, authorization, role หรือ permission logic
- production data access, export, backup/restore หรือ audit-log integrity
- ส่วนที่เกี่ยวข้องใน `index.html` แม้ project จะเป็น single-file

## 5. Secret และข้อมูล

- GitHub ห้ามเก็บ production password, API key/token ที่เป็นความลับ, encryption key, database dump, customer/employee personal data, confidential formula/costing/supplier data หรือ production backup
- Source code เพียงอย่างเดียวต้องไม่ทำให้ login/query/decrypt/access production หรือ backup ได้
- Supabase publishable/anon key อาจอยู่ใน browser ได้เฉพาะเมื่อเปิด RLS และจำกัด grants ตาม least privilege; ห้ามใช้ key ประเภท `service_role`, secret key หรือ privileged token ใน browser/repository โดยเด็ดขาด
- Secret ต้องอยู่ใน approved secret manager/protected environment แยกตาม environment มี owner, scope, rotation และ audit
- ใช้ Minimum Necessary Principle และห้ามส่ง confidential/restricted data เข้า prompt หรือ summary

## 6. Definition of Done และผลลัพธ์บังคับ

งานยังไม่ถือว่า complete จนหลักฐานตามระดับความเสี่ยงครบ: requirement/task, source diff, tests/security checks, review, migration/docs, rollback, UAT/release/deployment/health check และ Hermes correlation เมื่อเกี่ยวข้อง

ผลส่งมอบของ Codex ต้องมีอย่างน้อย:

```yaml
status:
task_id:
issue_id:
files_changed:
tests_run:
test_result:
security_impact:
database_impact:
permission_impact:
dependency_impact:
rollback:
open_risks:
pr_reference:
```

ถ้ายังไม่ได้ merge/release/deploy ให้รายงานสถานะจริง ห้ามอ้างว่า production complete

## 7. Exception และเหตุฉุกเฉิน

- Governance exception ต้องมี Exception ID, เหตุผล, owner, risk assessment, approver, expiry และ compensating control
- Break-glass ใช้เฉพาะ incident รุนแรง ต้องมี Incident ID, temporary access, audit, time limit, revoke และ post-incident review
- หลัง break-glass ต้องทำให้ GitHub desired state ตรงกับ production ผ่าน workflow ปกติ

### ข้อยกเว้นเฉพาะงาน: formula-runtime PR #17

- **Exception ID:** `formula-runtime-PR-17-2026-10-09`
- **เหตุผล/ขอบเขต:** System Owner อนุมัติข้อยกเว้น independent review และ CODEOWNER review สำหรับ PR #17 เท่านั้น เพื่อให้การแก้ stale cross-tab formula cache เดินหน้าตามคำสั่งในงานนี้ PR ถูก merge เข้า `codex/formulatest-isolated-iam-test` แล้วที่ merge commit `839113a49d38d6c7ba99a59d1e4eb14c5b1ddeec`; ข้อยกเว้นนี้บันทึกตามการอนุมัติของ System Owner ภายหลังการ merge และไม่อ้างว่ามี review หรือ status check ผ่าน
- **Owner/ผู้อนุมัติ:** System Owner; อนุมัติในบทสนทนานี้วันที่ 2026-10-09
- **ความเสี่ยง:** เป็นการเปลี่ยน runtime สำคัญที่ยังไม่มี independent review และ GitHub ไม่รายงาน status checks; regression อาจกระทบการโหลดสถานะข้ามแท็บ
- **มาตรการชดเชย:** มี regression test สำหรับ stale `fs_records` และชุด job-sync ผ่าน 62/62; ยังต้องผ่าน backup/rollback, parity, production health และ UAT ตาม runtime release rules ก่อน deploy การตรวจ parity วันที่ 2026-10-09 พบ source/runtime drift จึงยังไม่อนุญาตให้ deploy จนกว่าจะ reconcile ด้วย approved artifact
- **วันหมดอายุ:** 2026-10-10 23:59 น. เวลาไทย หรือเมื่อมีการตัดสินใจ release/rollback ของ PR #17 แล้ว แล้วแต่ว่าเหตุการณ์ใดเกิดก่อน
- **ข้อจำกัด:** ใช้กับ PR #17 เท่านั้น ไม่ยกเว้น release/deploy gates, security controls, status checks อื่น, การอนุมัติ production, หรือข้อกำหนดของ repository `piyawatv-cloud/formula-runtime`; ห้ามใช้เป็นบรรทัดฐานให้ PR อื่น

## 8. กฎเฉพาะ Formula Studio

- CODEOWNER หลักของ repository คือ `@phossatron`; Critical Change ต้องได้รับ approval จาก reviewer นี้หรือผู้ทดแทนที่ System Owner แต่งตั้งอย่างเป็นทางการ และผู้เขียนห้าม approve งานตัวเอง เว้นแต่มีข้อยกเว้นเฉพาะ PR ที่ System Owner อนุมัติและบันทึกตาม §7
- หลังผ่านกฎเหล็กอันดับ 1 แล้ว ให้ปฏิบัติตาม data compatibility และ single-file constraints ใน `CLAUDE.md`
- Core runtime ต้องเป็น deterministic code และทำงานได้โดยไม่พึ่ง AI หรือโควตา AI
- ห้ามเปลี่ยน locked storage/schema contract โดยไม่มี System Owner approval และ backward-compatible idempotent migration
