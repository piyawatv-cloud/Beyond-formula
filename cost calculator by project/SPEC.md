# Cost Calculator by Project — Current Specification

Baseline: คำยืนยันผู้ใช้ 2026-09-05. เอกสารนี้แทนข้อกำหนดเก่าที่ขัดกัน ไม่ได้ยืนยันว่า implementation เสร็จแล้ว.

## Pricing and disclosure authority — Q21–Q23 ล่าสุด

ข้อยืนยันรอบ 6 มีลำดับเหนือถ้อยคำเดิมที่เรียกยอดแจ้ง Sales ว่าต้นทุน: แยกต้นทุนจริงก่อนบวก → ราคาหลังบวกของหมวด → ราคาขายสุดท้าย. Sales/OPC เห็นเฉพาะยอดหลังบวก RM/PK/Operation และยอดรวมจากฐานที่เปิดเผยได้ ไม่เห็นต้นทุนจริงก่อนบวก. เมื่อกฎยังไม่กำหนด แสดงรอกำหนดราคา ไม่ fallback เป็นต้นทุนจริงหรือบวกศูนย์. คำว่าต้นทุนจริงก่อนบวกในส่วนนี้คือฐานคำนวณก่อน policy ไม่ใช่ actual production cost หลังผลิตที่รอเชื่อมระบบภายหลัง.

## Delivery boundary — Q27–Q29 ล่าสุด

ระบบรอบนี้จบที่ราคาที่พร้อมให้ Sales นำไปเสนอลูกค้า ตาม CEO approval และ quote revision controls ที่ยืนยันไว้ พร้อมส่งสรุปตัวเลขเบื้องต้นที่เปิดเผยได้เข้า chat ของ project เดิมใน Formula อย่างต่อเนื่อง. ไม่กำหนดหรือรับผิดชอบ lead time ส่งมอบรวม/คิวผลิต/QC/การส่งสินค้าหรือการสื่อสารกับลูกค้าแทน Sales. Material LT ยังเป็นข้อมูลเลือกวัสดุและยืนยันเงื่อนไข Procurement. WMS และ actual-production-cost integration เป็นแผนภายหลัง ไม่ใช่เกณฑ์รับงานรอบนี้.

## Workflow ที่ยืนยัน

1. Sales รับโจทย์จาก project Formula ไม่กรอกข้อมูลลูกค้า/briefซ้ำโดยไม่จำเป็น.
2. RD เลือก/พัฒนาสูตร กำหนดความต้องการและยอมรับ spec บรรจุภัณฑ์ พร้อม routing ตั้งแต่ต้น; PU-PK เลือก PK item/Tier และยืนยันเงื่อนไขใน scenario เดียวกัน. ใช้ Data Center แบ่ง RM, PK(PU-PK), Operation; RD เห็น PK เฉพาะรายละเอียดการใช้งานและยอดหลังบวก.
3. Procurement ยืนยันวัสดุ/vendor/หนึ่งTier/ราคา/MOQ/Lead Timeก่อนใช้ราคาที่พร้อมเสนอ.
4. คำนวณต้นทุนตามจำนวนผลิต. Margin/markupเว้นไว้กำหนดภายหลัง แต่ต้องออกแบบให้ตั้งค่าแล้วใช้งานได้โดยไม่แก้สูตรระบบ.
5. Sales ใช้ cost calculator by project เปรียบเทียบscenario แก้revisionได้ เห็นต้นทุนแยกชั้นและจัดผลลัพธ์เพื่อเสนอลูกค้า.
6. CEO อนุมัติแล้วล็อกquotation version. การแก้ต้องสร้างrevisionใหม่และขออนุมัติใหม่ตามการเปลี่ยนแปลง.
7. WMS/actual cost เป็น roadmap ภายหลัง; รอบนี้ไม่สร้างระบบบันทึกผลิตหรือผูกการรับงานกับ integration ดังกล่าว.

## Cost layers

- RM: สูตร/ปริมาณใช้/หน่วย/selected approved Tier; รวมส่วนประกอบที่ใช้จริง. แยกnet usage, planned loss และpurchase quantity.
- PK: packaging BOMจากPU-PK, units per selling unit, price tier/MOQ, loss และค่าใช้จ่ายเฉพาะงานที่เกี่ยวข้อง.
- Operation: routing/ลำดับขั้นที่RDกำหนดให้ครบ; DL (direct labor) และ OH (overhead) แยกกันแต่รวมเป็นต้นทุนoperation.
- Proposed operation contract: step ID, process name, setup/run time, labor crew or person-hours, machine-hours/capacity, rate version, allocation basis, yield/loss basis และข้อจำกัดbatch. ต้องเลือกฐานจริงกับเจ้าของอัตราก่อนลงสูตร; ห้ามนับsetup,DLหรือOHซ้ำในflat rateและhourly rate.
- ค่าใช้จ่ายครั้งเดียว/ต่อbatch/ต่อหน่วยต้องแยกฐาน; กติกาเก็บแยกหรือเฉลี่ยยังต้องยืนยัน. ไม่มีค่าจริงให้ใช้สถานะmissing ไม่ใส่0เงียบๆ.
- ต้นทุนต่อหน่วยขาย = ต้นทุนที่จัดสรรให้ล็อต / หน่วยขายที่ส่งมอบได้; unit conversion และyieldต้องชัด.
- Procurement cash = จำนวนซื้อจริงตามMOQ/pack increment × applicable price; ไม่ใช่ต้นทุนใช้จริง. Inventory exposureแสดงแยกและต้องมีownerรับความเสี่ยง.

## Calculator / revision (design proposal for next step)

หนึ่งProjectมีหลายScenario/Revisionได้; ยังไม่กำหนดphysical schemaหรือเปลี่ยนFormula JSON contract. เก็บอ้างอิงFormula version, RM/PK quote versions, routing/rate versions, quantity/packaging assumptions, calculation version และapproval record.

Internal view: RM / PK / DL / OH / other cost / total / per selling unit / purchase cash / leftover exposure / missing data.
Customer-facing view: สินค้า/ขนาดบรรจุ/จำนวนสั่ง/ราคาที่อนุมัติ/ค่าใช้จ่ายแยก/เงื่อนไข/validity โดยไม่กำหนด lead time ส่งมอบรวมในระบบนี้ และไม่เปิดเผยsupplierหรือconfidential BOM/cost breakdownโดยอัตโนมัติ.
Cost calculatorแก้Draftได้; approved quoteเป็นsnapshot ไม่ใช่live lookupที่เปลี่ยนตามsync. งบเป้าหมายไม่ใช่ต้นทุนจริง. ถ้ายังไม่มีpricing policy ให้คำนวณcostได้แต่final selling priceยังไม่พร้อมอนุมัติ.

## Data Center rules ที่ยืนยันแล้ว

คงสองsourceต้นฉบับ; syncผ่านnative mirrorทุก30นาทีเป็นเป้าหมาย ไม่ใช่สถานะที่ผ่านแล้ว. RM legacy tab name→ชื่อสารที่ขอมา. RDเลือกgroup→offered material/vendor; codeไม่ใช่จุดเริ่มบังคับ. Child rowsจับคู่qty/priceตามตำแหน่ง. อ่านไม่ชัดให้DQพร้อมหลักฐาน; manual confirmationในData Centerไม่ใช่แก้ต้นฉบับ. เก็บประวัติและให้Procurementยืนยันทุกcommercial versionก่อนใช้.

