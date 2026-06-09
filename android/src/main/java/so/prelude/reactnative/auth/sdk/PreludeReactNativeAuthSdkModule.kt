// PreludeReactNativeAuthSdkModule
//
// Android Expo module for the React Native Auth SDK. Bridges the
// JS `PreludeAuthClient` API onto `so.prelude.android:auth-sdk`'s
// `PreludeAuthClient` class.
//
// One JS instance maps to one native client, looked up by the
// per-instance `handle` string the JS side stamps at construction.
// Native clients are created lazily on first use and reused for the
// lifetime of the handle so DPoP keys, refresh tokens, and the
// access-token cache stay stable across calls.
//
// In-flight step-up challenges are cached natively, keyed by
// (handle, challengeID), so the wire form sent across the bridge can
// omit the bearer challenge token.

package so.prelude.reactnative.auth.sdk

import android.content.Context
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import so.prelude.android.auth.PreludeAuthClient
import so.prelude.android.auth.PreludeAuthError
import so.prelude.android.auth.PreludeStepUpStatus
import so.prelude.android.auth.RedactedString
import so.prelude.android.auth.changePassword
import so.prelude.android.auth.canChangePassword
import so.prelude.android.auth.checkOTP
import so.prelude.android.auth.getPasswordCompliancy
import so.prelude.android.auth.listSessions
import so.prelude.android.auth.loginWithPassword
import so.prelude.android.auth.logout
import so.prelude.android.auth.requestStepUp
import so.prelude.android.auth.resendOTP
import so.prelude.android.auth.revokeSessions
import so.prelude.android.auth.sendStepUpOTP
import so.prelude.android.auth.startOTPLogin
import so.prelude.android.auth.submitStepUpOTP

class PreludeReactNativeAuthSdkModule : Module() {
    private val clientRegistry = ClientRegistry()

    override fun definition() =
        ModuleDefinition {
            Name("PreludeReactNativeAuthSdk")

            // Drop the native client and step-up cache for this handle
            // when the JS instance is disposed. Synchronous: nothing
            // here touches the network or the keystore.
            AsyncFunction("dispose") { handle: String ->
                clientRegistry.dispose(handle)
            }

            // OTP ---------------------------------------------------
            AsyncFunction("startOTPLogin") Coroutine {
                handle: String, config: Map<String, Any?>, options: Map<String, Any?> ->
                withClient(handle, config) {
                    it.startOTPLogin(decodeStartOTPLoginOptions(options))
                }
            }
            AsyncFunction("resendOTP") Coroutine { handle: String, config: Map<String, Any?> ->
                withClient(handle, config) { it.resendOTP() }
            }
            AsyncFunction("checkOTP") Coroutine {
                handle: String, config: Map<String, Any?>, code: String ->
                withClient(handle, config) { Codec.encodeUser(it.checkOTP(code)) }
            }

            // Password ----------------------------------------------
            AsyncFunction("loginWithPassword") Coroutine {
                handle: String, config: Map<String, Any?>, options: Map<String, Any?> ->
                withClient(handle, config) {
                    Codec.encodeUser(it.loginWithPassword(decodeLoginWithPasswordOptions(options)))
                }
            }
            // `validatePassword` is intentionally absent — JS classifies
            // locally against the cached compliancy.
            AsyncFunction("passwordCompliancy") Coroutine {
                handle: String, config: Map<String, Any?> ->
                withClient(handle, config) {
                    Codec.encodeCompliancy(it.getPasswordCompliancy())
                }
            }
            AsyncFunction("changePassword") Coroutine {
                handle: String, config: Map<String, Any?>, newPassword: String ->
                withClient(handle, config) { it.changePassword(RedactedString(newPassword)) }
            }
            AsyncFunction("canChangePassword") Coroutine {
                handle: String, config: Map<String, Any?> ->
                withClient(handle, config) { it.canChangePassword() }
            }

            // Refresh / logout / invalidate -------------------------
            AsyncFunction("refresh") Coroutine { handle: String, config: Map<String, Any?> ->
                withClient(handle, config) { Codec.encodeUser(it.refresh()) }
            }
            AsyncFunction("logout") Coroutine { handle: String, config: Map<String, Any?> ->
                withClient(handle, config) { it.logout() }
            }
            // Marks the cached access token stale without removing it.
            // No network call; the refresh token is untouched.
            AsyncFunction("invalidateSession") Coroutine {
                handle: String, config: Map<String, Any?> ->
                withClient(handle, config) { it.invalidateCache() }
            }

            // Manage sessions ---------------------------------------
            AsyncFunction("listSessions") Coroutine {
                handle: String, config: Map<String, Any?>, options: Map<String, Any?> ->
                withClient(handle, config) {
                    Codec.encodeListSessions(it.listSessions(decodeListSessionsOptions(options)))
                }
            }
            AsyncFunction("revokeSessions") Coroutine {
                handle: String, config: Map<String, Any?>, target: Map<String, Any?> ->
                withClient(handle, config) { it.revokeSessions(decodeRevokeTarget(target)) }
            }

            // Step-up -----------------------------------------------
            // `metadata` is `Any?` so a JS `null` survives the bridge
            // alongside an object-shaped payload. The decoder treats
            // both as "no metadata".
            AsyncFunction("requestStepUp") Coroutine {
                handle: String, config: Map<String, Any?>, scope: String, metadata: Any? ->
                withClient(handle, config) {
                    val challenge = it.requestStepUp(scope, decodeMetadata(metadata))
                    clientRegistry.cacheChallenge(handle, challenge)
                    Codec.encodeChallenge(challenge)
                }
            }
            AsyncFunction("sendStepUpOTP") Coroutine {
                handle: String, config: Map<String, Any?>, id: String ->
                withClient(handle, config) {
                    val challenge = clientRegistry.lookupChallenge(handle, id)
                    it.sendStepUpOTP(challenge)
                }
            }
            AsyncFunction("submitStepUpOTP") Coroutine {
                handle: String, config: Map<String, Any?>, id: String, code: String ->
                withClient(handle, config) { client ->
                    handleSubmitStepUpOTP(handle, client, id, code)
                }
            }
            AsyncFunction("getActiveStepUp") Coroutine {
                handle: String, config: Map<String, Any?> ->
                withClient(handle, config) { client ->
                    client.activeStepUp?.let {
                        // Mirror into the per-handle cache so a follow-up
                        // `submitStepUpOTP` resolves the bearer challenge
                        // token without the caller threading the handle
                        // through their own state.
                        clientRegistry.cacheChallenge(handle, it)
                        Codec.encodeChallenge(it)
                    }
                }
            }

            // Cached readers ----------------------------------------
            AsyncFunction("getProfile") Coroutine { handle: String, config: Map<String, Any?> ->
                withClient(handle, config) { client ->
                    client.getProfile()?.let { Codec.encodeProfile(it) }
                }
            }
            AsyncFunction("getSessionID") Coroutine { handle: String, config: Map<String, Any?> ->
                withClient(handle, config) { it.getSessionId() }
            }
            AsyncFunction("getAccessToken") Coroutine { handle: String, config: Map<String, Any?> ->
                withClient(handle, config) { it.getAccessToken() }
            }
            // Unix seconds, UTC. Already clock-skew-adjusted at storage
            // time so JS can compare against `Date.now() / 1000`.
            AsyncFunction("getAccessTokenExpiresAt") Coroutine {
                handle: String, config: Map<String, Any?> ->
                withClient(handle, config) { it.getAccessTokenExpiresAt()?.epochSecond }
            }

            OnDestroy {
                // Engine teardown: drop everything so the next load
                // doesn't observe a stale challenge cache.
                clientRegistry.clear()
            }
        }

