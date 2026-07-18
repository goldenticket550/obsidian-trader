import type { Candle, DataQuality, Timeframe } from "@/types/candle";
import type { SetupCondition, SetupResult, SetupStage, SetupStatus } from "@/types/setup";
import type { StrategyConfig } from "./config";
import { detectIntradayDecline, detectRecoveryFromLow } from "@/lib/indicators/sessionDecline";
import { detectConsecutiveBullish } from "@/lib/indicators/consecutiveBullish";
import { detectLiquiditySweep } from "@/lib/indicators/liquiditySweep";
import { detectStructureShift } from "@/lib/indicators/structureShift";
import { detectEmaReclaim } from "@/lib/indicators/emaReclaim";
import { detectDailySmaConfirmation } from "@/lib/indicators/dailySma";
import {
  detectBullishFairValueGaps,
  trackGapFillStatus,
} from "@/lib/indicators/fairValueGap";
import { detectVolumeConfirmation } from "@/lib/indicators/volumeConfirmation";
import { detectStratConfirmation } from "@/lib/indicators/stratCandle";

export interface ScoreSetupInput {
  symbol: string;
  timeframe: Timeframe;
  sessionCandles: Candle[]; // all candles so far in the current session, ascending time
  dailyCandles: Candle[]; // daily candles for the SMA confirmation
  prevClose: number;
  config: StrategyConfig;
  /**
   * ISO timestamp to stamp results with. Required (not computed internally
   * via `new Date()`) so this function stays a pure, deterministic function
   * of its inputs — calling `Date.now()` inside a "pure" rule-engine
   * function silently breaks that guarantee and, in a Next.js client
   * component, produces a different value on the server render pass than
   * on client hydration, causing a hydration mismatch. Callers own the
   * timestamp.
   */
  now: string;
  /**
   * The actual data quality reported by whichever provider supplied
   * `sessionCandles` (from `CandleSeries.quality`). Passed through
   * explicitly rather than assumed, so the UI always reflects reality —
   * hardcoding "simulated" here would silently mislabel real live data as
   * mock, exactly the kind of mistake `types/candle.ts` calls out as
   * something the UI must never let happen.
   */
  quality: DataQuality;
}

/**
 * Required conditions determine red/yellow/green. Optional conditions add
 * to the score but never block green. This mirrors the spec: a green
 * status means all REQUIRED rules pass — optional confirmations are extra
 * context, not gates.
 */
