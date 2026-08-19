/**
 * READ-ONLY origin-path trace.
 *
 *   npx tsx scripts/origin-path-diagnosis.ts --symbol MU --date 2026-07-31 \
 *     --direction bearish
 *
 * For each completed regular 5m bar, asks the SAME three origin paths the
 * committed detector asks, with the SAME causal inputs, and prints what
 * each returned and why it refused. Nothing is written, persisted or
 * changed; the detector is imported unchanged. No SIP -> IEX fallback.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Candle } from "../types/candle";
import { defaultTrendScannerConfig } from "../lib/trend/config";
import { detectHeldBaseOrigin, detectMomentumOrigin } from "../lib/trend/origin";
import { calculateAtr } from "../lib/indicators/atr";
import { latestValid } from "../lib/indicators/movingAverages";
import type { KeyLevel, TrendDirection } from "../lib/trend/types";

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
    if (process.env[k] === undefined) { process.env[k] = v; loaded.push(k); }
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

const ET = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
});
const cache = new Map<number, number>();
function etMin(t: number): number {
  const hit = cache.get(t);
  if (hit !== undefined) return hit;
  const f = ET.formatToParts(new Date(t * 1000));
  const v = Number(f.find((p) => p.type === "hour")?.value ?? "0") * 60 +
    Number(f.find((p) => p.type === "minute")?.value ?? "0");
  cache.set(t, v);
  return v;
}
const lbl = (t: number) => `${String(Math.floor(etMin(t) / 60)).padStart(2, "0")}:${String(etMin(t) % 60).padStart(2, "0")}`;

function agg5(one: Candle[]): Candle[] {
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
  const symbol = (get("symbol") ?? "MU").toUpperCase();
  const date = get("date") ?? "2026-07-31";
  const dir: TrendDirection = (get("direction") ?? "bearish") === "bullish" ? "bullish" : "bearish";
  const bars = Number(get("bars") ?? "18");

  loadEnvLocal();
  console.log(`Env loaded (names only). Detector imported unchanged. Observation only.\n`);

  const cfg = defaultTrendScannerConfig;
  const one = await fetchSip({ symbol, timeframe: "1Min", start: `${date}T08:00:00Z`, end: `${date}T23:59:59Z` });
  const daily = await fetchSip({ symbol, timeframe: "1Day", start: new Date(Date.parse(`${date}T08:00:00Z`) - 35 * 86400_000).toISOString(), end: `${date}T23:59:59Z` });
  const base5 = await fetchSip({ symbol, timeframe: "5Min", start: new Date(Date.parse(`${date}T08:00:00Z`) - 35 * 86400_000).toISOString(), end: `${date}T00:00:00Z` });

  const pre1 = one.filter((c) => etMin(c.time) >= 240 && etMin(c.time) < 570);
  const reg1 = one.filter((c) => etMin(c.time) >= 570 && etMin(c.time) < 960);
  const reg5 = agg5(reg1);
  const pre5 = agg5(pre1);

  const pmHigh = pre1.length ? Math.max(...pre1.map((c) => c.high)) : null;
  const pmLow = pre1.length ? Math.min(...pre1.map((c) => c.low)) : null;
  const prevDaily = daily.filter((c) => new Date(c.time * 1000).toISOString().slice(0, 10) < date);
  const prior = prevDaily[prevDaily.length - 1] ?? null;

  const levels: KeyLevel[] = [
    { name: "Premarket high", price: pmHigh ?? NaN, availableFrom: null },
    { name: "Premarket low", price: pmLow ?? NaN, availableFrom: null },
    { name: "Previous-day high", price: prior?.high ?? NaN, availableFrom: null },
    { name: "Previous-day low", price: prior?.low ?? NaN, availableFrom: null },
  ];

  const baselineByMinute: Record<number, number> = {};
  for (const m of new Set(reg5.map((c) => etMin(c.time)))) {
    const med = median(base5.filter((c) => etMin(c.time) === m).map((c) => c.volume));
    if (med !== null && med > 0) baselineByMinute[m] = med;
  }

  console.log(`=== ${symbol} ${date} ${dir.toUpperCase()} — ORIGIN PATH TRACE ===`);
  console.log(`  premarket ${pre1.length} 1m bars, high ${n(pmHigh)} low ${n(pmLow)}`);
  console.log(`  prior day high ${n(prior?.high ?? null)} low ${n(prior?.low ?? null)}`);
  console.log(`  ATR period 14 on 5m => needs 14 completed regular bars = 09:30 + 70min = 10:40 ET\n`);

  console.log(`  time   close   atrREG  atrCOMB  PATH-A(regular)          PATH-A(premkt-incl)      PATH-B(momentum)`);

  for (let i = 0; i < Math.min(bars, reg5.length); i++) {
    const five = reg5.slice(0, i + 1);
    const bar = five[five.length - 1];
    const cutoff = bar.time + 300;
    const oneSoFar = reg1.filter((c) => c.time + 60 <= cutoff);

    // Exactly what evaluate.ts feeds each path.
    const atrReg = latestValid(calculateAtr(five, 14));
    const combined5 = [...pre5, ...five];
    const atrComb = latestValid(calculateAtr(combined5, 14));

    const relVol = (() => {
      const b = baselineByMinute[etMin(bar.time)];
      return b !== undefined && b > 0 ? bar.volume / b : null;
    })();

    const pathA = detectHeldBaseOrigin({
      oneMinute: oneSoFar, fiveMinute: five, direction: dir,
      atr5m: atrReg, levels, config: cfg,
    });

    const pathAPre = pre1.length === 0 || atrComb === null
      ? { origin: null, rejections: ["no_premarket_or_no_atr"], stabilisation: [] }
      : detectHeldBaseOrigin({
          oneMinute: [...pre1, ...oneSoFar], fiveMinute: combined5, direction: dir,
          atr5m: atrComb, levels, config: cfg,
        });

    const pathB = detectMomentumOrigin({
      oneMinute: oneSoFar, fiveMinute: five, direction: dir,
      atr5m: atrReg, levels, relativeVolume: relVol, config: cfg,
    });

    const fmt = (a: { origin: { price: number } | null; rejections: string[] }) =>
      a.origin !== null ? `LOCK ${a.origin.price.toFixed(2)}`.padEnd(24) : a.rejections.slice(0, 2).join(",").padEnd(24);

    console.log(
      `  ${lbl(bar.time)}  ${n(bar.close).padStart(7)}  ${n(atrReg).padStart(6)}  ${n(atrComb).padStart(7)}  ` +
        `${fmt(pathA)} ${fmt(pathAPre)} ${fmt(pathB)}`
    );
  }

  console.log(`\n  (PATH-A premkt-incl mirrors Fix #1: it still has to pass the`);
  console.log(`   locked-before-the-bell and still-holding guards inside evaluate.ts)`);
}

main().catch((e) => {
  console.error(`DIAGNOSIS FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
