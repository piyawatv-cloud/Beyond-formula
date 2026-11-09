#!/bin/sh
# Classify the unauthenticated public Formula endpoint without treating its
# Cloudflare Access challenge as a cloudflared outage.  It deliberately emits
# no Location value because Access redirect URLs can contain signed state.
set -eu

URL="${1:?ต้องระบุ URL}"
ACCESS_LOGIN_PREFIX="${FORMULA_ACCESS_LOGIN_PREFIX:-https://beyond-workflow.cloudflareaccess.com/cdn-cgi/access/login/}"

# Keep response headers in memory only.  `status=` is an explicit delimiter so
# a header value can never be mistaken for curl's HTTP result.
RESPONSE="$(curl -sS -D - -o /dev/null -w '\nstatus=%{http_code}\n' --max-time 20 "$URL" 2>/dev/null || true)"
CODE="$(printf '%s\n' "$RESPONSE" | awk -F= '/^status=/{code=$2} END{print code}')"
[ -n "$CODE" ] || CODE=000

if [ "$CODE" = 200 ]; then
  echo "public-access=ok http=200"
  exit 0
fi

AUTH="$(printf '%s\n' "$RESPONSE" | tr -d '\r' | awk 'BEGIN{IGNORECASE=1} tolower($1)=="www-authenticate:" {sub(/^[^:]*:[[:space:]]*/, ""); print; exit}')"
LOCATION="$(printf '%s\n' "$RESPONSE" | tr -d '\r' | awk 'BEGIN{IGNORECASE=1} tolower($1)=="location:" {sub(/^[^:]*:[[:space:]]*/, ""); print; exit}')"

case "$CODE:$AUTH:$LOCATION" in
  302:*Cloudflare-Access*:"$ACCESS_LOGIN_PREFIX"*)
    # The only field reported is the known Access host, never the signed path.
    HOST="$(printf '%s' "$ACCESS_LOGIN_PREFIX" | sed -E 's#^https?://([^/]+)/.*#\1#')"
    echo "public-access=expected-access-redirect http=302 location-host=$HOST"
    exit 0
    ;;
esac

WHY="ไม่ตอบ 200 และไม่ใช่ Cloudflare Access 302 ที่ตรวจสอบได้"
[ "$CODE" = 000 ] && WHY="ติดต่อโดเมนจริงไม่ได้"
echo "public-access=unexpected http=$CODE why=$WHY"
exit 1
