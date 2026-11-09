/* สำเนาสำรองนอกเครื่อง "ขึ้นคลาวด์จริง" หรือแค่เขียนลงดิสก์ — รันสคริปต์จริงทุกตัว
 *   scripts/copy-backup-offsite.sh   ตัวส่ง
 *   scripts/check-offsite-status.sh  ตัวตรวจใน monitor
 *   scripts/alert-backup-proof.sh    ตัวเตือน (ชนิด offsite)
 *
 * ทำไมต้องมี: 25 ส.ค. – 28 ก.ย. 2569 offsite.log ขึ้น "status=ok checksum=ok" ทุกคืน
 * ทั้งที่ Drive ไม่เคยได้ไฟล์เลยสักไฟล์ — checksum บอกได้แค่ว่าเขียนลงดิสก์ในเครื่องแล้ว
 * หลักฐานเดียวว่า Drive รู้จักไฟล์คือป้าย xattr `com.google.drivefs.item-id#S`
 * เทสต์นี้จึงจำลอง "Drive" ด้วยการเขียนป้ายนั้นเอง (หรือไม่เขียน) แล้วดูว่าสคริปต์เชื่อป้าย ไม่ใช่เชื่อ cp
 *
 * ความปลอดภัย: ห้ามแตะ Drive จริง ~/.hermes จริง หรือ Telegram จริง ทุกการรันตั้ง
 *   - FORMULA_DRIVE_ROOT → โฟลเดอร์ชั่วคราว (ถ้าหลุด ค่าเริ่มต้นชี้ ~/Library/CloudStorage จริง
 *     จึงมีด่าน assert ใน envFor() ว่าต้องอยู่ใต้โฟลเดอร์ชั่วคราวเสมอ)
 *   - FORMULA_STATE_DIR → โฟลเดอร์ชั่วคราว (offsite.log ไม่ลง ~/.hermes)
 *   - FORMULA_TELEGRAM_ENV / FORMULA_TELEGRAM_API → env ปลอม + เซิร์ฟเวอร์ปลอมบน 127.0.0.1
 *   - FORMULA_ALERT_NO_DESKTOP=1 และ HOME → โฟลเดอร์ชั่วคราว
 * "Drive ไม่ได้ mount" จำลองด้วยพาธที่ไม่มีอยู่ "ใต้โฟลเดอร์ชั่วคราว" — ห้ามลบตัวแปรทิ้ง
 *
 * ทำไมใช้ spawn ไม่ใช่ spawnSync: Drive ปลอม (ตัวติดป้าย) และเซิร์ฟเวอร์ Telegram ปลอม
 * อยู่ในโปรเซสเดียวกับเทสต์ spawnSync บล็อก event loop ทั้งคู่จะไม่ได้ทำงาน
 *
 * FORMULA_OFFSITE_SCRIPTS ใช้เฉพาะตอนทำ mutation test กับ "สำเนา" ของโฟลเดอร์ scripts/
 * (ต้องคัดลอกทั้งโฟลเดอร์ เพราะตัวส่ง/ตัวตรวจ source offsite-dest.sh จากโฟลเดอร์ตัวเอง)
 */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test, { after, before, beforeEach } from "node:test";

const run = promisify(execFile);
const root = new URL("../", import.meta.url);
const SCRIPTS = process.env.FORMULA_OFFSITE_SCRIPTS || fileURLToPath(new URL("scripts/", root));
const COPY = join(SCRIPTS, "copy-backup-offsite.sh");
const CHECK = join(SCRIPTS, "check-offsite-status.sh");
const ALERT = join(SCRIPTS, "alert-backup-proof.sh");
const PROOF_CHECK = join(SCRIPTS, "check-backup-status.sh");

const XATTR = "com.google.drivefs.item-id#S";
const DEST_NAME = "Formula Studio Backups"; // ต้องตรงกับ offsite-dest.sh — ตรวจอีกทีในเทสต์สัญญา
const FAKE_TOKEN = "999000111:FAKE-token-never-real_abcXYZ";

// ป้ายของ Drive เป็นของ macOS — เครื่องที่ไม่มีคำสั่ง xattr ทดสอบเรื่องนี้ไม่ได้ ข้ามทั้งไฟล์ดีกว่าเขียวหลอก
const hasXattr = await run("sh", ["-c", "command -v xattr"]).then(() => true, () => false);
const skip = hasXattr ? false : "ไม่มีคำสั่ง xattr (ไม่ใช่ macOS)";

let dir, home, envFile, server, api;
let requests = [];
let reply = { status: 200, body: { ok: true, result: {} } };

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "offsite-upload-test-"));
  home = join(dir, "home");
  await mkdir(home);
  envFile = join(dir, "hermes.env");
  await writeFile(envFile, `TELEGRAM_BOT_TOKEN="${FAKE_TOKEN}"\nTELEGRAM_HOME_CHANNEL=-100424242\n`);
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", c => { raw += c; });
    req.on("end", () => {
      requests.push({ url: req.url, form: new URLSearchParams(raw) });
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  api = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(r => server.close(r));
  if (dir) await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  requests = [];
  reply = { status: 200, body: { ok: true, result: {} } };
});

let n = 0;
async function fresh(label) {
  const d = join(dir, `${label}-${++n}`);
  await mkdir(d, { recursive: true });
  return d;
}

