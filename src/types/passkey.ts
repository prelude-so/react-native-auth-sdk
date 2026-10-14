/** Options for `registerPasskey`. */
export interface RegisterPasskeyOptions {
  /** Shown by the authenticator; usually the user's email or phone. */
  username: string;
  /** Human-friendly name; defaults to `username`. */
  displayName?: string;
  /** Optional server-side label ("iPhone", "Pixel"). */
  nickname?: string;
}

export interface RegisterPasskeyOptionsJson {
  username: string;
  displayName: string | null;
  nickname: string | null;
}

export function registerPasskeyOptionsToJson(
  options: RegisterPasskeyOptions,
): RegisterPasskeyOptionsJson {
  return {
    username: options.username,
    displayName: options.displayName ?? null,
    nickname: options.nickname ?? null,
  };
}

/** Options for `loginWithPasskey`. */
export interface PasskeyLoginOptions {
  /**
   * iOS only: offer matching passkeys inline through the keyboard's
   * AutoFill row instead of a modal sheet. Android always shows the
   * Credential Manager sheet.
   */
  autofill?: boolean;
}

export interface PasskeyLoginOptionsJson {
  autofill: boolean;
}

export function passkeyLoginOptionsToJson(
  options: PasskeyLoginOptions,
): PasskeyLoginOptionsJson {
  return { autofill: options.autofill ?? false };
}

/** A passkey registered to the authenticated user. */
export interface PreludePasskeyCredential {
  credentialID: string;
  nickname: string | null;
  /** WebAuthn transports the credential advertises. */
  transports: string[];
  /** Whether the credential is backed up (synced). */
  backupState: boolean;
  createdAt: Date;
  /** Equals `createdAt` until first use. */
  lastUsedAt: Date;
}

export interface PreludePasskeyCredentialJson {
  credentialID: string;
  nickname: string | null;
  transports: string[];
  backupState: boolean;
  /** Unix seconds. */
  createdAt: number;
  /** Unix seconds. */
  lastUsedAt: number;
}

export function passkeyCredentialFromJson(
  json: PreludePasskeyCredentialJson,
): PreludePasskeyCredential {
  return {
    credentialID: json.credentialID,
    nickname: json.nickname ?? null,
    transports: json.transports ?? [],
    backupState: json.backupState,
    createdAt: new Date(json.createdAt * 1000),
    lastUsedAt: new Date(json.lastUsedAt * 1000),
  };
}

/** Outcome of `registerPasskey`. */
export interface PasskeyRegistrationResult {
  credential: PreludePasskeyCredential;
  /** `true` when the server already held this credential. */
  alreadyRegistered: boolean;
}

export interface PasskeyRegistrationResultJson {
  credential: PreludePasskeyCredentialJson;
  alreadyRegistered: boolean;
}

export function passkeyRegistrationResultFromJson(
  json: PasskeyRegistrationResultJson,
): PasskeyRegistrationResult {
  return {
    credential: passkeyCredentialFromJson(json.credential),
    alreadyRegistered: json.alreadyRegistered,
  };
}
