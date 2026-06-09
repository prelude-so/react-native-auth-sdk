import type { PreludeAuthClient } from "../../client";
import { StepUpChallenge } from "../../types/stepUp";
import { PreludeUser } from "../../types/user";
import { restoreSession } from "../restore";
import { createAuthStore } from "../store";

const mockFn = () => jest.fn() as jest.Mock;

const user: PreludeUser = {
  accessToken: "tok",
  profile: { extras: {} },
};
const challenge: StepUpChallenge = {
  status: "continue",
  challengeID: "c1",
  currentStep: "verify_email",
  requestedScope: "prld:pwd:write",
};

type RestoreClient = Pick<PreludeAuthClient, "refresh" | "getActiveStepUp">;

function clientWith(overrides: Partial<RestoreClient>): RestoreClient {
  return {
    refresh: mockFn().mockResolvedValue(user),
    getActiveStepUp: mockFn().mockResolvedValue(null),
    ...overrides,
  } as unknown as RestoreClient;
}

describe("restoreSession", () => {
  test("refresh + step-up both succeed → signedIn with the challenge", async () => {
    const store = createAuthStore();
    const client = clientWith({
      getActiveStepUp: mockFn().mockResolvedValue(challenge),
    });

    const outcome = await restoreSession(client, store);
    expect(outcome).toEqual({ stage: "signedIn", user, stepUp: challenge });
    const s = store.getSnapshot();
    expect(s.stage).toBe("signedIn");
    expect(s.user).toBe(user);
    expect(s.stepUp).toBe(challenge);
  });

  test("refresh succeeds + step-up throws → signedIn with stepUp: null (does not discard session)", async () => {
    const store = createAuthStore();
    const client = clientWith({
      getActiveStepUp: mockFn().mockRejectedValue(new Error("native bridge gone")),
    });

    const outcome = await restoreSession(client, store);
    expect(outcome).toEqual({ stage: "signedIn", user, stepUp: null });
    const s = store.getSnapshot();
    expect(s.stage).toBe("signedIn");
    expect(s.user).toBe(user);
    expect(s.stepUp).toBeNull();
  });

  test("refresh throws → signedOut, no user", async () => {
    const store = createAuthStore();
    const client = clientWith({
      refresh: mockFn().mockRejectedValue(new Error("no session")),
    });

    const outcome = await restoreSession(client, store);
    expect(outcome).toEqual({ stage: "signedOut" });
    const s = store.getSnapshot();
    expect(s.stage).toBe("signedOut");
    expect(s.user).toBeNull();
  });

  test("isCancelled bails out before writing on the success path", async () => {
    const store = createAuthStore();
    const client = clientWith({});
    let cancelled = false;
    const isCancelled = () => cancelled;

    const promise = restoreSession(client, store, { isCancelled });
    cancelled = true;
    const outcome = await promise;
    expect(outcome).toBeNull();
    expect(store.getSnapshot().stage).toBe("initializing");
  });

  test("isCancelled bails out before writing on the failure path", async () => {
    const store = createAuthStore();
    const client = clientWith({
      refresh: mockFn().mockRejectedValue(new Error("nope")),
    });
    let cancelled = false;
    const isCancelled = () => cancelled;

    const promise = restoreSession(client, store, { isCancelled });
    cancelled = true;
    const outcome = await promise;
    expect(outcome).toBeNull();
    expect(store.getSnapshot().stage).toBe("initializing");
  });
});

describe("restoreSession session-gate (isStale)", () => {
  test("isStale before terminal write skips success path", async () => {
    const store = createAuthStore();
    const client = clientWith({});
    let stale = false;

    const promise = restoreSession(client, store, { isStale: () => stale });
    stale = true;
    const outcome = await promise;
    expect(outcome).toBeNull();
    expect(store.getSnapshot().stage).toBe("initializing");
  });

  test("isStale before terminal write skips failure path", async () => {
    const store = createAuthStore();
    const client = clientWith({
      refresh: mockFn().mockRejectedValue(new Error("nope")),
    });
    let stale = false;

    const promise = restoreSession(client, store, { isStale: () => stale });
    stale = true;
    const outcome = await promise;
    expect(outcome).toBeNull();
    expect(store.getSnapshot().stage).toBe("initializing");
  });
});
