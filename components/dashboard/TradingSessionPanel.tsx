"use client";

import { useEffect, useState } from "react";
import type { SessionInfo } from "@/lib/market-data/types";
import type { RiskSettings } from "@/types/risk";
import { formatEasternTime } from "@/lib/market-data/freshness";

/**
 * "Scheduled" is load-bearing. computeSessionInfo() derives the session
 * from ordinary weekday hours only — it has no holiday calendar (see the
 * documented limitation in lib/market-data/session.ts). On Thanksgiving
 * this would otherwise assert "Regular session" while the market is shut.
 */
const SESSION_LABEL: Record<string, string> = {
  "pre-market": "Scheduled pre-market",
  regular: "Scheduled regular session",
  "after-hours": "Scheduled after hours",
  closed: "Market closed",
};

const SESSION_SHORT: Record<string, string> = {
  "pre-market": "Pre-market",
  regular: "Regular",
  "after-hours": "After hours",
  closed: "Closed",
};

const SESSION_COLOR: Record<string, string> = {
  "pre-market": "var(--amber)",
  regular: "var(--green)",
  "after-hours": "var(--amber)",
  closed: "var(--text-muted)",
};

export function TradingSessionPanel({
  session,
  settings,
}: {
  session: SessionInfo | null;
  settings: RiskSettings | null;
}) {
  // Wall clock only — this says nothing about market-data freshness,
  // which is reported separately and per-symbol.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const outsideAllowed =
    settings && session && !settings.allowedSessions.includes(session.session as never);

  return (
    <section className="panel px-4 py-3" aria-label="Trading session">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="card-heading">Trading session</h2>
        <details className="relative">
          <summary
            className="list-none cursor-help inline-flex items-center justify-center h-3.5 w-3.5 rounded-full text-[9px] focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-champagne"
            style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
            aria-label="Session limitations"
            title="Session limitations"
          >
            i
          </summary>
          <p
            className="mt-2 text-[10px] leading-relaxed panel-raised p-2 rounded"
            style={{ color: "var(--text-muted)" }}
          >
            Derived from regular weekday hours. No holiday calendar — on a market holiday this
            shows the scheduled session, not an open exchange.
          </p>
        </details>
      </div>

      {!session ? (
        <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          Unavailable
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span
              className="h-1.5 w-1.5 rounded-full shrink-0"
              style={{ background: SESSION_COLOR[session.session] ?? "var(--text-muted)" }}
              aria-hidden="true"
            />
            <span
              className="text-[14px] font-display leading-tight"
              style={{ color: SESSION_COLOR[session.session] ?? "var(--text-secondary)" }}
            >
              {SESSION_LABEL[session.session] ?? session.session}
            </span>
          </div>

          <div
            className="mt-2 pt-1.5 space-y-[3px]"
            style={{ borderTop: "1px solid var(--border-soft)" }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Current time
              </span>
              <span
                className="font-mono tabular text-[12px]"
                style={{ color: "var(--text-secondary)" }}
              >
                {now ? formatEasternTime(now.toISOString()) : "—"}
              </span>
            </div>
            {settings && settings.allowedSessions.length > 0 && (
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  You allow
                </span>
                <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                  {settings.allowedSessions.map((s) => SESSION_SHORT[s] ?? s).join(", ")}
                </span>
              </div>
            )}
          </div>

          {outsideAllowed && (
            <p className="mt-2 text-[10px] leading-snug" style={{ color: "var(--amber)" }}>
              Outside the sessions you allow yourself to trade.
            </p>
          )}
        </>
      )}
    </section>
  );
}
