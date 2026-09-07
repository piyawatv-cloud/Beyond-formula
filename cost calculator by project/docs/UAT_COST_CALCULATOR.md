# Cost Calculator — UAT and release worksheet

Status: PREPARED, NOT EXECUTED. No business acceptance is inferred from synthetic tests. P24–P26 remain human/operator gates.

Before UAT: approve the version/access contract; implement trusted persistence and project-scoped reads/writes; close legacy Formula disclosure routes; verify physical RM/PK mapping in a non-production environment; provide versioned STD/loss/pricing/rounding values. Use sanitized projects and test recipients. No actual external messages during automated tests.

| Case | Business owner | Expected observation | Actual / accepted by / date |
| --- | --- | --- | --- |
| Similar RM names, different specs/Tiers | RD + Procurement RM | Correct item selected from one comparative list; price/MOQ inseparable | Not executed |
| Missing material | RD + Procurement RM | Sourcing request; pending RD spec and commercial confirmation; original RM unchanged | Not executed |
| RM-only with PK absent/offline | RD | Save/edit/compare RM without PK; partial amount clearly not total | Not executed |
| PK negotiation and selected version | PU-PK + RD | Multiple revisions preserved; explicit adoption; changed spec/quantity invalidates reuse | Not executed |
| Loss and operation | RD + Production + Finance | Unit/batch/run/setup and ownership reconcile; no double loss/STD | Not executed |
| MOQ exposure | Procurement + CEO | Used cost, estimated cash and residual exposure separate; no assumed resale | Not executed |
| Permission matrix | RD/PU-PK/Sales/OPC/Finance/CEO | Real request payloads/exports/chat/history contain only permitted fields | Not executed |
| Partial chat + retry | RD + Sales | Correct project/revision/link, safe aliases, pending/sent truthful, no duplicate | Not executed |
| CEO approval and changed terms | CEO + Procurement | Exact eligible revision only; approved snapshot unchanged; new revision requires approval | Not executed |
| Old client/data compatibility | Owner + QA | Existing keys/types load; redacted client writes never erase full source data | Not executed |

Server-side negatives already covered by the local SQL suite, so UAT can focus on business behaviour rather than re-proving them: role/raw-category boundaries (RD denied raw PK and raw Operation; generic `purchasing` denied every raw category; unmapped roles fail closed), Sales cross-project denial, Sales denied historical-view capability and base cost, non-admin cannot enable or remove the gateway flag, direct reads of the private cost store denied, stale-revision edits rejected without forking history, summary idempotency conflict on changed content, pending receipts never reported as sent, CEO approval fail-closed, and an approved snapshot staying byte-stable across a new revision and a changed source.

Not covered by any automated test and still required from UAT: changed PK commercial terms and changed spec/packaging conditions at the server layer (no PK snapshot or packaging-requirement table exists yet), the permission matrix against real Procurement RM / PU-PK / Production / Finance / CEO capabilities, and old-client/cache compatibility. The `Permission matrix` and `CEO approval and changed terms` cases below therefore cannot be executed until the capability mapping in [gateway contract](COST_GATEWAY_CONTRACT.md) §3 is approved.

Release evidence required: real Issue/PR, immutable commit, independent CODEOWNER/security review, checks, completed UAT, approved migration/cache transition, operator deployment record and rollback rehearsal. Author cannot final-approve.

Rollback: local changes can be reverted by feature commit. For a future live rollout, disable calculator gateway and use a reviewed compatible prior artifact; retain snapshots/outbox/audit records. Never restore broad data grants merely to make an old client work. No runtime rollback script is certified by this worksheet.

Stop/revert criteria: unauthorized raw payload, incorrect units/pricing/selected snapshot, corrupted revisions, duplicate sends, or incompatible record writes. Post-live checks must include user workflow and permission evidence in addition to service health. Deployer/time/release/health/rollback target: pending authorized Runtime Operator.

---

## รอบ Phase E — ทางเข้า Cost Calculation (เตรียมไว้ 2026-09-07 · ยังไม่ได้รัน)

