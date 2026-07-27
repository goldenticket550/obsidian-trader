import type { DataQuality } from "@/types/candle";

const ET_ZONE = "America/New_York";

/**
 * Honest data-freshness labelling. The rule this module exists to enforce:
 * SCAN TIME and MARKET-DATA TIME are different things and must never be
 * collapsed into a single "live" indicator. A scan can run right now off a
 * candle that opened forty minutes ago; showing only one of those numbers
 * is how the dashboard previously misled.
 *
 * Everything is rendered in US Eastern because that's the market's clock,
 * not the viewer's.
 */

export function formatEasternTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unavailable";
  return `${d.toLocaleTimeString("en-US", {
    timeZone: ET_ZONE,
    hour: "numeric",
    minute: "2-digit",
  })} ET`;
}

export function formatEasternDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unavailable";
  return `${d.toLocaleString("en-US", {
    timeZone: ET_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} ET`;
}

/** The event's calendar date in Eastern, as YYYY-MM-DD. */
function easternDateKey(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: ET_ZONE });
}

/**
 * Timestamp for a discrete past event (an alert firing), where the event
 * may be minutes or weeks old.
 *
 * A bare "8:31 PM ET" is only safe when the event is from today. Seen at
 * 9:14 AM it silently described something from a previous day — the same
 * date-less-timestamp failure as the candle labelling. So:
 *   - today            -> "6:16 PM ET"
 *   - within a week    -> "Fri 8:31 PM ET"
 *   - older than that  -> "Fri Jul 24, 8:31 PM ET"
 *
 * The third case matters because a weekday alone repeats every seven
 * days; "Fri" on a three-week-old event is just as ambiguous as no date.
 */
export function formatEventTime(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unavailable";

  const time = formatEasternTime(iso);
  if (easternDateKey(d) === easternDateKey(new Date(now))) return time;

  const weekday = d.toLocaleString("en-US", { timeZone: ET_ZONE, weekday: "short" });
  const withinAWeek = now - d.getTime() < 7 * 24 * 60 * 60 * 1000;
  if (withinAWeek) return `${weekday} ${time}`;

  const monthDay = d.toLocaleString("en-US", {
    timeZone: ET_ZONE,
    month: "short",
    day: "numeric",
  });
  return `${weekday} ${monthDay}, ${time}`;
}

export const DATA_QUALITY_LABEL: Record<DataQuality, string> = {
  simulated: "Simulated data",
  delayed: "Delayed data",
  realtime: "Real-time data",
};

/**
 * How stale the underlying market data is, expressed as a bucket the UI
 * can color by. Thresholds are deliberately generous: the provider cache
 * alone is 30s for 5m candles, and a 5-minute bar legitimately doesn't
 * change for five minutes, so "current" has to tolerate both.
 */
export type Staleness = "current" | "recent" | "stale" | "unavailable";

export function candleStaleness(latestCandleTime: string | null | undefined, now: number): Staleness {
  if (!latestCandleTime) return "unavailable";
  const t = new Date(latestCandleTime).getTime();
  if (!Number.isFinite(t)) return "unavailable";

  const ageMs = now - t;
  if (ageMs < 15 * 60_000) return "current";
  if (ageMs < 60 * 60_000) return "recent";
  return "stale";
}

/**
 * The candle-time line, e.g. "Latest candle: 1:35 PM ET". Says
 * "Unavailable" rather than inventing a time when there's no candle —
 * a symbol with no data must never look like a symbol with fresh data.
 */
export function latestCandleLabel(latestCandleTime: string | null | undefined): string {
  if (!latestCandleTime) return "Latest candle: Unavailable";
  const formatted = formatEasternTime(latestCandleTime);
  return formatted === "Unavailable" ? "Latest candle: Unavailable" : `Latest candle: ${formatted}`;
}

/** The scan-time line, always distinct from the candle line. */
export function scannedLabel(lastUpdated: string | null | undefined): string {
  if (!lastUpdated) return "Scanned: Unavailable";
  const formatted = formatEasternTime(lastUpdated);
  return formatted === "Unavailable" ? "Scanned: Unavailable" : `Scanned ${formatted}`;
}

/** Rounded age of the newest candle, e.g. "10h old". */
export function candleAgeLabel(latestCandleTime: string | null | undefined, now: number): string | null {
  if (!latestCandleTime) return null;
  const t = new Date(latestCandleTime).getTime();
  if (!Number.isFinite(t)) return null;
  const mins = Math.floor((now - t) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m old`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h old`;
  return `${Math.floor(hours / 24)}d old`;
}

export interface FeedStatus {
  /** What to show in the badge. */
  label: string;
  /** Drives badge color: only "current" earns the positive treatment. */
  staleness: Staleness;
}

/**
 * Combines the provider's FEED CAPABILITY with the ACTUAL AGE of the data.
 *
 * These are different claims and conflating them is how a dashboard ends
 * up showing a green "Real-time data" badge at 2am on a Saturday over
 * Friday's closing candle. The feed genuinely is a real-time feed; the
 * data in front of you is ten hours old. The badge must say the second
 * thing, because that's the one that affects a decision.
 */
export function describeFeed(
  quality: DataQuality | null,
  latestCandleTime: string | null | undefined,
  now: number
): FeedStatus {
  if (!quality) return { label: "Data unavailable", staleness: "unavailable" };

  const staleness = candleStaleness(latestCandleTime, now);
  const base = DATA_QUALITY_LABEL[quality];

  if (staleness === "unavailable") {
    return { label: `${base} · no candle`, staleness };
  }
  if (staleness === "current") {
    return { label: base, staleness };
  }

  // Feed is capable of X, but what we're holding is older than that
  // implies — say so rather than letting the capability stand alone.
  const age = candleAgeLabel(latestCandleTime, now);
  const feedWord = quality === "realtime" ? "Real-time feed" : base;
  return { label: age ? `${feedWord} · data ${age}` : feedWord, staleness };
}
