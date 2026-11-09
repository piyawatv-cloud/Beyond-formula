# กู้ฉุกเฉิน — Formula Studio runtime

เอกสารนี้เขียนไว้ให้อ่านตอนที่ระบบใช้งานไม่ได้และมีคนรออยู่ ไม่ใช่ตอนว่าง
ลำดับที่เขียนไว้คือลำดับที่ควรทำจริง — **อย่าข้ามไปข้อท้าย ๆ ก่อน** ข้อท้าย ๆ ถอยกลับยากที่สุด

ก่อนอื่น: **ตัวกู้อัตโนมัติทำงานทุก 5 นาทีอยู่แล้ว** (`com.beyond.formula-recover`)
ถ้าเพิ่งพังไม่ถึง 5 นาที รอดูก่อนหนึ่งรอบ · เปิดดูสิ่งที่มันทำไปแล้วที่
`~/.hermes/apps/formula-studio/monitoring/recover-<วันที่>.log`

---

## 0. ดูก่อนว่าพังตรงไหน (30 วินาที)

```sh
cd ~/formula-runtime
sh scripts/monitor-formula.sh
```

อ่านบรรทัดที่ขึ้น `WARN` — ทุกบรรทัดมีช่อง `why=` บอกว่าเจออะไร
แล้วเลือกหัวข้อข้างล่างตามสิ่งที่เจอ

| เจอ | ไปที่ |
|---|---|
| `docker=unreachable` | ข้อ 1 |
| `container=...` ตัวใดตัวหนึ่งไม่ running | ข้อ 2 |
| `postgres=` ติดต่อไม่ได้ | ข้อ 3 |
| `policy=` ไม่ครบ | ข้อ 4 |
| `public-access=unexpected` แต่ `proxy=3026/3027` ปกติ | ข้อ 5 |
| ข้อมูลหายหรือถูกลบผิด | ข้อ 6 |
| ทุกอย่างพังหมด และต้องให้คนทำงานได้เดี๋ยวนี้ | ข้อ 7 |

---

## 1. docker ติดต่อไม่ได้

เกือบทุกครั้งคือ colima ถูกหยุด (เคยมีงานตามเวลาของระบบอื่นสั่งหยุดตอนตี 1
แล้วทั้งระบบล่มไป 7 ชั่วโมง)

```sh
cd / && colima status
cd / && colima restart          # ต้องอยู่นอกโฟลเดอร์โปรเจกต์ตอนสั่ง
```

รอจน `docker info` ตอบได้ แล้วปล่อยให้ตัวกู้อัตโนมัติสตาร์ตคอนเทนเนอร์ให้เอง
หรือเร่งด้วย `sh scripts/recover-formula.sh`

---

## 2. คอนเทนเนอร์ไม่ขึ้น

```sh
sh scripts/recover-formula.sh          # start/restart ของที่มีอยู่ ไม่สร้างใหม่
```

ถ้ามันบอกว่า `cannot-fix why=ไม่มีคอนเทนเนอร์นี้อยู่เลย` แปลว่าคอนเทนเนอร์หายไปจริง
ต้องยกขึ้นใหม่ ซึ่งเป็นงานของ blue-green ไม่ใช่ของตัวกู้:

```sh
sh scripts/blue-green-formula.sh bootstrap
```

**ระวังสองข้อ**

1. `bootstrap` สร้างคอนเทนเนอร์ที่ยังไม่มี ซึ่งจะอ่าน `runtime/formula-proxy.mjs`
   และไฟล์ใน `runtime/assets/` จากดิสก์ ณ วินาทีนั้น · ถ้ามีใครกำลังแก้ไฟล์พวกนั้นค้างอยู่
   สิ่งที่ขึ้นระบบคือฉบับที่แก้ค้าง — เช็ค `git status` ก่อนเสมอ

2. `bootstrap` ใช้ `compose up -d` เฉย ๆ **ไม่มี `--force-recreate`**
   คอนเทนเนอร์ที่ "ขึ้นอยู่แล้ว" จึงไม่ถูกสร้างใหม่ และยังเสิร์ฟไฟล์ฉบับเก่าต่อไปเงียบ ๆ
   ถึงจะแก้ไฟล์บนดิสก์ไปแล้วก็ตาม (เจอจริง 24 ส.ค. บน testlab)
   **ถ้าต้องการให้คอนเทนเนอร์หยิบไฟล์ใหม่ ต้องใช้ `prepare <สี>` ไม่ใช่ `bootstrap`**
   ด่าน `verify-formula-parity.sh` ข้อ "เสิร์ฟตรงกับไฟล์บนดิสก์" จับเรื่องนี้ได้
   — รันมันหลัง `bootstrap` เสมอ

ถ้าสีใดสีหนึ่งขึ้นไม่ได้ แต่อีกสีปกติ — ปล่อยสีที่ดีให้บริการต่อไปก่อน อย่าฝืนซ่อมทั้งคู่พร้อมกัน

---

## 3. ชั้นข้อมูลไม่ขึ้น (PostgreSQL / PostgREST)

