// Mock the native module before importing anything that touches it.
const listeners: Array<(e: unknown) => void> = [];
const state = (over: Record<string, boolean> = {}) => ({
  isLocked: false,
  isEnabled: true,
  isBiometricsEnabled: false,
  isBiometricsAvailable: true,
  ...over,
});
const mockNative = {
  dispose: jest.fn().mockResolvedValue(undefined),
  addListener: jest.fn((_name: string, cb: (e: unknown) => void) => {
    listeners.push(cb);
    return { remove: () => listeners.splice(listeners.indexOf(cb), 1) };
  }),
  idleLockStart: jest.fn().mockResolvedValue(state({ isLocked: true })),
  idleLockStop: jest.fn().mockResolvedValue(undefined),
  idleLockState: jest.fn().mockResolvedValue(state()),
  idleLockSetPasscode: jest.fn().mockResolvedValue(state()),
  idleLockEnableBiometrics: jest.fn().mockResolvedValue(state({ isBiometricsEnabled: true })),
  idleLockDisableBiometrics: jest.fn().mockResolvedValue(state()),
  idleLockDisable: jest.fn().mockResolvedValue(state({ isEnabled: false })),
  idleLockLock: jest.fn().mockResolvedValue(state({ isLocked: true })),
  idleLockUnlock: jest.fn().mockResolvedValue(state()),
  idleLockUnlockWithBiometrics: jest.fn().mockResolvedValue(state()),
  idleLockClear: jest.fn().mockResolvedValue(state()),
};

jest.mock("expo-modules-core", () => ({
  requireNativeModule: () => mockNative,
}));

import { PreludeAuthClient } from "../client";
import {
  DisposedError,
  InvalidPasscodeError,
  LockedOutError,
} from "../types/errors";

const options = { thresholdSeconds: 120 };

beforeEach(() => {
  jest.clearAllMocks();
  listeners.length = 0;
});

describe("IdleLock", () => {
  test("start subscribes to native changes and applies the returned state", async () => {
    const client = new PreludeAuthClient();
    const lock = client.idleLock(options);
    const seen: boolean[] = [];
    lock.subscribe(() => seen.push(lock.getState().isLocked));

    expect(lock.getState().isLocked).toBe(false);
    await lock.start();

    expect(mockNative.addListener).toHaveBeenCalledWith("onIdleLockChange", expect.any(Function));
    expect(mockNative.idleLockStart).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ endpoint: expect.anything() }),
      options,
    );
    expect(lock.getState()).toEqual(state({ isLocked: true }));
    expect(seen).toEqual([true]);
  });

  test("native change events for this handle update the state; other handles are ignored", async () => {
    const client = new PreludeAuthClient();
    const lock = client.idleLock(options);
    await lock.start();
    const handle = mockNative.idleLockStart.mock.calls[0][0];
    const notify = jest.fn();
    lock.subscribe(notify);

    listeners[0]({ handle: "someone-else", ...state() });
    expect(lock.getState().isLocked).toBe(true);
    expect(notify).not.toHaveBeenCalled();

    listeners[0]({ handle, ...state() });
    expect(lock.getState().isLocked).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);

    // An identical state is not re-published.
    listeners[0]({ handle, ...state() });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  test("every call applies the state it resolves with", async () => {
    const client = new PreludeAuthClient();
    const lock = client.idleLock(options);
    await lock.start();

    await lock.enableBiometrics();
    expect(lock.getState().isBiometricsEnabled).toBe(true);
    await lock.unlock("1234");
    expect(mockNative.idleLockUnlock).toHaveBeenCalledWith(expect.any(String), "1234");
    expect(lock.getState().isLocked).toBe(false);
    await lock.disable();
    expect(lock.getState().isEnabled).toBe(false);
  });

  test("native lock errors hydrate as typed errors", async () => {
    const client = new PreludeAuthClient();
    const lock = client.idleLock(options);
    await lock.start();

    mockNative.idleLockUnlock.mockRejectedValueOnce({
      code: "invalid_passcode",
      message: "Wrong passcode — 4 attempts left",
    });
    await expect(lock.unlock("0000")).rejects.toBeInstanceOf(InvalidPasscodeError);

    mockNative.idleLockUnlock.mockRejectedValueOnce({ code: "locked_out", message: "Too many attempts" });
    await expect(lock.unlock("0000")).rejects.toBeInstanceOf(LockedOutError);
    // A failed call leaves the mirrored state untouched.
    expect(lock.getState().isLocked).toBe(true);
  });

  test("idleLock returns one instance per client", () => {
    const client = new PreludeAuthClient();
    const lock = client.idleLock(options);
    expect(client.idleLock({ thresholdSeconds: 5 })).toBe(lock);
  });

  test("stop removes the listener and stops natively; a never-started lock skips native", async () => {
    const client = new PreludeAuthClient();
    const lock = client.idleLock(options);
    await lock.stop();
    expect(mockNative.idleLockStop).not.toHaveBeenCalled();

    await lock.start();
    expect(listeners).toHaveLength(1);
    await lock.stop();
    expect(listeners).toHaveLength(0);
    expect(mockNative.idleLockStop).toHaveBeenCalledTimes(1);
  });

  test("dispose stops the lock before dropping the handle", async () => {
    const client = new PreludeAuthClient();
    const lock = client.idleLock(options);
    await lock.start();

    await client.dispose();

    expect(mockNative.idleLockStop).toHaveBeenCalledTimes(1);
    expect(mockNative.dispose).toHaveBeenCalledTimes(1);
    expect(listeners).toHaveLength(0);
    expect(() => client.idleLock(options)).toThrow(DisposedError);
  });
});
