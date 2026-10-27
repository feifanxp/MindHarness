#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SSH_HOST="${MINDROOM_SSH_HOST:-mindroom}"
LOCAL_PORT="${MINDROOM_TUNNEL_PORT:-8808}"
REMOTE_BIND="${MINDROOM_REMOTE_BIND:-localhost}"
REMOTE_PORT="${MINDROOM_REMOTE_PORT:-8008}"

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 64
fi

cleanup() {
  if [ -n "${SSH_PID:-}" ]; then
    kill "${SSH_PID}" 2>/dev/null || true
    wait "${SSH_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

ssh \
  -o BatchMode=yes \
  -o ExitOnForwardFailure=yes \
  -L "${LOCAL_PORT}:${REMOTE_BIND}:${REMOTE_PORT}" \
  "${SSH_HOST}" \
  -N &
SSH_PID=$!

export E2E_HOMESERVER="${E2E_HOMESERVER:-http://127.0.0.1:${LOCAL_PORT}}"

cd "${ROOT_DIR}"
"$@"