## Reference adaptation

Budget Planner reference: ใช้แนวทางsetupกลาง, input fieldsชัดเจน, บันทึกครั้งเดียวสรุปหลายหน้า, plan-vs-actual และdashboard. ไม่ยกสูตรpersonal finance/VAT/debtมาเป็นOEM costing. การอ่านreferenceก่อนหน้าเป็นmetadataและsample formulas ไม่ใช่full workbook audit.

## Acceptance criteria

- Source-row reconciliation: imported/excluded/DQครบ ไม่หายเงียบ; slash casesไม่จับคู่ข้ามตำแหน่ง.
- Material/price/MOQ/LTหรือapprovalไม่ครบต้องblockquotation; approveต้องผูกidentity/log/current version.
- Operationครบroutingที่RDตั้ง; DL/OHถูกฐานไม่ซ้ำ; RM/PK/Operationรวมกลับเป็นtotalได้.
- Scenarioหลายจำนวนใช้applicable tiers/ratesจริง ไม่ลดราคาเดา.
- แก้revisionแล้วapproved quoteเดิมไม่เปลี่ยน; CEOเป็นcommercial approver.
- Syncล้ม/ข้อมูลเก่าแสดงสถานะจริง; current generationไม่ผสมครึ่งรอบ.
- UATใช้projectจริงที่ได้รับอนุญาตและsanitized testcases; ทดสอบจนผู้ใช้ยอมรับ ไม่มีpilotที่ผ่านแล้ว.

## Open decisions / dependencies

Project Formula integration contract; PU-PK semantic mapping/owner; Operation STD values/unitsและกฎแต่ละหมวด; batch/pack rounding; Procurement confirmation implementation contract; markup vs marginและผู้ตั้งpolicy; customer disclosureเพิ่มเติม. Actual-cost keys/allocation scope เป็น dependency ของ roadmap ภายหลัง ไม่ใช่ blocker ของรอบนี้. ห้ามถือข้อเสนอเหล่านี้เป็นข้อยืนยันโดยอัตโนมัติ.

## Grill round 1 — ข้อยืนยันผู้ใช้ 2026-09-05

- UAT: ผู้ใช้จะทดสอบจริงเมื่อระบบพร้อม ปัญหาหลักที่ต้องแก้คือ RD ต้องเปิดสอง Sheet ค้นกลุ่มแล้วไล่อ่าน RM จำนวนมากที่ชื่อคล้ายแต่ spec/LT/MOQ/ราคาต่างกัน ยังไม่ได้กำหนดตัวเลขเกณฑ์ยอมรับหรือถือว่า UAT ผ่าน.
- RM selection: ช่องเลือก item สำหรับคำนวณต้นทุนต่อชิ้นต้องให้ RD เลือกได้อิสระและเห็นรายละเอียดชัดเจน ผู้ใช้ยืนยันรอบ 2 ว่าเลือกได้เฉพาะใน Data Center; ไม่พบให้ขอ Procurement เสนอวัสดุ/spec ใหม่ ส่วนการใช้รายการยังไม่ยืนยันใน draft ยังต้องถามต่อ ไม่เปลี่ยนข้อห้ามใช้ข้อมูลไม่พร้อมกับ quotation.
- First result: เมื่อได้ราคาแรก ต้องมีปุ่มส่งไปยัง chat ของ project เดียวกันใน Formula เพื่อให้ Sales รับทราบก่อนขั้นถัดไป รอบ 2 ยืนยันว่าคือต้นทุนประมาณการภายในต่อชิ้น พร้อมจำนวนผลิต ขนาดบรรจุ revision รายการค้าง และลิงก์ calculator; Sales/OPC ห้ามเห็น supplier, supplier price และชื่อวัตถุดิบเต็ม/ตามใบเสนอราคา.
- MOQ leftover: Procurement ประเมินความเสี่ยงและเสนอวิธีจัดการ CEO อนุมัติผลกระทบทางการค้า แสดงแยกจากต้นทุนใช้จริง ไม่สมมติว่าจะใช้หรือขายของเหลือได้.
- Operation: ฝ่ายผลิตยืนยันเวลา/กำลังผลิต/จำนวนคน บัญชีต้นทุนหรือการเงินยืนยันอัตราและฐานจัดสรร RD กำหนด routing ผู้ใช้จะกำหนด STD เริ่มต้น ให้เตรียมข้อมูลรองรับโดยไม่ใส่ค่าหรือหน่วยสมมติ รอบ 3 ยืนยันแยกสถานะใช้ทดสอบ/อนุมัติใช้เสนอราคา พร้อมผู้รับรองและวันที่มีผล; ไม่ใส่ตัวเลขจนกฎแต่ละหมวดชัดเจน.
- Procurement inquiry: ต้องมีปุ่มส่งข้อความและอีเมลสอบถาม Procurement โดยอ้างอิงสถานการณ์และ project ปัจจุบัน เพื่อยืนยันข้อเสนอที่ใช้ได้พร้อมเหตุผล/หลักฐาน รายการขัดกันต้องหยุดก่อนใช้เสนอราคา วิธีบันทึกคำยืนยันให้ระบบไปต่อยังอยู่ระหว่างออกแบบ ไม่ได้อนุญาตให้ส่งข้อความจริงในรอบเอกสารนี้.
- Price change while awaiting CEO: เก็บ revision เดิม พักการอนุมัติจน Procurement ยืนยันเงื่อนไข หากเงื่อนไขเปลี่ยนให้คำนวณ revision ใหม่ ใบเสนอราคาที่อนุมัติแล้วไม่เปลี่ยนย้อนหลัง.

## Procurement workflow — ข้อเสนอรอคำตอบ

- RM picker: ค้นชื่อ/กลุ่มและเปรียบเทียบ offered material แยก spec/vendor พร้อม LT, MOQ+unit, price+unit, tier และสถานะยืนยัน ไม่รวมชื่อคล้ายเป็นวัสดุเดียวโดยอัตโนมัติ.
- Procurement inquiry เป็นรายการติดตามเดียวที่อ้าง project/scenario/revision/material/เงื่อนไขที่สอบถาม ช่องทางข้อความและอีเมลนำกลับรายการเดียวกัน ไม่ถือคำตอบในข้อความว่าอนุมัติโดยอัตโนมัติ.
- Confirmation: ผู้มีสิทธิ์ยืนยันตัวตนแล้วตรวจ material/spec/vendor/หนึ่ง tier/ราคาและหน่วย/MOQและหน่วย/LT/อายุราคา พร้อมเหตุผลและหลักฐาน ระบบตรวจความครบและ revision ปัจจุบันก่อนปลดรายการที่รอ หากเสนอวัสดุหรือ spec ใหม่ต้องให้ RD รับรองก่อนนำไปแทน.
- รอบ 3 ยืนยันขั้นเพิ่มวัสดุ/รับรอง spec และ partial cost แล้ว; รอบ 4 ยืนยันขอบเขตแก้ชื่อแล้ว; กฎราคาของแต่ละหมวดยังรอเจ้าของกำหนด.


