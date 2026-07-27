"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SignalRow } from "@/components/dashboard/SignalRow";
import { AccountRiskPanel } from "@/components/dashboard/AccountRiskPanel";
import { TradingSessionPanel } from "@/components/dashboard/TradingSessionPanel";
import { MarketContextPanel } from "@/components/dashboard/MarketContextPanel";
import { RankedOpportunities } from "@/components/dashboard/RankedOpportunities";
import { ActionQueue } from "@/components/dashboard/ActionQueue";
import type { WatchlistSymbol, AccountabilityChecks } from "@/types/watchlist";
import type { SetupResult } from "@/types/setup";
import type { DataQuality } from "@/types/candle";
import type { SessionInfo } from "@/lib/market-data/types";
import type { MarketContextQuote } from "@/lib/market-data/marketContext";
import type { AlertEvent } from "@/lib/alerts/types";
import type { RiskSettings, DailyTradingStatus } from "@/types/risk";
import type { SignalWindow } from "@/lib/alerts/signalCounts";
import { dedupeAlerts } from "@/lib/alerts/triage";
import { describeFeed, latestCandleLabel, scannedLabel } from "@/lib/market-data/freshness";

interface ScanApiResponse {
  provider: string;
  watchlist: WatchlistSymbol[];
  resultsBySymbol: Record<string, { "5m": SetupResult; "15m": SetupResult }>;
  newAlerts: AlertEvent[];
  errors: { symbol: string; message: string }[];
}

interface RiskApiResponse {
  settings: RiskSettings;
  status: DailyTradingStatus;
  checks: AccountabilityChecks;
  session?: SessionInfo;
}

/** Fallback only for the stage-progression threshold before risk settings
 * load. Mirrors defaultRiskSettings.minSetupScore; not a displayed value. */
const FALLBACK_SCORE_THRESHOLD = 6;

