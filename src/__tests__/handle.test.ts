import { newHandle } from "../handle";

describe("newHandle", () => {
  it("produces unique values", () => {
    const set = new Set(Array.from({ length: 1000 }, () => newHandle()));
    expect(set.size).toBe(1000);
  });

  it("matches the time-prefixed lower-hex shape", () => {
    expect(newHandle()).toMatch(/^[0-9a-f]{16}-[0-9a-f]{16}$/);
  });
});
