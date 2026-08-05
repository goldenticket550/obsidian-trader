/**
 * READ-ONLY probe: does the free tier serve HISTORICAL SIP bars?
 *
 *   npx tsx scripts/probe-sip-access.ts --date 2026-08-03
 *
 * Alpaca's Market Data FAQ states that for historical queries the `end`
 * parameter must be at least 15 minutes old to query SIP without a
 * subscription. The repository's own provider sets `start` but NEVER
 * `end`, so every existing call looks like a recent-data request to
 * Alpaca — which is exactly what a restricted SIP request looks like.
 * This probe therefore sets BOTH explicitly.
 *
 * Writes nothing, persists nothing, changes no config, and never prints
 * credential values. Deliberately few requests: the free tier is limited
 * to roughly 200 requests/minute and this must not hammer it.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "https://data.alpaca.markets/v2";

/** Loads .env.local without printing or returning any value. */
function loadEnvLocal(): string[] {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return [];
  const loaded: string[] = [];
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded.push(key);
    }
  }
  return loaded;
}

interface Bar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n?: number;
}

interface FetchOutcome {
  ok: boolean;
  /** Safe category only — never a body that could echo credentials. */
  errorCategory: string | null;
  status: number | null;
  bars: Bar[];
  pages: number;
  /** Whatever the response said the feed was, when it says so. */
  reportedFeed: string | null;
}

async function fetchBars(args: {
  symbol: string;
  timeframe: string;
  feed: "sip" | "iex";
  start: string;
  end: string;
  adjustment: string;
  maxPages?: number;
}): Promise<FetchOutcome> {
  const keyId = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  if (!keyId || !secret) {
    return {
      ok: false,
      errorCategory: "missing_credentials",
      status: null,
      bars: [],
      pages: 0,
      reportedFeed: null,
    };
  }

  const bars: Bar[] = [];
  let pageToken: string | null = null;
  let pages = 0;
  let reportedFeed: string | null = null;
  const maxPages = args.maxPages ?? 6;

  do {
    const url = new URL(`${BASE}/stocks/${args.symbol}/bars`);
    url.searchParams.set("timeframe", args.timeframe);
    url.searchParams.set("feed", args.feed);
    url.searchParams.set("adjustment", args.adjustment);
    // BOTH bounds explicit. `end` is what decides whether Alpaca treats
    // this as a historical (allowed) or recent (restricted) SIP query.
    url.searchParams.set("start", args.start);
    url.searchParams.set("end", args.end);
    url.searchParams.set("limit", "10000");
    if (pageToken) url.searchParams.set("page_token", pageToken);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          "APCA-API-KEY-ID": keyId,
          "APCA-API-SECRET-KEY": secret,
        },
      });
    } catch {
      return {
        ok: false,
        errorCategory: "network_error",
        status: null,
        bars,
        pages,
        reportedFeed,
      };
    }

    if (!response.ok) {
      // Category only. Alpaca's 403 for an unsubscribed SIP request is
      // the specific signal this probe exists to detect.
      const category =
        response.status === 403
          ? "forbidden_subscription_required"
          : response.status === 401
          ? "unauthorized_bad_credentials"
          : response.status === 429
          ? "rate_limited"
          : `http_${response.status}`;
      return { ok: false, errorCategory: category, status: response.status, bars, pages, reportedFeed };
    }

    const json = (await response.json()) as {
      bars?: Bar[] | null;
      next_page_token?: string | null;
      // Some Alpaca responses echo the feed used.
      feed?: string;
    };
    if (json.feed) reportedFeed = json.feed;
    if (json.bars) bars.push(...json.bars);
    pageToken = json.next_page_token ?? null;
    pages += 1;
  } while (pageToken && pages < maxPages);

  return { ok: true, errorCategory: null, status: 200, bars, pages, reportedFeed };
}

