// Mock the native module before importing anything that touches it,
// otherwise `requireNativeModule` blows up at import time on Node.
const mockNative = {
  dispose: jest.fn().mockResolvedValue(undefined),
  resendOTP: jest.fn().mockResolvedValue(undefined),
  requestStepUp: jest.fn().mockResolvedValue({
    status: "continue",
    challengeID: "c_1",
    currentStep: "verify_email",
    requestedScope: "prld:pwd:write",
  }),
  sendStepUpOTP: jest.fn().mockResolvedValue(undefined),
  // Default to "completed" so any test that doesn't override sees a
  // null return; multi-step / non-null cases are mocked per-test.
  submitStepUpOTP: jest.fn().mockResolvedValue(null),
  getActiveStepUp: jest.fn().mockResolvedValue(null),
  migrate: jest.fn().mockResolvedValue({
    accessToken: "tok",
    profile: { extras: {} },
  }),
};

jest.mock("expo-modules-core", () => ({
  requireNativeModule: () => mockNative,
}));

import { PreludeAuthClient } from "../client";
import { DisposedError } from "../types/errors";
import { RedactedString } from "../types/redactedString";

beforeEach(() => {
  Object.values(mockNative).forEach((fn) => fn.mockClear?.());
});

describe("PreludeAuthClient.dispose", () => {
  it("calls native dispose exactly once", async () => {
    const c = new PreludeAuthClient();
    await c.dispose();
    await c.dispose(); // idempotent
    expect(mockNative.dispose).toHaveBeenCalledTimes(1);
  });

  it("does not deadlock on its own internal `disposed` check", async () => {
    // Regression: an earlier scaffold flipped `disposed = true` and then
    // routed the native call through `invoke`, which would refuse it.
    const c = new PreludeAuthClient();
    await expect(c.dispose()).resolves.toBeUndefined();
  });

  it("rejects subsequent calls with DisposedError", async () => {
    const c = new PreludeAuthClient();
    await c.dispose();
    await expect(c.resendOTP()).rejects.toBeInstanceOf(DisposedError);
    expect(mockNative.resendOTP).not.toHaveBeenCalled();
  });
});

describe("PreludeAuthClient signals + step-up surface", () => {
  it("forwards `signalsKeyOverride` (trimmed) to the config", async () => {
    const c = new PreludeAuthClient({ signalsKeyOverride: "  sdk_test_xyz  " });
    await c.resendOTP();
    expect(mockNative.resendOTP).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signalsKeyOverride: "sdk_test_xyz" }),
    );
  });

  it("collapses blank `signalsKeyOverride` into null", async () => {
    const c = new PreludeAuthClient({ signalsKeyOverride: "   " });
    await c.resendOTP();
    expect(mockNative.resendOTP).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signalsKeyOverride: null }),
    );
  });

  it("requestStepUp accepts a string scope", async () => {
    const c = new PreludeAuthClient();
    await c.requestStepUp("prld:pwd:write");
    expect(mockNative.requestStepUp).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      "prld:pwd:write",
      null,
    );
  });

  it("requestStepUp forwards metadata when given an options object", async () => {
    const c = new PreludeAuthClient();
    await c.requestStepUp({
      scope: "prld:pwd:write",
      metadata: { reason: "settings" },
    });
    expect(mockNative.requestStepUp).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      "prld:pwd:write",
      { reason: "settings" },
    );
  });

  it("requestStepUp collapses empty metadata `{}` to null", async () => {
    const c = new PreludeAuthClient();
    await c.requestStepUp({ scope: "prld:pwd:write", metadata: {} });
    expect(mockNative.requestStepUp).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      "prld:pwd:write",
      null,
    );
  });

  it("sendStepUpOTP only forwards the challengeID, not the bearer token", async () => {
    const c = new PreludeAuthClient();
    await c.sendStepUpOTP({
      status: "continue",
      challengeID: "c_42",
      currentStep: "verify_email",
      requestedScope: "prld:pwd:write",
    });
    expect(mockNative.sendStepUpOTP).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      "c_42",
    );
  });

  it("getActiveStepUp returns null when nothing is in flight", async () => {
    const c = new PreludeAuthClient();
    expect(await c.getActiveStepUp()).toBeNull();
  });

  it("getActiveStepUp decodes a non-null cached challenge", async () => {
    mockNative.getActiveStepUp.mockResolvedValueOnce({
      status: "continue",
      challengeID: "c_active",
      currentStep: "verify_email",
      requestedScope: "prld:pwd:write",
    });
    const c = new PreludeAuthClient();
    expect(await c.getActiveStepUp()).toEqual({
      status: "continue",
      challengeID: "c_active",
      currentStep: "verify_email",
      requestedScope: "prld:pwd:write",
    });
  });

  it("submitStepUpOTP returns null when the native call signals completion", async () => {
    const c = new PreludeAuthClient();
    const result = await c.submitStepUpOTP(
      {
        status: "continue",
        challengeID: "c_1",
        currentStep: "verify_email",
        requestedScope: "prld:pwd:write",
      },
      "123456",
    );
    expect(result).toBeNull();
    // Only `challengeID` + the code cross — the bearer token stays
    // in the native cache.
    expect(mockNative.submitStepUpOTP).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      "c_1",
      "123456",
    );
  });

  it("submitStepUpOTP decodes the next challenge for multi-step flows", async () => {
    mockNative.submitStepUpOTP.mockResolvedValueOnce({
      status: "continue",
      challengeID: "c_2",
      currentStep: "verify_sms",
      requestedScope: "prld:pwd:write",
    });
    const c = new PreludeAuthClient();
    const next = await c.submitStepUpOTP(
      {
        status: "continue",
        challengeID: "c_1",
        currentStep: "verify_email",
        requestedScope: "prld:pwd:write",
      },
      "123456",
    );
    expect(next).toEqual({
      status: "continue",
      challengeID: "c_2",
      currentStep: "verify_sms",
      requestedScope: "prld:pwd:write",
    });
  });
});

