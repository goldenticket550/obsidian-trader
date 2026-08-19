import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeCandle } from "@/lib/fixtures/candles";
import { buildArchiveLabelChart, loadArchiveLabelChart } from "@/lib/replay/archiveLabelChart";

const epoch = (iso: string) => Date.parse(iso) / 1000;

describe("archive-backed label chart", () => {
  it("derives every required overlay and aligns the interesting-time marker", () => {
    const bars = [
      makeCandle({ time: epoch("2025-08-18T12:00:00Z"), open: 100, high: 101, low: 99, close: 100.5, volume: 10 }),
      makeCandle({ time: epoch("2025-08-18T13:30:00Z"), open: 100.5, high: 102, low: 100, close: 101.5, volume: 20 }),
      makeCandle({ time: epoch("2025-08-18T13:31:00Z"), open: 101.5, high: 103, low: 101, close: 102.5, volume: 30 }),
      makeCandle({ time: epoch("2025-08-18T20:00:00Z"), open: 102.5, high: 104, low: 102, close: 103, volume: 40 }),
    ];
    const chart = buildArchiveLabelChart({ tradingDate: "2025-08-18", symbol: "TEST", bars, priorClose: 98, becameInteresting: "09:31:00" });
    expect(chart.vwap).toHaveLength(bars.length);
    expect(new Set(chart.levels.map((item) => item.kind))).toEqual(new Set(["hod", "lod", "premarket_high", "premarket_low", "prior_close", "opening_range_high", "opening_range_low"]));
    expect(chart.markerTime).toBe(bars[2].time);
    expect(chart.regularSession).toEqual({ firstBarTime: bars[1].time, lastBarTime: bars[2].time });
  });

  it.runIf(existsSync("data/archive/sip-split/metadata.json"))("loads a real immutable SIP session from archive chunks", () => {
    const chart = loadArchiveLabelChart({ tradingDate: "2025-08-18", symbol: "NVDA", becameInteresting: "10:03:00" });
    expect(chart).toMatchObject({ source: "sip_split_archive", feed: "sip", adjustment: "split", tradingDate: "2025-08-18", symbol: "NVDA" });
    expect(chart.bars.length).toBeGreaterThan(900);
    expect(chart.levels.map((item) => item.kind)).toEqual(expect.arrayContaining(["hod", "lod", "premarket_high", "premarket_low", "prior_close", "opening_range_high", "opening_range_low"]));
  });
});
