// Silence React's `act(...) is not supported` warning in jsdom — the
// tests already wrap renders in `act`, we just need to flag the env.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement as h, ReactElement, StrictMode } from "react";

import type { PreludeAuthClient } from "../../client";
import { StepUpChallenge } from "../../types/stepUp";
import { PreludeUser } from "../../types/user";
import { SignedIn, SignedOut } from "../gates";
import { PreludeAuthProvider } from "../provider";
import { RestoreOutcome } from "../restore";
import { useSignIn } from "../useSignIn";
import { PreludeIdentifier } from "../../types/identifier";

// jsdom-only — the Node project skips. `react-dom/client` is on
// disk via React Native's transitive deps; we `require` it to
// skip the missing `@types/react-dom` in this package without
// polluting the public type surface.
const hasDOM = typeof document !== "undefined";
type Root = { render: (n: ReactElement) => void; unmount: () => void };
const createRoot: (el: Element) => Root = hasDOM
  ? // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("react-dom/client").createRoot
  : ((() => ({ render() {}, unmount() {} })) as never);
const d = hasDOM ? describe : describe.skip;

// Track every internally-constructed PreludeAuthClient so the
// StrictMode test can assert dispose calls regardless of which
// instance React kept after its double-invoked initializer.
const constructed: Array<{ dispose: jest.Mock; refresh: jest.Mock }> = [];
// Mock the whole module — `jest.requireActual` would load the real
// `client.ts`, which pulls in `react-native` and breaks under the
// Node/jsdom test envs. Type-only imports (e.g. `RequestStepUpOptions`)
// are erased at runtime so they need no implementation here.
jest.mock("../../client", () => ({
  PreludeAuthClient: jest.fn().mockImplementation(() => {
    const inst = {
      refresh: jest.fn().mockResolvedValue({
        accessToken: "tok",
        profile: { extras: {} },
      }),
      getActiveStepUp: jest.fn().mockResolvedValue(null),
      dispose: jest.fn().mockResolvedValue(undefined),
    };
    constructed.push(inst);
    return inst;
  }),
}));

const mockFn = () => jest.fn() as jest.Mock;
const user: PreludeUser = { accessToken: "tok", profile: { extras: {} } };
const challenge: StepUpChallenge = {
  status: "continue",
  challengeID: "c1",
  currentStep: "verify_email",
  requestedScope: "prld:pwd:write",
};

type ClientShape = Pick<
  PreludeAuthClient,
  "refresh" | "getActiveStepUp" | "dispose"
