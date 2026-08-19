# Attention Engine population calibration — FAILED

> Timing statistics derived from historical pulls assume instantaneous bar availability. Real arrival latency is not represented. Human-relative latency and move-capture figures are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.

## CALIBRATION STATUS — FAILED; NO THRESHOLDS PUBLISHED

> Population calibration is not ground-truth validation. No hit rate, latency, move capture, false-positive rate, or discovery-quality conclusion is available.

Artifact: `eb46b850bfbe2c38e504bf64920cb740fe6ffc271e82b3e705cce3c99393268f`. Frozen split: `82f216fdd69dbb70ae1a5e025e7862486dadf172828c86a7fc11ddf152571a7d`. Raw features: `7d9608733933679eb70dd27972a414b8a63f81f4e39954ac5662d462dd0554ca`.

The A3 report's `Final WAKING UP: AAOI` was a contract fixture, not a historical session result.

## Resolved product limitation — IEX-partial extended hours

> **ON THE FREE IEX FEED, THE SCANNER OPERATES DURING THE REGULAR SESSION ONLY. Premarket and after-hours coverage require the consolidated feed.**

The mechanism is structural partial-feed sparsity, not a shortage of sessions. Early and late windows contain no target bars. The shoulder windows have 1.3–4.2% target coverage, incomplete synchronized references, and too few displacement/reference baselines. These five sets are `unavailable_by_construction`, emit `insufficient_reference`, and never use a SIP or adjacent-window fallback.

| Feed | Sub-window | Established training rows | Status |
|---|---|---:|---|
| sip | premarket_early | 86218 | calibrated |
| sip | premarket_core | 105125 | calibrated |
| sip | premarket_final | 34236 | calibrated |
| sip | regular | 635452 | calibrated |
| sip | after_hours_core | 88103 | calibrated |
| sip | after_hours_late | 69914 | calibrated |
| iex_partial | premarket_early | 0 | unavailable_by_construction |
| iex_partial | premarket_core | 79 | unavailable_by_construction |
| iex_partial | premarket_final | 118 | unavailable_by_construction |
| iex_partial | regular | 533054 | calibrated |
| iex_partial | after_hours_core | 39 | unavailable_by_construction |
| iex_partial | after_hours_late | 0 | unavailable_by_construction |

## Remaining blocker — I4 settled ordering conflicts with hysteresis

Replay stopped at: **sip 2025-10-10 11:21 ET: I3 SETTLED DEMOTION violated by USO: WATCHING exit persisted without demotion (state=IN_PLAY, pending=exiting:19, runs={"watchingEnter":0,"emergingEnter":0,"inPlayEnter":0,"watchingExit":20,"emergingExit":20,"inPlayExit":19}).**

The original AMD/CRWV pending-transition case now passes I1–I4. This failure contains no pending transition: the lower-state symbol and higher-state symbol are both settled inside the same hysteresis overlap. Any strict enter/exit gap permits this ordering, so I4 cannot be guaranteed without changing either hysteresis or the meaning of `pendingTransition`. The assertion was preserved and the replay failed, as required.

## Provisional curve-v1 translation

WATCHING 0.25 → z=1.0845 on both axes; EMERGING 0.50 → z=2.0000; IN PLAY 0.70 → z=2.7061. At one axis z=6, the partner still requires z=1.9801. Every viable unpublished proposal passed the hard z≥1.90 asymmetric confluence guard.

## Unpublished fit proposals

These are diagnostics only. They were not written to the scoring calibration store.

| Feed | Window | Status | Train rows | WATCH | EMERGE | IN PLAY | Velocity |
|---|---|---|---:|---:|---:|---:|---:|
| sip | premarket_early | calibrated | 86218 | 0.3464 | 0.4052 | 0.7230 | 6.028 |
| sip | premarket_core | calibrated | 105125 | 0.3503 | 0.4162 | 0.7219 | 6.232 |
| sip | premarket_final | calibrated | 34236 | 0.2581 | 0.3047 | 0.7227 | 6.140 |
| sip | regular | calibrated | 635452 | 0.5759 | 0.6654 | 0.8000 | 7.620 |
| sip | after_hours_core | calibrated | 88103 | 0.3571 | 0.4243 | 0.7179 | 6.328 |
| sip | after_hours_late | calibrated | 69914 | 0.3479 | 0.4069 | 0.7240 | 5.790 |
| iex_partial | premarket_early | unavailable_by_construction | 0 | n/a | n/a | n/a | n/a |
| iex_partial | premarket_core | unavailable_by_construction | 79 | n/a | n/a | n/a | n/a |
| iex_partial | premarket_final | unavailable_by_construction | 118 | n/a | n/a | n/a | n/a |
| iex_partial | regular | calibrated | 533054 | 0.7930 | 0.8697 | 0.9312 | 10.416 |
| iex_partial | after_hours_core | unavailable_by_construction | 39 | n/a | n/a | n/a | n/a |
| iex_partial | after_hours_late | unavailable_by_construction | 0 | n/a | n/a | n/a | n/a |

