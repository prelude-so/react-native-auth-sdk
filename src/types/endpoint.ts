import { InvalidConfigurationError } from "./errors";

/**
 * API endpoint for `PreludeAuthClient`.
 *
 * `Endpoint.default` resolves natively to the canonical Prelude
 * address — a JS bump isn't required when iOS / Android rotate.
 * `Endpoint.custom(address)` is for staging / local dev.
 */
export type EndpointJson =
  | { kind: "default" }
  | { kind: "custom"; address: string };

export class Endpoint {
  private constructor(private readonly json: EndpointJson) {}

  static readonly default = new Endpoint({ kind: "default" });

  static custom(address: string): Endpoint {
    // Typed throw so a single `catch (e: PreludeAuthError)` at
    // the call site covers both pre-flight arg validation and
    // native errors. Plain `Error` would slip past it.
    if (!address) {
      throw new InvalidConfigurationError(
        "Endpoint.custom: address is required",
      );
    }
    return new Endpoint({ kind: "custom", address });
  }

  toJSON(): EndpointJson {
    return this.json;
  }
}
