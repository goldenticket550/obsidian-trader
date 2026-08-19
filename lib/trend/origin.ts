import type { Candle } from "@/types/candle";
import { calculateEma, calculateSma, latestValid } from "@/lib/indicators/movingAverages";
import { calculateVwap } from "@/lib/indicators/vwap";
import { opsFor } from "./direction";
import type { TrendScannerConfig } from "./config";
import { closeTransitions } from "./facts";
import type { KeyLevel, TrendDirection, TrendOrigin } from "./types";

/**
 * CAUSAL ORIGIN DETECTION.
 *
 * Two valid paths, because requiring a clean base is exactly how the old
 * scanner missed straight-line moves, and requiring only momentum is how
 * it would chase every spike.
 *
 * Both paths are strictly causal: they are handed candles up to the
 * evaluation bar and never index beyond it. The locked origin is derived
 * ONLY from bars at or before the lock, so replaying the session one bar
 * at a time reproduces the same origin the live scan produced.
 *
 * Once locked, an origin NEVER trails. Trailing it upward as price rises
 * would shrink the measured move toward zero and make every milestone
 * unreachable.
 */

/** Prices closer than this are treated as equal, not "higher". */
export const PRICE_EPSILON = 1e-6;

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

export type OriginRejection =
  | "insufficient_candles"
  | "no_atr"
  | "no_candidate_low"
  | "candidate_not_above_session_extreme"
  | "pullback_too_shallow"
  | "hold_not_satisfied"
  | "stabilisation_insufficient"
  | "not_beyond_emas"
  | "transitions_insufficient"
  | "relative_volume_insufficient"
  | "close_not_near_extreme"
  | "no_key_level_interaction";

export interface OriginAttempt {
  origin: TrendOrigin | null;
  /** Why no origin locked. Empty when one did. */
  rejections: OriginRejection[];
  /** Stabilisation signals observed, for display. */
  stabilisation: string[];
}

/** Evidence that a base is actually stabilising, not just pausing. */
function stabilisationSignals(
  oneMinute: readonly Candle[],
  fiveMinute: readonly Candle[],
  candidateIndex: number,
  direction: TrendDirection,
  config: TrendScannerConfig,
  levels: readonly KeyLevel[]
): string[] {
  const ops = opsFor(direction);
  const signals: string[] = [];

  // 1. Contracting true range across the hold window.
  const window = oneMinute.slice(candidateIndex, candidateIndex + config.baseHoldBars + 1);
  if (window.length >= 3) {
    const ranges = window.map((c) => c.high - c.low);
    const firstHalf = ranges.slice(0, Math.floor(ranges.length / 2));
    const secondHalf = ranges.slice(Math.floor(ranges.length / 2));
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    if (secondHalf.length > 0 && firstHalf.length > 0 && avg(secondHalf) < avg(firstHalf)) {
      signals.push("Contracting range");
    }
  }

  // 2. Favourable close transitions.
  const t = closeTransitions(oneMinute, config.higherCloseTransitions, direction);
  if (t.measurable && t.favourable >= config.minimumHigherCloses) {
    signals.push(
      `${t.favourable} of ${t.transitions} ${direction === "bullish" ? "higher" : "lower"} closes`
    );
  }

  // 3. Holding the 1m 9 EMA.
  const ema = latestValid(calculateEma(oneMinute as Candle[], 9));
  const last = oneMinute[oneMinute.length - 1];
  if (ema !== null && last && ops.beyond(last.close, ema)) {
    signals.push("Holding 1m 9 EMA");
  }

  // 4. Holding VWAP or the 5m 20 SMA.
  if (fiveMinute.length > 0) {
    const vwap = latestValid(calculateVwap(fiveMinute as Candle[]));
    const sma = latestValid(calculateSma(fiveMinute as Candle[], 20));
    const close = fiveMinute[fiveMinute.length - 1].close;
    if (vwap !== null && ops.beyond(close, vwap)) signals.push("Holding VWAP");
    else if (sma !== null && ops.beyond(close, sma)) signals.push("Holding 5m 20 SMA");
  }

  // 5. Proximity to a real key level.
  if (last) {
    const near = levels.some(
      (l) =>
        Number.isFinite(l.price) &&
        last.close !== 0 &&
        Math.abs(l.price - last.close) / last.close < 0.005
    );
    if (near) signals.push("At a key level");
  }

  return signals;
}

