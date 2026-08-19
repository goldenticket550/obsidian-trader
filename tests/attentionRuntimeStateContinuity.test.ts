import { describe, expect, it, vi } from "vitest";
import { AttentionLiveWorker, type AttentionRuntimeProcessor } from "@/lib/attention-runtime/worker";
import { InMemoryRuntimeStore } from "@/lib/attention-runtime/inMemoryStore";
import { RestIexPollingSource, type LiveIngestionSource } from "@/lib/attention-runtime/ingestion";
import { metricAt } from "@/lib/attention-runtime/iexProcessor";
import type {
  LiveMinuteBatch,
  RuntimeIdentity,
  RuntimeProcessorResult,
} from "@/lib/attention-runtime/contracts";
import type { MarketDataProvider } from "@/lib/market-data/types";
import { getEasternTimeParts } from "@/lib/market-data/easternTime";
import type { Candle } from "@/types/candle";

const identity: RuntimeIdentity = {
  engineInstanceId: "state-continuity",
  runId: "state-continuity-run",
  userId: "owner",
  universeHash: "universe",
  calibrationId: "calibration",
  configHash: "config",
  baselineTableId: "baseline",
  feedMode: "iex_partial",
};

interface FixtureState {
  rolling: number[];
  episode: { id: string; startedAt: number; observations: number } | null;
}

function emptyFixtureState(): FixtureState {
  return { rolling: [], episode: null };
}

class StatefulProcessor implements AttentionRuntimeProcessor {
  state = emptyFixtureState();
  calls = 0;
  restore(value: unknown): void {
    this.state = value ? structuredClone(value as FixtureState) : emptyFixtureState();
  }
  async process(batch: LiveMinuteBatch): Promise<RuntimeProcessorResult> {
    this.calls += 1;
    this.state.rolling.push(batch.at);
    this.state.episode ??= { id: "episode-AAOI", startedAt: batch.at, observations: 0 };
    this.state.episode.observations += 1;
    return {
      rows: [],
      events: [],
      processorState: structuredClone(this.state),
      statusMessage: `processed=${this.calls}`,
    };
  }
}

function minuteBatch(
  at: number,
  input: { complete?: boolean; guardReason?: LiveMinuteBatch["guard"]["reason"]; bars?: Candle[] } = {},
): LiveMinuteBatch {
  const eastern = getEasternTimeParts(new Date(at));
  const guardReason = input.guardReason ?? "none";
  const bars = input.bars ?? [];
  return {
    at,
    tradingDate: eastern.date,
    minuteOfDay: eastern.minutesSinceMidnight,
    mode: "mock",
    requestedSymbols: ["AAOI"],
    barsBySymbol: { AAOI: bars },
    latestBarBySymbol: { AAOI: bars.at(-1) ?? null },
    responseFeed: "mock",
    complete: input.complete ?? true,
    staleSymbols: [],
    missingSymbols: [],
    guard: {
      active: guardReason !== "none",
      reason: guardReason,
      activeSince: guardReason === "none" ? null : at,
      contiguousMinutes: guardReason === "none" ? 5 : 0,
      requiredContiguousMinutes: 5,
    },
    audit: [],
  };
}

class MutableSource implements LiveIngestionSource {
  readonly mode = "mock" as const;
  batch!: LiveMinuteBatch;
  async readCompletedMinute(): Promise<LiveMinuteBatch> {
    return structuredClone(this.batch);
  }
}

function setControls(store: InMemoryRuntimeStore, at: number): void {
  store.setControls({
    version: 1,
    attentionLiveAlertingEnabled: false,
    legacyAlertingEnabled: true,
    activeAlertEngine: "legacy",
    updatedAt: at,
    reason: "shadow test",
  });
}

