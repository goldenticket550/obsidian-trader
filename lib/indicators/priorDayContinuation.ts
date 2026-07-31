import type { Candle } from "@/types/candle";
import type { StrategyConfig } from "@/lib/strategies/config";
import { findPreviousDailyCandle } from "@/lib/market-data/sessionFilter";

export type RejectionTier = "rejection" | "strong_rejection" | "none";

export interface PriorDayRejectionResult {
  passed: boolean;
  insufficientData: boolean;
  rejectionLevel: number | null;
  priorClose: number | null;
  declinePct: number | null;
  tier: RejectionTier;
}

/**
 * Rule A1 — was a level tested and rejected in the PRIOR regular session?
 *
 * `rejectionLevel = prior_high`. Two independent tiers, each `lte`:
 *   rejection        prior_close <= prior_high × (1 − rejectionThresholdPct)
 *   strong_rejection prior_close <= prior_high × (1 − strongRejectionThresholdPct)
 *
 * The prior candle is located by DATE via findPreviousDailyCandle, never
 * positionally: alpacaProvider deliberately does not session-filter the
 * `1d` series, so during market hours the array's last element is today's
 * still-forming bar. Taking it positionally would compare today's high
 * against today's own price and manufacture a "prior-day rejection" out
 * of the current session. When no strictly-earlier candle exists this
 * reports insufficientData rather than falling back to today's.
 */
export function detectPriorDayRejection(
  dailyCandles: Candle[],
  todayTradingDate: string,
  config: StrategyConfig["priorDayContinuation"]
): PriorDayRejectionResult {
  const prior = findPreviousDailyCandle(dailyCandles, todayTradingDate);

  if (!prior) {
    return {
      passed: false,
      insufficientData: true,
      rejectionLevel: null,
      priorClose: null,
      declinePct: null,
      tier: "none",
    };
  }

  const rejectionLevel = prior.high;
  const priorClose = prior.close;

  // Guard a zero/negative high rather than dividing by it — a real
  // series should never produce one, and silently emitting Infinity or
  // NaN as a "decline" would be worse than reporting no data.
  if (rejectionLevel <= 0) {
    return {
      passed: false,
      insufficientData: true,
      rejectionLevel: null,
      priorClose: null,
      declinePct: null,
      tier: "none",
    };
  }

  const declinePct = (rejectionLevel - priorClose) / rejectionLevel;

  const stronglyRejected = priorClose <= rejectionLevel * (1 - config.strongRejectionThresholdPct);
  const rejected = priorClose <= rejectionLevel * (1 - config.rejectionThresholdPct);

  // Tiers are evaluated independently per the rule table; the deeper one
  // is reported when both hold, since strong_rejection implies rejection.
  const tier: RejectionTier = stronglyRejected
    ? "strong_rejection"
    : rejected
    ? "rejection"
    : "none";

  return {
    passed: tier !== "none",
    insufficientData: false,
    rejectionLevel,
    priorClose,
    declinePct,
    tier,
  };
}

export interface PremarketReclaimResult {
  passed: boolean;
  insufficientData: boolean;
  reclaimLevel: number | null;
  currentPremarketPrice: number | null;
  reclaimCandleTime: number | null;
  sparseData: boolean;
}

/**
 * Minimum premarket candles below which coverage is called sparse rather
 * than treated as a real "no reclaim". The free IEX feed's premarket
 * coverage is materially thinner than regular hours (already-documented
 * limitation), so thin data must be flagged, not silently read as an
 * absence of buying.
 */
const SPARSE_PREMARKET_CANDLE_COUNT = 6;

/**
 * Rule A2 — did premarket genuinely RECLAIM the rejected level?
 *
 * Deliberately the "currently held reclaim" shape already proven in
 * detectVwapReclaim/detectEmaReclaim, not "is price above the level":
 *   1. if the latest premarket close is not above the level, no reclaim
 *      is being held right now — report accurate current values;
 *   2. otherwise walk backward while closes stay above, looking for the
 *      candle that genuinely crossed up from below;
 *   3. if the streak breaks first, or the series was above the whole way
 *      (never below), that is not a reclaim.
 */
