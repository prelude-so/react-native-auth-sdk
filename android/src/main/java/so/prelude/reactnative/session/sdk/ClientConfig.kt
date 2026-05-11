package so.prelude.reactnative.session.sdk

import so.prelude.android.session.LoginWithPasswordOptions
import so.prelude.android.session.PreludeIdentifier
import so.prelude.android.session.PreludeIdentifierType
import so.prelude.android.session.PreludeListSessionsOptions
import so.prelude.android.session.PreludeRevokeTarget
import so.prelude.android.session.PreludeSessionError
import so.prelude.android.session.RedactedString
import so.prelude.android.session.StartOTPLoginOptions
import java.net.MalformedURLException
import java.net.URL
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

/**
 * Snapshot of the JS-side `ConfigJson` decoded for the native
 * constructor. Held only for the lifetime of one client construction.
 */
internal data class ClientConfig(
    val baseUrl: URL,
    val hostOverride: String?,
    val timeout: Duration,
    val signalsKeyOverride: String?,
) {
    companion object {
        /** Canonical Prelude API address. */
        private const val DEFAULT_BASE_URL = "https://api.prelude.dev"

        fun decode(raw: Map<*, *>): ClientConfig {
            val endpointRaw = raw["endpoint"] as? Map<*, *>
                ?: throw decodeError("config.endpoint missing or wrong shape")
            val address = when (endpointRaw["kind"] as? String) {
                "default" -> DEFAULT_BASE_URL
                "custom" -> endpointRaw["address"] as? String
                    ?: throw decodeError("Endpoint.custom missing address")
                else -> throw decodeError("Unknown Endpoint kind")
            }
            val baseUrl = try {
                URL(address)
            } catch (_: MalformedURLException) {
                throw PreludeSessionError.InvalidConfiguration(
                    "Endpoint address `$address` is not a valid URL",
                )
            }
            // `timeoutSeconds` arrives as either Double or Int.
            val timeoutSecs = (raw["timeoutSeconds"] as? Number)?.toDouble() ?: 10.0
            // `allowInsecureTLS` is intentionally not threaded through:
            // the native Android client doesn't expose a hook for it.
            // Local-development trust overrides belong in the consuming
            // app's `network_security_config.xml`.
            return ClientConfig(
                baseUrl = baseUrl,
                hostOverride = raw["hostOverride"] as? String,
                timeout = timeoutSecs.seconds,
                // JS is authoritative on trim + blank-collapse for
                // the override, so accept it verbatim here.
                signalsKeyOverride = raw["signalsKeyOverride"] as? String,
            )
        }
    }
}

internal fun decodeStartOTPLoginOptions(raw: Any?): StartOTPLoginOptions {
    val json = raw as? Map<*, *>
        ?: throw decodeError("StartOTPLoginOptions: malformed payload")
    val identifierRaw = json["identifier"] as? Map<*, *>
        ?: throw decodeError("StartOTPLoginOptions: malformed payload")
    val typeWire = identifierRaw["type"] as? String
        ?: throw decodeError("StartOTPLoginOptions: malformed payload")
    val value = identifierRaw["value"] as? String
        ?: throw decodeError("StartOTPLoginOptions: malformed payload")
    val type = PreludeIdentifierType.entries.firstOrNull { it.wireValue == typeWire }
        ?: throw decodeError("Unknown PreludeIdentifierType: $typeWire")
    return StartOTPLoginOptions(
        identifier = PreludeIdentifier(type = type, value = value),
        loginConfigId = json["loginConfigID"] as? String,
    )
}

internal fun decodeLoginWithPasswordOptions(raw: Any?): LoginWithPasswordOptions {
    val json = raw as? Map<*, *>
        ?: throw decodeError("LoginWithPasswordOptions: malformed payload")
    val email = json["emailAddress"] as? String
        ?: throw decodeError("LoginWithPasswordOptions: malformed payload")
    val password = json["password"] as? String
        ?: throw decodeError("LoginWithPasswordOptions: malformed payload")
    // Wrap in [RedactedString] at the bridge boundary so the only
    // named local holding the plaintext is `password` above.
    return LoginWithPasswordOptions(
        identifier = email,
        password = RedactedString(password),
    )
}

/** `null` / missing options fall through to defaults so the server
 *  picks its own pagination — matching JS-side semantics. */
internal fun decodeListSessionsOptions(raw: Any?): PreludeListSessionsOptions {
    val json = raw as? Map<*, *> ?: return PreludeListSessionsOptions()
    return PreludeListSessionsOptions(
        limit = (json["limit"] as? Number)?.toInt(),
        offset = (json["offset"] as? Number)?.toInt(),
    )
}

internal fun decodeRevokeTarget(raw: Any?): PreludeRevokeTarget {
    val json = raw as? Map<*, *>
        ?: throw decodeError("RevokeTarget: malformed payload")
    return when (val kind = json["kind"] as? String) {
        "all" -> PreludeRevokeTarget.All
        "others" -> PreludeRevokeTarget.Others
        "mine" -> PreludeRevokeTarget.Mine
        "session" -> {
            val id = json["sessionID"] as? String
                ?: throw decodeError("RevokeTarget.session: missing sessionID")
            PreludeRevokeTarget.Session(id)
        }
        else -> throw decodeError("Unknown RevokeTarget kind: $kind")
    }
}

/**
 * Optional `Map<String, String>` step-up audit metadata. Non-string
 * keys / values surface as a typed decode error so a JS-side mistake
 * fails loudly instead of being silently dropped on the floor.
 */
internal fun decodeMetadata(raw: Any?): Map<String, String>? {
    if (raw == null) return null
    val map = raw as? Map<*, *>
        ?: throw decodeError("metadata: expected map of String → String")
    return map.entries.associate { (k, v) ->
        val key = k as? String
            ?: throw decodeError("metadata: non-string key")
        val value = v as? String
            ?: throw decodeError("metadata: non-string value for `$key`")
        key to value
    }
}
