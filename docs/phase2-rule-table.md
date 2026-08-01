# Phase 2 Rule Table — Prior-Day/Premarket Continuation + Momentum Ladder

Status: specification only. No production code changes. This document is the required
formalization step before either feature is implemented — every vague term used in
conversation gets an exact formula here, so implementation never has to guess.

Both features reuse the existing `Candle`, session-filtering, and scorer infrastructure
already hardened across six Codex review rounds. Neither requires a new data provider or
options access.

---

## Shared foundations both features depend on

### Session boundaries (reuse, do not redefine)

Already correct in `lib/market-data/session.ts` / `sessionFilter.ts`:
- Premarket: `[04:00:00, 09:30:00)` ET
- Regular: `[09:30:00, official close)` ET
- After-hours: `[official close, 20:00:00)` ET

**Known gap, inherited, not fixed by this document**: the existing session logic does not
yet consult a real exchange calendar for early closes/holidays (documented limitation since
Phase 4). Both new features below inherit this same limitation. Do not silently assume every
weekday is a normal full session — if a real calendar dependency is ever added, both features
benefit automatically.

### Immutable anchor requirement (the exact bug this document exists to prevent)

Per Codex's finding: a milestone ladder anchored to a *moving* value (like "current session
low," which keeps changing as new lows form) makes every earlier "held at 3%" reading
retroactively meaningless once the anchor shifts. Both features below use only **immutable,
frozen-at-a-specific-moment** anchors:

| Anchor name | Frozen at | Used by |
|---|---|---|
| `prior_close` | Prior regular session's official close | Continuation detector |
| `prior_high` | Prior regular session's highest traded price | Continuation detector |
| `session_open` | First regular-session candle's open (9:30 bar) | Momentum ladder (default) |
| `premarket_high_at_open` | Highest premarket price, frozen at 9:30:00 | Momentum ladder (optional alt anchor) |

None of these change value once frozen, for the life of that trading day's evaluation.

### Data provenance (reuse existing `DataQuality`/`latestCandleTime` pattern)

Both features must report, per condition, whether they had enough real data to evaluate at
all — reusing the existing `insufficientData` pattern already built for
`consecutiveBullish`/`liquiditySweep` today, not inventing a new one.

---

## Feature A — Premarket Expansion Candidate (supersedes the earlier, simpler continuation detector)

**Status change**: this replaces the original three-rule prior-day/premarket continuation
detector with a considerably more rigorous evidence-group model — historical baseline
comparison instead of a single fixed threshold, QQQ relative strength, and an explicit
safeguard against correlated facts inflating apparent confidence. If you build Feature A,
build this version, not the original A1-A3.

**Illustrative example values below are display formatting only** — never hardcode, seed, or
display them when live calculation is unavailable.

### Rule A1 — Move from prior close

| Field | Definition |
|---|---|
| Rule ID | `premarket_move_from_prior_close` |
| Required input | Latest eligible **completed** premarket bar's price; prior regular-session close via `findPreviousDailyCandle()` (already built tonight for the original Feature A — reused here, not reimplemented) |
| Exact formula | `dollarMove = currentPrice - priorRegularSessionClose`; `percentMove = priorRegularSessionClose > 0 ? dollarMove / priorRegularSessionClose × 100 : null` |
| Forbidden inputs | Yesterday's extended-hours close, today's premarket open, a quote from a mismatched timestamp, an unfinished/still-forming candle |
| Missing-data behavior | If prior regular-session close is unavailable: display "Unavailable," not zero |
| Evidence output | `dollarMove` (usd), `percentMove` (percent) |

### Rule A2 — Premarket volume pace (historical baseline, not a fixed threshold)

