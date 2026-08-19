import { describe, expect, it } from "vitest";
import { composeOpeningAndModeProtection } from "@/lib/replay/openingProtectionComposition";

describe("A2 carry-forward guard composition", () => {
  it("does not stack a 10-minute mode guard with 15-minute opening protection", () => {
    const open = Date.parse("2026-08-17T13:30:00Z");
    const at940 = Date.parse("2026-08-17T13:40:00Z");
    expect(composeOpeningAndModeProtection({
      evaluatedAt: at940,
      regularOpenAt: open,
      openingProtectionMs: 15 * 60_000,
      modeTransitionSuppressUntil: open + 10 * 60_000,
    })).toEqual({
      modeTransitionActive: false,
      openingEvidenceTightened: true,
      velocityDerivedEventsSuppressed: false,
      blanketEventSuppression: false,
    });
  });
});
