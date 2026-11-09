# ตรวจรุ่น Formula Runtime และผลต่อ PR มือถือ #16

วันที่ตรวจ 2026-11-01 18:39 น. เวลาไทย · สถานะ **PASS WITH CONDITIONS** เฉพาะการระบุรุ่น; สิทธิ์อ่านจริงรายบุคคลและการควบคุมขอบเขตสถานะอนุมัติยังไม่ยืนยัน

ขอบเขต: อ่าน metadata ของบริการที่กำลังทำงาน, ไฟล์กำกับ artifact และ source, ประวัติ Git ในเครื่องและ GitHub; ไม่อ่านข้อมูลธุรกิจ ไม่แก้ระบบ ฐานข้อมูล IAM หรือการ deploy

## รุ่นที่ทำงาน

- `http://127.0.0.1:3025/__formula/health` รายงาน `status=ok`, `color=blue`, `codeCommit=50126b93e2781eec505151450f59651f2fad93da`, `release=cf7ab7813cbe`, `artifactId=f1d18c68cd35b3137485c6c5f9a48b922084d144e6f93e09bae584cc6090eccc`, `proxySourceSha=28989da6bd607164dca6be84b3256c58f63d408ac5967a083a320198f49f1493`, `iamEnforced=true`.
- `docker inspect` แสดง blue และ green ติดตั้ง artifact `f1d18c…` แบบอ่านอย่างเดียวและ healthy; `artifact.json` ระบุ commit และ release ตรงกับ health; SHA-256 ของ proxy ภายใน artifact ตรงกับไฟล์ proxy ใน commit `50126b9`. Health ณ เวลาตรวจระบุ blue เป็นตัวรับคำขอ ไม่ใช่การตรวจตลอดเวลา
- Git ในเครื่องยืนยันว่า `a11f0a900d822700db7ea9443ea0f91c277ef6d0` และ `f0a5adea819d6c6eef50b4f9443c5fa3b43e77c4` เป็นบรรพบุรุษของ `50126b93e2781eec505151450f59651f2fad93da`; branch `codex/mkt-pd-oversea-sales-20261028` ในเครื่องชี้ไป `f0a5ade`. จึงยืนยันว่าชุด runtime ที่รายงานว่ากำลังทำงานรวม commit ทั้งสอง ไม่ใช่ข้อสรุปว่าสิทธิ์รายบัญชีหรือ SQL จริงถูกต้อง
- GitHub `main` ตรวจได้ `91d5fde5a17abf70d9ac5764b6b31529d69f913c`; เป็นบรรพบุรุษของ `50126b9` และ local graph แสดง 14 commits เพิ่มจาก main. GitHub API ไม่พบ `a11f0a9`, `f0a5ade` หรือ `50126b9` ใน repository ที่ตรวจ และไม่พบ PR ที่มีชื่อ branch ที่ระบุจากรายการ PR ที่เข้าถึงได้ ข้อมูลนี้ไม่ใช่หลักฐานว่าได้ผ่าน review, PR, หรือ release gate
- บันทึก `docs/MOBILE_APK_REVIEW_2026-10-29.md` อ้างว่า deploy `f0a5ade` และภายหลัง `50126b9`; หลักฐานจาก artifact/health ยืนยันรุ่นที่กำลังรัน ไม่ยืนยันกระบวนการอนุมัติหรือทุกขั้นตอนในบันทึก

## อ่านสถานะอนุมัติและข้อจำกัด

- Source proxy ที่กำลังรันมีกฎสำหรับ **เขียนอนุมัติ**: MKT อนุมัติ PD และ Sales; Oversea อนุมัติ Sales และมีการตรวจความเป็นเจ้าของงานสำหรับ Oversea/Sales กติกาใน source SQL ของ `50126b9` สอดคล้องในส่วนชื่อบทบาท แต่ไม่ได้ตรวจ SQL ที่ติดตั้งอยู่ในฐานข้อมูลจริง การอนุมัติยังต้องผ่านสิทธิ์ IAM รายบัญชีและเงื่อนไขอื่น
- การอ่าน `fs_approvals` เป็น GET ที่ตรวจ session และ `FORMULA_VIEW` ที่ gateway ไม่ใช้กฎ `rolePartAllowed` สำหรับเขียนอนุมัติเป็นตัวตัดสินการอ่าน ใน source ไม่มีข้อห้ามอ่านเฉพาะ MKT/Oversea แต่ยังไม่ยืนยันผลของ IAM รายบัญชีหรือการตั้งค่าฐานข้อมูลปลายทางด้วยบัญชีจริง จึงตอบได้ว่า **ตาม code มีเส้นทางอ่านเมื่อผ่านสิทธิ์ ไม่ใช่ยืนยันว่าบัญชีจริงทุกคนอ่านได้**
- **HIGH / ต้องตรวจเพิ่ม:** GET `fs_records`, `fs_chats`, `fs_messages` ถูกส่งเข้า `handleScopedRead` ซึ่งกรองงานตามเจ้าของสำหรับ Sales/Oversea แต่ GET `fs_approvals` ไม่อยู่ในรายการเส้นทางดังกล่าว และหลังตรวจ `FORMULA_VIEW` ใช้เส้นทางส่งต่อทั่วไป ยังไม่ได้ทดสอบว่า policy ที่ปลายทางบังคับขอบเขตได้หรือไม่ จึงห้ามถือว่าการกรอง ID ในแอปเป็นหลักประกันการแยกข้อมูลฝั่งบริการ ควรให้ผู้รับผิดชอบ security ตรวจด้วยข้อมูลและบัญชีจำลองในพื้นที่อนุญาตก่อนรับรอง PR #16
- PR #16 (`phossatron/Beyond-formula`, head `ab5b8a95a4e841c1474612ed49bbbf9982d347e7`) อ่านงานก่อนแล้วขอ `fs_approvals` ตาม ID ที่ได้รับ และกรณี 403 ตั้งสถานะไม่ทราบผลแทนแสดงเป็นรออนุมัติ การจัดการฝั่งแอปไม่แทนการตรวจสิทธิ์ฝั่งบริการ

## ข้อเสนอและหลักฐานที่ยังขาด

System Owner ควรตรวจสอบ drift ระหว่าง GitHub main กับ artifact ที่รัน โดยผ่าน PR, independent/CODEOWNER review จาก `@phossatron` และ release workflow สำหรับ Critical Change ตามกฎปัจจุบัน ไม่ถือว่าการ deploy ที่พบแทนการอนุมัติ ไม่มีการเปลี่ยนแปลงหรือเสนอแก้ IAM/production ในการตรวจนี้ หลักฐานที่ยังขาด: PR/review ที่ผูก commit ที่ deploy, สถานะ SQL ในฐานจริง, การทดสอบบัญชี MKT/Oversea และขอบเขต `fs_approvals` แบบได้รับอนุญาต
