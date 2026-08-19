/**
 * READ-ONLY observation: run the committed detector over FREE HISTORICAL
 * SIP bars and report what it actually does.
 *
 *   npx tsx scripts/observe-sip-replay.ts --date 2026-08-03
 *
 * Observation only. It imports the committed detector unchanged, writes
 * nothing, persists nothing, commits nothing, and does not alter the live
 * scan (which stays on IEX). No SIP -> IEX fallback: a failed SIP request
 * is reported as failed.
 *
 * Everything printed comes from real returned candles. Anything not
 * measurable prints as `null`, never 0.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Candle } from "../types/candle";
import { defaultTrendScannerConfig } from "../lib/trend/config";
import { replaySession, type ReplayOutcome } from "../lib/trend/replay";
import { detectHeldBaseOrigin } from "../lib/trend/origin";
import { calculateAtr } from "../lib/indicators/atr";
import { latestValid } from "../lib/indicators/movingAverages";
import type { SyntheticSession } from "../lib/trend/fixtures/syntheticSession";
import type { TrendDirection } from "../lib/trend/types";

const BASE = "https://data.alpaca.markets/v2";

function loadEnvLocal(): string[] {
  const p = resolve(process.cwd(), ".env.local");
  if (!existsSync(p)) return [];
  const loaded: string[] = [];
  for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith("#")) continue;
    const i = l.indexOf("=");
    if (i <= 0) continue;
    const k = l.slice(0, i).trim();
    let v = l.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) {
      process.env[k] = v;
      loaded.push(k);
    }
  }
  return loaded;
}

interface RawBar { t: string; o: number; h: number; l: number; c: number; v: number; n?: number }

async function fetchSip(args: {
  symbol: string;
  timeframe: string;
  start: string;
  end: string;
  maxPages?: number;
}): Promise<Candle[]> {
  const keyId = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  if (!keyId || !secret) throw new Error("missing_credentials");

  const out: Candle[] = [];
  let token: string | null = null;
  let pages = 0;
  const maxPages = args.maxPages ?? 6;

  do {
    const u = new URL(`${BASE}/stocks/${args.symbol}/bars`);
    u.searchParams.set("timeframe", args.timeframe);
    u.searchParams.set("feed", "sip");           // explicit, never defaulted
    u.searchParams.set("adjustment", "raw");
    u.searchParams.set("start", args.start);
    u.searchParams.set("end", args.end);         // explicit: keeps us in the allowed window
    u.searchParams.set("limit", "10000");
    if (token) u.searchParams.set("page_token", token);

    const r = await fetch(u, {
      headers: { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secret },
    });
    if (!r.ok) {
      // Category only, and NO silent fallback to IEX.
      throw new Error(`sip_request_failed_http_${r.status}`);
    }
    const j = (await r.json()) as { bars?: RawBar[] | null; next_page_token?: string | null };
    for (const b of j.bars ?? []) {
      out.push({ time: Math.floor(Date.parse(b.t) / 1000), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v });
    }
    token = j.next_page_token ?? null;
    pages += 1;
  } while (token && pages < maxPages);

  return out;
}

/** Eastern minute-of-day, DST-aware. */
function etMinutes(timeSec: number): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(timeSec * 1000));
  const hh = Number(f.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(f.find((p) => p.type === "minute")?.value ?? "0");
  return hh * 60 + mm;
}
function etLabel(timeSec: number): string {
  const m = etMinutes(timeSec);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")} ET`;
}
const PRE = 4 * 60, OPEN = 9 * 60 + 30, CLOSE = 16 * 60;
const isPre = (c: Candle) => etMinutes(c.time) >= PRE && etMinutes(c.time) < OPEN;
const isReg = (c: Candle) => etMinutes(c.time) >= OPEN && etMinutes(c.time) < CLOSE;

function aggregate5m(oneMinute: Candle[]): Candle[] {
  const buckets = new Map<number, Candle[]>();
  for (const c of oneMinute) {
    const k = Math.floor(c.time / 300) * 300;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(c);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, bs]) => ({
      time,
      open: bs[0].open,
      high: Math.max(...bs.map((b) => b.high)),
      low: Math.min(...bs.map((b) => b.low)),
      close: bs[bs.length - 1].close,
      volume: bs.reduce((a, b) => a + b.volume, 0),
    }));
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const n = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "null" : v.toFixed(d);

