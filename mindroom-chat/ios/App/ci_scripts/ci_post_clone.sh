#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
source "$SCRIPT_DIR/ci_common.sh"

install_if_missing() {
  local command_name="$1"
  local formula="$2"

  if command -v "$command_name" >/dev/null 2>&1; then
    return
  fi

  if ! command -v brew >/dev/null 2>&1; then
    echo "Error: $command_name is not available and Homebrew was not found." >&2
    echo "Install $command_name before running this script, or make Homebrew available in PATH." >&2
    exit 1
  fi

  brew_install_with_retry "$formula"
}

init_homebrew

cd "$REPO_ROOT"

install_if_missing node node
if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not available after confirming node is installed." >&2
  echo "Install a Node distribution that includes npm before running this script." >&2
  exit 1
fi
install_if_missing pod cocoapods

node --version
npm --version
pod --version

npm ci