/**
 * PATH A — a held higher-low base (mirrored for bearish).
 *
 * The candidate must be a genuine higher low: strictly beyond the
 * session extreme by more than an epsilon. Matching the session low is
 * a double-bottom, not a higher low, and treating it as one is how a
 * still-falling name gets called a base.
 */
export function detectHeldBaseOrigin(args: {
  oneMinute: readonly Candle[];
  fiveMinute: readonly Candle[];
  direction: TrendDirection;
  atr5m: number | null;
  levels: readonly KeyLevel[];
  config: TrendScannerConfig;
}): OriginAttempt {
  const { oneMinute, fiveMinute, direction, atr5m, levels, config } = args;
  const ops = opsFor(direction);
  const rejections: OriginRejection[] = [];

  if (oneMinute.length < config.baseHoldBars + 2) {
    return { origin: null, rejections: ["insufficient_candles"], stabilisation: [] };
  }
  if (atr5m === null || !(atr5m > 0)) {
    return { origin: null, rejections: ["no_atr"], stabilisation: [] };
  }

  const search = oneMinute.slice(-config.baseLookbackOneMinuteBars);
  const offset = oneMinute.length - search.length;

  // The session extreme BEFORE any candidate — tracked separately from
  // later candidate lows so a higher low is measured against the real
  // session extreme, not against itself.
  let sessionExtreme = ops.adverseExtreme(search[0]);
  let best: OriginAttempt | null = null;

  // A candidate must have `baseHoldBars` completed bars after it, all of
  // which held. That is what makes the lock causal.
  for (let i = 1; i <= search.length - 1 - config.baseHoldBars; i++) {
    const candidate = search[i];
    const candidateLow = ops.adverseExtreme(candidate);

    // Strictly beyond the session extreme, by more than epsilon.
    const isHigherLow =
      ops.beyond(candidateLow, sessionExtreme) &&
      Math.abs(candidateLow - sessionExtreme) > PRICE_EPSILON;

    if (!isHigherLow) {
      if (ops.adverse(candidateLow, sessionExtreme)) sessionExtreme = candidateLow;
      if (!rejections.includes("candidate_not_above_session_extreme")) {
        rejections.push("candidate_not_above_session_extreme");
      }
      continue;
    }

    // Pullback from a causal high BEFORE the candidate.
    const priorWindow = search.slice(0, i);
    let priorHigh = ops.extreme(priorWindow[0]);
    for (const c of priorWindow) priorHigh = ops.best(priorHigh, ops.extreme(c));
    const pullback = Math.abs(priorHigh - candidateLow);
    if (pullback < config.minimumPullbackAtr * atr5m) {
      if (!rejections.includes("pullback_too_shallow")) rejections.push("pullback_too_shallow");
      continue;
    }

    // The hold: no completed bar in the window may breach the candidate.
    const holdWindow = search.slice(i + 1, i + 1 + config.baseHoldBars);
    const held = holdWindow.every((c) => !ops.adverse(ops.adverseExtreme(c), candidateLow));
    if (!held || holdWindow.length < config.baseHoldBars) {
      if (!rejections.includes("hold_not_satisfied")) rejections.push("hold_not_satisfied");
      continue;
    }

    const lockIndex = offset + i + config.baseHoldBars;
    const signals = stabilisationSignals(
      oneMinute.slice(0, lockIndex + 1),
      fiveMinute,
      offset + i,
      direction,
      config,
      levels
    );
    if (signals.length < 2) {
      if (!rejections.includes("stabilisation_insufficient")) {
        rejections.push("stabilisation_insufficient");
      }
      continue;
    }

    const attempt: OriginAttempt = {
      origin: {
        mode: "held_base",
        price: candidateLow,
        establishedAt: iso(oneMinute[lockIndex].time),
        invalidationPrice: ops.adverseOffset(
          candidateLow,
          config.originInvalidationAtr * atr5m
        ),
        // The causal high this base retraced from — computed above from
        // bars strictly BEFORE the candidate, so it is knowable at the lock.
        pullbackFrom: priorHigh,
      },
      rejections: [],
      stabilisation: signals,
    };
    // Keep the EARLIEST qualifying base: it is the one that actually
    // locked first in real time. A later one would be hindsight.
    if (best === null) best = attempt;
  }

  return best ?? { origin: null, rejections: rejections.length > 0 ? rejections : ["no_candidate_low"], stabilisation: [] };
}

