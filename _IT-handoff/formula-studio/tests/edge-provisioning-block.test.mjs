/* edge กันประตูสร้างโปรไฟล์จากอินเทอร์เน็ต — ยกบล็อกจริงออกมารัน (กฎ 6.2) */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const START = "// >>> กันประตูสร้างโปรไฟล์ — เริ่มบล็อก";
const END = "// <<< กันประตูสร้างโปรไฟล์ — จบบล็อก";

test("the edge refuses the provisioning gateway for any Cloudflare-carried request, whatever the path spelling", async () => {
  const source = await readFile(new URL("../runtime/formula-edge.mjs", import.meta.url), "utf8");
  const start = source.indexOf(START);
  const end = source.indexOf(END, start);
  assert.ok(start >= 0 && end > start, "เครื่องหมายบล็อกหายไปจาก formula-edge.mjs");
  const blocked = vm.runInThisContext(`(function () {\n${source.slice(start, end)}\nreturn provisioningFromInternet;\n})`)();
  const viaCloudflare = { "cf-ray": "8c1f-SIN" };
  for (const url of ["/__formula/provisioning/profile", "/./__formula/provisioning/profile", "/x/../__formula/provisioning/profile",
    "/%2e/__formula/provisioning/profile", "/__FORMULA/provisioning/profile", "/__formula/provisioning/profile?x=1"]) {
    assert.equal(blocked({ url, headers: viaCloudflare }), true, url);
  }
  assert.equal(blocked({ url: "/__formula/provisioning/profile", headers: { "cf-connecting-ip": "203.0.113.9" } }), true);
  assert.equal(blocked({ url: "/__formula/provisioning/profile", headers: { "cf-access-jwt-assertion": "x" } }), true);
  // OPC calls from inside the host carry no cf-* header and pass to the proxy (which checks the signature).
  assert.equal(blocked({ url: "/__formula/provisioning/profile", headers: {} }), false);
  // Ordinary app traffic through Cloudflare is untouched.
  assert.equal(blocked({ url: "/sb/rest/v1/fs_records", headers: viaCloudflare }), false);
  assert.equal(blocked({ url: "/", headers: viaCloudflare }), false);
});
