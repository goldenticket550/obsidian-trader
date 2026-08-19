import type { AttentionScoreResult } from "@/lib/attention/attentionScore";
import { volumeCoverageLabel } from "@/lib/attention/attentionScore";

function number(value: number | null, digits = 3): string {
  return value === null ? "unavailable" : value.toFixed(digits);
}

export function AttentionVolumeFigure({
  value,
  feedMode,
  label,
}: {
  value: number;
  feedMode: AttentionScoreResult["feedMode"];
  label: string;
}) {
  return (
    <span data-volume-feed-mode={feedMode}>
      {label}: {value.toLocaleString("en-US")} <strong>{volumeCoverageLabel(feedMode)}</strong>
    </span>
  );
}

/** On-demand decomposition. It is intentionally not wired to live scoring yet. */
export function AttentionScoreBreakdown({ result }: { result: AttentionScoreResult }) {
  const explanation = result.explanation;
  const partialFeedUnavailable = result.feedMode === "iex_partial" && result.unavailableReason === "insufficient_reference";
  return (
    <section data-attention-feed-mode={result.feedMode} data-threshold-status={result.thresholdCalibrationStatus}>
      <h3>Attention score explanation</h3>
      <div>Feed mode: {result.feedMode}</div>
      <div>Sub-window: {result.subWindow}</div>
      {partialFeedUnavailable ? (
        <div role="status" data-attention-availability="insufficient_reference">
          unavailable on partial feed
        </div>
      ) : (
        <div>Thresholds: {result.thresholdCalibrationStatus} — ground-truth conclusions refused</div>
      )}
      <div>Calibration: {result.calibrationId} · curve v{result.normalizationVersion} ({result.normalizationCalibrationStatus})</div>
      <AttentionVolumeFigure label="Volume" value={explanation.participation.currentVolume} feedMode={result.feedMode} />
      <AttentionVolumeFigure label="Dollar volume" value={explanation.participation.currentDollarVolume} feedMode={result.feedMode} />
      {[explanation.participation, explanation.displacement, explanation.idiosyncrasy].map((axis) => (
        <div key={axis.axis} data-axis={axis.axis}>
          <strong>{axis.axis}</strong>: input={number(axis.normalizationInput)}, z50={axis.z50}, k={axis.k}, normalized={number(axis.normalized)}
          {axis.components.map((component) => (
            <div key={component.name}>
              {component.name}: raw={number(component.rawValue)}, median={number(component.baselineMedian)}, MAD={number(component.baselineMad)}, p_present={number(component.pPresent)}, surprise={number(component.surpriseBits)}, mode={component.baselineMode}, signal={component.signalKind}, transform={component.baselineTransform}
            </div>
          ))}
        </div>
      ))}
      <div>Core ({explanation.coreAxes.join(" × ")}): {number(explanation.core)}</div>
      <div>Modifier ({explanation.modifierKind}): raw={number(explanation.modifier)}, maximum={number(explanation.maxModifier)}, applied scale={number(explanation.modifierScale)}</div>
      <div>Final: {number(explanation.final, 2)}</div>
    </section>
  );
}
