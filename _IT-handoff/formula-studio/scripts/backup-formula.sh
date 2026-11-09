#!/bin/sh
# สำรองข้อมูล Formula Studio จาก Supabase
#
# กติกาที่ยกมาจากระบบ OPC และห้ามผ่อน:
#   - ไม่ลบไฟล์สำรองเก่าโดยอัตโนมัติ (โหมดสังเกตอย่างเดียว)
#   - เขียน checksum ทุกไฟล์ แล้ว "ตรวจซ้ำ" ทันที — สำรองที่ยังไม่ได้ตรวจ ไม่นับเป็นจุดกู้คืน
#   - ชนิด predeploy ถ้าชนกับรอบอื่น ให้ล้มเลย ไม่ใช่ข้าม เพราะ deploy ต้องมีสำรองของตัวเอง
#
# ใช้: sh scripts/backup-formula.sh [daily|predeploy|manual|weekly]
#      [--plan A03119,A02588 --immutable-commit <commit>]

set -eu
umask 077

KIND="${1:-manual}"
if [ "$#" -gt 0 ]; then shift; fi
BACKUP_PLAN=
BACKUP_COMMIT=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --plan)
      shift
      [ "$#" -gt 0 ] || { echo 'backup status=fail why=plan is required' >&2; exit 2; }
      BACKUP_PLAN=$1
      ;;
    --immutable-commit)
      shift
      [ "$#" -gt 0 ] || { echo 'backup status=fail why=immutable commit is required' >&2; exit 2; }
      BACKUP_COMMIT=$1
      ;;
    *)
      echo 'backup status=fail why=unknown option' >&2
      exit 2
      ;;
  esac
  shift
done
if [ -n "$BACKUP_PLAN" ] || [ -n "$BACKUP_COMMIT" ]; then
  [ -n "$BACKUP_PLAN" ] && [ -n "$BACKUP_COMMIT" ] || {
    echo 'backup status=fail why=plan and immutable commit must be bound together' >&2
    exit 2
  }
  case "$BACKUP_PLAN" in *[!A-Za-z0-9_,.-]*) echo 'backup status=fail why=invalid plan binding' >&2; exit 2;; esac
  case "$BACKUP_COMMIT" in *[!A-Fa-f0-9]*) echo 'backup status=fail why=invalid commit binding' >&2; exit 2;; esac
fi
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${FORMULA_ENV_FILE:-$REPO_DIR/runtime/formula.env}"
ROOT="${FORMULA_STATE_DIR:-$HOME/.hermes/apps/formula-studio}"
BACKUP_ROOT="$ROOT/backups/$KIND"
LOCK_DIR="$ROOT/runtime-state/backup.lock"
LOG_FILE="$ROOT/monitoring/backup.log"

mkdir -p "$BACKUP_ROOT" "$ROOT/runtime-state" "$ROOT/monitoring"

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE"
}

if [ ! -f "$ENV_FILE" ]; then
  log "backup kind=$KIND status=fail why=ไม่พบไฟล์ค่าลับ:$ENV_FILE"
  exit 2
