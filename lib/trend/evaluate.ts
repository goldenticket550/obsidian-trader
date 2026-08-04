import type { Candle } from "@/types/candle";
import { getSessionTypeForTimestamp } from "@/lib/market-data/session";
import type { TrendScannerConfig } from "./config";
import { computeTrendFacts, openingRangeLevels, selectTap2Level } from "./facts";
import { detectHeldBaseOrigin, detectMomentumOrigin } from "./origin";
import { advanceLifecycle, buildSetupKey, emptyLifecycle } from "./stages";
import { opsFor } from "./direction";
import type {
  KeyLevel,
  Measured,
  RelativeVolumeFact,
  TrendDirection,
  TrendGate,
  TrendLifecycle,
  TrendResult,
  TrendTransition,
} from "./types";

/**
 * ONE EVALUATION of one symbol in one direction on one completed bar.
 *
 * Pure. No clock of its own, no I/O, no persistence. Everything it knows
 * arrives as an argument, which is what lets the replay tool reproduce a
 * live session exactly by feeding candles one at a time.
 */

export interface EvaluateInput {
  symbol: string;
  direction: TrendDirection;
  tradingDate: string;
  /** COMPLETED 1m candles up to and including the evaluation bar. */
  oneMinute: readonly Candle[];
  /** COMPLETED 5m candles up to and including the evaluation bar. */
  fiveMinute: readonly Candle[];
  /** COMPLETED daily candles. Higher-timeframe context only. */
  daily: readonly Candle[];
  /** Key levels with honest availability times. */
  levels: readonly KeyLevel[];
  /** The frozen premarket level for this direction, when it exists. */
  premarketLevel: KeyLevel | null;
  relativeVolume: RelativeVolumeFact;
  relativeToBenchmark: Measured<number>;
  relativeToSector: Measured<number>;
  previous: TrendLifecycle;
  config: TrendScannerConfig;
  /** Wall-clock evaluation time. Never used as a market timestamp. */
  evaluatedAt: Date;
  pivotLength: number;
  feedLabel: string;
}

export interface EvaluateOutput {
  result: TrendResult;
  newTransitions: TrendTransition[];
  newMilestones: number[];
}

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function ageSeconds(barTimeSec: number, intervalMinutes: number, now: Date): number {
  // Aged from the bar's CLOSE: a 5m bar stamped 9:20 was not finished
  // informing us until 9:25.
  const closeMs = (barTimeSec + intervalMinutes * 60) * 1000;
  return Math.max(0, Math.round((now.getTime() - closeMs) / 1000));
}

/**
 * Freshness and session gate.
 *
 * Returns EVERY reason it is not alertable rather than the first, so the
 * UI can explain the whole picture instead of one symptom at a time.
 */
export function computeGate(input: {
  oneMinute: readonly Candle[];
  fiveMinute: readonly Candle[];
  config: TrendScannerConfig;
  evaluatedAt: Date;
  feedLabel: string;
}): TrendGate {
  const { config, evaluatedAt } = input;
  const reasons: string[] = [];

  const lastOne = input.oneMinute[input.oneMinute.length - 1] ?? null;
  const lastFive = input.fiveMinute[input.fiveMinute.length - 1] ?? null;

  const oneAge = lastOne === null ? null : ageSeconds(lastOne.time, 1, evaluatedAt);
  const fiveAge = lastFive === null ? null : ageSeconds(lastFive.time, 5, evaluatedAt);

  const sessionAt = lastFive ?? lastOne;
  const session = sessionAt === null
    ? ("closed" as const)
    : getSessionTypeForTimestamp(new Date(sessionAt.time * 1000));

  if (lastFive === null) reasons.push("No completed 5-minute bar");
  if (lastOne === null) reasons.push("No completed 1-minute bar");
  if (oneAge !== null && oneAge > config.oneMinuteFreshnessSeconds) {
    reasons.push(`1-minute data is ${oneAge}s old`);
  }
  if (fiveAge !== null && fiveAge > config.fiveMinuteFreshnessSeconds) {
    reasons.push(`5-minute data is ${fiveAge}s old`);
  }
  if (session === "closed" || !config.allowedSessions.includes(session)) {
    reasons.push(`Session ${session} is not enabled for alerts`);
  }

  return {
    alertable: reasons.length === 0,
    reasons,
    session,
    oneMinuteAgeSeconds: oneAge,
    fiveMinuteAgeSeconds: fiveAge,
    feedLabel: input.feedLabel,
  };
}