async function observe(symbol: string, date: string): Promise<void> {
  console.log(`\n${"=".repeat(66)}\n${symbol} — ${date} — FREE HISTORICAL SIP\n${"=".repeat(66)}`);

  const dayStart = `${date}T08:00:00Z`;
  const dayEnd = `${date}T23:59:59Z`;
  const baseStart = new Date(Date.parse(dayStart) - 35 * 86400_000).toISOString();
  const baseEnd = `${date}T00:00:00Z`;

  const oneMinuteAll = await fetchSip({ symbol, timeframe: "1Min", start: dayStart, end: dayEnd });
  const dailyAll = await fetchSip({ symbol, timeframe: "1Day", start: baseStart, end: dayEnd });
  const baseline5m = await fetchSip({ symbol, timeframe: "5Min", start: baseStart, end: baseEnd });

  const premarket1m = oneMinuteAll.filter(isPre);
  const regular1m = oneMinuteAll.filter(isReg);
  // 5m aggregated LOCALLY from 1m, so the two timeframes cannot disagree.
  const regular5m = aggregate5m(regular1m);

  const premarketHigh = premarket1m.length ? Math.max(...premarket1m.map((c) => c.high)) : null;
  const premarketLow = premarket1m.length ? Math.min(...premarket1m.map((c) => c.low)) : null;

  console.log(`\n[1] PREMARKET STRUCTURE ON FULL SIP DATA`);
  console.log(`  premarket 1m bars      : ${premarket1m.length}`);
  console.log(`  premarket high         : ${n(premarketHigh)}`);
  console.log(`  premarket low          : ${n(premarketLow)}`);
  console.log(`  regular 1m bars        : ${regular1m.length}`);
  console.log(`  regular 5m (aggregated): ${regular5m.length}`);

  // The premarket higher-low base, using the SAME Path A detector the
  // scanner uses — but fed PREMARKET bars, which the live detector never
  // sees. This is an observation, not a change in behaviour.
  const atrSeries = calculateAtr(aggregate5m(premarket1m), 14);
  const premarketAtr = latestValid(atrSeries);
  const pmBase = premarket1m.length >= 10 && premarketAtr !== null
    ? detectHeldBaseOrigin({
        oneMinute: premarket1m,
        fiveMinute: aggregate5m(premarket1m),
        direction: "bullish",
        atr5m: premarketAtr,
        levels: premarketHigh === null ? [] : [{ name: "Premarket high", price: premarketHigh, availableFrom: null }],
        config: defaultTrendScannerConfig,
      })
    : null;
  console.log(`  premarket 5m ATR       : ${n(premarketAtr)}`);
  console.log(
    `  premarket higher-low base: ${pmBase?.origin ? n(pmBase.origin.price) : "null"}` +
      (pmBase?.origin ? ` (locked ${pmBase.origin.establishedAt})` : ` (${pmBase?.rejections.join(", ") ?? "not evaluated"})`)
  );

  // ---- run the COMMITTED detector, regular session only (as it does) ----
  const prevDaily = dailyAll.filter((c) => new Date(c.time * 1000).toISOString().slice(0, 10) < date);
  const prior = prevDaily[prevDaily.length - 1] ?? null;

  const baselineByMinute: Record<number, number> = {};
  for (const m of new Set(regular5m.map((c) => etMinutes(c.time)))) {
    const sameMinute = baseline5m.filter((c) => etMinutes(c.time) === m).map((c) => c.volume);
    const med = median(sameMinute);
    if (med !== null && med > 0) baselineByMinute[m] = med;
  }

  if (premarketHigh === null || premarketLow === null || regular5m.length < 5) {
    console.log(`\n  Cannot replay: insufficient real data. Nothing substituted.`);
    return;
  }

  const session: SyntheticSession = {
    symbol, tradingDate: date, synthetic: false,
    oneMinute: regular1m, fiveMinute: regular5m, daily: dailyAll,
    premarketHigh, premarketLow,
    previousDayHigh: prior?.high ?? premarketHigh,
    previousDayLow: prior?.low ?? premarketLow,
    oneMinuteVolumeBaseline: 0, fiveMinuteVolumeBaseline: 0,
    fiveMinuteBaselineByMinute: baselineByMinute,
  };

  for (const direction of ["bullish", "bearish"] as TrendDirection[]) {
    const out = replaySession({
      session, direction, config: defaultTrendScannerConfig,
      dataSource: "provider",
      // FULL market coverage: volume thresholds now apply for real.
      feedLabel: "SIP — full-market coverage",
    });
    measureAndPrint(out, symbol, date, direction, premarketHigh, pmBase?.origin?.price ?? null);
  }
}