| Field | Definition |
|---|---|
| Rule ID | `premarket_volume_pace` |
| Required input | Cumulative volume from 4:00 AM ET through the latest completed bar, **today**; the identical elapsed interval from each of the prior `lookbackSessions` eligible trading days |
| Exact formula | `pace = currentElapsedVolume / median(baselineVolumes)` |
| Configurable threshold | `lookbackSessions: 20` (default), **minimum 10 valid comparison sessions required** or report `insufficientData: true` |
| Missing/excluded-session behavior | Exclude any historical session missing a substantial portion of the comparison interval — do not silently include a partial session as if it were complete |
| Evidence output | `pace` (ratio), `baselineSampleSize` (count) — e.g. "3.2× median, 18 eligible sessions through 9:24 AM ET." Never say "normal" without stating the real sample size behind it. |

### Rule A3 — Premarket range (same historical-baseline principle as A2)

| Field | Definition |
|---|---|
| Rule ID | `premarket_range_expansion` |
| Exact formula | `currentRange = premarketHigh - premarketLow` (elapsed only, today); compare against `median(historicalRanges)` over the identical elapsed interval across the same lookback |
| Comparison operator | `currentRange / baselineMedianRange` |
| Missing-data behavior | Same 10-session minimum as A2; never compare an incomplete current range against complete historical ranges |
| Evidence output | `currentRange` (usd), `rangeMultiple` (ratio) — e.g. "$6.10 · 1.8× median" |

### Rule A4 — Position within premarket range

| Field | Definition |
|---|---|
| Rule ID | `premarket_range_position` |
| Exact formula | `positionPercent = (currentPrice - premarketLow) / (premarketHigh - premarketLow) × 100` |
| Display vs. internal value | Clamp to 0-100 **for display only** — preserve the raw (possibly out-of-range) value internally so a price that's broken outside the previously-observed range isn't concealed |
| Configurable zones | Upper: 75-100%, Middle: 25-75%, Lower: 0-25% |
| Missing-data behavior | Zero or unavailable range → "Unavailable" |
| Important constraint | Being in the upper zone is evidence *toward* a bullish read — it cannot, by itself, qualify a candidate. See Rule A7. |

### Rule A5 — Relative performance vs. benchmark (reuses Rule D's fetch)

| Field | Definition |
|---|---|
| Rule ID | `premarket_relative_strength` |
| Required input | Symbol and benchmark (QQQ, or per-symbol mapping from Rule D2) prices from **matching completed-bar timestamps** — reuses the shared-benchmark-fetch-once-per-cycle infrastructure already built for Rule D tonight, not a second fetch |
| Exact formula | `relativePct = ((symbolCurrent - symbolPriorClose) / symbolPriorClose × 100) - ((benchmarkCurrent - benchmarkPriorClose) / benchmarkPriorClose × 100)` |
| Configurable threshold | `alignedTolerancePct` (default TBD — needs a real decision, see open questions) defines the "Approximately aligned" band |
| Labels | `Outperforming` / `Underperforming` / `Approximately aligned` / `Unavailable` — always display the actual computed difference alongside the label, never the label alone |
| Missing-data behavior | Timestamp mismatch or benchmark data unavailable → `Unavailable`. **Never count missing benchmark data as bearish evidence** — same `insufficientData` discipline as everything built tonight. |

### Rule A6 — Prior-day high/low proximity

| Field | Definition |
|---|---|
| Rule ID | `prior_level_proximity` |
| Exact formula | `distanceDollars = priorDayHigh - currentPrice`; `distancePercent = distanceDollars / priorDayHigh × 100` |
| "Approaching" classification | Within the **larger of** a configured percentage tolerance or a configured fraction of daily ATR — e.g. `priorLevelApproachPercent: 0.25`, `priorLevelApproachAtrFraction: 0.10` (both unvalidated scanner defaults, not probabilities) |
| Display requirement | Always show the actual distance ("$0.84 away (0.24%)") — never an unexplained "Approaching" label with no number behind it |

### Rule A7 — Independent evidence groups (the most important rule in this feature)

**Why this exists**: range position, higher-lows structure, and distance-to-prior-high can all
be restating the same underlying fact (price is near its high) rather than three genuinely
independent pieces of evidence. Counting them separately would silently inflate confidence.

