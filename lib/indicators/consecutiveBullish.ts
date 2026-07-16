import type { Candle } from "@/types/candle";
import type { StrategyConfig } from "@/lib/strategies/config";

export interface ConsecutiveBullishResult {
  passed: boolean;
  candleCount: number;
  totalMoveDollars: number;
  higherHighsLows: boolean;
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
  const fail: ConsecutiveBullishResult = {
    passed: false,
    candleCount: 0,
    totalMoveDollars: 0,
    higherHighsLows: false,
  };

  if (candles.length < n) return fail;

  const window = candles.slice(candles.length - n);

  const allBullish = window.every((c) => c.close > c.open);
  if (!allBullish) return fail;

  const allMeetBodySize = window.every(
    (c) => Math.abs(c.close - c.open) >= config.minBodySizeDollars
  );

  const totalMoveDollars = window[window.length - 1].close - window[0].open;

  let higherHighsLows = true;
  for (let i = 1; i < window.length; i++) {
    if (window[i].high <= window[i - 1].high || window[i].low <= window[i - 1].low) {
      higherHighsLows = false;
      break;
    }
  }

  const meetsStructure = config.requireHigherHighsLows ? higherHighsLows : true;
  const meetsTotalMove = totalMoveDollars >= config.minTotalMoveDollars;

  const passed = allMeetBodySize && meetsStructure && meetsTotalMove;

  return { passed, candleCount: n, totalMoveDollars, higherHighsLows };
}
