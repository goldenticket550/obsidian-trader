import { describe, expect, it } from "vitest";
import { assertCheckpointCompatible, canRollForwardEmptyLegacyCheckpoint, checkpointChecksum } from "@/lib/attention-runtime/inMemoryStore";
import type { RuntimeCheckpoint, RuntimeIdentity } from "@/lib/attention-runtime/contracts";

const identity: RuntimeIdentity = {
  engineInstanceId: "checksum-worker",
  runId: "checksum-run",
  userId: "owner",
  universeHash: "universe",
  calibrationId: "calibration",
  configHash: "config",
  baselineTableId: "baseline",
  feedMode: "iex_partial",
};

describe("runtime checkpoint checksum", () => {
  it("survives jsonb-style object-key reordering", () => {
    const unsigned: Omit<RuntimeCheckpoint, "checksum"> = {
      schemaVersion: 1,
      identity,
      sequence: 7,
      watermarkAt: Date.parse("2026-08-20T03:27:00Z"),
      createdAt: Date.parse("2026-08-20T03:27:01Z"),
      ingestionMode: "iex_rest_polling",
      guard: {
        active: false,
        reason: "none",
        activeSince: null,
        contiguousMinutes: 5,
        requiredContiguousMinutes: 5,
      },
      processorState: { z: 1, nested: { beta: 2, alpha: 1 }, a: 3 },
      deliveryState: { tradingDate: "2026-08-19", counters: { z: 0, a: 0 } },
    };
    const checksum = checkpointChecksum(unsigned);
    const reordered = JSON.parse(JSON.stringify({
      deliveryState: unsigned.deliveryState,
      processorState: unsigned.processorState,
      guard: unsigned.guard,
      ingestionMode: unsigned.ingestionMode,
      createdAt: unsigned.createdAt,
      watermarkAt: unsigned.watermarkAt,
      sequence: unsigned.sequence,
      identity: unsigned.identity,
      schemaVersion: unsigned.schemaVersion,
      checksum,
    })) as RuntimeCheckpoint;

    expect(checkpointChecksum(unsigned)).toBe(checksum);
    expect(() => assertCheckpointCompatible(reordered, identity)).not.toThrow();
  });

  it("only rolls forward an empty identity-matching legacy checkpoint", () => {
    const checkpoint: RuntimeCheckpoint = {
      schemaVersion: 1,
      identity,
      sequence: 24,
      watermarkAt: Date.parse("2026-08-20T03:27:00Z"),
      createdAt: Date.parse("2026-08-20T03:27:01Z"),
      ingestionMode: "iex_rest_polling",
      guard: {
        active: false,
        reason: "none",
        activeSince: null,
        contiguousMinutes: 5,
        requiredContiguousMinutes: 5,
      },
      processorState: null,
      deliveryState: {
        sessionEvents: [],
        regularCountersStarted: false,
        detectionCounters: { detectionRanMinutes: 0, eventsDetected: 0 },
      },
      checksum: "pre-canonical-checksum",
    };

    expect(canRollForwardEmptyLegacyCheckpoint(checkpoint, identity)).toBe(true);
    expect(canRollForwardEmptyLegacyCheckpoint({ ...checkpoint, processorState: {} }, identity)).toBe(false);
    expect(canRollForwardEmptyLegacyCheckpoint({
      ...checkpoint,
      identity: { ...identity, configHash: "other" },
    }, identity)).toBe(false);
  });
});
