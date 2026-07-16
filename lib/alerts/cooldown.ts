import type { AlertEvent, AlertRule } from "./types";

function cooldownKey(ruleId: string, symbol: string, timeframe: string): string {
  return `${ruleId}:${symbol}:${timeframe}`;
}

/**
 * Tracks the last time each (rule, symbol, timeframe) combination fired,
 * so a rule that's already fired recently doesn't fire again until its
 * cooldown expires — even though evaluateAlerts() already only fires on
 * a true pass/fail edge, a value can genuinely flip back and forth near
 * a boundary (e.g. score sitting right at a threshold), and the cooldown
 * is what stops that from becoming a flood of near-duplicate alerts.
 */
export class AlertCooldownTracker {
  private lastFiredAt = new Map<string, number>();

  isOnCooldown(event: AlertEvent, cooldownMs: number, now: number): boolean {
    const key = cooldownKey(event.ruleId, event.symbol, event.timeframe);
    const last = this.lastFiredAt.get(key);
    if (last === undefined) return false;
    return now - last < cooldownMs;
  }

  recordFired(event: AlertEvent, now: number): void {
    const key = cooldownKey(event.ruleId, event.symbol, event.timeframe);
    this.lastFiredAt.set(key, now);
  }

  clear(): void {
    this.lastFiredAt.clear();
  }
}

/**
 * Filters a batch of candidate events through the cooldown tracker,
 * recording firing time for whatever survives. Rules are looked up by id
 * to find each event's configured cooldown.
 */
export function applyCooldowns(
  events: AlertEvent[],
  rules: AlertRule[],
  tracker: AlertCooldownTracker,
  now: number
): AlertEvent[] {
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const surviving: AlertEvent[] = [];

  for (const event of events) {
    const rule = ruleById.get(event.ruleId);
    const cooldownMs = rule?.cooldownMs ?? 0;

    if (tracker.isOnCooldown(event, cooldownMs, now)) continue;

    tracker.recordFired(event, now);
    surviving.push(event);
  }

  return surviving;
}
