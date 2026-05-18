import { stepUpChallengeFromJson } from "../types/stepUp";

describe("stepUpChallengeFromJson", () => {
  it("preserves known statuses", () => {
    expect(
      stepUpChallengeFromJson({
        status: "continue",
        challengeID: "c_1",
        currentStep: "verify_email",
        requestedScope: "prld:pwd:write",
      }).status,
    ).toBe("continue");
  });

  it("folds unknown statuses into 'block' rather than escaping the union", () => {
    expect(
      stepUpChallengeFromJson({
        status: "wat",
        challengeID: "c_1",
        currentStep: null,
        requestedScope: "prld:pwd:write",
      }).status,
    ).toBe("block");
  });
});