/** The single most useful sentence about why this symbol is on screen. */
function primaryReason(result: Omit<TrendResult, "primaryReason">): string {
  const { lifecycle, facts, direction } = result;
  const way = direction === "bullish" ? "up" : "down";

  switch (lifecycle.stage) {
    case "failed":
      return lifecycle.transitions[lifecycle.transitions.length - 1]?.reason ?? "Setup failed";
    case "extended":
      return facts.atrFromFiveMinuteEma === null
        ? "Stretched from its average"
        : `${facts.atrFromFiveMinuteEma.toFixed(1)} ATR from the 5m 9 EMA — stretched`;
    case "level_break": {
      // Names whichever level actually broke — premarket or opening
      // range — by reusing the recorded transition rather than assuming.
      const t = [...lifecycle.transitions].reverse().find((x) => x.stage === "level_break");
      return t?.reason ?? "Closed through its continuation level";
    }
    case "trend_confirmed": {
      const move = facts.fromOriginDollars;
      const pct = facts.fromOriginPct;
      if (move === null || pct === null) return `Trend confirmed ${way}`;
      return `Moved $${Math.abs(move).toFixed(2)} (${Math.abs(pct).toFixed(1)}%) from its origin`;
    }
    case "trend_watch": {
      const t = facts.closeTransitions;
      const rv = facts.relativeVolume.multiple;
      const parts = [`${t.favourable} of ${t.transitions} closes ${way}`];
      if (rv !== null) parts.push(`${rv.toFixed(1)}x volume`);
      return `Turning ${way}: ${parts.join(", ")}`;
    }
    case "basing":
      return "Basing — a higher low is holding but has not confirmed";
    default:
      return "No active trend setup";
  }
}

/** Facts that could not be measured at all, named honestly. */
function unavailableFacts(result: Pick<TrendResult, "facts">): string[] {
  const out: string[] = [];
  const f = result.facts;
  if (f.atr5m === null) out.push("5-minute ATR");
  if (f.oneMinuteEma9.value === null) out.push("1-minute 9 EMA");
  if (f.fiveMinuteEma9.value === null) out.push("5-minute 9 EMA");
  if (f.fiveMinuteSma20.value === null) out.push("5-minute 20 SMA");
  if (f.dailySma20.value === null) out.push("Daily 20 SMA");
  if (f.vwap.value === null) out.push("VWAP");
  if (f.relativeVolume.multiple === null) {
    out.push(`Relative volume (${f.relativeVolume.unavailableReason ?? "not measurable"})`);
  }
  if (f.relativeToBenchmark === null) out.push("Relative strength vs QQQ");
  if (f.relativeToSector === null) out.push("Relative strength vs sector");
  if (!f.closeTransitions.measurable) out.push("Close-to-close transitions");
  return out;
}

