# Obsidian Trader

A personal, AI-assisted trading **scanner, setup validator, accountability coach, and journal**.

**This is not a trading bot.** It never places, modifies, or cancels trades. All objective
technical conditions are calculated in code (`lib/indicators`, `lib/strategies` — arriving in
Phase 2); the AI layer only explains results in plain English later on. TradingView is used
only to open deep links to charts in a new tab — it is never scraped and no account data is read.

### Second bug found against the live API (fixed)

Claude Code also caught that every result showed `"quality": "simulated"` even with real Alpaca
data flowing through — `scoreSetup()` hardcoded `quality: "simulated"` in both of its return
paths instead of using the actual quality reported by `CandleSeries.quality` (which
`alpacaProvider.ts` correctly computes as `"realtime"`). This directly contradicted the
principle stated in `types/candle.ts` that the UI must always surface real data quality so a
live feed is never mistaken for mock data. Fixed the same way as the `now` bug: `quality` is now
a required explicit input to `scoreSetup()`, threaded through from `CandleSeries.quality` in the
provider-driven scan path, and both callers (mock and provider) updated to supply it. Added
regression tests confirming `"realtime"` and `"delayed"` pass through correctly, on both the
normal and empty-candles code paths.

### Bug found against the live Alpaca API (fixed)

Claude Code tested this with a real Alpaca account and found the gap the README had flagged as
untested: `getCandles()` never sent an explicit `start` param, relying entirely on Alpaca's
implicit default window. Queried on a Sunday (markets closed), that default window didn't reach
back to Friday's session, so Alpaca correctly returned `bars: null` — not an error, just genuinely
nothing in the (too-narrow) implicit window. Fixed by adding a pure, unit-tested
`computeStartDate()` that always requests several calendar days back (6 for intraday, scaled
further for daily candles), comfortably covering weekends. A regression test now asserts the
actual request always includes a `start` param, so this can't silently reappear.

### Real bug found in production use (fixed)

After Phase 7 was built, actually using the dashboard surfaced a real bug from Phase 6d:
`scan_snapshots` and `alert_events` only had `SELECT` policies, because I'd incorrectly assumed
only the cron job (using the RLS-bypassing admin client) would ever write to them. In fact, the
dashboard's own `/api/scan` route writes to both tables on every regular scan, using your normal
RLS-protected session — so every dashboard scan failed with "new row violates row-level security
policy." Fixed by adding the missing insert/update policies.

**Migration instructions depend on whether you already ran `0004`:**
- **If you already ran `supabase/migrations/0004_background_scanning.sql`** (i.e. you set up
  background scanning before this fix): run the new
  `supabase/migrations/0005_fix_scan_snapshot_rls.sql` — it only adds the missing policies.
- **If you're setting up background scanning for the first time**: just run the (now-corrected)
  `0004_background_scanning.sql` — it already includes the right policies, and you should
  **skip `0005`** (running both would fail with a "policy already exists" error, since `0005`
  re-adds policies `0004` now already creates).

### Real bug found through actual use (fixed) — stale candles, not just a stale price display

You noticed NVDA's price looked off ($200.20 shown vs. $204.57 real). Investigating turned up a
more serious bug than a display lag: `alpacaProvider.ts` requested `limit=100` directly from
Alpaca alongside a multi-day lookback window (`start` set several days back to safely cross
weekends). A 6-day window of 5-minute bars can contain 400+ possible candles — so Alpaca
correctly returned the *oldest* 100 bars within that window, not the most recent 100. This meant
the scanner could be scoring setups against days-stale candles, not just displaying a stale
current price. Confirmed directly: a raw request against the live API showed the most recent
available bar was from 15:55 ET while the wall clock read 21:25 ET — a real, verified gap.

Fixed by always requesting a generously oversized batch from Alpaca (5x the caller's limit, floor
500, capped at Alpaca's max of 10,000) and keeping only the most recent N candles ourselves
before returning — rather than trusting a `limit` param to do the right thing against a window
that can hold far more bars than requested. Added a regression test that specifically feeds more
bars than requested and confirms the *recent* ones are kept, not the oldest.

**Separately, worth understanding — not a bug**: when markets are closed, "the current price"
will always lag real quotes somewhat, because the free Alpaca feed (`feed=iex`) only reflects
trades on the IEX exchange specifically, which has much lower after-hours activity than the full
market. That gap is real and expected on the free tier; upgrading to the `sip` feed (full
consolidated tape) would close it, at the cost Phase 4's provider comparison already covered.

### Recurring TypeScript error in explain-setup route, now fixed at the source

Claude Code had been protecting its own local fix to `app/api/ai/explain-setup/route.ts` across
several merges, since my zips kept reintroducing a type error. Root cause: `timeframe` was typed
as the full `Timeframe` (which includes `"1d"`), but `scan.resultsBySymbol[symbol]` only ever has
`"5m"`/`"15m"` keys — indexing with a value that could theoretically be `"1d"` doesn't
type-check. Fixed properly (not just patched around) with a narrowed `IntradayTimeframe` type and
a real runtime type guard (`isIntradayTimeframe()`) instead of the previous unchecked cast — this
is now both more correct and safer against malformed input, and shouldn't need re-fixing again.

### Real bug found through actual use — alerts didn't distinguish scan time from market-data time (fixed)

Testing the newly-working cron route on a Saturday (markets closed) surfaced genuine confusion:
an alert fired with `fired_at` showing "just now," but the underlying price data was actually
from Friday's close — there was no way to tell the difference from the alert alone. Root cause:
`SetupResult` only tracked `lastUpdated` (when the scan ran), never when the underlying candle
data was actually from. Fixed by adding `latestCandleTime`, computed directly from the most
recent candle in `sessionCandles` — genuinely distinct from scan time, and correctly null when
there's no candle data at all. Alert messages now include a `[market data as of ...]` suffix
when available, and the setup detail panel shows both "Scanned {time}" and "Latest candle
started {time}" separately instead of one ambiguous timestamp. The label was worded "Latest
candle started" rather than "as of" because `latestCandleTime` is the Alpaca bar's *open*
timestamp — a 5m/15m candle covers `[time, time + duration)`, so the real edge of the data can
be up to a full bar's duration newer than what's displayed. 5 new tests cover this (the scorer
computing it correctly, alert messages including/omitting the suffix appropriately).

## Status: Phase 8 — Richer checklist, weighted scoring, entry quality (a scoped subset of a larger spec)

You raised a real concern after using the tool for a while: the checklist didn't feel thorough
enough to act on, and every condition counted equally regardless of how meaningful it actually
was. You'd separately drafted a large 6-engine "Trader Scanner V2" spec (SPY/QQQ correlation,
opening ranges, time-of-day RVOL, news/event risk, a full state machine, forward-performance
analytics). Rather than build that whole thing — which is a genuinely separate, much bigger
project, and premature before any real trade history exists to justify it — this milestone pulls
out the highest-value pieces that were buildable on what already existed, and pairs them with a
richer, always-available explanation layer.

### What's new

- **Weighted confluence scoring, normalized to a fixed 0-10 scale**: conditions are categorized
  (`core`/`secondary`/`supporting`/`informational`, weights 3/2/1/0.5 — see `CATEGORY_WEIGHT` in
  `types/setup.ts`). A confirmed structure shift counts far more than a volume confirmation,
  instead of every condition being worth one flat point. The raw weighted total is then
  normalized to always display as a score out of 10 (`maxScore` is always exactly `10`), per the
  spec's own suggestion ("Score may be normalized to 0-10 or 0-100") — this was a deliberate
  revision after the first version of this milestone shipped a raw, unnormalized ~21-point scale
  that felt arbitrary and would have silently shifted every time a condition was added or
  removed. Alert score-threshold and the risk settings' "minimum setup score" default were both
  recalibrated to `7` and `6` respectively to match.
- **`lib/indicators/vwap.ts`** (new): session VWAP calculator + reclaim detector, wired in as an
  optional confirmation (`vwap_reclaim`), same "genuine reclaim, not just currently above"
  pattern as the 9 EMA detector.
- **`lib/indicators/atr.ts`** (new): true range / ATR, used specifically to power real extension
  detection rather than a raw, stock-agnostic percentage.
- **`lib/indicators/pressure.ts`** (new): buy/sell pressure classification from body size, close
  position, and relative volume — deliberately labeled `strong_buy_pressure`/
  `strong_sell_pressure`/`neutral`, never "institutional," per the spec's own caution that volume
  alone can't prove who caused a move. Folded into the volume confirmation's detail text rather
  than a new scored row, to avoid checklist clutter.
