#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

usage() {
  cat <<'EOF'
usage: npm run appstore:screenshots -- [playwright args...]

Captures App Store screenshots into ios/App/fastlane/screenshots/en-US/.

The command starts the local Docker Matrix stack, provisions an isolated
disposable account and room for each run, seeds the public-safe screenshot
fixture, and runs the Playwright capture spec. Existing/live account capture is
intentionally unsupported because it can expose private rooms or profiles.
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

cd "${ROOT_DIR}"

export E2E_MATRIX_PORT="${E2E_MATRIX_PORT:-28008}"
if [ -z "${E2E_PORT:-}" ]; then
  E2E_PORT="$(
    node -e 'const net = require("node:net"); const server = net.createServer(); server.listen(0, "127.0.0.1", () => { console.log(server.address().port); server.close(); });'
  )"
fi
export E2E_PORT
export E2E_REUSE_EXISTING_SERVER="${E2E_REUSE_EXISTING_SERVER:-0}"
export E2E_SERVER_COMMAND="${E2E_SERVER_COMMAND:-npm run start -- --host 127.0.0.1 --port ${E2E_PORT} --strictPort --force}"

SCREENSHOT_DIR="${ROOT_DIR}/ios/App/fastlane/screenshots/en-US"
mkdir -p "${SCREENSHOT_DIR}"
find "${SCREENSHOT_DIR}" -maxdepth 1 -type f ! -name '.*' -delete

fixture_environment="$("${ROOT_DIR}/scripts/appstore-fixture-up.sh" --print-env)"
eval "${fixture_environment}"

exec npx playwright test e2e/app-store-screenshots.spec.ts --project=chromium "$@"
