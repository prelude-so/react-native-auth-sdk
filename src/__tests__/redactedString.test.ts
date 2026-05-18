import { RedactedString } from "../types/redactedString";

describe("RedactedString", () => {
  const r = new RedactedString("hunter2");

  it("exposes the raw value via .value only", () => {
    expect(r.value).toBe("hunter2");
  });

  it("hides the secret in toString and template literals", () => {
    expect(`${r}`).toBe("<redacted>");
    expect(String(r)).toBe("<redacted>");
  });

  it("hides the secret in JSON.stringify output", () => {
    expect(JSON.stringify(r)).toBe('"<redacted>"');
    expect(JSON.stringify({ password: r })).toBe('{"password":"<redacted>"}');
  });
});
