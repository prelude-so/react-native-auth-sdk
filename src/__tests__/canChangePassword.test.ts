// Mock the native module before importing anything that touches it,
// otherwise `requireNativeModule` blows up at import time on Node.
const mockNative = {
  canChangePassword: jest.fn(),
};

jest.mock("expo-modules-core", () => ({
  requireNativeModule: () => mockNative,
}));

import { PreludeAuthClient } from "../client";

beforeEach(() => {
  mockNative.canChangePassword.mockReset();
});

describe("PreludeAuthClient.canChangePassword", () => {
  it("bridges to native and returns true when scope is present", async () => {
    mockNative.canChangePassword.mockResolvedValueOnce(true);
    const c = new PreludeAuthClient();
    expect(await c.canChangePassword()).toBe(true);
    expect(mockNative.canChangePassword).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
    );
  });

  it("returns false when the native side says so", async () => {
    mockNative.canChangePassword.mockResolvedValueOnce(false);
    const c = new PreludeAuthClient();
    expect(await c.canChangePassword()).toBe(false);
  });

  it("propagates native errors via `invoke`", async () => {
    mockNative.canChangePassword.mockRejectedValueOnce({
      code: "internal_server_error",
      message: "boom",
    });
    const c = new PreludeAuthClient();
    await expect(c.canChangePassword()).rejects.toBeDefined();
  });
});
