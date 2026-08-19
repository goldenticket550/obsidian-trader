/**
 * Causal trend replay CLI.
 *
 *   npm run replay:trend -- --symbol NVDA --date 2026-08-03
 *
 * Reveals a session one completed candle at a time and prints every
 * lifecycle transition with its candle timestamp. Persists nothing,
 * emits no alerts, and writes to no database — it is an inspection tool.
 *
 * Uses REAL bars through the existing provider adapter when Alpaca
 * credentials are present. The data source is always printed, and the
 * tool STOPS rather than substituting synthetic data when real data was
 * requested and could not be loaded.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getMarketDataProvider } from "../lib/market-data/providerFactory";
import { defaultTrendScannerConfig } from "../lib/trend/config";
import {
  bearishLifecycleSession,
  bullishLifecycleSession,
  type SyntheticSession,
} from "../lib/trend/fixtures/syntheticSession";
import { loadRealSession } from "../lib/trend/realSession";
import { formatReplayTimeline, replaySession, type ReplayOutcome } from "../lib/trend/replay";
import type { TrendDirection } from "../lib/trend/types";

/**
 * Loads .env.local into process.env exactly as the running app is
 * configured, WITHOUT printing or returning any value. Only names are
 * ever surfaced. Existing process.env wins, so a shell override still
 * takes precedence.
 */
