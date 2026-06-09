import { PreludeAuthClient } from "../client";
import { StepUpChallenge } from "../types/stepUp";
import { PreludeUser } from "../types/user";

import { AuthStore } from "./store";

/** Terminal state of a silent session-restore probe. */
export type RestoreOutcome =
  | { stage: "signedIn"; user: PreludeUser; stepUp: StepUpChallenge | null }
  | { stage: "signedOut" };

export interface RestoreOptions {
  /** Host unmounted before we settled — bail out without writing. */
  isCancelled?: () => boolean;
  /**
   * A racing hook action has invalidated the probe's session capture
   * (e.g. signOut bumped the session gate). Treat like `isCancelled`:
   * skip the terminal write so the actions layer keeps authority.
   */
  isStale?: () => boolean;
}

/**
 * Silent session restore. Only `refresh()` decides signed-in vs
 * signed-out — a step-up probe failure (transient native bridge
 * error, etc.) must not discard a successfully refreshed session.
 *
 * Returns the outcome on settle, or `null` if cancelled / staled
 * mid-flight (so the caller can fire one-shot callbacks accurately).
 */
export async function restoreSession(
  client: Pick<PreludeAuthClient, "refresh" | "getActiveStepUp">,
  store: AuthStore,
  opts: RestoreOptions = {},
): Promise<RestoreOutcome | null> {
  const cancelled = opts.isCancelled ?? (() => false);
  const stale = opts.isStale ?? (() => false);
  const dead = () => cancelled() || stale();
  try {
    const user = await client.refresh();
    if (dead()) return null;
    const stepUp = await client.getActiveStepUp().catch(() => null);
    if (dead()) return null;
    store.setState({ stage: "signedIn", user, stepUp });
    return { stage: "signedIn", user, stepUp };
  } catch {
    if (dead()) return null;
    store.setState({ stage: "signedOut" });
    return { stage: "signedOut" };
  }
}
