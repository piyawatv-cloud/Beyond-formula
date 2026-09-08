# Ownership & integration registry

## ข้อมูลต้นทุน → PO → รับเข้า → MRP/Forecast — 2026-09-08

คำสั่งใหม่ให้เตรียมการแยกประเภทครอบคลุมโครงสร้างต้นทุน เพื่อทวนสอบ IN inventory และต่อยอด MRP/Forecast โดยไม่เพิ่มชีตเกินจำเป็น ส่วนนี้เป็น **logical contract สำหรับพัฒนาต่อ ยังไม่ใช่ schema/runtime ที่ติดตั้งแล้ว** ไม่เปลี่ยน ID/storage/สิทธิ์เดิม ไม่สร้าง PO หรือรับเข้าอัตโนมัติ และไม่เพิ่ม WMS เป็น gate ของ Phase E เดิม

### 1. แยกหมวด องค์ประกอบ และชนิดหลักฐาน

| มิติ | ค่า | ความหมาย |
|---|---|---|
| costCategory | RM / PK / OPERATION / OTHER | หมวดต้นทุน; OTHER ต้องมีรายละเอียด |
| costElement | MATERIAL / DL / OH / SETUP / TOOLING / TESTING / FREIGHT / SERVICE / OTHER | องค์ประกอบ ไม่เปลี่ยนหมวดหรือกฎการบวกราคาเดิม |
| evidenceType | ตามตารางถัดไป | ตัวเลขมาจากประมาณการ ภาระซื้อ หรือเหตุการณ์จริง |
| receiptMode | STOCK / SERVICE / ASSET / NONE / UNRESOLVED | เจ้าของข้อมูลยืนยันตามรายการ ไม่เดาจากหมวด; tooling อาจเป็นสินทรัพย์ บริการบรรจุไม่ใช่ stock PK |

| evidenceType | เจ้าของ / ใช้เมื่อ | ไม่ใช่ |
|---|---|---|
| SUPPLIER_OFFER | Procurement RM / PU-PK: ข้อเสนอราคา ใช้ประมาณการเมื่อเลือกเวอร์ชันและผ่าน gate ซื้อ/spec/หน่วย/อายุ/ขอบเขตเดิม | PO, stock หรือการรับประกันว่าจะซื้อได้ |
| STANDARD_RATE | Production ยืนยันเวลา/กำลังผลิต; Finance ยืนยันอัตรา ฐานจัดสรร วันที่มีผล และสิ่งที่รวมใน STD | ค่าใช้จ่ายเกิดจริง |
| COST_ESTIMATE | ผลคำนวณ revision ที่อ้างอิงข้อเสนอและ STD; draft แสดงข้อค้าง | demand ยืนยัน หรือ stock movement |
| PURCHASE_ORDER | PO line/revision จากระบบจัดซื้อเดิม; ยืนยันสถานะ ยอดค้าง และกำหนดรับ | on-hand หรือต้นทุนจริงครบถ้วน |
| GOODS_RECEIPT | คลังรับจริงระดับ line/lot; posted และอ้าง PO/item/หน่วย แยก received/accepted/rejected/quarantine | ของพร้อมใช้ทั้งหมด หรือการอนุมัติราคาสุดท้าย |
| STOCK_MOVEMENT | คลัง: IN/OUT/คืน/โอน/ปรับ/กลับรายการ พร้อม event ID | ทุก IN เป็นการซื้อ หรือทุก OUT เป็นใช้ผลิต |
| SERVICE_ACCEPTANCE | เจ้าของงานยืนยันผลงานบริการ/เวลา/งวด | จำนวน stock |
| ACTUAL_RESOURCE_USAGE | Production/คลัง: เบิกใช้สุทธิ ชั่วโมงจริง driver จริง ผูก batch/operation; วัสดุอ้าง movement เดิม | ค่าใช้จริงจากยอดซื้อหรือยอดรับ |
| INVOICE_ADJUSTMENT | Finance: invoice/credit/debit/ค่าใช้จ่ายเพิ่ม หลังตรวจหน่วย สกุลเงิน ภาษี และการจัดสรร | ปริมาณรับเข้า หรือราคาที่เทียบได้ทันที |
| FORECAST_DEMAND | ความต้องการคาดการณ์ตาม item/spec/จำนวน/หน่วย/ช่วงเวลา/scenario/version; owner รอยืนยัน | คำสั่งซื้อหรือ demand ยืนยัน |
| CONFIRMED_DEMAND | ระบบคำสั่งงาน/คำสั่งซื้อเดิม: สถานะยืนยัน ยอดค้างและวันใช้; owner รอยืนยัน | forecast อีกก้อนที่นำมาบวกซ้ำ |

ชนิดหลักฐานไม่ใช่ lifecycle เดียว: ห้ามเปลี่ยนข้อเสนอเดิมเป็น PO ให้เชื่อม reference ไป PO ที่เกิดจริง แยก sourceStatus, validationStatus และ confirmationRef ไม่ใช้ APPROVED/ส่งอีเมลแล้วแทนทุก gate

### 2. Field dictionary ของการเชื่อม (ไม่ใช่ให้กรอกซ้ำทุกชีต)

