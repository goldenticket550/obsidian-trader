import { describe, it, expect } from "vitest";
import {
  resolveExpansionStage,
  isOngoingExpansion,
  computeOpeningRange,
  type ExpansionStageSignals,
} from "@/lib/scanner/expansionMonitor";
import { EXPANSION_STAGE_PRIORITY } from "@/lib/scanner/expansionPriority";
import type { ExpansionStage } from "@/lib/indicators/premarketExpansion";
import type { EarlyAccelerationResult } from "@/lib/indicators/earlyAcceleration";
import type { ShockResult } from "@/lib/indicators/dollarVolume";
import type { Candle } from "@/types/candle";

/**
 * The two stages the five-minute detector structurally cannot reach.
 *
 * Both need live one-minute impulse, so both are resolved here rather than
 * in `deriveStage` — and neither may ever be reached by inference from an
 * ABSENCE of data.
 */

const NO_SIGNALS: ExpansionStageSignals = {
  earlyAccelerationFired: false,
  breakoutAccepted: false,
  ongoingExpansion: false,
};

const ALL_STAGES = Object.keys(EXPANSION_STAGE_PRIORITY) as ExpansionStage[];

describe("opening_drive", () => {
  it("is reached when an early acceleration fires before acceptance", () => {
    expect(
      resolveExpansionStage("premarket_candidate", {
        ...NO_SIGNALS,
        earlyAccelerationFired: true,
      })
    ).toBe("opening_drive");

    expect(
      resolveExpansionStage("context_developing", {
        ...NO_SIGNALS,
        earlyAccelerationFired: true,
      })
    ).toBe("opening_drive");
  });

  it("is NOT reached without a qualifying early acceleration", () => {
    expect(resolveExpansionStage("premarket_candidate", NO_SIGNALS)).toBe("premarket_candidate");
    expect(resolveExpansionStage("context_developing", NO_SIGNALS)).toBe("context_developing");
    expect(resolveExpansionStage("inactive", NO_SIGNALS)).toBe("inactive");
  });

  it("never demotes a symbol that has already broken its level", () => {
    // level_break (5) outranks opening_drive (4): a symbol through its
    // level is further along than one merely driving at it.
    expect(
      resolveExpansionStage("level_break", { ...NO_SIGNALS, earlyAccelerationFired: true })
    ).toBe("level_break");
  });

  it("does not apply once the breakout is accepted", () => {
    // After acceptance the interesting question is whether expansion
    // CONTINUES, not whether it started.
    expect(
      resolveExpansionStage("breakout_accepted", {
        earlyAccelerationFired: true,
        breakoutAccepted: true,
        ongoingExpansion: false,
      })
    ).toBe("breakout_accepted");
  });
});

describe("expansion_active", () => {
  it("is reached when an accepted breakout is still expanding", () => {
    expect(
      resolveExpansionStage("breakout_accepted", {
        earlyAccelerationFired: false,
        breakoutAccepted: true,
        ongoingExpansion: true,
      })
    ).toBe("expansion_active");
  });

  it("is NOT reached by acceptance alone", () => {
    // Acceptance is a completed event; expansion_active is a continuing one.
    expect(
      resolveExpansionStage("breakout_accepted", {
        ...NO_SIGNALS,
        breakoutAccepted: true,
      })
    ).toBe("breakout_accepted");
  });

  it("is NOT reached by ongoing expansion without acceptance", () => {
    expect(
      resolveExpansionStage("level_break", {
        earlyAccelerationFired: false,
        breakoutAccepted: false,
        ongoingExpansion: true,
      })
    ).toBe("level_break");
  });
});

