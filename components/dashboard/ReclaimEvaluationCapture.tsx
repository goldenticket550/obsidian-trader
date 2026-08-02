"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReclaimSymbolResult } from "@/lib/scanner/reclaimRunner";
import {
  appendEvaluationRows,
  buildEvaluationRows,
  countScans,
  toCsv,
  toNdjson,
  MAX_EVALUATION_ROWS,
  type ReclaimEvaluationRow,
} from "@/lib/evaluation/reclaimEvaluationLog";

/**
 * Reclaim EVALUATION CAPTURE — session transcript and export.
 *
 * Reclaim is display-only: the tier is computed and shown but never
 * emitted, so nothing durable records what the rules said during a live
 * session. This accumulates that transcript IN MEMORY, in this component's
 * state, and lets it be downloaded for threshold review.
 *
 * Deliberately client-only and deliberately volatile:
 *  - no server route, no database, no provider call — it only reads the
 *    scan payload the dashboard already has;
 *  - no localStorage or sessionStorage, so nothing outlives the tab and
 *    no market data is silently persisted anywhere;
 *  - export is an in-browser Blob download.
 *
 * Nothing here is an alert. The captured tier is recorded EVALUATION
 * output — what the rules would have said — and is labelled as such.
 */
export function ReclaimEvaluationCapture({
  reclaimBySymbol,
  scanTime,
  maxRows = MAX_EVALUATION_ROWS,
}: {
  reclaimBySymbol?: Record<string, ReclaimSymbolResult>;
  /** The SCAN's timestamp. Null means the scan is undated. */
  scanTime: string | null;
  maxRows?: number;
}) {
  const [rows, setRows] = useState<ReclaimEvaluationRow[]>([]);
  /**
   * The last scan actually captured. A re-render with the same scan must
   * not re-append, and neither must React's double-invoked effects in
   * development — the per-symbol de-duplication would absorb both, but
   * skipping the work outright is cheaper and states the intent.
   */
  const capturedScanRef = useRef<string | null>(null);

  useEffect(() => {
    // An undated scan is not captured. A row stamped with the browser
    // clock would look like a scan time and would not be one.
    if (!reclaimBySymbol || scanTime === null) return;
    if (capturedScanRef.current === scanTime) return;
    capturedScanRef.current = scanTime;

    const incoming = buildEvaluationRows(reclaimBySymbol, scanTime);
    // `appendEvaluationRows` returns the SAME array when a scan added
    // nothing, so a quiet market causes no state update and no re-render.
    setRows((current) => appendEvaluationRows(current, incoming, maxRows));
  }, [reclaimBySymbol, scanTime, maxRows]);

  const download = useCallback((contents: string, filename: string, mime: string) => {
    const blob = new Blob([contents], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    // Released immediately: the log can be large and the tab may stay
    // open for the whole session.
    URL.revokeObjectURL(url);
  }, []);

  const stamp = rows[rows.length - 1]?.scannedAt ?? "session";
  const filename = (extension: string) =>
    `reclaim-evaluation-${stamp.replace(/[:.]/g, "-")}.${extension}`;

  const exportNdjson = useCallback(() => {
    download(toNdjson(rows), filename("ndjson"), "application/x-ndjson");
    // `filename` closes over `rows`, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, download]);

  const exportCsv = useCallback(() => {
    download(toCsv(rows), filename("csv"), "text/csv");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, download]);

  // Nothing evaluated and nothing captured: the panel does not exist.
  // Once rows HAVE been captured it stays, even if a later scan omits
  // Reclaim — otherwise a transient absence would strand the session's
  // only copy of the transcript with no way to export it.
  if (!reclaimBySymbol && rows.length === 0) return null;

  const empty = rows.length === 0;

  return (
    <section className="command-panel overflow-hidden" aria-label="Reclaim evaluation capture">
      <div
        className="px-4 py-2.5 flex items-baseline justify-between flex-wrap gap-2"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div>
          <h2 className="card-heading">Evaluation capture</h2>
          <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            Recorded evaluation output for threshold review — not alerts, and not saved anywhere
          </p>
        </div>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded"
          style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
        >
          In-memory only
        </span>
      </div>

      <div className="px-4 py-3 flex items-center justify-between flex-wrap gap-3">
        <dl className="flex items-center gap-5">
          <div>
            <dt className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              Rows
            </dt>
            <dd className="text-sm tabular-nums" data-testid="evaluation-row-count">
              {rows.length}
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                {" "}
                / {maxRows}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              Scans
            </dt>
            <dd className="text-sm tabular-nums" data-testid="evaluation-scan-count">
              {countScans(rows)}
            </dd>
          </div>
        </dl>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportNdjson}
            disabled={empty}
            className="text-[11px] px-2 py-1 rounded disabled:opacity-40"
            style={{ border: "1px solid var(--border)" }}
          >
            Export evaluation log (NDJSON)
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={empty}
            className="text-[11px] px-2 py-1 rounded disabled:opacity-40"
            style={{ border: "1px solid var(--border)" }}
          >
            CSV
          </button>
        </div>
      </div>

      {empty ? (
        <p className="px-4 pb-3 text-[10px]" style={{ color: "var(--text-muted)" }}>
          Nothing captured yet. Rows are appended as scans arrive, and only when a symbol&apos;s
          read actually changes.
        </p>
      ) : null}
    </section>
  );
}
