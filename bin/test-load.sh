#!/usr/bin/env bash
# Script: API Load Test Runner (Artillery)
# Purpose: Load-test the FastAPI backend on a fresh, seeded test database and
#          record latency, throughput, errors and backend CPU/memory
# Usage: ./bin/test-load.sh [extra artillery run args]

set -euo pipefail

ARTILLERY_VERSION="2.0.34"

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    echo "Usage: $0 [artillery run options]"
    echo "Run the Artillery load test (tests/load/api-load.yml) against a local backend"
    echo ""
    echo "Description:"
    echo "  1. Creates/resets the PostgreSQL database 'acme_e2e' and seeds demo data"
    echo "  2. Starts the FastAPI backend on port 8000 against it"
    echo "  3. Samples backend CPU/memory once per second while"
    echo "  4. 'npx artillery@$ARTILLERY_VERSION run' executes the scenario"
    echo "  5. Writes report, resource samples and a summary to tests/load/reports/"
    echo "  6. Stops the backend; exits non-zero if any 'ensure' threshold failed"
    echo ""
    echo "Environment overrides: TEST_DB_NAME (must end in _e2e), BACKEND_PORT, E2E_DEMO_PASSWORD"
    exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" > /dev/null 2>&1 || exit 1; pwd -P)"
# shellcheck source=bin/test-stack-lib.sh
source "$SCRIPT_DIR/test-stack-lib.sh"

LOAD_DIR="$PROJECT_ROOT/tests/load"
REPORT_DIR="$LOAD_DIR/reports"
STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT_JSON="$REPORT_DIR/report-$STAMP.json"
RESOURCES_CSV="$REPORT_DIR/resources-$STAMP.csv"
SUMMARY_MD="$REPORT_DIR/summary-$STAMP.md"
STOP_FLAG="$REPORT_DIR/.monitor-stop-$STAMP"
MONITOR_PID=""

echo "==================================================="
echo "API Load Test (Artillery $ARTILLERY_VERSION)"
echo "==================================================="
echo ""

mkdir -p "$TEST_LOG_DIR" "$REPORT_DIR"

stop_monitor() {
    [ -z "$MONITOR_PID" ] && return 0
    touch "$STOP_FLAG"
    for _ in 1 2 3 4 5; do kill -0 "$MONITOR_PID" 2>/dev/null || break; sleep 1; done
    stop_process "$MONITOR_PID"
    rm -f "$STOP_FLAG"
    MONITOR_PID=""
}
trap 'echo ""; echo "Cleaning up..."; stop_monitor; stop_servers' EXIT
trap 'exit 130' INT TERM

# PID of the process listening on the backend port (the real Python process, not the
# venv launcher on Windows).
listener_pid() {
    if command -v netstat > /dev/null 2>&1 && [ -n "${WINDIR:-}" ]; then
        netstat -ano | tr -d '\r' | awk -v p=":$BACKEND_PORT" '$1=="TCP" && $2 ~ p"$" && $4=="LISTENING" {print $5; exit}'
    elif command -v lsof > /dev/null 2>&1; then
        lsof -t -iTCP:"$BACKEND_PORT" -sTCP:LISTEN | head -1
    else
        ss -ltnp 2>/dev/null | awk -v p=":$BACKEND_PORT" '$4 ~ p"$" {match($0, /pid=[0-9]+/); print substr($0, RSTART+4, RLENGTH-4); exit}'
    fi
}

# Sample CPU (% of one core) and resident memory (MB) once per second.
start_monitor() {
    local pid="$1"
    if [ -n "${WINDIR:-}" ] && command -v powershell > /dev/null 2>&1; then
        powershell -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$LOAD_DIR/monitor-process.ps1")" \
            -ProcessId "$pid" -OutFile "$(cygpath -w "$RESOURCES_CSV")" -StopFile "$(cygpath -w "$STOP_FLAG")" \
            > "$TEST_LOG_DIR/monitor.log" 2>&1 &
    else
        (
            echo "timestamp,cpu_percent,rss_mb" > "$RESOURCES_CSV"
            while [ ! -f "$STOP_FLAG" ] && kill -0 "$pid" 2>/dev/null; do
                # ps %cpu is a decaying average on macOS and a lifetime average on Linux,
                # so on Linux derive per-second CPU from /proc instead.
                if [ -r "/proc/$pid/stat" ]; then
                    t1=$(awk '{print $14+$15}' "/proc/$pid/stat"); sleep 1
                    t2=$(awk '{print $14+$15}' "/proc/$pid/stat" 2>/dev/null || echo "$t1")
                    cpu=$(awk -v a="$t1" -v b="$t2" -v hz="$(getconf CLK_TCK)" 'BEGIN{printf "%.1f", (b-a)*100/hz}')
                else
                    sleep 1; cpu=$(ps -o %cpu= -p "$pid" | tr -d ' ')
                fi
                rss=$(ps -o rss= -p "$pid" | awk '{printf "%.1f", $1/1024}')
                echo "$(date -u +%Y-%m-%dT%H:%M:%SZ),$cpu,$rss" >> "$RESOURCES_CSV"
            done
        ) &
    fi
    MONITOR_PID=$!
}

echo "[1/4] Checking ports and tools..."
find_python
require_free_port "$BACKEND_PORT" "the backend"
echo "  ✓ Port $BACKEND_PORT is free"
echo ""

echo "[2/4] Preparing database..."
ensure_demo_password
prepare_test_database
echo ""

echo "[3/4] Starting backend..."
start_backend
BACKEND_OS_PID="$(listener_pid || true)"
if [ -n "$BACKEND_OS_PID" ]; then
    start_monitor "$BACKEND_OS_PID"
    echo "  ✓ Sampling backend process $BACKEND_OS_PID (CPU/memory) every second"
else
    echo "  ⚠ Could not find the backend process; resource sampling skipped"
fi
echo ""

echo "[4/4] Running Artillery (about 2.5 minutes)..."
set +e
(
    cd "$PROJECT_ROOT" || exit 1
    LOAD_TEST_PASSWORD="$E2E_DEMO_PASSWORD" \
    npx -y "artillery@$ARTILLERY_VERSION" run \
        --target "http://127.0.0.1:$BACKEND_PORT" \
        --output "$REPORT_JSON" \
        "$@" "$LOAD_DIR/api-load.yml" 2>&1 | grep -v "EBADENGINE\|npm WARN" | tee "$TEST_LOG_DIR/artillery.log"
    exit "${PIPESTATUS[0]}"
)
STATUS=$?
set -e
stop_monitor

echo ""
if [ -f "$REPORT_JSON" ]; then
    node "$LOAD_DIR/summarize.mjs" "$REPORT_JSON" "$RESOURCES_CSV" "$SUMMARY_MD"
    echo ""
    echo "  Report:    $REPORT_JSON"
    echo "  Resources: $RESOURCES_CSV"
    echo "  Summary:   $SUMMARY_MD"
fi
echo ""
if [ "$STATUS" -eq 0 ]; then
    echo "  ✓ Load test passed all thresholds"
else
    echo "  ✗ Load test failed (exit $STATUS): a threshold was violated or Artillery errored"
fi
exit "$STATUS"
