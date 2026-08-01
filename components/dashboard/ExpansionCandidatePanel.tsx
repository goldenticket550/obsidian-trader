"use client";

import type { SymbolExpansion } from "@/lib/scanner/scanService";
import {
  describeInteraction,
  BASELINE_REASON_TEXT,
  type EvidenceGroup,
  type PremarketExpansionResult,
} from "@/lib/indicators/premarketExpansion";
import { stageLabel } from "@/lib/indicators/premarketExpansionDisplay";
import { EXPANSION_STAGE_PRIORITY } from "@/lib/scanner/expansionPriority";
import { formatEasternTime } from "@/lib/market-data/freshness";

/**
 * Display for the Premarket Expansion Candidate.
 *
 * Presentational only, and built from the RESULT's structured fields
 * rather than the preformatted evidence strings — the padded monospace
 * block those builders produce reads like a log dump next to the rest of
 * the dashboard.
 *
 * The one rule inherited from the detector survives the restyle intact:
 * anything that could not be measured says so. There is no formatter here
 * that turns a null into a zero, a dash, or a plausible-looking
 * placeholder.
 */

// ---------------------------------------------------------------------------
// Formatters — presentational only. Every one maps null to explicit words.
// ---------------------------------------------------------------------------

function money(value: number | null): string {
  return value === null ? "Unavailable" : `$${value.toFixed(2)}`;
}

function signedMoney(value: number | null): string {
  return value === null ? "Unavailable" : `${value >= 0 ? "+" : "−"}$${Math.abs(value).toFixed(2)}`;
}

function signedPct(value: number | null, digits = 2): string {
  return value === null
    ? "Unavailable"
    : `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}%`;
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

const STATE_PILL: Record<EvidenceGroup["state"], { label: string; color: string }> = {
  pass: { label: "Pass", color: "var(--green)" },
  wait: { label: "Wait", color: "var(--amber)" },
  // Muted, never red: unmeasurable is not a failure.
  unavailable: { label: "N/A", color: "var(--text-muted)" },
};

const FRESHNESS: Record<
  PremarketExpansionResult["freshness"]["status"],
  { label: string; color: string }
> = {
  real_time: { label: "Real-time", color: "var(--green)" },
  delayed: { label: "Delayed data", color: "var(--amber)" },
  stale: { label: "Stale — no new alert", color: "var(--red)" },
  partial: { label: "Partial data — no new alert", color: "var(--amber)" },
  unavailable: { label: "Unavailable", color: "var(--text-muted)" },
};

// ---------------------------------------------------------------------------
// Direction selection
// ---------------------------------------------------------------------------

/**
 * Which direction's evidence to surface.
 *
 * A qualifying direction wins. When BOTH qualify — a symbol expanding
 * hard enough to satisfy the gate either way — the sign of the move from
 * the prior close breaks the tie, so the read shown matches the direction
 * price has actually travelled.
 */
export function selectQualifyingExpansion(
  expansion: SymbolExpansion | undefined
): PremarketExpansionResult | null {
  if (!expansion) return null;
  const { bullish, bearish } = expansion;

  if (bullish.qualified && bearish.qualified) {
    return (bullish.move.percentMove ?? 0) >= 0 ? bullish : bearish;
  }
  if (bullish.qualified) return bullish;
  if (bearish.qualified) return bearish;
  return null;
}

/**
 * The direction to DISPLAY, which is not the same question as which one
 * qualifies: before qualification the evidence is still worth reading, so
 * the more developed stage is shown rather than nothing at all.
 */
export function selectDisplayExpansion(expansion: SymbolExpansion): PremarketExpansionResult {
  const qualifying = selectQualifyingExpansion(expansion);
  if (qualifying) return qualifying;

  const { bullish, bearish } = expansion;
  return EXPANSION_STAGE_PRIORITY[bearish.stage] > EXPANSION_STAGE_PRIORITY[bullish.stage]
    ? bearish
    : bullish;
}

/**
 * Nothing has printed in premarket yet, so every row below would read
 * "Unavailable". A wall of them says less than one honest sentence.
 */
function hasNoPremarketWindow(result: PremarketExpansionResult): boolean {
  return (
    result.freshness.status === "unavailable" ||
    result.freshness.latestCompletedBarAt === null ||
    result.ranges.sessionHigh === null ||
    result.move.currentPrice === null
  );
}

// ---------------------------------------------------------------------------
// Building blocks, matching AccountRiskPanel's label/value idiom
// ---------------------------------------------------------------------------

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <span
        className="font-mono tabular text-[12px] text-right"
        style={{ color: tone ?? "var(--text-secondary)" }}
      >
        {value}
      </span>
    </div>
  );
}

