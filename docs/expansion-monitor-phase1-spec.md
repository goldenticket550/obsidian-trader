# Premarket Expansion Candidate + Expansion Monitor Phase 1 — approved build spec

**Status: authoritative.** This document is the corrected, approved version of Feature A and
supersedes anything conflicting in `docs/phase2-rule-table.md`'s Feature A section. Read that
section for background only; where the two disagree, this file wins.

Two specs combined into one implementation pass:

1. the fully-corrected **Premarket Expansion Candidate** feature, and
2. **Phase 1 only** of the Expansion Monitor amendment — stage-based prioritization, early
   acceleration alerts, and dollar-volume shock.

Phases 2–5 of the Expansion Monitor (sector ETFs / gap / compression / extension, catalyst
context, forward outcome logging, final UI) are explicitly **out of scope** and follow
separately. Catalyst context specifically is blocked on a real decision about adding a news
data provider, which has not been made.

Do not replace the existing `priorDayContinuation` behavior until tests prove the replacement
preserves every intended existing consumer. Prefer adding the new module independently and
then adapting the two known consumers (`scorer.ts:23` and `scorer.ts:144`) deliberately.

---

# PART 1: PREMARKET EXPANSION CANDIDATE (fully corrected)

The following final decisions replace ambiguous language in the previous spec.

## 1. Remove Expansion Rank completely

Remove Expansion Rank, `rankScore`, `rankComponents`, ranking bands, rank weights, and every
example containing a numerical expansion rank. **Do not replace it with another score.**

Present: qualifying badge; direction; expansion stage; passed evidence groups;
failed/waiting/unavailable evidence groups; current move; active level; next confirmation;
invalidation.

Collapsed example:

```
GOOGL  $339.78  +$5.80 (+1.74%)
Bullish Premarket Candidate
PM volume 3.2× · PM position 91% · QQQ +1.12%
4 of 6 evidence groups passing
```

Do not rank symbols using a hidden formula. For this build: preserve the existing Ranked
Opportunities ordering, add a prominent expansion badge to qualifying symbols, put
`breakout_accepted` and `expansion_invalidated` events in Review Now, and treat cross-symbol
expansion ranking as explicitly out of scope.

## 2. Define active confirmation levels precisely

For a bullish candidate, possible resistance references are: premarket reference high,
prior-day high. For bearish: premarket reference low, prior-day low. Select the nearest valid
level in the direction of travel:

```ts
// Bullish
const unbrokenResistances = validLevels
  .filter((level) => level.price > latestCompletedClose)
  .sort((a, b) => a.price - b.price);
const activeResistance = unbrokenResistances[0] ?? null;

// Bearish
const unbrokenSupports = validLevels
  .filter((level) => level.price < latestCompletedClose)
  .sort((a, b) => b.price - a.price);
const activeSupport = unbrokenSupports[0] ?? null;
```

Use tolerance-aware comparisons, not exact floating-point equality.

Do not treat a first close beyond both levels as fully confirmed merely because no unbroken
level remains. If the latest completed candle has just broken the final reference but
acceptance is not confirmed, display `Next confirmation: Hold above both premarket and
prior-day highs` (or bearish mirror). Only after the acceptance rule passes may the UI display
`Breakout accepted above both premarket and prior-day highs` (bearish mirror: `Breakdown
accepted below both premarket and prior-day lows`).

**Acceptance requires:** two completed 5-minute closes beyond the level; **or** break,
controlled retest, and completed close back in the breakout direction.

Distinct situations:

- Unbroken reference exists: `Break and hold above/below [level]`
- First break occurred, acceptance pending: `Hold above/below [level or both levels]`
- Acceptance completed: `Breakout/breakdown accepted`

## 3. Final freshness rules

```ts
type FreshnessStatus = "real_time" | "delayed" | "stale" | "partial" | "unavailable";
```

**Unavailable:** no eligible market bars exist.

**Delayed:** determined only from known feed metadata / provider configuration, never inferred
from bar age. A delayed feed may generate a candidate only when the delay is known and bounded,
the latest eligible completed bar is no older than the known delay plus two candle intervals,
and every alert visibly says it is based on delayed data.

