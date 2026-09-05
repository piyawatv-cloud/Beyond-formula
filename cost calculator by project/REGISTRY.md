# Ownership & integration registry

| Domain | Authority / Owner | Current status |
|---|---|---|
| Customer/project brief | Project Formula / Sales | integration mapping pending |
| Formula/material identity | RD | source contractต้องรักษา |
| RM source evidence | Original price workbooks | read-only; URLsในlocal-only |
| Governed RM price | Procurement / Data Center | audit FAIL; syncไม่ยืนยัน |
| PK | PU-PK | PU-PK-Data source ระบุแล้ว; metadata/7-tab headers ตรวจแล้ว; semantics/runtime/ผู้ประสานงานยังไม่ยืนยัน; ราคาจริงห้ามเปิดข้าม RD |
| Routing | RD | เพิ่มในscopeนี้ |
| Production time/capacity/crew | ฝ่ายผลิต | RD กำหนด routing; ค่าจริงยังรอ |
| DL/OH rates and allocation | บัญชีต้นทุน/การเงิน | ยืนยันอัตราและฐานจัดสรร; ผู้ใช้กำหนด STD เริ่มต้น; แยกใช้ทดสอบ/อนุมัติใช้เสนอราคา พร้อมผู้รับรอง/วันที่มีผล; กฎรายหมวดยังไม่ระบุ |
| Commercial material terms | Procurement | price/MOQ/tier/LT/risk |
| Leftover commercial exposure | Procurement เสนอ / CEO อนุมัติ | แยกจากต้นทุนใช้จริง |
| First-result project communication | RD → Sales / Formula project chat | ยอดหลังบวกประมาณการต่อชิ้น/จำนวน/pack/revision/รายการค้าง/link; ห้าม supplier/ราคา supplier/ชื่อ RM เต็มแก่ Sales/OPC |
| Sales scenarios/revisions | Sales, RDตามหน้าที่ | proposal; ยังไม่implement |
| Quotation final approval | CEO | ผู้ใช้ยืนยันล่าสุด |
| Actual production cost | ระบบบันทึกการผลิตเดิม | future integration |

Logical referencesที่ต้องมี: project reference, formula revision, scenario/calculation revision, material identity, source observation, tier version, operation/rate version, approval event, quote version, production batch reference. ยังไม่ใช่authorizationสร้างschemaหรือเปลี่ยนlocked keys.

Latest user decisions > current SPEC > legacy archive. เอกสารlegacyที่อนุญาตauto approval/max priceหรือProcurement final quotation approvalไม่ใช้เป็นpolicyปัจจุบัน.


Round 2 confirmed: RM selection จาก Data Center เท่านั้น; ไม่มีรายการต้องขอ Procurement เสนอ. เงื่อนไขกลาง reuse ได้เฉพาะ scope/validity/ข้อจำกัดตรงกัน; ราคาพิเศษและ leftover decision ผูก project. รอบ 3 ยืนยันรายการใหม่เข้า Data Center กลางและรอ RD รับรอง spec; พร้อมเสนอราคาเมื่อผ่าน spec และเงื่อนไขซื้อครบ ไม่ใช่สิทธิ์แก้ RM ต้นฉบับ.


| Round 3 domain | Owner | Confirmed / pending |
|---|---|---|
| Disclosable material name | RD | ช่องในหน้าสูตรและ Data Center เพื่อ reuse; ชื่อกลางเป็น default; override ในสูตรเฉพาะ revision; แก้กลางเป็นคำสั่ง RD แยก; ไม่มีชื่อใช้ข้อความชั่วคราวไม่เปิดชื่อเต็ม |
| Sales/OPC cost view | ตามข้อยืนยันผู้ใช้ | ยอดหลังบวกรวมต่อชิ้นและ RM/PK/Operation เท่านั้น; ห้ามต้นทุนรายวัสดุและเอกสารราคาต้นทาง |
| Partial estimate | RD ส่ง Sales | ยอดเฉพาะส่วนที่ทราบ + รายการค้าง + ยังไม่ใช่ต้นทุนรวมต่อชิ้น |


Round 4: cost calculation ใช้ได้เมื่อฐานต้นทุนครบโดยไม่รอ selling-price policy; กฎราคาขายแต่ละหมวดยังรอผู้ใช้กำหนด ไม่สมมติอัตราหรือถือค่าว่างเป็นศูนย์.


