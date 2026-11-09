#!/bin/sh
set -eu
export LC_ALL="${LC_ALL:-C}"
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/formula-compat.XXXXXX")
port=$((50000 + ($$ % 10000)))
cleanup(){ if [ -f "$tmp/data/postmaster.pid" ]; then pg_ctl -D "$tmp/data" -m fast -w stop >/dev/null 2>&1 || true; fi; rm -rf -- "$tmp"; }
trap cleanup EXIT HUP INT TERM
initdb -D "$tmp/data" -A trust --no-locale >/dev/null
pg_ctl -D "$tmp/data" -l "$tmp/postgres.log" -o "-F -k $tmp -p $port -c listen_addresses=''" -w start >/dev/null
createdb -h "$tmp" -p "$port" formula_compat
psql_cmd="psql -X -q -v ON_ERROR_STOP=1 -h $tmp -p $port -d formula_compat"
$psql_cmd -f "$root/tests/sql/bootstrap.sql" > "$tmp/setup.log" 2>&1
$psql_cmd -f "$root/supabase/schema.sql" >> "$tmp/setup.log" 2>&1
$psql_cmd -f "$root/mobile-preview/simulation/legacy-compat.sql" > "$tmp/result.log" 2>&1
cat "$tmp/result.log"
if grep -Eq 'UNSAFE|REVIEW' "$tmp/result.log"; then
 printf '%s\n' 'FAIL: compatibility guard unresolved; do not connect shared production data'
 exit 1
fi
printf '%s\n' 'PASS: tested compatibility guards'
