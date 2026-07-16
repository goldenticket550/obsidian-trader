"use client";

import { useEffect, useState } from "react";
import type { WatchedSymbol } from "@/lib/scanner/scanService";
import type { StrategyConfig } from "@/lib/strategies/config";
import type { RiskSettings } from "@/types/risk";
import type { SessionType } from "@/lib/market-data/types";

export default function SettingsPage() {
  const [symbols, setSymbols] = useState<WatchedSymbol[] | null>(null);
  const [newSymbol, setNewSymbol] = useState("");
  const [newExchange, setNewExchange] = useState("NASDAQ");
  const [watchlistError, setWatchlistError] = useState<string | null>(null);

  const [config, setConfig] = useState<StrategyConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  const [risk, setRisk] = useState<RiskSettings | null>(null);
  const [riskError, setRiskError] = useState<string | null>(null);
  const [riskSaveStatus, setRiskSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    fetch("/api/watchlist")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load watchlist: ${res.status}`);
        return res.json();
      })
      .then((json) => setSymbols(json.symbols))
      .catch((err) => setWatchlistError(err.message));

    fetch("/api/settings/config")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load config: ${res.status}`);
        return res.json();
      })
      .then((json) => setConfig(json.config))
      .catch((err) => setConfigError(err.message));

    fetch("/api/risk/settings")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load risk settings: ${res.status}`);
        return res.json();
      })
      .then((json) => setRisk(json.settings))
      .catch((err) => setRiskError(err.message));
  }, []);

  async function handleAddSymbol(e: React.FormEvent) {
    e.preventDefault();
    if (!newSymbol.trim()) return;

    const res = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: newSymbol, exchange: newExchange }),
    });
    const json = await res.json();
    if (!res.ok) {
      setWatchlistError(json.error ?? "Failed to add symbol");
      return;
    }
    setSymbols(json.symbols);
    setNewSymbol("");
    setWatchlistError(null);
  }

  async function handleRemoveSymbol(symbol: string) {
    const res = await fetch("/api/watchlist", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol }),
    });
    const json = await res.json();
    if (!res.ok) {
      setWatchlistError(json.error ?? "Failed to remove symbol");
      return;
    }
    setSymbols(json.symbols);
  }

  async function handleSaveConfig() {
    if (!config) return;
    setSaveStatus("saving");
    const res = await fetch("/api/settings/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const json = await res.json();
      setConfigError(json.error ?? "Failed to save config");
      setSaveStatus("idle");
      return;
    }
    setSaveStatus("saved");
    setTimeout(() => setSaveStatus("idle"), 2000);
  }

  async function handleSaveRisk() {
    if (!risk) return;
    setRiskSaveStatus("saving");
    const res = await fetch("/api/risk/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(risk),
    });
    if (!res.ok) {
      const json = await res.json();
      setRiskError(json.error ?? "Failed to save risk settings");
      setRiskSaveStatus("idle");
      return;
    }
    setRiskSaveStatus("saved");
    setTimeout(() => setRiskSaveStatus("idle"), 2000);
  }

  function toggleSession(session: SessionType) {
    if (!risk) return;
    const has = risk.allowedSessions.includes(session);
    setRisk({
      ...risk,
      allowedSessions: has
        ? risk.allowedSessions.filter((s) => s !== session)
        : [...risk.allowedSessions, session],
    });
  }

  return (
    <div className="space-y-6">
      <section className="panel p-5">
        <h2 className="text-sm font-display uppercase tracking-wider text-platinum-dim mb-4">
          Watchlist
        </h2>

        {watchlistError && <div className="text-xs text-signal-red mb-3">{watchlistError}</div>}

        {!symbols && !watchlistError && (
          <div className="text-sm text-platinum-dim">Loading…</div>
        )}

        {symbols && (
          <>
            {symbols.length === 0 && (
              <div className="text-sm text-platinum-dim mb-4">
                Your watchlist is empty. Add a symbol below to start scanning it.
              </div>
            )}
            <ul className="divide-y divide-obsidian-border/60 mb-4">
              {symbols.map((s) => (
                <li key={s.symbol} className="py-2.5 flex items-center justify-between text-sm">
                  <span className="font-mono text-platinum-bright">
                    {s.symbol} <span className="text-platinum-dim">· {s.exchange}</span>
                  </span>
                  <button
                    onClick={() => handleRemoveSymbol(s.symbol)}
                    className="text-xs text-signal-red hover:underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>

            <form onSubmit={handleAddSymbol} className="flex gap-2">
              <input
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                placeholder="TICKER"
                className="flex-1 bg-obsidian-charcoal border border-obsidian-border rounded px-3 py-2 text-sm font-mono text-platinum-bright focus:outline-none focus:border-platinum-dim"
              />
              <select
                value={newExchange}
                onChange={(e) => setNewExchange(e.target.value)}
                className="bg-obsidian-charcoal border border-obsidian-border rounded px-3 py-2 text-sm text-platinum-bright focus:outline-none"
              >
                <option value="NASDAQ">NASDAQ</option>
                <option value="NYSE">NYSE</option>
                <option value="AMEX">AMEX</option>
              </select>
              <button
                type="submit"
                className="bg-white/[0.08] hover:bg-white/[0.12] border border-obsidian-border rounded px-4 py-2 text-sm text-platinum-bright transition-colors"
              >
                Add
              </button>
            </form>
          </>
        )}
      </section>

      <section className="panel p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-display uppercase tracking-wider text-platinum-dim">
            Strategy Thresholds
          </h2>
          {config && (
            <button
              onClick={handleSaveConfig}
              disabled={saveStatus === "saving"}
              className="text-xs bg-white/[0.08] hover:bg-white/[0.12] disabled:opacity-50 border border-obsidian-border rounded px-3 py-1.5 text-platinum-bright transition-colors"
            >
              {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved ✓" : "Save"}
            </button>
          )}
        </div>

        <p className="text-xs text-platinum-dim mb-4">
          A focused starter set for now — the full threshold list in{" "}
          <code className="text-platinum">lib/strategies/config.ts</code> covers every stage of
          the setup and remains code-editable; more of it will move here as it proves useful to
          tune live.
        </p>

        {configError && <div className="text-xs text-signal-red mb-3">{configError}</div>}

        {!config && !configError && <div className="text-sm text-platinum-dim">Loading…</div>}

        {config && (
          <div className="space-y-4">
            <NumberField
              label="Minimum decline from open (%)"
              value={config.intradayDecline.minDeclineFromOpenPct * 100}
              onChange={(v) =>
                setConfig({
                  ...config,
                  intradayDecline: { ...config.intradayDecline, minDeclineFromOpenPct: v / 100 },
                })
              }
            />
            <NumberField
              label="Minimum dollar recovery from session low"
              value={config.recoveryFromLow.minDollarRecovery}
              onChange={(v) =>
                setConfig({
                  ...config,
                  recoveryFromLow: { ...config.recoveryFromLow, minDollarRecovery: v },
                })
              }
            />
            <NumberField
              label="Consecutive bullish candles required"
              value={config.consecutiveBullish.minCandles}
              step={1}
              onChange={(v) =>
                setConfig({
                  ...config,
                  consecutiveBullish: { ...config.consecutiveBullish, minCandles: Math.round(v) },
                })
              }
            />
            <NumberField
              label="9 EMA period"
              value={config.emaReclaim.period}
              step={1}
              onChange={(v) =>
                setConfig({
                  ...config,
                  emaReclaim: { ...config.emaReclaim, period: Math.round(v) },
                })
              }
            />
            <NumberField
              label="Daily SMA period"
              value={config.dailySma.period}
              step={1}
              onChange={(v) => setConfig({ ...config, dailySma: { period: Math.round(v) } })}
            />
          </div>
        )}
      </section>

      <section className="panel p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-display uppercase tracking-wider text-platinum-dim">
            Risk &amp; Accountability
          </h2>
          {risk && (
            <button
              onClick={handleSaveRisk}
              disabled={riskSaveStatus === "saving"}
              className="text-xs bg-white/[0.08] hover:bg-white/[0.12] disabled:opacity-50 border border-obsidian-border rounded px-3 py-1.5 text-platinum-bright transition-colors"
            >
              {riskSaveStatus === "saving" ? "Saving…" : riskSaveStatus === "saved" ? "Saved ✓" : "Save"}
            </button>
          )}
        </div>

        <p className="text-xs text-platinum-dim mb-4">
          These drive the accountability panel and trade-limit warnings on the dashboard. The
          app cannot physically block a trade placed through an outside broker — these are
          warnings, not enforcement, exactly per the original design.
        </p>

        {riskError && <div className="text-xs text-signal-red mb-3">{riskError}</div>}
        {!risk && !riskError && <div className="text-sm text-platinum-dim">Loading…</div>}

        {risk && (
          <div className="space-y-4">
            <NumberField
              label="Max trades per day"
              value={risk.maxTradesPerDay}
              step={1}
              onChange={(v) => setRisk({ ...risk, maxTradesPerDay: Math.round(v) })}
            />
            <NumberField
              label="Max loss per day ($)"
              value={risk.maxLossPerDay}
              onChange={(v) => setRisk({ ...risk, maxLossPerDay: v })}
            />
            <NumberField
              label="Daily profit target ($)"
              value={risk.dailyProfitTarget}
              onChange={(v) => setRisk({ ...risk, dailyProfitTarget: v })}
            />
            <NumberField
              label="Max risk per trade ($)"
              value={risk.maxRiskPerTrade}
              onChange={(v) => setRisk({ ...risk, maxRiskPerTrade: v })}
            />
            <NumberField
              label="Minimum setup score to trade"
              value={risk.minSetupScore}
              step={1}
              onChange={(v) => setRisk({ ...risk, minSetupScore: Math.round(v) })}
            />
            <NumberField
              label="Minimum minutes between trades"
              value={risk.minMinutesBetweenTrades}
              step={1}
              onChange={(v) => setRisk({ ...risk, minMinutesBetweenTrades: Math.round(v) })}
            />

            <div className="flex items-center justify-between gap-4">
              <label className="text-sm text-platinum-dim">Allowed trading sessions</label>
              <div className="flex gap-3">
                {(["pre-market", "regular", "after-hours"] as SessionType[]).map((session) => (
                  <label key={session} className="flex items-center gap-1.5 text-xs text-platinum-dim">
                    <input
                      type="checkbox"
                      checked={risk.allowedSessions.includes(session)}
                      onChange={() => toggleSession(session)}
                    />
                    {session}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <label className="text-sm text-platinum-dim">Block trading after target hit</label>
              <input
                type="checkbox"
                checked={risk.blockAfterTarget}
                onChange={(e) => setRisk({ ...risk, blockAfterTarget: e.target.checked })}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm text-platinum-dim">Block trading after loss limit hit</label>
              <input
                type="checkbox"
                checked={risk.blockAfterLossLimit}
                onChange={(e) => setRisk({ ...risk, blockAfterLossLimit: e.target.checked })}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 0.1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <label className="text-sm text-platinum-dim">{label}</label>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-28 bg-obsidian-charcoal border border-obsidian-border rounded px-2 py-1 text-sm text-right font-mono text-platinum-bright focus:outline-none focus:border-platinum-dim"
      />
    </div>
  );
}
