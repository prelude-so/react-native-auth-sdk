package so.prelude.reactnative.auth.sdk

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import so.prelude.android.auth.PreludeAuthClient
import so.prelude.android.auth.PreludeAuthError
import so.prelude.android.auth.isSealed
import so.prelude.android.auth.lock.PreludeIdleLock
import so.prelude.android.auth.unseal

internal class IdleLockOptions(
    val thresholdMs: Long,
    val unlockTitle: String,
    val lockOnStart: Boolean,
    val maxAttempts: Int,
) {
    companion object {
        fun decode(raw: Map<*, *>): IdleLockOptions {
            val seconds = (raw["thresholdSeconds"] as? Number)?.toDouble()
            if (seconds == null || seconds <= 0) {
                throw decodeError("IdleLockOptions.thresholdSeconds must be a positive number")
            }
            return IdleLockOptions(
                thresholdMs = (seconds * 1_000).toLong(),
                unlockTitle = raw["unlockReason"] as? String ?: "Unlock to continue",
                lockOnStart = raw["lockOnStart"] as? Boolean ?: true,
                maxAttempts = (raw["maxAttempts"] as? Number)?.toInt() ?: 5,
            )
        }
    }
}

/** A lock plus the collector that mirrors its state to JS. */
internal class IdleLockEntry(
    val lock: PreludeIdleLock,
    onChange: (Map<String, Any?>) -> Unit,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    init {
        // The first combined value is the initial state, which
        // `IdleLockRegistry.start` returns directly.
        scope.launch {
            combine(lock.isLocked, lock.isEnabled, lock.isBiometricsEnabled, ::encode)
                .drop(1)
                .collect(onChange)
        }
    }

    fun snapshot(): Map<String, Any?> =
        encode(lock.isLocked.value, lock.isEnabled.value, lock.isBiometricsEnabled.value)

    fun stop() {
        scope.cancel()
        lock.stop()
    }

    private fun encode(
        isLocked: Boolean,
        isEnabled: Boolean,
        isBiometricsEnabled: Boolean,
    ): Map<String, Any?> =
        mapOf(
            "isLocked" to isLocked,
            "isEnabled" to isEnabled,
            "isBiometricsEnabled" to isBiometricsEnabled,
            "isBiometricsAvailable" to lock.isBiometricsAvailable,
        )
}

/**
 * One [PreludeIdleLock] per client handle, created by [start] and
 * dropped with the handle. [onChange] receives the handle and the
 * lock's new state whenever it changes natively; [isLive] says
 * whether the handle still has a client, so a start that races
 * `dispose` installs nothing.
 */
internal class IdleLockRegistry(
    private val onChange: (handle: String, state: Map<String, Any?>) -> Unit,
    private val isLive: (handle: String) -> Boolean,
) {
    private val locks = mutableMapOf<String, IdleLockEntry>()

    /**
     * Build, start and (by default) lock. The seal is awaited here
     * rather than left to `PreludeIdleLock(lockOnStart)`, so JS
     * restores the session only after the lock is in place.
     *
     * A new lock starts unlocked, but the client may still be sealed
     * by the lock it replaces ([stop] keeps the seal). The lock is
     * then re-engaged so JS sees the seal; with no passcode left to
     * lift it, the seal is dropped instead, since a seal with no way
     * in strands the session.
     */
    suspend fun start(
        handle: String,
        client: PreludeAuthClient,
        raw: Map<*, *>,
    ): Map<String, Any?> {
        val options = IdleLockOptions.decode(raw)
        val lock =
            PreludeIdleLock(
                client = client,
                thresholdMs = options.thresholdMs,
                unlockTitle = options.unlockTitle,
                lockOnStart = false,
                maxAttempts = options.maxAttempts,
            )
        val entry = IdleLockEntry(lock) { onChange(handle, it) }
        if (!replace(handle, entry)) {
            throw PreludeAuthError.LockUnavailable("The client was disposed")
        }
        lock.start()
        val sealed = client.isSealed
        if (sealed && !lock.isEnabled.value) {
            client.unseal()
        } else if (options.lockOnStart || sealed) {
            lock.lock()
        }
        return entry.snapshot()
    }

    fun stop(handle: String) {
        replace(handle, null)
    }

    fun get(handle: String): IdleLockEntry =
        synchronized(locks) { locks[handle] }
            ?: throw PreludeAuthError.LockUnavailable("Call idleLock.start() before using the lock")

    fun clear() =
        synchronized(locks) {
            locks.values.forEach { it.stop() }
            locks.clear()
        }

    /** Stops the lock it replaces. Returns `false`, with [entry] stopped, for a dead handle. */
    private fun replace(
        handle: String,
        entry: IdleLockEntry?,
    ): Boolean =
        synchronized(locks) {
            locks.remove(handle)?.stop()
            if (entry == null) return true
            if (!isLive(handle)) {
                entry.stop()
                return false
            }
            locks[handle] = entry
            true
        }
}