export default function DashboardPage() {
  const [scan, setScan] = useState<ScanApiResponse | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [risk, setRisk] = useState<RiskApiResponse | null>(null);
  const [alerts, setAlerts] = useState<AlertEvent[] | null>(null);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [context, setContext] = useState<MarketContextQuote[] | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [signalWindow, setSignalWindow] = useState<SignalWindow>("recent");

  const topScore = useMemo(() => {
    if (!scan) return null;
    const scores = scan.watchlist.map((s) => Math.max(s.score5m, s.score15m));
    return scores.length > 0 ? Math.max(...scores) : null;
  }, [scan]);

  const dataQuality: DataQuality | null = useMemo(() => {
    if (!scan) return null;
    return Object.values(scan.resultsBySymbol)[0]?.["5m"]?.quality ?? null;
  }, [scan]);

  /** Scan time comes from the results themselves, not the browser clock —
   * refreshing the page must never look like a newer scan. */
  const scanTime = useMemo(() => {
    if (!scan) return null;
    return Object.values(scan.resultsBySymbol)[0]?.["5m"]?.lastUpdated ?? null;
  }, [scan]);

  /** Newest candle across every scanned symbol — the true edge of the
   * market data, which is a different question from feed capability. */
  const newestCandleTime = useMemo(() => {
    if (!scan) return null;
    const times = Object.values(scan.resultsBySymbol)
      .map((r) => r["5m"]?.latestCandleTime)
      .filter((t): t is string => !!t);
    if (times.length === 0) return null;
    return times.reduce((a, b) => (new Date(a) > new Date(b) ? a : b));
  }, [scan]);

  /** Freshly-fired events merged with persisted history, deduped by id. */
  const allAlerts = useMemo(
    () => dedupeAlerts([...(scan?.newAlerts ?? []), ...(alerts ?? [])]),
    [scan, alerts]
  );

  const fetchRisk = useCallback(() => {
    const scoreParam = topScore !== null ? `?selectedScore=${topScore.toFixed(2)}` : "";
    fetch(`/api/risk/status${scoreParam}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json) setRisk(json);
      })
      .catch(() => {
        // Non-fatal: the rest of the dashboard still works without it.
      });
  }, [topScore]);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/scan")
      .then((res) => {
        if (!res.ok) throw new Error(`Scan request failed: ${res.status}`);
        return res.json();
      })
      .then((json: ScanApiResponse) => {
        if (!cancelled) setScan(json);
      })
      .catch((err) => {
        if (!cancelled) setScanError(err instanceof Error ? err.message : "Unknown error");
      });

    fetch("/api/alerts")
      .then((res) => {
        if (!res.ok) throw new Error(`Alerts request failed: ${res.status}`);
        return res.json();
      })
      .then((json: { events: AlertEvent[] }) => {
        if (!cancelled) setAlerts(json.events ?? []);
      })
      .catch((err) => {
        if (!cancelled) setAlertsError(err instanceof Error ? err.message : "Unknown error");
      });

    fetch("/api/market-context")
      .then((res) => {
        if (!res.ok) throw new Error(`Market context failed: ${res.status}`);
        return res.json();
      })
      .then((json: { quotes: MarketContextQuote[] }) => {
        if (!cancelled) setContext(json.quotes ?? []);
      })
      .catch((err) => {
        if (!cancelled) setContextError(err instanceof Error ? err.message : "Unknown error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    fetchRisk();
  }, [fetchRisk]);

  const scoreThreshold = risk?.settings.minSetupScore ?? FALLBACK_SCORE_THRESHOLD;

  // Badge reflects how old the DATA is, not what the feed is capable of.
  const feed = describeFeed(dataQuality, newestCandleTime, Date.now());

  return (
    <div className="space-y-3">
      {/* Status group. No "Real-time data" badge: the dot reports PROVIDER
          CONNECTIVITY, and scan time / candle time are shown as separate
          labelled values so neither can be mistaken for the other. Green
          is reserved for a genuinely current candle. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] uppercase tracking-[0.1em] px-3 py-1.5 rounded"
          style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
        >
          <span className="flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: scan
                  ? feed.staleness === "current"
                    ? "var(--green)"
                    : "var(--amber)"
                  : "var(--text-muted)",
              }}
              aria-hidden="true"
            />
            <span style={{ color: "var(--text-secondary)" }}>
              {scan ? scan.provider : "Connecting"}
            </span>
          </span>

          {scanTime && (
            <>
              <span aria-hidden="true" style={{ color: "var(--border)" }}>
                ·
              </span>
              <span style={{ color: "var(--text-muted)" }}>
                {scannedLabel(scanTime).replace("Scanned ", "Scanned ")}
              </span>
            </>
          )}

          {newestCandleTime && (
            <>
              <span aria-hidden="true" style={{ color: "var(--border)" }}>
                ·
              </span>
              <span
                style={{
                  color: feed.staleness === "current" ? "var(--text-secondary)" : "var(--amber)",
                }}
              >
                {latestCandleLabel(newestCandleTime)}
              </span>
            </>
          )}

          {risk?.session && (
            <>
              <span aria-hidden="true" style={{ color: "var(--border)" }}>
                ·
              </span>
              <span style={{ color: "var(--text-muted)" }}>
                {risk.session.session.replace(/-/g, " ")}
              </span>
            </>
          )}
        </div>

        <Link href="/journal" className="btn-secondary">
          Log a trade →
        </Link>
      </div>

      <SignalRow
        events={allAlerts}
        window={signalWindow}
        onWindowChange={setSignalWindow}
        loading={alerts === null && !alertsError}
      />

      {scanError && (
        <div className="command-panel p-4 border-signal-red/40 text-sm text-signal-red">
          Scan failed: {scanError}
        </div>
      )}

      {scan && scan.errors.length > 0 && (
        <div className="command-panel p-4 border-signal-red/30 text-sm space-y-1">
          <div className="text-platinum-bright font-medium">
            {scan.errors.length} symbol{scan.errors.length > 1 ? "s" : ""} failed to scan
          </div>
          {scan.errors.map((e) => (
            <div key={e.symbol} className="text-platinum-dim text-xs">
              <span className="font-mono text-signal-red">{e.symbol}</span>: {e.message}
            </div>
          ))}
          <div className="text-platinum-dim text-xs pt-1">
            Excluded from the list below rather than shown with fabricated data.
          </div>
        </div>
      )}

      {/* Left compact, centre dominant, queue readable but not dominant.
          All three columns start at the same vertical position. */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(230px,0.78fr)_minmax(620px,2.65fr)_minmax(300px,1fr)] gap-3 items-start">
        <div className="space-y-3">
          <AccountRiskPanel
            settings={risk?.settings ?? null}
            status={risk?.status ?? null}
            checks={risk?.checks ?? null}
          />
          <TradingSessionPanel
            session={risk?.session ?? null}
            settings={risk?.settings ?? null}
          />
          <MarketContextPanel
            quotes={context}
            loading={context === null && !contextError}
            error={contextError}
          />
        </div>

        <div className="min-w-0">
          <RankedOpportunities
            symbols={scan?.watchlist ?? []}
            resultsBySymbol={scan?.resultsBySymbol ?? {}}
            loading={scan === null && !scanError}
            scoreThreshold={scoreThreshold}
          />
        </div>

        <div className="min-w-0">
          <ActionQueue
            alerts={allAlerts}
            resultsBySymbol={scan?.resultsBySymbol ?? {}}
            loading={alerts === null && !alertsError}
            error={alertsError}
          />
        </div>
      </div>
    </div>
  );
}
