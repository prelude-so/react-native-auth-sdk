import { newHandle } from "./handle";
import native from "./native";
import { validatePassword } from "./passwordValidate";
import { ConfigJson } from "./types/config";
import { Endpoint } from "./types/endpoint";
import { DisposedError, fromNativeError } from "./types/errors";
import { startOTPLoginOptionsToJson, StartOTPLoginOptions } from "./types/otp";
import {
  loginWithPasswordOptionsToJson,
  LoginWithPasswordOptions,
  passwordCompliancyFromJson,
  PreludePasswordCompliancy,
  PreludePasswordCompliancyResults,
} from "./types/password";
import { PreludeProfile, profileFromJson } from "./types/profile";
import { RedactedString } from "./types/redactedString";
import {
  listSessionsOptionsToJson,
  listSessionsResponseFromJson,
  PreludeListSessionsOptions,
  PreludeListSessionsResponse,
  PreludeRevokeTarget,
} from "./types/sessions";
import { stepUpChallengeFromJson, StepUpChallenge } from "./types/stepUp";
import { PreludeUser, userFromJson } from "./types/user";

export interface PreludeSessionClientOptions {
  /** API endpoint. Defaults to `Endpoint.default`. */
  endpoint?: Endpoint;
  /** Canonical-authority hint. `undefined` derives from the endpoint. */
  hostOverride?: string;
  /** Per-request timeout in milliseconds. Default 10s. */
  timeoutMs?: number;
  /**
   * iOS only. Local development only — never ship `true`.
   *
   * Android cannot honor this from the SDK; configure self-signed
   * certificate trust via the consuming app's
   * `network_security_config.xml` instead. The option is silently
   * ignored on Android.
   */
  allowInsecureTLS?: boolean;
  /**
   * Forces a specific Prelude signals SDK key for this client,
   * bypassing the platform manifest. Default is to leave this
   * undefined and configure the key per-platform: `PreludeSDKKey`
   * in `Info.plist` on iOS, `<meta-data android:name="so.prelude.sdk_key">`
   * in `AndroidManifest.xml` on Android — that way the iOS key
   * can't ship in an Android build, and vice versa. The override
   * is for runtime-fetched config (CI, white-label) where a
   * JS-side string is genuinely the right shape.
   */
  signalsKeyOverride?: string;
}

export interface RequestStepUpOptions {
  /** Scope to be granted on completion (e.g. `prld:pwd:write`). */
  scope: string;
  /**
   * Forwarded verbatim to the server's step-up audit hook. Server
   * caps apply (max 5 keys, 12-char keys, 32-char values); a
   * violation surfaces as `BadRequestError`.
   */
  metadata?: Record<string, string>;
}

/**
 * Bridges to the native iOS / Android session clients.
 *
 * One JS instance owns one logical session: the SDK stamps an
 * opaque handle at construction and forwards it with every call.
 * The native plugin lazily creates one client per handle on first
 * use and reuses it, so DPoP keys, refresh tokens, and the
 * access-token cache stay stable across calls.
 *
 * Call `dispose()` when done. Forgetting leaks the native client
 * until the process exits; nothing else breaks.
 */
export class PreludeSessionClient {
  private readonly handle = newHandle();
  private readonly config: ConfigJson;
  private disposed = false;

  constructor(options: PreludeSessionClientOptions = {}) {
    // Empty-string overrides collapse to `null` so a misconfigured
    // env var doesn't construct a half-wired dispatcher native-side.
    // Native side re-checks for blank as defence in depth.
    const override = options.signalsKeyOverride?.trim();
    this.config = {
      endpoint: (options.endpoint ?? Endpoint.default).toJSON(),
      hostOverride: options.hostOverride ?? null,
      timeoutSeconds: (options.timeoutMs ?? 10_000) / 1000,
      allowInsecureTLS: options.allowInsecureTLS ?? false,
      signalsKeyOverride: override && override.length > 0 ? override : null,
    };
  }

