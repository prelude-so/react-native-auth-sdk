import { Endpoint } from "../types/endpoint";
import { InvalidConfigurationError } from "../types/errors";

describe("Endpoint", () => {
  it("default serializes to {kind: 'default'}", () => {
    expect(Endpoint.default.toJSON()).toEqual({ kind: "default" });
  });

  it("custom serializes to {kind: 'custom', address}", () => {
    expect(Endpoint.custom("https://staging.example").toJSON()).toEqual({
      kind: "custom",
      address: "https://staging.example",
    });
  });

  it("custom rejects empty addresses with a typed PreludeAuthError", () => {
    // Subclass of PreludeAuthError so a single catch at the call
    // site covers pre-flight + bridge errors uniformly.
    expect(() => Endpoint.custom("")).toThrow(InvalidConfigurationError);
  });
});
