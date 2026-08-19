# Obsidian Scanner — Attention Engine Refactor v3.1

This is the canonical, versioned specification. The Phase 0 decisions below are approved. Later
sections remain requirements, not authorization to skip the implementation order.

## 0. Purpose and invariants

The scanner is a real-time attention and decision-support system for an active intraday options
trader. It answers: **Which stocks deserve my attention right now?** It does not decide trades.

`IN PLAY ≠ ENTRY` · `ACCELERATION ≠ BUY` ·
`DIRECTION TRANSITION ≠ REVERSAL CONFIRMED` · `ATTENTION SCORE ≠ SETUP SCORE` ·
`SETUP SCORE ≠ WIN PROBABILITY` · `REFERENCE LEVEL ≠ GUARANTEED TARGET`.

Preserve existing FVG, MSS/BOS, liquidity-sweep, EMA, displacement, extension, benchmark/sector,
setup, alert, session, and ingestion machinery. Advanced TA supports discovery; it never gates a
symbol from receiving attention. A runtime flag must restore legacy ranking and alerting without a
redeploy, and an attention failure must visibly fall back to the legacy dashboard.

## 1. Approved Phase 0 architecture

- **Feed:** Path A, consolidated SIP. Historical SIP is available free when `end` is at least 15
  minutes old. Do not purchase real-time SIP before §2 steps 1–5 complete.
- **Runtime:** always-on worker owns streaming/polling, state, recovery, snapshots, and events;
  Supabase is the durable handoff; Next.js is dashboard and control surface.
- **Fetch:** `getCandlesMulti` is mandatory while per-symbol `getCandles` remains for deep detail,
  debugging, and fallback. Preserve cache identity, retries, deadlines, rate limiting, symbol-first
  pagination, session filtering, provider abstraction, and mock support.
- **Setup Score:** Option A. Required/core conditions constrain the score; green cannot fall below
  the alert threshold; a missing core caps the score; unavailable is distinct from failure.
- **Trend package:** HARVEST into market-map/direction/regime/replay boundaries; do not partially
  integrate or delete it.

## 2. Phase A-Zero — replay harness and ground truth

Build replay and recording before tuning. The runner has no live-network or wall-clock dependency;
time is injected into decision logic. For every minute, hash sorted `symbol + score(4dp) + state +
episode id`. Identical input and configuration must produce identical hash sequences.

### 2.0 Corrected free-first sequencing

1. BUILD recorder, batch fetch, deterministic replay — free.
2. ARCHIVE 12-month SIP history, verified and checksummed — free.
3. RECORD about 20 sessions via next-day historical pulls — free.
4. LABEL same-day with both timestamps — free.
5. TUNE axes, baselines, score, states, episodes, and thresholds — free.
6. SUBSCRIBE about one month before go-live for real-time WebSocket recording.
7. VALIDATE stream fidelity: reconnect, backfill, halt/resume, and ingestion integrity.
8. GO LIVE with continuous subscription from step 6; no cancel/resubscribe cycle.

Do not subscribe for historical acquisition. Do not subscribe until steps 1–5 complete.

#### What historical pulls cannot represent

Historical bars omit the raw WebSocket stream, trading-status messages, and true bar-arrival timing.
They cannot faithfully validate reconnect/backfill, halt/resume, or live ingestion integrity.

Every replay report before step 6 must contain this verbatim disclosure:

> Timing statistics derived from historical pulls assume instantaneous bar availability. Real
> arrival latency is not represented. Human-relative latency and move-capture figures are therefore
> OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.

#### Historical archive

- 1m split-adjusted extended-hours bars: 12 months, six minimum.
- 5m split-adjusted extended-hours bars: 12 months.
- Split-adjusted daily bars: 24 months.
- Include 150–200 research symbols plus SPY, QQQ, IWM and every sector ETF.
- Persist raw bars only in a compact compressed format; never freeze derived scores or axes.
- Explicitly request `feed=sip` and `adjustment=split` on every call.
- Enforce `end <= now - 15 minutes` before network I/O.
- Reject unexpected or unverifiable feed provenance; never label partial-feed data SIP.
- Record adjustment in metadata and test it against the live-path adjustment.
- Respect symbol-first pagination and throttle deliberately at 180/min, below the 200/min ceiling.
- Expect roughly 5,500–6,000 minimum pages before retries, daily bars, and ancillary instruments.
- Checksum every payload and metadata file; verify readability and at least ten source triples before
  tuning.

#### Session recording and labels

Record end-to-end premarket, regular, and after-hours raw 1m/5m/daily bars. Retain boring and quiet
days. After real-time subscription, capture at least five raw WebSocket sessions including reconnect
and halt/status behavior when observed.

Labels are written the same trading day, ideally within 30 minutes of close. Each label contains
`symbol`, `time_it_became_interesting`, `time_i_actually_noticed`, confidence, direction, controlled
reason tags, and a note. A no-label day must explicitly be marked quiet. Hindsight chart timestamps
and actual-notice timestamps are reported separately and thresholds are never tuned to beat hindsight.

Controlled tags: `volume_wakeup`, `range_expansion`, `HOD_retest`, `LOD_retest`, `PMH_reclaim`,
`PML_reclaim`, `PDH_break`, `PDL_break`, `VWAP_reclaim`, `VWAP_loss`, `intraday_reversal`,
`continuation`, `sector_momentum`, `relative_strength`, `relative_weakness`, `opening_range`, `unknown`.

#### Replay report and exit

Report ground-truth hit rate, surface timestamp, latency against both label times, median latency,
before/after counts, false-positive proxy, alerts/hour, time EMERGING and IN PLAY, episode statistics,
and quarantined move-capture statistics. Run legacy and attention variants over identical data once
both exist. Phase A-Zero exits after at least two recorded sessions reproduce identical hash sequences.

### 2.1 Pre-A1 hardening findings

- Recorded replay sessions must contain the complete configured research universe. The accepted
  2025-08-14 and 2025-08-15 sessions contain 190 symbols; a two-symbol replay proves determinism
  only and cannot support cross-sectional calibration.
- Baseline coverage is measured per symbol x Eastern minute bucket and reported in sub-windows. At
  the 10-present-session displacement minimum, fully viable symbols are: premarket_early 63/190
  (04:00-07:00), premarket_core 121/190 (07:00-09:00), premarket_final 147/190 (09:00-09:30),
  regular 190/190, after_hours_core 95/190 (16:00-18:00), and after_hours_late 87/190
  (18:00-20:00). Phase A2 baseline-dependent premarket scoring starts at 07:00 ET and uses
  premarket_core plus premarket_final (121/190 fully viable across the combined window), not 04:00.
  Premarket_early requires a separately calibrated per-symbol policy before it can participate.
- Absent-bar semantics are axis-specific. For Participation (volume and dollar volume), no printed
  bar is a known zero observation and every known market session remains in the distribution. For
  Displacement (range, ATR-normalized range, path efficiency), no printed bar is missing price data
  and is excluded, never imputed as zero. Idiosyncrasy is price-derived and follows Displacement.
