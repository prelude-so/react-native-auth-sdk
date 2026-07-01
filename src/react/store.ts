import { PreludeAuthError } from "../types/errors";
import { PreludeIdentifier } from "../types/identifier";
import { StepUpChallenge } from "../types/stepUp";
import { PreludeUser } from "../types/user";

/**
 * High-level auth stage for UI routing. Sub-flows (e.g. password
 * change, MFA reauth) compose on top of these — they don't get
 * their own top-level stage.
 */
export type AuthStage =
  | "initializing"
  | "signedOut"
  | "awaitingOtp"
  | "signedIn";

export interface AuthState {
  stage: AuthStage;
  user: PreludeUser | null;
  /** Identifier the pending OTP was sent to; null outside `awaitingOtp`. */
  pendingIdentifier: PreludeIdentifier | null;
  /** Epoch ms of the most recent OTP send; null when no OTP is in flight. */
  otpSentAt: number | null;
  /** Active step-up challenge, if any. Orthogonal to `stage`. */
  stepUp: StepUpChallenge | null;
  /** Last action error, cleared at the start of the next action. */
  error: PreludeAuthError | null;
  /**
   * Names of every async action currently in flight. Empty when the
   * SDK is idle. Hooks scope this to their own action group when
   * deriving their `pending: boolean`.
   */
  pending: ReadonlySet<AsyncAuthAction>;
}

/** Async action identifiers — see `pending` in `AuthState`. */
export type AsyncAuthAction =
  | "startOtpLogin"
  | "resendOtp"
  | "verifyOtp"
  | "loginWithPassword"
  | "migrate"
  | "loginWithOAuth"
  | "checkOAuthEmailOtp"
  | "refresh"
  | "signOut"
  | "changePassword"
  | "requestStepUp"
  | "sendStepUpOtp"
  | "submitStepUpOtp";

export interface AuthStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => AuthState;
  setState: (patch: Partial<AuthState>) => void;
}

export function createAuthStore(): AuthStore {
  let state: AuthState = {
    stage: "initializing",
    user: null,
    pendingIdentifier: null,
    otpSentAt: null,
    stepUp: null,
    error: null,
    pending: new Set(),
  };
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return state;
    },
    setState(patch) {
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
  };
}
