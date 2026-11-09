#!/bin/sh
# อ่านบันทึกของ runtime ให้คนอ่านรู้เรื่อง — ใครเข้ามา ใครเขียนอะไร อะไรถูกปฏิเสธ
#
# บันทึกเก็บเป็น NDJSON วันละไฟล์ที่ ~/.hermes/apps/formula-studio/monitoring/gateway-<วันที่>.ndjson
# ไฟล์ดิบอ่านด้วยตาไม่ไหว ตัวนี้จึงมีไว้ให้เรียกดูได้โดยไม่ต้องเขียน jq เอง
#
# ใช้:
#   sh scripts/audit-log.sh                      วันนี้ ทั้งหมด
#   sh scripts/audit-log.sh --day 2026-08-25     ระบุวัน
#   sh scripts/audit-log.sh --user มายด์          เฉพาะคนนั้น
#   sh scripts/audit-log.sh --table fs_records   เฉพาะตารางนั้น
#   sh scripts/audit-log.sh --only write         เฉพาะชนิดนั้น (write · denied · signed-in …)
#   sh scripts/audit-log.sh --summary            สรุปอย่างเดียว ไม่ต้องรายบรรทัด
set -eu

DIR="${FORMULA_STATE_DIR:-$HOME/.hermes/apps/formula-studio}/monitoring"
DAY="$(date +%Y-%m-%d)"
USER_F=""; TABLE_F=""; ONLY_F=""; SUMMARY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --day) DAY="$2"; shift 2 ;;
    --user) USER_F="$2"; shift 2 ;;
    --table) TABLE_F="$2"; shift 2 ;;
    --only) ONLY_F="$2"; shift 2 ;;
    --summary) SUMMARY=1; shift ;;
    *) echo "ไม่รู้จักตัวเลือก $1" >&2; exit 2 ;;
  esac
done

FILE="$DIR/gateway-$DAY.ndjson"
[ -f "$FILE" ] || { echo "ไม่มีบันทึกของวันที่ $DAY"; exit 0; }

DAY="$DAY" USER_F="$USER_F" TABLE_F="$TABLE_F" ONLY_F="$ONLY_F" SUMMARY="${SUMMARY:-}" \
node -e '
const fs = require("fs");
const rows = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean)
  .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const { USER_F, TABLE_F, ONLY_F, SUMMARY, DAY } = process.env;
const t = at => new Date(at).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" });
const keep = rows.filter(r =>
  (!USER_F || (r.name || r.by || "") === USER_F)
  && (!TABLE_F || r.table === TABLE_F)
  && (!ONLY_F || r.decision === ONLY_F));

console.log(`บันทึกวันที่ ${DAY} — ${keep.length} รายการ` + (keep.length !== rows.length ? ` (จากทั้งหมด ${rows.length})` : ""));

const by = k => keep.reduce((a, r) => (a[r[k] ?? "—"] = (a[r[k] ?? "—"] || 0) + 1, a), {});
const show = (title, o) => {
  const e = Object.entries(o).sort((a, b) => b[1] - a[1]);
  if (!e.length) return;
  console.log("\n" + title);
  for (const [k, v] of e) console.log("  " + String(v).padStart(5) + "  " + k);
};
show("ชนิดของเหตุการณ์", by("decision"));
const writes = keep.filter(r => r.decision === "write" || r.decision === "write-failed");
if (writes.length) {
  show("เขียนแยกตามตาราง", writes.reduce((a, r) => (a[r.table] = (a[r.table] || 0) + (r.rows || 1), a), {}));
  show("เขียนแยกตามคน", writes.reduce((a, r) => (a[r.name || "(ไม่ทราบ)"] = (a[r.name || "(ไม่ทราบ)"] || 0) + 1, a), {}));
}
const ins = keep.filter(r => r.decision === "signed-in");
if (ins.length) {
  console.log("\nเข้าใช้งาน");
  for (const r of ins) console.log("  " + t(r.at) + "  " + (r.name || "") + "  " + (r.role || "") + "  " + (r.email || ""));
}
if (SUMMARY) process.exit(0);
console.log("\nรายบรรทัด");
for (const r of keep) {
  const bits = [t(r.at), r.decision];
  if (r.status) bits.push(String(r.status));
  if (r.table) bits.push(r.table + (r.method ? "/" + r.method : "") + (r.rows ? " ×" + r.rows : ""));
  if (r.name || r.by) bits.push(r.name || r.by);
  if (r.why) bits.push(String(r.why).slice(0, 60));
  console.log("  " + bits.join("  "));
}
' "$FILE"