## Frozen corpus composition

40 sessions = 28 train + 12 untouched holdout. Halt evidence is only an inferred SIP bar gap because historical pulls do not include trading-status messages.

| Date | Split | Primary | Tags | Early close | Holiday adjacent | Halt evidence |
|---|---|---|---|---|---|---|
| 2025-10-01 | holdout | trending_up | trending_up | no | no | unconfirmed bar gap |
| 2025-10-10 | train | high_volatility | trending_down, high_volatility | no | no | none |
| 2025-10-24 | train | quiet | quiet | no | no | unconfirmed bar gap |
| 2025-10-28 | train | quiet | chopping, quiet | no | no | unconfirmed bar gap |
| 2025-11-04 | train | chopping | chopping | no | no | none |
| 2025-11-14 | train | high_volatility | trending_up, high_volatility | no | no | none |
| 2025-11-20 | train | high_volatility | trending_down, high_volatility | no | no | none |
| 2025-11-24 | train | trending_up | trending_up | no | yes | none |
| 2025-11-28 | train | quiet | quiet | yes | yes | none |
| 2025-12-09 | train | quiet | chopping, quiet | no | no | none |
| 2025-12-10 | train | trending_up | trending_up | no | no | none |
| 2025-12-17 | train | trending_down | trending_down | no | no | none |
| 2025-12-30 | train | quiet | chopping, quiet | no | yes | none |
| 2026-01-20 | train | trending_down | trending_down | no | yes | none |
| 2026-01-21 | train | high_volatility | trending_up, high_volatility | no | yes | none |
| 2026-01-27 | holdout | quiet | quiet | no | no | none |
| 2026-01-29 | train | high_volatility | chopping, high_volatility | no | no | none |
| 2026-01-30 | holdout | chopping | chopping | no | no | none |
| 2026-02-02 | holdout | high_volatility | chopping, high_volatility | no | no | none |
| 2026-02-06 | train | high_volatility | trending_up, high_volatility | no | no | none |
| 2026-02-12 | holdout | high_volatility | trending_down, high_volatility | no | no | none |
| 2026-02-13 | train | chopping | chopping | no | yes | none |
| 2026-02-25 | holdout | quiet | trending_up, quiet | no | no | none |
| 2026-03-09 | train | high_volatility | trending_up, high_volatility | no | no | none |
| 2026-03-10 | train | chopping | chopping | no | no | none |
| 2026-03-27 | train | trending_down | trending_down | no | no | none |
| 2026-03-31 | train | high_volatility | trending_up, high_volatility | no | yes | none |
| 2026-04-02 | holdout | high_volatility | trending_up, high_volatility | no | yes | none |
| 2026-04-20 | train | quiet | chopping, quiet | no | no | none |
| 2026-04-21 | holdout | trending_down | trending_down | no | no | none |
| 2026-04-22 | holdout | quiet | quiet | no | no | none |
| 2026-05-06 | train | trending_up | trending_up | no | no | none |
| 2026-05-07 | holdout | trending_down | trending_down | no | no | none |
| 2026-05-27 | train | quiet | chopping, quiet | no | yes | none |
| 2026-06-02 | train | quiet | quiet | no | no | none |
| 2026-06-09 | holdout | high_volatility | chopping, high_volatility | no | no | none |
| 2026-06-26 | train | high_volatility | chopping, high_volatility | no | no | none |
| 2026-07-22 | train | quiet | chopping, quiet | no | no | none |
| 2026-07-29 | train | high_volatility | trending_down, high_volatility | no | no | none |
| 2026-08-14 | holdout | quiet | trending_down, quiet | no | no | none |

## Missing requested outputs

State dwell, transition, zero-IN-PLAY, and holdout state populations are unavailable because the mandatory ordering assertion terminated the training replay before holdout evaluation began. Reporting them from a guard-disabled run would contradict the accepted A3 contract.

## Scope fence

No subscription, deployment, migration, Phase B work, Market Map, events, alerts, direction, regime, advanced TA, or live wiring was performed.