// ทุกการรันได้ตัวแปรครบหกตัวเสมอ — ตัวไหนหลุด ค่าเริ่มต้นของสคริปต์ชี้ของจริงทั้งหมด
function envFor({ driveRoot, stateDir, ...overrides }) {
  assert.ok(driveRoot && driveRoot.startsWith(dir), `FORMULA_DRIVE_ROOT ต้องอยู่ใต้โฟลเดอร์ชั่วคราว: ${driveRoot}`);
  assert.ok(stateDir && stateDir.startsWith(dir), `FORMULA_STATE_DIR ต้องอยู่ใต้โฟลเดอร์ชั่วคราว: ${stateDir}`);
  const env = { ...process.env, HOME: home, FORMULA_DRIVE_ROOT: driveRoot, FORMULA_BACKUP_DESTINATION: "drive", FORMULA_STATE_DIR: stateDir,
    FORMULA_TELEGRAM_ENV: envFile, FORMULA_TELEGRAM_API: api, FORMULA_ALERT_NO_DESKTOP: "1" };
  for (const k of ["FORMULA_TELEGRAM_CHAT_ID", "FORMULA_OFFSITE_UPLOAD_WAIT_SECONDS",
    "FORMULA_OFFSITE_MAX_LAG_HOURS", "FORMULA_BACKUP_CHECK_NOW", "FORMULA_ALERT_TODAY",
    "FORMULA_BACKUP_MAX_AGE_HOURS"]) delete env[k];
  return { ...env, ...overrides };
}

function runSh(args, env, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const p = spawn("sh", args, { env });
    let out = "";
    p.stdout.on("data", c => { out += c; });
    p.stderr.on("data", c => { out += c; });
    const timer = setTimeout(() => { p.kill("SIGKILL"); reject(new Error(`ค้างเกิน ${timeoutMs / 1000} วิ:\n${out}`)); }, timeoutMs);
    p.on("error", reject);
    p.on("close", code => { clearTimeout(timer); resolve({ code, out: out.trim() }); });
  });
}

const tag = (file, id = "fake-drive-id") => run("xattr", ["-w", XATTR, id, file]);
const tagged = file => run("xattr", ["-p", XATTR, file]).then(() => true, () => false);

// ชุดสำรองปลอมหน้าตาเหมือนของจริง: formula.dump + ไฟล์ประกอบ + SHA256SUMS
// SHA256SUMS ต้องเป็นชื่อสัมพัทธ์ (รัน shasum ในโฟลเดอร์นั้น) — ถ้าเป็นพาธเต็ม
// `cd $DEST && shasum -c` จะไปตรวจไฟล์ต้นทางแทน แล้วผ่านทั้งที่สำเนาเสีย
async function writeSums(dir, paths) {
  const { stdout } = await run("shasum", ["-a", "256", ...paths], { cwd: dir });
  await writeFile(join(dir, "SHA256SUMS"), stdout);
}

async function filesBelow(dir, relative = "") {
  const files = [];
  for (const entry of await readdir(join(dir, relative), { withFileTypes: true }).catch(() => [])) {
    const name = relative ? join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...await filesBelow(dir, name));
    else if (entry.isFile()) files.push(name);
  }
  return files;
}

async function makeSet(stamp = "20260928-031500", { nested = false } = {}) {
  const src = join(await fresh("src"), stamp);
  await mkdir(src);
  await writeFile(join(src, "formula.dump"), `PGDMP fake dump ${stamp}\n`.repeat(50));
  await writeFile(join(src, "manifest.txt"), `stamp=${stamp}\n`);
  const paths = ["formula.dump", "manifest.txt"];
  if (nested) {
    await mkdir(join(src, "job-intake", "receipts"), { recursive: true });
    await writeFile(join(src, "job-intake", "receipts", "receipt.json"), '{"receipt":"nested"}\n');
    paths.push("job-intake/receipts/receipt.json");
  }
  await writeSums(src, paths);
  // ต้นทางต้องไม่มีป้าย — cp ของ macOS พาป้ายติดไปด้วย ถ้าต้นทางมีป้าย "ok" ทุกข้อจะว่างเปล่า
  for (const f of await filesBelow(src)) assert.equal(await tagged(join(src, f)), false, `ต้นทางมีป้ายติดมา: ${f}`);
  return src;
}

// Drive ปลอม: คอยดูโฟลเดอร์ปลายทาง แล้วติดป้ายให้ทุกไฟล์ที่โผล่มา (รวม SHA256SUMS)
function fakeDrive(destDir, only = () => true) {
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      const files = (await filesBelow(destDir)).filter(only);
      for (const f of files) await tag(join(destDir, f)).catch(() => {});
      await new Promise(r => setTimeout(r, 200));
    }
  })();
  return async () => { stopped = true; await loop; };
}

async function driveFixture() {
  const base = await fresh("drive");
  const driveRoot = join(base, "My Drive");
  await mkdir(driveRoot);
  const stateDir = await fresh("state");
  return { driveRoot, stateDir, destRoot: join(driveRoot, DEST_NAME) };
}

// ───────────────────────── copy-backup-offsite.sh ─────────────────────────

test("copy: Drive ติดป้ายครบ → status=ok uploaded=ok ออก 0 · ไฟล์ครบ · log ลง FORMULA_STATE_DIR", { skip }, async () => {
  const { driveRoot, stateDir, destRoot } = await driveFixture();
  const src = await makeSet("20260928-031500");
  const dest = join(destRoot, "20260928-031500");
  await mkdir(dest, { recursive: true });
  const stop = fakeDrive(dest);
  let r;
  try {
    r = await runSh([COPY, src], envFor({ driveRoot, stateDir, FORMULA_OFFSITE_UPLOAD_WAIT_SECONDS: "20" }));
  } finally { await stop(); }
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /offsite status=ok stamp=20260928-031500 .*checksum=ok uploaded=ok waited=\d+s/);
  for (const f of ["formula.dump", "manifest.txt", "SHA256SUMS"]) {
    assert.equal(await readFile(join(dest, f), "utf8"), await readFile(join(src, f), "utf8"), f);
  }
  const log = await readFile(join(stateDir, "monitoring", "offsite.log"), "utf8");
  assert.match(log, /offsite status=ok /);
});

