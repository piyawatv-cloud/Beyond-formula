/* กุญแจประตูสร้างโปรไฟล์: สแตกจริงอ่านจาก Keychain เอง, formulatest ไม่รับกุญแจ production
 * รันไฟล์เชลล์จริง โดยวาง `security` ปลอมไว้หน้า PATH — ไม่แตะ Keychain จริง
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url).pathname;
const bin = mkdtempSync(join(tmpdir(), "fs-sec-"));
const log = join(bin, "calls");
writeFileSync(join(bin, "security"), `#!/bin/sh\necho "$*" >> "${log}"\n[ "$5" = beyond-workflow.formula.provisioning ] && echo keychain-value-0123456789abcdef0123456789\n`);
chmodSync(join(bin, "security"), 0o755);

function run(project, preset) {
  writeFileSync(log, "");
  const env = { PATH: `${bin}:/usr/bin:/bin`, USER: "tester" };
  if (preset !== undefined) env.FORMULA_PROVISIONING_SECRET = preset;
  const out = execFileSync("/bin/sh", ["-c", `. "${root}scripts/provisioning-secret.sh"; formula_provisioning_secret_for "$1"; sh -c 'printf %s "$FORMULA_PROVISIONING_SECRET"'`, "sh", project], { env }).toString();
  return { value: out, calls: readFileSync(log, "utf8").trim() };
}

test("the production stack reads the key from Keychain and exports it to child processes", () => {
  const r = run("formularuntime");
  assert.equal(r.value, "keychain-value-0123456789abcdef0123456789");
  assert.match(r.calls, /find-generic-password -a tester -s beyond-workflow\.formula\.provisioning -w/);
});

test("a key already given to the production stack wins and Keychain is not asked", () => {
  const r = run("formularuntime", "given-value");
  assert.equal(r.value, "given-value");
  assert.equal(r.calls, "");
});

test("formulatest never inherits the production provisioning secret, even when the shell carries a key", () => {
  assert.equal(run("formularuntimetest", "leaked-value").value, "");
  assert.equal(run("formularuntimetest").value, "");
  assert.equal(run("formularuntimetest").calls, "");
});

test("blue-green-formula.sh loads it after the project name is known", () => {
  const src = readFileSync(join(root, "scripts/blue-green-formula.sh"), "utf8");
  const project = src.indexOf('PROJECT="$FORMULA_COMPOSE_PROJECT"');
  const load = src.indexOf('formula_provisioning_secret_for "$PROJECT"');
  const compose = src.indexOf('COMPOSE="docker compose');
  assert.ok(project > 0 && load > project && compose > load, "loaded between the project name and the compose command");
});