describe.each([
  { label: "guard-suppressed", input: { guardReason: "poll_failed" as const } },
  { label: "incomplete", input: { complete: false } },
])("mid-session processor continuity: $label minute", ({ input }) => {
  it("preserves rolling history and episode memory across the skipped minute", async () => {
    const firstAt = Date.parse("2026-08-19T14:00:00Z"); // 10:00 ET
    const store = new InMemoryRuntimeStore();
    const source = new MutableSource();
    const processor = new StatefulProcessor();
    const worker = new AttentionLiveWorker(store, source, processor, {
      identity,
      shadow: true,
      leaseTtlMs: 60 * 60_000,
    });
    setControls(store, firstAt);
    await worker.start(firstAt);

    source.batch = minuteBatch(firstAt);
    await worker.runOnce(firstAt);
    source.batch = minuteBatch(firstAt + 60_000);
    await worker.runOnce(firstAt + 60_000);
    const beforeSuppression = (await store.loadCheckpoint())!.processorState as FixtureState;

    source.batch = minuteBatch(firstAt + 2 * 60_000, input);
    const suppressed = await worker.runOnce(firstAt + 2 * 60_000);
    const duringSuppression = (await store.loadCheckpoint())!.processorState as FixtureState;

    expect(suppressed.detectionStatus).toBe("suppressed");
    expect(duringSuppression).toEqual(beforeSuppression);
    expect(processor.calls).toBe(2);

    source.batch = minuteBatch(firstAt + 3 * 60_000);
    await worker.runOnce(firstAt + 3 * 60_000);
    await worker.stop();
    const afterSuppression = (await store.loadCheckpoint())!.processorState as FixtureState;

    expect(afterSuppression.episode).toMatchObject({
      id: "episode-AAOI",
      startedAt: firstAt,
      observations: 3,
    });
    expect(afterSuppression.rolling).toEqual([
      firstAt,
      firstAt + 60_000,
      firstAt + 3 * 60_000,
    ]);
  });
});

