// Silence React's `act(...) is not supported` warning in jsdom.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement as h, ReactElement } from "react";

import type { PreludeAuthClient } from "../../client";
import type { IdleLock } from "../../idleLock";
import { SessionLockedError } from "../../types/errors";
import { IdleLockState } from "../../types/idleLock";
import { PreludeUser } from "../../types/user";
import { Locked, SignedIn, SignedOut } from "../gates";
import { PreludeAuthProvider } from "../provider";
import { RestoreOutcome } from "../restore";
import { useIdleLock } from "../useIdleLock";

// jsdom-only — the Node project skips.
const hasDOM = typeof document !== "undefined";
type Root = { render: (n: ReactElement) => void; unmount: () => void };
const createRoot: (el: Element) => Root = hasDOM
  ? // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("react-dom/client").createRoot
  : ((() => ({ render() {}, unmount() {} })) as never);
const d = hasDOM ? describe : describe.skip;

jest.mock("../../client", () => ({ PreludeAuthClient: jest.fn() }));

const mockFn = () => jest.fn() as jest.Mock;
const profile = { extras: {} } as const;
const user: PreludeUser = { accessToken: "tok", profile };

/**
 * A lock whose `start()` seals the client: afterwards `refresh`
 * throws `SessionLockedError` and the cached readers return null,
 * until `unlock` lifts it.
 */
function fakeLockAndClient() {
  let sealed = false;
  let state: IdleLockState = {
    isLocked: false,
    isEnabled: true,
    isBiometricsEnabled: false,
    isBiometricsAvailable: false,
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<IdleLockState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  const calls: string[] = [];
  const lock = {
    getState: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    start: mockFn().mockImplementation(async () => {
      calls.push("start");
      sealed = true;
      set({ isLocked: true });
    }),
    stop: mockFn().mockResolvedValue(undefined),
    unlock: mockFn().mockImplementation(async () => {
      sealed = false;
      set({ isLocked: false });
    }),
    disable: mockFn().mockResolvedValue(undefined),
  } as unknown as IdleLock;
  const client = {
    idleLock: mockFn().mockReturnValue(lock),
    refresh: mockFn().mockImplementation(async () => {
      calls.push("refresh");
      if (sealed) throw new SessionLockedError("Unlock the session");
      return user;
    }),
    getActiveStepUp: mockFn().mockResolvedValue(null),
    getProfile: mockFn().mockImplementation(async () => (sealed ? null : profile)),
    getAccessToken: mockFn().mockImplementation(async () => (sealed ? null : "tok")),
    logout: mockFn().mockResolvedValue(undefined),
    dispose: mockFn().mockResolvedValue(undefined),
  } as unknown as PreludeAuthClient;
  return { lock, client, calls, set };
}

function mount(node: ReactElement): { root: Root } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return { root };
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });

type Probe = ReturnType<typeof useIdleLock>;

d("PreludeAuthProvider with idleLock", () => {
  test("starts the lock before the restore probe and lands on locked", async () => {
    const { client, calls } = fakeLockAndClient();
    const onRestored = jest.fn();
    let probe: Probe | undefined;
    function Capture() {
      probe = useIdleLock();
      return null;
    }
    const { root } = mount(
      h(PreludeAuthProvider, {
        client,
        idleLock: { thresholdSeconds: 60 },
        onRestored,
        children: [
          h(Capture, { key: "c" }),
          h(Locked, { key: "l", children: h("span", { id: "locked" }) }),
          h(SignedIn, { key: "s", children: h("span", { id: "signed-in" }) }),
          h(SignedOut, { key: "o", children: h("span", { id: "signed-out" }) }),
        ],
      }),
    );

    await flush();

    expect(client.idleLock).toHaveBeenCalledWith({ thresholdSeconds: 60 });
    expect(calls).toEqual(["start", "refresh"]);
    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(onRestored.mock.calls[0][0]).toEqual<RestoreOutcome>({ stage: "locked" });
    expect(probe?.isConfigured).toBe(true);
    expect(probe?.isLocked).toBe(true);
    expect(document.querySelector("#locked")).not.toBeNull();
    expect(document.querySelector("#signed-in")).toBeNull();
    // Locked is not signed out: the login screen must stay hidden.
    expect(document.querySelector("#signed-out")).toBeNull();

    // Unlock: the session comes back from the cache, no refresh.
    await act(async () => {
      await probe!.unlock("1234");
    });
    await flush();

    expect(calls).toEqual(["start", "refresh"]);
    expect(probe?.isLocked).toBe(false);
    expect(document.querySelector("#locked")).toBeNull();
    expect(document.querySelector("#signed-in")).not.toBeNull();
    expect(document.querySelector("#signed-out")).toBeNull();

    act(() => root.unmount());
  });

  test("a seal while signed in flips the gates without any action", async () => {
    const { client, lock, set } = fakeLockAndClient();
    (lock.start as jest.Mock).mockResolvedValue(undefined);
    const { root } = mount(
      h(PreludeAuthProvider, {
        client,
        idleLock: { thresholdSeconds: 60, lockOnStart: false },
        children: [
          h(Locked, { key: "l", children: h("span", { id: "locked" }) }),
          h(SignedIn, { key: "s", children: h("span", { id: "signed-in" }) }),
        ],
      }),
    );
    await flush();
    expect(document.querySelector("#signed-in")).not.toBeNull();

    act(() => set({ isLocked: true }));

    expect(document.querySelector("#signed-in")).toBeNull();
    expect(document.querySelector("#locked")).not.toBeNull();

    act(() => root.unmount());
  });

  test("without idleLock options the hook reports unconfigured", async () => {
    const { client } = fakeLockAndClient();
    let probe: Probe | undefined;
    function Capture() {
      probe = useIdleLock();
      return null;
    }
    const { root } = mount(h(PreludeAuthProvider, { client, children: h(Capture) }));
    await flush();

    expect(client.idleLock).not.toHaveBeenCalled();
    expect(probe?.isConfigured).toBe(false);
    expect(probe?.isLocked).toBe(false);

    act(() => root.unmount());
  });
});
