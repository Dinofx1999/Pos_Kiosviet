#!/bin/sh
# Usage: backup.sh <host> <user> <db> <outdir>
# Creates a compressed pg_dump and keeps the last 14 files.
set -e
HOST=${1:-localhost}; USER=${2:-erp}; DB=${3:-retail_erp}; OUT=${4:-./backups}
mkdir -p "$OUT"
STAMP=$(date +%Y%m%d-%H%M%S)
FILE="$OUT/$DB-$STAMP.dump"
pg_dump -h "$HOST" -U "$USER" -Fc "$DB" > "$FILE"
echo "backup written: $FILE"
ls -1t "$OUT"/$DB-*.dump 2>/dev/null | tail -n +15 | xargs -r rm -f
