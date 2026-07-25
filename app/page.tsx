"use client";

import { useCallback, useEffect, useState } from "react";
import { Watchlist } from "@/components/dashboard/Watchlist";
import { SetupDetail } from "@/components/dashboard/SetupDetail";
import { AccountSummary } from "@/components/dashboard/AccountSummary";
import { AccountabilityPanel } from "@/components/dashboard/AccountabilityPanel";
import Link from "next/link";
import type { WatchlistSymbol, AccountSummary as AccountSummaryType, AccountabilityChecks } from "@/types/watchlist";
import type { SetupResult } from "@/types/setup";
import type { AlertEvent } from "@/lib/alerts/types";
import type { RiskSettings, DailyTradingStatus } from "@/types/risk";

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
}

function toAccountSummary(risk: RiskApiResponse): AccountSummaryType {
  let accountabilityStatus: AccountSummaryType["accountabilityStatus"] = "on_track";
  if (risk.checks.dailyGoalReached) accountabilityStatus = "target_hit";
  else if (risk.checks.dailyLossLimitReached) accountabilityStatus = "over_limit";
  else if (risk.checks.tradesRemaining === 0) accountabilityStatus = "at_limit";

  return {
    tradingDate: risk.status.tradeDate,
    dailyTradeLimit: risk.settings.maxTradesPerDay,
    tradesTakenToday: risk.status.tradesTaken,
    dailyRealizedPnl: risk.status.realizedPnl,
    dailyMaxLoss: -risk.settings.maxLossPerDay,
    accountabilityStatus,
  };
}

export default function DashboardPage() {
  const [selected, setSelected] = useState<string | null>("NVDA");
  const [timeframe, setTimeframe] = useState<"5m" | "15m">("5m");
  const [data, setData] = useState<ScanApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [risk, setRisk] = useState<RiskApiResponse | null>(null);

  const selectedResult = selected ? data?.resultsBySymbol[selected]?.[timeframe] ?? null : null;

  const fetchRisk = useCallback(() => {
    const scoreParam = selectedResult ? `?selectedScore=${selectedResult.score}` : "";
    fetch(`/api/risk/status${scoreParam}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json) setRisk(json);
      })
      .catch(() => {
        // Non-fatal — the dashboard still works without the risk panel.
      });
  }, [selectedResult]);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/scan")
      .then((res) => {
        if (!res.ok) throw new Error(`Scan request failed: ${res.status}`);
        return res.json();
      })
      .then((json: ScanApiResponse) => {
        if (!cancelled) setData(json);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    fetchRisk();
  }, [fetchRisk]);

  const watchlist = data?.watchlist ?? [];
  const selectedSymbol = watchlist.find((s) => s.ticker === selected) ?? null;

  return (
    <div className="space-y-6">
      {risk && (
        <div className="space-y-2">
          <AccountSummary summary={toAccountSummary(risk)} />
          <div className="flex justify-end">
            <Link
              href="/journal"
              className="text-xs bg-white/[0.08] hover:bg-white/[0.12] border border-obsidian-border rounded px-3 py-1.5 text-platinum-bright transition-colors"
            >
              Log a trade in your journal →
            </Link>
          </div>
        </div>
      )}

      {error && (
        <div className="panel p-4 border-signal-red/40 text-sm text-signal-red">
          Scan failed: {error}
        </div>
      )}

      {!data && !error && (
        <div className="panel p-6 text-sm text-platinum-dim">Scanning watchlist…</div>
      )}

      {data && (
        <>
          <div className="text-xs text-platinum-dim">
            Data provider: <span className="text-platinum">{data.provider}</span>
            {data.provider === "mock" && " — simulated data, no live keys configured"}
          </div>

          {data.newAlerts.length > 0 && (
            <div className="panel p-4 border-signal-green/30 text-sm space-y-1">
              <div className="text-platinum-bright font-medium">
                {data.newAlerts.length} new alert{data.newAlerts.length > 1 ? "s" : ""}
              </div>
              {data.newAlerts.map((a) => (
                <div key={a.id} className="text-platinum-dim text-xs">
                  {a.message}
                </div>
              ))}
            </div>
          )}

          {data.errors.length > 0 && (
            <div className="panel p-4 border-signal-red/30 text-sm space-y-1">
              <div className="text-platinum-bright font-medium">
                {data.errors.length} symbol{data.errors.length > 1 ? "s" : ""} failed to scan
              </div>
              {data.errors.map((e) => (
                <div key={e.symbol} className="text-platinum-dim text-xs">
                  <span className="font-mono text-signal-red">{e.symbol}</span>: {e.message}
                </div>
              ))}
              <div className="text-platinum-dim text-xs pt-1">
                These symbols are excluded from the watchlist below rather than shown with
                fabricated data — everyone else's real data is unaffected.
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            <div className="lg:col-span-2 space-y-6">
              <Watchlist symbols={watchlist} selected={selected} onSelect={setSelected} />
            </div>
            <div className="space-y-6">
              {risk && <AccountabilityPanel checks={risk.checks} />}
            </div>
          </div>

          <SetupDetail
            result={selectedResult}
            exchange={selectedSymbol?.exchange ?? "NASDAQ"}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
          />
        </>
      )}
    </div>
  );
}
