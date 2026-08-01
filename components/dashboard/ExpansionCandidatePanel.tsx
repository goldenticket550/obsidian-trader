"use client";

import { useState } from "react";
import type { SymbolExpansion } from "@/lib/scanner/scanService";
import type { SymbolExpansionMonitor } from "@/lib/scanner/expansionMonitor";
import type { EntryStatus } from "@/types/setup";
import type { MilestoneTierResult, MomentumLadderResult } from "@/lib/indicators/momentumLadder";
import {
  describeInteraction,
  BASELINE_REASON_TEXT,
  type EvidenceGroup,
  type ExpansionDirection,
  type ExpansionStage,
  type PremarketExpansionResult,
} from "@/lib/indicators/premarketExpansion";
import { stageLabel } from "@/lib/indicators/premarketExpansionDisplay";
import { EXPANSION_STAGE_PRIORITY } from "@/lib/scanner/expansionPriority";
import { formatEasternTime } from "@/lib/market-data/freshness";

/**
 * The Premarket Expansion Candidate card.
 *
 * Presentational only. Every number is read from the detector results —
 * this component computes no market measurement of its own, and every
 * formatter below maps a null to explicit words rather than to a zero, a
 * dash, or a plausible-looking placeholder.
 */

// ---------------------------------------------------------------------------
// Formatters
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

export function selectDisplayExpansion(expansion: SymbolExpansion): PremarketExpansionResult {
  const qualifying = selectQualifyingExpansion(expansion);
  if (qualifying) return qualifying;

  const { bullish, bearish } = expansion;
  return EXPANSION_STAGE_PRIORITY[bearish.stage] > EXPANSION_STAGE_PRIORITY[bullish.stage]
    ? bearish
    : bullish;
}

function hasNoPremarketWindow(result: PremarketExpansionResult): boolean {
  return (
    result.freshness.status === "unavailable" ||
    result.freshness.latestCompletedBarAt === null ||
    result.ranges.sessionHigh === null ||
    result.move.currentPrice === null
  );
}

// ---------------------------------------------------------------------------
// Stage rail
// ---------------------------------------------------------------------------

export type RailStepState = "done" | "current" | "pending";

export interface RailStep {
  label: string;
  state: RailStepState;
}

/**
 * The six observable milestones, in the order a real expansion passes
 * through them.
 *
 * `atLeast` is a threshold on the EXISTING priority table rather than a
 * parallel ranking — the rail can never disagree with the stage badge
 * beside it. "Early acceleration" is the one step keyed to a signal
 * instead of a stage: the alert can fire without the stage moving (a
 * symbol already at `level_break` outranks `opening_drive`), and the rail
 * should still show that it happened.
 */
const RAIL_STEPS: { label: string; atLeast: number }[] = [
  { label: "Premarket", atLeast: EXPANSION_STAGE_PRIORITY.premarket_candidate },
  { label: "Early Acceleration", atLeast: EXPANSION_STAGE_PRIORITY.opening_drive },
  { label: "Opening Drive", atLeast: EXPANSION_STAGE_PRIORITY.opening_drive },
  { label: "Level Break", atLeast: EXPANSION_STAGE_PRIORITY.level_break },
  { label: "Accepted", atLeast: EXPANSION_STAGE_PRIORITY.breakout_accepted },
  { label: "Expansion Active", atLeast: EXPANSION_STAGE_PRIORITY.expansion_active },
];

export function buildStageRail(
  stage: ExpansionStage,
  earlyAccelerationFired: boolean
): RailStep[] {
  const priority = EXPANSION_STAGE_PRIORITY[stage];

  const satisfied = RAIL_STEPS.map((step, index) => {
    if (index === 1) return earlyAccelerationFired || priority >= step.atLeast;
    return priority >= step.atLeast;
  });

  // The furthest milestone actually reached is "current"; everything
  // before it that was also reached is "done".
  let currentIndex = -1;
  satisfied.forEach((ok, index) => {
    if (ok) currentIndex = index;
  });

  return RAIL_STEPS.map((step, index) => ({
    label: step.label,
    state: !satisfied[index] ? "pending" : index === currentIndex ? "current" : "done",
  }));
}

