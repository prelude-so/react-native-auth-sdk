package so.prelude.reactnative.auth.sdk

import org.junit.Test
import so.prelude.android.auth.PreludeSessionDeviceType
import so.prelude.android.auth.PreludeJSONValue
import so.prelude.android.auth.PreludeListSessionsResponse
import so.prelude.android.auth.PreludePasswordCompliancy
import so.prelude.android.auth.PreludeProfile
import so.prelude.android.auth.PreludeSessionView
import so.prelude.android.auth.PreludeUser
import java.time.Instant
import kotlin.test.assertEquals
import kotlin.test.assertNull

class CodecTest {
    @Test
    fun `encodeUser carries the access token and a nested profile`() {
        val out = Codec.encodeUser(
            PreludeUser(
                accessToken = "at_xyz",
                profile = PreludeProfile(userId = "u_1", sessionId = "s_1"),
            ),
        )
        assertEquals("at_xyz", out["accessToken"])
        @Suppress("UNCHECKED_CAST")
        val profile = out["profile"] as Map<String, Any?>
        assertEquals("u_1", profile["userID"])
        assertEquals("s_1", profile["sessionID"])
    }

    @Test
    fun `encodeProfile preserves null userID and sessionID through the bridge`() {
        // Sent as Kotlin `null`; the Expo bridge surfaces that as
        // JS `null`. The JS-side decoder folds null into `undefined`,
        // so this is the canonical absent-claim wire shape.
        val out = Codec.encodeProfile(PreludeProfile(userId = null, sessionId = null))
        assertNull(out["userID"])
        assertNull(out["sessionID"])
    }

    @Test
    fun `encodeProfile flattens PreludeJSONValue extras to native JS shapes`() {
        val out = Codec.encodeProfile(
            PreludeProfile(
                extras = mapOf(
                    "iat" to PreludeJSONValue.Int(1_700_000_000L),
                    "amr" to PreludeJSONValue.Array(
                        listOf(PreludeJSONValue.Str("pwd"), PreludeJSONValue.Str("otp")),
                    ),
                    "ext" to PreludeJSONValue.Object(
                        mapOf("plan" to PreludeJSONValue.Str("pro")),
                    ),
                    "active" to PreludeJSONValue.Bool(true),
                    "score" to PreludeJSONValue.Double(0.42),
                    "ssn" to PreludeJSONValue.Null,
                ),
            ),
        )
        @Suppress("UNCHECKED_CAST")
        val extras = out["extras"] as Map<String, Any?>
        assertEquals(1_700_000_000L, extras["iat"])
        assertEquals(listOf("pwd", "otp"), extras["amr"])
        assertEquals(mapOf("plan" to "pro"), extras["ext"])
        assertEquals(true, extras["active"])
        assertEquals(0.42, extras["score"])
        // `Null` -> Kotlin null -> JS null. The container key stays
        // present so the JS-side decoder can distinguish "claim
        // present and explicitly null" from "claim absent".
        assertEquals(true, extras.containsKey("ssn"))
        assertNull(extras["ssn"])
    }

    @Test
    fun `encodeCompliancy round-trips the rule set verbatim`() {
        val out = Codec.encodeCompliancy(
            PreludePasswordCompliancy(
                minLength = 8, maxLength = 0, uppercase = 1,
                lowercase = 1, numbers = 1, symbols = 0,
            ),
        )
        assertEquals(8, out["minLength"])
        assertEquals(0, out["maxLength"])
        assertEquals(1, out["uppercase"])
        assertEquals(1, out["lowercase"])
        assertEquals(1, out["numbers"])
        assertEquals(0, out["symbols"])
    }

    @Test
    fun `encodeSessionView formats Instants as ISO-8601 UTC`() {
        val view = PreludeSessionView(
            id = "s_1",
            deviceModel = "Pixel 8",
            deviceType = PreludeSessionDeviceType.MOBILE,
            osVersion = "Android 14",
            countryCode = "US",
            createdAt = Instant.parse("2026-01-01T00:00:00Z"),
            lastSeenAt = Instant.parse("2026-01-02T03:04:05Z"),
            expiresAt = Instant.parse("2026-02-01T00:00:00Z"),
        )
        val out = Codec.encodeSessionView(view)
        // The JS side parses with `new Date(...)` so anything other
        // than ISO-8601-UTC silently parses to NaN; pin the format.
        assertEquals("2026-01-01T00:00:00Z", out["createdAt"])
        assertEquals("2026-01-02T03:04:05Z", out["lastSeenAt"])
        assertEquals("2026-02-01T00:00:00Z", out["expiresAt"])
        assertEquals("mobile", out["deviceType"])
    }

    @Test
    fun `encodeListSessions wraps the page envelope`() {
        val out = Codec.encodeListSessions(
            PreludeListSessionsResponse(
                sessions = emptyList(), total = 0, limit = 20, offset = 0,
            ),
        )
        assertEquals(emptyList<Any?>(), out["sessions"])
        assertEquals(0, out["total"])
        assertEquals(20, out["limit"])
        assertEquals(0, out["offset"])
    }
}
