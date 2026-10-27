#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="${E2E_MATRIX_COMPOSE_FILE:-${ROOT_DIR}/e2e/docker-compose.matrix.yaml}"

docker compose -f "${COMPOSE_FILE}" down "$@"
