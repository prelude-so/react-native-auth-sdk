package so.prelude.reactnative.auth.sdk

import expo.modules.kotlin.exception.CodedException
import org.junit.Test
import so.prelude.android.auth.PreludeAuthError
import java.io.IOException
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ErrorsTest {
    @Test
    fun `every PreludeAuthError arm maps to the matching JS code`() {
        // Codes are part of the JS-side `fromNativeError` REGISTRY
        // contract; if any of these change without a JS update,
        // typed JS errors silently degrade to the generic class.
        val cases: List<Pair<Throwable, String>> = listOf(
            PreludeAuthError.BadRequest("x") to "bad_request",
            PreludeAuthError.Unauthorized("x") to "unauthorized",
            PreludeAuthError.RateLimited("x") to "rate_limited",
            PreludeAuthError.InternalServerError("x") to "internal_server_error",
            PreludeAuthError.MissingChallengeToken("x") to "missing_challenge_token",
            PreludeAuthError.InvalidChallengeToken("x") to "invalid_challenge_token",
            PreludeAuthError.ExpiredChallengeToken("x") to "expired_challenge_token",
            PreludeAuthError.TokenReused("x") to "token_reused",
            PreludeAuthError.InvalidOTPCode("x") to "invalid_otp_code",
            PreludeAuthError.RefreshFailed("x") to "refresh_failed",
            PreludeAuthError.Timeout() to "timeout",
            PreludeAuthError.InvalidConfiguration("x") to "invalid_configuration",
            PreludeAuthError.InvalidPassword("x") to "invalid_password",
            PreludeAuthError.Forbidden("x") to "forbidden",
            PreludeAuthError.InsufficientScope("x") to "insufficient_scope",
            PreludeAuthError.NotFound("x") to "not_found",
            PreludeAuthError.Conflict("x") to "conflict",
            PreludeAuthError.Network(IOException("offline")) to "network",
            PreludeAuthError.CryptoFailure(IllegalStateException("ks")) to "crypto_failure",
            PreludeAuthError.SignalsDispatchFailed(IllegalStateException("dispatch"))
                to "signals_dispatch_failed",
            PreludeAuthError.Generic("teapot", "418") to "teapot",
        )
        for ((error, expectedCode) in cases) {
            assertEquals(expectedCode, mapError(error).code, error::class.simpleName)
        }
    }

    @Test
    fun `decode failures map to bad_request`() {
        // Argument-shape errors reach JS as `BadRequestError` so the
        // consumer can distinguish a wire-format mistake from server
        // 400s; both share the code intentionally.
        val coded = mapError(DecodeException("bad payload"))
        assertEquals("bad_request", coded.code)
        assertEquals("bad payload", coded.message)
    }

    @Test
    fun `untyped throws fall through to a generic code`() {
        val coded = mapError(IllegalStateException("unexpected"))
        assertEquals("generic", coded.code)
        // Don't assert exact message — we just need it to be
        // non-empty so triage isn't flying blind.
        assertTrue(coded.message!!.isNotBlank())
    }

    @Test
    fun `existing CodedExceptions pass through unchanged`() {
        // `withClient` already maps; a re-throw shouldn't double-wrap.
        val original = CodedException("custom_code", "msg", null)
        assertEquals(original, mapError(original))
    }
}

class CauseMessageFallbackTest {
    @Test
    fun `Network error with a meaningful cause carries its message through`() {
        val coded = mapError(PreludeAuthError.Network(IOException("offline")))
        assertEquals("network", coded.code)
        assertEquals("offline", coded.message)
    }

    @Test
    fun `Network error with an empty cause and message lands on a triage-friendly default`() {
        // Bug bait: the prior `error.cause?.message ?: error.message.orEmpty()`
        // surfaced as `NetworkError("")` to JS — indistinguishable from any
        // other failure during ops triage. The default keeps a stable string
        // and tags the cause class so the operator can still triangulate.
        val cause = object : Throwable("") {}
        val coded = mapError(PreludeAuthError.Network(cause))
        assertEquals("network", coded.code)
        assertTrue(coded.message!!.contains("Network error"), coded.message)
    }

    @Test
    fun `CryptoFailure and SignalsDispatchFailed share the same fallback shape`() {
        val cf = mapError(PreludeAuthError.CryptoFailure(IllegalStateException("")))
        val sf = mapError(PreludeAuthError.SignalsDispatchFailed(IllegalStateException("")))
        assertTrue(cf.message!!.contains("Crypto failure"), cf.message)
        assertTrue(sf.message!!.contains("Signals dispatch failed"), sf.message)
    }
}
