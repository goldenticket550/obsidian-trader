"use client";

import type { SymbolExpansion } from "@/lib/scanner/scanService";
import type { PremarketExpansionResult } from "@/lib/indicators/premarketExpansion";
import {
  formatExpandedEvidence,
  stageLabel,
} from "@/lib/indicators/premarketExpansionDisplay";
import { EXPANSION_STAGE_PRIORITY } from "@/lib/scanner/expansionPriority";

/**
 * Display for the Premarket Expansion Candidate.
 *
 * Presentational only. Every string shown here comes from
 * `premarketExpansionDisplay`'s pure builders, which already render an
 * unmeasured value as "Unavailable" / "N/A" — this component renders that
 * output verbatim rather than reformatting it, so a missing baseline can
 * never be smoothed into a plausible-looking number on its way to the
 * screen.
 */

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
export function selectDisplayExpansion(
  expansion: SymbolExpansion
): PremarketExpansionResult {
  const qualifying = selectQualifyingExpansion(expansion);
  if (qualifying) return qualifying;

  const { bullish, bearish } = expansion;
  return EXPANSION_STAGE_PRIORITY[bearish.stage] > EXPANSION_STAGE_PRIORITY[bullish.stage]
    ? bearish
    : bullish;
}

export function ExpansionCandidatePanel({ expansion }: { expansion?: SymbolExpansion }) {
  // Nothing to say is said by saying nothing — never an empty placeholder
  // panel implying the symbol was evaluated and found uninteresting.
  if (!expansion) return null;

  const result = selectDisplayExpansion(expansion);
  const isBullish = result.direction === "bullish";
  const directionColor = isBullish ? "var(--green)" : "var(--red)";

  return (
    <section
      data-testid="expansion-panel"
      data-direction={result.direction}
      aria-label={`Premarket expansion candidate for ${result.symbol}, ${result.direction}`}
      className="mx-4 mb-3 rounded overflow-hidden"
      style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
    >
      <div
        className="px-3 py-2 flex items-center flex-wrap gap-x-2 gap-y-1"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <span className="text-[11px] uppercase tracking-[0.1em]" style={{ color: "var(--text-secondary)" }}>
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

      {/* Monospace and whitespace-preserving: the builders pad their labels
          into columns, which only line up in a fixed-width block. */}
      <pre
        className="px-3 py-2 text-[11px] leading-[1.5] font-mono whitespace-pre overflow-x-auto"
        style={{ color: "var(--text-secondary)" }}
      >
        {formatExpandedEvidence(result).join("\n")}
      </pre>
    </section>
  );
}
