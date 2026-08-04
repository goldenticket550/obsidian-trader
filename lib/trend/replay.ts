import type { Candle } from "@/types/candle";
import type { TrendScannerConfig } from "./config";
import { evaluateTrend } from "./evaluate";
import { emptyLifecycle } from "./stages";
import { selectTap2Level } from "./facts";
import type { SyntheticSession } from "./fixtures/syntheticSession";
import { getEasternTimeParts } from "@/lib/market-data/easternTime";
import type {
  KeyLevel,
  Measured,
  RelativeVolumeFact,
  TrendDirection,
  TrendLifecycle,
  TrendResult,
  TrendStage,
} from "./types";

/**
 * CAUSAL REPLAY.
 *
 * Reveals candles ONE AT A TIME and re-evaluates from scratch each step,
 * carrying only the lifecycle forward. Nothing in here can see a future
 * candle, which is the entire point: if the detector reports Trend Watch
 * at 10:05 during replay, it would have reported it at 10:05 live.
 *
 * Persists nothing. Emits nothing. Replay is an inspection tool.
 */

/** Eastern minute-of-day for a bar, for like-for-like baselines. */
function easternMinuteOfDay(timeSeconds: number): number {
  return getEasternTimeParts(new Date(timeSeconds * 1000)).minutesSinceMidnight;
}

export interface ReplayStep {
  /** Market time of the completed 5m bar just revealed. */
  marketDataAt: string;
  stage: TrendStage;
  price: number;
  /** Stage transitions recorded on this bar. */
  transitions: { stage: TrendStage; reason: string }[];
  /** Percent milestones crossed on this bar. */
  milestones: number[];
  /** Unmet requirements at this bar, for the exact blocker trail. */
  blockers: { requirement: string; detail: string }[];
  relativeVolume: Measured<number>;
  fromOriginPct: Measured<number>;
  /** The level TAP 2 would use at this bar, named honestly. */
  tap2LevelName: string | null;
}

export interface ReplayOutcome {
  symbol: string;
  direction: TrendDirection;
  tradingDate: string;
  /** Where the candles came from. Always reported, never assumed. */
  dataSource: "synthetic-fixture" | "provider" | "json-fixture";
  steps: ReplayStep[];
  final: TrendResult;
}

/**
 * Same-feed, same-time-of-day relative volume.
 *
 * The numerator and the baseline both come from the same feed and the
 * same bar interval. Mixing a consolidated baseline with an IEX
 * numerator would produce a number that looks like participation and
 * is really a feed-coverage artefact.
 */
export function relativeVolumeFrom(
  bar: Candle | null,
  baseline: number | null,
  feed: string,
  partialMarketCoverage: boolean
): RelativeVolumeFact {
  if (bar === null) {
    return {
      multiple: null,
      dollarMultiple: null,
      unavailableReason: "no completed bar",
      feed,
      partialMarketCoverage,
    };
  }
  if (baseline === null || !(baseline > 0)) {
    return {
      multiple: null,
      dollarMultiple: null,
      unavailableReason: "no same-feed time-of-day baseline",
      feed,
      partialMarketCoverage,
    };
  }
  const dollarBaseline = baseline * bar.close;
  return {
    multiple: bar.volume / baseline,
    dollarMultiple: dollarBaseline > 0 ? (bar.volume * bar.close) / dollarBaseline : null,
    unavailableReason: null,
    feed,
    partialMarketCoverage,
  };
}

export interface ReplayInput {
  session: SyntheticSession;
  direction: TrendDirection;
  config: TrendScannerConfig;
  dataSource: ReplayOutcome["dataSource"];
  feedLabel: string;
  pivotLength?: number;
}

