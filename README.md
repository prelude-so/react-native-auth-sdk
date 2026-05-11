# Readme

### Usage

The React Native Session SDK lets you sign users into your app and
manages the resulting session — tokens, refresh, logout, step-up —
against the Prelude session API on iOS and Android.

It is provided as an Expo module that you can add as a dependency
to any React Native or Expo app:

```bash
npm install @prelude.so/react-native-session-sdk
# or: yarn add @prelude.so/react-native-session-sdk
```

```jsonc
// package.json
{
  "dependencies": {
    "@prelude.so/react-native-session-sdk": "^0.1.0"
  }
}
```

### Quickstart

```ts
import {
  Endpoint,
  PreludeIdentifier,
  PreludeSessionClient,
} from "@prelude.so/react-native-session-sdk";

const client = new PreludeSessionClient({
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
downloads `PreludeSession` on iOS, and Gradle resolves
`so.prelude.android:session-sdk` (plus `so.prelude.android:sdk`
for signals) from Maven Central on Android. Nothing else to add
to your project — no extra coordinates in your iOS Podfile or
Android `build.gradle`.

> The iOS pod is shipped as a `static_framework` (required for an
> Expo module that vendors Swift sources). If your app explicitly
> toggles `use_frameworks!` to `:dynamic` in the Podfile, override
> it locally for `PreludeReactNativeSessionSdk` — otherwise
> CocoaPods will fail to link the bridge.

#### Configure the client

Point the client at your project's Prelude session endpoint. Use
the production URL in production, and a custom URL for staging or
local development.
Find the URL in the Prelude dashboard under your project's
session settings.

```ts
import {
  Endpoint,
  PreludeSessionClient,
} from "@prelude.so/react-native-session-sdk";

const client = new PreludeSessionClient({
  endpoint: Endpoint.custom("https://<your-app>.session.prelude.dev"),
});
```

Constructing the client is JS-side only — no native work happens
until the first method call, which is when the SDK provisions
per-handle DPoP key state in the platform secure store. The client
config is captured at construction and reused for every subsequent
call on that instance; create a new `PreludeSessionClient` if you
need different settings.

#### Email OTP login

Send a one-time code to the user's email address, then submit the
code they entered. The SDK persists the resulting tokens in the
platform's secure store (Keychain on iOS, app-private storage on
Android).

```ts
import {
  PreludeIdentifier,
} from "@prelude.so/react-native-session-sdk";

await client.startOTPLogin({
  identifier: PreludeIdentifier.emailAddress("alice@example.com"),
});

const user = await client.checkOTP("123456");
```

If the user wants the code resent, call `client.resendOTP()`.

#### Email and password login

```ts
import { RedactedString } from "@prelude.so/react-native-session-sdk";

const user = await client.loginWithPassword({
  emailAddress: "alice@example.com",
  password: new RedactedString("correct horse battery staple"),
});
```

#### Password validation

One-shot validation against the project's policy:

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
const result = PreludeSessionClient.validate("candidate", policy);
```

#### Session lifecycle

```ts
await client.refresh();   // refreshes the access token
await client.logout();    // revokes the session and clears local tokens

const profile = await client.getProfile();      // currently signed-in user, if any
const token   = await client.getAccessToken();  // the access token, if any
```

Protected requests auto-refresh expired access tokens
transparently, so most apps will not need to call `refresh()`
explicitly.

#### Step-up authentication

Some operations (e.g. changing the password) require a fresh
proof of identity. Request the scope, deliver the OTP, then
submit the code:

```ts
const challenge = await client.requestStepUp("prld:pwd:write");
await client.sendStepUpOTP(challenge);                  // POST /otp
const next = await client.submitStepUpOTP(challenge, "123456");

// `next == null` means the flow completed and the session now
// carries the requested scope. A non-null value is the next
// challenge in a multi-step flow — call `sendStepUpOTP` on it
// to deliver the next code.
```

`client.getActiveStepUp()` returns the most recent in-flight
challenge so a UI can resume from a cold start.

