package so.prelude.reactnative.auth.sdk

import org.junit.Test
import so.prelude.android.auth.PreludeIdentifierType
import so.prelude.android.auth.PreludeRevokeTarget
import kotlin.test.assertEquals
import kotlin.test.assertFails
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DecodeStartOTPLoginOptionsTest {
    @Test
    fun `decodes a phone-number identifier`() {
        val opts = decodeStartOTPLoginOptions(
            mapOf(
                "identifier" to mapOf("type" to "phone_number", "value" to "+15551234567"),
            ),
        )
        assertEquals(PreludeIdentifierType.PHONE_NUMBER, opts.identifier.type)
        assertEquals("+15551234567", opts.identifier.value)
        assertNull(opts.loginConfigId)
    }

    @Test
    fun `forwards loginConfigID when present`() {
        val opts = decodeStartOTPLoginOptions(
            mapOf(
                "identifier" to mapOf("type" to "email_address", "value" to "a@b.test"),
                "loginConfigID" to "lc_42",
            ),
        )
        assertEquals("lc_42", opts.loginConfigId)
    }

    @Test
    fun `rejects unknown identifier types loudly`() {
        val e = assertFailsWith<DecodeException> {
            decodeStartOTPLoginOptions(
                mapOf("identifier" to mapOf("type" to "carrier_pigeon", "value" to "v")),
            )
        }
        assertTrue(e.message!!.contains("PreludeIdentifierType"))
    }
}

class DecodeListSessionsOptionsTest {
    @Test
    fun `null payload returns server-default options`() {
        val opts = decodeListSessionsOptions(null)
        assertNull(opts.limit)
        assertNull(opts.offset)
    }

    @Test
    fun `tolerates Int and Double pagination shapes`() {
        // Bug bait: `as? Int` on a Double from the bridge returns
        // null and silently drops paging. The Number-cast guards
        // against that — assert both shapes round-trip.
        val asDouble = decodeListSessionsOptions(mapOf("limit" to 10.0, "offset" to 20.0))
        val asInt = decodeListSessionsOptions(mapOf("limit" to 10, "offset" to 20))
        assertEquals(10, asDouble.limit)
        assertEquals(20, asDouble.offset)
        assertEquals(10, asInt.limit)
        assertEquals(20, asInt.offset)
    }

    @Test
    fun `negative paging is rejected by the SDK constructor`() {
        // `PreludeListSessionsOptions.init` enforces `>= 0`. The bridge
        // doesn't double-validate; we rely on the SDK to fail-fast.
        assertFails { decodeListSessionsOptions(mapOf("limit" to -1)) }
    }
}

class DecodeRevokeTargetTest {
    @Test
    fun `decodes the four kinds`() {
        assertEquals(PreludeRevokeTarget.All, decodeRevokeTarget(mapOf("kind" to "all")))
        assertEquals(PreludeRevokeTarget.Others, decodeRevokeTarget(mapOf("kind" to "others")))
        assertEquals(PreludeRevokeTarget.Mine, decodeRevokeTarget(mapOf("kind" to "mine")))
        assertEquals(
            PreludeRevokeTarget.Session("s_42"),
            decodeRevokeTarget(mapOf("kind" to "session", "sessionID" to "s_42")),
        )
    }

    @Test
    fun `session kind requires a sessionID`() {
        val e = assertFailsWith<DecodeException> {
            decodeRevokeTarget(mapOf("kind" to "session"))
        }
        assertTrue(e.message!!.contains("sessionID"))
    }

    @Test
    fun `unknown kinds fail loudly`() {
        assertFailsWith<DecodeException> {
            decodeRevokeTarget(mapOf("kind" to "nuke_from_orbit"))
        }
    }
}

class DecodeMetadataTest {
    @Test
    fun `null and missing collapse to null`() {
        assertNull(decodeMetadata(null))
    }

    @Test
    fun `well-formed map round-trips`() {
        val m = decodeMetadata(mapOf("reason" to "settings", "src" to "ios"))
        assertEquals(mapOf("reason" to "settings", "src" to "ios"), m)
    }

    @Test
    fun `non-string values fail loudly with the offending key`() {
        // Silent drop here would let a JS bug ship an empty audit
        // payload to the server — surface it as `bad_request` so the
        // caller sees the typo at integration time.
        val e = assertFailsWith<DecodeException> {
            decodeMetadata(mapOf("retry_count" to 3))
        }
        assertTrue(e.message!!.contains("retry_count"))
    }
}

class DecodeMigrateOptionsTest {
    @Test
    fun `decodes a token`() {
        val opts = decodeMigrateOptions(mapOf("token" to "legacy_xyz"))
        assertEquals("legacy_xyz", opts.token.value)
    }

    @Test
    fun `missing token fails loudly`() {
        assertFailsWith<DecodeException> { decodeMigrateOptions(emptyMap<String, Any?>()) }
    }
}
