import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function loadRolePolicy() {
  const source = await readFile(new URL("runtime/formula-proxy.mjs", root), "utf8");
  const block = source.match(
    /const FORMULA_DATA_ROLES = [\s\S]*?function formulaSyncCanWrite\(role\) \{[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(block, "Formula role write policy must remain executable in the runtime");
  return vm.runInThisContext(`(() => { ${block}; return { formulaRoleCanWrite, formulaSyncCanWrite }; })()`);
}

test("Formula normal writes follow Beyond-formula role capabilities", async () => {
  const { formulaRoleCanWrite, formulaSyncCanWrite } = await loadRolePolicy();

  assert.equal(formulaSyncCanWrite("pd"), true);
  assert.equal(formulaSyncCanWrite("opc"), true);
  assert.equal(formulaSyncCanWrite("sales"), true);
  assert.equal(formulaSyncCanWrite("ra"), true);

  assert.equal(formulaRoleCanWrite("opc", "fs_records", "POST"), true);
  assert.equal(formulaRoleCanWrite("sales", "fs_records", "POST"), true);
  assert.equal(formulaRoleCanWrite("pd", "fs_records", "POST"), true);
  assert.equal(formulaRoleCanWrite("ra", "fs_records", "POST"), false);
  assert.equal(formulaRoleCanWrite("sales", "fs_approvals", "POST"), true);
  assert.equal(formulaRoleCanWrite("opc", "fs_approvals", "POST"), false);
  assert.equal(formulaRoleCanWrite("purchasing", "fs_chats", "POST"), true);
});

test("Formula runtime keeps ingredient edits behind the sensitive IAM grant", async () => {
  const source = await readFile(new URL("runtime/formula-proxy.mjs", root), "utf8");

  assert.match(source, /formulaRowsWriteNeedsEdit\(withRole, stored\)/);
  assert.match(source, /if \(change\.needsEdit\) return iamPermission\(session\.centralUserId, "FORMULA_EDIT"\)/);
  assert.match(source, /return \{ allowed: false, reason_code: "FORMULA_DATA_SCOPE_DENIED" \}/);
});

test("Sales can create/update normal jobs but cannot change ingredient rows", async () => {
  const source = await readFile(new URL("runtime/formula-proxy.mjs", root), "utf8");
  const block = source.match(
    /const FORMULA_DATA_ROLES = [\s\S]*?function formulaRowsWriteNeedsEdit\(rows, stored\) \{[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(block, "Formula row-write policy must remain executable in the runtime");
  const { formulaRowsWriteNeedsEdit } = vm.runInThisContext(
    `(() => { ${block}; return { formulaRowsWriteNeedsEdit }; })()`,
  );

  const stored = new Map([["A00001", { rows: [{ ingredient: "old" }] }]]);

  const create = formulaRowsWriteNeedsEdit([
    { id: "A00002", data: { rows: [{ ingredient: "new" }] }, sessionRole: "sales" },
  ], stored);
  assert.equal(create.blocked, false);
  assert.equal(create.needsEdit, false);

  const normalUpdate = formulaRowsWriteNeedsEdit([
    { id: "A00001", data: { rows: [{ ingredient: "old" }] }, sessionRole: "sales" },
  ], stored);
  assert.equal(normalUpdate.blocked, false);
  assert.equal(normalUpdate.needsEdit, false);

  const reorderedEquivalentUpdate = formulaRowsWriteNeedsEdit([
    { id: "A00001", data: { rows: [{ weight: 1, ingredient: "old" }] }, sessionRole: "sales" },
  ], new Map([["A00001", { rows: [{ ingredient: "old", weight: 1 }] }]]));
  assert.equal(reorderedEquivalentUpdate.blocked, false);
  assert.equal(reorderedEquivalentUpdate.needsEdit, false,
    "object key order must not turn an unchanged ingredient row into a protected edit");

  const ingredientUpdate = formulaRowsWriteNeedsEdit([
    { id: "A00001", data: { rows: [{ ingredient: "changed" }] }, sessionRole: "sales" },
  ], stored);
  assert.equal(ingredientUpdate.blocked, false);
  assert.equal(ingredientUpdate.needsEdit, true);
});
