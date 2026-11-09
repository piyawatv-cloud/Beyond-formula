import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const root = new URL("../", import.meta.url);
const copy = new URL("scripts/copy-backup-local.sh", root).pathname;
const check = new URL("scripts/check-local-backup-status.sh", root).pathname;

test("สำเนาใน iMac ต้องคัดลอกตาม SHA256SUMS และตรวจซ้ำได้ โดยไม่พึ่ง Google Drive", async () => {
  const temp = await mkdtemp(join(tmpdir(), "formula-local-backup-"));
  try {
    const src = join(temp, "source", "20261012T160000Z");
    const state = join(temp, "state");
    const dest = join(temp, "project-backups");
    await mkdir(join(src, "job-intake", "receipts"), { recursive: true });
    await mkdir(join(state, "monitoring"), { recursive: true });
    await writeFile(join(src, "formula.dump"), "safe backup\n");
    await writeFile(join(src, "job-intake", "receipts", "receipt.json"), '{"accepted":true}\n');
    await run("shasum", ["-a", "256", "formula.dump", "job-intake/receipts/receipt.json"], { cwd: src }).then(({ stdout }) => writeFile(join(src, "SHA256SUMS"), stdout));

    const env = { ...process.env, HOME: join(temp, "home"), FORMULA_STATE_DIR: state,
      FORMULA_LOCAL_BACKUP_ROOT: dest, FORMULA_BACKUP_DESTINATION: "local" };
    const copied = await run("sh", [copy, src], { env });
    assert.match(copied.stdout, /local-backup status=ok .*checksum=ok files=2/);
    assert.equal(await readFile(join(dest, "20261012T160000Z", "SHA256SUMS"), "utf8"), await readFile(join(src, "SHA256SUMS"), "utf8"));
    assert.equal(await readFile(join(dest, "20261012T160000Z", "job-intake", "receipts", "receipt.json"), "utf8"), '{"accepted":true}\n');

    const at = "2026-10-12T16:00:00Z";
    await writeFile(join(state, "monitoring", "backup.log"), `${at} daily-backup status=ok kind=daily files=2 dest=${src} restore-proof=ok\n`);
    const checked = await run("sh", [check, join(state, "monitoring", "backup.log")], { env: { ...env, FORMULA_BACKUP_CHECK_NOW: String(Date.parse("2026-10-12T16:05:00Z") / 1000) } });
    assert.match(checked.stdout, /local-backup=ok .*ที่เก็บ=iMac checksum=ok files=2/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("ตัวตรวจต้องไม่ผ่านเมื่อไฟล์สำเนาใน iMac ถูกเปลี่ยน", async () => {
  const temp = await mkdtemp(join(tmpdir(), "formula-local-backup-corrupt-"));
  try {
    const src = join(temp, "source", "20261012T160001Z");
    const state = join(temp, "state");
    const dest = join(temp, "project-backups");
    await mkdir(src, { recursive: true });
    await mkdir(join(state, "monitoring"), { recursive: true });
    await writeFile(join(src, "formula.dump"), "original\n");
    const { stdout } = await run("shasum", ["-a", "256", "formula.dump"], { cwd: src });
    await writeFile(join(src, "SHA256SUMS"), stdout);
    const env = { ...process.env, HOME: join(temp, "home"), FORMULA_STATE_DIR: state, FORMULA_LOCAL_BACKUP_ROOT: dest };
    await run("sh", [copy, src], { env });
    await writeFile(join(dest, "20261012T160001Z", "formula.dump"), "changed\n");
    await writeFile(join(state, "monitoring", "backup.log"), `2026-10-12T16:00:00Z daily-backup status=ok kind=daily files=1 dest=${src} restore-proof=ok\n`);
    await assert.rejects(
      run("sh", [check, join(state, "monitoring", "backup.log")], { env: { ...env, FORMULA_BACKUP_CHECK_NOW: String(Date.parse("2026-10-12T16:05:00Z") / 1000) } }),
      error => /local-backup=corrupt/.test(error.stdout || ""),
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
