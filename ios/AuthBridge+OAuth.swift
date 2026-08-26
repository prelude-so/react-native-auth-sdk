// Social / OAuth login: the one-shot web flow plus the lower-level
// initiate / finalize pair for apps that present the page themselves.

import Foundation

extension AuthBridge {
    func loginWithOAuth(
        handle: String, configRaw: [String: Any], options: [String: Any]
    ) async throws -> [String: Any] {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        let result = try await client.loginWithOAuth(decodeOAuthLoginOptions(options))
        return encodeOAuthResult(handle: handle, result: result)
    }

    func initiateOAuthLogin(
        handle: String, configRaw: [String: Any], options: [String: Any]
    ) async throws -> String {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        let context = try await client.initiateOAuthLogin(
            decodeInitiateOAuthLoginOptions(options)
        )
        cacheOAuthContext(handle: handle, context: context)
        return context.authorizationURL.absoluteString
    }

    func finalizeOAuthLogin(
        handle: String, configRaw: [String: Any], challengeToken: String
    ) async throws -> [String: Any] {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        let context = try lookupOAuthContext(handle: handle)
        let result = try await client.finalizeOAuthLogin(
            context, challengeToken: challengeToken
        )
        evictOAuthContext(handle: handle)
        return encodeOAuthResult(handle: handle, result: result)
    }

    /// Tagged wire encoding of an OAuth outcome. An `otpRequired`
    /// result stashes its `OAuthEmailChallenge` in the per-handle
    /// cache and crosses only the opaque id, keeping the verification
    /// token off the wire.
    func encodeOAuthResult(
        handle: String, result: FinalizeOAuthLoginResult
    ) -> [String: Any] {
        switch result {
        case .loggedIn(let user):
            return ["kind": "logged_in", "user": Codec.encode(user: user)]
        case .otpRequired(let challenge, let email):
            let id = cacheOAuthChallenge(handle: handle, challenge: challenge)
            return ["kind": "otp_required", "challengeID": id, "email": email ?? NSNull()]
        }
    }

    /// Redeem the email OTP for an `otpRequired` login, resolving the
    /// cached challenge by id. The verification token it carries is
    /// replayed native-side; only the code crosses the bridge. Evicts
    /// on success and on any non-retryable failure — a wrong code
    /// (`invalidOTPCode`) keeps the challenge usable up to the
    /// server's bucket limit.
    func checkOAuthEmailOTP(
        handle: String, configRaw: [String: Any], challengeID: String, code: String
    ) async throws -> [String: Any] {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        let challenge = try lookupOAuthChallenge(handle: handle, challengeID: challengeID)
        do {
            let user = try await client.checkOAuthEmailOTP(code, resuming: challenge)
            evictOAuthChallenge(handle: handle, challengeID: challengeID)
            return Codec.encode(user: user)
        } catch let cancel as CancellationError {
            // Cooperative interrupt — leave the challenge cached so the
            // next attempt can resume against the same handle.
            throw cancel
        } catch let error as PreludeAuthError {
            if case .invalidOTPCode = error {
                // keep cached
            } else {
                evictOAuthChallenge(handle: handle, challengeID: challengeID)
            }
            throw error
        } catch {
            // Untyped throw (e.g. a misconfigured store) must still
            // evict so a stale entry can't outlive the failure.
            evictOAuthChallenge(handle: handle, challengeID: challengeID)
            throw error
        }
    }
}