- Every symbol-minute bucket stores a versioned baseline mode. Mode assignment is sticky: a bucket
  enters `dense` at p_present >= 0.60 and an existing dense bucket leaves only at p_present <= 0.50;
  both thresholds are configurable. A regeneration emits a bucket-level diff containing old/new
  mode and p_present. Any mode flip invalidates that bucket's cached baseline. Coverage reports the
  number of buckets within 0.05 of the dense-entry boundary as the visible instability surface.
- `dense` routes only through median/MAD z. `sparse` means nonzero historical presence below the
  dense-entry threshold and routes only through presence surprise `-log2(p_present)` plus its own
  bounded normalization curve. A zero MAD is never repaired with epsilon, and explainability names
  the stored mode and signal kind rather than presenting presence surprise as a z-score.
- A `dead` bucket with no current bar is `dead_expected_absence` and not applicable. If a current bar
  appears in a bucket with no archived prints, it is `dead_unexpected_activity`: participation emits
  the saturated 6-bit surprise value and `firstObservedActivity=true`. The symbol remains visible,
  but this signal requires displacement confluence before it can drive NOW IN PLAY. The flag is a
  headline UI reason and a required alert-payload field.
- Participation-mode transitions reset the attention-velocity sample window. Scores from differing
  modes are never differenced or compared without explicit opt-in. The score remains visible and
  flagged, but velocity-derived events are suppressed for a configurable guard (initially 10 minutes,
  to be calibrated within the accepted 5-15 minute range). Existing episodes remain continuous and
  record a modeTransition marker.
- Core and velocity thresholds have distinct stored calibration sets for premarket_early,
  premarket_core, premarket_final, regular, after_hours_core, and after_hours_late. A pending or
  missing set throws; no sub-window may borrow another's values. These sets remain pending until
  replay calibration is authorized and completed.
- The 63 symbols viable across all three premarket sub-windows are emitted separately as research
  candidates. Universe membership and benchmark, sectorEtf, cluster, and optionsTier remain trader
  judgment; the report does not select them.
- Feed provenance requires both request/response attestation and empirical evidence. For five liquid
  symbols, archived regular-session SIP volume is compared with a same-day split-adjusted IEX pull;
  every SIP/IEX ratio must remain within the configured 8x-60x band and observations are stored in
  archive metadata.

### 2.2 Setup-score unavailable and decision-payload semantics

- REQUIRED + unavailable is deliberately two-part: unavailable is excluded from arithmetic, but it
  still prevents confirmation and caps the score. A missing unavailable core condition caps at 6.5;
  another unavailable required condition caps at 6.9. The UI must say "Warming up - setup score
  capped," not imply an ordinarily low evaluated score.
- The score-band invariant is
  MISSING_CORE_SCORE_CAP < MISSING_REQUIRED_SCORE_CAP < alertThreshold <= CONFIRMED_SCORE_FLOOR.
- DEVELOPING requires at least 50% of required conditions passing. Two of six is WATCH, not
  DEVELOPING; the former redundant two-condition clause is removed.
- entryStatus and invalidationNote are first-class typed outputs. Invalidation carries a numeric
  level plus a reason enum. Every evaluated condition carries observedValue, thresholdValue,
  signed distanceToThreshold, and its normalization unit; unavailable conditions carry an explicit
  reason instead. Display prose is never the numeric interface.
- Every reversal alert carries entry status, structured invalidation, required n-of-m, triggering
  condition id, numeric score, all structured conditions, and evidence. Empty scorer results publish
  empty evidence explicitly.

### 2.3b Label assistant

The label assistant reduces end-of-session review effort without automating trader judgment.

- Executed journal trades, and broker fills when supplied, become `executed_trade` labels with the
  actual entry timestamp as `time_i_actually_noticed`. They are high confidence but explicitly
  selection-biased and cannot independently validate scanner discovery. Legacy journal rows without
  an actual entry timestamp are reported for backfill; `created_at` is never misrepresented as a fill.
- The end-of-session generator excludes executed symbols and proposes names in the top decile of
  ATR-normalized session range or travelling the configurable ATR threshold inside 30 minutes.
  Candidates are back-dated to the first bar of the contiguous move, not its threshold crossing.
- Suggestions may include PMH/PML reclaim, PDH/PDL break, HOD/LOD retest, VWAP reclaim/loss,
  opening range, range expansion, and volume wake-up evidence when computable. Each candidate carries
  an inline price/volume sparkline. All generated decisions start `pending`.
- The trader supplies accept/reject and may supply actual-notice time. Candidate field edits are
  recorded. A manually added symbol is marked `missedByCandidateGenerator` and reported separately.
- Partial decisions persist immediately in Supabase. Quiet-session status is nullable until the
  trader explicitly chooses it; an unlabelled session is never interpreted as quiet or empty.
- A review cannot complete with pending candidates. Replay label validation fails prominently when
  trader-adjudicated labels are absent or the auto-candidate rejection rate is zero. Hit rates are
  always reported separately for `executed_trade` and `trader_adjudicated`; they are never pooled.

The minimal `/labels` surface supports arrow-key navigation, A/R one-keystroke adjudication, an
optional actual-notice field, explicit quiet/not-quiet controls, a missed-symbol form, and JSON export
for deterministic replay. The accept/reject decision, actual-notice time, and quiet-session judgment
are never inferred.

## 3. Phase A — core attention engine (not authorized in Phase A-Zero)

### 3.1 Configured universe

The trader-authored universe is the canonical configuration. Every entry carries symbol, benchmark,
sector ETF, cluster, options tier, enabled, referenceOnly, and optional listedSince. Options tier is
display-only and cannot affect score, state, rank, or membership.
The current configuration contains 61 tradeable and 7 reference-only symbols (68 fetched).

Reference-only entries (enabled:false, referenceOnly:true) are fetched in the same mandatory
multi-symbol batch and may supply benchmark/sector context, but can never be ranked, displayed as a
candidate, enter IN PLAY, or count against cluster caps. An enabled tradeable symbol may
also serve as another symbol's sectorEtf; resolution is based on symbol identity, not disabled status.

A benchmark must never equal its target: that makes stock-vs-benchmark Idiosyncrasy identically zero.
For an ETF that is itself the asset-class or sector proxy, sectorEtf may equal the target provided its
benchmark is a distinct, meaningful peer. Under the configured universe, QQQ and IWM use SPY as the
peer benchmark; SPY uses IWM as an explicit large-cap-versus-small-cap breadth comparison. SPY does
not claim a more fundamental broad-market benchmark. SMH, GLD, SLV, IBIT, DRAM, and SPCX use
themselves only for the sector leg, so that leg honestly duplicates the target-vs-peer magnitude
rather than manufacturing an unrelated proxy. This convention and every reference mapping are part
of universeHash and invalidate baseline, calibration, and checkpoint identities when changed.

### 3.1b New-listing policy

