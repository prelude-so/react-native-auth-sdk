import { createContext, useContext, useSyncExternalStore } from "react";

import { PreludeAuthClient } from "../client";

import { AuthActions } from "./actionTypes";
import { AuthState, AuthStore } from "./store";

export interface AuthContextValue {
  store: AuthStore;
  actions: AuthActions;
  client: PreludeAuthClient;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** Internal — pulls the provider context with a friendly error. */
export function useAuthContext(hookName: string): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error(`${hookName} must be used inside <PreludeAuthProvider>`);
  }
  return ctx;
}

/**
 * Subscribe to a derived slice of the auth store. Re-renders only
 * when `Object.is(prev, next)` flips for the selected value, so
 * each hook re-renders only on changes to the bits it actually
 * reads. Selectors must return primitives or stable references —
 * a fresh object literal each call would defeat the comparison.
 */
export function useStoreSlice<T>(
  store: AuthStore,
  select: (s: AuthState) => T,
): T {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.getSnapshot()),
    () => select(store.getSnapshot()),
  );
}
