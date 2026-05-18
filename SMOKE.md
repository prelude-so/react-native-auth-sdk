# Pre-publish smoke procedure

Run before tagging any release.

## Automated

```bash
cd sdk/platforms/reactnative/packages/prelude-auth
npm install
npm run smoke    # postinstall + autolinking config + type check
npm test         # JS unit tests (decoders, codec, error mapping, step-up cache)
```

## Native unit tests (Android)

Android JVM tests run against the bridge's Kotlin sources via the
standalone demo's prebuilt Gradle project:

```bash
cd sdk/demo/reactnative/expo/prelude-react-native-auth-sdk-demo
npx expo prebuild --no-install --clean
cd android
./gradlew :prelude-so-react-native-auth-sdk:test
```

## Native compile (iOS)

This is an Expo module, so `pod lib lint` in isolation can't
resolve `ExpoModulesCore` (it's autolinked, not registered in
the public spec repo). The bridge is exercised end-to-end by
building the demo's iOS target:

```bash
cd sdk/demo/reactnative/expo/prelude-react-native-auth-sdk-demo
npx expo prebuild --clean
cd ios && pod install
xcodebuild -workspace PreludeAuthSDK.xcworkspace \
           -scheme PreludeAuthSDK \
           -configuration Debug -sdk iphonesimulator build
```

## On-device QA

```bash
cd sdk/demo/reactnative/expo/prelude-react-native-auth-sdk-demo
npm install
npx expo run:ios       # or run:android
```

The demo exercises the full surface — OTP login, password login,
step-up, change-password, settings — against your project's
staging endpoint. Configure the endpoint via the Settings screen
on first launch.

A failure anywhere above blocks the release; file a regression
issue with the captured logs (`react-native log-ios`,
`adb logcat *:S PreludeAuth:*`).
