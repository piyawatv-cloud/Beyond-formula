# Decision Brief: Sale Brief และความพร้อมก่อนเสนอราคา

วันที่: 2026-09-17  
สถานะ: เสนอเพื่อวิเคราะห์และอนุมัติแนวทาง  
ขอบเขต: Sale brief → RD/Procurement/PU-PK/Operation → Cost Scenario → Sales Proposal → CEO Approval

## 1. Executive decision

**ข้อเสนอหลัก:** อนุมัติให้แยก Sale brief ออกจาก Quote-ready record เป็น 3 gate:

```text
Gate A: รับโจทย์ / เปิดงาน
        ↓
Gate B: Draft Formula + Cost Scenario
        ↓
Gate C: พร้อมให้ Sales เสนอ / CEO อนุมัติ
```

Sale brief ปัจจุบันเหมาะกับ Gate A และเริ่ม Gate B ได้บางส่วน แต่ยังไม่ควรใช้เป็นหลักฐานพร้อมเสนอราคา

**คำตัดสินที่ควรอนุมัติ:**

1. ห้ามปล่อยราคาเพียงเพราะ Sale brief มีราคาเป้าหมายหรือผ่าน PD/RA/RD/Sales Pass
2. เพิ่มข้อมูลแบบมีเจ้าของและมี version/status ไม่ใช่เพิ่มช่องให้ Sales กรอกทุกอย่าง
3. ใช้ Project Formula เป็น source ของ customer/project identity และ link ไปยัง source ของ RD, Procurement, PU-PK และ Operation
4. การแก้ application, permission, sync หรือ schema ในอนาคตต้องผ่าน Critical Change governance และ independent review

## 2. สิ่งที่ตรวจพบ

### ข้อมูลที่มีอยู่แล้ว

| หมวด | มีอะไรอยู่ | ใช้ได้ถึงระดับใด |
|---|---|---|
| ลูกค้า/แบรนด์ | customer, brand, Sales owner, phone, job id | เปิดงานและติดตามงาน |
| สินค้า | รูปแบบ, ขนาด, น้ำหนัก, target, gender, target price | ตั้งโจทย์ RD เบื้องต้น |
| Spec เบื้องต้น | สี, กลิ่น, รส, pack type, ขนาดกล่อง, FDA type | ช่วยกำหนดทิศทางสูตร/pack |
| สูตรเบื้องต้น | ingredient, น้ำหนัก, concentration, origin, note | ทำ draft formula |
| การทำงานร่วมกัน | chat, activity log, PD/RA/RD/Sales pass | ติดตามการทำงานบางส่วน |

### สิ่งที่ยังไม่มีหรือยังไม่พิสูจน์

| หมวด | ช่องว่าง | ผลกระทบ |
|---|---|---|
| Project identity | ไม่มี explicit Formula Project ID/brief revision ที่เชื่อมทุกระบบ | ย้อนที่มาและแยก revision ไม่ชัด |
| Commercial terms | ไม่มี material identity, selected Tier, price/MOQ pair, unit, validity, confirmation | ต้นทุนยังไม่พร้อมใช้เสนอ |
| PK | ไม่มี verified PK request/quote/snapshot ที่ตรงกับ spec และ quantity ปัจจุบัน | เสี่ยงใช้ packaging cost ผิด version |
| Operation | ไม่มี routing, setup/run time, crew, capacity, DL/OH rate, yield/loss | ต้นทุนผลิตไม่ครบ |
| Pricing policy | ยังไม่มี policy version ของ markup/margin | ห้ามคำนวณ selling price แบบเดา |
| Quote control | ไม่มี immutable quote snapshot และ CEO approval event | ราคาเดิมอาจเปลี่ยนตาม source ภายหลัง |
| Disclosure | บางเส้นทางแสดงชื่อสาร/Origin เต็ม | เสี่ยงเปิดข้อมูลที่ Sales/OPC ไม่ควรเห็น |
| Missing semantics | ระบบมี default เช่น 0, 100% และ generic target/benefit | “ยังไม่รู้” อาจถูกอ่านว่า “ยืนยันแล้ว” |

## 3. จุดบอดที่ผู้มีอำนาจควรพิจารณา

### Blind spot 1 — “กรอก brief ได้” ไม่ได้แปลว่า “เสนอราคาได้”

ปัจจุบันสร้างงานได้เมื่อมีเพียงชื่อลูกค้าหรือแบรนด์ (`index.html:2448-2451`) และ template ทำให้หลายช่องเป็น optional (`index.html:5447-5468`) ความยืดหยุ่นนี้ดีสำหรับรับงาน แต่ถ้าไม่มี gate แยก จะทำให้ draft ถูกตีความเป็น quote-ready

### Blind spot 2 — ราคาเป้าหมายอาจถูกใช้ผิดความหมาย

`ราคาเป้าหมาย/หน่วย` เป็นความคาดหวังของลูกค้า ไม่ใช่ supplier price, cost basis หรือ margin policy การใช้ตัวเลขนี้ตัดสินว่าต้นทุน “ผ่าน” อาจทำให้ระบบยืนยันราคาที่ไม่มีหลักฐาน

