#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="${E2E_MATRIX_COMPOSE_FILE:-${ROOT_DIR}/e2e/docker-compose.matrix.yaml}"
MATRIX_PORT="${E2E_MATRIX_PORT:-28008}"
HOMESERVER_URL="${E2E_HOMESERVER:-http://127.0.0.1:${MATRIX_PORT}}"

docker compose -f "${COMPOSE_FILE}" up -d

python3 - "${HOMESERVER_URL}" <<'PY'
import json
import sys
import time
import urllib.error
import urllib.request

base = sys.argv[1].rstrip("/")
url = f"{base}/_matrix/client/versions"
deadline = time.time() + 60
last_error = "unknown error"

while time.time() < deadline:
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            payload = json.loads(response.read().decode())
        if isinstance(payload, dict) and "versions" in payload:
            sys.exit(0)
        last_error = f"unexpected payload: {payload!r}"
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        last_error = str(exc)
    time.sleep(1)

raise SystemExit(f"Timed out waiting for Matrix homeserver at {url}: {last_error}")
PY
