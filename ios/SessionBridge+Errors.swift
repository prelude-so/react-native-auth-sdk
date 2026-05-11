// Map native errors onto Expo `Exception`s whose `code` matches
// the JS-side `fromNativeError` registry, so typed JS errors
// (`UnauthorizedError`, `InvalidOTPCodeError`, …) hydrate
// correctly. Unknown codes fall through to a generic `Exception`
// that still surfaces the original code.

import ExpoModulesCore
import Foundation

func mapBridgeError(_ error: Error) -> Exception {
    // Already an Expo Exception: preserve its code so a typed throw
    // from a nested call still hydrates the right JS error.
    if let exc = error as? Exception {
        return exc
    }
    if let e = error as? PreludeSessionError {
        return mapSessionError(e)
    }
    if let e = error as? BridgeDecodeError {
        return Exception(name: "BadRequest", description: e.message, code: "bad_request")
    }
    return Exception(
        name: "Generic",
        description: String(describing: error),
        code: "generic"
    )
}

// `cryptoFailure` and `signalsDispatchFailed` are not currently
// emitted on this platform; the JS registry has them ready to
// hydrate if the native enum gains those cases.
private func mapSessionError(_ error: PreludeSessionError) -> Exception {
    let (code, message) = codeAndMessage(error)
    return Exception(
        name: nameFor(code: code),
        description: message,
        code: code
    )
}

// swiftlint:disable cyclomatic_complexity
private func codeAndMessage(_ error: PreludeSessionError) -> (String, String) {
    switch error {
    case .badRequest(let m): return ("bad_request", m)
    case .unauthorized(let m): return ("unauthorized", m)
    case .rateLimited(let m): return ("rate_limited", m)
    case .internalServerError(let m): return ("internal_server_error", m)
    case .missingChallengeToken(let m): return ("missing_challenge_token", m)
    case .invalidChallengeToken(let m): return ("invalid_challenge_token", m)
    case .expiredChallengeToken(let m): return ("expired_challenge_token", m)
    case .tokenReused(let m): return ("token_reused", m)
    case .invalidOTPCode(let m): return ("invalid_otp_code", m)
    case .refreshFailed(let m): return ("refresh_failed", m)
    case .timeout: return ("timeout", "Request timed out")
    case .invalidConfiguration(let m): return ("invalid_configuration", m)
    case .invalidPassword(let m): return ("invalid_password", m)
    case .forbidden(let m): return ("forbidden", m)
    case .insufficientScope(let m): return ("insufficient_scope", m)
    case .notFound(let m): return ("not_found", m)
    case .conflict(let m): return ("conflict", m)
    case .network(let underlying): return ("network", underlying.localizedDescription)
    case .generic(let code, let message): return (code, message)
    }
}
// swiftlint:enable cyclomatic_complexity

/// Stable, snake-case-free name for the `Exception`. Used only
/// for native logs — JS dispatch goes through `code`.
private func nameFor(code: String) -> String {
    code.split(separator: "_")
        .map { $0.prefix(1).uppercased() + $0.dropFirst() }
        .joined()
}
