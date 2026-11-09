#!/bin/sh
# ส่งข้อความถึงเจ้าของทาง Telegram ตรงจากสคริปต์ — ไม่ผ่านโมเดล
#
# ทำไมต้องมี: ทางเดียวที่เคยถึงคนคือ cron ของ Hermes ที่ให้โมเดลเลือกเองว่าจะหยิบเรื่องอะไร
# ไปรายงาน · 45 รอบพูดถึงสำรองที่ล้มครั้งเดียว ทั้งที่ล้ม 13 คืน (กฎ 5.3 และ 7.3)
#
# บอทและห้องแชทเดียวกับที่ Hermes ใช้ อ่านจาก ~/.hermes/.env เฉพาะสองคีย์ ไม่ source ทั้งไฟล์
# โทเค็นส่งให้ curl ทาง stdin — ไม่อยู่ใน argv (ps เห็น) และไม่ถูกพิมพ์ลง log ไหนเลย
#
# ใช้: sh scripts/notify-telegram.sh "<ข้อความ>"
# ออก: 0 = Telegram ตอบ ok:true แล้วเท่านั้น · 1 = ส่งไม่ออก (พิมพ์บรรทัดที่มี why=)
set -eu

TEXT="${1:?ต้องระบุข้อความ}"
ENV_FILE="${FORMULA_TELEGRAM_ENV:-$HOME/.hermes/.env}"
API="${FORMULA_TELEGRAM_API:-https://api.telegram.org}"

# รับรูปแบบที่ dotenv ของ Hermes รับ: CRLF · "export " นำหน้า · ช่องว่างรอบ = · มีเครื่องหมายคำพูด
# ไม่งั้นวันที่มีคนเซฟ .env ใหม่ ทางนี้จะพังคนเดียวโดยที่ Hermes ยังใช้ได้ปกติ
env_value() {
  [ -r "$ENV_FILE" ] || return 0
  tr -d '\r' < "$ENV_FILE" \
    | sed -n "s/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}$1[[:space:]]*=[[:space:]]*//p" \
    | tail -1 | sed "s/[[:space:]]*\$//; s/^[\"']//; s/[\"']\$//"
}

TOKEN="$(env_value TELEGRAM_BOT_TOKEN)"
CHAT="${FORMULA_TELEGRAM_CHAT_ID:-$(env_value TELEGRAM_HOME_CHANNEL)}"
if [ -z "$TOKEN" ] || [ -z "$CHAT" ]; then
  echo "telegram=failed why=ไม่พบ TELEGRAM_BOT_TOKEN หรือ TELEGRAM_HOME_CHANNEL ใน $ENV_FILE"
  exit 1
fi

RESP="$(mktemp "${TMPDIR:-/tmp}/formula-tg.XXXXXX")"
trap 'rm -f "$RESP"' EXIT INT TERM

# stderr ของ curl ทิ้งไป เพราะบางรุ่นพิมพ์ URL ทั้งเส้น (ซึ่งมีโทเค็น) ตอนล้ม
# แต่เก็บรหัสออกของ curl ไว้บอกเหตุแทน — หมดเวลากับโทเค็นผิดต้องแยกกันออก
CURL_RC=0
CODE="$(printf 'url = "%s/bot%s/sendMessage"\n' "$API" "$TOKEN" \
  | curl -sS --max-time 20 -K - -o "$RESP" -w '%{http_code}' \
      --data-urlencode "chat_id=$CHAT" \
      --data-urlencode "text=$TEXT" \
      --data-urlencode "disable_web_page_preview=true" 2>/dev/null)" || CURL_RC=$?
CODE="${CODE:-000}"

if [ "$CODE" = 200 ] && grep -q '"ok"[[:space:]]*:[[:space:]]*true' "$RESP"; then
  echo "telegram=sent chat=$CHAT"
  exit 0
fi
case "$CURL_RC" in
  0)  DESC="$(sed -n 's/.*"description"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$RESP" | head -1)"
      WHY="Telegram ไม่ยืนยันว่าส่งถึง${DESC:+ ($DESC)}" ;;
  3)  WHY="URL เสีย — โทเค็นหรือ FORMULA_TELEGRAM_API มีตัวอักษรแปลก" ;;
  6)  WHY="หาชื่อโดเมนไม่เจอ (DNS / เน็ตหลุด)" ;;
  7)  WHY="ต่อเซิร์ฟเวอร์ไม่ได้" ;;
  28) WHY="หมดเวลา 20 วินาที" ;;
  *)  WHY="curl ล้ม" ;;
esac
echo "telegram=failed http=$CODE curl=$CURL_RC why=$WHY"
exit 1
