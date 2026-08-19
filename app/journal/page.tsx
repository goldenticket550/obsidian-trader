"use client";

import { useEffect, useMemo, useState } from "react";
import type { JournalEntry, NewJournalEntry, TradeDirection } from "@/types/journal";
import { mistakeCategories, emotionalStates } from "@/lib/journal/mistakeCategories";
import { computeJournalStatistics } from "@/lib/journal/statistics";

const emptyForm = (): NewJournalEntry => ({
  tradeDate: new Date().toISOString().slice(0, 10),
  entryTime: new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16),
  symbol: "",
  direction: "long" as TradeDirection,
  entryPrice: 0,
  exitPrice: null,
  positionSize: 0,
  stopLoss: null,
  profitLoss: 0,
  setupScoreAtEntry: null,
  conditionsPassed: [],
  conditionsMissing: [],
  screenshotUrl: null,
  notes: null,
  emotionalState: null,
  followedPlan: true,
  mistakeCategory: null,
  lessonLearned: null,
  tags: [],
});

export default function JournalPage() {
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<NewJournalEntry>(emptyForm());
  const [conditionsPassedText, setConditionsPassedText] = useState("");
  const [conditionsMissingText, setConditionsMissingText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [patterns, setPatterns] = useState<{ available: boolean; analysis?: string; message?: string } | null>(
    null
  );
  const [patternsLoading, setPatternsLoading] = useState(false);
  const [patternsError, setPatternsError] = useState<string | null>(null);

  const stats = useMemo(() => computeJournalStatistics(entries ?? []), [entries]);

  function refresh() {
    fetch("/api/journal")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load journal: ${res.status}`);
        return res.json();
      })
      .then((json) => setEntries(json.entries))
      .catch((err) => setError(err instanceof Error ? err.message : "Unknown error"));
  }

  useEffect(refresh, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const payload: NewJournalEntry = {
      ...form,
      entryTime: form.entryTime ? new Date(form.entryTime).toISOString() : null,
      symbol: form.symbol.toUpperCase(),
      conditionsPassed: conditionsPassedText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      conditionsMissing: conditionsMissingText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };

    const res = await fetch("/api/journal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const json = await res.json();
      setError(json.error ?? "Failed to save entry");
      setSubmitting(false);
      return;
    }

    setForm(emptyForm());
    setConditionsPassedText("");
    setConditionsMissingText("");
    setSubmitting(false);
    refresh();
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/journal/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json();
      setError(json.error ?? "Failed to delete entry");
      return;
    }
    refresh();
  }

  async function handleGenerateSummary() {
    setSummaryLoading(true);
    setSummaryError(null);
    setSummary(null);

    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch("/api/ai/journal-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: today }),
    });
    const json = await res.json();

    if (!res.ok) {
      setSummaryError(json.error ?? "Failed to generate summary");
      setSummaryLoading(false);
      return;
    }

    setSummary(json.summary);
    setSummaryLoading(false);
  }

  async function handleAnalyzePatterns() {
    setPatternsLoading(true);
    setPatternsError(null);
    setPatterns(null);

    const res = await fetch("/api/ai/patterns");
    const json = await res.json();

    if (!res.ok) {
      setPatternsError(json.error ?? "Failed to analyze patterns");
      setPatternsLoading(false);
      return;
    }

    setPatterns(json);
    setPatternsLoading(false);
  }

  return (
    <div className="space-y-6">
      <section className="panel p-5">
        <h2 className="text-sm font-display uppercase tracking-wider text-platinum-dim mb-4">
          Statistics
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
          <Stat label="Total Trades" value={String(stats.totalTrades)} />
          <Stat
            label="Win Rate"
            value={`${(stats.winRate * 100).toFixed(0)}%`}
            tone={stats.winRate >= 0.5 ? "green" : "red"}
          />
          <Stat
            label="Total P&L"
            value={`${stats.totalPnl >= 0 ? "+" : ""}$${stats.totalPnl.toFixed(2)}`}
            tone={stats.totalPnl >= 0 ? "green" : "red"}
          />
          <Stat label="Avg P&L / Trade" value={`$${stats.averagePnl.toFixed(2)}`} />
          <Stat
            label="Plan-Following Score"
            value={`${(stats.planFollowingRate * 100).toFixed(0)}%`}
            tone={stats.planFollowingRate >= 0.8 ? "green" : "yellow"}
          />
        </div>
        {Object.keys(stats.mistakeCounts).length > 0 && (
          <div className="mt-4 pt-4 border-t border-obsidian-border">
            <div className="text-xs text-platinum-dim mb-2">Mistake breakdown</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(stats.mistakeCounts).map(([category, count]) => (
                <span
                  key={category}
                  className="text-xs px-2 py-1 rounded bg-white/[0.05] text-platinum-dim"
                >
                  {category} × {count}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-display uppercase tracking-wider text-platinum-dim mb-4">
          AI Insights
        </h2>
        <p className="text-xs text-platinum-dim mb-4">
          These explain and summarize data your journal already contains — they never calculate
          indicators, predict prices, or recommend trades.
        </p>

        <div className="space-y-4">
          <div>
            <button
              onClick={handleGenerateSummary}
              disabled={summaryLoading}
              className="text-xs bg-white/[0.08] hover:bg-white/[0.12] disabled:opacity-50 border border-obsidian-border rounded px-3 py-1.5 text-platinum-bright transition-colors"
            >
              {summaryLoading ? "Thinking…" : "Generate today's summary"}
            </button>
            {summaryError && <div className="text-xs text-signal-red mt-2">{summaryError}</div>}
            {summary && (
              <div className="mt-3 text-sm text-platinum-dim leading-relaxed border-l-2 border-obsidian-border pl-3">
                {summary}
              </div>
            )}
          </div>

          <div>
            <button
              onClick={handleAnalyzePatterns}
              disabled={patternsLoading}
              className="text-xs bg-white/[0.08] hover:bg-white/[0.12] disabled:opacity-50 border border-obsidian-border rounded px-3 py-1.5 text-platinum-bright transition-colors"
            >
              {patternsLoading ? "Thinking…" : "Analyze behavioral patterns"}
            </button>
            {patternsError && <div className="text-xs text-signal-red mt-2">{patternsError}</div>}
            {patterns && !patterns.available && (
              <div className="mt-3 text-sm text-platinum-dim">{patterns.message}</div>
            )}
            {patterns && patterns.available && (
              <div className="mt-3 text-sm text-platinum-dim leading-relaxed border-l-2 border-obsidian-border pl-3 whitespace-pre-line">
                {patterns.analysis}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-display uppercase tracking-wider text-platinum-dim mb-4">
          New Journal Entry
        </h2>
        {error && <div className="text-xs text-signal-red mb-3">{error}</div>}
        <form onSubmit={handleSubmit} className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Date">
            <input
              type="date"
              required
              value={form.tradeDate}
              onChange={(e) => setForm({ ...form, tradeDate: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="Entry Time">
            <input
              type="datetime-local"
              required
              value={form.entryTime ?? ""}
              onChange={(e) => setForm({ ...form, entryTime: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="Ticker">
            <input
              required
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
              className="input font-mono"
              placeholder="NVDA"
            />
          </Field>
          <Field label="Direction">
            <select
              value={form.direction}
              onChange={(e) => setForm({ ...form, direction: e.target.value as TradeDirection })}
              className="input"
            >
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
          </Field>
          <Field label="Entry Price">
            <input
              type="number"
              step="0.01"
              required
              value={form.entryPrice || ""}
              onChange={(e) => setForm({ ...form, entryPrice: Number(e.target.value) })}
              className="input"
            />
          </Field>
          <Field label="Exit Price">
            <input
              type="number"
              step="0.01"
              value={form.exitPrice ?? ""}
              onChange={(e) =>
                setForm({ ...form, exitPrice: e.target.value ? Number(e.target.value) : null })
              }
              className="input"
            />
          </Field>
          <Field label="Position Size">
            <input
              type="number"
              step="1"
              required
              value={form.positionSize || ""}
              onChange={(e) => setForm({ ...form, positionSize: Number(e.target.value) })}
              className="input"
            />
          </Field>
          <Field label="Stop Loss">
            <input
              type="number"
              step="0.01"
              value={form.stopLoss ?? ""}
              onChange={(e) =>
                setForm({ ...form, stopLoss: e.target.value ? Number(e.target.value) : null })
              }
              className="input"
            />
          </Field>
          <Field label="Profit / Loss ($)">
            <input
              type="number"
              step="0.01"
              required
              value={form.profitLoss || ""}
              onChange={(e) => setForm({ ...form, profitLoss: Number(e.target.value) })}
              className="input"
            />
          </Field>
          <Field label="Setup Score at Entry">
            <input
              type="number"
              step="1"
              value={form.setupScoreAtEntry ?? ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  setupScoreAtEntry: e.target.value ? Number(e.target.value) : null,
                })
              }
              className="input"
            />
          </Field>
          <Field label="Emotional State">
            <select
              value={form.emotionalState ?? ""}
              onChange={(e) => setForm({ ...form, emotionalState: e.target.value || null })}
              className="input"
            >
              <option value="">—</option>
              {emotionalStates.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Mistake Category">
            <select
              value={form.mistakeCategory ?? ""}
              onChange={(e) => setForm({ ...form, mistakeCategory: e.target.value || null })}
              className="input"
            >
              <option value="">—</option>
              {mistakeCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Followed Plan">
            <div className="flex items-center h-9">
              <input
                type="checkbox"
                checked={form.followedPlan}
                onChange={(e) => setForm({ ...form, followedPlan: e.target.checked })}
              />
            </div>
          </Field>
          <Field label="Conditions Passed (comma-separated)" span={2}>
            <input
              value={conditionsPassedText}
              onChange={(e) => setConditionsPassedText(e.target.value)}
              className="input"
              placeholder="recovery_from_low, ema_reclaim"
            />
          </Field>
          <Field label="Conditions Missing (comma-separated)" span={2}>
            <input
              value={conditionsMissingText}
              onChange={(e) => setConditionsMissingText(e.target.value)}
              className="input"
              placeholder="structure_shift"
            />
          </Field>
          <Field label="Screenshot URL" span={2}>
            <input
              value={form.screenshotUrl ?? ""}
              onChange={(e) => setForm({ ...form, screenshotUrl: e.target.value || null })}
              className="input"
            />
          </Field>
          <Field label="Notes" span={2}>
            <textarea
              value={form.notes ?? ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value || null })}
              className="input h-9"
              rows={1}
            />
          </Field>
          <Field label="Lesson Learned" span={4}>
            <textarea
              value={form.lessonLearned ?? ""}
              onChange={(e) => setForm({ ...form, lessonLearned: e.target.value || null })}
              className="input"
              rows={2}
            />
          </Field>

          <div className="col-span-2 md:col-span-4 flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="bg-white/[0.08] hover:bg-white/[0.12] disabled:opacity-50 border border-obsidian-border rounded px-4 py-2 text-sm text-platinum-bright transition-colors"
            >
              {submitting ? "Saving…" : "Save Entry"}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="px-5 py-4 border-b border-obsidian-border flex items-center justify-between">
          <h2 className="text-sm font-display uppercase tracking-wider text-platinum-dim">
            Journal History
          </h2>
          {entries && <span className="text-xs text-platinum-dim">{entries.length} entries</span>}
        </div>

        {!entries && !error && <div className="p-5 text-sm text-platinum-dim">Loading…</div>}
        {entries && entries.length === 0 && (
          <div className="p-5 text-sm text-platinum-dim">
            No journal entries yet. Log your first trade above.
          </div>
        )}

        {entries && entries.length > 0 && (
          <ul className="divide-y divide-obsidian-border/60">
            {entries.map((entry) => (
              <li key={entry.id} className="px-5 py-3 flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm text-platinum-bright font-mono">
                    {entry.tradeDate} · {entry.symbol} · {entry.direction}
                    {!entry.followedPlan && (
                      <span className="ml-2 text-[10px] uppercase text-signal-yellow">
                        off-plan
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-platinum-dim mt-0.5">
                    Entry ${entry.entryPrice.toFixed(2)}
                    {entry.exitPrice !== null && ` → Exit $${entry.exitPrice.toFixed(2)}`}
                    {" · "}
                    <span className={entry.profitLoss >= 0 ? "text-signal-green" : "text-signal-red"}>
                      {entry.profitLoss >= 0 ? "+" : ""}${entry.profitLoss.toFixed(2)}
                    </span>
                    {entry.mistakeCategory && ` · ${entry.mistakeCategory}`}
                  </div>
                  {entry.lessonLearned && (
                    <div className="text-xs text-platinum-dim mt-1 italic">
                      &ldquo;{entry.lessonLearned}&rdquo;
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(entry.id)}
                  className="text-xs text-signal-red hover:underline shrink-0"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <style jsx>{`
        .input {
          width: 100%;
          background: rgb(27, 27, 30);
          border: 1px solid rgb(42, 42, 46);
          border-radius: 0.25rem;
          padding: 0.4rem 0.6rem;
          font-size: 0.8rem;
          color: rgb(232, 234, 237);
        }
        .input:focus {
          outline: none;
          border-color: rgb(138, 142, 150);
        }
      `}</style>
    </div>
  );
}

function Field({
  label,
  children,
  span = 1,
}: {
  label: string;
  children: React.ReactNode;
  span?: number;
}) {
  return (
    <div className={span === 2 ? "col-span-2" : span === 4 ? "col-span-2 md:col-span-4" : ""}>
      <label className="block text-[11px] text-platinum-dim mb-1">{label}</label>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "green" | "red" | "yellow";
}) {
  const toneClass =
    tone === "green"
      ? "text-signal-green"
      : tone === "red"
      ? "text-signal-red"
      : tone === "yellow"
      ? "text-signal-yellow"
      : "text-platinum-bright";
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-platinum-dim mb-1">{label}</div>
      <div className={`font-mono text-lg ${toneClass}`}>{value}</div>
    </div>
  );
}
