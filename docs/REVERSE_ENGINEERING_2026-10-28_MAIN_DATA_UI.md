# Formula Studio — ตรวจต้นฉบับการรับส่งข้อมูลและหน้าจอ

สถานะ: วิเคราะห์แบบอ่านอย่างเดียว; เก็บงานแก้ร่างใน formula-runtime แยกไว้และยังไม่เสร็จ ยังไม่มีการเปลี่ยน source/runtime หรือข้อมูลจริงจากการวิเคราะห์นี้

## ขอบเขตและตัวตน

System Owner ระบุให้ตรวจ `main` ของ `piyawatv-cloud/Beyond-formula` ก่อน ณ วันที่ 28 ตุลาคม 2569 `git ls-remote` แสดง commit `010312e5bdeb851a67926ddd041e88dc18ddf47f` วันที่ 21 สิงหาคม 2569. ไฟล์ index SHA-256 `9d9fe2155c6b8df70335b2705c2e6e71f69d45c4d2745eda134ebc9f86323090`. ตรวจจาก git object ที่ตรง remote โดยไม่ใช้ index ใน working tree ซึ่งอยู่คนละ branch และมีงานที่ยังไม่ commit.

รุ่น production ที่ตรวจ metadata ก่อนหน้าใช้ sealed page `cf7ab7813cbe` จาก source commit `cfa964b909cdafbce6c2ab6465a04a2cf8949725`, hash `cf7ab7813cbe867d9d691f5f97aa2b60e8a9134aa4decc6d4c18575a2e118c64`. `010312e5` เป็นบรรพบุรุษ ไม่ใช่ byte เดียวกัน; production ยังประกอบ gateway และ assets เพิ่ม. ไม่ได้พิสูจน์ว่า main นี้เป็นรุ่นที่ผู้ใช้เคยใช้งานโดยไม่พบปัญหา หรือว่าไม่เคยมีข้อมูลหาย. เอกสารและ Git ระบุว่ามีกรณีข้อมูลเก่าทับและสูตร PD เด้งกลับที่เคยแก้มาก่อน ซึ่งไม่ได้ยืนยันสาเหตุ incident ปัจจุบัน.

## เส้นทางจากโค้ด

