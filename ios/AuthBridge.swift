// Per-process registry of native ``PreludeAuthClient``s, keyed
// by the JS-stamped handle. Native clients are created lazily on
// first use and reused across calls so DPoP keys, refresh tokens
// and the access-token cache stay stable for the lifetime of the
// JS instance.
//
// Concurrency model: a serial ``DispatchQueue`` guards the
// dictionaries (cheap, microsecond-scale). Provisioning a client
// is heavier — synchronous Keychain probe — and runs inside a
// ``Task`` rather than under the lock, so an in-flight first-call
// for one handle doesn't block bridge calls on other handles.
// Single-flight via the ``pendingResolves`` map: concurrent
// first-callers for the same handle await the same ``Task``,
// preventing the duplicate-DPoP-keypair race the lock guarded
// against in earlier revisions.

import Foundation

final class AuthBridge {
    /// Shared instance: the Expo `Module` is reinitialised on
    /// reload, so the registry lives above it. The Module's
    /// `OnDestroy` calls ``clearAll()`` so reloads don't leak
    /// orphaned clients — JS handles aren't persisted across
    /// reload, so old entries would otherwise become unreachable.
    static let shared = AuthBridge()

    private var clients: [String: PreludeAuthClient] = [:]
    private var pendingResolves: [String: Task<PreludeAuthClient, Error>] = [:]
    private var challenges: [String: [String: StepUpChallenge]] = [:]
    private var oauthChallenges: [String: [String: OAuthEmailChallenge]] = [:]

    /// Single serial queue covers all three maps. Their lifetimes
    /// are coupled — disposing a handle evicts everything in
    /// lockstep — so a shared queue keeps that invariant cheap to
    /// express. Held only for dictionary reads / writes; the
    /// expensive provisioning work runs outside.
    private let queue = DispatchQueue(
        label: "so.prelude.reactnative.auth.registry"
    )

    // MARK: - Client resolution

    /// Lookup-or-create the native client for `handle`.
    ///
    /// Cache hit: returns immediately after a dictionary lookup.
    ///
    /// Cache miss: stages a single ``Task`` in ``pendingResolves``
    /// so concurrent first-callers for the same handle await one
    /// provisioning rather than each minting their own DPoP
    /// keypair. The ``Task`` body runs the synchronous Keychain
    /// probe + decode outside the queue lock, so unrelated handles
    /// keep moving.
    func resolveClient(
        handle: String,
        configRaw: [String: Any]
    ) async throws -> PreludeAuthClient {
        // Fast path.
        if let existing = queue.sync(execute: { clients[handle] }) {
            return existing
        }
        // Slow path: pick or stage the single-flight Task under the lock.
        let task: Task<PreludeAuthClient, Error> = queue.sync {
            // Re-check after acquiring the lock: a concurrent caller
            // may have just settled the cache.
            if let existing = clients[handle] {
                return Task { existing }
            }
            if let pending = pendingResolves[handle] { return pending }
            let new = Task<PreludeAuthClient, Error> {
                try Self.provisionClient(configRaw: configRaw)
            }
            pendingResolves[handle] = new
            return new
        }
        do {
            let client = try await task.value
            queue.sync {
                // Don't resurrect a handle that was disposed mid-flight.
                if pendingResolves[handle] != nil {
                    clients[handle] = client
                    pendingResolves.removeValue(forKey: handle)
                }
            }
            return client
        } catch {
            queue.sync { _ = pendingResolves.removeValue(forKey: handle) }
            throw error
        }
    }

    private static func provisionClient(
        configRaw: [String: Any]
    ) throws -> PreludeAuthClient {
        let config = try ClientConfig(decoding: configRaw)
        let signalsKey = resolveSignalsSDKKey(keyOverride: config.signalsKeyOverride)
        // Adapter no-ops when the key is nil, so we always pass it
        // through. Hides the manifest / override decision from the
        // auth client.
        let dispatcher: PreludeSignalsDispatcher =
            ReactNativePreludeSignalsAdapter(sdkKey: signalsKey)
        return try PreludeAuthClient(
            endpoint: config.endpoint,
            hostOverride: config.hostOverride,
            signalsDispatcher: dispatcher,
            timeout: config.timeout,
            allowInsecureTLS: config.allowInsecureTLS
        )
    }

