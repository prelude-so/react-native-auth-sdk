/** Status of a step-up flow as reported by the server. */
export type StepUpStatus = "continue" | "review" | "block";

const STEP_UP_STATUSES: readonly StepUpStatus[] = ["continue", "review", "block"];

/**
 * Handle returned by `requestStepUp` and `submitStepUpOTP`.
 *
 * The challenge token + expiry stay native, keyed by `challengeID`
 * in a per-handle cache. Only `challengeID` crosses the bridge.
 */
export interface StepUpChallenge {
  status: StepUpStatus;
  challengeID: string;
  /** Next server step (`verify_email`, `completed`, …). `null` if blocked. */
  currentStep: string | null;
  /** Scope passed to `requestStepUp`. */
  requestedScope: string;
}

export interface StepUpChallengeJson {
  status: string;
  challengeID: string;
  currentStep: string | null;
  requestedScope: string;
}

export function stepUpChallengeFromJson(
  json: StepUpChallengeJson,
): StepUpChallenge {
  const status: StepUpStatus = (STEP_UP_STATUSES as readonly string[]).includes(
    json.status,
  )
    ? (json.status as StepUpStatus)
    : "block";
  return {
    status,
    challengeID: json.challengeID,
    currentStep: json.currentStep ?? null,
    requestedScope: json.requestedScope,
  };
}
