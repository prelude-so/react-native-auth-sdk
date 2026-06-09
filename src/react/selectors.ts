import { AsyncAuthAction, AuthState } from "./store";

// Field selectors hoisted to module scope so hooks don't allocate
// a fresh arrow each render. Each must return a primitive or stable
// reference — `useStoreSlice`'s Object.is comparison is what gates
// re-renders, and a fresh object literal would defeat it.

export const selectStage = (s: AuthState) => s.stage;
export const selectUser = (s: AuthState) => s.user;
export const selectError = (s: AuthState) => s.error;
export const selectStepUp = (s: AuthState) => s.stepUp;
export const selectOtpSentAt = (s: AuthState) => s.otpSentAt;
export const selectPendingIdentifier = (s: AuthState) => s.pendingIdentifier;

/**
 * Build a selector returning `true` if any action in `scope` is
 * currently pending. Hooks use this to scope their `pending` boolean
 * to the action group they care about, so an unrelated in-flight
 * call doesn't disable the hook's buttons.
 */
export function makeScopedPendingSelector(
  scope: ReadonlySet<AsyncAuthAction>,
): (s: AuthState) => boolean {
  return (s) => {
    for (const name of scope) if (s.pending.has(name)) return true;
    return false;
  };
}
