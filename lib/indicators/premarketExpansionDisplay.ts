import {
  describeInteraction,
  formatBarClock,
  type EvidenceGroup,
  type PremarketExpansionResult,
} from "./premarketExpansion";

/**
 * The two display formats for a Premarket Expansion Candidate: a concise
 * collapsed row and a full expanded evidence block.
 *
 * NO EXPANSION RANK. The collapsed row presents a qualifying badge,
 * direction, stage, the headline measurements and an evidence COUNT
 * ("4 of 6 evidence groups passing") — never a rank, score, or band.
 *
 * Kept as pure string builders entirely outside React: this is testable
 * line-by-line, and the efficiency requirement forbids doing this work
 * inside rendering.
 *
 * One rule governs everything below — anything that could not be measured
 * renders as "Unavailable" or "Not established", never as a zero, a dash,
 * or a plausible-looking placeholder. Example values from the spec are
 * illustrative formatting only and are never seeded here.
 */

function money(value: number | null): string {
  return value === null ? "Unavailable" : `$${value.toFixed(2)}`;
}

function signedMoney(value: number | null): string {
  if (value === null) return "Unavailable";
  return `${value >= 0 ? "+" : "−"}$${Math.abs(value).toFixed(2)}`;
}

function signedPct(value: number | null, digits = 2): string {
  if (value === null) return "Unavailable";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}%`;
}

function multiple(value: number | null): string {
  return value === null ? "Unavailable" : `${value.toFixed(1)}×`;
}

const GROUP_LABELS: Record<EvidenceGroup["name"], string> = {
  participation: "Participation",
  rangeExpansion: "Range expansion",
  rangeLocation: "Range location",
  structure: "Structure",
  priorDayInteraction: "Prior-day interaction",
  benchmarkRelativeMove: "Relative strength",
};

const STATE_LABELS: Record<EvidenceGroup["state"], string> = {
  pass: "Pass",
  wait: "Wait",
  unavailable: "N/A",
};

const STAGE_LABELS: Record<PremarketExpansionResult["stage"], string> = {
  inactive: "Inactive",
  context_developing: "Context developing",
  premarket_candidate: "Premarket candidate",
  opening_drive: "Opening drive",
  level_break: "Level break",
  breakout_accepted: "Breakout accepted",
  expansion_active: "Expansion active",
  stalled: "Stalled",
  invalidated: "Invalidated",
};

export function stageLabel(stage: PremarketExpansionResult["stage"]): string {
  return STAGE_LABELS[stage];
}

/**
 * The collapsed row. Four lines: price/move, the qualifying badge and
 * stage, the headline metrics, and the evidence count.
 */
export function formatCollapsedRow(result: PremarketExpansionResult): string[] {
  const { move, volumePace, rangePosition, relativeStrength } = result;

  const priceLine = [
    result.symbol,
    money(move.currentPrice),
    `${signedMoney(move.dollarMove)} (${signedPct(move.percentMove)})`,
  ].join("  ");

  const directionWord = result.direction === "bullish" ? "Bullish" : "Bearish";
  const badge = result.qualified
    ? `${directionWord} Premarket Candidate`
    : `${directionWord} — ${STAGE_LABELS[result.stage]}`;

  const metrics = [
    `PM volume ${multiple(volumePace.multiple)}`,
    rangePosition.rawPositionPercent === null
      ? "PM position Unavailable"
      : `PM position ${rangePosition.rawPositionPercent.toFixed(0)}%`,
    relativeStrength.relativePct === null
      ? `${relativeStrength.benchmarkSymbol} Unavailable`
      : `${relativeStrength.benchmarkSymbol} ${signedPct(relativeStrength.relativePct)}`,
  ].join(" · ");

  // An honest count, not a rank: the denominator is every group, so a
  // reader can see how much was measurable at all.
  const evidence = `${result.passingGroups} of ${result.totalGroups} evidence groups passing`;

  return [priceLine, badge, metrics, evidence];
}

/**
 * The expanded evidence display: the premarket context block, the six
 * evidence groups with their states, the confirmation/invalidation pair,
 * and the two freshness timestamps, which stay visibly distinct.
 */
export function formatExpandedEvidence(result: PremarketExpansionResult): string[] {
  const {
    move,
    ranges,
    volumePace,
    rangeExpansion,
    rangePosition,
    relativeStrength,
    priorLevel,
    freshness,
  } = result;

  const lines: string[] = [];

  lines.push("PREMARKET CONTEXT");
  lines.push(row("Stage", STAGE_LABELS[result.stage]));
  lines.push(
    row("Move from prior close", `${signedMoney(move.dollarMove)} (${signedPct(move.percentMove)})`)
  );
  lines.push(
    row(
      "Volume pace",
      volumePace.multiple === null
        ? `Unavailable — ${volumePace.reason ? reasonText(result, "volume") : "no data"}`
        : `${multiple(volumePace.multiple)} median · ${volumePace.baselineSampleSize} sessions`
    )
  );
  // The DISPLAYED premarket range is the complete elapsed session range,
  // never the reference range that deliberately excludes the current bar.
  lines.push(
    row(
      "Premarket range",
      ranges.sessionHigh === null || ranges.sessionLow === null
        ? "Unavailable"
        : `${money(ranges.sessionHigh - ranges.sessionLow)} (${money(ranges.sessionLow)}–${money(
            ranges.sessionHigh
          )})`
    )
  );
  lines.push(
    row(
      "Range vs reference",
      rangeExpansion.multiple === null
        ? `Unavailable — ${reasonText(result, "range")}`
        : `${multiple(rangeExpansion.multiple)} median · ${rangeExpansion.baselineSampleSize} sessions`
    )
  );
  lines.push(row("Position in reference range", formatRangePosition(rangePosition)));
  lines.push(
    row(
      `Relative to ${relativeStrength.benchmarkSymbol}`,
      // Never the label alone — the computed difference is always beside it.
      relativeStrength.relativePct === null
        ? "Unavailable"
        : `${signedPct(relativeStrength.relativePct)} (${relativeStrength.label})`
    )
  );
  lines.push(row("Prior-day level", describeInteraction(priorLevel, result.direction)));

  lines.push("");
  lines.push("EVIDENCE");
  for (const group of result.groups) {
    lines.push(`${STATE_LABELS[group.state].padEnd(5)} ${GROUP_LABELS[group.name]} — ${group.detail}`);
  }
  lines.push(`${result.passingGroups} of ${result.totalGroups} evidence groups passing`);

  lines.push("");
  lines.push("NEXT");
  lines.push(row("Confirmation", formatConfirmation(result)));
  lines.push(row("Invalidation", formatInvalidation(result)));

  lines.push("");
  // Two different clocks, never collapsed into one "live" line.
  lines.push(row("Scanned at", formatIsoClock(freshness.scannedAt)));
  lines.push(
    row(
      "Latest completed bar",
      freshness.latestCompletedBarAt === null
        ? "Unavailable"
        : formatIsoClock(freshness.latestCompletedBarAt)
    )
  );
  lines.push(row("Data status", formatFreshness(result)));

  return lines;
}

function reasonText(result: PremarketExpansionResult, which: "volume" | "range"): string {
  const comparison = which === "volume" ? result.volumePace : result.rangeExpansion;
  const group = result.groups.find((g) =>
    which === "volume" ? g.name === "participation" : g.name === "rangeExpansion"
  );
  return comparison.reason ? group!.detail : "no data";
}

function formatRangePosition(rangePosition: PremarketExpansionResult["rangePosition"]): string {
  if (rangePosition.rawPositionPercent === null) return "Unavailable";

  const raw = `${rangePosition.rawPositionPercent.toFixed(0)}%`;
  // The break state is shown separately so clamping for the progress bar
  // can never conceal an out-of-range value.
  switch (rangePosition.breakState) {
    case "above_reference":
      return `${raw} — above reference high`;
    case "below_reference":
      return `${raw} — below reference low`;
    default:
      return raw;
  }
}

const FRESHNESS_LABELS: Record<PremarketExpansionResult["freshness"]["status"], string> = {
  real_time: "Real-time",
  delayed: "Delayed data",
  stale: "Stale — no new alert",
  partial: "Partial data — no new alert",
  unavailable: "Unavailable",
};

function formatFreshness(result: PremarketExpansionResult): string {
  const base = FRESHNESS_LABELS[result.freshness.status];
  // "Severely stale" is explanatory text only, never a separate state.
  return result.freshness.severelyStale && result.freshness.status === "stale"
    ? `${base} (severely stale)`
    : base;
}

/**
 * Three distinct situations, exactly as specified — and notably, a first
 * close beyond the final reference is NOT reported as accepted merely
 * because no unbroken level remains.
 */
function formatConfirmation(result: PremarketExpansionResult): string {
  const { confirmation, direction } = result;
  const verb = direction === "bullish" ? "above" : "below";
  const plural = direction === "bullish" ? "highs" : "lows";

  switch (confirmation.state) {
    case "awaiting_break":
      return `Break and hold ${verb} ${money(confirmation.activeLevel!.price)}`;
    case "awaiting_acceptance":
      return confirmation.allLevels.length > 1
        ? `Hold ${verb} both premarket and prior-day ${plural}`
        : `Hold ${verb} ${money(confirmation.allLevels[0]?.price ?? null)}`;
    case "accepted":
      return direction === "bullish"
        ? `Breakout accepted above ${acceptedLevelText(result)}`
        : `Breakdown accepted below ${acceptedLevelText(result)}`;
    default:
      return "No active level established";
  }
}

function acceptedLevelText(result: PremarketExpansionResult): string {
  const plural = result.direction === "bullish" ? "highs" : "lows";
  return result.confirmation.brokenLevels.length > 1
    ? `both premarket and prior-day ${plural}`
    : money(result.confirmation.brokenLevels[0]?.price ?? null);
}

const INVALIDATION_LABELS: Record<
  NonNullable<PremarketExpansionResult["invalidation"]["source"]>,
  string
> = {
  premarket_vwap: "PM VWAP",
  structure_pivot: "latest structure pivot",
  premarket_extreme: "premarket extreme",
  accepted_breakout_level: "accepted breakout level",
};

function formatInvalidation(result: PremarketExpansionResult): string {
  const { invalidation } = result;
  // No defensible structural level means saying so, never inventing a price.
  if (invalidation.price === null || invalidation.source === null) return "Not established";

  const verb = result.direction === "bullish" ? "Lose" : "Reclaim";
  return `${verb} ${INVALIDATION_LABELS[invalidation.source]} at ${money(invalidation.price)}`;
}

function formatIsoClock(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "Unavailable";
  return formatBarClock(Math.floor(ms / 1000));
}

function row(label: string, value: string): string {
  return `${label.padEnd(28)}${value}`;
}
