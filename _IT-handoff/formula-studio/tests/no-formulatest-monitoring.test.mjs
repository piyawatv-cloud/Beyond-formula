/* formulatest ถูกลบแล้ว (เจ้าของตัดสินใจ 3 ต.ค. 2569) — ตัวเฝ้าระวังและรายงานต้องไม่ตรวจสแตกนี้
 * ไม่งั้นจะรายงาน "ผิดปกติ" และแจ้งเตือนผิดทุกรอบ
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("monitor and Hermes report only watch the production stack", async () => {
  const monitor = await read("scripts/monitor-formula.sh");
  const report = await read("scripts/hermes-report-formula.sh");
  assert.doesNotMatch(monitor, /for STACK in [^\n;]*formulatest/);
  assert.match(monitor, /for STACK in formula;/);
  assert.doesNotMatch(report, /"formulatest 3028"/);
  assert.match(report, /for pair in "formula 3025";/);
});