export function scoreSetup(input: ScoreSetupInput): SetupResult {
  const { symbol, timeframe, sessionCandles, dailyCandles, prevClose, config, now, quality } = input;

  if (sessionCandles.length === 0) {
    return emptyResult(symbol, timeframe, now, quality);
  }

  const currentPrice = sessionCandles[sessionCandles.length - 1].close;

  const decline = detectIntradayDecline(sessionCandles, prevClose, config.intradayDecline);
  const recovery = detectRecoveryFromLow(sessionCandles, config.recoveryFromLow);
  const consecutive = detectConsecutiveBullish(sessionCandles, config.consecutiveBullish);
  const sweep = detectLiquiditySweep(sessionCandles, recovery.sessionLow, config.liquiditySweep);
  const sweepIndex = sweep.passed
    ? sessionCandles.findIndex((c) => c.time === sweep.reclaimCandleTime)
    : null;
  const structure = detectStructureShift(sessionCandles, sweepIndex, config.structureShift);
  const emaReclaim = detectEmaReclaim(sessionCandles, config.emaReclaim);

  const rawGaps = detectBullishFairValueGaps(sessionCandles, config.fairValueGap);
  const trackedGaps = rawGaps.map((gap) => {
    const afterIndex = sessionCandles.findIndex((c) => c.time === gap.candle3Time) + 1;
    return trackGapFillStatus(gap, sessionCandles.slice(afterIndex));
  });
  const activeGap = trackedGaps.find((g) => g.status === "open" || g.status === "partially_filled");

  const volume = detectVolumeConfirmation(sessionCandles, 20, config.volumeConfirmation);
  const dailySma = detectDailySmaConfirmation(
    dailyCandles,
    currentPrice,
    config.dailySma.period
  );
  const strat = config.strat.enabled ? detectStratConfirmation(sessionCandles) : null;

  const conditions: SetupCondition[] = [
    {
      id: "intraday_decline",
      label: "Significant intraday decline",
      required: true,
      state: decline.passed ? "pass" : "fail",
      detail: `${(decline.declineFromOpenPct * 100).toFixed(1)}% from open, ${(
        decline.declineFromPrevClosePct * 100
      ).toFixed(1)}% from prev close`,
    },
    {
      id: "recovery_from_low",
      label: "Recovery from session low",
      required: true,
      state: recovery.passed ? "pass" : "fail",
      detail: `$${recovery.dollarRecovery.toFixed(2)} (${(recovery.pctRecovery * 100).toFixed(
        1
      )}%) recovered from $${recovery.sessionLow.toFixed(2)} low`,
    },
    {
      id: "consecutive_bullish",
      label: "Consecutive bullish candles",
      required: true,
      state: consecutive.passed ? "pass" : "fail",
      detail: `${consecutive.candleCount}-candle window, $${consecutive.totalMoveDollars.toFixed(
        2
      )} total move`,
    },
    {
      id: "liquidity_sweep",
      label: "Liquidity sweep (experimental)",
      required: true,
      state: sweep.passed ? "pass" : "fail",
      detail: sweep.passed
        ? `Swept ${sweep.sweptLevelSource} at $${sweep.sweptLevel?.toFixed(2)}`
        : "No qualifying sweep detected",
    },
    {
      id: "structure_shift",
      label: "Bullish market-structure shift",
      required: true,
      state:
        structure.state === "confirmed" ? "pass" : structure.state === "invalidated" ? "invalidated" : "waiting",
      detail:
        structure.state === "confirmed"
          ? `Closed above swing high $${structure.triggerSwingHigh?.toFixed(2)}`
          : structure.triggerSwingHigh
          ? `Needs close above $${structure.triggerSwingHigh.toFixed(2)}`
          : "No swing high identified yet",
    },
    {
      id: "ema_reclaim",
      label: "9 EMA reclaim",
      required: true,
      state: emaReclaim.passed ? "pass" : "fail",
      detail:
        emaReclaim.emaValue !== null && emaReclaim.price !== null
          ? `Price $${emaReclaim.price.toFixed(2)} vs EMA $${emaReclaim.emaValue.toFixed(2)} (${(
              (emaReclaim.distancePct ?? 0) * 100
            ).toFixed(1)}%)`
          : "Not enough candles for EMA",
    },
    {
      id: "fair_value_gap",
      label: "Valid bullish fair value gap",
      required: true,
      state: activeGap ? "pass" : "waiting",
      detail: activeGap
        ? `Gap $${activeGap.lower.toFixed(2)}–$${activeGap.upper.toFixed(2)}, ${activeGap.status}`
        : "No qualifying 3-candle gap yet",
    },
    {
      id: "gap_proximity",
      label: "Price approaching or entering the gap",
      required: false,
      state: activeGap && currentPrice <= activeGap.upper ? "pass" : "waiting",
      detail: activeGap ? `Current price $${currentPrice.toFixed(2)}` : "No gap selected",
    },
    {
      id: "volume_confirmation",
      label: "Volume confirmation",
      required: false,
      state: volume.passed ? "pass" : "waiting",
      detail: `${(volume.relativeVolumePct * 100).toFixed(0)}% of average volume`,
    },
    {
      id: "daily_sma_confirmation",
      label: "Above daily 20 SMA",
      required: false,
      state: dailySma.passed ? "pass" : "waiting",
      detail:
        dailySma.smaValue !== null
          ? `Price $${currentPrice.toFixed(2)} vs daily SMA $${dailySma.smaValue.toFixed(2)} (${(
              (dailySma.distancePct ?? 0) * 100
            ).toFixed(1)}%)`
          : "Not enough daily candles for SMA",
    },
  ];

  if (strat) {
    conditions.push({
      id: "strat_confirmation",
      label: "Strat candle-type confirmation",
      required: false,
      state: strat.passed ? "pass" : "waiting",
      detail: strat.pattern ? strat.pattern : "No qualifying Strat pattern",
    });
  }

  const requiredConditions = conditions.filter((c) => c.required);
  const requiredPassed = requiredConditions.filter((c) => c.state === "pass").length;
  const anyInvalidated = conditions.some((c) => c.state === "invalidated");

  const optionalConditions = conditions.filter((c) => !c.required);
  const optionalPassed = optionalConditions.filter((c) => c.state === "pass").length;

  const score = requiredPassed + optionalPassed;
  const maxScore = conditions.length;

  let status: SetupStatus;
  if (anyInvalidated) {
    status = "red";
  } else if (requiredPassed === requiredConditions.length) {
    status = "green";
  } else if (requiredPassed > 0) {
    status = "yellow";
  } else {
    status = "red";
  }

  const stage = determineStage({
    decline: decline.passed,
    recovery: recovery.passed,
    consecutive: consecutive.passed,
    sweep: sweep.passed,
    structureConfirmed: structure.state === "confirmed",
    emaReclaim: emaReclaim.passed,
    hasGap: !!activeGap,
    gapProximity: !!activeGap && currentPrice <= activeGap.upper,
  });

  const lastCandle = sessionCandles[sessionCandles.length - 1];
  const latestCandleTime = lastCandle ? new Date(lastCandle.time * 1000).toISOString() : null;

  return {
    symbol,
    timeframe,
    quality,
    stage,
    status,
    score,
    maxScore,
    conditions,
    lastUpdated: now,
    latestCandleTime,
  };
}

function determineStage(flags: {
  decline: boolean;
  recovery: boolean;
  consecutive: boolean;
  sweep: boolean;
  structureConfirmed: boolean;
  emaReclaim: boolean;
  hasGap: boolean;
  gapProximity: boolean;
}): SetupStage {
  if (flags.gapProximity) return "gap_proximity";
  if (flags.hasGap) return "fair_value_gap";
  if (flags.emaReclaim) return "ema_reclaim";
  if (flags.structureConfirmed) return "structure_shift";
  if (flags.sweep) return "liquidity_sweep";
  if (flags.consecutive) return "consecutive_bullish";
  if (flags.recovery) return "recovery_from_low";
  if (flags.decline) return "intraday_decline";
  return "none";
}

function emptyResult(
  symbol: string,
  timeframe: Timeframe,
  now: string,
  quality: DataQuality
): SetupResult {
  return {
    symbol,
    timeframe,
    quality,
    stage: "none",
    status: "red",
    score: 0,
    maxScore: 0,
    conditions: [],
    lastUpdated: now,
    latestCandleTime: null,
  };
}