| กลุ่ม logical fields | ข้อกำหนด |
|---|---|
| sourceSystem / sourceRecordId / sourceLineId / sourceVersion | คีย์ระดับรายการพร้อม namespace; ชื่อและเลขแถวไม่ใช่ identity |
| sourceEventId / eventType / reversalOf | แยกเหตุการณ์จริงจาก correction; นำเข้าซ้ำไม่เพิ่มยอด; reversal ไม่ลบหลักฐาน |
| occurredAt / postedAt / observedAt / sourceStatus | แยกวันเกิด วันลงรายการ และวันอ่าน ไม่ใช้วัน import แทนวันรับ |
| materialId / inventoryItemRef / specRevision / mappingRef | map ไป master เดิมพร้อมผู้รับรอง/version/วันที่มีผล; คง RMS-/RD-Code/PK IDs เดิม ห้าม join ชื่อคล้ายแล้วผ่านเอง |
| quantity / uom / baseQuantity / baseUom / conversionRef | เก็บหน่วยต้นทาง; box→piece ต้อง pack/spec version ที่ยืนยัน; ห้ามแปลงมวลเป็นจำนวนโดยเดา |
| unitPrice / priceBasisQuantity / priceUom / currency / taxBasis / includedCharges | แยกฐานราคาและหน่วยซื้อ; แสดงราคาตามสิทธิ์เดิม ไม่รวมคนละสกุล/ฐานภาษีโดยเดา |
| projectRef / costJobRef / scenarioRevision / formulaRevision / batchRef | อ้าง master เดิมตาม applicability; PO กลางไม่จำเป็นต้องผูก project เดียว |
| offerRef / pkSnapshotRef / poLineRef / receiptLineRef / movementRef / invoiceLineRef | หลายต่อหลายผ่าน allocation; PO หนึ่ง line รับหลายครั้ง/หลาย lot และ invoice รวมหลาย line ได้ |
| allocationRef / allocatedQuantity / allocationUom | บันทึกปริมาณที่จับคู่แต่ละคู่; รวมไม่เกินต้นทางที่ใช้ได้ ไม่จัด supply ซ้ำหลายงาน |
| lotRef / warehouseRef / locationRef / qualityStatus / expiryDate | stock เท่านั้น; รับแล้วไม่เท่ากับพร้อมใช้; shelf-life ตามงานรอ policy |
| confirmationRef / mappingApprovedBy / mappingApprovedAt / evidenceRef | เก็บหลักฐานและผู้รับรองจาก authority จริง ไม่พิมพ์ชื่อแทนสิทธิ์ |

ฟิลด์ไม่ทราบ = pending ไม่ใช่ 0; ไม่เกี่ยวข้องต้องมีเหตุผล ระบบอ่านจากเจ้าของข้อมูลก่อนและถามเฉพาะสิ่งขาด ไม่มีการเปลี่ยน locked schema โดยเอกสารนี้

### 3. กติกาทวนสอบ IN inventory

1. ตรวจ ID/version/event, posted status, item/spec mapping และหน่วยก่อน; ขาดใช้ PENDING_EVIDENCE / MAPPING_REQUIRED ไม่ใช่ MATCHED
2. เทียบ PO line กับรับสะสมสุทธิจาก receipt/return/reversal ตาม semantics ของต้นทางและยอดค้าง PO ล่าสุด แยก PARTIAL / OVER_RECEIPT / CANCELLED_PO_RECEIPT / SPEC_MISMATCH / UNIT_MISMATCH
3. เทียบ receipt กับ movement IN ที่อ้าง line เดียวกันระดับ item/lot/หน่วย; โอนเข้า ปรับยอด คืนจากผลิต และยอดตั้งต้นเป็นคนละประเภท ไม่จับทั้งหมดเป็นการรับจาก PO
4. รายงานผลจำนวน identity/spec คุณภาพ ราคา และสถานะเอกสารแยกกัน: จำนวนตรงแต่ราคาต่างไม่ใช่ผ่านทั้งหมด ไม่มี invoice ให้ส่วนราคาค้างโดยเก็บหลักฐานรับจริงไว้
5. เทียบ offer→PO→invoice เฉพาะฐานเดียวกัน แยก freight/adjustment ไม่ทับ estimate เดิม; quantity/price tolerance และผู้อนุมัติผลต่างยังรอยืนยัน ห้าม auto-pass ด้วยค่าที่เดา
6. ตรวจ duplicate/orphan, รับบางส่วนหลายครั้ง/หลาย lot, เอกสารลงย้อนหลัง, คืน/กลับรายการ; เก็บ cutoff/as-of และ version ชุดหลักฐานเพื่อทำซ้ำได้ ผล reconcile ไม่เขียนแก้ stock/PO

### 4. MRP และ Forecast

- Forecast กับ confirmed demand แยก version/ช่วงเวลา/ที่มา การเปลี่ยนเป็น confirmed ใช้ consumption/allocation reference และนโยบายที่ยืนยันเพื่อไม่บวกซ้ำ; โคลนใบงานต้นทุนไม่เพิ่ม demand
- MRP ใช้ formula/BOM/spec/routing revision ที่ผู้รับผิดชอบยืนยันสำหรับ planning พร้อมหน่วย ขนาดบรรจุ batch และ loss ตามขั้นเดิม ห้ามบวก loss ซ้ำกับ PK snapshot
- Eligible on-hand ต้องผ่าน quality/expiry/ข้อจำกัดและการจอง; open PO ใช้เฉพาะยอดค้างที่ยังไม่ยกเลิกและมีวันรับ การรับบางส่วนต้องไม่ถูกนับทั้ง scheduled receipt และ on-hand
- Net ตาม time bucket และวันต้องใช้ จาก demand ที่ตัดการซ้ำแล้วเทียบ supply ที่ทันเวลา; หาก available balance หัก reservation แล้ว ห้ามหักซ้ำ ต้องตรวจ semantics ต้นทางก่อน
- ผล MRP เป็นข้อเสนอจัดหาพร้อม as-of/need date/ข้อค้าง ใช้ MOQ/order increment/LT ที่ยืนยัน; ไม่สร้าง PO ไม่เลือก vendor/Tier/spec ใหม่ให้เอง และไม่ถือข้อเสนอราคาเป็น scheduled receipt
- Operation ใช้ capacity/labor planning แยกจาก material MRP; service/tooling วางแผนตาม receiptMode ไม่ net กับ stock RM/PK
- ยังรอ owner ของ forecast, horizon/bucket, consumption policy, safety stock, yield/loss, shelf-life, calendars และ receiving/inspection LT; ไม่ใส่ค่าจำลองเป็น policy หากขาดแสดง gross demand/ข้อค้าง ไม่อ้างว่าแผนซื้อพร้อมใช้

