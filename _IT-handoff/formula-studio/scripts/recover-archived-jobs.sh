#!/bin/sh
# Operator-only wrapper for the reviewed archived-job recovery function.
#
# Default is read-only. No business payload is accepted, generated, or printed.
# Execute mode is fail-closed until the caller supplies and verifies:
#   * an immutable commit containing every executable helper used by this wrapper;
#   * release evidence tied to that exact commit;
#   * a clear release/transition lock evidence;
#   * a fresh backup with a verified SHA256SUMS file and isolated restore proof.
set -eu

usage() {
  cat >&2 <<'EOF'
usage:
  recover-archived-jobs.sh --dry-run \
    --immutable-commit COMMIT --release-evidence FILE --lock-evidence FILE
  recover-archived-jobs.sh --execute --confirm-plan A03119,A02588 \
    --immutable-commit COMMIT --release-evidence FILE --lock-evidence FILE \
    --backup DIR --backup-proof FILE

The connection must be supplied through SB_PG_URL (or PSQL_SERVICE), never a
payload file. Execute mode requires the exact approved plan confirmation.
Evidence files must be sanitized and must not contain secrets or business data.
EOF
}

MODE=
CONFIRM=
IMMUTABLE_COMMIT=
RELEASE_EVIDENCE=
LOCK_EVIDENCE=
BACKUP_DIR=
BACKUP_PROOF=

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      [ -z "$MODE" ] || { usage; exit 2; }
      MODE=dry-run
      ;;
    --execute)
      [ -z "$MODE" ] || { usage; exit 2; }
      MODE=execute
      ;;
    --confirm-plan)
      shift
      [ "$#" -gt 0 ] || { usage; exit 2; }
      CONFIRM=$1
      ;;
    --immutable-commit)
      shift
      [ "$#" -gt 0 ] || { usage; exit 2; }
      IMMUTABLE_COMMIT=$1
      ;;
    --release-evidence)
      shift
      [ "$#" -gt 0 ] || { usage; exit 2; }
      RELEASE_EVIDENCE=$1
      ;;
    --lock-evidence)
      shift
      [ "$#" -gt 0 ] || { usage; exit 2; }
      LOCK_EVIDENCE=$1
      ;;
    --backup)
      shift
      [ "$#" -gt 0 ] || { usage; exit 2; }
      BACKUP_DIR=$1
      ;;
    --backup-proof)
      shift
      [ "$#" -gt 0 ] || { usage; exit 2; }
      BACKUP_PROOF=$1
      ;;
    *)
      usage
      exit 2
      ;;
  esac
  shift
done

[ -n "$MODE" ] || { echo 'recovery status=blocked why=mode is required' >&2; exit 3; }
[ -n "$IMMUTABLE_COMMIT" ] || { echo 'recovery status=blocked why=immutable commit is required' >&2; exit 3; }
[ -n "$RELEASE_EVIDENCE" ] || { echo 'recovery status=blocked why=release evidence is required' >&2; exit 3; }
[ -n "$LOCK_EVIDENCE" ] || { echo 'recovery status=blocked why=lock evidence is required' >&2; exit 3; }

REPO_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if ! git -C "$REPO_DIR" rev-parse --verify "$IMMUTABLE_COMMIT^{commit}" >/dev/null 2>&1; then
  echo 'recovery status=blocked why=immutable commit cannot be verified' >&2
  exit 4
fi
if [ "$(git -C "$REPO_DIR" rev-parse HEAD)" != "$IMMUTABLE_COMMIT" ]; then
  echo 'recovery status=blocked why=worktree is not at immutable commit' >&2
  exit 4
fi

# These are the only executable helpers used by the wrapper. Tests are not
# invoked at runtime; if a future wrapper invokes a test, its path must be added
# here before release. Require both clean working-tree state and byte equality
# with the immutable commit so a dirty helper cannot silently substitute itself.
REQUIRED_FILES='runtime/archived-job-recovery.sql scripts/recover-archived-jobs.sh scripts/backup-formula.sh scripts/verify-restore-formula.sh scripts/validate-recovery-backup.mjs'
if [ -n "$(git -C "$REPO_DIR" status --porcelain --untracked-files=all -- $REQUIRED_FILES)" ]; then
  echo 'recovery status=blocked why=executable helper working tree is dirty' >&2
  exit 4
fi
for REQUIRED_FILE in $REQUIRED_FILES; do
  if ! git -C "$REPO_DIR" cat-file -e "$IMMUTABLE_COMMIT:$REQUIRED_FILE" 2>/dev/null; then
    echo 'recovery status=blocked why=immutable commit is missing an executable helper' >&2
    exit 4
  fi
  IMMUTABLE_BLOB="$(git -C "$REPO_DIR" rev-parse "$IMMUTABLE_COMMIT:$REQUIRED_FILE")"
  WORKTREE_BLOB="$(git -C "$REPO_DIR" hash-object "$REPO_DIR/$REQUIRED_FILE")"
  if [ "$IMMUTABLE_BLOB" != "$WORKTREE_BLOB" ]; then
    echo 'recovery status=blocked why=executable helper bytes differ from immutable commit' >&2
    exit 4
  fi
