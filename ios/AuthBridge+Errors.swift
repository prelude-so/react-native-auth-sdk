// Map native errors onto Expo `Exception`s whose `code` matches
// the JS-side `fromNativeError` registry, so typed JS errors
// (`UnauthorizedError`, `InvalidOTPCodeError`, …) hydrate
// correctly. Unknown codes fall through to a generic `Exception`
// that still surfaces the original code.

import ExpoModulesCore
import Foundation

/// `Exception(name:description:code:)` leaves `reason` at its
/// "undefined reason" default, and the message delivered to JS is
/// built from `reason` — so errors built that way reach JS with
/// their message dropped. Overriding `reason` keeps it intact.
private final class BridgeException: Exception {
    private let message: String

    init(name: String, message: String, code: String) {
        self.message = message
        super.init(name: name, description: message, code: code)
    }

    override var reason: String { message }
}

func mapBridgeError(_ error: Error) -> Exception {
    // Already an Expo Exception: preserve its code so a typed throw
    // from a nested call still hydrates the right JS error.
    if let exc = error as? Exception {
        return exc
    }
    if let e = error as? PreludeAuthError {
        return mapAuthError(e)
    }
    if let e = error as? BridgeDecodeError {
        return BridgeException(name: "BadRequest", message: e.message, code: "bad_request")
    }
    return BridgeException(
        name: "Generic",
        message: String(describing: error),
        code: "generic"
    )
}

// `cryptoFailure` and `signalsDispatchFailed` are not currently
// emitted on this platform; the JS registry has them ready to
// hydrate if the native enum gains those cases.
private func mapAuthError(_ error: PreludeAuthError) -> Exception {
    let (code, message) = codeAndMessage(error)
    return BridgeException(
        name: nameFor(code: code),
        message: message,
        code: code
    )
}

// swiftlint:disable cyclomatic_complexity
private func codeAndMessage(_ error: PreludeAuthError) -> (String, String) {
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
    case .cancelled: return ("cancelled", "Request cancelled")
    case .invalidConfiguration(let m): return ("invalid_configuration", m)
    case .invalidPassword(let m): return ("invalid_password", m)
    case .forbidden(let m): return ("forbidden", m)
    case .insufficientScope(let m): return ("insufficient_scope", m)
    case .notFound(let m): return ("not_found", m)
    case .conflict(let m): return ("conflict", m)
    case .samlLoginRequired(let m): return ("saml_login_required", m)
    case .passkeyNotConfigured(let m): return ("passkey_not_configured", m)
    case .passkeyRegistrationFailed(let m): return ("passkey_registration_failed", m)
    case .passkeyStepUnavailable(let m): return ("passkey_step_unavailable", m)
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
