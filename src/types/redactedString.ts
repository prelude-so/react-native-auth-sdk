/**
 * `string` wrapper whose textual representation is `<redacted>`.
 *
 * Use for secrets that must never appear in logs or stack traces.
 * Reach for the raw value via `.value`.
 */
export class RedactedString {
  constructor(readonly value: string) {}

  toString(): string {
    return "<redacted>";
  }

  // Hide the secret from console.log / inspect on Node and Hermes.
  toJSON(): string {
    return "<redacted>";
  }
}