**Real-time:** for a real-time feed with five-minute confirmation candles, latest completed bar
age `<= 10 minutes`. General formula: `ageMs <= 2 * candleIntervalMs`.

**Stale:** for a real-time feed, latest completed bar age `> 10 minutes`. Use 10 minutes as the
enforceable alert boundary — there is no undefined 10–15 minute state. The UI may additionally
describe data older than three intervals as "severely stale" as explanatory text only, not a
separate state.

**Partial:** does **not** mean a normal live candle is currently forming (that would block every
live alert during market hours). Instead: the specific dataset or completed evaluation window
required by the calculation is incomplete — missing bars inside a required confirmation
sequence, a partially-returned historical session, a 5m candle that cannot be constructed from
source bars, or an incomplete elapsed historical comparison window. Ignore an
ordinarily-forming current candle; evaluate the latest completed candle. Its existence alone
must not set the result to partial.

**Alert gate:** a new candidate alert may be produced only when `real_time`, or `delayed` with a
known bounded delay and acceptable delayed-feed age. Block new alerts when `stale`, `partial`,
or `unavailable`. Existing candidates may remain visible in a non-actionable state with the
freshness warning attached.

## 4. Prior-day level sign convention

```ts
const signedDistance = currentPrice - priorDayHigh;
const absoluteDistance = Math.abs(signedDistance);
const percentDistance = priorDayHigh > 0 ? (absoluteDistance / priorDayHigh) * 100 : null;
```

Render:

- Below: `Prior-day high: $0.84 away (0.24%)`
- At: `Prior-day high: Testing level` (use a configured tolerance for "Testing level")
- Above: `Prior-day high: Broken, $0.84 above (0.24%)`

Mirror for prior-day low (Above / At / Below with "away" / "Testing level" / "Broken… below").

Feed these explicit states into `priorDayInteraction`:

```ts
type LevelInteraction =
  | "not_near"
  | "approaching"
  | "testing"
  | "broken"
  | "accepted"
  | "rejected"
  | "unavailable";
```

A break and an accepted break are **not** the same state.

## 5. Separate the reference range from the displayed session range

Two distinct concepts.

**Premarket reference range** — the range established BEFORE the evaluation candle:

```ts
premarketReferenceHigh = max(high of completed premarket bars before evaluationBar);
premarketReferenceLow  = min(low  of completed premarket bars before evaluationBar);
```

Use for: breakout detection, breakdown detection, raw position calculation, out-of-range
detection, active resistance/support, confirmation messaging. This allows the evaluation candle
to close above 100% or below 0% of the previously established range.

**Complete elapsed premarket range** — includes ALL eligible completed premarket bars through
the evaluation candle:

```ts
premarketSessionHigh = max(high of completed premarket bars through evaluationBar);
premarketSessionLow  = min(low  of completed premarket bars through evaluationBar);
```

Use for: displayed total premarket high/low, displayed premarket range, historical
range-multiple comparison, descriptive session statistics. Do not label the reference range as
the complete premarket high/low.

Range-position calculation (against the **reference** range):

```ts
rawPremarketPositionPercent =
  premarketReferenceHigh > premarketReferenceLow
    ? ((currentPrice - premarketReferenceLow) /
        (premarketReferenceHigh - premarketReferenceLow)) * 100
    : null;
```

Preserve the raw value internally. Examples: 91% = inside upper portion; 108% = 8% of the
reference range above its high; −6% = 6% below its low. Clamp only the progress-bar rendering
to 0–100; display breakout/breakdown state separately so the UI never conceals the out-of-range
value.

Require a configurable minimum number of preceding completed bars before establishing a
reference range. One bar or a zero-width range = insufficient data.

## 6. Premarket volume baseline safeguards

Compute premarket volume pace only when ALL are true: elapsed premarket time `>= 15 minutes`;
at least the configured minimum number of eligible historical sessions; baseline median
cumulative volume `>= 500 shares`; current comparison window complete; historical comparison
windows complete.

```ts
minimumElapsedPremarketMinutes: 15;
minimumBaselineMedianVolume: 500;
minimumBaselineSessions: 10;
baselineLookbackSessions: 20;
```

If any gate fails: `{ value: null, insufficientData: true, reason: "specific reason" }`

