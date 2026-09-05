# วิธีแก้รูปแบบข้อความ MOQ/ราคาใน RD Data Center

เจ้าของระบบสั่งให้แก้ต้นทาง 2026-09-05 · **สคริปต์นี้ให้คนเป็นผู้รัน ไม่ใช่ agent**

## ทำไมไม่ให้ agent แก้ให้เลย

เครื่องมือ Google Drive ที่ผมมี **แก้ได้แค่ชื่อไฟล์และโฟลเดอร์ เขียนเซลล์ไม่ได้** และไม่มีเครื่องมือ Sheets API การเขียนทับทั้งไฟล์เป็นวิธีเดียวที่พอทำได้ ซึ่งจะ**ทำลาย 26 แท็บ สูตร และรูปแบบทั้งหมด** จึงไม่ทำ

สคริปต์นี้แก้เฉพาะเซลล์ที่ตั้งใจ และให้คนกดรันเอง ซึ่งตรงกับกติกาที่ว่าการเปลี่ยนแปลงต้องมีคนรับผิดชอบ

## ขั้นตอน

1. เปิดสเปรดชีต → Extensions → Apps Script
2. เพิ่มไฟล์ `RmSourceMap.gs` และ `RmSourceFix.gs` จาก `cost calculator by project/apps_script/`
3. แก้ค่า `RM_FIX_SHEET_NAME` ให้เป็นชื่อแท็บหลักฐานราคา (แท็บที่มีคอลัมน์ `Price Tiers (Raw)` และ `MOQ / Qty`)
4. **รัน `previewSourceFix()` ก่อนเสมอ** — ไม่เขียนอะไรทั้งสิ้น ดูรายงานใน Logger ว่าจะเปลี่ยนแถวไหนจากอะไรเป็นอะไร
5. ถ้ารายงานถูกต้อง จึงรัน `applySourceFix()`

## สิ่งที่สคริปต์ทำและไม่ทำ

**ทำ**
- แตะเฉพาะสองคอลัมน์ `Price Tiers (Raw)` และ `MOQ / Qty` ในแท็บที่ระบุเท่านั้น
- สำรองค่าเดิมลงแท็บซ่อนชื่อ `_backup_rawtiers_<เวลา>` พร้อมเลขแถว ค่าเดิม ค่าใหม่ เวลา และอีเมลผู้รัน **ก่อน**เขียนทุกครั้ง
- รันซ้ำได้ ค่าที่ตรงอยู่แล้วถูกข้าม

**ไม่ทำ**
- ไม่แตะแท็บอื่น สูตร รูปแบบ หรือคอลัมน์อื่น
- **ไม่แตะแถวที่ตีความไม่ชัด** เช่น MOQ เป็นช่วง หน่วยไม่ใช่น้ำหนัก จำนวน MOQ กับราคาไม่เท่ากัน หรือราคาทะลุเพดาน — แถวเหล่านี้ถูกรายงานให้คนตัดสินแทน
- ไม่เขียนถ้าสร้างแท็บสำรองไม่ได้ และหยุดทันทีถ้าหาหัวคอลัมน์ไม่เจอ แทนที่จะเดาตำแหน่ง

## ย้อนกลับ

```javascript
RmSourceFix.restore(SpreadsheetApp.getActiveSpreadsheet(), '_backup_rawtiers_<เวลา>', RM_FIX_SHEET_NAME)
```

## ที่คาดว่าจะเกิดขึ้น

จากการสำรวจ 275 แถว คาดว่าจะปรับรูปแบบราว **214 แถว** และ **ไม่แตะราว 24 แถว** ที่ต้องให้คนตัดสิน แต่ตัวเลขจริงให้ยึดตามรายงานของ `previewSourceFix()` ในวันที่รัน เพราะข้อมูลอาจเปลี่ยนไปแล้ว

## ทดสอบแล้ว

`tests/rm-source-fix.test.js` ใช้ mock ของ Sheets ที่บันทึกทุกการเขียน ยืนยันว่า dry run ไม่เขียนแม้แต่เซลล์เดียว · เขียนเฉพาะสองคอลัมน์ที่ตั้งใจ · ไม่แตะแถวที่ไม่ชัด · สำรองก่อนเขียนเสมอ · ปฏิเสธเมื่อสำรองไม่ได้ · รันซ้ำไม่เขียนเพิ่ม · คืนค่าเดิมได้ · หยุดเมื่อหาหัวคอลัมน์ไม่เจอ