test("copy: ทุกพาธใน manifest รวม job-intake ที่ซ้อนอยู่ ถูกคัดลอก ตรวจ checksum และได้ป้ายครบ", { skip }, async () => {
  const { driveRoot, stateDir, destRoot } = await driveFixture();
  const stamp = "20260928-031506";
  const src = await makeSet(stamp, { nested: true });
  const dest = join(destRoot, stamp);
  await mkdir(dest, { recursive: true });
  const stop = fakeDrive(dest);
  let r;
  try {
    r = await runSh([COPY, src], envFor({ driveRoot, stateDir, FORMULA_OFFSITE_UPLOAD_WAIT_SECONDS: "20" }));
  } finally { await stop(); }
  assert.equal(r.code, 0, r.out);
  assert.equal(await readFile(join(dest, "job-intake", "receipts", "receipt.json"), "utf8"),
    await readFile(join(src, "job-intake", "receipts", "receipt.json"), "utf8"));
  const check = await run("shasum", ["-a", "256", "-c", "SHA256SUMS"], { cwd: dest });
  assert.match(check.stdout, /job-intake\/receipts\/receipt\.json: OK/);
  assert.equal(await tagged(join(dest, "job-intake", "receipts", "receipt.json")), true);
});

test("copy: Drive ไม่เคยติดป้าย → status=pending ออก 3 พร้อม why= และชื่อไฟล์ที่ค้าง (ไม่ใช่ ok เพราะ checksum ผ่าน)", { skip }, async () => {
  const { driveRoot, stateDir } = await driveFixture();
  const src = await makeSet();
  // WAIT=0: ไม่รอเลย · WAIT=5: วนหนึ่งรอบแล้วต้องหยุดเอง ไม่ค้าง
  for (const wait of ["0", "5"]) {
    const t0 = Date.now();
    const r = await runSh([COPY, src], envFor({ driveRoot, stateDir, FORMULA_OFFSITE_UPLOAD_WAIT_SECONDS: wait }));
    assert.equal(r.code, 3, r.out);
    assert.match(r.out, /offsite status=pending stamp=\S+ .*checksum=ok why=/);
    assert.doesNotMatch(r.out, /status=ok|uploaded=ok/);
    assert.match(r.out, /formula\.dump/, "ต้องบอกว่าไฟล์ไหนยังไม่ขึ้น");
    assert.ok(Date.now() - t0 < 15_000, `WAIT=${wait} ใช้เวลานานเกิน`);
  }
});

test("copy: ติดป้ายแค่บางไฟล์ → ยัง pending (ต้องครบทุกไฟล์ ไม่ใช่แค่ formula.dump)", { skip }, async () => {
  const { driveRoot, stateDir, destRoot } = await driveFixture();
  const src = await makeSet("20260928-031501");
  const dest = join(destRoot, "20260928-031501");
  await mkdir(dest, { recursive: true });
  // Drive ปลอมที่รู้จักแค่ formula.dump — ไฟล์อื่นไม่เคยได้ป้าย
  // (ติดป้ายไว้ล่วงหน้าไม่ได้: cp ของ macOS ทับไฟล์แล้วป้ายเดิมหาย ป้ายตามไฟล์ต้นทางไป)
  const stop = fakeDrive(dest, f => f === "formula.dump");
  let r;
  try {
    r = await runSh([COPY, src], envFor({ driveRoot, stateDir, FORMULA_OFFSITE_UPLOAD_WAIT_SECONDS: "5" }));
  } finally { await stop(); }
  assert.equal(await tagged(join(dest, "formula.dump")), true, "Drive ปลอมไม่ได้ติดป้าย — เทสต์ไม่ได้ทดสอบอะไร");
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /why=.*manifest\.txt/);
  assert.doesNotMatch(r.out, /\(\s*[^)]*formula\.dump/, "formula.dump มีป้ายแล้ว ไม่ควรอยู่ในรายการค้าง");
});

test("copy: Drive ไม่ได้ mount → status=skip ออก 0 และไม่สร้างโฟลเดอร์ Drive ขึ้นมาเอง", { skip }, async () => {
  const base = await fresh("drive-missing");
  const driveRoot = join(base, "not-mounted");
  const stateDir = await fresh("state");
  const src = await makeSet();
  const r = await runSh([COPY, src], envFor({ driveRoot, stateDir, FORMULA_OFFSITE_UPLOAD_WAIT_SECONDS: "0" }));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /offsite status=skip why=/);
  await assert.rejects(stat(driveRoot), "สร้างโฟลเดอร์ Drive ปลอมขึ้นมาเอง = ไฟล์ไปอยู่บนดิสก์เครื่องนี้ แล้วเข้าใจว่าส่งแล้ว");
});

test("copy: checksum ไม่ตรง / ไม่มี SHA256SUMS → ออก 1 fail · ไม่มีโฟลเดอร์ต้นทาง → ออก 2", { skip }, async () => {
  const { driveRoot, stateDir } = await driveFixture();
  const env = envFor({ driveRoot, stateDir, FORMULA_OFFSITE_UPLOAD_WAIT_SECONDS: "0" });

  const bad = await makeSet("20260928-031502");
  const sums = await readFile(join(bad, "SHA256SUMS"), "utf8");
  await writeFile(join(bad, "SHA256SUMS"), sums.replace(/^[0-9a-f]{8}/, "00000000"));
  let r = await runSh([COPY, bad], env);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /offsite status=fail why=checksum/);
  assert.doesNotMatch(r.out, /status=ok|status=pending/);

  const nosums = await makeSet("20260928-031503");
  await rm(join(nosums, "SHA256SUMS"));
  r = await runSh([COPY, nosums], env);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /offsite status=fail why=.*SHA256SUMS/);

  r = await runSh([COPY, join(dir, "no-such-set")], env);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /offsite status=fail why=/);
});

