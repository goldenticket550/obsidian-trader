/**
 * OBSIDIAN ATTENTION ENGINE — configured universe (§3.1)
 *
 * 61 tradeable symbols + 7 reference-only sector ETFs = 68 fetched symbols.
 *
 * IMPORTANT — `optionsTier` is a TRADER USABILITY FIELD ONLY.
 * Per §3.1 it must NOT affect the Attention Score, the state machine, ranking
 * order, or list membership. It is displayed and used for warnings. Do not
 * filter WAKING UP or IN PLAY by tier.
 *
 * `enabled: false` = REFERENCE ONLY. Fetched and used as a sectorEtf/benchmark
 * for the Idiosyncrasy axis (§3.4), never ranked or displayed as a candidate.
 *
 * For an ETF that is itself the asset-class/sector proxy, `sectorEtf` may point
 * to the symbol itself. That is not a self-referential benchmark: its sector and
 * stock magnitude are the same honest comparison against a distinct peer benchmark.
 *
 * SPY uses IWM as its explicit breadth peer (large-cap market versus small-cap
 * market); it does not claim to have a more fundamental broad-market benchmark.
 *
 * `cluster` is used ONLY for display compaction (§3.16) — never for ranking,
 * scoring, event detection or logging exclusion.
 *
 * NEW-LISTING WARNING (see accompanying spec addendum §3.1b):
 * SPCX, CRWV, NBIS, SNDK have limited trading history. Their time-of-day
 * baselines will be built substantially from post-listing / post-spinoff
 * behaviour, which is not representative. They must carry `listedSince` and be
 * gated by the minimum-history policy, NOT merely by minBaselineSessions.
 *
 * ON `listedSince` VALUES BELOW:
 *   SPCX  — AUTHORITATIVE. First trade 2026-06-12 (Nasdaq debut, closed $161,
 *           +19%). Sourced, not inferred.
 *   SNDK  — AUTHORITATIVE, adjudicated. Regular-way trading began 2025-02-24
 *           (ex-date; ticker changed from SNDKV to SNDK that day). Alpaca's
 *           history starts 2025-02-13, which is the WHEN-ISSUED period under
 *           ticker SNDKV — record date 2025-02-12. Those 7 sessions are a
 *           conditional pre-distribution market, thin and arb-driven, and are
 *           EXCLUDED from baselines. Source: Nasdaq Equity Corporate Actions
 *           Alert 2025-38 (WDC spin-off of SanDisk).
 *   NBIS / CRWV — APPROXIMATE. Derive from the archive per §3.1b(f).
 */

export interface UniverseSymbol {
  symbol: string;
  benchmark: "QQQ" | "SPY" | "IWM";
  sectorEtf: string | null;
  cluster: string;
  optionsTier: 1 | 2 | 3;
  enabled: boolean;
  /** ISO date of first trade, when the symbol is a recent listing or spinoff. */
  listedSince?: string;
  /** Set when the symbol exists only as a benchmark/sector reference. */
  referenceOnly?: boolean;
}