export function evaluateTrend(input: EvaluateInput): EvaluateOutput {
  const gate = computeGate({
    oneMinute: input.oneMinute,
    fiveMinute: input.fiveMinute,
    config: input.config,
    evaluatedAt: input.evaluatedAt,
    feedLabel: input.feedLabel,
  });

  const previous = input.previous ?? emptyLifecycle();

  // Facts are computed against the PREVIOUS origin, so "move from origin"
  // is measured from where the setup actually started.
  const factsWithPrevOrigin = computeTrendFacts({
    direction: input.direction,
    oneMinute: input.oneMinute,
    fiveMinute: input.fiveMinute,
    daily: input.daily,
    levels: input.levels,
    relativeVolume: input.relativeVolume,
    relativeToBenchmark: input.relativeToBenchmark,
    relativeToSector: input.relativeToSector,
    origin: previous.origin,
    transitions: input.config.higherCloseTransitions,
    pivotLength: input.pivotLength,
  });

  // Only look for a NEW origin when there is no live one.
  const needsOrigin = previous.origin === null;
  const basePath = needsOrigin
    ? detectHeldBaseOrigin({
        oneMinute: input.oneMinute,
        fiveMinute: input.fiveMinute,
        direction: input.direction,
        atr5m: factsWithPrevOrigin.atr5m,
        levels: input.levels,
        config: input.config,
      })
    : { origin: null, rejections: [], stabilisation: [] };

  const momentumPath =
    needsOrigin && basePath.origin === null
      ? detectMomentumOrigin({
          oneMinute: input.oneMinute,
          fiveMinute: input.fiveMinute,
          direction: input.direction,
          atr5m: factsWithPrevOrigin.atr5m,
          levels: input.levels,
          relativeVolume: input.relativeVolume.multiple,
          config: input.config,
        })
      : { origin: null, rejections: [], stabilisation: [] };

  const candidateOrigin = basePath.origin ?? momentumPath.origin;

  const fiveMinuteBars = input.fiveMinute;
  const previousClose =
    fiveMinuteBars.length >= 2 ? fiveMinuteBars[fiveMinuteBars.length - 2].close : null;

  // TAP 2 level chosen per setup: premarket while overhead, otherwise
  // the opening range. Recomputed each bar from completed data only.
  const tap2Level = selectTap2Level({
    fiveMinute: input.fiveMinute,
    premarket: input.premarketLevel,
    direction: input.direction,
    openingRangeMinutes: input.config.openingRangeMinutes,
  });

  // Best completed extreme since the origin, EXCLUDING the current bar,
  // so the candle that makes a new high is the candle that reports it.
  const originAt = previous.origin === null ? null : Date.parse(previous.origin.establishedAt) / 1000;
  const sinceOrigin = originAt === null
    ? []
    : fiveMinuteBars.slice(0, -1).filter((c) => c.time >= originAt);
  const dirOps = opsFor(input.direction);
  const blueSkyReference = sinceOrigin.length === 0
    ? null
    : sinceOrigin.reduce((best, c) => dirOps.best(best, dirOps.extreme(c)), dirOps.extreme(sinceOrigin[0]));

  const advanced = advanceLifecycle({
    previous,
    facts: factsWithPrevOrigin,
    direction: input.direction,
    config: input.config,
    marketDataAt:
      fiveMinuteBars.length > 0
        ? iso(fiveMinuteBars[fiveMinuteBars.length - 1].time)
        : input.evaluatedAt.toISOString(),
    candidateOrigin,
    // A base candidate exists but has not earned Trend Watch yet.
    hasBasingCandidate:
      basePath.origin !== null || basePath.rejections.includes("stabilisation_insufficient"),
    blueSkyReference,
    previousClose,
    evaluable: gate.alertable,
  });

  let lifecycle = advanced.lifecycle;

  // Assign the stable setup key once the origin is locked.
  if (lifecycle.origin !== null && lifecycle.setupKey === null) {
    lifecycle = {
      ...lifecycle,
      setupKey: buildSetupKey(input.symbol, input.direction, input.tradingDate, lifecycle.origin),
    };
  }

  // Recompute the move against the NEWLY locked origin so the first
  // evaluation after a lock already reports a real distance.
  const facts =
    lifecycle.origin !== previous.origin
      ? computeTrendFacts({
          direction: input.direction,
          oneMinute: input.oneMinute,
          fiveMinute: input.fiveMinute,
          daily: input.daily,
          levels: input.levels,
          relativeVolume: input.relativeVolume,
          relativeToBenchmark: input.relativeToBenchmark,
          relativeToSector: input.relativeToSector,
          origin: lifecycle.origin,
          transitions: input.config.higherCloseTransitions,
          pivotLength: input.pivotLength,
        })
      : factsWithPrevOrigin;

  const base: Omit<TrendResult, "primaryReason"> = {
    symbol: input.symbol,
    direction: input.direction,
    tradingDate: input.tradingDate,
    lifecycle,
    facts,
    timestamps: {
      oneMinuteBarAt:
        input.oneMinute.length > 0 ? iso(input.oneMinute[input.oneMinute.length - 1].time) : null,
      fiveMinuteBarAt:
        fiveMinuteBars.length > 0 ? iso(fiveMinuteBars[fiveMinuteBars.length - 1].time) : null,
      dailyBarAt: input.daily.length > 0 ? iso(input.daily[input.daily.length - 1].time) : null,
      evaluatedAt: input.evaluatedAt.toISOString(),
    },
    nextConfirmation: advanced.nextConfirmation,
    invalidation:
      lifecycle.origin === null
        ? null
        : {
            price: lifecycle.origin.invalidationPrice,
            description: `A completed close beyond ${lifecycle.origin.invalidationPrice.toFixed(2)} ends this setup`,
          },
    blockers: advanced.blockers,
    unavailable: unavailableFacts({ facts }),
    gate,
  };

  return {
    result: { ...base, primaryReason: primaryReason(base) },
    newTransitions: advanced.newTransitions,
    newMilestones: advanced.newMilestones,
  };
}
