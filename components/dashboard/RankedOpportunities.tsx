"use client";

import { useEffect, useState } from "react";
import type { WatchlistSymbol } from "@/types/watchlist";
import type { SetupResult } from "@/types/setup";
import { SetupDetail } from "./SetupDetail";
import {
  ExpansionCandidatePanel,
  selectQualifyingExpansion,
  selectDisplayExpansion,
} from "./ExpansionCandidatePanel";
import type { SymbolExpansion } from "@/lib/scanner/scanService";
import type { SymbolExpansionMonitor } from "@/lib/scanner/expansionMonitor";
import { stageLabel } from "@/lib/indicators/premarketExpansionDisplay";
import { rankOpportunities, RANKING_RULE_DESCRIPTION } from "@/lib/scanner/ranking";
import { formatEasternTime } from "@/lib/market-data/freshness";
import { compareExpansionPriority } from "@/lib/scanner/expansionPriority";
import { selectPreferredExpansion } from "@/lib/scanner/expansionPresentation";
import type { ReclaimSymbolResult } from "@/lib/scanner/reclaimRunner";
import { ReclaimContinuationPanel } from "./ReclaimContinuationPanel";

const STATUS_DOT: Record<"red" | "yellow" | "green", string> = {
  red: "var(--red)",
  yellow: "var(--amber)",
  green: "var(--green)",
};

const ENTRY_SHORT: Record<string, string> = {
  actionable_now: "Actionable",
  wait_for_pullback: "Wait pullback",
  extended_do_not_chase: "Extended",
  invalidated: "Invalidated",
  insufficient_data: "No data",
};

const ENTRY_COLOR: Record<string, string> = {
  actionable_now: "var(--green)",
  wait_for_pullback: "var(--amber)",
  extended_do_not_chase: "var(--amber)",
  invalidated: "var(--red)",
  insufficient_data: "var(--text-muted)",
};

/** `dailyChangePct` / `distanceFromSessionLowPct` are stored as fractions
 * (0.0165 = 1.65%), matching every indicator in lib/. */