## Grill round 2 — ข้อยืนยันผู้ใช้

- เลือก RM ลงสูตรได้เฉพาะรายการที่มีใน Data Center หากไม่มีต้องส่งคำขอให้ Procurement เสนอวัสดุหรือ spec ใหม่ ห้ามเพิ่ม free-text material ที่ข้าม Data Center ไปคำนวณ.
- ส่งผลประมาณการต่อชิ้นเข้าห้องแชท project พร้อมจำนวนผลิต ขนาดบรรจุ revision รายการค้าง และลิงก์ calculator; Q22 ล่าสุดกำหนดให้ยอดที่ Sales/OPC เห็นเป็นยอดหลังบวกเท่านั้น.
- Sales/OPC ห้ามเห็นชื่อซัพพลายเออร์ ราคาซัพพลายเออร์ และชื่อวัตถุดิบเต็มหรือชื่อบนใบเสนอราคา ข้อจำกัดครอบคลุมหน้าจอ calculator, chat, search, export, notification และข้อมูลที่ส่งถึงผู้ใช้; ซ่อนเฉพาะหน้าจอไม่เพียงพอ. รอบ 3 ยืนยันใช้ชื่อแสดงที่ RD กำหนด; เห็นยอดต่อชิ้นและ RM/PK/Operation แต่ไม่เห็นต้นทุนรายวัสดุหรือเอกสารราคาต้นทาง.
- เงื่อนไขกลางที่ยังมีผลใช้ซ้ำได้เมื่อวัสดุ/vendor/Tier/ข้อจำกัดตรงกัน ราคาพิเศษและการรับภาระของเหลือเฉพาะงานต้องผูก project.
- เตรียม STD แยก setup ต่อ batch, run time/capacity, crew, DL/OH rates, หน่วยและวันที่มีผล; แบบเหมารวมต้องระบุรายการที่รวมไว้ ไม่ใส่ค่าตัวเลขแทนผู้ใช้. รอบ 3 ยืนยันสถานะใช้ทดสอบ/อนุมัติใช้เสนอราคาแยกกัน พร้อมผู้รับรองและวันที่มีผล; กฎแต่ละหมวดยังรอกำหนด.

## Proposed data flow — รอข้อยุติ ไม่ใช่ physical schema

1. Sourcing request อ้าง project/revision/ความต้องการ spec/จำนวน/กำหนดใช้ เป็นงานค้าง ไม่ใช่ material line ที่คำนวณได้.
2. Procurement ค้นรายการเดิมก่อน หากเป็นวัสดุเดิมให้เพิ่ม commercial offer version; หาก spec ใหม่ให้เสนอ candidate ใน Data Center พร้อมหลักฐาน โดย RD รับรอง identity/spec ไม่แก้ต้นฉบับ read-only. รอบ 3 ยืนยันเก็บใน Data Center กลาง สถานะรอ RD รับรอง spec; โครงสร้างจัดเก็บจริงยังไม่กำหนด.
3. Commercial offer version เก็บ material/spec reference, vendor, tier ที่มีคู่ราคาและ MOQ พร้อมหน่วย, LT, validity, ข้อจำกัดและขอบเขต general/project, source evidence. Confirmation event อ้าง exact version พร้อมผู้มีสิทธิ์/เวลา/เหตุผล. การแก้เงื่อนไขสร้างเวอร์ชันใหม่และต้องยืนยันใหม่.
4. วัสดุ/spec ผ่าน RD และเงื่อนไขผ่าน Procurement ครบแล้ว จึงแสดงเป็นพร้อมเลือกสำหรับ quotation ภายใต้ scope/validity/quantity ที่เข้าเงื่อนไข. การยืนยันไม่ได้เลือก Tier ลงสูตรหรือแทนรายการให้ RD อัตโนมัติ.
5. Formula scenario line อ้าง material/spec version และหนึ่ง selected offer/tier version พร้อมปริมาณใช้และหน่วย. คำนวณจากปริมาณที่จัดสรรให้ล็อตและราคาหน่วยที่แปลงแล้ว; cash คำนวณจากจำนวนซื้อจริงตาม MOQ/pack increment แยกต่างหาก. ไม่ต้องคัดลอกราคาด้วยมือ.
6. เมื่อมีเงื่อนไขใหม่ แสดงความเปลี่ยนแปลงให้ RD รับเข้าฉบับทำงานอย่างชัดเจน ไม่เปลี่ยนสูตรเงียบๆ. ถ้าเป็น revision รอ CEO ให้พักและสร้าง revision ใหม่ตาม policy; approved quotation คงเดิม.
7. ข้อมูลจำกัดสิทธิ์ใช้โดย cost engine แต่ไม่ส่ง raw supplier terms หรือชื่อเต็มไป Sales/OPC. ต้องพิจารณาการย้อนหาราคาซัพพลายเออร์จากต้นทุนรายวัสดุหารปริมาณใช้; รอบ 3 ยืนยันส่งยอดรวม/ชั้น RM/PK/Operation โดยไม่เปิดต้นทุนรายวัสดุหรือเอกสารราคาต้นทาง.


## Grill round 3 — ข้อยืนยันผู้ใช้ (Q10–Q13)

- Procurement เพิ่มวัสดุ/spec ใหม่ใน Data Center กลางเป็นรอ RD รับรอง spec ไม่แก้ RM ต้นฉบับ; พร้อมเลือกใช้เสนอราคาเมื่อผ่านทั้ง spec และเงื่อนไขซื้อครบ.
- RD กำหนดชื่อแสดงที่เปิดเผยได้ ต้องมีช่องกรอกในหน้าทำสูตร และวางแผนให้ตั้งชื่อจาก Data Center เพื่อใช้ซ้ำลดการกรอกทุกสูตร. รอบ 4 ยืนยันแก้ในสูตรเฉพาะ revision; แก้ชื่อกลางเป็นคำสั่งแยกของ RD และไม่เปลี่ยนเอกสารอนุมัติย้อนหลัง.
- Sales/OPC เห็นยอดหลังบวกต่อชิ้นและระดับ RM/PK/Operation ตาม Q22 ล่าสุด แต่ไม่เห็นต้นทุนรายวัสดุ เอกสารราคาต้นทาง supplier/ราคา supplier/ชื่อ RM เต็ม ทั้ง calculator/chat/export. การส่งข้อมูลจริงต้องบังคับตามสิทธิ์ ไม่ใช่แค่ซ่อนคอลัมน์.
- หากข้อมูลไม่ครบ ส่งสถานะและต้นทุนเฉพาะส่วนที่ทราบพร้อมรายการค้างได้ ต้องระบุว่า “ยังไม่ใช่ต้นทุนรวมต่อชิ้น” ไม่ให้ผลรวมบางส่วนกลายเป็นฐานเสนอราคา.
- STD แยกใช้ทดสอบ/อนุมัติใช้เสนอราคา พร้อมผู้รับรองและวันที่มีผล เตรียมช่องข้อมูลโดยไม่ใส่ตัวเลขจนกฎการบวกราคาแต่ละหมวดระบุ. รอบ 4 ยืนยันคำนวณต้นทุนได้เมื่อฐานต้นทุนครบ; กฎราคาขายรายหมวดแยกต่างหากและยังไม่ใส่อัตรา. หมวดและฐานที่จะรองรับยังต้องระบุ.

