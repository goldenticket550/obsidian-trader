import { AttentionA3ReplayEngine, type AttentionA3EngineState, type AttentionA3ProcessTimings } from "@/lib/attention/attentionA3Replay";
import { AttentionEventEngine, DEFAULT_ATTENTION_EVENT_CONFIG } from "@/lib/attention/attentionEvents";
import { exchangeCalendarDay, exchangeRegularCloseAt, tradingSessionsSince } from "@/lib/attention/exchangeCalendar";
import type { AttentionHistoryObservation } from "@/lib/attention/attentionHistory";
import { buildMarketMap, type MarketMapSnapshot } from "@/lib/attention/marketMap";
import { ATTENTION_UNIVERSE } from "@/lib/attention/universe";
import { rankableUniverse } from "@/lib/attention/universePolicy";
import { scoreRawCalibrationPoint } from "@/lib/replay/populationCalibration";
import type { FeedAwareAttentionThresholdStore } from "@/lib/replay/feedAwareAttentionThresholds";
import type { LiveAttentionRow, LiveMinuteBatch, RuntimeControls, RuntimeProcessorResult } from "./contracts";
import { aggregateFive, metricAt, regularOpenAt, type MinuteMetric } from "./iexProcessor";
import { assertIexBaselineTable, evaluateStaticContinuousBaseline, iexBaselineBucketKey, type IexBaselineTable } from "./iexBaselineTable";
import type { AttentionRuntimeProcessor } from "./worker";
import { aggregateDailyBar } from "./iexMetricWarmup";

interface StaticProcessorCheckpoint {
  schemaVersion: 2;
  baselineTableId: string;
  a3: AttentionA3EngineState;
  events: ReturnType<AttentionEventEngine["checkpoint"]>;
}

const rankable = rankableUniverse(ATTENTION_UNIVERSE);

