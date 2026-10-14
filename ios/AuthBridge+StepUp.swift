// Step-up: request, deliver OTP, submit OTP or a passkey, and read the most
// recent in-flight challenge. Only the public-surface metadata
// crosses the bridge; the challenge JWT lives in
// ``AuthBridge``'s per-handle cache.

import Foundation

extension AuthBridge {
    func requestStepUp(
        handle: String,
        configRaw: [String: Any],
        scope: String,
        metadataRaw: [String: Any]?
    ) async throws -> [String: Any] {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        let metadata = try decodeMetadata(metadataRaw)
        let challenge = try await client.requestStepUp(
            scope: scope,
            metadata: metadata
        )
        cacheChallenge(handle: handle, challenge: challenge)
        return Codec.encode(challenge: challenge)
    }

    /// Mirror the native `activeStepUp` accessor into the per-handle
    /// cache so a follow-up `submitStepUpOTP` resolves the bearer
    /// challenge token without the caller threading the handle
    /// through their own state.
    func getActiveStepUp(
        handle: String,
        configRaw: [String: Any]
    ) async throws -> [String: Any]? {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        guard let challenge = await client.activeStepUp else { return nil }
        cacheChallenge(handle: handle, challenge: challenge)
        return Codec.encode(challenge: challenge)
    }

    /// Trigger OTP delivery for an in-flight challenge. The native
    /// client throws ``PreludeAuthError/invalidChallengeToken``
    /// for blocked challenges; we don't evict the cache entry on
    /// that path because the lookup itself already misses then.
    func sendStepUpOTP(
        handle: String,
        configRaw: [String: Any],
        challengeID: String
    ) async throws {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        let challenge = try lookupChallenge(handle: handle, challengeID: challengeID)
        try await client.sendStepUpOTP(challenge)
    }

    func submitStepUpOTP(
        handle: String, configRaw: [String: Any], challengeID: String, code: String
    ) async throws -> [String: Any]? {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        let challenge = try lookupChallenge(handle: handle, challengeID: challengeID)
        return try await advanceStepUp(
            handle: handle,
            challenge: challenge,
            // `invalidOTPCode` keeps the challenge usable up to the
            // server's bucket limit; any other error kills it.
            keepsChallenge: { error in
                if case .invalidOTPCode = error { return true }
                return false
            }
        ) { try await client.submitStepUpOTP(challenge, code: code) }
    }

    func continueStepUpWithPasskey(
        handle: String, configRaw: [String: Any], challengeID: String
    ) async throws -> [String: Any]? {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        let challenge = try lookupChallenge(handle: handle, challengeID: challengeID)
        return try await advanceStepUp(
            handle: handle,
            challenge: challenge,
            // Most passkey failures happen before any request is sent —
            // a dismissed sheet, no usable credential — and leave the
            // challenge good for a fallback step. Retire it only when
            // the error says the token itself is gone.
            keepsChallenge: { error in
                switch error {
                case .invalidChallengeToken, .expiredChallengeToken, .tokenReused:
                    return false
                default:
                    return true
                }
            }
        ) { try await client.continueStepUpWithPasskey(challenge) }
    }

    /// Run one step-up `step` against `challenge` and reconcile the
    /// cache with its outcome: swap in the returned challenge, or drop
    /// the entry once the flow completes. On a typed failure
    /// `keepsChallenge` decides whether the challenge survives for
    /// another attempt; an untyped throw always evicts.
    private func advanceStepUp(
        handle: String,
        challenge: StepUpChallenge,
        keepsChallenge: (PreludeAuthError) -> Bool,
        step: () async throws -> StepUpChallenge?
    ) async throws -> [String: Any]? {
        let next: StepUpChallenge?
        do {
            next = try await step()
        } catch let cancel as CancellationError {
            // Cooperative interrupt — leave the challenge cached so
            // the next attempt can resume against the same handle.
            throw cancel
        } catch let error as PreludeAuthError {
            if !keepsChallenge(error) {
                evictChallenge(handle: handle, challengeID: challenge.challengeID)
            }
            throw error
        } catch {
            evictChallenge(handle: handle, challengeID: challenge.challengeID)
            throw error
        }
        guard let next else {
            // Flow completed: post-completion refresh has already
            // minted the scoped access token.
            evictChallenge(handle: handle, challengeID: challenge.challengeID)
            return nil
        }
        if next.status == .blocked {
            // Terminal: a blocked challenge carries no token and is
            // unsubmittable, so don't cache it; just drop the prior
            // entry and surface the verdict to JS.
            evictChallenge(handle: handle, challengeID: challenge.challengeID)
            return Codec.encode(challenge: next)
        }
        // Insert before evicting so a concurrent reader observing
        // under the new id never sees an empty slot during a
        // multi-step transition.
        cacheChallenge(handle: handle, challenge: next)
        if next.challengeID != challenge.challengeID {
            evictChallenge(handle: handle, challengeID: challenge.challengeID)
        }
        return Codec.encode(challenge: next)
    }
}
