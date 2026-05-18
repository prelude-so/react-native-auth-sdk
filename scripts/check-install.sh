#!/usr/bin/env bash
# Pre-publish smoke for the package itself. Verifies the postinstall
# vendoring runs cleanly, the bridge module is wired into the Expo
# autolinking config, and the published `.d.ts` compiles. End-to-end
# QA on a real device happens against the standalone demo at
# `sdk/demo/reactnative/expo/prelude-react-native-auth-sdk-demo/`,
# not from this script.
#
# Usage: bash scripts/check-install.sh
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== 1. Run postinstall (vendor PreludeAuth) ==="
node "$PKG_DIR/scripts/postinstall.js"

echo "=== 2. Verify vendored sources exist ==="
if [ ! -d "$PKG_DIR/ios/sdk/PreludeAuth" ]; then
  echo "FAIL: ios/sdk/PreludeAuth is missing after postinstall." >&2
  exit 1
fi

echo "=== 3. Verify Expo module config lists the bridge ==="
if ! grep -q "PreludeReactNativeAuthSdkModule" \
    "$PKG_DIR/expo-module.config.json"; then
  echo "FAIL: expo-module.config.json missing the bridge module name." >&2
  exit 1
fi

echo "=== 4. Type-check the package ==="
( cd "$PKG_DIR" && npx --yes tsc --noEmit )

echo "OK — pre-publish smoke green."
