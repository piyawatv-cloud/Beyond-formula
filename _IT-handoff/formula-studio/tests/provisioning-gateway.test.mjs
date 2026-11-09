/* ประตูสร้างโปรไฟล์ของ OPC — รัน proxy ตัวจริงเป็นโปรเซสลูก ต่อกับ PostgREST จำลองในเทสต์
 *
 * ไม่ใช่ assert ข้อความในไฟล์ (กฎ 6.2): ยิง HTTP จริงผ่านประตู แล้วดูว่าฐาน (จำลอง) ได้อะไร
 * ฐานจำลองทำตามกฎสองข้อของ data-policy.sql ที่ประตูพึ่ง: ถอด role ออกจากแถวใหม่ และตั้ง role
 * ได้ทางเดียวคือ fs_set_user_role
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url).pathname;
const SECRET = "synthetic-gateway-secret-0123456789abcdef0123";
const CENTRAL = "0b9f0c3e-1111-4222-8333-944455556666";

function mockPostgrest() {
  const users = new Map([["Existing Person", { name: "Existing Person", email: "existing@example.test", role: "sales" }]]);
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
    const url = new URL(req.url, "http://mock");
    calls.push(`${req.method} ${url.pathname}`);
    const send = (status, payload) => { res.writeHead(status, { "content-type": "application/json" }); res.end(payload === undefined ? "" : JSON.stringify(payload)); };
    if (url.pathname === "/rpc/fs_set_user_role") {
      const row = users.get(body.p_name);
      if (!row) return send(400, {});
      row.role = body.p_role;
      return send(204);
    }
    if (url.pathname === "/fs_users" && req.method === "GET") {
      const eq = url.searchParams.get("name");
      const rows = [...users].filter(([name]) => !eq || `eq.${name}` === decodeURIComponent(eq)).map(([name, data]) => ({ name, data }));
      return send(200, rows);
    }
    if (url.pathname === "/fs_users" && req.method === "POST") {
      if (users.has(body.name)) return send(409, { code: "23505" });
      const data = { ...body.data };
      delete data.role; // data-policy.sql ข้อ 5ก
      users.set(body.name, data);
      return send(201);
    }
    return send(404, {});
  });
  return { users, calls, server };
}

async function startStack(t) {
  const mock = mockPostgrest();
  await new Promise(r => mock.server.listen(0, "127.0.0.1", r));
  const port = 40000 + Math.floor(Math.random() * 2000);
  const logDir = await mkdtemp(join(tmpdir(), "fs-gw-"));
  const child = spawn(process.execPath, ["runtime/formula-proxy.mjs"], {
    cwd: root,
    env: {
      PATH: process.env.PATH, PORT: String(port), FORMULA_COLOR: "blue",
      FORMULA_RELEASE_DIR: join(root, "releases"), FORMULA_ASSET_DIR: join(root, "runtime/assets"), FORMULA_LOG_DIR: logDir,
      SB_ORIGIN: `http://127.0.0.1:${mock.server.address().port}`, SB_SERVICE_KEY: "synthetic-not-a-key", SB_REST_BASE: "/",
      FORMULA_PROVISIONING_SECRET: SECRET, FORMULA_SESSION_SECRET: "synthetic-session-secret-0123456789abcdef",
    },
    stdio: "ignore",
  });
  t.after(() => { child.kill(); mock.server.close(); });
  for (let i = 0; i < 50; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/__formula/health`)).ok) break; } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 100));
  }
  const call = async (path, payload, { secret = SECRET, tamper = false } = {}) => {
    const body = JSON.stringify(payload);
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", secret).update(`POST\n${path}\n${ts}\n${body}`).digest("hex");
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST", body: tamper ? body.replace("Admin", "Root") : body,
      headers: { "content-type": "application/json", "x-fs-provisioning-timestamp": ts, "x-fs-provisioning-signature": signature },
    });
    return { status: res.status, body: await res.json() };
  };
  return { mock, call, port };
}

test("the gateway creates, replays, re-projects and refuses exactly as OPC relies on", async (t) => {
  const { mock, call, port } = await startStack(t);
  const create = { idempotency_key: "k1", name: "New Admin", email: "new.admin@example.test", central_user_id: CENTRAL, role: "admin" };

  assert.equal((await call("/__formula/provisioning/profile", create, { secret: "x".repeat(40) })).status, 401, "wrong secret");
  assert.equal((await call("/__formula/provisioning/profile", create, { tamper: true })).status, 401, "body changed after signing");

  assert.deepEqual(await call("/__formula/provisioning/profile", create), { status: 200, body: { formula_user_id: "New Admin", created: true } });
  assert.equal(mock.users.get("New Admin").role, "admin", "role arrives only through fs_set_user_role");
  assert.deepEqual(await call("/__formula/provisioning/profile", create), { status: 200, body: { formula_user_id: "New Admin", created: false } }, "replay");

  // Another person's email or an existing name is never overwritten.
  assert.deepEqual(await call("/__formula/provisioning/profile", { ...create, email: "existing@example.test" }), { status: 409, body: { error: "profile_conflict" } });
  assert.deepEqual(await call("/__formula/provisioning/profile", { ...create, name: "Existing Person", email: "other@example.test" }), { status: 409, body: { error: "profile_conflict" } });
  assert.equal(mock.users.get("Existing Person").email, "existing@example.test");

  // Every existing Formula role is accepted; anything else is not.
  for (const role of ["pd", "ra", "rd", "sales", "oversea", "opc", "mkt", "purchasing", "admin"]) {
    assert.deepEqual(await call("/__formula/provisioning/profile/role", { idempotency_key: `r-${role}`, formula_user_id: "New Admin", role, central_user_id: CENTRAL }),
      { status: 200, body: { formula_user_id: "New Admin", role } });
    assert.equal(mock.users.get("New Admin").role, role);
  }
  assert.equal((await call("/__formula/provisioning/profile/role", { formula_user_id: "New Admin", role: "root", central_user_id: CENTRAL })).status, 400);
  // A profile OPC created for one identity cannot be re-roled for another.
  assert.deepEqual(await call("/__formula/provisioning/profile/role", { formula_user_id: "New Admin", role: "rd", central_user_id: "11111111-1111-4111-8111-111111111111" }),
    { status: 409, body: { error: "profile_conflict" } });

  // A request that came through Cloudflare is refused by the proxy too, even when signed.
  const viaCf = await fetch(`http://127.0.0.1:${port}/__formula/provisioning/profile/find`, { method: "POST", headers: { "cf-ray": "x", "content-type": "application/json" }, body: "{}" });
  assert.equal(viaCf.status, 404);

  const read = await call("/__formula/provisioning/profile/read", { formula_user_id: "New Admin" });
  assert.deepEqual(read.body, { found: true, formula_user_id: "New Admin", email: "new.admin@example.test", role: "admin" });
  assert.ok(!mock.calls.some(line => line.startsWith("DELETE")), "nothing is ever deleted");
});
