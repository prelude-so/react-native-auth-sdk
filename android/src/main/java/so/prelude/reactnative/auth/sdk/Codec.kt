package so.prelude.reactnative.auth.sdk

import so.prelude.android.auth.PreludeJSONValue
import so.prelude.android.auth.PreludeListSessionsResponse
import so.prelude.android.auth.PreludePasswordCompliancy
import so.prelude.android.auth.PreludeProfile
import so.prelude.android.auth.PreludeSessionView
import so.prelude.android.auth.PreludeStepUpChallenge
import so.prelude.android.auth.PreludeUser
import java.time.format.DateTimeFormatter

/** Encodes native value types into JS-friendly maps. */
internal object Codec {
    fun encodeUser(user: PreludeUser): Map<String, Any?> =
        mapOf(
            "accessToken" to user.accessToken,
            "profile" to encodeProfile(user.profile),
        )

    fun encodeProfile(profile: PreludeProfile): Map<String, Any?> {
        val extras = mutableMapOf<String, Any?>()
        for ((k, v) in profile.extras) extras[k] = encodeJson(v)
        return mapOf(
            "userID" to profile.userId,
            "sessionID" to profile.sessionId,
            "extras" to extras,
        )
    }

    fun encodeCompliancy(c: PreludePasswordCompliancy): Map<String, Any?> =
        mapOf(
            "minLength" to c.minLength,
            "maxLength" to c.maxLength,
            "uppercase" to c.uppercase,
            "lowercase" to c.lowercase,
            "numbers" to c.numbers,
            "symbols" to c.symbols,
        )

    fun encodeSessionView(v: PreludeSessionView): Map<String, Any?> =
        mapOf(
            "id" to v.id,
            "deviceModel" to v.deviceModel,
            "deviceType" to v.deviceType.wireValue,
            "osVersion" to v.osVersion,
            "countryCode" to v.countryCode,
            // ISO 8601 UTC strings — JS parses these with `new Date(...)`.
            "createdAt" to DateTimeFormatter.ISO_INSTANT.format(v.createdAt),
            "lastSeenAt" to DateTimeFormatter.ISO_INSTANT.format(v.lastSeenAt),
            "expiresAt" to DateTimeFormatter.ISO_INSTANT.format(v.expiresAt),
        )

    fun encodeListSessions(r: PreludeListSessionsResponse): Map<String, Any?> =
        mapOf(
            "sessions" to r.sessions.map { encodeSessionView(it) },
            "total" to r.total,
            "limit" to r.limit,
            "offset" to r.offset,
        )

    /** Encode the public-surface fields only. The challenge JWT and
     *  expiry stay in the registry's per-handle cache so the bearer
     *  credential never crosses the bridge. */
    fun encodeChallenge(c: PreludeStepUpChallenge): Map<String, Any?> =
        mapOf(
            "status" to c.status.wireValue,
            "challengeID" to c.challengeId,
            "currentStep" to c.currentStep,
            "requestedScope" to c.requestedScope,
        )

    /**
     * Encode a [PreludeJSONValue] as a plain JS-shaped value — the
     * JS-side `extras: Record<string, unknown>` contract has no
     * tagged-union decoder. JS's `Number` handles int/double for us.
     *
     * Caveat: 64-bit integer claims above `Number.MAX_SAFE_INTEGER`
     * (2^53) lose precision on the way through the bridge. No real-
     * world session claim hits that range; document if it ever does.
     */
    fun encodeJson(value: PreludeJSONValue): Any? =
        when (value) {
            is PreludeJSONValue.Str -> value.value
            is PreludeJSONValue.Int -> value.value
            is PreludeJSONValue.Double -> value.value
            is PreludeJSONValue.Bool -> value.value
            is PreludeJSONValue.Array -> value.value.map { encodeJson(it) }
            is PreludeJSONValue.Object -> {
                val bridged = mutableMapOf<String, Any?>()
                for ((k, v) in value.value) bridged[k] = encodeJson(v)
                bridged
            }
            PreludeJSONValue.Null -> null
        }
}
