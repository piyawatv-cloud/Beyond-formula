import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Formula resolves OPC access email before the legacy OPC login name", async () => {
  const source = await readFile(new URL("runtime/formula-proxy.mjs", root), "utf8");
  const functionSource = source.match(
    /function canonicalOpcEmail\(opcUser, login\) \{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(functionSource, "canonical OPC email resolver must remain present");
  const canonicalOpcEmail = vm.runInThisContext(`(${functionSource})`);

  assert.equal(
    canonicalOpcEmail(
      { email: "mind.mkt", accessEmail: "kessuda@example.com" },
      "mind.mkt",
    ),
    "kessuda@example.com",
  );
  assert.equal(canonicalOpcEmail({ email: "legacy@example.test" }, "legacy@example.test"), "legacy@example.test");
  assert.match(source, /const email = canonicalOpcEmail\(opcUser, login\);/);
});
