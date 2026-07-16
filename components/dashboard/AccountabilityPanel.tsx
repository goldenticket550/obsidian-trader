"use client";

import { useState } from "react";
import type { AccountabilityChecks } from "@/types/watchlist";

export function AccountabilityPanel({ checks }: { checks: AccountabilityChecks }) {
  const [reminder, setReminder] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGetReminder() {
    setLoading(true);
    setError(null);
    setReminder(null);

    const res = await fetch("/api/ai/accountability-reminder");
    const json = await res.json();

    if (!res.ok) {
      setError(json.error ?? "Failed to generate reminder");
      setLoading(false);
      return;
    }

    setReminder(json.reminder);
    setLoading(false);
  }

  const messages: { text: string; tone: "ok" | "warn" }[] = [
    {
      text: `${checks.tradesRemaining} trade${checks.tradesRemaining === 1 ? "" : "s"} remaining today.`,
      tone: checks.tradesRemaining > 0 ? "ok" : "warn",
    },
    {
      text: `Max allowed risk per trade: $${checks.maxAllowedRisk.toFixed(2)}.`,
      tone: "ok",
    },
    {
      text: checks.dailyGoalReached
        ? "Your daily target has been reached. Protect the day."
        : "Daily target not yet reached.",
      tone: checks.dailyGoalReached ? "warn" : "ok",
    },
    {
      text: checks.dailyLossLimitReached
        ? "Your daily loss limit has been reached."
        : "Daily loss limit not reached.",
      tone: checks.dailyLossLimitReached ? "warn" : "ok",
    },
    {
      text: checks.attemptingLowScoringSetup
        ? "This setup does not meet your minimum score."
        : "No low-scoring setup attempts detected.",
      tone: checks.attemptingLowScoringSetup ? "warn" : "ok",
    },
    {
      text: checks.tradingTooCloseTogether
        ? "You are taking trades too close together."
        : "Trade spacing looks fine.",
      tone: checks.tradingTooCloseTogether ? "warn" : "ok",
    },
    {
      text: checks.outsideAllowedSession
        ? "You are outside your allowed trading session."
        : "Within your allowed trading session.",
      tone: checks.outsideAllowedSession ? "warn" : "ok",
    },
    {
      text: checks.blockedFromTrading
        ? "This is outside your plan — trading is blocked for the rest of today."
        : "No blocking conditions active.",
      tone: checks.blockedFromTrading ? "warn" : "ok",
    },
  ];

  return (
    <section className="panel p-5">
      <h2 className="text-sm font-display uppercase tracking-wider text-platinum-dim mb-4">
        Accountability
      </h2>
      <ul className="space-y-2.5">
        {messages.map((m, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm">
            <span
              className={`inline-block h-2 w-2 rounded-full mt-1.5 shrink-0 ${
                m.tone === "warn" ? "bg-signal-yellow" : "bg-signal-green"
              }`}
            />
            <span className={m.tone === "warn" ? "text-platinum-bright" : "text-platinum-dim"}>
              {m.text}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 pt-4 border-t border-obsidian-border">
        <button
          onClick={handleGetReminder}
          disabled={loading}
          className="text-xs bg-white/[0.08] hover:bg-white/[0.12] disabled:opacity-50 border border-obsidian-border rounded px-3 py-1.5 text-platinum-bright transition-colors"
        >
          {loading ? "Thinking…" : "Get a reminder (AI)"}
        </button>
        {error && <div className="text-xs text-signal-red mt-2">{error}</div>}
        {reminder && (
          <div className="mt-3 text-sm text-platinum-dim leading-relaxed border-l-2 border-obsidian-border pl-3">
            {reminder}
          </div>
        )}
      </div>
    </section>
  );
}
