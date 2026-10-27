#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
ruby scripts/ios-routing-test-project.rb
cd .claude/evidence/ios-routing
pod install

device_id=$(xcrun simctl list devices available --json | node --input-type=commonjs -e '
  let input = "";
  process.stdin.on("data", chunk => input += chunk);
  process.stdin.on("end", () => {
    const devices = Object.entries(JSON.parse(input).devices)
      .filter(([runtime]) => runtime.includes("iOS"))
      .sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }))
      .flatMap(([, devices]) => devices);
    const phone = devices.find(device => device.name.startsWith("iPhone"));
    if (!phone) throw new Error("No available iPhone simulator");
    process.stdout.write(phone.udid);
  });
')

# Finish simulator startup explicitly; Xcode can otherwise stall before XCTest
# starts on a fresh CI runner. Keep a failed boot visible and bounded.
node --input-type=commonjs - "$device_id" <<'NODE'
const { spawnSync } = require('node:child_process');
const result = spawnSync('xcrun', ['simctl', 'bootstatus', process.argv[2], '-b'], {
  stdio: 'inherit',
  timeout: 180_000,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
NODE

# Keep every run, including the failing baseline, as an inspectable result bundle.
result_name="Routing-$(date -u +%Y%m%dT%H%M%SZ).xcresult"
xcodebuild test \
  -workspace Routing.xcworkspace \
  -scheme Routing \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=$device_id" \
  -parallel-testing-enabled NO \
  -test-timeouts-enabled YES \
  -default-test-execution-time-allowance 60 \
  -maximum-test-execution-time-allowance 120 \
  -derivedDataPath DerivedData \
  -resultBundlePath "$result_name" \
  CODE_SIGNING_ALLOWED=NO 2>&1 | tee xcodebuild.log
