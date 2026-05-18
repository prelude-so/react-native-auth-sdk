import { BadRequestError } from "../types/errors";
import {
  listSessionsOptionsToJson,
  listSessionsResponseFromJson,
  PreludeRevokeTarget,
  sessionViewFromJson,
} from "../types/sessions";

describe("listSessionsOptionsToJson", () => {
  it("omits absent fields so the server applies its own defaults", () => {
    expect(listSessionsOptionsToJson({})).toEqual({});
  });

  it("passes through valid paging", () => {
    expect(listSessionsOptionsToJson({ limit: 10, offset: 0 })).toEqual({
      limit: 10,
      offset: 0,
    });
  });

  it("rejects negative paging with a typed PreludeAuthError", () => {
    // Was RangeError; now BadRequestError so consumers can
    // `catch (e: PreludeAuthError)` uniformly.
    expect(() => listSessionsOptionsToJson({ limit: -1 })).toThrow(BadRequestError);
    expect(() => listSessionsOptionsToJson({ offset: -1 })).toThrow(BadRequestError);
  });
});

describe("sessionViewFromJson", () => {
  const base = {
    id: "s_1",
    deviceModel: "iPhone 15",
    osVersion: "iOS 17.2",
    countryCode: "US",
    createdAt: "2026-01-01T00:00:00Z",
    lastSeenAt: "2026-01-02T00:00:00Z",
    expiresAt: "2026-02-01T00:00:00Z",
  };

  it("preserves known device types", () => {
    expect(
      sessionViewFromJson({ ...base, deviceType: "mobile" }).deviceType,
    ).toBe("mobile");
  });

  it("folds unknown device types into 'unknown' instead of throwing", () => {
    expect(
      sessionViewFromJson({ ...base, deviceType: "tablet_xl" }).deviceType,
    ).toBe("unknown");
  });
});

describe("listSessionsResponseFromJson", () => {
  it("decodes an empty page without errors", () => {
    const r = listSessionsResponseFromJson({
      sessions: [],
      total: 0,
      limit: 10,
      offset: 0,
    });
    expect(r.sessions).toEqual([]);
    expect(r.total).toBe(0);
  });
});

describe("PreludeRevokeTarget", () => {
  it("rejects empty session ids with a typed PreludeAuthError", () => {
    expect(() => PreludeRevokeTarget.session("")).toThrow(BadRequestError);
    expect(() => PreludeRevokeTarget.session("   ")).toThrow(BadRequestError);
  });

  it("session() builds a session-kind target", () => {
    expect(PreludeRevokeTarget.session("s_1")).toEqual({
      kind: "session",
      sessionID: "s_1",
    });
  });

  it("freezes the singleton constants so they can't be mutated", () => {
    expect(Object.isFrozen(PreludeRevokeTarget)).toBe(true);
    expect(Object.isFrozen(PreludeRevokeTarget.all)).toBe(true);
    expect(() => {
      (PreludeRevokeTarget.all as { kind: string }).kind = "others";
    }).toThrow(TypeError);
  });
});
