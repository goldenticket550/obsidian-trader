import { describe, expect, it } from "vitest";
import { dashboardWorkerLiveness, SNAPSHOT_DELAY_AFTER_MS, WORKER_HEARTBEAT_STALE_AFTER_MS } from "@/lib/attention-runtime/dashboardLiveness";
import { explainSelfReferentialBenchmark } from "@/lib/attention-runtime/referenceQuality";
import { nextSupervisorStateAfterSpawn, type SupervisorLivenessState } from "@/lib/attention-runtime/processLiveness";
import type { LiveAttentionRow } from "@/lib/attention-runtime/contracts";

const row: LiveAttentionRow = {
  symbol: "SPY",
  attentionScore: null,
  core: null,
  state: null,
  freshness: null,
  rank: null,
  dataQualityState: "insufficient_reference",
  dataQualityReason: "generic",
  feedBadge: "IEX PARTIAL",
  pendingTransition: "none",
  pendingTransitionMinutes: 0,
};

describe("live runtime liveness contract", () => {
  it("does not call a healthy heartbeat down when the completed minute is delayed", () => {
    const now = Date.parse("2026-08-18T14:00:00Z");
    expect(dashboardWorkerLiveness({ asOf: now - SNAPSHOT_DELAY_AFTER_MS - 1 }, now, { heartbeatAt: now - 15_000, health: "ready" }))
      .toMatchObject({ workerDown: false, dataDelayed: true, label: "DATA DELAYED" });
  });

  it("declares the worker down only when its heartbeat is stale or failed", () => {
    const now = Date.parse("2026-08-18T14:00:00Z");
    expect(dashboardWorkerLiveness({ asOf: now - 30_000 }, now, { heartbeatAt: now - WORKER_HEARTBEAT_STALE_AFTER_MS - 1, health: "ready" }))
      .toMatchObject({ workerDown: true, label: "WORKER DOWN" });
    expect(dashboardWorkerLiveness({ asOf: now - 30_000 }, now, { heartbeatAt: now, health: "failed" }))
      .toMatchObject({ workerDown: true, label: "WORKER DOWN" });
  });

  it("does not call an intentionally dark partial-feed window a worker outage", () => {
    const afterHours = Date.parse("2026-08-18T21:00:00Z");
    expect(dashboardWorkerLiveness({ asOf: afterHours - 30 * 60_000 }, afterHours)).toMatchObject({ regularSession: false, workerDown: false, label: "LAST SNAPSHOT" });
  });

  it("does not apply the retired self-reference reason to corrected index mappings", () => {
    expect(explainSelfReferentialBenchmark(row).dataQualityReason).toBe("generic");
    expect(explainSelfReferentialBenchmark({ ...row, symbol: "QQQ" }).dataQualityReason).toBe("generic");
    expect(explainSelfReferentialBenchmark({ ...row, symbol: "IWM" }).dataQualityReason).toBe("generic");
  });

  it("counts every child start after the first as a supervised restart", () => {
    const initial: SupervisorLivenessState = { schemaVersion: 1, supervisorPid: 1, supervisorStartedAt: 1, status: "running", childPid: null, childStartedAt: null, childStartCount: 0, restartCount: 0, lastChildExit: null };
    const first = nextSupervisorStateAfterSpawn(initial, 2, 10);
    const restarted = nextSupervisorStateAfterSpawn({ ...first, childPid: null }, 3, 20);
    expect(first).toMatchObject({ childStartCount: 1, restartCount: 0 });
    expect(restarted).toMatchObject({ childStartCount: 2, restartCount: 1 });
  });
});
