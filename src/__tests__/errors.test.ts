import {
  BadRequestError,
  ConflictError,
  CryptoFailureError,
  DisposedError,
  ExpiredChallengeTokenError,
  ForbiddenError,
  InsufficientScopeError,
  InternalServerError,
  InvalidChallengeTokenError,
  InvalidConfigurationError,
  InvalidOTPCodeError,
  InvalidPasswordError,
  MissingChallengeTokenError,
  NetworkError,
  NotFoundError,
  PreludeAuthError,
  RateLimitedError,
  RefreshFailedError,
  TimeoutError,
  TokenReusedError,
  UnauthorizedError,
  fromNativeError,
} from "../types/errors";

describe("fromNativeError", () => {
  const cases: Array<[string, new (m: string) => PreludeAuthError]> = [
    ["bad_request", BadRequestError],
    ["unauthorized", UnauthorizedError],
    ["forbidden", ForbiddenError],
    ["not_found", NotFoundError],
    ["conflict", ConflictError],
    ["rate_limited", RateLimitedError],
    ["internal_server_error", InternalServerError],
    ["missing_challenge_token", MissingChallengeTokenError],
    ["invalid_challenge_token", InvalidChallengeTokenError],
    ["expired_challenge_token", ExpiredChallengeTokenError],
    ["token_reused", TokenReusedError],
    ["invalid_otp_code", InvalidOTPCodeError],
    ["refresh_failed", RefreshFailedError],
    ["timeout", TimeoutError],
    ["invalid_configuration", InvalidConfigurationError],
    ["invalid_password", InvalidPasswordError],
    ["insufficient_scope", InsufficientScopeError],
    ["crypto_failure", CryptoFailureError],
    ["network", NetworkError],
  ];

  it.each(cases)("decodes `%s` into the matching subclass", (code, Cls) => {
    const e = fromNativeError({ code, message: "boom" });
    expect(e).toBeInstanceOf(Cls);
    expect(e.code).toBe(code);
    expect(e.message).toBe("boom");
  });

  it("falls through to a generic PreludeAuthError for unknown codes", () => {
    const e = fromNativeError({ code: "tea_pot", message: "418" });
    expect(e).toBeInstanceOf(PreludeAuthError);
    expect(e.code).toBe("tea_pot");
  });

  it("passes existing PreludeAuthError instances through unchanged", () => {
    const original = new BadRequestError("nope");
    expect(fromNativeError(original)).toBe(original);
  });

  it("synthesises an `unknown` code when nothing decodable is present", () => {
    const e = fromNativeError(new Error("something"));
    expect(e.code).toBe("unknown");
  });
});

describe("DisposedError", () => {
  it("is a PreludeAuthError with code 'disposed'", () => {
    const e = new DisposedError();
    expect(e).toBeInstanceOf(PreludeAuthError);
    expect(e.code).toBe("disposed");
    expect(e.name).toBe("DisposedError");
  });
});