describe("PreludeAuthClient.submitStepUpOTP cache state machine", () => {
  // The bearer challenge token never crosses the bridge — only the
  // public `challengeID` does. These tests assert the JS side
  // correctly threads the *next* challenge's id into a follow-up
  // call, so the native step-up cache is keyed correctly across
  // multi-step transitions.
  const initial = {
    status: "continue" as const,
    challengeID: "c_initial",
    currentStep: "verify_email",
    requestedScope: "prld:pwd:write",
  };

  it("threads next.challengeID into the follow-up submit", async () => {
    const next = {
      status: "continue" as const,
      challengeID: "c_next",
      currentStep: "verify_sms",
      requestedScope: "prld:pwd:write",
    };
    mockNative.submitStepUpOTP.mockResolvedValueOnce(next);
    mockNative.submitStepUpOTP.mockResolvedValueOnce(null);

    const c = new PreludeAuthClient();
    const step1 = await c.submitStepUpOTP(initial, "111111");
    expect(step1).not.toBeNull();
    await c.submitStepUpOTP(step1!, "222222");

    // Second native call must use the *new* challengeID, not the
    // initial one — otherwise the native cache lookup misses and the
    // user sees `InvalidChallengeTokenError` mid-flow.
    expect(mockNative.submitStepUpOTP).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(Object),
      "c_next",
      "222222",
    );
  });

  it("returns the blocked challenge to JS but the JS side still surfaces it", async () => {
    // Terminal verdict — the SDK contract documents this as a
    // render-only state. The JS layer must hand it back unchanged so
    // consumers can `instanceof`-check the status without losing
    // metadata. The native side won't accept a follow-up submit
    // (cached challenge has been evicted), but the JS side doesn't
    // pre-empt the call — the typed error from the bridge does.
    const blocked = {
      status: "block" as const,
      challengeID: "",
      currentStep: null,
      requestedScope: "prld:pwd:write",
    };
    mockNative.submitStepUpOTP.mockResolvedValueOnce(blocked);
    const c = new PreludeAuthClient();
    const result = await c.submitStepUpOTP(initial, "111111");
    expect(result).toEqual(blocked);
  });

  it("preserves the original challenge handle on InvalidOTPCode so a retry can use it", async () => {
    // Mirrors the native state machine: a wrong code keeps the
    // challenge cached up to the server's bucket limit. Verify the
    // JS side can issue a retry against the same `challenge` object.
    mockNative.submitStepUpOTP.mockRejectedValueOnce({
      code: "invalid_otp_code",
      message: "wrong",
    });
    mockNative.submitStepUpOTP.mockResolvedValueOnce(null);

    const c = new PreludeAuthClient();
    await expect(c.submitStepUpOTP(initial, "000000")).rejects.toMatchObject({
      code: "invalid_otp_code",
    });
    await c.submitStepUpOTP(initial, "111111");

    // Both calls hit the native side with the *original* challengeID;
    // the JS side never silently rewrites it.
    expect(mockNative.submitStepUpOTP).toHaveBeenNthCalledWith(
      1, expect.any(String), expect.any(Object), "c_initial", "000000",
    );
    expect(mockNative.submitStepUpOTP).toHaveBeenNthCalledWith(
      2, expect.any(String), expect.any(Object), "c_initial", "111111",
    );
  });
});

describe("PreludeAuthClient.migrate", () => {
  it("forwards the unwrapped token and returns a user", async () => {
    const c = new PreludeAuthClient();
    const user = await c.migrate({ token: new RedactedString("legacy_xyz") });
    expect(mockNative.migrate).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      { token: "legacy_xyz" },
    );
    expect(user.accessToken).toBe("tok");
  });
});
