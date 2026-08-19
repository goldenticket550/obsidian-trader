import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { generateLabelCandidates } from "../lib/replay/labelAssistant";
import type { RecordedSession } from "../lib/replay/types";

const value = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};

const input = value("input");
if (!input) throw new Error("Usage: npm run labels:candidates -- --input session.json.gz [--exclude NVDA,AAPL] [--travel-atr 1]");
const path = resolve(input);
const bytes = readFileSync(path);
const session = JSON.parse(path.endsWith(".gz") ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8")) as RecordedSession;
const excluded = (value("exclude") ?? "").split(",").map((symbol) => symbol.trim()).filter(Boolean);
const travel = Number(value("travel-atr") ?? "1");
if (!Number.isFinite(travel) || travel <= 0) throw new Error("--travel-atr must be a positive number.");
const result = generateLabelCandidates(session, excluded, {
  topRangePercentile: 0.9,
  windowMinutes: 30,
  windowTravelAtr: travel,
  maxBackdatePullbackAtr: 0.15,
  volumeWakeupMultiple: 2,
  openingRangeMinutes: 15,
});
const output = resolve(value("out") ?? `data/replay/labels/${session.tradingDate}-candidates.json`);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  tradingDate: result.tradingDate,
  eligibleSymbols: result.eligibleSymbols,
  candidates: result.candidates.length,
  pending: result.candidates.filter((candidate) => candidate.decision === "pending").length,
  rangeDecileCutoff: result.rangeDecileCutoff,
  output,
}, null, 2));
