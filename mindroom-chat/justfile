set shell := ["bash", "-euo", "pipefail", "-c"]

default:
  @just --list

# Reinstall dependencies and rebuild the web app
rebuild:
  npm ci
  npm run build

# Build once, then start the local dev server
run:
  npm run build
  npm start

# Run the repo lint checks
lint:
  npm run lint

# Run TypeScript without emitting build output
typecheck:
  npm run typecheck

# Run the Vitest suite once
test:
  npm run test

# Run the full repo verification suite
check:
  just lint
  just typecheck
  just test
  npm run build

# Full refresh after pulling commits (safe if dependencies changed)
ios-rebuild:
  npm install
  npm run build
  npm run ios:icons
  npm run appstore:preflight
  npx cap sync ios

# Faster refresh when node_modules is already up to date
ios-sync:
  npm run build
  npm run ios:icons
  npm run appstore:preflight
  npx cap sync ios

ios-open:
  npx cap open ios

# Build, install, and launch the iOS app on the paired phone
ios-phone:
  npm run ios:phone

# Start the iOS phone auto-push watcher in the foreground
ios-phone-watch:
  npm run ios:phone:watch

# Start the iOS phone auto-push watcher in the background
ios-phone-bg:
  npm run ios:phone:bg

# Stop the background iOS phone auto-push watcher
ios-phone-stop:
  npm run ios:phone:stop

# Follow the background iOS phone watcher log
ios-phone-log:
  tail -f /tmp/mindroom-chat-ios-phone-watch.log

# Reinstall Node deps and rebuild + sync the Android project (full refresh)
android-rebuild:
  npm install
  npm run build
  npx cap sync android

# Faster Android refresh when node_modules is already up to date
android-sync:
  npm run build
  npx cap sync android

# Open the Android Studio project
android-open:
  npx cap open android

# Build a local debug APK (artifact at android/app/build/outputs/apk/debug/app-debug.apk)
android-debug:
  npm run build
  npx cap sync android
  cd android && ./gradlew --no-daemon assembleDebug