```sh
sh scripts/healthcheck-data.sh
docker start formula-postgres formula-postgrest
```

**ห้ามลบ volume `formula_pgdata` ไม่ว่ากรณีใด** ข้อมูลทั้งระบบอยู่ในนั้น
ถ้า PostgreSQL ขึ้นไม่ได้เพราะดิสก์เต็ม ให้ไปหาที่ว่างจากที่อื่น ไม่ใช่จากข้อมูลของแอป

PostgREST ขึ้นแต่ตอบ error แปลก ๆ — ลองสั่งอ่านสคีมาใหม่ก่อนรีสตาร์ต:

```sh
docker exec -i formula-postgres psql -U postgres -d formula -c "notify pgrst, 'reload schema';"
```

---

## 4. นโยบายในฐานไม่ครบ

อาการ: `verify-data-policy.sh` ขึ้นว่ามีข้อไม่ผ่าน
สาเหตุที่พบบ่อยที่สุดคือมีใครรัน `runtime/data-grants.sql` โดยไม่ได้รัน
`runtime/data-policy.sql` ต่อ ซึ่งคืนสิทธิ์ `TRUNCATE` ให้ `anon` และทิ้ง trigger เก็บสำเนา

แก้ด้วยการรันไฟล์นโยบายทับ (รันซ้ำได้ ไม่ลบข้อมูล):

```sh
docker cp runtime/data-policy.sql formula-postgres:/tmp/data-policy.sql
docker exec -i formula-postgres psql -v ON_ERROR_STOP=1 -U postgres -d formula -f /tmp/data-policy.sql
sh scripts/verify-data-policy.sh
```

ถ้าขึ้นว่าประตูเปลี่ยนบทบาทตอบ 404 — นั่นคือแคชสคีมาของ PostgREST ค้าง
ไฟล์นโยบายจบด้วย `notify pgrst, 'reload schema';` อยู่แล้ว ถ้ายังไม่หายให้รีสตาร์ต
`formula-postgrest`

**ช่วงที่นโยบายไม่ครบ ให้ถือว่าข้อมูลมีความเสี่ยง** — สิ่งที่ถูกลบระหว่างนั้นอาจไม่มีสำเนา

---

## 5. public access ผิดปกติ แต่ในเครื่องปกติ

`public-access=expected-access-redirect http=302` คือพฤติกรรมปกติของ Cloudflare Access
เมื่อเรียกโดเมนโดยไม่มี session จึงไม่ต้องตรวจหรือรีสตาร์ต cloudflared จากบรรทัดนี้

ให้ทำตามหัวข้อนี้เฉพาะเมื่อ monitor ขึ้น `public-access=unexpected ... why=...` และ internal
edge `http://127.0.0.1:3025/` ตอบปกติเท่านั้น: จึงมีหลักฐานว่าปัญหาอยู่ที่อุโมงค์หรือ Access
ไม่ใช่ที่แอป

```sh
launchctl list | grep -i cloudflare
# ดู hostname ของเราใน ~/.cloudflared/config.yml
#   formula.beyond-workflow.com     → 127.0.0.1:3025
```

อุโมงค์นี้ใช้ร่วมกับ OPC Workflow — **การรีสตาร์ต cloudflared กระทบ OPC ด้วย**
ถ้า OPC ยังเข้าได้ปกติ แปลว่าอุโมงค์ยังดี ปัญหาอยู่ที่บรรทัดของเราหรือที่ฝั่ง Cloudflare
ตรวจ Access configuration และ authenticated browser ก่อนการรีสตาร์ตเสมอ

---

## 6. ข้อมูลหาย หรือถูกลบผิด

**อย่าเพิ่งกู้จากไฟล์สำรอง** ลองที่ถูกที่สุดก่อน — ของที่ถูกลบผ่านแอปมีสำเนาอยู่แล้ว

```sh
docker exec -i formula-postgres psql -U postgres -d formula -c \
  "select archived_at, source, row_key from fs_archive order by archived_at desc limit 20;"
```

เอากลับเข้าตารางเดิม (ตัวอย่างของ `fs_records`):

```sh
docker exec -i formula-postgres psql -v ON_ERROR_STOP=1 -U postgres -d formula <<'SQL'
begin;
  insert into fs_records (id, data)
  select data ->> 'id', data -> 'data'
    from fs_archive
   where source = 'fs_records' and row_key = 'A00123'
   order by archived_at desc limit 1
  on conflict (id) do nothing;
  select id from fs_records where id = 'A00123';
rollback;   -- ดูผลก่อน แล้วค่อยเปลี่ยนเป็น commit
SQL
```

**ให้รันด้วย `rollback;` ดูผลก่อนเสมอ แล้วค่อยเปลี่ยนเป็น `commit;`**

ถ้าของที่หายไม่ได้อยู่ใน `fs_archive` (เช่นถูกลบตอนที่นโยบายไม่ครบ ตามข้อ 4)
ให้กู้จากไฟล์สำรอง — **กู้ลงฐานทดสอบก่อน อย่ากู้ทับฐานจริง**

