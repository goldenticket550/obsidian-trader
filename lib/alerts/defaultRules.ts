import type { AlertRule } from "./types";

const FIVE_MIN = 5 * 60_000;

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
];
