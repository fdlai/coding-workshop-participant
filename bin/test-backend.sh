#!/usr/bin/env bash
# Script: Backend Test Runner
# Purpose: Run the acme-api pytest suite with coverage (SQLite by default, or PostgreSQL)
# Usage: ./test-backend.sh [--postgres] [pytest args...]

set -e

# Usage helper
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    echo "Usage: $0 [--postgres] [pytest args...]"
    echo "Run the backend (acme-api) test suite with code coverage"
    echo ""
    echo "Description:"
    echo "  Default: runs every test on an isolated in-memory SQLite database."
    echo "  --postgres: runs the same suite (plus PostgreSQL-only integration tests)"
    echo "  against a disposable local database named \$TEST_DB_NAME (default: acme_test),"
    echo "  creating it if missing. Connection settings come from backend/acme-api/.env"
    echo "  (POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASS)."
    echo "  The application database (POSTGRES_NAME) is never used."
    echo ""
    echo "Options:"
    echo "  --postgres      Run against PostgreSQL instead of SQLite"
    echo "  -h, --help      Show this help message"
    echo "  Any other arguments are passed to pytest (e.g. -k budget, -x)."
    echo ""
    echo "Requirements:"
    echo "  - Python 3 (the script creates backend/acme-api/.venv and installs"
    echo "    requirements.txt + requirements-dev.txt on first run)"
    echo "  - --postgres: a running PostgreSQL server reachable with the .env credentials"
    echo "    (copied from .env.sample on first run if .env is missing)"
    exit 0
fi

USE_POSTGRES=false
if [ "$1" = "--postgres" ]; then
    USE_POSTGRES=true
    shift
fi

# Resolve script directory and project root paths
SCRIPT_DIR="$(cd "$(dirname "$0")" > /dev/null 2>&1 || exit 1; pwd -P)"
PROJECT_ROOT="$(cd $SCRIPT_DIR/.. > /dev/null 2>&1 || exit 1; pwd -P)"
API_DIR="$PROJECT_ROOT/backend/acme-api"

# First run on a fresh machine (e.g. the workshop VDI): create .venv, install deps, create .env
# shellcheck source=bin/backend-env-lib.sh
source "$SCRIPT_DIR/backend-env-lib.sh"
ensure_backend_env "$API_DIR"
PYTHON="$BACKEND_PYTHON"

cd "$API_DIR"

echo "======================================"
echo "Coding Workshop - Backend Tests"
echo "======================================"
echo ""

if [ "$USE_POSTGRES" = true ]; then
    export TEST_DB_NAME="${TEST_DB_NAME:-acme_test}"
    echo "Database: PostgreSQL ($TEST_DB_NAME)"

    if [ -z "$TEST_DATABASE_URL" ]; then
        # Builds the URL from config.settings (.env + environment) and creates the
        # database if missing. The password is never printed.
        TEST_DATABASE_URL="$("$PYTHON" - <<'PY'
import os
import sys

import psycopg
from psycopg import sql
from sqlalchemy.engine import URL

from config import settings

name = os.environ["TEST_DB_NAME"]
if not name.endswith("_test") or name == settings.POSTGRES_NAME:
    sys.exit(f"Refusing to use database {name!r}: the name must end in '_test' and differ from POSTGRES_NAME")

try:
    with psycopg.connect(
        host=settings.POSTGRES_HOST,
        port=settings.POSTGRES_PORT,
        user=settings.POSTGRES_USER,
        password=settings.POSTGRES_PASS,
        dbname="postgres",
        autocommit=True,
        connect_timeout=10,
    ) as conn:
        if conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone() is None:
            conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
            print(f"Created database {name}", file=sys.stderr)
except psycopg.OperationalError as exc:
    sys.exit(f"Cannot connect to PostgreSQL at {settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}: {exc}")

print(
    URL.create(
        "postgresql+psycopg",
        username=settings.POSTGRES_USER,
        password=settings.POSTGRES_PASS,
        host=settings.POSTGRES_HOST,
        port=settings.POSTGRES_PORT,
        database=name,
    ).render_as_string(hide_password=False)
)
PY
)"
    fi
    export TEST_DATABASE_URL
else
    echo "Database: in-memory SQLite"
    unset TEST_DATABASE_URL
fi
echo ""

"$PYTHON" -m pytest --cov --cov-report=term-missing "$@"