- **Conviction level** (`watch` / `developing` / `confirmed`): a coarser, staged read of the
  setup, computed from the ratio of required conditions passing — this is what "talks to you in
  stages" instead of one static score.
- **Entry status** (`actionable_now` / `wait_for_pullback` / `extended_do_not_chase` /
  `invalidated`): distinguishes "this setup is real" from "this is still a good place to get
  involved." Computed from price's distance from the 9 EMA relative to ATR — never a prediction,
  purely a measure of how far price has already run. This is the piece built specifically to
  address "not comfortable taking entries."
- **Invalidation notes**: a short, deterministic sentence describing what would break the current
  setup, computed from already-known structural levels (the session low, the EMA, the FVG
  boundary) — never a prediction.
- **`lib/strategies/conditionExplanations.ts`** (new): hand-written, NOT AI-generated "why this
  matters" reasoning for every condition type — instant, free, always available regardless of
  whether AI is configured. This is the direct answer to "the checklist doesn't explain why
  conditions matter."
- **Checklist UI**: now grouped by category (Core Signals / Secondary Confirmations / Supporting
  Signals / Informational), each row showing its reasoning inline, plus conviction-level and
  entry-status badges above the score.
- **Sharpened AI explanation prompt**: now structured into three explicit required parts — why
  it's here, what's next, what would invalidate it — using the real computed `invalidationNote`
  rather than letting the model invent its own.

### Deliberately NOT built (from the larger spec)

SPY/QQQ/sector relative-strength context, opening range tracking (5m/15m/30m), time-of-day-
adjusted RVOL, a full state machine with alert deduplication across states, news/event-risk
flags, and forward-performance analytics (15/30/60-minute post-alert tracking). Each of these is
real, standalone infrastructure — none of them reuse what exists today the way VWAP/ATR/pressure
did. Worth reconsidering individually once there's real trade history to justify which (if any)
actually improve decisions, rather than building all of it speculatively.

### Known limitations in this milestone

- Extension detection (`entryStatus`) only checks distance from the 9 EMA, not from VWAP or the
  breakout level specifically, the way the original spec described — a reasonable first cut, not
  the full picture.
- The weighted score change is a real breaking change to the score *scale* (not the underlying
  logic) — the very first version of this milestone used a raw ~21-point scale before being
  revised to a normalized 0-10 scale; anyone with saved alert history from that brief window will
  see a discontinuity.
- `minSetupScore` (6) and the alert `scoreThreshold` (7) were set to preserve roughly the same
  *proportion* (about 60-70%) as the old flat-count scale rather than an exact equivalent —
  worth revisiting once you have a feel for the new 0-10 scale in practice.

### UI polish pass (real usage feedback)

Screenshot review of the live dashboard surfaced two things worth fixing:

1. **The timestamp was there but too easy to miss** — tiny gray text tucked in the top-right
   corner. Moved it into a clearly labeled row inside the new summary card ("Scanned 8:31 PM" /
   "Latest candle started Fri, Jul 24, 4:25 PM"), with the weekday added so a Saturday-viewed
   Friday close is unambiguous at a glance, not just at second read.
2. **"Looks dated, not separated"** — addressed as a spacing/hierarchy problem, not a palette
   problem: the app already has an established brand direction (black/charcoal, platinum, signal
   colors) from Phase 1, so this wasn't about picking new colors. Score, conviction badge, entry
   status, and timestamps are now combined into one visually distinct summary card with a
   left border colored by status (red/yellow/green) — the single most important glance on the
   panel, now the most visually weighted element instead of blending into the header. Checklist
   rows got a colored left-accent per category (core signals brightest, informational dimmest)
   and more generous spacing, so scanning the list doesn't read as one dense wall of text.

### Recurring divergence bugs, now permanently synced into the source

Across the last several merges, Claude Code caught my zips reintroducing two bugs it had already
fixed locally, protecting the merge each time rather than blindly overwriting:

1. **The "January 1970" bug** (`lib/fixtures/candles.ts`, `lib/mock/scanInputs.ts`): the mock
   candle generators built `Candle.time` by counting up from `0` with no anchor to a real date.
   Since `scoreSetup()` computes `latestCandleTime` as `new Date(candle.time * 1000)`, a `time`
   of only a few thousand seconds resolved to a date a few hours after the Unix epoch — January
   1970 — instead of anything close to the present.
2. **The 15-minute spacing bug** (same two files): the fixture generators and the `chain()`
   helper hardcoded a 300-second (5-minute) step with no way to pass a different interval, so
   every "15-minute" mock series was actually spaced 5 minutes apart, identical to the 5-minute
   series.

Fixed with `anchorToMockNow()` (shifts a series so its most recent candle lands exactly on a
real interval boundary at or before the deterministic mock scan time, preserving spacing) and a
configurable `intervalSeconds` parameter threaded through `flatSeries`/`risingSeries`/
`fallingSeries`/`chain`. `scanService.ts`'s `MOCK_SCAN_TIME` had to become exported so
`scanInputs.ts` can anchor to the exact same timestamp rather than duplicating it. All three
files are now permanently synced into this source — this shouldn't need protecting against on
future merges.

### Independent Codex review of Phase 8 (commit 08b5927) — 4 real findings, all fixed

You had Codex do a second-opinion review of the weighted-scoring milestone. It found four
genuine issues — not nitpicks — and I fixed all four:

1. **Saved risk settings weren't migrated to the new 0-10 scale.** A `min_setup_score` saved
   before the Phase 8 rescale (old scales went up to ~21) could sit above 10 — since no score can
   ever reach that on the new scale, the "attempting a low-scoring setup" check would fail
   **permanently**, every scan, forever. Fixed with `clampMinSetupScore()` (read path, falls back
   to default rather than crashing) and `validateMinSetupScore()` (write path, rejects NaN/
   Infinity outright rather than silently saving something broken) in `lib/risk/defaults.ts`, both
   wired into `lib/risk/queries.ts`. Added `min={0} max={10}` to the Settings UI field. Added
   migration `0006_clamp_min_setup_score.sql` — clamps any existing bad data, then adds a DB-level
   `CHECK` constraint as defense in depth. 15 new tests covering legacy values, both boundaries
   (0 and 10), and invalid input.
2. **Pressure analysis ignored `config.pressure.lookback`.** It was averaging every preceding
   candle in the whole session instead of just the configured 20-candle window, so old session
   volume could distort a "is this candle's volume unusual right now" reading. Extracted into an
   exported `computePressureAverageVolume()` and fixed to use only the configured lookback window
   (excluding the current candle), gracefully falling back to whatever's available on shorter
   histories. 5 new tests, including one that proves candles older than the lookback genuinely
   don't affect the result.
