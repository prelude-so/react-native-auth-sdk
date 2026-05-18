package so.prelude.reactnative.auth.sdk

import org.junit.Test
import so.prelude.android.auth.PreludeAuthError
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class ClientConfigTest {
    @Test
    fun `decode resolves the default endpoint to the canonical URL`() {
        val config = ClientConfig.decode(
            mapOf(
                "endpoint" to mapOf("kind" to "default"),
                "timeoutSeconds" to 10.0,
            ),
        )
        assertEquals("https://api.prelude.dev", config.baseUrl.toString())
    }

    @Test
    fun `decode passes a custom endpoint through verbatim`() {
        val config = ClientConfig.decode(
            mapOf(
                "endpoint" to mapOf(
                    "kind" to "custom",
                    "address" to "https://staging.example.dev",
                ),
                "timeoutSeconds" to 5,
            ),
        )
        assertEquals("https://staging.example.dev", config.baseUrl.toString())
    }

    @Test
    fun `decode tolerates Int and Double timeout shapes`() {
        val asDouble = ClientConfig.decode(
            mapOf("endpoint" to mapOf("kind" to "default"), "timeoutSeconds" to 7.5),
        )
        val asInt = ClientConfig.decode(
            mapOf("endpoint" to mapOf("kind" to "default"), "timeoutSeconds" to 7),
        )
        // Compare as ms to keep the assertion readable across Duration shapes.
        assertEquals(7.5 * 1000, asDouble.timeout.inWholeMilliseconds.toDouble(), 1.0)
        assertEquals(7L * 1000, asInt.timeout.inWholeMilliseconds)
    }

    @Test
    fun `decode falls back to a 10s timeout when missing or wrong-typed`() {
        val config = ClientConfig.decode(mapOf("endpoint" to mapOf("kind" to "default")))
        assertEquals(10_000L, config.timeout.inWholeMilliseconds)
    }

    @Test
    fun `decode rejects a missing endpoint`() {
        val e = assertFailsWith<DecodeException> {
            ClientConfig.decode(mapOf("timeoutSeconds" to 1))
        }
        assertTrue(e.message!!.contains("endpoint"))
    }

    @Test
    fun `decode surfaces malformed URLs as InvalidConfiguration`() {
        // Bubbles to JS as `invalid_configuration` rather than the
        // generic decode `bad_request` so consumers can distinguish
        // a missing/wrong-shape arg from a typed-but-invalid value.
        assertFailsWith<PreludeAuthError.InvalidConfiguration> {
            ClientConfig.decode(
                mapOf(
                    "endpoint" to mapOf(
                        "kind" to "custom",
                        "address" to "not a url",
                    ),
                ),
            )
        }
    }

    @Test
    fun `signalsKeyOverride is taken verbatim — JS owns trim+blank collapse`() {
        val raw = ClientConfig.decode(
            mapOf(
                "endpoint" to mapOf("kind" to "default"),
                "signalsKeyOverride" to "sdk_test_key",
            ),
        )
        assertEquals("sdk_test_key", raw.signalsKeyOverride)
    }
}
