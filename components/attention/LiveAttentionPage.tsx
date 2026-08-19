"use client";

import { useEffect, useRef, useState } from "react";
import type { AttentionEvent } from "@/lib/attention/attentionEvents";
import type { LiveAttentionSnapshot, RuntimeDetectionCounters } from "@/lib/attention-runtime/contracts";
import { dashboardWorkerLiveness, formatSnapshotAge } from "@/lib/attention-runtime/dashboardLiveness";

interface DetectionResponse {
  status: "ran" | "suppressed" | "unknown";
  reason: string | null;
  counters: RuntimeDetectionCounters | null;
}

interface ApiBody {
  snapshot?: LiveAttentionSnapshot | null;
  events?: AttentionEvent[];
  detection?: DetectionResponse;
  status?: string;
  error?: string;
}

class SignedOutError extends Error {}

async function readJson(response: Response): Promise<ApiBody> {
  const contentType = response.headers.get("content-type") ?? "";
  if (response.redirected || response.status === 401 || !contentType.includes("application/json")) {
    throw new SignedOutError("SIGNED OUT — SIGN IN AGAIN");
  }
  return response.json() as Promise<ApiBody>;
}

const etTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const etTimeWithSeconds = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function eventContext(event: AttentionEvent): string[] {
  return [
    ...(event.payload.freshnessDetail?.reasons ?? []),
    ...event.payload.contextBadges.map((badge) => badge.label),
    ...(event.payload.extensionWarning ? [event.payload.extensionWarning] : []),
  ];
}

function freshnessClass(freshness: string | null): string {
  if (freshness === "Extended") return "border-red-700 bg-red-950 text-red-200";
  if (freshness === "Fresh") return "border-emerald-700 bg-emerald-950 text-emerald-200";
  return "border-slate-700 bg-slate-900 text-slate-300";
}

function suppressionLabel(reason: string | null | undefined): string {
  return (reason ?? "unknown").replaceAll("_", " ");
}

