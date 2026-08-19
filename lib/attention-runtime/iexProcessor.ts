import { AttentionA3ReplayEngine, type AttentionA3EngineState, type AttentionA3ProcessTimings } from "@/lib/attention/attentionA3Replay";
import { AttentionEventEngine, DEFAULT_ATTENTION_EVENT_CONFIG } from "@/lib/attention/attentionEvents";
import { calculatePathEfficiency } from "@/lib/attention/attentionAxes";
import { buildContinuousSameTimeBaseline } from "@/lib/attention/baselines";
import { exchangeCalendarDay, exchangeRegularCloseAt } from "@/lib/attention/exchangeCalendar";
import { buildMarketMap, type MarketMapSnapshot } from "@/lib/attention/marketMap";
import { ATTENTION_UNIVERSE } from "@/lib/attention/universe";
import { rankableUniverse } from "@/lib/attention/universePolicy";
import type { AttentionHistoryObservation } from "@/lib/attention/attentionHistory";
import { scoreRawCalibrationPoint } from "@/lib/replay/populationCalibration";
import type { FeedAwareAttentionThresholdStore } from "@/lib/replay/feedAwareAttentionThresholds";
import { tradingSessionsSince } from "@/lib/attention/exchangeCalendar";
import { getEasternTimeParts } from "@/lib/market-data/easternTime";
import type { Candle } from "@/types/candle";
import type { LiveAttentionRow, LiveMinuteBatch, RuntimeControls, RuntimeProcessorResult } from "./contracts";
import type { AttentionRuntimeProcessor } from "./worker";
import { aggregateDailyBar, aggregateFiveMinuteBars, bridgeRegularOpenWindow, buildPriorSessionAtrSeed, candleTrueRange } from "./iexMetricWarmup";

interface SessionBars { tradingDate: string; bars: Record<string, Candle[]>; priorSessionRegularBars?: Record<string, Candle[]> }
export interface MinuteMetric {
  bar: Candle | null; atr: number | null; rangeAtr: number | null; pathEfficiency: number | null;
  return5m: number | null; vwap: number | null; ema9: number | null; expansionBars: number; priceLostVwap: boolean;
}
interface ProcessorCheckpoint { schemaVersion: 1; a3: AttentionA3EngineState; events: ReturnType<AttentionEventEngine["checkpoint"]> }

const MIN_BASELINE_SESSIONS = 10;
const rankable = rankableUniverse(ATTENTION_UNIVERSE);
const bySymbol = new Map(ATTENTION_UNIVERSE.map((entry) => [entry.symbol, entry]));

