/* HTTP 302 ที่ Access ส่งให้ผู้ไม่มี session คือขอบเขตความปลอดภัย ไม่ใช่ runtime ล่ม
 * แต่ห้ามยอมรับ redirect ทั่วไป: ต้องมี Cloudflare Access challenge และ login prefix ที่กำหนด
 */
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url);
const script = new URL("scripts/check-public-access.sh", root);

test("public access probe: รับเฉพาะ 200 หรือ 302 ของ Cloudflare Access ที่มี challenge และ login prefix", async () => {
  const dir = await mkdtemp(join(tmpdir(), "formula-public-access-test-"));
  const bin = join(dir, "bin");
  const curl = join(bin, "curl");
  try {
    await (await import("node:fs/promises")).mkdir(bin);
    await writeFile(curl, `#!/bin/sh
case "\${FAKE_CURL_CASE}" in
  ok) printf 'HTTP/2 200\\r\\n\\r\\nstatus=200\\n' ;;
  access) printf 'HTTP/2 302\\r\\nwww-authenticate: Cloudflare-Access realm="abc"\\r\\nlocation: https://beyond-workflow.cloudflareaccess.com/cdn-cgi/access/login/formula/signed-secret\\r\\n\\r\\nstatus=302\\n' ;;
  redirect) printf 'HTTP/2 302\\r\\nlocation: https://example.invalid/elsewhere\\r\\n\\r\\nstatus=302\\n' ;;
  wrong-access) printf 'HTTP/2 302\\r\\nwww-authenticate: Cloudflare-Access\\r\\nlocation: https://example.invalid/cdn-cgi/access/login/elsewhere\\r\\n\\r\\nstatus=302\\n' ;;
  down) printf 'status=000\\n'; exit 7 ;;
esac
`);
    await chmod(curl, 0o755);
    const run = kind => spawnSync("sh", [script.pathname, "https://formula.beyond-workflow.com/"], {
      encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_CURL_CASE: kind,
        FORMULA_ACCESS_LOGIN_PREFIX: "" },
    });
    for (const kind of ["ok", "access"]) {
      const r = run(kind);
      assert.equal(r.status, 0, `${kind}: ${r.stdout}${r.stderr}`);
    }
    assert.match(run("ok").stdout.trim(), /^public-access=ok http=200$/);
    assert.match(run("access").stdout.trim(), /^public-access=expected-access-redirect http=302 location-host=beyond-workflow\.cloudflareaccess\.com$/);
    for (const kind of ["redirect", "wrong-access", "down"]) {
      const r = run(kind);
      assert.notEqual(r.status, 0, `${kind} must remain an alert`);
      assert.match(r.stdout, /^public-access=unexpected http=/);
      assert.match(r.stdout, /why=/);
      assert.doesNotMatch(r.stdout, /signed-secret/, "redirect token must never be logged");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
