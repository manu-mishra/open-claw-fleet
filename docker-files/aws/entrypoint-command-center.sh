#!/bin/sh
set -eu

DATA_DIR="${DATA_DIR:-/data/command-center}"
POSTGRES_DATA_DIR="${POSTGRES_DATA_DIR:-/data/postgres}"
SHARED_FILES_ROOT="${SHARED_FILES_ROOT:-/data/shared}"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGDATABASE="${PGDATABASE:-command_center}"
PGUSER="${PGUSER:-command_center}"
PGPASSWORD="${PGPASSWORD:-command-center-local}"

export DATA_DIR
export POSTGRES_DATA_DIR
export SHARED_FILES_ROOT
export PGHOST
export PGPORT
export PGDATABASE
export PGUSER
export PGPASSWORD

mkdir -p "$DATA_DIR" "$POSTGRES_DATA_DIR" "$SHARED_FILES_ROOT"

if [ ! -s "$POSTGRES_DATA_DIR/PG_VERSION" ]; then
  initdb -D "$POSTGRES_DATA_DIR" -U "$PGUSER" --auth-host=scram-sha-256 --auth-local=trust >/dev/null
fi

APP_PID=""

shutdown() {
  if [ -n "$APP_PID" ]; then
    kill "$APP_PID" >/dev/null 2>&1 || true
    wait "$APP_PID" >/dev/null 2>&1 || true
  fi
  pg_ctl -D "$POSTGRES_DATA_DIR" -m fast stop >/dev/null 2>&1 || true
}

trap shutdown INT TERM EXIT

pg_ctl \
  -D "$POSTGRES_DATA_DIR" \
  -l "$POSTGRES_DATA_DIR/postgres.log" \
  -o "-c listen_addresses=127.0.0.1 -c port=${PGPORT} -c unix_socket_directories=/tmp" \
  start >/dev/null

attempt=0
until pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -gt 60 ]; then
    echo "PostgreSQL did not become ready in time" >&2
    exit 1
  fi
  sleep 1
done

# Keep role password in sync with current runtime secret (works with local trust over socket).
ESCAPED_PG_PASSWORD="$(printf "%s" "$PGPASSWORD" | sed "s/'/''/g")"
psql \
  -h /tmp \
  -p "$PGPORT" \
  -U "$PGUSER" \
  -d postgres \
  -c "ALTER ROLE \"$PGUSER\" WITH LOGIN PASSWORD '${ESCAPED_PG_PASSWORD}';" >/dev/null

if ! psql -h /tmp -p "$PGPORT" -U "$PGUSER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${PGDATABASE}'" | grep -q 1; then
  createdb -h /tmp -p "$PGPORT" -U "$PGUSER" "$PGDATABASE"
fi

npm run start --workspace=@anycompany/command-center-next &
APP_PID=$!
wait "$APP_PID"
exit $?
