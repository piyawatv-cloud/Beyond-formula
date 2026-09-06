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