export default function LiveAttentionPage() {
  const [snapshot, setSnapshot] = useState<LiveAttentionSnapshot | null>(null);
  const [events, setEvents] = useState<AttentionEvent[]>([]);
  const [detection, setDetection] = useState<DetectionResponse>({ status: "unknown", reason: "unknown", counters: null });
  const [clock, setClock] = useState(() => Date.now());
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [status, setStatus] = useState("Connecting to the runtime handoff…");
  const [signedOut, setSignedOut] = useState(false);
  const [connectionUnavailable, setConnectionUnavailable] = useState(false);
  const [newEventUntil, setNewEventUntil] = useState<Record<string, number>>({});
  const knownEventIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [liveResult, eventsResult] = await Promise.allSettled([
        fetch("/api/attention/live", { cache: "no-store" }).then(readJson),
        fetch("/api/attention/events?limit=200", { cache: "no-store" }).then(readJson),
      ]);
      if (!active) return;
      const failures = [liveResult, eventsResult].filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failures.some((result) => result.reason instanceof SignedOutError)) {
        setSignedOut(true);
        setStatus("SIGNED OUT — SIGN IN AGAIN");
        return;
      }
      setSignedOut(false);
      setConnectionUnavailable(failures.length > 0);
      let updated = false;
      if (liveResult.status === "fulfilled") {
        const body = liveResult.value;
        if (body.snapshot) setSnapshot(body.snapshot);
        else if (body.status === "worker_not_registered") setSnapshot(null);
        setStatus(body.snapshot?.statusMessage ?? body.status ?? body.error ?? "No worker snapshot");
        updated = true;
      } else {
        setStatus("Connection unavailable — showing the last confirmed cloud snapshot.");
      }
      if (eventsResult.status === "fulfilled") {
        const body = eventsResult.value;
        if (body.events) {
          const now = Date.now();
          const nextIds = new Set(body.events.map((event) => event.eventId));
          if (knownEventIds.current) {
            const arrived = body.events.filter((event) => !knownEventIds.current!.has(event.eventId));
            if (arrived.length) setNewEventUntil((current) => ({
              ...Object.fromEntries(Object.entries(current).filter(([, until]) => until > now)),
              ...Object.fromEntries(arrived.map((event) => [event.eventId, now + 30_000])),
            }));
          }
          knownEventIds.current = nextIds;
          setEvents(body.events);
        }
        if (body.detection) setDetection(body.detection);
        updated = true;
      }
      if (updated) setLastUpdatedAt(Date.now());
    };
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void load(); };
    const refreshOnFocus = () => { void load(); };
    void load();
    const pollTimer = window.setInterval(load, 15_000);
    const clockTimer = window.setInterval(() => setClock(Date.now()), 1_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      active = false;
      window.clearInterval(pollTimer);
      window.clearInterval(clockTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, []);

  const liveness = dashboardWorkerLiveness(snapshot, clock);
  const livenessClass = connectionUnavailable
    ? "bg-amber-950 text-amber-200"
    : liveness.workerDown
    ? "bg-red-950 text-red-300"
    : liveness.label === "CURRENT" ? "bg-emerald-950 text-emerald-300"
    : "bg-slate-800 text-slate-300";
  const rankingsVisible = Boolean(snapshot && !connectionUnavailable && !liveness.workerDown && !snapshot.darkWindowReason && !signedOut);
  const latestMinuteQuiet = detection.status === "ran" && (snapshot?.eventsDetected ?? 0) === 0;
  const marketClosed = detection.status === "suppressed" && detection.reason === "non_regular";
  const displayedStatus = marketClosed
    ? "Market closed — regular-session scanning resumes at 09:30 ET."
    : status;

  return <main className="mx-auto max-w-6xl space-y-5 p-6 text-slate-100">
    <header className="space-y-2">
      <h1 className="text-2xl font-semibold">Live Attention</h1>
      <p className="text-sm text-slate-400">{displayedStatus}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {snapshot && <span className="rounded bg-amber-950 px-2 py-1 text-amber-300">{snapshot.feedBadge}</span>}
        {snapshot && <span className="rounded bg-slate-800 px-2 py-1">{snapshot.ingestionMode}</span>}
        {snapshot?.shadow && <span className="rounded border border-violet-700 bg-violet-950 px-2 py-1 text-violet-200">SHADOW — ON-PAGE ONLY · NO OUT-OF-BAND DELIVERY</span>}
        <span className={`rounded px-2 py-1 ${livenessClass}`}>{connectionUnavailable ? "CONNECTION STALE" : liveness.label}</span>
        <span className="text-slate-400">Last updated {lastUpdatedAt === null ? "—" : `${etTimeWithSeconds.format(lastUpdatedAt)} ET`}</span>
      </div>
    </header>

    {signedOut && <section role="alert" className="rounded border-2 border-red-500 bg-red-950 p-5 text-red-100">
      <h2 className="text-xl font-bold">SIGNED OUT — SIGN IN AGAIN</h2>
      <p className="mt-2">The API returned a redirect, a non-JSON login page, or an unauthenticated response.</p>
    </section>}

    {!signedOut && connectionUnavailable && <section role="alert" className="rounded border-2 border-amber-500 bg-amber-950 p-5 text-amber-100">
      <h2 className="text-xl font-bold">CONNECTION LOST — SHOWING LAST CONFIRMED DATA</h2>
      <p className="mt-2">The browser cannot currently reach the cloud handoff. This does not prove the worker is down; rankings are hidden until the connection recovers.</p>
    </section>}

    {!signedOut && !connectionUnavailable && liveness.workerDown && <section role="alert" className="rounded border-2 border-red-500 bg-red-950 p-5 text-red-100">
      <h2 className="text-xl font-bold">WORKER DOWN — LIVE DATA IS STALE</h2>
      <p className="mt-2">The last completed snapshot is {formatSnapshotAge(liveness.ageMs)}. Rankings are hidden because they are not live; recorded alerts remain below.</p>
    </section>}

    {snapshot?.lagWarning && <section role="alert" className="rounded border-2 border-orange-500 bg-orange-950 p-5 text-orange-100">
      <h2 className="text-xl font-bold">PROCESSING LAG — WATERMARK IS BEHIND</h2>
      <p className="mt-2">The last cycle crossed a minute boundary or the watermark is more than one minute late. Treat rankings as delayed.</p>
      <p className="mt-1 text-sm text-orange-200">Cycle {Math.round(snapshot.cycleTimings.totalCycleMs)} ms · watermark lag {Math.round(snapshot.watermarkLagMs / 1000)} s.</p>
    </section>}

    <section aria-labelledby="live-alerts-heading" className="space-y-3 rounded border border-slate-700 bg-slate-950 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="live-alerts-heading" className="text-lg font-semibold">Live Alerts</h2><p className="text-xs text-slate-400">Recorded detections for today, newest first. NOT AN ENTRY — open the chart.</p></div>
        {detection.status === "ran" && <span className={`rounded px-2 py-1 text-xs ${latestMinuteQuiet ? "bg-slate-800 text-slate-300" : "bg-emerald-950 text-emerald-300"}`}>{latestMinuteQuiet ? "QUIET — DETECTION RAN" : `${snapshot?.eventsDetected ?? 0} DETECTED THIS MINUTE`}</span>}
        {marketClosed && <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200">MARKET CLOSED — REGULAR SESSION ONLY</span>}
        {detection.status === "suppressed" && !marketClosed && <span className="rounded bg-amber-950 px-2 py-1 text-xs text-amber-200">DETECTION SUPPRESSED — {suppressionLabel(detection.reason).toUpperCase()}</span>}
        {detection.status === "unknown" && <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">DETECTION STATUS UNKNOWN</span>}
      </div>
      {detection.counters && <p className="text-xs text-slate-500">Session counters: {detection.counters.detectionRanMinutes} ran · {detection.counters.incompleteBatchMinutes} incomplete · {detection.counters.nonRegularMinutes} non-regular · {Object.values(detection.counters.guardSuppressedByReason).reduce((sum, count) => sum + (count ?? 0), 0)} guard-suppressed.</p>}
      {events.length === 0 ? <div className="rounded border border-slate-800 p-4 text-sm text-slate-400">
        {marketClosed ? "Market is closed. Free IEX shadow scanning resumes at 09:30 ET; no regular-session detection is running now." : detection.status === "ran" ? "No detections recorded today." : detection.status === "suppressed" ? `No event was recorded for the latest minute because detection was suppressed: ${suppressionLabel(detection.reason)}.` : "No recorded events are available yet."}
      </div> : <div className="space-y-2">{events.map((event) => {
        const context = eventContext(event);
        const isNew = (newEventUntil[event.eventId] ?? 0) > clock;
        return <article key={event.eventId} className={`grid gap-2 rounded border p-3 transition-colors md:grid-cols-[72px_150px_80px_90px_120px_1fr] ${isNew ? "border-cyan-400 bg-cyan-950/60" : "border-slate-800 bg-slate-900"}`}>
          <time className="font-mono text-sm text-slate-300">{etTime.format(event.qualifiedAt)} ET</time>
          <span className="text-xs font-semibold text-cyan-200">{event.type.replaceAll("_", " ")}</span>
          <span className="font-semibold">{event.symbol}</span><span>{event.payload.attentionScore.toFixed(1)}</span>
          <span className={`w-fit rounded border px-2 py-0.5 text-xs ${freshnessClass(event.payload.freshness)}`}>{event.payload.freshness}</span>
          <div className="flex flex-wrap gap-1 text-xs text-slate-300">{context.length ? context.map((label, index) => <span key={`${event.eventId}:${index}`} className="rounded bg-slate-800 px-2 py-0.5">{label}</span>) : <span>—</span>}</div>
        </article>;
      })}</div>}
    </section>

    {snapshot?.cycleBudgetExceeded && !snapshot.lagWarning && <p role="status" className="rounded border border-amber-500 bg-amber-950 p-3 text-amber-200">Cycle budget exceeded 20 seconds. Stage timings are recorded in runtime health.</p>}
    {snapshot?.darkWindowReason && <section className="rounded border border-slate-700 bg-slate-900 p-5"><h2 className="font-medium">Closed for the day</h2><p className="mt-1 text-sm text-slate-400">Free IEX shadow scanning runs during the regular session, 09:30–16:00 ET. Today&apos;s recorded alerts remain available above.</p></section>}

    {rankingsVisible && snapshot && <section className="overflow-hidden rounded border border-slate-800"><table className="w-full text-sm">
      <thead className="bg-slate-900 text-left text-slate-400"><tr><th className="p-3">Rank</th><th>Symbol</th><th>Attention</th><th>State</th><th>Freshness</th><th>Transition / explanation</th><th>Quality</th></tr></thead>
      <tbody>{snapshot.rankedRows.map((row) => <tr key={row.symbol} className="border-t border-slate-800"><td className="p-3">{row.rank ?? "—"}</td><td className="font-medium">{row.symbol}</td><td>{row.attentionScore?.toFixed(1) ?? "—"}</td><td>{row.state ?? "—"}</td><td><span className={`rounded border px-2 py-0.5 text-xs ${freshnessClass(row.freshness)}`}>{row.freshness ?? "—"}</span></td><td>{row.pendingTransition === "none" ? row.dataQualityReason : `${row.pendingTransition} ${row.pendingTransitionMinutes}m`}</td><td>{row.dataQualityState}</td></tr>)}</tbody>
    </table></section>}
  </main>;
}