สถานะ: PREPARED, NOT EXECUTED · เกณฑ์รับงาน AC1–AC10 อยู่ใน `SPEC.md` ส่วน "Grill round 9" · ผู้ตัดสินว่าผ่าน: **เจ้าของระบบ** หลังจาก RD จริงทดลองใช้ (คำตัดสิน 2026-09-06) · build ที่ต้องเห็นบน header ก่อนเริ่ม: `2026-09-07.8-line-search` หรือใหม่กว่า (hard refresh)

ข้อมูลที่ใช้: ใบงาน Formula สังเคราะห์ที่มีตารางสาร ≥ 3 ชื่อ · แคตตาล็อก RM ที่จัดซื้อยืนยันแล้วอย่างน้อย 5 ข้อเสนอ · ห้ามใช้ชื่อลูกค้าจริงในรอบนี้ · ไม่มีข้อความจริงส่งออกนอกระบบ

| # | AC | บทบาทที่ทดสอบ | สิ่งที่ต้องเห็น | ผ่าน/ไม่ผ่าน · ผู้ตรวจ · วันที่ |
|---|---|---|---|---|
| 1 | AC1 | RD, Admin, PU-PK, Purchasing | เมนู "Cost Calculation" ปรากฏท้ายซ้ายถัดจาก Dashboard | ยังไม่รัน |
| 2 | AC1 | Sales, OPC, Finance, CEO, PD, RA, MKT | ไม่เห็นเมนู · ปุ่ม "คำนวณต้นทุน" ในตาราง Dashboard หาย · เปิดลิงก์ `#project=…` แล้วไม่เปิด | ยังไม่รัน |
| 3 | AC2 | RD | Dashboard แสดง 9 คอลัมน์ครบ · พิมพ์ค้น 1 ตัวอักษรแล้วตารางกรองทันที เคอร์เซอร์ไม่กระโดด · ราคา/หน่วยขึ้น "รอ" จนกว่าจะคำนวณครบ | ยังไม่รัน |
| 4 | AC2 | Purchasing | เห็นแถวและสถานะ แต่ช่องราคา/หน่วยเป็น "—" · ไม่มีปุ่ม "+ สร้างใบงานต้นทุน" | ยังไม่รัน |
| 5 | AC3 | RD | สร้างลอย → ได้รหัส `CJ-…` เปิดเป็นหน้าเครื่องคำนวณทันที · ผูกกับใบงาน Formula ที่ว่างได้ · ผูกกับใบที่มีใบงานต้นทุนแล้วถูกปฏิเสธพร้อมชื่อเจ้าของ · ผูกแล้วรหัสเดิม | ยังไม่รัน |
| 6 | AC3 | RD | ผูกขณะมีค่าที่ยังไม่บันทึก → ถูกปฏิเสธให้บันทึกก่อน ค่าไม่หาย | ยังไม่รัน |
| 7 | AC4 | RD | โคลนใบที่พร้อมเสนอ → ใบใหม่ติดสูตร ราคา RM และ PK มาครบ · ถ้าราคาในต้นแบบหมดอายุ ใบใหม่ขึ้น "RM n: รอ…" ไม่ผ่านเงียบ | ยังไม่รัน |
| 8 | AC5 | RD | เปิด 2 ใบเป็น 2 tab พิมพ์ค้างใน tab แรก สลับไปกลับค่ายังอยู่ · ปิด tab ที่มีค่าค้างต้องยืนยัน ปฏิเสธแล้วไม่ปิด · ยืนยันแล้วไม่มี revision ใหม่เกิด | ยังไม่รัน |
| 9 | AC6 | Sales ปิดใบงาน Formula → RD | tab ของใบนั้นเป็นอ่านอย่างเดียว ช่องกรอกปิดหมด · ปุ่ม "โคลนไปทำใบใหม่" ใช้ได้ · Sales เปิดงานใหม่แล้ว RD แก้ได้อีก | ยังไม่รัน |
| 10 | AC7 | RD → CEO | RD กด "ส่งให้ CEO ดูทั้งเอกสาร" · ในแชทมีข้อความ 1 บรรทัดพร้อมปุ่ม "เปิดเอกสารต้นทุน" (CEO เห็นปุ่ม Sales ไม่เห็น) · เอกสารแสดง RM/PK/Operation/กฎราคา/ผู้ขาย ครบ ไม่รวม VAT · แก้ไม่ได้ · RD แก้ต่อแล้วเอกสารเดิมไม่เปลี่ยน | ยังไม่รัน |
| 11 | AC7 | Sales | เปิดลิงก์ `#costdoc=CJ-…&revision=N` แล้วไม่แสดงเอกสาร | ยังไม่รัน |
| 12 | AC8 | Finance | เมนู "กฎราคา" เห็นแต่เมนู Cost Calculation ไม่เห็น · บันทึกอัตรามาตรฐานเวอร์ชันใหม่แล้วสถานะเป็น "ใช้ได้" · เลือกใบงานแล้วบันทึกกฎ → RD เห็นราคาต่อหน่วยใน dashboard · revision ก่อนหน้าไม่เปลี่ยน | ยังไม่รัน |
| 13 | AC9 | Admin + QA | หน้า Formula Studio เดิม (Dashboard, Customer Data, แชท, Export) ใช้ได้เหมือนเดิม · `localStorage` ไม่มี key ใหม่นอกจาก `fs_cost` | ยังไม่รัน |
| 14 | REGISTRY | RD | เปิดใบที่ผูกครั้งแรก → แถว RM มีชื่อสารครบตามใบงาน Formula ปริมาณว่าง หน่วย mg (แคปซูล/เม็ด) · พิมพ์ชื่อสลับคำ (เช่น `type ii collagen`) เจอ · พิมพ์ไทย (เช่น `วิตามินซี`) เจอชื่อการค้าอังกฤษ · ตัวที่เคยเลือกมีป้ายและอยู่บนสุด แต่ต้องกดเอง · ใส่ปริมาณแล้วราคาต่อหน่วยผลิตขึ้นทันที | ยังไม่รัน |
| 15 | REGISTRY | RD | สารที่ไม่มีในแคตตาล็อก → กด "ไม่พบ → ขอจัดหา" คำขอมีชื่อสารครบ ไม่มีราคาสมมติ | ยังไม่รัน |

