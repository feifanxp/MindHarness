#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MATRIX_PORT="${E2E_MATRIX_PORT:-28008}"
HOMESERVER_URL="${E2E_HOMESERVER:-http://127.0.0.1:${MATRIX_PORT}}"
SERVER_NAME="${E2E_MATRIX_SERVER_NAME:-matrix.localhost}"
FIXTURE_ALIAS_LOCAL="${E2E_FIXTURE_ROOM_ALIAS_LOCAL:-cinny-e2e-fixture}"
FIXTURE_ALIAS="${E2E_FIXTURE_ROOM_ALIAS:-#${FIXTURE_ALIAS_LOCAL}:${SERVER_NAME}}"
DEPLOYED_PORT="${E2E_DEPLOYED_PORT:-28090}"
DEPLOYED_BASE_URL="${E2E_DEPLOYED_BASE_URL:-http://127.0.0.1:${DEPLOYED_PORT}}"
AUTO_DOWN="${E2E_MATRIX_AUTO_DOWN:-0}"

cleanup() {
  if [ -n "${DEPLOYED_PREVIEW_PID:-}" ]; then
    kill "${DEPLOYED_PREVIEW_PID}" 2>/dev/null || true
    wait "${DEPLOYED_PREVIEW_PID}" 2>/dev/null || true
  fi

  if [ "${AUTO_DOWN}" = "1" ]; then
    "${ROOT_DIR}/scripts/e2e-matrix-down.sh" >/dev/null
  fi
}

trap cleanup EXIT INT TERM

export E2E_HOMESERVER="${HOMESERVER_URL}"
export E2E_FIXTURE_ROOM_ALIAS="${FIXTURE_ALIAS}"

"${ROOT_DIR}/scripts/e2e-matrix-up.sh"

RUN_SUFFIX="$(date +%s)${RANDOM}"
eval "$("${ROOT_DIR}/scripts/ensure-e2e-account.sh" E2E "cinnye2eprimary${RUN_SUFFIX}" 'Pwcinnye2eprimary123!')"
eval "$("${ROOT_DIR}/scripts/ensure-e2e-account.sh" E2E_SECOND "cinnye2esecond${RUN_SUFFIX}" 'Pwcinnye2esecond123!')"
eval "$("${ROOT_DIR}/scripts/ensure-e2e-account.sh" E2E_THIRD "cinnye2ethird${RUN_SUFFIX}" 'Pwcinnye2ethird123!')"
eval "$("${ROOT_DIR}/scripts/ensure-e2e-account.sh" E2E_DEACTIVATE "cinnye2edeactivate${RUN_SUFFIX}" 'Pwcinnye2edeactivate123!')"

cd "${ROOT_DIR}"
node ./e2e/live/seed-fixture-room.mjs

export E2E_FIXTURE_ROOM_ID="$(
  node --input-type=module -e '
    const homeserver = process.env.E2E_HOMESERVER;
    const alias = process.env.E2E_FIXTURE_ROOM_ALIAS;
    const url = `${homeserver}/_matrix/client/v3/directory/room/${encodeURIComponent(alias)}`;
    const response = await fetch(url);
    const body = await response.json();
    if (!response.ok || typeof body.room_id !== "string") {
      console.error(`Failed to resolve fixture room alias ${alias}: ${JSON.stringify(body)}`);
      process.exit(1);
    }
    process.stdout.write(body.room_id);
  '
)"

if [ "${E2E_ENABLE_DEPLOYED_FIXTURE:-1}" = "1" ]; then
  npm run build >/dev/null
  export E2E_DEPLOYED_BASE_URL="${DEPLOYED_BASE_URL}"
  export E2E_DEPLOYED_HOMESERVER="${E2E_DEPLOYED_HOMESERVER:-${E2E_HOMESERVER}}"
  export E2E_DEPLOYED_USERNAME="${E2E_DEPLOYED_USERNAME:-${E2E_USERNAME}}"
  export E2E_DEPLOYED_PASSWORD="${E2E_DEPLOYED_PASSWORD:-${E2E_PASSWORD}}"

  (
    cd "${ROOT_DIR}/dist"
    python3 ../serve.py "${DEPLOYED_PORT}"
  ) >/tmp/cinny-e2e-preview.log 2>&1 &
  DEPLOYED_PREVIEW_PID=$!

  python3 - "${E2E_DEPLOYED_BASE_URL}" <<'PY'
import sys
import time
import urllib.error
import urllib.request

url = sys.argv[1].rstrip("/") + "/"
deadline = time.time() + 60
last_error = "unknown error"

while time.time() < deadline:
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            if response.status == 200:
                sys.exit(0)
            last_error = f"HTTP {response.status}"
    except (urllib.error.URLError, TimeoutError) as exc:
        last_error = str(exc)
    time.sleep(1)

raise SystemExit(f"Timed out waiting for deployed preview at {url}: {last_error}")
PY
fi

set +e
npx playwright test "$@"
exit_code=$?
set -e

exit "${exit_code}"