---

# แทรกสามคอลัมน์ที่เครื่องคำนวณต้องใช้

เจ้าของระบบสั่งให้แทรก 2026-09-05 · สคริปต์ `RmSchemaExtend.gs` · **ให้คนเป็นผู้รัน** ด้วยเหตุผลเดียวกับข้างบน

| คอลัมน์ที่เพิ่ม | ความหมาย | ตัวช่วยกรอก |
|---|---|---|
| `Order Increment (kg)` | ขนาดที่สั่งเพิ่มได้ทีละ | ต้องเป็นตัวเลขมากกว่า 0 |
| `Price Valid Until` | ราคามีผลถึงวันไหน | บังคับเป็นวันที่ รูปแบบ `yyyy-mm-dd` |
| `Spec Approved` | RD รับรอง spec แล้วหรือยัง | เลือก TRUE หรือ FALSE เท่านั้น |

## ขั้นตอน

1. เพิ่มไฟล์ `RmSchemaExtend.gs` เข้า Apps Script project เดียวกัน
2. แก้ `RM_SCHEMA_SHEET_NAME` ให้เป็นชื่อแท็บจับคู่ราคา (แท็บที่มี `RD-Code`)
3. รัน `previewSchemaExtend()` ก่อน — บอกว่าจะเพิ่มคอลัมน์ไหนที่ตำแหน่งใด โดยไม่เขียนอะไร
4. รัน `applySchemaExtend()`

## สิ่งที่กันไว้

- **ต่อท้ายเสมอ ไม่แทรกกลาง** เพราะการแทรกกลางจะทำให้ index ของคอลัมน์เดิมขยับ แล้วสูตรและสคริปต์ที่อ้างตำแหน่งคอลัมน์จะพังทั้งไฟล์
- **ไม่เติมค่าให้** ช่องว่างแปลว่ายังไม่มีข้อมูล ไม่ใช่ศูนย์หรือ FALSE
- ใส่ data validation ให้ทั้งสามคอลัมน์ เพื่อกันกรอกผิดตั้งแต่ต้นทาง
- รันซ้ำไม่เพิ่มซ้ำ · มีอยู่แล้วบางคอลัมน์ก็เพิ่มเฉพาะที่ขาด · หาหัวตารางไม่เจอจะหยุด ไม่เดาตำแหน่ง

ทดสอบด้วย mock ที่บันทึกทุกการเขียน ยืนยันว่าไม่มีการเขียนลงคอลัมน์เดิมเลย

---

# กลุ่ม C — A03/A04: ยืนยันเงื่อนไขแบบผูกเวอร์ชัน (เตรียม local แล้ว)

วันที่ 2026-09-06 · **Critical Change / LOCAL_VERIFIED / INTEGRATION_BLOCKED**

`RmConfirmationAdapter.gs` เรียก `RmData.confirm()` และ `RmData.eligible()` โดยตรง เพื่อไม่ให้ข้อความ READY/CONFIRMED ที่กรอกเองกลายเป็นหลักฐานอนุมัติ และให้การเปลี่ยนราคา/MOQ/LT/spec/เงื่อนไขทำให้สถานะเวอร์ชันเก่าใช้ต่อไม่ได้ งานนี้เป็นตัวประสานให้คนรัน ไม่มี trigger และ agent ไม่ได้รันกับ Google Sheets

**ยังห้ามนำไปรันกับ pilot โดยเดาคอลัมน์เอง**: ใน source ที่ได้รับอนุญาตให้อ่าน ยังไม่มี binding ที่ตรวจแล้วระหว่างรายการ pilot ↔ stable offer identity ↔ commercial version ↔ approval event log ↔ cost gate ต้นทาง `RmCatalogBuild` ยังใช้ label READY และ version ตั้งต้น จึงไม่ถือว่า adapter นี้ปิด A03/A04 ใน runtime ได้แล้ว ไม่มีการแก้ legacy snapshot หรือสร้าง contract ตารางขึ้นเอง

## สิ่งที่มีให้ตรวจและสิ่งที่ยังต้องจัดหา

