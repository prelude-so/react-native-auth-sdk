import { ReactNode } from "react";

import { useAuth } from "./useAuth";

/**
 * Renders children while a live session exists (`user` is set).
 * Inverse of `SignedOut`. Gating on the session — not on `stage` —
 * keeps the authenticated subtree mounted when a signed-in user
 * enters a re-auth OTP flow (`awaitingOtp` with `user` intact);
 * unmounting it there would tear down effects, refs, and timers
 * despite an active session. When the gate does flip, the whole
 * subtree unmounts and every effect cleanup runs.
 */
export function SignedIn({ children }: { children: ReactNode }): ReactNode {
  return useAuth().user !== null ? children : null;
}

/**
 * Renders children while no session exists: signed out, or mid
 * sign-in (awaiting a first-login OTP). A re-auth OTP flow stays on
 * the `SignedIn` side — the session is still live. Check
 * `useAuth().stage === "awaitingOtp"` for finer control.
 */
export function SignedOut({ children }: { children: ReactNode }): ReactNode {
  const { stage, user } = useAuth();
  return user === null && stage !== "initializing" ? children : null;
}

/**
 * Renders children while the SDK is still restoring a cached
 * session on mount. Pair with a splash screen — keep the rest of
 * the tree hidden until restore settles to avoid a "signed out
 * flicker" on app open.
 */
export function AuthLoading({ children }: { children: ReactNode }): ReactNode {
  return useAuth().stage === "initializing" ? children : null;
}
