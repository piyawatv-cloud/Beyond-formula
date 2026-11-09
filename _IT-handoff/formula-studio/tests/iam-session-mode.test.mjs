/* โหมด session ของ IAM — ยกบล็อกจริงออกมารัน (กฎ 6.2 ไม่ assert ข้อความในไฟล์)
 *
 * บล็อกพึ่งของจากส่วนอื่นของ proxy แค่สามอย่าง (createHmac, sameSecret, COOKIE_SECURE)
 * จึงส่งเข้าไปเป็นพารามิเตอร์ของฟังก์ชันห่อ แล้วรันด้วย runInThisContext
 */
import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const START = "// >>> โหมด session ของ IAM — เริ่มบล็อก";
const END = "// <<< โหมด session ของ IAM — จบบล็อก";

async function loadBlock(cookieSecure = true) {
  const source = await readFile(new URL("../runtime/formula-proxy.mjs", import.meta.url), "utf8");
  const start = source.indexOf(START);
  const end = source.indexOf(END, start);
  assert.ok(start >= 0 && end > start, "เครื่องหมายบล็อกโหมด IAM หายไปจาก formula-proxy.mjs");
  const block = source.slice(start, end);
  const factory = vm.runInThisContext(
    `(function (createHmac, sameSecret, COOKIE_SECURE) {\n${block}\n`
      + "return { sessionFromIntrospection, iamModeDenies, iamCarrierHeader, cookieValue, provisioningSignatureValid, IAM_CARRIER_COOKIE, IAM_FORMULA_ROLES };\n})",
  );
  const sameSecret = (a, b) => {
    const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
    return x.length === y.length && timingSafeEqual(x, y);
  };
  return factory(createHmac, sameSecret, cookieSecure);
}

const NOW = Date.parse("2026-10-01T05:00:00.000Z");
const active = (overrides = {}) => ({
  active: true, status: "ACTIVE", audience: "FORMULA", central_user_id: "0b9f0c3e-1111-4222-8333-944455556666",
  email: "synthetic.rd@example.test", expires_at: "2026-10-01T09:00:00.000Z", grant_version: "7",
  app_role: "FORMULA_RD", legacy_user_id: "Synthetic RD", ...overrides,
});
const profile = { name: "Synthetic RD", data: { name: "Synthetic RD", email: "synthetic.rd@example.test", role: "sales" } };

test("an IAM-confirmed FORMULA session maps the IAM role, not the stored fs_users role", async () => {
  const { sessionFromIntrospection } = await loadBlock();
  const session = sessionFromIntrospection(active(), profile, NOW);
  assert.equal(session.role, "rd", "role must come from IAM (FORMULA_RD), never from fs_users.data.role ('sales')");
  assert.equal(session.formulaUserId, "Synthetic RD");
  assert.equal(session.centralUserId, active().central_user_id);
  assert.equal(session.grantVersion, "7");
  assert.equal(sessionFromIntrospection(active({ app_role: "FORMULA_ADMIN" }), profile, NOW).role, "admin");
});

test("every missing or wrong field fails closed", async (t) => {
  const { sessionFromIntrospection } = await loadBlock();
  const cases = [
    ["inactive", active({ active: false })],
    ["disabled user", active({ status: "INACTIVE" })],
    ["wrong audience", active({ audience: "OPC" })],
    ["expired", active({ expires_at: "2026-10-01T04:59:59.000Z" })],
    ["malformed expiry", active({ expires_at: "soon" })],
    ["missing grant version", active({ grant_version: undefined })],
    ["non-numeric grant version", active({ grant_version: "v7" })],
    ["no app role", active({ app_role: null })],
    ["OPC role presented to Formula", active({ app_role: "OPC_ADMIN" })],
    ["unknown Formula role", active({ app_role: "FORMULA_SALES" })],
    ["no mapping", active({ legacy_user_id: null })],
    ["missing central id", active({ central_user_id: "" })],
  ];
  for (const [name, result] of cases) {
    await t.test(name, () => assert.equal(sessionFromIntrospection(result, profile, NOW), null));
  }
  await t.test("IAM unreachable (no result)", () => assert.equal(sessionFromIntrospection(null, profile, NOW), null));
  await t.test("mapped profile missing", () => assert.equal(sessionFromIntrospection(active(), null, NOW), null));
  await t.test("profile is someone else", () => assert.equal(sessionFromIntrospection(active(), { ...profile, name: "Other" }, NOW), null));
});

test("IAM mode removes delete and Formula user management for every role", async () => {
  const { iamModeDenies } = await loadBlock();
  for (const table of ["fs_records", "fs_chats", "fs_messages", "fs_approvals", "fs_users"]) {
    assert.equal(iamModeDenies("DELETE", table), "FORMULA_DELETE_DISABLED");
  }
  for (const method of ["POST", "PATCH", "PUT"]) assert.equal(iamModeDenies(method, "fs_users"), "FORMULA_USER_MANAGEMENT_DISABLED");
  assert.equal(iamModeDenies("GET", "fs_users"), "");
  assert.equal(iamModeDenies("POST", "fs_records"), "");
  assert.equal(iamModeDenies("POST", "fs_messages"), "");
});

test("the carrier cookie is host-only, HttpOnly, Secure, and cleared with Max-Age=0", async () => {
  const { iamCarrierHeader, cookieValue, IAM_CARRIER_COOKIE } = await loadBlock(true);
  const header = iamCarrierHeader("opaque-ref", 3600);
  assert.match(header, /^fs_iam_session=opaque-ref; Path=\/; HttpOnly; SameSite=Lax; Max-Age=3600; Secure$/);
  assert.doesNotMatch(header, /Domain=/i);
  assert.match(iamCarrierHeader("", 0), /Max-Age=0/);
  assert.equal(cookieValue({ headers: { cookie: `a=1; ${IAM_CARRIER_COOKIE}=xyz; fs_session=old` } }, IAM_CARRIER_COOKIE), "xyz");
  assert.equal(cookieValue({ headers: {} }, IAM_CARRIER_COOKIE), "");
});

test("the provisioning gateway accepts only a fresh signature over the exact body", async () => {
  const { provisioningSignatureValid } = await loadBlock();
  const secret = "synthetic-provisioning-secret-0123456789abcdef";
  const path = "/__formula/provisioning/profile";
  const body = JSON.stringify({ idempotency_key: "k1", name: "N" });
  const now = 1_790_000_000;
  const sign = (b, ts) => createHmac("sha256", secret).update(`POST\n${path}\n${ts}\n${b}`).digest("hex");
  assert.equal(provisioningSignatureValid(path, String(now), body, sign(body, now), secret, now), true);
  assert.equal(provisioningSignatureValid(path, String(now), body.replace("N", "M"), sign(body, now), secret, now), false, "tampered body");
  assert.equal(provisioningSignatureValid(path, String(now - 61), body, sign(body, now - 61), secret, now), false, "stale timestamp");
  assert.equal(provisioningSignatureValid("/__formula/provisioning/profile/read", String(now), body, sign(body, now), secret, now), false, "other path");
  assert.equal(provisioningSignatureValid(path, String(now), body, sign(body, now), "short", now), false, "unconfigured secret");
});