// ---------------------------------------------------------------------------
// Ladders
// ---------------------------------------------------------------------------

export type LadderPillState =
  | "holding"
  | "reached"
  | "rejected"
  | "lost"
  | "approaching"
  | "pending";

const LADDER_PILL: Record<LadderPillState, { label: string; color: string }> = {
  holding: { label: "Holding", color: "var(--green)" },
  reached: { label: "Reached", color: "var(--amber)" },
  rejected: { label: "Rejected", color: "var(--red)" },
  lost: { label: "Lost", color: "var(--red)" },
  approaching: { label: "Approaching", color: "var(--text-secondary)" },
  pending: { label: "Pending", color: "var(--text-muted)" },
};

/**
 * Maps a tier's lifecycle state onto a display pill.
 *
 * "Approaching" is not a seventh lifecycle state — it is the LOWEST tier
 * not yet reached, which is simply the next one up. Every other unreached
 * tier is "Pending", so the card never implies price is near a level it is
 * nowhere near.
 */
export function ladderPillStates(ladder: MomentumLadderResult): LadderPillState[] {
  const firstUnreached = ladder.tiers.findIndex((t) => t.state === "not_reached");

  return ladder.tiers.map((tier, index) => {
    switch (tier.state) {
      case "holding":
      case "reclaimed":
        return "holding";
      case "reached":
        return "reached";
      case "rejected":
        return "rejected";
      case "lost":
        return "lost";
      default:
        return index === firstUnreached ? "approaching" : "pending";
    }
  });
}

// ---------------------------------------------------------------------------
// Small building blocks
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

/**
 * One of the three equal-width cards. The heading is muted for all three;
 * only the VALUE carries a tone, so a red "what breaks it" reads as the
 * consequence rather than as an alarm about the card itself.
 */
function MiniCard({
  heading,
  children,
  testId,
}: {
  heading: string;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="min-w-0 rounded px-2.5 py-2"
      style={{ background: "var(--panel-muted)", border: "1px solid var(--border-soft)" }}
    >
      <p
        className="text-[9px] uppercase tracking-[0.1em] mb-1.5"
        style={{ color: "var(--text-muted)" }}
      >
        {heading}
      </p>
      {children}
    </div>
  );
}

function CardLine({ value, tone, muted }: { value: string; tone?: string; muted?: boolean }) {
  return (
    <p
      className="text-[11px] leading-snug"
      style={{ color: tone ?? (muted ? "var(--text-muted)" : "var(--text-secondary)") }}
    >
      {value}
    </p>
  );
}

/** States that count as "already achieved" — a check, and no trailing word. */
const REACHED_STATES: ReadonlySet<LadderPillState> = new Set(["holding", "reached"]);

/**
 * One ladder: a left-aligned label followed by a horizontal row of tier
 * pills. Both ladders read the same `momentumLadder`; only the pill text
 * differs, so a dollar tier and its percent tier can never disagree.
 */
