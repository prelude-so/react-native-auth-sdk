import { validatePassword } from "../passwordValidate";

const compliancy = {
  minLength: 8,
  maxLength: 0,
  uppercase: 1,
  lowercase: 1,
  numbers: 1,
  symbols: 0,
};

describe("validatePassword", () => {
  it("passes a strong password", () => {
    const r = validatePassword("Hunter22!", compliancy);
    expect(r.valid).toBe(true);
  });

  it("rejects a too-short password", () => {
    const r = validatePassword("Aa1", compliancy);
    expect(r.valid).toBe(false);
    expect(r.results.find((x) => x.criterion === "min_length")?.valid).toBe(false);
  });

  it("counts code points, not UTF-16 units", () => {
    // 5 emoji = 5 code points (each is a surrogate pair).
    const r = validatePassword("Aa1\u{1F600}\u{1F600}\u{1F600}\u{1F600}\u{1F600}", compliancy);
    expect(r.results.find((x) => x.criterion === "min_length")?.actual).toBe(8);
  });
});

describe("validatePassword maxLength", () => {
  // The "0 = no upper bound" sentinel is exercised by every other
  // case above; pin the actual upper-bound branch so a regression
  // (e.g. flipping the comparator) doesn't go silent.
  const bounded = { ...compliancy, maxLength: 12 };

  it("passes when length is within the explicit upper bound", () => {
    const r = validatePassword("Hunter22!", bounded);
    expect(r.results.find((x) => x.criterion === "max_length")?.valid).toBe(true);
  });

  it("rejects when length exceeds the explicit upper bound", () => {
    const r = validatePassword("Hunter22!Hunter22!", bounded);
    expect(r.valid).toBe(false);
    const maxLengthResult = r.results.find((x) => x.criterion === "max_length");
    expect(maxLengthResult?.valid).toBe(false);
    expect(maxLengthResult?.actual).toBe(18);
    expect(maxLengthResult?.expected).toBe(12);
  });
});
