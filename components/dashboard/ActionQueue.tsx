"use client";

import Link from "next/link";
import type { AlertEvent } from "@/lib/alerts/types";
import type { SetupResult } from "@/types/setup";
import { triageAlerts, type TriageBucket } from "@/lib/alerts/triage";
import type { SignalWindow } from "@/lib/alerts/signalCounts";
import { formatEventTime } from "@/lib/market-data/freshness";

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

export function ActionQueue({
  alerts,
  window,
  resultsBySymbol,
  loading,
  error,
}: {
  /** Already filtered to the selected window by the dashboard — the same
   * collection the headline counts are computed from. */
  alerts: AlertEvent[];
  window: SignalWindow;
  resultsBySymbol: Record<string, { "5m": SetupResult; "15m": SetupResult }>;
  loading: boolean;
  error: string | null;
}) {
  const groups = triageAlerts(alerts);
  const isEmpty = alerts.length === 0;

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
        <Link
          href="/alerts"
          className="text-[10px] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-champagne rounded"
          style={{ color: "var(--text-muted)" }}
        >
          Alert history →
        </Link>
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
                {group.label} · {group.events.length}
              </div>

              {group.events.length === 0 && (
                <p className="px-4 pb-2.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {group.emptyCopy}
                </p>
              )}

              <ul className="pb-1.5">
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
