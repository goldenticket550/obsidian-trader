import type { Candle } from "@/types/candle";
import type { StrategyConfig } from "@/lib/strategies/config";

export interface VolumeConfirmationResult {
  passed: boolean;
  currentVolume: number;
  averageVolume: number;
  relativeVolumePct: number;
}

/**
 * Optional confirmation: is the current candle's volume elevated relative
 * to its recent average? Never required by default.
 */
export function detectVolumeConfirmation(
  candles: Candle[],
  lookback: number,
  config: StrategyConfig["volumeConfirmation"]
): VolumeConfirmationResult {
  if (candles.length < lookback + 1) {
    return { passed: false, currentVolume: 0, averageVolume: 0, relativeVolumePct: 0 };
  }

  const current = candles[candles.length - 1];
  const window = candles.slice(candles.length - 1 - lookback, candles.length - 1);
  const averageVolume = window.reduce((sum, c) => sum + c.volume, 0) / window.length;
  const relativeVolumePct = averageVolume === 0 ? 0 : current.volume / averageVolume;

  return {
    passed: relativeVolumePct >= config.minRelativeVolumePct,
    currentVolume: current.volume,
    averageVolume,
    relativeVolumePct,
  };
}
