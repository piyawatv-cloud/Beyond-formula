/* สคริปต์ฝังเกาะอะไรในหน้าเว็บไว้บ้าง — และของพวกนั้นยังอยู่ไหม
 *
 * `runtime/assets/fs-session-bridge.js` ทำงานด้วยการทับฟังก์ชันของแอปและค้นหา
 * ข้อความ/คลาสในหน้าจอ · เราไม่ได้เป็นเจ้าของ `index.html` (กฎ 0.1) เจ้าของแอปจึง
 * เปลี่ยนชื่อฟังก์ชันหรือแก้คำเมื่อไหร่ก็ได้ โดยไม่มีใครบอกเรา
 *
 * ที่ต้องมีเทสต์นี้เพราะ **การแทรกสคริปต์ไม่มีด่านแบบที่การเปลี่ยนปลายทางข้อมูลมี**
 * ฝั่งนั้นถ้าจับข้อความไม่เจอ `x-fs-sb-gateway` เป็น `unchanged` แล้วสลับสีไม่ได้
 * ส่วนฝั่งนี้ ถ้าจับไม่เจอ มันจะข้ามไปเงียบ ๆ — ปุ่มที่ตั้งใจเอาออกกลับมา ข้อความที่
 * ตั้งใจแก้กลับเป็นของเดิม และทุกด่านยังเขียวหมด เพราะทุกด่านตรวจแค่ว่าไฟล์เสิร์ฟได้
 *
 * เทสต์นี้จึงเป็นด่านนั้น: อ่าน "จุดเกาะ" ออกมาจากสคริปต์จริง แล้วยืนยันกับ
 * **บันเดิลที่ผนึกไว้จริง** ว่าของพวกนั้นยังอยู่ (กฎ 6.3 — ห้ามเทียบสำเนากับสำเนา)
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

const bridge = () => read("runtime/assets/fs-session-bridge.js");
const bundle = async () => {
  const current = (await read("releases/CURRENT")).trim();
  return read(`releases/${current}/index.html`);
};

/* ฟังก์ชันของแอปที่สคริปต์ทับ
 *
 * ต้องประกาศด้วย `function` ระดับบนสุดเท่านั้น — ถ้าเจ้าของแอปเปลี่ยนไปใช้ `let`/`const`
 * การทับผ่าน `window.<ชื่อ>` จะไม่มีผลกับที่ `onclick=` ในหน้าเรียก และสคริปต์จะเงียบสนิท
 * ทั้งที่โค้ดถูกทุกบรรทัด (เคยเกิดกับตัวแปรของแอปนี้มาแล้ว)
 */
const OVERRIDDEN = [
  "resetUserPassword",
  "resetAllPasswords",
  "openChangePassword",
  "renderUserList",
  "renderLoginView",
  "doLogin",
  // เพิ่ม 24 ส.ค. เย็น — ทางที่ตั้ง currentUser เองโดยไม่ผ่าน OPC
  "loginUserAt",
  "askLoginPassword",
  "submitLoginPassword",
  "openImpersonate",
  "seedTeamUsers",
];

test("ฟังก์ชันที่สคริปต์ฝังทับ ต้องยังประกาศด้วย function ในบันเดิล", async () => {
  const [js, html] = await Promise.all([bridge(), bundle()]);
  for (const name of OVERRIDDEN) {
    assert.ok(
      js.includes(`window.${name} =`),
      `สคริปต์ไม่ได้ทับ ${name} แล้ว — ถ้าเลิกทับจริงให้เอาชื่อออกจากรายการนี้ด้วย`,
    );
    assert.ok(
      new RegExp(`function\\s+${name}\\s*\\(`).test(html),
      `บันเดิลไม่มี function ${name}() แล้ว — การทับผ่าน window จะไม่มีผล และสคริปต์จะเงียบสนิท`,
    );
  }
});

/* จุดเกาะในหน้าจอ — id, คลาส และข้อความที่สคริปต์ใช้ค้นหา
 *
 * ค่าพวกนี้เขียนไว้ในสคริปต์ตรง ๆ ถ้าต้นทางเปลี่ยนคำเมื่อไหร่ สคริปต์จะข้ามไปเงียบ ๆ
 */
