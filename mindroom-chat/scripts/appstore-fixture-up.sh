#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PRINT_ENV=0

usage() {
  cat <<'EOF'
usage: scripts/appstore-fixture-up.sh [--print-env]

Starts the local Matrix fixture stack by default, provisions the disposable
App Store screenshot account, creates fake AI agent accounts with avatars, and
seeds the public-safe App Store screenshot room.

Live-account capture is intentionally unsupported for App Store screenshots.
Use the local fixture so public screenshots cannot expose private rooms,
profiles, or existing account state.

Use --print-env when another script needs to eval the E2E_* exports produced
by the setup step.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --print-env)
      PRINT_ENV=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 64
      ;;
  esac
done

cd "${ROOT_DIR}"

if [ "${APPSTORE_SCREENSHOTS_USE_EXISTING_E2E:-0}" = "1" ]; then
  echo "Existing live-account screenshot capture is not supported for App Store screenshots because it can expose private rooms or profiles. Use the local fixture instead." >&2
  exit 64
fi

export E2E_MATRIX_PORT="${E2E_MATRIX_PORT:-28008}"
export E2E_HOMESERVER="${E2E_HOMESERVER:-http://127.0.0.1:${E2E_MATRIX_PORT}}"

case "${E2E_HOMESERVER}" in
  http://127.0.0.1:* | http://localhost:* | http://\[::1\]:*) ;;
  *)
    echo "Only local homeservers are supported for App Store screenshot fixtures. Refusing E2E_HOMESERVER=${E2E_HOMESERVER}" >&2
    exit 64
    ;;
esac

export APPSTORE_SCREENSHOT_RUN_ID="${APPSTORE_SCREENSHOT_RUN_ID:-$(date -u +%Y%m%d%H%M%S)-$$}"
SAFE_RUN_ID="$(printf '%s' "${APPSTORE_SCREENSHOT_RUN_ID}" | tr -cd '[:alnum:]' | tr '[:upper:]' '[:lower:]')"
if [ -z "${SAFE_RUN_ID}" ]; then
  echo "APPSTORE_SCREENSHOT_RUN_ID must contain at least one alphanumeric character." >&2
  exit 64
fi

export E2E_FIXTURE_ROOM_ALIAS="#mindroom-app-store-personal-showcase-${SAFE_RUN_ID}:matrix.localhost"

"${ROOT_DIR}/scripts/e2e-matrix-up.sh" >&2
account_environment="$(
  "${ROOT_DIR}/scripts/ensure-e2e-account.sh" \
    E2E \
    "appstorescreenshots${SAFE_RUN_ID}" \
    'Pwappstorescreenshots123!'
)"
eval "${account_environment}"
export E2E_USERNAME E2E_PASSWORD

node "${ROOT_DIR}/scripts/seed-appstore-screenshot-room.mjs" >&2

if [ "${PRINT_ENV}" = "1" ]; then
  printf 'export APPSTORE_SCREENSHOT_RUN_ID=%q\n' "${APPSTORE_SCREENSHOT_RUN_ID}"
  printf 'export E2E_MATRIX_PORT=%q\n' "${E2E_MATRIX_PORT}"
  printf 'export E2E_HOMESERVER=%q\n' "${E2E_HOMESERVER}"
  printf 'export E2E_FIXTURE_ROOM_ALIAS=%q\n' "${E2E_FIXTURE_ROOM_ALIAS}"
  printf 'export E2E_USERNAME=%q\n' "${E2E_USERNAME}"
  printf 'export E2E_PASSWORD=%q\n' "${E2E_PASSWORD}"
else
  echo "App Store screenshot Matrix fixture is ready." >&2
  echo "  Run ID: ${APPSTORE_SCREENSHOT_RUN_ID}" >&2
  echo "  Homeserver: ${E2E_HOMESERVER}" >&2
  echo "  Room alias: ${E2E_FIXTURE_ROOM_ALIAS}" >&2
fi
