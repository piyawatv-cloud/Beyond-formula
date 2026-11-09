/* ตัวตรวจ "พิสูจน์กู้คืนผ่านจริงไหม" (scripts/check-backup-status.sh) — รันสคริปต์จริง
 *
 * ทำไมต้องมี: ด่านเดิมของ monitor ดูแค่อายุโฟลเดอร์สำรองล่าสุด แต่ daily-backup-formula.sh
 * สร้างโฟลเดอร์ก่อนพิสูจน์กู้คืนเสมอ ผลคือ 25 ส.ค. – 26 ก.ย. 2569 กู้คืนไม่ผ่าน 13 จาก 36 คืน
 * และไม่มีใครได้เตือนเลยสักคืน
 *
 * ทำไมรันสคริปต์จริง ไม่ใช่ assert.match บนซอร์ส (กฎ 6.2): เทสต์ที่ยืนยันว่า "มีคำว่า fail
 * อยู่ในไฟล์" ผ่านได้ทั้งที่สคริปต์ออก 0 ตอนเจอ fail — ซึ่งก็คืออาการเดิมที่เราแก้อยู่พอดี
 * ที่นี่จึงเขียน backup.log ปลอมลงโฟลเดอร์ชั่วคราว แล้วดูรหัสออกกับบรรทัดที่พิมพ์ออกมา
 *
 * ห้ามชี้เทสต์ไปที่ ~/.hermes/apps/formula-studio/monitoring/backup.log เด็ดขาด —
 * ไฟล์นั้นคือบันทึกจริง ไม่ใช่ที่ทดลอง (สคริปต์อ่านอย่างเดียวก็จริง แต่เทสต์ไม่ควรพึ่งข้อนั้น)
 *
 * FORMULA_BACKUP_CHECK_SCRIPT ใช้เฉพาะตอนทำ mutation test กับ "สำเนา" ของสคริปต์
 * เพื่อพิสูจน์ว่าเทสต์ชุดนี้แดงได้จริงเมื่อสคริปต์ผิด — ปกติไม่ต้องตั้ง
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";

const root = new URL("../", import.meta.url);
const SCRIPT = process.env.FORMULA_BACKUP_CHECK_SCRIPT
  || fileURLToPath(new URL("scripts/check-backup-status.sh", root));

let dir;
before(async () => { dir = await mkdtemp(join(tmpdir(), "backup-status-test-")); });
after(async () => { await rm(dir, { recursive: true, force: true }); });

// เวลาอ้างอิงคงที่ ไม่ใช้นาฬิกาเครื่อง — เทสต์ที่เขียวหรือแดงตามเวลาที่รัน ไม่ใช่เทสต์
const AT_OK = "2026-09-27T20:15:10Z";
const epoch = iso => Math.floor(Date.parse(iso) / 1000);
const hoursAfter = (iso, h) => String(epoch(iso) + h * 3600);

// รูปบรรทัดจริงจาก daily-backup-formula.sh (say = "<UTC stamp> <ข้อความ>")
const okLine = at =>
  `${at} daily-backup status=ok kind=daily dest=/x/backups/daily/${at.replace(/[-:]/g, "")} restore-proof=ok`;
const failLine = (at, why = "กู้คืนไม่ผ่าน") =>
  `${at} daily-backup status=fail why=${why} dest=/x/backups/daily/${at.replace(/[-:]/g, "")}`;

let n = 0;
async function run(lines, { now, maxAge, file } = {}) {
  const path = file ?? join(dir, `backup-${++n}.log`);
  if (lines !== null) await writeFile(path, lines.length ? lines.join("\n") + "\n" : "");
  const env = { ...process.env, FORMULA_BACKUP_CHECK_NOW: now ?? hoursAfter(AT_OK, 1) };
  delete env.FORMULA_BACKUP_MAX_AGE_HOURS;
  if (maxAge !== undefined) env.FORMULA_BACKUP_MAX_AGE_HOURS = String(maxAge);
  const r = spawnSync("sh", [SCRIPT, path], { env, encoding: "utf8" });
  const out = (r.stdout + r.stderr).trim();
  // สัญญา: พิมพ์หนึ่งบรรทัดเสมอ — monitor เอาบรรทัดนี้ไปใส่ ok/warn ตรง ๆ
  assert.equal(out.split("\n").length, 1, `ต้องพิมพ์บรรทัดเดียว ได้:\n${out}`);
  return { code: r.status, out };
}

test("คืนล่าสุดกู้คืนไม่ผ่าน → ออก 1 พร้อม why= เหตุผลเดิม และ at=", async () => {
  const at = "2026-09-26T20:15:08Z";
  const r = await run([okLine("2026-09-24T20:15:10Z"), failLine(at)], { now: hoursAfter(at, 2) });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^backup-proof=fail /);
  assert.match(r.out, /why=/);
  assert.ok(r.out.includes("กู้คืนไม่ผ่าน"), `ต้องยกเหตุผลเดิมมาด้วย: ${r.out}`);
  assert.ok(r.out.includes(`at=${at}`), r.out);
  // dest= เป็นพาธยาว ไม่ใช่เหตุผล — ไม่ควรติดมากับ why
  assert.ok(!r.out.includes("dest="), r.out);
});

test("fail ตามด้วย ok ของคืนถัดมา → ออก 0 (ดูบรรทัดล่าสุด ไม่ใช่มี fail ที่ไหนก็ได้)", async () => {
  const r = await run([
    failLine("2026-09-25T20:15:03Z"),
    failLine("2026-09-26T20:15:08Z"),
    okLine(AT_OK),
  ]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^backup-proof=ok /);
  assert.ok(r.out.includes(`at=${AT_OK}`), r.out);
});

test("ok ที่ยังสด (ภายใน 30 ชม. ค่าเริ่มต้น) → ออก 0", async () => {
  const r = await run([okLine(AT_OK)], { now: hoursAfter(AT_OK, 30) });
  assert.equal(r.code, 0, r.out);
  assert.ok(!r.out.includes("why="), r.out);
});

test("ok ที่เก่าเกินเกณฑ์ → ออก 1 stale (งานประจำวันไม่ได้รัน เงียบไม่ใช่ปกติ)", async () => {
  const r = await run([okLine(AT_OK)], { now: hoursAfter(AT_OK, 31) });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^backup-proof=stale /);
  assert.match(r.out, /why=/);

  // เกณฑ์ปรับได้ด้วย FORMULA_BACKUP_MAX_AGE_HOURS — ต้องใช้ค่าที่ตั้ง ไม่ใช่ 30 ตายตัว
  const tight = await run([okLine(AT_OK)], { now: hoursAfter(AT_OK, 5), maxAge: 4 });
  assert.equal(tight.code, 1, tight.out);
  assert.match(tight.out, /^backup-proof=stale /);
});

test("ไม่มีไฟล์ backup.log → ออก 1 พร้อม why=", async () => {
  const r = await run(null, { file: join(dir, "does-not-exist.log") });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^backup-proof=none /);
  assert.match(r.out, /why=/);
});

test("ไฟล์ว่าง หรือมีแต่บรรทัดที่ไม่ใช่สถานะ → ออก 1 ไม่ใช่ ok", async () => {
  const empty = await run([]);
  assert.equal(empty.code, 1, empty.out);
  assert.match(empty.out, /^backup-proof=none .*why=/);

  const noStatus = await run([
    "2026-09-27T20:15:00Z verify-restore start",
    "2026-09-27T20:15:09Z daily-backup warn=ส่งสำเนาออกนอกเครื่องไม่สำเร็จ ดู offsite.log",
  ]);
  assert.equal(noStatus.code, 1, noStatus.out);
  assert.match(noStatus.out, /^backup-proof=none .*why=/);
});

test("บรรทัด daily-backup warn= หลัง fail ต้องไม่กลบ fail", async () => {
  const at = "2026-09-26T20:15:08Z";
  const r = await run([
    failLine(at),
    "2026-09-26T20:15:09Z daily-backup warn=ส่งสำเนาออกนอกเครื่องไม่สำเร็จ ดู offsite.log",
  ], { now: hoursAfter(at, 1) });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^backup-proof=fail /);
  assert.ok(r.out.includes(`at=${at}`), r.out);
});

test("ข้อความของ verify-restore ที่มี 'daily-backup status=ok' กลางบรรทัด ต้องถูกข้าม", async () => {
  const at = "2026-09-26T20:15:08Z";
  const r = await run([
    failLine(at),
    "restore noise daily-backup status=ok",
    "2026-09-26T20:15:09Z verify-restore echo: daily-backup status=ok kind=daily",
    "  2026-09-26T20:15:09Z daily-backup status=ok kind=daily dest=/indented",
  ], { now: hoursAfter(at, 1) });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^backup-proof=fail /);
});

test("fail ที่ไม่มี dest= (ชั้นข้อมูลไม่พร้อม) → ยกเหตุผลเต็มมาครบ", async () => {
  const at = "2026-09-26T20:15:02Z";
  const why = "ชั้นข้อมูลไม่พร้อม (healthcheck-data ไม่ผ่าน)";
  const r = await run([`${at} daily-backup status=fail why=${why}`], { now: hoursAfter(at, 1) });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^backup-proof=fail /);
  assert.ok(r.out.includes(why), `เหตุผลต้องไม่ถูกตัด: ${r.out}`);
});

test("นับคืนที่ล้มติดกัน — ok คั่นกลางต้องรีเซ็ตตัวนับ", async () => {
  const last = "2026-09-26T20:15:08Z";
  const r = await run([
    failLine("2026-09-20T20:15:07Z"),
    failLine("2026-09-21T20:15:08Z"),
    okLine("2026-09-24T20:15:10Z"),
    failLine("2026-09-25T20:15:03Z"),
    "2026-09-25T20:15:04Z daily-backup warn=ส่งสำเนาออกนอกเครื่องไม่สำเร็จ ดู offsite.log",
    failLine(last),
  ], { now: hoursAfter(last, 1) });
  assert.equal(r.code, 1, r.out);
  assert.ok(r.out.includes("ล้มติดกัน=2คืน"), `ต้องนับ 2 ไม่ใช่ 4: ${r.out}`);

  const one = await run([okLine("2026-09-24T20:15:10Z"), failLine(last)], { now: hoursAfter(last, 1) });
  assert.ok(one.out.includes("ล้มติดกัน=1คืน"), one.out);
});

test("สถานะที่ไม่รู้จัก → ไม่ใช่ ok", async () => {
  const r = await run([`${AT_OK} daily-backup status=partial dest=/x`]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /why=/);
});

test("สัญญา: monitor และ hermes-report เรียกตัวตรวจนี้จริง และ monitor ยังเก็บด่านอายุโฟลเดอร์เดิมไว้", async () => {
  // บรรทัดคอมเมนต์ไม่นับ — คอมเมนต์ที่พูดถึงสคริปต์ไม่ได้ทำให้สคริปต์ถูกเรียก
  const code = async path => (await readFile(new URL(path, root), "utf8"))
    .split("\n").filter(line => !/^\s*#/.test(line)).join("\n");
  const call = /\bsh\s+"\$REPO_DIR\/scripts\/check-backup-status\.sh"\s+"[^"]*\/backup\.log"/;

  const monitor = await code("scripts/monitor-formula.sh");
  assert.match(monitor, call, "monitor-formula.sh ต้องเรียก check-backup-status.sh กับ backup.log");
  // ผลต้องไปลง warn เมื่อไม่ผ่าน ไม่ใช่ถูกกลืนหาย
  // รูปที่สอง (เก็บรหัสออกไว้ใน PROOF_RC ก่อน) มาเพราะตัวส่ง Telegram ต้องได้รหัสเดียวกันไปใช้
  // บังคับว่าต้องเป็น PROOF_RC ที่เซ็ตจากบรรทัดเรียกตัวตรวจเอง ไม่ใช่ตัวแปรอะไรก็ได้
  assert.match(monitor,
    /check-backup-status\.sh[^\n]*(?:\|\|\s*PROOF_RC=\$\?\s*\n\s*if\s+\[\s*"\$PROOF_RC"\s*=\s*0\s*\];\s*then\s*)?\n\s*ok\s[^\n]*\n\s*else\s*\n\s*warn\s/,
    "ผลที่ไม่ผ่านต้องไปลง warn");

  // ด่านเดิมต้องอยู่ — ด่านใหม่มาเพิ่ม ไม่ได้มาแทน (ห้ามถอดด่าน)
  assert.match(monitor, /warn\s+"backup=none /, "ด่าน backup=none หายไปจาก monitor-formula.sh");
  assert.match(monitor, /\[\s*"\$AGE_H"\s+-le\s+"\$BACKUP_MAX_AGE_HOURS"\s*\]/,
    "ด่านอายุโฟลเดอร์ (BACKUP_MAX_AGE_HOURS) หายไปจาก monitor-formula.sh");
  assert.match(monitor, /^BACKUP_MAX_AGE_HOURS=/m);

  const report = await code("scripts/hermes-report-formula.sh");
  assert.match(report, call, "hermes-report-formula.sh ต้องเรียก check-backup-status.sh กับ backup.log");
  assert.match(report, /check-backup-status\.sh[^\n]*\n[^\n]*\n\s*else\s*\n\s*bad\s/,
    "ผลที่ไม่ผ่านต้องไปลง bad ในรายงาน");
});
