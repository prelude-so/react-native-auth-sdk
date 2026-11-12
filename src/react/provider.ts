import {
  createElement,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { PreludeAuthClient, PreludeAuthClientOptions } from "../client";
import { IdleLockOptions } from "../types/idleLock";
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
   * Lock the session after `thresholdSeconds` in the background. The
   * lock starts before the session restore, so with `lockOnStart`
   * (the default) a relaunch lands on `stage === "locked"`. Drive the
   * lock screen with `useIdleLock()`. Locked on first mount like the
   * other props.
   */
  idleLock?: IdleLockOptions;
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
  idleLock: idleLockOptions,
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
  // Like `client`, the lock is pure JS until `start()`: the discarded
  // StrictMode instance never reaches the native side.
  const [idleLock] = useState(() =>
    idleLockOptions ? client.idleLock(idleLockOptions) : null,
  );
  const { actions, restore, syncLock } = useMemo(
    () => createAuthActions(client, store, idleLock),
    [client, store, idleLock],
  );

  // Ref-store the callback so a parent re-render passing a fresh
  // function identity doesn't re-trigger the restore probe.
  const onRestoredRef = useRef(onRestored);
  onRestoredRef.current = onRestored;
  useEffect(() => {
    let cancelled = false;
    // The lock starts first: with `lockOnStart` the client is sealed
    // before the probe's refresh, so the probe lands on `locked`
    // rather than reading the session and being locked a moment
    // later. A failed start still runs the probe; the error surfaces
    // on the first lock action.
    const unsubscribe = idleLock?.subscribe(syncLock);
    const started = idleLock ? idleLock.start().catch(() => {}) : Promise.resolve();
    void started.then(() => {
      if (cancelled) return;
      return restore(() => cancelled).then((outcome) => {
        if (outcome) onRestoredRef.current?.(outcome);
        // A seal that raced the probe is reconciled now.
        if (!cancelled) syncLock();
      });
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [idleLock, restore, syncLock]);

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
    () => ({ store, actions, client, idleLock }),
    [store, actions, client, idleLock],
  );
  return createElement(AuthContext.Provider, { value }, children);
}
