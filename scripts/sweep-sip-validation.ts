/**
 * READ-ONLY validation sweep over free historical SIP.
 *
 *   npx tsx scripts/sweep-sip-validation.ts
 *
 * Runs the COMMITTED detector (byte-unchanged from fa45007) across a
 * multi-symbol, multi-session set and reports distributions. Measures
 * only: no threshold is read back into the detector, nothing is tuned,
 * nothing is persisted, nothing is committed, and the live scan stays on
 * IEX. No SIP -> IEX fallback: a session SIP cannot serve is skipped and
 * listed, never fabricated.
 *
 * REQUEST EFFICIENCY: bars are fetched ONCE PER SYMBOL over the whole
 * window and sliced per date locally, rather than once per
 * symbol-session. That turns ~495 requests into ~5 per symbol.
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
const SYMBOLS = ["NVDA", "GOOGL", "AAPL", "MSFT", "META", "TSLA", "AMD", "AMZN", "SPY", "QQQ", "IWM"];
const ANCHOR_DATE = "2026-08-03";
const SESSION_COUNT = 15;
const CALIBRATION_COUNT = 10; // oldest 10; newest 5 are the holdout

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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) { process.env[k] = v; loaded.push(k); }
  }
  return loaded;
}

interface RawBar { t: string; o: number; h: number; l: number; c: number; v: number }

let requestCount = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchSip(args: {
  symbol: string; timeframe: string; start: string; end: string; maxPages?: number;
}): Promise<Candle[]> {
  const keyId = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  if (!keyId || !secret) throw new Error("missing_credentials");

  const out: Candle[] = [];
  let token: string | null = null;
  let pages = 0;
  const maxPages = args.maxPages ?? 8;

  do {
    const u = new URL(`${BASE}/stocks/${args.symbol}/bars`);
    u.searchParams.set("timeframe", args.timeframe);
    u.searchParams.set("feed", "sip");        // explicit, never defaulted
    u.searchParams.set("adjustment", "raw");
    u.searchParams.set("start", args.start);
    u.searchParams.set("end", args.end);      // explicit: stays in the allowed window
    u.searchParams.set("limit", "10000");
    if (token) u.searchParams.set("page_token", token);

    requestCount += 1;
    const r = await fetch(u, { headers: { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secret } });
    if (r.status === 429) { await sleep(2000); continue; }
    if (!r.ok) throw new Error(`sip_http_${r.status}`);

    const j = (await r.json()) as { bars?: RawBar[] | null; next_page_token?: string | null };
    for (const b of j.bars ?? []) {
      out.push({ time: Math.floor(Date.parse(b.t) / 1000), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v });
    }
    token = j.next_page_token ?? null;
    pages += 1;
  } while (token && pages < maxPages);

  return out;
}

// One formatter, and one memoised conversion per distinct timestamp. Naively
// re-formatting per call costs ~10^8 Intl operations across a full sweep.
const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
const ET_CACHE = new Map<number, { date: string; minutes: number }>();

function et(t: number): { date: string; minutes: number } {
  const hit = ET_CACHE.get(t);
  if (hit) return hit;
  const p = ET_FMT.formatToParts(new Date(t * 1000));
  const g = (k: string) => p.find((x) => x.type === k)?.value ?? "0";
  const v = {
    date: `${g("year")}-${g("month")}-${g("day")}`,
    minutes: Number(g("hour")) * 60 + Number(g("minute")),
  };
  ET_CACHE.set(t, v);
  return v;
}
const etDate = (t: number) => et(t).date;
const etMinutes = (t: number) => et(t).minutes;
function etLabel(t: number): string {
  const m = etMinutes(t);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

const PRE = 4 * 60, OPEN = 9 * 60 + 30, CLOSE = 16 * 60;
const isPre = (c: Candle) => etMinutes(c.time) >= PRE && etMinutes(c.time) < OPEN;
const isReg = (c: Candle) => etMinutes(c.time) >= OPEN && etMinutes(c.time) < CLOSE;

function aggregate5m(one: Candle[]): Candle[] {
  const b = new Map<number, Candle[]>();
  for (const c of one) {
    const k = Math.floor(c.time / 300) * 300;
    if (!b.has(k)) b.set(k, []);
    b.get(k)!.push(c);
  }
  return [...b.entries()].sort((x, y) => x[0] - y[0]).map(([time, bs]) => ({
    time, open: bs[0].open,
    high: Math.max(...bs.map((z) => z.high)),
    low: Math.min(...bs.map((z) => z.low)),
    close: bs[bs.length - 1].close,
    volume: bs.reduce((a, z) => a + z.volume, 0),
  }));
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const n = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "null" : v.toFixed(d);

// ---------------------------------------------------------------------------
// Condition bucket — from DAILY bars only, as specified.
// ---------------------------------------------------------------------------
type Bucket = "trend-up" | "trend-down" | "gap-and-go" | "gap-and-fail" | "chop";

function classify(day: Candle, prevClose: number | null): Bucket {
  const range = day.high - day.low;
  if (!(range > 0)) return "chop";
  const body = Math.abs(day.close - day.open) / range;
  const loc = (day.close - day.low) / range;
  const gapPct = prevClose && prevClose > 0 ? ((day.open - prevClose) / prevClose) * 100 : 0;

  if (Math.abs(gapPct) >= 0.5 && prevClose !== null) {
    const up = gapPct > 0;
    const held = up ? day.close > day.open : day.close < day.open;
    const failed = up ? day.close < prevClose : day.close > prevClose;
    if (held) return "gap-and-go";
    if (failed) return "gap-and-fail";
  }
  if (body >= 0.5 && loc >= 0.7) return "trend-up";
  if (body >= 0.5 && loc <= 0.3) return "trend-down";
  return "chop";
}

// ---------------------------------------------------------------------------
// Per-leg measurement (computed alongside; never fed back to the detector)
// ---------------------------------------------------------------------------
interface Leg {
  symbol: string; date: string; direction: TrendDirection; set: "CAL" | "EVAL"; bucket: Bucket;
  tap1RelVol: number | null; confirmedRelVol: number | null;
  levelBreakRelVols: number[];
  originPrice: number | null;
  maxFromOrigin: number | null; maxFromPmBase: number | null; maxFromPmHigh: number | null;
  blueSkyCandidates: number; blueSkyGated: number; blueSkyWouldFire: number;
}

function movePct(anchor: number | null, price: number, dir: TrendDirection): number | null {
  if (anchor === null || anchor === 0) return null;
  return dir === "bullish" ? ((price - anchor) / anchor) * 100 : ((anchor - price) / anchor) * 100;
}

function measureLegs(
  out: ReplayOutcome, symbol: string, date: string, dir: TrendDirection,
  set: "CAL" | "EVAL", bucket: Bucket, pmBase: number | null, pmHigh: number | null
): Leg[] {
  const legs: Leg[] = [];
  let cur: Leg | null = null;
  let peak: number | null = null;
  const origin = out.final.lifecycle.origin;

  for (const step of out.steps) {
    const has = (s: string) => step.transitions.some((t) => t.stage === s);

    if (has("trend_watch")) {
      if (cur) legs.push(cur);
      cur = {
        symbol, date, direction: dir, set, bucket,
        tap1RelVol: step.relativeVolume, confirmedRelVol: null, levelBreakRelVols: [],
        originPrice: origin?.price ?? null,
        maxFromOrigin: null, maxFromPmBase: null, maxFromPmHigh: null,
        blueSkyCandidates: 0, blueSkyGated: 0, blueSkyWouldFire: 0,
      };
      peak = step.price;
    }
    if (!cur) continue;

    if (has("trend_confirmed") && cur.confirmedRelVol === null) cur.confirmedRelVol = step.relativeVolume;
    for (const _t of step.transitions.filter((x) => x.stage === "level_break")) {
      cur.levelBreakRelVols.push(step.relativeVolume ?? NaN);
    }

    // Blue-sky CANDIDATE from price alone, so volume-suppressed ones stay visible.
    if (peak !== null) {
      const beyond = dir === "bullish" ? step.price > peak : step.price < peak;
      const namedBreak = step.transitions.some((t) => t.stage === "level_break" && !/new-high/i.test(t.reason));
      if (beyond && !namedBreak) {
        cur.blueSkyCandidates += 1;
        const rv = step.relativeVolume;
        if (rv === null || rv < defaultTrendScannerConfig.levelBreakRelativeVolume) cur.blueSkyGated += 1;
        else cur.blueSkyWouldFire += 1;
      }
      peak = dir === "bullish" ? Math.max(peak, step.price) : Math.min(peak, step.price);
    }

    // The origin is LEG-SCOPED and is cleared on failure, so it cannot be
    // reconstructed from the end-of-session lifecycle. Take the detector's
    // own per-bar reading, which used whatever origin was live at that bar.
    if (step.fromOriginPct !== null) {
      cur.maxFromOrigin =
        cur.maxFromOrigin === null ? step.fromOriginPct : Math.max(cur.maxFromOrigin, step.fromOriginPct);
    }

    const upd = (k: "maxFromPmBase" | "maxFromPmHigh", anchor: number | null) => {
      const m = movePct(anchor, step.price, dir);
      if (m === null) return;
      cur![k] = cur![k] === null ? m : Math.max(cur![k]!, m);
    };
    upd("maxFromPmBase", pmBase);
    upd("maxFromPmHigh", pmHigh);

    if (has("failed")) { legs.push(cur); cur = null; peak = null; }
  }
  if (cur) legs.push(cur);
  return legs;
}

// ---------------------------------------------------------------------------

interface SymbolData { oneMinute: Candle[]; daily: Candle[]; baseline5m: Candle[] }

async function loadSymbol(symbol: string, windowStart: string, windowEnd: string, baseStart: string): Promise<SymbolData> {
  const oneMinute = await fetchSip({ symbol, timeframe: "1Min", start: windowStart, end: windowEnd });
  const daily = await fetchSip({ symbol, timeframe: "1Day", start: baseStart, end: windowEnd });
  const baseline5m = await fetchSip({ symbol, timeframe: "5Min", start: baseStart, end: windowEnd });
  return { oneMinute, daily, baseline5m };
}

const ALL_LEGS: Leg[] = [];
const SKIPPED: string[] = [];
const BUCKETS: Record<string, Bucket> = {};

function stats(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], p25: q(0.25), med: q(0.5), p75: q(0.75), max: s[s.length - 1] };
}
function line(label: string, xs: number[], gate?: number) {
  const st = stats(xs);
  if (!st) { console.log(`  ${label.padEnd(14)} n=0   (no measured readings)`); return; }
  const clearing = gate === undefined ? "" :
    `   >= ${gate}: ${xs.filter((v) => v >= gate).length}/${st.n} (${((xs.filter((v) => v >= gate).length / st.n) * 100).toFixed(0)}%)`;
  console.log(
    `  ${label.padEnd(14)} n=${String(st.n).padEnd(4)} min ${n(st.min)}  p25 ${n(st.p25)}  ` +
    `med ${n(st.med)}  p75 ${n(st.p75)}  max ${n(st.max)}${clearing}`
  );
}

async function main(): Promise<void> {
  const loaded = loadEnvLocal();
  console.log(`Env: ${loaded.filter((k) => /ALPACA/i.test(k)).join(", ")} (names only)`);
  console.log(`Detector byte-unchanged from fa45007. Measurement only — nothing tuned.\n`);

  // Trading days come from real SPY daily bars, not a hand-made calendar,
  // so holidays and early closes are whatever the tape actually did.
  const windowEnd = `${ANCHOR_DATE}T23:59:59Z`;
  const calendarStart = new Date(Date.parse(`${ANCHOR_DATE}T00:00:00Z`) - 70 * 86400_000).toISOString();
  const spyDaily = await fetchSip({ symbol: "SPY", timeframe: "1Day", start: calendarStart, end: windowEnd });
  const tradingDays = spyDaily.map((c) => etDate(c.time)).filter((d) => d <= ANCHOR_DATE);
  const dates = tradingDays.slice(-SESSION_COUNT);

  const calibration = dates.slice(0, CALIBRATION_COUNT);
  const evaluation = dates.slice(CALIBRATION_COUNT);
  console.log(`SESSION SET — ${dates.length} trading days ending ${ANCHOR_DATE}`);
  console.log(`  CALIBRATION (${calibration.length} oldest): ${calibration.join(", ")}`);
  console.log(`  EVALUATION  (${evaluation.length} newest): ${evaluation.join(", ")}`);
  console.log(`  Split decided mechanically BEFORE any result was inspected.\n`);

  const windowStart = `${dates[0]}T08:00:00Z`;
  const baseStart = new Date(Date.parse(windowStart) - 40 * 86400_000).toISOString();

  for (const symbol of SYMBOLS) {
    let data: SymbolData;
    try {
      data = await loadSymbol(symbol, windowStart, windowEnd, baseStart);
    } catch (e) {
      SKIPPED.push(`${symbol} ALL DATES (${e instanceof Error ? e.message : "error"})`);
      continue;
    }

    const byDate = new Map<string, Candle[]>();
    for (const c of data.oneMinute) {
      const d = etDate(c.time);
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push(c);
    }

    // Volume baseline indexed once per symbol: minute-of-day -> prior sessions.
    // Each date then slices this rather than rescanning every 5m bar.
    const baselineIndex = new Map<number, { date: string; volume: number }[]>();
    for (const c of data.baseline5m) {
      const { date: d, minutes: m } = et(c.time);
      if (!baselineIndex.has(m)) baselineIndex.set(m, []);
      baselineIndex.get(m)!.push({ date: d, volume: c.volume });
    }

    for (const date of dates) {
      const set: "CAL" | "EVAL" = calibration.includes(date) ? "CAL" : "EVAL";
      const dayBars = byDate.get(date) ?? [];
      const pre = dayBars.filter(isPre);
      const reg1 = dayBars.filter(isReg);
      const reg5 = aggregate5m(reg1);

      if (reg5.length < 5 || pre.length === 0) {
        SKIPPED.push(`${symbol} ${date} (regular5m=${reg5.length}, premarket1m=${pre.length})`);
        continue;
      }

      const pmHigh = Math.max(...pre.map((c) => c.high));
      const pmLow = Math.min(...pre.map((c) => c.low));

      const preAtr = latestValid(calculateAtr(aggregate5m(pre), 14));
      const pmBase = preAtr !== null && pre.length >= 10
        ? detectHeldBaseOrigin({
            oneMinute: pre, fiveMinute: aggregate5m(pre), direction: "bullish",
            atr5m: preAtr, levels: [{ name: "Premarket high", price: pmHigh, availableFrom: null }],
            config: defaultTrendScannerConfig,
          }).origin?.price ?? null
        : null;

      const dailyUpTo = data.daily.filter((c) => etDate(c.time) <= date);
      const today = dailyUpTo[dailyUpTo.length - 1];
      const prevClose = dailyUpTo.length >= 2 ? dailyUpTo[dailyUpTo.length - 2].close : null;
      const prior = dailyUpTo.length >= 2 ? dailyUpTo[dailyUpTo.length - 2] : null;
      const bucket = today ? classify(today, prevClose) : "chop";
      BUCKETS[`${symbol} ${date}`] = bucket;

      const baselineByMinute: Record<number, number> = {};
      for (const m of new Set(reg5.map((c) => etMinutes(c.time)))) {
        const priorVols = (baselineIndex.get(m) ?? [])
          .filter((e) => e.date < date)
          .map((e) => e.volume);
        const med = median(priorVols);
        if (med !== null && med > 0) baselineByMinute[m] = med;
      }

      const session: SyntheticSession = {
        symbol, tradingDate: date, synthetic: false,
        oneMinute: reg1, fiveMinute: reg5, daily: dailyUpTo,
        premarketHigh: pmHigh, premarketLow: pmLow,
        previousDayHigh: prior?.high ?? pmHigh, previousDayLow: prior?.low ?? pmLow,
        oneMinuteVolumeBaseline: 0, fiveMinuteVolumeBaseline: 0,
        fiveMinuteBaselineByMinute: baselineByMinute,
      };

      for (const dir of ["bullish", "bearish"] as TrendDirection[]) {
        const out = replaySession({
          session, direction: dir, config: defaultTrendScannerConfig,
          dataSource: "provider", feedLabel: "SIP — full-market coverage",
        });
        ALL_LEGS.push(...measureLegs(out, symbol, date, dir, set, bucket, pmBase, pmHigh));
      }
    }
    await sleep(400); // stay comfortably inside the free-tier request budget
  }

  // ----------------------------- REPORT -----------------------------
  for (const setName of ["CAL", "EVAL"] as const) {
    const legs = ALL_LEGS.filter((l) => l.set === setName);
    const title = setName === "CAL" ? "CALIBRATION (10 oldest dates)" : "EVALUATION (5 newest dates — HOLDOUT)";
    console.log(`\n${"=".repeat(74)}\n${title} — ${legs.length} legs\n${"=".repeat(74)}`);

    console.log(`\nRELATIVE VOLUME BY STAGE (real SIP, full-market)`);
    const gate = defaultTrendScannerConfig.levelBreakRelativeVolume;
    line("tap1", legs.map((l) => l.tap1RelVol).filter((v): v is number => v !== null), gate);
    line("confirmed", legs.map((l) => l.confirmedRelVol).filter((v): v is number => v !== null), gate);
    line("level_break", legs.flatMap((l) => l.levelBreakRelVols).filter((v) => Number.isFinite(v)), gate);

    console.log(`\nMAX MOVE PER LEG BY ANCHOR (%) — for rescaling the milestone ladder`);
    line("trendOrigin", legs.map((l) => l.maxFromOrigin).filter((v): v is number => v !== null));
    line("premarketBase", legs.map((l) => l.maxFromPmBase).filter((v): v is number => v !== null));
    line("premarketHigh", legs.map((l) => l.maxFromPmHigh).filter((v): v is number => v !== null));

    console.log(`\nMILESTONE LADDER REACHABILITY (max move >= each rung)`);
    for (const [label, key] of [["trendOrigin", "maxFromOrigin"], ["premarketBase", "maxFromPmBase"], ["premarketHigh", "maxFromPmHigh"]] as const) {
      const vals = legs.map((l) => l[key]).filter((v): v is number => v !== null);
      const cells = defaultTrendScannerConfig.percentMilestones.map(
        (m) => `${m}%: ${vals.filter((v) => v >= m).length}`
      );
      console.log(`  ${label.padEnd(14)} of ${String(vals.length).padEnd(4)} legs   ${cells.join("   ")}`);
    }

    const bs = legs.reduce((a, l) => ({
      c: a.c + l.blueSkyCandidates, g: a.g + l.blueSkyGated, f: a.f + l.blueSkyWouldFire,
    }), { c: 0, g: 0, f: 0 });
    console.log(`\nBLUE-SKY: ${bs.c} candidates, ${bs.g} gated by volume, ${bs.f} would fire`);

    const byBucket: Record<string, number> = {};
    for (const l of legs) byBucket[l.bucket] = (byBucket[l.bucket] ?? 0) + 1;
    console.log(`LEGS BY CONDITION: ${Object.entries(byBucket).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
  }

  const sessionBuckets: Record<string, number> = {};
  for (const b of Object.values(BUCKETS)) sessionBuckets[b] = (sessionBuckets[b] ?? 0) + 1;
  console.log(`\n${"=".repeat(74)}\nSESSIONS BY CONDITION BUCKET (from daily bars only)\n${"=".repeat(74)}`);
  for (const [k, v] of Object.entries(sessionBuckets).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(14)} ${v}`);
  }
  console.log(`  total sessions replayed: ${Object.keys(BUCKETS).length}`);

  console.log(`\nSKIPPED (SIP could not serve — nothing fabricated): ${SKIPPED.length}`);
  for (const s of SKIPPED.slice(0, 20)) console.log(`  ${s}`);
  if (SKIPPED.length > 20) console.log(`  ... and ${SKIPPED.length - 20} more`);

  console.log(`\nSIP requests issued: ${requestCount}`);
}

main().catch((e) => {
  console.error(`SWEEP FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
