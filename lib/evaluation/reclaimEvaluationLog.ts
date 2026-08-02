import type { ReclaimSymbolResult, ReclaimAlertTier, ReclaimAlignment } from "@/lib/scanner/reclaimRunner";
import type { ReclaimDirection, ReclaimEvidenceGroup, ReclaimStage } from "@/lib/scanner/reclaimContinuation";
import type { FreshnessStatus } from "@/lib/indicators/premarketExpansion";

/**
 * EVALUATION CAPTURE — pure log mechanics.
 *
 * Reclaim runs with `alertingEnabled: false`, so its tier is computed and
 * displayed but never emitted. That leaves no record of what the rules
 * actually said across a live session, which is exactly what threshold
 * tuning needs. This module accumulates one compact row per symbol per
 * scan so a session can be exported and reviewed afterwards.
 *
 * Deliberately pure and framework-free: no React, no browser APIs, no
 * storage, no network. The component owns the state; this owns the rules
 * about what a row is, when a row is worth keeping, and how rows
 * serialize. That split is what makes the behaviour testable without
 * rendering anything.
 *
 * Every value is copied from the runner result as-is. Nothing here is
 * an alert, a recommendation, or a derived score — it is a transcript.
 */

/** Evidence group names, in the order the runner reports them. */
export const EVIDENCE_GROUP_NAMES: ReclaimEvidenceGroup["name"][] = [
  "resetDepth",
  "failedContinuation",
  "controlReclaim",
  "participation",
  "roomToContinue",
  "dataFreshness",
];

/**
 * One symbol's read at one scan.
 *
 * Flat and small on purpose: a session can produce thousands of these,
 * and they have to stay cheap to hold, compare and serialize. Anything
 * the runner could not measure stays null — never zero standing in for
 * "unknown", which would be indistinguishable from a real measurement.
 */
export interface ReclaimEvaluationRow {
  /** The SCAN's own timestamp, not the browser clock. */
  scannedAt: string;
  symbol: string;
  sessionDate: string;
  /** Five-minute stage — the system of record. */
  stage: ReclaimStage;
  direction: ReclaimDirection | null;
  oneMinuteStage: ReclaimStage;
  alignment: ReclaimAlignment;
  /**
   * The rules-derived EVALUATION tier. Recorded because it is the thing
   * being tuned; it was never emitted as an alert.
   */
  alertTier: ReclaimAlertTier;
  resetDollars: number | null;
  resetAtr: number | null;
  nextLevelName: string | null;
  nextLevelPrice: number | null;
  distanceToNextLevelAtr: number | null;
  invalidationName: string | null;
  invalidationPrice: number | null;
  freshness: FreshnessStatus | null;
  isNewSetup: boolean;
  /** Group name -> state, for the six evidence groups. */
  evidence: Partial<Record<ReclaimEvidenceGroup["name"], ReclaimEvidenceGroup["state"]>>;
}

/**
 * Row cap. One row is one symbol at one scan, so a 20-symbol watchlist
 * scanning every 30s reaches this in roughly 45 minutes of CHANGING
 * reads — quiet symbols cost nothing because they de-duplicate away.
 */
export const MAX_EVALUATION_ROWS = 2000;

/** Builds one row per symbol from a scan's Reclaim output. */
export function buildEvaluationRows(
  reclaimBySymbol: Record<string, ReclaimSymbolResult>,
  scannedAt: string
): ReclaimEvaluationRow[] {
  return Object.keys(reclaimBySymbol)
    .sort()
    .map((symbol) => {
      const entry = reclaimBySymbol[symbol];
      const five = entry.fiveMinute;
      const evidence: ReclaimEvaluationRow["evidence"] = {};
      for (const group of five?.evidence ?? []) {
        evidence[group.name] = group.state;
      }

      return {
        scannedAt,
        symbol: entry.symbol,
        sessionDate: entry.sessionDate,
        stage: entry.stage,
        direction: entry.direction,
        oneMinuteStage: entry.oneMinuteStage,
        alignment: entry.alignment,
        alertTier: entry.alertTier,
        // Null, not zero, whenever the machine had no active read.
        resetDollars: five?.resetDollars ?? null,
        resetAtr: five?.resetAtr ?? null,
        nextLevelName: five?.nextLevelName ?? null,
        nextLevelPrice: five?.nextLevelPrice ?? null,
        distanceToNextLevelAtr: five?.distanceToNextLevelAtr ?? null,
        invalidationName: five?.invalidationName ?? null,
        invalidationPrice: five?.invalidationPrice ?? null,
        freshness: five?.freshness ?? null,
        isNewSetup: entry.isNewSetup,
        evidence,
      };
    });
}