### 5. Source ownership และระบบที่ไม่เพิ่มชีตซ้ำ

RM/PU-PK คง authority ข้อเสนอเดิม; PO/receipt/movement/invoice อ่านจากระบบเจ้าของที่ยังรอระบุ ไม่สร้างทะเบียน PO สำเนาใน RM/PK รอบนี้เพิ่มชีต **0** การแยกประเภทเป็นข้อมูลและ reference ไม่ใช่ประเภทละชีต

หน้าระบบในอนาคตใช้มุมมองจากข้อมูลชุดเดียว: ประมาณการ / จัดซื้อ / รับเข้าและผลต่าง / วางแผน อ่าน snapshot แล้ว delta ตาม source ID/version เมื่อรองรับ; หากไม่มี delta ใช้ bounded snapshot ตรวจครบก่อนสลับ cache ไม่อ่านทุกแท็บทุกครั้งที่ค้น รักษา cache เก่าพร้อมแจ้งอายุเมื่อ refresh ล้มเหลว และไม่ทับ revision ที่เลือกแล้ว ความเร็วต้องวัดจริง ไม่ถือการซ่อนแท็บว่าเพิ่มความเร็ว sync

สิทธิ์เดิมไม่ขยายตาม reference: Sales/OPC ไม่ได้ supplier/ราคาต้นทางผ่าน PO หรือ drill-through และงานนี้ไม่เปิดต้นทุนข้ามฝ่ายเพิ่ม ก่อนใช้งานต้องมี sanitized mapping, owner รับรอง semantics, synthetic tests + mutation ของกฎใหม่, CODEOWNER review และ operator deploy

### 6. แหล่ง PO และราคา IN — ข้อยืนยันและผลตรวจล่าสุด 2026-09-08

เจ้าของระบุ PO เป็นไฟล์สแกนใน Google Drive; เว้น `poDriveFolderUrl` และ `poDocumentUrl` ไว้เป็น null (รอ link ภายหลัง) ไม่สร้าง URL/เลข PO สมมติ ไม่ขวาง draft ต้นทุน แต่การตรวจ PO ที่ไม่มีหลักฐานต้องขึ้น PENDING_EVIDENCE ส่วนแหล่งราคาเปรียบเทียบคือชีต **IN** ใน workbook inventory ที่เจ้าของระบุ (URL เก็บใน local-only/SOURCE_INVENTORY_REFERENCE.md)

ตรวจ metadata และหัวตารางแถว 1 เท่านั้นของ IN, IN Price Snapshot, Master Item, Movement, Stock onhand, Reserve ไม่อ่านแถวธุรกิจ/ราคาจริง ไม่ตรวจสูตรหรือเขียน workbook ดังนั้น mapping ต่อไปนี้เป็น candidate ไม่ใช่ binding ที่ยืนยันแล้ว:

| ความหมาย | หัวคอลัมน์ที่พบจริง | การนำไปใช้ / ข้อค้าง |
|---|---|---|
| เอกสารรับเข้า | IN: Doc No, Date, Ref, Type, Legacy Type | Doc No อาจซ้ำหลายบรรทัด; Ref ยังไม่ยืนยันว่าเป็น PO; ต้องมี stable line/event identity ก่อน import ซ้ำอย่างปลอดภัย |
| ตัวตนวัสดุ | IN: New Code, Old Code, Category, Trade name | New Code เป็น candidate ไป Master Item ไม่เท่ากับ RMS-/RD-Code/PK ID อัตโนมัติ; ต้องยืนยัน mapping/spec |
| รับจริง | IN: Lot, MFG, Exp. date, Qty, UOM, Loc | ขอบเขต Type/การกลับรายการ/สถานะ posted และคุณภาพยังไม่ยืนยัน ไม่ถือทุก IN ว่าเป็นซื้อใหม่ |
| ราคาเปรียบเทียบ | IN: Price, Unit Cost | เจ้าของยืนยัน: Price = ราคารวมของรายการที่รับเข้ารอบนั้น; Unit Cost = ราคาต่อหน่วยของรายการที่รับเข้ารอบนั้น; ทั้งคู่ไม่รวม VAT/ขนส่ง สกุลเงิน THB แสดงทศนิยม 2 ตำแหน่งพร้อม comma หลักพัน; ฐานหน่วยยังต้องตรวจ |
| Item master | Master Item: New Code, Old Code, UOM, Vendor name, Cost per unit, Lead Time, MOQ, Pack side | ใช้ master เดิม; Cost per unit ไม่แทนราคา IN ราย lot/เอกสาร และไม่แทนข้อเสนอปัจจุบัน |
| ประวัติสำรองราคา | IN Price Snapshot: Run ID, Captured At, Source Row, Doc No, Ref, Canonical Item Code, Lot, Price, Unit Cost, Restore Status | ไม่รวมเป็นรับเข้าอีกชุด; header ดูเป็น snapshot/restore แต่ semantics ยังไม่ตรวจ ห้ามเลือกเป็นแหล่งหลักแทน IN |
| ปริมาณสำหรับ planning | Stock onhand: UOM, คงเหลือ, Location, status; Reserve: Qty, UOM, Ref, QO No | ยังไม่ยืนยันว่าคงเหลือหักจองแล้วหรือไม่; ไม่ net reservation ซ้ำ |
| Movement | Qty (g) IN, Qty (g) OUT, New Code, Lot (IN) | มีหัวหน่วย g; ห้ามแปลง PK จำนวนชิ้นเป็น g หรือใช้เป็น event ledger โดยยังไม่ตรวจ |