test("copy: SHA256SUMS ที่มีพาธออกนอกชุดสำรอง → fail ก่อนสร้างปลายทาง", { skip }, async () => {
  const { driveRoot, stateDir, destRoot } = await driveFixture();
  const stamp = "20260928-031503-unsafe";
  const src = await makeSet(stamp);
  const sums = await readFile(join(src, "SHA256SUMS"), "utf8");
  await writeFile(join(src, "SHA256SUMS"), `${sums}${"0".repeat(64)}  ../outside.json\n`);
  const r = await runSh([COPY, src], envFor({ driveRoot, stateDir, FORMULA_OFFSITE_UPLOAD_WAIT_SECONDS: "0" }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /พาธไม่ปลอดภัย/);
  await assert.rejects(stat(join(destRoot, stamp)), "invalid manifest must fail before creating a Drive destination");
});

test("copy: นับชุดบน Drive ถูก (N+1) · อ่านรายการไม่ได้ต้องบอก why= ไม่ใช่พิมพ์ 0", { skip }, async () => {
  const { driveRoot, stateDir, destRoot } = await driveFixture();
  for (const s of ["20260926-031500", "20260927-031500"]) await mkdir(join(destRoot, s), { recursive: true });
  const src = await makeSet("20260928-031504");
  let r = await runSh([COPY, src], envFor({ driveRoot, stateDir, FORMULA_OFFSITE_UPLOAD_WAIT_SECONDS: "0" }));
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /สำเนาบน Drive ทั้งหมด 3 ชุด/);

  // อ่านโฟลเดอร์ไม่ได้แต่ยังเข้า/เขียนได้ (0300) — mkdir/cp/xattr ยังทำงาน แต่ ls ล้ม
  // *หลักฐาน: เดิม 2>/dev/null ทำให้ขึ้น "ทั้งหมด 0 ชุด" ทุกคืน ทั้งที่มี 22 ชุด*
  const src2 = await makeSet("20260928-031505");
  await chmod(destRoot, 0o300);
  try {
    r = await runSh([COPY, src2], envFor({ driveRoot, stateDir, FORMULA_OFFSITE_UPLOAD_WAIT_SECONDS: "0" }));
  } finally { await chmod(destRoot, 0o755); }
  assert.equal(r.code, 3, r.out);
  // ใต้ launchd อ่านรายการไม่ได้ทุกคืน — บอกเป็นข้อมูลประกอบ ไม่ใช่ why= (ไม่งั้นบรรทัด ok มี why= ทุกคืน)
  assert.match(r.out, /จำนวนชุดบน Drive: นับไม่ได้/);
  assert.doesNotMatch(r.out, /ทั้งหมด 0 ชุด/);
});

// ───────────────────────── check-offsite-status.sh ─────────────────────────

const OK_AT = "2026-09-27T20:15:09Z";
const OK_EPOCH = Math.floor(Date.parse(OK_AT) / 1000);
// dest= เป็นพาธเต็มที่ไม่มีอยู่จริง — พิสูจน์ว่าตัวตรวจใช้แค่ชื่อชุด ไปดูบน Drive ไม่ใช่เปิดโฟลเดอร์ในเครื่อง
// รูปบรรทัดตาม say() + บรรทัด ok ของ daily-backup-formula.sh (ตรึงไว้ในเทสต์สัญญาท้ายไฟล์)
const okLine = (at, stamp) =>
  `${at} daily-backup status=ok kind=daily dest=/nonexistent/.hermes/backups/daily/${stamp} restore-proof=ok`;

async function checkFixture(logLines, { file = "tagged", stamp = "20260928-031500", sourceNested = false } = {}) {
  const fx = await driveFixture();
  const source = join(fx.stateDir, "restore-proven", stamp);
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "formula.dump"), "x");
  const paths = ["formula.dump"];
  if (sourceNested) {
    await mkdir(join(source, "job-intake", "receipts"), { recursive: true });
    await writeFile(join(source, "job-intake", "receipts", "receipt.json"), "nested\n");
    paths.push("job-intake/receipts/receipt.json");
  }
  await writeSums(source, paths);
  const log = join(fx.stateDir, "backup.log");
  await writeFile(log, logLines.map(line => line.replace(`/nonexistent/.hermes/backups/daily/${stamp}`, source)).join("\n") + "\n");
  if (file !== "none") {
    const d = join(fx.destRoot, stamp);
    await mkdir(d, { recursive: true });
    await writeFile(join(d, "formula.dump"), "x");
    if (sourceNested) {
      await mkdir(join(d, "job-intake", "receipts"), { recursive: true });
      await writeFile(join(d, "job-intake", "receipts", "receipt.json"), "nested\n");
    }
    await writeSums(d, paths);
    if (file === "tagged") {
      await tag(join(d, "formula.dump"));
      await tag(join(d, "SHA256SUMS"));
    }
  }
  return { ...fx, log };
}
const check = (fx, hoursAfter, extra = {}) => runSh([CHECK, fx.log], envFor({
  driveRoot: fx.driveRoot, stateDir: fx.stateDir,
  FORMULA_BACKUP_CHECK_NOW: String(OK_EPOCH + Math.round(hoursAfter * 3600)), ...extra }));

test("check: formula.dump ของชุดล่าสุดมีป้าย → offsite=ok ออก 0", { skip }, async () => {
  const fx = await checkFixture([okLine(OK_AT, "20260928-031500")]);
  const r = await check(fx, 10);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^offsite=ok stamp=20260928-031500 /);
});

test("check: formula.dump มีป้ายอย่างเดียว แต่พาธ nested ใน manifest หาย → ห้าม offsite=ok", { skip }, async () => {
  const fx = await checkFixture([okLine(OK_AT, "20260928-031500")], { sourceNested: true });
  const d = join(fx.destRoot, "20260928-031500");
  await rm(join(d, "job-intake"), { recursive: true, force: true });
  const r = await check(fx, 10);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^offsite=missing stamp=20260928-031500 .*why=/);
  assert.match(r.out, /job-intake\/receipts\/receipt\.json/);
});

test("check: ไฟล์ครบและมีป้ายครบ แต่ checksum เปลี่ยน → ห้าม offsite=ok", { skip }, async () => {
  const fx = await checkFixture([okLine(OK_AT, "20260928-031500")]);
  const d = join(fx.destRoot, "20260928-031500");
  await writeFile(join(d, "formula.dump"), "changed after upload");
  const r = await check(fx, 10);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^offsite=corrupt stamp=20260928-031500 .*why=/);
  assert.match(r.out, /checksum/);

  const fresh = await check(fx, 1);
  assert.equal(fresh.code, 1, fresh.out);
  assert.match(fresh.out, /^offsite=corrupt stamp=20260928-031500 .*why=/);
  assert.match(fresh.out, /ต้องตรวจทันที/);
  assert.doesNotMatch(fresh.out, /เกิน 6 ชม/);
});

