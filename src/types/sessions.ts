import { BadRequestError } from "./errors";

/** Form factor reported by the server for an active session. */
export type PreludeDeviceType =
  | "desktop"
  | "mobile"
  | "tablet"
  | "unknown";

const DEVICE_TYPES: readonly PreludeDeviceType[] = [
  "desktop",
  "mobile",
  "tablet",
  "unknown",
];

// Unknown server values fold into `unknown` rather than throwing —
// an additive server change shouldn't break older SDKs.
function deviceTypeFromWire(wire: unknown): PreludeDeviceType {
  return typeof wire === "string" &&
    (DEVICE_TYPES as readonly string[]).includes(wire)
    ? (wire as PreludeDeviceType)
    : "unknown";
}

/** One active session as reported by `GET /me/list`. */
export interface PreludeSessionView {
  id: string;
  deviceModel: string;
  deviceType: PreludeDeviceType;
  osVersion: string;
  countryCode: string;
  /** ISO 8601 UTC. */
  createdAt: string;
  /** ISO 8601 UTC. */
  lastSeenAt: string;
  /** ISO 8601 UTC; absolute refresh-token expiry. */
  expiresAt: string;
}

export interface PreludeSessionViewJson {
  id: string;
  deviceModel: string;
  deviceType: string;
  osVersion: string;
  countryCode: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface PreludeListSessionsOptions {
  limit?: number;
  offset?: number;
}

export interface PreludeListSessionsOptionsJson {
  limit?: number;
  offset?: number;
}

/**
 * Validate + serialize. Throws on negative paging up front rather
 * than handing it to the server.
 */
export function listSessionsOptionsToJson(
  options: PreludeListSessionsOptions,
): PreludeListSessionsOptionsJson {
  if (options.limit !== undefined && options.limit < 0) {
    throw new BadRequestError("PreludeListSessionsOptions.limit must be >= 0");
  }
  if (options.offset !== undefined && options.offset < 0) {
    throw new BadRequestError("PreludeListSessionsOptions.offset must be >= 0");
  }
  const json: PreludeListSessionsOptionsJson = {};
  if (options.limit !== undefined) json.limit = options.limit;
  if (options.offset !== undefined) json.offset = options.offset;
  return json;
}

export interface PreludeListSessionsResponse {
  sessions: PreludeSessionView[];
  total: number;
  limit: number;
  offset: number;
}

export interface PreludeListSessionsResponseJson {
  sessions: PreludeSessionViewJson[];
  total: number;
  limit: number;
  offset: number;
}

export function sessionViewFromJson(
  json: PreludeSessionViewJson,
): PreludeSessionView {
  return {
    id: json.id,
    deviceModel: json.deviceModel,
    deviceType: deviceTypeFromWire(json.deviceType),
    osVersion: json.osVersion,
    countryCode: json.countryCode,
    createdAt: json.createdAt,
    lastSeenAt: json.lastSeenAt,
    expiresAt: json.expiresAt,
  };
}

export function listSessionsResponseFromJson(
  json: PreludeListSessionsResponseJson,
): PreludeListSessionsResponse {
  return {
    sessions: (json.sessions ?? []).map(sessionViewFromJson),
    total: json.total,
    limit: json.limit,
    offset: json.offset,
  };
}

/** Which sessions to revoke. `session` carries its required id. */
export type PreludeRevokeTarget =
  | { kind: "all" }
  | { kind: "others" }
  | { kind: "mine" }
  | { kind: "session"; sessionID: string };

// Frozen so `PreludeRevokeTarget.all.kind = "others"` can't silently
// corrupt the singleton.
export const PreludeRevokeTarget = Object.freeze({
  all: Object.freeze({ kind: "all" }) as PreludeRevokeTarget,
  others: Object.freeze({ kind: "others" }) as PreludeRevokeTarget,
  mine: Object.freeze({ kind: "mine" }) as PreludeRevokeTarget,
  session(sessionID: string): PreludeRevokeTarget {
    if (!sessionID.trim()) {
      throw new BadRequestError(
        "PreludeRevokeTarget.session: non-empty id required",
      );
    }
    return Object.freeze({ kind: "session", sessionID });
  },
});
