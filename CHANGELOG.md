# Changelog

Notable changes to the Prelude React Native Session SDK (`@prelude.so/react-native-session-sdk`).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-05-10

Initial release.

### Added
- Email OTP login: `startOTPLogin`, `resendOTP`, `checkOTP`.
- Email and password login: `loginWithPassword`.
- Password validation against the project policy: `passwordCompliancy`, `validatePassword`, and `PreludeSessionClient.validate` for local keystroke-time classification.
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
- iOS `PreludeSession` `0.2.0`
- Android `so.prelude.android:session-sdk:0.2.0`
