import { describe, expect, it } from "vitest";
import { capAttentionDisplay } from "@/lib/attention/attentionLists";
import type { ClusterDisplayResult } from "@/lib/attention/universePolicy";

describe("attention global display cap", () => {
  it("caps presentation only while preserving all engine rows", () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({
      symbol: `S${String(index + 1).padStart(2, "0")}`,
    }));
    const display: ClusterDisplayResult<(typeof rows)[number]> = {
      engineRows: rows,
      visibleRows: rows,
      overflow: [],
    };

    const capped = capAttentionDisplay(display, 12);

    expect(capped.engineRows).toHaveLength(40);
    expect(capped.visibleRows).toHaveLength(12);
    expect(capped.visibleRows.map((row) => row.symbol)).toEqual(rows.slice(0, 12).map((row) => row.symbol));
    expect(capped.globalOverflow).toMatchObject({ hiddenCount: 28 });
    expect(capped.globalOverflow?.hiddenSymbols).toContain("S40");
  });
});