// ---------------------------------------------------------------------------
// MEASUREMENT OVERLAY
//
// Everything below is computed ALONGSIDE the unchanged detector. Nothing
// here is fed back into it, gates a decision, or alters a threshold. The
// detector's own output is the input to these metrics.
// ---------------------------------------------------------------------------

const MILESTONES = defaultTrendScannerConfig.percentMilestones;

interface MilestoneReach {
  pct: number;
  at: string | null;
  price: number | null;
}

interface LegRecord {
  symbol: string;
  date: string;
  direction: TrendDirection;
  legIndex: number;
  tap1At: string | null;
  tap1RelVol: number | null;
  confirmedAt: string | null;
  confirmedRelVol: number | null;
  levelBreaks: { at: string; relVol: number | null; reason: string }[];
  endedAt: string | null;
  endedBy: "failed" | "session_end";
  originPrice: number | null;
  originMode: string | null;
  maxMovePctFromOrigin: number | null;
  blueSkyCandidates: number;
  blueSkyGatedByVolume: number;
  blueSkyWouldFire: number;
}

/** First completed close in `steps` reaching `pct` beyond `anchor`. */
function firstReach(
  steps: { marketDataAt: string; price: number }[],
  anchor: number | null,
  pct: number,
  direction: TrendDirection
): MilestoneReach {
  if (anchor === null || anchor === 0) return { pct, at: null, price: null };
  for (const s of steps) {
    const move =
      direction === "bullish"
        ? ((s.price - anchor) / anchor) * 100
        : ((anchor - s.price) / anchor) * 100;
    if (move + 1e-9 >= pct) return { pct, at: s.marketDataAt, price: s.price };
  }
  return { pct, at: null, price: null };
}

function reachTable(
  label: string,
  anchor: number | null,
  steps: { marketDataAt: string; price: number }[],
  direction: TrendDirection
): void {
  const anchorText = anchor === null ? "null" : anchor.toFixed(2);
  const cells = MILESTONES.map((m) => {
    const r = firstReach(steps, anchor, m, direction);
    return r.at === null ? `${m}%: —` : `${m}%: ${etLabel(Date.parse(r.at) / 1000)}`;
  });
  console.log(`    ${label.padEnd(22)} anchor ${anchorText.padStart(8)}   ${cells.join("  ")}`);
}

/**
 * Segments a replay into LEGS (TAP 1 -> failure or session end) and
 * measures each one. Blue-sky candidates are derived from the price
 * series, so they can be counted even when the detector's volume gate
 * suppressed them.
 */
function measureLegs(
  out: ReplayOutcome,
  symbol: string,
  date: string,
  direction: TrendDirection
): LegRecord[] {
  const legs: LegRecord[] = [];
  let current: LegRecord | null = null;
  let legIndex = 0;

  // Running peak since the current leg's origin, for blue-sky candidates.
  let peak: number | null = null;

  for (const step of out.steps) {
    const has = (s: string) => step.transitions.some((t) => t.stage === s);

    if (has("trend_watch")) {
      if (current) legs.push(current);
      legIndex += 1;
      current = {
        symbol, date, direction, legIndex,
        tap1At: step.marketDataAt,
        tap1RelVol: step.relativeVolume,
        confirmedAt: null, confirmedRelVol: null,
        levelBreaks: [],
        endedAt: null, endedBy: "session_end",
        originPrice: null, originMode: null,
        maxMovePctFromOrigin: null,
        blueSkyCandidates: 0, blueSkyGatedByVolume: 0, blueSkyWouldFire: 0,
      };
      peak = step.price;
    }

    if (!current) continue;

    if (has("trend_confirmed") && current.confirmedAt === null) {
      current.confirmedAt = step.marketDataAt;
      current.confirmedRelVol = step.relativeVolume;
    }

    for (const t of step.transitions.filter((x) => x.stage === "level_break")) {
      current.levelBreaks.push({
        at: step.marketDataAt, relVol: step.relativeVolume, reason: t.reason,
      });
    }

    // Blue-sky CANDIDATE: a completed close beyond the running peak, i.e.
    // what the fallback would consider a fresh leg. Counted from price
    // alone so volume-suppressed ones are still visible.
    if (peak !== null) {
      const beyond = direction === "bullish" ? step.price > peak : step.price < peak;
      const noLevelAhead = !step.transitions.some(
        (t) => t.stage === "level_break" && !/new-high/i.test(t.reason)
      );
      if (beyond && noLevelAhead) {
        current.blueSkyCandidates += 1;
        const rv = step.relativeVolume;
        if (rv === null || rv < defaultTrendScannerConfig.levelBreakRelativeVolume) {
          current.blueSkyGatedByVolume += 1;
        } else {
          current.blueSkyWouldFire += 1;
        }
      }
      peak = direction === "bullish" ? Math.max(peak, step.price) : Math.min(peak, step.price);
    }

    if (step.fromOriginPct !== null) {
      current.maxMovePctFromOrigin =
        current.maxMovePctFromOrigin === null
          ? step.fromOriginPct
          : Math.max(current.maxMovePctFromOrigin, step.fromOriginPct);
    }

    if (has("failed")) {
      current.endedAt = step.marketDataAt;
      current.endedBy = "failed";
      legs.push(current);
      current = null;
      peak = null;
    }
  }
  if (current) legs.push(current);

  // Attach the origin the detector actually used, where still visible.
  const origin = out.final.lifecycle.origin;
  for (const leg of legs) {
    if (leg.originPrice === null && origin !== null) {
      leg.originPrice = origin.price;
      leg.originMode = origin.mode;
    }
  }
  return legs;
}

