/* นโยบายรายฟิลด์ของประตูข้อมูล — ยกบล็อกจริงออกมารัน
 *
 * ทำไมต้องยกออกมารัน ไม่ใช่ assert.match บนซอร์ส: เทสต์ที่ยืนยันว่า "มีข้อความนี้อยู่
 * ในไฟล์" ผ่านได้ทั้งที่กฎข้างในผิด — เคยเกิดมาแล้วในระบบพี่น้อง กติกาที่นี่จึงเป็น
 * กำหนดขอบเขตด้วยเครื่องหมายสองอัน แล้ว assert ว่าเครื่องหมายยังอยู่ ถ้าใครลบทิ้ง
 * เทสต์แดงทันที ไม่ใช่เขียวแบบเงียบ ๆ เพราะไม่มีอะไรให้ทดสอบ
 *
 * บล็อกนี้ไม่มี dependency กับส่วนอื่นของ proxy เลยโดยตั้งใจ (ไม่แตะ env ไม่แตะ fetch
 * ไม่แตะไฟล์) จึงยกมาวางใน vm เปล่า ๆ แล้วรันได้ตรง ๆ
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

const START = "// >>> นโยบายรายฟิลด์ — เริ่มบล็อก";
const END = "// <<< นโยบายรายฟิลด์ — จบบล็อก";

async function loadPolicy() {
  const source = await read("runtime/formula-proxy.mjs");
  const start = source.indexOf(START);
  const end = source.indexOf(END, start);
  assert.ok(start >= 0, "เครื่องหมายเปิดบล็อกนโยบายหายไปจาก formula-proxy.mjs");
  assert.ok(end > start, "เครื่องหมายปิดบล็อกนโยบายหายไปจาก formula-proxy.mjs");

  const block = source.slice(start, end);
  assert.ok(block.includes("function applyWritePolicy"), "บล็อกที่ตัดมาต้องมี applyWritePolicy");

  // รันในโลกเดียวกับเทสต์ (runInThisContext) ไม่ใช่โลกใหม่ (createContext)
  //
  // createContext สร้าง realm ใหม่ ซึ่งมี Array.prototype คนละตัว ผลคือ [] ที่ออกมา
  // จากโค้ดข้างในไม่เท่ากับ [] ของเทสต์เลย แม้เนื้อในเหมือนกันทุกตัว
  // (assert แจ้งว่า "same structure but are not reference-equal" ซึ่งอ่านแล้วงงมาก)
  //
  // ห่อด้วยฟังก์ชันเพื่อไม่ให้ const ที่ประกาศในบล็อกไปอยู่ในขอบเขตส่วนกลาง
  // ถ้าไม่ห่อ การเรียก loadPolicy() ครั้งที่สองจะพังด้วย "Identifier already declared"
  const factory = vm.runInThisContext(
    `(function () {\n${block}\n`
      + "return { applyWritePolicy, ALLOWED_RPC, TABLE_METHODS, KNOWN_ROLES, activityLogReadAllowed };\n})",
  );
  return factory();
}

async function sealedBundle() {
  const current = (await read("releases/CURRENT")).trim();
  return read(`releases/${current}/index.html`);
}

const admin = { name: "Ham", role: "admin" };
const sales = { name: "แกง", role: "sales" };
const storedOf = rows => new Map(rows.map(row => [row.name, row.data]));

// ---------------------------------------------------------------------------
// ด่านกันข้อมูลเคลื่อนจากต้นทาง — สองข้อนี้เทียบกับ "บันเดิลที่ผนึกไว้จริง"
// ไม่ใช่กับตารางที่พิมพ์เองไว้ในเทสต์ (เทียบสำเนากับสำเนา = ผ่านทั้งคู่ผิด)
// ---------------------------------------------------------------------------

test("รายชื่อบทบาทใน proxy ต้องตรงกับ ROLE_KEYS ของแอปเป๊ะ ๆ", async () => {
  const { KNOWN_ROLES } = await loadPolicy();
  const bundle = await sealedBundle();

  // ROLE_KEYS = Object.keys(ROLES) — จึงต้องอ่านคีย์ออกมาจากบล็อก const ROLES = {...}
  const start = bundle.indexOf("const ROLES = {");
  assert.ok(start >= 0, "หา const ROLES ในบันเดิลไม่เจอ — โครงของแอปเปลี่ยนไปแล้ว");
  const end = bundle.indexOf("const ROLE_KEYS", start);
  assert.ok(end > start, "หา const ROLE_KEYS ต่อท้ายไม่เจอ");
  const keys = [...bundle.slice(start, end).matchAll(/^\s{2}([a-z][a-z0-9_]*):\s*\{/gm)].map(m => m[1]);

  assert.ok(keys.length >= 5, `อ่านบทบาทออกมาได้แค่ ${keys.length} ตัว — ตัวอ่านน่าจะพัง`);
  assert.deepEqual(
    [...KNOWN_ROLES].sort(),
    [...keys].sort(),
    "บทบาทใน KNOWN_ROLES ไม่ตรงกับแอปแล้ว — admin จะเปลี่ยนบทบาทที่แอปรู้จักไม่ได้",
  );
});

test("การตัด PATCH ออกจากทุกตาราง ต้องยังปลอดภัยกับแอปตัวจริง", async () => {
  const { TABLE_METHODS } = await loadPolicy();
  const bundle = await sealedBundle();

  // เหตุผลเดียวที่ตัด PATCH ได้ คือแอปไม่เคยใช้เลย — ข้อนี้เฝ้าเหตุผลนั้นไว้
  assert.equal(
    (bundle.match(/PATCH/g) || []).length,
    0,
    "บันเดิลเริ่มใช้ PATCH แล้ว — TABLE_METHODS ที่ไม่มี PATCH จะทำให้คำสั่งนั้นถูกปฏิเสธ",
  );
  for (const [table, methods] of Object.entries(TABLE_METHODS)) {
    assert.ok(!methods.includes("PATCH"), `${table} ไม่ควรรับ PATCH`);
  }
});

test("ตารางที่ห้ามลบ ต้องเป็นตารางที่แอปไม่เคยสั่งลบจริง ๆ", async () => {
  const { TABLE_METHODS } = await loadPolicy();
  const bundle = await sealedBundle();

  for (const table of ["fs_activities", "fs_meta"]) {
    assert.ok(!TABLE_METHODS[table].includes("DELETE"), `${table} ไม่ควรรับ DELETE`);
    assert.ok(
      !bundle.includes(`sbDelete('${table}'`) && !bundle.includes(`sbDelete("${table}"`),
      `แอปเริ่มสั่งลบ ${table} แล้ว — การปฏิเสธ DELETE จะทำให้รอบซิงก์ค้างทั้งรอบ`,
    );
  }
  // ตรงข้าม: ตารางที่แอปสั่งลบจริง ต้องลบได้ ไม่งั้น sbPush พังตั้งแต่บรรทัดนั้น
  for (const table of ["fs_records", "fs_chats", "fs_users"]) {
    assert.ok(bundle.includes(`sbDelete('${table}'`), `คาดว่าแอปสั่งลบ ${table}`);
    assert.ok(TABLE_METHODS[table].includes("DELETE"), `${table} ต้องรับ DELETE`);
  }
});

test("เบราว์เซอร์ต้องเรียกประตูเปลี่ยนบทบาทเองไม่ได้", async () => {
  const { ALLOWED_RPC } = await loadPolicy();
  assert.ok(ALLOWED_RPC.has("fs_next_rec_seq"), "ออกเลขงานต้องเรียกได้");
  assert.ok(
    !ALLOWED_RPC.has("fs_set_user_role"),
    "fs_set_user_role อยู่ใน allowlist = ใครก็เลื่อนตำแหน่งตัวเองเป็น admin ได้",
  );
});

// ---------------------------------------------------------------------------
// ตัวนับเลขงาน
// ---------------------------------------------------------------------------

test("แถว reccounter ถูกกรองทิ้ง ส่วนแถวอื่นใน fs_meta ผ่านตามปกติ", async () => {
  const { applyWritePolicy } = await loadPolicy();
  const verdict = applyWritePolicy({
    table: "fs_meta",
    method: "POST",
    rows: [{ key: "reccounter", value: 5 }, { key: "tags", value: [{ id: "t1" }] }],
    session: admin,
    stored: null,
  });
  assert.deepEqual(verdict.rows, [{ key: "tags", value: [{ id: "t1" }] }]);
  assert.equal(verdict.dropped.length, 1);
  assert.equal(verdict.dropped[0].key, "reccounter");
  assert.equal(verdict.skipUpstream, false, "ต้องส่งแถวที่เหลือขึ้นไป ไม่ใช่ตัดทั้งคำขอ");
});

test("ต่อให้ admin เป็นคนส่ง reccounter ก็ยังถูกกรอง", async () => {
  const { applyWritePolicy } = await loadPolicy();
  const verdict = applyWritePolicy({
    table: "fs_meta",
    method: "POST",
    rows: [{ key: "reccounter", value: 1 }],
    session: admin,
    stored: null,
  });
  assert.deepEqual(verdict.rows, [], "เลขงานที่ออกไปแล้วอยู่บนเอกสารที่ออกจากบริษัทไปแล้ว");
});

// ---------------------------------------------------------------------------
// Activity Log
// ---------------------------------------------------------------------------

test("activity reads require an admin session role", async () => {
  const { activityLogReadAllowed } = await loadPolicy();
  assert.equal(activityLogReadAllowed(admin), true);
  for (const session of [sales, { role: "pd" }, null, undefined, {}, { role: "Admin" }]) {
    assert.equal(activityLogReadAllowed(session), false);
  }
});

test("ประวัติถูกประทับชื่อและบทบาทจากเซสชันจริง ไม่ใช่จากที่เบราว์เซอร์ส่งมา", async () => {
  const { applyWritePolicy } = await loadPolicy();
  const verdict = applyWritePolicy({
    table: "fs_activities",
    method: "POST",
    rows: [{ uid: "u1", ts: 111, data: { uid: "u1", ts: 111, user: "คนอื่น", role: "admin", action: "ลบงาน" } }],
    session: sales,
    stored: null,
  });
  assert.equal(verdict.rows[0].data.user, "แกง");
  assert.equal(verdict.rows[0].data.role, "sales");
  assert.equal(verdict.rows[0].data.action, "ลบงาน", "เนื้อความต้องไม่ถูกแตะ");
});

/* ข้อสำคัญที่สุดของกลุ่มนี้ */
test("uid และ ts ของประวัติต้องไม่ถูกแตะ", async () => {
  const { applyWritePolicy } = await loadPolicy();
  const row = { uid: "mt2wi2h4-14rbbfc", ts: 1787313820936, data: { uid: "mt2wi2h4-14rbbfc", ts: 1787313820936, user: "แกง" } };
  const verdict = applyWritePolicy({
    table: "fs_activities",
    method: "POST",
    rows: [row],
    session: sales,
    stored: null,
  });
  // uid คือกุญแจกันรายการซ้ำ ไม่ใช่รหัสประจำตัว — เขียนทับแล้วได้แถวซ้ำทุกรอบซิงก์
  assert.equal(verdict.rows[0].uid, "mt2wi2h4-14rbbfc");
  assert.equal(verdict.rows[0].data.uid, "mt2wi2h4-14rbbfc");
  // ts อยู่สองที่ (คอลัมน์ ts และ data.ts) แก้ที่เดียวแล้วลำดับที่แสดงกับที่เรียงจะไม่ตรงกัน
  assert.equal(verdict.rows[0].ts, 1787313820936);
  assert.equal(verdict.rows[0].data.ts, 1787313820936);
});