## Grill round 4 — ข้อยืนยันผู้ใช้ (Q14–Q16)

- ชื่อแสดงจาก Data Center เป็นค่าเริ่มต้น; แก้ชื่อในหน้าสูตรมีผลเฉพาะ revision นั้น การแก้ชื่อกลางเป็นการกระทำแยกของ RD ไม่เปลี่ยน approved quote ย้อนหลัง.
- ถ้ายังไม่มีชื่อแสดง ห้าม fallback เป็นชื่อเต็มใน Sales/OPC view; ใช้ชื่อกลางที่ไม่เปิดเผยข้อมูล เช่น รายการวัสดุ 1 จน RD กำหนดชื่อที่อนุญาต.
- ต้องแยก cost calculation/STD ออกจาก selling-price policy เพื่อคำนวณต้นทุนได้เมื่อฐานต้นทุนครบแม้ยังไม่ได้กำหนดราคาขาย. ตัวเลข uplift/margin และกฎรายหมวดรอเจ้าของกำหนด.


## Grill round 5 — ข้อยืนยันผู้ใช้ (Q17–Q20)

- Quantity basis: เริ่มจากจำนวนหน่วยขายที่ต้องส่งมอบและขนาดบรรจุ คำนวณย้อนเป็นปริมาณผลิตและ RM/PK ระบุหน่วยทุกตัวเลข.
- Planned loss/yield: RD ร่วมกับฝ่ายผลิตกำหนดตามขั้นผลิตและวัสดุที่เกี่ยวข้อง แยกการสูญเสียเนื้อผลิตภัณฑ์กับ PK ไม่ใช้เปอร์เซ็นต์เดียวซ้ำทุกชั้น เตรียมช่องไว้ก่อน; ค่าว่างหมายถึงยังไม่ยืนยัน ไม่ใช่ศูนย์.
- Inventory: การเชื่อม WMS เป็นแผนงานต่อเมื่อระบบ go-live ยังไม่ใช่ capability ปัจจุบันและไม่มีการดึง/หัก/จอง stock จริง. Q25 ยืนยันคำนวณจากความต้องการของงานตาม MOQ/หน่วยสั่งซื้อก่อนตรวจ stock ไม่ใช่ยอดสั่งซื้อจริง และไม่ใช่ยอดซื้อสุทธิหลังหัก stock.
- Other costs: แต่ละรายการระบุฐานครั้งเดียว/ต่อ batch/ต่อหน่วย และวิธีเรียกเก็บ แสดงผลกระทบใน scenario ป้องกันเฉลี่ยเข้าต้นทุนต่อชิ้นแล้วเก็บซ้ำ. ช่วงแรกไม่บังคับกรอกแต่ต้องแสดงรอข้อมูล ไม่แทนด้วยศูนย์. Q23 ยืนยันก่อนเสนอราคาต้องครบจำนวนเงินหรือยืนยันว่าไม่เกี่ยวข้อง; draft และผลบางส่วนทำต่อได้.
- Cross-department pricing: RM จาก RD, PK จาก PU-PK; ห้ามเห็นราคาจริงของกันและกัน ยกเว้นราคาที่บวกแล้ว. Q21–Q22 ยืนยันแยกฐานก่อนบวก/หลังบวก/ราคาขายสุดท้าย และบัญชีต้นทุน/การเงินกับ CEO เห็นต้นทุนจริงรวมเมื่อได้รับสิทธิ์; สูตร/อัตรายังไม่ยืนยัน; Q24 ยืนยันแยก Procurement RM และ PU-PK ตามหมวด และผู้ดูแลข้ามหมวดต้องมีสิทธิ์เฉพาะ. ข้อกำหนดนี้มีลำดับเหนือ internal view แบบรวมที่อาจเปิดราคาข้ามฝ่าย; ไม่อนุญาตให้แก้ runtime permissions ในรอบเอกสารนี้.

## Grill round 6 — ข้อยืนยันผู้ใช้ (Q21–Q23)

- แยกต้นทุนจริงก่อนบวก → ราคาหลังบวกของหมวด → ราคาขายสุดท้าย; ขั้นที่จะบวก/สูตร/อัตรารอกำหนด ไม่บวกซ้ำ. ผู้ไม่มีสิทธิ์เห็นต้นทุนจริงเห็นรอกำหนดราคาเมื่อยังไม่มีกฎ ไม่ใช้ราคาจริงหรือบวกศูนย์แทน.
- RD เห็นราคาจริง RM, PU-PK เห็นราคาจริง PK; ข้ามฝ่ายเห็นเฉพาะยอดหลังบวก. บัญชีต้นทุน/การเงินและ CEO เห็นต้นทุนจริงรวมเมื่อกำหนดสิทธิ์ให้ ไม่ให้ทุกบัญชีโดยชื่อ role อย่างเดียว.
- Sales/OPC เห็นยอด RM/PK/Operation หลังบวกเท่านั้น ยังคงห้าม supplier, supplier price, ชื่อวัสดุเต็ม, ต้นทุนรายวัสดุและเอกสารราคาต้นทาง. Calculator/chat/export/notification ต้องใช้ฐานการเปิดเผยเดียวกัน ไม่ให้ลิงก์ย้อนเปิดรายละเอียดที่ไม่มีสิทธิ์.
- ห้ามแสดงต้นทุนจริงรวมแก่ผู้ไม่มีสิทธิ์ข้ามหมวด เพราะอาจลบยอดที่รู้เพื่อย้อนหาหมวดที่ซ่อน. Q24 ยืนยัน Procurement RM เห็น/ยืนยัน RM, PU-PK เห็น/ยืนยัน PK; ฝ่ายผลิต/บัญชีต้นทุน/การเงิน/CEO เห็น Operation ตามหน้าที่ และ RD/PU-PK เห็นข้ามหมวดเฉพาะยอดหลังบวก.
- ค่าใช้จ่ายรอข้อมูลไม่ขวางทำสูตร เปรียบเทียบ draft และส่งผลบางส่วนที่เปิดเผยได้. ก่อนเสนอราคาต้องยืนยันแต่ละรายการว่ามีค่าใช้จ่ายเท่าไรหรือไม่เกี่ยวข้อง; ไม่ถือยังไม่รู้เป็นไม่มีค่าใช้จ่าย. ถ้ายอดหลังบวกยังไม่มี ส่งเฉพาะสถานะ/รายการค้างได้โดยไม่เผยฐานจริง.

## Grill round 7 — ข้อยืนยันผู้ใช้ (Q24–Q26)