Where listedSince is present, count actual exchange sessions since that date. This gate is separate
from minBaselineSessions. Below configurable minHistorySessions (initially 120), data quality is
limited_history even when enough samples exist to compute a baseline. Limited-history names remain
ranked and displayed normally, and every score/UI row carries the flag. Replay statistics split them
into a separate cohort and never pool them with established names. Threshold calibration excludes
them. insufficient_baseline remains reserved for an actual sample shortage.

#### 3.1b(f) Effective listing date for reused tickers

Hand-authored listedSince values are hints and cross-checks, not sufficient archive provenance. Pull
the full available split-adjusted daily history, find gaps between consecutive bars, and use the bar
immediately following the largest gap strictly greater than configurable listingGapDays (initially 45) as the effective listing date. If no gap qualifies, use the first available bar. If the derived
date differs from the authored value by more than configurable listingDateToleranceDays (initially
5), fail loudly and report both dates; never choose silently. SPCX's authoritative authored date is
2026-06-12 and remains subject to this cross-check. All bars before the effective date are excluded
from every baseline and archive-derived history. Persist the authored value, effective value, gap,
derivation method, and discarded-bar count in archive metadata so reused-ticker protection is
verifiable.

#### 3.1b(g) When-issued and ticker-transition sessions

A ticker-transition stub can be contiguous with regular-way trading and therefore cannot be found by
the gap rule. When no gap triggered, compare median volume over configurable
whenIssuedProbeSessions (initially 10) with median volume over the following 30 sessions. A ratio
below configurable whenIssuedVolumeRatio (initially 0.20) is possible_when_issued and requires human
adjudication; the earlier candidate date must not be auto-selected. When a later authoritative
listedSince is supplied and the intervening leading sessions match the same low-volume signature,
resolve in favor of the later authored date and exclude every intervening session. SNDK is adjudicated
to 2025-02-24: Alpaca's 2025-02-13 through 2025-02-21 history represents SNDKV when-issued trading,
not regular-way SNDK.

Every resolution persists one attributable rule: gap_rule, when_issued, authored_override, or
first_bar. Persist the signature medians, observed ratio, configured threshold, and number of
excluded leading sessions with the archive metadata and expose them in the A1/limited-history report.

### 3.2 A1 data plumbing

Every per-cycle universe pull uses getCandlesMulti through the provider abstraction, including
reference-only inputs. Session classification uses the exchange calendar for holidays, early closes,
half days, DST, premarket, regular hours, and after-hours. Same-time baselines support exact 1-minute
or configured 5-minute buckets, 95th-percentile winsorization, median/MAD, z clamping, explicit
MAD-near-zero unavailability, and the accepted axis-specific absent-bar semantics.

Attention runs once per minute from 1m bars. Baselines compare the same time-of-day bucket; displacement
uses 5m ATR(14). The regular-session opening warm-up crosses the session-artifact boundary:
seed the rolling ATR with the final 13 completed five-minute true ranges from the prior regular
session, then add the current partial five-minute range as observation 14. Missing pre-open slots in
the five-minute range/path window are bridged from the final prior-session regular one-minute bars;
actual same-day premarket prints take precedence, and the bridge expires completely by 09:35. The
first chronological current-session print computes true range against the prior regular close, so the
overnight gap is represented exactly once. Never synthesize an overnight bar, price, or volume. The
identical bridge is mandatory in corpus construction, persisted baseline artifacts, and live REST
polling. Existing scoreable minutes must remain numerically unchanged; this contract adds coverage.
 Maintain lightweight full-universe state and run deep 1m/5m/15m/daily TA only for the
active 8–12 names. Never discard episode/history state when a symbol leaves the active subset.

Axes are Participation, Displacement, and Idiosyncrasy. Dense buckets normalize with median/MAD,
winsorization, z-clamping, explicit insufficient-baseline state, and a MAD≈0 guard. Sparse
Participation buckets use presence-surprise bits and their own normalization curve; they never enter
the MAD path. Dead buckets without current activity are not applicable; a first observed print emits
saturated surprise with an explicit firstObservedActivity flag and cannot drive NOW IN PLAY without
Displacement confluence. Displacement and Idiosyncrasy require printed price bars and never receive
imputed zero observations. Every emitted score carries participationBaselineMode, and explainability
carries both the stored mode and signal kind. Path efficiency is null below
`minPathAtr × ATR`, never 1. Idiosyncrasy classifies/refines but cannot gate sector-wide tradable moves.
Dense Participation computes median/MAD z on `log1p(volume)` and `log1p(dollar volume)`; Displacement computes its range component on `log1p(range/ATR)`. Path efficiency and Idiosyncrasy remain linear. These transforms are versioned members of every calibration identity and a change invalidates the affected set.
Path A confluence is Participation × Displacement. After the final rescale, Idiosyncrasy is an asymmetric discount rather than a symmetric boost/penalty. One-axis spikes cannot produce high attention.

### 3.5 A2 feed-aware Attention Score

A2 implements two explicit scoring modes. Historical archive replay uses `feedMode=sip`; the
pre-go-live IEX subset uses `feedMode=iex_partial`. SIP uses
`core = sqrt(normParticipation * normDisplacement)`. IEX-partial uses
`core = sqrt(normDisplacement * normIdiosyncrasy)`; Participation is display-only and has exactly
zero scoring weight, all volume-derived acceleration is disabled, and the modifier is exactly 1
because Idiosyncrasy is already inside the core.

For every scored axis, `norm(z,z50,k) = max(1/(1+exp(-k*(z-z50))),0.01)`. SIP alone applies
`ctx = clamp(idiosyncrasyZ,-3,3)/3` and
`modifier = 1 + idiosyncrasyInfluence*ctx`, with default influence 0.15. Both feed paths use
`maxModifier = 1 + idiosyncrasyInfluence` and
`attention = 100 * core * modifier / maxModifier`, with no final clipping. The score is bounded by
construction. Under SIP at influence 0.15, `modifier/maxModifier` spans 0.739130... to 1.0:
Idiosyncrasy can only discount a market-driven move by up to 26.09%; it cannot inflate a move above
its confluence core. The former ±15% invariant is withdrawn as obsolete. Influence 0.075 is a documented
but unselected alternative whose applied scale spans 0.860465... to 1.0; the active value remains 0.15.
Under IEX-partial, modifier remains 1 because Idiosyncrasy is already in core, while the common
maxModifier denominator reserves identical headroom. The score explanation contains feed mode,
sub-window, raw and transformed inputs, median/MAD or presence probability and surprise,
normalization parameters, normalized axes, core, raw modifier, maximum modifier, applied modifier
scale, and final value. Stock-vs-benchmark and sector-vs-benchmark Idiosyncrasy evidence remains
separate.

`z50` and `k` are calibration parameters, not global scoring constants. Dense Participation,
presence-surprise Participation, Displacement, and Idiosyncrasy each have a versioned curve stored
inside every `(feedMode, sub-window)` calibration set beside that set's thresholds. A score must use
the exact set for its feed and window and fails if an axis curve differs from the stored curve. The
provisional curve-v1 starting points are z50=2.0, k=1.2 for dense Participation, Displacement, and
Idiosyncrasy, and z50=3.0, k=1.3 for presence-surprise Participation. They remain
`pending_calibration`, not accepted production parameters.