// ---------------------------------------------------------------------------
// ผู้ใช้และบทบาท
// ---------------------------------------------------------------------------

const stored = () =>
  storedOf([
    { name: "Ham", data: { name: "Ham", role: "admin", email: "chanin@example.com" } },
    { name: "แกง", data: { name: "แกง", role: "sales", email: "sutthida@example.com" } },
  ]);

test("profile metadata survives reduced browser sync without copying other stored fields", async () => {
  const { applyWritePolicy } = await loadPolicy();
  const known = {
    name: "Linked", role: "sales", email: "old@example.invalid", pass: null,
    central_user_id: "11111111-1111-4111-8111-111111111111", provisionedBy: "opc-user-access",
    storedOnly: "must not be copied",
  };
  for (const session of [admin, sales]) {
    for (const arrayBody of [false, true]) {
      const row = { name: "Linked", data: { name: "Edited", role: "sales", email: "new@example.invalid", pass: null } };
      const verdict = applyWritePolicy({ table: "fs_users", method: "POST", rows: arrayBody ? [row] : row,
        session, stored: new Map([["Linked", known]]) });
      assert.deepEqual(verdict.rows, [{ name: "Linked", data: {
        name: "Edited", role: "sales", email: "new@example.invalid", pass: null,
        central_user_id: "11111111-1111-4111-8111-111111111111", provisionedBy: "opc-user-access",
      } }]);
      assert.deepEqual(verdict.dropped, []);
      assert.deepEqual(verdict.roleChanges, []);
      assert.equal(verdict.skipUpstream, false);
      assert.equal(Object.hasOwn(row.data, "central_user_id"), false, "do not mutate browser input");
    }
  }
});

