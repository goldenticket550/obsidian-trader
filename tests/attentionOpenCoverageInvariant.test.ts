import { describe, expect, it } from "vitest";
import { ATTENTION_UNIVERSE } from "@/lib/attention/universe";
import { buildHistoricalMetricSeries } from "@/lib/attention-runtime/iexBaselineTable";
import { metricAt } from "@/lib/attention-runtime/iexProcessor";
import { buildPriorSessionAtrSeed } from "@/lib/attention-runtime/iexMetricWarmup";
import type { Candle } from "@/types/candle";

function bars(start: number, count: number, startPrice: number, slope = 0.02): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const open = startPrice + index * slope;
    return {
      time: start + index * 60,
      open,
      high: open + 0.12,
      low: open - 0.1,
      close: open + slope * 0.8,
      volume: 1_000 + index,
    };
  });
}

describe("opening coverage warm-up contract", () => {
  const prior = bars(Date.parse("2026-08-18T13:30:00Z") / 1000, 390, 90);

  it("requires fourteen five-minute ranges and seeds thirteen from the prior regular session", () => {
    const opening = bars(Date.parse("2026-08-19T13:30:00Z") / 1000, 1, 105);
    const withoutWarmup = buildHistoricalMetricSeries(opening)[570];
    const withWarmup = buildHistoricalMetricSeries(opening, prior)[570];
    const seed = buildPriorSessionAtrSeed(prior);

    expect(seed.completedTrueRanges).toHaveLength(13);
    expect(seed.previousClose).toBe(prior.at(-1)!.close);
    expect(withoutWarmup.rangeAtr).toBeNull();
    expect(withWarmup.rangeAtr).not.toBeNull();
    expect(withWarmup.pathEfficiency).not.toBeNull();
  });

  it("matches historical and live metrics at 09:30 exactly", () => {
    const opening = bars(Date.parse("2026-08-19T13:30:00Z") / 1000, 1, 105);
    const historical = buildHistoricalMetricSeries(opening, prior)[570];
    const live = metricAt(opening, 570, prior);
    expect(live.rangeAtr).toBe(historical.rangeAtr);
    expect(live.pathEfficiency).toBe(historical.pathEfficiency);
    expect(live.return5m).toBe(historical.return5m);
  });

  it("does not move a metric once the old same-session path was already usable", () => {
    const current = bars(Date.parse("2026-08-19T08:00:00Z") / 1000, 720, 100);
    const before = buildHistoricalMetricSeries(current);
    const after = buildHistoricalMetricSeries(current, prior);
    let maxDelta = 0;
    let compared = 0;
    for (let minute = 570; minute < 960; minute += 1) {
      if (before[minute].rangeAtr === null || before[minute].pathEfficiency === null) continue;
      compared += 1;
      maxDelta = Math.max(
        maxDelta,
        Math.abs(before[minute].rangeAtr! - after[minute].rangeAtr!),
        Math.abs(before[minute].pathEfficiency! - after[minute].pathEfficiency!),
      );
    }
    expect(compared).toBeGreaterThan(0);
    expect(maxDelta).toBe(0);
  });

  it("has no self-referential benchmark and makes ETF proxy semantics explicit", () => {
    expect(ATTENTION_UNIVERSE.filter((entry) => entry.benchmark === entry.symbol)).toEqual([]);
    for (const symbol of ["SPY", "QQQ", "IWM", "SMH", "GLD", "SLV", "IBIT", "DRAM", "SPCX"]) {
      const entry = ATTENTION_UNIVERSE.find((candidate) => candidate.symbol === symbol)!;
      expect(entry.sectorEtf).toBe(symbol);
    }
    expect(ATTENTION_UNIVERSE.find((entry) => entry.symbol === "SPY")).toMatchObject({ benchmark: "IWM", sectorEtf: "SPY" });
  });
});