To forward step-up audit metadata to the server, pass the
options-object form:

```ts
const challenge = await client.requestStepUp({
  scope: "prld:pwd:write",
  metadata: { reason: "settings" },
});
```

#### Change password

After completing a step-up for `prld:pwd:write`:

```ts
await client.changePassword(new RedactedString("new-password"));
```

The SDK drops the granted scope locally on success so the same
token cannot reset the password again.

> `RedactedString` shields the value at-rest in JS — `toString`
> and `console.log` print `<redacted>` and `JSON.stringify`
> produces the same. The shield does **not** extend across the
> JS↔native bridge: the value is unwrapped at the bridge boundary
> and the platform RPC layer transmits it as a regular string.
> This is how the password reaches the native session client; the
> boundary is the only point inside the SDK that needs the
> plaintext.

#### Manage active sessions

List the user's sessions across devices and revoke them
individually or in bulk:

```ts
import { PreludeRevokeTarget } from "@prelude.so/react-native-session-sdk";

const page = await client.listSessions({ limit: 20 });

await client.revokeSessions(PreludeRevokeTarget.others);              // keep this device, sign out the rest
await client.revokeSessions(PreludeRevokeTarget.session(sessionID));  // revoke a specific session
await client.revokeSessions(PreludeRevokeTarget.all);                 // including this device
```

Revoking the current session (`all`, `mine`, or its specific id)
also wipes the local credentials, mirroring `logout()`.

#### Anti-fraud signals

The Prelude signals SDK is bundled and **off by default**. When a
key is configured, the session client stamps a Prelude
`dispatch_id` onto unauthenticated logins (start OTP, login with
password, request step-up). With no key configured, `dispatch_id`
is omitted from login bodies and the rest of the flow is
unchanged — useful while integrating, recommended to enable for
production.

> **Platform note (v0.1.0):** signals dispatch is currently active
> on Android only. iOS accepts the same configuration surface and
> is wire-compatible, but `dispatch_id` is not attached on iOS in
> this release. Full iOS support lands in a follow-up.

Configuration lives in the native manifest so the iOS key can't
ship in an Android build, and vice versa.

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

For runtime-fetched configuration (CI, white-label apps),
`signalsKeyOverride` on the constructor wins over the manifest:

```ts
const client = new PreludeSessionClient({
  endpoint: Endpoint.custom("https://<your-app>.session.prelude.dev"),
  signalsKeyOverride: await myConfig.fetchSignalsKey(),
});
```

#### Disposing the client

Call `dispose()` when you're done with a client so the native
session is released:

```ts
await client.dispose();
```

After disposal every other method on the instance throws
`DisposedError`. Create a new `PreludeSessionClient` to start a
fresh logical session.

#### Endpoint configuration

```ts
const client = new PreludeSessionClient({
  endpoint: Endpoint.custom("https://<your-app>.session.prelude.dev"),
  timeoutMs: 10_000,
});
```

Each Prelude project has its own session endpoint URL — use the
production URL in production, and a custom URL for staging or
local development.

> `allowInsecureTLS: true` (iOS only) loosens TLS validation for
> local development; never ship it. Android self-signed
> certificate trust must be configured via the app's
> `network_security_config.xml` — the option is silently ignored
> there.

### Troubleshooting

- **`pod install` link error / missing `PreludeSession` symbols.**
  The `postinstall` script downloads the iOS sources from GitHub.
  If your `npm install` log shows
  `Skipping Apple Session SDK vendoring`, the bridge has no
  sources to compile against — re-run `npm install` on a network
  that can reach github.com, or point
  `APPLE_SESSION_SDK_LOCATION` at a local checkout.
- **Gradle: `minSdk 26 cannot be smaller than ...`.** Set
  `minSdkVersion: 26` via `expo-build-properties` (see
  Requirements above).
- **CocoaPods: bridge fails to link with `use_frameworks!
  :dynamic`.** Override locally for `PreludeReactNativeSessionSdk`
  — the pod is shipped as a `static_framework`.
