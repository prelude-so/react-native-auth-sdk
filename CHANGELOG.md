# Changelog

Notable changes to the Prelude React Native Auth SDK (`@prelude.so/react-native-auth-sdk`).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.7.1] - 2026-10-14

### Fixed
- iOS build of 0.7.0 failed in every app: the bridge referenced
  `PreludeAuthError` cases that exist in the PreludeAuth repository
  but not in the pinned `0.7.0` release ("type '_ErrorCodeProtocol'
  has no member 'sessionLocked'"). The bridge now compiles against the
  pinned release; native cases it does not know surface as
  `PreludeAuthError` with code `generic`.

## [0.7.0] - 2026-10-14

### Fixed
- iOS build with Expo SDK 58: `expo-modules-core` 58 declares
  `Exception.message`, which clashed with a stored property of the
  same name in the bridge's error type ("cannot override with a
  stored property 'message'").

### Changed
- `useAuth().refresh` moves `stage` to `signedOut` when the server
  rejects the session (`UnauthorizedError`, `TokenReusedError`), so
  the `SignedOut` gate shows the login screen without the app
  calling `signOut`. Transient failures such as `NetworkError` keep
  the session and only set `error`.

### Added
- Passkey login: `loginWithPasskey([options])` signs a user in with
  the platform authenticator — no password, no OTP. `autofill: true`
  offers credentials through the keyboard's AutoFill row on iOS.
- Passkey registration: `registerPasskey(options)` for a session
  holding `prld:passkey:write`, returning a `PasskeyRegistrationResult`
  whose `alreadyRegistered` flag marks an idempotent repeat.
- Passkey management: `listPasskeys()`, `renamePasskey(credentialID,
  nickname)` and `deletePasskey(credentialID)`, returning
  `PreludePasskeyCredential` values.
- `continueStepUpWithPasskey(challenge)` advances a step-up whose
  `currentStep` is `verify_passkey`, with the same
  next-challenge-or-`null` contract as `submitStepUpOTP`.
- Hooks: `useSignIn().loginWithPasskey`, `useAuth().registerPasskey`
  and `useStepUp().continueStepUpWithPasskey`. A dismissed sheet
  resolves without populating `error`.
- Config plugin: `"passkeyDomain"` adds the iOS `webcredentials:`
  associated domain and, on Android, the Credential Manager
  dependencies plus the Digital Asset Links `asset_statements`
  meta-data. `"scheme"` is now optional when `"passkeyDomain"` is set.
- `PasskeyNotSupportedError` (`passkey_not_supported`) and
  `PasskeyAlreadyRegisteredError` (`passkey_already_registered`,
  reported by Android). `PasskeyNotConfiguredError`,
  `PasskeyRegistrationFailedError`, `PasskeyStepUnavailableError`,
  `PasswordNotSetError` and `NoLoginConfigError` were already mapped
  by the bridge but not exported from the package — they are now.
- `NoLoginConfigError` (`no_login_config`), returned when starting an OTP login
  while the app has no login configuration accepting the
  identifier's channel. Create one via the Auth Management API.

### Changed
- Bumps the iOS dependency to `PreludeAuth` `0.7.0` and the Android
  dependency to `so.prelude.android:auth-sdk:0.7.1`, the native
  releases that add passkey support.
- Android passkey ceremonies need the hosting Activity; calls made
  while none is attached throw `InvalidConfigurationError`.

### Native dependencies
- iOS `PreludeAuth` `0.7.0`
- Android `so.prelude.android:auth-sdk:0.7.1`
- Android `so.prelude.android:sdk:0.5.2` (signals)
- Android `androidx.browser:browser:1.8.0` (added by the config plugin)
- Android `androidx.credentials:credentials:1.5.0` and
  `credentials-play-services-auth:1.5.0` (added by the config plugin
  when `passkeyDomain` is set)

## [0.6.0] - 2026-08-26

### Added
- Expo config plugin for the Android OAuth redirect. Adding
  `["@prelude.so/react-native-auth-sdk", { "scheme": "myapp" }]` to
  `expo.plugins` declares the redirect activity's intent-filter and
  adds the `androidx.browser` dependency its Custom Tab needs,
  replacing the hand-written `AndroidManifest.xml` edit (which could
  fail the manifest merge by re-declaring attributes the native SDK
  already sets). iOS needs no configuration.
- `PasswordNotSetError` (`password_not_set`), raised by password
  login when the account exists but has no password credential
  stored. Distinct from `UnauthorizedError` ("wrong password");
  recover via a password set/reset flow instead of retrying.

### Fixed
- The bridge now matches their context-based API — `initiateOAuthLogin` keeps
  the minted login context (and its PKCE verifier) on the native
  side, and `finalizeOAuthLogin` redeems it. One pending context per
  client: a new initiate supersedes an unredeemed earlier attempt,
  and concurrent logins never share a verifier.
- iOS errors reached JS as `undefined reason`, dropping the
  message that explains the failure (the typed error code was
  unaffected). Native error messages now come through intact.

### Changed
- Development toolchain bumped to Expo SDK 53 / React Native 0.79 /
  React 19 (dev-time only; the supported consumer range is
  unchanged: Expo ≥52, React Native ≥0.74, React ≥18.2).

### Native dependencies
- iOS `PreludeAuth` `0.6.0`
- Android `so.prelude.android:auth-sdk:0.6.0`
- Android `so.prelude.android:sdk:0.5.2` (signals)
- Android `androidx.browser:browser:1.8.0` (added by the config plugin)

## [0.5.0] - 2026-07-01

### Added
- Social login. `loginWithOAuth(options)` presents an identity
  provider (Google, Apple, Microsoft, GitHub, Okta, Facebook) in a
  system web session and establishes a session in one call;
  `initiateOAuthLogin` / `finalizeOAuthLogin` back it for apps that
  present the web session themselves. Exposed on `PreludeAuthClient`
  and the `useSignIn` hook. New `CancelledError` for a dismissed page.
- OAuth logins that require email verification (e.g. Microsoft) now
  resolve with an `OAuthEmailChallenge` in the `otpRequired` result.
  Redeem it with `checkOAuthEmailOTP(code, resuming)` on
  `PreludeAuthClient`, or `checkOAuthEmailOtp(code, challenge)` on the
  `useSignIn` hook, to finish the login. The challenge is an opaque
  handle; its verification token stays on the device, so concurrent
  logins stay isolated.

### Native dependencies
- iOS `PreludeAuth` `0.6.0`
- Android `so.prelude.android:auth-sdk:0.6.0`
- Android `so.prelude.android:sdk:0.5.2` (signals)

## [0.4.0] - 2026-06-12

### Added
- `migrate(options)` on `PreludeAuthClient` — exchange a legacy
  bearer token for a Prelude session via PKCE-bound `/migration` ⇒
  `/login/finalize`. Idempotent (a cached session short-circuits)
  and single-flight (concurrent callers share one exchange), so the
  legacy token is spent at most once. The token is taken as a
  `RedactedString` so it never leaks through `toString` /
  `console.log`.
- `migrate(legacyToken)` on the `useSignIn` hook — the same exchange
  surfaced through the React hooks layer, landing on `signedIn`.

### Changed
- Bumped the native auth dependencies to `0.5.0` (which add
  `migrate`): iOS `PreludeAuth` and `so.prelude.android:auth-sdk`.

### Native dependencies
- iOS `PreludeAuth` `0.5.0`
- Android `so.prelude.android:auth-sdk:0.5.0`
- Android `so.prelude.android:sdk:0.5.2` (signals)

## [0.3.0] - 2026-06-04

### Added
- React hooks layer under `@prelude.so/react-native-auth-sdk/react`:
  `PreludeAuthProvider` (silent session restore on mount, with an
  `onRestored` callback), the `useAuth`, `useSignIn`, and `useStepUp`
  hooks, and the `SignedIn` / `SignedOut` / `AuthLoading` render
  gates. The imperative `PreludeAuthClient` API is unchanged.
- `canChangePassword()` — `true` when the session's access token
  already carries `prld:pwd:write`.
- `NoActiveStepUpError` (`no_active_step_up`), thrown by hook
  step-up actions invoked without an active challenge.

### Changed
- Signals dispatch is now best-effort: a failed dispatch no longer
  aborts login; the call proceeds without a `dispatch_id`.

### Removed
- `SignalsDispatchFailedError` and the `signals_dispatch_failed`
  error code, obsolete with best-effort dispatch.

### Fixed
- Picks up native auth SDK 0.4.0 fixes: DPoP proofs compensate for
  device clock skew (with one retry on `invalid_dpop_proof`),
  race-safe profile / access-token reads, and no redundant refresh
  when a 401 races another caller's refresh.

### Native dependencies
- iOS `PreludeAuth` `0.4.0`
- Android `so.prelude.android:auth-sdk:0.4.0`
- Android `so.prelude.android:sdk:0.5.2` (signals)

## [0.2.1] - 2026-05-18

### Fixed
- Restore compiled `build/` output in published tarball.

## [0.2.0] - 2026-05-18

First public release. Picks up native auth SDK 0.3.0 (renamed
from `prelude-session` / `PreludeSession`) and the typed-error
fan-out that landed alongside it.

### Changed
- Bumped native dependencies to the renamed auth SDKs: iOS
  `PreludeAuth` `0.3.0` and Android `so.prelude.android:auth-sdk:0.3.0`.
  The bridge module, Swift pod (`PreludeReactNativeAuthSdk`), and
  Android coordinate (`so.prelude.reactnative.auth.sdk`) follow the
  same naming. No JS API changes.
- Bumped Android signals dependency to `so.prelude.android:sdk:0.5.2`.

### Fixed
- Seven (iOS) / six (Android) backend error codes that previously
  fell through to `PreludeAuthError` defaults are now mapped to
  their typed cases: `use_dpop_nonce` → `UnauthorizedError`;
  `invalid_verify_configuration`, `suspended_account`,
  `invalid_api_key`, `email_verification_not_allowed` (iOS only) →
  `ForbiddenError`; `email_domain_not_verified`,
  `insufficient_balance` → `BadRequestError`.

### Requirements
- iOS 15.1+
- Android API 26+
- React Native 0.74+ (or Expo SDK 52+)

### Native dependencies
- iOS `PreludeAuth` `0.3.0`
- Android `so.prelude.android:auth-sdk:0.3.0`
- Android `so.prelude.android:sdk:0.5.2` (signals)

## [0.1.0] - 2026-05-10

Initial release.

### Added
- Email OTP login: `startOTPLogin`, `resendOTP`, `checkOTP`.
- Email and password login: `loginWithPassword`.
- Password validation against the project policy: `passwordCompliancy`, `validatePassword`, and `PreludeAuthClient.validate` for local keystroke-time classification.
- Session lifecycle: `refresh`, `logout`, `invalidateSession`, `dispose`.
- Session inspection: `getProfile`, `getSessionID`, `getAccessToken`, `getAccessTokenExpiresAt`.
- Automatic access-token refresh on protected requests.
- Active-session management: `listSessions` and `revokeSessions` with `PreludeRevokeTarget.all`, `.others`, `.mine`, and `.session(id)`.
- Step-up authentication: `requestStepUp`, `sendStepUpOTP`, `submitStepUpOTP`, `getActiveStepUp`.
- `changePassword` gated on `prld:pwd:write`.
- Optional signals integration to attach a Prelude `dispatch_id` to login calls (Android only in this release; iOS lands in a follow-up).
- Typed errors covering every documented failure case.

### Requirements
- iOS 15.1+
- Android API 26+
- React Native 0.74+ (or Expo SDK 52+)

### Native dependencies
- iOS `PreludeAuth` `0.3.0`
- Android `so.prelude.android:auth-sdk:0.3.0`