function formatPct(fraction: number, withSign = false): string {
  const pct = fraction * 100;
  return `${withSign && pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function formatMoneyMove(value: number | null): string {
  if (value === null) return "--";
  const prefix = value > 0 ? "+$" : value < 0 ? "-$" : "$";
  return `${prefix}${Math.abs(value).toFixed(2)}`;
}

function formatNullablePct(value: number | null): string {
  if (value === null) return "--";
  return formatPct(value, true);
}

const COLS =
  "grid grid-cols-[26px_minmax(74px,1fr)_88px_72px_46px_46px_minmax(104px,1.1fr)_86px_30px] gap-2 items-center";

export function RankedOpportunities({
  symbols,
  resultsBySymbol,
  loading,
  scoreThreshold,
  expansionBySymbol,
  expansionMonitorBySymbol,
  selectedExpansionSymbol,
  onExpansionSelectionChange,
  reclaimBySymbol,
  reclaimErrors,
}: {
  symbols: WatchlistSymbol[];
  resultsBySymbol: Record<string, { "5m": SetupResult; "15m": SetupResult }>;
  loading: boolean;
  scoreThreshold: number;
  /**
   * Premarket Expansion Candidates, when the scan produced them. Optional:
   * omitted, this component renders exactly as it did before the feature
   * existed — no chip, no panel.
   */
  expansionBySymbol?: Record<string, SymbolExpansion>;
  /** The one-minute layer, when the scan evaluated it. Equally optional. */
  expansionMonitorBySymbol?: Record<string, SymbolExpansionMonitor>;
  selectedExpansionSymbol?: string | null;
  onExpansionSelectionChange?: (symbol: string) => void;
  /** Existing Reclaim output, displayed without deriving any new values. */
  reclaimBySymbol?: Record<string, ReclaimSymbolResult>;
  reclaimErrors?: { symbol: string; message: string }[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [timeframes, setTimeframes] = useState<Record<string, "5m" | "15m">>({});
  const [activeView, setActiveView] = useState<"setups" | "expansion">("setups");

  const ranked = rankOpportunities(symbols);
  useEffect(() => {
    if (!selectedExpansionSymbol || !expansionBySymbol?.[selectedExpansionSymbol]) return;
    setActiveView("expansion");
    setExpanded(selectedExpansionSymbol);
    const frame = requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`[data-ticker="${selectedExpansionSymbol}"]`);
      row?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
      row?.querySelector<HTMLButtonElement>("[data-expansion-toggle]")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedExpansionSymbol, expansionBySymbol]);

  const displayed =
    activeView === "setups"
      ? ranked
      : [...ranked].sort((a, b) => {
          const expansionA = expansionBySymbol?.[a.ticker];
          const expansionB = expansionBySymbol?.[b.ticker];
          if (!expansionA && !expansionB) return a.ticker.localeCompare(b.ticker);
          if (!expansionA) return 1;
          if (!expansionB) return -1;
          const selectedA = selectPreferredExpansion(
            expansionA,
            expansionMonitorBySymbol?.[a.ticker]
          );
          const selectedB = selectPreferredExpansion(
            expansionB,
            expansionMonitorBySymbol?.[b.ticker]
          );
          const monitorA = expansionMonitorBySymbol?.[a.ticker];
          const monitorB = expansionMonitorBySymbol?.[b.ticker];
          return compareExpansionPriority(
            {
              symbol: a.ticker,
              stage: selectedA.stage,
              atrNormalizedMove: null,
              relativeDollarVolume:
                monitorA?.dollarVolume.cumulativeRelativeDollarVolume ??
                selectedA.result.volumePace.multiple,
              sectorRelativePerformance: selectedA.result.relativeStrength.relativePct,
              lastConfirmedTransitionAt:
                monitorA?.[selectedA.result.direction].earlyAcceleration.fired
                  ? monitorA[selectedA.result.direction].earlyAcceleration.barTime
                  : null,
            },
            {
              symbol: b.ticker,
              stage: selectedB.stage,
              atrNormalizedMove: null,
              relativeDollarVolume:
                monitorB?.dollarVolume.cumulativeRelativeDollarVolume ??
                selectedB.result.volumePace.multiple,
              sectorRelativePerformance: selectedB.result.relativeStrength.relativePct,
              lastConfirmedTransitionAt:
                monitorB?.[selectedB.result.direction].earlyAcceleration.fired
                  ? monitorB[selectedB.result.direction].earlyAcceleration.barTime
                  : null,
            }
          );
        });

  return (
    <section className="command-panel overflow-hidden" aria-label="Ranked opportunities">
      <div
        className="px-4 py-2.5 flex items-baseline justify-between gap-3"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-1.5">
          <h2 className="card-heading">Ranked opportunities</h2>
          <span
            tabIndex={0}
            role="img"
            aria-label={RANKING_RULE_DESCRIPTION}
            title={RANKING_RULE_DESCRIPTION}
            className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full text-[9px] cursor-help focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-champagne"
            style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
          >
            i
          </span>
        </div>
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          {symbols.length} symbols
        </span>
      </div>
      {expansionBySymbol !== undefined && (
        <div
          className="px-4 flex items-center gap-5"
          style={{ borderBottom: "1px solid var(--border)" }}
          role="tablist"
          aria-label="Opportunity type"
        >
          {(["setups", "expansion"] as const).map((view) => (
            <button
              key={view}
              type="button"
              role="tab"
              id={`opportunities-${view}-tab`}
              aria-controls={`opportunities-${view}-panel`}
              aria-selected={activeView === view}
              onClick={() => {
                setActiveView(view);
                setExpanded(null);
              }}
              className="py-2 text-[10px] uppercase tracking-[0.12em] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-champagne"
              style={{
                color: activeView === view ? "var(--amber)" : "var(--text-muted)",
                borderBottom:
                  activeView === view ? "2px solid var(--amber)" : "2px solid transparent",
              }}
            >
              {view}
            </button>
          ))}
          <span className="ml-auto text-[9px]" style={{ color: "var(--text-muted)" }}>
            {activeView === "expansion"
              ? "Stage, then measured move"
              : reclaimBySymbol !== undefined
              ? "Reclaim stages, then supporting evidence"
              : "Ordered by setup score"}
          </span>
        </div>
      )}

      {loading && (
        <p className="px-4 py-8 text-[12px]" style={{ color: "var(--text-muted)" }}>
          Scanning…
        </p>
      )}

      {!loading &&
        ranked.length === 0 &&
        !(activeView === "setups" && reclaimBySymbol !== undefined) && (
          <p className="px-4 py-8 text-[12px] text-center" style={{ color: "var(--text-muted)" }}>
            No symbols scanned successfully.
          </p>
        )}

      {!loading && activeView === "setups" && reclaimBySymbol !== undefined && (
        <ReclaimContinuationPanel
          reclaimBySymbol={reclaimBySymbol}
          reclaimErrors={reclaimErrors}
          embedded
        />
      )}

      {!loading && ranked.length > 0 && (
        <details
          id={`opportunities-${activeView}-panel`}
          role="tabpanel"
          aria-labelledby={`opportunities-${activeView}-tab`}
          className={
            activeView === "setups" && reclaimBySymbol !== undefined
              ? "supporting-evidence"
              : ""
          }
          open={activeView === "setups" && reclaimBySymbol !== undefined ? undefined : true}
        >
          {activeView === "setups" && reclaimBySymbol !== undefined && (
            <summary>
              Supporting 5m / 15m score evidence
              <span>{ranked.length} symbols</span>
            </summary>
          )}
          <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            <div
              className={`${COLS} px-4 py-1.5 text-[10px] uppercase tracking-[0.1em]`}
              style={{ borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}
            >
              <span>#</span>
              <span>Ticker</span>
              <span className="text-right">Price</span>
              <span className="text-right">Chg</span>
              <span className="text-right">{activeView === "expansion" ? "$ move" : "5m"}</span>
              <span className="text-right">{activeView === "expansion" ? "% move" : "15m"}</span>
              <span>Stage / entry</span>
              <span className="text-right">Candle</span>
              <span />
            </div>

            {displayed.map((s, index) => {
              const isOpen = expanded === s.ticker;
              const timeframe = timeframes[s.ticker] ?? "5m";
              const detail = resultsBySymbol[s.ticker]?.[timeframe] ?? null;
              const row = resultsBySymbol[s.ticker]?.["5m"] ?? null;
              const entry = row?.entryStatus;
              const panelId = `setup-${s.ticker}`;
              // No candle => price is a previous-close fallback, not a quote.
              const hasCandle = !!row?.latestCandleTime;
              const expansion = expansionBySymbol?.[s.ticker];
              // Only a QUALIFYING candidate earns a chip. A developing or
              // absent one shows nothing rather than a placeholder that
              // would read as a weak signal.
              const qualifying = selectQualifyingExpansion(expansion);
              const displayExpansion = expansion ? selectDisplayExpansion(expansion) : null;
              const displayExpansionStage = displayExpansion
                ? expansionMonitorBySymbol?.[s.ticker]?.[displayExpansion.direction].stage ??
                  displayExpansion.stage
                : null;

              return (
                <div
                  key={s.ticker}
                  data-ticker={s.ticker}
                  style={
                    isOpen
                      ? {
                          background: "rgba(214,166,63,0.05)",
                          borderTop: "1px solid rgba(214,166,63,0.35)",
                          borderBottom: "1px solid rgba(214,166,63,0.35)",
                        }
                      : { borderBottom: "1px solid var(--border-soft)" }
                  }
                >
                  {/* Row is a plain container, not a button — the expand
                      control is its own element, so nothing interactive
                      ends up nested inside anything interactive. */}
                  <div className={`${COLS} px-4 py-2 text-[13px] hover:bg-white/[0.02] transition-colors`}>
                    <span
                      className="font-mono tabular text-[10px]"
                      style={{ color: isOpen ? "var(--amber)" : "var(--text-muted)" }}
                    >
                      {index + 1}
                    </span>

                    <span className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                        style={{ background: STATUS_DOT[s.status5m] }}
                        aria-hidden="true"
                      />
                      <span className="font-mono truncate" style={{ color: "var(--text)" }}>
                        {s.ticker}
                      </span>
                    </span>

                    {/* With no session candle the scanner falls back to the
                        previous close, which makes the change mechanically
                        0.0%. Rendering that as a normal quote would imply a
                        flat live market rather than absent data. */}
                    <span
                      className="font-mono tabular text-[12px] text-right"
                      style={{ color: hasCandle ? "var(--text)" : "var(--text-muted)" }}
                      title={hasCandle ? undefined : "Previous close — no session candle yet"}
                    >
                      ${s.price.toFixed(2)}
                    </span>

                    <span
                      className="font-mono tabular text-[12px] text-right"
                      style={{
                        color: !hasCandle
                          ? "var(--text-muted)"
                          : s.dailyChangePct < 0
                          ? "var(--red)"
                          : "var(--green)",
                      }}
                      title={hasCandle ? undefined : "No session candle to compare against"}
                    >
                      {hasCandle ? formatPct(s.dailyChangePct, true) : "—"}
                    </span>

                    <span
                      className="font-mono tabular text-right"
                      style={{ color: "var(--text)" }}
                    >
                      {activeView === "expansion"
                        ? formatMoneyMove(displayExpansion?.move.dollarMove ?? null)
                        : s.score5m.toFixed(1)}
                    </span>
                    <span
                      className="font-mono tabular text-right text-[12px]"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {activeView === "expansion"
                        ? formatNullablePct(displayExpansion?.move.percentMove ?? null)
                        : s.score15m.toFixed(1)}
                    </span>

                    <span className="min-w-0 text-[11px] leading-tight">
                      {activeView === "expansion" && displayExpansionStage && (
                        <span className="block truncate" style={{ color: "var(--text-secondary)" }}>
                          {stageLabel(displayExpansionStage)}
                        </span>
                      )}
                      <span className={activeView === "expansion" ? "hidden" : "block truncate"} style={{ color: "var(--text-secondary)" }}>
                        {row ? row.stage.replace(/_/g, " ") : "—"}
                      </span>
                      {activeView === "setups" && entry && (
                        <span
                          className="block truncate"
                          style={{ color: ENTRY_COLOR[entry] ?? "var(--text-muted)" }}
                        >
                          {ENTRY_SHORT[entry] ?? entry}
                        </span>
                      )}
                      {/* A separate setup type, so it sits on its own line
                          rather than competing with the reversal stage
                          above it. Direction is carried by the arrow and
                          by the label — never by colour alone. */}
                      {activeView === "setups" && qualifying && (
                        <span
                          data-testid="expansion-chip"
                          aria-label={`Premarket expansion candidate, ${qualifying.direction}, ${stageLabel(
                            qualifying.stage
                          )}`}
                          title={`${
                            qualifying.direction === "bullish" ? "Bullish" : "Bearish"
                          } premarket expansion — ${stageLabel(qualifying.stage)}`}
                          className="block truncate text-[10px]"
                          style={{
                            color:
                              qualifying.direction === "bullish" ? "var(--green)" : "var(--red)",
                          }}
                        >
                          {qualifying.direction === "bullish" ? "▲" : "▼"} Expansion ·{" "}
                          {stageLabel(qualifying.stage)}
                        </span>
                      )}
                    </span>

                    {/* Candle time deliberately adjacent to price so the
                        price is never read as a live quote. */}
                    <span
                      className="text-[10px] font-mono tabular text-right"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {row?.latestCandleTime ? formatEasternTime(row.latestCandleTime) : "—"}
                    </span>

                    <button
                      data-expansion-toggle={activeView === "expansion" ? "true" : undefined}
                      onClick={() => {
                        setExpanded(isOpen ? null : s.ticker);
                        if (!isOpen && activeView === "expansion") {
                          onExpansionSelectionChange?.(s.ticker);
                        }
                      }}
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      aria-label={`${isOpen ? "Collapse" : "Expand"} ${s.ticker} setup detail`}
                      className="justify-self-end h-6 w-6 rounded flex items-center justify-center text-[10px] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-champagne"
                      style={{
                        border: "1px solid var(--border)",
                        color: isOpen ? "var(--amber)" : "var(--text-muted)",
                      }}
                    >
                      {isOpen ? "▾" : "▸"}
                    </button>
                  </div>

                  {isOpen && (detail || expansion) && (
                    <div id={panelId}>
                      {/* A sibling of SetupDetail, never inside it: the
                          expansion candidate is a separate setup type and
                          must not read as another line on the reversal
                          checklist. Placed FIRST because the reversal
                          checklist below is long — a panel underneath it
                          is reached only by scrolling past everything
                          else, which buries the thing the row's badge just
                          advertised. */}
                      <ExpansionCandidatePanel
                        expansion={expansion}
                        monitor={expansionMonitorBySymbol?.[s.ticker]}
                        entryStatus={entry}
                      />
                      {activeView === "setups" && detail && (
                        <SetupDetail
                          result={detail}
                          exchange={s.exchange}
                          timeframe={timeframe}
                          onTimeframeChange={(tf) =>
                            setTimeframes((prev) => ({ ...prev, [s.ticker]: tf }))
                          }
                          embedded
                          scoreThreshold={scoreThreshold}
                          score5m={s.score5m}
                          score15m={s.score15m}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          </div>
        </details>
      )}
    </section>
  );
}
