import { createHash } from "node:crypto";
import type { BarAdjustment } from "@/lib/market-data/types";

export const HISTORICAL_SIP_DELAY_MS = 15 * 60_000;
export const LIVE_BAR_ADJUSTMENT: BarAdjustment = "split";
export const ARCHIVE_FORMAT_VERSION = 1;

export const PRE_STREAM_REPLAY_DISCLOSURE =
  "Timing statistics derived from historical pulls assume instantaneous bar availability. " +
  "Real arrival latency is not represented. Human-relative latency and move-capture figures " +
  "are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.";

export interface FeedVolumeObservation {
  symbol: string;
  sipVolume: number;
  iexVolume: number;
  ratio: number;
}

export interface EmpiricalFeedEvidence {
  method: "sip_to_iex_regular_volume_ratio";
  tradingDate: string;
  ratioBand: { min: number; max: number };
  observations: FeedVolumeObservation[];
}
export interface ArchiveMetadata {
  formatVersion: number;
  createdAt: string;
  feed: "sip";
  feedVerification: "response_attested" | "empirical_volume_ratio";
  feedEvidence?: EmpiricalFeedEvidence;
  adjustment: BarAdjustment;
  start: string;
  end: string;
  symbols: string[];
  timeframes: Array<"1m" | "5m" | "1d">;
  files: Array<{ path: string; bytes: number; bars: number; sha256: string }>;
}

export function assertHistoricalSipWindow(end: string, nowMs: number): void {
  const endMs = Date.parse(end);
  if (!Number.isFinite(endMs)) throw new Error(`Invalid archive end timestamp: ${end}`);
  if (endMs > nowMs - HISTORICAL_SIP_DELAY_MS) {
    throw new Error("Historical SIP end must be at least 15 minutes old; request was not issued.");
  }
}

export function assertSipResponseFeed(requestedFeed: string, responseFeed: string | null): void {
  if (requestedFeed !== "sip") throw new Error(`Archive request feed must be sip, got ${requestedFeed}.`);
  if (responseFeed === null) throw new Error("Archive response feed is unverifiable; refusing to write bars.");
  if (responseFeed !== "sip") throw new Error(`Unexpected archive response feed: ${responseFeed}.`);
}
export function assertEmpiricalFeedRatios(
  observations: FeedVolumeObservation[], minRatio: number, maxRatio: number
): void {
  if (observations.length === 0) throw new Error("Empirical feed verification requires observations.");
  for (const observation of observations) {
    if (!Number.isFinite(observation.ratio) || observation.iexVolume <= 0 || observation.sipVolume <= 0) {
      throw new Error(`Invalid feed-volume observation for ${observation.symbol}.`);
    }
    if (observation.ratio < minRatio || observation.ratio > maxRatio) {
      throw new Error(`SIP/IEX volume ratio for ${observation.symbol} was ${observation.ratio.toFixed(2)}, outside ${minRatio}-${maxRatio}.`);
    }
  }
}


export function assertArchiveMatchesLive(metadata: ArchiveMetadata): void {
  if (metadata.adjustment !== LIVE_BAR_ADJUSTMENT) {
    throw new Error(
      `Archive adjustment ${metadata.adjustment} does not match live adjustment ${LIVE_BAR_ADJUSTMENT}.`
    );
  }
}

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
