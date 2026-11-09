# ผลเตรียมตรวจสิทธิ์ แจ้งเตือน และ APK บน A001T

วันที่ 28 ต.ค. 2026 · สถานะ: ดำเนินการบางส่วน · ไม่มีการเชื่อมฐานข้อมูลจริง

## การตรวจสาเหตุแจ้งเตือน

หลักฐานเดิม: บริการตอบรับคำขอแต่ origin ทดสอบ 8799 แสดงไม่ครบ ขณะที่ origin ใหม่แสดงครบ; ยังไม่มีหลักฐานที่แยกการรับ push การทำงานของ service worker และการแสดงผลของ OS จึงยังสรุปสาเหตุไม่ได้ เตรียมชุดวินิจฉัยชั่วคราวที่ตรวจรุ่น worker และบันทึกเฉพาะชนิดเหตุการณ์/ผลแสดงข้อความ ไม่เก็บ token หรือ payload ใน log แต่ยังไม่ได้ใช้บน A001T เพราะอุปกรณ์หลุด USB; หยุดบริการและลบกุญแจทดสอบแล้ว

## การยืนยันตัวตนและสิทธิ์

`node mobile-preview/simulation/auth-http.test.cjs` เปิด HTTP เฉพาะ loopback ใช้บัญชีจำลอง ตรวจรหัสผ่านและลายเซ็น session จริง โดยกำหนดบทบาทจากผู้ใช้ในบริการ ไม่รับ actor ที่ผู้เรียกส่งมา จากนั้นเรียกคิวจำลอง การทดสอบผ่าน: รหัสผิด, ไม่ส่ง token, token ถูกแก้, ปลอม actor, งานนอกสิทธิ์, อุปกรณ์/บัญชีระงับ, logout, คำขอซ้ำและเริ่มบริการใหม่ รวมถึงบัญชีที่ถูกระงับยังถูกปฏิเสธหลัง restart

นี่คือบริการจำลองที่สร้างขึ้นสำหรับการทดสอบ ไม่ใช่ Supabase Auth/JWT, ไม่ใช่บัญชีจริง และไม่ควรใช้ใน production; `tests/run-sql-tests.sh` ผ่านการตรวจ RLS บน PostgreSQL ทดสอบที่ตั้งค่า identity จำลองโดยตรง แต่ทั้งสองชุดยังไม่พิสูจน์การเชื่อม Auth จริงกับ PostgreSQL RLS ผ่าน Data API

ระหว่างตรวจพบและแก้ defect ในบริการจำลอง: บัญชีที่ถูกระงับกลับมา active หลังเริ่มใหม่; บันทึกใน `docs/DEBUG_LOG.md` และมี regression test

## APK ทดสอบออฟไลน์

ไฟล์ `mobile-preview/android-test/app/build/outputs/apk/debug/app-debug.apk`, package `org.example.formulastudiotest`, version `0.1-test`, SHA-256 `c96cfcecfaf9327c6f3e1508a69a66a2e8ca97147d477afa668291a318dfa750` สร้างผ่าน Gradle `assembleDebug`; ตรวจลายเซ็น debug และ manifest พบเฉพาะสิทธิ์ `POST_NOTIFICATIONS`, ไม่มี `INTERNET`, ไม่ backup ข้อมูล

APK เป็นเครื่องมือทดสอบแจ้งเตือนภายในเครื่องโดยตั้งเวลา ไม่ใช่ Formula Studio, ไม่ใช่ FCM/Web Push, ไม่ทดสอบสถานการณ์แอปถูกบังคับหยุด, ไม่ใช่ release APK และไม่พร้อมเผยแพร่ Android อาจแสดงหลังเวลาที่ตั้งได้ ผู้ใช้ต้องอนุญาตแจ้งเตือน

ชุดสร้าง: JDK 17, Gradle 8.10.2, Android build tools ใน `/tmp/formula-android-sdk`; Gradle ดาวน์โหลดส่วนประกอบที่ขาดจากแหล่ง dependency ตาม build configuration ไม่ได้เพิ่มลงระบบจริง; Node SQLite สำหรับ fixture ถูกระบุว่า experimental

ยังไม่ได้ติดตั้ง APK หรือทดสอบบน A001T: `adb devices` และข้อมูล USB ไม่พบ A001T ขณะตรวจ แม้ก่อนหน้านี้เคยพบ; มี emulator อีกตัวแต่ไม่ได้ใช้งานเพราะไม่ได้ยืนยันว่าเป็นพื้นที่ทดสอบงานนี้

## งานค้างและด่านถัดไป

1. เชื่อม A001T และขอให้ผู้ใช้เปิดรับการแจ้งเตือนของ APK ก่อนทดสอบ; แยกปัดออกจาก recent กับ force-stop และบันทึกผลจริง
2. ทำซ้ำปัญหา Web Push พร้อมวัดการรับที่ worker และแสดงที่ OS ด้วยข้อมูลจำลอง ไม่สรุปสาเหตุจาก provider acceptance อย่างเดียว
3. จัดหา staging ที่อนุญาตสำหรับทดสอบ Supabase Auth + Data API/RLS แบบ end-to-end ด้วยผู้ใช้จำลอง และทดสอบเพิกถอนสิทธิ์ การส่งซ้ำ การกู้สถานะและ authorization ฝั่ง server
4. ตรวจ workflow เดิมที่ยังขาด, review/UAT และ approval ตาม governance ก่อนเสนอเชื่อม production

ผลกระทบ: ไม่มีการแก้ฐานข้อมูล สิทธิ์ secrets หรือ runtime จริง; source สำหรับการทดสอบและรายงานอยู่ใน workspace; ไม่มี PR, UAT หรือ deployment