มี `apps_script/RmConfirmationAdapter.gs` และ `tests/rm-confirmation-adapter.test.js` ใช้ mock บันทึกทุกการเขียน ขณะนี้ `RM_CONFIRMATION_BINDING = null` โดยตั้งใจ การเรียก entry point โดยไม่จัดหา binding จะหยุดด้วย `REVIEWED_PILOT_BINDING_REQUIRED`

ก่อนให้คนรัน ผู้ดูแล pilot ต้องส่ง source/mapping ที่อนุญาตให้ตรวจ เพื่อจัดทำ binding ที่ผ่าน independent review ดังนี้:

| Binding | หน้าที่ที่ต้องพิสูจน์ |
|---|---|
| `reviewedEvidenceRef` | อ้างอิงหลักฐาน review จริง ไม่ตั้งข้อความนี้แล้วถือว่าผ่านสิทธิ์โดยอัตโนมัติ |
| `read()` | อ่านรายการเป็น `{key, record, confirmation, context, gate}`; `key` เป็นตัวตนข้อเสนอที่คงเดิมเมื่อย้ายแถว, `record` เป็นผล `RmData` ที่อ่านจากต้นทางปัจจุบัน, confirmation มาจาก event ที่บันทึกแล้ว ไม่ใช่ dropdown |
| `authorize(actor, action)` | ตรวจผู้รันที่ระบุตัวตนได้ตามสิทธิ์ Procurement ของ pilot ห้ามใช้ actor จากช่องกรอกหรือ fallback identity; ไม่ใช่การรื้อสถาปัตยกรรม local-first ของ calculator |
| `withLock(fn)` | ทุกทางเข้าของ adapter ใช้ lock เดียวกัน; lock สคริปต์ไม่กันผู้ใช้แก้เซลล์เอง ต้องมีการจัดการช่วงเวลาที่รัน/ตรวจ currentness แยก |
| `backup(payload)` / `readBackup(ref)` | สำรองเฉพาะรายการที่กำลังจะเปลี่ยนพร้อมก่อน/หลัง/ผู้รัน/เวลาในที่เก็บที่อนุมัติ แล้วอ่านกลับเทียบครบก่อนเริ่มเขียนจริง ห้าม overwrite backup เดิม |
| `appendEvent(key, event)` | เก็บ event แบบ append-only และ idempotent ต่อเวอร์ชัน/การกระทำ ห้ามลบประวัติหรืออัปเดตราคาใน event เก่า; อ่านกลับผ่าน `read()` ได้หลัง flush |
| `writeGate(key, gate)` | เขียนเฉพาะ cost gate ที่ mapping ยืนยันว่าไม่ทับสูตร/คอลัมน์ธุรกิจ หาตำแหน่งจากตัวตนปัจจุบัน ไม่ใช้เลขแถวเก่าค้างไว้ |
| `flush()` | flush การเขียนจริงก่อนอ่านยืนยันผล; ไม่รายงานว่าสำเร็จจาก memory เท่านั้น |

`context` ต้องระบุ scope/currentness/withdrawn/obsolete/stale/syncFailed/ข้อจำกัดที่เกี่ยวข้องจากหลักฐานจริง ข้อมูลที่ไม่ชัดต้องคง review/block ไม่เดาเป็น current หรือ confirmed. Canonical version และ preview token มี commercial terms จึงเป็นข้อมูลภายใน ห้ามพิมพ์ลง log/shared screenshot/ส่ง Sales; `report()` แสดงเฉพาะจำนวน

## ลำดับที่คนต้องทำ หลัง binding และ release ได้รับอนุมัติ