    /**
     * Resolve the native client for [handle] (constructing it on first
     * use), invoke [block], and translate any throw into a
     * [CodedException] whose code matches the JS-side switch.
     *
     * Resolution + dispatch run on `Dispatchers.IO` (not the modules
     * queue) because client construction hydrates SharedPreferences
     * and probes AndroidKeystore on first use; doing that on the
     * shared module queue would block other modules' async functions.
     */
    private suspend fun <R> withClient(
        handle: String,
        configRaw: Map<*, *>,
        block: suspend (PreludeAuthClient) -> R,
    ): R = withContext(Dispatchers.IO) {
        val context: Context = appContext.reactContext
            ?: throw CodedException("generic", "module detached", null)
        try {
            block(clientRegistry.resolveClient(context, handle, configRaw))
        } catch (e: CancellationException) {
            // Structured-concurrency cancellation must propagate as-is.
            throw e
        } catch (e: Throwable) {
            // Funnel everything through [mapError] so untyped throws
            // (e.g. an NPE from a misconfigured store) still surface
            // to JS with a stable `generic` code instead of leaking
            // an opaque Expo bridge exception.
            throw mapError(e)
        }
    }

    /**
     * Submit an OTP against an in-flight step-up challenge. Resolves
     * the cached challenge by ID, runs the SDK call, and either caches
     * the next step (multi-step flow) or evicts on completion. On
     * `InvalidOTPCode` the challenge stays usable up to the server's
     * bucket limit; any other failure (SDK error or unexpected
     * runtime throw) kills it. Cooperative cancellation is exempt —
     * the challenge stays valid for the next attempt.
     */
    private suspend fun handleSubmitStepUpOTP(
        handle: String,
        client: PreludeAuthClient,
        challengeId: String,
        code: String,
    ): Map<String, Any?>? {
        val challenge = clientRegistry.lookupChallenge(handle, challengeId)
        return try {
            val next = client.submitStepUpOTP(challenge, code)
            when {
                next == null -> {
                    // Flow completed: post-completion refresh has already
                    // minted the scoped access token.
                    clientRegistry.evictChallenge(handle, challenge.challengeId)
                    null
                }
                next.status == PreludeStepUpStatus.BLOCKED -> {
                    // Terminal: a blocked challenge carries no token and
                    // is unsubmittable, so don't cache it; just drop the
                    // prior entry and surface the verdict to JS.
                    clientRegistry.evictChallenge(handle, challenge.challengeId)
                    Codec.encodeChallenge(next)
                }
                else -> {
                    // Insert before evicting so a concurrent reader observing
                    // under the new ID never sees an empty slot during a
                    // multi-step transition.
                    clientRegistry.cacheChallenge(handle, next)
                    if (next.challengeId != challenge.challengeId) {
                        clientRegistry.evictChallenge(handle, challenge.challengeId)
                    }
                    Codec.encodeChallenge(next)
                }
            }
        } catch (e: CancellationException) {
            // Cooperative interrupt — leave the challenge cached so
            // the next attempt can resume against the same handle.
            throw e
        } catch (e: Throwable) {
            // Catch broadly: a non-[PreludeAuthError] throw (e.g. a
            // misconfigured store NPE) must still evict the challenge
            // so a stale entry can't outlive the failure.
            if (e !is PreludeAuthError.InvalidOTPCode) {
                clientRegistry.evictChallenge(handle, challenge.challengeId)
            }
            throw e
        }
    }
}