>;
function fakeClient(overrides: Partial<ClientShape> = {}): PreludeAuthClient {
  return {
    refresh: mockFn().mockResolvedValue(user),
    getActiveStepUp: mockFn().mockResolvedValue(null),
    dispose: mockFn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as PreludeAuthClient;
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

const flushMicrotasks = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

const totalDispose = () =>
  constructed.reduce((n, c) => n + c.dispose.mock.calls.length, 0);

d("PreludeAuthProvider", () => {
  beforeEach(() => {
    constructed.length = 0;
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("onRestored fires exactly once with the signedIn outcome", async () => {
    const onRestored = jest.fn();
    const client = fakeClient({
      getActiveStepUp: mockFn().mockResolvedValue(challenge),
    });
    const { root } = mount(
      h(PreludeAuthProvider, { client, onRestored, children: h("div", null) }),
    );

    await flushMicrotasks();

    expect(onRestored).toHaveBeenCalledTimes(1);
    const outcome = onRestored.mock.calls[0][0] as RestoreOutcome;
    expect(outcome.stage).toBe("signedIn");
    if (outcome.stage === "signedIn") {
      expect(outcome.user).toBe(user);
      expect(outcome.stepUp).toBe(challenge);
    }

    act(() => root.unmount());
  });

  test("onRestored fires signedOut when refresh rejects", async () => {
    const onRestored = jest.fn();
    const client = fakeClient({
      refresh: mockFn().mockRejectedValue(new Error("no session")),
    });
    const { root } = mount(
      h(PreludeAuthProvider, { client, onRestored, children: h("div", null) }),
    );

    await flushMicrotasks();

    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(onRestored.mock.calls[0][0]).toEqual({ stage: "signedOut" });

    act(() => root.unmount());
  });

  test("external client is never disposed by the provider", async () => {
    const client = fakeClient();
    const { root } = mount(
      h(PreludeAuthProvider, { client, children: h("div", null) }),
    );
    await flushMicrotasks();

    act(() => root.unmount());
    jest.runAllTimers();

    expect(client.dispose).not.toHaveBeenCalled();
  });

  test("internal client is disposed on real unmount", async () => {
    const { root } = mount(h(PreludeAuthProvider, { children: h("div", null) }));
    await flushMicrotasks();
    expect(constructed.length).toBeGreaterThan(0);
    expect(totalDispose()).toBe(0);

    act(() => root.unmount());
    jest.runAllTimers();

    expect(totalDispose()).toBe(1);
  });

  test("StrictMode mount → unmount → mount cycle does not dispose", async () => {
    const { root } = mount(
      h(
        StrictMode,
        null,
        h(PreludeAuthProvider, { children: h("div", null) }),
      ),
    );
    await flushMicrotasks();
    jest.runAllTimers();
    expect(totalDispose()).toBe(0);

    act(() => root.unmount());
    jest.runAllTimers();
    expect(totalDispose()).toBe(1);
  });

  test("changing onRestored after mount does not re-trigger restore", async () => {
    const client = fakeClient();
    const a = jest.fn();
    const b = jest.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        h(PreludeAuthProvider, { client, onRestored: a, children: h("div", null) }),
      );
    });
    await flushMicrotasks();

    act(() => {
      root.render(
        h(PreludeAuthProvider, { client, onRestored: b, children: h("div", null) }),
      );
    });
    await flushMicrotasks();

    expect(client.refresh).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();

    act(() => root.unmount());
  });
});

d("auth gates", () => {
  test("re-auth OTP keeps SignedIn mounted — session is still live", async () => {
    const client = fakeClient({
      startOTPLogin: mockFn().mockResolvedValue(undefined),
    } as Partial<ClientShape>);
    let signIn!: ReturnType<typeof useSignIn>;
    function Grab() {
      signIn = useSignIn();
      return null;
    }
    const { root } = mount(
      h(PreludeAuthProvider, {
        client,
        children: [
          h(Grab, { key: "g" }),
          h(SignedIn, { key: "i", children: h("div", { id: "in" }) }),
          h(SignedOut, { key: "o", children: h("div", { id: "out" }) }),
        ],
      }),
    );
    // Restore probe finds a persisted session → signedIn.
    await flushMicrotasks();
    expect(document.querySelector("#in")).not.toBeNull();
    expect(document.querySelector("#out")).toBeNull();

    // Signed-in user starts a re-auth OTP flow: awaitingOtp with a
    // live session must not flip the gates.
    await act(async () => {
      await signIn.startOtpLogin(PreludeIdentifier.emailAddress("a@b.co"));
    });
    expect(document.querySelector("#in")).not.toBeNull();
    expect(document.querySelector("#out")).toBeNull();

    act(() => root.unmount());
  });

  test("fresh-login OTP renders SignedOut — no session yet", async () => {
    const client = fakeClient({
      refresh: mockFn().mockRejectedValue(new Error("no session")),
      startOTPLogin: mockFn().mockResolvedValue(undefined),
    } as Partial<ClientShape>);
    let signIn!: ReturnType<typeof useSignIn>;
    function Grab() {
      signIn = useSignIn();
      return null;
    }
    const { root } = mount(
      h(PreludeAuthProvider, {
        client,
        children: [
          h(Grab, { key: "g" }),
          h(SignedIn, { key: "i", children: h("div", { id: "in" }) }),
          h(SignedOut, { key: "o", children: h("div", { id: "out" }) }),
        ],
      }),
    );
    await flushMicrotasks();
    expect(document.querySelector("#out")).not.toBeNull();

    await act(async () => {
      await signIn.startOtpLogin(PreludeIdentifier.emailAddress("a@b.co"));
    });
    expect(document.querySelector("#in")).toBeNull();
    expect(document.querySelector("#out")).not.toBeNull();

    act(() => root.unmount());
  });
});
