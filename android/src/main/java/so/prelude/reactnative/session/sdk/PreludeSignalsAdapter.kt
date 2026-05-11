package so.prelude.reactnative.session.sdk

import android.content.Context
import so.prelude.android.sdk.Configuration
import so.prelude.android.sdk.Prelude
import so.prelude.android.session.signals.PreludeSignalsDispatcher

/**
 * Forwards [PreludeSignalsDispatcher.dispatch] calls into the
 * native `so.prelude.android:sdk` signals subsystem.
 *
 * `null` / blank `sdkKey` is a permissive no-op — the same shape
 * the iOS adapter uses. The session client treats `null` as
 * "skip signals on this call", so the adapter stays in the chain
 * regardless of whether a key was configured.
 */
internal class PreludeSignalsAdapter(
    context: Context,
    sdkKey: String?,
    timeoutMs: Long = 5_000L,
) : PreludeSignalsDispatcher {
    private val prelude: Prelude? =
        sdkKey
            ?.takeIf { it.isNotBlank() }
            ?.let {
                Prelude(
                    Configuration(
                        context = context.applicationContext,
                        sdkKey = it,
                        requestTimeout = timeoutMs,
                    ),
                )
            }

    override suspend fun dispatch(): String? {
        val client = prelude ?: return null
        // The suspend variant returns `Result<String>`. Throw on
        // failure — the session SDK's `dispatchSignalsIfConfigured`
        // wraps it as `PreludeSessionError.SignalsDispatchFailed`,
        // which `mapError` then surfaces to JS as
        // `signals_dispatch_failed`. Cooperative cancellation
        // propagates untouched.
        return client.dispatchSignals().getOrThrow()
    }
}
