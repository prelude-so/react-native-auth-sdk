import { fromNativeError, PreludeAuthError } from "../types/errors";
import { AsyncAuthAction, AuthStore } from "./store";

/**
 * Cancel/teardown coordination. Each gate is a monotonic counter; an
 * in-flight action captures the gate value at entry, and any later
 * settlement is treated as cancelled if the value has moved.
 */
export type Gate = { gen: number };

export interface Guarded {
  /**
   * Run a guarded action. Tracks the entry in `pending` for the hook
   * layer; cancellations remove it immediately (the underlying
   * promise still settles, but `stale()` gates any terminal write).
   * Failures populate `state.error` only when not stale; success /
   * throw / stale all collapse to `undefined`. The body receives
   * `stale()` so it can gate its own `store.setState`.
   */
  guarded: <T>(
    name: AsyncAuthAction,
    gates: ReadonlyArray<Gate>,
    body: (stale: () => boolean) => Promise<T>,
  ) => Promise<T | undefined>;
  /** Live in-flight action names, with stale (cancelled) entries dropped. */
  projectPending: () => Set<AsyncAuthAction>;
}

export function createGuarded(store: AuthStore): Guarded {
  // Each entry remembers its gate captures so `projectPending` can
  // drop entries the user has already cancelled — pending goes false
  // the moment cancel fires, not when the underlying client call
  // eventually settles. Hooks scope `pending` to their action group,
  // so an unrelated button doesn't disable mid-action.
  type InFlight = {
    name: AsyncAuthAction;
    gates: ReadonlyArray<Gate>;
    captured: ReadonlyArray<number>;
  };
  const inFlight = new Set<InFlight>();

  const projectPending = (): Set<AsyncAuthAction> => {
    const s = new Set<AsyncAuthAction>();
    inFlight.forEach((e) => {
      if (!e.gates.some((g, i) => g.gen !== e.captured[i])) s.add(e.name);
    });
    return s;
  };

  const guarded = async <T>(
    name: AsyncAuthAction,
    gates: ReadonlyArray<Gate>,
    body: (stale: () => boolean) => Promise<T>,
  ): Promise<T | undefined> => {
    const captured = gates.map((g) => g.gen);
    const stale = () => gates.some((g, i) => g.gen !== captured[i]);
    const entry: InFlight = { name, gates, captured };
    inFlight.add(entry);
    store.setState({ pending: projectPending(), error: null });
    try {
      const result = await body(stale);
      return stale() ? undefined : result;
    } catch (e) {
      // `client` methods are PreludeAuthError by contract; the
      // `instanceof` check is defence-in-depth for a stray throw
      // (programmer error) so the field stays well-typed. Skip the
      // write if cancelled mid-flight; cancel already cleared
      // `error`.
      if (!stale()) {
        store.setState({
          error: e instanceof PreludeAuthError ? e : fromNativeError(e),
        });
      }
      return undefined;
    } finally {
      inFlight.delete(entry);
      store.setState({ pending: projectPending() });
    }
  };

  return { guarded, projectPending };
}