const ANCHORS = [
  ["userListWrap", "กล่องรายชื่อผู้ใช้ที่สคริปต์เข้าไปลบปุ่มและเติมชื่อเต็ม"],
  ["userModal", "กล่องจัดการผู้ใช้"],
  ["sideChangePw", "เมนูเปลี่ยนรหัสผ่านที่สคริปต์ซ่อน"],
  ["loginBody", "กล่องฟอร์มล็อกอินที่สคริปต์บังคับให้แสดง"],
  ["lgUser", "ช่องกรอกชื่อผู้ใช้"],
  ["lgPass", "ช่องกรอกรหัสผ่าน"],
  ["user-row", "แถวของผู้ใช้แต่ละคน"],
  ["user-chip", "ปุ่มชื่อผู้ใช้"],
  ["modal-desc", "บรรทัดคำอธิบายในกล่อง"],
  ["login-hint", "บรรทัดคำใบ้ใต้ฟอร์มล็อกอิน"],
  ["123456", "รหัสผ่านตั้งต้นที่สคริปต์ใช้เป็นเครื่องหมายว่าเจอบรรทัดที่ต้องแก้"],
  ["ลืมรหัสผ่าน", "ข้อความในคำใบ้ที่สคริปต์เขียนทับ"],
  ["รีเซ็ตรหัส", "ข้อความในบรรทัดคำอธิบายที่สคริปต์เขียนทับ"],
];

test("จุดเกาะทุกจุดที่สคริปต์ฝังใช้ ต้องยังมีอยู่ในบันเดิลจริง", async () => {
  const [js, html] = await Promise.all([bridge(), bundle()]);
  for (const [anchor, why] of ANCHORS) {
    assert.ok(js.includes(anchor), `สคริปต์เลิกใช้จุดเกาะ "${anchor}" แล้ว — เอาออกจากรายการนี้ด้วย`);
    assert.ok(
      html.includes(anchor),
      `บันเดิลไม่มี "${anchor}" แล้ว (${why}) — สคริปต์จะข้ามส่วนนั้นไปเงียบ ๆ ไม่มีอะไรส่งเสียง`,
    );
  }
});

/* ข้อสำคัญที่สุดของไฟล์นี้
 *
 * สคริปต์ลบปุ่มด้วยการดูว่า onclick ของมันเรียกฟังก์ชันชื่อไหน ถ้าเจ้าของแอปเปลี่ยนวิธี
 * ผูกปุ่ม (เช่นย้ายไป addEventListener) ปุ่มจะยังอยู่ ยังกดได้ และยังขึ้นข้อความเดิม
 */
test("ปุ่มที่สคริปต์ตั้งใจลบ ต้องยังผูกด้วย onclick ในบันเดิล", async () => {
  const html = await bundle();
  for (const fn of ["resetUserPassword", "resetAllPasswords"]) {
    assert.ok(
      html.includes(`onclick="${fn}(`),
      `ปุ่ม ${fn} ไม่ได้ผูกด้วย onclick แล้ว — ตัวลบปุ่มของสคริปต์หาไม่เจอ ปุ่มจะกลับมาโผล่`,
    );
  }
});

/* กันไม่ให้ "แก้ข้อความ" กลายเป็นการพูดแทนเซิร์ฟเวอร์
 *
 * ถ้าวันหนึ่งมีคนครอบ loginUserAt/submitLoginPassword ได้ครบ ข้อความที่บอกว่า
 * "ไม่มีใครอ่านช่องรหัสผ่านแล้ว" ถึงจะเป็นความจริง · ตราบใดที่ยังครอบไม่ครบ
 * ข้อความแบบนั้นคือคำโกหกใหม่ที่มาแทนคำโกหกเก่า ซึ่งเป็นสิ่งที่ทั้งโปรเจกต์นี้ตั้งใจกำจัด
 */
test("ถ้ายังไม่ครอบทางที่ใช้รหัสผ่าน ห้ามพูดว่าไม่มีใครใช้รหัสผ่านแล้ว", async () => {
  const [js, html] = await Promise.all([bridge(), bundle()]);
  const appStillChecksPassword =
    html.includes("function submitLoginPassword") && html.includes("function loginUserAt");
  if (!appStillChecksPassword) return; // แอปเลิกใช้แล้วจริง ๆ พูดได้

  const bridgeCoversThem =
    js.includes("window.submitLoginPassword") && js.includes("window.loginUserAt");
  if (bridgeCoversThem) return; // ครอบครบแล้ว พูดได้

  assert.ok(
    !/ไม่ได้ตรวจรหัสผ่านเองแล้ว|ไม่มีใครอ่าน.{0,20}รหัสผ่าน/.test(js),
    "สคริปต์บอกผู้ใช้ว่าแอปไม่ตรวจรหัสผ่านแล้ว แต่ submitLoginPassword() ยังเทียบ pwHash "
      + "กับช่อง pass อยู่จริง และปุ่มชื่อผู้ใช้ยังเรียก loginUserAt() ได้ "
      + "— ให้ครอบสองฟังก์ชันนั้นก่อน หรือแก้ถ้อยคำให้ตรงกับสิ่งที่ระบบทำจริง",
  );
});
