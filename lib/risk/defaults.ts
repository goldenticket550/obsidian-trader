import type { RiskSettings } from "@/types/risk";

export const defaultRiskSettings: RiskSettings = {
  maxTradesPerDay: 3,
  maxLossPerDay: 400,
  dailyProfitTarget: 300,
  maxRiskPerTrade: 200,
  // Score is now normalized to a fixed 0-10 scale (see scorer.ts) - 6
  // roughly matches the same ~60-65% bar the old scale used.
  minSetupScore: 6,
  minMinutesBetweenTrades: 15,
  allowedSessions: ["regular"],
  blockAfterTarget: true,
  blockAfterLossLimit: true,
};

export const MIN_SETUP_SCORE_MIN = 0;
export const MIN_SETUP_SCORE_MAX = 10;

/**
 * Clamps a minSetupScore value into the valid 0-10 range (the scorer's
 * fixed scale since the Phase 8 rescale — see scorer.ts's
 * computeWeightedScore). Fixed a real bug (Codex review): a user who
 * saved this setting before the rescale could have a stored value above
 * 10 (the old scales went as high as ~21) — since no real score can ever
 * reach that on the new scale, the "attempting a low-scoring setup"
 * accountability check would fail PERMANENTLY, every single scan,
 * without this clamp.
 *
 * Used on the READ path (loading a possibly-stale value from the
 * database) — falls back to the default rather than throwing, since a
 * corrupted read shouldn't crash the whole scan. Rather than guess at a
 * proportional conversion from an ambiguous old scale (the exact old max
 * changed more than once during development), this simply clamps to the
 * new maximum: the safe choice, since it can never leave the check
 * permanently failing, and "require a near-perfect score" is a
 * reasonable conservative default until the user consciously revisits
 * the setting in Settings.
 */
export function clampMinSetupScore(value: number): number {
  if (!Number.isFinite(value)) return defaultRiskSettings.minSetupScore;
  return Math.min(MIN_SETUP_SCORE_MAX, Math.max(MIN_SETUP_SCORE_MIN, value));
}

/**
 * Same range, but for user-submitted input (the settings API route) —
 * rejects non-finite values outright instead of silently substituting a
 * default. A malformed write (e.g. NaN from a broken form field) is a
 * real bug worth surfacing as an error, not something to paper over
 * silently the way a stale database read should be.
 */
export function validateMinSetupScore(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`minSetupScore must be a finite number, got: ${value}`);
  }
  return Math.min(MIN_SETUP_SCORE_MAX, Math.max(MIN_SETUP_SCORE_MIN, value));
}
