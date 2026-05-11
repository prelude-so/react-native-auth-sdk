package so.prelude.reactnative.session.sdk

import expo.modules.kotlin.exception.CodedException
import so.prelude.android.session.PreludeSessionError

/**
 * Local exception type for argument / config decode failures. Kept
 * distinct from [PreludeSessionError] so the error mapper can route
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
        is PreludeSessionError -> mapSessionError(error)
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
private fun causeMessage(error: PreludeSessionError, default: String): String {
    // Prefer the cause's own message; the [PreludeSessionError]
    // wrapper's `message` always carries a `"Network: …"`-shaped
    // prefix that's noise for the JS-side `error.message`. Fall
    // back to the cause's class name (so triage can still see
    // *what* failed) and finally to the static default.
    val cause = error.cause
    cause?.message?.takeIf { it.isNotBlank() }?.let { return it }
    cause?.let { return "$default (${it::class.simpleName})" }
    return default
}

private fun mapSessionError(error: PreludeSessionError): CodedException =
    when (error) {
        is PreludeSessionError.BadRequest ->
            CodedException("bad_request", error.message.orEmpty(), error)
        is PreludeSessionError.Unauthorized ->
            CodedException("unauthorized", error.message.orEmpty(), error)
        is PreludeSessionError.RateLimited ->
            CodedException("rate_limited", error.message.orEmpty(), error)
        is PreludeSessionError.InternalServerError ->
            CodedException("internal_server_error", error.message.orEmpty(), error)
        is PreludeSessionError.MissingChallengeToken ->
            CodedException("missing_challenge_token", error.message.orEmpty(), error)
        is PreludeSessionError.InvalidChallengeToken ->
            CodedException("invalid_challenge_token", error.message.orEmpty(), error)
        is PreludeSessionError.ExpiredChallengeToken ->
            CodedException("expired_challenge_token", error.message.orEmpty(), error)
        is PreludeSessionError.TokenReused ->
            CodedException("token_reused", error.message.orEmpty(), error)
        is PreludeSessionError.InvalidOTPCode ->
            CodedException("invalid_otp_code", error.message.orEmpty(), error)
        is PreludeSessionError.RefreshFailed ->
            CodedException("refresh_failed", error.message.orEmpty(), error)
        is PreludeSessionError.Timeout ->
            CodedException("timeout", "Request timed out", error)
        is PreludeSessionError.InvalidConfiguration ->
            CodedException("invalid_configuration", error.message.orEmpty(), error)
        is PreludeSessionError.InvalidPassword ->
            CodedException("invalid_password", error.message.orEmpty(), error)
        is PreludeSessionError.Forbidden ->
            CodedException("forbidden", error.message.orEmpty(), error)
        is PreludeSessionError.InsufficientScope ->
            CodedException("insufficient_scope", error.message.orEmpty(), error)
        is PreludeSessionError.NotFound ->
            CodedException("not_found", error.message.orEmpty(), error)
        is PreludeSessionError.Conflict ->
            CodedException("conflict", error.message.orEmpty(), error)
        is PreludeSessionError.Network ->
            CodedException("network", causeMessage(error, "Network error"), error)
        is PreludeSessionError.CryptoFailure ->
            CodedException("crypto_failure", causeMessage(error, "Crypto failure"), error)
        is PreludeSessionError.SignalsDispatchFailed ->
            CodedException(
                "signals_dispatch_failed",
                causeMessage(error, "Signals dispatch failed"),
                error,
            )
        is PreludeSessionError.Generic ->
            CodedException(error.code, error.displayMessage, error)
    }
