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