- Procurement: ฝั่ง RM เห็นและยืนยัน RM, PU-PK เห็นและยืนยัน PK; ผู้ดูแลที่ต้องเห็นทั้งสองหมวดได้รับสิทธิ์เฉพาะ. Operation ให้ฝ่ายผลิต/บัญชีต้นทุน/การเงิน/CEO ตามหน้าที่; RD และ PU-PK เห็นข้ามหมวดเฉพาะยอดหลังบวก.
- ก่อนเชื่อม WMS คำนวณจำนวนต้องซื้อจากความต้องการของงานตาม MOQ และหน่วยสั่งซื้อ โดยยังไม่หัก stock พร้อมข้อความ “ประมาณการก่อนตรวจสต็อก ไม่ใช่ยอดสั่งซื้อจริง” แยกจากต้นทุนใช้จริงและภาระของเหลือ.
- เมื่อเปลี่ยนจำนวน scenario ให้แสดงเฉพาะ Tier ที่ Procurement ยืนยันและเข้าเงื่อนไข พร้อมเทียบต้นทุนใช้จริง/เงินซื้อ/ของเหลือ ให้ RD กดยืนยันตัวเลือกใหม่ในขอบเขต RM ที่มีสิทธิ์; ไม่สลับวัสดุหรือซื้อเพิ่มเพื่อราคาถูกอัตโนมัติ. MOQ/จำนวนเพิ่มต่อการสั่งซื้อมาจาก Procurement เท่านั้น. Q27 ยืนยัน PU-PK เลือก PK item/Tier โดย RD รับรอง packaging spec; ห้ามเปิดราคา PK จริงให้ RD เพื่อทำตามกติกานี้.


## Grill round 8 — ข้อยืนยันผู้ใช้ (Q27–Q29)

- RD ระบุความต้องการและยอมรับ spec บรรจุภัณฑ์; PU-PK เลือก item/Tier และยืนยันเงื่อนไข. ใช้ scenario เดียวกัน; RD เห็นรายละเอียดการใช้งานและยอดหลังบวก ไม่เห็นราคาจริง PK.
- ตัด delivery lead-time ownership ออกจาก scope: จบที่ราคาพร้อมให้ Sales ไปเสนอลูกค้า และส่งสรุปเบื้องต้นเข้า project chat Formula อย่างต่อเนื่อง. ไม่สร้างงานยืนยันกำหนดส่งมอบรวมเพิ่ม.
- ยึดแหล่งเดิมของ PU-PK ตรวจโครงสร้างก่อนออกแบบนำเข้า ไม่สร้างทะเบียนซ้ำ. ต่อมาผู้ใช้ให้แหล่งจริงแล้ว: ตรวจ metadata และหัวคอลัมน์ PU-PK-Data แบบ read-only; source reference เก็บ local-only. ยังไม่ตรวจ business rows/formulas/runtime และยังไม่ระบุผู้ประสานงาน.

## Remaining prerequisites for G2

- PU-PK source location และ header schema ตรวจแล้ว; ต้องยืนยัน semantic mapping, approved/current status ของ engine เดิมก่อนนำมาใช้จริง; Q30 ยืนยันใช้ PK snapshots เดิมแล้ว. ไม่ถือ header presence ว่าฟังก์ชันผ่าน.
- กำหนด Formula project/revision/chat integration จาก source ที่ตรวจ, restricted payloads และเส้นทางชื่อวัสดุใน chat/log/export เดิม; compatibility ตาม parent governance.
- การส่งสรุป chat ต้องผูก project และ calculation revision ที่ส่ง แสดงเนื้อหาตามสิทธิ์พร้อมลิงก์เปิด revision ที่เกี่ยวข้อง; pending/failed/sent ต้องตรงกับผลระบบ ไม่รายงานว่าส่งสำเร็จจากการเก็บในเครื่องอย่างเดียว. รายละเอียดนี้เป็นข้อเสนอทางเทคนิคเพื่อรองรับ seamless flow ไม่ใช่การส่งข้อความจริงในรอบนี้.
- สรุป acceptance checks/แผนงานและยืนยัน shared understanding ก่อน implementation. Independent reviewer ตาม governance ยังไม่แต่งตั้งเฉพาะงาน.
- Pricing/STD/loss ตัวเลข intentionally deferred configuration; ไม่ถามให้เดาอัตรา. Final quote ต้องมีข้อมูลและ policy ที่จำเป็นครบก่อนพร้อมใช้งาน.


## PU-PK source structural inspection — 2026-09-05

Evidence: native Google Sheets metadata (28 tabs), header-only reads of seven tabs. Exact URL/IDs and header inventory remain in local-only/PU_PK_SOURCE_REFERENCE.md. No business rows, supplier prices, personal data, formulas, status values, permissions, scripts or runtime were inspected; no writes performed.

| Observed tab | Declared structure in headers | Integration implication / unresolved |
|---|---|---|
| Incoming_ReqPK | Req-PK No, Project / Brand / Product, quantity/unit, typed packaging specs and attachments | Existing request entrypoint; project text is not proof of a stable Formula project ID. Some fields address RM as well, so filter scope explicitly. |
| PK_Quote_Data | Quote_ID, Req-PK No, Qty/UOM/Currency, QuotedUnitPrice, MOQ, LeadTimeDays, policy snapshots, RequesterUnitPriceSnapshot, RequesterNetUnitPrice, CurrentPricingRevisionID/No/Status | Candidate quote identity/terms linkage. Two requester-price fields require semantic clarification; do not pick by name alone. |
| PU_Pricing_History | Snapshot_ID, Source_Quote_ID, Source_Fingerprint, scenario quantity/units, OutputPerRoll, OrderMultiple, WastagePct, RecoveryPct, BlockCost, supplier cash, effective cost, surplus/exposure, selling totals, revision/parent/status/superseded references | Existing declared pricing/revision shape overlaps calculator scope; prefer reuse after validation instead of building a second PK rule engine. Never assume recovery or policy values are approved for current project. |
| PK_Response_Outbox | Response_ID, quote/request IDs, approval/sent/status fields, PricingSnapshot_ID | Existing reply flow candidate; not evidence of CEO final quotation approval or authority to send. Reuse only if compatible with approved project workflow; Formula chat is a separate required integration. |
| Spec PK | ประเภท, spec, เทคนิค | Existing spec taxonomy candidate, not evidence of RD acceptance workflow. |
| PU_Policy_Markup | PolicyKey, RequestType, VendorCategory, effective dates, MarkupPct, PolicyVersion, Status, PKType | A policy table exists; rates/statuses were not read and are not adopted by this project automatically. |
| PU_Pricing_Config | Scope, Key, Value, Unit, Description, UpdatedAt | Config structure exists; no config values inspected or inherited. |

Q30 confirmed: reference verified PK quote/pricing snapshots from existing PU-PK; keep common project scenario and role-filtered totals here. Select one authority for PK calculations, not duplicate markup/MOQ/loss/block/surplus logic. Requester amount / selling amount / pricing base / actual purchase fields have distinct possible meanings; validate their equations and units before mapping. Historical approval fields cannot substitute for current Procurement confirmation/RD spec acceptance/CEO commercial approval without proof.


## Q30 — PK calculation ownership and independent progress (confirmed)