describe("dark-window restore and first-minute rebuilding", () => {
  it("keeps a null processor checkpoint null overnight and rebuilds it from the first regular batch", async () => {
    const darkStart = Date.parse("2026-08-18T20:00:00Z"); // 16:00 ET
    const nextOpen = Date.parse("2026-08-19T13:30:00Z"); // 09:30 ET
    const bars = Array.from({ length: 121 }, (_, index): Candle => {
      const time = nextOpen / 1000 - (120 - index) * 60;
      const price = 100 + index * 0.02;
      return { time, open: price, high: price + 0.2, low: price - 0.2, close: price + 0.05, volume: 1_000 + index };
    });
    const store = new InMemoryRuntimeStore();
    const source = new MutableSource();
    const overnightProcessor = new StatefulProcessor();
    const overnightWorker = new AttentionLiveWorker(store, source, overnightProcessor, {
      identity,
      shadow: true,
      leaseTtlMs: 48 * 60 * 60_000,
    });
    setControls(store, darkStart);
    await overnightWorker.start(darkStart);

    for (let at = darkStart; at < nextOpen; at += 60_000) {
      source.batch = minuteBatch(at);
      setControls(store, at);
      await overnightWorker.runOnce(at);
    }
    expect((await store.loadCheckpoint())!.processorState).toBeNull();
    expect(overnightProcessor.calls).toBe(0);
    await overnightWorker.stop();

    const openingProcessor = new StatefulProcessor();
    const openingWorker = new AttentionLiveWorker(store, source, openingProcessor, {
      identity,
      shadow: true,
      leaseTtlMs: 60 * 60_000,
    });
    await openingWorker.start(nextOpen);
    source.batch = minuteBatch(nextOpen, { bars });
    setControls(store, nextOpen);
    const openingSnapshot = await openingWorker.runOnce(nextOpen);
    await openingWorker.stop();

    expect(openingSnapshot.detectionStatus).toBe("ran");
    expect(openingProcessor.calls).toBe(1);
    expect((await store.loadCheckpoint())!.processorState).toMatchObject({
      rolling: [nextOpen],
      episode: { startedAt: nextOpen, observations: 1 },
    });
    const metrics = metricAt(bars, 570);
    expect(metrics).toMatchObject({ bar: bars.at(-1), expansionBars: expect.any(Number) });
    expect(metrics.atr).not.toBeNull();
    expect(metrics.rangeAtr).not.toBeNull();
    expect(metrics.return5m).not.toBeNull();
    expect(metrics.vwap).not.toBeNull();
    expect(metrics.ema9).not.toBeNull();
  });

  it("preserves a non-null regular-session checkpoint through dark commits and a dark restart", async () => {
    const lastRegular = Date.parse("2026-08-18T19:59:00Z"); // 15:59 ET
    const store = new InMemoryRuntimeStore();
    const source = new MutableSource();
    const regularProcessor = new StatefulProcessor();
    const regularWorker = new AttentionLiveWorker(store, source, regularProcessor, {
      identity,
      shadow: true,
      leaseTtlMs: 48 * 60 * 60_000,
    });
    setControls(store, lastRegular);
    await regularWorker.start(lastRegular);
    source.batch = minuteBatch(lastRegular);
    await regularWorker.runOnce(lastRegular);
    const atClose = structuredClone((await store.loadCheckpoint())!.processorState as FixtureState);

    source.batch = minuteBatch(lastRegular + 60_000);
    setControls(store, lastRegular + 60_000);
    const dark = await regularWorker.runOnce(lastRegular + 60_000);
    expect(dark.detectionSuppressionReason).toBe("non_regular");
    expect((await store.loadCheckpoint())!.processorState).toEqual(atClose);
    await regularWorker.stop();

    const restoredProcessor = new StatefulProcessor();
    const darkWorker = new AttentionLiveWorker(store, source, restoredProcessor, {
      identity,
      shadow: true,
      leaseTtlMs: 48 * 60 * 60_000,
    });
    const darkRestartAt = lastRegular + 2 * 60_000;
    await darkWorker.start(darkRestartAt);
    expect(restoredProcessor.state).toEqual(atClose);
    source.batch = minuteBatch(darkRestartAt);
    setControls(store, darkRestartAt);
    await darkWorker.runOnce(darkRestartAt);
    await darkWorker.stop();

    expect(restoredProcessor.calls).toBe(0);
    expect((await store.loadCheckpoint())!.processorState).toEqual(atClose);
    expect(atClose).toMatchObject({
      rolling: [lastRegular],
      episode: {
        id: "episode-AAOI",
        startedAt: lastRegular,
        observations: 1,
      },
    });
  });

  it("requests split-adjusted prior-regular warm-up plus the current session at the first regular poll", async () => {
    const now = Date.parse("2026-08-19T13:31:00Z");
    const getCandlesMulti = vi.fn(async (_request: unknown) => ({
      candlesBySymbol: { AAOI: [] },
      pagination: { complete: true, pagesFetched: 1, nextPageTokenRemaining: false, truncationReason: null },
      requestedFeed: "iex",
      responseFeed: "iex",
    }));
    const provider = {
      name: "lookback-fixture",
      getCandles: vi.fn(),
      getCandlesMulti,
      getSessionInfo: vi.fn(),
    } as unknown as MarketDataProvider;
    const source = new RestIexPollingSource(provider, ["AAOI"], 120);

    await source.readCompletedMinute(now);

    expect(getCandlesMulti).toHaveBeenCalledTimes(2);
    expect(getCandlesMulti.mock.calls[0][0]).toMatchObject({
      symbols: ["AAOI"], timeframe: "1m",
      start: "2026-08-18T13:30:00.000Z", end: "2026-08-18T19:59:59.999Z", adjustment: "split",
    });
    expect(getCandlesMulti.mock.calls[1][0]).toMatchObject({
      symbols: ["AAOI"], timeframe: "1m",
      start: "2026-08-19T08:00:00.000Z", end: "2026-08-19T13:30:59.999Z", adjustment: "split",
    });
  });
});
