# Readme
### Usage

The React Native Auth SDK lets you sign users into your app and
manages the resulting session — tokens, refresh, logout, step-up —
against the Prelude Auth API on iOS and Android.

It is provided as an Expo module that you can add as a dependency
to any React Native or Expo app:

```bash
npm install @prelude.so/react-native-auth-sdk
# or: yarn add @prelude.so/react-native-auth-sdk
```

### Quickstart

```ts
import {
  Endpoint,
  PreludeIdentifier,
  PreludeAuthClient,
} from "@prelude.so/react-native-auth-sdk";

const client = new PreludeAuthClient({
  endpoint: Endpoint.custom("https://<your-app>.session.prelude.dev"),
});

await client.startOTPLogin({
  identifier: PreludeIdentifier.emailAddress("alice@example.com"),
});
const user = await client.checkOTP("123456");
```

### Requirements

- iOS deployment target **15.1+**
- Android minimum SDK **API 26**
- React Native **0.74+** (or Expo SDK **52+**)

Expo apps default to Android API 24 — bump to 26 via
`expo-build-properties` in `app.json`:

```jsonc
// expo.plugins
["expo-build-properties", { "android": { "minSdkVersion": 26 } }]
```

The module pulls the native SDKs in for you — `pod install`
downloads `PreludeAuth` on iOS, and Gradle resolves
`so.prelude.android:auth-sdk` (plus `so.prelude.android:sdk`
for signals) from Maven Central on Android. Nothing else to add
to your project — no extra coordinates in your iOS Podfile or
Android `build.gradle`.

> The iOS pod is shipped as a `static_framework` (required for an
> Expo module that vendors Swift sources). If your app explicitly
> toggles `use_frameworks!` to `:dynamic` in the Podfile, override
> it locally for `PreludeReactNativeAuthSdk` — otherwise
> CocoaPods will fail to link the bridge.

#### Configure the client

Point the client at your project's Prelude Auth endpoint. Use
the production URL in production, and a custom URL for staging or
local development.
Find the URL in the Prelude dashboard under your project's auth
settings.

```ts
import {
  Endpoint,
  PreludeAuthClient,
} from "@prelude.so/react-native-auth-sdk";

const client = new PreludeAuthClient({
  endpoint: Endpoint.custom("https://<your-app>.session.prelude.dev"),
});
```

Constructing the client is JS-side only — no native work happens
until the first method call, which is when the SDK provisions
per-handle DPoP key state in the platform secure store. The client
config is captured at construction and reused for every subsequent
call on that instance; create a new `PreludeAuthClient` if you
need different settings.

#### Email OTP login

```ts
import { PreludeIdentifier } from "@prelude.so/react-native-auth-sdk";

await client.startOTPLogin({
  identifier: PreludeIdentifier.emailAddress("alice@example.com"),
});
const user = await client.checkOTP("123456");
```

If the user wants the code resent, call `client.resendOTP()`.

#### Email and password login

```ts
import { RedactedString } from "@prelude.so/react-native-auth-sdk";

const user = await client.loginWithPassword({
  emailAddress: "alice@example.com",
  password: new RedactedString("correct horse battery staple"),
});
```

#### Password validation

```ts
const result = await client.validatePassword("candidate");
if (result.valid) {
  // ok to submit
}
```

Or fetch the policy once and classify locally — pure function,
safe to call on every keystroke:

```ts
const policy = await client.passwordCompliancy();
const result = PreludeAuthClient.validate("candidate", policy);
```

#### Session lifecycle

```ts
await client.refresh();   // refreshes the access token
await client.logout();    // revokes the session and clears local tokens

const profile = await client.getProfile();
const token   = await client.getAccessToken();
```

Protected requests auto-refresh expired access tokens
transparently, so most apps will not need to call `refresh()`
explicitly.

#### Step-up authentication

```ts
const challenge = await client.requestStepUp("prld:pwd:write");
await client.sendStepUpOTP(challenge);
const next = await client.submitStepUpOTP(challenge, "123456");
```

`client.getActiveStepUp()` returns the most recent in-flight
challenge so a UI can resume from a cold start.

#### Change password

After completing a step-up for `prld:pwd:write`:

```ts
await client.changePassword(new RedactedString("new-password"));
```

#### Manage active sessions

```ts
import { PreludeRevokeTarget } from "@prelude.so/react-native-auth-sdk";

const page = await client.listSessions({ limit: 20 });

await client.revokeSessions(PreludeRevokeTarget.others);
await client.revokeSessions(PreludeRevokeTarget.session(sessionID));
await client.revokeSessions(PreludeRevokeTarget.all);
```

#### Anti-fraud signals

The Prelude signals SDK is bundled and **off by default**. When a
key is configured, the auth client stamps a Prelude `dispatch_id`
onto unauthenticated logins. Configuration lives in the native
manifest so the iOS key can't ship in an Android build, and
vice versa.

iOS — add `PreludeSDKKey` to `ios/<App>/Info.plist`:

```xml
<key>PreludeSDKKey</key>
<string>sdk_ios_XXXXXXXXXXXXXXXX</string>
```

Android — add a `<meta-data>` entry inside `<application>` in
`android/app/src/main/AndroidManifest.xml`:

```xml
<meta-data
    android:name="so.prelude.sdk_key"
    android:value="sdk_android_XXXXXXXXXXXXXXXX" />
```

> **Platform note (v0.2.0):** signals dispatch is currently active
> on Android only. iOS accepts the same configuration surface and
> is wire-compatible, but `dispatch_id` is not attached on iOS in
> this release. Full iOS support lands in a follow-up.

#### Disposing the client

Call `dispose()` when you're done with a client so the native
session is released:

```ts
await client.dispose();
```

After disposal every other method on the instance throws
`DisposedError`. Create a new `PreludeAuthClient` to start a
fresh logical session.