Normalization curves and thresholds are calibrated together against the same labelled sessions;
neither may be calibrated against a version of the other that can later move. Any curve change creates
a new calibration identity, resets the affected threshold values, returns that set to
`pending_calibration`, and emits a report containing the old/new curve, version, and calibration IDs.
Every replay artifact publishes norm(input) at 0, 1, 2, 3, 4, and 6 for every stored axis curve.
Arithmetic guards require all z=0 axes to remain below `deadStockCeiling=15` and below the provisional
WATCHING core floor of 0.25. At z=6, SIP approaches 100 without reaching or exceeding it; IEX-partial
approaches `100/(1+influence)` because its modifier is 1 and the common denominator reserves modifier
headroom. With the provisional curve, scenario 20 is pinned at 61.8662 after rescaling; the former
71.1461 expectation belongs to the withdrawn clipped formula. These guards preserve the scanner's
ability to say nothing while representing extreme attention without a many-to-one final clamp.

**Post-B saturation resolution (2026-08-17):** the combined variant is accepted and active:
log1p dense Participation, log1p range, and theoretical-maximum final rescaling. The diagnostic
showed that z inflation was real but not dominant: Participation p99 was 12.5299, maximum 494.6853,
and 2.36% of observations would hit ±8, while Displacement p99 was 3.4697 and only 0.05% would hit
±8. The dominant saturation mechanism was the final clamp. On the same five-session candidate replay,
the accepted combination produced 0/74 exact-100 episode peaks, a 70.1713–98.4163 peak range, and 62
distinct one-decimal peaks. This episode-level gate is necessary but not sufficient: every calibration
must additionally publish within-minute min, max, IQR, and distinct score counts across simultaneous
IN PLAY names, because list ordering is a contemporaneous property. Population calibration is not
ground-truth validation.

Calibration identities are keyed by `(feedMode, sub-window)` and jointly cover normalization curves
and thresholds. No cross-feed or cross-window fallback exists. A feed-mode change invalidates and
reports the newly active feed's six calibration sets.
Population calibration is published for the seven viable sets (all six SIP windows plus IEX regular).
The five nonregular IEX sets are `unavailable_by_construction`. Neither state is ground-truth
validation; replay artifacts refuse discovery-quality conclusions until trader-adjudicated labels exist.
User-facing `first_bar` provenance always means first bar in provider history,
not an asserted exchange listing date.

### 3.9–3.15 A3 attention dynamics

Retain approximately 120 minutes of per-symbol score, core, axis-input, percentile, and display-rank
history. Rank is display context only. Transitions, persistence, cooling, and freshness must not accept rank or rank duration as decision inputs; they use score/core deltas, z-deltas,
percentile deltas, price/time evidence, and persistence.

Attention velocity contains exact 1m, 3m, and 5m score and percentile deltas, 1m core delta, and a
rolling 5m z-composite delta. It is distinct from price velocity. The measurement window resets before
comparing a different participation mode, feed mode, or versioned calibration identity. A participation
mode transition additionally starts the configured suppression guard; scores remain visible, the
episode remains continuous, and the episode records the transition marker.

State decisions may consume `coreSmoothed`, defined as a rolling median of raw core over
`stateSmoothingMinutes`; displayed score and attention velocity always remain raw, and I1-I4'' use the
same state-decision core. Zero disables smoothing. Corpus comparisons at 0, 3, and 5 minutes are
required before changing it.

States progress `LOW_PRIORITY -> WATCHING -> EMERGING -> IN_PLAY`, with `COOLING` for deterioration.
Every feed/window calibration set stores separate provisional or calibrated enter/exit core thresholds
for WATCHING, EMERGING, and IN PLAY, its velocity threshold, and separate integer entry/exit persistence
minutes. Both directions default to two minutes, but exit persistence is independently calibratable so
a qualified name can be slow to leave without admitting additional names. The former rule requiring every IN PLAY core
to exceed every WATCHING core is withdrawn: it is incompatible with legitimate pending promotion and
exit persistence. Every symbol instead exposes `pendingTransition: none | promoting | exiting` plus
its minute count, and every replay frame asserts:

- **I1 NO UNEARNED STATE:** the current staged state's enter threshold was met during its current
  continuous occupancy.
- **I2 SETTLED PROMOTION:** a continuously met enter threshold for the configured persistence places
  the symbol in that state or higher.
- **I3 SETTLED DEMOTION:** a continuously breached exit threshold for the configured persistence
  removes the symbol from that state or higher.
- **I4' SETTLED OCCUPANCY BAND:** when `pendingTransition=none`, each symbol is checked only against
  its own exact feed/window set: LOW PRIORITY is below WATCHING enter; WATCHING is at or above its exit
  and below EMERGING enter; EMERGING is at or above its exit and below IN PLAY enter; IN PLAY is at or
  above its exit. COOLING is outside I3/I4' ladder bands but preserves at least EMERGING membership for
  I2 because failed acceleration can enter COOLING only from EMERGING or IN PLAY. I4' is instantaneous; I1 is historical, so
  neither subsumes the other.
- **I5 LIST ORDERING:** the complete IN PLAY list is descending by attention score. State is membership metadata, never a sort key.
- **I6 ALERT-PAYLOAD CONSISTENCY:** a NOW IN PLAY payload's state-decision core is at or above the
  exact IN PLAY enter threshold from the feed/sub-window calibration set carried by that payload.
- **I7 ALERT PAYLOAD SNAPSHOT:** payload market values are frozen at the qualifying minute. Every event
  records `qualifiedAt` and `emittedAt`; its stated `at` and payload `at` equal `qualifiedAt` even when
  suppression delays emission. A calibration identity mismatch or emission before qualification fails.
  Any I1-I7 violation fails replay before the event can be stored.

Cross-symbol state ordering has now been withdrawn twice. The first formulation failed at 2025-10-10
11:00 because AMD/CRWV were legitimately inside exit/promotion persistence. The settled-only revision
failed at 2025-10-10 09:21 because the enter/exit hysteresis gap legitimately allowed IBIT EMERGING at
core 0.758935 beside AMD WATCHING at 0.845592. States are membership with memory, not ranking. Both
counterexamples are required passing regressions under I1-I4', and I5 separately protects the actual
score ordering. This history is normative and must not be removed or silently weakened.

Dashboard rows are never grouped or ordered by state. State renders as a badge beside the score-ranked row. Each row carries a plain-language explanation with its state-entered or pending
timestamp and exact band evidence, such as being below EMERGING entry or remaining above EMERGING exit,
so a legitimate cross-symbol state inversion never appears unexplained.

An episode starts when WATCHING qualification completes but is back-dated to the first bar of its
contiguous activity run. Walk backwards while each bar's core meets that bar's own feed/sub-window
WATCHING-enter threshold, bridging at most `episode.gapBars=2` consecutive misses and at most
`episode.maxBackdateMinutes=30`. `startedAt` and `priceAtStart` come from the back-dated bar, never the
later threshold crossing. At a participation/sub-window boundary, an unavailable or pending earlier
calibration truncates the walk and records `backdateTruncatedAtModeBoundary`, timestamp, and reason;
the qualifying bar's threshold is never borrowed across the boundary.