| Round 5 domain | Owner / restriction | Status |
|---|---|---|
| Planned loss/yield | RD + ฝ่ายผลิต | แยกขั้นและ RM/PK; ไม่มีอัตราสมมติ |
| Inventory | WMS ที่จะเชื่อมภายหลัง | แผนต่อหลัง go-live; ยังไม่มี live stock integration |
| RM/PK cross-department prices | RD / PU-PK | ไม่เห็นราคาจริงข้ามฝ่าย; เห็นได้เฉพาะราคาที่บวกแล้วซึ่ง policy ยังไม่กำหนด |
| Complete base-cost visibility | บัญชีต้นทุน/การเงิน และ CEO เมื่อกำหนดสิทธิ์ให้ | Q22 ยืนยัน; ไม่เปิดให้ RD/PU-PK ข้ามหมวด |
| Optional initial other costs | ผู้รับผิดชอบรายหมวดยังต้องระบุ | ระบุรอข้อมูลได้ ไม่ใส่ศูนย์; ก่อนเสนอราคาต้องยืนยันจำนวนเงินหรือไม่เกี่ยวข้อง |


Round 6 authority: Sales/OPC receives adjusted category amounts, not base costs. Missing pricing policy means pending-price status. RD sees RM base prices; PU-PK sees PK base prices; cross-category base access prohibited. Q24 confirms separate Procurement RM and PU-PK access; cross-category administrators require explicit scope; Operation access follows production/cost-accounting/finance/CEO duties. No runtime authorization implemented.


| Round 7 domain | Confirmed authority / rule |
|---|---|
| Procurement RM | เห็นและยืนยันราคาจริง RM |
| PU-PK commercial terms | เห็นและยืนยันราคาจริง PK |
| Cross-category administrator | สิทธิ์เฉพาะตามความจำเป็น ไม่ได้เปิดโดยอัตโนมัติ |
| Operation base costs | ฝ่ายผลิต/บัญชีต้นทุน/การเงิน/CEO ตามหน้าที่ |
| Pre-WMS purchase estimate | ความต้องการงาน + MOQ/หน่วยสั่งซื้อ; ประมาณการก่อนตรวจสต็อก ไม่ใช่ยอดสั่งซื้อจริง |
| RM scenario Tier choice | RD ยืนยัน Tier ที่ Procurement ยืนยันและเข้าเงื่อนไข; ไม่เปลี่ยนวัสดุ/ซื้อเพิ่มอัตโนมัติ |
| PK scenario Tier choice | PU-PK เลือก item/Tier และยืนยันเงื่อนไข; RD กำหนดความต้องการ/ยอมรับ spec และเห็นยอดหลังบวก |


Round 8 boundary: calculator → ราคาพร้อม Sales เสนอ (CEO approval ตามเดิม) + preliminary summary ใน Formula project chat. Delivery scheduling/overall delivery LT ไม่อยู่ใน scope. Material LT ยังอยู่ใน Procurement terms. PU-PK ใช้แหล่งเดิม; ต่อมาผู้ใช้ระบุตำแหน่งและตรวจ header schema แล้วแบบ read-only; สูตร/semantics/runtime ยังไม่ตรวจ. WMS/actual integration เป็น roadmap แยก ไม่ขวาง acceptance รอบนี้.


PU-PK source evidence: see local-only/PU_PK_SOURCE_REFERENCE.md for exact source and header inventory (never commit). Candidate references: Req-PK No → Quote_ID → Snapshot_ID/CurrentPricingRevisionID. These keys exist as headers; referential integrity, current/approved semantics and Formula linkage are unverified. Q30 confirmed authority: PU-PK owns PK calculations; calculator consumes verified version references, does not reproduce PK rules. PK delay must not block formula/RM progress. Existing PU policy rates are not automatically approved for this project.


Q30: separate RM, PK, Operation and pricing readiness. PU-PK owns item/Tier and PK calculation version; calculator owns scenario aggregation with role-filtered disclosure. PK availability is not authority to change RM. Q31 confirms reuse when packaging spec/quantity/pack size/terms/validity are unchanged; changes require PU-PK reconfirmation without blocking RM. Clarified: unconfirmed versions may be referenced in draft with pending-confirmation status; ready quotation requires confirmed and applicable versions.


Negotiation workflow accepted for trial: PU-PK owns offer history and commercial confirmation; calculator owns explicit version adoption and scenario aggregation. RD approves packaging suitability only. A source reply/email status is not evidence of commercial confirmation. Existing source IDs are mapping candidates, not proven contracts. No new duplicate vendor/master/pricing engine is authorized.


Trial evidence: docs/PK_WORKFLOW_TRIAL.md; 14 tests pass in a synthetic local model only. Actual PU-PK code/formulas/status mapping and adapter remain unverified. No canonical storage contracts were created by the test types.


Implementation tracking: [Plan](docs/IMPLEMENTATION_PLAN.md) owns the current P01–P27 work breakdown, [TASK](TASK.md) records progress/evidence. P-labels are local planning references only; bind to actual GitHub Issues when created. Notion is pending connection, with no published page or task IDs; it must not become a second source of calculation rules.
