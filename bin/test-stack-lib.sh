#!/usr/bin/env bash
# Script: Shared helpers for bin/test-e2e.sh and bin/test-load.sh
# Purpose: Reset/migrate/seed the dedicated test database and start/stop the
#          FastAPI backend and the Vite dev server for automated test runs.
# Usage:   source "$SCRIPT_DIR/test-stack-lib.sh"   (not meant to be run directly)
#
# Safety: every database operation targets TEST_DB_NAME (default acme_e2e). The
# Python helpers refuse to touch a database whose name does not end in "_e2e",
# that equals the developer database named in backend/acme-api/.env, or that
# is not on localhost. The developer database is never read or written.

SCRIPT_DIR="${SCRIPT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" > /dev/null 2>&1 || exit 1; pwd -P)}"
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$SCRIPT_DIR/.." > /dev/null 2>&1 || exit 1; pwd -P)}"
BACKEND_DIR="$PROJECT_ROOT/backend/acme-api"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

export PYTHONIOENCODING="${PYTHONIOENCODING:-utf-8}"
export TEST_DB_NAME="${TEST_DB_NAME:-acme_e2e}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
TEST_LOG_DIR="${TEST_LOG_DIR:-$PROJECT_ROOT/tests/.logs}"

BACKEND_PID=""
FRONTEND_PID=""

# shellcheck source=bin/backend-env-lib.sh
source "$SCRIPT_DIR/backend-env-lib.sh"

# Locate the backend virtualenv interpreter, creating the venv and .env on first run.
find_python() {
    ensure_backend_env "$BACKEND_DIR"
    PY="$BACKEND_PYTHON"
}

# True when something already answers on the port (IPv4 or IPv6 localhost).
port_in_use() {
    local port="$1"
    if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$port/" 2>/dev/null; then return 0; fi
    if curl -s -o /dev/null --max-time 2 "http://[::1]:$port/" 2>/dev/null; then return 0; fi
    if curl -s -o /dev/null --max-time 2 "http://localhost:$port/" 2>/dev/null; then return 0; fi
    return 1
}

require_free_port() {
    local port="$1" what="$2"
    if port_in_use "$port"; then
        echo "  ✗ Port $port is already in use, but $what must start fresh on it for this run."
        echo "    Stop the process listening on port $port (e.g. your dev server) and try again."
        exit 1
    fi
}

# Generate a throw-away password for the seeded demo accounts in the test database.
ensure_demo_password() {
    if [ -z "${E2E_DEMO_PASSWORD:-}" ]; then
        E2E_DEMO_PASSWORD="E2e-$(date +%s)-${RANDOM}${RANDOM}-Pw"
    fi
    export E2E_DEMO_PASSWORD
}

# Drop + recreate TEST_DB_NAME, run Alembic migrations, seed demo data.
prepare_test_database() {
    echo "  Resetting database '$TEST_DB_NAME'..."
    (
        cd "$BACKEND_DIR" || exit 1
        POSTGRES_NAME="$TEST_DB_NAME" "$PY" - <<'PY'
import os, re, sys
import psycopg
from psycopg import sql
from dotenv import dotenv_values
from config import settings

target = os.environ["TEST_DB_NAME"]
dev_db = (dotenv_values(".env").get("POSTGRES_NAME") or "acme_db").strip()
if not re.fullmatch(r"[a-z0-9_]+_e2e", target) or target in {dev_db, "acme_db", "acme_test"}:
    sys.exit(f"Refusing to reset {target!r}: test database names must end in '_e2e' and differ from the dev database.")
if settings.POSTGRES_NAME != target:
    sys.exit("POSTGRES_NAME does not match TEST_DB_NAME; refusing to continue.")
if settings.POSTGRES_HOST.lower() not in {"localhost", "127.0.0.1", "::1"}:
    sys.exit(f"Refusing to reset a database on non-local host {settings.POSTGRES_HOST!r}.")

conn_args = dict(host=settings.POSTGRES_HOST, port=settings.POSTGRES_PORT,
                 user=settings.POSTGRES_USER, password=settings.POSTGRES_PASS)
with psycopg.connect(dbname="postgres", autocommit=True, **conn_args) as conn:
    conn.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(target)))
    conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(target)))
