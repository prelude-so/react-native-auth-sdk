import { PreludeAuthError } from "../types/errors";
import { StepUpChallenge } from "../types/stepUp";

import { AuthActions } from "./actionTypes";
import { useAuthContext, useStoreSlice } from "./context";
import {
  makeScopedPendingSelector,
  selectError,
  selectStepUp,
} from "./selectors";
import { AsyncAuthAction } from "./store";

export interface UseStepUpValue {
  /** Active challenge, or null when no step-up is in progress. */
  challenge: StepUpChallenge | null;
  pending: boolean;
  error: PreludeAuthError | null;
  requestStepUp: AuthActions["requestStepUp"];
  sendStepUpOtp: AuthActions["sendStepUpOtp"];
  submitStepUpOtp: AuthActions["submitStepUpOtp"];
  cancelStepUp: AuthActions["cancelStepUp"];
}

const STEP_UP_ACTIONS: ReadonlySet<AsyncAuthAction> = new Set([
  "requestStepUp",
  "sendStepUpOtp",
  "submitStepUpOtp",
]);
const selectStepUpPending = makeScopedPendingSelector(STEP_UP_ACTIONS);

/**
 * Step-up (re-auth / privilege escalation) flow. Orthogonal to
 * sign-in: a signed-in user can have an active challenge.
 */
export function useStepUp(): UseStepUpValue {
  const { store, actions } = useAuthContext("useStepUp");
  return {
    challenge: useStoreSlice(store, selectStepUp),
    error: useStoreSlice(store, selectError),
    pending: useStoreSlice(store, selectStepUpPending),
    requestStepUp: actions.requestStepUp,
    sendStepUpOtp: actions.sendStepUpOtp,
    submitStepUpOtp: actions.submitStepUpOtp,
    cancelStepUp: actions.cancelStepUp,
  };
}