PO scan pipeline ที่เตรียมรองรับ: Drive file ID/version → extraction candidate ระดับหน้า/รายการพร้อมตำแหน่งหลักฐาน → ผู้รับผิดชอบตรวจยืนยันเลข PO/รายการ/item/spec/จำนวน/หน่วย/ราคา/สถานะ → จึงใช้เทียบ IN ได้ ข้อความ OCR ไม่ใช่ข้อมูลยืนยัน; อ่านไม่ชัดต้องค้าง ไม่เดา และไม่ส่งเอกสารไป OCR ภายนอกจนมีช่องทางที่ได้รับอนุมัติ ไฟล์ PO scan อย่างเดียวไม่ยืนยันยอดค้าง/ยกเลิก/กำหนดรับล่าสุดสำหรับ MRP ต้องมีแหล่งสถานะหรือผู้รับผิดชอบยืนยันเพิ่ม

แผนเทียบสามทาง: selected offer revision → verified PO line → IN line (ฐานราคาที่รับรองแล้ว) พร้อมผลต่างแต่ละคู่ ยังไม่ถือ IN เป็น invoice/landed cost/actual production cost และไม่อัปเดตราคาแคตตาล็อกหรือ revision เดิมตาม IN โดยอัตโนมัติ รายการที่ไม่มี PO link แสดงส่วนที่ตรวจได้พร้อม PO evidence pending ไม่แสดงว่าผ่านครบ

#### ฐานราคา IN — เจ้าของยืนยัน 2026-09-08

- Map `Price` → receiptLineAmount และ `Unit Cost` → receiptUnitCost เป็นชื่อเชิงความหมายใน adapter design ไม่เปลี่ยนชื่อคอลัมน์ต้นทางหรือ schema ที่ล็อก ทั้งคู่เป็นราคาของรอบรับนั้น ไม่ใช่ราคาล่าสุดของวัสดุทุก lot
- ตรวจ `Price` เทียบ `Qty × Unit Cost` เฉพาะเมื่อ Qty/UOM และฐานหน่วยของ Unit Cost ตรงกัน พร้อมรายงานผลต่าง `Price − Qty × Unit Cost` ไม่เขียนแก้ค่าใดให้เอง รูปแบบราคาเป็นทศนิยม 2 ตำแหน่งตามข้อยืนยันด้านล่าง แต่การอนุมัติผลต่าง (tolerance) เป็นคนละเรื่อง จึงไม่ auto-pass ผลต่างเล็กน้อย

#### สกุลเงินและรูปแบบราคา — ข้อยืนยันเพิ่มเติม 2026-09-08

