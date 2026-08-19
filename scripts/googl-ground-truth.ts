/**
 * READ-ONLY ground-truth check for ONE symbol/session.
 *
 *   npx tsx scripts/googl-ground-truth.ts --symbol GOOGL --date 2026-08-04
 *
 * Answers: where does the detector anchor trendOrigin, when does it fire,
 * and how much of the actual swing did it capture. Detector imported
 * unchanged from fa45007. Writes nothing, persists nothing, no SIP->IEX
 * fallback. Unmeasurable values print as `null`, never 0.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Candle } from "../types/candle";
import { defaultTrendScannerConfig } from "../lib/trend/config";
import { replaySession } from "../lib/trend/replay";
import { computeTrendFacts } from "../lib/trend/facts";
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) {
      process.env[k] = v;
      loaded.push(k);
    }
  }
  return loaded;
}

interface RawBar { t: string; o: number; h: number; l: number; c: number; v: number }

async function fetchSip(a: { symbol: string; timeframe: string; start: string; end: string }): Promise<Candle[]> {
  const keyId = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  if (!keyId || !secret) throw new Error("missing_credentials");
  const out: Candle[] = [];
  let token: string | null = null;
  let pages = 0;
  do {
    const u = new URL(`${BASE}/stocks/${a.symbol}/bars`);
    u.searchParams.set("timeframe", a.timeframe);
    u.searchParams.set("feed", "sip");
    u.searchParams.set("adjustment", "raw");
    u.searchParams.set("start", a.start);
    u.searchParams.set("end", a.end);
    u.searchParams.set("limit", "10000");
    if (token) u.searchParams.set("page_token", token);
    const r = await fetch(u, { headers: { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secret } });
    if (!r.ok) throw new Error(`sip_request_failed_http_${r.status}`);
    const j = (await r.json()) as { bars?: RawBar[] | null; next_page_token?: string | null };
    for (const b of j.bars ?? []) {
      out.push({ time: Math.floor(Date.parse(b.t) / 1000), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v });
    }
    token = j.next_page_token ?? null;
    pages += 1;
  } while (token && pages < 6);
  return out;
}

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
});
const ET_CACHE = new Map<number, number>();
function etMinutes(t: number): number {
  const hit = ET_CACHE.get(t);
  if (hit !== undefined) return hit;
  const f = ET_FMT.formatToParts(new Date(t * 1000));
  const v =
    Number(f.find((p) => p.type === "hour")?.value ?? "0") * 60 +
    Number(f.find((p) => p.type === "minute")?.value ?? "0");
  ET_CACHE.set(t, v);
  return v;
}
const etLabel = (t: number) => {
  const m = etMinutes(t);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
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
    time,
    open: bs[0].open,
    high: Math.max(...bs.map((z) => z.high)),
    low: Math.min(...bs.map((z) => z.low)),
    close: bs[bs.length - 1].close,
    volume: bs.reduce((a, z) => a + z.volume, 0),
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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (k: string) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const symbol = (get("symbol") ?? "GOOGL").toUpperCase();
  const date = get("date") ?? "2026-08-04";
  const noPremarket = argv.includes("--no-premarket");
  const DIR: TrendDirection = (get("direction") ?? "bullish") === "bearish" ? "bearish" : "bullish";
  const BULL = DIR === "bullish";

  const loaded = loadEnvLocal();
  console.log(`Env: ${loaded.filter((k) => /ALPACA/i.test(k)).join(", ")} (names only)`);
  console.log(`Detector byte-unchanged from fa45007. Observation only.\n`);

  const dayStart = `${date}T08:00:00Z`;
  const dayEnd = `${date}T23:59:59Z`;
  const baseStart = new Date(Date.parse(dayStart) - 35 * 86400_000).toISOString();

  const one = await fetchSip({ symbol, timeframe: "1Min", start: dayStart, end: dayEnd });
  const daily = await fetchSip({ symbol, timeframe: "1Day", start: baseStart, end: dayEnd });
  const base5 = await fetchSip({ symbol, timeframe: "5Min", start: baseStart, end: `${date}T00:00:00Z` });

  const pre1 = one.filter(isPre);
  const reg1 = one.filter(isReg);
  const reg5 = aggregate5m(reg1);
  if (pre1.length === 0 || reg5.length < 5) {
    console.log(`Cannot replay: insufficient real data. Nothing substituted.`);
    return;
  }

  const pmHigh = Math.max(...pre1.map((c) => c.high));
  const pmLow = Math.min(...pre1.map((c) => c.low));
  const pmLowBar = pre1.find((c) => c.low === pmLow)!;

  // ---- what the tape actually did ----
  const regLow = Math.min(...reg1.map((c) => c.low));
  const regHigh = Math.max(...reg1.map((c) => c.high));
  const regLowBar = reg1.find((c) => c.low === regLow)!;
  const regHighBar = reg1.find((c) => c.high === regHigh)!;
  const openPx = reg1[0].open;

  console.log(`=== ${symbol} ${date} — WHAT THE TAPE DID (real SIP) ===`);
  console.log(`  premarket   low  ${n(pmLow)} @ ${etLabel(pmLowBar.time)}   high ${n(pmHigh)}`);
  console.log(`  regular open     ${n(openPx)} @ ${etLabel(reg1[0].time)}`);
  console.log(`  regular     low  ${n(regLow)} @ ${etLabel(regLowBar.time)}`);
  console.log(`  regular     high ${n(regHigh)} @ ${etLabel(regHighBar.time)}`);
  // Reported in the SETUP direction: a bearish day is measured high -> low.
  const moveFrom = (a: number, b: number) => (BULL ? ((b - a) / a) * 100 : ((a - b) / a) * 100);
  console.log(`  DIRECTION UNDER TEST: ${DIR.toUpperCase()}`);
  console.log(`  premarket ${BULL ? "low  -> regular high" : "high -> regular low "} : ${n(moveFrom(BULL ? pmLow : pmHigh, BULL ? regHigh : regLow))}%`);
  console.log(`  regular open -> regular ${BULL ? "high" : "low "} : ${n(moveFrom(openPx, BULL ? regHigh : regLow))}%`);
  console.log(`  regular ${BULL ? "low -> high" : "high -> low"} : ${n(moveFrom(BULL ? regLow : regHigh, BULL ? regHigh : regLow))}%`);

  // Premarket held-base origin, using the SAME Path A detector but fed
  // premarket bars the live detector never sees. Observation only.
  const pmAtr = latestValid(calculateAtr(aggregate5m(pre1), 14));
  const pmBase = pre1.length >= 10 && pmAtr !== null
    ? detectHeldBaseOrigin({
        oneMinute: pre1, fiveMinute: aggregate5m(pre1), direction: DIR,
        atr5m: pmAtr,
        levels: [{ name: BULL ? "Premarket high" : "Premarket low", price: BULL ? pmHigh : pmLow, availableFrom: null }],
        config: defaultTrendScannerConfig,
      })
    : null;
  console.log(
    `  premarket ${BULL ? "higher-low" : "lower-high"} base (probe): ` +
      (pmBase?.origin ? `${n(pmBase.origin.price)} locked ${pmBase.origin.establishedAt}` : `null`)
  );

  const prevDaily = daily.filter((c) => new Date(c.time * 1000).toISOString().slice(0, 10) < date);
  const prior = prevDaily[prevDaily.length - 1] ?? null;
  const baselineByMinute: Record<number, number> = {};
  for (const m of new Set(reg5.map((c) => etMinutes(c.time)))) {
    const med = median(base5.filter((c) => etMinutes(c.time) === m).map((c) => c.volume));
    if (med !== null && med > 0) baselineByMinute[m] = med;
  }

  const session: SyntheticSession = {
    symbol, tradingDate: date, synthetic: false,
    oneMinute: reg1, fiveMinute: reg5, daily,
    // --no-premarket reproduces the OLD feed exactly, for an A/B that
    // shows the change is additive on non-gap days.
    premarketOneMinute: noPremarket ? undefined : pre1,
    premarketFiveMinute: noPremarket ? undefined : aggregate5m(pre1),
    premarketHigh: pmHigh, premarketLow: pmLow,
    previousDayHigh: prior?.high ?? pmHigh,
    previousDayLow: prior?.low ?? pmLow,
    oneMinuteVolumeBaseline: 0, fiveMinuteVolumeBaseline: 0,
    fiveMinuteBaselineByMinute: baselineByMinute,
  };

  // ---- which key levels the detector actually tracks ----
  // Mirrors exactly what evaluate.ts does internally: the same Path A on
  // the same premarket-inclusive window, then the same facts assembly.
  {
    const combinedOne = [...pre1, ...reg1];
    const combinedFive = [...aggregate5m(pre1), ...reg5];
    const atr = latestValid(calculateAtr(combinedFive, 14));
    const baseLevels = [
      { name: "Premarket high", price: pmHigh, availableFrom: null },
      { name: "Premarket low", price: pmLow, availableFrom: null },
      { name: "Previous-day high", price: prior?.high ?? pmHigh, availableFrom: null },
      { name: "Previous-day low", price: prior?.low ?? pmLow, availableFrom: null },
    ];
    const attempt = detectHeldBaseOrigin({
      oneMinute: combinedOne.filter((c) => c.time <= reg5[0].time + 300),
      fiveMinute: combinedFive.filter((c) => c.time <= reg5[0].time),
      direction: DIR, atr5m: atr, levels: baseLevels,
      config: defaultTrendScannerConfig,
    });
    const f = computeTrendFacts({
      direction: DIR,
      oneMinute: reg1.slice(0, 30), fiveMinute: reg5.slice(0, 6), daily,
      levels: baseLevels,
      relativeVolume: { multiple: null, dollarMultiple: null, unavailableReason: "n/a", feed: "SIP", partialMarketCoverage: false },
      relativeToBenchmark: null, relativeToSector: null,
      origin: attempt.origin,
      transitions: defaultTrendScannerConfig.higherCloseTransitions,
      pivotLength: 3,
    });
    console.log(`\n=== KEY LEVELS TRACKED (at the 6th regular 5m bar) ===`);
    console.log(`  origin ${n(attempt.origin?.price)} pullbackFrom ${n(attempt.origin?.pullbackFrom ?? null)}`);
    for (const l of f.levels) console.log(`  ${l.name.padEnd(22)} ${n(l.price).padStart(8)}`);
  }

  for (const direction of [DIR] as TrendDirection[]) {
    const out = replaySession({
      session, direction, config: defaultTrendScannerConfig,
      dataSource: "provider", feedLabel: "SIP — full-market coverage",
    });

    console.log(`\n=== ${direction.toUpperCase()} — BAR BY BAR (causal, no lookahead) ===`);
    console.log(`  time    close    stage            origin*  relVol  events / top blocker`);
    let firstFireAt: string | null = null;
    let firstFirePx: number | null = null;

    for (const s of out.steps) {
      const t = Math.floor(Date.parse(s.marketDataAt) / 1000);
      // The origin is not exposed on ReplayStep; derive it EXACTLY from the
      // detector's own fromOriginPct reading. null stays null.
      // Direction-aware: for a short the move is measured origin -> down,
      // so the bullish formula reports a nonsense anchor below price.
      const originPx =
        s.fromOriginPct === null
          ? null
          : BULL
          ? s.price / (1 + s.fromOriginPct / 100)
          : s.price / (1 - s.fromOriginPct / 100);
      const ev = s.transitions.map((x) => `${x.stage}(${x.reason})`).join(" ");
      const blocker = s.blockers.length ? `blocked: ${s.blockers[0].requirement}` : "";
      const milestone = s.milestones.length ? ` MILESTONE ${s.milestones.join(",")}%` : "";
      const line = ev || milestone ? `${ev}${milestone}` : blocker;
      if (s.transitions.length > 0 && firstFireAt === null) {
        firstFireAt = s.marketDataAt;
        firstFirePx = s.price;
      }
      // Print every bar that has an event, plus a periodic heartbeat.
      if (s.transitions.length > 0 || s.milestones.length > 0 || etMinutes(t) % 30 === 0) {
        console.log(
          `  ${etLabel(t)}  ${n(s.price).padStart(7)}  ${s.stage.padEnd(16)} ` +
            `${n(originPx).padStart(7)}  ${n(s.relativeVolume).padStart(5)}   ${line}`
        );
      }
    }
    console.log(`  * origin derived exactly from the detector's own fromOriginPct`);

    // ---- fire census + honest exit-based capture ----
    const fires = out.steps.flatMap((s) =>
      s.transitions
        .filter((t) => t.stage !== "basing" && t.stage !== "failed")
        .map((t) => ({ at: s.marketDataAt, price: s.price, stage: t.stage, reason: t.reason }))
    );
    const exits = out.steps.flatMap((s) =>
      s.transitions.filter((t) => t.stage === "failed").map((t) => ({ at: s.marketDataAt, price: s.price, reason: t.reason }))
    );
    console.log(`\n=== FIRE CENSUS ===`);
    console.log(`  alertable fires (excl. basing/failed): ${fires.length}`);
    for (const f of fires) {
      console.log(`    ${etLabel(Math.floor(Date.parse(f.at) / 1000))}  ${n(f.price)}  ${f.stage}  ${f.reason}`);
    }
    console.log(`  exits: ${exits.length}`);
    for (const e of exits) {
      console.log(`    ${etLabel(Math.floor(Date.parse(e.at) / 1000))}  ${n(e.price)}  ${e.reason}`);
    }

    const firstExit = exits[0] ?? null;
    if (firstFirePx !== null && firstExit !== null) {
      // The origin the detector actually locked, derived from its own
      // fromOriginPct on the first bar that reported one. Never hardcoded.
      const withOrigin = out.steps.find((s2) => s2.fromOriginPct !== null);
      const originPx =
        withOrigin === undefined || withOrigin.fromOriginPct === null
          ? null
          : BULL
          ? withOrigin.price / (1 + withOrigin.fromOriginPct / 100)
          : withOrigin.price / (1 - withOrigin.fromOriginPct / 100);
      const swing = originPx === null ? null : Math.abs((BULL ? regHigh : regLow) - originPx);
      const held = BULL ? firstExit.price - firstFirePx : firstFirePx - firstExit.price;
      console.log(`\n=== HELD FROM ENTRY TO EXIT (signals only, no hindsight) ===`);
      console.log(`  entry ${n(firstFirePx)}  ->  exit ${n(firstExit.price)}  = ${n(held)} pts`);
      console.log(
        `  origin ${n(originPx)} -> session ${BULL ? "high" : "low"} ${n(BULL ? regHigh : regLow)}` +
          ` = ${n(swing)} pts swing;  captured ${swing === null ? "null" : n((held / swing) * 100, 1) + "%"}`
      );
    }

    console.log(`\n=== CAPTURE (hindsight ceiling, for comparison only) ===`);
    if (firstFireAt === null || firstFirePx === null) {
      console.log(`  The detector never fired anything in this direction.`);
    } else {
      const t = Math.floor(Date.parse(firstFireAt) / 1000);
      const afterFire = reg1.filter((c) => c.time >= t);
      const highAfter = afterFire.length
        ? (BULL ? Math.max(...afterFire.map((c) => c.high)) : Math.min(...afterFire.map((c) => c.low)))
        : null;
      console.log(`  first fire            ${etLabel(t)} at ${n(firstFirePx)}`);
      console.log(`  high after first fire ${n(highAfter)}`);
      const swing = BULL ? regHigh - pmLow : pmHigh - regLow;
      const captured = highAfter === null ? null : (BULL ? highAfter - firstFirePx : firstFirePx - highAfter);
      console.log(`  full swing  ${n(pmLow)} -> ${n(regHigh)} = ${n(swing)} pts`);
      console.log(
        `  captured    ${n(firstFirePx)} -> ${n(highAfter)} = ${n(captured)} pts` +
          (captured === null ? "" : `  = ${n((captured / swing) * 100, 1)}% of the swing`)
      );
    }
    console.log(`  final stage: ${out.final.lifecycle.stage}`);
  }
}

main().catch((e) => {
  console.error(`GROUND TRUTH FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
