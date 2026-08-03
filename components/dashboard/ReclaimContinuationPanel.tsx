"use client";

import { useState } from "react";
import type { ReclaimSymbolResult } from "@/lib/scanner/reclaimRunner";
import { rankReclaimCandidates } from "@/lib/scanner/reclaimRunner";
import type {
  ReclaimEvidenceGroup,
  ReclaimMachineResult,
  ReclaimStage,
} from "@/lib/scanner/reclaimContinuation";

/**
 * Presentational view of the existing Reclaim & Continuation runner output.
 * It does not gate alerts or add directives; every displayed fact comes from
 * the result object. Unmeasured values remain "Unavailable" rather than zero.
 */

// ---------------------------------------------------------------------------
// Neutral, rules-based vocabulary
// ---------------------------------------------------------------------------

/** Rules-derived status language, never a trading instruction. */
const TIER_CRITERIA: Record<ReclaimSymbolResult["alertTier"], string> = {
  review_now: "Review criteria met",
  monitor: "Monitor criteria met",
  early: "Early criteria met",
  none: "No active tier",
};

const ALIGNMENT_LABEL: Record<ReclaimSymbolResult["alignment"], string> = {
  aligned: "Aligned",
  one_minute_leading: "1m leading",
  conflicting: "Mixed timeframes",
  unavailable: "Timeframes unavailable",
};

const STAGE_LABEL: Record<ReclaimStage, string> = {
  unavailable: "Unavailable",
  invalidated: "Invalidated",
  reset: "Reset",
  exhaustion: "Exhaustion",
  reclaim: "Reclaim",
  level_test: "Level test",
  acceptance: "Acceptance",
  continuation: "Continuation",
};

/** The rail, in the order a real setup passes through it. */
const RAIL: { label: string; stage: ReclaimStage }[] = [
  { label: "Reset", stage: "reset" },
  { label: "Exhaustion", stage: "exhaustion" },
  { label: "Reclaim", stage: "reclaim" },
  { label: "Level test", stage: "level_test" },
  { label: "Acceptance", stage: "acceptance" },
  { label: "Continuation", stage: "continuation" },
];

const EVIDENCE_LABEL: Record<ReclaimEvidenceGroup["name"], string> = {
  resetDepth: "Reset depth",
  failedContinuation: "Failed continuation",
  controlReclaim: "Control reclaim",
  participation: "Participation",
  roomToContinue: "Room to continue",
  dataFreshness: "Data freshness",
};

const EVIDENCE_STATE: Record<ReclaimEvidenceGroup["state"], { label: string; color: string }> = {
  pass: { label: "Pass", color: "var(--green)" },
  forming: { label: "Forming", color: "var(--amber)" },
  waiting: { label: "Waiting", color: "var(--text-secondary)" },
  // Muted, never red: unmeasurable is not a failure.
  unavailable: { label: "Unavailable", color: "var(--text-muted)" },
};

// ---------------------------------------------------------------------------
// Honest formatting — null never becomes a number
// ---------------------------------------------------------------------------

const UNAVAILABLE = "Unavailable";

function money(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? UNAVAILABLE
    : `$${value.toFixed(2)}`;
}

function signedMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNAVAILABLE;
  return `${value >= 0 ? "+" : "−"}$${Math.abs(value).toFixed(2)}`;
}

function pct(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? UNAVAILABLE
    : `${value.toFixed(digits)}%`;
}

function atrMultiple(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? UNAVAILABLE
    : `${value.toFixed(2)} ATR`;
}

function directionWord(result: ReclaimSymbolResult): string {
  if (result.direction === null) return "Direction unavailable";
  return result.direction === "bullish" ? "Bullish reclaim" : "Bearish reclaim";
}

function directionColor(result: ReclaimSymbolResult): string {
  if (result.direction === null) return "var(--text-muted)";
  return result.direction === "bullish" ? "var(--green)" : "var(--red)";
}

