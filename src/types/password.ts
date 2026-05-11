import { RedactedString } from "./redactedString";

export interface LoginWithPasswordOptions {
  emailAddress: string;
  password: RedactedString;
}

export interface LoginWithPasswordOptionsJson {
  emailAddress: string;
  password: string;
}

/**
 * Internal: unwraps the password right at the channel boundary.
 * The only place inside the SDK where the secret needs to be plain.
 */
export function loginWithPasswordOptionsToJson(
  options: LoginWithPasswordOptions,
): LoginWithPasswordOptionsJson {
  return {
    emailAddress: options.emailAddress,
    password: options.password.value,
  };
}

/** The server's configured password compliancy rules. */
export interface PreludePasswordCompliancy {
  minLength: number;
  /** `0` means "no upper bound". */
  maxLength: number;
  uppercase: number;
  lowercase: number;
  numbers: number;
  symbols: number;
}

export type PreludePasswordCompliancyJson = PreludePasswordCompliancy;

export function passwordCompliancyFromJson(
  json: PreludePasswordCompliancyJson,
): PreludePasswordCompliancy {
  return {
    minLength: json.minLength,
    maxLength: json.maxLength,
    uppercase: json.uppercase,
    lowercase: json.lowercase,
    numbers: json.numbers,
    symbols: json.symbols,
  };
}

export type PreludePasswordCompliancyCriterion =
  | "min_length"
  | "max_length"
  | "uppercase"
  | "lowercase"
  | "numbers"
  | "symbols";

export interface PreludePasswordCompliancyResult {
  criterion: PreludePasswordCompliancyCriterion;
  actual: number;
  expected: number;
  valid: boolean;
}

export interface PreludePasswordCompliancyResults {
  valid: boolean;
  results: PreludePasswordCompliancyResult[];
}
