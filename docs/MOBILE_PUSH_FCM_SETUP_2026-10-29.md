# ตั้งค่าแจ้งเตือนมือถือแบบ FCM (ไม่มีค่าใช้จ่าย) — 29 ต.ค. 2026

FCM และแพ็กเกจ Firebase Spark ไม่มีค่าใช้จ่ายสำหรับงานนี้ (ไม่ใช้ Cloud Functions/ที่เก็บข้อมูล) งานที่ผู้ช่วยทำเองไม่ได้คือสร้างโปรเจกต์ในบัญชี Google ของคุณ ผู้ช่วยจึงเตรียมโค้ดครบแล้ว เหลือ **2 ไฟล์ที่คุณสร้าง**

## สิ่งที่เตรียมไว้แล้ว (ทดสอบด้วย FCM/OAuth จำลอง ไม่ใช่ Google จริง)
- **ฝั่งแอป** (`mobile-preview/android-app`): ถ้ามี `app/google-services.json` จะเปิด FCM อัตโนมัติ ลงทะเบียน token หลังล็อกอิน ถอน token ตอนออกจากระบบ และหยุด polling; ถ้าไม่มีไฟล์ จะใช้ polling เหมือนเดิม
- **ฝั่งเซิร์ฟเวอร์** (branch `codex/mobile-push-20261029` ของ formula-runtime ยังไม่ merge/deploy):
  - `POST /__formula/push-register`, `/__formula/push-unregister` ผูก token กับผู้ใช้ที่ล็อกอิน (ตรวจสิทธิ์ IAM `FORMULA_VIEW`) เก็บในไฟล์ `FORMULA_PUSH_DIR` (สิทธิ์ 600) **ไม่แตะตาราง `fs_*`**
  - `scripts/push-notifier.mjs` อ่านข้อความใหม่จากฐาน ส่งหาอุปกรณ์ของผู้ที่เห็นงานนั้นได้ (Sales/Oversea เห็นเฉพาะงานตน) ยกเว้นผู้เขียน ข้อความเป็นแบบทั่วไป **ไม่มีรหัสงาน ชื่อลูกค้า หรือเนื้อหาแชต** ไม่ส่งซ้ำ ลบ token ที่ตายแล้ว
  - `scripts/run-push-notifier.sh` + `runtime/com.beyond.formula-push.plist` (ยังไม่ติดตั้ง)
- **ทดสอบแล้ว:** `tests/push-devices.test.mjs`, `tests/push-notifier.test.mjs` (ตรวจลายเซ็น JWT RS256 จริง, ขอบเขตผู้รับ, ไม่ส่งซ้ำ, token ตาย, ข้อความทั่วไป), e2e กับ proxy จริงบนฐานสังเคราะห์ (ลงทะเบียน/ถอน/ปฏิเสธผู้อื่น), คอมไพล์ Java ของรุ่น FCM กับ Firebase API จริง

## ที่คุณต้องทำ
1. เข้า https://console.firebase.google.com → สร้างโปรเจกต์ (แพ็กเกจ Spark ฟรี) → เพิ่มแอป Android ชื่อแพ็กเกจ `org.example.formulastudio.preview` (หรือชื่อที่จะใช้จริง) → ดาวน์โหลด **`google-services.json`** วางที่ `mobile-preview/android-app/app/` (ไฟล์นี้ถูก gitignore แล้ว)
2. Project settings → Service accounts → **Generate new private key** (ไฟล์ JSON) วางที่เครื่อง runtime ตำแหน่ง `~/.hermes/apps/formula-studio/secrets/fcm-service-account.json` แล้วสั่ง `chmod 600` — **ห้ามส่งไฟล์นี้ให้ผู้ช่วย ห้ามเข้า git/แชต/log** (ตัวส่งปฏิเสธไฟล์ที่สิทธิ์เปิดกว้าง)

## ขั้นถัดไปที่ผู้ช่วยทำให้ได้หลังคุณวางไฟล์ในข้อ 1
- บิลด์ APK รุ่น FCM (**ข้อจำกัดที่ต้องแก้ก่อน:** บนเครื่องนี้ขั้น `mergeDebugJavaResource` ของ AGP ล้มด้วย `VerifyException` เมื่อมี dependency ของ Firebase แม้ Java คอมไพล์ผ่าน; ลอง AGP 8.7.3/8.8.2, Gradle 8.10.2/9.7, packaging excludes แล้วไม่หาย ต้องสืบต่อ เช่น ใช้ JDK/AGP ชุดอื่น จึงยังไม่ได้พิสูจน์ว่า APK รุ่น FCM ติดตั้งและรับ push ได้จริง)
- merge branch ฝั่ง runtime + deploy (ผ่านด่านเทสต์เดิม ซึ่งตอนนี้ยังล้มตามโหลดเครื่อง) + mount `${FORMULA_STATE_ROOT}/push/formula` (compose แก้ไว้แล้ว) + ติดตั้ง launchd ของตัวส่ง
- ทดสอบจริงบนเครื่อง Android ที่มี Google Play services

## ความเสี่ยงที่ต้องรู้
ข้อความแจ้งเตือนผ่านเซิร์ฟเวอร์ของ Google (เนื้อหาเป็นข้อความทั่วไป) · ไฟล์บัญชีบริการเป็นความลับระดับเซิร์ฟเวอร์ · การส่งไม่การันตีถึงทุกครั้ง (ขึ้นกับ OS/แบตเตอรี่/สิทธิ์แจ้งเตือน) · ตัวส่งไม่ตรวจ IAM ซ้ำทุกข้อความ (ตรวจตอนลงทะเบียน + ตามบทบาทจาก `fs_users`)