/** Accumulated across every session, for the combined distribution. */
const ALL_RELVOL: { context: string; value: number | null }[] = [];
const ALL_LEGS: LegRecord[] = [];
const ANCHOR_REACH: Record<string, Record<number, number>> = {
  trendOrigin: {}, premarketBase: {}, premarketHigh: {},
};

function measureAndPrint(
  out: ReplayOutcome,
  symbol: string,
  date: string,
  direction: TrendDirection,
  premarketHigh: number | null,
  premarketBase: number | null
): void {
  const legs = measureLegs(out, symbol, date, direction);
  ALL_LEGS.push(...legs);

  console.log(`\n  --- ${direction.toUpperCase()} — ${legs.length} leg(s) ---`);
  if (legs.length === 0) {
    console.log(`    no TAP 1 in this direction`);
  }

  for (const leg of legs) {
    console.log(`\n    LEG ${leg.legIndex}`);
    console.log(
      `      TAP 1            ${leg.tap1At ? etLabel(Date.parse(leg.tap1At) / 1000) : "—"}` +
        `   relVol ${n(leg.tap1RelVol)}`
    );
    console.log(
      `      trend_confirmed  ${leg.confirmedAt ? etLabel(Date.parse(leg.confirmedAt) / 1000) : "—"}` +
        `   relVol ${n(leg.confirmedRelVol)}`
    );
    if (leg.levelBreaks.length === 0) {
      console.log(`      level_break      none`);
    }
    for (const b of leg.levelBreaks) {
      console.log(
        `      level_break      ${etLabel(Date.parse(b.at) / 1000)}   relVol ${n(b.relVol)}   ${b.reason}`
      );
    }
    console.log(
      `      ended            ${leg.endedAt ? etLabel(Date.parse(leg.endedAt) / 1000) : "session end"} (${leg.endedBy})`
    );
    console.log(
      `      trendOrigin      ${n(leg.originPrice)} ${leg.originMode ?? ""}` +
        `   max move from it ${n(leg.maxMovePctFromOrigin)}%`
    );
    console.log(
      `      blue-sky         ${leg.blueSkyCandidates} candidate(s): ` +
        `${leg.blueSkyWouldFire} would fire, ${leg.blueSkyGatedByVolume} gated by volume ` +
        `(threshold ${defaultTrendScannerConfig.levelBreakRelativeVolume})`
    );

    ALL_RELVOL.push({ context: "tap1", value: leg.tap1RelVol });
    if (leg.confirmedAt) ALL_RELVOL.push({ context: "confirmed", value: leg.confirmedRelVol });
    for (const b of leg.levelBreaks) ALL_RELVOL.push({ context: "level_break", value: b.relVol });
  }

  // ---- milestone reachability under all three anchors ----
  const steps = out.steps.map((s) => ({ marketDataAt: s.marketDataAt, price: s.price }));
  const legOrigin = legs.find((l) => l.originPrice !== null)?.originPrice ?? null;

  console.log(`\n    MILESTONE REACH — first completed close reaching each level`);
  reachTable("trendOrigin", legOrigin, steps, direction);
  reachTable("premarket base", premarketBase, steps, direction);
  reachTable("premarket high", premarketHigh, steps, direction);
  console.log(
    `    (premarket anchors are measured across the whole regular session;\n` +
      `     trendOrigin is the detector's own leg-scoped anchor)`
  );

  for (const [key, anchor] of [
    ["trendOrigin", legOrigin],
    ["premarketBase", premarketBase],
    ["premarketHigh", premarketHigh],
  ] as [string, number | null][]) {
    for (const m of MILESTONES) {
      const r = firstReach(steps, anchor, m, direction);
      if (r.at !== null) ANCHOR_REACH[key][m] = (ANCHOR_REACH[key][m] ?? 0) + 1;
    }
  }
}

