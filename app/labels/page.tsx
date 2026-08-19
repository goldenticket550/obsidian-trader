"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LabelCandidate } from "@/lib/replay/labelAssistant";
import type { LabelReview } from "@/lib/replay/labelStore";
import { IntradayCandidateChart } from "@/components/labels/IntradayCandidateChart";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function Sparkline({ candidate }: { candidate: LabelCandidate }) {
  const { prices, volumes } = candidate.sparkline;
  if (prices.length < 2) return <div className="h-14 text-xs text-platinum-dim">Chart unavailable</div>;
  const low = Math.min(...prices);
  const span = Math.max(0.0001, Math.max(...prices) - low);
  const maxVolume = Math.max(1, ...volumes);
  const points = prices.map((price, index) => `${(index / (prices.length - 1)) * 180},${4 + (1 - (price - low) / span) * 34}`).join(" ");
  return (
    <svg viewBox="0 0 180 56" className="h-14 w-44" role="img" aria-label={`${candidate.symbol} price and volume sparkline`}>
      {volumes.map((volume, index) => {
        const height = (volume / maxVolume) * 12;
        return <rect key={index} x={(index / volumes.length) * 180} y={56 - height} width={Math.max(1, 180 / volumes.length - 1)} height={height} fill="rgba(214,166,63,.28)" />;
      })}
      <polyline points={points} fill="none" stroke={candidate.direction === "bullish" ? "#45c58a" : "#e05252"} strokeWidth="1.8" />
    </svg>
  );
}

