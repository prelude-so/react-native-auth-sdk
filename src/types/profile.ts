/**
 * Decoded user profile sourced from the current access token's
 * JWT claims. `extras` preserves all top-level claims as-is so
 * large 64-bit integer claims survive intact.
 */
export interface PreludeProfile {
  userID?: string;
  sessionID?: string;
  extras: Record<string, unknown>;
}

export interface PreludeProfileJson {
  userID?: string | null;
  sessionID?: string | null;
  extras?: Record<string, unknown>;
}

export function profileFromJson(json: PreludeProfileJson): PreludeProfile {
  return {
    userID: json.userID ?? undefined,
    sessionID: json.sessionID ?? undefined,
    extras: json.extras ?? {},
  };
}