  /**
   * Release native state. Idempotent. Subsequent calls throw
   * `DisposedError`.
   *
   * Calls already in flight at dispose time complete normally on
   * the native side and resolve their JS promises — but any cache
   * side-effect that would mutate per-handle state (e.g. a step-up
   * transition mirroring into `activeStepUp`) is silently dropped
   * once the handle is gone.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    // Flip first so a concurrent caller can't sneak through `invoke`
    // while the native dispose is in flight. Native side is bypassed
    // here on purpose — `invoke` would now refuse the call.
    this.disposed = true;
    try {
      await native.dispose(this.handle);
    } catch (e) {
      throw fromNativeError(e);
    }
  }

  // ---------- OTP ----------

  startOTPLogin(options: StartOTPLoginOptions): Promise<void> {
    return this.invoke(() =>
      native.startOTPLogin(
        this.handle,
        this.config,
        startOTPLoginOptionsToJson(options),
      ),
    );
  }

  resendOTP(): Promise<void> {
    return this.invoke(() => native.resendOTP(this.handle, this.config));
  }

  async checkOTP(code: string): Promise<PreludeUser> {
    const raw = await this.invoke(() =>
      native.checkOTP(this.handle, this.config, code),
    );
    return userFromJson(raw);
  }

  // ---------- Password ----------

  async loginWithPassword(
    options: LoginWithPasswordOptions,
  ): Promise<PreludeUser> {
    const raw = await this.invoke(() =>
      native.loginWithPassword(
        this.handle,
        this.config,
        loginWithPasswordOptionsToJson(options),
      ),
    );
    return userFromJson(raw);
  }

  async passwordCompliancy(): Promise<PreludePasswordCompliancy> {
    const raw = await this.invoke(() =>
      native.passwordCompliancy(this.handle, this.config),
    );
    return passwordCompliancyFromJson(raw);
  }

  /**
   * Convenience that fetches compliancy then runs `validate`.
   * For real-time validation, fetch compliancy once and call the
   * static `PreludeSessionClient.validate` synchronously.
   */
  async validatePassword(
    password: string,
  ): Promise<PreludePasswordCompliancyResults> {
    const compliancy = await this.passwordCompliancy();
    return PreludeSessionClient.validate(password, compliancy);
  }

  /** Pure password classifier — re-export of `validatePassword`. */
  static validate = validatePassword;

  /**
   * Change the currently authenticated user's password. Requires the
   * session to carry `prld:pwd:write` — obtain it via `requestStepUp`
   * + `submitStepUpOTP`. Sessions without it throw
   * `InsufficientScopeError`. The password is taken as a
   * `RedactedString` so it never leaks through `toString` /
   * `console.log` at the call site.
   */
  changePassword(newPassword: RedactedString): Promise<void> {
    return this.invoke(() =>
      // Unwrap exactly here, on the way to the channel — the only
      // point inside the SDK where the secret needs to be plain.
      native.changePassword(this.handle, this.config, newPassword.value),
    );
  }

  // ---------- Refresh / logout / invalidate ----------

  /**
   * Return an authenticated `PreludeUser`, refreshing the access
   * token if the cached one has expired. Concurrent callers share a
   * single in-flight refresh.
   */
  async refresh(): Promise<PreludeUser> {
    const raw = await this.invoke(() =>
      native.refresh(this.handle, this.config),
    );
    return userFromJson(raw);
  }

  /** Revoke the session server-side and wipe local credentials. */
  logout(): Promise<void> {
    return this.invoke(() => native.logout(this.handle, this.config));
  }

  /**
   * Mark the local access token expired so the next protected call
   * refreshes. Does NOT revoke the session on the server or wipe the
   * refresh token — use `logout` for that.
   */
  invalidateSession(): Promise<void> {
    return this.invoke(() =>
      native.invalidateSession(this.handle, this.config),
    );
  }

  // ---------- Manage sessions ----------

  /**
   * Fetch a page of active sessions for the authenticated user.
   * Both `limit` and `offset` are optional — the server applies its
   * own defaults when absent so a default change lands without a
   * client release.
   */
  async listSessions(
    options: PreludeListSessionsOptions = {},
  ): Promise<PreludeListSessionsResponse> {
    const json = listSessionsOptionsToJson(options);
    const raw = await this.invoke(() =>
      native.listSessions(this.handle, this.config, json),
    );
    return listSessionsResponseFromJson(raw);
  }

  /**
   * Revoke one or more of the authenticated user's sessions.
   *
   * When `target` kills the calling session (`PreludeRevokeTarget.all`,
   * `PreludeRevokeTarget.mine`, or a `PreludeRevokeTarget.session`
   * whose id matches the cached session), the native SDK additionally
   * wipes the per-domain credential stores — same wipe `logout`
   * performs — so a stale refresh can't resurrect them.
   */
  revokeSessions(target: PreludeRevokeTarget): Promise<void> {
    return this.invoke(() =>
      native.revokeSessions(this.handle, this.config, target),
    );
  }

  // ---------- Step-up ----------

