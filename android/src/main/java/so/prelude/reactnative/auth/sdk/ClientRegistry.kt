package so.prelude.reactnative.auth.sdk

import android.content.Context
import android.content.pm.PackageManager
import so.prelude.android.auth.OAuthEmailChallenge
import so.prelude.android.auth.PreludeAuthClient
import so.prelude.android.auth.PreludeAuthError
import so.prelude.android.auth.PreludeStepUpChallenge
import so.prelude.android.auth.PreludeStepUpStatus
import java.util.UUID

/**
 * `AndroidManifest.xml` meta-data key the SDK reads for the
 * platform's Prelude signals SDK key.
 */
private const val MANIFEST_SDK_KEY = "so.prelude.sdk_key"

/**
 * Resolve the Prelude signals SDK key for this app.
 *
 * Precedence: JS-supplied override > manifest meta-data. Empty /
 * blank entries collapse to `null` so an unconfigured manifest
 * value doesn't construct a half-wired dispatcher. Returning
 * `null` is a supported no-op — signals just don't dispatch and
 * `dispatch_id` is omitted from login bodies. JS-side trim/collapse
 * is authoritative; this is defence in depth.
 */
internal fun resolveSignalsSDKKey(context: Context, override: String?): String? {
    if (!override.isNullOrBlank()) return override
    return try {
        val info = context.packageManager.getApplicationInfo(
            context.packageName,
            PackageManager.GET_META_DATA,
        )
        info.metaData?.getString(MANIFEST_SDK_KEY)?.takeIf { it.isNotBlank() }
    } catch (_: PackageManager.NameNotFoundException) {
        null
    }
}


/**
 * Per-handle native client cache plus per-handle in-flight step-up
 * challenges. A single lock covers both: their lifetimes are coupled
 * (disposing a handle should evict both in lockstep) and the wire form
 * sent across the bridge relies on the challenge cache to keep the
 * bearer challenge JWT off the JS side.
 */
internal class ClientRegistry {
    private val clients: MutableMap<String, PreludeAuthClient> = mutableMapOf()
    private val challenges: MutableMap<String, MutableMap<String, PreludeStepUpChallenge>> =
        mutableMapOf()
    private val oauthChallenges: MutableMap<String, MutableMap<String, OAuthEmailChallenge>> =
        mutableMapOf()
    private val lock = Any()

    /**
     * Lookup-or-create runs inside the same lock on purpose: a split
     * read-then-write would let two callers for the same handle both
     * miss the cache, both run the `PreludeAuthClient` constructor
     * (which provisions DPoP key state via Keystore), and the second
     * writer would win — leaving the loser's keystore footprint with
     * no JS-side reference to dispose it.
     */
    fun resolveClient(
        context: Context,
        handle: String,
        configRaw: Map<*, *>,
    ): PreludeAuthClient =
        synchronized(lock) {
            clients[handle]?.let { return@synchronized it }
            val config = ClientConfig.decode(configRaw)
            val signalsKey = resolveSignalsSDKKey(context, config.signalsKeyOverride)
            // Adapter no-ops when `sdkKey` is null, so we always
            // pass it through. Hides the manifest / override choice
            // from the auth client.
            val dispatcher = PreludeSignalsAdapter(context, signalsKey)
            val client = PreludeAuthClient(
                context = context,
                baseUrl = config.baseUrl,
                hostOverride = config.hostOverride,
                timeout = config.timeout,
                signalsDispatcher = dispatcher,
            )
            clients[handle] = client
            client
        }

    /** Drop the client and any cached challenges for [handle]. */
    fun dispose(handle: String) {
        synchronized(lock) {
            clients.remove(handle)
            challenges.remove(handle)
            oauthChallenges.remove(handle)
        }
    }

    /** Drop everything; called on module teardown. */
    fun clear() {
        synchronized(lock) {
            clients.clear()
            challenges.clear()
            oauthChallenges.clear()
        }
    }

    /**
     * Insert or replace a challenge under (handle, challengeID).
     * Blocked challenges and the empty-ID sentinel are skipped: neither
     * is submittable, so caching them would only grow the map.
     *
     * A call that races [dispose] / [clear] silently no-ops on the
     * cache write. The native call itself still returns its result
     * to JS; only the `activeStepUp` mirror is lost. Acceptable
     * because a disposed JS handle can't observe `activeStepUp`
     * anyway (it would throw `DisposedError` first).
     */
    fun cacheChallenge(handle: String, challenge: PreludeStepUpChallenge) {
        if (challenge.status == PreludeStepUpStatus.BLOCKED) return
        if (challenge.challengeId.isEmpty()) return
        synchronized(lock) {
            // Don't resurrect entries for a disposed handle.
            if (clients[handle] == null) return
            val slot = challenges.getOrPut(handle) { mutableMapOf() }
            slot[challenge.challengeId] = challenge
        }
    }

    fun evictChallenge(handle: String, challengeId: String) {
        synchronized(lock) {
            val slot = challenges[handle] ?: return
            slot.remove(challengeId)
            if (slot.isEmpty()) challenges.remove(handle)
        }
    }

    /**
     * Resolve a JS-side challengeID back to the cached challenge.
     * Throws `InvalidChallengeToken` when the ID is unknown to this
     * registry; recover via `requestStepUp(scope)`. TTL is tracked
     * server-side and surfaces independently as
     * `expired_challenge_token`, so this path is purely "we never
     * cached it / it was already evicted".
     */
    fun lookupChallenge(handle: String, challengeId: String): PreludeStepUpChallenge {
        val found = synchronized(lock) { challenges[handle]?.get(challengeId) }
        return found ?: throw PreludeAuthError.InvalidChallengeToken(
            "Step-up challenge `$challengeId` not found. " +
                "Pass the value returned by requestStepUp / submitStepUpOTP " +
                "unchanged, or call requestStepUp(scope) again.",
        )
    }

    /**
     * Stash the [OAuthEmailChallenge] from an `otpRequired` login
     * under a freshly minted opaque id and return that id. Only the id
     * crosses the bridge, so the verification token it carries never
     * leaves the device. A write that races [dispose] / [clear]
     * silently no-ops.
     */
    fun cacheOAuthChallenge(handle: String, challenge: OAuthEmailChallenge): String {
        val id = UUID.randomUUID().toString()
        synchronized(lock) {
            // Don't resurrect entries for a disposed handle.
            if (clients[handle] == null) return id
            val slot = oauthChallenges.getOrPut(handle) { mutableMapOf() }
            slot[id] = challenge
        }
        return id
    }

    fun evictOAuthChallenge(handle: String, challengeId: String) {
        synchronized(lock) {
            val slot = oauthChallenges[handle] ?: return
            slot.remove(challengeId)
            if (slot.isEmpty()) oauthChallenges.remove(handle)
        }
    }

    /**
     * Resolve a JS-side challengeId back to the cached challenge.
     * Throws `InvalidChallengeToken` when unknown to this registry;
     * recover by restarting the OAuth login.
     */
    fun lookupOAuthChallenge(handle: String, challengeId: String): OAuthEmailChallenge {
        val found = synchronized(lock) { oauthChallenges[handle]?.get(challengeId) }
        return found ?: throw PreludeAuthError.InvalidChallengeToken(
            "OAuth email challenge `$challengeId` not found. " +
                "Pass the value returned by finalizeOAuthLogin / loginWithOAuth " +
                "unchanged, or restart the OAuth login.",
        )
    }
}
