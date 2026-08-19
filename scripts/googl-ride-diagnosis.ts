/**
 * READ-ONLY tape walk for ONE window of one session.
 *
 *   npx tsx scripts/googl-ride-diagnosis.ts --symbol GOOGL --date 2026-08-04 \
 *     --from 11:00 --to 15:00
 *
 * Prints completed 5m bars with confirmed swing structure so a re-entry
 * can be located by hand against the owner's model. Imports nothing from
 * the detector except the pivot helper it already uses. Writes nothing,
 * persists nothing, changes no config, no SIP->IEX fallback.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Candle } from "../types/candle";
import { findPivots } from "../lib/indicators/pivots";

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
function etMin(t: number): number {
  const f = ET_FMT.formatToParts(new Date(t * 1000));
  return Number(f.find((p) => p.type === "hour")?.value ?? "0") * 60 +
    Number(f.find((p) => p.type === "minute")?.value ?? "0");
}
const etLabel = (t: number) => {
  const m = etMin(t);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

function agg5(one: Candle[]): Candle[] {
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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (k: string) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const symbol = (get("symbol") ?? "GOOGL").toUpperCase();
  const date = get("date") ?? "2026-08-04";
  const parseHM = (s: string) => Number(s.split(":")[0]) * 60 + Number(s.split(":")[1]);
  const from = parseHM(get("from") ?? "11:00");
  const to = parseHM(get("to") ?? "15:00");

  loadEnvLocal();
  console.log(`Env loaded (names only). Observation only — no detector code changed.\n`);

  const one = await fetchSip({ symbol, timeframe: "1Min", start: `${date}T08:00:00Z`, end: `${date}T23:59:59Z` });
  const reg1 = one.filter((c) => etMin(c.time) >= 570 && etMin(c.time) < 960);
  const reg5 = agg5(reg1);

  // Confirmed pivots on the WHOLE regular session, pivotLength 3, the
  // same helper and length the detector uses.
  const pivots = findPivots(reg5, 3);
  const pivotAt = new Map<number, string>();
  for (const p of pivots) {
    const bar = reg5[p.index];
    if (!bar) continue;
    const confirmIdx = p.index + 3;
    const confirmedAt = reg5[confirmIdx] ? etLabel(reg5[confirmIdx].time) : "unconfirmed";
    pivotAt.set(
      bar.time,
      `${p.type === "high" ? "SWING HIGH" : "swing low "} ${p.price.toFixed(2)} (confirmed ${confirmedAt})`
    );
  }

  console.log(`=== ${symbol} ${date} — completed 5m bars ${get("from") ?? "11:00"}-${get("to") ?? "15:00"} ET ===`);
  console.log(`  time     open    high     low   close      structure`);
  const window = reg5.filter((c) => etMin(c.time) >= from && etMin(c.time) <= to);
  for (const c of window) {
    console.log(
      `  ${etLabel(c.time)}  ${c.open.toFixed(2)}  ${c.high.toFixed(2)}  ${c.low.toFixed(2)}  ${c.close.toFixed(2)}` +
        `   ${pivotAt.get(c.time) ?? ""}`
    );
  }

  const lows = window.map((c) => c.low);
  const lowBar = window[lows.indexOf(Math.min(...lows))];
  const highs = window.map((c) => c.high);
  const highBar = window[highs.indexOf(Math.max(...highs))];
  console.log(`\n  window low  ${lowBar.low.toFixed(2)} @ ${etLabel(lowBar.time)}`);
  console.log(`  window high ${highBar.high.toFixed(2)} @ ${etLabel(highBar.time)}`);
}

main().catch((e) => {
  console.error(`DIAGNOSIS FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