Examples: `Premarket volume pace: Waiting for 15 minutes of premarket data` /
`Baseline volume too small` / `Insufficient comparison sessions`.

Do not convert insufficient data to zero, 1×, pass, or fail. The 500-share default is an
operational noise floor, **not** a validated trading threshold — keep it centralized and
configurable.

## 7. Correct historical cache design

Cache **raw historical bars**, not cutoff-specific aggregates.

Cache key: provider feed + symbol + historical session date + bar timeframe. Do **NOT** include
the current cutoff time in the raw-bar cache key. Fetch each required historical session dataset
once, then calculate cumulative volume and range from the cached bars in memory for the current
cutoff.

```ts
const historicalBars = await getCachedHistoricalBars(symbol, historicalSessionDates, feed);
const matchedWindows = historicalBars.map((sessionBars) =>
  aggregateThroughCutoff(sessionBars, currentEasternCutoff)
);
```

Requirements: batch provider requests where supported; respect pagination; cache by trading
session, not UTC calendar date; include provider feed in the key so IEX and SIP data are never
mixed; do not cache an incomplete provider response as complete; record cache completeness and
fetch time; reuse the existing QQQ data already fetched by benchmark alignment — do not fetch
QQQ separately per symbol.

**QQQ matching:** strict timestamp equality may make QQQ relative performance unavailable on
sparse IEX premarket data — keep missing benchmark data non-penalizing. Prefer identical
completed-bar timestamps; if an established bar-alignment utility already exists, reuse it;
otherwise do not silently introduce nearest-neighbor matching — return unavailable when exact
alignment is absent, and report the frequency of unavailable QQQ comparisons during
fixture/manual verification.

## Scope

**Includes:** premarket candidate calculations, bullish and bearish evidence groups, corrected
premarket reference levels, dollar/percentage display, volume and range baselines, QQQ-relative
movement when available, confirmation/invalidation messaging, compact and expanded
presentation, deduplicated candidate alerts, freshness gating.

**Excludes:** Expansion Rank, cross-symbol ranking, options/0DTE, order placement, automated
trading, news scoring, large historical backfills, changes to the original setup score.

## Code comments

Add concise comments at relevant implementation sites documenting: no Expansion Rank in this
release; deterministic confirmation-level selection; complete freshness thresholds and
partial-data semantics; signed prior-level interaction; reference range excludes the evaluation
candle; minimum elapsed-time/volume gates; raw historical-bar caching. One concise comment per
decision point — do not scatter long spec copies through the code.

## Tests for Part 1

All 14 originally required tests:

1. Premarket move uses the prior regular-session close.
2. Extended-hours close is not accidentally used.
3. Volume compares identical elapsed intervals.
4. Range compares identical elapsed intervals.
5. Range position handles a zero range.
6. Relative QQQ movement uses matching timestamps.
7. Missing QQQ data returns unavailable without penalizing the candidate.
8. Prior-day-high proximity uses percentage/ATR tolerance.
9. Three correlated price-location facts cannot falsely satisfy three independent groups.
10. A bullish candidate requires three independent evidence groups.
11. The bearish calculation mirrors the bullish calculation.
12. Stale data cannot generate a candidate alert.
13. Missing values render Unavailable, not zero.
14. Example values are not present as production constants or seeded data.

Plus:

15. A normal forming live candle does not make the result partial.
16. 11-minute-old real-time data is stale and blocks a new alert.
17. Known bounded-delay data is labeled delayed.
18. First close above both resistance levels still requires acceptance.
19. Accepted close sequence reports breakout accepted.
20. The evaluation candle can produce a raw position above 100% and below 0%.
21. The displayed session range includes the evaluation candle while the breakout reference
    range excludes it.
22. Baseline median volume of 499 is insufficient, 500 is eligible.
23. A 14-minute elapsed window is insufficient, 15-minute is eligible.
24. Changing the cutoff reuses cached raw bars.
25. IEX and SIP cache entries cannot collide.

---

# PART 2: EXPANSION MONITOR — PHASE 1 ONLY

Implement ONLY the three sections below. Do **NOT** implement sector ETFs / gap / compression /
extension, catalyst context, forward outcome logging, or final UI polish in this pass — those
are separate later phases, and catalyst context specifically requires a news data provider this
project does not currently have integrated. Stop after these three sections and report.