    func dispose(handle: String) {
        queue.sync {
            clients.removeValue(forKey: handle)
            // An in-flight resolve for this handle becomes orphaned —
            // its result will land but we won't promote it into
            // `clients` (the post-await write checks for `pending`).
            pendingResolves.removeValue(forKey: handle)
            challenges.removeValue(forKey: handle)
            oauthChallenges.removeValue(forKey: handle)
        }
    }

    /// Drop every client and challenge. Called on module teardown
    /// so a JS reload doesn't leave orphaned entries (whose handles
    /// the JS side has forgotten) lingering in the singleton.
    func clearAll() {
        queue.sync {
            clients.removeAll()
            pendingResolves.removeAll()
            challenges.removeAll()
            oauthChallenges.removeAll()
        }
    }

    // MARK: - Step-up challenge cache

    /// Insert or replace a challenge under (handle, challengeID).
    /// `blocked` and the empty-id sentinel are skipped — neither is
    /// submittable, so caching them would only grow the dict.
    ///
    /// A call that races `dispose(handle:)` / `clearAll()` silently
    /// no-ops on the cache write. The native call itself still
    /// returns its result to JS; only the `activeStepUp` mirror is
    /// lost. Acceptable because a disposed JS handle can't observe
    /// `activeStepUp` anyway (it would throw `DisposedError` first).
    func cacheChallenge(handle: String, challenge: StepUpChallenge) {
        guard challenge.status != .blocked, !challenge.challengeID.isEmpty
        else { return }
        queue.sync {
            // Don't resurrect entries for a disposed handle.
            guard clients[handle] != nil else { return }
            var slot = challenges[handle] ?? [:]
            slot[challenge.challengeID] = challenge
            challenges[handle] = slot
        }
    }

    func evictChallenge(handle: String, challengeID: String) {
        queue.sync {
            guard var slot = challenges[handle] else { return }
            slot.removeValue(forKey: challengeID)
            if slot.isEmpty {
                challenges.removeValue(forKey: handle)
            } else {
                challenges[handle] = slot
            }
        }
    }

    /// Resolve a JS-side `challengeID` back to its cached value, or
    /// throw ``PreludeAuthError/invalidChallengeToken`` so the
    /// consumer recovers via ``requestStepUp``.
    func lookupChallenge(
        handle: String,
        challengeID: String
    ) throws -> StepUpChallenge {
        var found: StepUpChallenge?
        queue.sync { found = challenges[handle]?[challengeID] }
        guard let challenge = found else {
            throw PreludeAuthError.invalidChallengeToken(
                "Step-up challenge `\(challengeID)` not found. " +
                "Pass the value returned by requestStepUp / submitStepUpOTP " +
                "unchanged, or call requestStepUp(scope:) again."
            )
        }
        return challenge
    }

    // MARK: - OAuth-email-link challenge cache

    /// Stash the `OAuthEmailChallenge` returned by an `otpRequired`
    /// login under a freshly minted opaque id and hand the id back —
    /// only that crosses to JS, so the verification token it carries
    /// never leaves the device. A write that races `dispose(handle:)`
    /// / `clearAll()` silently no-ops.
    func cacheOAuthChallenge(handle: String, challenge: OAuthEmailChallenge) -> String {
        let id = UUID().uuidString
        queue.sync {
            // Don't resurrect entries for a disposed handle.
            guard clients[handle] != nil else { return }
            var slot = oauthChallenges[handle] ?? [:]
            slot[id] = challenge
            oauthChallenges[handle] = slot
        }
        return id
    }

    func evictOAuthChallenge(handle: String, challengeID: String) {
        queue.sync {
            guard var slot = oauthChallenges[handle] else { return }
            slot.removeValue(forKey: challengeID)
            if slot.isEmpty {
                oauthChallenges.removeValue(forKey: handle)
            } else {
                oauthChallenges[handle] = slot
            }
        }
    }

    /// Resolve a JS-side `challengeID` back to its cached challenge, or
    /// throw ``PreludeAuthError/invalidChallengeToken`` so the consumer
    /// restarts the OAuth login.
    func lookupOAuthChallenge(
        handle: String,
        challengeID: String
    ) throws -> OAuthEmailChallenge {
        var found: OAuthEmailChallenge?
        queue.sync { found = oauthChallenges[handle]?[challengeID] }
        guard let challenge = found else {
            throw PreludeAuthError.invalidChallengeToken(
                "OAuth email challenge `\(challengeID)` not found. " +
                "Pass the value returned by finalizeOAuthLogin / loginWithOAuth " +
                "unchanged, or restart the OAuth login."
            )
        }
        return challenge
    }
}