function Ladder({
  testId,
  heading,
  ladder,
  format,
}: {
  testId: string;
  heading: string;
  ladder: MomentumLadderResult;
  format: (tier: MilestoneTierResult) => string;
}) {
  if (ladder.insufficientData) {
    return (
      <div data-testid={testId} data-unavailable="true" className="flex items-baseline gap-2 py-1">
        <LadderLabel>{heading}</LadderLabel>
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          Unavailable — {ladder.detail}
        </p>
      </div>
    );
  }

  const states = ladderPillStates(ladder);

  return (
    <div data-testid={testId} className="flex items-baseline gap-2 py-1">
      <LadderLabel>{heading}</LadderLabel>
      <div className="flex flex-wrap gap-1.5 min-w-0">
        {ladder.tiers.map((tier, index) => {
          const state = states[index];
          const pill = LADDER_PILL[state];
          const reached = REACHED_STATES.has(state);
          return (
            <span
              key={tier.tierPct}
              data-testid={`${testId}-tier`}
              data-state={state}
              title={`${pill.label} · tier price ${money(tier.tierPrice)}`}
              className="inline-flex items-baseline gap-1 rounded px-1.5 py-[2px] text-[10px] font-mono tabular"
              style={{ color: pill.color, border: `1px solid ${pill.color}` }}
            >
              {reached && <span aria-hidden="true">✓</span>}
              {format(tier)}
              {/* An achieved tier needs no word beside the check; every
                  other state says which one it is. */}
              {!reached && (
                <span className="text-[8px] uppercase tracking-[0.08em] opacity-80">
                  {pill.label}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function LadderLabel({ children }: { children: string }) {
  return (
    <span
      className="text-[10px] uppercase tracking-[0.1em] w-[86px] shrink-0"
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </span>
  );
}

/** One node on the stage rail, plus the track segments either side of it. */
function RailNode({
  step,
  isFirst,
  isLast,
  reachedTrackBefore,
  reachedTrackAfter,
  accent,
}: {
  step: RailStep;
  isFirst: boolean;
  isLast: boolean;
  reachedTrackBefore: boolean;
  reachedTrackAfter: boolean;
  accent: string;
}) {
  const track = (reached: boolean, hidden: boolean) => (
    <span
      aria-hidden="true"
      className="h-px flex-1"
      style={{ background: hidden ? "transparent" : reached ? accent : "var(--border)" }}
    />
  );

  const node =
    step.state === "done" ? (
      <span
        className="shrink-0 h-3 w-3 rounded-full flex items-center justify-center text-[7px] leading-none"
        style={{ background: accent, color: "var(--page)" }}
      >
        ✓
      </span>
    ) : step.state === "current" ? (
      <span
        className="shrink-0 h-3 w-3 rounded-full"
        style={{ border: `2px solid ${accent}`, background: "transparent" }}
      />
    ) : (
      <span
        className="shrink-0 h-2 w-2 rounded-full"
        style={{ border: "1px solid var(--border)", background: "transparent" }}
      />
    );

  return (
    <>
      <span className="flex items-center w-full">
        {track(reachedTrackBefore, isFirst)}
        {node}
        {track(reachedTrackAfter, isLast)}
      </span>
      <span
        className="mt-1 text-[8px] uppercase tracking-[0.04em] text-center leading-tight px-0.5"
        style={{
          color:
            step.state === "current"
              ? accent
              : step.state === "done"
              ? "var(--text-secondary)"
              : "var(--text-muted)",
        }}
      >
        {step.label}
      </span>
    </>
  );
}

// ---------------------------------------------------------------------------
// Value builders
// ---------------------------------------------------------------------------

function baselineValue(comparison: PremarketExpansionResult["volumePace"]): string {
  if (comparison.multiple !== null) {
    return `${multiple(comparison.multiple)} median · ${comparison.baselineSampleSize} sessions`;
  }
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

/** The level price still ahead, when there is one. */
function nextReferenceValue(result: PremarketExpansionResult): string {
  const active = result.confirmation.activeLevel;
  if (active) {
    const name = active.name === "prior_day" ? "prior-day level" : "premarket reference";
    return `Next reference: ${money(active.price)} (${name})`;
  }
  return "No unbroken reference ahead";
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
  if (invalidation.price === null || invalidation.source === null) return "Not established";
  const verb = result.direction === "bullish" ? "Lose" : "Reclaim";
  return `${verb} ${INVALIDATION_LABELS[invalidation.source]} at ${money(invalidation.price)}`;
}

/** The dollar-volume headline: this bar against its own time-of-day baseline. */
function dollarVolumeValue(monitor: SymbolExpansionMonitor | undefined): string {
  if (!monitor) return "Unavailable";
  const { currentBarRelativeDollarVolume, cumulativeRelativeDollarVolume } = monitor.dollarVolume;
  if (currentBarRelativeDollarVolume !== null) {
    return `${multiple(currentBarRelativeDollarVolume)} this 1m bar vs its own time-of-day median`;
  }
  if (cumulativeRelativeDollarVolume !== null) {
    return `${multiple(cumulativeRelativeDollarVolume)} cumulative dollar volume vs median`;
  }
  return "Unavailable";
}

// ---------------------------------------------------------------------------

export function ExpansionCandidatePanel({
  expansion,
  monitor,
  entryStatus,
}: {
  expansion?: SymbolExpansion;
  monitor?: SymbolExpansionMonitor;
  entryStatus?: EntryStatus;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  // Nothing to say is said by saying nothing — never an empty placeholder
  // panel implying the symbol was evaluated and found uninteresting.
  if (!expansion) return null;

  const result = selectDisplayExpansion(expansion);
  const direction: ExpansionDirection = result.direction;
  const isBullish = direction === "bullish";
  const directionColor = isBullish ? "var(--green)" : "var(--red)";
  const empty = hasNoPremarketWindow(result);

  // The monitor's resolved stage supersedes the 5m stage when present —
  // it is the same stage after live one-minute impulse is accounted for.
  const directional = monitor ? monitor[direction] : null;
  const stage = directional?.stage ?? result.stage;
  const earlyFired = directional?.signals.earlyAccelerationFired ?? false;

  const freshness = FRESHNESS[result.freshness.status];
  const evidenceId = `expansion-evidence-${result.symbol}-${direction}`;

  const rail = buildStageRail(stage, earlyFired);
  const currentIndex = rail.findIndex((step) => step.state === "current");

  return (
    <section
      data-testid="expansion-panel"
      data-direction={direction}
      data-stage={stage}
      aria-label={`Premarket expansion candidate for ${result.symbol}, ${direction}`}
      className="mx-4 mt-3 rounded overflow-hidden"
      style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
    >
      {/* ---------------------------------------------------------------- */}
      {/* Header                                                            */}
      {/* ---------------------------------------------------------------- */}
      <div
        className="px-3 py-2 flex items-center flex-wrap gap-x-2 gap-y-1"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <span className="font-mono text-[13px]" style={{ color: "var(--text)" }}>
          {result.symbol}
        </span>
        <span className="font-mono tabular text-[12px]" style={{ color: directionColor }}>
          {isBullish ? "▲" : "▼"} {signedMoney(result.move.dollarMove)} (
          {signedPct(result.move.percentMove)})
        </span>

        <span
          data-testid="expansion-stage-badge"
          className="text-[9px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded"
          style={{ color: directionColor, border: `1px solid ${directionColor}` }}
        >
          {stageLabel(stage)}
        </span>

        <span
          className="text-[10px] px-1.5 py-0.5 rounded"
          style={{
            color: result.qualified ? directionColor : "var(--text-muted)",
            border: `1px solid ${result.qualified ? directionColor : "var(--border)"}`,
          }}
        >
          {result.qualified ? "Qualified" : "Developing"}
        </span>

        {/* Far right, and only when extended. Extension is a warning ABOUT
            a valid setup, not an invalidation of it — the wording says
            both things at once. */}
        {entryStatus === "extended_do_not_chase" && (
          <span
            data-testid="expansion-extended-warning"
            className="ml-auto text-[9px] px-1.5 py-0.5 rounded"
            style={{ color: "var(--amber)", border: "1px solid var(--amber)" }}
          >
            Valid · Highly extended · Do not chase
          </span>
        )}
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
        <div className="px-3 py-2.5">
          {/* -------------------------------------------------------------- */}
          {/* Stage rail                                                      */}
          {/* -------------------------------------------------------------- */}
          {/* One horizontal row, left to right, connected by a thin track.
              The track is accented up to the current node and muted after
              it, so the rail reads as progress rather than decoration. */}
          <ol
            data-testid="expansion-stage-rail"
            className="flex items-start w-full mb-3"
            aria-label="Expansion stage progress"
          >
            {rail.map((step, index) => (
              <li
                key={step.label}
                data-testid="expansion-rail-step"
                data-step={step.label}
                data-state={step.state}
                className="flex-1 min-w-0 flex flex-col items-center"
              >
                <RailNode
                  step={step}
                  isFirst={index === 0}
                  isLast={index === rail.length - 1}
                  reachedTrackBefore={currentIndex >= 0 && index <= currentIndex}
                  reachedTrackAfter={currentIndex >= 0 && index < currentIndex}
                  accent={directionColor}
                />
              </li>
            ))}
          </ol>

          {/* -------------------------------------------------------------- */}
          {/* Three cards                                                     */}
          {/* -------------------------------------------------------------- */}
          {/* Three equal columns, one row. */}
          <div data-testid="expansion-cards" className="grid grid-cols-3 gap-2 mb-3">
            <MiniCard testId="card-what-changed" heading="What changed">
              <CardLine value={dollarVolumeValue(monitor)} />
              <CardLine
                value={`${result.relativeStrength.benchmarkSymbol}: ${relativeValue(
                  result.relativeStrength
                )}`}
                muted
              />
            </MiniCard>

            <MiniCard testId="card-whats-next" heading="What's next">
              <CardLine value={confirmationValue(result)} />
              <CardLine value={nextReferenceValue(result)} muted />
            </MiniCard>

            <MiniCard testId="card-what-breaks-it" heading="What breaks it">
              <CardLine value={invalidationValue(result)} tone="var(--red)" />
              <CardLine
                value={
                  monitor?.openingRange
                    ? `Opening range ${money(monitor.openingRange.low)}–${money(
                        monitor.openingRange.high
                      )}`
                    : "Opening range not established"
                }
                muted
              />
            </MiniCard>
          </div>

          {/* -------------------------------------------------------------- */}
          {/* Ladders                                                         */}
          {/* -------------------------------------------------------------- */}
          {monitor ? (
            /* Stacked, dollar above percent — same tiers, two readings. */
            <div className="mb-3">
              <Ladder
                testId="dollar-ladder"
                heading="Dollar ladder"
                ladder={monitor.momentumLadder}
                format={(tier) =>
                  monitor.momentumLadder.anchorPrice === null
                    ? "Unavailable"
                    : signedMoney(tier.tierPrice - monitor.momentumLadder.anchorPrice)
                }
              />
              <Ladder
                testId="percent-ladder"
                heading="Percent ladder"
                ladder={monitor.momentumLadder}
                format={(tier) => `+${tier.tierPct}%`}
              />
            </div>
          ) : (
            <p className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>
              Momentum ladders unavailable — one-minute monitor not evaluated
            </p>
          )}

          {/* -------------------------------------------------------------- */}
          {/* Collapsible evidence                                            */}
          {/* -------------------------------------------------------------- */}
          <button
            type="button"
            onClick={() => setEvidenceOpen((open) => !open)}
            aria-expanded={evidenceOpen}
            aria-controls={evidenceId}
            className="w-full text-center text-[10px] uppercase tracking-[0.1em] py-1.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-champagne"
            style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border-soft)" }}
          >
            {evidenceOpen ? "▾" : "▸"} View evidence &amp; calculations
          </button>

          <div id={evidenceId} hidden={!evidenceOpen}>
            <SectionHeading>Premarket context</SectionHeading>
            <Row
              label="Move from prior close"
              value={`${signedMoney(result.move.dollarMove)} (${signedPct(
                result.move.percentMove
              )})`}
              tone={
                result.move.dollarMove === null
                  ? undefined
                  : result.move.dollarMove >= 0
                  ? "var(--green)"
                  : "var(--red)"
              }
            />
            <Row label="Volume pace" value={baselineValue(result.volumePace)} />
            <Row label="Premarket range" value={rangeValue(result.ranges)} />
            <Row label="Range vs baseline" value={baselineValue(result.rangeExpansion)} />
            <Row label="Position in reference range" value={positionValue(result.rangePosition)} />
            <Row
              label={`Relative to ${result.relativeStrength.benchmarkSymbol}`}
              value={relativeValue(result.relativeStrength)}
            />
            <Row label="Prior-day level" value={describeInteraction(result.priorLevel, direction)} />

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
              <p className="mt-1.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
                {result.passingGroups} of {result.totalGroups} evidence groups passing
              </p>
            </div>

            {/* Two different clocks, never collapsed into one "live" line. */}
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
              {monitor && (
                <Row
                  label="1-minute data"
                  value={
                    monitor.oneMinute.insufficientData
                      ? `Unavailable — ${monitor.oneMinute.reason ?? "no data"}`
                      : `${monitor.oneMinute.completedBarCount} completed bars · ${monitor.oneMinute.baselineSampleSize} baseline sessions`
                  }
                  tone={monitor.oneMinute.insufficientData ? "var(--text-muted)" : undefined}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
