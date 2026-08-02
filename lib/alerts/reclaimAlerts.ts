import type { StrategyConfig } from "@/lib/strategies/config";
import type { ReclaimSymbolResult } from "@/lib/scanner/reclaimRunner";
import type { AlertEvent, AlertRule } from "./types";

/**
 * Reclaim & Continuation — ALERT EMISSION.
 *
 * This is the only file outside the config plumbing that reads
 * `alertingEnabled`, and the only place a Reclaim alert is created. The
 * detector and the runner stay pure: they compute a tier and never emit.
 *
 * Everything downstream is the EXISTING alert system — the same
 * `AlertEvent` shape, the same cooldown mechanism, the same
 * `alert_events` table, the same feed the reversal scanner uses. Nothing
 * here is a parallel alert pipeline.
 *
 * This app has no brokerage connection and no execution path: an alert
 * is a notification. The copy below is written accordingly — it states
 * what the rules observed and never what to do about it.
 */

/**
 * Rule id prefix. The full id carries the setup key, which is what makes
 * the EXISTING cooldown mechanism dedupe per setup instead of per symbol:
 * both the in-memory tracker (`ruleId:symbol:timeframe`) and the database
 * cooldown query (`user_id, rule_id, symbol, timeframe, fired_at`) are
 * keyed on the rule id, and the `alert_events_cooldown_idx` index already
 * covers exactly those columns. No new table, column, index or mechanism.
 */
export const RECLAIM_ALERT_RULE_PREFIX = "reclaim_review_now";

/**
 * One trading day. A setup key already contains the session date, so a
 * key cannot recur tomorrow; this cooldown is what makes "alert once per
 * setup" hold across every scan WITHIN a session, however many there are.
 */
export const RECLAIM_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Reclaim's system of record is the five-minute machine. */
const RECLAIM_TIMEFRAME = "5m" as const;

export function reclaimRuleIdFor(setupKey: string): string {
  return `${RECLAIM_ALERT_RULE_PREFIX}:${setupKey}`;
}

let eventCounter = 0;
function makeEventId(): string {
  eventCounter += 1;
  return `evt_reclaim_${Date.now()}_${eventCounter}`;
}

const STAGE_TEXT: Record<string, string> = {
  reset: "reset",
  exhaustion: "exhaustion",
  reclaim: "reclaim",
  level_test: "level test",
  acceptance: "acceptance",
  continuation: "continuation",
};

/**
 * Factual one-liner. States the symbol, direction, stage, the level in
 * play, and that the review criteria were met — nothing about what will
 * happen next and nothing about what to do.
 *
 * A level is named only when the machine actually has one. There is no
 * fallback price, because a made-up level in an alert is worse than an
 * alert without one.
 */
export function reclaimAlertMessage(entry: ReclaimSymbolResult): string {
  const five = entry.fiveMinute;
  const direction = entry.direction ?? "unspecified direction";
  const stage = STAGE_TEXT[entry.stage] ?? entry.stage;

  const accepted =
    five?.acceptedLevelPrice !== null && five?.acceptedLevelPrice !== undefined
      ? `accepted above ${five.acceptedLevelName ?? "level"} ${five.acceptedLevelPrice.toFixed(2)}`
      : null;
  const next =
    five?.nextLevelPrice !== null && five?.nextLevelPrice !== undefined
      ? `next level ${five.nextLevelName ?? "unnamed"} ${five.nextLevelPrice.toFixed(2)}`
      : null;

  const parts = [
    `${entry.symbol} (${RECLAIM_TIMEFRAME}) Reclaim & Continuation`,
    `${direction}, ${stage} stage`,
    accepted ?? next ?? "no tracked level in play",
    "review criteria met",
  ];

  const freshness = five?.freshness;
  const suffix = freshness ? ` [market data ${freshness}]` : "";
  return `${parts.join(" — ")}${suffix}`;
}

/**
 * Turns a scan's Reclaim output into alert candidates.
 *
 * Emits when BOTH the flag is on AND the tier is `review_now`. That
 * single tier check is sufficient on purpose: `alertTier` is already the
 * capped, alignment-adjusted tier, so a one-minute-only read (capped to
 * Monitor) and a conflicting alignment (Review blocked) are both already
 * excluded before this function sees them. Re-deriving those rules here
 * would let the two copies drift.
 *
 * `fiveMinute === null` is additionally required so a historical or
 * invalidated setup can never alert — those results carry no active
 * machine, and `historical` is deliberately not consulted.
 *
 * Pure: no I/O, no store, no clock of its own. Returns the rules
 * alongside the events because the cooldown layer resolves each event's
 * cooldown by rule id.
 */
export function buildReclaimAlertCandidates(
  reclaimBySymbol: Record<string, ReclaimSymbolResult> | undefined,
  config: StrategyConfig["reclaimContinuation"],
  now: string
): { events: AlertEvent[]; rules: AlertRule[] } {
  if (!config.alertingEnabled || !reclaimBySymbol) return { events: [], rules: [] };

  const events: AlertEvent[] = [];
  const rules: AlertRule[] = [];

  for (const symbol of Object.keys(reclaimBySymbol).sort()) {
    const entry = reclaimBySymbol[symbol];
    if (!entry || entry.alertTier !== "review_now") continue;
    // An active machine and a stable identity are both required: without
    // a setup key there is nothing to dedupe on, and alerting once per
    // scan is exactly what the key exists to prevent.
    if (entry.fiveMinute === null || entry.setupKey === null) continue;

    const ruleId = reclaimRuleIdFor(entry.setupKey);
    rules.push({
      id: ruleId,
      type: "reclaim_review_now",
      label: "Reclaim & Continuation review criteria met",
      enabled: true,
      cooldownMs: RECLAIM_ALERT_COOLDOWN_MS,
    });
    events.push({
      id: makeEventId(),
      ruleId,
      type: "reclaim_review_now",
      symbol: entry.symbol,
      timeframe: RECLAIM_TIMEFRAME,
      message: reclaimAlertMessage(entry),
      firedAt: now,
    });
  }

  return { events, rules };
}
