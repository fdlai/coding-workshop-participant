#!/usr/bin/env bash
# Script: End-to-End Test Runner (Cypress)
# Purpose: Run the Cypress suite against a fresh, seeded test database
# Usage: ./bin/test-e2e.sh [extra cypress run args, e.g. --spec cypress/e2e/01-auth.cy.js]

set -euo pipefail

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    echo "Usage: $0 [cypress run options]"
    echo "Run the Cypress end-to-end suite against a disposable database"
    echo ""
    echo "Description:"
    echo "  1. Creates/resets the PostgreSQL database 'acme_e2e' (never the dev database)"
    echo "  2. Runs Alembic migrations and seeds the demo data"
    echo "  3. Starts the FastAPI backend (port 8000) and Vite (port 5173) against it"
    echo "  4. Runs 'npx cypress run' (headless Electron)"
    echo "  5. Stops both servers, even when tests fail"
    echo ""
    echo "Environment overrides:"
    echo "  TEST_DB_NAME       test database name (must end in _e2e, default acme_e2e)"
    echo "  BACKEND_PORT       backend port (default 8000)"
    echo "  FRONTEND_PORT      Vite port (default 5173)"
    echo "  E2E_DEMO_PASSWORD  password for seeded demo accounts (random if unset)"
    echo ""
    echo "Requirements:"
    echo "  - PostgreSQL running with the credentials in backend/acme-api/.env"
    echo "  - Python 3 (backend/acme-api/.venv and .env are created on first run)"
    echo "  - npm installed (frontend dependencies are installed if missing)"
    exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" > /dev/null 2>&1 || exit 1; pwd -P)"
# shellcheck source=bin/test-stack-lib.sh
source "$SCRIPT_DIR/test-stack-lib.sh"

echo "==================================================="
echo "End-to-End Tests (Cypress)"
echo "==================================================="
echo ""

mkdir -p "$TEST_LOG_DIR"
trap 'echo ""; echo "Stopping servers..."; stop_servers' EXIT
trap 'exit 130' INT TERM

echo "[1/4] Checking ports and tools..."
find_python
require_free_port "$BACKEND_PORT" "the backend"
require_free_port "$FRONTEND_PORT" "the Vite dev server"
echo "  ✓ Ports $BACKEND_PORT and $FRONTEND_PORT are free"
echo ""

echo "[2/4] Preparing database..."
ensure_demo_password
prepare_test_database
echo ""

echo "[3/4] Starting servers..."
start_backend
start_frontend
echo ""

echo "[4/4] Running Cypress..."
set +e
(
    cd "$FRONTEND_DIR" || exit 1
    # VS Code-based terminals export this, which makes Cypress's Electron binary
    # behave like plain Node and fail its smoke test ("bad option: --smoke-test").
    unset ELECTRON_RUN_AS_NODE
    CYPRESS_BASE_URL="http://localhost:$FRONTEND_PORT" \
    CYPRESS_API_URL="http://127.0.0.1:$BACKEND_PORT" \
    CYPRESS_DEMO_PASSWORD="$E2E_DEMO_PASSWORD" \
    npx cypress run "$@"
)
STATUS=$?
set -e

echo ""
if [ "$STATUS" -eq 0 ]; then
    echo "  ✓ All end-to-end tests passed"
else
    echo "  ✗ End-to-end tests failed (exit $STATUS). Screenshots: frontend/cypress/screenshots"
    echo "    Server logs: $TEST_LOG_DIR"
fi
exit "$STATUS"
