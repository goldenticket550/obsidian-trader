import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { ATTENTION_UNIVERSE } from "../lib/attention/universe";
import { RestIexPollingSource } from "../lib/attention-runtime/ingestion";
import type { IexBaselineTable } from "../lib/attention-runtime/iexBaselineTable";
import { CalibratedIexAttentionProcessor, type IexHistoricalSessionBars } from "../lib/attention-runtime/iexProcessor";
import { StaticBaselineIexAttentionProcessor } from "../lib/attention-runtime/iexStaticProcessor";
import { AlpacaProvider } from "../lib/market-data/providers/alpacaProvider";
import { alpacaCredentials } from "../lib/replay/env";
import type { FeedAwareAttentionThresholdStore } from "../lib/replay/feedAwareAttentionThresholds";

function history(): IexHistoricalSessionBars[] {
  const directory = resolve("data/replay/calibration/sessions/iex_partial");
  return readdirSync(directory).filter((name) => name.endsWith(".json.gz")).sort().map((name) => {
    const payload = JSON.parse(gunzipSync(readFileSync(resolve(directory, name))).toString("utf8"));
    return { tradingDate: payload.tradingDate, bars: payload.bars, priorSessionRegularBars: payload.priorSessionRegularBars } as IexHistoricalSessionBars;
  });
}

async function main(): Promise<void> {
  const thresholds = JSON.parse(readFileSync(resolve("data/replay/reports/attention-thresholds.json"), "utf8")) as FeedAwareAttentionThresholdStore;
  const table = JSON.parse(readFileSync(resolve("data/replay/calibration/iex-live-baseline-table.json"), "utf8")) as IexBaselineTable;
  const credentials = alpacaCredentials();
  const source = new RestIexPollingSource(new AlpacaProvider({ ...credentials, feed: "iex", isPaidPlan: false }, undefined, 10_000, 12, 350), ATTENTION_UNIVERSE.map((entry) => entry.symbol), 120);
  const batch = await source.readCompletedMinute(Date.now());
  const controls = { version: 1 as const, attentionLiveAlertingEnabled: false, legacyAlertingEnabled: true, activeAlertEngine: "legacy" as const, updatedAt: Date.now(), reason: "static_baseline_equivalence" };
  const dynamicStartedAt = performance.now();
  const dynamic = await new CalibratedIexAttentionProcessor(thresholds, history()).process(batch, controls);
  const dynamicMs = performance.now() - dynamicStartedAt;
  const staticStartedAt = performance.now();
  const cached = await new StaticBaselineIexAttentionProcessor(thresholds, table).process(batch, controls);
  const staticMs = performance.now() - staticStartedAt;
  const dynamicBySymbol = new Map(dynamic.rows.map((row) => [row.symbol, row]));
  const differences: Array<Record<string, unknown> & { symbol: string; field: string }> = [];
  for (const row of cached.rows) {
    const prior = dynamicBySymbol.get(row.symbol);
    if (!prior || prior.attentionScore === null || row.attentionScore === null) {
      if (prior?.attentionScore !== row.attentionScore) differences.push({ symbol: row.symbol, field: "availability", dynamic: prior?.attentionScore ?? null, cached: row.attentionScore });
      continue;
    }
    const attentionDelta = Math.abs(prior.attentionScore - row.attentionScore);
    const coreDelta = Math.abs((prior.core ?? 0) - (row.core ?? 0));
    if (attentionDelta > 1e-9 || coreDelta > 1e-9) differences.push({ symbol: row.symbol, field: "score", attentionDelta, coreDelta });
  }
  const report = {
    schemaVersion: 1,
    completedMinute: new Date(batch.at).toISOString(),
    baselineTableId: table.tableId,
    dynamicMs,
    staticMs,
    speedup: dynamicMs / staticMs,
    dynamicStagesMs: dynamic.stageTimings,
    staticStagesMs: cached.stageTimings,
    dynamicScored: dynamic.rows.filter((row) => row.attentionScore !== null).length,
    staticScored: cached.rows.filter((row) => row.attentionScore !== null).length,
    differences,
    equivalent: differences.length === 0,
  };
  writeFileSync(resolve("data/runtime-shadow/static-baseline-equivalence.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (differences.length) throw new Error(`Static baseline changed ${differences.length} live rows.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