export default function LabelReviewPage() {
  const [date, setDate] = useState(today());
  const [review, setReview] = useState<LabelReview | null>(null);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualSymbol, setManualSymbol] = useState("");
  const [manualDirection, setManualDirection] = useState<"bullish" | "bearish" | "mixed">("mixed");
  const [manualBecame, setManualBecame] = useState("");
  const [manualNoticed, setManualNoticed] = useState("");
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null);
  const manualSymbolRef = useRef<HTMLInputElement>(null);
  const candidateRefs = useRef<Array<HTMLElement | null>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const response = await fetch(`/api/labels?date=${encodeURIComponent(date)}`);
    const json = await response.json();
    if (!response.ok) setError(json.error ?? "Failed to load label review");
    else setReview(json.review);
    setLoading(false);
  }, [date]);

  useEffect(() => { void load(); }, [load]);

  async function generate() {
    setLoading(true);
    setError(null);
    const response = await fetch("/api/labels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "generate", tradingDate: date }) });
    const json = await response.json();
    if (!response.ok) setError(json.error ?? "Failed to generate candidates");
    else {
      setReview(json.review);
      if (json.skippedExecutedTrades?.length) setError(`${json.skippedExecutedTrades.length} legacy journal trade(s) need an entry time before import.`);
    }
    setLoading(false);
  }

  const updateCandidate = useCallback(async (candidateId: string, body: Record<string, unknown>) => {
    setReview((current) => current ? {
      ...current,
      candidates: current.candidates.map((candidate) => candidate.id === candidateId ? {
        ...candidate,
        ...(body.decision ? { decision: body.decision as LabelCandidate["decision"] } : {}),
        ...(body.time_i_actually_noticed !== undefined ? { time_i_actually_noticed: body.time_i_actually_noticed as string | null } : {}),
      } : candidate),
    } : current);
    const response = await fetch("/api/labels", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "candidate", candidateId, ...body }) });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Failed to save candidate review");
      await load();
    }
  }, [load]);

  const moveSelection = useCallback((delta: number) => {
    setSelected((current) => {
      const next = Math.max(0, Math.min((review?.candidates.length ?? 1) - 1, current + delta));
      requestAnimationFrame(() => candidateRefs.current[next]?.scrollIntoView({ block: "nearest" }));
      return next;
    });
  }, [review?.candidates.length]);

  const decideSelected = useCallback((decision: "accepted" | "rejected") => {
    const candidate = review?.candidates[selected];
    if (!candidate) return;
    void updateCandidate(candidate.id, { decision });
    setExpandedCandidateId((current) => current === candidate.id ? null : current);
    moveSelection(1);
  }, [moveSelection, review?.candidates, selected, updateCandidate]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "SELECT" || target?.tagName === "TEXTAREA") return;
      const candidate = review?.candidates[selected];
      if (event.key === "ArrowDown") { event.preventDefault(); moveSelection(1); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); moveSelection(-1); return; }
      if (event.repeat) return;
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        manualSymbolRef.current?.scrollIntoView({ block: "center" });
        manualSymbolRef.current?.focus();
        return;
      }
      if (!candidate) return;
      if (event.key.toLowerCase() === "e") {
        event.preventDefault();
        setExpandedCandidateId((current) => current === candidate.id ? null : candidate.id);
      }
      if (event.key.toLowerCase() === "a") { event.preventDefault(); decideSelected("accepted"); }
      if (event.key.toLowerCase() === "r") { event.preventDefault(); decideSelected("rejected"); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [decideSelected, moveSelection, review, selected]);

  async function updateSession(body: Record<string, unknown>) {
    const response = await fetch("/api/labels", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "session", tradingDate: date, ...body }) });
    const json = await response.json();
    if (!response.ok) setError(json.error ?? "Failed to save session review");
    else await load();
  }

  async function addManual() {
    const response = await fetch("/api/labels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "manual_add", tradingDate: date, symbol: manualSymbol, direction: manualDirection, time_it_became_interesting: manualBecame || null, time_i_actually_noticed: manualNoticed || null }) });
    const json = await response.json();
    if (!response.ok) setError(json.error ?? "Failed to add label");
    else {
      setManualSymbol(""); setManualBecame(""); setManualNoticed("");
      await load();
    }
  }

  const counts = useMemo(() => ({
    pending: review?.candidates.filter((candidate) => candidate.decision === "pending").length ?? 0,
    accepted: review?.candidates.filter((candidate) => candidate.decision === "accepted").length ?? 0,
    rejected: review?.candidates.filter((candidate) => candidate.decision === "rejected").length ?? 0,
  }), [review]);

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <section className="panel p-4 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="font-display text-lg text-platinum-bright">End-of-session label review</h1>
          <p className="text-xs text-platinum-dim">You adjudicate. Movement only proposes candidates; nothing is accepted automatically.</p>
        </div>
        <label className="ml-auto text-xs text-platinum-dim">Session
          <input type="date" className="input block mt-1" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <button className="btn-secondary" disabled={loading} onClick={generate}>{loading ? "Working..." : "Generate / refresh"}</button>
        <a className="btn-secondary" href={`/api/labels?date=${encodeURIComponent(date)}&download=1`}>Download labels</a>
      </section>

      {error && <div className="panel p-3 text-xs text-signal-red">{error}</div>}

      <section className="panel p-4 flex flex-wrap items-center gap-3 text-xs">
        <span className="text-platinum-dim">Pending <strong className="text-platinum-bright">{counts.pending}</strong></span>
        <span className="text-platinum-dim">Accepted <strong className="text-signal-green">{counts.accepted}</strong></span>
        <span className="text-platinum-dim">Rejected <strong className="text-signal-red">{counts.rejected}</strong></span>
        <span className="ml-auto text-platinum-dim">Keys: ↑/↓ move · A accept · R reject · E chart · N missed symbol</span>
      </section>

      <section className="panel overflow-hidden">
        {(review?.candidates ?? []).map((candidate, index) => (
          <article key={candidate.id} ref={(element) => { candidateRefs.current[index] = element; }} aria-current={selected === index ? "true" : undefined} className={`border-b border-obsidian-border ${selected === index ? "bg-white/[.04] shadow-selected" : ""}`}>
            <div onClick={() => setSelected(index)} className="p-3 grid grid-cols-[42px_90px_1fr_180px_280px] gap-3 items-center">
              <div className="font-mono text-xs text-platinum-dim">#{candidate.rank}</div>
              <div><div className="font-mono font-semibold text-platinum-bright">{candidate.symbol}</div><div className="text-[10px] text-platinum-dim">{candidate.direction}</div></div>
              <div className="min-w-0">
                <div className="text-xs tabular">{candidate.rangeAtr.toFixed(2)} ATR range · {candidate.maxWindowTravelAtr.toFixed(2)} ATR / 30m</div>
                <div className="text-[10px] text-platinum-dim truncate">{candidate.time_it_became_interesting} · {candidate.reason_tags.join(", ") || "no map tag"}</div>
                <input aria-label={`${candidate.symbol} time actually noticed`} type="time" step="60" className="input mt-1 py-1 text-xs" value={candidate.time_i_actually_noticed?.slice(0, 5) ?? ""} onChange={(event) => setReview((current) => current ? { ...current, candidates: current.candidates.map((item) => item.id === candidate.id ? { ...item, time_i_actually_noticed: event.target.value || null } : item) } : current)} onBlur={(event) => void updateCandidate(candidate.id, { time_i_actually_noticed: event.target.value || null })} />
              </div>
              <Sparkline candidate={candidate} />
              <div className="flex justify-end gap-2">
                <button aria-expanded={expandedCandidateId === candidate.id} className="px-3 py-2 rounded text-xs border border-obsidian-border" onClick={(event) => { event.stopPropagation(); setSelected(index); setExpandedCandidateId((current) => current === candidate.id ? null : candidate.id); }}>{expandedCandidateId === candidate.id ? "Collapse" : "Chart"}</button>
                <button className={`px-3 py-2 rounded text-xs border ${candidate.decision === "accepted" ? "border-signal-green text-signal-green" : "border-obsidian-border"}`} onClick={(event) => { event.stopPropagation(); setSelected(index); void updateCandidate(candidate.id, { decision: "accepted" }); }}>Accept</button>
                <button className={`px-3 py-2 rounded text-xs border ${candidate.decision === "rejected" ? "border-signal-red text-signal-red" : "border-obsidian-border"}`} onClick={(event) => { event.stopPropagation(); setSelected(index); void updateCandidate(candidate.id, { decision: "rejected" }); }}>Reject</button>
              </div>
            </div>
            {expandedCandidateId === candidate.id ? <IntradayCandidateChart tradingDate={candidate.tradingDate} symbol={candidate.symbol} becameInteresting={candidate.time_it_became_interesting} /> : null}
          </article>
        ))}
        {!loading && (review?.candidates.length ?? 0) === 0 && <div className="p-8 text-center text-sm text-platinum-dim">No generated candidates yet. This is unlabelled—not a quiet session—until you explicitly decide.</div>}
      </section>

      <section className="panel p-4 space-y-3">
        <h2 className="text-sm font-display text-platinum-bright">Add a name the generator missed</h2>
        <form className="grid md:grid-cols-5 gap-2" onSubmit={(event) => { event.preventDefault(); if (manualSymbol) void addManual(); }}>
          <input ref={manualSymbolRef} className="input font-mono" placeholder="Symbol" aria-label="Missed symbol" value={manualSymbol} onChange={(event) => setManualSymbol(event.target.value.toUpperCase())} />
          <select className="input" value={manualDirection} onChange={(event) => setManualDirection(event.target.value as typeof manualDirection)}><option value="mixed">Mixed</option><option value="bullish">Bullish</option><option value="bearish">Bearish</option></select>
          <input className="input" type="time" aria-label="Time became interesting" value={manualBecame} onChange={(event) => setManualBecame(event.target.value)} />
          <input className="input" type="time" aria-label="Time actually noticed (optional)" value={manualNoticed} onChange={(event) => setManualNoticed(event.target.value)} />
          <button className="btn-secondary" disabled={!manualSymbol} type="submit">Add missed name</button>
        </form>
      </section>

      <section className="panel p-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-platinum-dim mr-2">Quiet-session judgment (never inferred):</span>
        <button className={`px-3 py-2 text-xs rounded border ${review?.quietSession === true ? "border-platinum-bright" : "border-obsidian-border"}`} onClick={() => void updateSession({ quietSession: true })}>Quiet session</button>
        <button className={`px-3 py-2 text-xs rounded border ${review?.quietSession === false ? "border-platinum-bright" : "border-obsidian-border"}`} onClick={() => void updateSession({ quietSession: false })}>Not quiet</button>
        <button className="btn-primary ml-auto" disabled={!review || counts.pending > 0 || review.quietSession === null || review.reviewCompleted} onClick={() => void updateSession({ reviewCompleted: true })}>{review?.reviewCompleted ? "Review complete" : "Complete review"}</button>
      </section>
    </div>
  );
}
