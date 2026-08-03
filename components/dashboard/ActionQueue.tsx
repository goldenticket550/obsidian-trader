"use client";

import Link from "next/link";
import type { AlertEvent } from "@/lib/alerts/types";
import type { SetupResult } from "@/types/setup";
import { triageAlerts, type TriageBucket } from "@/lib/alerts/triage";
import type { SignalWindow } from "@/lib/alerts/signalCounts";
import { formatEventTime } from "@/lib/market-data/freshness";
import type { SymbolExpansion } from "@/lib/scanner/scanService";
import type { SymbolExpansionMonitor } from "@/lib/scanner/expansionMonitor";
import { selectPreferredExpansion } from "@/lib/scanner/expansionPresentation";
import { stageLabel } from "@/lib/indicators/premarketExpansionDisplay";
import type { ExpansionStage } from "@/lib/indicators/premarketExpansion";

const BUCKET_ACCENT: Record<TriageBucket, string> = {
  risk_review: "var(--amber)",
  monitor: "var(--blue)",
  informational: "var(--text-muted)",
};

/** Per-type left rule, so a category is recognisable before reading. */
const TYPE_ACCENT: Record<string, string> = {
  setup_invalidated: "var(--red)",
  structure_shift: "var(--violet)",
  ema_reclaim: "var(--blue)",
  liquidity_sweep: "var(--green)",
  score_threshold: "var(--green)",
  fair_value_gap_created: "var(--amber)",
  fair_value_gap_proximity: "var(--amber)",
  recovery_from_low: "var(--text-muted)",
  consecutive_bullish: "var(--text-muted)",
  // Amber reads as "forming, not resolved" and is deliberately NOT the
  // green used by the confirmed tier (score_threshold, liquidity_sweep),
  // so an early heads-up can never be mistaken at a glance for a
  // confirmed setup.
  entered_developing: "var(--amber)",
  reclaim_review_now: "var(--blue)",
};

const TYPE_LABEL: Record<string, string> = {
  setup_invalidated: "Invalidated",
  score_threshold: "Score threshold",
  fair_value_gap_proximity: "FVG entry",
  fair_value_gap_created: "FVG created",
  structure_shift: "Structure shift",
  liquidity_sweep: "Liquidity sweep",
  ema_reclaim: "EMA reclaim",
  recovery_from_low: "Recovery from low",
  consecutive_bullish: "Consecutive bullish",
  // Renders uppercase as "EARLY · DEVELOPING". The leading word is the
  // point: every other badge names what happened, this one leads with
  // the fact that it is a heads-up rather than a confirmation.
  entered_developing: "Early · developing",
  reclaim_review_now: "Reclaim criteria",
};

/** The alert engine appends the market-data time as text; lift it out so
 * it can be shown as its own labelled line rather than inline noise. */
function splitMessage(message: string): { body: string; marketData: string | null } {
  const match = message.match(/\s*\[market data as of ([^\]]+)\]/);
  return {
    body: message.replace(/\s*\[market data as of [^\]]+\]/, ""),
    marketData: match ? match[1] : null,
  };
}

interface ExpansionQueueItem {
  symbol: string;
  direction: "bullish" | "bearish";
  stage: ExpansionStage;
  bucket: TriageBucket;
  timeframe: "1m" | "5m";
  message: string;
  marketDataTime: string | null;
}

export function expansionQueueItems(
  expansionBySymbol?: Record<string, SymbolExpansion>,
  monitorBySymbol?: Record<string, SymbolExpansionMonitor>
): ExpansionQueueItem[] {
  if (!expansionBySymbol) return [];
  return Object.entries(expansionBySymbol).flatMap(([symbol, expansion]) => {
    const monitor = monitorBySymbol?.[symbol];
    const selected = selectPreferredExpansion(expansion, monitor);
    const stage = selected.stage;
    let bucket: TriageBucket | null = null;
    if (["breakout_accepted", "expansion_active", "invalidated"].includes(stage)) {
      bucket = "risk_review";
    } else if (["opening_drive", "level_break"].includes(stage)) {
      bucket = "monitor";
    } else if (["context_developing", "premarket_candidate"].includes(stage)) {
      bucket = "informational";
    }
    if (bucket === null) return [];
    const latestBar = monitor?.oneMinute.evaluationBarTime;
    return [{
      symbol,
      direction: selected.result.direction,
      stage,
      bucket,
      timeframe: ["opening_drive", "expansion_active"].includes(stage) ? "1m" : "5m",
      message: selected.result.contextLabel,
      marketDataTime:
        latestBar !== null && latestBar !== undefined
          ? new Date(latestBar * 1000).toISOString()
          : selected.result.freshness.latestCompletedBarAt,
    }];
  });
}

