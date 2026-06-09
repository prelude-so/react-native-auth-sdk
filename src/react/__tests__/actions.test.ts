import type { PreludeAuthClient } from "../../client";
import { PreludeIdentifier } from "../../types/identifier";
import { NoActiveStepUpError, PreludeAuthError } from "../../types/errors";
import { RedactedString } from "../../types/redactedString";
import { StepUpChallenge } from "../../types/stepUp";
import { PreludeUser } from "../../types/user";
import { createAuthActions } from "../actions";
import { createAuthStore } from "../store";

const profile = { extras: {} } as const;
const user: PreludeUser = { accessToken: "tok", profile };
const challenge: StepUpChallenge = {
  status: "continue",
  challengeID: "c1",
  currentStep: "verify_email",
  requestedScope: "prld:pwd:write",
};

// `mockFn()` is typed as `Mock<never, never[]>` by @types/jest, which
// rejects any value passed to `.mockResolvedValue`. Loosen once here.
const mockFn = () => jest.fn() as jest.Mock;

function mockClient(overrides: Partial<PreludeAuthClient> = {}): PreludeAuthClient {
  return {
    startOTPLogin: mockFn().mockResolvedValue(undefined),
    resendOTP: mockFn().mockResolvedValue(undefined),
    checkOTP: mockFn().mockResolvedValue(user),
    loginWithPassword: mockFn().mockResolvedValue(user),
    refresh: mockFn().mockResolvedValue(user),
    logout: mockFn().mockResolvedValue(undefined),
    requestStepUp: mockFn().mockResolvedValue(challenge),
    sendStepUpOTP: mockFn().mockResolvedValue(undefined),
    submitStepUpOTP: mockFn().mockResolvedValue(null),
    changePassword: mockFn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as PreludeAuthClient;
}

const identifier = PreludeIdentifier.emailAddress("a@b.co");

describe("createAuthActions", () => {
  test("startOtpLogin → awaitingOtp + identifier + sentAt", async () => {
    const store = createAuthStore();
    const client = mockClient();
    const { actions } = createAuthActions(client, store);

    const before = Date.now();
    await actions.startOtpLogin(identifier, "login_cfg_42");

    expect(client.startOTPLogin).toHaveBeenCalledWith({
      identifier,
      loginConfigID: "login_cfg_42",
    });
    const s = store.getSnapshot();
    expect(s.stage).toBe("awaitingOtp");
    expect(s.pendingIdentifier).toBe(identifier);
    expect(s.otpSentAt).not.toBeNull();
    expect(s.otpSentAt!).toBeGreaterThanOrEqual(before);
    expect(s.pending.size).toBe(0);
  });

  test("resendOtp refreshes otpSentAt only", async () => {
    const store = createAuthStore();
    store.setState({ stage: "awaitingOtp", pendingIdentifier: identifier, otpSentAt: 1 });
    const { actions } = createAuthActions(mockClient(), store);

    await actions.resendOtp();
    const s = store.getSnapshot();
    expect(s.stage).toBe("awaitingOtp");
    expect(s.pendingIdentifier).toBe(identifier);
    expect(s.otpSentAt).not.toBe(1);
  });

  test("verifyOtp → signedIn + user, clears pending identifier", async () => {
    const store = createAuthStore();
    store.setState({ stage: "awaitingOtp", pendingIdentifier: identifier, otpSentAt: 1 });
    const { actions } = createAuthActions(mockClient(), store);

    await actions.verifyOtp("123456");
    const s = store.getSnapshot();
    expect(s.stage).toBe("signedIn");
    expect(s.user).toBe(user);
    expect(s.pendingIdentifier).toBeNull();
    expect(s.otpSentAt).toBeNull();
  });

  test("loginWithPassword wraps password in RedactedString", async () => {
    const store = createAuthStore();
    const client = mockClient();
    const { actions } = createAuthActions(client, store);

    await actions.loginWithPassword("a@b.co", "hunter2");
    const arg = (client.loginWithPassword as jest.Mock).mock.calls[0][0] as { emailAddress: string; password: RedactedString };
    expect(arg.emailAddress).toBe("a@b.co");
    expect(arg.password).toBeInstanceOf(RedactedString);
    expect(arg.password.value).toBe("hunter2");
    expect(store.getSnapshot().stage).toBe("signedIn");
  });

  test("loginWithPassword and refresh clear abandoned OTP metadata", async () => {
    const store = createAuthStore();
    const { actions } = createAuthActions(mockClient(), store);

    // User abandons an awaitingOtp flow in favor of a password login.
    store.setState({ stage: "awaitingOtp", pendingIdentifier: identifier, otpSentAt: 1 });
    await actions.loginWithPassword("a@b.co", "hunter2");
    let s = store.getSnapshot();
    expect(s.stage).toBe("signedIn");
    expect(s.pendingIdentifier).toBeNull();
    expect(s.otpSentAt).toBeNull();

    // Same contract for refresh.
    store.setState({ pendingIdentifier: identifier, otpSentAt: 1 });
    await actions.refresh();
    s = store.getSnapshot();
    expect(s.stage).toBe("signedIn");
    expect(s.pendingIdentifier).toBeNull();
    expect(s.otpSentAt).toBeNull();
  });

  test("cancelOtp resets to signedOut without calling the client", () => {
    const store = createAuthStore();
    store.setState({ stage: "awaitingOtp", pendingIdentifier: identifier, otpSentAt: 1 });
    const client = mockClient();
    const { actions } = createAuthActions(client, store);

    actions.cancelOtp();
    expect(store.getSnapshot().stage).toBe("signedOut");
    expect(store.getSnapshot().pendingIdentifier).toBeNull();
    expect(client.startOTPLogin).not.toHaveBeenCalled();
  });

  test("cancelOtp from signedIn clears error only — does not force signedOut", () => {
    const store = createAuthStore();
    store.setState({ stage: "signedIn", user, error: new Error("stale") as never });
    const { actions } = createAuthActions(mockClient(), store);

    actions.cancelOtp();
    const s = store.getSnapshot();
    expect(s.stage).toBe("signedIn");
    expect(s.user).toBe(user);
    expect(s.error).toBeNull();
  });

  test("cancelOtp during a signed-in re-auth falls back to signedIn, not signedOut", async () => {
    const store = createAuthStore();
    store.setState({ stage: "signedIn", user });
    const { actions } = createAuthActions(mockClient(), store);

    // Signed-in user starts a fresh OTP flow (re-auth / identifier
    // change), then backs out — the live session must survive.
    await actions.startOtpLogin(identifier);
    expect(store.getSnapshot().stage).toBe("awaitingOtp");

    actions.cancelOtp();
    const s = store.getSnapshot();
    expect(s.stage).toBe("signedIn");
    expect(s.user).toBe(user);
    expect(s.pendingIdentifier).toBeNull();
    expect(s.otpSentAt).toBeNull();
  });

  test("signOut wipes user, identifier, stepUp", async () => {
    const store = createAuthStore();
    store.setState({
      stage: "signedIn",
      user,
      pendingIdentifier: identifier,
      otpSentAt: 1,
      stepUp: challenge,
    });
    const { actions } = createAuthActions(mockClient(), store);

    await actions.signOut();
    const s = store.getSnapshot();
    expect(s.stage).toBe("signedOut");
    expect(s.user).toBeNull();
    expect(s.pendingIdentifier).toBeNull();
    expect(s.otpSentAt).toBeNull();
    expect(s.stepUp).toBeNull();
  });

  test("requestStepUp stores challenge and returns it", async () => {
    const store = createAuthStore();
    const { actions } = createAuthActions(mockClient(), store);

    const result = await actions.requestStepUp("prld:pwd:write");
    expect(result).toBe(challenge);
    expect(store.getSnapshot().stepUp).toBe(challenge);
  });

  test("sendStepUpOtp surfaces NoActiveStepUpError in state.error and resolves", async () => {
    const store = createAuthStore();
    const { actions } = createAuthActions(mockClient(), store);
    const ok = await actions.sendStepUpOtp();
    expect(ok).toBeUndefined();
    expect(store.getSnapshot().error).toBeInstanceOf(NoActiveStepUpError);
    expect(store.getSnapshot().pending.size).toBe(0);
  });

  test("sendStepUpOtp resolves to `true` on success", async () => {
    const store = createAuthStore();
    store.setState({ stepUp: challenge });
    const { actions } = createAuthActions(mockClient(), store);
    const ok = await actions.sendStepUpOtp();
    expect(ok).toBe(true);
    expect(store.getSnapshot().error).toBeNull();
  });

  test("submitStepUpOtp returns next challenge (or null) and stores it", async () => {
    const store = createAuthStore();
    store.setState({ stepUp: challenge });
    const nextChallenge: StepUpChallenge = { ...challenge, currentStep: "verify_sms" };
    const client = mockClient({
      submitStepUpOTP: mockFn().mockResolvedValue(nextChallenge),
    } as Partial<PreludeAuthClient>);
    const { actions } = createAuthActions(client, store);

    const result = await actions.submitStepUpOtp("000000");
    expect(result).toBe(nextChallenge);
    expect(store.getSnapshot().stepUp).toBe(nextChallenge);
  });

  test("submitStepUpOtp returning null clears the challenge", async () => {
    const store = createAuthStore();
    store.setState({ stepUp: challenge });
    const { actions } = createAuthActions(mockClient(), store);

    const result = await actions.submitStepUpOtp("000000");
    expect(result).toBeNull();
    expect(store.getSnapshot().stepUp).toBeNull();
  });

  test("client errors populate error state and flip pending back (no rethrow)", async () => {
    const store = createAuthStore();
    const boom = new Error("nope");
    const client = mockClient({
      startOTPLogin: mockFn().mockRejectedValue(boom),
    } as Partial<PreludeAuthClient>);
    const { actions } = createAuthActions(client, store);

    await actions.startOtpLogin(identifier);
    const s = store.getSnapshot();
    // Plain Errors are wrapped into PreludeAuthError so state.error
    // stays well-typed; the message survives the wrap.
    expect(s.error).toBeInstanceOf(PreludeAuthError);
    expect(s.error?.message).toBe("nope");
    expect(s.pending.size).toBe(0);
    expect(s.stage).toBe("initializing"); // never advanced past the failure
  });

  test("a successful action clears any prior error", async () => {
    const store = createAuthStore();
    store.setState({ error: new Error("stale") as never });
    const { actions } = createAuthActions(mockClient(), store);

    await actions.refresh();
    expect(store.getSnapshot().error).toBeNull();
  });

  test("clearError nulls the error field without touching anything else", () => {
    const store = createAuthStore();
    store.setState({ stage: "signedOut", error: new Error("x") as never });
    const { actions } = createAuthActions(mockClient(), store);

    actions.clearError();
    const s = store.getSnapshot();
    expect(s.error).toBeNull();
    expect(s.stage).toBe("signedOut");
  });

  test("changePassword wraps the password in RedactedString and stays signedIn", async () => {
    const store = createAuthStore();
    store.setState({ stage: "signedIn", user });
    const client = mockClient();
    const { actions } = createAuthActions(client, store);

    const ok = await actions.changePassword("newhunter2");
    expect(ok).toBe(true);
    const arg = (client.changePassword as jest.Mock).mock.calls[0][0] as RedactedString;
    expect(arg).toBeInstanceOf(RedactedString);
    expect(arg.value).toBe("newhunter2");
    expect(store.getSnapshot().stage).toBe("signedIn");
    expect(store.getSnapshot().pending.size).toBe(0);
    expect(store.getSnapshot().error).toBeNull();
  });

  test("changePassword resolves to `undefined` on failure", async () => {
    const store = createAuthStore();
    store.setState({ stage: "signedIn", user });
    const client = mockClient({
      changePassword: mockFn().mockRejectedValue(new Error("policy")),
    } as Partial<PreludeAuthClient>);
    const { actions } = createAuthActions(client, store);

    const ok = await actions.changePassword("weak");
    expect(ok).toBeUndefined();
    expect(store.getSnapshot().error).toBeTruthy();
  });

  test("cancelStepUp clears both the active challenge and any prior error", () => {
    const store = createAuthStore();
    store.setState({ stepUp: challenge, error: new Error("prev") as never });
    const { actions } = createAuthActions(mockClient(), store);

    actions.cancelStepUp();
    const s = store.getSnapshot();
    expect(s.stepUp).toBeNull();
    expect(s.error).toBeNull();
  });

  test("concurrent actions keep `pending` true until the last one settles", async () => {
    const store = createAuthStore();
    let resolveRefresh!: (u: PreludeUser) => void;
    let resolveLogout!: () => void;
    const refreshPromise = new Promise<PreludeUser>((r) => {
      resolveRefresh = r;
    });
    const logoutPromise = new Promise<void>((r) => {
      resolveLogout = r;
    });
    const client = mockClient({
      refresh: mockFn().mockReturnValue(refreshPromise),
      logout: mockFn().mockReturnValue(logoutPromise),
    } as Partial<PreludeAuthClient>);
    const { actions } = createAuthActions(client, store);

    const refreshing = actions.refresh();
    const signingOut = actions.signOut();
    // Let microtasks flush so the run() entry has set pending.
    await Promise.resolve();
    expect(store.getSnapshot().pending.size).toBeGreaterThan(0);

    resolveRefresh(user);
    await refreshing;
    expect(store.getSnapshot().pending.size).toBeGreaterThan(0);

    resolveLogout();
    await signingOut;
    expect(store.getSnapshot().pending.size).toBe(0);
  });

  // ---- Cancel-race coverage ----
  // Every cancellable action must resolve to `undefined` when a
  // cancel races with its in-flight call, and must NOT stomp the
  // store state the cancel just reset.

  test("cancelOtp drops pending immediately, before the client call settles", async () => {
    const store = createAuthStore();
    let resolveStart!: () => void;
    const startPromise = new Promise<void>((r) => {
      resolveStart = r;
    });
    const client = mockClient({
      startOTPLogin: mockFn().mockReturnValue(startPromise),
    } as Partial<PreludeAuthClient>);
    const { actions } = createAuthActions(client, store);

    const starting = actions.startOtpLogin(identifier);
    await Promise.resolve();
    expect(store.getSnapshot().pending.has("startOtpLogin")).toBe(true);

    actions.cancelOtp();
    expect(store.getSnapshot().pending.size).toBe(0);

    resolveStart();
    await starting;
    expect(store.getSnapshot().pending.size).toBe(0);
  });

  test("signOut bumps gates even on logout failure (no late-settle resurrection)", async () => {
    const store = createAuthStore();
    let resolveRefresh!: (u: PreludeUser) => void;
    const refreshPromise = new Promise<PreludeUser>((r) => {
      resolveRefresh = r;
    });
    const client = mockClient({
      refresh: mockFn().mockReturnValue(refreshPromise),
      logout: mockFn().mockRejectedValue(new Error("network")),
    } as Partial<PreludeAuthClient>);
    const { actions } = createAuthActions(client, store);

    const refreshing = actions.refresh();
    await actions.signOut();
    // Logout failed → state.error is set. The entry bump staled the
    // cold-start probe, so signOut settles `initializing` itself —
    // otherwise nothing would ever clear the loading stage.
    expect(store.getSnapshot().error).toBeTruthy();
    expect(store.getSnapshot().stage).toBe("signedOut");

    // The racing refresh must NOT flip the user to signedIn — gates
    // were bumped up front despite the logout failure.
    resolveRefresh(user);
    await expect(refreshing).resolves.toBeUndefined();
    expect(store.getSnapshot().stage).toBe("signedOut");
    expect(store.getSnapshot().user).toBeNull();
  });

  test("failed signOut leaves an established session intact", async () => {
    const store = createAuthStore();
    store.setState({ stage: "signedIn", user });
    const client = mockClient({
      logout: mockFn().mockRejectedValue(new Error("network")),
    } as Partial<PreludeAuthClient>);
    const { actions } = createAuthActions(client, store);

    await actions.signOut();
    const s = store.getSnapshot();
    expect(s.stage).toBe("signedIn");
    expect(s.user).toBe(user);
    expect(s.error).toBeTruthy();
  });

  test("cancelStepUp drops sendStepUpOtp pending immediately", async () => {
    const store = createAuthStore();
    store.setState({ stepUp: challenge });
    let resolveSend!: () => void;
    const sendPromise = new Promise<void>((r) => {
      resolveSend = r;
    });
    const client = mockClient({
      sendStepUpOTP: mockFn().mockReturnValue(sendPromise),
    } as Partial<PreludeAuthClient>);
    const { actions } = createAuthActions(client, store);

    const sending = actions.sendStepUpOtp();
    await Promise.resolve();
    expect(store.getSnapshot().pending.has("sendStepUpOtp")).toBe(true);

    actions.cancelStepUp();
    expect(store.getSnapshot().pending.size).toBe(0);

    resolveSend();
    await sending;
    expect(store.getSnapshot().pending.size).toBe(0);
  });

  test("cancelOtp mid startOtpLogin keeps signedOut", async () => {
    const store = createAuthStore();
    store.setState({ stage: "signedOut" });
    let resolveStart!: () => void;
    const startPromise = new Promise<void>((r) => {
      resolveStart = r;
    });
    const client = mockClient({
      startOTPLogin: mockFn().mockReturnValue(startPromise),
    } as Partial<PreludeAuthClient>);
    const { actions } = createAuthActions(client, store);

    const starting = actions.startOtpLogin(identifier);
    await Promise.resolve();
    actions.cancelOtp();
    resolveStart();
    await expect(starting).resolves.toBeUndefined();

    const s = store.getSnapshot();
    expect(s.stage).toBe("signedOut");
    expect(s.pendingIdentifier).toBeNull();
    expect(s.otpSentAt).toBeNull();
    expect(s.error).toBeNull();
    expect(s.pending.size).toBe(0);
  });

  test("cancelOtp mid resendOtp leaves otpSentAt cleared", async () => {
    const store = createAuthStore();
    store.setState({ stage: "awaitingOtp", pendingIdentifier: identifier, otpSentAt: 1 });
    let resolveResend!: () => void;
    const resendPromise = new Promise<void>((r) => {
      resolveResend = r;
    });
    const client = mockClient({
      resendOTP: mockFn().mockReturnValue(resendPromise),
    } as Partial<PreludeAuthClient>);
    const { actions } = createAuthActions(client, store);

    const resending = actions.resendOtp();
    await Promise.resolve();
    actions.cancelOtp();
    resolveResend();
    await expect(resending).resolves.toBeUndefined();

    const s = store.getSnapshot();
    expect(s.stage).toBe("signedOut");
    expect(s.otpSentAt).toBeNull();
    expect(s.error).toBeNull();
  });

  test("cancelOtp mid verifyOtp does not flip to signedIn", async () => {
    const store = createAuthStore();
    store.setState({ stage: "awaitingOtp", pendingIdentifier: identifier, otpSentAt: 1 });
    let resolveCheck!: (u: PreludeUser) => void;
    const checkPromise = new Promise<PreludeUser>((r) => {
      resolveCheck = r;
    });
    const client = mockClient({
      checkOTP: mockFn().mockReturnValue(checkPromise),
    } as Partial<PreludeAuthClient>);
    const { actions } = createAuthActions(client, store);

    const verifying = actions.verifyOtp("123456");
    await Promise.resolve();
    actions.cancelOtp();
    resolveCheck(user);
    await expect(verifying).resolves.toBeUndefined();

    const s = store.getSnapshot();
    expect(s.stage).toBe("signedOut");
    expect(s.user).toBeNull();
    expect(s.pendingIdentifier).toBeNull();
    expect(s.otpSentAt).toBeNull();
    expect(s.error).toBeNull();
    expect(s.pending.size).toBe(0);
  });

  test("cancelOtp mid failing verifyOtp skips the error write", async () => {
    const store = createAuthStore();
    store.setState({ stage: "awaitingOtp", pendingIdentifier: identifier, otpSentAt: 1 });
    let rejectCheck!: (e: Error) => void;
    const checkPromise = new Promise<PreludeUser>((_, rej) => {
      rejectCheck = rej;
    });
    const client = mockClient({
      checkOTP: mockFn().mockReturnValue(checkPromise),
    } as Partial<PreludeAuthClient>);
    const { actions } = createAuthActions(client, store);

    const verifying = actions.verifyOtp("000000");
    await Promise.resolve();
    actions.cancelOtp();
    rejectCheck(new Error("wrong code"));
    await expect(verifying).resolves.toBeUndefined();

    const s = store.getSnapshot();
    expect(s.stage).toBe("signedOut");
    expect(s.error).toBeNull();
    expect(s.pending.size).toBe(0);
  });

  test("cancelStepUp mid requestStepUp does not write stepUp", async () => {
    const store = createAuthStore();
    let resolveRequest!: (c: StepUpChallenge) => void;
    const requestPromise = new Promise<StepUpChallenge>((r) => {
      resolveRequest = r;
    });
    const client = mockClient({
      requestStepUp: mockFn().mockReturnValue(requestPromise),
    } as Partial<PreludeAuthClient>);
    const { actions } = createAuthActions(client, store);

    const requesting = actions.requestStepUp("prld:pwd:write");
    await Promise.resolve();
    actions.cancelStepUp();
    resolveRequest(challenge);
    await expect(requesting).resolves.toBeUndefined();

    const s = store.getSnapshot();
    expect(s.stepUp).toBeNull();
    expect(s.error).toBeNull();
  });

  test("cancelStepUp mid sendStepUpOtp skips the error write", async () => {
    const store = createAuthStore();
    store.setState({ stepUp: challenge });
    let rejectSend!: (e: Error) => void;
    const sendPromise = new Promise<void>((_, rej) => {
      rejectSend = rej;
    });
    const client = mockClient({
      sendStepUpOTP: mockFn().mockReturnValue(sendPromise),
    } as Partial<PreludeAuthClient>);
    const { actions } = createAuthActions(client, store);

    const sending = actions.sendStepUpOtp();
    await Promise.resolve();
    actions.cancelStepUp();
    rejectSend(new Error("network"));
    await expect(sending).resolves.toBeUndefined();

    const s = store.getSnapshot();
    expect(s.stepUp).toBeNull();
    expect(s.error).toBeNull();
  });

  test("cancelStepUp mid submitStepUpOtp does not restore the challenge", async () => {
    const store = createAuthStore();
    store.setState({ stepUp: challenge });
    let resolveSubmit!: (c: StepUpChallenge | null) => void;
    const submitPromise = new Promise<StepUpChallenge | null>((r) => {
      resolveSubmit = r;
    });
    const client = mockClient({
      submitStepUpOTP: mockFn().mockReturnValue(submitPromise),
    } as Partial<PreludeAuthClient>);
    const { actions } = createAuthActions(client, store);

    const submitting = actions.submitStepUpOtp("000000");
    await Promise.resolve();
    actions.cancelStepUp();
    resolveSubmit({ ...challenge, currentStep: "verify_sms" });
    await expect(submitting).resolves.toBeUndefined();

    const s = store.getSnapshot();
    expect(s.stepUp).toBeNull();
    expect(s.error).toBeNull();
    expect(s.pending.size).toBe(0);
  });

  // ---- signOut-race coverage ----
  // A signOut completing while another auth action is in flight
  // must collapse that action into `undefined` and leave the final
  // state at signedOut — late commits must not restore session
  // state. signOut bumps every gate just before its terminal write.

  test("signOut wins over a refresh started after its entry bump", async () => {
    const store = createAuthStore();
    let resolveLogout!: () => void;
    let resolveRefresh!: (u: PreludeUser) => void;
    const logoutPromise = new Promise<void>((r) => {
      resolveLogout = r;
    });
    const refreshPromise = new Promise<PreludeUser>((r) => {
      resolveRefresh = r;
    });
    const client = mockClient({
      refresh: mockFn().mockReturnValue(refreshPromise),
      logout: mockFn().mockReturnValue(logoutPromise),
    } as Partial<PreludeAuthClient>);
    const { actions } = createAuthActions(client, store);

    // signOut bumps the session gate, then blocks on logout.
    const signingOut = actions.signOut();
    await Promise.resolve();
    // Refresh started AFTER the entry bump captures the new gen, so
    // the entry-bump alone wouldn't stale it. The exit bump must.
    const refreshing = actions.refresh();
    await Promise.resolve();

    resolveLogout();
    await signingOut;
    expect(store.getSnapshot().stage).toBe("signedOut");
    expect(store.getSnapshot().user).toBeNull();

    resolveRefresh(user);
    await expect(refreshing).resolves.toBeUndefined();
    expect(store.getSnapshot().stage).toBe("signedOut");
    expect(store.getSnapshot().user).toBeNull();
  });

  test("signOut clears an error a racing action wrote before logout settled", async () => {
    const store = createAuthStore();
    let resolveLogout!: () => void;
    let rejectRefresh!: (e: Error) => void;
    const logoutPromise = new Promise<void>((r) => {
      resolveLogout = r;
    });
    const refreshPromise = new Promise<PreludeUser>((_, rej) => {
      rejectRefresh = rej;
    });
    const client = mockClient({
      refresh: mockFn().mockReturnValue(refreshPromise),
      logout: mockFn().mockReturnValue(logoutPromise),
    } as Partial<PreludeAuthClient>);
    const { actions } = createAuthActions(client, store);

    const signingOut = actions.signOut();
    await Promise.resolve();
    // Started after the entry bump, so it isn't stale yet — its
    // failure writes `state.error` while logout is still in flight.
    const refreshing = actions.refresh();
    await Promise.resolve();
    rejectRefresh(new Error("server"));
    await expect(refreshing).resolves.toBeUndefined();
    expect(store.getSnapshot().error).not.toBeNull();

    resolveLogout();
    await signingOut;
    const s = store.getSnapshot();
    expect(s.stage).toBe("signedOut");
    expect(s.error).toBeNull();
  });

  test("signOut mid refresh: late refresh state stays signedOut", async () => {
    const store = createAuthStore();
    let resolveRefresh!: (u: PreludeUser) => void;
    const refreshPromise = new Promise<PreludeUser>((r) => {
      resolveRefresh = r;
    });
    const client = mockClient({
      refresh: mockFn().mockReturnValue(refreshPromise),
    } as Partial<PreludeAuthClient>);
    const { actions } = createAuthActions(client, store);

    const refreshing = actions.refresh();
    await actions.signOut();
    resolveRefresh(user);
    await expect(refreshing).resolves.toBeUndefined();

    const s = store.getSnapshot();
    expect(s.stage).toBe("signedOut");
    expect(s.user).toBeNull();
  });

  test("signOut mid verifyOtp: late verify no signedIn flicker survives", async () => {
    const store = createAuthStore();
    store.setState({ stage: "awaitingOtp", pendingIdentifier: identifier, otpSentAt: 1 });
    let resolveCheck!: (u: PreludeUser) => void;
    const checkPromise = new Promise<PreludeUser>((r) => {
      resolveCheck = r;
    });
    const client = mockClient({
      checkOTP: mockFn().mockReturnValue(checkPromise),
    } as Partial<PreludeAuthClient>);
    const { actions } = createAuthActions(client, store);

    const verifying = actions.verifyOtp("123456");
    await actions.signOut();
    resolveCheck(user);
    await expect(verifying).resolves.toBeUndefined();

    const s = store.getSnapshot();
    expect(s.stage).toBe("signedOut");
    expect(s.user).toBeNull();
    expect(s.pendingIdentifier).toBeNull();
  });

  test("signOut mid loginWithPassword: late login state stays signedOut", async () => {
    const store = createAuthStore();
    let resolveLogin!: (u: PreludeUser) => void;
    const loginPromise = new Promise<PreludeUser>((r) => {
      resolveLogin = r;
    });
    const client = mockClient({
      loginWithPassword: mockFn().mockReturnValue(loginPromise),
    } as Partial<PreludeAuthClient>);
    const { actions } = createAuthActions(client, store);

    const loggingIn = actions.loginWithPassword("a@b.co", "hunter2");
    await actions.signOut();
    resolveLogin(user);
    await expect(loggingIn).resolves.toBeUndefined();

    const s = store.getSnapshot();
    expect(s.stage).toBe("signedOut");
    expect(s.user).toBeNull();
  });

  test("signOut mid requestStepUp: late request stepUp stays null", async () => {
    const store = createAuthStore();
    let resolveRequest!: (c: StepUpChallenge) => void;
    const requestPromise = new Promise<StepUpChallenge>((r) => {
      resolveRequest = r;
    });
    const client = mockClient({
      requestStepUp: mockFn().mockReturnValue(requestPromise),
    } as Partial<PreludeAuthClient>);
    const { actions } = createAuthActions(client, store);

    const requesting = actions.requestStepUp("prld:pwd:write");
    await actions.signOut();
    resolveRequest(challenge);
    await expect(requesting).resolves.toBeUndefined();

    const s = store.getSnapshot();
    expect(s.stage).toBe("signedOut");
    expect(s.stepUp).toBeNull();
  });

  test("signOut mid failing changePassword: late failure error stays cleared", async () => {
    const store = createAuthStore();
    let rejectChange!: (e: Error) => void;
    const changePromise = new Promise<void>((_, rej) => {
      rejectChange = rej;
    });
    const client = mockClient({
      changePassword: mockFn().mockReturnValue(changePromise),
    } as Partial<PreludeAuthClient>);
    const { actions } = createAuthActions(client, store);

    const changing = actions.changePassword("newpass");
    await actions.signOut();
    rejectChange(new Error("server"));
    await expect(changing).resolves.toBeUndefined();

    const s = store.getSnapshot();
    expect(s.stage).toBe("signedOut");
    expect(s.error).toBeNull();
  });

  // ---- restore-race coverage ----
  // The cold-start probe must defer to any user-driven action that
  // lands while it is still in flight: a login completing during
  // init owns the session, and the probe's late terminal write
  // (either path) must be dropped.

  test("restore failure cannot overwrite a login that landed during init", async () => {
    const store = createAuthStore();
    let rejectProbe!: (e: Error) => void;
    const probePromise = new Promise<PreludeUser>((_, rej) => {
      rejectProbe = rej;
    });
    const client = mockClient({
      refresh: mockFn().mockReturnValue(probePromise),
    } as Partial<PreludeAuthClient>);
    const { actions, restore } = createAuthActions(client, store);

    const probing = restore(() => false);
    await actions.loginWithPassword("a@b.co", "hunter2");
    expect(store.getSnapshot().stage).toBe("signedIn");

    rejectProbe(new Error("no persisted session"));
    await expect(probing).resolves.toBeNull();
    const s = store.getSnapshot();
    expect(s.stage).toBe("signedIn");
    expect(s.user).toBe(user);
  });

  test("restore success cannot overwrite a verifyOtp that landed during init", async () => {
    const store = createAuthStore();
    const staleUser: PreludeUser = { accessToken: "stale", profile };
    let resolveProbe!: (u: PreludeUser) => void;
    const probePromise = new Promise<PreludeUser>((r) => {
      resolveProbe = r;
    });
    const client = mockClient({
      refresh: mockFn().mockReturnValue(probePromise),
    } as Partial<PreludeAuthClient>);
    const { actions, restore } = createAuthActions(client, store);

    const probing = restore(() => false);
    store.setState({ stage: "awaitingOtp", pendingIdentifier: identifier, otpSentAt: 1 });
    await actions.verifyOtp("123456");
    expect(store.getSnapshot().user).toBe(user);

    resolveProbe(staleUser);
    await expect(probing).resolves.toBeNull();
    const s = store.getSnapshot();
    expect(s.stage).toBe("signedIn");
    expect(s.user).toBe(user);
  });

  test("two overlapping calls with the same name keep pending true until both settle", async () => {
    const store = createAuthStore();
    let resolveA!: (u: PreludeUser) => void;
    let resolveB!: (u: PreludeUser) => void;
    const pA = new Promise<PreludeUser>((r) => {
      resolveA = r;
    });
    const pB = new Promise<PreludeUser>((r) => {
      resolveB = r;
    });
    const refresh = mockFn()
      .mockReturnValueOnce(pA)
      .mockReturnValueOnce(pB);
    const { actions } = createAuthActions(
      mockClient({ refresh } as Partial<PreludeAuthClient>),
      store,
    );

    const a = actions.refresh();
    const b = actions.refresh();
    await Promise.resolve();
    expect(store.getSnapshot().pending.has("refresh")).toBe(true);

    resolveA(user);
    await a;
    expect(store.getSnapshot().pending.has("refresh")).toBe(true);

    resolveB(user);
    await b;
    expect(store.getSnapshot().pending.has("refresh")).toBe(false);
    expect(store.getSnapshot().pending.size).toBe(0);
  });

  test("each action only adds its own name to the pending set", async () => {
    const store = createAuthStore();
    let resolveRefresh!: (u: PreludeUser) => void;
    const refreshPromise = new Promise<PreludeUser>((r) => {
      resolveRefresh = r;
    });
    const client = mockClient({
      refresh: mockFn().mockReturnValue(refreshPromise),
    } as Partial<PreludeAuthClient>);
    const { actions } = createAuthActions(client, store);

    const refreshing = actions.refresh();
    await Promise.resolve();
    expect(store.getSnapshot().pending.has("refresh")).toBe(true);
    expect(store.getSnapshot().pending.has("signOut")).toBe(false);

    resolveRefresh(user);
    await refreshing;
    expect(store.getSnapshot().pending.size).toBe(0);
  });
});
