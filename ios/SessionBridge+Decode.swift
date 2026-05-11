// Decoders for arguments crossing the JS → Swift bridge.
//
// JS hands us untyped `[String: Any]` maps. Each decoder validates
// shape + types and throws a structured ``BridgeDecodeError``;
// missing/malformed args surface as `bad_request` on the JS side
// (see ``mapBridgeError(_:)``).

import Foundation

struct BridgeDecodeError: Error { let message: String }

func decodeError(_ message: String) -> Error {
    BridgeDecodeError(message: message)
}



/// Tolerant numeric arg readers. The Expo bridge surfaces JS
/// numbers as `Double`; some Hermes builds (and hand-rolled
/// integration tests) hand us `Int`. `as? Int` on a `Double`
/// returns nil, which is the bug that silently dropped pagination
/// args before — anyone reaching for a numeric field should use
/// these helpers, not raw casts.
func intArg(_ raw: [String: Any], _ key: String) -> Int? {
    if let n = raw[key] as? Int { return n }
    if let n = raw[key] as? Double { return Int(n) }
    return nil
}

func doubleArg(_ raw: [String: Any], _ key: String) -> Double? {
    if let n = raw[key] as? Double { return n }
    if let n = raw[key] as? Int { return Double(n) }
    return nil
}

/// Snapshot of the JS-side `ConfigJson`. Resolved lazily on the
/// first call per handle.
struct ClientConfig {
    let endpoint: Endpoint
    let hostOverride: String?
    let timeout: TimeInterval
    let allowInsecureTLS: Bool
    /// JS-supplied override; nil falls back to `Info.plist`'s
    /// `PreludeSDKKey`. JS is authoritative on trimming + blank
    /// collapsing, so we accept the value verbatim here.
    let signalsKeyOverride: String?

    init(decoding raw: [String: Any]) throws {
        guard let endpointRaw = raw["endpoint"] as? [String: Any] else {
            throw decodeError("config.endpoint missing or wrong shape")
        }
        switch endpointRaw["kind"] as? String {
        case "default":
            self.endpoint = .default
        case "custom":
            guard let address = endpointRaw["address"] as? String else {
                throw decodeError("Endpoint.custom missing address")
            }
            self.endpoint = .custom(address)
        default:
            throw decodeError("Unknown Endpoint kind")
        }
        self.hostOverride = raw["hostOverride"] as? String
        self.timeout = doubleArg(raw, "timeoutSeconds") ?? 10.0
        self.allowInsecureTLS = (raw["allowInsecureTLS"] as? Bool) ?? false
        self.signalsKeyOverride = raw["signalsKeyOverride"] as? String
    }
}

func decodeStartOTPLoginOptions(_ raw: [String: Any]) throws -> StartOTPLoginOptions {
    guard let identifierRaw = raw["identifier"] as? [String: Any],
          let typeWire = identifierRaw["type"] as? String,
          let value = identifierRaw["value"] as? String
    else {
        throw decodeError("StartOTPLoginOptions: malformed payload")
    }
    guard let type = PreludeIdentifierType(rawValue: typeWire) else {
        throw decodeError("Unknown PreludeIdentifierType: \(typeWire)")
    }
    return StartOTPLoginOptions(
        identifier: PreludeIdentifier(type: type, value: value),
        loginConfigID: raw["loginConfigID"] as? String
    )
}

func decodeLoginWithPasswordOptions(_ raw: [String: Any]) throws -> LoginWithPasswordOptions {
    guard let email = raw["emailAddress"] as? String,
          let password = raw["password"] as? String
    else {
        throw decodeError("LoginWithPasswordOptions: malformed payload")
    }
    // `LoginWithPasswordOptions.init` takes `String` and wraps
    // internally with `RedactedString` — the change-password bridge
    // wraps explicitly because that init's signature differs.
    return LoginWithPasswordOptions(emailAddress: email, password: password)
}

func decodeListSessionsOptions(_ raw: [String: Any]) -> ListSessionsOptions {
    // Missing keys fall through to nil so the server picks pagination
    // without a JS bump. `intArg` tolerates Double-shaped numbers
    // from the Expo bridge.
    return ListSessionsOptions(
        limit: intArg(raw, "limit"),
        offset: intArg(raw, "offset")
    )
}

func decodeRevokeTarget(_ raw: [String: Any]) throws -> RevokeTarget {
    guard let kind = raw["kind"] as? String else {
        throw decodeError("RevokeTarget: malformed payload")
    }
    switch kind {
    case "all": return .all
    case "others": return .others
    case "mine": return .mine
    case "session":
        guard let id = raw["sessionID"] as? String else {
            throw decodeError("RevokeTarget.session: missing sessionID")
        }
        return .session(id: id)
    default:
        throw decodeError("Unknown RevokeTarget kind: \(kind)")
    }
}

/// Optional `[String: String]` step-up audit metadata. JS `null`
/// reaches us as `nil` (the AsyncFunction signature is `[String: Any]?`).
/// A wrong-typed value fails loudly instead of being silently dropped.
func decodeMetadata(_ raw: [String: Any]?) throws -> [String: String]? {
    guard let raw else { return nil }
    var out: [String: String] = [:]
    for (k, v) in raw {
        guard let value = v as? String else {
            throw decodeError("metadata: non-string value for `\(k)`")
        }
        out[k] = value
    }
    return out
}