done

if [ ! -f "$RELEASE_EVIDENCE" ] || ! grep -Fq "immutable_commit=$IMMUTABLE_COMMIT" "$RELEASE_EVIDENCE"; then
  echo 'recovery status=blocked why=release evidence does not match immutable commit' >&2
  exit 4
fi
if [ ! -f "$LOCK_EVIDENCE" ] || ! grep -Eq '(^|[[:space:]])(lock|transition)=(clear|idle|not_active)($|[[:space:]])' "$LOCK_EVIDENCE"; then
  echo 'recovery status=blocked why=release or transition lock is not clear' >&2
  exit 4
fi

if [ "$MODE" = execute ] && [ "$CONFIRM" != 'A03119,A02588' ]; then
  echo 'recovery status=blocked why=exact approved plan confirmation required' >&2
  exit 3
fi

if [ -z "${SB_PG_URL:-}" ] && [ -z "${PSQL_SERVICE:-}" ]; then
  echo 'recovery status=blocked why=approved PostgreSQL connection is not configured' >&2
  exit 4
fi

if [ "$MODE" = execute ]; then
  [ -n "$BACKUP_DIR" ] || { echo 'recovery status=blocked why=fresh backup path is required' >&2; exit 4; }
  [ -n "$BACKUP_PROOF" ] || { echo 'recovery status=blocked why=isolated backup proof path is required' >&2; exit 4; }
  if [ ! -d "$BACKUP_DIR" ] || [ ! -f "$BACKUP_DIR/SHA256SUMS" ]; then
    echo 'recovery status=blocked why=fresh backup checksum manifest is missing' >&2
    exit 4
  fi
  if ! (cd "$BACKUP_DIR" && shasum -a 256 -c SHA256SUMS >/dev/null 2>&1); then
    echo 'recovery status=blocked why=backup checksum verification failed' >&2
    exit 4
  fi
  if ! node "$REPO_DIR/scripts/validate-recovery-backup.mjs" "$BACKUP_DIR" "$CONFIRM" "$IMMUTABLE_COMMIT" >/dev/null 2>&1; then
    echo 'recovery status=blocked why=backup is stale or not bound to plan and immutable commit' >&2
    exit 4
  fi
  if [ ! -f "$BACKUP_PROOF" ] ||
     ! grep -Fq 'verify-restore status=ok' "$BACKUP_PROOF" ||
     ! grep -Fq 'verify-restore checksum=ok' "$BACKUP_PROOF" ||
     ! grep -Fq "verify-restore plan=$CONFIRM" "$BACKUP_PROOF" ||
     ! grep -Fq "verify-restore immutable_commit=$IMMUTABLE_COMMIT" "$BACKUP_PROOF"; then
    echo 'recovery status=blocked why=isolated restore proof is not verified' >&2
    exit 4
  fi
  if ! FORMULA_VERIFY_PLAN="$CONFIRM" FORMULA_VERIFY_COMMIT="$IMMUTABLE_COMMIT" \
    sh "$REPO_DIR/scripts/verify-restore-formula.sh" "$BACKUP_DIR" >/dev/null 2>&1; then
    echo 'recovery status=blocked why=isolated restore verification failed' >&2
    exit 4
  fi
fi

PSQL_ARGS='-X -v ON_ERROR_STOP=1 -v VERBOSITY=terse -q -At'
if [ -n "${PSQL_SERVICE:-}" ]; then
  # shellcheck disable=SC2086
  PSQL_TARGET="service=$PSQL_SERVICE"
else
  PSQL_TARGET=$SB_PG_URL
fi

if [ "$MODE" = dry-run ]; then
  # shellcheck disable=SC2086
  psql $PSQL_ARGS "$PSQL_TARGET" -c 'select public.fs_archived_job_recovery_report();'
  echo 'recovery status=dry-run why=read-only archive reconciliation completed'
  exit 0
fi

# The function is the only mutating statement and is executed in one bounded
# transaction. A function error causes ON_ERROR_STOP to abort the transaction;
# the wrapper never follows it with cleanup or a second write.
# shellcheck disable=SC2086
RESULT="$(psql $PSQL_ARGS --single-transaction "$PSQL_TARGET" -c "set formula.archived_job_recovery='fs_archive:v2'; select public.fs_restore_archived_jobs();")"
printf '%s\n' "$RESULT"
echo 'recovery status=verified_in_transaction why=operator procedure returned post-write assertions'
