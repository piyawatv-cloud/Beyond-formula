# Prompt สำหรับ Codex — งานที่เหลือของ Cost Calculator

คัดลอกทั้งบล็อกด้านล่างไปเป็น prompt ให้ Codex ได้เลย เนื้อหาข้างล่างเขียนถึง Codex โดยตรง

---

## บริบท

Repository/worktree: `/Users/user/.codex/worktrees/cost-calculator-implementation` · branch `codex/cost-calculator-implementation`

อ่านก่อนเริ่มทุกครั้ง: `AGENTS.md` · `CLAUDE.md` · `cost calculator by project/TASK.md` · `docs/RD_DATA_CENTER_ASSESSMENT.md` · `docs/COST_LADDER_MAPPING.md` · `docs/RM_SOURCE_FIX_RUNBOOK.md` · `docs/adr/0002-local-first-cost-calculator-without-server-enforcement.md`

สถานะปัจจุบัน **LOCAL_VERIFIED / INTEGRATION_BLOCKED** — module 228 · calculator browser 8 · parent browser 37 · SQL 33 ผ่านทั้งหมด

## ข้อห้ามที่ยังมีผล

- ห้าม deploy production · ห้าม push public · ห้ามเปิด PR · ห้ามแก้ protected branch
- ห้ามใช้ production secret และห้ามส่งข้อความจริงถึงคนจริง
- ห้ามคัดลอกชื่อสาร ชื่อผู้ขาย ราคา หรือรหัสไฟล์ต้นทางลง repository / commit / log
- ห้ามเปลี่ยน locked storage contract ตาม CLAUDE.md กฎข้อ 2 · เพิ่ม key ใหม่ได้แต่ต้องมี loader ของตัวเองและห้ามเขียนก่อนโหลดเสร็จ (กฎข้อ 4)
- ห้ามอ้างว่าเสร็จหรือ production-ready จนกว่าจะผ่าน UAT / review / deployment gates
- แก้ `index.html` เมื่อไร ต้อง bump build stamp (กฎข้อ 10)

## งานที่ต้องทำ เรียงตามลำดับที่แนะนำ

### 1. หลังเจ้าของระบบเติมข้อมูลต้นทางแล้ว — ตรวจว่าคิดต้นทุนได้จริง

เจ้าของจะรัน `applySchemaExtend()` เพิ่มสามคอลัมน์ แล้วกรอกค่า จากนั้น

```sh
node "cost calculator by project/tools/build-rm-catalog.js" <DataCenter export> -o /tmp/catalog.csv
node "cost calculator by project/tools/check-rm-catalog.js" /tmp/catalog.csv --show-values
```

รายงานจำนวนที่ **พร้อมคิดต้นทุนทันที** ถ้ายังเป็น 0 ให้บอกว่าติดอะไร **ห้ามเติมค่าให้เอง** ค่าว่างแปลว่ายังไม่มีข้อมูล

### 2. Lead Time ของ 19 รายการที่จับคู่ไม่ได้

ทดสอบแล้วว่าจับคู่ด้วยชื่อได้ 4/23 และจับคู่บางส่วนได้ 0 แปลว่าเป็นคนละชุดข้อมูล **ห้ามทำ fuzzy matching เพิ่มโดยหวังว่าจะเจอ** ให้ถามเจ้าของระบบว่าจะเอา Lead Time จากไหน หรือให้กรอกเพิ่มที่ต้นทาง

### 3. ปิด A03 · A04 ที่ pilot script (Critical Change)

อยู่ใน `local-only/legacy-workspace/apps_script/Code.gs` ซึ่ง **gitignore ไว้และเป็นสำเนาของ runtime — ห้ามแก้ไฟล์นั้นโดยตรง**

- **A03** Cost Gate ตรวจแค่ `N=CONFIRMED, MOQ>0, Price>0, Lead Time ไม่ว่าง` ทำให้ `FIND ALTERNATIVE` กลายเป็น READY และแก้ราคาหลังอนุมัติแล้ว log ไม่ตรง
- **A04** ID ผูกกับหมายเลขแถว ย้ายแถว = ID เปลี่ยน · เปลี่ยน Lead Time 7→90 วัน = ID เดิม ไม่ต้องขออนุมัติใหม่