function minute(bar: Candle): number { return getEasternTimeParts(new Date(bar.time * 1000)).minutesSinceMidnight; }
export function aggregateFive(bars: readonly Candle[]): Candle[] {
  return aggregateFiveMinuteBars(bars);
}
export function metricAt(allBars: readonly Candle[], minuteOfDay: number, priorSessionRegularBars: readonly Candle[] = []): MinuteMetric {
  const bars = allBars.filter((bar) => minute(bar) <= minuteOfDay).sort((a, b) => a.time - b.time);
  const bar = [...bars].reverse().find((row) => minute(row) === minuteOfDay) ?? null;
  if (!bar) return { bar: null, atr: null, rangeAtr: null, pathEfficiency: null, return5m: null, vwap: null, ema9: null, expansionBars: 0, priceLostVwap: false };
  const five = aggregateFive(bars);
  const currentRanges: number[] = []; let currentPrior: number | null = null;
  for (const item of five) { currentRanges.push(candleTrueRange(item, currentPrior)); currentPrior = item.close; }
  const seed = buildPriorSessionAtrSeed(priorSessionRegularBars);
  const fallbackRanges = [...seed.completedTrueRanges]; let fallbackPrior = seed.previousClose;
  for (const item of five) { fallbackRanges.push(candleTrueRange(item, fallbackPrior)); fallbackPrior = item.close; }
  const ranges = currentRanges.length >= 14 ? currentRanges : fallbackRanges;
  const atr = ranges.length >= 14 ? ranges.slice(-14).reduce((sum, value) => sum + value, 0) / 14 : null;
  const recent = bridgeRegularOpenWindow(bars.filter((row) => minute(row) >= minuteOfDay - 4), minuteOfDay, priorSessionRegularBars);
  const rangeAtr = atr && recent.length ? (Math.max(...recent.map((row) => row.high)) - Math.min(...recent.map((row) => row.low))) / atr : null;
  const pathEfficiency = atr ? calculatePathEfficiency(recent, atr).value : null;
  const pv = bars.reduce((sum, row) => sum + ((row.high + row.low + row.close) / 3) * row.volume, 0);
  const volume = bars.reduce((sum, row) => sum + row.volume, 0);
  let ema9: number | null = null, expansionBars = 0;
  for (const row of bars) { ema9 = ema9 === null ? row.close : row.close * 0.2 + ema9 * 0.8; expansionBars = atr && (row.high - row.low) / atr >= 0.2 ? expansionBars + 1 : 0; }
  const previousBars = bars.slice(0, -1), previousVolume = previousBars.reduce((sum, row) => sum + row.volume, 0);
  const previousVwap = previousVolume ? previousBars.reduce((sum, row) => sum + ((row.high + row.low + row.close) / 3) * row.volume, 0) / previousVolume : null;
  const vwap = volume ? pv / volume : null;
  return {
    bar, atr, rangeAtr, pathEfficiency,
    return5m: recent.length ? recent.at(-1)!.close / recent[0].open - 1 : null,
    vwap, ema9, expansionBars,
    priceLostVwap: previousBars.length > 0 && previousVwap !== null && previousBars.at(-1)!.close >= previousVwap && vwap !== null && bar.close < vwap,
  };
}
function z(history: ReadonlyArray<number | null>, current: number, axis: "participation" | "displacement" | "idiosyncrasy", transform: "linear" | "log1p" = "linear"): number | null {
  return buildContinuousSameTimeBaseline({ axis, historicalValues: history, currentValue: current, minSessions: MIN_BASELINE_SESSIONS, transform, dataQualityState: "ok" }).value;
}
function average(values: ReadonlyArray<number | null>): number | null {
  const usable = values.filter((value): value is number => value !== null);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}
export function regularOpenAt(batch: LiveMinuteBatch): number {
  const any = Object.values(batch.barsBySymbol).flat().find((bar) => minute(bar) === 570);
  if (any) return any.time * 1000;
  return batch.at - (batch.minuteOfDay - 570) * 60_000;
}