  /**
   * Request a step-up to a scope. Returns the challenge handle —
   * pass it to `sendStepUpOTP` to trigger code delivery, then to
   * `submitStepUpOTP` together with the OTP code.
   *
   * This call never fires `POST /otp` itself, so callers driving a
   * "resend code" button or a multi-screen UI keep full control over
   * delivery timing.
   *
   * Accepts either `(scope)` for the common case or
   * `({ scope, metadata })` when forwarding step-up audit metadata.
   */
  async requestStepUp(scope: string): Promise<StepUpChallenge>;
  async requestStepUp(options: RequestStepUpOptions): Promise<StepUpChallenge>;
  async requestStepUp(
    scopeOrOptions: string | RequestStepUpOptions,
  ): Promise<StepUpChallenge> {
    const opts: RequestStepUpOptions =
      typeof scopeOrOptions === "string"
        ? { scope: scopeOrOptions }
        : scopeOrOptions;
    // Empty `{}` carries no audit value and would just inflate the
    // wire payload, so collapse to `null`. Keeps the bridge contract
    // a single shape: `null | non-empty Record<string, string>`.
    const metadata =
      opts.metadata && Object.keys(opts.metadata).length > 0
        ? opts.metadata
        : null;
    const raw = await this.invoke(() =>
      native.requestStepUp(this.handle, this.config, opts.scope, metadata),
    );
    return stepUpChallengeFromJson(raw);
  }

  /**
   * Most recent in-flight step-up challenge for this client, or
   * `null` if none. Mirrors the native accessor — useful for UIs
   * that resume a step-up flow across screens without threading the
   * `StepUpChallenge` handle through their state.
   *
   * A returned challenge with `status === "block"` is a terminal
   * verdict — render it, but do not call `sendStepUpOTP` /
   * `submitStepUpOTP` on it: blocked challenges carry no token and
   * the calls reject with `InvalidChallengeTokenError`.
   */
  async getActiveStepUp(): Promise<StepUpChallenge | null> {
    const raw = await this.invoke(() =>
      native.getActiveStepUp(this.handle, this.config),
    );
    return raw == null ? null : stepUpChallengeFromJson(raw);
  }

  /**
   * Trigger OTP delivery (`POST /otp`) for an in-flight step-up
   * `challenge`. Call this when `challenge.currentStep` is an
   * OTP-delivery step (`verify_email` / `verify_sms`) so the user
   * receives the code. Caller-driven on purpose: the UI decides
   * when delivery fires.
   *
   * Throws `InvalidChallengeTokenError` if `challenge.status` is
   * `"block"` (terminal verdict, no token to redeem).
   */
  sendStepUpOTP(challenge: StepUpChallenge): Promise<void> {
    return this.invoke(() =>
      native.sendStepUpOTP(this.handle, this.config, challenge.challengeID),
    );
  }

  /**
   * Submit an OTP `code` for `challenge`. Returns the next challenge
   * for multi-step flows, or `null` when the flow has completed and
   * the session has been refreshed with the granted scope. For a
   * multi-step flow whose next step is also OTP delivery, the caller
   * must invoke `sendStepUpOTP` on the returned challenge to trigger
   * the next code.
   *
   * If the returned challenge has `status === "block"`, the flow
   * has terminated — surface the verdict to the user but do not
   * resubmit. A subsequent `submitStepUpOTP` against it rejects
   * with `InvalidChallengeTokenError`.
   *
   * Throws `InvalidChallengeTokenError` if `challenge.status` was
   * already `"block"` on entry (no token to redeem).
   */
  async submitStepUpOTP(
    challenge: StepUpChallenge,
    code: string,
  ): Promise<StepUpChallenge | null> {
    const raw = await this.invoke(() =>
      native.submitStepUpOTP(
        this.handle,
        this.config,
        challenge.challengeID,
        code,
      ),
    );
    return raw == null ? null : stepUpChallengeFromJson(raw);
  }

  // ---------- Cached readers ----------

  /** Profile claims of the currently cached access token, or `null`. */
  async getProfile(): Promise<PreludeProfile | null> {
    const raw = await this.invoke(() =>
      native.getProfile(this.handle, this.config),
    );
    return raw == null ? null : profileFromJson(raw);
  }

  /** Session identifier of the currently cached access token (JWT `sid`). */
  getSessionID(): Promise<string | null> {
    return this.invoke(() => native.getSessionID(this.handle, this.config));
  }

  /** Raw cached access token, or `null` if none. */
  getAccessToken(): Promise<string | null> {
    return this.invoke(() => native.getAccessToken(this.handle, this.config));
  }

  /** Returns a `Date` (UTC), or `null` when no token cached. */
  async getAccessTokenExpiresAt(): Promise<Date | null> {
    const unix = await this.invoke(() =>
      native.getAccessTokenExpiresAt(this.handle, this.config),
    );
    return unix == null ? null : new Date(unix * 1000);
  }

  // ---------- Internals ----------

  private async invoke<T>(fn: () => Promise<T>): Promise<T> {
    if (this.disposed) throw new DisposedError();
    try {
      return await fn();
    } catch (e) {
      throw fromNativeError(e);
    }
  }
}
