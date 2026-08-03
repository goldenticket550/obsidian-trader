import type {
  ExpansionDirection,
  ExpansionStage,
  PremarketExpansionResult,
} from "@/lib/indicators/premarketExpansion";
import type { SymbolExpansionMonitor } from "@/lib/scanner/expansionMonitor";
import type { SymbolExpansion } from "@/lib/scanner/scanService";
import {
  EXPANSION_STAGE_LABELS,
  EXPANSION_STAGE_PRIORITY,
  sortByExpansionStage,
  type ExpansionPriorityItem,
} from "@/lib/scanner/expansionPriority";

export interface ExpansionLeader extends ExpansionPriorityItem {
  direction: ExpansionDirection;
  result: PremarketExpansionResult;
  currentPrice: number | null;
  dollarMove: number | null;
  percentMove: number | null;
  reasons: string[];
  freshness: PremarketExpansionResult["freshness"]["status"];
}

const ACTIVE_LEADER_STAGES = new Set<ExpansionStage>([
  "context_developing",
  "premarket_candidate",
  "opening_drive",
  "level_break",
  "breakout_accepted",
  "expansion_active",
]);

export function selectPreferredExpansion(
  expansion: SymbolExpansion,
  monitor?: SymbolExpansionMonitor
): { result: PremarketExpansionResult; stage: ExpansionStage } {
  const candidates = (["bullish", "bearish"] as const).map((direction) => ({
    result: expansion[direction],
    stage: monitor?.[direction].stage ?? expansion[direction].stage,
  }));

  return candidates.sort((a, b) => {
    if (a.result.qualified !== b.result.qualified) return a.result.qualified ? -1 : 1;
    const stageDelta = EXPANSION_STAGE_PRIORITY[b.stage] - EXPANSION_STAGE_PRIORITY[a.stage];
    if (stageDelta !== 0) return stageDelta;
    const aMove = a.result.move.percentMove;
    const bMove = b.result.move.percentMove;
    if (aMove === null && bMove !== null) return 1;
    if (aMove !== null && bMove === null) return -1;
    return Math.abs(bMove ?? 0) - Math.abs(aMove ?? 0);
  })[0];
}

function levelReason(result: PremarketExpansionResult): string | null {
  if (result.confirmation.state === "accepted") return "Breakout accepted";
  if (result.confirmation.state === "awaiting_acceptance") return "Active level broken";
  if (result.priorLevel.interaction === "accepted") return "Prior-day level accepted";
  if (result.priorLevel.interaction === "broken") return "Prior-day level broken";
  if (result.confirmation.activeLevel) {
    return `${result.confirmation.activeLevel.name.replaceAll("_", " ")} in play`;
  }
  return null;
}

function rangeReason(result: PremarketExpansionResult): string | null {
  if (result.rangePosition.rawPositionPercent === null) return null;
  const pct = Math.round(result.rangePosition.rawPositionPercent);
  return `${pct}% of PM range`;
}

function buildReasons(
  result: PremarketExpansionResult,
  relativeDollarVolume: number | null,
  atrNormalizedMove: number | null
): string[] {
  const reasons: Array<string | null> = [
    relativeDollarVolume === null ? null : `${relativeDollarVolume.toFixed(1)}x $Vol`,
    atrNormalizedMove === null ? null : `${Math.abs(atrNormalizedMove).toFixed(1)}x ATR`,
    levelReason(result),
    result.relativeStrength.relativePct === null
      ? null
      : `${result.relativeStrength.benchmarkSymbol} ${
          result.relativeStrength.relativePct >= 0 ? "+" : ""
        }${result.relativeStrength.relativePct.toFixed(1)} pp relative`,
    rangeReason(result),
  ];
  return reasons.filter((reason): reason is string => reason !== null).slice(0, 2);
}

export function buildExpansionLeaders(
  expansionBySymbol: Record<string, SymbolExpansion> | undefined,
  monitorBySymbol: Record<string, SymbolExpansionMonitor> | undefined,
  limit = 5
): ExpansionLeader[] {
  if (!expansionBySymbol) return [];

  const leaders: ExpansionLeader[] = [];
  for (const [symbol, expansion] of Object.entries(expansionBySymbol)) {
    const monitor = monitorBySymbol?.[symbol];
    const selected = selectPreferredExpansion(expansion, monitor);
    if (!ACTIVE_LEADER_STAGES.has(selected.stage)) continue;

    const directionalMonitor = monitor?.[selected.result.direction];
    const relativeDollarVolume =
      monitor?.dollarVolume.cumulativeRelativeDollarVolume ?? selected.result.volumePace.multiple;
    // The current payload does not expose daily ATR. Leave this null rather
    // than mislabeling range-vs-baseline as ATR-normalized movement.
    const atrNormalizedMove = null;
    const sectorRelativePerformance = selected.result.relativeStrength.relativePct;
    const lastConfirmedTransitionAt = directionalMonitor?.earlyAcceleration.fired
      ? directionalMonitor.earlyAcceleration.barTime
      : null;

    leaders.push({
      symbol,
      stage: selected.stage,
      direction: selected.result.direction,
      result: selected.result,
      currentPrice: selected.result.move.currentPrice,
      dollarMove: selected.result.move.dollarMove,
      percentMove: selected.result.move.percentMove,
      atrNormalizedMove,
      relativeDollarVolume,
      sectorRelativePerformance,
      lastConfirmedTransitionAt,
      reasons: buildReasons(selected.result, relativeDollarVolume, atrNormalizedMove),
      freshness: selected.result.freshness.status,
    });
  }

  return sortByExpansionStage(leaders).slice(0, Math.max(0, Math.min(5, limit)));
}

export function expansionTone(stage: ExpansionStage, direction: ExpansionDirection): string {
  if (stage === "premarket_candidate" || stage === "context_developing") return "var(--blue)";
  if (stage === "opening_drive") return "var(--amber)";
  if (stage === "stalled") return "var(--text-muted)";
  return direction === "bullish" ? "var(--green)" : "var(--red)";
}

export function expansionStageLabel(stage: ExpansionStage): string {
  return EXPANSION_STAGE_LABELS[stage];
}