### Blind spot 3 — ชื่อวัตถุดิบไม่ใช่ material identity

ชื่อเดียวกันอาจมี spec, vendor, concentration, origin และ commercial terms ต่างกัน ต้องให้ RD ยืนยัน identity/spec และให้ Procurement ยืนยัน Tier/ราคา/MOQ แยกหน้าที่กัน

### Blind spot 4 — Header มี ไม่ได้แปลว่า source ใช้งานได้

PU-PK source มี header ที่ดูรองรับ quote/snapshot แต่ semantic mapping, status meaning, equation, current/approved semantics, permission และ referential integrity ยังไม่ผ่านการพิสูจน์ ห้าม implement จากชื่อคอลัมน์เพียงอย่างเดียว

### Blind spot 5 — การซ่อนปุ่มไม่ใช่การคุมข้อมูล

Project rule กำหนดให้ Sales/OPC เห็น adjusted amount เท่านั้น แต่ record popup ยัง render ingredient name/origin/quantity (`index.html:4389-4404`, เรียกที่ `index.html:4501`) จึงต้องตรวจทุก path: screen, chat, export, log และ link

### Blind spot 6 — Department approval ไม่ใช่ commercial approval

PD/RA/RD/Sales Pass เป็น technical/workflow checks ใน Formula เดิม ไม่ใช่ CEO approval ของ quote และไม่ใช่ frozen commercial snapshot

### Blind spot 7 — การเปลี่ยน source หลังอนุมัติอาจเปลี่ยนความหมายของราคาเดิม

ถ้าไม่มี quote snapshot ระบบอาจอ่านราคา source ล่าสุดแล้วทำให้ quote เดิมเปลี่ยนโดยไม่ตั้งใจ ขัดกับหลักว่า approved quote ต้องไม่เปลี่ยนย้อนหลัง

## 4. โอกาสในการเปลี่ยนแปลง

### Opportunity A — เพิ่ม control โดยไม่เพิ่มภาระ Sales มากเกินไป

เพิ่มเฉพาะช่องที่ Sales รู้จริงใน Gate A:

- Formula Project ID / brief revision
- product + selling unit + quantity/scenario
- packaging requirement เบื้องต้น
- claims / constraints / evidence source
- owner, received date, source link
- status ของข้อมูล: Confirmed / Pending / Missing / N/A

ข้อมูลราคา, PK, routing และ DL/OH ให้ link จากเจ้าของข้อมูล ไม่ให้ Sales กรอกซ้ำ

### Opportunity B — สร้าง readiness status แทนการใช้ช่องว่าง

แยกสถานะเป็นรายหมวด:

```text
RM readiness        READY / PENDING / BLOCKED
PK readiness        READY / PENDING / BLOCKED
Operation readiness READY / PENDING / BLOCKED
Pricing policy      READY / PENDING / BLOCKED
Quote readiness     NOT READY / READY FOR CEO / APPROVED
```

ข้อดีคือ RD/RM ทำงานต่อได้เมื่อ PK ช้า แต่ระบบไม่ปล่อย quote จนกว่าหมวดบังคับจะครบ

### Opportunity C — ใช้ version/reference แทนการคัดลอกข้อมูล

ทุก calculation ควรอ้าง:

- Formula project + formula revision
- RM material/source/Tier version
- PK request/quote/snapshot version
- routing/rate version
- pricing policy version
- calculation revision
- quote revision และ approval event

ช่วยลดข้อมูลซ้ำและทำให้ rollback/audit ได้

### Opportunity D — ทำ role-based disclosure ให้เป็นมาตรฐานเดียว

สร้าง payload กลางสำหรับแต่ละ role:

| Role | ควรเห็น |
|---|---|
| Sales/OPC | product, pack, quantity, adjusted RM/PK/Operation, total ที่อนุญาต |
| RD | formula/material detail และ RM base cost ตาม scope |
| Procurement RM | RM commercial terms |
| PU-PK | PK commercial terms |
| Production/Finance | routing, DL/OH และฐานต้นทุนตามหน้าที่ |
| CEO | quote summary, assumptions, risk, approval snapshot |

ต้องใช้กฎเดียวกันในหน้าจอ, chat, export และ link

### Opportunity E — ทำ pilot ที่วัดผลได้

เลือก 1 authorized sanitized project แล้ววัด:

- เวลาจาก brief ถึง draft formula
- จำนวนครั้งที่ต้องย้อนถามข้อมูล
- จำนวนข้อมูลที่เป็น Missing/Pending
- จำนวน revision ก่อน quote
- จำนวน price mismatch หรือ source mismatch
- จำนวน disclosure violation
- เวลาจาก cost-ready ถึง CEO decision

## 5. ทางเลือกเพื่อการตัดสินใจ

