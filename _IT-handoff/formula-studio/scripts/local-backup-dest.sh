#!/bin/sh
# ปลายทางสำรองใน iMac แยกจากซอร์สและพื้นที่ทำงานของ Formula Studio
# ไม่ใช่สำรองนอกสถานที่: เครื่องเดียวกันยังมีความเสี่ยงร่วมกัน
set -eu

FORMULA_RUNTIME_REPO_ROOT="${FORMULA_RUNTIME_REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
FORMULA_LOCAL_BACKUP_ROOT="${FORMULA_LOCAL_BACKUP_ROOT:-$FORMULA_RUNTIME_REPO_ROOT/.formula-backups}"
LOCAL_BACKUP_DEST_ROOT="$FORMULA_LOCAL_BACKUP_ROOT"