- เจ้าของยืนยันสกุลเงิน THB และราคาแสดงทศนิยม 2 ตำแหน่งเสมอ พร้อม comma คั่นทุกหลักพัน เช่น `0.00`, `12.50`, `1,234.56`, `1,234,567.00` ใช้กับ Price, Unit Cost และยอดเงินเปรียบเทียบในขอบเขตนี้ ไม่ใช่ให้ปัด Qty/อัตราส่วน/ตัวแปลงหน่วยเหลือ 2 ตำแหน่ง
- แนวทาง implementation: ปัดใกล้สุดที่ 2 ตำแหน่ง; กึ่งกลางปัดออกจากศูนย์ (decimal half-up) เช่น `1,234.565 → 1,234.57`, `-1,234.565 → -1,234.57` เป็นวิธีปัดที่เลือกใช้ให้กฎ deterministic ไม่ใช่คำยืนยันเพิ่มเติมจากเจ้าของเรื่อง tie-breaking
- เก็บค่าต้นทางและความละเอียดสำหรับคำนวณไว้ ไม่เขียนค่าที่จัดรูปแบบย้อนลงต้นทางหรือแปลงตัวเลขเป็น string ที่มี comma ใน storage; ปัดเมื่อแสดงผล/สรุปยอดตามฐานเอกสาร ไม่ปัด Unit Cost ก่อนคูณ Qty ตัวอย่างสังเคราะห์ `100 × 1.2345 = 123.45` แม้ Unit Cost แสดง `1.23`
- ถ้าผลต่างที่ละเอียดกว่าระดับสตางค์แสดงเป็น `0.00` แต่ค่าจริงไม่เป็นศูนย์ ต้องมีธงผลต่างต่ำกว่าความละเอียดแสดงผลและไม่ถือว่า MATCHED เพราะหน้าจอดูเท่ากัน เก็บค่าจริงไว้ให้ตรวจ ไม่ใช่การอนุมัติ tolerance
- ข้อมูลใน IN ใช้ THB ตามคำยืนยัน; หาก PO/ข้อเสนอระบุสกุลเงินอื่นอย่างชัดเจน ห้ามติดป้าย THB ทับหรือใช้อัตราแลกเปลี่ยนสมมติ ให้ค้างการเทียบฐานราคา
- นี่เป็น contract สำหรับ adapter/UI ที่ยังไม่ติดตั้ง ไม่ได้เปลี่ยน number format ในชีตจริงหรือ formatter ของ application รอบนี้ ข้อค้างเรื่องสกุลเงินและจำนวนทศนิยมถือว่าปิดแล้ว เหลือฐานหน่วยและ mapping ตามรายการ
- Qty ว่าง/ศูนย์ ห้ามหารเพื่ออนุมาน Unit Cost; ค่าที่ขาดเป็น pending ไม่ใช่ 0 รายการติดลบต้องตรวจ return/reversal semantics ก่อน ไม่ถือเป็นการรับซื้อปกติ
- เทียบข้อเสนอและ PO ด้วยราคาต่อหน่วยที่ปรับฐานหน่วยและสกุลเงินตรงกัน **ไม่รวม VAT/ขนส่ง** ถ้าต้นทางรวมค่าเหล่านี้และแยกไม่ได้ ให้ค้างการเทียบแทนการลบด้วยอัตราสมมติ ไม่รวม Price ต่างรอบมาหารหรือเฉลี่ย Unit Cost ตรง ๆ
- หากต้องสรุปหลายรอบ ใช้ผลรวมยอด/ผลรวมปริมาณที่แปลงเป็นหน่วยเดียวกัน เฉพาะ item/spec/สกุลเงิน/ฐานราคาเดียวกันและเหตุการณ์ที่ผ่านการตรวจ ไม่ใช้ค่าเฉลี่ยนี้แทนราคาของ receipt แต่ละรอบหรือ inventory valuation policy ที่ยังไม่กำหนด
- VAT/ขนส่งที่ไม่อยู่ในสองช่องนี้ไม่ได้แปลว่าไม่มีค่าใช้จ่าย: freight/landed cost ยังต้องอ้างหลักฐานแยกและป้องกันบวกซ้ำ ตัวอย่างสังเคราะห์สำหรับทวนสอบ: Qty 10 piece, Unit Cost 20, Price 200 → ผลต่าง 0; Price 201 → ผลต่าง +1 รอตรวจตาม policy ไม่แก้เป็น 200 (ยังไม่ใช่ผลเทสต์ runtime)

### 7. ตัวอย่างทวนสอบสังเคราะห์สำหรับ implementation (ยังไม่ใช่ผลเทสต์)

| กรณี | ผลที่ต้องได้ |
|---|---|
| PO 100 piece รับ 40 และ 60 คนละ event | รับสะสม 100, ยอดค้าง 0; import event 40 ซ้ำยอดไม่เพิ่ม |
| กลับ receipt 60 โดย reversal reference | ยอดรับสุทธิ 40; ยอดค้างตรวจตามสถานะ PO ต้นทาง ไม่เดาว่า reopen |
| PO 10 box รับ 100 piece ยังไม่มี conversion | UNIT_MISMATCH/PENDING_EVIDENCE ไม่ MATCHED |
| item ชื่อเดียวกัน spec ต่าง | SPEC_MISMATCH ไม่รวม stock หรือทดแทน BOM |
| รับ 100 แต่ quarantine 20 | ไม่ถือ 100 ว่า eligible; ส่วน 80 ยังต้องตรวจ reservation/expiry |
| โอนเข้า 50 โดยไม่มี PO | จัดเป็น transfer ไม่เป็น orphan purchase receipt |
| ข้อเสนอ 10 บาท/ชิ้น PO 12 บาท/ชิ้น ฐานเดียวกัน | ผลต่าง +2 แยกจากจำนวน; estimate revision เดิมคง 10 |
| บริการ 8 ชั่วโมง | SERVICE_ACCEPTANCE ไม่เพิ่ม stock 8 |
| forecast 100 และ confirmed 40 ที่ consume forecast เดียวกันตาม policy | demand 100 ไม่ใช่ 140; policy ไม่ยืนยันให้ค้าง |
| STD รวม setup แล้วและมี setup อีกบรรทัด | ต้องตรวจ inclusion/การจัดสรร ไม่บวกซ้ำ |


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

---

# ทะเบียนวัสดุ · การค้นหา · ปริมาณใส่ — 2026-09-06

เป้าหมายจากเจ้าของระบบ: **ค้นชื่อสาร → เห็นราคา → ใส่ปริมาณ ให้ง่ายและแม่น** ภายใน 30 วินาทีต่อรายการ
ทุกข้อในส่วนนี้มาจากของจริงที่สำรวจ (ชีตราคา 166 ชื่อ · ตารางสารในใบงาน Formula · พจนานุกรม อย. 145 รายการในระบบ) และคำตอบของเจ้าของระบบ

## 1. แผนที่เอนทิตี

