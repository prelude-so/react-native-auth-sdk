import {
  passkeyCredentialFromJson,
  passkeyLoginOptionsToJson,
  registerPasskeyOptionsToJson,
} from "../types/passkey";

describe("passkey codecs", () => {
  it("registerPasskeyOptionsToJson keeps every field the native side reads", () => {
    expect(
      registerPasskeyOptionsToJson({
        username: "a@b.co",
        displayName: "Alice",
        nickname: "iPhone",
      }),
    ).toEqual({ username: "a@b.co", displayName: "Alice", nickname: "iPhone" });
  });

  it("passkeyLoginOptionsToJson always carries an explicit autofill flag", () => {
    expect(passkeyLoginOptionsToJson({})).toEqual({ autofill: false });
    expect(passkeyLoginOptionsToJson({ autofill: true })).toEqual({ autofill: true });
  });

  it("passkeyCredentialFromJson tolerates a missing transports list", () => {
    const cred = passkeyCredentialFromJson({
      credentialID: "cred",
      nickname: null,
      transports: undefined as unknown as string[],
      backupState: false,
      createdAt: 10,
      lastUsedAt: 10,
    });
    expect(cred.transports).toEqual([]);
    expect(cred.createdAt).toEqual(new Date(10_000));
  });
});