## 1. Deterministic prioritization without a score

Do not restore Expansion Rank or create another numerical score. Prioritize symbols
lexicographically using observable state.

```ts
const EXPANSION_STAGE_PRIORITY: Record<ExpansionStage, number> = {
  invalidated: 0,
  inactive: 1,
  context_developing: 2,
  premarket_candidate: 3,
  opening_drive: 4,
  level_break: 5,
  breakout_accepted: 6,
  expansion_active: 7,
  stalled: 2,
};
```

For the main opportunity list, sort higher stage priority first. Within the same stage,
tie-break in order:

1. larger absolute ATR-normalized move;
2. higher time-adjusted relative dollar volume;
3. stronger sector-relative performance — **skip this tie-breaker in this pass** since sector
   ETFs are Phase 2; fall through to the next;
4. more recent confirmed state transition;
5. ticker alphabetically.

This is a documented presentation order, **not** confidence, probability, or expected return.
Expose the reason: `GOOGL moved to the top because: Expansion active · 1.4x ATR move · 3.2x
dollar-volume pace`.

Do not alter the existing setup score. Add an explicit "Expansion Stage" sorting option showing
`Sort: Expansion Stage` rather than disrupting the existing default order — make qualifying
expansion symbols visually prominent instead.

## 2. Separate early detection from confirmed setup

Use two timeframes: completed **1-minute** bars for early acceleration / opening-drive heads-up;
completed **5-minute** bars for break / acceptance / hold / structure / invalidation
confirmation. Never use an unfinished candle.

Add one alert type:

```ts
type EarlyExpansionAlertType = "early_acceleration";
```

Must always display `EARLY HEADS-UP · UNCONFIRMED`. This is a **Monitor**-priority alert, not
Review Now.

A bullish early acceleration requires ALL of: completed 1-minute candle; dollar-volume shock
passes; true-range expansion passes; candle closes near its high; price is approaching or
breaking a significant bullish level; freshness permits alerting. Bearish mirrors these rules.

**Dollar-volume shock:**

```ts
typicalPrice = (high + low + close) / 3;
barDollarVolume = typicalPrice * volume;
```

Compare the evaluation bar with the median dollar volume of matching time-of-day bars from
eligible prior sessions. Defaults:

```ts
minimumDollarVolumeShockMultiple: 2.0;
minimumDollarVolumeBaselineSessions: 10;
dollarVolumeBaselineLookbackSessions: 20;
```

Return unavailable when the baseline is insufficient.

**True-range expansion:**

```ts
trueRange = Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
```

Compare with the median true range of matching time-of-day bars from prior eligible sessions.
Default: `minimumTrueRangeShockMultiple: 1.5`.

**Close near candle extreme:**

```ts
// Bullish
closeLocation = high > low ? (close - low) / (high - low) : null;
bullishCloseNearExtreme = closeLocation !== null && closeLocation >= 0.80;
// Bearish
bearishCloseNearExtreme = closeLocation !== null && closeLocation <= 0.20;
```

Default: `closeNearExtremeFraction: 0.20`.

**Significant level proximity:** eligible bullish levels are frozen premarket high after 9:30,
current premarket reference high before 9:30, prior-day high, opening-range high, frozen pending
breakout level (bearish mirrors these). A level is approaching when distance is within the
greater of 0.20% of the level price or 0.10 daily ATR — centralize and configure these
thresholds.

**Deduplication:** fire at most one early-acceleration alert per user + symbol + direction +
Eastern trading date + significant level or zone. Allow another early alert only after the first
setup invalidates AND price forms a genuinely new structural attempt at a different level, or
after a configured reset period. Do not alert on every accelerated one-minute candle.

## 3. Add dollar-volume pace and acceleration

Keep share-volume metrics, add dollar volume:

```ts
type DollarVolumeContext = {
  currentBarDollarVolume: number | null;
  currentBarRelativeDollarVolume: number | null;
  cumulativeDollarVolume: number | null;
  cumulativeRelativeDollarVolume: number | null;
  recentThreeBarDollarVolume: number | null;
  previousThreeBarDollarVolume: number | null;
  accelerationRatio: number | null;
  priceProgressing: boolean | null;
  status: "available" | "insufficient_data";
};
```