function average(values: ReadonlyArray<number | null>): number | null {
  const usable = values.filter((value): value is number => value !== null);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

export class StaticBaselineIexAttentionProcessor implements AttentionRuntimeProcessor {
  private readonly a3: AttentionA3ReplayEngine;
  private readonly events: AttentionEventEngine;

  constructor(private readonly store: FeedAwareAttentionThresholdStore, private readonly baselineTable: IexBaselineTable) {
    assertIexBaselineTable(baselineTable);
    const set = store.sets.iex_partial.regular;
    if (set.calibrationStatus !== "calibrated") throw new Error("Live IEX requires an exact calibrated regular-session set.");
    this.a3 = new AttentionA3ReplayEngine(store, ATTENTION_UNIVERSE);
    this.events = new AttentionEventEngine(store, { ...DEFAULT_ATTENTION_EVENT_CONFIG, alertEmissionEnabled: true });
  }

  restore(state: unknown): void {
    if (!state) return;
    const checkpoint = state as StaticProcessorCheckpoint;
    if (checkpoint.schemaVersion !== 2) throw new Error("Live processor checkpoint predates the static baseline-table identity.");
    if (checkpoint.baselineTableId !== this.baselineTable.tableId) throw new Error("Live processor checkpoint baseline-table identity mismatch.");
    this.a3.restore(checkpoint.a3);
    this.events.restoreCheckpoint(checkpoint.events);
  }

  async process(batch: LiveMinuteBatch, controls: RuntimeControls): Promise<RuntimeProcessorResult> {
    const set = this.store.sets.iex_partial.regular;
    const timings = { baselineResolutionMs: 0, axisComputationMs: 0, scoringMs: 0, stateMachineMs: 0, episodeEventMs: 0 };
    const currentStartedAt = performance.now();
    const currentMetrics = new Map<string, MinuteMetric>();
    for (const entry of ATTENTION_UNIVERSE) currentMetrics.set(entry.symbol, metricAt(
      batch.barsBySymbol[entry.symbol] ?? [], batch.minuteOfDay,
      batch.priorSessionRegularBarsBySymbol?.[entry.symbol] ?? [],
    ));
    timings.axisComputationMs += performance.now() - currentStartedAt;
    const observations: AttentionHistoryObservation[] = [];
    const maps: Record<string, MarketMapSnapshot> = {};
    const loopStartedAt = performance.now();
    let loopBaselineMs = 0;
    let loopScoringMs = 0;

    const baselineValue = (baseline: Parameters<typeof evaluateStaticContinuousBaseline>[0], value: number): number | null => {
      const startedAt = performance.now();
      try { return evaluateStaticContinuousBaseline(baseline, value); }
      finally { loopBaselineMs += performance.now() - startedAt; }
    };

    for (const entry of rankable) {
      const current = currentMetrics.get(entry.symbol)!;
      if (!current.bar || !current.atr || current.rangeAtr === null) continue;
      const lookupStartedAt = performance.now();
      const bucket = this.baselineTable.buckets[iexBaselineBucketKey(entry.symbol, batch.minuteOfDay)];
      loopBaselineMs += performance.now() - lookupStartedAt;
      if (!bucket) throw new Error(`Missing static IEX baseline for ${entry.symbol} minute ${batch.minuteOfDay}.`);
      const participationInput = bucket.baselineMode === "dense"
        ? average([
            baselineValue(bucket.volume, current.bar.volume),
            baselineValue(bucket.dollarVolume, current.bar.volume * current.bar.close),
          ])
        : bucket.baselineMode === "dead" ? 6 : Math.min(6, -Math.log2(bucket.pPresent));
      const displacementZ = average([
        baselineValue(bucket.rangeAtr, current.rangeAtr),
        current.pathEfficiency === null ? null : baselineValue(bucket.pathEfficiency, current.pathEfficiency),
      ]);
      const benchmark = currentMetrics.get(entry.benchmark);
      const sector = currentMetrics.get(entry.sectorEtf ?? entry.benchmark);
      if (participationInput === null || displacementZ === null || current.return5m === null || benchmark?.return5m === null || benchmark?.return5m === undefined || sector?.return5m === null || sector?.return5m === undefined) continue;
      const stockMagnitude = Math.abs(current.return5m - benchmark.return5m);
      const sectorMagnitude = Math.abs(sector.return5m - benchmark.return5m);
      const stockZ = baselineValue(bucket.stockMagnitude, stockMagnitude);
      const sectorZ = baselineValue(bucket.sectorMagnitude, sectorMagnitude);
      const idiosyncrasyValues = [stockZ, sectorZ].filter((value): value is number => value !== null);
      if (!idiosyncrasyValues.length) continue;
      const idiosyncrasyZ = Math.max(...idiosyncrasyValues);
      const limited = entry.listedSince ? tradingSessionsSince(entry.listedSince, batch.tradingDate) < 120 : false;
      const raw = {
        tradingDate: batch.tradingDate,
        symbol: entry.symbol,
        minuteOfDay: batch.minuteOfDay,
        feedMode: "iex_partial" as const,
        subWindow: "regular" as const,
        participationInput,
        participationInputKind: bucket.baselineMode === "dense" ? "z" as const : "surprise_bits" as const,
        displacementZ,
        idiosyncrasyZ,
        limitedHistory: limited,
      };
      const scoringStartedAt = performance.now();
      const score = scoreRawCalibrationPoint(raw, set.normalization);
      loopScoringMs += performance.now() - scoringStartedAt;
      observations.push({
        symbol: entry.symbol, at: batch.at, score: score.attention, core: score.core,
        feedMode: "iex_partial", subWindow: "regular", calibrationId: set.calibrationId,
        participationBaselineMode: bucket.baselineMode, participationInput,
        participationInputKind: raw.participationInputKind, displacementZ, idiosyncrasyZ,
        price: current.bar.close, atr: current.atr, vwap: current.vwap, ema9: current.ema9,
        consecutiveExpansionBars: current.expansionBars, pullbackObserved: false,
        priceLostVwap: current.priceLostVwap, dataQualityState: limited ? "limited_history" : "ok",
        provisional: false,
      });
      try {
        maps[entry.symbol] = buildMarketMap({
          symbol: entry.symbol, tradingDate: batch.tradingDate, at: batch.at,
          oneMinuteBars: batch.barsBySymbol[entry.symbol] ?? [],
          fiveMinuteBars: aggregateFive(batch.barsBySymbol[entry.symbol] ?? []),
          priorDailyBar: aggregateDailyBar(batch.priorSessionRegularBarsBySymbol?.[entry.symbol] ?? []), atr: current.atr,
        });
      } catch { /* map absence suppresses only level events */ }
    }
    timings.baselineResolutionMs = loopBaselineMs;
    timings.scoringMs = loopScoringMs;
    timings.axisComputationMs += performance.now() - loopStartedAt - loopBaselineMs - loopScoringMs;

    const unavailable = (symbol: string): LiveAttentionRow => ({
      symbol, attentionScore: null, core: null, state: null, freshness: null, rank: null,
      dataQualityState: "insufficient_reference",
      dataQualityReason: "No synchronized target/benchmark/sector observation with a usable same-time baseline.",
      feedBadge: "IEX PARTIAL", pendingTransition: "none", pendingTransitionMinutes: 0,
    });
    if (!observations.length) return {
      rows: rankable.map((entry) => unavailable(entry.symbol)), events: [], processorState: this.checkpoint(),
      statusMessage: "Regular session active; all 61 tradeable symbols are explicitly unavailable because synchronized references are insufficient.",
      stageTimings: timings,
    };

    const a3Timings: AttentionA3ProcessTimings = { stateMachineMs: 0, episodeMs: 0 };
    const frame = this.a3.processMinute(observations, a3Timings);
    const calendar = exchangeCalendarDay(batch.tradingDate);
    const regular = calendar.isTradingDay && batch.minuteOfDay >= 570 && batch.minuteOfDay < calendar.regularCloseMinutes!;
    const mayDetect = regular && batch.complete && !batch.guard.active;
    const eventStartedAt = performance.now();
    const eventResult = mayDetect ? this.events.processFrame({
      frame, marketMaps: maps, regularOpenAt: regularOpenAt(batch),
      sessionCloseAt: exchangeRegularCloseAt(batch.tradingDate).getTime(),
      earlyClose: exchangeCalendarDay(batch.tradingDate).kind === "early_close",
      backfillGuard: batch.guard.active, haltResumeGuard: batch.guard.reason === "halt_resume_inferred",
    }) : { emitted: [], suppressions: [] };
    timings.stateMachineMs = a3Timings.stateMachineMs;
    timings.episodeEventMs = a3Timings.episodeMs + performance.now() - eventStartedAt;
    const scoredRows: LiveAttentionRow[] = frame.rows.map((row) => ({
      symbol: row.symbol, attentionScore: row.point.score, core: row.point.core, state: row.state,
      freshness: row.freshness?.freshness ?? null, rank: row.point.rank,
      dataQualityState: row.point.dataQualityState, dataQualityReason: row.stateExplanation,
      feedBadge: "IEX PARTIAL", pendingTransition: row.pendingTransition,
      pendingTransitionMinutes: row.pendingTransitionMinutes,
    }));
    const scoredSymbols = new Set(scoredRows.map((row) => row.symbol));
    const unavailableRows = rankable.filter((entry) => !scoredSymbols.has(entry.symbol)).map((entry) => unavailable(entry.symbol));
    return {
      rows: [...scoredRows, ...unavailableRows], events: eventResult.emitted, processorState: this.checkpoint(),
      statusMessage: `${scoredRows.length} of 61 tradeable symbols scored on IEX PARTIAL; ${unavailableRows.length} explicitly unavailable; participation is display-only.`,
      stageTimings: timings,
    };
  }

  private checkpoint(): StaticProcessorCheckpoint {
    return { schemaVersion: 2, baselineTableId: this.baselineTable.tableId, a3: this.a3.snapshot(), events: this.events.checkpoint() };
  }
}
