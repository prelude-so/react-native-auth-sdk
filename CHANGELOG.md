# Changelog

Notable changes to the Prelude React Native Auth SDK (`@prelude.so/react-native-auth-sdk`).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
