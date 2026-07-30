import type { Timeframe } from "@/types/candle";

/**
 * One entry per alert type from the spec. Each maps to a specific
 * transition in the setup's conditions — alerts fire on the EDGE (the
 * moment a condition newly passes), not on every scan where it happens
 * to already be true, so you get one notification per event, not a
 * flood every 30 seconds while a condition stays true.
 */
export type AlertType =
  | "recovery_from_low"
  | "consecutive_bullish"
  | "liquidity_sweep"
  | "structure_shift"
  | "ema_reclaim"
  | "fair_value_gap_created"
  | "fair_value_gap_proximity"
  | "score_threshold"
  | "setup_invalidated"
  /**
   * Early tier. Fires the moment convictionLevel first reaches
   * "developing", ahead of the confirmed-tier types above. It reads the
   * convictionLevel the scorer already computed and changes nothing about
   * how it is computed, nor what any other alert requires.
   */
  | "entered_developing";

export interface AlertRule {
  id: string;
  type: AlertType;
  label: string;
  enabled: boolean;
  /** Only used by the "score_threshold" alert type. */
  scoreThreshold?: number;
  /** Minimum time between repeat firings of this rule for the same symbol+timeframe. */
  cooldownMs: number;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  type: AlertType;
  symbol: string;
  timeframe: Timeframe;
  message: string;
  firedAt: string; // ISO timestamp
}