`apps_script/RmData.gs` มี `confirm()` และ `eligible()` ที่ปิดสองข้อนี้แล้วในระดับโดเมน งานคือเขียน **adapter ที่ให้คนรัน** แบบเดียวกับ `RmSourceFix.gs` และ `RmSchemaExtend.gs` คือ preview ก่อน · สำรองก่อนเขียน · idempotent · ไม่แตะแถวที่ไม่ชัด · มีเทสต์ที่ใช้ mock บันทึกทุกการเขียน

### 4. ต่อ RmCatalogBuild เข้าปุ่มนำเข้าในแอปโดยตรง

ตอนนี้ต้องผ่านเครื่องมือ command line ก่อน ถ้าจะทำให้ import ไฟล์ Data Center ได้ตรง ๆ **ห้ามคัดลอกตรรกะจาก `RmSourceMap.gs`/`RmCatalogBuild.gs` เข้า `index.html`** เพราะจะกลายเป็นกฎสองชุดที่เพี้ยนกันได้ ให้หาวิธีที่ไม่ซ้ำซ้อน หรือคงเป็นสองขั้นตอนแล้วอธิบายว่าทำไม

### 5. งานที่ต้องรอคนอื่น ห้ามทำแทน

UAT กับผู้ใช้จริง · independent review จาก CODEOWNER `@phossatron` · deployment โดย Runtime Operator · A07/A08/A09 ที่ต้องแก้การติดตั้ง Apps Script จริง

## คำสั่งตรวจก่อนส่งงานทุกครั้ง

```sh
node --test tests/cost-calculator-core.test.js tests/cost-calculator-ui.test.js \
  tests/cost-calculator-local.test.js tests/cost-form-reconciliation.test.js \
  'cost calculator by project/tests/'*.test.js
node tests/run-cost-calculator-browser.js
node harness.js
./tests/run-sql-tests.sh
git diff --check
```

`run-sql-tests.sh` ต้องการ locale ที่ตั้งค่าแล้ว สคริปต์ pin `LC_ALL` ให้เองแล้ว

## สิ่งที่ต้องรายงานกลับ

files changed · commits · tests และผลจริง · security/database/permission/dependency impact · rollback · open risks · และระบุชัดว่าเป็น LOCAL_VERIFIED หรือ INTEGRATION_BLOCKED **ห้ามรายงานว่า production complete**

## บทเรียนจากรอบที่ผ่านมา อ่านก่อนเขียนโค้ด

1. **module test ผ่านหมดไม่ได้แปลว่าไม่พัง** — บั๊กที่หน้าจอว่างทั้งหน้าถูกจับโดย browser suite ตอน module 174 ข้อผ่านหมด รัน browser suite เสมอ
2. **เทสต์ที่ผ่านเพราะเลิกทดสอบของจริง คือเทสต์ที่แย่ที่สุด** — มีเทสต์ชื่อ "fails closed without persistence" ที่ยังเขียวหลังระบบมี persistence แล้ว ถ้าเปลี่ยนพฤติกรรมให้แก้ชื่อและ assertion ด้วย
3. **ระวัง cross-realm** — `deepEqual` กับ array ที่สร้างใน `vm` จะไม่ผ่าน และ `instanceof Date` ก็ใช้ไม่ได้ ใช้ `.join()` หรือ duck typing
4. **`finite()` ในแกนปฏิเสธค่าติดลบ** เพราะ `num()` บังคับ ≥ 0 อย่าใช้กับผลต่างที่มีเครื่องหมาย
5. **ค่าที่แสดงบนฟอร์มกับค่าตั้งต้นของ draft ต้องตรงกัน** ไม่งั้น `costDraftDirty()` จะเป็นจริงตลอดและบล็อกทุกคำสั่ง
6. **อย่าเดาแทนคน** — ทุกครั้งที่ข้อมูลกำกวม ให้ปฏิเสธพร้อมเหตุผลที่ตามต่อได้ ดีกว่าเดาแล้วได้ต้นทุนผิดแบบมองไม่ออก
