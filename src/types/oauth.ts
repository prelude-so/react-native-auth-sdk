import { PreludeUser, PreludeUserJson, userFromJson } from "./user";

/** Identity providers supported for OAuth login. */
export type OAuthProvider =
  | "google"
  | "apple"
  | "microsoft"
  | "github"
  | "okta"
  | "facebook";

/** Options for `PreludeAuthClient.loginWithOAuth`. */
export interface OAuthLoginOptions {
  /** Provider to authenticate against. */
  provider: OAuthProvider;
  /**
   * Where the provider redirects once authentication completes. Must
   * use the app's custom URL scheme (e.g. `myapp://oauth-callback`)
   * and be allowlisted by the app's configuration. An `http`/`https`
   * URI throws `InvalidConfigurationError` before any network call.
   */
  redirectUri: string;
  /**
   * iOS only. When `true` the web session shares no cookies with the
   * system browser, so every login starts clean. Ignored on Android.
   * Defaults to `false`.
   */
  prefersEphemeralSession?: boolean;
}

export interface OAuthLoginOptionsJson {
  provider: OAuthProvider;
  redirectUri: string;
  prefersEphemeralSession: boolean;
}

export function oAuthLoginOptionsToJson(
  options: OAuthLoginOptions,
): OAuthLoginOptionsJson {
  return {
    provider: options.provider,
    redirectUri: options.redirectUri,
    prefersEphemeralSession: options.prefersEphemeralSession ?? false,
  };
}

/** Options for `PreludeAuthClient.initiateOAuthLogin`. */
export interface InitiateOAuthLoginOptions {
  /** Provider to authenticate against. */
  provider: OAuthProvider;
  /**
   * Where the server redirects once authentication completes. Must be
   * allowlisted by the app's configuration.
   */
  redirectUri: string;
}

export interface InitiateOAuthLoginOptionsJson {
  provider: OAuthProvider;
  redirectUri: string;
}

export function initiateOAuthLoginOptionsToJson(
  options: InitiateOAuthLoginOptions,
): InitiateOAuthLoginOptionsJson {
  return { provider: options.provider, redirectUri: options.redirectUri };
}

/**
 * An OAuth-email-link verification awaiting its one-time code.
 * Returned in an `otpRequired` result and redeemed by
 * `PreludeAuthClient.checkOAuthEmailOTP`.
 *
 * Opaque handle: the verification token stays native, keyed by `id`
 * in a per-handle cache, so the bearer credential never crosses the
 * bridge and concurrent logins stay isolated. Pass it back unchanged.
 */
export class OAuthEmailChallenge {
  constructor(
    /** Native cache key. Opaque — don't depend on its shape. */
    readonly id: string,
  ) {}

  // Nothing meaningful (or secret) to print: the token lives native.
  toString(): string {
    return "OAuthEmailChallenge";
  }
}

/** Outcome of redeeming an OAuth login callback. */
export type FinalizeOAuthLoginResult =
  /** Session established. */
  | { kind: "loggedIn"; user: PreludeUser }
  /**
   * Provider email unverified; a one-time code was sent to `email`.
   * Redeem `challenge` with `checkOAuthEmailOTP` to complete the login.
   */
  | {
      kind: "otpRequired";
      challenge: OAuthEmailChallenge;
      email: string | null;
    };

/** Tagged wire form produced by the native bridge. */
export type FinalizeOAuthLoginResultJson =
  | { kind: "logged_in"; user: PreludeUserJson }
  | { kind: "otp_required"; challengeID: string; email: string | null };

export function finalizeOAuthLoginResultFromJson(
  json: FinalizeOAuthLoginResultJson,
): FinalizeOAuthLoginResult {
  switch (json.kind) {
    case "logged_in":
      return { kind: "loggedIn", user: userFromJson(json.user) };
    case "otp_required":
      return {
        kind: "otpRequired",
        challenge: new OAuthEmailChallenge(json.challengeID),
        email: json.email ?? null,
      };
  }
}