3. **VWAP reclaim could report stale, no-longer-true results.** `detectVwapReclaim()` searched
   backward through the *entire* session for any historical crossing and returned `passed: true`
   using *that old candle's* price/VWAP — even if price had since closed back below VWAP. Fixed
   to first check whether the *current* candle is actually above VWAP; only then walks backward to
   confirm the current above-VWAP streak traces back to a genuine cross (not just "the session
   opened above VWAP"). Documented the exact validity semantics in the function's own comment. 5
   new tests covering held reclaims, failed reclaims, always-above-no-genuine-reclaim, never
   reclaims, and accurate current-value reporting in both outcomes.
4. **Several Phase 8 tests could pass without proving their named behavior** — conditional
   assertions (`if (x) { expect(...) }`) that could execute zero real checks depending on what a
   candle fixture happened to produce. Fixed by extracting `computeWeightedScore()`,
   `determineConvictionLevel()`, and `determineInvalidationNote()` as exported pure functions
   (joining the already-exported `determineEntryStatus()`), then rewriting every flagged test to
   call these directly with deterministic, hand-built inputs — unconditional assertions that fail
   if the underlying logic is removed or reversed. Added the specifically-requested direct tests
   for `actionable_now` and `extended_do_not_chase`.

Net result: roughly 30+ new/rewritten tests across these four fixes (exact count TBD — I can't run
the suite myself, that's what the verification step below is for), `tsc` clean by manual review.
Committed locally per Codex's explicit instruction not to push until you've had a chance to
review — the push is a separate step for you to trigger once you're satisfied.

### Deploying migration 0006 — read this before assuming it's live

**I have not applied this migration to your live Supabase database, and cannot** — I have no
network access and no database credentials. Writing the migration file and committing it to git
does **not** run it against your actual database. Pushing to GitHub does not run it either — a
`git push` only updates your repository, it has no connection to Supabase at all. Someone (you)
has to actually execute the SQL against the database, same as every other migration in this
project.

**To actually apply it:**
1. Open your Supabase project dashboard → **SQL Editor**
2. Open `supabase/migrations/0006_clamp_min_setup_score.sql`, copy its full contents
3. Paste into a new query in the SQL Editor, click **Run**
4. You should see a success message (or, if you've already run it once, the same success — it's
   idempotent, safe to run more than once)

**Verify it actually took effect** — run these as separate queries in the SQL Editor:

```sql
-- 1. Confirm no existing rows are out of range (should return 0 rows):
select id, user_id, min_setup_score
from risk_settings
where min_setup_score < 0 or min_setup_score > 10;

-- 2. Confirm the constraint exists (should return exactly 1 row):
select conname
from pg_constraint
where conname = 'risk_settings_min_setup_score_range';

-- 3. Confirm out-of-range writes are actually rejected - replace
--    <your-user-id> with your real user id, then run this. It SHOULD
--    fail with a constraint-violation error — that's success, not a bug:
update risk_settings set min_setup_score = 15 where user_id = '<your-user-id>';
```

If query 3 does NOT error (i.e. it succeeds in setting 15), the constraint didn't apply
correctly — stop and let me know rather than assuming it's fine.

### Second independent Codex review (after commit 3bf6722) — 2 required fixes + 3 repository improvements

A follow-up review of the previous fix commit found two more real behavioral bugs, plus three
worthwhile repository/process improvements.

**Required fix 1 — EMA reclaim had the exact same staleness bug as VWAP.** `detectEmaReclaim()`
walked backward through the entire candle history for any historical crossing and returned
`passed: true` using *that old candle's* price/EMA, even after price had since closed back below
the EMA. Since EMA reclaim is a **required** setup condition (unlike VWAP, which is optional), a
stale reclaim could keep a setup at yellow/green status indefinitely. Fixed with the identical
"currently held" semantics as the VWAP fix: check whether the *current* candle is above the
*current* EMA first, then walk backward only to confirm a genuine crossing. `reclaimTime` is
preserved separately (the original crossing candle's timestamp) for UI/alert context, while
`price`/`emaValue` always reflect the current candle, never a stale one. The optional stronger
confirmations (`minReclaimBodySizeDollars`, `requireFollowThroughCandle`, `requireRisingSlope`)
are still evaluated at the original crossing candle (they measure the crossing's quality);
`minPctAboveEma` now uses the *current* distance (a present-state question, not a property of the
crossing moment) — this distinction is documented directly in the function's own comment. A
second genuine reclaim after an earlier one fails is now correctly found. 8 new tests, plus a
scorer-level integration test proving a failed historical reclaim no longer counts as a passing
required condition.

**Required fix 2 — insufficient data was silently labeled "actionable now."** `determineEntryStatus()`
returned `actionable_now` whenever EMA or ATR couldn't be calculated (too few candles, or a
literal zero ATR) — indistinguishable from "we checked and it's genuinely fine," when the truth
was "we couldn't check at all." Added a new, distinct `insufficient_data` entry status
(`types/setup.ts`), styled neutrally in the UI (not green/yellow/red, since it isn't an
assessment) with the label "Not Enough Data Yet." 5 new tests covering too-few-candles-for-EMA,
enough-for-EMA-but-not-ATR, exactly-zero-ATR, and confirming both `invalidated` and
`wait_for_pullback` still correctly take precedence over this new status.

**Deployment requirement — migration 0006 documentation.** Added an explicit, honest section
making clear that pushing this migration file to GitHub does **not** apply it to your live
Supabase database, with the exact manual procedure and three verification queries (existing
values in range, constraint exists, out-of-range writes actually rejected). I have not applied
this migration myself and cannot — no network access, no database credentials.

**Repository improvement 1 — GitHub Actions CI** (`.github/workflows/ci.yml`): runs on every push
to `main` and every PR — installs from the lockfile (`npm ci`), type-checks, runs the full test
suite, and runs a production build using placeholder (non-functional) values for only the two
`NEXT_PUBLIC_` Supabase vars, since those get inlined into the client bundle at build time
regardless. Every other secret (Alpaca, Anthropic, service role, cron) is read only inside
server-only route handlers at request time, never during the build — no real secrets are ever
needed in CI, and none are exposed.

**Repository improvement 2 — stopped tracking `tsconfig.tsbuildinfo`.** Added `*.tsbuildinfo` to
`.gitignore`. This is generated TypeScript incremental-compilation cache data, not real source —
it regenerates automatically the next time `tsc` runs (`tsconfig.json` already has
`"incremental": true`), so removing it from tracking loses nothing.

**Repository improvement 3 — staging setup and verification plan** (`docs/STAGING.md`): documents
a safe staging setup (separate Supabase project, Alpaca paper/read-only credentials, separate env
vars, a UI staging indicator — flagged as *documented but not yet built*) and an 8-point
end-to-end verification checklist. Explicitly documentation only — no external accounts, cloud
resources, or credentials were created while writing it.

### Third independent Codex review — data pipeline integrity (the most architecturally significant round yet)

This review went deeper than the previous two — instead of one bug in one detector function, it
flagged that the underlying data pipeline feeding every detector could itself be corrupted. Of
everything it raised, three were real, serious, and tractable enough to fix now; the rest is
legitimate but bigger-scope future work (documented below, not built).

**Fix 1 — session contamination (the most serious bug found in this whole project).**
`alpacaProvider.ts` fetches across a 6-day lookback window, then kept only the most recent
`limit` candles. Early in a session — say, the first 20 minutes after open — there simply aren't
100 candles from *today* yet, so "keep the most recent 100" silently pulled in leftover candles
from **previous trading days**. Since VWAP, session high/low, and decline-from-open are all
defined relative to a single session, mixing days doesn't just add noise — it changes what those
numbers mean entirely. Fixed with `filterToLatestSession()` (`lib/market-data/sessionFilter.ts`):
groups candles by their real US Eastern trading date and keeps only the most recent date, applied
right after fetching, before slicing to the caller's limit. Works correctly whether markets are
open (isolates today's candles so far) or closed (isolates the last real trading day). 5 new
tests, including the exact "fetch window spans a weekend" scenario that caused this.

**Fix 2 — previous-close was positionally ambiguous.** The old logic assumed the second-to-last
daily candle was always "yesterday" — only true when the last daily candle represents *today*.
Before today's daily bar has posted, that assumption silently grabbed a close from two sessions
ago instead of one. Fixed with `findPreviousClose()` (same file): walks backward from the end of
the daily series and returns the first candle whose *actual trading date* is before today's,
determined explicitly rather than assumed from array position. Correct in both cases without
needing to know which one applies. 5 new tests.

**Fix 3 — one bad symbol could fail the entire scan, and there was no retry for transient
errors.** `scanWatchlistWithProvider()` had no per-symbol error isolation — one rate limit or bad
ticker threw and took down every other symbol's real data with it. Fixed by wrapping each
symbol's work in its own try/catch: a failure is now reported in a new `errors` field and that
symbol is simply excluded — **never silently falls back to fabricated/simulated data pretending
to be real**, per the explicit requirement. Surfaced in the dashboard as a visible red banner
listing which symbols failed and why, and in the cron report's per-user results. Also added
bounded retry with exponential backoff in `alpacaProvider.ts` for genuinely transient failures
(429, 5xx) — never for auth failures or other 4xx errors, which won't succeed on retry regardless.
9 new tests across both files.

**Documented but deliberately not built this round** (real, but bigger scope — see the review
itself for full reasoning): IEX vs. SIP confidence labeling, market holiday/early-close handling
via Alpaca's real calendar endpoint (session.ts's existing documented limitation), closed-vs-
developing-candle enforcement, and the methodological question of whether several scoring
conditions (recovery/structure-shift/EMA/VWAP/FVG) are measuring meaningfully independent
evidence or partially double-counting the same underlying move — which genuinely needs forward-
performance data to answer, not more architecture.

### Fourth independent Codex review — the session fix was real but incomplete, plus retry gaps

Codex reviewed the round-3 data-pipeline fixes and found the direction was correct (cross-day
contamination genuinely fixed, DST-safe date conversion confirmed) but flagged real gaps: the
session fix didn't account for *time-of-day* contamination within a single calendar date, and
the retry logic had real correctness gaps of its own.

**High — "latest session" only filtered by calendar date, not by trading hours.**
`filterToLatestSession()` correctly excluded previous *days*, but a candle array can still span a
single Eastern date while mixing pre-market (from 4am ET), regular hours, and after-hours (until
8pm ET) bars together — which is still contamination for calculations (VWAP, session open,
volume averages) that are only meaningful within *regular* trading hours specifically. Fixed by
adding a `sessionScope` parameter (`"regular"` | `"extended"` | `"all"`), defaulting to
`"regular"`, reusing the exact same hour boundaries `session.ts` already used for
`computeSessionInfo()` (extracted into a shared `getSessionTypeForTimestamp()` so both stay in
sync instead of maintaining two copies of the same boundary logic). If a scan runs before the
opening bell with only pre-market bars available, this now correctly returns an empty result
(handled gracefully by the existing "insufficient data" paths) rather than silently substituting
extended-hours data. 11 new tests, including the exact "scan before the opening bell" and
"regular mixed with after-hours" scenarios Codex named.

**Low (but fixed) — "latest date" assumed the last array element was newest.** Now computed as
the actual maximum trading date across every candle, with a test using genuinely out-of-order
input to prove it.

**DST/timezone — confirmed correct, tests added anyway.** Codex's own analysis concluded the
`Intl.DateTimeFormat`-based conversion is DST-safe (absolute Unix timestamps can't produce an
ambiguous date), but requested explicit tests for the boundary cases regardless: 11:59pm/12:01am
Eastern in both EST and EDT, the spring-forward Sunday, both instances of the fall-back repeated
hour, and midnight-Eastern daily-bar timestamps in both DST regimes. All 6 added and passing.

**Medium — thin daily history could still mislabel today's own close as "previous close."**
When `findPreviousClose()` correctly returned null (no earlier daily bar available), the fallback
substituted the *latest* daily candle — which could BE today's own partial bar, silently making
decline-from-previous-close read as ~0% instead of correctly reporting the data as insufficient.
Fixed: a null previous close now throws a descriptive error for that symbol, caught by the
per-symbol isolation from round 3 and reported in `errors` — reuses the existing mechanism rather
than inventing a new one. New test proves a symbol with only today's own daily bar is excluded,
not silently mislabeled.

**Medium — retry attempts didn't count against the rate limiter.** `recordRequest()` was called
once before the whole retry sequence, but a retry sequence can make up to 3 real HTTP requests —
only 1 was ever counted, materially underestimating real usage under repeated failures. Fixed by
moving the rate-limit check and recording inside the retry loop, once per actual attempt.

**Medium — network exceptions (not just non-ok responses) escaped without retry.** A rejected
`fetch()` — DNS failure, connection reset, timeout — used to propagate immediately with no retry
at all. Now caught and retried the same as a 5xx, bounded by the same `maxRetries`. Added a real
request timeout via `AbortController` (10s) so a hung connection doesn't wait forever, and the
timeout's own abort is treated as a retryable transient failure like any other network exception
— never retried past `maxRetries`, so it can't loop forever. Also now honors a `Retry-After`
header on 429 responses instead of always using the fixed exponential backoff — extracted into
its own pure `computeRetryDelayMs()` function specifically so this could be tested directly and
instantly, with zero real or fake-timer waiting involved. 9 new tests across both concerns.

**Low — cron report's `symbolsScanned` silently included failures as if they'd succeeded.**
Replaced with explicit `symbolsAttempted` / `symbolsSucceeded` / `symbolsFailed` fields.

## Status: Phase 7 — AI explanations

The AI layer from the original spec: plain-English setup explanations, end-of-day journal
summaries, behavioral pattern analysis (gated on having enough data), and accountability
reminders. **Every prompt shares the same safety guardrails**, taken directly from the spec's
"AI responsibilities" section — this isn't a suggestion applied loosely, it's baked into a
shared base prompt every single AI call includes, and it's unit-tested that each guardrail
phrase is actually present.

### What the AI layer can and cannot do (enforced, not just documented)

Per the spec, and enforced in `lib/ai/prompts.ts`'s shared `SAFETY_BASE`:
- Never calculates, estimates, or invents a price or indicator — only references values already
  computed by the rule engine and explicitly passed in
- Never predicts price direction or calls a setup a "buy"/"sell" signal
- Never recommends a trade, position size, or overriding your own risk limits
- States plainly when a setup is weak or invalidated rather than manufacturing false
  encouragement or urgency
- For the accountability reminder specifically: the AI rephrases warnings that
  `computeAccountabilityChecks()` (Phase 6b, pure deterministic code) already decided — it is
  never the one deciding whether you're blocked from trading

### What's new

- **`lib/ai/client.ts`**: thin, server-only wrapper around the Claude API. Defaults to
  `claude-sonnet-5`, overridable via `AI_MODEL` (e.g. `claude-haiku-4-5-20251001` for
  cheaper/faster). Throws a clear, specific error if `ANTHROPIC_API_KEY` isn't set, rather than
  failing confusingly deep in a request.
- **`lib/ai/prompts.ts`**: four prompt builders (explain setup, end-of-day summary, pattern
  analysis, accountability reminder), all built on the shared safety base above. Pure functions
  — fully unit-tested (11 tests) including verifying the guardrail language is actually present
  in every system prompt, not just that the function runs.
- **Four new API routes** (`/api/ai/explain-setup`, `/api/ai/journal-summary`,
  `/api/ai/patterns`, `/api/ai/accountability-reminder`): all authenticated, all return a clear
  501 if AI isn't configured rather than a confusing failure. The explain-setup route
  deliberately **re-scans the symbol server-side** rather than trusting whatever `SetupResult`
  the browser sends it — the explanation must be grounded in freshly verified data.
- **Pattern analysis is gated on ≥10 journal entries** (`hasEnoughDataForPatternAnalysis()`),
  checked *before* spending an API call, exactly matching the spec's own instruction: *"Do not
  add advanced AI analysis until enough journal data exists."* Below that threshold, the button
  returns a plain "not enough data yet" message, no AI call made.
- **UI**: "Explain this setup" button on the setup detail panel, "Get a reminder" on the
  accountability panel, "Generate today's summary" and "Analyze behavioral patterns" on the
  journal page.

### I could not test any of this against the real Claude API myself

Same limitation as every external-service milestone — no internet access in my sandbox means
I've never actually called the Anthropic API. The prompt-building logic and guardrail presence
are unit-tested; the client's HTTP handling is tested against realistic mocked responses; but
the *first* real verification — does the actual model produce a sensible, safe explanation from
real data — has to happen in Claude Code with a real API key.

### Known limitations in this milestone

- Uses one shared `ANTHROPIC_API_KEY` for the whole app (appropriate for a personal single-user
  tool) — a multi-user version would need per-user key management or a shared billing model.
  Not relevant at your current scale.
- No caching — asking for the same setup's explanation twice makes two API calls. Fine for
  occasional use, worth adding if this gets used heavily.
- The 10-entry threshold for pattern analysis is a fixed constant, not configurable in the UI.
- No streaming — responses appear all at once after the "Thinking…" state, not token-by-token.

## Status: Phase 6d — Background scanning (alerts without the dashboard open)

Alerts previously only fired when the dashboard was open and triggered a scan — the whole point
of an alert system is catching something *without* watching the screen, so this closes that gap.
This milestone also fixes a real architecture problem it surfaced: the in-memory alert store
from Phase 5 cannot survive a scan running in a fresh serverless container with no memory of the
last scan, which background/cron scanning would hit immediately.

### Important, verified-current constraint: Vercel's free tier

**Vercel's Hobby (free) plan only allows cron jobs to run once per day** — any more frequent
schedule fails at deploy time. That's not workable for an intraday 5m/15m scanner. Your real
options, in order of simplicity:

1. **Stay on Hobby, use an external scheduler** — a free service (e.g. cron-job.org, or a GitHub
   Actions scheduled workflow in a repo you already have) sends a request to
   `/api/cron/scan` with the right auth header on whatever interval you want (every 5-15 minutes
   is reasonable). Vercel doesn't care who calls the route — it's a normal HTTP endpoint.
2. **Upgrade to Vercel Pro ($20/mo)** — removes the once-daily cap, `vercel.json`'s cron entry
   then fires on a real schedule natively.
3. **Run it yourself** — since you're currently running locally, `npm run dev` staying open is
   already "background" scanning in the loosest sense, just not while your computer's off.

`vercel.json` ships with a once-daily entry (`0 14 * * 1-5`, weekdays at 10am ET) as a Hobby-safe
placeholder — replace it with a real interval once you're on Pro, or delete it and use an
external scheduler instead.

### What's new

- **`supabase/migrations/0004_background_scanning.sql`**: `scan_snapshots` (persists the last
  `SetupResult` per user/symbol/timeframe so diffing survives across stateless invocations) and
  `alert_events` (persists fired alerts per user, replacing Phase 5's in-memory event history).
- **`lib/supabase/admin.ts`** (new): a service-role Supabase client that bypasses RLS —
  deliberately, since the cron job legitimately needs to act across every user's data at once.
  Never imported into anything handling a single user's request.
- **`lib/alerts/persistentAlertStore.ts`** (new): `processResultPersistent()`, the same
  evaluate → cooldown-check → fire logic as Phase 5's in-memory `AlertStore`, but backed by real
  tables. Unit-tested (4 tests) against a fake Supabase client covering first-scan,
  genuine-transition, and cooldown-suppression cases.
- **`app/api/cron/scan/route.ts`** (new): the actual background-scan endpoint. Refuses to run
  without a `CRON_SECRET` configured (never allows an unauthenticated request to trigger a scan
  of every user's data), iterates every watchlist via the admin client, and — critically — one
  user's failure (bad symbol, rate limit) doesn't abort scanning everyone else.
- **`app/api/scan/route.ts`** and **`app/api/alerts/route.ts`**: now use the persistent store for
  real (Supabase-configured) users; the in-memory store from Phase 5 is kept only as the
  no-Supabase fallback path, exactly matching every other fallback in this codebase.
- **`.env.example`**: `CRON_SECRET` documented, `SUPABASE_SERVICE_ROLE_KEY` (present since Phase
  1 but unused until now) finally has a real purpose.

### I could not test any of this against a real deployment

This is the least-tested milestone yet, honestly. I've never deployed this app anywhere, never
triggered a real cron job, and never verified the admin client's service-role access against a
live project. The persistent alert logic is unit-tested with fakes, but the *entire* deployment
and scheduling path — Vercel, an external scheduler, the cron route actually iterating real
users — is unverified until you try it for real.

### Known limitations in this milestone

- No per-user opt-out of background scanning — if a user exists with a watchlist, the cron job
  scans them every time it runs.
- No rate-limit-aware batching across users — if you ever have many users on a free Alpaca tier,
  scanning all of them back-to-back could burn through the provider's per-minute limit faster
  than scanning one dashboard ever did. Not a concern at your current scale, worth revisiting if
  this ever supports more than a handful of users.
- `scan_snapshots` grows one row per user/symbol/timeframe (bounded, not unbounded) but
  `alert_events` grows forever with no pruning — fine for a while, will eventually want a
  retention policy.

## Status: Phase 6c — Trade journal (real entries, real statistics)

The full trade journal from the spec — every field, basic statistics, and plan-following score.
This also retires the Phase 6b "Log Trade" stand-in exactly as that milestone's README promised:
daily trade count and P&L are now a genuine aggregate over real journal entries, not an
independently-tracked counter.

### What's new

- **`supabase/migrations/0003_trade_journal.sql`**: `trade_journal_entries` table, RLS-scoped to
  `auth.uid()`. One deliberate simplification from the original schema: `tags` is a plain
  `text[]` column on the entry itself rather than a separate `journal_tags` join table — simpler
  for a single-user tool, documented in the migration if this ever needs cross-user tag
  analytics later.
- **`lib/journal/queries.ts`**: `createJournalEntry()`, `listJournalEntries()`,
  `deleteJournalEntry()`, and `recomputeDailyStatusFromJournal()` — the key function. Every
  create/delete recomputes that day's `daily_trading_status` as a true sum over that day's real
  entries, so it self-corrects on edits/deletes instead of drifting like a manual counter would.
- **`lib/journal/statistics.ts`**: `computeJournalStatistics()`, pure and fully unit-tested (7
  tests) — total trades, win rate (excluding break-evens from the denominator), total/average
  P&L, plan-following rate, and a mistake-category breakdown. Per the spec: *"Do not add advanced
  AI analysis until enough journal data exists"* — this is deliberately plain arithmetic, no AI
  involved. That's Phase 7.
- **`app/journal/page.tsx`** (new): entry form with every field from the spec (date, ticker,
  direction, entry/exit price, size, stop, P&L, setup score at entry, conditions passed/missing,
  screenshot URL, notes, emotional state, followed-plan checkbox, mistake category, lesson
  learned, tags), plus statistics cards and a deletable entry history.
- **Removed**: `components/dashboard/LogTradeWidget.tsx` and the `POST` handler on
  `/api/risk/status` — both genuinely superseded now, not just unused. Leaving the old POST
  endpoint wired up would have created two competing ways to write `daily_trading_status` (a
  manual counter vs. the new journal-derived aggregate), which could silently drift out of sync
  with each other. The underlying `logTrade()` function in `lib/risk/queries.ts` is kept
  (harmless, still correct) but marked `@deprecated` and called from nowhere.

### I could not test this against a real Supabase project myself

Same limitation as every Supabase milestone. The statistics function and the recompute logic's
aggregation math are both unit-tested against realistic fake data, but the actual database
round-trip — creating an entry, seeing the dashboard's account summary update to match, deleting
an entry and confirming the numbers correctly drop — needs real verification.

### Known limitations in this milestone

- No edit capability yet, only create and delete — editing a mis-entered trade means deleting
  and re-creating it.
- Screenshot URL is just a text field (paste a link) — no actual file upload yet.
- The form's "Conditions Passed/Missing" fields are free-text comma-separated entry, not
  auto-populated from the scanner's actual checklist at the time of the trade — a nice future
  improvement would be pre-filling these from the real `SetupResult` when logging a trade
  directly from the dashboard's setup detail panel, rather than typing them by hand.
- Journal history has no pagination yet (`listJournalEntries` caps at 200) — fine for a while,
  will need real pagination eventually.

## Status: Phase 6b — Risk & accountability (real data, no more mock panel)

The account summary and accountability panel — mock/static since Phase 1 — now show real,
persisted, per-user data. Daily trade limits, loss limits, profit targets, and every
accountability warning are computed from actual saved settings and actual logged activity, not
hardcoded booleans.

### What's new

- **`supabase/migrations/0002_risk_and_daily_status.sql`**: `risk_settings` (your configured
  thresholds) and `daily_trading_status` (today's trade count, running P&L, last-trade time) —
  both RLS-scoped to `auth.uid()`.
- **`lib/risk/accountabilityEngine.ts`**: `computeAccountabilityChecks()`, a pure function taking
  real settings + real status + real market-session info and returning every warning from the
  spec's accountability list — trades remaining, daily goal/loss limit reached, low-scoring-setup
  attempt, trades-too-close-together, outside allowed session, and an overall "blocked from
  trading" flag. Fully unit-tested (11 tests) without touching a database.
- **`lib/risk/queries.ts`**: settings CRUD, plus `getOrCreateTodayStatus()` — the daily counters
  reset automatically because "today" just means no row exists yet for that trading date, not a
  separate reset job.
- **`lib/risk/tradingDate.ts`**: computes "today" in US Eastern time specifically, so the trading
  day boundary matches the market's, not the server's or your local timezone.
- **`app/api/risk/settings/route.ts`** and **`app/api/risk/status/route.ts`**: authenticated
  CRUD, with a mock-data fallback (matching `/api/scan`'s pattern) when Supabase isn't
  configured, so this stays fully backward compatible.
- **`components/dashboard/LogTradeWidget.tsx`** (new) + **Settings page**: a "Risk &
  Accountability" section with every threshold from the spec (max trades/day, max loss/day,
  profit target, max risk/trade, minimum setup score, minimum time between trades, allowed
  sessions, block-after-target, block-after-loss-limit).

### Important, deliberate simplification: trade logging vs. the full journal

There's no trade journal yet (that's next). Instead, a lightweight "Log Trade" widget on the
dashboard lets you record a P&L delta, which increments today's trade count and running P&L —
just enough to make the accountability panel genuinely real without building the full
entry/exit/stop/notes form first. **When the journal ships, this becomes an aggregate computed
from real journal entries** instead of an independently-tracked counter — documented here so
that transition doesn't come as a surprise.

### I could not test this against a real Supabase project myself

Same limitation as every Supabase milestone — the accountability engine itself is thoroughly
unit-tested (pure function, no I/O), but the actual database round-trip (saving risk settings,
logging a trade, seeing the daily counters update) needs real verification against your project.

### Known limitations in this milestone

- "Symbols I am permitted to trade" from the spec isn't a separate setting — it's implicitly
  your watchlist. Worth a dedicated field later if you ever want to scan a symbol without being
  "permitted" to trade it.
- No timezone-aware "next reset" countdown shown anywhere — the daily boundary works correctly,
  but there's no UI telling you when it resets.
- The dashboard's accountability panel doesn't yet check the low-scoring-setup warning against
  *every* watchlist symbol — only whichever one is currently selected in the setup detail panel.

## Status: Phase 6 foundation — Supabase auth, persistent watchlist & strategy config

Adds real, per-user data: sign-in, a watchlist you can actually edit (add/remove symbols without
touching code), and strategy thresholds editable from a Settings page instead of only in
`lib/strategies/config.ts`. **Fully backward compatible**: leave Supabase env vars unset and the
app runs exactly like Phases 1-5 (hardcoded mock watchlist, no login) — nothing breaks for
anyone not ready to set this up yet.

### Real bug found during first sign-in attempt (fixed)

Claude Code found that clicking "Send sign-in link" hung forever with a "Missing required
environment variable" error — even with real, correctly-set Supabase credentials in
`.env.local`. Root cause: `lib/supabase/client.ts` read the `NEXT_PUBLIC_*` vars through the
generic `required()` helper in `lib/env.ts`, which does a **dynamic** `process.env[name]`
lookup. Next.js can only inline `NEXT_PUBLIC_*` values into the browser bundle when it finds a
**static literal** `process.env.NEXT_PUBLIC_X` token in source at build time — a dynamic lookup
can't be analyzed that way, so it silently resolved to `undefined` in the actual browser no
matter how correctly the variable was set. This is why server-side code (middleware, Route
Handlers) worked fine throughout — real `process.env` object at runtime there, no bundling
step — while only the one client-component call site broke. Fixed by having
`lib/supabase/client.ts` read both vars as static literals directly, with its own clear error
message if they're missing. `lib/supabase/server.ts` is correctly left alone (dynamic lookup is
fine server-side) with a comment explaining why, so this doesn't get "fixed" into the same bug
later. **Note**: this specific class of bug can't be caught by a Vitest unit test, since Vitest
runs in Node with a real `process.env` — the failure only exists in an actual bundled browser
build. Caught here only because it was tested against the real dev server.

### Manual setup required (I can't do this part — no way to create cloud resources from my sandbox)

1. Create a free project at supabase.com
2. Copy the Project URL and anon/public key into `.env.local` as `NEXT_PUBLIC_SUPABASE_URL` /
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. In the Supabase SQL Editor, run `supabase/migrations/0001_watchlist_and_config.sql`
4. In Authentication → URL Configuration, add `http://localhost:3000/auth/callback` as a
   redirect URL
5. Restart the dev server — you should be redirected to `/login` on your next visit

### What's new

- **Auth**: magic-link (passwordless) sign-in via `app/login/page.tsx` and
  `app/auth/callback/route.ts`. `middleware.ts` refreshes the session on every request and
  redirects unauthenticated visits to `/login` — but only once Supabase is actually configured,
  so this can't lock anyone out who hasn't set it up.
- **`lib/supabase/client.ts` / `server.ts`**: browser and server Supabase clients using
  `@supabase/ssr`, the cookie-safe pattern for the App Router.
- **`supabase/migrations/0001_watchlist_and_config.sql`**: `watchlists`, `watchlist_symbols`,
  `strategy_configs` tables with Row Level Security scoped to `auth.uid()`. Note:
  `strategy_configs` stores the whole `StrategyConfig` as one `jsonb` column rather than ~30
  individual columns — simpler to migrate, at the cost of not being queryable per-field in SQL;
  documented trade-off, revisit if that becomes a real need.
- **`lib/watchlist/queries.ts`**: typed query functions — auto-provisions a default (empty)
  watchlist on first use, so there's no separate onboarding step; merges a saved partial config
  over the built-in defaults so adding a new threshold to `StrategyConfig` later can't produce a
  config missing fields the scorer expects.
- **`app/api/watchlist/route.ts`** (GET/POST/DELETE) and **`app/api/settings/config/route.ts`**
  (GET/PUT): authenticated CRUD for the watchlist and strategy config.
- **`app/settings/page.tsx`** (new): add/remove watchlist symbols, plus a focused set of
  editable thresholds (decline %, recovery amount, consecutive-candle count, EMA period, daily
  SMA period) — not the full ~30-field config yet, deliberately scoped down for this milestone.
  The rest stays code-editable in `lib/strategies/config.ts`.
- **`app/api/scan/route.ts`**: now resolves the real, authenticated user's watchlist and saved
  config from Supabase when configured, falling back to the old hardcoded 4-symbol list only
  when Supabase env vars are absent.
- **`components/layout/NavBar.tsx`**: Settings is now a real link; added a Sign Out button.

### I could not test any of this against a real Supabase project

Same limitation as Alpaca in Phase 4 — no internet access in my sandbox means I've never actually
created a Supabase project, run this migration, or completed a real magic-link sign-in. The
query-layer logic (default-merging, symbol normalization, duplicate handling) is unit-tested
against a fake client, but the *first* real test of auth, RLS, and the actual migration SQL has
to happen in Claude Code, against a real (free) Supabase project.

### Known limitations in this milestone

- Only a subset of strategy thresholds are editable in the UI — the rest require editing
  `lib/strategies/config.ts` directly, same as before.
- No "add a second watchlist" UI — every user gets exactly one, auto-created, called "My
  Watchlist". The schema supports more; the UI doesn't expose it yet.
- `SUPABASE_SERVICE_ROLE_KEY` is in `.env.example` but unused so far — everything here goes
  through RLS-protected user-scoped queries, which is the safer default. A service-role key
  would only be needed for admin-style operations that bypass RLS, which nothing here does yet.
- Alert history (`alert_events`) and risk/journal persistence are still in-memory/not built —
  next milestone.

## Status: Phase 5 — Alerts (in-app, edge-triggered, deduplicated)

In-app alerts now fire when a setup condition first crosses into passing (or invalidated), not
every time the dashboard happens to re-scan while it's already true. Structured so email, SMS,
push, Discord, Telegram, and Slack can be added later as new `NotificationChannel`
implementations without touching the alert engine or cooldown logic.

### What's new

- **`lib/alerts/types.ts`** — `AlertRule` and `AlertEvent` types, covering every alert type from
  the spec (recovery from low, consecutive bullish, liquidity sweep, structure shift, EMA
  reclaim, FVG created, FVG proximity, score threshold, setup invalidated). Note: "price
  approaching the gap" and "price entering the gap" are merged into one `fair_value_gap_proximity`
  rule, since both map to the same `gap_proximity` scorer condition today — documented as a
  known simplification, not hidden.
- **`lib/alerts/alertEngine.ts`** — `evaluateAlerts()`, a pure function comparing a symbol's
  previous and current `SetupResult` and returning events only for genuine pass/fail or
  invalidation *transitions*. Fires nothing on a symbol's first-ever scan (nothing to diff
  against yet), which avoids flooding the feed with alerts for conditions that were already true
  before the app started watching.
- **`lib/alerts/cooldown.ts`** — `AlertCooldownTracker` + `applyCooldowns()`, preventing a rule
  from re-firing for the same symbol/timeframe within its configured cooldown window, even if a
  value flickers back and forth near a boundary (e.g. score sitting right at a threshold).
- **`lib/alerts/defaultRules.ts`** — sensible default rules, all enabled, 5-minute cooldowns,
  score threshold at 7/11.
- **`lib/alerts/channels.ts`** — `NotificationChannel` interface + `InAppChannel`
  implementation. Future channels are stubbed as commented-out class names, not built.
- **`lib/alerts/alertStore.ts`** — server-side in-memory store holding the previous result per
  symbol/timeframe (for diffing) and recent event history. **Known limitation, documented**:
  in-memory and process-local — resets on server restart, won't work across multiple server
  instances. Shape mirrors the spec's `alert_events` Supabase table on purpose, so Phase 6
  persistence is a storage swap, not a redesign.
- **`app/api/scan/route.ts`**: every scan now feeds each symbol/timeframe's result through the
  alert store, dispatches any newly-fired events to the in-app channel, and returns them in the
  response as `newAlerts`.
- **`app/api/alerts/route.ts`** (new): returns recent alert history for the Alerts page.
- **`app/alerts/page.tsx`** (new): shows configured alert rules and a feed of fired alerts.
- **`components/layout/NavBar.tsx`** (new): the top nav is now real — Dashboard and Alerts are
  working links; Scanner/Journal/Performance/Settings render disabled (not dead links to `/`)
  since those pages don't exist yet.
- **`app/page.tsx`**: shows a small banner listing any alerts that fired on the current scan.

### Known limitations in this milestone

- Alerts only evaluate on scans triggered by loading the dashboard — there's no background
  polling/cron yet, so you won't get an alert while the tab is closed. A scheduled job (Vercel
  Cron, or similar) that scans periodically regardless of whether anyone has the dashboard open
  is reasonable future work once this needs to run unattended.
- The in-memory store means alert history is lost on every server restart — fine for
  development, not fine for production use until Phase 6 moves this to Supabase.
- No per-user rule configuration UI yet — the default rule set applies globally. A settings page
  to customize thresholds/cooldowns per rule is natural Phase 6 work alongside the
  `alert_rules` table from the original schema.

## Status: Phase 4 — Market-data integration (Alpaca adapter)

Real (or still-mock, your choice) candle data now flows through a proper provider interface into
the same rule engine and dashboard from Phases 2-3. **Runs on mock data by default** — you don't
need an Alpaca account to run the app; it only switches to live data once you set
`ALPACA_API_KEY_ID`/`ALPACA_API_SECRET_KEY` in `.env.local`.

### Provider comparison (done before writing any code, per the spec)

Compared Alpaca, Polygon.io (rebranded "Massive" in 2026), Twelve Data, and Finnhub on 5m/15m
candle support, real-time vs. delayed data, WebSocket availability, historical depth, rate
limits, cost, and commercial terms. Chose **Alpaca** to start: a genuinely free tier (not a
time-limited trial) with native 1/5/15/30/60-minute bars, a real-time (if single-exchange) free
WebSocket, and a generous 200 req/min limit — with a clean, same-adapter upgrade path to
Polygon's $29/mo tier or Alpaca's own $99/mo paid tier later if needed. One important finding:
**Finnhub's free tier moved candle/historical data behind a paywall in 2026** — despite being in
the original candidate list, it's no longer viable for this project's free tier. Also confirmed
directly: **TradingView does not offer a general market-data API**, even to paid subscribers —
its only developer surfaces are the Charting Library, the Datafeed spec, and the Broker REST API,
none of which hand you raw price data. TradingView's role in this app stays exactly what it was
from Phase 1: outbound chart links only.

### What's new

- **`lib/market-data/types.ts`** — the `MarketDataProvider` interface every adapter implements
  (`getCandles`, `getSessionInfo`). Strategy code never imports a specific provider.
- **`lib/market-data/providers/alpacaProvider.ts`** — the real adapter. Maps Alpaca's bar format
  to our `Candle` type via a pure, unit-tested `mapAlpacaBar()` function; handles 401/403/429
  with clear error messages; labels data quality (`realtime` for the free IEX feed, `delayed`
  for the free SIP feed, `realtime` on paid plans).
- **`lib/market-data/providers/mockProvider.ts`** — same interface, wraps the Phase 3 mock
  fixtures. This is the default provider — no API keys required to run the app.
- **`lib/market-data/providerFactory.ts`** — picks Alpaca vs. mock based on whether
  `ALPACA_API_KEY_ID`/`ALPACA_API_SECRET_KEY` are set in the server environment.
- **`lib/market-data/rateLimiter.ts`** — sliding-window limiter (200 req/min free tier, 10,000
  paid) that refuses new requests before they'd hit a 429, rather than finding out the hard way.
- **`lib/market-data/cache.ts`** — in-memory TTL cache (30s for 5m candles, 60s for 15m, 5min for
  daily) so refreshing the dashboard doesn't re-fetch on every render.
- **`lib/market-data/session.ts`** — computes pre-market/regular/after-hours/closed from the
  current time in US Eastern. **Known limitation, documented not hidden**: doesn't account for
  market holidays or early-close days yet — a real holiday calendar is a natural follow-up once
  a provider's `/clock` or calendar endpoint gets wired in.
- **`app/api/scan/route.ts`** (new) — a server-side Next.js route that runs the scan and returns
  JSON. This is *why* the dashboard now fetches instead of computing inline: Alpaca's API keys
  must never reach the browser, so the actual provider call has to happen server-side.
- **`app/page.tsx`** — now fetches from `/api/scan` with loading/error states, instead of calling
  `scanWatchlist()` synchronously against hardcoded mock inputs. Shows which provider is active
  (`mock` or `alpaca`) directly on the dashboard.
- **`lib/scanner/scanService.ts`** — added `scanWatchlistWithProvider()` alongside the original
  Phase 3 `scanWatchlist()` (kept, not deleted, since it's still useful for tests/fixtures).

### To actually go live

1. Sign up free at alpaca.markets (no funding required — data-only use is free)
2. Copy your API key ID and secret into `.env.local` (see `.env.example`)
3. Restart the dev server — the dashboard will show "Data provider: alpaca" instead of "mock"

**I could not test the real Alpaca integration myself** — no internet access in my sandbox means
I've never actually called Alpaca's API. The bar-mapping logic is unit-tested against realistic
fake responses, and the HTTP error handling is tested the same way, but the *first* real
verification of this against Alpaca's actual API has to happen in Claude Code, ideally with a
real (free) API key.

### Known limitations in this milestone

- The watchlist symbols are still hardcoded in `app/api/scan/route.ts` (NVDA/TSLA/AMD/AAPL) —
  a real user-editable watchlist is Phase 6 (Supabase) work.
- No retry/backoff logic on transient failures yet — a failed fetch just surfaces as an error
  banner on the dashboard.
- `getSessionInfo()` is computed locally rather than calling Alpaca's `/v2/clock` endpoint, to
  avoid spending a rate-limited request on something derivable — fine for now, but means no
  holiday awareness (see the session.ts limitation above).
- Only Alpaca is implemented. Polygon/Twelve Data adapters would follow the same
  `MarketDataProvider` interface if you want a second option later.

## Status: Phase 3 — Scanner dashboard (rule engine wired into the UI)

The dashboard now runs the real Phase 2 rule engine against mock candle data instead of showing
hand-typed scores. **Still no live market data** — `lib/mock/scanInputs.ts` holds synthetic
candle series per symbol, but everything downstream (scanner service → scorer → dashboard) is
the real code path Phase 4 will plug live data into.

### What changed

- **`lib/mock/scanInputs.ts`** (new): per-symbol mock candle series designed to land in
  different states — NVDA runs the "textbook" full bullish-reclaim sequence (should score
  highest), TSLA gets a decline + partial recovery but not enough for a full setup (yellow),
  AMD and AAPL stay uneventful (red) — so you can see all three status colors on one dashboard.
- **`lib/scanner/scanService.ts`** (new): `scanWatchlist()` runs `scoreSetup()` from Phase 2
  across every symbol's 5m and 15m candles and produces both the watchlist row summaries and
  the full per-symbol checklist results.
- **`components/dashboard/SetupStageTimeline.tsx`** (new): visual stage progression
  (decline → recovery → momentum → sweep → structure → EMA reclaim → FVG → gap entry),
  highlighting the setup's current stage.
- **`components/dashboard/SetupDetail.tsx`**: now shows the stage timeline and a 5m/15m toggle
  so you can flip timeframes on the selected symbol.
- **`app/page.tsx`**: replaced the static `mockWatchlist`/`mockSetupResults` imports with a
  `scanWatchlist(mockScanInputs)` call — the watchlist scores, status colors, and checklist are
  now genuinely computed, not hand-typed.
- `lib/mock/watchlist.ts` and `lib/mock/setups.ts` are no longer used by the dashboard but were
  left in place rather than deleted, since Phase 1 code shouldn't be removed without a reason —
  they're just superseded now.

**I still can't run this myself** (no internet access in my sandbox for `npm install`/`npm run
dev`), so treat this as ready for verification, not confirmed working, until you've run it.

### Known limitations in this milestone

- The mock candle series are hand-crafted to exercise specific stages, not randomly generated —
  don't read too much into the exact scores, they're demonstration data.
- `lastSignalTime` on the watchlist is a simplified placeholder (most recent scorer update time
  if any condition passed) — a real "signal" concept (specific stage transitions triggering
  alerts) is Phase 5 work.
- The account summary and accountability panels are still fully mock/static — those become real
  in Phase 6.

## Status: Phase 2 — Rule engine (pure functions + unit tests)

Phase 1 shipped a working dashboard shell with mock data. Phase 2 adds the actual rule engine —
every technical condition from the spec, calculated in code, fully unit-tested against fixture
candle data. **None of this is wired into the dashboard UI yet** — that's Phase 3. There is still
no live market data, no Supabase, and no brokerage integration.

### Running the tests

```bash
npm install
npm test
```

### Fixes from Claude Code's second verification pass

4. **`scoreSetup()` was calling `new Date()` internally — a real purity bug, fixed at the
   root.** This surfaced as a Next.js hydration mismatch (server render and client hydration
   computed different timestamps for the same data), but the actual problem was deeper: a
   function documented as "pure" that calls `Date.now()` internally isn't actually pure — two
   calls with identical candle data wouldn't produce identical output, which undermines the
   whole point of a deterministic, testable rule engine. Fixed by making `now` a required
   explicit input to `scoreSetup()` instead of computed internally; `scanWatchlist()` now passes
   a fixed mock timestamp by default. All 5 scorer tests updated to pass `now` explicitly.

### Fixes from Claude Code's first verification pass

1. **`tsconfig.json` — turned off `noUncheckedIndexedAccess`.** That was my own overly strict
   setting from Phase 1; it flagged ~70 "possibly undefined" errors on array indexing that's
   already bounds-checked by surrounding loop logic, not real bugs (the two real bugs found in
   Phase 2 were logic errors, which is what the test suite catches — not what this flag catches).
   Fixing it "properly" would mean ~70 non-null assertions sprinkled across the rule engine for
   no real safety gain. Standard `strict: true` is still on.
2. **`lib/tradingview.ts` — real bug, fixed.** `TIMEFRAME_TO_TV_INTERVAL` was missing a `"1d"`
   entry after `Timeframe` was extended for the daily SMA confirmation, which `tsc` correctly
   caught as a real Record-key mismatch. Added `"1d": "D"`.
3. **`lib/mock/scanInputs.ts` — mock-data gap, fixed.** The 5m and 15m series were calling the
   exact same generator function, so toggling timeframes in the UI showed identical numbers.
   Split each symbol into distinct `*Series5m()`/`*Series15m()` functions so the toggle now
   shows genuinely different (if still synthetic) data per timeframe.

### What's in the rule engine (`lib/indicators/`, `lib/strategies/`)

- `movingAverages.ts` — EMA and SMA calculators (shared math)
- `emaReclaim.ts` — Stage 6: 9 EMA reclaim, with optional follow-through/slope/distance/body-size confirmations
- `dailySma.ts` — optional confirmation: is price above the daily 20 SMA (higher-timeframe trend context)
- `sessionDecline.ts` — Stages 1–2: intraday decline detection and recovery-from-session-low (dollar and percent)
- `consecutiveBullish.ts` — Stage 3: N consecutive bullish candles with configurable body size, total move, and higher-highs/lows
- `pivots.ts` — swing high/low detector, shared by the sweep and structure-shift detectors
- `liquiditySweep.ts` — Stage 4 (marked experimental per spec): sweep below a pivot low or session low, then reclaim within N candles
- `structureShift.ts` — Stage 5: waiting/confirmed states based on a close above the most recent swing high after a sweep
- `fairValueGap.ts` — Stage 7–8: 3-candle bullish FVG detection, plus fill-status tracking (open/partial/full/invalidated) and proximity checks
- `volumeConfirmation.ts` — Stage 9: optional relative-volume confirmation
- `stratCandle.ts` — optional confirmation: Rob Smith's Strat candle typing (1/2u/2d/3), scoring 2-2 reversals and inside-bar breaks
- `strategies/config.ts` — every threshold above, in one `StrategyConfig` object with sane defaults — nothing is hard-coded into the detectors
- `strategies/scorer.ts` — composes every detector into a `SetupResult`: required conditions gate red/yellow/green, optional ones only add to score, exactly per spec

### Test coverage (`tests/`)

One file per detector, plus an integration test for the scorer, using synthetic fixture candles
in `lib/fixtures/candles.ts` (flat, rising, falling, and a "textbook" full bullish-reclaim
sequence). Covers: EMA/SMA math, EMA reclaim (including the no-reclaim case), daily SMA
confirmation, intraday decline, session-low recovery, consecutive bullish candles, pivot
detection, liquidity sweep (including the never-reclaims case), structure shift (confirmed and
waiting states), fair value gap detection, partial fill, full fill, invalidation, gap proximity,
Strat candle classification and confirmation patterns, and scorer-level integration checks
(empty input, flat/uneventful session stays red, optional confirmations never push status to
green on their own).

### Bugs found from real test runs (fixed)

Claude Code ran the test suite and reported 53/55 passing, 2 failing. Both were real issues, now fixed:

1. **`liquiditySweep.ts` — tautological session-low definition.** The detector compared each
   candle's low against the *whole-session* minimum, which by definition includes the candle
   being tested — nothing can ever trade below the lowest low in its own dataset. Fixed to use
   a running "prior low" computed only from candles *before* the one being tested, and to
   require the reclaim to happen on a **later** candle (not the same one), matching how a
   liquidity sweep actually plays out as a multi-candle event. The original tests also had a
   fixture bug (the "never reclaims" case accidentally shared its first candles with the
   "detects a sweep" case's actual sweep event) — both fixtures were rewritten to be
   unambiguous.
2. **`structureShift.ts` test fixture — insufficient lookback.** The detector itself was
   correct; the test fixture placed the intended swing high too close to the start of the
   candle array, so with `pivotLength: 3` there weren't enough candles on both sides to
   legitimately confirm it as a pivot — the detector correctly refused to call it one. Rebuilt
   the fixture with proper spacing so the swing high has 3 confirming candles on each side.

I traced both fixes by hand against the candle math since I still can't execute code, but this
needs a real `npm test` run to confirm — that's the next step.

## Status: Phase 1 — Foundation (mock data only)

This milestone ships a working dashboard shell with **entirely mock/simulated data**, so you can
see the real layout before any live data or database is connected. There is no brokerage
integration and no live market data yet.

## Getting started

Requirements: Node.js 18+ and npm.

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## What's here in Phase 1

- Dashboard shell with top navigation (Dashboard / Scanner / Alerts / Journal / Performance / Settings — only Dashboard is wired up so far)
- Account summary panel (trade limit, daily P&L, max loss, accountability status)
- Watchlist panel with 5m/15m scores and red/yellow/green status dots
- Setup detail / checklist panel with a TradingView deep link
- Accountability panel with firm-but-respectful status messages
- Core types (`types/candle.ts`, `types/setup.ts`, `types/watchlist.ts`) that the Phase 2 rule
  engine will build on
- `.env.example` for future Supabase / market-data configuration (nothing is required yet)

## What's explicitly NOT here yet

- No Supabase connection (auth, DB, journal persistence) — Phase 1 uses in-memory mock arrays
- No rule engine (EMA, structure shifts, FVGs, liquidity sweeps) — Phase 2
- No real or delayed market data — Phase 4
- No alerts, journal form, or settings page — later phases
- No AI explanations — Phase 7, only after the rule engine is proven

## Known limitations / assumptions in this milestone

- All data in `lib/mock/` is hardcoded and does not update; refreshing the page always shows the
  same values.
- The setup detail panel only has mock data wired up for `NVDA`; selecting other tickers will show
  the "select a symbol" empty state until Phase 2/3 wire up per-symbol results.
- `lib/env.ts` validates nothing yet (no required vars in Phase 1) — it exists so later phases fail
  loudly instead of silently breaking.
- Tailwind's dark palette (`obsidian.*`, `platinum.*`, `signal.*`) is defined in
  `tailwind.config.ts` — adjust hex values there if you want to tune the brand look.