1. เตรียม `RmData.gs`, `RmConfirmationAdapter.gs` และ reviewed pilot binding ในสภาพแวดล้อมทดสอบก่อน ห้ามวาง production หรือใช้ credential โดยถือว่าคู่มือนี้คือ approval
2. โหลดผู้รันจากวิธีระบุตัวตนที่ตรวจแล้ว เลือก `requests = [{key, expectedVersion}]` เฉพาะเงื่อนไขที่ Procurement ตรวจรับ ไม่เลือกจาก READY label
3. รัน `previewRmConfirmation(requests, actor, nowUTC)` เก็บ preview ที่ได้ใน session ของผู้รัน ตรวจผล `RmConfirmationAdapter.report(preview)` และรายละเอียดในพื้นที่ภายในที่มีสิทธิ์ ทั้งขั้นนี้ไม่มีการเขียน
4. รัน `applyRmConfirmation(preview, requests, actor, nowUTC)` หลังตรวจ preview แล้ว adapter จะอ่านใหม่ภายใต้ lock หากข้อมูล/สิทธิ์/ผลที่จะเปลี่ยนต่างจาก preview จะหยุดให้ preview ใหม่
5. สำรองและอ่านสำรองกลับให้ตรงครบ → เปลี่ยน gate ที่มีความเสี่ยงเป็น BLOCKED → append confirmation event → flush และอ่าน event/เงื่อนไขกลับ → ค่อยตั้ง READY และอ่าน gate กลับ
6. ถ้าใช้เวอร์ชันเดิมที่ยืนยันและเข้าเงื่อนไขอยู่แล้ว จะไม่สร้าง event ซ้ำ หากไม่มีอะไรเปลี่ยนจะไม่ backup หรือเขียนเพิ่ม
7. การทบทวนโดย `requests = []` ไม่อนุมัติอะไรใหม่ แต่คำนวณ gate ใหม่จาก event เดิมเพื่อปิด READY ที่หมดอายุ/เปลี่ยนเงื่อนไข/ถูกถอน โดยไม่ลบประวัติราคาเดิม

รายการกำกวมจะไม่รับ confirmation หรือแก้ source terms แต่ถ้ารายการนั้นมี READY ที่ไม่ปลอดภัยอยู่ จะปิดเฉพาะ gate เป็น BLOCKED และรายงานรอตรวจ รายการไม่เกี่ยวข้องไม่ถูกเขียน

## ล้มเหลวและย้อนกลับ

- Backup ล้ม/อ่านกลับไม่ตรง: ไม่มี gate/event write
- Event append ล้ม: รายการที่เคย READY ถูกปิดก่อนแล้ว ไม่ประกาศสำเร็จ
- เขียน READY ล้มหลัง event สำเร็จ: preview ใหม่แล้ว retry ได้ โดยอ่าน event เดิมและไม่ append ซ้ำ
- Terms เปลี่ยนระหว่างรัน: ไม่เปิด READY เมื่ออ่านกลับพบความต่าง; ต้องตรวจ pilot currentness อีกครั้ง ไม่อ้าง lock ว่าป้องกันทุก concurrent manual edit
- ไม่ทำ automatic restore READY จาก backup เพราะราคาเก่าอาจหมดอายุหรือไม่ตรงแล้ว ให้เก็บ gate BLOCKED ตรวจประวัติ/backup แล้วรัน preview ใหม่ตามข้อมูลที่ยืนยัน ห้ามลบ confirmation event เพื่อย้อนประวัติ; การคืนค่าธุรกิจเป็นงาน owner/operator ภายใต้ approval
- ถ้า pilot ต้นทางยังคำนวณ gate ด้วยสูตร/dropdown เส้นเก่า จะต้องแก้ routing นั้นผ่าน review ก่อน ตัวประสานนี้ไม่ได้ติดตั้งแทนให้อัตโนมัติ

## หลักฐาน local

คำสั่ง `node --test 'cost calculator by project/tests/rm-confirmation-adapter.test.js'` จาก root: **15/15 ผ่าน** ใช้ข้อมูล synthetic เท่านั้น เริ่มจาก regression ที่ fail ก่อน implementation รวม preview/no write, backup/readback, exact-version change, duplicate identity, unauthorized actor, invalid clock, append failure, silent persistence failure, retry หลัง log สำเร็จ เปลี่ยน LT ระหว่างเขียน และเปลี่ยนเงื่อนไขพร้อมการเขียน READY (readback ปิด gate และไม่ประกาศสำเร็จ)

ไม่มีการเปลี่ยน database/schema/permission/dependency จริง ไม่มี commit/push/deploy/ข้อความจริงใน subtask นี้ Rollback code: นำไฟล์ adapter/test ใหม่ออกและย้อน section เอกสารนี้ ไม่ต้องคืน production เพราะไม่เคยเขียน การตรวจ integrated browser/SQL ให้ยึดผลรวมที่ root บันทึกในรอบนี้; 15 unit tests ไม่ทดแทน UAT/CODEOWNER review/A07–A09 ที่ runtime
