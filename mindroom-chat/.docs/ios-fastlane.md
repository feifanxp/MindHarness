# MindRoom iOS Releases with fastlane

[fastlane](https://fastlane.tools) automates the App Store release flow.
It complements the existing pipeline: a push to `dev` lets `auto-mindroom-release.yml` create a release tag, and the current Xcode Cloud workflow independently watches `dev` and builds and uploads that branch through `ios/App/ci_scripts`.
Fastlane validates the uploaded build and local release assets, uploads version metadata and screenshots, preserves review access, selects the exact build, and submits it for review with automatic release after approval.

What fastlane owns in this repo:

| Task                              | Lane                 | Replaces                                                                                    |
| --------------------------------- | -------------------- | ------------------------------------------------------------------------------------------- |
| Validate and submit for review    | `release`            | App Store version creation, metadata and screenshot upload, build selection, and submission |
| Upload App Store metadata only    | `upload_metadata`    | Manual copy-paste from `.docs/APP_STORE_SUBMISSION_PACKET.md` into App Store Connect        |
| Upload App Store screenshots only | `upload_screenshots` | Manual drag-and-drop per device class in App Store Connect                                  |
| Local TestFlight build            | `beta`               | Xcode → Product → Archive → Organizer → Distribute when Xcode Cloud is unavailable          |
| Web build and Capacitor sync      | `sync_web`           | `npm run build:ios && npx cap sync ios`                                                     |

## Install

Homebrew (simplest, no Ruby management):

```bash
brew install fastlane
```

Or use Bundler with the checked-in `ios/App/Gemfile`.
This requires Ruby 3.2 or newer, such as `brew install ruby`, because the macOS system Ruby 2.6 is too old for the committed `Gemfile.lock`.

```bash
cd ios/App
bundle install
```

With Bundler, prefix commands with `bundle exec`.
With the Homebrew install, call `fastlane` directly.
The release lane is compatible with the Homebrew package even if the repository's Bundler gems have not been installed.

## Authentication

Create an App Store Connect API key in App Store Connect under Users and Access, Integrations, App Store Connect API with the App Manager role.
Export the key details before running a lane:

```bash
export ASC_KEY_ID="YOUR_KEY_ID"
export ASC_ISSUER_ID="YOUR_ISSUER_ID"
export ASC_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8"
# or, for CI secrets: export ASC_KEY_CONTENT="$(base64 -i "$ASC_KEY_PATH")"
```

API-key auth avoids Apple ID two-factor prompts and works in CI.
The `.p8` file is a secret and must never be committed.

An earlier local setup may already have placed the key in one of Apple's conventional directories.
This command finds likely key files without printing their contents:

```bash
find "$HOME/.appstoreconnect" "$HOME/.private_keys" -name 'AuthKey_*.p8' -print 2>/dev/null
```

The key ID is the suffix in `AuthKey_<KEY_ID>.p8`.
The issuer ID still comes from App Store Connect and is safe to keep in a shell profile or password-manager note.

## Submit a release for review

Start from a clean checkout of the exact `dev` commit used by the Xcode Cloud build.
Wait for Xcode Cloud and App Store Connect to finish processing the build.
Install dependencies and regenerate the complete screenshot set:

```bash
npm ci
npm run appstore:screenshots
```

Set the exact Apple marketing version and build number shown by App Store Connect.
The Xcode Cloud marketing version is generated from the checked-in version floor and its build counter, so it can be newer than the version in `project.pbxproj`.

```bash
export APP_STORE_VERSION="4.12.145"
export APP_STORE_BUILD_NUMBER="141"
export APP_STORE_RELEASE_NOTES="Improves reliability and the iOS experience."
export APP_STORE_RELEASE_CONFIRMATION="submit ${APP_STORE_VERSION} (${APP_STORE_BUILD_NUMBER}) for review"

cd ios/App
fastlane ios release
```

Use `bundle exec fastlane ios release` instead when the Bundler dependencies are installed.
The destructive confirmation must exactly name the version and build, which prevents a stale shell value from selecting a different binary.

The lane performs these checks before submission:

- The release notes are present and fit Apple's 4,000-character limit.
- The screenshot directory contains exactly five distinct `1320 x 2868` iPhone images and five distinct `2064 x 2752` iPad images with the expected names.
- The repository passes the App Store preflight, typecheck, full Vitest suite, and production build.
- No other iOS review submission is in progress.
- The requested version is newer than the live version and does not replace a different editable version.
- The exact App Store Connect build exists, is valid, is unexpired, is ready, and has export compliance resolved.
- Review contact fields, review notes, and saved demo credentials are present.
- The submitted version reaches `WAITING_FOR_REVIEW` or `IN_REVIEW` and remains configured for automatic release after approval.

The lane intentionally does not build or upload a new binary.
The reviewed binary must be the already processed Xcode Cloud build from the intended `dev` commit.
The lane can safely stop after a validation or upload error, but inspect App Store Connect before rerunning because metadata or screenshots may already have been updated.
Post-submission verification polls 24 times at 10-second intervals by default, allowing almost four minutes for App Store Connect to expose the new review state.
Set positive integer `APP_STORE_REVIEW_POLL_ATTEMPTS` or `APP_STORE_REVIEW_POLL_INTERVAL_SECONDS` values only when Apple latency requires a different window.

## Lanes

Run all lanes from `ios/App`:

```bash
cd ios/App

# Upload name/subtitle/description/keywords/review notes to App Store Connect
bundle exec fastlane ios upload_metadata

# Upload screenshots from fastlane/screenshots/<locale>/
bundle exec fastlane ios upload_screenshots

# Build web assets, sync Capacitor, archive, upload to TestFlight
bundle exec fastlane ios beta
```

Metadata lives in `ios/App/fastlane/metadata/` as plain-text files with one field per file, seeded from `.docs/APP_STORE_SUBMISSION_PACKET.md`.
Edit the files and rerun `upload_metadata`.
The submission packet remains the place for review-time checklists and credentials handling.

`deliver` uploads each file verbatim and skips fields whose file does not exist.
Release notes are supplied through `APP_STORE_RELEASE_NOTES` and are intentionally gitignored, so a stale placeholder cannot ship.
The same applies to the marketing URL.

The primary category is intentionally not stored under `fastlane/metadata`.
Category is stable app-level information already owned by App Store Connect, and attempting to reapply it can make Apple reject the metadata upload as a duplicate category selection.

The owner requires all iOS releases to publish automatically after Apple approves them.
`ios/App/fastlane/Deliverfile` enables automatic release while keeping standalone uploads from submitting for review.
Only the guarded `release` lane overrides the submission default, and it verifies Apple retained automatic release after approval.
Reviewer demo credentials remain stored only in App Store Connect.
Metadata upload can cause Apple to clear the demo-account-required flag, so both `upload_metadata` and `release` restore that flag when saved credentials are present.
The `release` lane refuses to submit when those credentials or the review contact information are missing.

## Screenshots

See `ios/App/fastlane/screenshots/README.md` for required pixel sizes, naming conventions, and capture commands.
Screenshot binaries are gitignored, and the directory only tracks documentation.

Current automated path, from the repository root:

```bash
npm run appstore:screenshots
```

This starts the local Docker Matrix stack, provisions an isolated disposable account and room for each run, and seeds the fictional Rivera household from `mindroom-ai/demo`.
Sam Rivera talks to Hearth, Pantry, and Atlas using bundled avatars from `scripts/fixtures/appstore/avatars/`; capture does not download profile images or require a demo checkout.
Playwright writes exact iPhone 6.9-inch (`1320 x 2868`) and iPad 13-inch (`2064 x 2752`) PNGs into `ios/App/fastlane/screenshots/en-US/`.
The five scenes show the family workspace, vegetarian meal planning, home automation with expanded tool calls, a Lisbon trip, and a reminder.
Capture fails if two scenes within a device class produce byte-identical PNGs.
The wrapper starts a fresh Vite server on an available port by default so dependency-cache changes cannot reuse a stale localhost build.

To only start Matrix and seed the fixture room:

```bash
npm run appstore:fixture
```

Live or existing account capture is intentionally unsupported for App Store screenshots because it can expose private rooms, profiles, or existing account state.
Use the local fixture path for release assets.

Fixture summaries count the messages actually seeded and use topic-specific emoji.
Capture uses UTC, matching the fixture scheduler, so tomorrow-at-four reminders display 4:00 PM regardless of the host timezone.
The local fixture server enables legacy Matrix media downloads for avatars; production homeserver settings are unaffected.

Fastlane `snapshot` remains a future option, but it requires adding an Xcode UI-test target and shared scheme to `App.xcodeproj`.
The Playwright path is the repo-native procedure for this Capacitor webview until that target exists.

## Signing note

The `beta` lane relies on Xcode-managed signing through `-allowProvisioningUpdates` with your local Apple Developer session.
If team members without account access need to build, adopt fastlane `match` with shared signing certificates in an encrypted repository as a follow-up.
