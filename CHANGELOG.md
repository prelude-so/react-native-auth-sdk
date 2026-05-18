# Changelog

Notable changes to the Prelude React Native Auth SDK (`@prelude.so/react-native-auth-sdk`).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