| Field | Definition |
|---|---|
| Rule ID | `premarket_evidence_groups` |
| The six groups | `participation` (Rule A2), `rangeExpansion` (Rule A3), `rangeLocation` (Rule A4), `structure` (higher-lows/lower-highs, reuses existing pivot logic), `priorDayInteraction` (recovery/surrender/pressure/break against prior-day levels), `benchmarkRelativeMove` (Rule A5) |
| Eligibility gate | **At least 3 of 6 groups passing, AND at least one of** `{participation, rangeExpansion, priorDayInteraction}` — this second clause specifically prevents three correlated "price location" facts (rangeLocation + structure + distance-to-high) from qualifying a candidate with zero real volume or range-expansion evidence behind it |
| Mirror requirement | Every rule and threshold above mirrors exactly for bearish candidates (lower range zone, lower-highs structure, surrendering a prior-day rally, underperforming benchmark) |

### Rule A8 — Directional context language

Display: **"Bullish context developing"** or **"Directional context: Bullish developing"** —
a factual rules-based classification, never a prediction. Never "Bias: Bullish pressure
building" or any language implying likelihood/confidence beyond what was actually measured.

### Rule A9 — Confirmation and invalidation

| Field | Definition |
|---|---|
| Confirmation (bullish) | Completed 5m close above active resistance, followed by either a second completed close above it, or a successful retest and bullish close |
| Invalidation | Chosen from real structure only: premarket VWAP, latest confirmed higher-low/lower-high, premarket high/low, or the active breakout level after acceptance |
| Missing-data behavior | If no defensible structural invalidation exists, display **"Invalidation: Not established"** — never invent a price |
| Bearish mirror | Confirmation/invalidation logic mirrors exactly, substituting support for resistance |

### Rule A10 — Freshness (reuses today's `insufficientData`/data-quality patterns throughout)

