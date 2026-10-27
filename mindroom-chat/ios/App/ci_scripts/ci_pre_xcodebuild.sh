#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
source "$SCRIPT_DIR/ci_common.sh"

init_homebrew

cd "$REPO_ROOT"

for command_name in git node npm npx pod; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Error: $command_name is not available before xcodebuild." >&2
    echo "ci_post_clone.sh should install dependencies and initialize CocoaPods before this script runs." >&2
    exit 1
  fi
done

refresh_remote_tags() {
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git fetch --force --tags origin >/dev/null 2>&1 || {
      echo "Warning: could not refresh git tags before resolving iOS build number." >&2
    }
  fi
}

get_metadata_value() {
  local key="$1"
  printf '%s\n' "$VERSION_METADATA" | sed -n "s/^${key}=//p" | tail -n 1
}

refresh_remote_tags
VERSION_METADATA="$(node scripts/ios-ci-version.mjs)"
APPLE_MARKETING_VERSION="$(get_metadata_value marketing_version)"
APPLE_MARKETING_VERSION_SOURCE="$(get_metadata_value marketing_version_source)"
CURRENT_PROJECT_VERSION="$(get_metadata_value build_number)"
CURRENT_PROJECT_VERSION_SOURCE="$(get_metadata_value build_number_source)"

if [[ ! "$APPLE_MARKETING_VERSION" =~ ^[0-9]+[.][0-9]+[.][0-9]+$ ]]; then
  echo "Error: iOS MARKETING_VERSION must use Apple's three-integer format, got '$APPLE_MARKETING_VERSION'." >&2
  exit 1
fi

if [[ -n "$CURRENT_PROJECT_VERSION" && ! "$CURRENT_PROJECT_VERSION" =~ ^[0-9]+$ ]]; then
  echo "Error: iOS CURRENT_PROJECT_VERSION must be an integer build number, got '$CURRENT_PROJECT_VERSION'." >&2
  exit 1
fi

if [[ -n "$CURRENT_PROJECT_VERSION" ]]; then
  echo "Setting iOS MARKETING_VERSION=$APPLE_MARKETING_VERSION CURRENT_PROJECT_VERSION=$CURRENT_PROJECT_VERSION"
  echo "Resolved iOS marketing version from ${APPLE_MARKETING_VERSION_SOURCE:-unknown}"
  echo "Resolved iOS build number from ${CURRENT_PROJECT_VERSION_SOURCE:-unknown}"
  MARKETING_VERSION="$APPLE_MARKETING_VERSION" CURRENT_PROJECT_VERSION="$CURRENT_PROJECT_VERSION" node --input-type=module <<'NODE'
    import fs from 'node:fs';
    import { replaceAppTargetBuildSetting } from './scripts/ios-xcode-project.mjs';

    const projectPath = 'ios/App/App.xcodeproj/project.pbxproj';
    const marketingVersion = process.env.MARKETING_VERSION;
    const buildNumber = process.env.CURRENT_PROJECT_VERSION;
    const original = fs.readFileSync(projectPath, 'utf8');
    let updated = replaceAppTargetBuildSetting(original, 'MARKETING_VERSION', marketingVersion);
    updated = replaceAppTargetBuildSetting(updated, 'CURRENT_PROJECT_VERSION', buildNumber);

    fs.writeFileSync(projectPath, updated);
NODE
elif [[ -n "${CI:-}" || -n "${CI_BUILD_NUMBER:-}" || -n "${CI_XCODEBUILD_ACTION:-}" ]]; then
  echo "Error: Could not determine iOS build number from IOS_BUILD_NUMBER, CI_BUILD_NUMBER, release tag, or the checked-in Xcode project." >&2
  exit 1
fi

npm run build:ios
npx cap sync ios
npm run appstore:preflight
