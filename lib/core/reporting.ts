import { randomUUID } from "node:crypto";
import { createReporter, type ObsidianSignal } from "@/packages/obsidian-reporter/src";
import { CoreChannel } from "@/lib/alerts/coreChannel";
import { dispatchToChannels } from "@/lib/alerts/channels";
import type { AlertEvent } from "@/lib/alerts/types";

function config() {
  const ingestUrl = process.env.OBSIDIAN_CORE_INGEST_URL;
  const keyId = process.env.OBSIDIAN_CORE_KEY_ID;
  const signingKey = process.env.OBSIDIAN_CORE_REPORTING_KEY;
  if (!ingestUrl || !keyId || !signingKey) return null;
  return {
    ingestUrl,
    keyId,
    signingKey,
    environment: (process.env.VERCEL_ENV === "production" ? "production" : "staging") as "production" | "staging",
  };
}

export async function enqueueCoreEvents(db: any, events: AlertEvent[]): Promise<void> {
  try {
    const reporterConfig = config();
    if (!reporterConfig) return;
    const reporter = createReporter(db, reporterConfig);
    const channel = new CoreChannel(reporter.report, reporterConfig.environment);
    await Promise.all(events.map((event) => dispatchToChannels(event, [channel])));
  } catch (error) {
    console.error("[core-reporting] event enqueue failed without failing scan:", error);
  }
}

export async function recordAndEnqueueHealth(db: any, report: any): Promise<void> {
  try {
    const reporterConfig = config();
    if (!reporterConfig) return;

    const totals = (report.results ?? []).reduce(
      (aggregate: any, result: any) => ({
        symbolsAttempted: aggregate.symbolsAttempted + (result.symbolsAttempted ?? 0),
        symbolsSucceeded: aggregate.symbolsSucceeded + (result.symbolsSucceeded ?? 0),
        symbolsFailed: aggregate.symbolsFailed + (result.symbolsFailed ?? 0),
        alertsFired: aggregate.alertsFired + (result.alertsFired ?? 0),
      }),
      { symbolsAttempted: 0, symbolsSucceeded: 0, symbolsFailed: 0, alertsFired: 0 }
    );
    const status = totals.symbolsFailed > 0 ? "degraded" : "healthy";
    const counts = { usersScanned: report.usersScanned, ...totals };
    const { error } = await db.from("trader_run_reports").insert({
      scanned_at: report.scannedAt,
      provider: report.provider,
      status,
      counts,
    });
    if (error) throw new Error(`Trader run-report persistence failed: ${error.message}`);

    const signal: ObsidianSignal = {
      schemaVersion: "1",
      kind: "health",
      signalId: randomUUID(),
      dedupKey: `trader:cron:${report.scannedAt}`,
      occurredAt: report.scannedAt,
      sentAt: new Date().toISOString(),
      source: { application: "trader", environment: reporterConfig.environment },
      payload: { status, provider: report.provider, scanCompletedAt: report.scannedAt, counts },
    };
    await createReporter(db, reporterConfig).report(signal);
  } catch (error) {
    console.error("[core-reporting] health persistence/enqueue failed without failing scan:", error);
  }
}

export async function drainCoreOutbox(db: any): Promise<{ delivered: number; retried: number }> {
  try {
    const reporterConfig = config();
    if (!reporterConfig) return { delivered: 0, retried: 0 };
    return await createReporter(db, reporterConfig).drain();
  } catch (error) {
    console.error("[core-reporting] outbox drain failed without failing scan:", error);
    return { delivered: 0, retried: 0 };
  }
}