test("profile metadata cannot be replaced by browser values or bypass role-change gates", async () => {
  const { applyWritePolicy } = await loadPolicy();
  for (const session of [admin, sales]) {
    for (const arrayBody of [false, true]) {
      const row = { name: "Linked", data: { name: "Edited", role: "pd", pass: null,
        central_user_id: "forged-id", provisionedBy: "forged-source" } };
      const verdict = applyWritePolicy({ table: "fs_users", method: "POST", rows: arrayBody ? [row] : row,
        session, stored: new Map([["Linked", { role: "sales", central_user_id: null, provisionedBy: "" }]]) });
      assert.deepEqual(verdict.rows, [{ name: "Linked", data: { name: "Edited", role: "pd", pass: null,
        central_user_id: null, provisionedBy: "" } }], "preserve exact stored values, including falsy values");
      assert.deepEqual(verdict.roleChanges, session === admin ? [{ name: "Linked", from: "sales", to: "pd" }] : []);
      assert.equal(verdict.dropped.length, session === admin ? 0 : 1);
      assert.equal(row.data.central_user_id, "forged-id", "do not mutate browser input");
    }
  }
});

test("profile metadata cannot be added by browser to legacy or new profiles", async () => {
  const { applyWritePolicy } = await loadPolicy();
  for (const session of [admin, sales]) {
    for (const arrayBody of [false, true]) {
      for (const existing of [false, true]) {
        const row = { name: "Legacy", data: { name: "Legacy", role: "sales", email: "legacy@example.invalid",
          central_user_id: "forged-id", provisionedBy: "forged-source" } };
        const verdict = applyWritePolicy({ table: "fs_users", method: "POST", rows: arrayBody ? [row] : row,
          session, stored: new Map(existing ? [["Legacy", { name: "Legacy", role: "sales" }]] : []) });
        const allowed = existing || session === admin;
        assert.deepEqual(verdict.rows, allowed ? [{ name: "Legacy", data: {
          name: "Legacy", role: "sales", email: "legacy@example.invalid",
        } }] : []);
        assert.deepEqual(verdict.roleChanges, !existing && session === admin
          ? [{ name: "Legacy", from: "(ผู้ใช้ใหม่)", to: "sales" }] : []);
        assert.equal(verdict.dropped.length, allowed ? 0 : 1);
      }
    }
  }
});