/**
 * PATH B — momentum expansion with no clean base.
 *
 * Exists so a straight-line move is not missed simply because it never
 * paused. The origin is the adverse extreme of the causal pre-impulse
 * window and is locked ONCE — never revised using later bars, which
 * would silently shrink every measured move.
 */
export function detectMomentumOrigin(args: {
  oneMinute: readonly Candle[];
  fiveMinute: readonly Candle[];
  direction: TrendDirection;
  atr5m: number | null;
  levels: readonly KeyLevel[];
  relativeVolume: number | null;
  config: TrendScannerConfig;
}): OriginAttempt {
  const { oneMinute, fiveMinute, direction, atr5m, levels, relativeVolume, config } = args;
  const ops = opsFor(direction);
  const rejections: OriginRejection[] = [];

  if (fiveMinute.length < config.higherCloseTransitions + 1 || oneMinute.length < 2) {
    return { origin: null, rejections: ["insufficient_candles"], stabilisation: [] };
  }
  if (atr5m === null || !(atr5m > 0)) {
    return { origin: null, rejections: ["no_atr"], stabilisation: [] };
  }

  const lastFive = fiveMinute[fiveMinute.length - 1];
  const lastOne = oneMinute[oneMinute.length - 1];

  // Beyond BOTH rising 9 EMAs.
  const oneEma = calculateEma(oneMinute as Candle[], 9);
  const fiveEma = calculateEma(fiveMinute as Candle[], 9);
  const oneNow = latestValid(oneEma);
  const fiveNow = latestValid(fiveEma);
  const onePrior = oneEma[oneEma.length - 4];
  const fivePrior = fiveEma[fiveEma.length - 4];

  const oneOk =
    oneNow !== null &&
    ops.beyond(lastOne.close, oneNow) &&
    onePrior !== undefined &&
    Number.isFinite(onePrior) &&
    ops.beyond(oneNow, onePrior);
  const fiveOk =
    fiveNow !== null &&
    ops.beyond(lastFive.close, fiveNow) &&
    fivePrior !== undefined &&
    Number.isFinite(fivePrior) &&
    ops.beyond(fiveNow, fivePrior);

  if (!oneOk || !fiveOk) rejections.push("not_beyond_emas");

  const t = closeTransitions(fiveMinute, config.higherCloseTransitions, direction);
  if (!t.measurable || t.favourable < config.minimumHigherCloses) {
    rejections.push("transitions_insufficient");
  }

  // Relative volume must be MEASURED. Unavailable is not a pass.
  if (relativeVolume === null || relativeVolume < config.watchRelativeVolume) {
    rejections.push("relative_volume_insufficient");
  }

  // The impulse candle must close near its own directional extreme.
  const strength = ops.closeStrength(lastFive);
  if (strength === null || strength < 0.6) rejections.push("close_not_near_extreme");

  // Breaking or approaching a real key level.
  const nearLevel = levels.some((l) => {
    if (!Number.isFinite(l.price) || lastFive.close === 0) return false;
    const within = Math.abs(l.price - lastFive.close) / lastFive.close < 0.01;
    return within || ops.beyond(lastFive.close, l.price);
  });
  if (!nearLevel) rejections.push("no_key_level_interaction");

  if (rejections.length > 0) return { origin: null, rejections, stabilisation: [] };

  // The pre-impulse window: bars BEFORE the run began, located causally
  // by walking back while closes remain favourable.
  let start = fiveMinute.length - 1;
  while (
    start > 0 &&
    ops.beyond(fiveMinute[start].close, fiveMinute[start - 1].close)
  ) {
    start -= 1;
  }
  const preImpulse = fiveMinute.slice(Math.max(0, start - 1), start + 1);
  let originPrice = ops.adverseExtreme(preImpulse[0]);
  for (const c of preImpulse) {
    const v = ops.adverseExtreme(c);
    if (ops.adverse(v, originPrice)) originPrice = v;
  }

  return {
    origin: {
      mode: "momentum_expansion",
      price: originPrice,
      establishedAt: iso(lastFive.time),
      invalidationPrice: ops.adverseOffset(originPrice, config.originInvalidationAtr * atr5m),
    },
    rejections: [],
    stabilisation: ["Momentum expansion — no base required"],
  };
}