function loadEnvLocal(): string[] {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return [];
  const loaded: string[] = [];

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
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

interface Args {
  symbol: string;
  date: string;
  direction: TrendDirection | "both";
  fixture: string | null;
  allowSynthetic: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | null => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const direction = (get("direction") ?? "both") as Args["direction"];
  if (!["bullish", "bearish", "both"].includes(direction)) {
    throw new Error("--direction must be bullish, bearish or both");
  }
  return {
    symbol: (get("symbol") ?? "NVDA").toUpperCase(),
    date: get("date") ?? new Date().toISOString().slice(0, 10),
    direction,
    fixture: get("fixture"),
    allowSynthetic: argv.includes("--synthetic"),
  };
}

/** Which origin path locked the setup, and at what price. */
function describeOrigin(outcome: ReplayOutcome): string {
  const origin = outcome.final.lifecycle.origin;
  if (origin === null) return "  origin: none locked";
  const path = origin.mode === "held_base" ? "A (held higher-low base)" : "B (momentum expansion)";
  return (
    `  origin: path ${path} @ ${origin.price.toFixed(2)} ` +
    `(locked ${origin.establishedAt}, invalidation ${origin.invalidationPrice.toFixed(2)})`
  );
}

/** Every TAP 2 trigger, named honestly from the recorded transition. */
function describeTap2(outcome: ReplayOutcome): string {
  // From the STEPS, not the final lifecycle: a new setup resets its own
  // transition history, so the final one only holds the last setup.
  const breaks = outcome.steps.flatMap((st) => st.transitions.filter((t) => t.stage === "level_break"));
  if (breaks.length === 0) return "  TAP 2: no break recorded";
  const named = breaks.filter((b) => !/new-high/i.test(b.reason)).length;
  const blueSky = breaks.length - named;
  return `  TAP 2: ${breaks.length} trigger(s) — ${named} named level(s), ${blueSky} new-high continuation(s)`;
}

/** Bars where a volume gate was the ONLY thing holding a stage back. */
function volumeGateReport(outcome: ReplayOutcome): string[] {
  const lines: string[] = [];
  let blockedBars = 0;
  let firstBlocked: string | null = null;
  let unavailableBars = 0;

  for (const step of outcome.steps) {
    const volumeBlockers = step.blockers.filter((b) => /Relative volume/i.test(b.requirement));
    if (volumeBlockers.length === 0) continue;
    if (volumeBlockers.some((b) => /not measurable|baseline/i.test(b.detail))) {
      unavailableBars += 1;
    }
    if (step.blockers.length === volumeBlockers.length) {
      blockedBars += 1;
      firstBlocked ??= step.marketDataAt;
    }
  }

  if (unavailableBars > 0) {
    lines.push(`  volume gate: relative volume UNMEASURABLE on ${unavailableBars} bar(s)`);
  }
  if (blockedBars > 0) {
    lines.push(
      `  volume gate: relative volume was the ONLY blocker on ${blockedBars} bar(s)` +
        (firstBlocked ? `, first at ${firstBlocked}` : "")
    );
  }
  if (lines.length === 0) lines.push("  volume gate: never the sole blocker");
  return lines;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const loadedKeys = loadEnvLocal();

  console.log(
    `\n=== Trend replay: ${args.symbol} ${args.date} ===\n` +
      `Config thresholds are UNVALIDATED starting parameters, not probabilities.`
  );
  // Names only — values are never printed.
  console.log(
    `Env loaded from .env.local: ${loadedKeys.length} key(s)` +
      (loadedKeys.length > 0 ? ` [${loadedKeys.filter((k) => /ALPACA/i.test(k)).join(", ")}]` : "")
  );

  const directions: TrendDirection[] =
    args.direction === "both" ? ["bullish", "bearish"] : [args.direction];

  // ---- JSON fixture path ----
  if (args.fixture) {
    const path = resolve(process.cwd(), args.fixture);
    if (!existsSync(path)) throw new Error(`Fixture not found: ${path}`);
    const session = JSON.parse(readFileSync(path, "utf8")) as SyntheticSession;
    for (const direction of directions) {
      const outcome = replaySession({
        session,
        direction,
        config: defaultTrendScannerConfig,
        dataSource: "json-fixture",
        feedLabel: "JSON fixture",
      });
      console.log("\n" + formatReplayTimeline(outcome));
      console.log(describeOrigin(outcome));
      console.log(describeTap2(outcome));
      volumeGateReport(outcome).forEach((l) => console.log(l));
    }
    return;
  }

  // ---- Explicit synthetic path ----
  if (args.allowSynthetic) {
    for (const direction of directions) {
      const session =
        direction === "bullish"
          ? bullishLifecycleSession(args.symbol, args.date)
          : bearishLifecycleSession(args.symbol, args.date);
      const outcome = replaySession({
        session,
        direction,
        config: defaultTrendScannerConfig,
        dataSource: "synthetic-fixture",
        feedLabel: "Synthetic fixture — not market data",
      });
      console.log("\n" + formatReplayTimeline(outcome));
      console.log(describeOrigin(outcome));
      console.log(describeTap2(outcome));
    }
    return;
  }

  // ---- REAL data path (default) ----
  const hasCredentials =
    !!process.env.ALPACA_API_KEY_ID && !!process.env.ALPACA_API_SECRET_KEY;
  if (!hasCredentials) {
    console.error(
      "\nSTOP: no Alpaca credentials found.\n" +
        "  Missing: ALPACA_API_KEY_ID and/or ALPACA_API_SECRET_KEY in .env.local.\n" +
        "  Supply them, or pass --fixture <path.json> with saved real bars.\n" +
        "  Refusing to fall back to synthetic data for a real-data request."
    );
    process.exitCode = 1;
    return;
  }

  const provider = getMarketDataProvider();
  const load = await loadRealSession({
    provider,
    symbol: args.symbol,
    tradingDate: args.date,
  });

  const d = load.diagnostics;
  const coverage = d.partialMarketCoverage
    ? `${d.feed.toUpperCase()} live — partial-market coverage (volume is NOT total-market)`
    : `${d.feed} — consolidated coverage`;
  console.log(
    `Feed: ${coverage}\n` +
      `Bars: ${d.fiveMinuteBars} regular 5m, ${d.oneMinuteBars} regular 1m, ` +
      `${d.premarketBars} premarket 5m, ${d.dailyBars} daily, ` +
      `${d.baselineSessions} baseline sessions`
  );

  if (load.session === null) {
    console.error(
      `\nSTOP: cannot replay ${args.symbol} on ${args.date} with real data.\n` +
        load.missing.map((m) => `  - ${m}`).join("\n") +
        `\n  Supply a saved JSON fixture of the real bars via --fixture, or a date with data.\n` +
        "  Refusing to fall back to synthetic data."
    );
    process.exitCode = 1;
    return;
  }

  if (load.missing.length > 0) {
    console.log("Partial data (reported, not substituted):");
    load.missing.forEach((m) => console.log(`  - ${m}`));
  }
  console.log(
    `Premarket high ${load.session.premarketHigh.toFixed(2)} / low ${load.session.premarketLow.toFixed(2)} ` +
      `(TAP 2 level), previous day ${load.session.previousDayHigh.toFixed(2)}/${load.session.previousDayLow.toFixed(2)}`
  );

  for (const direction of directions) {
    const outcome = replaySession({
      session: load.session,
      direction,
      config: defaultTrendScannerConfig,
      dataSource: "provider",
      feedLabel: coverage,
    });
    console.log("\n" + formatReplayTimeline(outcome));
    console.log(describeOrigin(outcome));
    console.log(describeTap2(outcome));
    volumeGateReport(outcome).forEach((l) => console.log(l));
  }
}

main().catch((err) => {
  console.error(`\nSTOP: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
