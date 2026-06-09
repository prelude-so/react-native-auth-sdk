import { PreludeAuthClient } from "../client";
import { PreludeAuthError } from "../types/errors";
import { PreludeUser } from "../types/user";

import { AuthActions } from "./actionTypes";
import { useAuthContext, useStoreSlice } from "./context";
import {
  makeScopedPendingSelector,
  selectError,
  selectStage,
  selectUser,
} from "./selectors";
import { AsyncAuthAction, AuthStage } from "./store";

export interface UseAuthValue {
  stage: AuthStage;
  user: PreludeUser | null;
  pending: boolean;
  error: PreludeAuthError | null;
  refresh: AuthActions["refresh"];
  signOut: AuthActions["signOut"];
  changePassword: AuthActions["changePassword"];
  clearError: AuthActions["clearError"];
  /**
   * Escape hatch to the underlying imperative client. Bypasses the
   * hook layer's gating + pending tracking — prefer the hook actions
   * (`signOut`, `refresh`, …) for anything you want surfaced in
   * `pending` / `error`. Sound for read-only diagnostics.
   */
  client: PreludeAuthClient;
}

const SESSION_ACTIONS: ReadonlySet<AsyncAuthAction> = new Set([
  "refresh",
  "signOut",
  "changePassword",
]);
const selectSessionPending = makeScopedPendingSelector(SESSION_ACTIONS);

/**
 * Session-level auth state. For starting a sign-in or step-up
 * flow, reach for `useSignIn` / `useStepUp`. Re-renders only when
 * stage / user / error / session-scope pending change.
 */
export function useAuth(): UseAuthValue {
  const { store, actions, client } = useAuthContext("useAuth");
  return {
    stage: useStoreSlice(store, selectStage),
    user: useStoreSlice(store, selectUser),
    error: useStoreSlice(store, selectError),
    pending: useStoreSlice(store, selectSessionPending),
    refresh: actions.refresh,
    signOut: actions.signOut,
    changePassword: actions.changePassword,
    clearError: actions.clearError,
    client,
  };
}