export function replaySession(input: ReplayInput): ReplayOutcome {
  const { session, direction, config } = input;
  const pivotLength = input.pivotLength ?? 3;

  const levels: KeyLevel[] = [
    { name: "Premarket high", price: session.premarketHigh, availableFrom: null },
    { name: "Premarket low", price: session.premarketLow, availableFrom: null },
    { name: "Previous-day high", price: session.previousDayHigh, availableFrom: null },
    { name: "Previous-day low", price: session.previousDayLow, availableFrom: null },
  ];
  const premarketLevel: KeyLevel =
    direction === "bullish"
      ? { name: "Premarket high", price: session.premarketHigh, availableFrom: null }
      : { name: "Premarket low", price: session.premarketLow, availableFrom: null };

  let lifecycle: TrendLifecycle = emptyLifecycle();
  const steps: ReplayStep[] = [];
  let final: TrendResult | null = null;

  for (let i = 0; i < session.fiveMinute.length; i++) {
    // Only candles up to and including bar i exist at this step.
    const fiveMinute = session.fiveMinute.slice(0, i + 1);
    const bar = fiveMinute[fiveMinute.length - 1];
    const oneMinuteCutoff = bar.time + 5 * 60;
    const oneMinute = session.oneMinute.filter((c) => c.time + 60 <= oneMinuteCutoff);

    // Prefer the SAME-minute-of-day baseline when the loader supplied
    // one. A flat scalar would compare a 9:35 bar against an all-day
    // average and call ordinary opening volume a shock.
    const minuteKey = easternMinuteOfDay(bar.time);
    const baseline =
      session.fiveMinuteBaselineByMinute?.[minuteKey] ??
      (session.fiveMinuteVolumeBaseline > 0 ? session.fiveMinuteVolumeBaseline : null);

    const rv = relativeVolumeFrom(
      bar,
      baseline,
      input.feedLabel,
      /partial|iex/i.test(input.feedLabel)
    );

    // Evaluated exactly at the bar's close, so freshness is never the
    // thing under test during a replay.
    const evaluatedAt = new Date((bar.time + 5 * 60) * 1000);

    const out = evaluateTrend({
      symbol: session.symbol,
      direction,
      tradingDate: session.tradingDate,
      oneMinute,
      fiveMinute,
      daily: session.daily,
      levels,
      premarketLevel,
      relativeVolume: rv,
      // Not modelled by the fixture: unavailable, never zero.
      relativeToBenchmark: null,
      relativeToSector: null,
      previous: lifecycle,
      config,
      evaluatedAt,
      pivotLength,
      feedLabel: input.feedLabel,
    });

    lifecycle = out.result.lifecycle;
    final = out.result;

    steps.push({
      marketDataAt: new Date(bar.time * 1000).toISOString(),
      stage: out.result.lifecycle.stage,
      price: bar.close,
      transitions: out.newTransitions.map((t) => ({ stage: t.stage, reason: t.reason })),
      milestones: out.newMilestones,
      blockers: out.result.blockers,
      relativeVolume: out.result.facts.relativeVolume.multiple,
      fromOriginPct: out.result.facts.fromOriginPct,
      tap2LevelName:
        selectTap2Level({
          fiveMinute,
          premarket: premarketLevel,
          direction,
          openingRangeMinutes: config.openingRangeMinutes,
        })?.name ?? null,
    });
  }

  if (final === null) {
    throw new Error(`Replay produced no evaluations for ${session.symbol}`);
  }

  return {
    symbol: session.symbol,
    direction,
    tradingDate: session.tradingDate,
    dataSource: input.dataSource,
    steps,
    final,
  };
}

/** Human-readable transition timeline. Only bars that changed something. */
export function formatReplayTimeline(outcome: ReplayOutcome): string {
  const lines: string[] = [];
  lines.push(
    `${outcome.symbol} ${outcome.direction} — ${outcome.tradingDate} [${outcome.dataSource}]`
  );

  const eventful = outcome.steps.filter(
    (s) => s.transitions.length > 0 || s.milestones.length > 0
  );
  if (eventful.length === 0) {
    lines.push("  (no lifecycle transitions)");
  }
  for (const step of eventful) {
    for (const t of step.transitions) {
      lines.push(`  ${step.marketDataAt}  ${t.stage.toUpperCase().padEnd(16)} ${t.reason}`);
    }
    for (const m of step.milestones) {
      const pct = step.fromOriginPct === null ? "?" : step.fromOriginPct.toFixed(2);
      lines.push(
        `  ${step.marketDataAt}  MILESTONE ${String(m).padStart(2)}%   reached (${pct}% from origin)`
      );
    }
  }

  const last = outcome.steps[outcome.steps.length - 1];
  lines.push(`  final stage: ${outcome.final.lifecycle.stage}`);
  if (outcome.final.lifecycle.stage !== "trend_confirmed" && last.blockers.length > 0) {
    lines.push("  blockers at the last bar:");
    for (const b of last.blockers) lines.push(`    - ${b.requirement}: ${b.detail}`);
  }
  return lines.join("\n");
}