Replay digests report `Episode lifetime` and `IN PLAY occupancy` separately. Episode lifetime freezes
when the episode completes; completed episodes cannot accrue phantom duration from later rows. IN PLAY
occupancy counts only minutes whose staged state is IN PLAY.

Freshness is `Fresh | Developing | Mature | Extended` and uses elapsed episode time, ATR travel from
`priceAtStart`, 9 EMA distance, expansion context, and episode-scoped pullback history. **Published D1
semantics are normative:** `Extended` means current price is at least 1.5 ATR from the current 9 EMA,
and nothing else. Episode travel remains a maturity/history input; VWAP distance and consecutive
expansion bars are factual context badges only and MUST NOT classify freshness or suppress an event.
A regression guarantees that a 06:00 session pullback cannot prevent a new 14:00 episode from being
Fresh. Freshness remains a displayed label and extension warning, not a list gate. Mature and Extended
episodes remain visible in IN PLAY.

Attention velocity remains computed from raw score and displayed on each row. It has one real internal
consumer: the A3 cooling classifier uses it to arm failed-acceleration evidence. Phase C ACCELERATION
is deliberately not a consumer of attention-score velocity; it independently requires Participation
and Displacement acceleration plus supportive Idiosyncrasy. This distinction is normative.

An armed attention-velocity spike with rising Participation that receives no meaningful Displacement
follow-through, then loses VWAP and collapses in score/core, is classified `ACCELERATION_FAILED` and
moves through COOLING persistence. It is not a short signal. Its visible Phase C event is optional and
disabled in the published replay configuration.

Episode lifecycle is explicit. An IN PLAY exit moves the current episode to `cooling`; it does not
complete it. Re-entry during cooling resumes that same episode, increments its re-entry count, and
cannot emit another NOW IN PLAY alert. Cooling expires after configurable
`episodeCoolingTimeoutMinutes` (published starting value: 45), at which point the episode becomes
`completed`. A later qualification creates a new episode and may emit a new NOW IN PLAY alert.

IN PLAY is the only attention list and is sorted by raw attention score. Cluster compaction remains
presentation-only. Quiet sessions may produce no rows.
Population calibration is complete for the seven viable feed/window sets: all six SIP sub-windows and
IEX regular. The five nonregular IEX sets are terminally `unavailable_by_construction`, not pending.
This establishes population behavior only. Every artifact continues to refuse performance, discovery,
timing, move-capture, false-positive, and ground-truth conclusions until trader-adjudicated labels are
available.

### 3.16 Cluster de-duplication

The default display cap is three visible rows per cluster; overflow renders as `+N more in <cluster>`.
This is display compaction only: the complete score-ordered collection remains available to ranking,
state, events, episode tracking, structured logging, and search. No retired WAKING-UP override exists.
A global presentation cap limits IN PLAY to 12 rendered rows after cluster compaction. Global overflow
is explicit. Neither cap removes any engine row or mutates rank/state. When an entire group moves
together, its sector ETF may be promoted as its own row.
### 3.17 Population calibration and validation boundary

Population calibration freezes a regime-diverse session corpus and an approximately 70/30
train/holdout split before fitting. Curves, state thresholds, hysteresis exits, persistence, and velocity
thresholds are fitted on established-name training observations only. Limited-history names remain
ranked but cannot contribute to the fit. The former objective of 4–10 distinct names reaching IN PLAY
per session—and its mean-versus-median variants—is withdrawn: it says nothing about minute coverage
or usable dwell and was satisfied by two-minute flashes. Regular-session usability calibration instead
publishes and targets the fraction of minutes with at least one IN PLAY name, IN PLAY and EMERGING
occupancy distributions, gaps between consecutive IN PLAY periods, and named quiet-day preservation. Exit thresholds and exit persistence are tested first and reported
separately from any enter-threshold change. Scenario selection uses training only; untouched holdout
behavior is reported after selection without iterative refitting.

For provisional curve-v1 (`z50=2.0, k=1.2`), WATCHING core 0.25 translates to z=1.0845 on
both axes, EMERGING 0.50 to z=2.0000, and IN PLAY 0.70 to z=2.7061. With one axis at z=6,
the other must still reach z=1.9801. Every later calibration publishes the corresponding symmetric
translation and both asymmetric saturated-axis checks. A fit is rejected if either partner requirement
falls below z=1.90; a single axis must never carry a symbol into IN PLAY.

Calibration sets require an adequate population in their exact feed-mode and sub-window. Missing IEX
observations cannot be replaced by SIP observations, another window, or a default set. Population
calibration permits state-population conclusions only. Hit rate, discovery quality, latency, move
capture, and false-positive conclusions remain unavailable until trader-adjudicated labels exist.

The free historical IEX-partial corpus produced adequate regular-session coverage but cannot support
non-regular scoring. Across the 28 training sessions, early premarket and late after-hours contain no
target-symbol bars. Core/final premarket and core after-hours have only 1.3-4.2% target coverage; even
when a target prints, a causal five-minute benchmark input exists only 56-77% of the time, followed by
too few displacement/reference baseline observations. More sessions cannot repair this feed mechanism.
The five sets are `unavailable_by_construction` with reason `insufficient_reference`, not
`pending_calibration`; they emit no score and never borrow SIP or another window. **On the free IEX
feed, the scanner operates during the regular session only. Premarket and after-hours coverage require
the consolidated feed.**

The two withdrawn cross-symbol formulations and their counterexamples are preserved in §3.9 above.
Population calibration uses I1-I3, per-symbol I4', and list-order I5; it never treats state membership
as a cross-symbol ordering.

The frozen corpus contains 40 sessions (28 train, 12 holdout), 68 fetched symbols, 61 ranked symbols,
and seven reference-only symbols. The accepted measurement is log1p dense Participation plus log1p
range with theoretical-maximum score rescaling. It eliminates exact-100 saturation while preserving
within-minute score discrimination.

The published episode lifecycle uses a 45-minute cooling timeout. Across the selected exit policy,
training has 152 episodes, five with a re-entry; holdout has 51 episodes, one with a re-entry. Re-entry
count per episode has median 0 and maximum 1 in both splits. Re-entry during cooling never creates an
extra NOW IN PLAY alert.

The full exit threshold × persistence frontier is versioned in `exit-lifecycle-frontier.json`. The
provisional selection rule was the highest settled share among points with at least 10% regular-session
coverage in both train and holdout. It selected IN PLAY exit core 0.66 with 15-minute exit persistence.
Its train behavior is 12.90% coverage, 23.32% settled display share, 48.82-point median decay, and
16-minute median peak-to-removal; holdout is 13.27%, 15.93%, 55.12 points, and 16 minutes. Those liveness
figures are weak and remain disclosed; standing coverage is secondary because NOW IN PLAY is now the
primary product alert and IN PLAY is a score-ordered context list.

