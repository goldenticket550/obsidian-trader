import type { Candle } from "@/types/candle";
import type { StrategyConfig } from "@/lib/strategies/config";

export interface ConsecutiveBullishResult {
  passed: boolean;
  candleCount: number;
  totalMoveDollars: number;
  higherHighsLows: boolean;
  /**
   * True only when there were fewer than `minCandles` candles to look at,
   * so nothing was actually evaluated.
   *
   * Without this, a failing result was indistinguishable from a
   * no-data result: both returned candleCount 0 and totalMoveDollars 0,
   * and the UI rendered "0-candle window, $0.00 total move" for each.
   * Confirmed live on MU 5m — 21 real regular-hours candles were
   * checked, the streak simply broke on a red close, and the checklist
   * still read as though nothing had been looked at. Same failure mode
   * as `insufficient_data` vs `actionable_now` in the entry status:
   * "no data" and "checked, and it's a no" are different answers.
   */
  insufficientData: boolean;
}

/**
 * Stage 3: detects N consecutive bullish candles ending at the most recent
 * candle. "Bullish" means close > open. Configurable minimum body size,
 * minimum total move, and whether higher-highs/higher-lows are required.
 */
export function detectConsecutiveBullish(
  candles: Candle[],
  config: StrategyConfig["consecutiveBullish"]
): ConsecutiveBullishResult {
  const n = config.minCandles;

  // Nothing was evaluated — the only case where 0/0 is the honest answer.
  if (candles.length < n) {
    return {
      passed: false,
      candleCount: 0,
      totalMoveDollars: 0,
      higherHighsLows: false,
      insufficientData: true,
    };
  }

  const window = candles.slice(candles.length - n);

  // Measured up-front so a failing result can still report what was
  // actually looked at. These are observations about the window, not
  // part of the pass/fail decision, which is unchanged below.
  const totalMoveDollars = window[window.length - 1].close - window[0].open;

  let higherHighsLows = true;
  for (let i = 1; i < window.length; i++) {
    if (window[i].high <= window[i - 1].high || window[i].low <= window[i - 1].low) {
      higherHighsLows = false;
      break;
    }
  }

  const allBullish = window.every((c) => c.close > c.open);
  if (!allBullish) {
    // Real candles were checked and the streak genuinely broke. Report
    // the true window size and net move rather than zeros, which would
    // read as "nothing happened".
    return {
      passed: false,
      candleCount: n,
      totalMoveDollars,
      higherHighsLows,
      insufficientData: false,
    };
  }

  const allMeetBodySize = window.every(
    (c) => Math.abs(c.close - c.open) >= config.minBodySizeDollars
  );

  const meetsStructure = config.requireHigherHighsLows ? higherHighsLows : true;
  const meetsTotalMove = totalMoveDollars >= config.minTotalMoveDollars;

  const passed = allMeetBodySize && meetsStructure && meetsTotalMove;

  return { passed, candleCount: n, totalMoveDollars, higherHighsLows, insufficientData: false };
}
