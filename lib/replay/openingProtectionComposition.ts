export interface OpeningProtectionComposition {
  modeTransitionActive: boolean;
  openingEvidenceTightened: boolean;
  velocityDerivedEventsSuppressed: boolean;
  blanketEventSuppression: false;
}

/**
 * Verification-only A2 contract. Opening protection raises evidence and
 * persistence requirements; it does not extend the mode-transition timer.
 * A3 will consume this policy when event/state machinery is authorized.
 */
export function composeOpeningAndModeProtection(input: {
  evaluatedAt: number;
  regularOpenAt: number;
  openingProtectionMs: number;
  modeTransitionSuppressUntil: number | null;
}): OpeningProtectionComposition {
  if (![input.evaluatedAt, input.regularOpenAt, input.openingProtectionMs].every(Number.isFinite) || input.openingProtectionMs < 0) {
    throw new Error("Opening-protection composition requires finite, non-negative timing inputs.");
  }
  const openingEvidenceTightened = input.evaluatedAt >= input.regularOpenAt
    && input.evaluatedAt < input.regularOpenAt + input.openingProtectionMs;
  const modeTransitionActive = input.modeTransitionSuppressUntil !== null
    && input.evaluatedAt < input.modeTransitionSuppressUntil;
  return {
    modeTransitionActive,
    openingEvidenceTightened,
    velocityDerivedEventsSuppressed: modeTransitionActive,
    blanketEventSuppression: false,
  };
}