| ทางเลือก | ผลดี | ความเสี่ยง/ข้อเสีย | คำแนะนำ |
|---|---|---|---|
| A. ไม่เปลี่ยนตอนนี้ | เร็ว ไม่กระทบระบบ | quote ผิด, ข้อมูลย้อนกลับไม่ได้, disclosure เสี่ยง | ไม่แนะนำ |
| B. เพิ่ม 3 gate + status + references ก่อน | เปลี่ยนเล็ก คุมความเสี่ยงได้ เรียนรู้เร็ว | ต้องกำหนด owner/field contract | **แนะนำ** |
| C. ทำ integrated quotation เต็มรูปแบบทันที | ครบในระยะยาว | scope ใหญ่, dependency สูง, เสี่ยงสร้าง duplicate source | ทำหลัง B และผ่าน pilot |

## 6. สิ่งที่ต้องขออนุมัติ

### ขออนุมัติเชิงธุรกิจ

- [ ] ยอมรับ 3 gate: Intake / Cost Draft / Quote Ready
- [ ] ยืนยันว่า CEO เป็น commercial approver สุดท้าย
- [ ] ยืนยันว่า target price ไม่ใช่ cost basis
- [ ] ยืนยัน owner ของ pricing policy, DL/OH, yield/loss และ leftover exposure
- [ ] ยืนยันว่าการเปลี่ยนข้อมูลหลัง approval ต้องสร้าง quote revision ใหม่

### ขออนุมัติเชิงระบบ

- [ ] ใช้ Formula Project เป็น source ของ customer/project identity
- [ ] ไม่สร้าง customer/project/material master ซ้ำใน calculator
- [ ] ใช้ additive, backward-compatible fields เท่านั้น
- [ ] บังคับ readiness/status โดยไม่ใช้ blank เป็น zero/default confirmation
- [ ] ทำ role-based disclosure ครบทุก surface
- [ ] ทำ pilot ด้วยข้อมูล sanitized ก่อน implementation/release จริง

### ขอแต่งตั้งผู้รับผิดชอบ

| เรื่อง | Owner ที่ต้องยืนยัน |
|---|---|
| Project/brief identity | Project Formula / Sales |
| Formula/material/spec | RD |
| RM price/Tier/MOQ | Procurement RM |
| PK item/Tier/snapshot | PU-PK |
| Routing/yield | RD + Production |
| DL/OH rate/allocation | Cost Accounting/Finance |
| Leftover exposure | Procurement เสนอ / CEO อนุมัติผลกระทบ |
| Final quotation | CEO |
| Technical change approval | System Owner + independent reviewer ตาม governance |

## 7. ขอบเขตที่ยังไม่ควรอนุมัติในรอบนี้

- ยังไม่ควรอนุมัติให้ quote จากข้อมูล Sale brief อย่างเดียว
- ยังไม่ควรอนุมัติการสร้าง duplicate pricing engine ของ PK
- ยังไม่ควรอนุมัติการใช้ PU-PK data จาก header/status โดยไม่ตรวจ semantics และ permissions
- ยังไม่ควรอนุมัติ production deployment หรือ schema/permission change
- ยังไม่ควรถือผล synthetic trial หรือ test pass แทน UAT กับ project ที่ได้รับอนุญาต

## 8. Recommendation

อนุมัติทางเลือก B: **กำหนด 3 gate และ field/ownership/status contract ก่อน** จากนั้นทำ pilot 1 project แบบ sanitized แล้วจึงตัดสินใจว่าจะขยายเป็น integrated quotation เต็มรูปแบบหรือไม่

ลำดับที่ปลอดภัยที่สุด:

1. แต่งตั้ง owner/reviewer และสร้าง GitHub Issue จริง
2. ยืนยัน field matrix ของ Gate A/B/C
3. ตรวจ source semantics ของ RM และ PU-PK แบบ read-only
4. ออกแบบ role-filtered payload และ revision references
5. ทดสอบ pilot/UAT
6. ค่อยเสนอ implementation และ release approval

## 9. Evidence and current verification

- แบบฟอร์มและ validation: `index.html:751-1004`, `2441-2547`
- Default/missing behavior: `index.html:2423-2437`, `2483-2499`
- Disclosure path: `index.html:4356-4405`, `4477-4501`
- Approval/export path: `index.html:4521-4527`, `5288-5295`
- Project authority and dependencies: `cost calculator by project/REGISTRY.md`, `SPEC.md`
- Existing application test: `node harness.js` → 56 passed, 0 failed
- Existing SQL authorization test: `./tests/run-sql-tests.sh` → PASS
- Detailed audit: `docs/AUDIT_2026-09-17.md`

## 10. Decision record

```yaml
status: DECISION REQUIRED
recommendation: approve_option_B
decision_owner: System Owner / business authority
technical_owner: to_be_assigned
independent_reviewer: to_be_assigned
issue_id: not_assigned
production_change_authorized: false
quote_ready_from_sale_brief_only: false
rollback: no application change; revert this report only
open_risks:
  - project/revision identity contract
  - RM/PK commercial confirmation and semantic mapping
  - Operation DL/OH/yield/loss evidence
  - pricing policy ownership
  - role-based disclosure across all surfaces
  - CEO quote snapshot/reapproval contract
```