Three-bar acceleration:

```ts
accelerationRatio =
  previousThreeBarDollarVolume > 0
    ? recentThreeBarDollarVolume / previousThreeBarDollarVolume
    : null;
```

Default descriptive states: `>= 1.25` "Participation accelerating"; `0.80–1.25` "Participation
stable"; `< 0.80` "Participation contracting". Keep thresholds configurable, labeled as
operational defaults.

Interpret price and volume together:

- price progressing + accelerating → "Expansion strengthening"
- price progressing + contracting → "Expansion continuing, participation weakening"
- high participation + little price progress → "Possible absorption; direction not inferred"
- price reversing + accelerating → "Reversal pressure increasing"

Do not claim institutional buying or selling.

## Tests for Part 2

1. Stage-based prioritization contains no hidden score.
2. Expansion-active symbols appear above premarket candidates.
3. ATR-normalized move resolves same-stage ties.
4. One-minute bullish early acceleration.
5. One-minute bearish early acceleration.
6. Unfinished one-minute candle is ignored.
7. Dollar-volume shock uses matching time-of-day baselines.
8. Dollar-volume acceleration compares non-overlapping three-bar windows.
9. High volume without price progress does not imply direction.
10. Early alert is labeled unconfirmed.
11. Early alerts deduplicate by structural attempt.
12. Original scanner scores and alerts remain unchanged.
13. A GOOGL-style fixture triggers early acceleration before five-minute acceptance.
14. The same fixture later produces breakout acceptance.
15. A failed look-alike fixture produces an early unconfirmed alert but never breakout
    acceptance.
16. The mirrored bearish fixture behaves correctly.

## Efficiency

Fetch each stock's required bars once per scan cycle; do not recalculate historical baselines
during UI rendering; degrade optional evidence to unavailable when provider limits are reached;
never allow missing optional context to stop the existing scanner.

---

# BEFORE EDITING (applies to both parts)

1. Read the full text above before writing any code.
2. Read `scorer.ts`'s existing `insufficientData` handling, the shared-benchmark-fetch pattern
   from Rule D, and check what introducing a 1-minute `Timeframe` value requires in the existing
   candle provider / cache / session-filtering code — this is a genuinely new timeframe for this
   app, not reused from anywhere.
3. Run `git status --short` and confirm a clean starting point.
4. Run the existing test suite, tsc, and build to record a baseline.

**Do not change** existing detector logic, scoring weights, alert generation outside what is
specified above, or session filtering beyond what is needed to support 1-minute candles.

# VERIFICATION

Full test suite, tsc, production build. Report the exact provider-request numbers.

> Note: the original message was truncated mid-sentence at "Report the exact provider-reques".
> The line above is the evident intent, but it is a reconstruction of a cut-off sentence, not
> verbatim source text.

---

# Implementation status (added by the build session, not part of the spec)

Agreed four-stage plan, each stage to end green and verified:

1. **Timeframe + provider foundation** — DONE, commit `09c3f44` (local only, unpushed).
2. **Historical raw-bar cache** — not started.
3. **Part 1, Premarket Expansion Candidate** — not started.
4. **Part 2, Expansion Monitor Phase 1** — not started.

State at the end of that session: 584 tests / 50 files passing, `tsc` exit 0, production build
successful. `priorDayContinuation.ts` is untouched, so no migration is half-done.

**Open blocker for Stage 2.** `getCandles` applies `filterToLatestSession` to every intraday
timeframe, which trims results to a SINGLE session regardless of `sessionScope` — the scope
selects which bar *types* count, not how many days survive. The historical-baseline cache
therefore cannot be built on `getCandles` as it currently stands and needs a distinct
multi-session read path. This decision has not been made.

**Measured provider numbers so far** (pagination implemented in Stage 1): ~7,800 bars (20
sessions, regular hours) is 1 page; ~14,000 bars (20 sessions, extended hours) is 2 pages.
Before Stage 1 the second case silently truncated at Alpaca's 10,000-per-page cap with no error.
The per-cycle 1m cost (estimated +1 request per symbol, ~+480/hour at the 60-second refresh)
remains an estimate until Stage 4 actually issues those fetches.
