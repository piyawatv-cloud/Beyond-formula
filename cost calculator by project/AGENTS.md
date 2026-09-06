# Cost Calculator — Project Instructions

ใช้ร่วมกับ ../AGENTS.md และ ../CLAUDE.md; ไม่เปลี่ยน locked Formula storage/schema contract.

## Scope / source of truth

- งาน OEM supplement cost calculator by project: Formula project brief → RD formula/packaging/routing → Procurement → cost scenarios → CEO quotation approval → future actual cost reconciliation.
- Project Formula เป็นแหล่งโจทย์ลูกค้าและ project identity; ห้ามสร้าง customer/project master ซ้ำโดยไม่มี sync/ownership contract.
- RM ต้นฉบับ read-only; Google Sheets Data Center เป็น pilot working data center. PK ใช้แหล่ง PU-PK ที่ผู้ใช้ระบุแล้ว; source reference เก็บ local-only และ mapping ที่ตรวจแล้วอยู่ docs/PK_SOURCE_MAPPING.md. Operation DL+OH เพิ่มในโครงการนี้ตาม routing ที่ RD กำหนด.
- Procurement ยืนยัน material/vendor/Tier/price/MOQ/lead time. RD owns ingredient identity/formula/routing. CEO อนุมัติใบเสนอราคาสุดท้าย ไม่ใช่ Procurement.
- One selected Tier ต่อ material line ต่อ scenario; price กับ MOQ ห้ามเลือกแยก. Unlabelled price = THB/kg; ห้ามเดาหน่วย MOQ.
- ไม่ให้ unconfirmed/ambiguous/excluded/obsolete record ป้อนต้นทุนที่พร้อมเสนอ. เก็บ raw evidence และ version history; source updates ไม่เปลี่ยน approved quotation.
- Exclude ยกเลิก, ยังไม่เคยซื้อ, ไม่ผ่าน อย., ไม่มีวันที่; ตรวจทุก field ที่เกี่ยวข้อง.
- Margin/markup policy ยังไม่กำหนด: รองรับการตั้งภายหลัง แต่ห้ามใส่อัตราสมมติหรือถือว่าว่างเป็นศูนย์สำหรับ final quote.
- Cost, purchase cash, leftover exposure เป็นคนละ measure; ห้ามคิด full MOQ ซ้ำเป็น consumed cost.

## Safety / current gate

- ผู้ใช้อนุญาต local implementation P01–P27 เมื่อ 2026-09-05 และยกเลิก Notion. ทำงานใน isolated feature worktree ตาม docs/IMPLEMENTATION_EXECUTION.md. Historical audit FAIL ยังไม่ปิดระดับ integration; ห้ามอ้าง sync30นาที/approval/live calculation พร้อมใช้งาน.
- local-only เป็น confidential evidence archive ที่ห้ามนำเข้าGitHub; legacy codeเป็นreference ไม่ใช่approved release.
- ห้ามเปลี่ยน parent application/runtime/database/permissions โดยอาศัยการตั้งโฟลเดอร์ครั้งนี้เป็นauthorization.
- ก่อน implementation ต้องอ่านauditและตรวจcurrent stateใหม่; UAT/review/releaseตามparent governance. CEO commercial approval ไม่ทดแทนtechnical release approval.

## Hermes monitoring authorization — 2026-09-06

System Owner authorized Hermes to read information for monitoring progress and recommending improvements. This records authorization; it does not provision an account, ACL, repository membership or runtime access.

- Purpose: correlate task → commit → test/review → UAT → release/deployment evidence; identify incomplete work, contradictions and improvement recommendations.
- Default scope: approved project documentation, source/diffs, commit metadata, test definitions and sanitized test/review/audit evidence within the assigned repository. Review content before making a report available; a filename alone does not establish that its contents are sanitized.
- Excluded from this authorization's default scope: secrets/credentials, confidential governance originals, local-only archives, browser profiles/localStorage, raw runtime logs, production records, personal data, formulas, supplier identities and actual commercial prices. If monitoring requires these, identify the minimum necessary fields and obtain explicit data-scope authorization first.
- Read-only means no file/data/configuration changes, commits, comments/messages, approval, merge, deployment or deletion. Hermes returns recommendations to the owner/development agent; implementing improvements is a separate authorized task.
- Access must be enforced by the host/repository/provider using an identified Hermes principal and a read-only mount or equivalent read-only grant. AGENTS.md is not an access-control boundary. Do not use chmod on the shared worktree, share an owner's credentials or add broad production access.
- Provisioning status: PENDING_IDENTITY_AND_CHANNEL. The Hermes account/service identity and access channel (local agent/host or approved repository/service) have not been identified in this session. No technical grant has been applied.
- Provisioning evidence must record principal, exact scope, enforcing control, grantor/time, expiry or revocation condition, successful allowed read and rejected write/out-of-scope access. Verify in an isolated test location; do not test writes against production.
- Engineering changes remain confined to /Users/user/.codex/worktrees/cost-calculator-implementation. Do not expose the entire host to grant access to this project.
