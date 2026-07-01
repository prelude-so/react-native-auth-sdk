import { PreludeAuthError } from "../types/errors";
import { PreludeIdentifier } from "../types/identifier";

import { AuthActions } from "./actionTypes";
import { useAuthContext, useStoreSlice } from "./context";
import {
  makeScopedPendingSelector,
  selectError,
  selectOtpSentAt,
  selectPendingIdentifier,
} from "./selectors";
import { AsyncAuthAction } from "./store";

export interface UseSignInValue {
  /** Identifier the pending OTP was sent to; null outside `awaitingOtp`. */
  pendingIdentifier: PreludeIdentifier | null;
  /** Epoch ms of the most recent OTP send; null when no OTP is in flight. */
  otpSentAt: number | null;
  pending: boolean;
  error: PreludeAuthError | null;
  startOtpLogin: AuthActions["startOtpLogin"];
  resendOtp: AuthActions["resendOtp"];
  verifyOtp: AuthActions["verifyOtp"];
  cancelOtp: AuthActions["cancelOtp"];
  loginWithPassword: AuthActions["loginWithPassword"];
  migrate: AuthActions["migrate"];
  loginWithOAuth: AuthActions["loginWithOAuth"];
  checkOAuthEmailOtp: AuthActions["checkOAuthEmailOtp"];
}

const SIGN_IN_ACTIONS: ReadonlySet<AsyncAuthAction> = new Set([
  "startOtpLogin",
  "resendOtp",
  "verifyOtp",
  "loginWithPassword",
  "migrate",
  "loginWithOAuth",
  "checkOAuthEmailOtp",
]);
const selectSignInPending = makeScopedPendingSelector(SIGN_IN_ACTIONS);

/** Sign-in flows: OTP (start → verify) and password. */
export function useSignIn(): UseSignInValue {
  const { store, actions } = useAuthContext("useSignIn");
  return {
    pendingIdentifier: useStoreSlice(store, selectPendingIdentifier),
    otpSentAt: useStoreSlice(store, selectOtpSentAt),
    error: useStoreSlice(store, selectError),
    pending: useStoreSlice(store, selectSignInPending),
    startOtpLogin: actions.startOtpLogin,
    resendOtp: actions.resendOtp,
    verifyOtp: actions.verifyOtp,
    cancelOtp: actions.cancelOtp,
    loginWithPassword: actions.loginWithPassword,
    migrate: actions.migrate,
    loginWithOAuth: actions.loginWithOAuth,
    checkOAuthEmailOtp: actions.checkOAuthEmailOtp,
  };
}