test("check: manifest บน Drive ถูกตัดให้เหลือ subset ที่ checksum ตรงเอง → ห้าม offsite=ok", { skip }, async () => {
  const fx = await checkFixture([okLine(OK_AT, "20260928-031500")], { sourceNested: true });
  const d = join(fx.destRoot, "20260928-031500");
  await rm(join(d, "job-intake"), { recursive: true, force: true });
  await writeSums(d, ["formula.dump"]);
  await tag(join(d, "formula.dump"));
  await tag(join(d, "SHA256SUMS"));
  const r = await check(fx, 10);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^offsite=invalid stamp=20260928-031500 .*why=/);
  assert.match(r.out, /ไม่ตรงกับชุดที่พิสูจน์กู้คืนแล้วในเครื่อง/);

  const fresh = await check(fx, 1);
  assert.equal(fresh.code, 1, fresh.out);
  assert.match(fresh.out, /^offsite=invalid stamp=20260928-031500 .*why=/);
  assert.match(fresh.out, /ต้องตรวจทันที/);
});

test("check: ไม่มีป้าย/ไม่มีไฟล์ ภายในช่วงรอ → ออก 0 'ยังอยู่ในช่วงรอ' · เกินช่วง → ออก 1 พร้อม why= (ขอบ 6 ชม.)", { skip }, async () => {
  for (const [file, state] of [["untagged", "pending"], ["none", "missing"]]) {
    const fx = await checkFixture([okLine(OK_AT, "20260928-031500")], { file });
    const lag = { FORMULA_OFFSITE_MAX_LAG_HOURS: "6" };

    let r = await check(fx, 5 + 59 / 60, lag);
    assert.equal(r.code, 0, `${state}: ${r.out}`);
    assert.match(r.out, new RegExp(`^offsite=${state} stamp=20260928-031500 .*ยังอยู่ในช่วงรอ`));
    assert.doesNotMatch(r.out, /why=/);

    r = await check(fx, 6, lag);
    assert.equal(r.code, 1, `${state}: ${r.out}`);
    assert.match(r.out, new RegExp(`^offsite=${state} stamp=20260928-031500 .*why=\\S`));

    // ค่าเริ่มต้นของเกณฑ์คือ 6 ชม. — ไม่ตั้งตัวแปรก็ต้องได้ผลเดียวกัน
    r = await check(fx, 7);
    assert.equal(r.code, 1, `${state} (ค่าเริ่มต้น): ${r.out}`);
  }
});

test("check: Drive ไม่ได้ mount → unmounted ออก 1 · ไม่มีบรรทัด ok / ไม่มีไฟล์ log → unknown ออก 1", { skip }, async () => {
  const fx = await checkFixture([okLine(OK_AT, "20260928-031500")]);
  let r = await runSh([CHECK, fx.log], envFor({ driveRoot: join(fx.driveRoot, "gone"), stateDir: fx.stateDir,
    FORMULA_BACKUP_CHECK_NOW: String(OK_EPOCH + 3600) }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^offsite=unmounted stamp=20260928-031500 .*why=\S/);

  const none = await checkFixture([
    "2026-09-27T20:15:09Z daily-backup status=fail why=กู้คืนไม่ผ่าน dest=/x/20260928-031500",
  ]);
  r = await check(none, 1);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^offsite=unknown why=\S/);

  r = await runSh([CHECK, join(fx.stateDir, "no-backup.log")], envFor({ driveRoot: fx.driveRoot, stateDir: fx.stateDir }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^offsite=unknown why=\S/);
});

test("check: ใช้บรรทัด ok 'ล่าสุด' — ไม่ใช่บรรทัด fail/warn ที่ตามมา และไม่ใช่ ok ชุดเก่าที่บังเอิญขึ้นแล้ว", { skip }, async () => {
  // ok ตามด้วย fail และ warn ของคืนหลัง → ยังต้องดูชุดของบรรทัด ok (ชุดที่ fail ไม่ถูกส่งออกอยู่แล้ว)
  const fx = await checkFixture([
    okLine(OK_AT, "20260928-031500"),
    "2026-09-28T20:15:09Z daily-backup warn=ส่งสำเนาออกนอกเครื่องไม่สำเร็จ ดู offsite.log",
    "2026-09-28T20:16:09Z daily-backup status=fail why=กู้คืนไม่ผ่าน dest=/x/20260929-031500",
  ]);
  let r = await check(fx, 30);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^offsite=ok stamp=20260928-031500 /);

  // ok สองบรรทัด: ชุดเก่ามีป้าย ชุดใหม่ไม่มีและเกินช่วงรอ → ต้องไม่ ok (พิสูจน์ว่าดู "ล่าสุด" ไม่ใช่ "ชุดไหนก็ได้")
  const two = await checkFixture([
    okLine("2026-09-26T20:15:09Z", "20260927-031500"),
    okLine(OK_AT, "20260928-031500"),
  ], { file: "untagged", stamp: "20260928-031500" });
  const old = join(two.destRoot, "20260927-031500");
  await mkdir(old, { recursive: true });
  await writeFile(join(old, "formula.dump"), "x");
  await tag(join(old, "formula.dump"));
  r = await check(two, 10);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^offsite=pending stamp=20260928-031500 .*why=/);
});

// ───────────────────────── alert-backup-proof.sh offsite ─────────────────────────

// บรรทัดผลสร้างจากตัวตรวจตัวจริง ไม่พิมพ์เองในเทสต์ (กฎ 6.3)
async function realOffsiteLine(kind, hoursAfter = 10) {
  const fx = await checkFixture([okLine(OK_AT, "20260928-031500")], { file: kind === "ok" ? "tagged" : "untagged" });
  const r = await check(fx, hoursAfter);
  return { rc: r.code, line: r.out };
}
async function realProofFail() {
  const log = join(await fresh("proof"), "backup.log");
  await writeFile(log, `${OK_AT} daily-backup status=fail why=กู้คืนไม่ผ่าน dest=/x\n`);
  const r = await runSh([PROOF_CHECK, log], { ...process.env, HOME: home, FORMULA_BACKUP_CHECK_NOW: String(OK_EPOCH + 3600) });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^backup-proof=fail at=/);
  return r.out;
}