Alert-frequency verification ran every frontier point with the lifecycle enabled. NOW IN PLAY alerts
per session at the selected point are train median 3.5, IQR 1–7, min 0, max 29; holdout median 3.5,
IQR 1.75–5.75, min 1, max 11. Every tested point had the same 3.5 median because the 45-minute cooling
lease absorbed short exit/re-entry cycles. The provisional point therefore passed the 2–15 median bound
and is published as exit 0.66 / persistence 15 under calibration identity
`mode-map-v3:measure-v1:curve-v3:state-v4:sip:regular:population-82f216fdd69d:alert-verified-42b9fb71b210`.
This is population/generated-event behavior, not ground-truth validation.

## Negative results — WAKING UP retirement (normative)

The original freshness/episode gate is withdrawn as a circular design error. The retired thesis was that attention-score velocity from one-minute OHLCV could surface actionable
names before the attention-level state did. It was tested three independent ways:

1. The originally specified episode/freshness-gated list produced 0% coverage.
2. After the episode-scoped pullback fix it produced 0.09% train / 0.09% holdout and no publishable fit.
3. After structural decoupling from state, episode, and freshness it produced 9.90% train / 11.43%
   holdout, but the required quiet sessions no longer stayed quiet. The quiet-preserving variant fell
   to 0.23% / 0.28%, had one-minute dwell, and had a −202-minute holdout lead: on median it fired more
   than three hours after IN PLAY entry.

Conclusion: attention velocity does not lead attention level in this corpus. One-minute OHLCV cannot
show the move beginning; by the time a completed bar reports unusual volume, the move has begun. The
required signal lives in tape/book data, deliberately out of scope. WAKING UP is permanently retired
as a displayed list, event/alert surface, cluster override, calibration target, and I5 ordering clause.
These numbers and the conclusion are canonical specifically to prevent re-litigation without a new
data modality and explicit trader authorization.
### A2 entry gates carried forward

- The versioned mode differ must pass both the real archive-regeneration diff and a forced synthetic
  sparse-to-dense flip with the old cache identity invalidated.
- Mode-transition suppression and opening-period protection must compose, not add their durations.
  Opening protection is evidence/persistence tightening rather than a blanket delay; a mode change at
  09:30 must not silence valid opening events through 09:45 by stacking guards.
- Seven viable sets are population-calibrated and five IEX nonregular sets are unavailable by
  construction. Replay reports still refuse performance or ground-truth validation conclusions;
  population calibration alone may not justify claims about discovery quality, latency, or capture.

### 3.18 Halt inference on partial feeds

On IEX, trading-status messages are unavailable. The runtime therefore activates halt inference: a
configured zero-volume/no-print run followed by a gapped resume is labelled `halt_inferred` and then
`resume_inferred`, never a confirmed exchange halt. The resume window activates the same acceleration
suppression guard as a confirmed halt so restart discontinuity cannot emit ACCELERATION. A later SIP
status message may confirm a halt, but the original inference remains auditable. Sparse/dead baseline
semantics alone are insufficient to claim a halt; the inference requires the full configured temporal
and gap signature.
## 4. Phase B — Market Map

Deep Market Map work applies only to the active subset. Cheap current price, VWAP, HOD, and LOD state
is maintained for the full fetched universe.

Static/session levels are PMH, PML, PDH, PDL, prior close, ORH, ORL, and VWAP. Dynamic levels are
literal HOD/LOD, meaningful intraday swing highs/lows, and confirmed consolidation boundaries.
Literal HOD/LOD and meaningful swings are distinct identities.

### 4.1 Opening range

One configurable definition is authoritative: 15 minutes by default, supporting only 5, 15, or 30
minutes. It is anchored absolutely to the exchange calendar's regular open—09:30 ET on current US
sessions—never to the first received bar. Missing 09:30 data cannot shift the window. ORH/ORL remain
unavailable until the configured clock window has closed.

### 4.2 Meaningful swings and consolidations

Meaningful swings reuse `findPivots` through `confirmedPivotLevels`; no additional pivot algorithm is
permitted. A swing must be causally confirmed and pass configurable minimum ATR separation, time/bar
separation, and persistence. Consolidation boundaries require a configurable number of completed
five-minute bars inside a maximum ATR-normalized width.

### 4.3 Level relevance

Every level exposes recency, reaction count, volume at interaction, rejection strength, reclaim count,
still-unbroken status, and an explainable 0–100 relevance score. Premarket automatic priority decays
after the open. Observed interaction evidence does not: repeated PMH/PML reactions can make that level
more relevant later in the session even after automatic priority has decayed.

### 4.4 Destination/reference engine

Active names expose nearest and next references above and below with price, distance percent, distance
in ATR, expected-session-move fraction when available, and relevance. Allowed language is “Nearest
upside reference” or “Next downside reference.” Deterministic claims such as “price will target,”
“guaranteed target,” or equivalents are forbidden. References describe where price is, not what it
will do.

Phase B contains no event generation, alerts, direction state, regime classification, advanced TA, or
live wiring. Market Map outputs are deterministic from completed bars and replay identically.

## 5. Phase C — replay-only event engine

Phase C generates and stores deterministic replay events only. No push, email, webhook, scheduler,
live delivery, paid feed, or deployment path is authorized. `alertEmissionEnabled=false` is the rollback
state: no alert is generated, stored, surfaced, or left pending, while attention replay remains unchanged.

### 5.1 NOW IN PLAY

NOW IN PLAY is the primary alert. It fires only on the first IN PLAY entry of an episode. An exit into
cooling and re-entry within the 45-minute cooling lease resumes the same episode and cannot re-alert.
Qualification after completion creates a new episode and may alert.

The qualifying row is captured immutably when the transition occurs. NOW IN PLAY is never suppressed
because freshness is Extended. It emits at qualification and carries the prominent literal warning
`EXTENDED — do not chase` plus ATR travelled since the back-dated episode start. Extension remains
a suppression reason for ACCELERATION.

Every alert carries `qualifiedAt`, `emittedAt`, qualifying attention score, state-decision core,
raw core, exact IN PLAY entry threshold, feed mode, sub-window, calibration identity, all three axis
contributions, freshness, ATR travelled from the back-dated episode start, nearest reference and ATR
distance, and data-quality/feed badges. The qualifying snapshot is immutable. Its literal notice is
`NOT AN ENTRY — open the chart.` I6 and I7 execute before storage.
### 5.2 ACCELERATION

ACCELERATION is for an already-active episode. It requires contemporaneous Participation acceleration
and Displacement acceleration plus supportive Idiosyncrasy, persistence, and cooldown. One-axis motion
can never fire it. It consumes per-axis deltas, not attention-score velocity.

### 5.3 KEY LEVEL EVENT

Supported event semantics are approach, break, reclaim, rejection, retest, and failed break. Eligible
levels are HOD, LOD, PMH, PML, PDH, PDL, ORH, ORL, VWAP, and meaningful confirmed intraday swings.
Proximity is ATR-normalized. Identity is `(symbol, level identity, event type, episode)` and is emitted
at most once until a materially distinct event state exists. The published replay relevance floor is the observed p90, `84.11111111111111`/100. Semantic transition remains unchanged and supplies the selective state-change gate; the full suppression/audit trail is retained.

