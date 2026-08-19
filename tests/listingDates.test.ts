import { describe, expect, it } from "vitest";
import { deriveEffectiveListingDate, PossibleWhenIssuedError } from "@/lib/replay/listingDates";

const daily = (date: string, volume = 1_000) => ({ time: Date.parse(`${date}T14:30:00Z`) / 1000, volume });
const contiguous = (count: number, lowSessions = 0) => Array.from({ length: count }, (_, index) => {
  const date = new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
  return daily(date, index < lowSessions ? 100 : 10_000);
});

describe("effective listing-date derivation", () => {
  it("uses the first bar after the largest qualifying gap for a reused ticker", () => {
    const resolution = deriveEffectiveListingDate(
      "REUSE",
      [daily("2015-01-02"), daily("2015-01-05"), daily("2024-01-03"), daily("2024-01-04")],
      "2024-01-03"
    );
    expect(resolution).toMatchObject({
      effectiveListedSince: "2024-01-03",
      previousBarDate: "2015-01-05",
      derivation: "largest_gap",
      resolutionRule: "gap_rule",
    });
    expect(resolution.largestGapDays).toBeGreaterThan(3_200);
  });

  it("fails loudly when authored and derived dates exceed tolerance without a resolving signature", () => {
    expect(() => deriveEffectiveListingDate(
      "WRONG",
      [daily("2015-01-02"), daily("2024-01-03")],
      "2024-02-01",
      { listingDateToleranceDays: 5 }
    )).toThrow(/authored=2024-02-01, derived=2024-01-03/);
  });

  it("uses the first available bar when no gap or when-issued signature exists", () => {
    expect(deriveEffectiveListingDate(
      "NEW",
      [daily("2026-06-12"), daily("2026-06-15"), daily("2026-06-16")],
      "2026-06-12"
    )).toMatchObject({ effectiveListedSince: "2026-06-12", derivation: "first_bar", resolutionRule: "first_bar" });
  });

  it("flags a contiguous low-volume seven-session stub and refuses to auto-select it", () => {
    try {
      deriveEffectiveListingDate("WHEN", contiguous(45, 7));
      throw new Error("expected possible_when_issued");
    } catch (error) {
      expect(error).toBeInstanceOf(PossibleWhenIssuedError);
      expect(error).toMatchObject({ code: "possible_when_issued", candidateDate: "2026-01-01" });
    }
  });

  it("resolves a matching when-issued signature in favor of a later authored date", () => {
    const resolution = deriveEffectiveListingDate("WHEN", contiguous(45, 7), "2026-01-08");
    expect(resolution).toMatchObject({
      derivedCandidateDate: "2026-01-01",
      effectiveListedSince: "2026-01-08",
      resolutionRule: "authored_override",
      whenIssued: { possibleWhenIssued: true, excludedLeadingSessions: 7 },
    });
  });
});