- PU-PK เลือก item/Tier และสร้างผลคำนวณเวอร์ชันที่ตรวจสอบได้; calculator อ้างอิงเวอร์ชันนั้นใน scenario รวมกับ RM/Operation และแสดงตามสิทธิ์. ตรวจสูตร/หน่วย/ความหมายสถานะเดิมก่อนใช้จริง ไม่สร้าง PK rule engine ซ้ำ.
- งานสูตร/RM ต้องทำต่อได้เมื่อ PK ช้า/ยังไม่มีผล/เชื่อมไม่ได้; แยกสถานะความพร้อม RM, PK, Operation และ pricing policy ไม่ล็อกทั้ง scenario เพราะ PK pending.
- ทำ/บันทึก/เปรียบเทียบ draft สูตรและ RM ได้ และส่งสรุปเฉพาะส่วนที่ทราบและเปิดเผยได้เข้า project chat พร้อมรายการค้าง; ถ้ายังไม่มีราคาหลังบวกไม่ส่งต้นทุนจริงแทน.
- PK missing ไม่เท่ากับศูนย์ ผลรวมบางส่วนต้องระบุยังไม่ใช่ต้นทุนรวมต่อชิ้น; final quotation ยังต้องผ่านข้อมูล/นโยบาย/การอนุมัติที่กำหนดครบ ไม่ได้ยกเว้น PK เพื่อให้งาน RM เดินต่อ.
- แยกงานตรวจและเชื่อม PK ออกจากงานสูตร/RM ในแผนพัฒนา โดยใช้ interface contract ที่ทดสอบด้วยข้อมูล synthetic ได้ระหว่างรอ source validation; ห้ามอ้าง synthetic response เป็น PK จริงที่ยืนยันแล้ว.

## Q31 — PK reuse applicability (confirmed)

- ผู้ใช้ยืนยันใช้ PK version เดิมต่อเมื่อ spec บรรจุภัณฑ์ จำนวน ขนาดบรรจุ เงื่อนไขและอายุราคาไม่เปลี่ยน; revision ใหม่ต้องอ้างเวอร์ชันที่ใช้ชัดเจน. ผู้ใช้ชี้แจงแล้ว: เวอร์ชันที่ยังไม่ยืนยันอ้างใน draft พร้อมสถานะรอยืนยันได้; ราคาพร้อมเสนอใช้เฉพาะเวอร์ชันที่ยืนยันแล้วและยังเข้าเงื่อนไข.
- หากปัจจัยที่มีผลต่อ PK เปลี่ยน ส่งให้ PU-PK ยืนยันใหม่ แต่สูตร/RM ทำต่อได้; ต้องรวมผลที่ตรงกับความต้องการปัจจุบัน ไม่รับคำตอบเก่ามาทับคำขอใหม่. ไม่เปลี่ยน approved quote ย้อนหลัง.
- reuse แบบพร้อมเสนอได้เฉพาะ PK version ที่ยืนยันแล้วและยังใช้ได้; version ที่ยังไม่ยืนยันเก็บอ้างอิงใน draft พร้อมสถานะรอยืนยัน แต่ไม่ปลด gate หรือถือเป็น PK พร้อมเสนอ.

## Focused acceptance cases for independent progress

- ไม่มี PK/PK unavailable: RD แก้ RM และบันทึก scenario ได้; ไม่แสดง PK เป็นศูนย์หรือ total ready.
- PK response ช้า: ความคืบหน้า RM ไม่สูญหาย; เมื่อรับผลแล้วไม่เขียนทับ RM revision.
- PK response ไม่ตรง quantity/spec/request version ปัจจุบัน: ไม่ปลดสถานะพร้อมเสนอราคา; แสดงให้ตรวจ.
- ส่งสรุปบางส่วน: เป็นยอดหลังบวกที่ผู้รับเห็นได้ + revision + missing PK + link; policy missing ส่งได้เฉพาะสถานะที่ไม่เผยฐานจริง.
- Final quote: บล็อกเมื่อ PK/หมวดบังคับ/policy/approval ยังไม่ครบ; approved snapshot ไม่เปลี่ยนเมื่อ PU-PK อัปเดตภายหลัง.


## PK negotiation and integration — workflow accepted for trial; technical adapter still proposed

User constraint: PU-PK may source repeatedly, negotiate and change offers. Keep negotiation in PU-PK, avoiding confirmation and duplicate entry in both systems on every round.

- Request scope: link Formula project/scenario and packaging requirement revision to existing Req-PK No references. Multiple component requests/quotes may belong to one scenario. Same requirement can retain request reference through negotiation; changed requirement must retain a traceable new version rather than overwrite evidence.
- Negotiation: retain vendor offers and counteroffers as versions referencing Quote_ID; do not force every negotiation round into a ready-to-quote status or auto-update an adopted calculator version. Do not assume current PU-PK implementation already preserves every counteroffer.
- Selection/confirmation in PU-PK: responsible PU-PK user selects item/Tier per required PK component, verifies price/currency/unit/MOQ/order multiple/LT/validity/spec reference/evidence and confirms the selected pricing result. Formula/RD acceptance covers packaging suitability; no additional RD approval of supplier price.
- Confirmation is for a selected snapshot/selected set of components, not approval of every supplier offer. Supporting evidence can cover multiple lines; confirmation records who/when/exact version/scope and any unresolved items. Missing required components remain partial.
- Integration identity candidates observed in headers: Req-PK No, Quote_ID, Snapshot_ID, CurrentPricingRevisionID. Their actual equations/state values/referential integrity are unverified; do not equate generic Status, ApprovedToSend, SentAt or latest UpdatedAt with commercial confirmation.
- Adapter proposal: read restricted, versioned results from authoritative PU-PK and map to shared scenario via verified project/requirement references. Store an explicit adopted PK result reference with sufficient frozen evidence for audit. Reads must return a coherent confirmed version; repeated delivery of the same result must not create a new revision or duplicate chat summary. Transport/hosting/auth/schema changes require separate technical design and governance review.
- Calculator offers explicit adoption of a matching result, never copies supplier numbers by hand. Only users with the relevant scope receive raw fields; RD/Sales/OPC get permitted usage/spec and adjusted amounts. Draft reference stays pending while source confirmation is pending.
- Changed price after adoption: new source result version, visible update notice, no silent replacement. Adopt into a new calculator revision when applicable; approved quotation stays unchanged. If old terms expire/are withdrawn, mark the old result not eligible for a new final quote even if it was previously confirmed. Negotiation alone does not invalidate a still-valid offer unless evidence says so.
- Scope-changing proposal (spec/pack/quantity): RD accepts changed packaging suitability and PU-PK recalculates/validates applicable terms before ready status. Formula/RM remain editable throughout.
- Source unavailable/late/inconsistent: retain adopted result/history, show current verification/freshness status accurately and prevent unsupported readiness; no overwrite of RM or assumption that newest row is approved.

Proposed action labels (not observed runtime states): บันทึกร่าง/รอต่อราคา → ยืนยันผล PK ที่เลือก → นำเวอร์ชันนี้มาใช้. Actual source state mapping must be validated before implementing these labels.


## Authorized local trial

User accepted negotiation → selected-result confirmation in PU-PK → calculator version adoption and requested a trial. Local synthetic workflow trial completed with 14 passing tests; see docs/PK_WORKFLOW_TRIAL.md. No live PU-PK adapter or parent application changes were made. This acceptance permits the bounded local trial, not production writes/deployment or use of unverified PU-PK formulas. Confirmed workflow is no longer pending user agreement; detailed live integration remains to be validated.