1. สร้างใบงาน: `generateDash` → `saveRecord` → `saveRecordsStore` เก็บ `fs_records` ใน localStorage แล้ว `sbQueue`; การสร้างห้องเป็นอีกเหตุการณ์ ไม่ได้ยืนยันพร้อมกัน. `openChatRoom` สร้างห้องในเครื่องเมื่อไม่พบในเครื่อง แล้ว `saveChats` ตั้งคิว. [สร้างใบงาน](https://github.com/piyawatv-cloud/Beyond-formula/blob/010312e5bdeb851a67926ddd041e88dc18ddf47f/index.html#L2601), [เปิดห้อง](https://github.com/piyawatv-cloud/Beyond-formula/blob/010312e5bdeb851a67926ddd041e88dc18ddf47f/index.html#L5483).
2. แก้สูตร: Chat `chatIngEdit` และ PD `editIng` บันทึกหลังเปลี่ยนช่อง, นอกเหนือจากปุ่ม Save; Chat สร้างข้อความระบบและ Activity, PD อัปเดต record กับ dashboard. `fxSaved` แจ้งสถานะก่อนมี readback จากระบบกลาง. [Chat](https://github.com/piyawatv-cloud/Beyond-formula/blob/010312e5bdeb851a67926ddd041e88dc18ddf47f/index.html#L5943), [PD](https://github.com/piyawatv-cloud/Beyond-formula/blob/010312e5bdeb851a67926ddd041e88dc18ddf47f/index.html#L4194).
3. ส่ง: `sbPush` คัดแถวต่างจาก `sbSnap` แล้วส่ง records → messages → approvals → chats → users → activities ผ่านหลาย HTTP requests. `sbUpsert` ใช้ merge-duplicates + return-minimal จึงไม่ใช่ transaction เดียวและไม่อ่านข้อมูลกลับมาเทียบ exact ก่อนถือว่าคำขอนั้นสำเร็จ. [ส่งข้อมูล](https://github.com/piyawatv-cloud/Beyond-formula/blob/010312e5bdeb851a67926ddd041e88dc18ddf47f/index.html#L7569).
4. ดึง: `sbPull` แบ่งหน้า, watermark และ `sbApplyFull/Delta` รักษา record ที่ระบุ dirty และรวมข้อความ. `recDirty` พึ่ง `sbSnap` ใน memory; หลังเปิดหน้าใหม่ที่ยังไม่มี baseline ไม่ถือ local record ว่า dirty. ประวัติ `fs_recbak` เก็บใน browser มีขนาดจำกัด ไม่ใช่สำรองกลาง. [ดึงและรวม](https://github.com/piyawatv-cloud/Beyond-formula/blob/010312e5bdeb851a67926ddd041e88dc18ddf47f/index.html#L7244), [dirty](https://github.com/piyawatv-cloud/Beyond-formula/blob/010312e5bdeb851a67926ddd041e88dc18ddf47f/index.html#L7354).
5. Chat send เคลียร์ช่องและเก็บข้อความใน browser ก่อนคิวส่ง. localStorage errors ถูก catch เงียบใน saveRecordsStore/saveChats; จึงไม่มีหลักฐานจาก UI ว่าเก็บในเครื่องได้สำเร็จทุกครั้ง. [ส่งข้อความ](https://github.com/piyawatv-cloud/Beyond-formula/blob/010312e5bdeb851a67926ddd041e88dc18ddf47f/index.html#L6151).
6. `sbQueue` หน่วงรวบคำขอ 150 ms; รอบดึงช่วง active/idle/sleep 3/10/30 วินาที และ full pull ทุก 60 วินาที. 150 ms ไม่รวม network, server, queue และ verification จึงไม่ใช่เวลายืนยันภายใน 0.5 วินาที. [ค่าจังหวะ](https://github.com/piyawatv-cloud/Beyond-formula/blob/010312e5bdeb851a67926ddd041e88dc18ddf47f/index.html#L1243).
7. ต้นฉบับมี 4 Pass; role MKT ใน main ได้สิทธิ์ PD และ Sales ซึ่งกว้างกว่าที่คุยไว้ว่าให้บัญชีที่ระบุกดแทน PD จึงห้ามนำ rule นี้ไปปรับ production โดยอัตโนมัติ. [role](https://github.com/piyawatv-cloud/Beyond-formula/blob/010312e5bdeb851a67926ddd041e88dc18ddf47f/index.html#L2868).

## หลักฐานทดสอบจำลอง

รันฟังก์ชันต้นฉบับจาก git object ใน Node VM กับข้อมูล synthetic และ localStorage ที่จำลองให้ setItem throw: `saveRecordsStore` ไม่ส่ง exception กลับและยังเรียก sbQueue. ไม่เปิด browser จริง ไม่มี network หรือข้อมูล production.

รัน `sbUpsert` ต้นฉบับกับ sbReq จำลอง: ได้ POST หนึ่งคำขอ `resolution=merge-duplicates,return=minimal` และไม่มี GET อ่านกลับในฟังก์ชันนั้น. เป็นหลักฐานระดับฟังก์ชัน ไม่ใช่ network trace หรือหลักฐานของ production.

## ความหมายต่อการแก้ที่พักไว้

รักษาประสบการณ์ใช้งานที่เข้าใจง่ายได้ แต่ไม่ควรย้อนกลับทั้งระบบเพื่อหวังความเสถียร: ต้นฉบับยังมีจุดที่ยืนยันข้อมูลไม่ครบและความปลอดภัย/สิทธิ์/รหัสงานต่างจาก runtime. นำหลักการใช้ local draft, รักษาข้อความเมื่อ redraw, แยกห้องและข้อความ, และรัน sync ต่อเมื่อมี baseline ไปพิจารณาร่วมกับการยืนยันต่อรายการ, การจัดการ conflict/การกู้, การป้องกัน user/แท็บชนกัน และการรองรับ offline/รุ่นเก่า. ข้อเสนอ schema/protocol ที่ยังไม่ได้อนุมัติยังต้องผ่านข้อกำหนดใน `formula-runtime/AGENTS.md`, independent review, full suite, backup/rollback และ UAT ก่อน production.

ข้อมูลที่ยังไม่รู้: รุ่นจริงที่ user เคยใช้งานดี, สาเหตุเฉพาะของ A04480, สถานะทุกเครื่อง/คิวรุ่นเก่า, behavior ภายใต้โหลดจริง, และเวลาได้รับ central ACK ใน production. ไม่ได้ทดสอบ end-to-end หรือแก้ production ในการวิเคราะห์นี้.
