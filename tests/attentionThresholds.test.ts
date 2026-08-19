import { describe, expect, it } from "vitest";
import {
  ATTENTION_SUB_WINDOWS,
  assertAttentionThresholdStore,
  createPendingThresholdStore,
  thresholdSetForScore,
} from "@/lib/replay/attentionThresholds";

describe("feed-mode x sub-window attention thresholds", () => {
  it("creates twelve distinct pending calibration slots", () => {
    const store = createPendingThresholdStore(3);
    assertAttentionThresholdStore(store);
    expect(store.schemaVersion).toBe(5);
    const sets = [...Object.values(store.sets.sip), ...Object.values(store.sets.iex_partial)];
    expect(sets).toHaveLength(12);
    expect(new Set(sets.map((set) => set.calibrationId)).size).toBe(12);
    expect(sets.every((set) => set.calibrationStatus === "pending_calibration")).toBe(true);
    expect(sets.every((set) => set.normalizationVersion === 1)).toBe(true);
    expect(sets.every((set) => set.normalization.displacement.z50 === 2 && set.normalization.displacement.k === 1.2)).toBe(true);
    expect(sets.every((set) => set.provisionalValues.watchingEnterCore === 0.25 && set.provisionalValues.watchingExitCore === 0.20)).toBe(true);
  });

  it("does not reuse another window while calibration is pending", () => {
    const store = createPendingThresholdStore(3);
    expect(() => thresholdSetForScore(store, "regular", "sip")).toThrow(/feed\/window fallback is forbidden/);
  });

  it("invalidates all threshold identities when the mode-map version changes", () => {
    const oldStore = createPendingThresholdStore(3);
    const newStore = createPendingThresholdStore(4);
    for (const feedMode of ["sip", "iex_partial"] as const) {
      for (const window of ATTENTION_SUB_WINDOWS) {
        expect(newStore.sets[feedMode][window].calibrationId).not.toBe(oldStore.sets[feedMode][window].calibrationId);
      }
    }
  });
});
