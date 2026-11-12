export interface IdleLockOptions {
  /** Seconds in the background before the session locks. */
  thresholdSeconds: number;
  /** Shown on the system biometric prompt. Default "Unlock to continue". */
  unlockReason?: string;
  /**
   * Lock as soon as `start()` runs, so relaunching the app is not a
   * way past the lock. Default `true`.
   */
  lockOnStart?: boolean;
  /** Wrong passcodes allowed before `unlock` throws `LockedOutError`. Default 5. */
  maxAttempts?: number;
}

export interface IdleLockState {
  /** The session is sealed; protected calls throw `SessionLockedError`. */
  isLocked: boolean;
  /** A passcode is set. The lock does nothing until one is. */
  isEnabled: boolean;
  /** The biometric shortcut is armed. */
  isBiometricsEnabled: boolean;
  /** The device can enroll biometrics. */
  isBiometricsAvailable: boolean;
}

export type IdleLockOptionsJson = IdleLockOptions;
export type IdleLockStateJson = IdleLockState;

export const IDLE_LOCK_INITIAL_STATE: IdleLockState = {
  isLocked: false,
  isEnabled: false,
  isBiometricsEnabled: false,
  isBiometricsAvailable: false,
};

export function idleLockStateFromJson(json: IdleLockStateJson): IdleLockState {
  return {
    isLocked: json.isLocked === true,
    isEnabled: json.isEnabled === true,
    isBiometricsEnabled: json.isBiometricsEnabled === true,
    isBiometricsAvailable: json.isBiometricsAvailable === true,
  };
}
