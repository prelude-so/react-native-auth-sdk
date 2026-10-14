#!/usr/bin/env bash
#
# Confirms the packed @prelude.so/react-native-auth-sdk compiles for iOS
# inside a fresh Expo app of a given SDK. The demo app pins one Expo SDK,
# so a break in a newer expo-modules-core (such as the `Exception.message`
# override added in 58) would otherwise first surface in a customer build.
#
# Scaffolds a throwaway app from the blank TypeScript template, installs
# the SDK tarball the way a customer would, prebuilds the iOS project, and
# builds it for the simulator without code signing. macOS only.
#
# Usage:
#   scripts/verify-expo.sh [EXPO_SDK_TAG]
#     EXPO_SDK_TAG  dist-tag of expo-template-blank-typescript, e.g.
#                   sdk-58 or latest (default: latest)
#
#   APP_DIR=/path/to/existing-app scripts/verify-expo.sh   # reuse an app

set -euo pipefail

SDK_TAG="${1:-latest}"
PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="PreludeAuthExpoCheck"
APP_DIR="${APP_DIR:-/tmp/prelude-auth-expo-$SDK_TAG/$APP_NAME}"
LOG=/tmp/prelude-auth-expo-$SDK_TAG-xcodebuild.log

echo "== pack the SDK =="
TARBALL="$(cd "$PKG_DIR" && npm pack --silent | tail -1)"
TARBALL="$PKG_DIR/$TARBALL"

if [ ! -d "$APP_DIR" ]; then
  echo "== scaffold an Expo app (template $SDK_TAG) =="
  mkdir -p "$(dirname "$APP_DIR")"
  ( cd "$(dirname "$APP_DIR")" \
    && npx --yes create-expo-app@latest "$APP_NAME" \
         --template "blank-typescript@$SDK_TAG" --no-install )
fi
cd "$APP_DIR"

echo "== install the SDK =="
# The postinstall vendors the PreludeAuth sources from the tag pinned in
# package.json, exactly as a customer install does. The in-repo Apple
# checkout can be ahead of that tag, so building against it would hide
# a bridge that no longer compiles for customers (0.7.0 shipped that way).
# `--legacy-peer-deps`: a pre-release Expo template pins a React Native
# release candidate, which npm does not accept against the SDK's
# `react-native >=0.74.0` peer range.
npm install --legacy-peer-deps "$TARBALL"

echo "== configure the app =="
node - <<'JS'
const fs = require("fs");
const config = JSON.parse(fs.readFileSync("app.json", "utf8"));
config.expo.ios = { ...config.expo.ios, bundleIdentifier: "so.prelude.reactnative.auth.expocheck" };
config.expo.plugins = [["@prelude.so/react-native-auth-sdk", { scheme: "prelude-expo-check" }]];
fs.writeFileSync("app.json", JSON.stringify(config, null, 2) + "\n");
JS

echo "== prebuild iOS =="
npx expo prebuild --platform ios --no-install --clean
( cd ios && pod install )

XCODEBUILD=(xcodebuild
  -workspace "ios/$APP_NAME.xcworkspace"
  -scheme "$APP_NAME"
  -configuration Debug
  -sdk iphonesimulator
  -destination 'generic/platform=iOS Simulator'
  CODE_SIGNING_ALLOWED=NO)

# React Native 0.88+ adds Swift packages to the Pods project. Resolve
# them on their own first: this output is short, so keep it visible.
echo "== resolve Swift packages =="
"${XCODEBUILD[@]}" -resolvePackageDependencies

echo "== build for the iOS simulator =="
if "${XCODEBUILD[@]}" build > "$LOG" 2>&1; then
  echo "OK — iOS build green on Expo template $SDK_TAG"
else
  echo "iOS build failed on Expo template $SDK_TAG. First errors:" >&2
  grep -E -A8 'error:' "$LOG" | head -80 >&2
  echo "Full log: $LOG" >&2
  exit 1
fi
