import { ATTENTION_UNIVERSE } from "@/lib/attention/universe";
import type { LiveAttentionRow, RuntimeProcessorResult } from "./contracts";
import type { AttentionRuntimeProcessor } from "./worker";
import type { LiveMinuteBatch, RuntimeControls } from "./contracts";

const SELF_REFERENTIAL = new Set(ATTENTION_UNIVERSE.filter((entry) => entry.benchmark === entry.symbol).map((entry) => entry.symbol));

export function explainSelfReferentialBenchmark(row: LiveAttentionRow): LiveAttentionRow {
  if (!SELF_REFERENTIAL.has(row.symbol) || row.attentionScore !== null) return row;
  return {
    ...row,
    dataQualityReason: "self_referential_benchmark: benchmark equals target, so Path B idiosyncrasy has zero spread and no usable baseline.",
  };
}

export class ExplicitReferenceQualityProcessor implements AttentionRuntimeProcessor {
  constructor(private readonly delegate: AttentionRuntimeProcessor) {}
  restore(state: unknown): void { this.delegate.restore(state); }
  async process(batch: LiveMinuteBatch, controls: RuntimeControls): Promise<RuntimeProcessorResult> {
    const result = await this.delegate.process(batch, controls);
    return { ...result, rows: result.rows.map(explainSelfReferentialBenchmark) };
  }
}
