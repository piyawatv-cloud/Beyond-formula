import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("Formula read-only sessions must not attempt write sync", async () => {
  const html = await read(`releases/${(await read("releases/CURRENT")).trim()}/index.html`);

  // สัญญาใหม่ตั้งแต่ 39a67c4: เริ่มที่ยังไม่เคยเจอด่าน แล้วเชื่อคำตอบเมื่อด่านตอบจริง
  // ไม่ใช่ปิดไว้ก่อนเสมอ เพราะดีพลอยที่ไม่มีด่านจะกลายเป็นอ่านอย่างเดียวถาวร
  assert.match(html, /let sbIamSeen\s*=\s*false/);
  assert.match(html, /async function sbLoadWritePermission\s*\(/);
  assert.match(html, /sbIamSeen\s*=\s*true/);
  assert.match(html, /sbCanEdit\s*=\s*data\.authenticated\s*===\s*true\s*&&\s*data\.canEdit\s*===\s*true/);
  assert.match(html, /!sbOn\(\)\s*\|\|\s*!sbCanEdit\s*\|\|\s*!sbReady/);
  assert.match(html, /sbReady\s*&&\s*sbCanEdit\s*\?\s*await sbPush\(\)\s*:\s*false/);
  assert.match(html, /อ่านอย่างเดียว/);
});

// สัญญาใหม่ปลอดภัยได้ก็ต่อเมื่อด่านมีอยู่จริงและตอบทุกครั้ง
// ถ้าปลายทางนี้หายไปจาก proxy ทุกคนจะกลายเป็นเขียนได้เงียบ ๆ — ต้องจับให้ได้ตรงนี้
test("Formula runtime must serve the /sb/session gate", async () => {
  const proxy = await read("runtime/formula-proxy.mjs");
  assert.match(proxy, /"\/sb\/session"/);
});

test("Formula session separates normal sync writes from sensitive formula edit", async () => {
  const proxy = await read("runtime/formula-proxy.mjs");

  assert.match(proxy, /async function formulaEditAllowed\s*\(/);
  assert.match(proxy, /iamPermission\(centralUserId,\s*"FORMULA_EDIT"\)/);
  assert.match(proxy, /canEdit:\s*formulaSyncCanWrite\(/);
  assert.match(proxy, /canFormulaEdit:\s*await formulaEditAllowed\(/);
});
