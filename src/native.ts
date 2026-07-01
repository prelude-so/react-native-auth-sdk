import { requireNativeModule } from "expo-modules-core";

import { ConfigJson } from "./types/config";
import { MigrateOptionsJson } from "./types/migrate";
import {
  FinalizeOAuthLoginResultJson,
  InitiateOAuthLoginOptionsJson,
  OAuthLoginOptionsJson,
} from "./types/oauth";
import { StartOTPLoginOptionsJson } from "./types/otp";
import {
  LoginWithPasswordOptionsJson,
  PreludePasswordCompliancyJson,
} from "./types/password";
import { PreludeProfileJson } from "./types/profile";
import {
  PreludeListSessionsOptionsJson,
  PreludeListSessionsResponseJson,
  PreludeRevokeTarget,
} from "./types/sessions";
import { StepUpChallengeJson } from "./types/stepUp";
import { PreludeUserJson } from "./types/user";

/**
 * Native module proxy. Every async method takes a `handle`
 * (per-instance UUID) and a `config` snapshot so the native
 * plugin can lazily provision the underlying client on first
 * use.
 */
export interface PreludeAuthNativeModule {
  // Lifecycle
  dispose(handle: string): Promise<void>;

  // OTP
  startOTPLogin(
    handle: string,
    config: ConfigJson,
    options: StartOTPLoginOptionsJson,
  ): Promise<void>;
  resendOTP(handle: string, config: ConfigJson): Promise<void>;
  checkOTP(
    handle: string,
    config: ConfigJson,
    code: string,
  ): Promise<PreludeUserJson>;

  // Password
  loginWithPassword(
    handle: string,
    config: ConfigJson,
    options: LoginWithPasswordOptionsJson,
  ): Promise<PreludeUserJson>;
  passwordCompliancy(
    handle: string,
    config: ConfigJson,
  ): Promise<PreludePasswordCompliancyJson>;
  changePassword(
    handle: string,
    config: ConfigJson,
    newPassword: string,
  ): Promise<void>;
  canChangePassword(handle: string, config: ConfigJson): Promise<boolean>;

  // Migration
  migrate(
    handle: string,
    config: ConfigJson,
    options: MigrateOptionsJson,
  ): Promise<PreludeUserJson>;
  // Social / OAuth login
  loginWithOAuth(
    handle: string,
    config: ConfigJson,
    options: OAuthLoginOptionsJson,
  ): Promise<FinalizeOAuthLoginResultJson>;
  /** Resolves with the provider authorization URL as a string. */
  initiateOAuthLogin(
    handle: string,
    config: ConfigJson,
    options: InitiateOAuthLoginOptionsJson,
  ): Promise<string>;
  finalizeOAuthLogin(
    handle: string,
    config: ConfigJson,
    challengeToken: string,
  ): Promise<FinalizeOAuthLoginResultJson>;
  /**
   * Redeem an email OTP for an `otp_required` OAuth result. The
   * `challengeID` resolves the native-cached challenge whose
   * verification token never crossed the bridge.
   */
  checkOAuthEmailOTP(
    handle: string,
    config: ConfigJson,
    challengeID: string,
    code: string,
  ): Promise<PreludeUserJson>;

  // Refresh / logout / invalidate
  refresh(handle: string, config: ConfigJson): Promise<PreludeUserJson>;
  logout(handle: string, config: ConfigJson): Promise<void>;
  invalidateSession(handle: string, config: ConfigJson): Promise<void>;

  // Manage sessions
  listSessions(
    handle: string,
    config: ConfigJson,
    options: PreludeListSessionsOptionsJson,
  ): Promise<PreludeListSessionsResponseJson>;
  revokeSessions(
    handle: string,
    config: ConfigJson,
    target: PreludeRevokeTarget,
  ): Promise<void>;

  // Step-up. Only `challengeID` crosses for send/submit — the
  // bearer challenge token stays in the native per-handle cache.
  requestStepUp(
    handle: string,
    config: ConfigJson,
    scope: string,
    metadata: Record<string, string> | null,
  ): Promise<StepUpChallengeJson>;
  sendStepUpOTP(
    handle: string,
    config: ConfigJson,
    challengeID: string,
  ): Promise<void>;
  submitStepUpOTP(
    handle: string,
    config: ConfigJson,
    challengeID: string,
    code: string,
  ): Promise<StepUpChallengeJson | null>;
  /** Native-cached most recent in-flight challenge, or `null`. */
  getActiveStepUp(
    handle: string,
    config: ConfigJson,
  ): Promise<StepUpChallengeJson | null>;

  // Cached readers
  getProfile(
    handle: string,
    config: ConfigJson,
  ): Promise<PreludeProfileJson | null>;
  getSessionID(handle: string, config: ConfigJson): Promise<string | null>;
  getAccessToken(handle: string, config: ConfigJson): Promise<string | null>;
  /** Unix seconds, UTC. `null` when no token cached. */
  getAccessTokenExpiresAt(
    handle: string,
    config: ConfigJson,
  ): Promise<number | null>;
}

export default requireNativeModule<PreludeAuthNativeModule>(
  "PreludeReactNativeAuthSdk",
);