```sh
ls -1t ~/.hermes/apps/formula-studio/backups/*/*/ | head
sh scripts/verify-restore-formula.sh          # กู้ลงฐานชั่วคราวแล้วนับแถวเทียบ
```

แล้วดึงเฉพาะแถวที่ต้องการออกมาใส่กลับ ไม่ใช่กู้ทั้งฐานทับของที่ยังใช้งานอยู่ —
การกู้ทับทั้งฐานจะลบทุกอย่างที่เกิดขึ้นหลังเวลาที่สำรองไว้

---

## 7. ทางถอยฉุกเฉิน — กลับไปใช้ของเดิมบน Vercel

**นี่คือข้อสุดท้ายจริง ๆ ใช้เมื่อ iMac เครื่องนี้ใช้การไม่ได้และซ่อมไม่ทัน**

`beyond-formula.vercel.app` ยังเปิดอยู่ และยังคุยกับ Supabase เดิมได้
(ตราบใดที่ยังไม่ได้ทำ `docs/handoff/RUNBOOK-เพิกถอน-supabase.md` — ตรวจก่อนว่ายังไม่ได้ทำ)

**สิ่งที่ต้องบอกทุกคนก่อนสั่งให้ย้ายไป:**

- **ข้อมูลที่นั่นหยุดอยู่ที่ 22 ส.ค. 2569 09:28** งานทุกใบที่ทำหลังจากนั้นจะไม่อยู่ที่นั่น
- งานที่ทำบนนั้นระหว่างช่วงฉุกเฉิน จะ **ไม่** ไหลกลับเข้าฐานในเครื่องเอง
  ต้องมีคนย้ายด้วยมือทีหลัง และต้องระวังเลขงานชนกัน
- ประวัติเวอร์ชันของงาน (`fs_recbak`) อยู่ใน localStorage ของโดเมนไหน ก็อยู่โดเมนนั้น
  ย้ายโดเมนแล้วมองไม่เห็นของอีกฝั่ง
- คีย์ของ Supabase ฝังอยู่ในไฟล์ที่แจกออกไปแล้ว ใครก็อ่านเขียนข้อมูลชุดนั้นได้ทั้งหมด

เพราะข้อสุดท้ายนี้ **ให้ถือว่าช่วงที่ใช้ Vercel คือช่วงที่ข้อมูลไม่มีด่านอะไรกันเลย**
ใช้ให้สั้นที่สุดเท่าที่จะสั้นได้ แล้วรีบกลับมาที่ระบบนี้

พอ iMac กลับมา: ยกสแตกขึ้นตามข้อ 2 → ตรวจ `verify-data-policy.sh` → แล้วค่อยประกาศให้ย้ายกลับ

---

## สิ่งที่ห้ามทำ ไม่ว่าจะรีบแค่ไหน

- **ห้ามลบข้อมูลเพื่อเรียกคืนพื้นที่** — ตาราง `fs_*`, volume `formula_pgdata`,
  WAL, ไฟล์สำรอง · ห้ามทุกกรณี
- **ห้าม `docker system prune --volumes`** หรือคำสั่งล้างแบบกวาดทั้งระบบ
- **ห้าม `drop table fs_archive`** ในนั้นคือสำเนาของสิ่งที่ถูกลบไปแล้ว ไม่มีที่อื่นเก็บอีก
- **ห้ามผ่อนด่านเพื่อให้ deploy ผ่าน** — ถ้าด่านไม่ผ่าน แปลว่ามันเจออะไรจริง ๆ
- **ห้ามสลับไปสีที่เก่ากว่าโดยไม่ตรวจ** — `rollback` มีด่านของมันเองซึ่งหลวมกว่าขาไป
  โดยตั้งใจ ใช้คำสั่งนั้น อย่าไปแก้ไฟล์ `active` ด้วยมือ
- **ห้ามกู้ไฟล์สำรองทับฐานจริงตรง ๆ** — กู้ลงฐานทดสอบ แล้วดึงเฉพาะแถวที่ต้องการ

---

## เบอร์ที่ต้องรู้

| อะไร | ที่ไหน |
|---|---|
| กฎประจำระบบ | `docs/FORMULA-RUNTIME-RULES.md` |
| สถานะสองสี | `sh scripts/blue-green-formula.sh status` |
| บันทึกของประตูข้อมูล | `~/.hermes/apps/formula-studio/monitoring/gateway-<วัน>.ndjson` |
| บันทึกตัวเฝ้า/ตัวกู้ | `.../monitoring/monitor-<วัน>.log` · `recover-<วัน>.log` |
| เสียงเตือนที่ส่งถึงคน | `.../monitoring/alerts.log` |
| ประวัติการสลับสี | `.../runtime-state/formula/switches.ndjson` |
| หลักฐานการปล่อยของ | `.../releases/` |
| ไฟล์สำรอง | `.../backups/{daily,manual,predeploy}/` |
