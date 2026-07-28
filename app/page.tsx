"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { DEFAULT_SIGNAL_WINDOW, filterEventsByWindow, type SignalWindow } from "@/lib/alerts/signalCounts";
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

/** How often the dashboard re-runs its scan in the background, measured from
 * the client. 60s matches the shortest candle timeframe (5m) comfortably
 * without hammering the provider or its cache. */
const AUTO_REFRESH_INTERVAL_MS = 60_000;

export default function DashboardPage() {
  const [scan, setScan] = useState<ScanApiResponse | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [risk, setRisk] = useState<RiskApiResponse | null>(null);
  const [alerts, setAlerts] = useState<AlertEvent[] | null>(null);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [context, setContext] = useState<MarketContextQuote[] | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  // Default to the last 60 minutes so a Monday view isn't dominated by
  // Friday's alerts. "Recent" (the full loaded set) stays user-selectable.
  const [signalWindow, setSignalWindow] = useState<SignalWindow>(DEFAULT_SIGNAL_WINDOW);

  // Synchronous guard: at most one dashboard scan in flight at a time. A ref
  // (not state) so two callbacks in the same tick can't both pass the check.
  const scanInFlightRef = useRef(false);
  // Guards against applying results after unmount (the existing scan used no
  // AbortController, so we gate setState rather than aborting the request).
  const mountedRef = useRef(true);

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

  /** Single `now` and single windowed collection shared by BOTH the headline
   * counts and the action queue, so the selected window can never apply to
   * one but not the other. Recomputed only when the data or window changes. */
  const windowNow = useMemo(() => Date.now(), [allAlerts, signalWindow]);
  const windowedAlerts = useMemo(
    () => filterEventsByWindow(allAlerts, signalWindow, windowNow),
    [allAlerts, signalWindow, windowNow]
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

  /**
   * The single dashboard scan path, shared by the initial load and every
   * background refresh — same three requests, same state setters, so there is
   * no second implementation to drift.
   *
   * `mode` only changes FAILURE handling: the initial load keeps the existing
   * visible error behaviour, while a background failure keeps the last good
   * data on screen and merely logs. Success always applies through the normal
   * setters (so "Scanned {time}" updates and the loading state clears), and we
   * never reset data to null, so a refresh never flashes a loading state.
   *
   * Only stable setters/refs are referenced, so this callback is stable and
   * the scheduling effect below is never recreated by routine data updates.
   */
  const runScan = useCallback(async (mode: "initial" | "background") => {
    // Synchronous overlap guard — two callbacks in the same tick can't both
    // start, and interval/visibility refreshes skip while one is in flight.
    if (scanInFlightRef.current) return;
    scanInFlightRef.current = true;

    const applyIfMounted = (fn: () => void) => {
      if (mountedRef.current) fn();
    };
    const handleError = (
      label: string,
      setError: (message: string | null) => void,
      err: unknown
    ) => {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (mode === "initial") {
        applyIfMounted(() => setError(message));
      } else {
        // Background failure: preserve last-known-good data, don't disrupt the
        // dashboard, don't touch the scan timestamp. Log the message only —
        // never response bodies, tokens, or cookies.
        console.error(`[dashboard] background ${label} refresh failed: ${message}`);
      }
    };

    try {
      await Promise.allSettled([
        (async () => {
          try {
            const res = await fetch("/api/scan");
            if (!res.ok) throw new Error(`Scan request failed: ${res.status}`);
            const json = (await res.json()) as ScanApiResponse;
            applyIfMounted(() => {
              setScan(json);
              setScanError(null);
            });
          } catch (err) {
            handleError("scan", setScanError, err);
          }
        })(),
        (async () => {
          try {
            const res = await fetch("/api/alerts");
            if (!res.ok) throw new Error(`Alerts request failed: ${res.status}`);
            const json = (await res.json()) as { events: AlertEvent[] };
            applyIfMounted(() => {
              setAlerts(json.events ?? []);
              setAlertsError(null);
            });
          } catch (err) {
            handleError("alerts", setAlertsError, err);
          }
        })(),
        (async () => {
          try {
            const res = await fetch("/api/market-context");
            if (!res.ok) throw new Error(`Market context failed: ${res.status}`);
            const json = (await res.json()) as { quotes: MarketContextQuote[] };
            applyIfMounted(() => {
              setContext(json.quotes ?? []);
              setContextError(null);
            });
          } catch (err) {
            handleError("market context", setContextError, err);
          }
        })(),
      ]);
    } finally {
      // Always release the guard — after success, failure, or partial failure.
      scanInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    // Initial load — same path as every refresh. Runs regardless of tab
    // visibility, preserving the pre-existing on-mount fetch behaviour.
    void runScan("initial");

    let intervalId: ReturnType<typeof setInterval> | null = null;
    const startSchedule = () => {
      if (intervalId === null) {
        intervalId = setInterval(() => {
          // Never scan a hidden tab; the schedule is also paused on hide below.
          if (document.visibilityState === "visible") void runScan("background");
        }, AUTO_REFRESH_INTERVAL_MS);
      }
    };
    const stopSchedule = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        // Promptly refresh on resume (the in-flight guard skips it if a scan
        // is already running), then resume the 60s schedule.
        void runScan("background");
        startSchedule();
      } else {
        stopSchedule();
      }
    };

    // Only schedule while visible; a tab opened in the background waits until
    // it is shown. `startSchedule` installs the interval WITHOUT firing an
    // immediate extra scan on top of the initial load.
    if (document.visibilityState === "visible") startSchedule();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      mountedRef.current = false;
      stopSchedule();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [runScan]);

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
        now={windowNow}
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
            alerts={windowedAlerts}
            window={signalWindow}
            resultsBySymbol={scan?.resultsBySymbol ?? {}}
            loading={alerts === null && !alertsError}
            error={alertsError}
          />
        </div>
      </div>
    </div>
  );
}
