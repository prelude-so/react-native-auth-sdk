// PreludeReactNativeAuthSdkModule
//
// iOS Expo module for the React Native Auth SDK. Bridges the
// JS `PreludeAuthClient` API onto the native `PreludeAuth`
// `PreludeAuthClient` value type.
//
// Wiring layer only — the registry, codecs, decoders, and method
// bodies live in `AuthBridge*.swift`. Each `AsyncFunction`
// resolves the bridge instance and delegates, and `wrap` funnels
// every throw through `mapBridgeError` so JS sees a typed error
// matching the `fromNativeError` registry on the JS side.

import ExpoModulesCore

public class PreludeReactNativeAuthSdkModule: Module {
    private let bridge = AuthBridge.shared

    public func definition() -> ModuleDefinition {
        Name("PreludeReactNativeAuthSdk")

        AsyncFunction("dispose") { (handle: String) in
            // Funnel through `wrap` for parity with every other
            // method, even though the current bridge path is
            // non-throwing — keeps the surface uniform if dispose
            // ever grows network or keystore work.
            try await self.wrap { self.bridge.dispose(handle: handle) }
        }

        // OTP -------------------------------------------------------
        AsyncFunction("startOTPLogin") { (h: String, c: [String: Any], o: [String: Any]) in
            try await self.wrap { try await self.bridge.startOTPLogin(handle: h, configRaw: c, options: o) }
        }
        AsyncFunction("resendOTP") { (h: String, c: [String: Any]) in
            try await self.wrap { try await self.bridge.resendOTP(handle: h, configRaw: c) }
        }
        AsyncFunction("checkOTP") { (h: String, c: [String: Any], code: String) -> [String: Any] in
            try await self.wrap { try await self.bridge.checkOTP(handle: h, configRaw: c, code: code) }
        }

        // Password --------------------------------------------------
        AsyncFunction("loginWithPassword") { (h: String, c: [String: Any], o: [String: Any]) -> [String: Any] in
            try await self.wrap { try await self.bridge.loginWithPassword(handle: h, configRaw: c, options: o) }
        }
        AsyncFunction("passwordCompliancy") { (h: String, c: [String: Any]) -> [String: Any] in
            try await self.wrap { try await self.bridge.passwordCompliancy(handle: h, configRaw: c) }
        }
        AsyncFunction("changePassword") { (h: String, c: [String: Any], pwd: String) in
            try await self.wrap { try await self.bridge.changePassword(handle: h, configRaw: c, newPassword: pwd) }
        }

        // Refresh / logout / invalidate -----------------------------
        AsyncFunction("refresh") { (h: String, c: [String: Any]) -> [String: Any] in
            try await self.wrap { try await self.bridge.refresh(handle: h, configRaw: c) }
        }
        AsyncFunction("logout") { (h: String, c: [String: Any]) in
            try await self.wrap { try await self.bridge.logout(handle: h, configRaw: c) }
        }
        AsyncFunction("invalidateSession") { (h: String, c: [String: Any]) in
            try await self.wrap { try await self.bridge.invalidateSession(handle: h, configRaw: c) }
        }

        // Manage sessions -------------------------------------------
        AsyncFunction("listSessions") { (h: String, c: [String: Any], o: [String: Any]) -> [String: Any] in
            try await self.wrap { try await self.bridge.listSessions(handle: h, configRaw: c, options: o) }
        }
        AsyncFunction("revokeSessions") { (h: String, c: [String: Any], t: [String: Any]) in
            try await self.wrap { try await self.bridge.revokeSessions(handle: h, configRaw: c, target: t) }
        }

        // Step-up ---------------------------------------------------
        // `metadata` arrives as `Any` so a JS `null` → NSNull is
        // accepted alongside an object-shaped payload; the bridge
        // decodes both into the same `[String: String]?`.
        AsyncFunction("requestStepUp") { (h: String, c: [String: Any], scope: String, metadata: [String: Any]?) -> [String: Any] in
            try await self.wrap {
                try await self.bridge.requestStepUp(
                    handle: h, configRaw: c, scope: scope, metadataRaw: metadata
                )
            }
        }
        AsyncFunction("sendStepUpOTP") { (h: String, c: [String: Any], id: String) in
            try await self.wrap { try await self.bridge.sendStepUpOTP(handle: h, configRaw: c, challengeID: id) }
        }
        AsyncFunction("submitStepUpOTP") { (h: String, c: [String: Any], id: String, code: String) -> [String: Any]? in
            try await self.wrap { try await self.bridge.submitStepUpOTP(handle: h, configRaw: c, challengeID: id, code: code) }
        }
        AsyncFunction("getActiveStepUp") { (h: String, c: [String: Any]) -> [String: Any]? in
            try await self.wrap { try await self.bridge.getActiveStepUp(handle: h, configRaw: c) }
        }

        // Cached readers --------------------------------------------
        AsyncFunction("getProfile") { (h: String, c: [String: Any]) -> [String: Any]? in
            try await self.wrap { try await self.bridge.getProfile(handle: h, configRaw: c) }
        }
        AsyncFunction("getSessionID") { (h: String, c: [String: Any]) -> String? in
            try await self.wrap { try await self.bridge.getSessionID(handle: h, configRaw: c) }
        }
        AsyncFunction("getAccessToken") { (h: String, c: [String: Any]) -> String? in
            try await self.wrap { try await self.bridge.getAccessToken(handle: h, configRaw: c) }
        }
        AsyncFunction("getAccessTokenExpiresAt") { (h: String, c: [String: Any]) -> Int? in
            try await self.wrap { try await self.bridge.getAccessTokenExpiresAt(handle: h, configRaw: c) }
        }

        OnDestroy {
            // Engine teardown: drop everything so the next load
            // doesn't observe a stale challenge cache or leaked
            // native client.
            self.bridge.clearAll()
        }
    }

    /// Single error-translation hop so every method gets a JS
    /// `code` that matches the `fromNativeError` registry — keeps
    /// `definition()` flat. Cooperative cancellation propagates
    /// as-is so Expo's task-cancellation machinery isn't fed a
    /// typed `generic` error.
    private func wrap<T>(_ body: () async throws -> T) async throws -> T {
        do {
            return try await body()
        } catch let cancel as CancellationError {
            throw cancel
        } catch {
            throw mapBridgeError(error)
        }
    }
}
