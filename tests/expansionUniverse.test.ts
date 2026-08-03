import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  scanWatchlistWithProvider,
  resetExpansionBaselineCache,
  type WatchedSymbol,
} from "@/lib/scanner/scanService";
import { defaultStrategyConfig, type StrategyConfig } from "@/lib/strategies/config";
import {
  normalizeExpansionUniverse,
  validateExpansionUniverse,
} from "@/lib/strategies/expansionUniverseConfig";
import { normalizeAndValidateStrategyConfig } from "@/lib/strategies/reclaimContinuationConfig";
import {
  FixtureProvider,
  standardFixtures,
  SCAN_NOW,
  ORDINARY,
} from "./support/expansionScanFixture";

/**
 * TWO SYMBOL UNIVERSES.
 *
 * The EXPANSION side (Premarket Expansion + Monitor + Live Leaders) scans
 * the expansion universe. The SETUPS side (reversal scoring + Reclaim)
 * scans the watchlist. This file is entirely about WHICH symbols feed
 * which computation — never about how any computation works.
 */

beforeEach(() => {
  resetExpansionBaselineCache();
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const WATCH: WatchedSymbol[] = [
  { symbol: "MSTR", exchange: "NASDAQ" },
  { symbol: "NVDA", exchange: "NASDAQ" },
];
const UNIVERSE: WatchedSymbol[] = [
  { symbol: "SPY", exchange: "NYSE" },
  { symbol: "NVDA", exchange: "NASDAQ" },
];

/** Every symbol above resolves to a real fixture, plus the benchmark. */
function provider() {
  return new FixtureProvider(
    standardFixtures({ MSTR: ORDINARY, NVDA: ORDINARY, SPY: ORDINARY })
  );
}

function scan(p = provider(), config: StrategyConfig = defaultStrategyConfig) {
  return scanWatchlistWithProvider(WATCH, p, config, SCAN_NOW, undefined, UNIVERSE);
}

// ---------------------------------------------------------------------------
// The split
// ---------------------------------------------------------------------------

describe("universe split", () => {
  it("runs Expansion on the expansion universe, not the watchlist", async () => {
    const result = await scan();

    // Precondition: the two lists genuinely differ, so this cannot pass
    // by the lists happening to be identical.
    expect(WATCH.map((s) => s.symbol)).not.toEqual(UNIVERSE.map((s) => s.symbol));

    const expansionKeys = Object.keys(result.expansionBySymbol!).sort();
    expect(expansionKeys).toEqual(["NVDA", "SPY"]);
    // A watchlist-only name is NOT evaluated for expansion.
    expect(expansionKeys).not.toContain("MSTR");
  });

  it("runs setups and Reclaim on the watchlist, not the expansion universe", async () => {
    const result = await scan();

    expect(Object.keys(result.resultsBySymbol).sort()).toEqual(["MSTR", "NVDA"]);
    expect(Object.keys(result.reclaimBySymbol!).sort()).toEqual(["MSTR", "NVDA"]);
    // An expansion-only name is NOT scored or Reclaim-evaluated.
    expect(result.resultsBySymbol.SPY).toBeUndefined();
    expect(result.reclaimBySymbol!.SPY).toBeUndefined();
    expect(result.watchlist.map((w) => w.ticker).sort()).toEqual(["MSTR", "NVDA"]);
  });

  it("keeps an overlapping symbol in BOTH outputs", async () => {
    const result = await scan();
    expect(result.expansionBySymbol!.NVDA).toBeDefined();
    expect(result.resultsBySymbol.NVDA).toBeDefined();
    expect(result.reclaimBySymbol!.NVDA).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Union fetch
// ---------------------------------------------------------------------------

describe("union fetch", () => {
  it("fetches an overlapping symbol once, not once per list", async () => {
    const p = provider();
    await scan(p);

    // NVDA is in both lists. Every timeframe it needs is requested once.
    const nvda = p.callsFor("NVDA");
    const byTimeframe = nvda.reduce<Record<string, number>>((acc, c) => {
      const key = `${c.timeframe}:${c.sessionScope ?? "regular"}:${(c.sessionCount ?? 1) > 1 ? "multi" : "single"}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    for (const [key, count] of Object.entries(byTimeframe)) {
      expect(`${key}=${count}`).toBe(`${key}=1`);
    }
  });

  it("visits each symbol in the union exactly once", async () => {
    const p = provider();
    await scan(p);
    // Three distinct names across two lists of two.
    const scanned = new Set(p.calls.map((c) => c.symbol));
    expect([...scanned].filter((s) => s !== "QQQ").sort()).toEqual(["MSTR", "NVDA", "SPY"]);
  });

  it("never requests 15m bars for an expansion-only symbol", async () => {
    const p = provider();
    await scan(p);

    // 15m feeds only the reversal scorer, which does not run for SPY.
    expect(p.callsFor("SPY").filter((c) => c.timeframe === "15m")).toHaveLength(0);
    // ...and still does for a watchlist symbol.
    expect(p.callsFor("MSTR").filter((c) => c.timeframe === "15m")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Degradation
// ---------------------------------------------------------------------------

describe("a symbol with no bars", () => {
  it("degrades to unavailable without breaking the scan", async () => {
    // An unknown symbol: FixtureProvider serves an empty candle series,
    // which is what an index like SPX looks like on a provider that does
    // not carry it.
    const p = new FixtureProvider(standardFixtures({ MSTR: ORDINARY, NVDA: ORDINARY }));
    const result = await scanWatchlistWithProvider(
      WATCH,
      p,
      defaultStrategyConfig,
      SCAN_NOW,
      undefined,
      [{ symbol: "SPX", exchange: "INDEX" }]
    );

    // The scan itself survives, and the SETUPS side is untouched.
    expect(Object.keys(result.resultsBySymbol).sort()).toEqual(["MSTR", "NVDA"]);
    expect(result.watchlist).toHaveLength(2);

    // SPX produced no expansion result, and said so rather than throwing
    // or inventing one. Whichever way it is reported, it is never a
    // fabricated candidate.
    const spxExpansion = result.expansionBySymbol?.SPX;
    if (spxExpansion) {
      expect(spxExpansion.bullish.qualified).toBe(false);
      expect(spxExpansion.bearish.qualified).toBe(false);
    }
    // It never reaches the setups side at all.
    expect(result.resultsBySymbol.SPX).toBeUndefined();
    expect(result.reclaimBySymbol?.SPX).toBeUndefined();
  });

  it("isolates an expansion-only symbol whose provider call throws", async () => {
    // The other possibility for an index the provider does not carry: it
    // rejects the request outright rather than returning empty bars.
    // Either way the scan must survive and the setups side must be whole.
    const p = new FixtureProvider(
      standardFixtures({ MSTR: ORDINARY, NVDA: ORDINARY, SPX: { failsEntirely: true } })
    );
    const result = await scanWatchlistWithProvider(
      WATCH,
      p,
      defaultStrategyConfig,
      SCAN_NOW,
      undefined,
      [{ symbol: "SPX", exchange: "INDEX" }]
    );

    // Precondition: it really did fail.
    expect(result.errors.map((e) => e.symbol)).toContain("SPX");
    // ...and cost nothing else.
    expect(Object.keys(result.resultsBySymbol).sort()).toEqual(["MSTR", "NVDA"]);
    expect(result.watchlist).toHaveLength(2);
    expect(result.expansionBySymbol!.SPX).toBeUndefined();
  });

  it("does not exclude an expansion-only symbol for lacking a previous close", async () => {
    // The reversal scanner requires a previous daily close and excludes a
    // symbol without one. That requirement must not follow a symbol that
    // never runs reversal scoring.
    const p = new FixtureProvider(standardFixtures({ MSTR: ORDINARY, NVDA: ORDINARY }));
    const result = await scanWatchlistWithProvider(
      WATCH,
      p,
      defaultStrategyConfig,
      SCAN_NOW,
      undefined,
      [{ symbol: "SPX", exchange: "INDEX" }]
    );

    expect(result.errors.map((e) => e.symbol)).not.toContain("SPX");
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility
// ---------------------------------------------------------------------------

describe("default behaviour", () => {
  it("scans one list for both sides when no universe is supplied", async () => {
    const p = provider();
    const result = await scanWatchlistWithProvider(WATCH, p, defaultStrategyConfig, SCAN_NOW);

    // Omitting the universe means "same list both sides" — the behaviour
    // every existing caller relies on.
    expect(Object.keys(result.expansionBySymbol!).sort()).toEqual(["MSTR", "NVDA"]);
    expect(Object.keys(result.resultsBySymbol).sort()).toEqual(["MSTR", "NVDA"]);
  });
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe("expansionUniverse config", () => {
  const EXPECTED = [
    "AAPL", "AMD", "AMZN", "AVGO", "GOOGL", "INTC", "META", "MSFT", "MU",
    "NVDA", "TSLA", "SMH", "XLF", "IBIT", "SPY", "QQQ", "IWM", "SPX",
  ];

  it("ships the 18 documented tickers", () => {
    const symbols = defaultStrategyConfig.expansionUniverse.map((s) => s.symbol);
    expect(symbols).toHaveLength(18);
    expect(symbols).toEqual(EXPECTED);
    // Every entry carries an exchange, even though the provider keys on
    // symbol — a blank one would fail validation on the next save.
    for (const entry of defaultStrategyConfig.expansionUniverse) {
      expect(entry.exchange.length).toBeGreaterThan(0);
    }
    expect(validateExpansionUniverse(defaultStrategyConfig.expansionUniverse)).toEqual([]);
  });

  it("fills the default when the field was never configured", () => {
    expect(normalizeExpansionUniverse(undefined).map((s) => s.symbol)).toEqual(EXPECTED);
    expect(normalizeExpansionUniverse(null).map((s) => s.symbol)).toEqual(EXPECTED);
  });

  it("returns a copy, so a caller cannot mutate the shipped default", () => {
    const first = normalizeExpansionUniverse(undefined);
    first.push({ symbol: "ZZZZ", exchange: "NASDAQ" });
    expect(normalizeExpansionUniverse(undefined)).toHaveLength(18);
    expect(defaultStrategyConfig.expansionUniverse).toHaveLength(18);
  });

  it("preserves an EMPTY list rather than replacing it with the default", () => {
    // "Scan nothing for expansion" is a real choice, distinct from
    // "never configured".
    expect(normalizeExpansionUniverse([])).toEqual([]);
  });

  it("is editable — an added symbol survives normalization", () => {
    const edited = [...defaultStrategyConfig.expansionUniverse, { symbol: "COIN", exchange: "NASDAQ" }];
    const normalized = normalizeExpansionUniverse(edited);
    expect(normalized.map((s) => s.symbol)).toContain("COIN");
    expect(validateExpansionUniverse(normalized)).toEqual([]);
  });

  it("rejects malformed entries instead of repairing them", () => {
    const fields = (v: unknown) =>
      validateExpansionUniverse(v as StrategyConfig["expansionUniverse"]).map((e) => e.field);

    expect(fields("AAPL,MSFT")).toEqual(["expansionUniverse"]);
    expect(fields([{ exchange: "NASDAQ" }])).toContain("expansionUniverse[0].symbol");
    expect(fields([{ symbol: "AAPL" }])).toContain("expansionUniverse[0].exchange");
    expect(fields([{ symbol: "", exchange: "NASDAQ" }])).toContain("expansionUniverse[0].symbol");
    expect(fields([{ symbol: "not a ticker", exchange: "NASDAQ" }])).toContain(
      "expansionUniverse[0].symbol"
    );
    expect(fields([null])).toContain("expansionUniverse[0]");
    // A present-but-invalid value is never silently replaced.
    expect(normalizeExpansionUniverse([{ symbol: "bad ticker", exchange: "X" }])).toEqual([
      { symbol: "bad ticker", exchange: "X" },
    ]);
  });

  it("rejects a duplicate symbol", () => {
    const errors = validateExpansionUniverse([
      { symbol: "SPY", exchange: "NYSE" },
      { symbol: "SPY", exchange: "NYSE" },
    ]);
    expect(errors.map((e) => e.field)).toContain("expansionUniverse[1].symbol");
  });

  it("reports every problem at once, not just the first", () => {
    const errors = validateExpansionUniverse([
      { symbol: "", exchange: "" },
      { symbol: "ok!", exchange: "NASDAQ" },
    ] as StrategyConfig["expansionUniverse"]);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it("is validated at the stored-config read boundary", () => {
    const stored = {
      ...defaultStrategyConfig,
      expansionUniverse: [{ symbol: "bad ticker", exchange: "NASDAQ" }],
    } as StrategyConfig;
    const { errors } = normalizeAndValidateStrategyConfig(stored);
    expect(errors.map((e) => e.field)).toContain("expansionUniverse[0].symbol");
  });

  it("accepts a legacy stored config that predates the field", () => {
    const legacy = { ...defaultStrategyConfig } as StrategyConfig;
    delete (legacy as Partial<StrategyConfig>).expansionUniverse;

    const { config, errors } = normalizeAndValidateStrategyConfig(legacy);
    expect(errors).toEqual([]);
    expect(config.expansionUniverse).toHaveLength(18);
  });
});
