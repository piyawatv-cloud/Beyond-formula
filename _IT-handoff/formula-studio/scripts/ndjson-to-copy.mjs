#!/usr/bin/env node
// แปลงไฟล์สำรอง NDJSON เป็นสคริปต์ psql (คำสั่ง COPY) เพื่อใช้พิสูจน์ว่ากู้คืนได้จริง
//
// ทำไมต้องมี: สำรองที่ไม่เคยกู้กลับ ไม่ใช่จุดกู้คืน เป็นแค่ไฟล์
// สคริปต์นี้ทำให้ "กู้คืนแล้วนับแถวเทียบ" เป็นคำสั่งเดียวที่รันซ้ำได้

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const COLUMNS = {
  fs_records: ["id", "data", "updated_at"],
  fs_chats: ["job_id", "data", "updated_at"],
  fs_messages: ["uid", "job_id", "ts", "data", "updated_at"],
  fs_approvals: ["job_id", "part", "data", "updated_at"],
  fs_users: ["name", "data", "updated_at"],
  fs_activities: ["uid", "ts", "data"],
  fs_meta: ["key", "value", "updated_at"],
};

const dir = process.argv[2];
const out = process.argv[3];
if (!dir || !out) {
  console.error("ใช้: node ndjson-to-copy.mjs <โฟลเดอร์สำรอง> <ไฟล์ .sql ปลายทาง>");
  process.exit(2);
}

// รูปแบบ text ของ COPY: ต้อง escape \ , แท็บ , ขึ้นบรรทัด และ NULL = \N
const escape = value => {
  if (value === null || value === undefined) return "\\N";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("\t", "\\t")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r");
};

const parts = [];
const counts = {};

for (const [table, columns] of Object.entries(COLUMNS)) {
  const file = `${dir}/${table}.ndjson`;
  if (!existsSync(file)) {
    console.error(`[restore] ไม่พบ ${table}.ndjson — ข้าม`);
    counts[table] = 0;
    continue;
  }
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  counts[table] = lines.length;
  parts.push(`COPY ${table} (${columns.join(", ")}) FROM STDIN;`);
  for (const line of lines) {
    const row = JSON.parse(line);
    parts.push(columns.map(column => escape(row[column])).join("\t"));
  }
  parts.push("\\.");
  parts.push("");
}

writeFileSync(out, `${parts.join("\n")}\n`);
console.log(JSON.stringify(counts));