### 5.4 DIRECTION TRANSITION

Unavailable until Phase D supplies a typed direction state. Phase C does not fabricate it.

### 5.5 FAILED ACCELERATION

The A3 classification remains available as context and is not a short signal. Visible alert emission
is optional and disabled in the published Phase C replay configuration.

### 5.6 Suppression, expiry, and session boundaries

Cooldown, persistence, data quality, backfill, halt/resume, mode transition, opening protection,
material change, event identity, and episode identity are explicit suppression inputs. Extension is
event-specific: it suppresses ACCELERATION but never NOW IN PLAY. A suppressed edge remains pending
or re-arms only while it is actionable. Every suppression is logged with reason and disposition.

A pending alert has a configurable hard expiry, default 10 minutes. Once older than
`pendingAlertMaxAgeMinutes`, it is dropped and logged as `pending_expired`; it can never leak later.
An event at or after its calendar alert-session close is dropped as `session_closed`. Ordinary SIP
sessions retain calibrated extended-hours alerting through 20:00 ET. A scheduled early close is a hard
regular-session alert cutoff (13:00 ET for 2025-11-28) until a close-relative baseline exists.

ACCELERATION in the same episode and emission minute as NOW IN PLAY is discarded as
`redundant_with_entry`; it does not add a second byte-identical alert.
### 5.6b Post-storage tiered delivery

Delivery tiering runs after detection and durable event storage. It never changes engine state, episode
state, event identity, suppression logs, ranking, or the standing IN PLAY list.

- **PRIMARY — NOW IN PLAY.** Retains the existing four-envelope rolling 15-minute budget. Events
  inside direct capacity deliver individually; one slot may become an update-in-place overflow digest.
  A NOW IN PLAY name at least 10 attention points above the prior rolling-window peak may override the
  PRIMARY cap. Material override is unavailable to every other type.
- **SECONDARY — KEY LEVEL EVENT and ACCELERATION.** Never deliver individually. At most one
  update-in-place SECONDARY digest starts per rolling 15 minutes, and it lists every secondary event
  in that window with a link to the full event list.

PRIMARY and SECONDARY budgets are independent. Stored detections, carried events, and delivered
envelopes are distinct counts in every report. No tier may drop a durable detection or silently delay
an expired event.
### 5.7 Cooldown and identity overrides

A new episode, materially new level state, or fulfilled multi-axis acceleration after cooldown may emit.
Raw rank motion never overrides cooldown or identity. Re-entry within a cooling episode is explicitly
not a new episode.

### 5.8 Opening-period protection

From 09:30–09:45 ET, time-of-day normalization remains primary and event evidence is tightened with
persistence and a stricter Displacement requirement; there is no blanket delay. The mode-transition
guard releases independently at 09:40 in the calibrated composition and does not stack into silence
through 09:45.

The pre-fix diagnosis found mechanism (a): all original qualifying rows met their exact entry
threshold, but Extended rows were held pending and payload construction later read the emission row.
Cooling expiry never bypassed the gate. I6/I7 now freeze the qualifying row and reject any inconsistent
event before storage.

The extension guard itself was then withdrawn for NOW IN PLAY. In the corrected five-session replay,
all 47 emitted NOW IN PLAY alerts have a zero-minute qualifying-to-emission gap and zero threshold
violations. Freshness at qualification is Fresh 0, Developing 1, Mature 1, Extended 45. Every Extended
payload carries `EXTENDED — do not chase` prominently with ATR travelled. ACCELERATION still suppresses
Extended cases.

This semantic correction did not preserve the previous frequency: NOW IN PLAY rose from 26 delayed
emissions to 47 immediate, non-early-close emissions (35 regular, 10 after-hours core, and 2 premarket).
That is a product finding, not hidden variance; the artifact is diagnostic and requires trader review
before the alert-frequency policy can be called published. The complete type counts are NOW IN PLAY 47,
ACCELERATION 1, KEY LEVEL EVENT 3, and optional FAILED ACCELERATION 0. Per-session alert totals are
9, 32, 9, 0, and 1 for 2025-10-01, 2025-10-10, 2025-11-04, 2025-11-28, and 2026-02-13.

Early-close diagnosis confirmed a measurement mismatch. Current baseline identity is symbol x
minute-of-day only, so 12:59 on 2025-11-28 was compared with ordinary 12:59 midday history rather than
a closing-auction bucket. The corpus contains one early close out of 40 sessions (2.5%), insufficient
for its own empirical distribution. Until a versioned close-relative baseline is built, the final
15 minutes of an early-close session are excluded from alert emission and logged as
`early_close_baseline_unavailable`. At and after 13:00, candidates are logged as `session_closed`.
The replay quarantined 19 candidates (5 NOW IN PLAY and 1 ACCELERATION before 13:00; 13 NOW IN PLAY at
or after the close), The 18 dropped NOW IN PLAY candidates would otherwise be 27.69% of corrected entry candidates; all 19 dropped events would be 27.14% of all corrected alert candidates. The early-close
session emitted zero alerts. Full emitted distributions and early-close-excluded distributions are
therefore identical, while the quarantined counterfactual remains inspectable.

The pre-publication five-session post-storage delivery pass left all 51 stored detections unchanged and produces
30 delivery envelopes: 28 direct and 2 digest envelopes, with 23 NOW IN PLAY detections compacted.
Per-session detected/delivered counts are 9/9, 32/11, 9/9, 0/0, and 1/1. On 2025-10-10, two digests
compact 20 and 3 names respectively; the measured maximum ordinary delivery envelopes of all event types in any
rolling 15-minute window is four. One explicit material override fired: GDX at 10:48 ET on 2025-10-01 with attention 92.39.

Pre-publication Extended-classification diagnosis found that the then-active definition was not legacy EMA-only. It was an
OR across travel from the back-dated episode start >=2 ATR, distance from VWAP >=1.5 ATR, distance
from EMA9 >=1.5 ATR, and four uninterrupted expansion bars. At qualification, episode travel has
median 1.38 ATR (IQR 0.62-2.76), EMA9 distance median 1.59 ATR (IQR 1.17-1.94), and VWAP distance
median 2.94 ATR (IQR 1.98-4.94). Removing back-dating as a control still produces Fresh 1, Mature 1,
and Extended 45; zero entries are Extended only because of back-dated travel. Back-dating is not the
cause in this sample. However, 21 of 45 Extended entries are below the legacy 1.5-ATR EMA9 distance,
so the current label is materially broader than the legacy `too far now` claim. No freshness rule or
warning was changed in this diagnostic round.

Pre-publication ACCELERATION diagnosis found 9,751 active-episode symbol-minutes and 1,684 IN PLAY symbol-minutes.
Cumulative confluence falls 453 participation -> 115 displacement -> 95 supportive idiosyncrasy ->
8 with two-minute persistence -> 1 after the Extended suppression; that survivor emits. Persistence
is the primary binding gate and extension is the secondary binding gate. No threshold changed.