test("profile metadata preserves only fields actually present in stored profile", async () => {
  const { applyWritePolicy } = await loadPolicy();
  for (const fields of [{ central_user_id: "stored-id" }, { provisionedBy: "opc-user-access" }]) {
    const verdict = applyWritePolicy({ table: "fs_users", method: "POST",
      rows: { name: "Partial", data: { name: "Partial", central_user_id: "forged-id", provisionedBy: "forged-source" } },
      session: admin, stored: new Map([["Partial", { role: "sales", ...fields }]]) });
    assert.deepEqual(verdict.rows, [{ name: "Partial", data: { name: "Partial", ...fields } }]);
  }
});

test("profile metadata write still fails closed when stored profiles cannot be read", async () => {
  const { applyWritePolicy } = await loadPolicy();
  for (const session of [admin, sales]) {
    for (const arrayBody of [false, true]) {
      const row = { name: "Linked", data: { central_user_id: "forged-id", provisionedBy: "forged-source" } };
      const verdict = applyWritePolicy({ table: "fs_users", method: "POST", rows: arrayBody ? [row] : row,
        session, stored: null });
      assert.deepEqual(verdict.rows, []);
      assert.deepEqual(verdict.roleChanges, []);
      assert.equal(verdict.dropped.length, 1);
    }
  }
});

