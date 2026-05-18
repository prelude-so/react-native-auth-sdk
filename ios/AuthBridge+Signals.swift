// Stub adapter for Prelude signals on iOS. The Prelude signals
// SDK isn't bundled in this pod, so the adapter always returns
// `nil` — the auth client treats that as "no signals", and
// `dispatch_id` is omitted from login bodies.

import Foundation

struct ReactNativePreludeSignalsAdapter: PreludeSignalsDispatcher, @unchecked Sendable {
    init(sdkKey: String?, timeout: TimeInterval = 5.0) {
        // Arguments accepted for API parity; intentionally unused.
        _ = sdkKey; _ = timeout
    }

    func dispatch() async throws -> String? { nil }
}

/// Resolve the Prelude signals SDK key for this process. Currently
/// a no-op (always returns `nil`); kept so the public surface stays
/// stable when signals dispatch is wired up.
func resolveSignalsSDKKey(keyOverride: String?) -> String? {
    nil
}
