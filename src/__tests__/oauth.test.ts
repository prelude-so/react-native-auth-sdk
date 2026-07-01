import {
  finalizeOAuthLoginResultFromJson,
  initiateOAuthLoginOptionsToJson,
  OAuthEmailChallenge,
  oAuthLoginOptionsToJson,
} from "../types/oauth";

describe("oAuthLoginOptionsToJson", () => {
  it("defaults prefersEphemeralSession to false", () => {
    expect(
      oAuthLoginOptionsToJson({ provider: "google", redirectUri: "app://cb" }),
    ).toEqual({
      provider: "google",
      redirectUri: "app://cb",
      prefersEphemeralSession: false,
    });
  });

  it("preserves an explicit prefersEphemeralSession", () => {
    expect(
      oAuthLoginOptionsToJson({
        provider: "okta",
        redirectUri: "app://cb",
        prefersEphemeralSession: true,
      }).prefersEphemeralSession,
    ).toBe(true);
  });
});

describe("initiateOAuthLoginOptionsToJson", () => {
  it("forwards provider + redirectUri", () => {
    expect(
      initiateOAuthLoginOptionsToJson({
        provider: "github",
        redirectUri: "app://cb",
      }),
    ).toEqual({ provider: "github", redirectUri: "app://cb" });
  });
});

describe("finalizeOAuthLoginResultFromJson", () => {
  it("decodes a logged_in result into a PreludeUser", () => {
    const r = finalizeOAuthLoginResultFromJson({
      kind: "logged_in",
      user: {
        accessToken: "tok",
        profile: { userID: "u1", sessionID: "s1", extras: {} },
      },
    });
    expect(r.kind).toBe("loggedIn");
    if (r.kind !== "loggedIn") throw new Error("unreachable");
    expect(r.user.accessToken).toBe("tok");
    expect(r.user.profile.userID).toBe("u1");
  });

  it("decodes an otp_required result into a challenge handle + email", () => {
    const r = finalizeOAuthLoginResultFromJson({
      kind: "otp_required",
      challengeID: "oauth-1",
      email: "a@b.co",
    });
    expect(r.kind).toBe("otpRequired");
    if (r.kind !== "otpRequired") throw new Error("unreachable");
    expect(r.challenge).toBeInstanceOf(OAuthEmailChallenge);
    expect(r.challenge.id).toBe("oauth-1");
    expect(r.email).toBe("a@b.co");
  });

  it("normalises a missing otp_required email to null", () => {
    const r = finalizeOAuthLoginResultFromJson({
      kind: "otp_required",
      challengeID: "oauth-1",
      email: null,
    });
    expect(r.kind === "otpRequired" && r.email).toBeNull();
  });
});

describe("OAuthEmailChallenge", () => {
  it("is opaque to string conversion — no internals leak", () => {
    const challenge = new OAuthEmailChallenge("oauth-secret-key");
    expect(`${challenge}`).toBe("OAuthEmailChallenge");
    expect(`${challenge}`).not.toContain("oauth-secret-key");
  });
});
