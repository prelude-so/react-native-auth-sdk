import { PreludeAuthClient } from "../client";
import { NoActiveStepUpError } from "../types/errors";
import { RedactedString } from "../types/redactedString";

import { AuthActions, AuthRuntime, GatedRestore } from "./actionTypes";
import { createGuarded, Gate } from "./gating";
import { restoreSession } from "./restore";
import { AuthStore } from "./store";

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
): AuthRuntime {
  const otp: Gate = { gen: 0 };
  const stepUp: Gate = { gen: 0 };
  const session: Gate = { gen: 0 };
  const { guarded, projectPending } = createGuarded(store);

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
    async refresh() {
      await guarded("refresh", [session], async (stale) => {
        const user = await client.refresh();
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
    },
    async changePassword(password) {
      return guarded("changePassword", [session], async () => {
        await client.changePassword(new RedactedString(password));
        return true as const;
      });
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
        const challenge = store.getSnapshot().stepUp;
        if (!challenge) {
          throw new NoActiveStepUpError("No active step-up challenge");
        }
        await client.sendStepUpOTP(challenge);
        return true as const;
      });
    },
    async submitStepUpOtp(code) {
      return guarded("submitStepUpOtp", [stepUp, session], async (stale) => {
        const challenge = store.getSnapshot().stepUp;
        if (!challenge) {
          throw new NoActiveStepUpError("No active step-up challenge");
        }
        const next = await client.submitStepUpOTP(challenge, code);
        if (stale()) return undefined;
        store.setState({ stepUp: next });
        return next;
      });
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
  };

  // The cold-start probe only has authority while `stage` is still
  // `initializing` — any user-driven action that moves the stage
  // (login, verifyOtp, cancelOtp) wins, and the probe's late terminal
  // write is dropped. The gate capture covers the one stage-preserving
  // case: a `signOut` whose server logout failed bumps the gate but
  // leaves `initializing` in place.
  const restore: GatedRestore = (isCancelled) => {
    const captured = session.gen;
    return restoreSession(client, store, {
      isCancelled,
      isStale: () =>
        session.gen !== captured ||
        store.getSnapshot().stage !== "initializing",
    });
  };

  return { actions, restore };
}
