/* fs_next_rec_seq() ต้องไม่ออกเลขที่ต่ำกว่าหรือเท่ากับรหัสงานที่มีอยู่จริง (พบ 3 ต.ค. 2569, D2)
 * เทสต์นี้ล็อกข้อความใน data-policy.sql และสูตรแปลงรหัสให้ตรงกับ seqFromRecId() ของบันเดิลที่ผนึกไว้
 * (ทดลองกับ PostgreSQL 16 จริงในคอนเทนเนอร์ไม่ต่อเครือข่ายแล้ว: ตัวนับ 14 + A00015 → 16)
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("data-policy floors the issued sequence at the highest existing record id, forward-only", async () => {
  const sql = await read("runtime/data-policy.sql");
  assert.match(sql, /create or replace function fs_rec_seq_of\(rec_id text\)/);
  assert.match(sql, /select coalesce\(max\(fs_rec_seq_of\(id\)\), 0\) into floor_seq from fs_records;/);
  assert.match(sql, /greatest\(\(fs_meta\.value #>> '\{\}'\)::bigint, floor_seq\) \+ 1/);
  assert.match(sql, /create or replace function fs_next_rec_seq\(\) returns bigint\s+language plpgsql security definer set search_path = public/);
  // the direct-write guard on reccounter must stay
  assert.match(sql, /reccounter is issued by fs_next_rec_seq\(\) only/);
});

test("the SQL id mapping uses the same block size and pattern as the sealed client", async () => {
  const current = (await read("releases/CURRENT")).trim();
  const bundle = await read(`releases/${current}/index.html`);
  assert.match(bundle, /const REC_BLOCK = 99999;/);
  assert.match(bundle, /\/\^\(\[A-Z\]\+\)\(\\d\{5\}\)\$\//);
  const sql = await read("runtime/data-policy.sql");
  assert.match(sql, /'\^\(\[A-Z\]\+\)\(\\d\{5\}\)\$'/);
  assert.match(sql, /- 1\) \* 99999 \+ m\[2\]::bigint/);
});