async function alertEnv(extra = {}) {
  const mon = await fresh("monitoring");
  const { driveRoot, stateDir } = await driveFixture();
  const env = envFor({ driveRoot, stateDir, FORMULA_BACKUP_CHECK_NOW: String(OK_EPOCH + 3600),
    FORMULA_ALERT_TODAY: "2026-09-28", ...extra });
  return { mon, env };
}
const alert = (mon, env, rc, line, kind) => runSh([ALERT, String(rc), line, mon, ...(kind ? [kind] : [])], env);
const readState = async (mon, name) => (await readFile(join(mon, name), "utf8").catch(() => "")).trim();

test("alert offsite: ไฟล์สถานะแยกจากเรื่องกู้คืน — เตือนเรื่องหนึ่งต้องไม่ทำให้อีกเรื่องเงียบ (ทั้งสองทิศ)", { skip }, async () => {
  const pend = await realOffsiteLine("pending");
  assert.equal(pend.rc, 1, pend.line);
  const proof = await realProofFail();

  for (const order of [["proof", "offsite"], ["offsite", "proof"]]) {
    const { mon, env } = await alertEnv();
    requests = [];
    for (const k of order) {
      const r = k === "proof" ? await alert(mon, env, 1, proof) : await alert(mon, env, 1, pend.line, "offsite");
      assert.equal(r.code, 0, `${order}: ${r.out}`);
      assert.match(r.out, k === "proof" ? /^backup-alert=sent / : /^offsite-alert=sent key=pending@20260928-031500@2026-09-28$/);
    }
    assert.equal(requests.length, 2, `${order}: ต้องส่งทั้งสองเรื่อง`);
    assert.match(await readState(mon, "backup-proof-alerted"), /^fail@/);
    assert.equal(await readState(mon, "backup-offsite-alerted"), "pending@20260928-031500@2026-09-28");
    const texts = requests.map(q => q.form.get("text"));
    assert.ok(texts.some(t => t.includes("สำเนานอกเครื่องบน Google Drive ยังไม่ครบ")), "ข้อความ offsite ต้องบอกว่าสำเนานอกเครื่องไม่ครบ");
    assert.ok(texts.some(t => t.includes("จุดกู้คืนไม่ได้")), "ข้อความ proof ต้องเป็นเรื่องกู้คืน");
  }

  // offsite กลับมา ok → ล้างเฉพาะไฟล์ของ offsite ไฟล์ของ proof ต้องอยู่เหมือนเดิม
  const { mon, env } = await alertEnv();
  await alert(mon, env, 1, proof);
  await alert(mon, env, 1, pend.line, "offsite");
  const ok = await realOffsiteLine("ok");
  assert.equal(ok.rc, 0, ok.line);
  const r = await alert(mon, env, 0, ok.line, "offsite");
  assert.match(r.out, /^offsite-alert=recovered-sent /);
  assert.equal(await readState(mon, "backup-offsite-alerted"), "");
  assert.match(await readState(mon, "backup-proof-alerted"), /^fail@/, "offsite หายแล้วห้ามล้างสถานะเรื่องกู้คืน");
});

test("alert offsite: เตือนวันละครั้ง — วันเดียวกันเงียบ · วันถัดไปเตือนซ้ำ (ชุดเดิมค้างไม่ขยับ)", { skip }, async () => {
  const pend = await realOffsiteLine("pending");
  const { mon, env } = await alertEnv();
  let r = await alert(mon, env, 1, pend.line, "offsite");
  assert.match(r.out, /^offsite-alert=sent key=pending@20260928-031500@2026-09-28$/);
  r = await alert(mon, env, 1, pend.line, "offsite");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^offsite-alert=already-sent /);
  assert.equal(requests.length, 1);

  r = await alert(mon, { ...env, FORMULA_ALERT_TODAY: "2026-09-29" }, 1, pend.line, "offsite");
  assert.match(r.out, /^offsite-alert=sent key=pending@20260928-031500@2026-09-29$/);
  assert.equal(requests.length, 2);

  // unmounted ไม่มีป้ายชุดเปลี่ยน แต่สถานะต่าง → กุญแจใหม่ ส่งทันที
  const fx = await checkFixture([okLine(OK_AT, "20260928-031500")]);
  const um = await runSh([CHECK, fx.log], envFor({ driveRoot: join(fx.driveRoot, "gone"), stateDir: fx.stateDir,
    FORMULA_BACKUP_CHECK_NOW: String(OK_EPOCH + 3600) }));
  r = await alert(mon, { ...env, FORMULA_ALERT_TODAY: "2026-09-29" }, um.code, um.out, "offsite");
  assert.match(r.out, /^offsite-alert=sent key=unmounted@20260928-031500@2026-09-29$/);
});

test("alert offsite: กลับมาขึ้นแล้ว → ส่งข้อความหาย · ล้างสถานะ · รอบต่อไป idle", { skip }, async () => {
  const pend = await realOffsiteLine("pending");
  const ok = await realOffsiteLine("ok");
  const { mon, env } = await alertEnv();
  let r = await alert(mon, env, 0, ok.line, "offsite");
  assert.equal(r.out, "offsite-alert=idle", "ยังไม่เคยเตือน ไม่มีอะไรให้บอกว่าหาย");
  assert.equal(requests.length, 0);

  await alert(mon, env, 1, pend.line, "offsite");
  r = await alert(mon, env, 0, ok.line, "offsite");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^offsite-alert=recovered-sent prev=pending@20260928-031500@2026-09-28$/);
  assert.match(requests.at(-1).form.get("text"), /ชุดสำรองเต็มขึ้น Google Drive และตรวจครบแล้ว/);
  assert.equal(await readState(mon, "backup-offsite-alerted"), "");
  r = await alert(mon, env, 0, ok.line, "offsite");
  assert.equal(r.out, "offsite-alert=idle");
  assert.equal(requests.length, 2);
});

