import { PreludeAuthClient } from "../client";
import { IdleLock } from "../idleLock";
import {
  CancelledError,
  LockedOutError,
  LockUnavailableError,
  NoActiveStepUpError,
  TokenReusedError,
  UnauthorizedError,
} from "../types/errors";
import { RedactedString } from "../types/redactedString";
import { StepUpChallenge } from "../types/stepUp";
import { PreludeUser } from "../types/user";

import { AuthActions, AuthRuntime, GatedRestore } from "./actionTypes";
import { createGuarded, Gate } from "./gating";
import { restoreSession } from "./restore";
import { AsyncAuthAction, AuthStore } from "./store";

/**
 * A dismissed system sheet or web page isn't an error — map
 * `CancelledError` to `undefined` so the gate resolves without
 * writing `state.error`.
 */
function swallowCancel(e: unknown): undefined {
  if (e instanceof CancelledError) return undefined;
  throw e;
}

/** The server no longer accepts this session: expired, revoked, or reused. */
function isSessionGone(e: unknown): boolean {
  return e instanceof UnauthorizedError || e instanceof TokenReusedError;
}

/**
 * Gate bumps:
 *   otp     — cancelOtp + signOut
 *   stepUp  — cancelStepUp + signOut
 *   session — signOut bumps twice: at entry (stales work already in
 *             flight) and again right before its terminal setState
 *             (stales any work that started AFTER the entry bump, so
 *             its late setState can't overwrite signedOut). Every
 *             action that writes session state captures this gate.
 *             The provider's restore probe captures it too so a late
 *             refresh can't overwrite a fresh user-driven login.
 */
