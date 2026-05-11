import {
  PreludePasswordCompliancy,
  PreludePasswordCompliancyResult,
  PreludePasswordCompliancyResults,
} from "./types/password";

// Unicode general-category regexes for password classification.
const RE_UPPER = /\p{Lu}/u;
const RE_LOWER = /\p{Ll}/u;
const RE_DIGIT = /\p{Nd}/u;

/**
 * Classify `password` against `compliancy`. Pure; safe on every
 * keystroke. Length is counted in code points, not UTF-16 units,
 * so emoji and astral chars count as one.
 */
export function validatePassword(
  password: string,
  compliancy: PreludePasswordCompliancy,
): PreludePasswordCompliancyResults {
  let upper = 0;
  let lower = 0;
  let numbers = 0;
  let symbols = 0;
  const codepoints = Array.from(password);

  for (const ch of codepoints) {
    if (RE_UPPER.test(ch)) upper++;
    else if (RE_LOWER.test(ch)) lower++;
    else if (RE_DIGIT.test(ch)) numbers++;
    else symbols++;
  }

  const length = codepoints.length;

  const results: PreludePasswordCompliancyResult[] = [
    {
      criterion: "min_length",
      actual: length,
      expected: compliancy.minLength,
      valid: length >= compliancy.minLength,
    },
    {
      criterion: "max_length",
      actual: length,
      expected: compliancy.maxLength,
      // 0 = "no upper bound" sentinel.
      valid: compliancy.maxLength === 0 || length <= compliancy.maxLength,
    },
    {
      criterion: "uppercase",
      actual: upper,
      expected: compliancy.uppercase,
      valid: upper >= compliancy.uppercase,
    },
    {
      criterion: "lowercase",
      actual: lower,
      expected: compliancy.lowercase,
      valid: lower >= compliancy.lowercase,
    },
    {
      criterion: "numbers",
      actual: numbers,
      expected: compliancy.numbers,
      valid: numbers >= compliancy.numbers,
    },
    {
      criterion: "symbols",
      actual: symbols,
      expected: compliancy.symbols,
      valid: symbols >= compliancy.symbols,
    },
  ];

  return {
    valid: results.every((r) => r.valid),
    results,
  };
}
