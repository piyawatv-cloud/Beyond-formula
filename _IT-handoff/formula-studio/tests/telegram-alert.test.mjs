/* เสียงเตือนสำรองทาง Telegram (scripts/alert-backup-proof.sh + scripts/notify-telegram.sh) — รันสคริปต์จริง
 *
 * ทำไมต้องมี: ทางเดียวที่เคยถึงคนคือ cron ของ Hermes ที่ให้โมเดลเลือกเองว่าจะรายงานอะไร
 * สำรองกู้คืนไม่ผ่าน 13 คืน แต่ถูกพูดถึงครั้งเดียว · สคริปต์คู่นี้ส่งตรงโดยไม่ผ่านโมเดล
 * สิ่งที่ต้องไม่พังคือกฎ 5.3: จดว่า "เตือนแล้ว" เฉพาะเมื่อ Telegram ยืนยันว่าส่งถึงเท่านั้น
 * ถ้าจดก่อนแล้วส่งไม่ออก คืนนั้นจะเงียบทั้งคืน — ซึ่งก็คืออาการเดิมที่เรากำลังแก้
 *
 * ความปลอดภัย: เทสต์นี้ห้ามแตะ Telegram จริงเด็ดขาด ทุกการรันตั้ง
 *   - FORMULA_TELEGRAM_ENV → ไฟล์ env ปลอมในโฟลเดอร์ชั่วคราว (โทเค็นปลอม)
 *   - FORMULA_TELEGRAM_API → เซิร์ฟเวอร์ปลอมบน 127.0.0.1 ที่เปิดในเทสต์เอง
 *   - HOME → โฟลเดอร์ชั่วคราว เผื่อวันหนึ่งตัวแปรข้างบนหลุด ค่าเริ่มต้น ~/.hermes/.env
 *     จะชี้ไปที่ว่าง ไม่ใช่ไฟล์จริงที่มีโทเค็นของบอทจริง
 * และลบ FORMULA_TELEGRAM_CHAT_ID ทิ้ง ไม่ให้ค่าจากเครื่องคนรันมาปนผล
 *
 * ทำไมใช้ spawn ไม่ใช่ spawnSync: spawnSync บล็อก event loop ทั้งโปรเซส
 * เซิร์ฟเวอร์ปลอมที่อยู่ในโปรเซสเดียวกันจะตอบไม่ได้ curl จะค้างจนหมดเวลา
 *
 * FORMULA_ALERT_SCRIPT ใช้เฉพาะตอนทำ mutation test กับ "สำเนา" ของสคริปต์
 * (สำเนาต้องมี notify-telegram.sh อยู่ข้าง ๆ เพราะสคริปต์หาเพื่อนจากโฟลเดอร์ตัวเอง)
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before, beforeEach } from "node:test";

const root = new URL("../", import.meta.url);
const ALERT = process.env.FORMULA_ALERT_SCRIPT
  || fileURLToPath(new URL("scripts/alert-backup-proof.sh", root));
const NOTIFY = fileURLToPath(new URL("scripts/notify-telegram.sh", root));

// โทเค็นปลอมที่หน้าตาเหมือนของจริง และไม่ซ้ำกับคำอื่นในผลลัพธ์ — ใช้ค้นหาว่ารั่วไหม
const FAKE_TOKEN = "999000111:FAKE-token-never-real_abcXYZ";
const FAKE_CHAT = "-100424242";

// บรรทัดผลของสองคืนต่างกัน — สร้างจาก check-backup-status.sh ตัวจริงใน before()
// ไม่พิมพ์เองในเทสต์ (กฎ 6.3): เคยพิมพ์ลำดับช่องผิดจากของจริง แล้วเทสต์ผ่านทั้งที่ตัวอ่านกุญแจ
// ของจริงจะอ่านอีกแบบ
const CHECK = fileURLToPath(new URL("scripts/check-backup-status.sh", root));
const realProof = {};
const proofFail = at => realProof[at];
const NIGHT1 = "2026-09-26T20:15:08Z";
const NIGHT2 = "2026-09-27T20:15:09Z";
const PROOF_OK = "backup-proof=ok at=2026-09-28T20:15:10Z";

let dir, home, envFile, server, api;
let requests = [];
// ค่าที่เซิร์ฟเวอร์ปลอมจะตอบรอบถัดไป — แต่ละเทสต์ตั้งเอง
let reply = { status: 200, body: { ok: true, result: {} } };

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "telegram-alert-test-"));
  home = join(dir, "home");
  await mkdir(home);
  envFile = join(dir, "hermes.env");
  // มีบรรทัดอื่นปนด้วย และมีเครื่องหมายคำพูด เหมือน .env จริง — สคริปต์ต้องหยิบแค่สองคีย์
  await writeFile(envFile, [
    "OTHER_SECRET=do-not-read",
    `TELEGRAM_BOT_TOKEN="${FAKE_TOKEN}"`,
    `TELEGRAM_HOME_CHANNEL=${FAKE_CHAT}`,
    "",
  ].join("\n"));

  server = createServer((req, res) => {
    let raw = "";
    req.on("data", c => { raw += c; });
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, form: new URLSearchParams(raw) });
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.body));
    });
  });
  for (const at of [NIGHT1, NIGHT2]) {
    const log = join(dir, `backup-${at}.log`);
    await writeFile(log, `${at} daily-backup status=fail why=กู้คืนไม่ผ่าน dest=/x\n`);
    const now = Math.floor(Date.parse(at) / 1000) + 3600;
    const r = await runSh([CHECK, log], { ...process.env, FORMULA_BACKUP_CHECK_NOW: String(now) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^backup-proof=fail at=/, "รูปบรรทัดของตัวตรวจเปลี่ยน — ตัวอ่านกุญแจต้องตามด้วย");
    realProof[at] = r.out;
  }

  await new Promise(r => server.listen(0, "127.0.0.1", r));
  api = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(r => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  requests = [];
  reply = { status: 200, body: { ok: true, result: {} } };
});

function envFor(overrides = {}) {
  // FORMULA_ALERT_NO_DESKTOP: ทางสำรองบนจอ Mac ต้องไม่เด้งทุกครั้งที่รันเทสต์
  const env = { ...process.env, HOME: home, FORMULA_TELEGRAM_ENV: envFile, FORMULA_TELEGRAM_API: api,
    FORMULA_ALERT_NO_DESKTOP: "1",
    // ตรึง "ตอนนี้" ไว้หลังคืนที่สองหนึ่งชั่วโมง — fail ที่เก่าเกิน 30 ชม. ได้กุญแจแบบมีวันที่
    // ถ้าปล่อยตามนาฬิกาเครื่อง เทสต์จะเปลี่ยนผลเองเมื่อวันผ่านไป
    FORMULA_BACKUP_CHECK_NOW: String(Math.floor(Date.parse(NIGHT2) / 1000) + 3600) };
  delete env.FORMULA_TELEGRAM_CHAT_ID;
  return { ...env, ...overrides };
}

function runSh(args, env) {
  return new Promise((resolve, reject) => {
    const p = spawn("sh", args, { env });
    let out = "";
    p.stdout.on("data", c => { out += c; });
    p.stderr.on("data", c => { out += c; });
    const timer = setTimeout(() => { p.kill("SIGKILL"); reject(new Error(`ค้างเกิน 30 วิ:\n${out}`)); }, 30_000);
    p.on("error", reject);
    p.on("close", code => { clearTimeout(timer); resolve({ code, out: out.trim() }); });
  });
}

let n = 0;
async function newMonitorDir() {
  const d = join(dir, `monitoring-${++n}`);
  await mkdir(d);
  return d;
}
const alert = (mon, rc, proof, env) => runSh([ALERT, String(rc), proof, mon], envFor(env));
const readState = async mon => (await readFile(join(mon, "backup-proof-alerted"), "utf8").catch(() => "")).trim();
const readAlerts = async mon => readFile(join(mon, "alerts.log"), "utf8").catch(() => "");

function assertNoToken(...texts) {
  for (const t of texts) assert.ok(!t.includes(FAKE_TOKEN), `โทเค็นรั่วออกมา:\n${t}`);
}

test("ลำดับหนึ่งเหตุ: ส่งไม่ออก → ไม่จด · ส่งได้ → จดครั้งเดียว · ซ้ำ → เงียบ · คืนใหม่ → ส่งอีก · กลับมาผ่าน → แจ้งแล้วล้าง", async () => {
  const mon = await newMonitorDir();

  // 1) Telegram ตอบ 401 → ออก 1, ห้ามจดกุญแจ (กฎ 5.3), ต้องมีบรรทัดใน alerts.log
  reply = { status: 401, body: { ok: false, error_code: 401, description: "Unauthorized" } };
  let r = await alert(mon, 1, proofFail(NIGHT1));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /backup-alert=notification-failed/);
  assert.match(r.out, /why=/, "ส่งไม่ออกต้องบอกเหตุผล (กฎ 5.2)");
  assert.equal(requests.length, 1, "ต้องลองส่งจริงหนึ่งครั้ง");
  assert.equal(await readState(mon), "", "ส่งไม่ออกแต่จดว่าเตือนแล้ว = คืนนั้นจะเงียบ");
  let log = await readAlerts(mon);
  assert.match(log, /backup-alert=notification-failed key=fail@/);
  assertNoToken(r.out, log);

  // 2) รอบถัดไป (15 นาที) Telegram กลับมา → ส่งเหตุเดิมซ้ำ แล้วจดกุญแจ
  requests = [];
  reply = { status: 200, body: { ok: true, result: {} } };
  r = await alert(mon, 1, proofFail(NIGHT1));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /backup-alert=sent/);
  assert.equal(requests.length, 1, "ต้องส่งหนึ่งครั้งพอดี");
  const req = requests[0];
  assert.equal(req.method, "POST");
  // โทเค็นต้องไปถึงปลายทางจริง (ไม่งั้นเทสต์ "ไม่รั่ว" ก็ผ่านเพราะไม่มีโทเค็นเลย)
  assert.equal(req.url, `/bot${FAKE_TOKEN}/sendMessage`);
  assert.equal(req.form.get("chat_id"), FAKE_CHAT);
  assert.ok(req.form.get("text").includes(proofFail(NIGHT1)), `ข้อความต้องยกบรรทัดผลมาทั้งบรรทัด:\n${req.form.get("text")}`);
  assert.equal(await readState(mon), `fail@${NIGHT1}`);
  log = await readAlerts(mon);
  assert.match(log, new RegExp(`backup-alert=sent key=fail@${NIGHT1}`));
  assertNoToken(r.out, log);

  // 3) เหตุเดิม รอบถัดไป → ไม่ส่งซ้ำ (ไม่งั้นเจ้าของโดนทุก 15 นาทีแล้วเลิกอ่าน)
  requests = [];
  r = await alert(mon, 1, proofFail(NIGHT1));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /backup-alert=already-sent/);
  assert.equal(requests.length, 0);

  // 4) คืนถัดไปล้มอีก → กุญแจใหม่ ต้องส่งอีก
  r = await alert(mon, 1, proofFail(NIGHT2));
  assert.equal(r.code, 0, r.out);
  assert.equal(requests.length, 1, "คืนใหม่ที่ล้มต้องเตือนใหม่");
  assert.equal(await readState(mon), `fail@${NIGHT2}`);

  // 5) กลับมาผ่าน → แจ้งว่าหายแล้ว และล้างกุญแจ
  requests = [];
  r = await alert(mon, 0, PROOF_OK);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /backup-alert=recovered-sent/);
  assert.equal(requests.length, 1);
  const text = requests[0].form.get("text");
  assert.ok(text.includes(PROOF_OK), text);
  assert.ok(text.includes(`fail@${NIGHT2}`), "ข้อความหายแล้วต้องบอกว่าเหตุไหนหาย");
  assert.equal(await readState(mon), "");

  // 6) ผ่านต่อเนื่อง → เงียบ
  requests = [];
  r = await alert(mon, 0, PROOF_OK);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /backup-alert=idle/);
  assert.equal(requests.length, 0);

  assertNoToken(await readAlerts(mon));
});

test("rc=0 และไม่มีเหตุค้าง → ไม่ส่งอะไรเลย", async () => {
  const mon = await newMonitorDir();
  const r = await alert(mon, 0, PROOF_OK);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /backup-alert=idle/);
  assert.equal(requests.length, 0);
});

test("แจ้งว่าหายแล้วแต่ส่งไม่ออก → ออก 1 และคงกุญแจไว้ให้รอบหน้าลองใหม่", async () => {
  const mon = await newMonitorDir();
  await writeFile(join(mon, "backup-proof-alerted"), `fail@${NIGHT1}\n`);
  reply = { status: 500, body: { ok: false, description: "Internal" } };
  const r = await alert(mon, 0, PROOF_OK);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /recovery-notification-failed/);
  assert.equal(await readState(mon), `fail@${NIGHT1}`);
  assert.match(await readAlerts(mon), /recovery-notification-failed/);
});

test("HTTP 200 แต่ {\"ok\":false} → นับว่าส่งไม่ออก ไม่จดกุญแจ", async () => {
  const mon = await newMonitorDir();
  reply = { status: 200, body: { ok: false, description: "Bad Request: chat not found" } };
  const r = await alert(mon, 1, proofFail(NIGHT1));
  assert.equal(r.code, 1, r.out);
  assert.equal(requests.length, 1);
  assert.equal(await readState(mon), "");
  assert.ok(r.out.includes("chat not found"), `ต้องยกเหตุผลของ Telegram มาด้วย: ${r.out}`);
});

test("ไม่มีไฟล์ env → ออก 1 พร้อม why= และไม่มีคำขอออกไปเลย", async () => {
  const mon = await newMonitorDir();
  const missing = join(dir, "no-such.env");
  const r = await alert(mon, 1, proofFail(NIGHT1), { FORMULA_TELEGRAM_ENV: missing });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /why=/);
  assert.equal(requests.length, 0);
  assert.equal(await readState(mon), "");
  assert.match(await readAlerts(mon), /notification-failed.*why=/);

  // ตัวส่งเองก็ต้องบอกเหตุผลตรง ๆ
  const n2 = await runSh([NOTIFY, "hello"], envFor({ FORMULA_TELEGRAM_ENV: missing }));
  assert.equal(n2.code, 1, n2.out);
  assert.match(n2.out, /^telegram=failed why=/);
});

test("สัญญา: monitor-formula.sh ส่งรหัสออกของตัวตรวจตัวจริงให้ตัวเตือน และส่งไม่ออกต้องลง warn", async () => {
  // บรรทัดคอมเมนต์ไม่นับ — คอมเมนต์ที่พูดถึงสคริปต์ไม่ได้ทำให้สคริปต์ถูกเรียก
  // (พฤติกรรมของตัวเตือนพิสูจน์ด้วยการรันจริงข้างบนแล้ว ตรงนี้แค่กันไม่ให้ใครถอดสายออกจาก monitor)
  const monitor = (await readFile(new URL("scripts/monitor-formula.sh", root), "utf8"))
    .split("\n").filter(line => !/^\s*#/.test(line)).join("\n");
  assert.match(monitor, /PROOF="\$\(sh "\$REPO_DIR\/scripts\/check-backup-status\.sh"[^\n]*\|\|\s*PROOF_RC=\$\?/);
  assert.match(monitor, /sh "\$REPO_DIR\/scripts\/alert-backup-proof\.sh" "\$PROOF_RC" "\$PROOF" "\$REPORT_DIR"/);
  assert.match(monitor, /alert-backup-proof\.sh[^\n]*\|\|\s*ALERT_RC=\$\?\s*\n\s*if\s+\[\s*"\$ALERT_RC"\s*=\s*0\s*\];\s*then\s*\n[^\n]*\n\s*else\s*\n\s*warn\s/,
    "ส่งไม่ออกต้องขึ้น WARN ใน monitor ไม่ใช่เงียบ (กฎ 5.3)");
});

test("notify-telegram.sh: ส่งสำเร็จพิมพ์ telegram=sent · ล้มพิมพ์ why= · ไม่เคยพิมพ์โทเค็น", async () => {
  let r = await runSh([NOTIFY, "ทดสอบ"], envFor());
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^telegram=sent /);
  assert.equal(requests.length, 1);
  assertNoToken(r.out);

  reply = { status: 401, body: { ok: false, description: "Unauthorized" } };
  r = await runSh([NOTIFY, "ทดสอบ"], envFor());
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^telegram=failed http=401 curl=0 why=/);
  assertNoToken(r.out);

  // ปลายทางปิดอยู่ (curl ต่อไม่ติด) — curl บางรุ่นพิมพ์ URL เต็มเส้นที่มีโทเค็นตอนล้ม
  r = await runSh([NOTIFY, "ทดสอบ"], envFor({ FORMULA_TELEGRAM_API: "http://127.0.0.1:1" }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /why=/);
  assertNoToken(r.out);
});

test("สถานะที่ไม่ใช่ fail (stale/none) เตือนซ้ำวันละครั้ง ไม่ใช่ครั้งเดียวแล้วเงียบตลอดไป", async () => {
  // งานสำรองตาย = เวลาของบรรทัดล่าสุดไม่ขยับอีกเลย ถ้ากุญแจไม่มีวันที่ จะได้ข้อความเดียวแล้วเงียบ
  const mon = await newMonitorDir();
  const stale = "backup-proof=stale at=2026-09-27T20:15:10Z อายุ=52ชม. why=ไม่มีผลงานสำรองใหม่";
  let r = await alert(mon, 1, stale, { FORMULA_ALERT_TODAY: "2026-09-29" });
  assert.equal(r.code, 0, r.out);
  assert.equal(await readState(mon), "stale@2026-09-27T20:15:10Z@2026-09-29");
  r = await alert(mon, 1, stale, { FORMULA_ALERT_TODAY: "2026-09-29" });
  assert.match(r.out, /already-sent/);
  assert.equal(requests.length, 1, "วันเดียวกันส่งครั้งเดียว");
  r = await alert(mon, 1, stale, { FORMULA_ALERT_TODAY: "2026-09-30" });
  assert.match(r.out, /backup-alert=sent/);
  assert.equal(requests.length, 2, "วันใหม่ เหตุยังไม่หาย ต้องเตือนอีก");

  requests = [];
  r = await alert(mon, 1, "backup-proof=none why=ไม่พบไฟล์", { FORMULA_ALERT_TODAY: "2026-09-30" });
  assert.equal(await readState(mon), "none@none@2026-09-30");
  assert.equal(requests.length, 1);
});

test("กุญแจอ่านจาก at= ช่องแรกเท่านั้น — at= ในข้อความ why ห้ามทำให้กุญแจค้าง", async () => {
  const mon = await newMonitorDir();
  const tricky = at => `backup-proof=fail at=${at} ล้มติดกัน=1คืน why=เจอ at=FROZEN ในข้อความ`;
  await alert(mon, 1, tricky(NIGHT1));
  assert.equal(await readState(mon), `fail@${NIGHT1}`);
  await alert(mon, 1, tricky(NIGHT2));
  assert.equal(requests.length, 2, "คืนที่สองต้องเตือน ไม่ใช่ติดกุญแจ FROZEN");
});

test("ส่งออกแล้วแต่จดสถานะไม่ได้ → บอกตรง ๆ ว่าส่งแล้ว มี why= ไม่ใช่ตายเงียบแล้วอ้างว่าส่งไม่ออก", async () => {
  const mon = await newMonitorDir();
  const state = join(mon, "backup-proof-alerted");
  await writeFile(state, "old@key\n");
  await chmod(state, 0o444);
  try {
    const r = await alert(mon, 1, proofFail(NIGHT1));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /sent-state-unwritable.*why=/);
    // ข้อความ error ของเชลล์ต้องไม่หลุดออกมา — monitor เก็บ stderr ด้วย จะกลายเป็นบรรทัดไม่มี why=
    assert.equal(r.out.split("\n").length, 1, `ต้องพิมพ์บรรทัดเดียว:\n${r.out}`);
    assert.doesNotMatch(r.out, /Permission denied/);
    assert.equal(requests.length, 1);
    assert.match(await readAlerts(mon), /sent-state-unwritable/);
  } finally {
    await chmod(state, 0o600);
  }
});

test(".env รูปแบบอื่นที่ dotenv รับ (CRLF · export · ช่องว่างรอบ =) ต้องส่งได้เหมือนกัน", async () => {
  const variants = {
    crlf: `TELEGRAM_BOT_TOKEN=${FAKE_TOKEN}\r\nTELEGRAM_HOME_CHANNEL=${FAKE_CHAT}\r\n`,
    export: `export TELEGRAM_BOT_TOKEN='${FAKE_TOKEN}'\nexport TELEGRAM_HOME_CHANNEL=${FAKE_CHAT}\n`,
    spaces: `TELEGRAM_BOT_TOKEN = ${FAKE_TOKEN}\nTELEGRAM_HOME_CHANNEL = "${FAKE_CHAT}"\n`,
  };
  for (const [name, body] of Object.entries(variants)) {
    requests = [];
    const f = join(dir, `${name}.env`);
    await writeFile(f, body);
    const r = await runSh([NOTIFY, "x"], envFor({ FORMULA_TELEGRAM_ENV: f }));
    assert.equal(r.code, 0, `${name}: ${r.out}`);
    assert.equal(requests[0]?.url, `/bot${FAKE_TOKEN}/sendMessage`, name);
    assert.equal(requests[0].form.get("chat_id"), FAKE_CHAT, name);
  }
});

test("fail ที่ค้างเกิน 30 ชม. (งานสำรองล้มแล้วไม่ได้รันอีก) เตือนซ้ำวันละครั้ง ไม่ใช่เงียบตลอดไป", async () => {
  const mon = await newMonitorDir();
  const old = Math.floor(Date.parse(NIGHT1) / 1000);
  const at = (hours, today) => ({ FORMULA_BACKUP_CHECK_NOW: String(old + hours * 3600), FORMULA_ALERT_TODAY: today });
  // ยังไม่เกินเกณฑ์ → กุญแจตามคืน ไม่มีวันที่
  await alert(mon, 1, proofFail(NIGHT1), at(2, "2026-09-27"));
  assert.equal(await readState(mon), `fail@${NIGHT1}`);
  // เกินเกณฑ์ บรรทัดเดิม → เตือนอีกและติดวันที่
  await alert(mon, 1, proofFail(NIGHT1), at(40, "2026-09-28"));
  assert.equal(await readState(mon), `fail@${NIGHT1}@2026-09-28`);
  let r = await alert(mon, 1, proofFail(NIGHT1), at(41, "2026-09-28"));
  assert.match(r.out, /already-sent/);
  await alert(mon, 1, proofFail(NIGHT1), at(200, "2026-10-05"));
  assert.equal(requests.length, 3, "หนึ่งครั้งตอนล้ม + วันละครั้งหลังค้าง");
});
