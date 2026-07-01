import { RequestStepUpOptions } from "../client";
import { PreludeIdentifier } from "../types/identifier";
import {
  FinalizeOAuthLoginResult,
  OAuthEmailChallenge,
  OAuthLoginOptions,
} from "../types/oauth";
import { StepUpChallenge } from "../types/stepUp";

import { RestoreOutcome } from "./restore";

/**
 * Hook-layer actions. Every action resolves — never rejects.
 *
 *   - Failures populate `state.error` and resolve to `undefined`.
 *   - Cancellations (`cancelOtp` / `cancelStepUp` / `signOut`) clear
 *     `error` synchronously and the racing call resolves to
 *     `undefined`.
 *   - Value-returning actions encode outcome in their return type:
 *     `requestStepUp`   → `challenge | undefined`,
 *     `submitStepUpOtp` → `nextChallenge | null | undefined`,
 *     `sendStepUpOtp`   → `true | undefined`,
 *     `changePassword`  → `true | undefined`,
 *     where `undefined` is the failure / cancel sentinel.
 *
 * Code that needs throw-on-error semantics (sequencing, background
 * tasks) can drop down to `PreludeAuthClient` via `useAuth().client`.
 */
export interface AuthActions {
  startOtpLogin: (
    identifier: PreludeIdentifier,
    loginConfigID?: string,
  ) => Promise<void>;
  resendOtp: () => Promise<void>;
  verifyOtp: (code: string) => Promise<void>;
  cancelOtp: () => void;
  loginWithPassword: (emailAddress: string, password: string) => Promise<void>;
  /** Exchange a legacy bearer token for a session; lands on `signedIn`. */
  migrate: (legacyToken: string) => Promise<void>;
  /**
   * OAuth login via the system web session. On success transitions to
   * `signedIn` and resolves with the result. A provider email that
   * still needs verification resolves with an `otpRequired` result and
   * leaves the stage untouched. A dismissed page or a failure resolves
   * with `undefined` — failures populate `state.error`, cancellation
   * does not.
   */
  loginWithOAuth: (
    options: OAuthLoginOptions,
  ) => Promise<FinalizeOAuthLoginResult | undefined>;
  /**
   * Complete an OAuth login that resolved with an `otpRequired`
   * result by submitting the email `code` for `challenge`. On success
   * transitions to `signedIn`; a failure populates `state.error` and
   * leaves the stage untouched.
   */
  checkOAuthEmailOtp: (
    code: string,
    challenge: OAuthEmailChallenge,
  ) => Promise<void>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Resolves with `true` on success, `undefined` on failure / cancellation. */
  changePassword: (password: string) => Promise<boolean | undefined>;
  requestStepUp: (
    scope: string | RequestStepUpOptions,
  ) => Promise<StepUpChallenge | undefined>;
  /**
   * Trigger OTP delivery for the active step-up challenge. The
   * challenge is read from `state.stepUp` at call time, so a
   * concurrent `requestStepUp` won't redirect this call to a new
   * challenge mid-flight. Resolves with `true` on success, or
   * `undefined` on failure / cancellation.
   */
  sendStepUpOtp: () => Promise<boolean | undefined>;
  /**
   * Submit `code` against the active step-up challenge. Resolves
   * with the next challenge, `null` when step-up is complete, or
   * `undefined` on failure / cancellation. The active challenge is
   * read from `state.stepUp` at call time; a concurrent
   * `requestStepUp` won't redirect this call.
   */
  submitStepUpOtp: (
    code: string,
  ) => Promise<StepUpChallenge | null | undefined>;
  cancelStepUp: () => void;
  clearError: () => void;
}

/** Provider-internal wrapper that runs the restore probe under the session gate. */
export type GatedRestore = (
  isCancelled: () => boolean,
) => Promise<RestoreOutcome | null>;

export interface AuthRuntime {
  actions: AuthActions;
  restore: GatedRestore;
}
