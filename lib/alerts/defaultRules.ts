import type { AlertRule } from "./types";

const FIVE_MIN = 5 * 60_000;

/**
 * Cooldown for the early-tier `entered_developing` rule only. Longer than
 * the FIVE_MIN every confirmed-tier rule uses, because the watch <->
 * developing boundary is genuinely easy to oscillate across:
 * determineConvictionLevel promotes on `requiredRatio >= 0.5 ||
 * requiredPassed >= 2`, so a single required condition flickering
 * pass/fail flips conviction back and forth and would re-fire this alert
 * every scan at a 5-minute cooldown.
 *
 * 15 minutes is 3 candles on the 5m timeframe and 1 on the 15m, so a
 * genuine re-entry after a real move still gets through, while flapping
 * inside one candle's worth of noise does not. This does not delay
 * anything: the confirmed-tier alerts keep their own independent
 * FIVE_MIN cooldowns and are unaffected by this value.
 */
const FIFTEEN_MIN = 15 * 60_000;

/**
 * Default rule set covering every alert type from the spec. Note:
 * "price approaching a gap" and "price entering the gap" are merged into
 * a single `fair_value_gap_proximity` rule, since both map to the same
 * underlying `gap_proximity` condition in the scorer's checklist — the
 * condition detail text already distinguishes proximity vs. actually
 * inside the gap. Splitting them into two separate alert rules would
 * require the scorer to expose a finer-grained gap-distance signal than
 * it currently does; worth revisiting once real usage shows it's needed.
 */
export const defaultAlertRules: AlertRule[] = [
  {
    id: "recovery_from_low",
    type: "recovery_from_low",
    label: "Recovered from session low",
    enabled: true,
    cooldownMs: FIVE_MIN,
  },
  {
    id: "consecutive_bullish",
    type: "consecutive_bullish",
    label: "Consecutive bullish candles formed",
    enabled: true,
    cooldownMs: FIVE_MIN,
  },
  {
    id: "liquidity_sweep",
    type: "liquidity_sweep",
    label: "Liquidity sweep detected",
    enabled: true,
    cooldownMs: FIVE_MIN,
  },
  {
    id: "structure_shift",
    type: "structure_shift",
    label: "Market-structure shift confirmed",
    enabled: true,
    cooldownMs: FIVE_MIN,
  },
  {
    id: "ema_reclaim",
    type: "ema_reclaim",
    label: "9 EMA reclaimed",
    enabled: true,
    cooldownMs: FIVE_MIN,
  },
  {
    id: "fair_value_gap_created",
    type: "fair_value_gap_created",
    label: "Bullish fair value gap created",
    enabled: true,
    cooldownMs: FIVE_MIN,
  },
  {
    id: "fair_value_gap_proximity",
    type: "fair_value_gap_proximity",
    label: "Price approaching or entering the gap",
    enabled: true,
    cooldownMs: FIVE_MIN,
  },
  {
    id: "score_threshold",
    type: "score_threshold",
    label: "Setup score reached threshold",
    enabled: true,
    // Score is now normalized to a fixed 0-10 scale (see scorer.ts) -
    // 7 roughly matches "essentially all required conditions passing."
    scoreThreshold: 7,
    cooldownMs: FIVE_MIN,
  },
  {
    id: "setup_invalidated",
    type: "setup_invalidated",
    label: "Setup invalidated",
    enabled: true,
    cooldownMs: FIVE_MIN,
  },
  {
    id: "entered_developing",
    type: "entered_developing",
    label: "Setup entered developing conviction",
    enabled: true,
    cooldownMs: FIFTEEN_MIN,
  },
];
