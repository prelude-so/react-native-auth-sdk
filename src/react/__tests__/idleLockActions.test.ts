import type { PreludeAuthClient } from "../../client";
import type { IdleLock } from "../../idleLock";
import {
  InvalidPasscodeError,
  LockedOutError,
  LockUnavailableError,
  SessionLockedError,
  UnauthorizedError,
} from "../../types/errors";
import { IdleLockState } from "../../types/idleLock";
import { PreludeUser } from "../../types/user";
import { createAuthActions } from "../actions";
import { createAuthStore } from "../store";

const profile = { extras: {} } as const;
const user: PreludeUser = { accessToken: "tok", profile };

const mockFn = () => jest.fn() as jest.Mock;

function mockClient(overrides: Partial<PreludeAuthClient> = {}): PreludeAuthClient {
  return {
    refresh: mockFn().mockResolvedValue(user),
    logout: mockFn().mockResolvedValue(undefined),
    getProfile: mockFn().mockResolvedValue(profile),
    getAccessToken: mockFn().mockResolvedValue("tok"),
    ...overrides,
  } as unknown as PreludeAuthClient;
}

/** A JS-side lock whose native state the test flips by hand. */
function mockLock(initial: Partial<IdleLockState> = {}) {
  let state: IdleLockState = {
    isLocked: false,
    isEnabled: true,
    isBiometricsEnabled: false,
    isBiometricsAvailable: true,
    ...initial,
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<IdleLockState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  const lock = {
    getState: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    start: mockFn().mockResolvedValue(undefined),
    stop: mockFn().mockResolvedValue(undefined),
    lock: mockFn().mockImplementation(async () => set({ isLocked: true })),
    unlock: mockFn().mockImplementation(async () => set({ isLocked: false })),
    unlockWithBiometrics: mockFn().mockImplementation(async () => set({ isLocked: false })),
    setPasscode: mockFn().mockImplementation(async () => set({ isEnabled: true })),
    enableBiometrics: mockFn().mockImplementation(async () => set({ isBiometricsEnabled: true })),
    disableBiometrics: mockFn().mockImplementation(async () => set({ isBiometricsEnabled: false })),
    disable: mockFn().mockImplementation(async () =>
      set({ isLocked: false, isEnabled: false, isBiometricsEnabled: false }),
    ),
    clear: mockFn().mockImplementation(async () => set({ isLocked: false })),
  };
  return { lock: lock as unknown as IdleLock, set };
}

function signedIn(store: ReturnType<typeof createAuthStore>) {
  store.setState({ stage: "signedIn", user });
}

describe("idle lock actions", () => {
  test("a native seal moves a live session to locked and drops user", () => {
    const store = createAuthStore();
    const { lock, set } = mockLock();
    const { syncLock } = createAuthActions(mockClient(), store, lock);
    lock.subscribe(syncLock);
    signedIn(store);

    set({ isLocked: true });

    const s = store.getSnapshot();
    expect(s.stage).toBe("locked");
    expect(s.user).toBeNull();
  });

  test("a refresh that lands after the seal cannot bring user back", async () => {
    const store = createAuthStore();
    const { lock, set } = mockLock();
    let resolveRefresh!: (u: PreludeUser) => void;
    const client = mockClient({
      refresh: mockFn().mockReturnValue(new Promise<PreludeUser>((r) => (resolveRefresh = r))),
    });
    const { actions, syncLock } = createAuthActions(client, store, lock);
    lock.subscribe(syncLock);
    signedIn(store);

    const refreshing = actions.refresh();
    set({ isLocked: true });
    resolveRefresh(user);
    await refreshing;

    expect(store.getSnapshot().stage).toBe("locked");
    expect(store.getSnapshot().user).toBeNull();
  });

  test("unlock reads the session back from the cache without a refresh", async () => {
    const store = createAuthStore();
    const { lock } = mockLock({ isLocked: true });
    const client = mockClient();
    const { actions, syncLock } = createAuthActions(client, store, lock);
    lock.subscribe(syncLock);
    store.setState({ stage: "locked" });

    const ok = await actions.unlock("1234");

    expect(ok).toBe(true);
    expect(lock.unlock).toHaveBeenCalledWith("1234");
    expect(client.refresh).not.toHaveBeenCalled();
    const s = store.getSnapshot();
    expect(s.stage).toBe("signedIn");
    expect(s.user).toEqual(user);
    expect(s.error).toBeNull();
    expect(s.pending.size).toBe(0);
  });

  test("a lifted seal with no cached session lands on signedOut", async () => {
    const store = createAuthStore();
    const { lock, set } = mockLock({ isLocked: true });
    const client = mockClient({ getProfile: mockFn().mockResolvedValue(null) });
    const { syncLock } = createAuthActions(client, store, lock);
    lock.subscribe(syncLock);
    store.setState({ stage: "locked" });

    set({ isLocked: false });
    await new Promise((r) => setTimeout(r, 0));

    expect(store.getSnapshot().stage).toBe("signedOut");
  });

  test("a wrong passcode keeps the stage and records the error", async () => {
    const store = createAuthStore();
    const { lock } = mockLock({ isLocked: true });
    const error = new InvalidPasscodeError("Wrong passcode — 4 attempts left");
    (lock.unlock as jest.Mock).mockRejectedValue(error);
    const { actions, syncLock } = createAuthActions(mockClient(), store, lock);
    lock.subscribe(syncLock);
    store.setState({ stage: "locked" });

    const ok = await actions.unlock("0000");

    expect(ok).toBeUndefined();
    expect(store.getSnapshot().stage).toBe("locked");
    expect(store.getSnapshot().error).toBe(error);
  });

  test("locked out: signs out, forgets the passcode, keeps the error", async () => {
    const store = createAuthStore();
    const { lock } = mockLock({ isLocked: true });
    const error = new LockedOutError("Too many attempts");
    (lock.unlock as jest.Mock).mockRejectedValue(error);
    const client = mockClient();
    const { actions, syncLock } = createAuthActions(client, store, lock);
    lock.subscribe(syncLock);
    store.setState({ stage: "locked" });

    await actions.unlock("0000");

    expect(client.logout).toHaveBeenCalledTimes(1);
    expect(lock.disable).toHaveBeenCalledTimes(1);
    const s = store.getSnapshot();
    expect(s.stage).toBe("signedOut");
    expect(s.error).toBe(error);
  });

  test("a dead session on refresh forgets the passcode", async () => {
    const store = createAuthStore();
    const { lock } = mockLock();
    const client = mockClient({
      refresh: mockFn().mockRejectedValue(new UnauthorizedError("revoked")),
    });
    const { actions } = createAuthActions(client, store, lock);
    signedIn(store);

    await actions.refresh();

    expect(store.getSnapshot().stage).toBe("signedOut");
    expect(lock.disable).toHaveBeenCalledTimes(1);
  });

  test("a restore that lands on signedOut forgets the passcode; a locked one keeps it", async () => {
    const store = createAuthStore();
    const { lock } = mockLock();
    const client = mockClient({
      refresh: mockFn().mockRejectedValue(new Error("no session")),
    });
    expect(await createAuthActions(client, store, lock).restore(() => false)).toEqual({
      stage: "signedOut",
    });
    expect(lock.disable).toHaveBeenCalledTimes(1);

    const lockedStore = createAuthStore();
    const { lock: lockedLock } = mockLock({ isLocked: true });
    const sealedClient = mockClient({
      refresh: mockFn().mockRejectedValue(new SessionLockedError("sealed")),
    });
    expect(
      await createAuthActions(sealedClient, lockedStore, lockedLock).restore(() => false),
    ).toEqual({ stage: "locked" });
    expect(lockedLock.disable).not.toHaveBeenCalled();
  });

  test("a lifted seal with no cached session forgets the passcode", async () => {
    const store = createAuthStore();
    const { lock, set } = mockLock({ isLocked: true });
    const client = mockClient({ getProfile: mockFn().mockResolvedValue(null) });
    const { syncLock } = createAuthActions(client, store, lock);
    lock.subscribe(syncLock);
    store.setState({ stage: "locked" });

    set({ isLocked: false });
    await new Promise((r) => setTimeout(r, 0));

    expect(store.getSnapshot().stage).toBe("signedOut");
    expect(lock.disable).toHaveBeenCalledTimes(1);
  });

  test("signOut forgets the passcode", async () => {
    const store = createAuthStore();
    const { lock } = mockLock();
    const { actions, syncLock } = createAuthActions(mockClient(), store, lock);
    lock.subscribe(syncLock);
    signedIn(store);

    await actions.signOut();

    expect(lock.disable).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().stage).toBe("signedOut");
    expect(store.getSnapshot().error).toBeNull();
  });

  test("lock action seals and moves to locked", async () => {
    const store = createAuthStore();
    const { lock } = mockLock();
    const { actions, syncLock } = createAuthActions(mockClient(), store, lock);
    lock.subscribe(syncLock);
    signedIn(store);

    expect(await actions.lock()).toBe(true);
    expect(store.getSnapshot().stage).toBe("locked");
    expect(store.getSnapshot().user).toBeNull();
  });

  test("enrollment actions resolve true and report pending under the lock scope", async () => {
    const store = createAuthStore();
    const { lock } = mockLock({ isEnabled: false });
    const { actions } = createAuthActions(mockClient(), store, lock);
    signedIn(store);

    const setting = actions.setPasscode("1234");
    expect(store.getSnapshot().pending.has("setPasscode")).toBe(true);
    expect(await setting).toBe(true);
    expect(await actions.enableBiometrics()).toBe(true);
    expect(await actions.disableBiometrics()).toBe(true);
    expect(await actions.disableIdleLock()).toBe(true);
    expect(store.getSnapshot().pending.size).toBe(0);
    expect(store.getSnapshot().stage).toBe("signedIn");
  });

  test("enrollment actions refuse while locked; the seal and stage stay", async () => {
    const store = createAuthStore();
    const { lock } = mockLock({ isLocked: true, isBiometricsEnabled: true });
    const { actions } = createAuthActions(mockClient(), store, lock);
    store.setState({ stage: "locked" });

    expect(await actions.disableIdleLock()).toBeUndefined();
    expect(await actions.setPasscode("9999")).toBeUndefined();
    expect(await actions.enableBiometrics()).toBeUndefined();
    expect(await actions.disableBiometrics()).toBeUndefined();

    expect(lock.disable).not.toHaveBeenCalled();
    expect(lock.setPasscode).not.toHaveBeenCalled();
    expect(lock.enableBiometrics).not.toHaveBeenCalled();
    expect(lock.disableBiometrics).not.toHaveBeenCalled();
    expect(store.getSnapshot().stage).toBe("locked");
    expect(store.getSnapshot().error).toBeInstanceOf(LockUnavailableError);
  });

  test("without idleLock options every lock action fails with LockUnavailableError", async () => {
    const store = createAuthStore();
    const { actions } = createAuthActions(mockClient(), store);

    expect(await actions.unlock("1234")).toBeUndefined();
    expect(store.getSnapshot().error).toBeInstanceOf(LockUnavailableError);
    expect(await actions.setPasscode("1234")).toBeUndefined();
    expect(await actions.lock()).toBeUndefined();
  });
});
