// Encoders for Swift → JS replies. Output shapes mirror the
// `*FromJson` decoders on the JS side (see `src/types/`); keep
// them in lockstep when extending.

import Foundation

enum Codec {
    static func encode(user: PreludeUser) -> [String: Any] {
        [
            "accessToken": user.accessToken,
            "profile": encode(profile: user.profile),
        ]
    }

    static func encode(profile: PreludeProfile) -> [String: Any] {
        var extras: [String: Any] = [:]
        for (k, v) in profile.extras { extras[k] = encode(json: v) }
        // NSNull so the Expo bridge surfaces these as JS `null`
        // instead of dropping the key entirely.
        return [
            "userID": profile.userID ?? NSNull(),
            "sessionID": profile.sessionID ?? NSNull(),
            "extras": extras,
        ]
    }

    /// Plain JS-native value for a JWT claim. Mirrors the JS-side
    /// `Record<string, unknown>` shape — consumers cast at the use
    /// site. JS numbers are doubles, so 64-bit ids past 2^53 lose
    /// precision; keep large ids as strings server-side if needed.
    static func encode(json: PreludeJSONValue) -> Any {
        switch json {
        case .string(let s): return s
        // Always box numerics through NSNumber so the Expo bridge
        // takes one path (objc_msgSend on NSNumber). Bare `Double` /
        // `Bool` would let the bridge see Swift native types and
        // pick a different conversion.
        case .int(let i): return NSNumber(value: i)
        case .double(let d): return NSNumber(value: d)
        case .bool(let b): return NSNumber(value: b)
        case .array(let arr): return arr.map(encode(json:))
        case .object(let obj):
            var out: [String: Any] = [:]
            for (k, v) in obj { out[k] = encode(json: v) }
            return out
        case .null: return NSNull()
        }
    }

    static func encode(compliancy: PreludePasswordCompliancy) -> [String: Any] {
        [
            "minLength": compliancy.minLength,
            "maxLength": compliancy.maxLength,
            "uppercase": compliancy.uppercase,
            "lowercase": compliancy.lowercase,
            "numbers": compliancy.numbers,
            "symbols": compliancy.symbols,
        ]
    }

    static func encode(sessionView v: PreludeSessionView) -> [String: Any] {
        // Server-provided ISO 8601 timestamps pass through verbatim:
        // the JS side keeps them as strings so callers pick their
        // own parsing strategy.
        [
            "id": v.id,
            "deviceModel": v.deviceModel,
            "deviceType": v.deviceType.rawValue,
            "osVersion": v.osVersion,
            "countryCode": v.countryCode,
            "createdAt": v.createdAt,
            "lastSeenAt": v.lastSeenAt,
            "expiresAt": v.expiresAt,
        ]
    }

    static func encode(listSessions r: ListSessionsResponse) -> [String: Any] {
        [
            "sessions": r.sessions.map { encode(sessionView: $0) },
            "total": r.total,
            "limit": r.limit,
            "offset": r.offset,
        ]
    }

    /// Public-surface fields only. The challenge token + expiry
    /// stay in ``AuthBridge``'s per-handle cache so the bearer
    /// credential never crosses the wire.
    static func encode(challenge: StepUpChallenge) -> [String: Any] {
        [
            "status": challenge.status.rawValue,
            "challengeID": challenge.challengeID,
            "currentStep": challenge.currentStep ?? NSNull(),
            "requestedScope": challenge.requestedScope,
        ]
    }

}
