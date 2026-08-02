import type { SetupResult } from "@/types/setup";
import type { AlertEvent, AlertRule } from "./types";
import { evaluateAlerts } from "./alertEngine";
import { AlertCooldownTracker, applyCooldowns } from "./cooldown";

const MAX_STORED_EVENTS = 200;

function resultKey(symbol: string, timeframe: string): string {
  return `${symbol}:${timeframe}`;
}

/**
 * Holds the previous scan result per symbol/timeframe (so the alert
 * engine has something to diff against), the cooldown tracker, and a
 * bounded history of fired events.
 *
 * V1 limitation, documented not hidden: this is in-memory and process-
 * local. It resets on every server restart and won't work correctly
 * across multiple server instances. The shape mirrors the spec's
 * `alert_events` Supabase table closely on purpose, so moving this to
 * real persistence in Phase 6 is a storage-layer swap, not a redesign.
 */
export class AlertStore {
  private previousResults = new Map<string, SetupResult>();
  private events: AlertEvent[] = [];
  private cooldownTracker = new AlertCooldownTracker();

  /**
   * Call once per symbol/timeframe on every scan. Compares against the
   * last stored result for that key, fires whatever alerts survive the
   * cooldown check, and updates the stored snapshot for next time.
   */
  processResult(result: SetupResult, rules: AlertRule[], now: string): AlertEvent[] {
    const key = resultKey(result.symbol, result.timeframe);
    const previous = this.previousResults.get(key) ?? null;

    const candidates = evaluateAlerts(previous, result, rules, now);
    const surviving = this.processCandidates(candidates, rules, now);

    this.previousResults.set(key, result);

    return surviving;
  }

  /**
   * The cooldown-and-store half of `processResult`, for callers that
   * produced their own candidates — the in-memory counterpart of
   * `recordCandidatesPersistent`.
   *
   * Shares this store's ONE cooldown tracker and event history, so a
   * second setup type cannot dedupe differently or keep a separate feed.
   */
  processCandidates(candidates: AlertEvent[], rules: AlertRule[], now: string): AlertEvent[] {
    const surviving = applyCooldowns(candidates, rules, this.cooldownTracker, Date.parse(now));

    if (surviving.length > 0) {
      this.events = [...surviving, ...this.events].slice(0, MAX_STORED_EVENTS);
    }

    return surviving;
  }

  getRecentEvents(limit = 50): AlertEvent[] {
    return this.events.slice(0, limit);
  }

  clear(): void {
    this.previousResults.clear();
    this.events = [];
    this.cooldownTracker.clear();
  }
}

let storeSingleton: AlertStore | null = null;

/** Server-only singleton, same pattern as getMarketDataProvider(). */
export function getAlertStore(): AlertStore {
  if (!storeSingleton) storeSingleton = new AlertStore();
  return storeSingleton;
}