export function createAuthActions(
  client: PreludeAuthClient,
  store: AuthStore,
  lock: IdleLock | null = null,
): AuthRuntime {
  const otp: Gate = { gen: 0 };
  const stepUp: Gate = { gen: 0 };
  const session: Gate = { gen: 0 };
  const { guarded, projectPending } = createGuarded(store);

  const requireLock = (): IdleLock => {
    if (!lock) {
      throw new LockUnavailableError(
        "Pass idleLock options to PreludeAuthProvider to use the idle lock",
      );
    }
    return lock;
  };

  // Changing or removing the credential while locked would be a way
  // past the lock, and native `disable` does not lift the seal.
  const requireUnlocked = (lock: IdleLock): IdleLock => {
    if (lock.getState().isLocked || store.getSnapshot().stage === "locked") {
      throw new LockUnavailableError("Unlock the session before changing the lock");
    }
    return lock;
  };

  // The passcode belongs to the session that ended; the next user
  // sets their own. Every path to `signedOut` calls this, or a stale
  // credential could seal the next session behind a passcode its
  // user never set. Nothing is left to guard if it fails, so the
  // error is not surfaced.
  const forgetLock = (): Promise<void> =>
    lock?.disable().catch(() => {}) ?? Promise.resolve();

  // The native seal already hides the profile and token; this drops
  // the JS copy too. Bumping the gates stales any session-writing
  // action in flight, so a login or refresh that lands after the
  // seal cannot bring `user` back while locked.
  const lockSession = () => {
    otp.gen++;
    session.gen++;
    store.setState({
      stage: "locked",
      user: null,
      pendingIdentifier: null,
      otpSentAt: null,
    });
  };

  // Reads the session back from the native cache: no network, so an
  // offline unlock works. The cache ignores expiration; the next
  // protected call refreshes if needed.
  let unlocking: Promise<void> | null = null;
  const unlockSession = (): Promise<void> =>
    (unlocking ??= (async () => {
      const captured = session.gen;
      try {
        const [profile, accessToken] = await Promise.all([
          client.getProfile(),
          client.getAccessToken(),
        ]);
        if (session.gen !== captured || store.getSnapshot().stage !== "locked") {
          return;
        }
        if (profile && accessToken) {
          store.setState({ stage: "signedIn", user: { accessToken, profile } });
        } else {
          store.setState({ stage: "signedOut", user: null });
          await forgetLock();
        }
      } catch {
        if (session.gen === captured && store.getSnapshot().stage === "locked") {
          store.setState({ stage: "signedOut", user: null });
          await forgetLock();
        }
      } finally {
        unlocking = null;
      }
    })());

  // While the cold-start probe runs it has authority: a sealed client
  // makes its refresh throw `SessionLocked`, which lands on `locked`.
  // The provider calls this again once the probe settles.
  const syncLock = () => {
    if (!lock) return;
    const { stage } = store.getSnapshot();
    if (stage === "initializing") return;
    if (lock.getState().isLocked) {
      if (stage !== "locked") lockSession();
    } else if (stage === "locked") {
      void unlockSession();
    }
  };

  // Lock actions report success as `true`; `guarded` turns a throw
  // into `undefined` and records the error.
  const lockAction = (
    name: AsyncAuthAction,
    body: (lock: IdleLock) => Promise<void>,
  ) =>
    guarded(name, [], async () => {
      await body(requireLock());
      return true as const;
    });

  // The active challenge is read from `state.stepUp` at call time, so
  // a concurrent `requestStepUp` can't redirect an in-flight step.
  const activeChallenge = (): StepUpChallenge => {
    const challenge = store.getSnapshot().stepUp;
    if (!challenge) throw new NoActiveStepUpError("No active step-up challenge");
    return challenge;
  };

  // Run one step against the active challenge and store what comes
  // back: the next challenge, `null` when the flow completed, or
  // `undefined` when the step was abandoned and nothing should change.
  const advanceStepUp = (
    name: AsyncAuthAction,
    step: (challenge: StepUpChallenge) => Promise<StepUpChallenge | null | undefined>,
  ) =>
    guarded(name, [stepUp, session], async (stale) => {
      const next = await step(activeChallenge());
      if (next === undefined || stale()) return undefined;
      store.setState({ stepUp: next });
      return next;
    });

  const actions: AuthActions = {
    async startOtpLogin(identifier, loginConfigID) {
      await guarded("startOtpLogin", [otp, session], async (stale) => {
        await client.startOTPLogin({ identifier, loginConfigID });
        if (stale()) return;
        store.setState({
          stage: "awaitingOtp",
          pendingIdentifier: identifier,
          otpSentAt: Date.now(),
        });
      });
    },
    async resendOtp() {
      await guarded("resendOtp", [otp, session], async (stale) => {
        await client.resendOTP();
        if (stale()) return;
        store.setState({ otpSentAt: Date.now() });
      });
    },
    async verifyOtp(code) {
      await guarded("verifyOtp", [otp, session], async (stale) => {
        const user = await client.checkOTP(code);
        if (stale()) return;
        store.setState({
          stage: "signedIn",
          user,
          pendingIdentifier: null,
          otpSentAt: null,
        });
      });
    },
    cancelOtp() {
      // Drops in-flight OTP work and rewinds the stage. The rewind
      // target follows the cached session: a signed-in user re-authing
      // via OTP entered `awaitingOtp` with `user` intact, and backing
      // out must return them to `signedIn` — only a fresh login falls
      // back to `signedOut`. Other stages have nothing to rewind.
      otp.gen++;
      const { stage, user } = store.getSnapshot();
      store.setState({
        ...(stage === "awaitingOtp"
          ? {
              stage: user ? ("signedIn" as const) : ("signedOut" as const),
              pendingIdentifier: null,
              otpSentAt: null,
            }
          : {}),
        error: null,
        pending: projectPending(),
      });
    },
    async loginWithPassword(emailAddress, password) {
      await guarded("loginWithPassword", [session], async (stale) => {
        // Re-wrap the plain string in RedactedString here so logs at
        // the native bridge boundary still see `<redacted>`.
        const user = await client.loginWithPassword({
          emailAddress,
          password: new RedactedString(password),
        });
        if (stale()) return;
        // Clear OTP metadata too — the user may have abandoned an
        // `awaitingOtp` flow in favor of a password login, and
        // `pendingIdentifier` / `otpSentAt` are contracted to be null
        // outside `awaitingOtp`.
        store.setState({
          stage: "signedIn",
          user,
          pendingIdentifier: null,
          otpSentAt: null,
        });
      });
    },
    async migrate(legacyToken) {
      await guarded("migrate", [session], async (stale) => {
        // Re-wrap the plain string so logs at the native bridge
        // boundary still see `<redacted>`.
        const user = await client.migrate({
          token: new RedactedString(legacyToken),
        });
        if (stale()) return;
        // Clear OTP metadata too — the user may have abandoned an
        // `awaitingOtp` flow in favor of migrating.
        store.setState({
          stage: "signedIn",
          user,
          pendingIdentifier: null,
          otpSentAt: null,
        });
      });
    },
    async loginWithOAuth(options) {
      return guarded("loginWithOAuth", [session], async (stale) => {
        const result = await client.loginWithOAuth(options).catch(swallowCancel);
        if (result === undefined || stale()) return undefined;
        if (result.kind === "loggedIn") {
          store.setState({
            stage: "signedIn",
            user: result.user,
            pendingIdentifier: null,
            otpSentAt: null,
          });
        }
        // `otpRequired`: provider email still needs verification. Leave
        // the stage untouched and hand the result back to the caller.
        return result;
      });
    },
    async checkOAuthEmailOtp(code, challenge) {
      await guarded("checkOAuthEmailOtp", [session], async (stale) => {
        const user = await client.checkOAuthEmailOTP(code, challenge);
        if (stale()) return;
        // Clear any OTP metadata a prior flow left behind so it
        // stays null outside `awaitingOtp`.
        store.setState({
          stage: "signedIn",
          user,
          pendingIdentifier: null,
          otpSentAt: null,
        });
      });
    },
    async loginWithPasskey(options) {
      await guarded("loginWithPasskey", [session], async (stale) => {
        const user = await client.loginWithPasskey(options).catch(swallowCancel);
        if (user === undefined || stale()) return;
        store.setState({
          stage: "signedIn",
          user,
          pendingIdentifier: null,
          otpSentAt: null,
        });
      });
    },
    async refresh() {
      await guarded("refresh", [session], async (stale) => {
        const refreshed = store.getSnapshot().user;
        let user: PreludeUser;
        try {
          user = await client.refresh();
        } catch (e) {
          // A dead session is a terminal state, not a transient error:
          // move to signedOut so the gates show the login screen. The
          // error is still recorded by `guarded` for the UI. A login
          // that landed meanwhile replaced `user`; leave it alone.
          const unchanged = store.getSnapshot().user === refreshed;
          if (isSessionGone(e) && !stale() && unchanged) {
            store.setState({
              stage: "signedOut",
              user: null,
              pendingIdentifier: null,
              otpSentAt: null,
              stepUp: null,
            });
            await forgetLock();
          }
          throw e;
        }
        if (stale()) return;
        store.setState({
          stage: "signedIn",
          user,
          pendingIdentifier: null,
          otpSentAt: null,
        });
      });
    },
    async signOut() {
      // Tear down every in-flight auth flow up front — the user
      // asked to sign out; a late settle from a parallel verifyOtp
      // / refresh / requestStepUp must not write session state, even
      // if the server-side logout below rejects.
      otp.gen++;
      stepUp.gen++;
      session.gen++;
      const ok = await guarded("signOut", [], async () => {
        await client.logout();
        return true as const;
      });
      if (!ok) {
        // Server logout failed — leave an established local session
        // intact (no `signedOut` write here) so the user sees the
        // error and can retry. `state.error` is populated by
        // `guarded`; in-flight sub-flows are already neutered by the
        // gate bumps above. One exception: if we interrupted the
        // cold-start probe (the entry bump staled it), nothing else
        // will ever resolve the stage — settle `initializing` to
        // `signedOut`, since there is no local session to preserve.
        if (store.getSnapshot().stage === "initializing") {
          store.setState({ stage: "signedOut" });
          await forgetLock();
        }
        return;
      }
      // Second bump: invalidates any session-gated action that
      // started AFTER the entry bump but hasn't reached its terminal
      // setState yet, so its late write can't resurrect a session.
      // `error: null` wipes a failure such an action may have
      // already written while logout was in flight.
      session.gen++;
      store.setState({
        stage: "signedOut",
        user: null,
        pendingIdentifier: null,
        otpSentAt: null,
        stepUp: null,
        error: null,
      });
      await forgetLock();
    },
    async changePassword(password) {
      return guarded("changePassword", [session], async () => {
        await client.changePassword(new RedactedString(password));
        return true as const;
      });
    },
    async registerPasskey(options) {
      return guarded("registerPasskey", [session], async () =>
        client.registerPasskey(options).catch(swallowCancel),
      );
    },
    async requestStepUp(scope) {
      const options = typeof scope === "string" ? { scope } : scope;
      return guarded("requestStepUp", [stepUp, session], async (stale) => {
        const challenge = await client.requestStepUp(options);
        if (stale()) return undefined;
        store.setState({ stepUp: challenge });
        return challenge;
      });
    },
    async sendStepUpOtp() {
      return guarded("sendStepUpOtp", [stepUp, session], async () => {
        await client.sendStepUpOTP(activeChallenge());
        return true as const;
      });
    },
    async submitStepUpOtp(code) {
      return advanceStepUp("submitStepUpOtp", (challenge) =>
        client.submitStepUpOTP(challenge, code),
      );
    },
    async continueStepUpWithPasskey() {
      return advanceStepUp("continueStepUpWithPasskey", (challenge) =>
        client.continueStepUpWithPasskey(challenge).catch(swallowCancel),
      );
    },
    cancelStepUp() {
      // Mirror cancelOtp — clearing the lingering error too keeps
      // consumers from rendering stale step-up failures after the
      // user backs out of the flow.
      stepUp.gen++;
      store.setState({
        stepUp: null,
        error: null,
        pending: projectPending(),
      });
    },
    clearError() {
      store.setState({ error: null });
    },

    async unlock(passcode) {
      return lockAction("unlock", async (lock) => {
        try {
          await lock.unlock(passcode);
        } catch (e) {
          // Attempts are spent: the session is unreachable without a
          // sign-in. `signOut` runs first so the error it clears on
          // entry is not this one.
          if (e instanceof LockedOutError) await actions.signOut();
          throw e;
        }
        // The lock's own change event also triggers this; the second
        // call is a no-op once the stage has moved.
        await unlockSession();
      });
    },
    async unlockWithBiometrics() {
      return lockAction("unlock", async (lock) => {
        await lock.unlockWithBiometrics();
        await unlockSession();
      });
    },
    async lock() {
      return lockAction("lock", async (lock) => {
        await lock.lock();
        syncLock();
      });
    },
    async setPasscode(passcode) {
      return lockAction("setPasscode", (lock) =>
        requireUnlocked(lock).setPasscode(passcode),
      );
    },
    async enableBiometrics() {
      return lockAction("enableBiometrics", (lock) =>
        requireUnlocked(lock).enableBiometrics(),
      );
    },
    async disableBiometrics() {
      return lockAction("disableBiometrics", (lock) =>
        requireUnlocked(lock).disableBiometrics(),
      );
    },
    async disableIdleLock() {
      return lockAction("disableIdleLock", (lock) =>
        requireUnlocked(lock).disable(),
      );
    },
  };

  // The cold-start probe only has authority while `stage` is still
  // `initializing` — any user-driven action that moves the stage
  // (login, verifyOtp, cancelOtp) wins, and the probe's late terminal
  // write is dropped. The gate capture covers the one stage-preserving
  // case: a `signOut` whose server logout failed bumps the gate but
  // leaves `initializing` in place.
  const restore: GatedRestore = async (isCancelled) => {
    const captured = session.gen;
    const outcome = await restoreSession(client, store, {
      isCancelled,
      isStale: () =>
        session.gen !== captured ||
        store.getSnapshot().stage !== "initializing",
    });
    if (outcome?.stage === "signedOut") await forgetLock();
    return outcome;
  };

  return { actions, restore, syncLock };
}