/**
 * Everything about a row EXCEPT when it was taken.
 *
 * The timestamp necessarily changes every scan, so comparing whole rows
 * would defeat de-duplication entirely. Two rows with the same signature
 * describe the same market read at two different moments, and only the
 * first is worth keeping.
 */
export function rowSignature(row: ReclaimEvaluationRow): string {
  const { scannedAt, ...rest } = row;
  void scannedAt;
  return JSON.stringify({
    ...rest,
    // Key order in `evidence` follows insertion, so normalize it —
    // otherwise an identical read could produce two signatures.
    evidence: EVIDENCE_GROUP_NAMES.map((name) => rest.evidence[name] ?? null),
  });
}

/**
 * Appends a scan's rows, dropping any symbol whose read is unchanged
 * since its own most recent entry, then trims to the cap.
 *
 * De-duplication is PER SYMBOL and compares against that symbol's last
 * kept row, not the previous scan's — so a symbol that goes quiet, then
 * changes, then returns to its earlier read still records all three.
 *
 * Returns the existing log unchanged (same reference) when nothing was
 * appended, so a caller can skip a re-render on a quiet scan.
 */
export function appendEvaluationRows(
  log: readonly ReclaimEvaluationRow[],
  rows: readonly ReclaimEvaluationRow[],
  maxRows: number = MAX_EVALUATION_ROWS
): ReclaimEvaluationRow[] {
  const lastSignatureBySymbol = new Map<string, string>();
  for (const row of log) {
    lastSignatureBySymbol.set(row.symbol, rowSignature(row));
  }

  const kept: ReclaimEvaluationRow[] = [];
  for (const row of rows) {
    const signature = rowSignature(row);
    if (lastSignatureBySymbol.get(row.symbol) === signature) continue;
    lastSignatureBySymbol.set(row.symbol, signature);
    kept.push(row);
  }

  if (kept.length === 0) return log as ReclaimEvaluationRow[];

  const combined = [...log, ...kept];
  // Oldest rows fall off the front; the most recent window is what
  // matters for tuning.
  return combined.length > maxRows ? combined.slice(combined.length - maxRows) : combined;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** Newline-delimited JSON: one row per line, streamable, no outer array. */
export function toNdjson(rows: readonly ReclaimEvaluationRow[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n");
}

const CSV_COLUMNS = [
  "scannedAt",
  "symbol",
  "sessionDate",
  "stage",
  "direction",
  "oneMinuteStage",
  "alignment",
  "alertTier",
  "resetDollars",
  "resetAtr",
  "nextLevelName",
  "nextLevelPrice",
  "distanceToNextLevelAtr",
  "invalidationName",
  "invalidationPrice",
  "freshness",
  "isNewSetup",
] as const;

/**
 * RFC-4180 quoting. `nextLevelName` joins level sources with " / " and
 * could pick up a comma from a future source name, so quoting is not
 * optional even though today's values happen to be safe.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Flat CSV; the six evidence groups become their own columns. */
export function toCsv(rows: readonly ReclaimEvaluationRow[]): string {
  const header = [...CSV_COLUMNS, ...EVIDENCE_GROUP_NAMES].join(",");
  const lines = rows.map((row) =>
    [
      ...CSV_COLUMNS.map((column) => csvCell(row[column])),
      ...EVIDENCE_GROUP_NAMES.map((name) => csvCell(row.evidence[name])),
    ].join(",")
  );
  return [header, ...lines].join("\n");
}

/** Distinct scans represented, for the on-screen count. */
export function countScans(rows: readonly ReclaimEvaluationRow[]): number {
  return new Set(rows.map((row) => row.scannedAt)).size;
}