function SectionHeading({ children }: { children: string }) {
  return (
    <p
      className="text-[10px] uppercase tracking-[0.1em] mb-1"
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </p>
  );
}

function StatePill({ state }: { state: EvidenceGroup["state"] }) {
  const { label, color } = STATE_PILL[state];
  return (
    <span
      data-testid={`evidence-pill-${state}`}
      className="shrink-0 inline-flex items-center justify-center rounded text-[9px] px-1.5 py-[1px] w-[38px]"
      style={{ color, border: `1px solid ${color}` }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Value builders for the context section
// ---------------------------------------------------------------------------

function baselineValue(
  comparison: PremarketExpansionResult["volumePace"],
  noun: string
): string {
  if (comparison.multiple !== null) {
    return `${multiple(comparison.multiple)} ${noun} · ${comparison.baselineSampleSize} sessions`;
  }
  // The specific reason, not a bare "Unavailable" — "Insufficient
  // comparison sessions" and "Waiting for 15 minutes of premarket data"
  // call for completely different responses from a reader.
  return comparison.reason ? BASELINE_REASON_TEXT[comparison.reason] : "Unavailable";
}

function rangeValue(ranges: PremarketExpansionResult["ranges"]): string {
  if (ranges.sessionHigh === null || ranges.sessionLow === null) return "Unavailable";
  return `${money(ranges.sessionHigh - ranges.sessionLow)} (${money(ranges.sessionLow)}–${money(
    ranges.sessionHigh
  )})`;
}

function positionValue(rangePosition: PremarketExpansionResult["rangePosition"]): string {
  if (rangePosition.rawPositionPercent === null) return "Unavailable";
  const raw = `${rangePosition.rawPositionPercent.toFixed(0)}%`;
  // Reported separately so clamping for a progress bar could never hide
  // an out-of-range value.
  switch (rangePosition.breakState) {
    case "above_reference":
      return `${raw} · above reference high`;
    case "below_reference":
      return `${raw} · below reference low`;
    default:
      return raw;
  }
}

function relativeValue(relative: PremarketExpansionResult["relativeStrength"]): string {
  // Never the label alone — the computed difference sits beside it.
  return relative.relativePct === null
    ? "Unavailable"
    : `${signedPct(relative.relativePct)} (${relative.label})`;
}

function confirmationValue(result: PremarketExpansionResult): string {
  const { confirmation, direction } = result;
  const verb = direction === "bullish" ? "above" : "below";
  const plural = direction === "bullish" ? "highs" : "lows";

  switch (confirmation.state) {
    case "awaiting_break":
      return `Break and hold ${verb} ${money(confirmation.activeLevel?.price ?? null)}`;
    case "awaiting_acceptance":
      return confirmation.allLevels.length > 1
        ? `Hold ${verb} both premarket and prior-day ${plural}`
        : `Hold ${verb} ${money(confirmation.allLevels[0]?.price ?? null)}`;
    case "accepted": {
      const level =
        confirmation.brokenLevels.length > 1
          ? `both premarket and prior-day ${plural}`
          : money(confirmation.brokenLevels[0]?.price ?? null);
      return direction === "bullish"
        ? `Breakout accepted above ${level}`
        : `Breakdown accepted below ${level}`;
    }
    default:
      return "No active level established";
  }
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

function invalidationValue(result: PremarketExpansionResult): string {
  const { invalidation } = result;
  // No defensible structural level means saying so, never inventing a price.
  if (invalidation.price === null || invalidation.source === null) return "Not established";
  const verb = result.direction === "bullish" ? "Lose" : "Reclaim";
  return `${verb} ${INVALIDATION_LABELS[invalidation.source]} at ${money(invalidation.price)}`;
}

// ---------------------------------------------------------------------------

export function ExpansionCandidatePanel({ expansion }: { expansion?: SymbolExpansion }) {
  // Nothing to say is said by saying nothing — never an empty placeholder
  // panel implying the symbol was evaluated and found uninteresting.
  if (!expansion) return null;

  const result = selectDisplayExpansion(expansion);
  const isBullish = result.direction === "bullish";
  const directionColor = isBullish ? "var(--green)" : "var(--red)";
  const empty = hasNoPremarketWindow(result);
  const freshness = FRESHNESS[result.freshness.status];

  return (
    <section
      data-testid="expansion-panel"
      data-direction={result.direction}
      aria-label={`Premarket expansion candidate for ${result.symbol}, ${result.direction}`}
      className="mx-4 mt-3 rounded overflow-hidden"
      style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
    >
      <div
        className="px-3 py-2 flex items-center flex-wrap gap-x-2 gap-y-1"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <span
          className="text-[10px] uppercase tracking-[0.1em]"
          style={{ color: "var(--text-secondary)" }}
        >
          Premarket Expansion Candidate
        </span>
        <span className="text-[11px] font-mono" style={{ color: directionColor }}>
          {isBullish ? "▲" : "▼"} {isBullish ? "Bullish" : "Bearish"}
        </span>
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          · {stageLabel(result.stage)}
        </span>
        {/* "Developing" is a state, not a soft "almost" — the evidence
            below says exactly what has and has not been measured. */}
        <span
          className="ml-auto text-[10px] px-1.5 py-0.5 rounded"
          style={{
            color: result.qualified ? directionColor : "var(--text-muted)",
            border: `1px solid ${result.qualified ? directionColor : "var(--border)"}`,
          }}
        >
          {result.qualified ? "Qualified" : "Developing"}
        </span>
      </div>

      {empty ? (
        <p
          data-testid="expansion-empty"
          className="px-3 py-2.5 text-[11px]"
          style={{ color: "var(--text-muted)" }}
        >
          No premarket data yet — market closed or pre-open
        </p>
      ) : (
        <div className="px-3 py-2">
          <SectionHeading>Premarket context</SectionHeading>
          <Row
            label="Move from prior close"
            value={`${signedMoney(result.move.dollarMove)} (${signedPct(result.move.percentMove)})`}
            tone={
              result.move.dollarMove === null
                ? undefined
                : result.move.dollarMove >= 0
                ? "var(--green)"
                : "var(--red)"
            }
          />
          <Row label="Volume pace" value={baselineValue(result.volumePace, "median")} />
          <Row label="Premarket range" value={rangeValue(result.ranges)} />
          <Row label="Range vs baseline" value={baselineValue(result.rangeExpansion, "median")} />
          <Row label="Position in reference range" value={positionValue(result.rangePosition)} />
          <Row
            label={`Relative to ${result.relativeStrength.benchmarkSymbol}`}
            value={relativeValue(result.relativeStrength)}
          />
          <Row
            label="Prior-day level"
            value={describeInteraction(result.priorLevel, result.direction)}
          />

          <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--border-soft)" }}>
            <SectionHeading>Evidence</SectionHeading>
            <ul className="space-y-[3px]">
              {result.groups.map((group) => (
                <li key={group.name} className="flex items-baseline gap-2">
                  <StatePill state={group.state} />
                  <span className="min-w-0 text-[11px] leading-tight">
                    <span style={{ color: "var(--text-secondary)" }}>
                      {GROUP_LABELS[group.name]}
                    </span>{" "}
                    <span style={{ color: "var(--text-muted)" }}>— {group.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            {/* An honest count, not a rank: the denominator is every
                group, so a reader can see how much was measurable. */}
            <p className="mt-1.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
              {result.passingGroups} of {result.totalGroups} evidence groups passing
            </p>
          </div>

          <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--border-soft)" }}>
            <SectionHeading>Next</SectionHeading>
            <Row label="Confirmation" value={confirmationValue(result)} />
            <Row label="Invalidation" value={invalidationValue(result)} />
          </div>

          {/* Two different clocks, never collapsed into one "live" line: a
              scan running right now off a forty-minute-old bar is not live,
              however current the scan itself is. */}
          <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--border-soft)" }}>
            <Row label="Scanned at" value={formatEasternTime(result.freshness.scannedAt)} />
            <Row
              label="Latest completed bar"
              value={
                result.freshness.latestCompletedBarAt === null
                  ? "Unavailable"
                  : formatEasternTime(result.freshness.latestCompletedBarAt)
              }
            />
            <Row label="Data status" value={freshness.label} tone={freshness.color} />
          </div>
        </div>
      )}
    </section>
  );
}