| Field | Definition |
|---|---|
| Type | `{ scannedAt, latestCompletedBarAt, ageSeconds, status: "real_time" \| "delayed" \| "stale" \| "partial" \| "unavailable" }` |
| Requirement | Never produce a new candidate alert from stale data |
| Display requirement | UI must show "Scanned at 9:25 AM ET" and "Latest completed bar 9:24 AM ET" as visibly distinct values — never conflate scan time with market-data time (the exact class of confusion behind tonight's Action Queue timestamp fix) |

### Display formats

**Collapsed row** (concise, not every calculation):
```
GOOGL  $339.78  +$5.80 (+1.74%)
Bullish PM Candidate · Expansion Rank 58
PM volume 3.2× · PM position 91% · QQQ +1.12%
```

**Expanded evidence display**:
```
PREMARKET CONTEXT
Move from prior close       +$5.80 (+1.74%)
Volume pace                 3.2× median
Premarket range             $6.10 · 1.8× median
Position in range           91%
Relative to QQQ             +1.12%
Distance to prior high      $0.84 (0.24%)

EVIDENCE
Pass  Participation
Pass  Range expansion
Pass  Upper-range hold
Pass  Relative strength
Wait  Prior-day-high break

NEXT
Confirmation  Break and hold above $340.62
Invalidation  Lose PM VWAP at $336.90
```

### Efficiency requirements

Reuse the same fetched bars for every calculation above — do not fetch separately per rule.
Fetch the benchmark once per scan cycle (already built for Rule D). Cache historical premarket
baselines keyed by symbol, comparison cutoff time, and trading date — do not recompute 20
historical sessions on every render. Keep all calculations in pure, testable functions, never
inside React rendering.

### Open architectural decisions — genuinely need your input before a build spec

1. **`alignedTolerancePct` for Rule A5** — no default proposed yet; needs a real number.
2. **The historical-baseline infrastructure itself** (rolling 20-session premarket volume/range
   medians, cached) doesn't exist anywhere in the app — this is new, non-trivial plumbing, not
   a small addition. Worth sizing honestly before committing to it.
3. **What happens for a symbol without 10+ eligible historical premarket sessions** (newly
   added to the watchlist, or newly listed) — Rule A2/A3 correctly degrade to
   `insufficientData`, but worth deciding whether the whole candidate then can't qualify at
   all, or just those two evidence groups become unavailable while others still count.
4. **How this interacts with Feature E (momentum expansion)** — both are now "new setup type"
   detectors evaluated separately from the reversal checklist. Worth deciding whether they're
   fully independent, or whether a symbol satisfying both should be surfaced differently than
   satisfying just one.

This is intentionally left at the formalization stage — genuinely bigger than Rules B-D below,
comparable to or larger than tonight's entire four-rule build. Worth its own dedicated session.

---

## All three decisions — resolved (apply to Rules B and the original A1-A3, which Feature A above now supersedes)

1. **Rejection threshold** (original A1, superseded): two-tier — **2%** = "Rejection", **5%** = "Strong Rejection"
2. **Momentum ladder**: percent-based, tiers **3%, 5%, 8%, 10%, 15%**, with the dollar-equivalent shown alongside each percentage in the display
3. **Anchor**: `session_open`

---

## Feature B — Milestone-Based Momentum Ladder

**Plain description** (from conversation): instead of a strict streak that resets completely
on one red candle (today's MU false-negative), track whether a move is *holding* successive
percentage milestones (3%, 5%, 8%, 10%, configurable), surviving small pullbacks the way the
existing `consecutiveBullish` streak cannot.

### Rule B1 — Milestone definitions

| Field | Definition |
|---|---|
| Rule ID | `momentum_milestone` |
| Required input | Session candles (regular-hours filtered) + `session_open` anchor |
| Exact formula | `movePct = (currentPrice - anchorPrice) / anchorPrice × 100`; `moveDollars = currentPrice - anchorPrice` |
| Comparison operator | `gte` against each configured milestone threshold |
| Configurable threshold | Ladder tiers: **`[3, 5, 8, 10, 15]` percent** — explicitly labeled "unvalidated display defaults," not a validated strategy |
| Units | percent (primary), usd (companion display value) |
| Evaluation timeframe | Same timeframe as the setup being evaluated (5m or 15m) |
| Minimum sample size | 1 candle beyond the anchor point |
| Missing-data behavior | `insufficientData: true` if the session-open candle doesn't exist yet |
| Stale-data behavior | Inherits the underlying candle series' staleness flag |
| Reset behavior | Anchor and all milestone state reset at the start of each new trading day |
| Evidence output | `anchorPrice` (usd), `currentMovePct` (percent), `currentMoveDollars` (usd), `highestMilestoneReached` (percent) — each milestone's display shows both forms, e.g. "+5% ($42.50)" |

### Rule B2 — Per-milestone state (not just "reached," a real lifecycle)

Each configured milestone (3%, 5%, 8%, 10%, etc.) independently tracks its own state:

```
not_reached → reached → holding → lost → reclaimed
                  ↓
               rejected
```

| Field | Definition |
|---|---|
| Rule ID | `milestone_state` (one instance per configured tier) |
| `reached` | Intrabar high/low touched the milestone threshold — may be supported by a wick alone |
| `holding` | Requires a **completed candle's close**, not just an intrabar touch, at or beyond the milestone |
| `lost` | A milestone previously `holding` closes back below the milestone threshold on a completed candle |
| `reclaimed` | A milestone previously `lost` closes back at/above the threshold again on a completed candle |
| `rejected` | A milestone `reached` intrabar but the candle closed back below threshold without ever reaching `holding` |
| Invalid transitions (must be prevented in code) | Cannot go `lost` before `holding`; cannot go `reclaimed` before `lost`; cannot go `rejected` after `holding` (holding implies it already passed the rejected/not-rejected fork) |
| Evidence output | Current state per tier, timestamp of first reaching that state, timestamp of most recent transition |

### Rule B3 — Display / "is this still holding" summary

| Field | Definition |
|---|---|
| Rule ID | `momentum_ladder_summary` |
| Exact formula | Reports the **highest tier currently in `holding` or `reclaimed` state** — this is the direct answer to "is it holding the 3% move, or has it moved on to holding 5%" from tonight's conversation |
| Evidence output | e.g. "Holding +5% (session open $200.00 → current $210.00). Next milestone: +8% ($216.00)." |

**What this rule explicitly does NOT do**: it does not replace `consecutiveBullish` — that
detector still measures short-streak momentum and stays exactly as-is. This is a genuinely
new, separate condition, additive to the existing checklist, not a modification of anything
that exists today.

---

## Feature C — Fair value gap: optional, and the *right* gap, not just *a* gap

**The real problem, named precisely**: today's scorer does two things that work against what you're
describing. First, a valid FVG is currently a **required** condition — one of the things gating
green/confirmed status — even though a gap is a lower-conviction, more experimental signal than
things like a confirmed structure shift. Second, when multiple gaps exist on a chart (which
happens often), the current logic just takes the *first* one it finds with an open/partially-filled
status — not the one actually closest to where price is right now, which is the one that matters.

### Rule C1 — Reclassify FVG from required to optional

| Field | Definition |
|---|---|
| Rule ID | `fair_value_gap_reclassification` |
| Change | `fair_value_gap` condition's `required` flag: `true` → `false`. Category unchanged (`secondary`, weight 2) — it still contributes to score when present, it just no longer gates status. |
| **Explicit, deliberate behavior change** | Green/confirmed status becomes achievable without a fair value gap ever forming. Required-condition count drops from 7 to 6. This is intentional, not a side effect — flagging it plainly per Codex's own rigor about not silently changing requirements. |
| `gap_proximity` (the existing dependent condition) | Stays optional/informational as it already is today — unaffected by this change beyond now depending on an optional parent instead of a required one |

### Rule C2 — Track and rank multiple gaps, surface the closest one

| Field | Definition |
|---|---|
| Rule ID | `fair_value_gap_ranked` |
| Required input | *All* tracked gaps from the existing `detectBullishFairValueGaps` + `trackGapFillStatus` pipeline — not just the first match |
| Exact formula | Filter to gaps with status `"open"` or `"partially_filled"` (a fully filled gap is no longer a valid target). Rank the remainder by `distance = abs(currentPrice - midpoint(gap.lower, gap.upper))`, ascending — closest wins. |
| Comparison operator | Filter: exclude `"filled"`. Rank: ascending distance. |
| Configurable threshold | None new — reuses existing FVG detection thresholds unchanged |
| Units | usd (distance) |
| Evaluation timeframe | Same as existing FVG detector (5m/15m) |
| Minimum sample size | Same as existing (3-candle FVG pattern) |
| Missing-data behavior | Zero qualifying gaps → condition state `"waiting"`, same as today, not fabricated |
| Reset behavior | Recomputed every scan — gaps that fill or expire drop out naturally |
| Evidence output | For the selected (closest) gap: `lower`, `upper`, `status`, `distance` (usd). Also `totalGapsTracked` (count), so the checklist can honestly show "closest of 3 gaps" instead of silently picking one with no indication others exist — directly answering "which gap is the right one." |

---

## Feature D — Benchmark/sector alignment as a real scoring input

Upgrades the Market Context panel's SPY/QQQ/USO display from passive information into an
actual condition the scorer evaluates — reusing existing VWAP/EMA logic, just applied to the
benchmark instead of the stock.

### Rule D1 — Benchmark alignment

| Field | Definition |
|---|---|
| Rule ID | `benchmark_alignment` |
| Required input | The benchmark symbol's own candle series, fetched the same way the underlying stock's candles already are |
| Exact formula | Benchmark counted as "aligned" if its price is above **both** its own session VWAP and its own 9 EMA — reuses the exact existing VWAP/EMA reclaim logic, applied to the benchmark symbol instead of the stock being scored |
| Comparison operator | `gt` on both sub-checks, ANDed |
| Configurable threshold | None beyond the existing, already-proven VWAP/EMA logic |
| Units | state (aligned / not aligned) |
| Evaluation timeframe | Same timeframe as the setup being evaluated |
| Minimum sample size | Same floor as existing VWAP/EMA detectors |
| Missing-data behavior | `insufficientData: true` if benchmark candles can't be fetched — never silently treat "unknown" as "not aligned" |
| Reset behavior | Recomputed every scan |
| Evidence output | `benchmarkSymbol`, `benchmarkPrice` (usd), `benchmarkVwap` (usd), `benchmarkEma` (usd), `aligned` (boolean) |

### Rule D2 — Symbol-to-benchmark mapping

| Field | Definition |
|---|---|
| Rule ID | `benchmark_symbol_resolution` |
| Exact formula | Per-symbol configured override if one exists (e.g. semiconductor names → SMH); otherwise default to **QQQ** for the whole watchlist |
| Missing-data behavior | If no mapping exists and QQQ itself can't be fetched, report `insufficientData: true` — never silently skip without explanation |
| Reset behavior | Configuration-driven, not session-dependent |

### Efficiency requirement (carried forward from the Codex ranking spec, still valid here)

If multiple watchlist symbols share the same benchmark (e.g. five semiconductor names all
mapped to SMH), fetch SMH's candles **once per scan cycle** and reuse across all five — never
issue duplicate benchmark requests per symbol. Real rate-limit consideration, not optional
polish.



---

## Feature E — Momentum Expansion (a genuinely separate setup type)

**Why this exists**: confirmed live on 2026-07-31 — GOOGL moved from ~$328 to ~$358 intraday
(a real, catalyst-driven breakout, not a decline-then-recovery pattern) and scored only 4.2/10,
never alerting, because every existing core condition (`recovery_from_low`, `structure_shift`,
`liquidity_sweep`) assumes a prior selloff that never happened here. The existing scanner is,
structurally, a **reversal detector** — it has no way to recognize "this is already breaking out
and continuing" at all. This isn't a tuning problem; it's a missing setup type, matching what
the Codex ranking-layer spec (discussed earlier tonight) called "momentum expansion" as
distinct from "pullback continuation."

**Architectural consequence, stated plainly**: this requires evaluating each symbol against
**two independent condition sets** — the existing reversal checklist, and a new momentum
checklist — rather than adding one more line to the existing required-conditions list. A
symbol can qualify under either, both, or neither. This is bigger than Rules A-D tonight, and
closer in size to the original rule-engine build.

### Rule E1 — Rapid expansion (ATR-relative, not a fixed percentage)

| Field | Definition |
|---|---|
| Rule ID | `rapid_expansion` |
| Required input | Session candles + existing ATR calculation (`calculateAtr`, already built) |
| Exact formula | `priceChangeOverWindow = candles[last].close - candles[last - N].close` (N = lookback, default 6 candles); `expansionRatio = abs(priceChangeOverWindow) / currentAtr` |
| Comparison operator | `gte` |
| Configurable threshold | `expansionRatio >= 2.0` — moved at least 2x its own normal ATR-based range within the lookback window. ATR-relative (not fixed %) specifically because "unusual" is inherently volatility-relative — a $2 move means something different for a $20 stock than a $850 one. Explicitly "unvalidated default." |
| Units | ratio (ATR multiples) |
| Evaluation timeframe | Same as setup (5m/15m) |
| Minimum sample size | N+1 candles |
| Missing-data behavior | `insufficientData: true` if fewer than N+1 candles or ATR unavailable |
| Reset behavior | Recomputed every scan — this is a "right now" measurement, no persisted state |
| Evidence output | `priceChangeOverWindow` (usd), `currentAtr` (usd), `expansionRatio` (ratio) |

### Rule E2 — Directional consistency (filters out chop, not just volatility)

| Field | Definition |
|---|---|
| Rule ID | `directional_consistency` |
| Required input | Same N-candle window as E1 |
| Exact formula | `sameDirectionCount` = candles closing in the same direction as the overall window move; `directionalRatio = sameDirectionCount / N` |
| Comparison operator | `gte` |
| Configurable threshold | `directionalRatio >= 0.6` — at least 60% of candles agree with the overall direction, so a genuinely choppy/whipsaw stock with high ATR but no real direction doesn't false-positive |
| Missing-data behavior | Same as E1 |
| Evidence output | `sameDirectionCount`, `totalCandles`, `directionalRatio` |

### Rule E3 — Volume confirmation (reuse, do not reimplement)

Reuses the existing `detectVolumeConfirmation` detector exactly as built — no new formula.
Required for this setup type (unlike its optional role in the reversal checklist), since real
participation is what separates a genuine breakout from a low-volume drift.

### Rule E4 — Not excessively extended (reuse, do not reimplement)

Reuses the existing ATR-based extension logic already driving `entryStatus`'s
`extended_do_not_chase` state. Required for this setup type — directly matches Codex's own
explicit callout ("Not excessively extended... a high-scoring setup can still be marked
extended").

### Rule E5 — Combined momentum expansion signal

| Field | Definition |
|---|---|
| Rule ID | `momentum_expansion` |
| Exact formula | `passed = E1.passed && E2.passed && E3.passed && !extended` |
| FVG requirement | Explicitly NOT required, matching both tonight's C1 decision and Codex's original ranking-layer spec |
| Evidence output | Combined message, e.g. "Rapid expansion: 2.4x ATR over 30min, 83% directional consistency, volume confirmed, not extended" |

**What this rule explicitly does NOT do**: predict the move continues. Same anti-overclaiming
language discipline as everything else — "momentum expansion detected" is a description of
what already happened in the data, never a forecast.

### Real, honest limits (say this plainly, don't oversell)

1. This can only recognize a move once real candles exist showing it — it cannot alert before
   any price action has happened. It can catch a breakout meaningfully earlier than "never,"
   not at the literal first tick.
2. It has zero access to *why* a move is happening (earnings, news, guidance) — that requires
   a completely separate data source (an earnings/news calendar) not integrated anywhere in
   this app. This detects the shape of the move, not its cause.

## Open architectural decisions — genuinely need your input before any build spec

1. **How does a `momentum_expansion` qualification surface on the dashboard** alongside the
   existing reversal-based stage/status? Does a symbol get a second, independent
   score/status specifically for this setup type, shown alongside the existing one? Or does
   qualifying under momentum expansion elevate the existing `convictionLevel` some other way?
   This needs a real UI decision, not a guess.
2. **Does `Ranked Opportunities` need a way to show which setup type a symbol qualified
   under** (reversal vs. momentum expansion vs. both), so you can tell at a glance which kind
   of setup you're looking at?
3. **E1's lookback window (6 candles) and thresholds (2.0x ATR, 60% directional consistency)**
   are unvalidated starting guesses, same status as tonight's other unvalidated defaults —
   worth sitting with real examples (like today's GOOGL candles) before locking in.

This is intentionally left at the formalization stage, not a build spec — this is genuinely
bigger than tonight's Rules A-D and deserves its own dedicated session to work through the
architecture decisions above properly, not a rushed default at the end of a very long night.

---

## Build spec — already executed tonight (historical record, kept for reference)

**Note on Rule A specifically**: this section describes what was actually built and shipped
tonight, which used the *original*, simpler three-rule prior-day/premarket continuation
detector (rejection + reclaim + combined) — not the more rigorous Premarket Expansion
Candidate formalization above, which is a proposed *replacement* for future work, not yet
built. If Feature A above gets implemented later, it should replace the live
`priorDayContinuation.ts` described below, not sit alongside it.

BEFORE EDITING

1. Read `lib/indicators/sessionDecline.ts`, `lib/indicators/emaReclaim.ts`,
   `lib/indicators/fairValueGap.ts`, and `lib/strategies/scorer.ts` to confirm the exact
   patterns to follow: currently-held reclaim semantics, `insufficientData` reporting,
   category/weight assignment, how the FVG pipeline currently tracks gaps, and how conditions
   get added to the checklist array.
2. Run `git status --short` and confirm a clean starting point.
3. Run the existing test suite, TypeScript check, and production build to record a baseline.

Do not change:
- Any existing detector's pass/fail logic beyond exactly what Rules C1/C2 specify for FVG
- Scoring weights (beyond FVG's `required` flag per C1) or the 0-10 normalization
- Alert generation for anything other than the new conditions below
- Session filtering, timezone handling, or any of tonight's earlier fixes

REQUIRED IMPLEMENTATION

**Rule A (prior-day/premarket continuation, original simpler version — already built)**: new
file `lib/indicators/priorDayContinuation.ts` implementing the original Rules A1-A3 — two-tier
rejection (2%/5%), genuine premarket reclaim using the same "currently held, not just touched"
pattern already proven in `detectVwapReclaim`/`detectEmaReclaim`, combined into one condition.
Added as a new, optional (not required) condition in the checklist, category `secondary`.

**Rule B (momentum ladder)**: new file `lib/indicators/momentumLadder.ts` implementing Rules
B1-B3 exactly as specified above — `session_open` anchor, 5-tier percent ladder with dollar
display, per-milestone state machine (`not_reached → reached → holding → lost → reclaimed`,
`rejected` branch) with the exact invalid-transition guards specified in Rule B2. Add as a
new, optional condition in the checklist, category `supporting`.

**Rule C (FVG reclassification + multi-gap ranking)**: modify the existing FVG handling in
`scorer.ts` per C1 (flip `required` to `false`, document the required-count change from 7 to
6 explicitly in a comment) and extend the existing gap-tracking pipeline per C2 (rank all
qualifying gaps by distance to current price instead of taking the first match, surface
`totalGapsTracked` in the evidence/detail text).

**Rule D (benchmark alignment)**: new file `lib/indicators/benchmarkAlignment.ts`
implementing D1-D2 — reuses existing VWAP/EMA detector logic applied to a benchmark symbol,
with the per-symbol-or-QQQ-default resolution from D2. Add as a new, optional condition,
category `secondary`. Implement the shared-benchmark-fetch efficiency requirement (one fetch
per unique benchmark per scan cycle, not per symbol) in `scanService.ts`'s scan loop.

All four new/changed conditions must use the existing `insufficientData`-style distinction
(per today's reporting-defect fixes) rather than an ambiguous zero-object for "no data" vs.
"checked and found nothing."

TESTS

Cover every row in Rules A1-A3, B1-B3, C1-C2, and D1-D2's tables: insufficient-data cases,
the two-tier rejection boundary exactly at 2% and 5%, genuine premarket reclaim vs.
never-reclaimed vs. reclaimed-then-lost, milestone state transitions including the
explicitly-invalid ones (prove they're rejected), daily reset behavior, FVG required-count
dropping from 7 to 6 with a real fixture proving green is now reachable without a gap,
multi-gap ranking picking the closest of 3+ synthetic gaps correctly, benchmark alignment
with a real fixture, and the shared-benchmark-fetch efficiency requirement (prove it's not
re-fetched per symbol when multiple symbols share one benchmark).

VERIFICATION

Full test suite, TypeScript check, production build. Confirm zero unintended changes to any
existing condition's pass/fail logic, scoring weights, or alert behavior beyond exactly what
C1 specifies for FVG.

Do not commit, push, deploy, or create a zip unless explicitly requested.
