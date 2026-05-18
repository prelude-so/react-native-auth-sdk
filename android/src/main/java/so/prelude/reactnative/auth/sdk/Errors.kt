package so.prelude.reactnative.auth.sdk

import expo.modules.kotlin.exception.CodedException
import so.prelude.android.auth.PreludeAuthError

/**
 * Local exception type for argument / config decode failures. Kept
 * distinct from [PreludeAuthError] so the error mapper can route
 * decode failures to a stable `bad_request` code without reaching
 * for the SDK's error hierarchy.
 */
internal class DecodeException(message: String) : Exception(message)

internal fun decodeError(message: String): Throwable = DecodeException(message)

/**
 * Translate a thrown error into a [CodedException] whose code
 * matches the JS-side `fromNativeError` switch arm-for-arm so the
 * typed JS errors hydrate correctly.
 */
internal fun mapError(error: Throwable): CodedException =
    when (error) {
        is CodedException -> error
        is PreludeAuthError -> mapAuthError(error)
        is DecodeException -> CodedException("bad_request", error.message ?: "bad_request", error)
        else -> CodedException("generic", error.toString(), error)
    }

/**
 * Pick the most diagnostic non-blank message available, falling
 * back to the cause's class name when both messages are empty.
 *
 * An empty `message` string reaches JS as `NetworkError("")` —
 * indistinguishable from any other failure during ops triage.
 * `default` ("Network error", "Crypto failure", …) is the floor.
 */
private fun causeMessage(error: PreludeAuthError, default: String): String {
    // Prefer the cause's own message; the [PreludeAuthError]
    // wrapper's `message` always carries a `"Network: …"`-shaped
    // prefix that's noise for the JS-side `error.message`. Fall
    // back to the cause's class name (so triage can still see
    // *what* failed) and finally to the static default.
    val cause = error.cause
    cause?.message?.takeIf { it.isNotBlank() }?.let { return it }
    cause?.let { return "$default (${it::class.simpleName})" }
    return default
}

private fun mapAuthError(error: PreludeAuthError): CodedException =
    when (error) {
        is PreludeAuthError.BadRequest ->
            CodedException("bad_request", error.message.orEmpty(), error)
        is PreludeAuthError.Unauthorized ->
            CodedException("unauthorized", error.message.orEmpty(), error)
        is PreludeAuthError.RateLimited ->
            CodedException("rate_limited", error.message.orEmpty(), error)
        is PreludeAuthError.InternalServerError ->
            CodedException("internal_server_error", error.message.orEmpty(), error)
        is PreludeAuthError.MissingChallengeToken ->
            CodedException("missing_challenge_token", error.message.orEmpty(), error)
        is PreludeAuthError.InvalidChallengeToken ->
            CodedException("invalid_challenge_token", error.message.orEmpty(), error)
        is PreludeAuthError.ExpiredChallengeToken ->
            CodedException("expired_challenge_token", error.message.orEmpty(), error)
        is PreludeAuthError.TokenReused ->
            CodedException("token_reused", error.message.orEmpty(), error)
        is PreludeAuthError.InvalidOTPCode ->
            CodedException("invalid_otp_code", error.message.orEmpty(), error)
        is PreludeAuthError.RefreshFailed ->
            CodedException("refresh_failed", error.message.orEmpty(), error)
        is PreludeAuthError.Timeout ->
            CodedException("timeout", "Request timed out", error)
        is PreludeAuthError.InvalidConfiguration ->
            CodedException("invalid_configuration", error.message.orEmpty(), error)
        is PreludeAuthError.InvalidPassword ->
            CodedException("invalid_password", error.message.orEmpty(), error)
        is PreludeAuthError.Forbidden ->
            CodedException("forbidden", error.message.orEmpty(), error)
        is PreludeAuthError.InsufficientScope ->
            CodedException("insufficient_scope", error.message.orEmpty(), error)
        is PreludeAuthError.NotFound ->
            CodedException("not_found", error.message.orEmpty(), error)
        is PreludeAuthError.Conflict ->
            CodedException("conflict", error.message.orEmpty(), error)
        is PreludeAuthError.Network ->
            CodedException("network", causeMessage(error, "Network error"), error)
        is PreludeAuthError.CryptoFailure ->
            CodedException("crypto_failure", causeMessage(error, "Crypto failure"), error)
        is PreludeAuthError.SignalsDispatchFailed ->
            CodedException(
                "signals_dispatch_failed",
                causeMessage(error, "Signals dispatch failed"),
                error,
            )
        is PreludeAuthError.Generic ->
            CodedException(error.code, error.displayMessage, error)
    }