test("alert offsite: Telegram ส่งไม่ออก → ไม่จดกุญแจ (กฎ 5.3) รอบหน้าลองใหม่", { skip }, async () => {
  const pend = await realOffsiteLine("pending");
  const { mon, env } = await alertEnv();
  reply = { status: 401, body: { ok: false, description: "Unauthorized" } };
  let r = await alert(mon, env, 1, pend.line, "offsite");
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^offsite-alert=notification-failed .*why=/);
  assert.equal(await readState(mon, "backup-offsite-alerted"), "");
  assert.ok(!r.out.includes(FAKE_TOKEN));

  reply = { status: 200, body: { ok: true, result: {} } };
  r = await alert(mon, env, 1, pend.line, "offsite");
  assert.match(r.out, /^offsite-alert=sent /);
  assert.equal(requests.length, 2);
});

// บั๊กที่พบตอนเขียนเทสต์นี้ (แก้แล้ว 28 ก.ย.): ตัวตรวจออก 0 ทั้ง "ok" และ "ยังอยู่ในช่วงรอ"
// ตัวเตือนถือ rc=0 เป็น "หายแล้ว" → คืนที่ 1 เตือนว่าค้าง · คืนที่ 2 ชุดใหม่ก็ยังไม่ขึ้นแต่อยู่ในช่วงรอ
// → ส่ง "✅ สำรองขึ้น Google Drive แล้ว" ทั้งที่ไฟล์ยังอยู่แค่ในเครื่อง แล้วอีก 6 ชม. เตือนใหม่
test("alert offsite: 'ยังอยู่ในช่วงรอ' ต้องไม่ถูกประกาศว่าขึ้น Drive แล้ว", { skip }, async () => {
  const pend = await realOffsiteLine("pending", 10);
  const { mon, env } = await alertEnv();
  await alert(mon, env, 1, pend.line, "offsite");
  const waiting = await realOffsiteLine("pending", 1);
  assert.equal(waiting.rc, 0, waiting.line);
  assert.match(waiting.line, /ยังอยู่ในช่วงรอ/);
  const r = await alert(mon, env, waiting.rc, waiting.line, "offsite");
  assert.doesNotMatch(r.out, /recovered/, `ประกาศว่าหายทั้งที่ยังไม่ขึ้น: ${r.out}`);
  assert.ok(!requests.some(q => /ชุดสำรองเต็มขึ้น Google Drive/.test(q.form.get("text"))),
    "ส่งข้อความ ✅ ขึ้น Google Drive แล้ว ทั้งที่ไฟล์ยังไม่มีป้าย");
  assert.match(r.out, /^offsite-alert=holding /);
  // สถานะต้องยังค้าง — พอชุดนั้นขึ้นจริง (offsite=ok) ถึงค่อยส่ง ✅
  const up = await realOffsiteLine("ok", 1);
  assert.equal(up.rc, 0, up.line);
  const r2 = await alert(mon, env, up.rc, up.line, "offsite");
  assert.match(r2.out, /recovered-sent/);
});

// ───────────────────────── สัญญาในซอร์ส (นับน้อยกว่าเทสต์พฤติกรรมข้างบน — กฎ 6.2) ─────────────────────────