export function ActionQueue({
  alerts,
  window,
  resultsBySymbol,
  loading,
  error,
  onWindowChange,
  expansionBySymbol,
  expansionMonitorBySymbol,
}: {
  /** Already filtered to the selected window by the dashboard — the same
   * collection the headline counts are computed from. */
  alerts: AlertEvent[];
  window: SignalWindow;
  resultsBySymbol: Record<string, { "5m": SetupResult; "15m": SetupResult }>;
  loading: boolean;
  error: string | null;
  onWindowChange?: (window: SignalWindow) => void;
  expansionBySymbol?: Record<string, SymbolExpansion>;
  expansionMonitorBySymbol?: Record<string, SymbolExpansionMonitor>;
}) {
  const groups = triageAlerts(alerts);
  const expansionItems = expansionQueueItems(expansionBySymbol, expansionMonitorBySymbol);
  const isEmpty = alerts.length === 0 && expansionItems.length === 0;

  // Honest calm state for an empty window — never backfilled with older
  // events. The 60-minute copy is explicit about the window it reflects.
  const emptyCopy =
    window === "last_60m"
      ? "No alerts recorded in the last 60 minutes."
      : "No recent alerts recorded.";

  return (
    <section className="command-panel flex flex-col" aria-label="Action queue">
      <div
        className="px-4 py-2.5 flex items-center justify-between shrink-0"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <h2 className="card-heading">Action queue</h2>
        <span className="flex items-center gap-2">
          {onWindowChange && (
            <span className="inline-flex rounded" role="group" aria-label="Alert time window">
              {(["last_60m", "recent"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={window === value}
                  onClick={() => onWindowChange(value)}
                  className="px-1.5 py-0.5 text-[8px] uppercase tracking-wide focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-champagne"
                  style={{ color: window === value ? "var(--amber)" : "var(--text-muted)" }}
                >
                  {value === "last_60m" ? "60m" : "Recent"}
                </button>
              ))}
            </span>
          )}
          <Link
            href="/alerts"
            className="text-[10px] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-champagne rounded"
            style={{ color: "var(--text-muted)" }}
          >
            History →
          </Link>
        </span>
      </div>

      {loading && (
        <p className="px-4 py-5 text-[12px]" style={{ color: "var(--text-muted)" }}>
          Loading alerts…
        </p>
      )}

      {error && !loading && (
        <p className="px-4 py-5 text-[12px]" style={{ color: "var(--red)" }}>
          Unavailable — {error}
        </p>
      )}

      {/* Own scroll region on xl only, where the queue is a fixed side
          column and its length would otherwise set page height. Below xl
          it participates in normal page flow — a nested scroll box inside
          an already-scrolling phone page is worse than a long list. */}
      {!loading && !error && isEmpty && (
        <p className="px-4 py-5 text-[12px]" style={{ color: "var(--text-muted)" }}>
          {emptyCopy}
        </p>
      )}

      {!loading && !error && !isEmpty && (
        <div
          className="xl:overflow-y-auto xl:max-h-[calc(100vh-190px)] focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-champagne"
          tabIndex={0}
          role="region"
          aria-label="Alert events"
        >
          {groups.map((group) => (
            <div key={group.bucket} style={{ borderBottom: "1px solid var(--border-soft)" }}>
              <div
                className="px-4 pt-2.5 pb-1.5 text-[10px] uppercase tracking-[0.12em] sticky top-0 backdrop-blur"
                style={{ color: BUCKET_ACCENT[group.bucket], background: "rgba(15,23,28,0.92)" }}
              >
                {group.bucket === "risk_review" ? "Review now" : group.label} ·{" "}
                {group.events.length +
                  expansionItems.filter((item) => item.bucket === group.bucket).length}
              </div>

              {group.events.length === 0 &&
                expansionItems.filter((item) => item.bucket === group.bucket).length === 0 && (
                <p className="px-4 pb-2.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {group.emptyCopy}
                </p>
              )}

              <ul className="pb-1.5">
                {expansionItems
                  .filter((item) => item.bucket === group.bucket)
                  .map((item) => {
                    const tone =
                      item.stage === "invalidated"
                        ? "var(--red)"
                        : ["context_developing", "premarket_candidate"].includes(item.stage)
                        ? "var(--blue)"
                        : item.stage === "opening_drive"
                        ? "var(--amber)"
                        : item.direction === "bullish"
                        ? "var(--green)"
                        : "var(--red)";
                    return (
                      <li
                        key={`expansion-${item.symbol}-${item.direction}-${item.stage}`}
                        data-testid="expansion-queue-item"
                        className="mx-3 mb-1.5 pl-2.5 pr-2 py-1.5 rounded-r"
                        style={{ borderLeft: `2px solid ${tone}`, background: "var(--panel-raised)" }}
                      >
                        <div className="flex items-baseline gap-1.5">
                          <span className="font-mono text-[12px]" style={{ color: "var(--text)" }}>
                            {item.symbol}
                          </span>
                          <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>
                            {item.timeframe}
                          </span>
                          <span className="text-[9px] uppercase tracking-wide" style={{ color: tone }}>
                            {stageLabel(item.stage)}
                          </span>
                        </div>
                        <p
                          className="mt-0.5 line-clamp-2 text-[11px] leading-snug"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {item.message}
                        </p>
                        {item.marketDataTime && (
                          <p className="mt-0.5 text-[9px]" style={{ color: "var(--text-muted)" }}>
                            Latest candle {formatEventTime(item.marketDataTime)}
                          </p>
                        )}
                      </li>
                    );
                  })}
                {group.events.map((event) => {
                  const { body, marketData } = splitMessage(event.message);
                  const result =
                    resultsBySymbol[event.symbol]?.[event.timeframe === "15m" ? "15m" : "5m"];
                  const candleTime = result?.latestCandleTime;
                  const isInvalidation = event.type === "setup_invalidated";

                  return (
                    <li
                      key={event.id}
                      className="mx-3 mb-1.5 pl-2.5 pr-2 py-1.5 rounded-r"
                      style={{
                        borderLeft: `2px solid ${TYPE_ACCENT[event.type] ?? "var(--border)"}`,
                        background: isInvalidation
                          ? "rgba(224, 82, 82, 0.07)"
                          : "var(--panel-raised)",
                      }}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 flex items-baseline gap-1.5">
                          <span
                            className="font-mono text-[12px]"
                            style={{ color: "var(--text)" }}
                          >
                            {event.symbol}
                          </span>
                          <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>
                            {event.timeframe}
                          </span>
                          <span
                            className="text-[9px] uppercase tracking-wide truncate"
                            style={{ color: TYPE_ACCENT[event.type] ?? "var(--text-muted)" }}
                          >
                            {TYPE_LABEL[event.type] ?? event.type}
                          </span>
                        </span>
                        {/* Dated once the event is not from today — a bare
                            "8:31 PM ET" seen at 9:14 AM described a
                            previous day with nothing to say so. */}
                        <span
                          className="text-[9px] font-mono tabular shrink-0"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {formatEventTime(event.firedAt)}
                        </span>
                      </div>

                      {/* Clamped to two lines, but `title` keeps the full
                          message reachable — a truncated alert must never
                          be the only copy of what happened. */}
                      <p
                        className="text-[11px] mt-0.5 leading-snug line-clamp-2"
                        title={body}
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {body}
                      </p>

                      {(marketData || candleTime) && (
                        <p className="text-[9px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                          {/* The fallback is the raw ISO string lifted out
                              of the stored message — format it rather than
                              dumping 2026-07-24T20:55:00.000Z on screen. */}
                          Latest candle {formatEventTime(candleTime ?? marketData!)}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
