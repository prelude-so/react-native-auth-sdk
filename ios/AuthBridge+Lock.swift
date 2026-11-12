// Idle lock: one `PreludeIdleLock` per client handle, created by
// `idleLockStart`. Native state changes (a seal on foreground, a
// withdrawn lock) reach JS through the `onIdleLockChange` event;
// every call also returns the state it left behind, so JS never
// has to poll.

import Combine
import Foundation

struct IdleLockOptions {
    let threshold: TimeInterval
    let unlockReason: String
    let lockOnStart: Bool
    let maxAttempts: Int

    init(decoding raw: [String: Any]) throws {
        guard let threshold = doubleArg(raw, "thresholdSeconds"), threshold > 0 else {
            throw decodeError("IdleLockOptions.thresholdSeconds must be a positive number")
        }
        self.threshold = threshold
        unlockReason = (raw["unlockReason"] as? String) ?? "Unlock to continue"
        lockOnStart = (raw["lockOnStart"] as? Bool) ?? true
        maxAttempts = intArg(raw, "maxAttempts") ?? PreludeIdleLock.defaultMaxAttempts
    }
}

/// A lock plus the subscription that mirrors its state to JS.
final class IdleLockEntry {
    let lock: PreludeIdleLock
    private var subscription: AnyCancellable?

    init(lock: PreludeIdleLock, onChange: @escaping ([String: Any]) -> Void) {
        self.lock = lock
        // `@Published` emits before the property is set, so the state is
        // built from the emitted values. The first emission is the
        // initial state, which `idleLockStart` returns directly.
        subscription = Publishers.CombineLatest3(lock.$isLocked, lock.$isEnabled, lock.$isBiometricsEnabled)
            .dropFirst()
            .receive(on: DispatchQueue.main)
            .sink { [lock] isLocked, isEnabled, isBiometricsEnabled in
                onChange(IdleLockEntry.encode(
                    isLocked: isLocked,
                    isEnabled: isEnabled,
                    isBiometricsEnabled: isBiometricsEnabled,
                    isBiometricsAvailable: lock.isBiometricsAvailable
                ))
            }
    }

    func stop() {
        subscription = nil
        lock.stop()
    }

    @MainActor
    func snapshot() -> [String: Any] {
        Self.encode(
            isLocked: lock.isLocked,
            isEnabled: lock.isEnabled,
            isBiometricsEnabled: lock.isBiometricsEnabled,
            isBiometricsAvailable: lock.isBiometricsAvailable
        )
    }

    private static func encode(
        isLocked: Bool, isEnabled: Bool, isBiometricsEnabled: Bool, isBiometricsAvailable: Bool
    ) -> [String: Any] {
        [
            "isLocked": isLocked,
            "isEnabled": isEnabled,
            "isBiometricsEnabled": isBiometricsEnabled,
            "isBiometricsAvailable": isBiometricsAvailable,
        ]
    }
}

extension AuthBridge {
    /// Build, start and (by default) lock. The seal is awaited here
    /// rather than left to `PreludeIdleLock(lockOnStart:)`, so JS
    /// restores the session only after the lock is in place.
    ///
    /// A new lock starts unlocked, but the client may still be sealed
    /// by the lock it replaces (`idleLockStop` keeps the seal). The
    /// lock is then re-engaged so JS sees the seal; with no passcode
    /// left to lift it, the seal is dropped instead, since a seal
    /// with no way in strands the session.
    func idleLockStart(
        handle: String, configRaw: [String: Any], options: [String: Any]
    ) async throws -> [String: Any] {
        let client = try await resolveClient(handle: handle, configRaw: configRaw)
        let options = try IdleLockOptions(decoding: options)
        let lock = PreludeIdleLock(
            client: client,
            threshold: options.threshold,
            unlockReason: options.unlockReason,
            lockOnStart: false,
            maxAttempts: options.maxAttempts
        )
        let entry = IdleLockEntry(lock: lock) { [weak self] state in
            self?.onIdleLockChange?(handle, state)
        }
        replaceIdleLock(handle: handle, with: entry)
        lock.start()
        let sealed = await client.isSealed
        let enabled = await MainActor.run { lock.isEnabled }
        if sealed, !enabled {
            await client.unseal()
        } else if options.lockOnStart || sealed {
            await lock.lock()
        }
        return await entry.snapshot()
    }

    func idleLockStop(handle: String) {
        replaceIdleLock(handle: handle, with: nil)
    }

    func idleLockState(handle: String) async throws -> [String: Any] {
        try await idleLock(handle: handle).snapshot()
    }

    func idleLockSetPasscode(handle: String, passcode: String) async throws -> [String: Any] {
        let entry = try idleLock(handle: handle)
        try await MainActor.run { try entry.lock.setPasscode(passcode) }
        return await entry.snapshot()
    }

    func idleLockEnableBiometrics(handle: String) async throws -> [String: Any] {
        let entry = try idleLock(handle: handle)
        try await MainActor.run { try entry.lock.enableBiometrics() }
        return await entry.snapshot()
    }

    func idleLockDisableBiometrics(handle: String) async throws -> [String: Any] {
        let entry = try idleLock(handle: handle)
        await MainActor.run { entry.lock.disableBiometrics() }
        return await entry.snapshot()
    }

    func idleLockDisable(handle: String) async throws -> [String: Any] {
        let entry = try idleLock(handle: handle)
        await MainActor.run { entry.lock.disable() }
        return await entry.snapshot()
    }

    func idleLockLock(handle: String) async throws -> [String: Any] {
        let entry = try idleLock(handle: handle)
        await entry.lock.lock()
        return await entry.snapshot()
    }

    func idleLockUnlock(handle: String, passcode: String) async throws -> [String: Any] {
        let entry = try idleLock(handle: handle)
        try await entry.lock.unlock(passcode: passcode)
        return await entry.snapshot()
    }

    func idleLockUnlockWithBiometrics(handle: String) async throws -> [String: Any] {
        let entry = try idleLock(handle: handle)
        try await entry.lock.unlockWithBiometrics()
        return await entry.snapshot()
    }

    func idleLockClear(handle: String) async throws -> [String: Any] {
        let entry = try idleLock(handle: handle)
        await MainActor.run { entry.lock.clear() }
        return await entry.snapshot()
    }

    private func idleLock(handle: String) throws -> IdleLockEntry {
        guard let entry = currentIdleLock(handle: handle) else {
            throw PreludeAuthError.lockUnavailable("Call idleLock.start() before using the lock")
        }
        return entry
    }
}
