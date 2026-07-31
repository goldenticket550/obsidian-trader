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

## Feature A — Prior-Day / Premarket Continuation Detector

**Plain description** (from conversation): a level got tested and rejected yesterday; if
premarket action today shows genuine signs of reclaiming or holding above that same level,
that's a different, earlier signal than anything the existing scanner produces (which only
looks within a single session).

### Rule A1 — Prior-day rejection identified (two-tier)

**Implementation note (resolves a real gap found during build)**: identifying "the prior
daily candle" is not safe to do positionally. `alpacaProvider.ts` deliberately does not
session-filter the `1d` series, so during market hours the daily array's last element is
*today's* still-forming bar, not yesterday's complete one — the same class of bug already
fixed once tonight for `findPreviousClose()`. Do not reimplement that logic a second time:
refactor `findPreviousClose()` in `lib/market-data/sessionFilter.ts` to build on a new
`findPreviousDailyCandle()` that returns the whole candle (not just `.close`), so
`findPreviousClose` becomes a one-line wrapper around it. Rule A1 pulls both `.high` and
`.close` from that same, already-tested lookup. If no candle exists with an ET date strictly
before today's, report `insufficientData: true` — never fabricate a rejection from today's
own forming candle.

| Field | Definition |
|---|---|
| Rule ID | `prior_day_rejection` |
| Required input | Prior regular-session daily candle (already fetched via existing `dailyCandles`) |
| Exact formula | `rejectionLevel = prior_high`. Two tiers: `rejected` if `prior_close <= rejectionLevel × (1 - 0.02)`; `stronglyRejected` if `prior_close <= rejectionLevel × (1 - 0.05)` |
| Comparison operator | `lte` for each tier independently |
| Configurable threshold | `rejectionThresholdPct: 0.02` (matches the existing `intradayDecline` convention already in production), `strongRejectionThresholdPct: 0.05` |
| Units | percent |
| Evaluation timeframe | Daily (1 candle = 1 prior session) |
| Minimum sample size | 1 complete prior daily candle |
| Missing-data behavior | `insufficientData: true` if no prior daily candle exists — never fabricate a rejection |
| Stale-data behavior | Evaluate but propagate the prior daily candle's own data-quality flag |
| Reset behavior | Recomputed fresh every trading day |
| Evidence output | `rejectionLevel` (usd), `priorClose` (usd), `declinePct` (percent), `tier` ("rejection" \| "strong_rejection" \| "none") |

---

## All three decisions — resolved

1. **Rejection threshold**: two-tier — **2%** = "Rejection" (matches the existing `intradayDecline` convention already running in production), **5%** = "Strong Rejection"
2. **Momentum ladder**: percent-based, tiers **3%, 5%, 8%, 10%, 15%**, with the dollar-equivalent shown alongside each percentage in the display
3. **Anchor**: `session_open`

No open decisions remain. This document is now implementation-ready.

### Rule A2 — Premarket reclaim of the rejected level

**Implementation note (resolves a real gap found during build)**: `GetCandlesParams` has no
`sessionScope` field today, and the provider hardcodes `filterToLatestSession(allCandles)`
defaulting to `"regular"` — premarket bars never reach the scorer as things stand. Add an
optional `sessionScope?: SessionScope` to `GetCandlesParams`, defaulting to today's exact
existing behavior so nothing currently working changes, thread it through the provider(s),
and fetch a premarket-scoped series specifically for this rule in `scanService.ts`.
`filterToLatestSession`'s internal logic stays completely untouched — this only lets a
caller explicitly request a scope it already knows how to produce.

| Field | Definition |
|---|---|
| Rule ID | `premarket_reclaim` |
| Required input | Premarket candles for *today*, session-filtered to `sessionScope: "extended"` bucket, restricted further to only the premarket window |
| Exact formula | Genuine reclaim, same "was below, now closes above" pattern as existing EMA/VWAP reclaim detectors (not "currently above," a real cross) — `reclaimLevel = rejectionLevel` from Rule A1 |
| Comparison operator | `gt` (close), cross-detection identical in structure to `detectVwapReclaim`'s "currently held" semantics fixed earlier today |
| Configurable threshold | None beyond the reclaim itself — this is presence/absence, not a magnitude threshold |
| Units | state (pass/waiting/fail) |
| Evaluation timeframe | 5-minute premarket candles |
| Minimum sample size | 2 premarket candles minimum (same floor as existing reclaim detectors) |
| Missing-data behavior | `insufficientData: true` if fewer than 2 premarket candles exist yet (e.g. evaluated at 4:05am) — genuinely different from "checked and failed," per today's reporting-defect fix pattern |
| Stale-data behavior | Free-tier IEX feed has materially thinner premarket coverage than regular hours (known, already-documented limitation) — if the premarket candle count is implausibly low for the time of day, flag `sparseData: true` in evidence rather than silently treating thin data as "no reclaim" |
| Reset behavior | Fresh every trading day, tied to Rule A1's fresh `rejectionLevel` |
| Evidence output | `reclaimLevel` (usd), `currentPremarketPrice` (usd), `reclaimCandleTime` (timestamp), `sparseData` (boolean) |

### Rule A3 — Combined continuation signal

| Field | Definition |
|---|---|
| Rule ID | `prior_day_continuation` |
| Required input | Results of A1 and A2 |
| Exact formula | `passed = A1.passed && A2.passed` |
| Missing-data behavior | If either A1 or A2 is `insufficientData`, the combined result is `insufficientData`, never silently treated as fail |
| Evidence output | Combines both sub-rules' evidence into one message: e.g. "Prior-day rejection at $220.10 (−2.3%), premarket reclaimed at $221.40" |

**What this rule explicitly does NOT do** (per Codex's language requirements): it does not
predict continuation into the regular session. Display language must read like "Prior-day
selloff recovery is developing; premarket has reclaimed the rejected level" — never "this
means the stock will continue higher" or any probability/confidence claim.

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



## Build spec — ready to hand to Claude Code

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

**Rule A (prior-day/premarket continuation)**: new file `lib/indicators/priorDayContinuation.ts`
implementing Rules A1-A3 exactly as specified above — two-tier rejection (2%/5%), genuine
premarket reclaim using the same "currently held, not just touched" pattern already proven in
`detectVwapReclaim`/`detectEmaReclaim`, combined into one condition. Add as a new, optional
(not required) condition in the checklist, category `secondary`.

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
