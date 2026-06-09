import { createAuthStore } from "../store";

describe("createAuthStore", () => {
  test("initial snapshot is in `initializing`", () => {
    const s = createAuthStore();
    const snap = s.getSnapshot();
    expect(snap.stage).toBe("initializing");
    expect(snap.user).toBeNull();
    expect(snap.error).toBeNull();
    expect(snap.pending).toEqual(new Set());
    expect(snap.stepUp).toBeNull();
    expect(snap.otpSentAt).toBeNull();
    expect(snap.pendingIdentifier).toBeNull();
  });

  test("setState merges patches", () => {
    const s = createAuthStore();
    s.setState({ stage: "signedOut" });
    expect(s.getSnapshot().stage).toBe("signedOut");
    expect(s.getSnapshot().user).toBeNull();
    s.setState({ pending: new Set(["refresh"]) });
    expect(s.getSnapshot().stage).toBe("signedOut");
    expect(s.getSnapshot().pending.has("refresh")).toBe(true);
  });

  test("snapshot reference is stable until a write", () => {
    const s = createAuthStore();
    expect(s.getSnapshot()).toBe(s.getSnapshot());
    const before = s.getSnapshot();
    s.setState({ pending: new Set(["refresh"]) });
    expect(s.getSnapshot()).not.toBe(before);
  });

  test("subscribers are called on every write", () => {
    const s = createAuthStore();
    const listener = jest.fn();
    s.subscribe(listener);
    s.setState({ pending: new Set(["refresh"]) });
    s.setState({ pending: new Set() });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("unsubscribe stops further calls", () => {
    const s = createAuthStore();
    const listener = jest.fn();
    const unsubscribe = s.subscribe(listener);
    s.setState({ pending: new Set(["refresh"]) });
    unsubscribe();
    s.setState({ pending: new Set() });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("multiple subscribers all fire", () => {
    const s = createAuthStore();
    const a = jest.fn();
    const b = jest.fn();
    s.subscribe(a);
    s.subscribe(b);
    s.setState({ stage: "signedOut" });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
