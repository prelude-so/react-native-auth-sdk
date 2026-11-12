import { EventSubscription } from "expo-modules-core";

import native from "./native";
import { ConfigJson } from "./types/config";
import { fromNativeError } from "./types/errors";
import {
  IDLE_LOCK_INITIAL_STATE,
  IdleLockOptions,
  IdleLockState,
  IdleLockStateJson,
  idleLockStateFromJson,
} from "./types/idleLock";

/**
 * Locks the session after time in the background; the user unlocks
 * it offline with an app passcode or biometrics. Obtain one from
 * `client.idleLock(options)`, call `start()` once, and drive the
 * lock screen from `getState().isLocked` (or `useIdleLock()`).
 *
 * The native side owns the lock. This class mirrors its state: every
 * call applies the state it resolves with, and changes the native
 * side makes on its own (a seal on foreground) arrive as events.
 */
export class IdleLock {
  private state: IdleLockState = IDLE_LOCK_INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private subscription: EventSubscription | null = null;
  private started = false;

  constructor(
    private readonly handle: string,
    private readonly config: ConfigJson,
    private readonly options: IdleLockOptions,
  ) {}

  getState(): IdleLockState {
    return this.state;
  }

  /** Notifies on every state change. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Start observing the app lifecycle and, with `lockOnStart`, lock
   * now. Resolves once the lock is in place, so a session restore
   * that follows sees the sealed client.
   */
  async start(): Promise<void> {
    this.subscription ??= native.addListener("onIdleLockChange", (event) => {
      if (event.handle === this.handle) this.apply(event);
    });
    this.started = true;
    await this.call(() =>
      native.idleLockStart(this.handle, this.config, this.options),
    );
  }

  /** Stop observing. The native seal, if any, stays in place. */
  async stop(): Promise<void> {
    this.subscription?.remove();
    this.subscription = null;
    if (!this.started) return;
    this.started = false;
    try {
      await native.idleLockStop(this.handle);
    } catch (e) {
      throw fromNativeError(e);
    }
  }

  /** Set or replace the passcode (4+ characters). Drops the biometric shortcut. */
  setPasscode(passcode: string): Promise<void> {
    return this.call(() => native.idleLockSetPasscode(this.handle, passcode));
  }

  /** Arm biometrics as a shortcut past the passcode. Needs a passcode first. */
  enableBiometrics(): Promise<void> {
    return this.call(() => native.idleLockEnableBiometrics(this.handle));
  }

  disableBiometrics(): Promise<void> {
    return this.call(() => native.idleLockDisableBiometrics(this.handle));
  }

  /** Forget the passcode and the shortcut, and drop the lock. Call on sign-out. */
  disable(): Promise<void> {
    return this.call(() => native.idleLockDisable(this.handle));
  }

  /** Lock now. Does nothing when signed out or when no passcode is set. */
  lock(): Promise<void> {
    return this.call(() => native.idleLockLock(this.handle));
  }

  /**
   * Throws `InvalidPasscodeError` while attempts remain and
   * `LockedOutError` once they are spent; sign the user out on the
   * latter.
   */
  unlock(passcode: string): Promise<void> {
    return this.call(() => native.idleLockUnlock(this.handle, passcode));
  }

  /** Throws `LockUnavailableError` when no shortcut is armed or the match fails. */
  unlockWithBiometrics(): Promise<void> {
    return this.call(() => native.idleLockUnlockWithBiometrics(this.handle));
  }

  /** Drop the lock without authenticating. For use after signing out. */
  clear(): Promise<void> {
    return this.call(() => native.idleLockClear(this.handle));
  }

  private async call(fn: () => Promise<IdleLockStateJson>): Promise<void> {
    let json: IdleLockStateJson;
    try {
      json = await fn();
    } catch (e) {
      throw fromNativeError(e);
    }
    this.apply(json);
  }

  private apply(json: IdleLockStateJson) {
    const next = idleLockStateFromJson(json);
    const prev = this.state;
    if (
      prev.isLocked === next.isLocked &&
      prev.isEnabled === next.isEnabled &&
      prev.isBiometricsEnabled === next.isBiometricsEnabled &&
      prev.isBiometricsAvailable === next.isBiometricsAvailable
    ) {
      return;
    }
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
}
