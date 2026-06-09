/**
 * Base type for every error thrown by `PreludeAuthClient`.
 *
 * Native `CodedError`s are decoded into matching subclasses by
 * `fromNativeError`; consumers `instanceof`-match the case they
 * care about.
 */
export class PreludeAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PreludeAuthError";
  }
}

const subclass = (code: string, name: string) =>
  class extends PreludeAuthError {
    constructor(message: string) {
      super(code, message);
      this.name = name;
    }
  };

export const BadRequestError = subclass("bad_request", "BadRequestError");
export const UnauthorizedError = subclass("unauthorized", "UnauthorizedError");
export const ForbiddenError = subclass("forbidden", "ForbiddenError");
export const NotFoundError = subclass("not_found", "NotFoundError");
export const ConflictError = subclass("conflict", "ConflictError");
export const RateLimitedError = subclass("rate_limited", "RateLimitedError");
export const InternalServerError = subclass(
  "internal_server_error",
  "InternalServerError",
);
export const MissingChallengeTokenError = subclass(
  "missing_challenge_token",
  "MissingChallengeTokenError",
);
export const InvalidChallengeTokenError = subclass(
  "invalid_challenge_token",
  "InvalidChallengeTokenError",
);
/** Step-up challenge token exceeded its TTL. Recover via `requestStepUp`. */
export const ExpiredChallengeTokenError = subclass(
  "expired_challenge_token",
  "ExpiredChallengeTokenError",
);
/** Bearer token was already redeemed. Same recovery: start a fresh challenge. */
export const TokenReusedError = subclass("token_reused", "TokenReusedError");
export const InvalidOTPCodeError = subclass(
  "invalid_otp_code",
  "InvalidOTPCodeError",
);
/**
 * Thrown by React hook actions when the caller invokes a step-up
 * action without an active challenge in store state (e.g. calling
 * `sendStepUpOtp()` before `requestStepUp()`).
 */
export const NoActiveStepUpError = subclass(
  "no_active_step_up",
  "NoActiveStepUpError",
);
export const RefreshFailedError = subclass(
  "refresh_failed",
  "RefreshFailedError",
);
export const TimeoutError = subclass("timeout", "TimeoutError");
export const InvalidConfigurationError = subclass(
  "invalid_configuration",
  "InvalidConfigurationError",
);
export const InvalidPasswordError = subclass(
  "invalid_password",
  "InvalidPasswordError",
);
export const InsufficientScopeError = subclass(
  "insufficient_scope",
  "InsufficientScopeError",
);
/**
 * Local crypto / Keychain / Keystore failure on the device. Recovery
 * is platform-specific (e.g. clearing app data); not retryable.
 * Currently surfaced by the Android native SDK only.
 */
export const CryptoFailureError = subclass(
  "crypto_failure",
  "CryptoFailureError",
);
export const NetworkError = subclass("network", "NetworkError");

/**
 * Thrown when a method is called on a disposed `PreludeAuthClient`.
 * Programmer error — distinct from API errors. Subclasses
 * `PreludeAuthError` so a single `catch` covers both.
 */
export class DisposedError extends PreludeAuthError {
  constructor() {
    super(
      "disposed",
      "PreludeAuthClient has been disposed. Create a new instance " +
        "to start a new logical session.",
    );
    this.name = "DisposedError";
  }
}

const REGISTRY: Record<string, new (m: string) => PreludeAuthError> = {
  bad_request: BadRequestError,
  unauthorized: UnauthorizedError,
  forbidden: ForbiddenError,
  not_found: NotFoundError,
  conflict: ConflictError,
  rate_limited: RateLimitedError,
  internal_server_error: InternalServerError,
  missing_challenge_token: MissingChallengeTokenError,
  invalid_challenge_token: InvalidChallengeTokenError,
  expired_challenge_token: ExpiredChallengeTokenError,
  token_reused: TokenReusedError,
  invalid_otp_code: InvalidOTPCodeError,
  refresh_failed: RefreshFailedError,
  timeout: TimeoutError,
  invalid_configuration: InvalidConfigurationError,
  invalid_password: InvalidPasswordError,
  insufficient_scope: InsufficientScopeError,
  crypto_failure: CryptoFailureError,
  network: NetworkError,
};

/**
 * Decode an Expo `CodedError` into the matching `PreludeAuthError`
 * subclass. Unknown codes fall through to a generic `PreludeAuthError`
 * — keeps forward compat with new server-side codes cheap.
 */
export function fromNativeError(e: unknown): PreludeAuthError {
  if (e instanceof PreludeAuthError) return e;
  const err = e as { code?: string; message?: string };
  const code = err?.code ?? "unknown";
  const message = err?.message ?? String(e);
  const Cls = REGISTRY[code];
  return Cls ? new Cls(message) : new PreludeAuthError(code, message);
}
