#!/usr/bin/env node
// ดึงทุกตารางของ Formula Studio ลงไฟล์ NDJSON ทีละหน้า
//
// ทำไมไม่ดึงทีเดียว: PostgREST ตอบสูงสุด 1000 แถวต่อครั้ง ตารางอย่าง fs_messages
// โตเกินนั้นแน่ ๆ (index.html เขียนหมายเหตุเรื่องนี้ไว้เองที่หัวข้อ SUPABASE SYNC)
//
// เรื่องที่ต้องซื่อสัตย์: การไล่หน้าแบบ offset ขณะมีคนเขียนอยู่ อาจข้ามหรือซ้ำแถวได้
// สคริปต์นี้จึงนับจำนวนแถว "ก่อน" และ "หลัง" ดึงทุกตาราง ถ้าตัวเลขไม่ตรงจะลองใหม่
// อีกหนึ่งรอบ และถ้ายังไม่ตรงจะบันทึกไว้ใน manifest ว่าตารางนี้ดึงมาขณะข้อมูลขยับ
// — ไม่ปิดบัง เพราะสำรองที่โกหกว่าครบ อันตรายกว่าสำรองที่บอกว่าไม่ครบ
//
// ถ้ามี SB_PG_URL (สายต่อ PostgreSQL ตรง) ให้ใช้ pg_dump แทน ตัวนี้จะไม่ถูกเรียก

import { createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { once } from "node:events";

const PAGE = 1000;
const MAX_RETRY = 3;

// ตาราง + คีย์ที่ใช้เรียงลำดับ ต้องเป็นคีย์หลักเสมอ ไม่งั้นการไล่หน้าไม่นิ่ง
const TABLES = [
  { name: "fs_records", order: "id.asc" },
  { name: "fs_chats", order: "job_id.asc" },
  { name: "fs_messages", order: "uid.asc" },
  { name: "fs_approvals", order: "job_id.asc,part.asc" },
  { name: "fs_users", order: "name.asc" },
  { name: "fs_activities", order: "uid.asc" },
  { name: "fs_meta", order: "key.asc" },
];

const origin = (process.env.SB_ORIGIN_HOST || process.env.SB_ORIGIN || "").replace(/\/+$/, "");
const key = process.env.SB_ANON_KEY || process.env.SB_SERVICE_KEY || "";
// ปลายทางย้ายมาเป็น PostgREST ในเครื่องแล้ว ใช้สองปุ่มเดียวกับ formula-proxy.mjs
// เพื่อไม่ให้มีสองที่ที่ต้องจำว่า "ตอนนี้ชี้ไปไหน" — ดูคำอธิบายเต็มที่ไฟล์นั้น
const restBase = (process.env.SB_REST_BASE || "/rest/v1").replace(/\/+$/, "");
const upstreamAuth = process.env.SB_UPSTREAM_AUTH === "none" ? "none" : "bearer";
const outDir = process.argv[2];

if (!origin || !key) {
  console.error("ขาดค่า SB_ORIGIN หรือคีย์ — ตรวจ runtime/formula.env");
  process.exit(2);
}
if (!outDir) {
  console.error("ใช้: node pull-supabase-tables.mjs <โฟลเดอร์ปลายทาง>");
  process.exit(2);
}

const headers =
  upstreamAuth === "bearer"
    ? { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" }
    : { Accept: "application/json" };

async function request(path, extraHeaders = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRY; attempt += 1) {
    try {
      const response = await fetch(`${origin}${restBase}/${path}`, {
        headers: { ...headers, ...extraHeaders },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${await response.text()}`.slice(0, 300));
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRY) await new Promise(r => setTimeout(r, attempt * 1500));
    }
  }
  throw lastError;
}

// นับแถวจริงด้วย Content-Range โดยไม่ต้องดึงข้อมูล
async function countRows(table) {
  const response = await request(`${table}?select=*&limit=1`, {
    Prefer: "count=exact",
    Range: "0-0",
  });
  const range = response.headers.get("content-range") || "";
  const total = Number(range.split("/")[1]);
  return Number.isFinite(total) ? total : null;
}

async function pullTable(table, order, file) {
  const stream = createWriteStream(file, { flags: "w" });
  let offset = 0;
  let rows = 0;
  for (;;) {
    const response = await request(
      `${table}?select=*&order=${order}&limit=${PAGE}&offset=${offset}`,
    );
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error(`${table}: ตอบกลับไม่ใช่ array`);
    for (const row of page) {
      if (!stream.write(`${JSON.stringify(row)}\n`)) await once(stream, "drain");
    }
    rows += page.length;
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  stream.end();
  await once(stream, "finish");
  return rows;
}

const report = { pulledAt: new Date().toISOString(), origin, tables: [] };
let exitCode = 0;

for (const { name, order } of TABLES) {
  const file = `${outDir}/${name}.ndjson`;
  let entry = { table: name, file: `${name}.ndjson` };
  try {
    let moved = false;
    let rows = 0;
    let before = null;
    let after = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      before = await countRows(name);
      rows = await pullTable(name, order, file);
      after = await countRows(name);
      moved = before !== null && after !== null && before !== after;
      if (!moved) break;
      console.error(`[backup] ${name}: ข้อมูลขยับระหว่างดึง (${before} → ${after}) ลองใหม่`);
    }
    entry = { ...entry, rows, countBefore: before, countAfter: after, movedDuringPull: moved };
    if (moved) {
      entry.warning = "จำนวนแถวเปลี่ยนระหว่างดึง — สำรองชุดนี้อาจไม่ใช่ภาพนิ่ง";
      exitCode = 1;
    }
    console.log(`[backup] ${name}: ${rows} แถว`);
  } catch (error) {
    entry = { ...entry, rows: 0, error: String(error?.message ?? error) };
    console.error(`[backup] ${name}: ล้มเหลว — ${entry.error}`);
    exitCode = 2;
  }
  report.tables.push(entry);
}

await writeFile(`${outDir}/pull-report.json`, `${JSON.stringify(report, null, 2)}\n`);
process.exit(exitCode);
