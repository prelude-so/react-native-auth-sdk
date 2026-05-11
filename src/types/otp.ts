import { PreludeIdentifier, PreludeIdentifierJson } from "./identifier";

export interface StartOTPLoginOptions {
  identifier: PreludeIdentifier;
  loginConfigID?: string;
}

export interface StartOTPLoginOptionsJson {
  identifier: PreludeIdentifierJson;
  loginConfigID?: string | null;
}

export function startOTPLoginOptionsToJson(
  options: StartOTPLoginOptions,
): StartOTPLoginOptionsJson {
  return {
    identifier: options.identifier.toJSON(),
    loginConfigID: options.loginConfigID ?? null,
  };
}