function printDistributionSummary(): void {
  console.log(`\n${"=".repeat(66)}\nCOMBINED DISTRIBUTION SUMMARY\n${"=".repeat(66)}`);

  const measured = ALL_RELVOL.filter((r) => r.value !== null).map((r) => r.value as number);
  const unmeasured = ALL_RELVOL.length - measured.length;

  console.log(`\nRELATIVE VOLUME — every reading across every leg (SIP, full-market)`);
  console.log(`  readings: ${ALL_RELVOL.length} (${measured.length} measured, ${unmeasured} null)`);
  if (measured.length > 0) {
    const sorted = [...measured].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    console.log(`  min ${n(sorted[0])}   p25 ${n(q(0.25))}   median ${n(q(0.5))}   p75 ${n(q(0.75))}   max ${n(sorted[sorted.length - 1])}`);
    for (const ctx of ["tap1", "confirmed", "level_break"]) {
      const vals = ALL_RELVOL.filter((r) => r.context === ctx && r.value !== null).map((r) => r.value as number);
      if (vals.length === 0) { console.log(`  ${ctx.padEnd(12)} no measured readings`); continue; }
      const s2 = [...vals].sort((a, b) => a - b);
      console.log(
        `  ${ctx.padEnd(12)} n=${vals.length}  min ${n(s2[0])}  median ${n(s2[Math.floor(s2.length / 2)])}  max ${n(s2[s2.length - 1])}`
      );
    }
    const thr = defaultTrendScannerConfig.levelBreakRelativeVolume;
    const above = measured.filter((v) => v >= thr).length;
    console.log(
      `\n  vs the CURRENT threshold ${thr}: ${above}/${measured.length} readings clear it ` +
        `(${((above / measured.length) * 100).toFixed(0)}%)`
    );
  }

  console.log(`\nMILESTONE REACH COUNT PER ANCHOR (across all sessions/directions)`);
  for (const key of ["trendOrigin", "premarketBase", "premarketHigh"]) {
    const cells = MILESTONES.map((m) => `${m}%: ${ANCHOR_REACH[key][m] ?? 0}`);
    console.log(`  ${key.padEnd(16)} ${cells.join("   ")}`);
  }

  const totalBlueSky = ALL_LEGS.reduce((a, l) => a + l.blueSkyCandidates, 0);
  const gated = ALL_LEGS.reduce((a, l) => a + l.blueSkyGatedByVolume, 0);
  console.log(`\nBLUE-SKY CANDIDATES: ${totalBlueSky} total, ${gated} gated by volume, ${totalBlueSky - gated} would fire`);
  console.log(`LEGS: ${ALL_LEGS.length} total across all sessions and directions\n`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (k: string) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const date = get("date") ?? "2026-08-03";
  const symbols = (get("symbols") ?? "NVDA,GOOGL").split(",");

  const loaded = loadEnvLocal();
  console.log(`Env loaded from .env.local: ${loaded.filter((k) => /ALPACA/i.test(k)).join(", ")} (names only)`);
  const endAge = Math.round((Date.now() - Date.parse(`${date}T23:59:59Z`)) / 60000);
  console.log(`SIP window end is ${endAge} minutes old (>= 15 required).`);
  console.log(`Detector, config and thresholds are UNCHANGED from commit fa45007.`);

  for (const s of symbols) await observe(s.trim().toUpperCase(), date);
  printDistributionSummary();
}

main().catch((e) => {
  console.error(`OBSERVATION FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