export class CalibratedIexAttentionProcessor implements AttentionRuntimeProcessor {
  private readonly a3: AttentionA3ReplayEngine;
  private readonly events: AttentionEventEngine;
  constructor(private readonly store: FeedAwareAttentionThresholdStore, private readonly history: readonly SessionBars[]) {
    const set = store.sets.iex_partial.regular;
    if (set.calibrationStatus !== "calibrated") throw new Error("Live IEX requires an exact calibrated regular-session set.");
    this.a3 = new AttentionA3ReplayEngine(store, ATTENTION_UNIVERSE);
    this.events = new AttentionEventEngine(store, { ...DEFAULT_ATTENTION_EVENT_CONFIG, alertEmissionEnabled: true });
  }
  restore(state: unknown): void {
    if (!state) return;
    const checkpoint = state as ProcessorCheckpoint;
    if (checkpoint.schemaVersion !== 1) throw new Error("Unsupported live processor checkpoint.");
    this.a3.restore(checkpoint.a3); this.events.restoreCheckpoint(checkpoint.events);
  }
  async process(batch: LiveMinuteBatch, controls: RuntimeControls): Promise<RuntimeProcessorResult> {
    const set = this.store.sets.iex_partial.regular;
    const timings = { baselineResolutionMs: 0, axisComputationMs: 0, scoringMs: 0, stateMachineMs: 0, episodeEventMs: 0 };
    let stageStartedAt = performance.now();
    const currentMetrics = new Map<string, MinuteMetric>();
    for (const entry of ATTENTION_UNIVERSE) currentMetrics.set(entry.symbol, metricAt(
      batch.barsBySymbol[entry.symbol] ?? [], batch.minuteOfDay,
      batch.priorSessionRegularBarsBySymbol?.[entry.symbol] ?? [],
    ));
    timings.axisComputationMs += performance.now() - stageStartedAt;
    stageStartedAt = performance.now();
    const historyMetrics = this.history.map((session) => {
      const metrics = new Map<string, MinuteMetric>();
      for (const entry of ATTENTION_UNIVERSE) metrics.set(entry.symbol, metricAt(
        session.bars[entry.symbol] ?? [], batch.minuteOfDay,
        session.priorSessionRegularBars?.[entry.symbol] ?? [],
      ));
      return metrics;
    });
    timings.baselineResolutionMs += performance.now() - stageStartedAt;
    const timedZ = (...args: Parameters<typeof z>): number | null => {
      const startedAt = performance.now();
      try { return z(...args); }
      finally { timings.baselineResolutionMs += performance.now() - startedAt; }
    };
    const axisLoopStartedAt = performance.now();
    const baselineBeforeLoop = timings.baselineResolutionMs;
    const scoringBeforeLoop = timings.scoringMs;
    const observations: AttentionHistoryObservation[] = [];
    const maps: Record<string, MarketMapSnapshot> = {};
    for (const entry of rankable) {
      const current = currentMetrics.get(entry.symbol)!;
      if (!current.bar || !current.atr || current.rangeAtr === null) continue;
      const histories = historyMetrics.map((day) => day.get(entry.symbol)!);
      const present = histories.filter((row) => row.bar).length;
      const pPresent = present / Math.max(1, histories.length);
      const baselineMode = pPresent >= 0.6 ? "dense" as const : pPresent > 0 ? "sparse" as const : "dead" as const;
      const participationInput = baselineMode === "dense"
        ? average([
            timedZ(histories.map((row) => row.bar?.volume ?? null), current.bar.volume, "participation", "log1p"),
            timedZ(histories.map((row) => row.bar ? row.bar.volume * row.bar.close : null), current.bar.volume * current.bar.close, "participation", "log1p"),
          ])
        : baselineMode === "dead" ? 6 : Math.min(6, -Math.log2(pPresent));
      const displacementZ = average([
        timedZ(histories.map((row) => row.rangeAtr), current.rangeAtr, "displacement", "log1p"),
        current.pathEfficiency === null ? null : timedZ(histories.map((row) => row.pathEfficiency), current.pathEfficiency, "displacement"),
      ]);
      const benchmark = currentMetrics.get(entry.benchmark);
      const sector = currentMetrics.get(entry.sectorEtf ?? entry.benchmark);
      if (participationInput === null || displacementZ === null || current.return5m === null || benchmark?.return5m === null || benchmark?.return5m === undefined || sector?.return5m === null || sector?.return5m === undefined) continue;
      const stockMagnitude = Math.abs(current.return5m - benchmark.return5m), sectorMagnitude = Math.abs(sector.return5m - benchmark.return5m);
      const stockZ = timedZ(historyMetrics.map((day) => { const s=day.get(entry.symbol)!, b=day.get(entry.benchmark)!; return s.return5m === null || b.return5m === null ? null : Math.abs(s.return5m-b.return5m); }), stockMagnitude, "idiosyncrasy");
      const sectorZ = timedZ(historyMetrics.map((day) => { const s=day.get(entry.sectorEtf ?? entry.benchmark)!, b=day.get(entry.benchmark)!; return s.return5m === null || b.return5m === null ? null : Math.abs(s.return5m-b.return5m); }), sectorMagnitude, "idiosyncrasy");
      const idiosyncrasyZ = Math.max(...[stockZ, sectorZ].filter((value): value is number => value !== null));
      if (!Number.isFinite(idiosyncrasyZ)) continue;
      const limited = entry.listedSince ? tradingSessionsSince(entry.listedSince, batch.tradingDate) < 120 : false;
      const raw = { tradingDate: batch.tradingDate, symbol: entry.symbol, minuteOfDay: batch.minuteOfDay, feedMode: "iex_partial" as const, subWindow: "regular" as const, participationInput, participationInputKind: baselineMode === "dense" ? "z" as const : "surprise_bits" as const, displacementZ, idiosyncrasyZ, limitedHistory: limited };
      const scoringStartedAt = performance.now();
      const score = scoreRawCalibrationPoint(raw, set.normalization);
      timings.scoringMs += performance.now() - scoringStartedAt;
      observations.push({ symbol: entry.symbol, at: batch.at, score: score.attention, core: score.core, feedMode: "iex_partial", subWindow: "regular", calibrationId: set.calibrationId, participationBaselineMode: baselineMode, participationInput, participationInputKind: raw.participationInputKind, displacementZ, idiosyncrasyZ, price: current.bar.close, atr: current.atr, vwap: current.vwap, ema9: current.ema9, consecutiveExpansionBars: current.expansionBars, pullbackObserved: false, priceLostVwap: current.priceLostVwap, dataQualityState: limited ? "limited_history" : "ok", provisional: false });
      try { maps[entry.symbol] = buildMarketMap({ symbol: entry.symbol, tradingDate: batch.tradingDate, at: batch.at, oneMinuteBars: batch.barsBySymbol[entry.symbol] ?? [], fiveMinuteBars: aggregateFive(batch.barsBySymbol[entry.symbol] ?? []), priorDailyBar: aggregateDailyBar(batch.priorSessionRegularBarsBySymbol?.[entry.symbol] ?? []), atr: current.atr }); } catch { /* map absence suppresses only level events */ }
    }
    timings.axisComputationMs += performance.now() - axisLoopStartedAt - (timings.baselineResolutionMs - baselineBeforeLoop) - (timings.scoringMs - scoringBeforeLoop);
    if (!observations.length) return { rows: rankable.map((entry) => ({ symbol: entry.symbol, attentionScore: null, core: null, state: null, freshness: null, rank: null, dataQualityState: "insufficient_reference" as const, dataQualityReason: "No synchronized target/benchmark/sector observation with a usable same-time baseline.", feedBadge: "IEX PARTIAL" as const, pendingTransition: "none" as const, pendingTransitionMinutes: 0 })), events: [], processorState: this.checkpoint(), statusMessage: "Regular session active; all 61 tradeable symbols are explicitly unavailable because synchronized references are insufficient.", stageTimings: timings };
    const a3Timings: AttentionA3ProcessTimings = { stateMachineMs: 0, episodeMs: 0 };
    const frame = this.a3.processMinute(observations, a3Timings);
    const calendar = exchangeCalendarDay(batch.tradingDate);
    const regular = calendar.isTradingDay && batch.minuteOfDay >= 570 && batch.minuteOfDay < calendar.regularCloseMinutes!;
    const mayDetect = regular && batch.complete && !batch.guard.active;
    const eventStartedAt = performance.now();
    const eventResult = mayDetect ? this.events.processFrame({ frame, marketMaps: maps, regularOpenAt: regularOpenAt(batch), sessionCloseAt: exchangeRegularCloseAt(batch.tradingDate).getTime(), earlyClose: exchangeCalendarDay(batch.tradingDate).kind === "early_close", backfillGuard: batch.guard.active, haltResumeGuard: batch.guard.reason === "halt_resume_inferred" }) : { emitted: [], suppressions: [] };
    timings.stateMachineMs = a3Timings.stateMachineMs;
    timings.episodeEventMs = a3Timings.episodeMs + performance.now() - eventStartedAt;
    const scoredRows: LiveAttentionRow[] = frame.rows.map((row) => ({ symbol: row.symbol, attentionScore: row.point.score, core: row.point.core, state: row.state, freshness: row.freshness?.freshness ?? null, rank: row.point.rank, dataQualityState: row.point.dataQualityState, dataQualityReason: row.stateExplanation, feedBadge: "IEX PARTIAL", pendingTransition: row.pendingTransition, pendingTransitionMinutes: row.pendingTransitionMinutes }));
    const scoredSymbols = new Set(scoredRows.map((row) => row.symbol));
    const unavailableRows: LiveAttentionRow[] = rankable.filter((entry) => !scoredSymbols.has(entry.symbol)).map((entry) => ({ symbol: entry.symbol, attentionScore: null, core: null, state: null, freshness: null, rank: null, dataQualityState: "insufficient_reference", dataQualityReason: "No synchronized target/benchmark/sector observation with a usable same-time baseline.", feedBadge: "IEX PARTIAL", pendingTransition: "none", pendingTransitionMinutes: 0 }));
    const rows = [...scoredRows, ...unavailableRows];
    return { rows, events: eventResult.emitted, processorState: this.checkpoint(), statusMessage: `${scoredRows.length} of 61 tradeable symbols scored on IEX PARTIAL; ${unavailableRows.length} explicitly unavailable; participation is display-only.`, stageTimings: timings };
  }
  private checkpoint(): ProcessorCheckpoint { return { schemaVersion: 1, a3: this.a3.snapshot(), events: this.events.checkpoint() }; }
}

export type { SessionBars as IexHistoricalSessionBars };
