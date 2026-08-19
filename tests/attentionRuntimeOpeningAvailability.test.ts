import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { StaticBaselineIexAttentionProcessor } from "@/lib/attention-runtime/iexStaticProcessor";
import type { IexBaselineTable } from "@/lib/attention-runtime/iexBaselineTable";
import type { LiveMinuteBatch, RuntimeControls } from "@/lib/attention-runtime/contracts";
import type { FeedAwareAttentionThresholdStore } from "@/lib/replay/feedAwareAttentionThresholds";
import type { Candle } from "@/types/candle";

const controls: RuntimeControls = {
  version: 1,
  attentionLiveAlertingEnabled: false,
  legacyAlertingEnabled: true,
  activeAlertEngine: "legacy",
  updatedAt: Date.parse("2026-08-19T13:30:00Z"),
  reason: "shadow test",
};

function batch(at: number, minuteOfDay: number): LiveMinuteBatch {
  const makeBars = (slope: number, volumeScale: number): Candle[] => Array.from({ length: 121 }, (_, index) => {
    const time = at / 1000 - (120 - index) * 60;
    const price = 100 + index * slope;
    return {
      time,
      open: price,
      high: price + 0.15 + index % 3 * 0.01,
      low: price - 0.12,
      close: price + slope * 0.8,
      volume: Math.round((1_000 + index * 5) * volumeScale),
    };
  });
  const barsBySymbol = {
    NVDA: makeBars(0.025, 2.5),
    QQQ: makeBars(0.008, 4),
    SMH: makeBars(0.015, 3),
  };
  const priorOpen = Date.parse("2026-08-18T13:30:00Z") / 1000;
  const makePriorBars = (slope: number, volumeScale: number): Candle[] => Array.from({ length: 390 }, (_, index) => {
    const price = 95 + index * slope;
    return { time: priorOpen + index * 60, open: price, high: price + 0.12, low: price - 0.1, close: price + slope * 0.8, volume: Math.round((900 + index * 3) * volumeScale) };
  });
  const priorSessionRegularBarsBySymbol = {
    NVDA: makePriorBars(0.02, 2.5),
    QQQ: makePriorBars(0.007, 4),
    SMH: makePriorBars(0.012, 3),
  };
  return {
    at,
    tradingDate: "2026-08-19",
    minuteOfDay,
    mode: "mock",
    requestedSymbols: Object.keys(barsBySymbol),
    barsBySymbol,
    priorSessionRegularBarsBySymbol,
    latestBarBySymbol: Object.fromEntries(Object.entries(barsBySymbol).map(([symbol, bars]) => [symbol, bars.at(-1) ?? null])),
    responseFeed: "mock",
    complete: true,
    staleSymbols: [],
    missingSymbols: [],
    guard: { active: false, reason: "none", activeSince: null, contiguousMinutes: 5, requiredContiguousMinutes: 5 },
    audit: [],
  };
}

describe("opening availability from an empty live processor checkpoint", () => {
  it("scores 09:30 from an empty checkpoint using prior-session regular warm-up", async () => {
    const baseline = JSON.parse(readFileSync(resolve("data/replay/calibration/iex-live-baseline-table.json"), "utf8")) as IexBaselineTable;
    const thresholds = JSON.parse(readFileSync(resolve("data/replay/reports/attention-thresholds.json"), "utf8")) as FeedAwareAttentionThresholdStore;
    const processor = new StaticBaselineIexAttentionProcessor(thresholds, baseline);
    processor.restore(null);

    const openAt = Date.parse("2026-08-19T13:30:00Z");
    const opening = await processor.process(batch(openAt, 570), controls);
    const nvda = opening.rows.find((row) => row.symbol === "NVDA");
    expect(nvda?.attentionScore).not.toBeNull();
    expect(nvda?.core).not.toBeNull();
    expect(opening.processorState).toMatchObject({
      schemaVersion: 2,
      baselineTableId: baseline.tableId,
      a3: { history: expect.any(Object) },
    });
  });
});