/** Eastern minute-of-day, DST-aware, for session bucketing. */
function easternParts(iso: string): { minutes: number; label: string } {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { minutes: hh * 60 + mm, label: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` };
}

const PRE_OPEN = 4 * 60;
const REG_OPEN = 9 * 60 + 30;
const REG_CLOSE = 16 * 60;

function summarise(bars: Bar[]) {
  let pre = 0;
  let regular = 0;
  let after = 0;
  let regularVolume = 0;
  let tradeCount = 0;
  for (const b of bars) {
    const { minutes } = easternParts(b.t);
    if (minutes >= PRE_OPEN && minutes < REG_OPEN) pre += 1;
    else if (minutes >= REG_OPEN && minutes < REG_CLOSE) {
      regular += 1;
      regularVolume += b.v;
    } else after += 1;
    if (typeof b.n === "number") tradeCount += b.n;
  }
  return { pre, regular, after, regularVolume, tradeCount };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (n: string) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const date = get("date") ?? "2026-08-03";
  const symbols = (get("symbols") ?? "NVDA,GOOGL").split(",");

  const loaded = loadEnvLocal();
  console.log(`\n=== FREE HISTORICAL SIP PROBE — ${date} ===`);
  console.log(
    `Env loaded from .env.local: ${loaded.length} key(s)` +
      ` [${loaded.filter((k) => /ALPACA/i.test(k)).join(", ")}]  (names only)`
  );

  // Full extended session in UTC. 4:00 ET -> 20:00 ET during EDT.
  const start = `${date}T08:00:00Z`;
  const end = `${date}T23:59:59Z`;
  const ageMinutes = Math.round((Date.now() - Date.parse(end)) / 60000);
  console.log(`Window: start=${start} end=${end}`);
  console.log(
    `\`end\` is ${ageMinutes} minutes old — the FAQ requires >= 15 for unsubscribed SIP.` +
      (ageMinutes >= 15 ? " OK." : " TOO RECENT — this would be restricted.")
  );
  console.log(`Adjustment mode requested: raw\n`);

  for (const symbol of symbols) {
    console.log(`--- ${symbol} ---`);

    const sip = await fetchBars({
      symbol,
      timeframe: "1Min",
      feed: "sip",
      start,
      end,
      adjustment: "raw",
    });

    if (!sip.ok) {
      console.log(`  SIP 1Min: FAILED (${sip.errorCategory}, status ${sip.status})`);
    } else {
      const s = summarise(sip.bars);
      const first = sip.bars[0];
      const last = sip.bars[sip.bars.length - 1];
      console.log(
        `  SIP 1Min: ${sip.bars.length} bars over ${sip.pages} page(s)` +
          (sip.reportedFeed ? ` [response feed: ${sip.reportedFeed}]` : " [response did not echo feed]")
      );
      console.log(
        `    sessions: ${s.pre} premarket, ${s.regular} regular, ${s.after} after-hours`
      );
      if (first && last) {
        console.log(
          `    first ${first.t} (${easternParts(first.t).label} ET)  last ${last.t} (${easternParts(last.t).label} ET)`
        );
      }
      console.log(`    regular-session volume: ${s.regularVolume.toLocaleString()}`);
      console.log(
        `    trade count (n): ${s.tradeCount > 0 ? s.tradeCount.toLocaleString() : "not provided"}`
      );
    }

    // IEX comparison on the SAME window, for a like-for-like difference.
    const iex = await fetchBars({
      symbol,
      timeframe: "1Min",
      feed: "iex",
      start,
      end,
      adjustment: "raw",
    });
    if (!iex.ok) {
      console.log(`  IEX 1Min: FAILED (${iex.errorCategory}, status ${iex.status})`);
    } else {
      const s = summarise(iex.bars);
      console.log(`  IEX 1Min: ${iex.bars.length} bars, ${s.pre} premarket, ${s.regular} regular`);
      console.log(`    regular-session volume: ${s.regularVolume.toLocaleString()}`);
    }

    if (sip.ok && iex.ok) {
      const sv = summarise(sip.bars).regularVolume;
      const iv = summarise(iex.bars).regularVolume;
      const ratio = iv > 0 ? sv / iv : null;
      console.log(
        `  SIP/IEX regular-volume ratio: ${ratio === null ? "n/a" : ratio.toFixed(1) + "x"}` +
          "  (a difference is consistent with, but not proof of, provenance)"
      );
      console.log(
        `  bar-count difference: SIP ${sip.bars.length} vs IEX ${iex.bars.length}`
      );
    }
    console.log("");
  }

  console.log(
    "No fallback was performed: a failed SIP request is reported as failed, never\n" +
      "silently replaced with IEX. Nothing was written, cached, or committed.\n"
  );
}

main().catch((err) => {
  // Message only — never a stack that could contain a header value.
  console.error(`PROBE FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
