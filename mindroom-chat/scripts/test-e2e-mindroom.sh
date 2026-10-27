#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE_ALIAS="${E2E_FIXTURE_ROOM_ALIAS:-#cinny-e2e-fixture:mindroom.lab.mindroom.chat}"

if [ -z "${E2E_USERNAME:-}" ] || [ -z "${E2E_PASSWORD:-}" ]; then
  eval "$("${ROOT_DIR}/scripts/create-mindroom-e2e-account.sh" E2E)"
  echo "Provisioned disposable primary e2e account via ${MINDROOM_SSH_HOST:-mindroom}." >&2
fi

if [ -z "${E2E_SECOND_USERNAME:-}" ] || [ -z "${E2E_SECOND_PASSWORD:-}" ]; then
  eval "$("${ROOT_DIR}/scripts/create-mindroom-e2e-account.sh" E2E_SECOND)"
  echo "Provisioned disposable secondary e2e account via ${MINDROOM_SSH_HOST:-mindroom}." >&2
fi

if [ -z "${E2E_THIRD_USERNAME:-}" ] || [ -z "${E2E_THIRD_PASSWORD:-}" ]; then
  eval "$("${ROOT_DIR}/scripts/create-mindroom-e2e-account.sh" E2E_THIRD)"
  echo "Provisioned disposable third e2e account via ${MINDROOM_SSH_HOST:-mindroom}." >&2
fi

if [ -z "${E2E_DEACTIVATE_USERNAME:-}" ] || [ -z "${E2E_DEACTIVATE_PASSWORD:-}" ]; then
  eval "$("${ROOT_DIR}/scripts/create-mindroom-e2e-account.sh" E2E_DEACTIVATE)"
  echo "Provisioned disposable deactivation e2e account via ${MINDROOM_SSH_HOST:-mindroom}." >&2
fi

export E2E_FIXTURE_ROOM_ALIAS="${FIXTURE_ALIAS}"

"${ROOT_DIR}/scripts/with-mindroom-tunnel.sh" bash -lc '
  set -euo pipefail
  cd "'"${ROOT_DIR}"'"
  node ./e2e/live/seed-fixture-room.mjs

  export E2E_FIXTURE_ROOM_ID="$(
    node --input-type=module <<'\''NODE'\''
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
NODE
  )"

  exec npx playwright test "$@"
' bash "$@"
