/** Identifier kind used to start a login flow. */
export type PreludeIdentifierType = "phone_number" | "email_address";

export interface PreludeIdentifierJson {
  type: PreludeIdentifierType;
  value: string;
}

export class PreludeIdentifier {
  constructor(
    readonly type: PreludeIdentifierType,
    readonly value: string,
  ) {}

  static phoneNumber(value: string): PreludeIdentifier {
    return new PreludeIdentifier("phone_number", value);
  }

  static emailAddress(value: string): PreludeIdentifier {
    return new PreludeIdentifier("email_address", value);
  }

  toJSON(): PreludeIdentifierJson {
    return { type: this.type, value: this.value };
  }
}
