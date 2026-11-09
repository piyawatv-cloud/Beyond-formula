#!/bin/sh
# ผนึกสำเนา index.html ของ Formula Studio ไว้หนึ่งรุ่น แล้วชี้ CURRENT มาที่รุ่นนี้
#
# ทำไมต้องผนึก แทนที่จะดึงจาก Vercel ทุกครั้ง:
#   - runtime นี้เป็นทางเข้าทางเดียวของผู้ใช้ ถ้าปลายทางเป็น Vercel เมื่อ Vercel ล่ม
#     หรือขึ้นหน้า challenge (ระบบ OPC เคยโดน 578 คำขอในวันเดียว) ผู้ใช้เข้าไม่ได้ทันที
#   - ผนึกแล้วเรารู้แน่ว่าแต่ละสีเสิร์ฟไฟล์เดียวกันไบต์ต่อไบต์ ซึ่งเป็นเงื่อนไขของด่านเทียบสองสี
#   - ผลข้างเคียงที่ต้องรู้: push ขึ้น GitHub ของ Formula Studio จะไม่ถึงผู้ใช้อีกต่อไป
#     จนกว่าจะรันสคริปต์นี้ซ้ำ นี่คือการเปลี่ยนวิธีปล่อยของ ไม่ใช่ผลข้างเคียงเล็ก ๆ
#
# ใช้: sh scripts/seal-release.sh [git-ref]     (ไม่ใส่ = main)

set -eu

REF="${1:-main}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UPSTREAM="${FORMULA_UPSTREAM_RAW:-https://raw.githubusercontent.com/phossatron/Beyond-formula}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM

echo "seal ref=$REF"
curl -fsS --max-time 120 -o "$WORK/index.html" "$UPSTREAM/$REF/index.html"

BYTES="$(wc -c < "$WORK/index.html" | tr -d ' ')"
[ "$BYTES" -gt 200000 ] || { echo "seal status=fail why=ไฟล์เล็กผิดปกติ($BYTES ไบต์) น่าจะไม่ใช่ index.html จริง" >&2; exit 2; }

# ตรวจว่าไฟล์ที่ดึงมามีสิ่งที่ runtime ต้องพึ่งครบ — ถ้าอันไหนหาย ห้ามผนึก
for NEEDLE in "let SB_URL" "let SB_KEY" "<head>" "</head>" "</body>" "hdr-sub"; do
  grep -qF "$NEEDLE" "$WORK/index.html" || {
    echo "seal status=fail why=ไม่พบข้อความที่ runtime ต้องใช้: $NEEDLE" >&2; exit 3; }
done

HASH="$(shasum -a 256 "$WORK/index.html" | cut -c1-12)"
DEST="$REPO_DIR/releases/$HASH"
STAMP="$(grep -o 'build [0-9][0-9.-]*' "$WORK/index.html" | head -1 || true)"
COMMIT="$(curl -fsS --max-time 60 "https://api.github.com/repos/phossatron/Beyond-formula/commits/$REF" 2>/dev/null \
          | sed -n 's/.*"sha": *"\([0-9a-f]\{40\}\)".*/\1/p' | head -1 || true)"

mkdir -p "$DEST"
cp "$WORK/index.html" "$DEST/index.html"
( cd "$DEST" && shasum -a 256 index.html > MANIFEST.sha256 )
printf '{"id":"%s","ref":"%s","commit":"%s","buildStamp":"%s","bytes":%s,"sealedAt":"%s"}\n' \
  "$HASH" "$REF" "$COMMIT" "$STAMP" "$BYTES" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DEST/meta.json"

( cd "$DEST" && shasum -a 256 -c MANIFEST.sha256 >/dev/null ) || {
  echo "seal status=fail why=ตรวจ MANIFEST ไม่ผ่าน" >&2; exit 4; }

printf '%s\n' "$HASH" > "$REPO_DIR/releases/CURRENT"
echo "seal status=ok id=$HASH bytes=$BYTES stamp=\"$STAMP\" commit=${COMMIT:-unknown}"