describe("stage resolution is total and safe", () => {
  it("never upgrades an invalidated setup, whatever the one-minute series shows", () => {
    // The structure that defined the setup is gone; a fresh impulse
    // against a dead level is not a resumption of it.
    for (const signals of [
      { earlyAccelerationFired: true, breakoutAccepted: false, ongoingExpansion: true },
      { earlyAccelerationFired: true, breakoutAccepted: true, ongoingExpansion: true },
      { earlyAccelerationFired: false, breakoutAccepted: true, ongoingExpansion: true },
    ]) {
      expect(resolveExpansionStage("invalidated", signals)).toBe("invalidated");
    }
  });

  it("only ever moves a stage UP the existing priority table, never down", () => {
    const combinations: ExpansionStageSignals[] = [];
    for (const early of [true, false]) {
      for (const accepted of [true, false]) {
        for (const ongoing of [true, false]) {
          combinations.push({
            earlyAccelerationFired: early,
            breakoutAccepted: accepted,
            ongoingExpansion: ongoing,
          });
        }
      }
    }

    for (const base of ALL_STAGES) {
      for (const signals of combinations) {
        const resolved = resolveExpansionStage(base, signals);
        expect(EXPANSION_STAGE_PRIORITY[resolved]).toBeGreaterThanOrEqual(
          EXPANSION_STAGE_PRIORITY[base]
        );
      }
    }
  });

  it("is deterministic — the same inputs always resolve the same way", () => {
    for (const base of ALL_STAGES) {
      const signals = { earlyAccelerationFired: true, breakoutAccepted: true, ongoingExpansion: true };
      expect(resolveExpansionStage(base, signals)).toBe(resolveExpansionStage(base, signals));
    }
  });
});

describe("isOngoingExpansion", () => {
  function shock(status: ShockResult["status"], passed: boolean): ShockResult {
    return {
      status,
      passed,
      value: 1,
      baselineMedian: passed ? 0.5 : 2,
      multiple: passed ? 2 : 0.5,
      baselineSampleSize: 12,
    };
  }

  function early(dv: ShockResult, tr: ShockResult): EarlyAccelerationResult {
    return {
      type: "early_acceleration",
      fired: false,
      direction: "bullish",
      symbol: "AAA",
      label: "EARLY HEADS-UP · UNCONFIRMED",
      priority: "monitor",
      barTime: 1,
      checks: {
        completedCandle: true,
        dollarVolumeShock: dv,
        trueRangeShock: tr,
        closeLocation: 0.9,
        closeNearExtreme: true,
        level: { engagement: "breaking", level: null, distance: null, tolerance: null },
        freshnessPermits: true,
      },
      blockedBy: null,
    };
  }

  it("requires BOTH the dollar-volume and true-range shocks", () => {
    expect(isOngoingExpansion(early(shock("available", true), shock("available", true)))).toBe(true);
    expect(isOngoingExpansion(early(shock("available", true), shock("available", false)))).toBe(
      false
    );
    expect(isOngoingExpansion(early(shock("available", false), shock("available", true)))).toBe(
      false
    );
  });

  it("treats an unmeasurable shock as not expanding, never as expanding", () => {
    // A missing baseline must not be able to promote a symbol to
    // expansion_active.
    const unmeasured = shock("insufficient_data", false);
    expect(isOngoingExpansion(early(unmeasured, unmeasured))).toBe(false);
    expect(isOngoingExpansion(early(shock("available", true), unmeasured))).toBe(false);
  });
});

describe("computeOpeningRange", () => {
  /** Epoch seconds for a US Eastern minute-of-day during EDT. */
  function etTime(minuteOfDay: number): number {
    const utcMinutes = minuteOfDay + 4 * 60;
    const hh = String(Math.floor(utcMinutes / 60)).padStart(2, "0");
    const mm = String(utcMinutes % 60).padStart(2, "0");
    return Math.floor(Date.parse(`2026-07-13T${hh}:${mm}:00Z`) / 1000);
  }

  function bar(minute: number, high: number, low: number): Candle {
    return { time: etTime(minute), open: low, high, low, close: high, volume: 1000 };
  }

  it("measures the high and low of the first N regular-session minutes", () => {
    const bars = [
      bar(9 * 60 + 25, 200, 100), // premarket — excluded
      bar(9 * 60 + 30, 105, 99),
      bar(9 * 60 + 40, 108, 101),
      bar(9 * 60 + 44, 104, 97),
      bar(9 * 60 + 45, 300, 1), // outside a 15-minute window — excluded
    ];
    expect(computeOpeningRange(bars, 15)).toEqual({ high: 108, low: 97, barCount: 3 });
  });

  it("honors a different window width", () => {
    const bars = [bar(9 * 60 + 30, 105, 99), bar(9 * 60 + 35, 120, 90)];
    expect(computeOpeningRange(bars, 5)).toEqual({ high: 105, low: 99, barCount: 1 });
    expect(computeOpeningRange(bars, 30)).toEqual({ high: 120, low: 90, barCount: 2 });
  });

  it("returns null before the open rather than a zero-width range", () => {
    expect(computeOpeningRange([bar(9 * 60 + 25, 105, 99)], 15)).toBeNull();
    expect(computeOpeningRange([], 15)).toBeNull();
  });
});