```
ใบงาน Formula (fs_records · A00001)
  └─ rows[] : {name, w(mg ที่ชั่ง), o(แหล่งกำเนิด), p(% เข้มข้น), actual(mg สารจริง)}   ← RD/Sales เป็นเจ้าของ · ต้นทุน "อ่านชื่อ" อย่างเดียว
        │  ดึงเฉพาะ name มาเป็นแถว RM (ปริมาณให้ RD กรอกเอง — คำตัดสิน 2026-09-06)
        ▼
ใบงานต้นทุน (fs_cost · CJ-000001)
  └─ scenario.rmLines[] : {id, materialId, alias, amount, unit, lossPercent, offer(snapshot)}
        │  materialId ──► วัสดุ (Material) ◄── 1 : n ── ข้อเสนอ (Offer = Tier ของผู้ขาย)
        │                       ▲                                   ▲
        │                       │ ชื่อเรียก (Alias) ← จัดซื้อในชีต     │ ราคา · MOQ · เพดาน · LT · spec
        │                       │                                   │
        └─ ความจำการเลือก (Pick) : {ชื่อสารในสูตร → offerId ที่ RD เลือก, ครั้ง, ล่าสุด}  ← เครื่องนี้
```

| เอนทิตี | คีย์ถาวร | เจ้าของ | อยู่ที่ |
|---|---|---|---|
| วัสดุ (Material) | `materialId` = `RMS-` + hash(ผู้ขาย + ชื่อที่ normalize) | จัดซื้อ (ผ่านชีตราคา) | ประกอบตอนนำเข้า ไม่มีตารางแยก |
| ข้อเสนอ (Offer) | `offerId` = `materialId-<MOQ เป็น µg>UG` | จัดซื้อ | `fs_cost.catalog[]` |
| ชื่อเรียก (Alias) | ไม่มีคีย์เอง ผูกกับ `materialId` | **จัดซื้อ** — คอลัมน์ใหม่ "ชื่อเรียก" ในชีตราคา (คำตัดสิน 2026-09-06) | อ่านจากชีต → เก็บใน `offer.aliases[]` |
| ความจำการเลือก (Pick) | (`normalizedFormulaName`, `offerId`) | RD เครื่องนั้น — ข้อมูลเสริม ไม่ใช่ความจริงทางธุรกิจ | `fs_cost.picks[]` (key ใหม่ในก้อนเดิม additive) |
| แถว RM ในสูตร | `line.id` ภายใน scenario | RD | `scenario.rmLines[]` (มีอยู่แล้ว ไม่เปลี่ยน) |

## 2. กติกาการตั้งรหัส — เพิ่มจากส่วนบน

- `materialId` และ `offerId` ตามที่ใช้แล้วใน `RmPriceSource.gs` (commit 9c370ef) — **ไม่ผูกราคา ไม่ผูกลำดับแถว** จึงคงที่เมื่อผู้ขายขยับราคาหรือจัดซื้อแทรกแถว
- ชื่อเรียกและความจำการเลือก **ห้ามใช้เป็นตัวตน** — เป็นดัชนีค้นหาเท่านั้น ถ้าชื่อเรียกชนกันสองวัสดุ ให้แสดงทั้งคู่ ไม่เลือกให้
- `normalizedFormulaName` = `norm()` ตัวเดียวกับที่ใช้สร้าง `materialId` (ตัด ®™ วงเล็บ เครื่องหมาย ยุบช่องว่าง **คง %**) เพื่อให้ "Collagen  Type II" กับ "collagen type ii" เป็นคีย์เดียวกัน

## 3. ตารางข้อมูลรายตัว

### ข้อเสนอ (Offer) — เฉพาะฟิลด์ที่เกี่ยวกับการค้นหา (ฟิลด์ราคาดู `COST_LADDER_MAPPING.md`)

| ฟิลด์ | ชนิด | บังคับ | ค่าเริ่มต้น | เจ้าของ | ตัวอย่าง (สังเคราะห์) |
|---|---|---|---|---|---|
| `name` | string | ✅ | — | จัดซื้อ | `BRANDX™ (Undenatured Collagen Type II)/USA` |
| `aliases` | string[] | ❌ | `[]` | จัดซื้อ (คอลัมน์ "ชื่อเรียก" คั่นด้วย `;` หรือ `,`) | `["คอลลาเจน type 2","UC-II"]` |
| `searchTokens` | string[] | คำนวณ | — | ระบบ (ไม่เก็บ ประกอบตอนโหลด) | `["brandx","undenatured","collagen","type","ii","usa","คอลลาเจน","uc-ii"]` |
| `vendor` | string | ✅ | — | จัดซื้อ | `ผู้ขายตัวอย่าง 1` |
| `condition` | string | ❌ | `""` | จัดซื้อ (Remark) | ย่อ 90 ตัวอักษรบนหน้าจอ เต็มใน title |
| `pricePerKg` | number | คำนวณ | — | ระบบ | `price / mass(priceBasisQuantity, priceUnit)` ไม่เก็บซ้ำ |

`searchTokens` ประกอบจาก: `name` แตกคำ (รวมข้อความในวงเล็บ ตัด ®™ และ `/ประเทศ` ออกเป็น token แยก) + `aliases` + `vendor` + **keywords จากพจนานุกรม อย.** ที่ `name` จับคู่ได้ (มีอยู่แล้ว 145 รายการ อังกฤษ+ไทย เช่น `["ascorbic acid","vitamin c","วิตามินซี"]`) — ทำให้พิมพ์ไทยหาชื่อการค้าอังกฤษเจอโดยจัดซื้อไม่ต้องกรอกเพิ่ม

### ความจำการเลือก (Pick) — `fs_cost.picks[]` ใหม่ additive