const code = async path => (await readFile(new URL(path, root), "utf8"))
  .split("\n").filter(line => !/^\s*#/.test(line)).join("\n");

test("สัญญา: monitor เรียก check-offsite-status.sh กับ backup.log และส่งผล + 'offsite' ให้ตัวเตือน · ส่งไม่ออกลง warn", async () => {
  // แค่กันไม่ให้ใครถอดสายออกจาก monitor — พฤติกรรมจริงพิสูจน์ด้วยการรันข้างบนแล้ว
  const monitor = await code("scripts/monitor-formula.sh");
  assert.match(monitor, /OFFSITE="\$\(sh "\$REPO_DIR\/scripts\/check-offsite-status\.sh" "\$REPORT_DIR\/backup\.log"[^\n]*\|\|\s*OFFSITE_RC=\$\?/);
  assert.match(monitor, /OFFSITE_RC[^\n]*\n\s*if\s+\[\s*"\$OFFSITE_RC"\s*=\s*0\s*\][\s\S]*?warn\s/,
    "ผลที่ไม่ ok ต้องไปลง warn");
  assert.match(monitor, /sh "\$REPO_DIR\/scripts\/alert-backup-proof\.sh" "\$OFFSITE_RC" "\$OFFSITE" "\$REPORT_DIR" offsite[^\n]*\|\|\s*OALERT_RC=\$\?/);
  assert.match(monitor, /alert-backup-proof\.sh[^\n]*offsite[^\n]*\|\|\s*OALERT_RC=\$\?\s*\n\s*if\s+\[\s*"\$OALERT_RC"\s*=\s*0\s*\];\s*then\s*\n[^\n]*\n\s*else\s*\n\s*warn\s/,
    "ส่งเตือน offsite ไม่ออกต้องขึ้น WARN (กฎ 5.3)");
  // ด่านเรื่องกู้คืนต้องยังอยู่ — offsite มาเพิ่ม ไม่ได้มาแทน
  assert.match(monitor, /sh "\$REPO_DIR\/scripts\/alert-backup-proof\.sh" "\$PROOF_RC" "\$PROOF" "\$REPORT_DIR"/);
});

test("สัญญา: รูปบรรทัด log ที่เทสต์นี้เขียนเอง ตรงกับ daily-backup-formula.sh · ส่งออกหลังพิสูจน์ผ่านเท่านั้น · ปลายทางชื่อเดียว", async () => {
  const daily = await code("scripts/daily-backup-formula.sh");
  assert.match(daily, /say\(\)\s*\{\s*printf '%s %s\\n' "\$\(date -u \+%Y-%m-%dT%H:%M:%SZ\)"/, "รูปเวลาใน say() เปลี่ยน — okLine() ในเทสต์ต้องตาม");
  assert.match(daily, /say "daily-backup status=ok kind=\$KIND dest=\$LATEST /);
  assert.match(daily, /if sh "\$REPO_DIR\/scripts\/verify-restore-formula\.sh"[^\n]*;\s*then\s*\n\s*say "daily-backup status=ok[\s\S]*case "\$BACKUP_DESTINATION" in[\s\S]*sh "\$REPO_DIR\/scripts\/copy-backup-local\.sh" "\$LATEST"[\s\S]*sh "\$REPO_DIR\/scripts\/copy-backup-offsite\.sh" "\$LATEST"/,
    "ตัวส่งต้องอยู่หลังการพิสูจน์กู้คืน และเลือกปลายทางตามโหมด");
  const dest = await code("scripts/offsite-dest.sh");
  assert.match(dest, new RegExp(`OFFSITE_DEST_ROOT="\\$OFFSITE_DRIVE_ROOT/${DEST_NAME}"`));
  assert.match(dest, /OFFSITE_ID_XATTR="com\.google\.drivefs\.item-id#S"/);
  assert.match(dest, /OFFSITE_DRIVE_ROOT="\$\{FORMULA_DRIVE_ROOT:-/);
  for (const s of ["copy-backup-offsite.sh", "check-offsite-status.sh"]) {
    assert.match(await code(`scripts/${s}`), /\.\s+"\$\(cd "\$\(dirname "\$0"\)" && pwd\)\/offsite-dest\.sh"/, `${s} ต้องอ่านปลายทางจาก offsite-dest.sh`);
  }
});

test("copy: อ่านรายการในโฟลเดอร์ชุดไม่ได้ (แบบ launchd) → ต้องไม่ ok ถ้าไม่มีป้าย · ok ได้ถ้ามีป้ายครบ", { skip }, async () => {
  // ใต้ launchd macOS ไม่ให้อ่านรายการโฟลเดอร์ใน CloudStorage แต่เปิดไฟล์ตามพาธได้
  // เดิมไล่ไฟล์ด้วย glob ของโฟลเดอร์ → ได้ว่าง → "ไม่มีไฟล์ไหนขาดป้าย" → ok ปลอม
  const { driveRoot, stateDir, destRoot } = await driveFixture();
  const src = await makeSet("20260928-031506");
  const dest = join(destRoot, "20260928-031506");
  await mkdir(dest, { recursive: true });
  await chmod(dest, 0o300);
  try {
    let r = await runSh([COPY, src], envFor({ driveRoot, stateDir, FORMULA_OFFSITE_UPLOAD_WAIT_SECONDS: "0" }));
    assert.equal(r.code, 3, `อ่านรายการไม่ได้แล้วขึ้น ok = ok ปลอมแบบเดิม:\n${r.out}`);
    assert.match(r.out, /status=pending .*formula\.dump/);

    // Drive ปลอมที่ติดป้ายตามพาธ (อ่านรายการไม่ได้เหมือนกัน)
    let stopped = false;
    const loop = (async () => { while (!stopped) {
      for (const f of ["formula.dump", "manifest.txt", "SHA256SUMS"]) await tag(join(dest, f)).catch(() => {});
      await new Promise(res => setTimeout(res, 200)); } })();
    try {
      r = await runSh([COPY, src], envFor({ driveRoot, stateDir, FORMULA_OFFSITE_UPLOAD_WAIT_SECONDS: "20" }));
    } finally { stopped = true; await loop; }
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /status=ok .*uploaded=ok/);
  } finally { await chmod(dest, 0o755); }
});

test("copy: ไฟล์ต้นทางมีป้าย Drive ติดมา → fail ไม่ใช่ ok (cp พาป้ายไปด้วย)", { skip }, async () => {
  const { driveRoot, stateDir } = await driveFixture();
  const src = await makeSet("20260928-031507");
  await tag(join(src, "formula.dump"), "stale-id-from-elsewhere");
  const r = await runSh([COPY, src], envFor({ driveRoot, stateDir, FORMULA_OFFSITE_UPLOAD_WAIT_SECONDS: "0" }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /status=fail why=.*formula\.dump.*ป้าย/);
  assert.doesNotMatch(r.out, /uploaded=ok/);
});

test("copy: SHA256SUMS ไม่มีขึ้นบรรทัดท้าย / แบบไบนารี (*ชื่อ) — ทุกไฟล์ยังต้องถูกตรวจป้าย", { skip }, async () => {
  for (const variant of ["no-trailing-newline", "binary-marker"]) {
    const { driveRoot, stateDir, destRoot } = await driveFixture();
    const stamp = `20260928-0316${variant === "binary-marker" ? "01" : "00"}`;
    const src = await makeSet(stamp);
    let sums = await readFile(join(src, "SHA256SUMS"), "utf8");
    if (variant === "no-trailing-newline") sums = sums.replace(/\n$/, "");
    else sums = sums.replace(/  /g, " *");
    await writeFile(join(src, "SHA256SUMS"), sums);
    const dest = join(destRoot, stamp);
    await mkdir(dest, { recursive: true });
    // Drive ปลอมติดป้ายทุกไฟล์ ยกเว้นไฟล์ "สุดท้าย" ใน SHA256SUMS (manifest.txt)
    const stop = fakeDrive(dest, f => f !== "manifest.txt");
    let r;
    try {
      r = await runSh([COPY, src], envFor({ driveRoot, stateDir, FORMULA_OFFSITE_UPLOAD_WAIT_SECONDS: "3" }));
    } finally { await stop(); }
    assert.equal(r.code, 3, `${variant}: manifest.txt ไม่มีป้ายแต่ขึ้น ok:\n${r.out}`);
    assert.match(r.out, /status=pending .*manifest\.txt/, variant);
    assert.doesNotMatch(r.out, /pending \([^)]*formula\.dump/, `${variant}: formula.dump มีป้ายแล้ว ต้องอ่านชื่อได้ถูก`);
  }
});