print(f"  ✓ Database '{target}' recreated")
PY
    ) || exit 1

    echo "  Running migrations..."
    (cd "$BACKEND_DIR" && POSTGRES_NAME="$TEST_DB_NAME" "$PY" -m alembic upgrade head > "$TEST_LOG_DIR/alembic.log" 2>&1) || {
        echo "  ✗ Alembic migration failed"; tail -n 30 "$TEST_LOG_DIR/alembic.log" | sed 's/^/    /'; exit 1;
    }
    echo "  ✓ Migrations applied"

    echo "  Seeding demo data..."
    (
        cd "$BACKEND_DIR" || exit 1
        POSTGRES_NAME="$TEST_DB_NAME" "$PY" - <<'PY'
import os, sys
from config import settings
target = os.environ["TEST_DB_NAME"]
if settings.POSTGRES_NAME != target or not target.endswith("_e2e"):
    sys.exit("Refusing to seed: target is not the e2e test database.")
from database import SessionLocal
from scripts.seed import seed_all

with SessionLocal() as db:
    try:
        report = seed_all(db, os.environ["E2E_DEMO_PASSWORD"])
        db.commit()
    except Exception:
        db.rollback()
        raise
print(f"  ✓ Seeded: {sum(report.created.values())} records")
PY
    ) || exit 1
}

# Start uvicorn against TEST_DB_NAME and wait for /health.
start_backend() {
    require_free_port "$BACKEND_PORT" "the backend"
    echo "  Starting backend on port $BACKEND_PORT (database '$TEST_DB_NAME')..."
    (
        cd "$BACKEND_DIR" || exit 1
        POSTGRES_NAME="$TEST_DB_NAME" \
        CORS_ORIGINS="http://localhost:$FRONTEND_PORT,http://127.0.0.1:$FRONTEND_PORT" \
        exec "$PY" -m uvicorn main:app --host 127.0.0.1 --port "$BACKEND_PORT" --log-level warning
    ) > "$TEST_LOG_DIR/backend.log" 2>&1 &
    BACKEND_PID=$!
    wait_for_url "http://127.0.0.1:$BACKEND_PORT/health" "backend" "$BACKEND_PID" "$TEST_LOG_DIR/backend.log"
}

# Start Vite (directly via node, so a single process tree) pointed at the test backend.
start_frontend() {
    require_free_port "$FRONTEND_PORT" "the Vite dev server"
    if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
        echo "  Installing frontend dependencies..."
        (cd "$FRONTEND_DIR" && npm ci > "$TEST_LOG_DIR/npm-ci.log" 2>&1) || {
            echo "  ✗ npm ci failed"; tail -n 30 "$TEST_LOG_DIR/npm-ci.log" | sed 's/^/    /'; exit 1;
        }
    fi
    echo "  Starting Vite on port $FRONTEND_PORT..."
    (
        cd "$FRONTEND_DIR" || exit 1
        VITE_API_URL="http://127.0.0.1:$BACKEND_PORT" \
        exec node node_modules/vite/bin/vite.js --port "$FRONTEND_PORT" --strictPort --host localhost
    ) > "$TEST_LOG_DIR/frontend.log" 2>&1 &
    FRONTEND_PID=$!
    wait_for_url "http://localhost:$FRONTEND_PORT/" "frontend" "$FRONTEND_PID" "$TEST_LOG_DIR/frontend.log"
}

wait_for_url() {
    local url="$1" name="$2" pid="$3" log="$4"
    for _ in $(seq 1 60); do
        if curl -s -o /dev/null --max-time 2 "$url"; then
            echo "  ✓ $name ready at $url"
            return 0
        fi
        if ! kill -0 "$pid" 2>/dev/null; then
            echo "  ✗ $name exited during startup:"; tail -n 30 "$log" | sed 's/^/    /'; exit 1
        fi
        sleep 1
    done
    echo "  ✗ $name did not become ready within 60 seconds:"; tail -n 30 "$log" | sed 's/^/    /'; exit 1
}

# Kill a background process and its children (Windows needs taskkill /T for the
# venv launcher and node children; POSIX kills the process group members).
stop_process() {
    local pid="$1"
    [ -z "$pid" ] && return 0
    kill -0 "$pid" 2>/dev/null || return 0
    if [ -r "/proc/$pid/winpid" ] && command -v taskkill > /dev/null 2>&1; then
        taskkill //F //T //PID "$(cat "/proc/$pid/winpid")" > /dev/null 2>&1 || true
    else
        pkill -TERM -P "$pid" 2>/dev/null || true
    fi
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
}

stop_servers() {
    [ -n "$FRONTEND_PID" ] && { stop_process "$FRONTEND_PID"; echo "  ✓ Frontend stopped"; }
    [ -n "$BACKEND_PID" ] && { stop_process "$BACKEND_PID"; echo "  ✓ Backend stopped"; }
    FRONTEND_PID=""
    BACKEND_PID=""
}