| ฟิลด์ | ชนิด | บังคับ | เจ้าของ | หมายเหตุ |
|---|---|---|---|---|
| `key` | string | ✅ | ระบบ | `normalizedFormulaName` |
| `offerId` | string | ✅ | RD | ข้อเสนอที่กดเลือก |
| `materialId` | string | ✅ | ระบบ | เผื่อ offerId หายเมื่อ Tier ถูกยกเลิก ยังจำวัสดุได้ |
| `count` | number | ✅ | ระบบ | นับครั้งที่เลือก |
| `lastAt` | ISO string | ✅ | ระบบ | ล่าสุด |
| `by` | string | ✅ | ระบบ | ผู้เลือก (บันทึกไว้ตรวจย้อน ไม่ใช่ตัวตน) |

เขียนเมื่อ `selectRM` สำเร็จเท่านั้น (idempotency key เดิมของ action) · ห้ามเขียนก่อน `loadCostStore()` · ลบไม่ได้ ใช้ `count` เป็นน้ำหนัก · **ไม่ sync ขึ้นเซิร์ฟเวอร์** เป็นสถานะของเครื่อง

### แถว RM (`rmLines[]`) — มีอยู่แล้ว ระบุเฉพาะกติกาปริมาณ

| ฟิลด์ | ความหมายที่ยืนยัน | ที่มา |
|---|---|---|
| `alias` | ชื่อที่แสดง — ดึงจาก `rows[].name` ของใบงาน Formula ตอนสร้างแถว | Formula (อ่าน) แล้ว RD แก้ได้ |
| `amount` + `unit` | **ปริมาณที่ใส่ต่อหน่วยผลิต** (ต่อแคปซูล/ซอง/เม็ด) — RD กรอกเอง ไม่ดึง `w` มา (คำตัดสิน 2026-09-06) | RD |
| `unit` ค่าเริ่มต้น | `mg` เมื่อรูปแบบเป็นแคปซูล/เม็ด · `g` เมื่อซอง/ผง — เดาแค่หน่วย ไม่เดาตัวเลข | ระบบ ตาม `form` ของใบงาน Formula |
| `lossPercent` | ค่าเริ่มต้น `0` แสดงชัด ไม่ซ่อน | RD |

หน่วยที่ผู้ใช้พูดกับที่ระบบเก็บ **ตรงกัน** (mg/g/kg ต่อหน่วยผลิต) ไม่มี "กระปุก" ในชั้นนี้ — ขนาดบรรจุอยู่ที่ `sellingUnits × unitsPerPack` แยกต่างหาก

## 4. Master data

| รายการหลัก | ผู้ดูแล | เพิ่มรายการใหม่ | ข้อมูลเก่าที่ไม่ตรง |
|---|---|---|---|
| วัสดุ + ข้อเสนอ | จัดซื้อ | กรอกแถวในชีตราคาแบบเดิม → RD/จัดซื้อนำเข้าไฟล์ | แถวที่อ่านไม่ได้ขึ้นรายงาน 23 แถวพร้อมเหตุผล ไม่เดาแทน |
| ชื่อเรียก | จัดซื้อ | กรอกคอลัมน์ "ชื่อเรียก" ในแถวเดิม (ว่างได้) | ไม่มีคอลัมน์ = ไม่มีชื่อเรียก ระบบยังค้นจากชื่อและพจนานุกรม อย. ได้ |
| พจนานุกรม อย. | Formula Studio (มีอยู่แล้ว) | ตาม Formula Studio | อ่านอย่างเดียว ห้ามแก้จากฝั่งต้นทุน |
| ความจำการเลือก | เครื่องของ RD | อัตโนมัติเมื่อเลือก | ถ้า offerId ไม่มีในแคตตาล็อกแล้ว ใช้ `materialId` หาข้อเสนอที่ยังใช้ได้ของวัสดุเดิม |

## 5. State machine — แถว RM หนึ่งแถว

| จาก | ไป | ใครสั่ง | หลักฐาน |
|---|---|---|---|
| (ไม่มี) | `ดึงจาก Formula` — มีชื่อ ไม่มีปริมาณ ไม่มีข้อเสนอ | ระบบ ตอนเปิดใบงานที่ผูกครั้งแรก | `alias` = `rows[].name` |
| `ดึงจาก Formula` | `เลือกข้อเสนอแล้ว` | RD กดเลือก 1 ใน 3–5 ตัวเลือก | บันทึก Pick |
| `เลือกข้อเสนอแล้ว` | `พร้อมคำนวณ` | RD กรอก `amount` | `formulaPreview` ปรับทันที |
| ใด ๆ | `ต้องขอจัดหา` | RD กด "ไม่พบ" | สร้าง request เดิม ไม่ใส่ราคาสมมติ |
| `พร้อมคำนวณ` | `รอ` (ราคาหมดอายุ/เกินเพดาน/รอยืนยัน) | ระบบ ทุกครั้งที่คำนวณ | ข้อความค้างระบุเจ้าของ |

**ระบบไม่เปลี่ยนสถานะไป `เลือกข้อเสนอแล้ว` เอง** แม้เจอตัวเดียว (คำตัดสิน 2026-09-06) — ตัวที่เคยเลือกบ่อยขึ้นบนสุดและถูกไฮไลต์ แต่ RD ต้องกด

## 6. เส้นทางข้อมูล — การค้นหา

```
พิมพ์ในช่องค้นหา (ทุกตัวอักษร ≤ 4 ms หลัง commit 7549cc8)
  → query แตกคำด้วย norm() → ทุกคำต้องเจอใน searchTokens (AND, ไม่สนลำดับ, prefix match ได้)
  → จัดกลุ่มตาม materialId (มีอยู่แล้ว costCatalogGroups)
  → เรียง: Pick.count ของชื่อสารแถวนี้ (มาก→น้อย) → pricePerKg (น้อย→มาก) → ชื่อ
  → แสดง 3–5 กลุ่มแรก + "แสดงทั้งหมด N"
  → RD กด → selectRM (idempotent) → เขียน Pick → วาดใหม่เฉพาะแถว
```