## Implementation planning reference

See [Implementation Plan](docs/IMPLEMENTATION_PLAN.md) for the reviewed requirement map, task cards, sequencing, dependencies, risk gates and acceptance evidence. It is a draft work plan, not implementation/release approval. [TASK](TASK.md) tracks current progress and earlier evidence. Notion connection is unavailable; no Notion artifact exists yet. Existing unvalidated technical proposals are assigned to contract/source-validation tasks instead of silently treated as approved designs.

---

## Grill round 9 — ทางเข้า Cost Calculation, dashboard, tab, สิทธิ์ · ข้อยืนยันผู้ใช้ 2026-09-06

ส่วนนี้**มีลำดับเหนือ**ถ้อยคำเดิมที่ขัดกัน โดยเฉพาะ Workflow ข้อ 5 ("Sales ใช้ cost calculator เปรียบเทียบ scenario")
และข้อ 6 (CEO อนุมัติในเครื่องคำนวณ) — เจ้าของระบบตัดสินใหม่ว่า **Sales/OPC/Finance/CEO ไม่เข้าเครื่องคำนวณเลย**

### ภาพรวม

```
เมนูซ้าย (RD · Admin · PU-PK · Purchasing เท่านั้น)
  └─ [Cost Calculation]
       └─ Dashboard ใบงานต้นทุน ── ค้นหา ─┐
            │  รหัส · ลูกค้า/แบรนด์ · สถานะใบงาน · แก้ล่าสุด/โดยใคร · เจ้าของสูตร
            │  ราคาต่อหน่วยล่าสุด · สถานะต้นทุน · รูปแบบสินค้า · จำนวน revision
            ├─ [เปิด] ใบงานที่มี ────────────────► tab ภายในแอป: Cost Calculation
            ├─ [สร้างใหม่] ─┬─ อ้างอิงใบงาน Formula ─► ผูกทันที ─► tab
            │               ├─ สร้างลอย ─────────────► งานลอย ─► tab (ผูกทีหลัง)
            │               └─ โคลนจากใบงานต้นทุนเดิม ► งานลอย ติดทุกอย่างมา ─► tab
            └─ หลาย tab พร้อมกัน · ปิดต้องยืนยันถ้ายังไม่บันทึก

RD ส่งจาก tab ──► แชทโครงการ ──┬─ Sales/OPC เห็น: ราคาสรุปต่อชิ้น (ข้อความเดิม)
                                └─ CEO เห็น: ลิงก์ → หน้าเอกสารอ่านอย่างเดียว ทั้งฉบับ

Finance / CEO ──► หน้าตั้งค่าแยก: กฎการบวกราคา + อัตรามาตรฐาน Operation (ไม่ใช่เครื่องคำนวณ)
```

### หน้าจอ / ฟีเจอร์

| # | หน้าจอ | ใครใช้ | ตัดสินใจอะไร | เห็นข้อมูลอะไร | ทำอะไรได้ |
|---|---|---|---|---|---|
| S1 | ปุ่มเมนู **Cost Calculation** ท้ายซ้ายใกล้ Dashboard | RD · Admin · PU-PK · Purchasing | — | — | เปิด S2 · role อื่นไม่เห็นปุ่มและเปิดไม่ได้ทางใด ๆ |
| S2 | **Dashboard ใบงานต้นทุน** | เหมือน S1 | จะเปิดใบไหน / สร้างใหม่ | 9 คอลัมน์ตามภาพรวม | ค้นหา · เปิด · สร้างใหม่ (RD/Admin เท่านั้น) |
| S3 | **สร้างใบงานต้นทุน** | RD · Admin | อ้างอิง Formula / สร้างลอย / โคลน | รายชื่อใบงาน Formula ที่ยังไม่มีใบงานต้นทุน · รายชื่อใบงานต้นทุนที่โคลนได้ | เลือกทางแล้วเปิดเป็น tab |
| S4 | **tab Cost Calculation** (หน้าเครื่องคำนวณเดิม) | RD · Admin · PU-PK · Purchasing ตามสิทธิ์เดิม | สูตร RM · Tier · ปริมาณ | ตามสิทธิ์เดิม | เดิม + ผูกใบงาน Formula (ถ้ายังลอย) + โคลน |
| S5 | **แถบ tab** เหนือเนื้อหา | เหมือน S4 | สลับงาน | ชื่อ tab = รหัส + ลูกค้า/แบรนด์ (งานลอย = รหัสภายใน) · จุดแสดงว่ายังไม่บันทึก | สลับ · ปิด (ยืนยันถ้ายังไม่บันทึก) |
| S6 | **เอกสารต้นทุนอ่านอย่างเดียว** | CEO (และ RD/Admin) | อนุมัติ/ไม่อนุมัติ นอกระบบ | RM/PK/Operation ครบทุกบรรทัดของ revision ที่ RD ส่ง ไม่รวม VAT | อ่าน · ไม่มีปุ่มแก้ |
| S7 | **หน้าตั้งค่ากฎราคา** | Finance · CEO · Admin | markup รายหมวด · อัตรามาตรฐาน Operation | ตารางกลางเดิม | ตั้งค่า มีผลกับ revision ที่บันทึกหลังจากนั้น |

ทุกหน้าต้องมี 4 สถานะที่หน้าตาต่างกัน: กำลังโหลด (โครงหน้ายังอยู่) · ยังไม่มีข้อมูล (บอกว่าทำอะไรต่อ) · ผิดพลาด (รหัส + ลองใหม่) · ไม่มีสิทธิ์ (บอกว่าให้ใครเปิดสิทธิ์)

### กติกาธุรกิจ

