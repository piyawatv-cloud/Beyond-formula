#!/bin/sh
set -eu

# initdb/postmaster abort with "postmaster became multithreaded during startup"
# on macOS when the calling shell leaves the locale unset. Pin it so the
# documented command works from any shell.
LC_ALL=${LC_ALL:-C}
export LC_ALL

FS_SQL_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mkdir -p "$FS_SQL_ROOT/.runtime"
FS_SQL_TMP=$(mktemp -d "$FS_SQL_ROOT/.runtime/sql.XXXXXX")
FS_SQL_PORT=$((50000 + ($$ % 10000)))
FS_SQL_LOG="$FS_SQL_TMP/postgres.log"

cleanup() {
  if [ -f "$FS_SQL_TMP/data/postmaster.pid" ]; then
    pg_ctl -D "$FS_SQL_TMP/data" -m fast -w stop >/dev/null 2>&1 || true
  fi
  rm -rf -- "$FS_SQL_TMP"
}
trap cleanup EXIT HUP INT TERM

initdb -D "$FS_SQL_TMP/data" -A trust --no-locale >/dev/null
pg_ctl -D "$FS_SQL_TMP/data" -l "$FS_SQL_LOG" -o "-F -k $FS_SQL_TMP -p $FS_SQL_PORT" -w start >/dev/null
createdb -h "$FS_SQL_TMP" -p "$FS_SQL_PORT" formula_studio_test

PSQL="psql -X -v ON_ERROR_STOP=1 -h $FS_SQL_TMP -p $FS_SQL_PORT -d formula_studio_test"
$PSQL -f "$FS_SQL_ROOT/tests/sql/bootstrap.sql"
$PSQL -f "$FS_SQL_ROOT/supabase/schema.sql"
$PSQL -f "$FS_SQL_ROOT/supabase/schema.sql"
$PSQL -f "$FS_SQL_ROOT/supabase/migrations/20260905140000_cost_gateway_contract.sql"
$PSQL -f "$FS_SQL_ROOT/supabase/migrations/20260905140000_cost_gateway_contract.sql"
$PSQL -f "$FS_SQL_ROOT/tests/sql/cost_gateway_test.sql"
$PSQL -f "$FS_SQL_ROOT/tests/sql/auth_rls_test.sql"
