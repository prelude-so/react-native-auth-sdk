import { IdleLock } from "../idleLock";
import { PreludeAuthError } from "../types/errors";
import { IDLE_LOCK_INITIAL_STATE, IdleLockState } from "../types/idleLock";
import { useSyncExternalStore } from "react";

import { AuthActions } from "./actionTypes";
import { useAuthContext, useStoreSlice } from "./context";
import { makeScopedPendingSelector, selectError } from "./selectors";
import { AsyncAuthAction } from "./store";

export interface UseIdleLockValue extends IdleLockState {
  /** Whether the provider was given `idleLock` options. */
  isConfigured: boolean;
  pending: boolean;
  error: PreludeAuthError | null;
  unlock: AuthActions["unlock"];
  unlockWithBiometrics: AuthActions["unlockWithBiometrics"];
  lock: AuthActions["lock"];
  setPasscode: AuthActions["setPasscode"];
  enableBiometrics: AuthActions["enableBiometrics"];
  disableBiometrics: AuthActions["disableBiometrics"];
  disable: AuthActions["disableIdleLock"];
}

const LOCK_ACTIONS: ReadonlySet<AsyncAuthAction> = new Set([
  "unlock",
  "lock",
  "setPasscode",
  "enableBiometrics",
  "disableBiometrics",
  "disableIdleLock",
]);
const selectLockPending = makeScopedPendingSelector(LOCK_ACTIONS);

const noop = () => () => {};
const initial = () => IDLE_LOCK_INITIAL_STATE;

function useLockState(lock: IdleLock | null): IdleLockState {
  return useSyncExternalStore(
    lock ? (onChange) => lock.subscribe(onChange) : noop,
    lock ? () => lock.getState() : initial,
    lock ? () => lock.getState() : initial,
  );
}

/**
 * Idle lock state and actions. `isLocked` mirrors `stage ===
 * "locked"`; `isEnabled` is false until a passcode is set, which is
 * when to show the set-up screen.
 */
export function useIdleLock(): UseIdleLockValue {
  const { store, actions, idleLock } = useAuthContext("useIdleLock");
  const state = useLockState(idleLock);
  return {
    ...state,
    isConfigured: idleLock !== null,
    error: useStoreSlice(store, selectError),
    pending: useStoreSlice(store, selectLockPending),
    unlock: actions.unlock,
    unlockWithBiometrics: actions.unlockWithBiometrics,
    lock: actions.lock,
    setPasscode: actions.setPasscode,
    enableBiometrics: actions.enableBiometrics,
    disableBiometrics: actions.disableBiometrics,
    disable: actions.disableIdleLock,
  };
}