1. ใบงาน Formula 1 ใบ มีใบงานต้นทุนได้ **1 ใบ** — ผูกซ้ำ = ปฏิเสธ พร้อมบอกชื่อเจ้าของสูตรของใบที่มีอยู่
2. ใบงานต้นทุนมี **รหัสภายในถาวร** (รูปแบบ `ยังไม่ยืนยัน — รอเจ้าของระบบ` · ข้อเสนอ `CJ-000001` ตัวนับแยกใน `fs_cost`) ช่องใบงาน Formula ว่างได้จนกว่าจะผูก ผูกแล้วรหัสไม่เปลี่ยน
3. งานลอย **ส่งสรุปเข้าแชทไม่ได้** (ไม่มีห้อง) — ต้องผูกก่อน
4. เจ้าของสูตร = ผู้สร้าง revision 1 ของใบงานต้นทุน · โคลนแล้วเจ้าของคือผู้โคลน
5. โคลนติด **ทุกอย่าง** รวมราคา RM ที่เลือกและ PK — แต่ตัวคำนวณตรวจ `validUntil`/`status`/`specApproved` ใหม่ทุกครั้ง ราคาที่หมดอายุขึ้น "รอ" ไม่ใช้เงียบ
6. ใบงาน Formula ปิดงานแล้ว → ใบงานต้นทุน**อ่านอย่างเดียว** โคลนไปทำใบใหม่ได้
7. สถานะใบงาน = จาก `closed` ของ Formula · สถานะต้นทุน = ร่าง (ยังไม่มี RM) / รอ PK / รอกำหนดราคา / พร้อมเสนอ (`complete`) — คำนวณจากรายการค้างที่มีอยู่
8. "แก้ล่าสุด โดยใคร" = `createdAt`/`createdBy` ของ revision ล่าสุดในใบงานต้นทุน ไม่ใช่ `updatedBy` ของ Formula
9. ราคาต่อหน่วยล่าสุดแสดงเฉพาะเมื่อ `complete` และเป็นราคา**ไม่รวม VAT** · มิฉะนั้น "รอ"
10. Sales/OPC ได้เฉพาะข้อความสรุปในแชท (ที่มีอยู่แล้ว) · CEO ได้ลิงก์ไป S6 ของ revision ที่ RD ส่ง — ลิงก์ชี้ revision คงที่ ไม่เลื่อนตาม
11. Finance/CEO ตั้งกฎราคาผ่าน S7 เท่านั้น · `costCapabilities().setPricing` ยังเป็นของ Finance/CEO/Admin แต่หน้าเครื่องคำนวณไม่แสดงส่วนตั้งค่าอีก
12. tab: เปิดหลายงานพร้อมกันได้ · ปิด tab ที่มี draft ค้าง = ยืนยันก่อน ห้ามบันทึกให้เอง
13. ผลงานภายใน 30 วินาทีต่อรายการ วัดที่ **เวลาของคน** ใน UAT — เวลาเครื่องวัดแล้ว 78 ms ต่อรายการ ไม่ใช่ข้อจำกัด

### ข้อมูลที่ต้องมี (ระดับหัวข้อ · โครงละเอียดเป็นงาน `/registry`)

- ใบงานต้นทุน: รหัสภายใน · ใบงาน Formula ที่ผูก (nullable) · เจ้าของสูตร · โคลนจาก (nullable) · revisions[] (มีอยู่แล้วเป็น `scenarios[]` ใน `fs_cost` — ต้องเพิ่มชั้น "ใบงาน" ครอบ scenario โดย**ไม่เปลี่ยน** โครง scenario เดิม)
- ตัวนับรหัสภายใน ใน `fs_cost` (ไม่ใช่ `fs_reccounter`)
- ลิงก์เอกสารสำหรับ CEO: รหัสใบงาน + revision · เก็บในข้อความแชท `type:'sys'`
- สถานะ tab ที่เปิดอยู่: ในหน่วยความจำของหน้าเท่านั้น ไม่ persist

### การเชื่อมต่อ

| ใคร | เรียกใคร | ตอนไหน | ถ้าล้มเหลว |
|---|---|---|---|
| S2 | `records` (อ่าน) | ทุกครั้งที่วาด | แสดงเฉพาะฝั่งต้นทุน คอลัมน์ Formula ขึ้น "อ่านใบงานไม่ได้" |
| S3 ผูก | `fs_cost` | กดผูก | ปฏิเสธพร้อมเหตุผล ไม่เขียนครึ่งเดียว |
| S4 ส่ง | `fs_chats` (append) | RD กดส่ง | ไม่รายงานสำเร็จ ไม่ทิ้งข้อความหลอก (พฤติกรรมเดิม) |
| S6 | `fs_cost` (อ่าน revision คงที่) | CEO เปิดลิงก์ | "ไม่พบ revision" ไม่ fallback ไป revision อื่น |

### Non-goals รอบนี้

- ไม่ทำ approve/lock quotation ในระบบ (CEO ตัดสินนอกระบบจากเอกสาร S6)
- ไม่ทำ tab เบราว์เซอร์จริง ไม่แตะ auth session
- ไม่ sync ใบงานต้นทุนขึ้น Supabase (ADR 0002 ยังใช้)
- ไม่ย้าย/แก้ปุ่ม Formula Studio เดิมนอกจากซ่อนปุ่ม "คำนวณต้นทุน" จาก role ที่ถูกตัด
- ไม่ทำหน้ารวมคำขอจัดหาสำหรับจัดซื้อ (รอบถัดไป)

### เกณฑ์รับงาน

- [ ] AC1 · login เป็น RD/Admin/PU-PK/Purchasing เห็นปุ่ม Cost Calculation · Sales/OPC/Finance/CEO/PD/RA/MKT ไม่เห็น และ `costCapabilities().open` เป็น false · เปิดผ่าน `#project=` และปุ่มในตาราง Dashboard ก็ถูกปฏิเสธ (มีเทสต์ทุก role)
- [ ] AC2 · dashboard แสดง 9 คอลัมน์ · ค้นหาด้วยรหัส/ลูกค้า/แบรนด์/เจ้าของสูตร ได้ผลภายใน 1 ตัวอักษร · ไม่แสดงราคาเมื่อยังไม่ `complete`
- [ ] AC3 · สร้างลอย → ได้รหัสภายใน · ผูกกับใบงานว่างได้ · ผูกกับใบงานที่มีแล้วถูกปฏิเสธพร้อมชื่อเจ้าของ · ผูกแล้วรหัสเดิม
- [ ] AC4 · โคลนติดราคาและ PK มาครบ และราคาที่หมดอายุในต้นฉบับขึ้น "รอ" ในใบใหม่
- [ ] AC5 · เปิด 2 tab สลับกันค่าที่กรอกไม่หาย · ปิด tab ที่มี draft ต้องยืนยัน · ยืนยันแล้วไม่มี revision ใหม่เกิด
- [ ] AC6 · ใบงาน Formula ปิดแล้ว: tab เป็นอ่านอย่างเดียว ปุ่มบันทึกไม่มี โคลนได้
- [ ] AC7 · CEO เปิดลิงก์เห็นเอกสารเต็มของ revision นั้น แก้ไม่ได้ · Sales เปิดลิงก์เดียวกันถูกปฏิเสธ
- [ ] AC8 · Finance ตั้งกฎราคาใน S7 แล้ว revision ที่บันทึกหลังจากนั้นใช้อัตราใหม่ ของเก่าไม่เปลี่ยน
- [ ] AC9 · ของเดิมใน Formula Studio: harness 37/37 ผ่านเหมือนเดิม ไม่มี key ใหม่นอก `fs_cost`
- [ ] AC10 · UAT: RD จริง 1 คน ทำใบงานจริง 1 ใบ จน Sales ได้ราคาในแชท จับเวลา ≤ 30 วินาที/รายการ · เจ้าของระบบตัดสินผ่าน

### ยังไม่ยืนยัน

- รูปแบบรหัสภายในใบงานต้นทุน — `ยังไม่ยืนยัน — รอเจ้าของระบบ` (ข้อเสนอ `CJ-000001`)
- ชื่อปุ่มเมนู "Cost Calculation" vs "Cost Calculator" ที่ใช้ในหน้าเดิม — `ยังไม่ยืนยัน — รอเจ้าของระบบ`
- ลำดับปุ่มในเมนู: ต่อจาก Dashboard หรือต่อจาก Chat — `ยังไม่ยืนยัน — รอเจ้าของระบบ` (คำสั่งบอก "ท้ายซ้ายใกล้ dashboard")