ไม่มีปลายทางภายนอก ไม่มี retry — ทั้งหมดอยู่ในเครื่อง · ค้นหาว่าง = แสดงตามความจำการเลือกของแถวนั้น (ถ้ามี) ก่อน

## 7. การตรวจสอบย้อนหลัง

- Pick เก็บ `by` และ `lastAt` — ตอบได้ว่า "ทำไมตัวนี้ขึ้นก่อน" · ไม่ลบ
- `rmLines[].offer` เป็น snapshot ณ ตอนเลือก (มีอยู่แล้ว) — ราคาที่ใช้คิดคือราคา ณ ตอนนั้น ไม่ใช่ราคาปัจจุบัน
- ชื่อเรียกจากชีตติดมากับ `catalogSource` (ไฟล์ ผู้นำเข้า เวลา) — ตอบได้ว่าชื่อเรียกชุดนี้มาจากรอบไหน

## 8. สายที่ปล่อยรอไว้ (จงใจไม่ทำตอนนี้)

| จุดขยาย | เผื่อไว้อย่างไร | เหตุผลที่ยังไม่ทำ |
|---|---|---|
| ชื่อเรียกที่ RD เพิ่มเองในแอป | `aliases[]` รับได้จากหลายที่มา · ถ้าทำเพิ่ม `source:'rd'` ต่อท้าย | เจ้าของเลือกให้จัดซื้อดูแลก่อน |
| ดึงปริมาณ `w` จาก Formula | โครง `rmLines` รับ `amount` ได้แล้ว แค่เปิดสวิตช์ | เจ้าของสั่งให้ RD กรอกเอง — ปริมาณใน Formula อาจไม่ใช่ที่ซื้อจริง |
| ความจำการเลือกร่วมทุกเครื่อง | `picks[]` มี `by`/`lastAt` พร้อม merge | ADR 0002 ยังไม่ sync `fs_cost` |
| ค้นหาด้วย RD-Code | `rdCode` มีใน offer แล้ว (จับคู่ได้ ≥7/143) | รายการ RD-Code กับชีตราคาเป็นคนละชุด ต้องรอจัดซื้อเติม |
| จับคู่ตาม % ความเข้มข้น (`p` ใน Formula กับ `%` ในชื่อ) | `norm()` คง % ไว้แล้ว | ต้องยืนยันกับ RD ก่อนว่า % ในสองที่หมายถึงสิ่งเดียวกัน |

## 9. ของที่ยังขาด — ห้ามสมมติ

| สิ่งที่ขาด | ใครให้ |
|---|---|
| คอลัมน์ "ชื่อเรียก" ในชีตราคา (ยังไม่มี) · รูปแบบคั่นด้วย `;` | จัดซื้อ — ระบบอ่านเป็น optional ว่างได้ |
| ยืนยันว่า % ในชื่อชีตราคา กับ `p` (% เข้มข้น) ในใบงาน Formula คือความหมายเดียวกัน | RD |
| ตัวอย่างชื่อสารที่ RD พิมพ์จริงในใบงาน Formula 20 ชื่อ (เพื่อทดสอบว่าค้นเจอ) — ห้ามใช้ข้อมูลลูกค้าจริงในเทสต์ | RD ให้แบบปกปิดลูกค้า |
| หน่วยเริ่มต้นต่อรูปแบบสินค้าสำหรับ 12 รูปแบบ (ตอนนี้รู้แค่แคปซูล/เม็ด=mg ซอง=g) | RD |

## ไอเดียปรับที่ตกผลึกจากทะเบียนนี้ — เรียงตามผลต่อเป้า 30 วินาที

1. **เปิดใบงานที่ผูกแล้วมีแถว RM รอครบทุกชื่อ** (จาก `rows[].name`) — RD ไม่ต้องพิมพ์ชื่อสักตัว เหลือกดเลือกและกรอกปริมาณ
2. **ค้นแบบทุกคำต้องเจอ ไม่สนลำดับ** — "type ii collagen" เจอ "…(Undenatured Collagen Type II)" · ตอนนี้ต้องพิมพ์ติดกันเป๊ะถึงเจอ
3. **พจนานุกรม อย. เป็นชื่อเรียกฟรี** — พิมพ์ "วิตามินซี" เจอ "Ascorbic Acid 99%" ทันที โดยจัดซื้อยังไม่ต้องกรอกอะไร
4. **ตัวที่เคยเลือกขึ้นก่อน ไฮไลต์ แต่ไม่กดให้** — ครั้งที่สองของชื่อเดิม = กดครั้งเดียว
5. **ช่องปริมาณอยู่บนแถวเดียวกับข้อเสนอที่เลือก** พร้อมราคาต่อหน่วยผลิตขึ้นทันทีที่พิมพ์ (`amount × pricePerKg`) — RD เห็นผลของตัวเลขทันที ไม่ต้องรอบันทึก
6. **แสดง "ใช้ได้ถึง N kg" และ MOQ เป็นคำ ไม่ใช่รหัส** ในตัวเลือก — ตัดสินใจ Tier ได้ในบรรทัดเดียว
7. **ปุ่ม "ไม่พบ → ขอจัดหา" อยู่ท้ายผลค้นหาทุกครั้ง** ส่งชื่อสารและใบงานไปให้จัดซื้อโดยไม่ต้องพิมพ์ซ้ำ
