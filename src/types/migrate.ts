import { RedactedString } from "./redactedString";

/** Options for {@link PreludeAuthClient.migrate}. */
export interface MigrateOptions {
  /**
   * Bearer token issued by the legacy authentication system.
   * Wrapped in a {@link RedactedString} so the options object never
   * leaks the token through `toString` / `console.log`.
   */
  token: RedactedString;
}

export interface MigrateOptionsJson {
  token: string;
}

/**
 * Internal: unwraps the token right at the channel boundary. The
 * only place inside the SDK where the secret needs to be plain.
 */
export function migrateOptionsToJson(
  options: MigrateOptions,
): MigrateOptionsJson {
  return { token: options.token.value };
}