Pre-publication KEY LEVEL EVENT diagnosis observed 33,516 allowed level observations. Relevance has p50 67.50,
p90 84.11, p95 84.72, p99 88.46, and max 92.42 against the fixed floor 90; only 0.55% of allowed
observations meet it. The row funnel is 1,684 eligible -> 169 with a relevant level -> 3 semantic
transitions -> 3 emitted. Relevance is the first binding population gate and semantic transition is
the final binding gate. No threshold changed.

The sole 2026-02-13 NOW IN PLAY alert is AAPL at 08:53 ET in `premarket_core`. The earlier
finding of zero IN PLAY names across all 390 regular-session minutes remains correct.
This is a replay integrity and usability census, not performance evidence.
### 5.9 Published empirical gate resolution (normative)

D1 is published. Across the 40-session corpus it changes Fresh/Developing/Mature/Extended from
`1/3/5/257` under D3 to `1/75/61/129`; NOW IN PLAY rows not flagged Extended rise from 9 to 137 of
266. In the five-session digest D1 yields `0/16/7/24`, leaving 23 of 47 not Extended. D2 was rejected
because EMA9-or-episode-travel conflates a historical move with current entry extension; it produced
154/266 Extended. D3 was rejected because VWAP distance and expansion momentum describe trend and
activity, not necessarily lateness; it produced 257/266 Extended. These rejection reasons and counts
are regression-protected so the broader OR definition cannot be silently reintroduced.

KEY LEVEL EVENT publishes the distribution-derived p90 relevance floor `84.11111111111111`.
At that floor the five-session semantic funnel is 1,063 relevant symbol-minutes -> 89 transitions ->
64 novel identities. The isolated D3 diagnostic emitted 15, but the combined published D1 policy
removes extension suppression from additional valid level transitions and emits 43. This interaction
is explicit; it is not evidence that the semantic-transition gate changed.

ACCELERATION publishes two-minute confluence with D1 extension suppression. The funnel remains
95 supportive confluence rows -> 8 with two-minute persistence -> 6 not Extended -> 4 emitted after
cooldown and same-minute entry deduplication. One-minute+D1 produced 52 candidate events across five
sessions and is explicitly rejected unless trader-adjudicated labels justify reconsideration.

Combined published detection totals are NOW IN PLAY 47, ACCELERATION 4, KEY LEVEL EVENT 43, and
FAILED ACCELERATION 0 (94 stored detections). Tiered delivery keeps all 94 detections and produces 39
envelopes: 24 direct PRIMARY, two PRIMARY overflow digests carrying 23 PRIMARY events, and 13
SECONDARY digests carrying all 47 SECONDARY events. Per-session
`primary detected / secondary detected / primary direct / primary digest / secondary digest / total`
is `8/12/8/0/4/12`, `32/25/9/2/5/16`, `6/10/6/0/4/10`, `0/0/0/0/0/0`, and
`1/0/1/0/0/1`. Both rolling budgets hold. Normal-session direct PRIMARY delivery is 8, 9, 6, 0, and
1; only high-volatility 2025-10-10 exceeds eight, by one. Detection thresholds and budgets are not
retuned.

The IN PLAY entry-threshold sweep from 0.80 toward 0.40 is **withdrawn and cancelled**. It existed to
address D3's over-broad Extended complaint. D1 resolves that semantic defect without adding lower-score
qualifications or sacrificing conversion quality. The published SIP-regular entry remains 0.80.
## 6–7. Later layers (not authorized now)

- **Direction/regime/maturity:** typed, persistent transitions; repeated VWAP chop cannot flip state
  every cross; session phases come from an exchange calendar, including holidays and early closes.
- **Advanced TA:** preserve existing FVG, MSS, BOS, liquidity, EMA, and displacement detectors as
  present/absent/unavailable supporting evidence. Do not invent new pattern logic before wiring the
  existing evidence.
## 8. Logging and analysis quarantine

Log raw axis inputs, normalized values, core/modifier, ranks, episodes, quality, direction, maturity,
levels, regime, alerts, suppressions, options tier, and supporting TA. Forward outcomes use the open of
the bar after an event and retain triggering close, MFE, MAE, ordering, timing, and reference reach.
Move capture reads future bars and must live under `analysis/**`; live attention/events/direction code
cannot import it, enforced by test/lint boundary. Compare events with a random non-alerted symbol,
SPY, QQQ, and sector ETF. Report excess performance, not raw follow-through as edge.

Pre-registered questions require at least 150 events per arm across at least 20 sessions. No ML, AI
prediction, or LLM in the per-minute path.

## 9–14. UI, engineering, tests, and success

UI order is Market Header, IN PLAY (score ordered), WATCHING/EMERGING state badges, collapsed LOW PRIORITY, cluster compaction, and symbol detail. Attention velocity and freshness remain row context; neither creates a separate list. Always show feed/data-quality badges and the non-equivalence warnings.

Engineering requires modular typed state, centralized configuration, injected time, explainability,
structured logs, debug dumps, config-coverage testing, replay determinism, analysis import quarantine,
rollback/fallback, and no deep TA across all symbols. Required tests include axes, robust baselines,
confluence, sector-wide moves, state/list transitions, hysteresis, episodes, events/cooldowns,
cluster/options-tier invariants, missing/duplicate/delayed/out-of-order/backfill/halt/reconnect data,
holidays/early closes, feed modes, determinism, and architecture boundaries.

Non-goals: automated execution, options orders, guaranteed targets, probability claims, mandatory
advanced-TA confirmation, news explanation, LLM/ML scoring, full rewrite, deleting advanced TA, or a
large dependency expansion.

## 15. Implementation order

Completed through Phase C: Phase 0 → A-Zero → A1 → A2 → A3 → replay calibration → B → C.
The authorized future order is **E → G1 → D → F → G2 → G3**.

E precedes G1 because existing FVG/MSS/BOS/liquidity/EMA/displacement detectors need the Advanced TA
panel before pattern rows have a rendering surface. G1 must use the corrected Pattern + Historical-
Analog Addendum v3 only when supplied and authorized; earlier drafts are invalid. D precedes G2 because
G2 regime stratification depends on direction/regime state.

F has two independent halves. Forward performance, MFE/MAE, and SPY/QQQ/sector/random controls are
computable without labels. Ground-truth hit rate, latency, and discovery quality remain blocked on
trader-adjudicated labels. G1's measurement question must be pre-registered before G1 ships and answered
in F.

## 16. Current authorization

Phase C replay implementation and alert-frequency verification are complete. The IN PLAY entry sweep
is cancelled. A scoped live-runtime plan is authorized as documentation only; implementation is not.
Do not start Phase E, G1, Direction/Regime, forward statistics, or live-runtime construction without
new authorization. Do not subscribe to a paid feed, deploy, or apply any pending or proposed migration.
Ground-truth validation remains unavailable until trader-adjudicated labels exist.