export function detectPremarketReclaim(
  premarketCandles: Candle[],
  reclaimLevel: number | null
): PremarketReclaimResult {
  const sparseData =
    premarketCandles.length > 0 && premarketCandles.length < SPARSE_PREMARKET_CANDLE_COUNT;

  const insufficient: PremarketReclaimResult = {
    passed: false,
    insufficientData: true,
    reclaimLevel,
    currentPremarketPrice: null,
    reclaimCandleTime: null,
    sparseData,
  };

  // No level to reclaim (A1 had no prior candle) is itself no-data.
  if (reclaimLevel === null) return insufficient;
  if (premarketCandles.length < 2) return insufficient;

  const lastIndex = premarketCandles.length - 1;
  const currentPremarketPrice = premarketCandles[lastIndex].close;

  const base = {
    insufficientData: false,
    reclaimLevel,
    currentPremarketPrice,
    sparseData,
  };

  if (currentPremarketPrice <= reclaimLevel) {
    return { ...base, passed: false, reclaimCandleTime: null };
  }

  for (let i = lastIndex; i >= 1; i--) {
    const closedAboveHere = premarketCandles[i].close > reclaimLevel;
    if (!closedAboveHere) break;

    const prevClosedBelow = premarketCandles[i - 1].close < reclaimLevel;
    if (prevClosedBelow) {
      return { ...base, passed: true, reclaimCandleTime: premarketCandles[i].time };
    }
  }

  // Above the level the whole way with no crossing: "always been above",
  // not a reclaim — the same distinction the EMA/VWAP detectors make.
  return { ...base, passed: false, reclaimCandleTime: null };
}

export interface PriorDayContinuationResult {
  passed: boolean;
  insufficientData: boolean;
  rejection: PriorDayRejectionResult;
  reclaim: PremarketReclaimResult;
  detail: string;
}

/**
 * Rule A3 — the combined signal: `passed = A1.passed && A2.passed`.
 *
 * If EITHER sub-rule is insufficientData the combined result is
 * insufficientData, never silently a fail.
 *
 * The detail text deliberately describes only what already happened. It
 * never claims the move will continue into the regular session, and
 * carries no probability or confidence language.
 */
export function detectPriorDayContinuation(
  dailyCandles: Candle[],
  premarketCandles: Candle[],
  todayTradingDate: string,
  config: StrategyConfig["priorDayContinuation"]
): PriorDayContinuationResult {
  const rejection = detectPriorDayRejection(dailyCandles, todayTradingDate, config);
  const reclaim = detectPremarketReclaim(premarketCandles, rejection.rejectionLevel);

  const insufficientData = rejection.insufficientData || reclaim.insufficientData;
  const passed = !insufficientData && rejection.passed && reclaim.passed;

  return { passed, insufficientData, rejection, reclaim, detail: buildDetail(rejection, reclaim) };
}

function buildDetail(
  rejection: PriorDayRejectionResult,
  reclaim: PremarketReclaimResult
): string {
  if (rejection.insufficientData) {
    return "No prior session daily candle yet to measure a rejection against";
  }
  if (reclaim.insufficientData) {
    return `Prior-day rejection at $${rejection.rejectionLevel!.toFixed(2)}; not enough premarket candles yet to evaluate a reclaim`;
  }

  const sparseNote = reclaim.sparseData ? " (sparse premarket coverage)" : "";

  if (!rejection.passed) {
    return `No prior-day rejection — prior close $${rejection.priorClose!.toFixed(2)} vs high $${rejection.rejectionLevel!.toFixed(2)} (${formatDeclinePct(rejection.declinePct!)})${sparseNote}`;
  }

  const label = rejection.tier === "strong_rejection" ? "Strong prior-day rejection" : "Prior-day rejection";
  const head = `${label} at $${rejection.rejectionLevel!.toFixed(2)} (${formatDeclinePct(rejection.declinePct!)})`;

  if (reclaim.passed) {
    return `${head}, premarket reclaimed at $${reclaim.currentPremarketPrice!.toFixed(2)}${sparseNote}`;
  }
  return `${head}, premarket has not reclaimed it (currently $${reclaim.currentPremarketPrice!.toFixed(2)})${sparseNote}`;
}

/** A decline is reported as a negative percentage, e.g. "−2.3%". */
function formatDeclinePct(declinePct: number): string {
  return `−${(declinePct * 100).toFixed(1)}%`;
}