export const UNIVERSE: UniverseSymbol[] = [
  // ---------------------------------------------------------------- index
  { symbol: "SPY",  benchmark: "IWM", sectorEtf: "SPY",   cluster: "index",         optionsTier: 1, enabled: true },
  { symbol: "QQQ",  benchmark: "SPY", sectorEtf: "QQQ",   cluster: "index",         optionsTier: 1, enabled: true },
  { symbol: "IWM",  benchmark: "SPY", sectorEtf: "IWM",   cluster: "index",         optionsTier: 1, enabled: true },

  // --------------------------------------------------------- megacap tech
  { symbol: "AAPL", benchmark: "QQQ", sectorEtf: "XLK",  cluster: "megacap_tech",  optionsTier: 1, enabled: true },
  { symbol: "MSFT", benchmark: "QQQ", sectorEtf: "XLK",  cluster: "megacap_tech",  optionsTier: 1, enabled: true },
  { symbol: "GOOGL",benchmark: "QQQ", sectorEtf: "XLC",  cluster: "megacap_tech",  optionsTier: 1, enabled: true },
  { symbol: "AMZN", benchmark: "QQQ", sectorEtf: "XLY",  cluster: "megacap_tech",  optionsTier: 1, enabled: true },
  { symbol: "META", benchmark: "QQQ", sectorEtf: "XLC",  cluster: "megacap_tech",  optionsTier: 1, enabled: true },
  { symbol: "TSLA", benchmark: "QQQ", sectorEtf: "XLY",  cluster: "megacap_tech",  optionsTier: 1, enabled: true },

  // ---------------------------------------------------------------- semis
  { symbol: "NVDA", benchmark: "QQQ", sectorEtf: "SMH",  cluster: "semis",         optionsTier: 1, enabled: true },
  { symbol: "AMD",  benchmark: "QQQ", sectorEtf: "SMH",  cluster: "semis",         optionsTier: 1, enabled: true },
  { symbol: "AVGO", benchmark: "QQQ", sectorEtf: "SMH",  cluster: "semis",         optionsTier: 1, enabled: true },
  { symbol: "INTC", benchmark: "QQQ", sectorEtf: "SMH",  cluster: "semis",         optionsTier: 1, enabled: true },
  { symbol: "QCOM", benchmark: "QQQ", sectorEtf: "SMH",  cluster: "semis",         optionsTier: 2, enabled: true },
  { symbol: "MRVL", benchmark: "QQQ", sectorEtf: "SMH",  cluster: "semis",         optionsTier: 2, enabled: true },
  { symbol: "AMAT", benchmark: "QQQ", sectorEtf: "SMH",  cluster: "semis",         optionsTier: 2, enabled: true },
  { symbol: "KLAC", benchmark: "QQQ", sectorEtf: "SMH",  cluster: "semis",         optionsTier: 2, enabled: true },
  { symbol: "ARM",  benchmark: "QQQ", sectorEtf: "SMH",  cluster: "semis",         optionsTier: 2, enabled: true },
  { symbol: "TSM",  benchmark: "QQQ", sectorEtf: "SMH",  cluster: "semis",         optionsTier: 2, enabled: true },
  { symbol: "SMH",  benchmark: "QQQ", sectorEtf: "SMH",   cluster: "semis",         optionsTier: 2, enabled: true },

  // --------------------------------------------------------------- memory
  // Distinct sub-cluster: these move together far harder than they move with
  // broad semis. DRAM (Roundhill Memory ETF) is the group's sector reference
  // AND is itself tradeable.
  { symbol: "MU",   benchmark: "QQQ", sectorEtf: "DRAM", cluster: "memory",        optionsTier: 1, enabled: true },
  { symbol: "SNDK", benchmark: "QQQ", sectorEtf: "DRAM", cluster: "memory",        optionsTier: 1, enabled: true, listedSince: "2025-02-24" /* AUTHORITATIVE — regular-way; when-issued SNDKV from 02-13 excluded */ },
  { symbol: "WDC",  benchmark: "QQQ", sectorEtf: "DRAM", cluster: "memory",        optionsTier: 2, enabled: true },
  { symbol: "DRAM", benchmark: "QQQ", sectorEtf: "DRAM",   cluster: "memory",        optionsTier: 1, enabled: true },

  // ------------------------------------------------------------- ai_infra
  { symbol: "SMCI", benchmark: "QQQ", sectorEtf: "SMH",  cluster: "ai_infra",      optionsTier: 2, enabled: true },
  { symbol: "DELL", benchmark: "QQQ", sectorEtf: "XLK",  cluster: "ai_infra",      optionsTier: 1, enabled: true },
  { symbol: "NBIS", benchmark: "QQQ", sectorEtf: "XLK",  cluster: "ai_infra",      optionsTier: 1, enabled: true, listedSince: "2024-10-21" /* APPROX — derive */ },
  { symbol: "CRWV", benchmark: "QQQ", sectorEtf: "XLK",  cluster: "ai_infra",      optionsTier: 3, enabled: true, listedSince: "2025-03-28" /* APPROX — derive */ },
  // Applied Optoelectronics — optical transceivers, AI/datacenter capex beta.
  // Listed 2013, full history available: no listedSince gate required.
  { symbol: "AAOI", benchmark: "QQQ", sectorEtf: "SMH",  cluster: "ai_infra",      optionsTier: 2, enabled: true },

  // ------------------------------------------------------------- software
  { symbol: "PLTR", benchmark: "QQQ", sectorEtf: "XLK",  cluster: "software",      optionsTier: 1, enabled: true },
  { symbol: "PANW", benchmark: "QQQ", sectorEtf: "XLK",  cluster: "software",      optionsTier: 1, enabled: true },
  { symbol: "ORCL", benchmark: "QQQ", sectorEtf: "XLK",  cluster: "software",      optionsTier: 2, enabled: true },
  { symbol: "CRWD", benchmark: "QQQ", sectorEtf: "XLK",  cluster: "software",      optionsTier: 2, enabled: true },
  { symbol: "CRM",  benchmark: "QQQ", sectorEtf: "XLK",  cluster: "software",      optionsTier: 3, enabled: true },
  { symbol: "ADBE", benchmark: "QQQ", sectorEtf: "XLK",  cluster: "software",      optionsTier: 3, enabled: true },
  { symbol: "NOW",  benchmark: "QQQ", sectorEtf: "XLK",  cluster: "software",      optionsTier: 3, enabled: true },

  // ------------------------------------------------------------- internet
  { symbol: "NFLX", benchmark: "QQQ", sectorEtf: "XLC",  cluster: "internet",      optionsTier: 1, enabled: true },
  { symbol: "UBER", benchmark: "QQQ", sectorEtf: "XLY",  cluster: "internet",      optionsTier: 2, enabled: true },
  { symbol: "SNAP", benchmark: "QQQ", sectorEtf: "XLC",  cluster: "internet",      optionsTier: 3, enabled: true },

  // --------------------------------------------------------------- crypto
  // IBIT is the group's sector reference and is itself tradeable.
  { symbol: "MSTR", benchmark: "QQQ", sectorEtf: "IBIT", cluster: "crypto",        optionsTier: 2, enabled: true },
  { symbol: "HOOD", benchmark: "QQQ", sectorEtf: "IBIT", cluster: "crypto",        optionsTier: 2, enabled: true },
  { symbol: "IBIT", benchmark: "QQQ", sectorEtf: "IBIT",   cluster: "crypto",        optionsTier: 2, enabled: true },
  { symbol: "COIN", benchmark: "QQQ", sectorEtf: "IBIT", cluster: "crypto",        optionsTier: 3, enabled: true },

  // -------------------------------------------------------------- fintech
  { symbol: "SOFI", benchmark: "SPY", sectorEtf: "XLF",  cluster: "fintech",       optionsTier: 2, enabled: true },
  { symbol: "PYPL", benchmark: "QQQ", sectorEtf: "XLF",  cluster: "fintech",       optionsTier: 3, enabled: true },

  // --------------------------------------------------------------- metals
  { symbol: "GLD",  benchmark: "SPY", sectorEtf: "GLD",   cluster: "metals",        optionsTier: 2, enabled: true },
  { symbol: "SLV",  benchmark: "SPY", sectorEtf: "SLV",   cluster: "metals",        optionsTier: 2, enabled: true },
  { symbol: "GDX",  benchmark: "SPY", sectorEtf: "GLD",  cluster: "metals",        optionsTier: 3, enabled: true },

  // --------------------------------------------------------------- energy
  { symbol: "XOM",  benchmark: "SPY", sectorEtf: "XLE",  cluster: "energy",        optionsTier: 3, enabled: true },
  { symbol: "USO",  benchmark: "SPY", sectorEtf: "XLE",  cluster: "energy",        optionsTier: 3, enabled: true },
  { symbol: "BE",   benchmark: "SPY", sectorEtf: "XLE",  cluster: "energy",        optionsTier: 2, enabled: true },

  // ----------------------------------------------------------- healthcare
  { symbol: "LLY",  benchmark: "SPY", sectorEtf: "XLV",  cluster: "healthcare",    optionsTier: 2, enabled: true },
  { symbol: "UNH",  benchmark: "SPY", sectorEtf: "XLV",  cluster: "healthcare",    optionsTier: 3, enabled: true },

  // ------------------------------------------------------------- consumer
  { symbol: "COST", benchmark: "SPY", sectorEtf: "XLP",  cluster: "consumer",      optionsTier: 2, enabled: true },
  { symbol: "WMT",  benchmark: "SPY", sectorEtf: "XLP",  cluster: "consumer",      optionsTier: 3, enabled: true },
  { symbol: "NKE",  benchmark: "SPY", sectorEtf: "XLY",  cluster: "consumer",      optionsTier: 3, enabled: true },

  // --------------------------------------------------------------- travel
  { symbol: "CCL",  benchmark: "SPY", sectorEtf: "XLY",  cluster: "travel",        optionsTier: 3, enabled: true },
  { symbol: "AAL",  benchmark: "SPY", sectorEtf: "XLY",  cluster: "travel",        optionsTier: 3, enabled: true },

  // -------------------------------------------------------------- legacy
  { symbol: "IBM",  benchmark: "SPY", sectorEtf: "XLK",  cluster: "legacy_tech",   optionsTier: 2, enabled: true },
  { symbol: "T",    benchmark: "SPY", sectorEtf: "XLC",  cluster: "legacy_tech",   optionsTier: 3, enabled: true },

  // ---------------------------------------------------------------- space
  { symbol: "SPCX", benchmark: "QQQ", sectorEtf: "SPCX",   cluster: "space",         optionsTier: 1, enabled: true, listedSince: "2026-06-12" },

  // ------------------------------------------------- REFERENCE ONLY (§3.4)
  // Fetched for the Idiosyncrasy axis. Never ranked, never displayed as a
  // candidate, never eligible for WAKING UP or IN PLAY.
  { symbol: "XLK",  benchmark: "SPY", sectorEtf: null,   cluster: "sector_ref",    optionsTier: 3, enabled: false, referenceOnly: true },
  { symbol: "XLC",  benchmark: "SPY", sectorEtf: null,   cluster: "sector_ref",    optionsTier: 3, enabled: false, referenceOnly: true },
  { symbol: "XLY",  benchmark: "SPY", sectorEtf: null,   cluster: "sector_ref",    optionsTier: 3, enabled: false, referenceOnly: true },
  { symbol: "XLP",  benchmark: "SPY", sectorEtf: null,   cluster: "sector_ref",    optionsTier: 3, enabled: false, referenceOnly: true },
  { symbol: "XLE",  benchmark: "SPY", sectorEtf: null,   cluster: "sector_ref",    optionsTier: 3, enabled: false, referenceOnly: true },
  { symbol: "XLF",  benchmark: "SPY", sectorEtf: null,   cluster: "sector_ref",    optionsTier: 3, enabled: false, referenceOnly: true },
  { symbol: "XLV",  benchmark: "SPY", sectorEtf: null,   cluster: "sector_ref",    optionsTier: 3, enabled: false, referenceOnly: true },
];

/** Symbols requiring an archive re-pull before they have usable baselines. */
export const PENDING_ARCHIVE: readonly string[] = [
  "SNDK", "WDC", "DRAM", "BE", "TSM", "SPCX", "DELL", "NBIS", "CRWV",
  "AAOI", // added after the A1 pull — requires its own archive fetch
];
