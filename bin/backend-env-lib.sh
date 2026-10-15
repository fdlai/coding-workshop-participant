#!/usr/bin/env bash
# Script: Shared backend environment bootstrap for the bin/test-*.sh runners
# Purpose: On a fresh machine (e.g. the workshop VDI), create backend/acme-api/.venv,
#          install requirements.txt + requirements-dev.txt, and create .env from
#          .env.sample. Does nothing when everything is already in place.
# Usage:   source "$SCRIPT_DIR/backend-env-lib.sh"; ensure_backend_env "$API_DIR"
#          Afterwards BACKEND_PYTHON holds the virtualenv interpreter.

# Locate the virtualenv interpreter (Git Bash on Windows uses Scripts/, POSIX bin/).
find_backend_python() {
    local api_dir="$1"
    if [ -x "$api_dir/.venv/Scripts/python.exe" ] || [ -x "$api_dir/.venv/Scripts/python" ]; then
        BACKEND_PYTHON="$api_dir/.venv/Scripts/python"
    elif [ -x "$api_dir/.venv/bin/python" ]; then
        BACKEND_PYTHON="$api_dir/.venv/bin/python"
    else
        BACKEND_PYTHON=""
    fi
}

ensure_backend_env() {
    local api_dir="$1"

    find_backend_python "$api_dir"
    if [ -z "$BACKEND_PYTHON" ]; then
        local base_python=""
        for candidate in python3.13 python3 python; do
            if command -v "$candidate" > /dev/null 2>&1; then
                base_python="$candidate"
                break
            fi
        done
        if [ -z "$base_python" ]; then
            echo "ERROR: Python 3 is not installed (run ./bin/setup-environment.sh)"
            exit 1
        fi
        echo "Creating virtualenv in $api_dir/.venv with $base_python..."
        (cd "$api_dir" && "$base_python" -m venv .venv) || exit 1
        find_backend_python "$api_dir"
    fi

    # Install dependencies when pytest-cov (the newest dev requirement) is missing
    if ! (cd "$api_dir" && "$BACKEND_PYTHON" -c "import pytest_cov, fastapi") > /dev/null 2>&1; then
        echo "Installing backend dependencies..."
        (
            cd "$api_dir" &&
            "$BACKEND_PYTHON" -m pip install --quiet --upgrade pip &&
            "$BACKEND_PYTHON" -m pip install --quiet -r requirements.txt -r requirements-dev.txt
        ) || exit 1
    fi

    # Local settings: start from the VDI defaults when no .env exists yet
    if [ ! -f "$api_dir/.env" ]; then
        echo "No .env found; copying .env.sample (edit it if your PostgreSQL credentials differ)"
        cp "$api_dir/.env.sample" "$api_dir/.env"
    fi
}
