import {
  createElement,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { PreludeAuthClient, PreludeAuthClientOptions } from "../client";
import { createAuthActions } from "./actions";
import { AuthContext } from "./context";
import { RestoreOutcome } from "./restore";
import { createAuthStore } from "./store";

export interface PreludeAuthProviderProps {
  /** Options forwarded to `PreludeAuthClient` if no `client` is supplied. */
  options?: PreludeAuthClientOptions;
  /** Inject a client (tests, multi-tenant apps). The provider will not dispose it. */
  client?: PreludeAuthClient;
  /**
   * Fires once after the silent session-restore probe completes on
   * mount. Useful for hiding a splash, kicking off route decisions,
   * or telemetry — anything that wants a one-shot signal instead of
   * subscribing to `useAuth().stage` transitions.
   */
  onRestored?: (outcome: RestoreOutcome) => void;
  children: ReactNode;
}

export function PreludeAuthProvider({
  options,
  client: externalClient,
  onRestored,
  children,
}: PreludeAuthProviderProps) {
  // `client`, `store`, and `ownsClient` are locked on first mount:
  // changing `options` or swapping `externalClient` afterwards is
  // silently ignored. Construct a fresh provider if you need
  // different settings. `ownsClient.current` records whether we
  // constructed the client (and must dispose it) — read from the
  // ref on cleanup so a parent toggling `externalClient` later
  // can't flip the closure into the wrong branch.
  //
  // StrictMode double-invokes this initializer in dev; that's safe
  // because construction is pure JS (a handle string + config — the
  // native client materializes lazily on first call). The discarded
  // instance is never invoked, so no native resource exists to leak.
  const [client] = useState(
    () => externalClient ?? new PreludeAuthClient(options),
  );
  const ownsClient = useRef(!externalClient);
  const [store] = useState(createAuthStore);
  const { actions, restore } = useMemo(
    () => createAuthActions(client, store),
    [client, store],
  );

  // Ref-store the callback so a parent re-render passing a fresh
  // function identity doesn't re-trigger the restore probe.
  const onRestoredRef = useRef(onRestored);
  onRestoredRef.current = onRestored;
  useEffect(() => {
    let cancelled = false;
    void restore(() => cancelled).then((outcome) => {
      if (outcome) onRestoredRef.current?.(outcome);
    });
    return () => {
      cancelled = true;
    };
  }, [restore]);

  // Defer dispose via `pendingDispose` so StrictMode's unmount →
  // remount cycle in dev can cancel it: the next effect run clears
  // the pending timeout before it fires. Caller-owned clients
  // aren't ours to free.
  const pendingDispose = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (pendingDispose.current !== null) {
      clearTimeout(pendingDispose.current);
      pendingDispose.current = null;
    }
    return () => {
      if (!ownsClient.current) return;
      pendingDispose.current = setTimeout(() => {
        pendingDispose.current = null;
        client.dispose().catch(() => {});
      }, 0);
    };
  }, [client]);

  const value = useMemo(
    () => ({ store, actions, client }),
    [store, actions, client],
  );
  return createElement(AuthContext.Provider, { value }, children);
}