test("คนที่ไม่ใช่ admin เลื่อนตำแหน่งตัวเองไม่ได้", async () => {
  const { applyWritePolicy } = await loadPolicy();
  const verdict = applyWritePolicy({
    table: "fs_users",
    method: "POST",
    rows: [{ name: "แกง", data: { name: "แกง", role: "admin" } }],
    session: sales,
    stored: stored(),
  });
  assert.deepEqual(verdict.roleChanges, [], "ต้องไม่มีคำสั่งเปลี่ยนบทบาทหลุดออกไป");
  assert.equal(verdict.dropped.length, 1);
  assert.match(verdict.dropped[0].why, /เฉพาะ admin/);
  // แถวยังถูกส่งขึ้นไป เพราะฐานเป็นคนตรึง role กลับให้ และฟิลด์อื่นที่เขาแก้ต้องบันทึกได้
  assert.equal(verdict.rows.length, 1);
});

test("admin เปลี่ยนบทบาทได้ และต้องออกมาเป็นคำสั่งผ่านประตูเฉพาะ", async () => {
  const { applyWritePolicy } = await loadPolicy();
  const verdict = applyWritePolicy({
    table: "fs_users",
    method: "POST",
    rows: [{ name: "แกง", data: { name: "แกง", role: "pd" } }],
    session: admin,
    stored: stored(),
  });
  assert.deepEqual(verdict.roleChanges, [{ name: "แกง", from: "sales", to: "pd" }]);
  assert.equal(verdict.dropped.length, 0);
});

test("บทบาทที่แอปไม่รู้จัก ต้องไม่ถูกเขียนลงไป แม้ admin เป็นคนส่ง", async () => {
  const { applyWritePolicy } = await loadPolicy();
  const verdict = applyWritePolicy({
    table: "fs_users",
    method: "POST",
    rows: [{ name: "แกง", data: { name: "แกง", role: "superuser" } }],
    session: admin,
    stored: stored(),
  });
  assert.deepEqual(verdict.roleChanges, []);
  assert.match(verdict.dropped[0].why, /ไม่อยู่ในรายการที่รู้จัก/);
});

test("รอบซิงก์ปกติที่ไม่มีใครเปลี่ยนบทบาท ต้องไม่ก่อคำสั่งอะไรเพิ่มเลย", async () => {
  const { applyWritePolicy } = await loadPolicy();
  const verdict = applyWritePolicy({
    table: "fs_users",
    method: "POST",
    rows: [{ name: "แกง", data: { name: "แกง", role: "sales", email: "ใหม่@beyondlabth.co.th" } }],
    session: sales,
    stored: stored(),
  });
  assert.deepEqual(verdict.roleChanges, []);
  assert.deepEqual(verdict.dropped, [], "แก้อีเมลตัวเองเป็นเรื่องปกติ ไม่ควรมีบรรทัดในบันทึก");
  assert.equal(verdict.rows[0].data.email, "ใหม่@beyondlabth.co.th");
});

test("แถวที่ไม่มีช่อง role มาด้วย ต้องไม่ถูกนับว่าเป็นการเปลี่ยนบทบาท", async () => {
  const { applyWritePolicy } = await loadPolicy();
  const verdict = applyWritePolicy({
    table: "fs_users",
    method: "POST",
    rows: [{ name: "แกง", data: { name: "แกง", email: "a@b.c" } }],
    session: sales,
    stored: stored(),
  });
  assert.deepEqual(verdict.dropped, []);
  assert.deepEqual(verdict.roleChanges, []);
});