function reclaimedControls(five: ReclaimMachineResult | null): string {
  if (five === null) return UNAVAILABLE;
  const controls: string[] = [];
  if (five.vwapReclaimed) controls.push("VWAP");
  if (five.emaReclaimed) controls.push("9 EMA");
  if (five.structureReclaimed) controls.push("Structure");
  return controls.length > 0 ? `${controls.join(" + ")} reclaimed` : "None confirmed";
}

function benchmarkContext(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "Benchmark unavailable";
  }
  return `Benchmark relative move ${value > 0 ? "+" : ""}${value.toFixed(2)} pp`;
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
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

function DecisionSection({
  heading,
  children,
  testId,
}: {
  heading: string;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <section
      data-testid={testId}
      className="reclaim-decision-card"
    >
      <h4
        className="uppercase"
        style={{
          fontSize: "9px",
          letterSpacing: "0.1em",
          marginBottom: "6px",
          color: "var(--text-muted)",
        }}
      >
        {heading}
      </h4>
      {children}
    </section>
  );
}

/** The six-step rail. Mirrors the reference's node-and-track progression. */
function StageRail({ stage, accent }: { stage: ReclaimStage; accent: string }) {
  const currentIndex = RAIL.findIndex((step) => step.stage === stage);

  return (
    <ol
      data-testid="reclaim-rail"
      aria-label="Setup progression"
      className="reclaim-stage-rail"
    >
      {RAIL.map((step, index) => {
        const state =
          currentIndex === -1
            ? "pending"
            : index < currentIndex
            ? "complete"
            : index === currentIndex
            ? "current"
            : "pending";
        const reachedBefore = currentIndex >= 0 && index <= currentIndex;
        const reachedAfter = currentIndex >= 0 && index < currentIndex;

        const track = (reached: boolean, hidden: boolean) => (
          <span
            aria-hidden="true"
            style={{
              flex: 1,
              height: "2px",
              borderRadius: "1px",
              background: hidden ? "transparent" : reached ? accent : "var(--text-muted)",
              opacity: hidden ? 0 : reached ? 1 : 0.45,
            }}
          />
        );

        return (
          <li
            key={step.label}
            data-testid="reclaim-rail-step"
            data-step={step.label}
            data-state={state}
            className="flex flex-col items-center"
            style={{ flex: 1, minWidth: 0 }}
          >
            <span className="flex items-center w-full" style={{ minHeight: "14px" }}>
              {track(reachedBefore, index === 0)}
              <span
                style={{
                  flexShrink: 0,
                  width: state === "pending" ? "8px" : "14px",
                  height: state === "pending" ? "8px" : "14px",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxSizing: "border-box",
                  fontSize: "9px",
                  lineHeight: 1,
                  fontWeight: 700,
                  color: "var(--page)",
                  background:
                    state === "complete"
                      ? accent
                      : state === "current"
                      ? "var(--panel)"
                      : "var(--text-muted)",
                  border: state === "pending" ? "none" : `2px solid ${accent}`,
                  opacity: state === "pending" ? 0.45 : 1,
                }}
              >
                {state === "complete" ? "✓" : ""}
              </span>
              {track(reachedAfter, index === RAIL.length - 1)}
            </span>
            <span
              className="uppercase text-center"
              style={{
                marginTop: "6px",
                fontSize: "8px",
                lineHeight: 1.25,
                letterSpacing: "0.04em",
                padding: "0 2px",
                color:
                  state === "current"
                    ? accent
                    : state === "complete"
                    ? "var(--text-secondary)"
                    : "var(--text-muted)",
              }}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

function ReclaimDetail({ result }: { result: ReclaimSymbolResult }) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const five: ReclaimMachineResult | null = result.fiveMinute;
  const accent = directionColor(result);
  const evidenceId = `reclaim-evidence-${result.symbol}`;

  return (
    <div data-testid="reclaim-detail" data-symbol={result.symbol} className="min-w-0">
      {/* Summary */}
      <div
        className="reclaim-summary-card"
      >
        <div className="flex items-baseline flex-wrap gap-x-2 gap-y-1">
          <span className="font-mono text-[13px]" style={{ color: "var(--text)" }}>
            {result.symbol}
          </span>
          <span
            data-testid="reclaim-direction"
            className="text-[9px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded"
            style={{ color: accent, border: `1px solid ${accent}` }}
          >
            {directionWord(result)}
          </span>
          {result.isNewSetup && (
            <span
              data-testid="reclaim-new-setup"
              className="text-[9px] px-1.5 py-0.5 rounded"
              style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
            >
              New setup
            </span>
          )}
          <span
            data-testid="reclaim-tier"
            className="ml-auto text-[10px] px-1.5 py-0.5 rounded"
            style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
          >
            {TIER_CRITERIA[result.alertTier]}
          </span>
        </div>

        <p className="mt-1.5 text-[12px]" style={{ color: "var(--text-secondary)" }}>
          {STAGE_LABEL[result.stage]}
          {five?.reclaimStatus && five.reclaimStatus !== "none"
            ? ` · reclaim ${five.reclaimStatus}`
            : ""}
        </p>
        <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
          {five?.summary ?? "No qualifying setup on the five-minute series."}
        </p>
      </div>

      <StageRail stage={result.stage} accent={accent} />

      {/* Three decision sections */}
      <div data-testid="reclaim-decisions" className="reclaim-decision-grid">
        <DecisionSection heading="What changed" testId="reclaim-what-changed">
          <Fact
            label="Reset"
            value={
              five === null
                ? UNAVAILABLE
                : `${signedMoney(five.resetDollars)} · ${atrMultiple(five.resetAtr)}`
            }
          />
          <Fact label="Severity" value={five?.resetSeverity ?? UNAVAILABLE} />
          <Fact label="Control" value={reclaimedControls(five)} />
          <Fact
            label="Recovery"
            value={five === null ? UNAVAILABLE : atrMultiple(five.recoveryAtr)}
          />
          <Fact label="Participation" value={five === null ? UNAVAILABLE : formatPace(five)} />
        </DecisionSection>

        <DecisionSection heading="What's next" testId="reclaim-whats-next">
          <Fact
            label="Level"
            value={
              five?.nextLevelName == null
                ? UNAVAILABLE
                : `${five.nextLevelName} ${money(five.nextLevelPrice)}`
            }
          />
          <Fact
            label="Distance"
            value={
              five === null
                ? UNAVAILABLE
                : `${money(five.distanceToNextLevelDollars)} · ${pct(
                    five.distanceToNextLevelPct
                  )} · ${atrMultiple(five.distanceToNextLevelAtr)}`
            }
          />
          <Fact
            label="Accepted"
            value={
              five?.acceptedLevelName == null
                ? "None yet"
                : `${five.acceptedLevelName} ${money(five.acceptedLevelPrice)}`
            }
          />
        </DecisionSection>

        <DecisionSection heading="What breaks it" testId="reclaim-what-breaks-it">
          <Fact
            label="Invalidation"
            value={
              five?.invalidationName == null
                ? "Not established"
                : `${five.invalidationName} ${money(five.invalidationPrice)}`
            }
            tone="var(--red)"
          />
          <Fact
            label="Chase guard"
            value={five === null ? UNAVAILABLE : five.isExtended ? "Extended" : "Not extended"}
          />
          <Fact label="Data" value={five?.freshness ?? UNAVAILABLE} />
        </DecisionSection>
      </div>

      {/* Existing rules status, framed as evidence rather than a directive. */}
      <div
        data-testid="reclaim-evaluation"
        className="reclaim-evaluation-row flex items-baseline flex-wrap gap-x-3 gap-y-1 px-3 py-3"
      >
        <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
          Criteria status: {TIER_CRITERIA[result.alertTier]}
        </span>
        <span
          data-testid="reclaim-alignment"
          className="text-[10px] px-1.5 py-0.5 rounded"
          style={{
            color: result.alignment === "conflicting" ? "var(--amber)" : "var(--text-muted)",
            border: "1px solid var(--border)",
          }}
        >
          {ALIGNMENT_LABEL[result.alignment]}
        </span>
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          1m scout: {STAGE_LABEL[result.oneMinuteStage]}
        </span>
        {result.cappedByTimeframe && (
          <span data-testid="reclaim-capped" className="text-[10px]" style={{ color: "var(--amber)" }}>
            1-minute capped to Monitor
          </span>
        )}
        {result.reviewBlockedByAlignment && (
          <span data-testid="reclaim-blocked" className="text-[10px]" style={{ color: "var(--amber)" }}>
            Review criteria blocked — mixed timeframes
          </span>
        )}
        <span className="ml-auto text-[10px]" style={{ color: "var(--text-muted)" }}>
          {benchmarkContext(five?.benchmarkRelativeMove)}
        </span>
      </div>

      {/* Evidence, collapsed by default */}
      <button
        type="button"
        onClick={() => setEvidenceOpen((open) => !open)}
        aria-expanded={evidenceOpen}
        aria-controls={evidenceId}
        className="w-full text-center text-[10px] uppercase tracking-[0.1em] py-1.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-champagne"
        style={{ color: "var(--text-muted)" }}
      >
        {evidenceOpen ? "▾" : "▸"} View evidence · {five?.evidence.length ?? 0} groups
      </button>

      <div id={evidenceId} hidden={!evidenceOpen}>
        {five === null || five.evidence.length === 0 ? (
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            No evidence available.
          </p>
        ) : (
          <ul className="space-y-[3px]">
            {five.evidence.map((group) => {
              const state = EVIDENCE_STATE[group.state];
              return (
                <li key={group.name} className="flex items-baseline gap-2">
                  <span
                    data-testid={`reclaim-evidence-${group.state}`}
                    className="shrink-0 inline-flex items-center justify-center rounded text-[9px] px-1.5 py-[1px]"
                    style={{ color: state.color, border: `1px solid ${state.color}`, width: "72px" }}
                  >
                    {state.label}
                  </span>
                  <span className="min-w-0 text-[11px] leading-tight">
                    <span style={{ color: "var(--text-secondary)" }}>
                      {EVIDENCE_LABEL[group.name]}
                    </span>{" "}
                    <span style={{ color: "var(--text-muted)" }}>— {group.detail}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatPace(five: ReclaimMachineResult): string {
  return five.volumePace === null ? UNAVAILABLE : `${five.volumePace.toFixed(1)}× normal pace`;
}

// ---------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------

export function ReclaimContinuationPanel({
  reclaimBySymbol,
  reclaimErrors,
  embedded = false,
}: {
  reclaimBySymbol?: Record<string, ReclaimSymbolResult>;
  reclaimErrors?: { symbol: string; message: string }[];
  embedded?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  // Absent means "not evaluated" — the screen says nothing at all rather
  // than claiming nothing was found.
  if (!reclaimBySymbol) return null;

  // One malformed entry must not take the whole view down.
  const entries = Object.values(reclaimBySymbol).filter(
    (entry): entry is ReclaimSymbolResult =>
      entry !== null && typeof entry === "object" && typeof entry.symbol === "string"
  );

  const active = rankReclaimCandidates(entries.filter((e) => e.fiveMinute !== null));
  const historical = entries.filter((e) => e.fiveMinute === null && e.historical !== null);

  const chosen = active.find((e) => e.symbol === selected) ?? active[0] ?? null;

  return (
    <section
      className={embedded ? "overflow-hidden" : "command-panel overflow-hidden"}
      aria-label="Reclaim and continuation"
    >
      <div
        className="px-4 py-2.5 flex items-baseline justify-between flex-wrap gap-2"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div>
          <h2 className="card-heading">Reclaim &amp; Continuation</h2>
          <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            Ranked by stage, alignment, freshness and participation
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: "var(--blue)", background: "rgba(77, 163, 229, 0.1)" }}>
            {active.length} active
          </span>
          {/* Describes the source and bar basis without making an alerting claim. */}
          <span
            data-testid="reclaim-evaluation-banner"
            className="text-[9px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded"
            style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
          >
            Rules-based / completed bars
          </span>
        </div>
      </div>

      {active.length === 0 && historical.length === 0 && (
        <p className="px-4 py-6 text-[12px]" style={{ color: "var(--text-muted)" }}>
          No candidate currently meets the criteria.
        </p>
      )}

      {active.length > 0 && (
        <div className="p-4">
          <div
            className="reclaim-layout-grid"
            data-testid="reclaim-layout"
          >
            {/* Ranked candidates */}
            <aside data-testid="reclaim-ranked" aria-label="Ranked candidates" className="reclaim-ranked-list">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    <th className="text-left font-normal pb-1" style={{ width: "1.6rem" }}>
                      #
                    </th>
                    <th className="text-left font-normal pb-1">Candidate</th>
                    <th className="text-right font-normal pb-1">Reset</th>
                  </tr>
                </thead>
                <tbody>
                  {active.map((entry, index) => (
                    <tr
                      key={entry.symbol}
                      data-testid="reclaim-row"
                      data-symbol={entry.symbol}
                      data-active={String(entry.symbol === chosen?.symbol)}
                      className="reclaim-candidate-row"
                    >
                      <td
                        className="font-mono tabular text-[10px] align-top py-1"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {index + 1}
                      </td>
                      <td className="py-1">
                        <button
                          type="button"
                          onClick={() => setSelected(entry.symbol)}
                          aria-pressed={entry.symbol === chosen?.symbol}
                          className="font-mono text-left inline-flex items-center gap-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-champagne"
                          style={{ color: "var(--text)" }}
                        >
                          <span
                            aria-hidden="true"
                            className="h-1.5 w-1.5 rounded-full shrink-0"
                            style={{ background: directionColor(entry) }}
                          />
                          {entry.symbol}
                        </button>
                        <span className="block text-[10px]" style={{ color: "var(--text-muted)" }}>
                          {STAGE_LABEL[entry.stage]} · {TIER_CRITERIA[entry.alertTier]}
                        </span>
                      </td>
                      <td
                        className="py-1 text-right font-mono tabular text-[11px] align-top"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {signedMoney(entry.fiveMinute?.resetDollars ?? null)}
                        <span className="block text-[10px]" style={{ color: "var(--text-muted)" }}>
                          {pct(entry.fiveMinute?.resetPct ?? null)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </aside>

            {chosen !== null && <ReclaimDetail result={chosen} />}
          </div>
        </div>
      )}

      {/* An invalidated setup is history, never presented as a candidate. */}
      {historical.length > 0 && (
        <div
          data-testid="reclaim-historical"
          className="px-4 py-2"
          style={{ borderTop: "1px solid var(--border-soft)" }}
        >
          <p className="text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>
            History — invalidated
          </p>
          {historical.map((entry) => (
            <p key={entry.symbol} className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              <span className="font-mono">{entry.symbol}</span> — invalidated
              {entry.historical?.invalidationName
                ? ` at ${entry.historical.invalidationName} ${money(
                    entry.historical.invalidationPrice
                  )}`
                : ""}
            </p>
          ))}
        </div>
      )}

      {/* Evaluation errors, kept separate from scan errors. */}
      {reclaimErrors && reclaimErrors.length > 0 && (
        <div
          data-testid="reclaim-errors"
          className="px-4 py-2"
          style={{ borderTop: "1px solid var(--border-soft)" }}
        >
          <p className="text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>
            Evaluation errors
          </p>
          {reclaimErrors.map((error) => (
            <p key={error.symbol} className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              <span className="font-mono" style={{ color: "var(--red)" }}>
                {error.symbol}
              </span>
              : {error.message}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
