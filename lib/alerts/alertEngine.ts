import type { SetupResult } from "@/types/setup";
import type { AlertEvent, AlertRule, AlertType } from "./types";

/** Maps the simple pass-transition alert types to their scorer condition id. */
const CONDITION_ID_FOR_TYPE: Partial<Record<AlertType, string>> = {
  recovery_from_low: "recovery_from_low",
  consecutive_bullish: "consecutive_bullish",
  liquidity_sweep: "liquidity_sweep",
  structure_shift: "structure_shift",
  ema_reclaim: "ema_reclaim",
  fair_value_gap_created: "fair_value_gap",
  fair_value_gap_proximity: "gap_proximity",
};

function conditionState(result: SetupResult, conditionId: string): string | undefined {
  return result.conditions.find((c) => c.id === conditionId)?.state;
}

function conditionDetail(result: SetupResult, conditionId: string): string | undefined {
  return result.conditions.find((c) => c.id === conditionId)?.detail;
}

let eventCounter = 0;
function makeEventId(): string {
  eventCounter += 1;
  return `evt_${Date.now()}_${eventCounter}`;
}

/**
 * Compares a symbol/timeframe's previous and current SetupResult and
 * returns any alert events that should fire. `previous` is null on the
 * very first scan of a symbol — no alerts fire on that scan, since
 * everything would look like a "new" transition from nothing, which
 * would flood the feed with alerts for conditions that may have been
 * true for hours before the app ever ran a first scan.
 */
export function evaluateAlerts(
  previous: SetupResult | null,
  current: SetupResult,
  rules: AlertRule[],
  now: string
): AlertEvent[] {
  if (!previous) return [];

  const events: AlertEvent[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;

    if (rule.type === "score_threshold") {
      const threshold = rule.scoreThreshold ?? Infinity;
      const wasAbove = previous.score >= threshold;
      const isAbove = current.score >= threshold;
      if (!wasAbove && isAbove) {
        events.push({
          id: makeEventId(),
          ruleId: rule.id,
          type: rule.type,
          symbol: current.symbol,
          timeframe: current.timeframe,
          message: `${current.symbol} (${current.timeframe}) reached a score of ${current.score}/${current.maxScore}`,
          firedAt: now,
        });
      }
      continue;
    }

    if (rule.type === "setup_invalidated") {
      const newlyInvalidated = current.conditions.filter((c) => {
        if (c.state !== "invalidated") return false;
        const prevState = conditionState(previous, c.id);
        return prevState !== "invalidated";
      });
      if (newlyInvalidated.length > 0) {
        events.push({
          id: makeEventId(),
          ruleId: rule.id,
          type: rule.type,
          symbol: current.symbol,
          timeframe: current.timeframe,
          message: `${current.symbol} (${current.timeframe}) setup invalidated: ${newlyInvalidated[0].label}`,
          firedAt: now,
        });
      }
      continue;
    }

    const conditionId = CONDITION_ID_FOR_TYPE[rule.type];
    if (!conditionId) continue;

    const wasPassing = conditionState(previous, conditionId) === "pass";
    const isPassing = conditionState(current, conditionId) === "pass";
    if (!wasPassing && isPassing) {
      const detail = conditionDetail(current, conditionId);
      events.push({
        id: makeEventId(),
        ruleId: rule.id,
        type: rule.type,
        symbol: current.symbol,
        timeframe: current.timeframe,
        message: `${current.symbol} (${current.timeframe}) ${rule.label.toLowerCase()}${
          detail ? ` — ${detail}` : ""
        }`,
        firedAt: now,
      });
    }
  }

  return events;
}