test("คนที่ไม่ใช่ admin สร้างผู้ใช้ใหม่ไม่ได้ — แถวนั้นไม่ถูกส่งขึ้นไป", async () => {
  const { applyWritePolicy } = await loadPolicy();
  const verdict = applyWritePolicy({
    table: "fs_users",
    method: "POST",
    rows: [
      { name: "คนใหม่", data: { name: "คนใหม่", role: "admin" } },
      { name: "แกง", data: { name: "แกง", role: "sales" } },
    ],
    session: sales,
    stored: stored(),
  });
  assert.deepEqual(verdict.rows.map(r => r.name), ["แกง"], "เหลือเฉพาะแถวที่มีอยู่เดิม");
  assert.match(verdict.dropped[0].why, /สร้างผู้ใช้ใหม่ได้เฉพาะ admin/);
});

test("admin สร้างผู้ใช้ใหม่พร้อมบทบาทได้", async () => {
  const { applyWritePolicy } = await loadPolicy();
  const verdict = applyWritePolicy({
    table: "fs_users",
    method: "POST",
    rows: [{ name: "คนใหม่", data: { name: "คนใหม่", role: "ra" } }],
    session: admin,
    stored: stored(),
  });
  assert.equal(verdict.rows.length, 1);
  assert.deepEqual(verdict.dropped, []);
});

/* ข้อสำคัญที่สุดของกลุ่มนี้ — พังแบบปิด ไม่ใช่พังแบบเปิด */
test("อ่านผู้ใช้เดิมมาเทียบไม่ได้ ต้องไม่เขียนอะไรเลย", async () => {
  const { applyWritePolicy } = await loadPolicy();
  const verdict = applyWritePolicy({
    table: "fs_users",
    method: "POST",
    rows: [{ name: "แกง", data: { name: "แกง", role: "admin" } }],
    session: sales,
    stored: null,
  });
  assert.deepEqual(verdict.rows, [], "เทียบไม่ได้ = แยกไม่ออกว่าใครใหม่ใครเปลี่ยนบทบาท");
  assert.equal(verdict.dropped.length, 1);
});

test("ลบผู้ใช้ได้เฉพาะ admin และการปฏิเสธต้องไม่ทำให้รอบซิงก์ล้ม", async () => {
  const { applyWritePolicy } = await loadPolicy();

  const byStaff = applyWritePolicy({ table: "fs_users", method: "DELETE", rows: null, session: sales, stored: null });
  assert.equal(byStaff.skipUpstream, true, "ไม่ส่งต่อขึ้นไป");
  assert.equal(byStaff.dropped.length, 1);

  const byAdmin = applyWritePolicy({ table: "fs_users", method: "DELETE", rows: null, session: admin, stored: null });
  assert.equal(byAdmin.skipUpstream, false);
  assert.deepEqual(byAdmin.dropped, []);
});

test("ลบใบงาน/ห้องแชท ใครก็ทำได้ตามเดิม — ฐานเก็บสำเนาให้เอง", async () => {
  const { applyWritePolicy } = await loadPolicy();
  for (const table of ["fs_records", "fs_chats", "fs_messages", "fs_approvals"]) {
    const verdict = applyWritePolicy({ table, method: "DELETE", rows: null, session: sales, stored: null });
    assert.equal(verdict.skipUpstream, false, `${table} ต้องลบได้ตามปกติ`);
    assert.deepEqual(verdict.dropped, []);
  }
});

test("ตารางงานปกติผ่านไปทั้งก้อน ไม่ถูกแก้แม้แต่ฟิลด์เดียว", async () => {
  const { applyWritePolicy } = await loadPolicy();
  const rows = [{ id: "A00001", data: { id: "A00001", brand: "เจลลี่กาบา", owner: "แกง" } }];
  const verdict = applyWritePolicy({ table: "fs_records", method: "POST", rows, session: sales, stored: null });
  assert.deepEqual(verdict.rows, rows);
  assert.deepEqual(verdict.dropped, []);
  assert.deepEqual(verdict.roleChanges, []);
});

// ---------------------------------------------------------------------------
// ส่งเนื้อคำขอเป็นก้อนเดียวแทนรายการ — ช่องที่ผู้ตรวจเดินผ่านจริง 24 ส.ค. 2569
//
// โค้ดรุ่นแรกเขียนว่า "ไม่ใช่รายการ = ส่งผ่าน" และบรรทัดนั้นอยู่เหนือกฎทุกข้อ
// PostgREST รับทั้ง [{...}] และ {...} เท่ากัน คำขอเดียวจึงข้ามด่านได้ทั้งหมด
// สามข้อนี้คือสามอย่างที่ทำได้ตอนนั้น เขียนไว้เพื่อไม่ให้กลับมาได้อีก
// ---------------------------------------------------------------------------