### AC10 — แบบจับเวลา 30 วินาทีต่อรายการ (วัดที่เวลาของคน ไม่ใช่เวลาเครื่อง)

เวลาเครื่องวัดแล้ว 78 ms ต่อรายการ (เอกสาร `RM_SOURCE_FIX_RUNBOOK.md` §5) ไม่ใช่ข้อจำกัด · ตารางนี้วัด RD จริง 1 คน ทำใบงานจริง 1 ใบ จนกดส่งสรุปเข้าแชทและ Sales ได้ราคา

| รายการสาร (ชื่อสังเคราะห์) | เริ่มพิมพ์ค้นหา (นาฬิกา) | กดเลือกข้อเสนอ | ใส่ปริมาณเสร็จ | วินาทีต่อรายการ | หมายเหตุ (ติดตรงไหน) |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |
| **เฉลี่ย** | | | | **≤ 30 ?** | |

เวลารวมตั้งแต่กดเมนู Cost Calculation จน Sales เห็นราคาในแชท: ________ นาที · RD ที่ทดสอบ: ________ · ผู้จับเวลา: ________ · วันที่: ________

**เกณฑ์ผ่าน:** เฉลี่ย ≤ 30 วินาทีต่อรายการ **และ** ทุกเคส 1–15 ผ่าน · ถ้าเกิน ให้ระบุขั้นตอนที่ช้าที่สุดในช่องหมายเหตุ เพื่อแก้ตรงจุด ไม่เดา

### หลังผ่าน UAT

ส่งต่อ CODEOWNER `@phossatron` review (แตะ permission = Critical Change: E1-02, E5, E6) → Runtime Operator deploy · ผู้เขียนโค้ดไม่ final-approve และไม่ deploy เอง