fi
# shellcheck disable=SC1090
. "$ENV_FILE"
# ค่าของชั้นข้อมูลในเครื่องต้องมาทีหลังเสมอ ไม่งั้นสำรองจะยังไปดูด Supabase ที่เลิกใช้แล้ว
# ซึ่งจะ "ผ่าน" ทุกครั้งโดยไม่มีใครรู้ว่ามันสำรองฐานผิดตัวมาตลอด
DATA_ENV_FILE="${FORMULA_DATA_ENV_FILE:-$REPO_DIR/runtime/data.env}"
if [ -f "$DATA_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$DATA_ENV_FILE"
fi
export SB_ORIGIN SB_ORIGIN_HOST SB_REST_BASE SB_UPSTREAM_AUTH SB_ANON_KEY SB_SERVICE_KEY

# ล็อกเดียวใช้ร่วมทุกชนิด กันสองรอบเขียนทับกัน
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  HELD="$(cat "$LOCK_DIR/kind" 2>/dev/null || echo unknown)"
  if [ "$KIND" = "predeploy" ]; then
    log "backup kind=$KIND status=fail why=ล็อกถูกถือโดย:$HELD (predeploy ต้องมีสำรองของตัวเอง จึงไม่ข้าม)"
    exit 3
  fi
  log "backup kind=$KIND status=skip why=ล็อกถูกถือโดย:$HELD"
  exit 0
fi
printf '%s\n' "$KIND" > "$LOCK_DIR/kind"
cleanup() { rm -rf "$LOCK_DIR"; }
trap cleanup EXIT INT TERM

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DEST="$BACKUP_ROOT/$STAMP"
mkdir -p "$DEST"

METHOD="postgrest"
PULL_STATUS=0
if [ -n "${SB_PG_URL:-}" ] && command -v pg_dump >/dev/null 2>&1; then
  METHOD="pg_dump"
  log "backup kind=$KIND method=pg_dump dest=$DEST"
  pg_dump --no-owner --no-privileges --format=custom --file="$DEST/formula.dump" "$SB_PG_URL" || PULL_STATUS=$?
  # จำนวนแถว ณ เวลาที่ดัมป์ — ต้องเขียนไว้ ไม่งั้นตอนกู้คืนจะไม่มีอะไรให้เทียบเลย
  # (ทาง NDJSON เทียบกับจำนวนบรรทัดในไฟล์ได้ ทางดัมป์ไม่มีตัวเลขนั้นอยู่ในตัวมันเอง)
  if [ "$PULL_STATUS" -eq 0 ]; then
    psql -tAq "$SB_PG_URL" -c "
      select json_object_agg(t, c) from (
        select 'fs_records' t, count(*) c from fs_records
        union all select 'fs_chats', count(*) from fs_chats
        union all select 'fs_messages', count(*) from fs_messages
        union all select 'fs_approvals', count(*) from fs_approvals
        union all select 'fs_users', count(*) from fs_users
        union all select 'fs_activities', count(*) from fs_activities
        union all select 'fs_meta', count(*) from fs_meta
      ) s" > "$DEST/row-counts.json" || PULL_STATUS=$?
  fi
else
  if [ -n "${SB_PG_URL:-}" ]; then
    log "backup kind=$KIND note=มี SB_PG_URL แต่ไม่พบคำสั่ง pg_dump จึงถอยไปใช้ PostgREST"
  fi
  log "backup kind=$KIND method=postgrest dest=$DEST"
  node "$REPO_DIR/scripts/pull-supabase-tables.mjs" "$DEST" || PULL_STATUS=$?
fi

# PULL_STATUS 1 = ดึงครบแต่ข้อมูลขยับระหว่างดึง · 2 ขึ้นไป = มีตารางที่ดึงไม่ได้
if [ "$PULL_STATUS" -ge 2 ]; then
  log "backup kind=$KIND status=fail why=ดึงข้อมูลไม่ครบ(code=$PULL_STATUS) dest=$DEST"
  exit 4
fi

# Include private delivery receipts: a browser may have closed before PostgreSQL
# was available. Never print their payloads or discard accepted receipts.
STACK_FILE="${FORMULA_STACK_ENV:-$REPO_DIR/runtime/stack.env}"
[ -f "$STACK_FILE" ] || { log "backup kind=$KIND status=fail why=ไม่พบขอบเขตสแตกที่จะสำรอง"; exit 4; }
# Read the same non-secret stack settings used by compose; do not guess a path.
. "$STACK_FILE"
INTAKE_SOURCE="$FORMULA_STATE_ROOT/job-intake/$FORMULA_PREFIX"
if [ ! -d "$INTAKE_SOURCE" ]; then
  INTAKE_MOUNTS="$(docker inspect -f '{{range .Mounts}}{{println .Destination}}{{end}}' "$FORMULA_PREFIX-runtime-blue" "$FORMULA_PREFIX-runtime-green" 2>/dev/null)" || {
    log "backup kind=$KIND status=fail why=ยืนยันที่รับข้อมูลกลางไม่ได้"; exit 4;
  }
  if printf '%s\n' "$INTAKE_MOUNTS" | grep -q '^/intake$'; then
    log "backup kind=$KIND status=fail why=ที่รับข้อมูลกลางที่เปิดใช้อยู่หายไป"; exit 4;
  fi
fi
node "$REPO_DIR/scripts/backup-job-intake.mjs" backup "$INTAKE_SOURCE" "$DEST/job-intake" || {
  log "backup kind=$KIND status=fail why=สำรองต้นฉบับที่รับเข้ายังไม่ได้ dest=$DEST"
  exit 4
}

# Metadata is immutable provenance, not a second mutable status report.  It must
# exist before the checksum manifest so the manifest and the final log totals
# both describe every file in the finished backup directory.
if [ -n "$BACKUP_PLAN" ]; then
  PLAN_JSON="\"$BACKUP_PLAN\""
  COMMIT_JSON="\"$BACKUP_COMMIT\""
else
  PLAN_JSON=null
  COMMIT_JSON=null
fi
printf '{"format":2,"kind":"%s","stamp":"%s","createdAt":"%s","method":"%s","approvedPlan":%s,"immutableCommit":%s,"movedDuringPull":%s}\n' \
  "$KIND" "$STAMP" "$CREATED_AT" "$METHOD" "$PLAN_JSON" "$COMMIT_JSON" \
  "$( [ "$PULL_STATUS" -eq 1 ] && echo true || echo false )" > "$DEST/backup-meta.json"

# เขียน checksum แล้วตรวจซ้ำทันที (รวม backup-meta.json, ยกเว้น manifest ตัวเอง)
( cd "$DEST" && find . -type f ! -name SHA256SUMS -print0 | xargs -0 shasum -a 256 > SHA256SUMS )
if ! ( cd "$DEST" && shasum -a 256 -c SHA256SUMS >/dev/null 2>&1 ); then
  log "backup kind=$KIND status=fail why=ตรวจ checksum ไม่ผ่าน dest=$DEST"
  exit 5
fi

# Totals are emitted only after the final immutable directory and its manifest
# exist.  Keeping them in the log avoids a self-referential metadata checksum.
BYTES="$(find "$DEST" -type f -exec wc -c {} \; | awk '{s+=$1} END {print s+0}')"
FILES="$(find "$DEST" -type f | wc -l | tr -d ' ')"

printf '%s\n' "$DEST" > "$ROOT/runtime-state/last-backup-$KIND"

if [ "$PULL_STATUS" -eq 1 ]; then
  log "backup kind=$KIND status=ok-with-warning files=$FILES bytes=$BYTES dest=$DEST why=บางตารางข้อมูลขยับระหว่างดึง"
else
  log "backup kind=$KIND status=ok files=$FILES bytes=$BYTES dest=$DEST"
fi