test("ก้อนเดียว: คนที่ไม่ใช่ admin สร้างผู้ใช้บทบาท admin ไม่ได้", async () => {
  const { applyWritePolicy } = await loadPolicy();
  const verdict = applyWritePolicy({
    table: "fs_users",
    method: "POST",
    rows: { name: "ผู้บุกรุก", data: { name: "ผู้บุกรุก", role: "admin" } },
    session: sales,
    stored: stored(),
  });
  assert.deepEqual(verdict.rows, [], "แถวต้องไม่ถูกส่งขึ้นไป");
  assert.match(verdict.dropped[0].why, /สร้างผู้ใช้ใหม่ได้เฉพาะ admin/);
});

test("ก้อนเดียว: ปลอมชื่อผู้ทำในประวัติไม่ได้", async () => {
  const { applyWritePolicy } = await loadPolicy();
  const verdict = applyWritePolicy({
    table: "fs_activities",
    method: "POST",
    rows: { uid: "u1", ts: 1, data: { uid: "u1", user: "PST", role: "admin" } },
    session: sales,
    stored: null,
  });
  assert.equal(verdict.rows[0].data.user, "แกง");
  assert.equal(verdict.rows[0].data.role, "sales");
});

test("ก้อนเดียว: เขียนตัวนับเลขงานทับไม่ได้", async () => {
  const { applyWritePolicy } = await loadPolicy();
  const verdict = applyWritePolicy({
    table: "fs_meta",
    method: "POST",
    rows: { key: "reccounter", value: 999999 },
    session: admin,
    stored: null,
  });
  assert.deepEqual(verdict.rows, []);
});

test("เนื้อคำขอที่ไม่ใช่ทั้งรายการและก้อนข้อมูล ต้องถูกปฏิเสธ ไม่ใช่ส่งผ่าน", async () => {
  const { applyWritePolicy } = await loadPolicy();
  // ปลายทางเคยตอบ 201 ให้เนื้อคำขอที่เป็นข้อความเปล่า ๆ ซึ่งไม่มีทางเป็นสิ่งที่ตั้งใจ
  for (const bad of ["xxx", 42, null, true]) {
    const verdict = applyWritePolicy({
      table: "fs_users",
      method: "POST",
      rows: bad,
      session: admin,
      stored: stored(),
    });
    assert.ok(verdict.reject, `ต้องปฏิเสธเนื้อคำขอชนิด ${typeof bad}`);
  }
});

test("บทบาทของผู้ใช้ใหม่ที่ admin สร้าง ต้องออกทางประตูเฉพาะ ไม่ใช่ติดมากับแถว", async () => {
  const { applyWritePolicy } = await loadPolicy();
  const verdict = applyWritePolicy({
    table: "fs_users",
    method: "POST",
    rows: [{ name: "คนใหม่", data: { name: "คนใหม่", role: "ra" } }],
    session: admin,
    stored: stored(),
  });
  // ฐานถอด role ออกตอน INSERT เสมอ ถ้า proxy ไม่สั่งประตูให้ ผู้ใช้ใหม่จะไม่มีบทบาทเลย
  assert.deepEqual(verdict.roleChanges, [{ name: "คนใหม่", from: "(ผู้ใช้ใหม่)", to: "ra" }]);
  assert.equal(verdict.rows.length, 1);
});

test("บทบาทที่ไม่รู้จักของผู้ใช้ใหม่ ต้องไม่ถูกสั่งผ่านประตู", async () => {
  const { applyWritePolicy } = await loadPolicy();
  const verdict = applyWritePolicy({
    table: "fs_users",
    method: "POST",
    rows: [{ name: "คนใหม่", data: { name: "คนใหม่", role: "superuser" } }],
    session: admin,
    stored: stored(),
  });
  assert.deepEqual(verdict.roleChanges, []);
  assert.match(verdict.dropped[0].why, /ไม่อยู่ในรายการที่รู้จัก/);
});
